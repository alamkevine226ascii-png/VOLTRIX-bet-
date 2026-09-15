// Monitoring du sweep des historiques (Task 30bis — lecture seule)
// Vérifie : TeamHistorySyncState, couverture équipes des matchs à venir,
// ancres OddsOpenClose (marques Task 29), derniers SyncJobRun.
import { db } from '../src/lib/db';

async function main() {
  const now = new Date();
  const to = new Date(now.getTime() + 7 * 24 * 3_600_000);

  // 1. Équipes tracées par le sweep
  const states = await db.teamHistorySyncState.findMany();
  const ok = states.filter((s) => s.lastResult === 'ok').length;
  const failed = states.filter((s) => s.lastResult === 'échec').length;
  const vide = states.filter((s) => s.lastResult === 'vide').length;
  const pending = states.length - ok - failed - vide;
  console.log(`TeamHistorySyncState: ${states.length} équipes tracées | ok=${ok} vide=${vide} échec=${failed} jamais=${pending}`);
  const recentDone = states
    .filter((s) => s.lastSyncedAt && now.getTime() - s.lastSyncedAt.getTime() < 45 * 60_000)
    .sort((a, b) => (b.lastSyncedAt?.getTime() ?? 0) - (a.lastSyncedAt?.getTime() ?? 0));
  console.log(`  synchronisées depuis le redémarrage (45 min): ${recentDone.length}`);
  for (const s of recentDone.slice(0, 10)) console.log(`    - ${s.teamName ?? s.espnTeamId} (${s.leagueCode}) : ${s.matchesImported} matchs, ${s.lastResult}, ${s.lastSyncedAt?.toISOString()}`);

  // 2. Couverture des équipes des matchs à venir 7 j
  const upcoming = await db.match.findMany({
    where: { kickoffAt: { gte: now, lte: to }, status: 'SCHEDULED', homeTeamId: { not: null }, awayTeamId: { not: null } },
    select: { homeTeamId: true, awayTeamId: true },
  });
  const teamIds = new Set<string>();
  for (const m of upcoming) { if (m.homeTeamId) teamIds.add(m.homeTeamId); if (m.awayTeamId) teamIds.add(m.awayTeamId); }
  const withFinal = await db.match.groupBy({
    by: ['homeTeamId'],
    where: { status: 'FINAL', homeTeamId: { in: [...teamIds] } },
  });
  const withFinalAway = await db.match.groupBy({
    by: ['awayTeamId'],
    where: { status: 'FINAL', awayTeamId: { in: [...teamIds] } },
  });
  const covered = new Set<string>([...withFinal.map((r) => r.homeTeamId), ...withFinalAway.map((r) => r.awayTeamId)].filter(Boolean) as string[]);
  const missing = [...teamIds].filter((t) => !covered.has(t));
  console.log(`Couverture historiques matchs à venir: ${covered.size}/${teamIds.size} équipes avec ≥1 FINAL (manquantes: ${missing.length})`);
  if (missing.length && missing.length <= 40) {
    const names = await db.team.findMany({ where: { id: { in: missing } }, select: { id: true, name: true } });
    console.log('  équipes sans FINAL:', names.map((n) => n.name).join(', '));
  }

  // 3. Ancres OddsOpenClose créées depuis le redémarrage (marques Task 29 actives ?)
  const since = new Date(now.getTime() - 30 * 60_000);
  const freshAnchors = await db.oddsOpenClose.count({ where: { updatedAt: { gte: since } } });
  const totalAnchors = await db.oddsOpenClose.count();
  console.log(`OddsOpenClose: total=${totalAnchors} | créées 30 dernières min=${freshAnchors}`);

  // 4. Derniers jobs de sync
  const runs = await db.syncJobRun.findMany({ orderBy: { startedAt: 'desc' }, take: 8, select: { phase: true, startedAt: true, finishedAt: true, stats: true, error: true } });
  for (const r of runs) console.log(`SyncJobRun ${r.phase} ${r.startedAt.toISOString()} ${r.finishedAt ? 'fini ' + r.finishedAt.toISOString() : 'en cours'} stats=${r.stats?.slice(0, 180) ?? ''} ${r.error?.slice(0, 80) ?? ''}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
