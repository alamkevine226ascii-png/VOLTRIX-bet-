#!/usr/bin/env bun
// ============================================================
// VOLTRIX bet — Blind test JJA 2026 · PHASE 1a : COLLECTE DES MATCHS
// ============================================================
// PHASE 1 (prédictions) — étape 1/3.
// Règle anti-fuite structurelle : ce script collecte les FIXTURES
// (identité des matchs) et NE STOCKE JAMAIS :
//   - les scores finaux (champs home.score / away.score supprimés) ;
//   - les cotes du scoreboard (odds du scoreboard ignorées).
// Les résultats ne seront récupérés qu'en PHASE 2 (script séparé),
// après gel SHA-256 des prédictions.
//
// Sortie : scripts/blindtest/data/fixtures.json
// ============================================================

import { fetchScoreboard } from '../../src/lib/espn';
import { mapWithConcurrency } from '../../src/lib/cache';
import { writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

const SCRIPT_DIR = dirname(resolve(process.argv[1] ?? '.'));
const DATA_DIR = join(SCRIPT_DIR, 'data');

const FROM = '2026-06-01';
const TO = '2026-08-31';

const LEAGUES = [
  // Priorité A — têtes d'affiche
  'fifa.world', 'eng.1', 'fra.1', 'esp.1', 'ita.1', 'ger.1', 'bra.1', 'usa.1', 'mex.1', 'arg.1',
  // Priorité B — été européen
  'nor.1', 'swe.1', 'irl.1', 'den.1', 'fin.1',
  // Priorité C — Amériques
  'col.1', 'chi.1', 'uru.1', 'par.1', 'per.1', 'ecu.1', 'usa.nwsl',
  // Priorité D — Asie/Océanie
  'jpn.1', 'chn.1', 'kor.1', 'aus.1',
  // Priorité E — coupes continentales (qualifs juin-août)
  'conmebol.libertadores', 'conmebol.sudamericana', 'uefa.champions', 'uefa.europa', 'uefa.europa.conf',
];

function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

interface Fixture {
  matchId: string;
  league: string;
  kickoff: string; // ISO UTC
  homeId: string;
  homeName: string;
  awayId: string;
  awayName: string;
  status: string; // 'pre' | 'in' | 'post'
  statusDetail: string;
  completed: boolean;
}

async function fetchBoardWithRetry(league: string, date: string, retries = 1): Promise<ReturnType<typeof fetchScoreboard>> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fetchScoreboard(league, date);
    } catch (e) {
      if (attempt === retries) throw e;
      await new Promise((r) => setTimeout(r, 1200));
    }
  }
  return null;
}

async function main(): Promise<void> {
  const dates = datesBetween(FROM, TO);
  console.log(`[collecte] fenêtre ${FROM} → ${TO} (${dates.length} jours) × ${LEAGUES.length} ligues = ${dates.length * LEAGUES.length} appels scoreboard…`);

  const seen = new Set<string>();
  const fixtures: Fixture[] = [];
  const excluded = { voidOrCancelled: 0, noTeams: 0, outsideWindow: 0, duplicated: 0 };
  const scoreboardCalls = { ok: 0, fail: 0 };
  const perLeague: Record<string, number> = {};

  let dayIndex = 0;
  for (const date of dates) {
    const boards = await mapWithConcurrency(LEAGUES, 5, async (league) => {
      try {
        const board = await fetchBoardWithRetry(league, date);
        scoreboardCalls.ok++;
        return { league, board };
      } catch {
        scoreboardCalls.fail++;
        return { league, board: null };
      }
    });
    for (const { league, board } of boards) {
      if (!board) continue;
      for (const e of board.events) {
        if (seen.has(e.id)) {
          excluded.duplicated++;
          continue;
        }
        seen.add(e.id);
        const kickoffDay = (e.date ?? '').slice(0, 10);
        if (kickoffDay < FROM || kickoffDay > TO) {
          excluded.outsideWindow++;
          continue;
        }
        if (!e.home?.team || !e.away?.team) {
          excluded.noTeams++;
          continue;
        }
        const isVoid = /canceled|cancelled|postponed|abandoned|suspended|forfeit|void/i.test(e.statusDetail ?? '');
        if (isVoid) excluded.voidOrCancelled++;
        const fx: Fixture = {
          matchId: e.id,
          league,
          kickoff: e.date,
          homeId: e.home.team.id,
          homeName: e.home.team.displayName ?? e.home.team.name ?? '',
          awayId: e.away.team.id,
          awayName: e.away.team.displayName ?? e.away.team.name ?? '',
          status: e.status,
          statusDetail: e.statusDetail ?? '',
          completed: !!e.completed,
        };
        fixtures.push(fx);
        perLeague[league] = (perLeague[league] ?? 0) + 1;
      }
    }
    dayIndex++;
    if (dayIndex % 10 === 0) console.log(`[collecte] jour ${dayIndex}/${dates.length} (${date}) — ${fixtures.length} fixtures`);
  }

  fixtures.sort((a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff) || a.matchId.localeCompare(b.matchId));

  const collectedAt = new Date().toISOString();
  const payload = {
    meta: {
      title: 'VOLTRIX blind test JJA 2026 — fixtures (Phase 1a)',
      collectedAt,
      window: { from: FROM, to: TO },
      leagues: LEAGUES,
      counts: {
        fixtures: fixtures.length,
        completed: fixtures.filter((f) => f.completed).length,
        voidOrCancelledFlagged: excluded.voidOrCancelled,
        scoreboardCallsOk: scoreboardCalls.ok,
        scoreboardCallsFail: scoreboardCalls.fail,
      },
      excluded,
      perLeague,
      // NOTE ANTI-FUITE : ce fichier ne contient AUCUN score. Les statuts
      // (completed / statusDetail) servent uniquement à la sélection des
      // matchs — jamais comme entrée du moteur de prédiction.
      antiLeakage: 'Aucun score stocké en Phase 1 — résultats réservés à la Phase 2 (après gel des prédictions).',
    },
    fixtures,
  };

  const outPath = join(DATA_DIR, 'fixtures.json');
  writeFileSync(outPath, JSON.stringify(payload, null, 1));
  const perMonth: Record<string, number> = { '2026-06': 0, '2026-07': 0, '2026-08': 0 };
  for (const f of fixtures) perMonth[f.kickoff.slice(0, 7)]++;
  console.log(`\n[collecte] TERMINÉ — ${fixtures.length} fixtures (${perMonth['2026-06']} juin / ${perMonth['2026-07']} juillet / ${perMonth['2026-08']} août)`);
  console.log(`[collecte] appels scoreboard OK=${scoreboardCalls.ok} fail=${scoreboardCalls.fail} · exclus: void=${excluded.voidOrCancelled} sansÉquipes=${excluded.noTeams} horsFenêtre=${excluded.outsideWindow}`);
  console.log(`[collecte] par ligue : ${Object.entries(perLeague).sort((a, b) => b[1] - a[1]).map(([l, n]) => `${l}=${n}`).join(' ')}`);
  console.log(`[collecte] écrit : ${outPath}`);
}

main().catch((e) => {
  console.error('Collecte échouée:', e);
  process.exit(1);
});
