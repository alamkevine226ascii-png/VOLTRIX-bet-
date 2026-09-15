/**
 * Task 29 — Audit READ-ONLY de l'état Neon au moment de l'audit ESPN→Neon.
 * Aucune écriture : uniquement des SELECT/counts.
 * Exécution : env -u DATABASE_URL -u DIRECT_URL bun scripts/audit-task29.ts
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('=== AUDIT TASK29 —', new Date().toISOString(), '===\n')

  // 1. Tables existantes (information_schema) — détection standings/injuries/weather
  const tables = await prisma.$queryRaw<{ table_name: string; table_type: string }[]>`
    SELECT table_name, table_type FROM information_schema.tables
    WHERE table_schema = 'public' ORDER BY table_name`
  const names = tables.map((t) => t.table_name)
  console.log('TABLES Neon (' + names.length + ') :', names.join(', '))
  const missing = ['standing', 'injur', 'weather', 'odds_open', 'team_history'].filter((pat) => !names.some((n) => n.includes(pat)))
  console.log('Patterns absents :', missing.join(', ') || '(aucun)')

  // 2. Comptages
  const counts: Array<[string, Promise<number>]> = [
    ['Match', prisma.match.count()],
    ['Team', prisma.team.count()],
    ['Competition', prisma.competition.count()],
    ['OddsSnapshot', prisma.oddsSnapshot.count()],
    ['MatchResult', prisma.matchResult.count()],
    ['Prediction (suivi)', prisma.prediction.count()],
    ['ForecastSnapshot (legacy)', prisma.forecastSnapshot.count()],
    ['PredictionSnapshot', prisma.predictionSnapshot.count()],
    ['PredictionMarket', prisma.predictionMarket.count()],
    ['PredictionOutcome', prisma.predictionOutcome.count()],
    ['PredictionComponent', prisma.predictionComponent.count()],
  ]
  console.log('\nCOMPTEAGES :')
  for (const [n, p] of counts) {
    try { console.log('  ' + n.padEnd(28) + '= ' + (await p)) } catch (e: any) { console.log('  ' + n.padEnd(28) + '= ERR ' + e.message.split('\n')[0]) }
  }

  // 3. Fenêtre couverte
  const agg = await prisma.match.aggregate({ _min: { kickoffAt: true }, _max: { kickoffAt: true } })
  console.log('\nFENETRE Match : min=' + agg._min.kickoffAt?.toISOString() + ' max=' + agg._max.kickoffAt?.toISOString())
  const finalCount = await prisma.match.count({ where: { status: 'FINAL' } })
  console.log('  Matchs FINAL = ' + finalCount)

  // 4. Couverture historique équipes (moteur : Poisson/Elo/Forme/H2H)
  const now = new Date()
  const finished = await prisma.match.findMany({
    where: { status: 'FINAL', homeScore: { not: null }, awayScore: { not: null } },
    select: { homeTeamId: true, awayTeamId: true, kickoffAt: true },
  })
  const perTeam = new Map<string, number>()
  for (const m of finished) {
    if (m.homeTeamId) perTeam.set(m.homeTeamId, (perTeam.get(m.homeTeamId) ?? 0) + 1)
    if (m.awayTeamId) perTeam.set(m.awayTeamId, (perTeam.get(m.awayTeamId) ?? 0) + 1)
  }
  const teams = await prisma.team.findMany({ select: { espnTeamId: true } })
  const withHistory = teams.filter((t) => (perTeam.get(t.espnTeamId) ?? 0) > 0).length
  const buckets = [0, 1, 5, 10, 20, 40]
  console.log('\nHISTORIQUE EQUIPES (matchs FINAL par équipe) :')
  for (let i = 0; i < buckets.length; i++) {
    const lo = buckets[i]
    const hi = buckets[i + 1]
    const n = [...perTeam.values()].filter((v) => v >= lo && (hi === undefined ? true : v < hi)).length
    console.log('  >=' + lo + (hi ? ' <' + hi : '+') + ' : ' + n + ' équipes')
  }
  console.log('  Equipes connues = ' + teams.length + ' | avec >=1 match FINAL = ' + withHistory)

  // Paires H2H
  const pairs = new Map<string, number>()
  for (const m of finished) {
    if (!m.homeTeamId || !m.awayTeamId) continue
    const k = [m.homeTeamId, m.awayTeamId].sort().join('|')
    pairs.set(k, (pairs.get(k) ?? 0) + 1)
  }
  console.log('  Paires avec >=1 confrontation : ' + pairs.size + ' | >=2 : ' + [...pairs.values()].filter((v) => v >= 2).length)

  // 5. Cotes : séries open/close
  const oddsTotal = await prisma.oddsSnapshot.count()
  const oddsMatches = await prisma.$queryRaw<{ n: bigint }[]>`SELECT COUNT(DISTINCT "matchId") AS n FROM "OddsSnapshot"`
  const multiSeries = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*) AS n FROM (
      SELECT "matchId", "marketType", "outcome", COALESCE(line::text,'') AS l, COUNT(*) AS c
      FROM "OddsSnapshot" GROUP BY 1,2,3,4 HAVING COUNT(*) > 1
    ) t`
  const oddsFuture = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(DISTINCT o."matchId") AS n FROM "OddsSnapshot" o
    JOIN "Match" m ON m."espnEventId" = o."matchId"
    WHERE m."kickoffAt" >= NOW() AND m."kickoffAt" <= NOW() + INTERVAL '14 days'`
  console.log('\nCOTES : captures=' + oddsTotal + ' | matchs avec cotes=' + oddsMatches[0]?.n +
    ' | séries multi-captures=' + multiSeries[0]?.n + ' | matchs futurs(14j) avec cotes=' + oddsFuture[0]?.n)

  // 6. Ligues actives (matchs dans -1j..+14j) — périmètre standings/injuries
  const upcoming = await prisma.match.findMany({
    where: { kickoffAt: { gte: new Date(now.getTime() - 24 * 3600e3), lte: new Date(now.getTime() + 14 * 24 * 3600e3) } },
    select: { competitionId: true, kickoffAt: true, homeTeamId: true, awayTeamId: true, venue: true },
  })
  const activeLeagues = new Set<string>()
  for (const m of upcoming) if (m.competitionId) activeLeagues.add(m.competitionId)
  console.log('\nLIGUES ACTIVES (-1j..+14j) : ' + activeLeagues.size + ' | matchs concernés : ' + upcoming.length)

  // 7. Matchs <=48h : avec stade (météo possible) / avec city ?
  const soon = await prisma.match.findMany({
    where: { kickoffAt: { gte: now, lte: new Date(now.getTime() + 48 * 3600e3) } },
    select: { venue: true, venueCity: true } as any,
  }).catch((e: any) => { console.log('  (venueCity colonne absente : ' + e.message.split('\n')[0] + ')'); return null })
  if (soon) {
    const withVenue = soon.filter((m: any) => !!m.venue).length
    console.log('  Matchs <=48h : ' + soon.length + ' | avec venue : ' + withVenue)
  } else {
    console.log('  Matchs <=48h : (voir erreur ci-dessus)')
  }

  // 8. Pronos en attente de résolution (Précision)
  const pending = await prisma.prediction.count({ where: { resolved: false } })
  console.log('\nPronos PENDING (résolution Précision) = ' + pending)

  // 9. Last sync runs
  const runs = await prisma.syncJobRun.findMany({ orderBy: { startedAt: 'desc' }, take: 5 })
  console.log('\nDERNIERS SyncJobRun :')
  for (const r of runs) console.log('  ' + r.startedAt.toISOString() + ' ' + r.phase + ' ' + (r.stats ?? '').slice(0, 110))

  console.log('\n=== FIN AUDIT READ-ONLY ===')
}

main().finally(() => prisma.$disconnect())
