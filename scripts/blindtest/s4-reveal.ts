#!/usr/bin/env bun
// ============================================================
// VOLTRIX bet — Blind test JJA 2026 · PHASE 2 : RÉVÉLATION DES RÉSULTATS
// ============================================================
// Exécutée UNIQUEMENT après le gel des prédictions (vérification SHA-256
// en préambule : si le snapshot a changé, ABANDON immédiat).
// Pour chaque match : endpoint summary ESPN →
//   - score final + statut (header.competitions) ;
//   - cotes CLOSE (pickcenter) conservées comme RÉFÉRENCE marché-clôture
//     UNIQUEMENT — jamais comme entrée du moteur (elles n'entrent en
//     contact avec aucune probabilité gelée).
//
// Sortie : data/results.json (fichier SÉPARÉ du snapshot de prédictions)
// ============================================================

import { pickcenterToOdds, type RawPickcenter } from '../backtest-lib';
import { isVoidStatusDetail } from '../../src/lib/grade';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, resolve } from 'node:path';
import { mapWithConcurrency } from '../../src/lib/cache';

const SCRIPT_DIR = dirname(resolve(process.argv[1] ?? '.'));
const DATA_DIR = join(SCRIPT_DIR, 'data');

const SUMMARY_SITE = 'https://site.api.espn.com/apis/site/v2/sports/soccer';

interface Fixture {
  matchId: string;
  league: string;
  kickoff: string;
  homeId: string;
  homeName: string;
  awayId: string;
  awayName: string;
  status: string;
  statusDetail: string;
  completed: boolean;
}

async function fetchSummary(league: string, matchId: string, retries = 1): Promise<{ json: unknown | null; error?: string }> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`${SUMMARY_SITE}/${league}/summary?event=${matchId}`, {
        headers: { 'User-Agent': 'curl/8.5.0', Accept: 'application/json' },
      });
      if (res.ok) return { json: await res.json() };
      if (attempt === retries) return { json: null, error: `HTTP ${res.status}` };
    } catch (e) {
      if (attempt === retries) return { json: null, error: (e as Error).message };
    }
    await new Promise((r) => setTimeout(r, 1200));
  }
  return { json: null, error: 'unreachable' };
}

async function main(): Promise<void> {
  // ---- 0. Vérification d'intégrité du snapshot gelé ----
  const frozenPath = join(DATA_DIR, 'predictions-frozen.json');
  const frozenBytes = readFileSync(frozenPath, 'utf8');
  const actualHash = createHash('sha256').update(frozenBytes).digest('hex');
  const expectedHash = readFileSync(`${frozenPath}.sha256`, 'utf8').split(/\s+/)[0];
  if (actualHash !== expectedHash) {
    console.error(`[révélation] ABANDON : le snapshot des prédictions a été modifié depuis le gel !\n  attendu ${expectedHash}\n  observé ${actualHash}`);
    process.exit(1);
  }
  console.log(`[révélation] intégrité du gel vérifiée (SHA-256 ${actualHash.slice(0, 16)}…) — les résultats peuvent être révélés.`);

  const fixtures = (JSON.parse(readFileSync(join(DATA_DIR, 'fixtures.json'), 'utf8')) as { fixtures: Fixture[] }).fixtures;
  console.log(`[révélation] ${fixtures.length} matchs → summary ESPN (scores + statuts + close en référence)…`);

  interface ResultRow {
    matchId: string;
    league: string;
    revealedAtUtc: string;
    statusState: string | null;
    statusDetail: string | null;
    completed: boolean;
    voidFlag: boolean;
    homeScore: number | null;
    awayScore: number | null;
    outcome1x2: 'H' | 'D' | 'A' | null;
    totalGoals: number | null;
    ou25Result: boolean | null;
    bttsResult: boolean | null;
    scoreAvailable: boolean;
    closeOddsReference: {
      provider: string | null;
      moneylineClose: { home: number | null; draw: number | null; away: number | null } | null;
      overUnderLine: number | null;
      totalCloseOdds: { over: number | null; under: number | null; line: number | null } | null;
    } | null;
    note: string | null;
  }

  const results: ResultRow[] = [];
  let fetchFails = 0;
  let done = 0;

  await mapWithConcurrency(fixtures, 5, async (f) => {
    const { json, error } = await fetchSummary(f.league, f.matchId);
    if (done % 100 === 0 && done > 0) console.log(`  ${done}/${fixtures.length}`);
    const revealedAtUtc = new Date().toISOString();
    if (!json) {
      fetchFails++;
      results.push({
        matchId: f.matchId,
        league: f.league,
        revealedAtUtc,
        statusState: null,
        statusDetail: f.statusDetail || null,
        completed: f.completed,
        voidFlag: isVoidStatusDetail(f.statusDetail),
        homeScore: null,
        awayScore: null,
        outcome1x2: null,
        totalGoals: null,
        ou25Result: null,
        bttsResult: null,
        scoreAvailable: false,
        closeOddsReference: null,
        note: `summary indisponible (${error ?? 'raison inconnue'}) — repli sur le statut du scoreboard Phase 1`,
      });
      done++;
      return;
    }
    const j = json as {
      header?: { competitions?: Array<{
        status?: { type?: { state?: string; completed?: boolean; description?: string; detail?: string } };
        competitors?: Array<{ homeAway?: string; score?: string | number }>;
      }> };
      pickcenter?: RawPickcenter[];
    };
    const comp = j.header?.competitions?.[0];
    const statusType = comp?.status?.type;
    const competitors = comp?.competitors ?? [];
    const homeC = competitors.find((c) => c.homeAway === 'home');
    const awayC = competitors.find((c) => c.homeAway === 'away');
    const parseScore = (s: string | number | undefined): number | null => {
      if (s === undefined || s === null || s === '') return null;
      const n = typeof s === 'number' ? s : parseInt(String(s), 10);
      return Number.isFinite(n) ? n : null;
    };
    let homeScore = parseScore(homeC?.score);
    let awayScore = parseScore(awayC?.score);
    const statusDetail = statusType?.detail ?? statusType?.description ?? f.statusDetail ?? '';
    const completed = statusType?.completed ?? f.completed;
    const voidFlag = isVoidStatusDetail(statusDetail) || isVoidStatusDetail(f.statusDetail);
    // Sécurité : un match VOID/annulé ne peut pas avoir de « score » exploitable
    if (voidFlag) {
      homeScore = null;
      awayScore = null;
    }
    const scoreAvailable = homeScore !== null && awayScore !== null;
    const outcome1x2 = scoreAvailable ? (homeScore > awayScore ? 'H' : homeScore === awayScore ? 'D' : 'A') : null;
    const totalGoals = scoreAvailable ? homeScore + awayScore : null;

    // Cotes CLOSE (référence uniquement)
    const pc = j.pickcenter?.[0];
    const fullOdds = pickcenterToOdds(pc);
    const closeRef = fullOdds
      ? {
          provider: fullOdds.provider,
          moneylineClose: { home: fullOdds.moneyline.home.close, draw: fullOdds.moneyline.draw.close, away: fullOdds.moneyline.away.close },
          overUnderLine: fullOdds.overUnderLine,
          totalCloseOdds: { over: fullOdds.total.over.closeOdds, under: fullOdds.total.under.closeOdds, line: fullOdds.total.over.line },
        }
      : null;

    results.push({
      matchId: f.matchId,
      league: f.league,
      revealedAtUtc,
      statusState: statusType?.state ?? null,
      statusDetail,
      completed,
      voidFlag,
      homeScore,
      awayScore,
      outcome1x2,
      totalGoals,
      ou25Result: totalGoals !== null ? totalGoals > 2.5 : null,
      bttsResult: scoreAvailable ? homeScore > 0 && awayScore > 0 : null,
      scoreAvailable,
      closeOddsReference: closeRef,
      note: null,
    });
    done++;
  });

  results.sort((a, b) => a.matchId.localeCompare(b.matchId));
  const counts = {
    total: results.length,
    scoreAvailable: results.filter((r) => r.scoreAvailable).length,
    void: results.filter((r) => r.voidFlag).length,
    noScoreNotVoid: results.filter((r) => !r.scoreAvailable && !r.voidFlag).length,
    withCloseOdds: results.filter((r) => r.closeOddsReference).length,
    fetchFails,
  };

  writeFileSync(
    join(DATA_DIR, 'results.json'),
    JSON.stringify(
      {
        meta: {
          title: 'VOLTRIX blind test JJA 2026 — RÉSULTATS RÉVÉLÉS (Phase 2, après gel)',
          revealedAtUtc: new Date().toISOString(),
          predictionsFrozenSha256: actualHash,
          source: 'ESPN summary (header.competitions = score final/statut ; pickcenter close = référence marché-clôture uniquement)',
          separation: 'Fichier SÉPARÉ du snapshot de prédictions (Phase 1). Les cotes close n\'entrent jamais en contact avec les probabilités gelées.',
          counts,
        },
        results,
      },
      null,
      0
    )
  );
  console.log(`\n[révélation] TERMINÉ — ${counts.total} résultats · scores ${counts.scoreAvailable} · VOID ${counts.void} · sans score (non-VOID) ${counts.noScoreNotVoid} · close ${counts.withCloseOdds} · échecs fetch ${fetchFails}`);
  console.log(`[révélation] écrit : ${join(DATA_DIR, 'results.json')}`);
}

main().catch((e) => {
  console.error('Phase 2 échouée:', e);
  process.exit(1);
});
