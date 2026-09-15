#!/usr/bin/env bun
// ============================================================
// VOLTRIX bet — Blind test JJA 2026 : SONDE DE DISPONIBILITÉ
// Mesure l'activité ESPN par ligue sur juin/juillet/août 2026
// (dates échantillonnées) pour dimensionner la collecte complète.
// Aucune écriture de livrable — diagnostic uniquement.
// ============================================================

import { fetchScoreboard, fetchTeamSchedule } from '../../src/lib/espn';
import { mapWithConcurrency } from '../../src/lib/cache';

const CANDIDATES = [
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

const SAMPLE_DATES = [
  '2026-06-03', '2026-06-08', '2026-06-13', '2026-06-18', '2026-06-23', '2026-06-28',
  '2026-07-03', '2026-07-08', '2026-07-13', '2026-07-18', '2026-07-23', '2026-07-28',
  '2026-08-02', '2026-08-07', '2026-08-12', '2026-08-17', '2026-08-22', '2026-08-27', '2026-08-31',
];

interface LeagueStat {
  league: string;
  byMonth: Record<string, number>;
  completed: number;
  withTeams: number;
  sampleTeams: string[];
  total: number;
}

async function main(): Promise<void> {
  console.log(`Sonde : ${CANDIDATES.length} ligues × ${SAMPLE_DATES.length} dates…`);
  const tasks = CANDIDATES.flatMap((league) => SAMPLE_DATES.map((date) => ({ league, date })));
  const results = new Map<string, LeagueStat>();
  for (const l of CANDIDATES) {
    results.set(l, { league: l, byMonth: { '2026-06': 0, '2026-07': 0, '2026-08': 0 }, completed: 0, withTeams: 0, sampleTeams: [], total: 0 });
  }
  let done = 0;
  await mapWithConcurrency(tasks, 6, async ({ league, date }) => {
    try {
      const board = await fetchScoreboard(league, date);
      const st = results.get(league)!;
      if (board && board.events.length) {
        const month = date.slice(0, 7);
        for (const e of board.events) {
          st.total++;
          st.byMonth[month]++;
          if (e.completed) st.completed++;
          if (e.home?.team && e.away?.team) {
            st.withTeams++;
            if (st.sampleTeams.length < 2 && e.home.team.id) st.sampleTeams.push(e.home.team.id);
          }
        }
      }
    } catch {
      /* ligue/date indisponible → compté comme 0 */
    }
    done++;
    if (done % 60 === 0) console.log(`  … ${done}/${tasks.length}`);
  });

  console.log('\n════════ ACTIVITÉ PAR LIGUE (échantillon 19 dates / 3 mois) ════════');
  const rows = [...results.values()].sort((a, b) => b.total - a.total);
  for (const r of rows) {
    const m = (k: string) => String(r.byMonth[k]).padStart(4);
    console.log(`${r.league.padEnd(24)} total=${String(r.total).padStart(4)}  juin=${m('2026-06')} juil=${m('2026-07')} août=${m('2026-08')}  complétées=${String(r.completed).padStart(4)}  équipesOK=${r.withTeams}`);
  }

  // Vérification calendriers : 1 équipe Coupe du Monde + 1 équipe eng.1 + 1 bra.1 (saison 2026)
  console.log('\n════════ VÉRIFICATION CALENDRIERS (saison 2026) ════════');
  for (const [lg, res] of [['fifa.world', wcStat(results)], ['eng.1', results.get('eng.1')], ['bra.1', results.get('bra.1')]] as Array<[string, LeagueStat | undefined]>) {
    if (res && res.sampleTeams[0]) {
      try {
        const games = await fetchTeamSchedule(lg, res.sampleTeams[0], [2026]);
        console.log(`${lg} équipe ${res.sampleTeams[0]} : ${games.length} matchs saison 2026 (complétés ${games.filter((g) => g.completed).length})`);
      } catch (e) {
        console.log(`${lg} équipe ${res.sampleTeams[0]} : ERREUR ${(e as Error).message}`);
      }
    }
  }
}

function wcStat(results: Map<string, LeagueStat>): LeagueStat | undefined {
  return results.get('fifa.world');
}

main().catch((e) => {
  console.error('Probe failed:', e);
  process.exit(1);
});
