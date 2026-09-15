// ============================================================
// VOLTRIX bet — Task 28 : API /api/sync/status
// Diagnostic de la base Neon + de la synchronisation (§31) :
// connectivité, volumes par table, dernier cycle, index présents.
// Aucune donnée sensible n'est exposée (aucune chaîne de connexion).
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ensureSyncLoop } from '@/lib/sync/sync-job';
import { espnStats, resetEspnStats } from '@/lib/espn';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  ensureSyncLoop();
  // Task 28-b : diagnostic de centralisation — ?resetEspn=1 remet le compteur
  // d'appels ESPN à zéro (mesure « appels ESPN pendant une consultation »).
  if (req.nextUrl.searchParams.get('resetEspn') === '1') {
    resetEspnStats();
  }
  try {
    // Connectivité + latence Neon (§30 : test de connexion)
    const t0 = Date.now();
    await db.$queryRaw`SELECT 1`;
    const latencyMs = Date.now() - t0;

    const [matches, teams, competitions, odds, snapshots, markets, outcomes, forecastSnapshots, predictions, lastSync, lastForecast] =
      await Promise.all([
        db.match.count(),
        db.team.count(),
        db.competition.count(),
        db.oddsSnapshot.count(),
        db.predictionSnapshot.count(),
        db.predictionMarket.count(),
        db.predictionOutcome.count(),
        db.forecastSnapshot.count(),
        db.prediction.count(),
        db.syncJobRun.findFirst({ orderBy: { startedAt: 'desc' } }),
        db.forecastJobRun.findFirst({ orderBy: { startedAt: 'desc' } }),
      ]);

    const byStatus = await db.match.groupBy({ by: ['status'], _count: { _all: true } });

    return NextResponse.json({
      ok: true,
      db: { connected: true, latencyMs },
      counts: { matches, teams, competitions, oddsSnapshots: odds, predictionSnapshots: snapshots, predictionMarkets: markets, predictionOutcomes: outcomes, forecastSnapshots, predictions },
      matchStatuses: byStatus.map((s) => ({ status: s.status, count: s._count._all })),
      espnCalls: {
        // Task 28-b : preuve de centralisation. source='client' = consultation
        // (analyse moteur, cashout…), source='sync' = ingestion ESPN → Neon.
        total: espnStats.total,
        client: espnStats.bySource.client,
        sync: espnStats.bySource.sync,
        recent: espnStats.recent.slice(-15).map((e) => ({ t: new Date(e.t).toISOString(), source: e.source, ok: e.ok, url: e.url })),
      },
      lastSync: lastSync ? { phase: lastSync.phase, startedAt: lastSync.startedAt, finishedAt: lastSync.finishedAt, stats: lastSync.stats ? JSON.parse(lastSync.stats) : null } : null,
      lastForecastJob: lastForecast ? { phase: lastForecast.phase, startedAt: lastForecast.startedAt, finishedAt: lastForecast.finishedAt } : null,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'Erreur base de données' }, { status: 500 });
  }
}
