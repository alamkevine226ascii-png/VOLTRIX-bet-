// Sweep des historiques — passes supplémentaires via la FONCTION OFFICIELLE
// de la couche sync (src/lib/sync/context-sync.ts — ingestion, jamais le moteur).
// Répète sweepTeamHistory(budget) jusqu'à épuisement de la file stale (teams:0)
// pour couvrir TOUTES les équipes des matchs à venir, pas seulement les 40 premières.
// Idempotent (upserts clés uniques ESPN) — ne touche AUCUNE prédiction de production.
import { sweepTeamHistory } from '../src/lib/sync/context-sync';

async function main() {
  const budget = Number(process.env.SWEEP_BUDGET ?? 40);
  const maxPasses = Number(process.env.SWEEP_MAX_PASSES ?? 8);
  const t0 = Date.now();
  let totalTeams = 0;
  let totalImported = 0;
  for (let p = 1; p <= maxPasses; p++) {
    const r = await sweepTeamHistory(budget);
    totalTeams += r.teams;
    totalImported += r.imported;
    console.log(`passe ${p}: équipes=${r.teams} matchs importés=${r.imported} (cumul équipes=${totalTeams}, importés=${totalImported}, ${Math.round((Date.now() - t0) / 1000)}s)`);
    if (r.teams === 0) { console.log('File stale épuisée.'); break; }
  }
  console.log(`TOTAL: ${totalTeams} équipes, ${totalImported} matchs importés en ${Math.round((Date.now() - t0) / 1000)}s`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
