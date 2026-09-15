import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  console.log('--- [13] Legacy Précision ---')
  const leg: any = await prisma.$queryRawUnsafe(`SELECT COUNT(*) total, SUM(CASE WHEN resolved THEN 1 ELSE 0 END) resolus, COUNT(DISTINCT "matchId") matchs FROM "Prediction"`)
  console.log(`  lignes=${Number(leg[0].total)} résolues=${Number(leg[0].resolus)} matchs distincts=${Number(leg[0].matchs)}`)
  console.log('--- [14] Tous les triggers ---')
  const trg: any[] = await prisma.$queryRawUnsafe(`SELECT DISTINCT event_object_table t, action_timing a, event_manipulation m FROM information_schema.triggers WHERE trigger_schema='public' ORDER BY 1,2,3`)
  for (const r of trg) console.log(`  ${r.t} : ${r.a} ${r.m}`)
  console.log('--- [15] ForecastJobRun 10 derniers ---')
  const runs: any[] = await prisma.$queryRawUnsafe(`SELECT phase, "startedAt", "finishedAt", stats FROM "ForecastJobRun" ORDER BY "startedAt" DESC LIMIT 10`)
  for (const r of runs) { const s = r.stats ? JSON.parse(r.stats) : {}; console.log(`  ${new Date(r.startedAt).toISOString()} ${String(r.phase).padEnd(9)} fin=${r.finishedAt ? new Date(r.finishedAt).toISOString() : 'NULL'} scan=${s.scanned ?? '-'} pred=${s.predicted ?? '-'} rés=${s.resultsUpdated ?? '-'} éval=${s.evaluated ?? '-'} err=${s.errors ?? 0}`) }
  console.log('--- [16] Components détail (quels snapshots ont des composants) ---')
  const comps: any[] = await prisma.$queryRawUnsafe(`SELECT ps."modelVersion" mv, ps."matchId", pc.component, COUNT(*) c FROM prediction_components pc JOIN prediction_snapshots ps ON ps.id = pc."snapshotId" GROUP BY 1,2,3 ORDER BY 2`)
  for (const r of comps) console.log(`  ${r.mv} match=${r.matchId} ${r.component}×${Number(r.c)}`)
  console.log('--- [17] Marchés par model_version (complets vs migrés) ---')
  const mk: any[] = await prisma.$queryRawUnsafe(`SELECT ps."modelVersion" mv, pm."marketKey", COUNT(*) c FROM prediction_markets pm JOIN prediction_snapshots ps ON ps.id = pm."snapshotId" GROUP BY 1,2 ORDER BY 1,2`)
  for (const r of mk) console.log(`  ${r.mv} : ${r.marketKey} = ${Number(r.c)}`)
  await prisma.$disconnect()
}
main().catch(async e => { console.error('ERR:', e.message); await prisma.$disconnect(); process.exit(1) })
