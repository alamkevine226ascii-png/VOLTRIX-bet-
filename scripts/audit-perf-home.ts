// ============================================================
// VOLTRIX — Audit perf accueil (LECTURE SEULE, 0 DB, 0 écriture)
// Mesure : latence HTTP ESPN (scoreboard) + coût pur runEngine.
// Aucun accès Neon, aucune modification de fichier projet.
// ============================================================

import { runEngine } from '../src/lib/prediction';
import type { EspnScheduleGame, EspnStandingsTeam } from '../src/lib/espn';

const LEAGUE = 'eng.1';
const today = new Date().toISOString().slice(0, 10);

async function timed(label: string, fn: () => Promise<unknown>): Promise<number> {
  const t0 = Date.now();
  try {
    await fn();
  } catch (e) {
    console.log(`${label}: ERREUR ${(e as Error).message}`);
    return Date.now() - t0;
  }
  const ms = Date.now() - t0;
  console.log(`${label}: ${ms} ms`);
  return ms;
}

async function main() {
  console.log(`=== Audit perf — ${new Date().toISOString()} ===`);

  // 1. Latence réseau ESPN — 3 fetchs scoreboard séquentiels (cold + warm ×2)
  const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${LEAGUE}/scoreboard?dates=${today}`;
  await timed('ESPN scoreboard #1 (cold DNS/TLS)', () => fetch(url, { cache: 'no-store' }).then((r) => r.json()));
  await timed('ESPN scoreboard #2 (connexion chaude)', () => fetch(url, { cache: 'no-store' }).then((r) => r.json()));
  await timed('ESPN scoreboard #3 (connexion chaude)', () => fetch(url, { cache: 'no-store' }).then((r) => r.json()));

  // 2. Coût pur du moteur v2.1 (aucune IO) — entrée synthétique réaliste
  const sched: EspnScheduleGame[] = Array.from({ length: 50 }, (_, i) => ({
    id: `g${i}`,
    date: new Date(Date.now() - i * 86400000).toISOString(),
    homeTeam: { id: 'h1', name: 'H' },
    awayTeam: { id: 'a1', name: 'A' },
    homeScore: i % 4,
    awayScore: (i + 1) % 3,
    status: 'FINAL',
    leagueCode: LEAGUE,
  })) as unknown as EspnScheduleGame[];
  const standings: EspnStandingsTeam[] = Array.from({ length: 20 }, (_, i) => ({
    teamId: `t${i}`,
    rank: i + 1,
    points: 60 - i,
    gamesPlayed: 30,
    goalsFor: 50 - i,
    goalsAgainst: 40 - i,
  })) as unknown as EspnStandingsTeam[];

  const input = {
    homeTeam: { id: 'h1', name: 'Home FC', logo: null, schedule: sched, standings: standings[0] },
    awayTeam: { id: 'a1', name: 'Away FC', logo: null, schedule: sched, standings: standings[1] },
    injuries: [],
    odds: null,
    isDerby: false,
    weatherImpact: null,
    nowMs: Date.now(),
    leagueTeamsCount: 20,
  } as Parameters<typeof runEngine>[0];

  // Échauffement JIT puis 5 mesures
  try {
    runEngine(input);
    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      runEngine(input);
      times.push(performance.now() - t0);
    }
    const avg = (times.reduce((a, b) => a + b, 0) / times.length).toFixed(1);
    console.log(`runEngine v2.1 (pur calcul, 50 matchs d'historique) : avg ${avg} ms / appel [${times.map((t) => t.toFixed(1)).join(', ')}]`);
  } catch (e) {
    console.log(`runEngine: ERREUR ${(e as Error).message}`);
  }

  console.log('=== Fin audit (aucune écriture effectuée) ===');
}

void main();
