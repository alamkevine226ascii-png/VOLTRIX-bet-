// ============================================================
// VOLTRIX — Task 31 : VÉRIFICATION SERVEUR → NEON EN DIRECT
// Lecture seule. Prouve : (1) boucles sync vivantes (SyncJobRun
// post-boot), (2) marques Task 29 actives (OddsOpenClose.updatedAt
// récents = ingestBatch met à jour les ancres), (3) intégrité des
// données. AUCUNE écriture, AUCUN appel moteur.
// ============================================================
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();
const BOOT = new Date(Date.now() - 30 * 60_000); // fenêtre post-reboot large

try {
  // 1) Boucles sync vivantes — SyncJobRun créés APRÈS le reboot
  const runs = await db.syncJobRun.findMany({
    where: { startedAt: { gte: BOOT } },
    orderBy: { startedAt: 'desc' },
    take: 8,
    select: { phase: true, startedAt: true, finishedAt: true, stats: true, error: true },
  });
  console.log('=== SyncJobRun post-reboot (30 dernières min) ===');
  for (const r of runs) {
    const dur = r.finishedAt ? Math.round((r.finishedAt.getTime() - r.startedAt.getTime()) / 1000) + 's' : 'en cours';
    let brief = '';
    try { const s = JSON.parse(r.stats || '{}'); brief = Object.entries(s).filter(([, v]) => typeof v === 'number' && v > 0).slice(0, 5).map(([k, v]) => `${k}=${v}`).join(' '); } catch {}
    console.log(`${r.phase.padEnd(9)} ${r.startedAt.toISOString().slice(11, 19)}Z dur=${dur.padEnd(8)} ${brief.slice(0, 100)}${r.error ? ' ERR=' + r.error.slice(0, 60) : ''}`);
  }
  if (runs.length === 0) console.log('AUCUN run — boucles pas encore déclenchées');

  // 2) Marques Task 29 — ancres OddsOpenClose mises à jour récemment
  const since = new Date(Date.now() - 15 * 60_000);
  const freshAnchors = await db.oddsOpenClose.count({ where: { updatedAt: { gte: since } } });
  const totalAnchors = await db.oddsOpenClose.count();
  const lastAnchor = await db.oddsOpenClose.findFirst({ orderBy: { updatedAt: 'desc' }, select: { updatedAt: true, marketType: true, line: true } });
  console.log(`\n=== Ancres OddsOpenClose (marques Task 29) ===`);
  console.log(`maj dernières 15 min : ${freshAnchors} / total ${totalAnchors}`);
  if (lastAnchor) console.log(`dernière maj : ${lastAnchor.updatedAt.toISOString()} (${lastAnchor.marketType} line=${lastAnchor.line})`);

  // 3) Cotes fraîches (OddsSnapshot dernières 15 min)
  const freshSnaps = await db.oddsSnapshot.count({ where: { capturedAt: { gte: since } } });
  console.log(`OddsSnapshot capturées dernières 15 min : ${freshSnaps}`);

  // 4) Intégrité
  const [mFinal, preds] = await Promise.all([
    db.match.count({ where: { status: 'FINAL' } }),
    db.predictionSnapshot.count(),
  ]);
  console.log(`\n=== Intégrité ===\nMatch FINAL : ${mFinal} | PredictionSnapshot : ${preds}`);
} finally {
  await db.$disconnect();
}
