// ============================================================
// VOLTRIX bet — Task 28 : SEED initial Neon (one-shot)
// Synchronise 21 jours d'historique + 8 jours à venir depuis ESPN
// vers Neon (matchs, équipes, compétitions, résultats, cotes).
// Idempotent — ré-exécutable sans créer de doublons.
// Usage : set -a && source .env && set +a && bun scripts/seed-neon.ts
// ============================================================

import { runSyncCycle } from '../src/lib/sync/espn-sync';
import { db } from '../src/lib/db';

async function main() {
  const daysBack = parseInt(process.argv[2] ?? '21', 10);
  const daysAhead = parseInt(process.argv[3] ?? '8', 10);
  console.log(`════════ SEED NEON — ESPN → DB (${daysBack} j arrière, ${daysAhead} j à venir) ════════`);
  const t0 = Date.now();
  const stats = await runSyncCycle({ daysBack, daysAhead, phase: 'seed' });
  const secs = Math.round((Date.now() - t0) / 1000);
  console.log(`⏱ ${secs}s`);
  console.table(stats);

  // Vérification post-seed
  const [matches, odds, finalWithScores] = await Promise.all([
    db.match.count(),
    db.oddsSnapshot.count(),
    db.match.count({ where: { status: 'FINAL', homeScore: { not: null } } }),
  ]);
  console.log(`✓ Match: ${matches} | FINAL avec score: ${finalWithScores} | Cotes historisées: ${odds}`);
}

main()
  .then(() => {
    console.log('✓ Seed terminé');
    process.exit(0);
  })
  .catch((e) => {
    console.error('✗ Erreur seed:', e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
