#!/usr/bin/env bun
// ============================================================
// VOLTRIX bet — Blind test JJA 2026 · PHASE 1b : DONNÉES PRÉ-MATCH
// ============================================================
// PHASE 1 (prédictions) — étape 2/3.
// 1. Calendriers équipes par (ligue, équipe, saison) — saison courante
//    + précédente (collecte UNE fois, réutilisée à toutes les horizons).
//    Le filtrage as-of (< T_pred) est fait À L'ÉVALUATION (s3), jamais ici.
// 2. Cotes pré-match : endpoint summary ESPN → pickcenter DraftKings.
//    SEULE la vue OPEN est extraite (disponible avant le coup d'envoi).
//    La vue CLOSE n'est PAS stockée en Phase 1 — elle ne pourra jamais
//    entrer dans une prédiction (référence marché-clôture = Phase 2).
//
// Sorties :
//   data/schedules.json (matière première historique, avec tag saison)
//   data/odds-open.json (cotes open uniquement + heure de capture)
// ============================================================

import { currentSeasonYear } from '../../src/lib/analyze';
import { fetchTeamSchedules, fetchHistoricalOddsV3, type CollectedMatch, type RequestStats, type TeamSeasonSchedules } from '../backtest-lib';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

const SCRIPT_DIR = dirname(resolve(process.argv[1] ?? '.'));
const DATA_DIR = join(SCRIPT_DIR, 'data');

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

interface EspnScheduleGame {
  eventId: string;
  date: string;
  opponentId: string;
  opponentName: string;
  homeAway: 'home' | 'away';
  teamScore: number | null;
  opponentScore: number | null;
  completed: boolean;
  leagueCode: string;
}

async function main(): Promise<void> {
  const fixturesRaw = JSON.parse(readFileSync(join(DATA_DIR, 'fixtures.json'), 'utf8')) as { meta: unknown; fixtures: Fixture[] };
  const fixtures = fixturesRaw.fixtures;
  console.log(`[pré-match] ${fixtures.length} fixtures chargées.`);

  // ---- 1. Équipes par ligue + saisons nécessaires ----
  const teamsByLeague = new Map<string, Set<string>>();
  const seasonSet = new Set<number>();
  for (const f of fixtures) {
    if (!teamsByLeague.has(f.league)) teamsByLeague.set(f.league, new Set());
    teamsByLeague.get(f.league)!.add(f.homeId);
    teamsByLeague.get(f.league)!.add(f.awayId);
    seasonSet.add(currentSeasonYear(f.kickoff, f.league));
  }
  const seasons = new Set<number>();
  for (const s of seasonSet) {
    seasons.add(s);
    seasons.add(s - 1); // saison précédente : historiques + profondeur Elo
  }
  const seasonList = [...seasons].sort();
  const totalTeams = [...teamsByLeague.values()].reduce((s, t) => s + t.size, 0);
  console.log(`[pré-match] équipes uniques : ${totalTeams} · saisons : ${seasonList.join(', ')} → ${totalTeams * seasonList.length} appels calendrier…`);

  const stats: RequestStats = { scoreboard: 0, schedule: 0, summary: 0, excluded: { voidOrCancelled: 0, notFinalOrNoScore: 0, noTeams: 0, outsideWindow: 0 } };
  const schedules = await fetchTeamSchedules(teamsByLeague, seasonList, stats, (m) => console.log(`  ${m}`));

  // Sérialisation condensée : { "league:teamId": { "2025": [...], "2026": [...] } }
  const schedulesOut: Record<string, Record<string, EspnScheduleGame[]>> = {};
  let totalGames = 0;
  for (const [key, entry] of schedules) {
    schedulesOut[key] = {};
    for (const [season, games] of entry.bySeason) {
      schedulesOut[key][String(season)] = games;
      totalGames += games.length;
    }
  }
  writeFileSync(
    join(DATA_DIR, 'schedules.json'),
    JSON.stringify({ meta: { collectedAt: new Date().toISOString(), seasons: seasonList, pairs: schedules.size, totalGames, note: 'Historiques BRUTS (toutes dates). Le filtrage as-of < T_pred est appliqué à l’évaluation (Phase 1c), jamais ici.' }, schedules: schedulesOut }, null, 0)
  );
  console.log(`[pré-match] calendriers : ${schedules.size} paires (ligue,équipe) · ${totalGames} matchs · écrit data/schedules.json`);

  // ---- 2. Cotes OPEN (summary ESPN → pickcenter, vue open uniquement) ----
  // Adapte les fixtures au type CollectedMatch attendu par le harnais
  // (logos null, scores -1 : JAMAIS lus par fetchHistoricalOddsV3).
  const asCollected: CollectedMatch[] = fixtures.map((f) => ({
    id: f.matchId,
    league: f.league,
    kickoff: f.kickoff,
    homeId: f.homeId,
    homeName: f.homeName,
    homeLogo: null,
    awayId: f.awayId,
    awayName: f.awayName,
    awayLogo: null,
    homeScore: -1,
    awayScore: -1,
  }));
  console.log(`[pré-match] cotes historiques (summary ESPN, vue OPEN uniquement)…`);
  const oddsV3 = await fetchHistoricalOddsV3(asCollected, stats, (m) => console.log(`  ${m}`));

  const oddsOut: Record<string, unknown> = {};
  let withOpen = 0;
  const capturedAt = new Date().toISOString();
  for (const f of fixtures) {
    const o = oddsV3.get(f.matchId);
    const open = o?.openOnly ?? null;
    if (open?.hasOdds) withOpen++;
    oddsOut[f.matchId] = {
      hasOpen: !!(open?.hasOdds),
      provider: open?.provider ?? null,
      // Vue OPEN STRICTE (champs close absents par construction du harnais)
      moneyline: open
        ? {
            home: open.moneyline.home.open,
            draw: open.moneyline.draw.open,
            away: open.moneyline.away.open,
          }
        : null,
      overUnderLine: open?.overUnderLine ?? null,
      total: open
        ? { overOpenOdds: open.total.over.openOdds, underOpenOdds: open.total.under.openOdds, line: open.total.over.line }
        : null,
    };
  }
  writeFileSync(
    join(DATA_DIR, 'odds-open.json'),
    JSON.stringify(
      {
        meta: {
          capturedAt,
          source: 'ESPN summary → pickcenter DraftKings (vue OPEN — disponible avant le coup d\'envoi)',
          limitation: 'ESPN ne publie aucun timestamp de cote : l\'OPEN est le proxy « disponible à T_pred » (documenté au rapport). Les CLOSE ne sont pas stockées en Phase 1.',
          withOpen,
          total: fixtures.length,
        },
        odds: oddsOut,
      },
      null,
      0
    )
  );
  console.log(`[pré-match] cotes OPEN : ${withOpen}/${fixtures.length} matchs · écrit data/odds-open.json`);
  console.log(`[pré-match] stats réseau : scoreboard=${stats.scoreboard} schedule=${stats.schedule} summary=${stats.summary}`);
}

main().catch((e) => {
  console.error('Phase 1b échouée:', e);
  process.exit(1);
});
