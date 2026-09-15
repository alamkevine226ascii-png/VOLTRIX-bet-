/**
 * Audit direct de Neon — Task 28 vérification utilisateur
 * Aucune supposition : requêtes SQL brutes sur PostgreSQL.
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('=== AUDIT NEON —', new Date().toISOString(), '===\n')

  // 1. Comptages exacts par table
  const tables = [
    ['matches (Match)', prisma.match.count()],
    ['teams (Team)', prisma.team.count()],
    ['competitions (Competition)', prisma.competition.count()],
    ['odds (OddsSnapshot)', prisma.oddsSnapshot.count()],
    ['prediction_snapshots (PredictionSnapshot)', prisma.predictionSnapshot.count()],
    ['prediction_markets (PredictionMarket)', prisma.predictionMarket.count()],
    ['prediction_outcomes (PredictionOutcome)', prisma.predictionOutcome.count()],
    ['prediction_components', prisma.predictionComponent.count()],
    ['forecast_snapshots (legacy)', prisma.forecastSnapshot.count()],
    ['match_results (legacy)', prisma.matchResult.count()],
    ['forecast_matches (legacy registre)', prisma.forecastMatch.count()],
    ['sync_job_runs', prisma.syncJobRun.count()],
  ] as const

  for (const [name, p] of tables) {
    try {
      const n = await p
      console.log(`${name.padEnd(45)} = ${n}`)
    } catch (e: any) {
      console.log(`${name.padEnd(45)} = ERREUR: ${e.message.split('\n')[0]}`)
    }
  }

  // 2. Répartition par jour sur 8 prochains jours (requête demandée par l'utilisateur)
  console.log('\n=== MATCHS FUTURS PAR JOUR (kickoff_at >= NOW(), 8 jours) ===')
  const now = new Date()
  const d8 = new Date(now.getTime() + 8 * 24 * 3600 * 1000)
  const future = await prisma.match.findMany({
    where: { kickoffAt: { gte: now, lt: d8 } },
    select: { kickoffAt: true, status: true },
  })
  const byDay = new Map<string, number>()
  for (const m of future) {
    const day = m.kickoffAt.toISOString().slice(0, 10)
    byDay.set(day, (byDay.get(day) ?? 0) + 1)
  }
  const days = [...byDay.entries()].sort()
  for (const [day, n] of days) console.log(`  ${day} = ${n}`)
  console.log(`  TOTAL futur 8j = ${future.length}`)

  // 3. Répartition complète : min/max kickoff, passé/futur
  console.log('\n=== PLAGE GLOBALE kickoff_at ===')
  const agg = await prisma.match.aggregate({ _min: { kickoffAt: true }, _max: { kickoffAt: true } })
  console.log(`  min = ${agg._min.kickoffAt?.toISOString()}`)
  console.log(`  max = ${agg._max.kickoffAt?.toISOString()}`)
  const past = await prisma.match.count({ where: { kickoffAt: { lt: now } } })
  const futureAll = await prisma.match.count({ where: { kickoffAt: { gte: now } } })
  console.log(`  passés = ${past} | futurs = ${futureAll}`)

  // 4. Répartition par jour sur TOUTE la plage (passé 21j + futur 8j)
  console.log('\n=== RÉPARTITION PAR JOUR (30 derniers jours + 10 suivants) ===')
  const d30p = new Date(now.getTime() - 30 * 24 * 3600 * 1000)
  const d10f = new Date(now.getTime() + 10 * 24 * 3600 * 1000)
  const window = await prisma.match.findMany({
    where: { kickoffAt: { gte: d30p, lt: d10f } },
    select: { kickoffAt: true },
  })
  const byDay2 = new Map<string, number>()
  for (const m of window) {
    const day = m.kickoffAt.toISOString().slice(0, 10)
    byDay2.set(day, (byDay2.get(day) ?? 0) + 1)
  }
  const days2 = [...byDay2.entries()].sort()
  for (const [day, n] of days2) console.log(`  ${day} = ${n}`)

  // 5. Derniers sync job runs
  console.log('\n=== DERNIERS SYNC_JOB_RUNS ===')
  const jobs = await prisma.syncJobRun.findMany({ orderBy: { startedAt: 'desc' }, take: 5 })
  for (const j of jobs) {
    console.log(`  ${j.startedAt.toISOString()} kind=${(j as any).kind} status=${(j as any).status} ${JSON.stringify((j as any).details ?? {}).slice(0, 300)}`)
  }

  // 6. updatedAt récents sur matches (qui écrit ?)
  const recent = await prisma.match.count({ where: { updatedAt: { gte: new Date(now.getTime() - 3600 * 1000) } } })
  console.log(`\nmatchs updatedAt < 1h = ${recent}`)

  await prisma.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
