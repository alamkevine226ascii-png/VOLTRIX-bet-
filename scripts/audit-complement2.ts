import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  console.log('--- [16] Components par snapshot ---')
  const comps: any[] = await prisma.$queryRawUnsafe(`SELECT ps."modelVersion" mv, ps."matchId", pc."component", COUNT(*) c FROM "PredictionComponent" pc JOIN "PredictionMarket" pm ON pm.id = pc."marketId" JOIN "PredictionSnapshot" ps ON ps.id = pm."snapshotId" GROUP BY 1,2,3 ORDER BY 2,3`)
  for (const r of comps) console.log(`  ${r.mv} match=${r.matchId} ${r.component}×${Number(r.c)}`)
  console.log('--- [17] Marchés par model_version ---')
  const mk: any[] = await prisma.$queryRawUnsafe(`SELECT ps."modelVersion" mv, pm."marketKey", COUNT(*) c FROM "PredictionMarket" pm JOIN "PredictionSnapshot" ps ON ps.id = pm."snapshotId" GROUP BY 1,2 ORDER BY 1,2`)
  for (const r of mk) console.log(`  ${r.mv} : ${r.marketKey} = ${Number(r.c)}`)
  console.log('--- [18] Job 13:00 encore ouvert ? ---')
  const j: any[] = await prisma.$queryRawUnsafe(`SELECT id, phase, "startedAt", "finishedAt" FROM "ForecastJobRun" ORDER BY "startedAt" DESC LIMIT 3`)
  for (const r of j) console.log(`  ${r.id} ${r.phase} début=${new Date(r.startedAt).toISOString()} fin=${r.finishedAt ? new Date(r.finishedAt).toISOString() : 'NULL'}`)
  console.log('--- [19] OddsSnapshot: doublons même valeur même seconde (course seed+cycle) ---')
  const d2: any[] = await prisma.$queryRawUnsafe(`SELECT COUNT(*) c FROM (SELECT "matchId","marketType","outcome","odds",COUNT(*) k FROM "OddsSnapshot" GROUP BY 1,2,3,4 HAVING COUNT(*)>1) x`)
  console.log(`  Captures identiques (même valeur) = ${Number(d2[0].c)}`)
  await prisma.$disconnect()
}
main().catch(async e => { console.error('ERR:', e.message); await prisma.$disconnect(); process.exit(1) })
