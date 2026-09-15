/**
 * Task 29 — VÉRIFICATION : idempotence (2e passage = ~0 ajout), comptages,
 * périodes couvertes, échantillons de reconstruction « as-of ».
 * Exécution : env -u DATABASE_URL -u DIRECT_URL bun scripts/task29-verify.ts
 */
import { PrismaClient } from '@prisma/client'
import { runSyncCycle } from '../src/lib/sync/espn-sync'
import { runContextSync } from '../src/lib/sync/context-sync'

const prisma = new PrismaClient()

async function main() {
  console.log('=== TASK 29 VÉRIFICATION —', new Date().toISOString(), '===\n')

  console.log('[1] 2e ingestion fenêtre courte (-1j..+2j) — attendu : ~0 cote insérée, 0 erreur de schéma :')
  const cycle = await runSyncCycle({ daysBack: 1, daysAhead: 2, phase: 'verify-task29' })
  console.log(`    ligues=${cycle.leaguesTotal} échecs=${cycle.leaguesFailed} events=${cycle.eventsSeen} matchesUpdated=${cycle.matchesUpdated} results=${cycle.resultsUpserted} oddsInserted=${cycle.oddsInserted}`)

  console.log('\n[2] 2e passe contextuelle (budget sweep=0) — attendu : ~0 écriture (idempotence jour UTC) :')
  const ctx = await runContextSync({ teamBudget: 0 })
  console.log(`    ligues=${ctx.leaguesTotal} standings=${ctx.standingsUpserted} injuries=${ctx.injuriesUpserted} weather=${ctx.weatherCaptured}`)

  console.log('\n[3] COMPTAGES FINAUX :')
  const rows: Array<[string, number]> = []
  for (const [n, p] of [
    ['Match', prisma.match.count()],
    ['MatchResult', prisma.matchResult.count()],
    ['OddsSnapshot (série)', prisma.oddsSnapshot.count()],
    ['OddsOpenClose (ancrage)', prisma.oddsOpenClose.count()],
    ['StandingsSnapshot', prisma.standingsSnapshot.count()],
    ['InjurySnapshot', prisma.injurySnapshot.count()],
    ['WeatherSnapshot', prisma.weatherSnapshot.count()],
    ['TeamHistorySyncState', prisma.teamHistorySyncState.count()],
  ] as const) {
    const v = await p
    rows.push([n, v])
    console.log('    ' + n.padEnd(26) + '= ' + v)
  }

  const st = await prisma.standingsSnapshot.aggregate({ _count: true, _min: { snapshotDate: true }, _max: { snapshotDate: true } })
  const stLeagues = await prisma.standingsSnapshot.groupBy({ by: ['espnLeagueId'], _count: true })
  const wx = await prisma.weatherSnapshot.aggregate({ _min: { capturedAt: true }, _max: { capturedAt: true } })
  console.log(`\n    standings : ${st._count} lignes / ${stLeagues.length} ligues / période ${st._min.snapshotDate?.toISOString().slice(0, 10)} → ${st._max.snapshotDate?.toISOString().slice(0, 10)}`)
  console.log(`    météo     : période ${wx._min.capturedAt?.toISOString() ?? '-'} → ${wx._max.capturedAt?.toISOString() ?? '-'}`)

  console.log('\n[4] ÉCHANTILLONS — reconstruction « as-of » :')
  const asOf = await prisma.standingsSnapshot.findMany({
    where: { espnLeagueId: 'eng.1' },
    orderBy: { rank: 'asc' },
    take: 5,
    select: { teamName: true, rank: true, gamesPlayed: true, points: true, pointsFor: true, pointsAgainst: true, snapshotDate: true },
  })
  console.log('    eng.1 top5 @', asOf[0]?.snapshotDate?.toISOString().slice(0, 10) ?? '-')
  for (const r of asOf) console.log(`      ${String(r.rank).padStart(2)}. ${r.teamName} — ${r.points} pts (${r.gamesPlayed} J, ${r.pointsFor}:${r.pointsAgainst})`)

  const oc = await prisma.oddsOpenClose.findMany({
    where: { espnOpenOdds: { not: null }, espnCloseOdds: { not: null }, matchId: { in: await prisma.match.findMany({ where: { status: 'SCHEDULED', kickoffAt: { gte: new Date() } }, take: 400, select: { espnEventId: true } }).then((ms) => ms.map((m) => m.espnEventId)) } },
    orderBy: { updatedAt: 'desc' },
    take: 5,
  })
  console.log('\n    Ancrages open→close (matchs à venir) :')
  for (const s of oc) console.log(`      ${s.matchId} ${s.marketType}/${s.outcome}${s.line != null ? ' ' + s.line : ''} : ESPN open=${s.espnOpenOdds} → close=${s.espnCloseOdds}`)

  const w = await prisma.weatherSnapshot.findMany({ orderBy: { capturedAt: 'desc' }, take: 3 })
  console.log('\n    Dernières captures météo (facteur buts) :')
  for (const s of w) console.log(`      ${s.espnEventId} ${s.city ?? '?'} : ${s.tempC}°C, vent ${s.windKmh} km/h, pluie ${s.precipitationMm} mm → goalsFactor=${s.goalsFactor}`)

  const th = await prisma.teamHistorySyncState.findMany({ where: { lastResult: 'ok' }, orderBy: { lastSyncedAt: 'desc' }, take: 5 })
  console.log('\n    Sweep historiques équipes (5 dernières ok) :')
  for (const s of th) console.log(`      ${s.espnTeamId} ${s.teamName ?? ''} (${s.leagueCode}) : ${s.matchesImported} matchs importés @ ${s.lastSyncedAt?.toISOString().slice(11, 19)}`)

  console.log('\n=== VÉRIFICATION TERMINÉE ===')
}

main().catch((e) => { console.error('FATAL:', e); process.exitCode = 1 }).finally(() => prisma.$disconnect())
