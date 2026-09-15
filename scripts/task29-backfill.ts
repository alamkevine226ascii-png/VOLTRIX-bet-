/**
 * Task 29 — BACKFILL one-shot de la centralisation des entrées moteur.
 *
 * Étape 1 : ingestion ESPN → Neon sur la fenêtre [-4 j ; +14 j] via la couche
 *           officielle (syncLeagueWindow) → matchs, résultats, série de cotes
 *           ET nouvel ancrage OddsOpenClose + venueCity/venueCountry.
 * Étape 2 : runContextSync → standings (priorité 1), blessures (2), météo (5)
 *           et sweep historiques équipes (3).
 * Étape 3 : comptages et périodes couvertes.
 *
 * Idempotent : peut être relancé sans dupliquer (clés uniques par jour/clé).
 * Exécution : env -u DATABASE_URL -u DIRECT_URL bun scripts/task29-backfill.ts
 */
import { PrismaClient } from '@prisma/client'

// Utilise les modules de l'app (tsx/bun résout l'alias @ via tsconfig paths ? non —
// on importe par chemin relatif depuis scripts/ : ../src/lib/...)
import { runSyncCycle } from '../src/lib/sync/espn-sync'
import { runContextSync } from '../src/lib/sync/context-sync'

const prisma = new PrismaClient()

async function main() {
  const t0 = Date.now()
  console.log('=== TASK 29 BACKFILL —', new Date().toISOString(), '===')

  console.log('\n[1/3] Ingestion fenêtre -4j..+14j (matchs + résultats + série cotes + ancrage open/close + venueCity)...')
  const cycle = await runSyncCycle({ daysBack: 4, daysAhead: 14, phase: 'backfill-task29' })
  console.log('   ligues=%d échecs=%d events=%d matchesCreated=%d matchesUpdated=%d results=%d oddsInserted=%d',
    cycle.leaguesTotal, cycle.leaguesFailed, cycle.eventsSeen, cycle.matchesCreated, cycle.matchesUpdated, cycle.resultsUpserted, cycle.oddsInserted)

  console.log('\n[2/3] Contexte : standings + blessures + météo + sweep historiques équipes...')
  const ctx = await runContextSync({ teamBudget: 60 })
  console.log('   ligues=%d échecs=%d standings=%d injuries=%d weather=%d teamSweep=%d teams/%d matchs importés (durée %s s)',
    ctx.leaguesTotal, ctx.leaguesFailed, ctx.standingsUpserted, ctx.injuriesUpserted, ctx.weatherCaptured, ctx.teamHistoryTeams, ctx.teamHistoryImported, Math.round(ctx.durationMs / 1000))

  console.log('\n[3/3] ÉTAT NEON APRÈS BACKFILL :')
  const counts: Array<[string, Promise<number>]> = [
    ['StandingsSnapshot', prisma.standingsSnapshot.count()],
    ['InjurySnapshot', prisma.injurySnapshot.count()],
    ['WeatherSnapshot', prisma.weatherSnapshot.count()],
    ['OddsOpenClose', prisma.oddsOpenClose.count()],
    ['TeamHistorySyncState', prisma.teamHistorySyncState.count()],
  ]
  for (const [n, p] of counts) {
    try { console.log('   ' + n.padEnd(24) + '= ' + (await p)) } catch (e: any) { console.log('   ' + n.padEnd(24) + '= ERR ' + e.message.split('\n')[0]) }
  }

  // Périodes couvertes
  const st = await prisma.standingsSnapshot.aggregate({ _min: { snapshotDate: true }, _max: { snapshotDate: true } })
  const od = await prisma.oddsOpenClose.aggregate({ _min: { openCapturedAt: true }, _max: { openCapturedAt: true } })
  const venueFilled = await prisma.match.count({ where: { venueCity: { not: null } } })
  const teamsCovered = await prisma.teamHistorySyncState.count({ where: { lastSyncedAt: { not: null } } })
  console.log('\n   standings période :', st._min.snapshotDate?.toISOString().slice(0, 10), '→', st._max.snapshotDate?.toISOString().slice(0, 10))
  console.log('   odds marks openCapturedAt :', od._min.openCapturedAt?.toISOString() ?? '-', '→', od._max.openCapturedAt?.toISOString() ?? '-')
  console.log('   Matchs avec venueCity :', venueFilled)
  console.log('   Équipes historiques tracées :', teamsCovered)

  // Échantillon open/close (preuve)
  const sample = await prisma.oddsOpenClose.findMany({
    where: { espnOpenOdds: { not: null }, espnCloseOdds: { not: null } },
    take: 5,
    orderBy: { updatedAt: 'desc' },
  })
  console.log('\n   Échantillon ancrages ESPN open→close :')
  for (const s of sample) {
    console.log(`   ${s.matchId} ${s.marketType}/${s.outcome}${s.line != null ? ' ' + s.line : ''} : open=${s.espnOpenOdds} close=${s.espnCloseOdds} (effectif ${s.openOdds}→${s.closeOdds}, captures=${s.captures})`)
  }

  console.log('\n=== BACKFILL TERMINÉ en ' + Math.round((Date.now() - t0) / 1000) + ' s ===')
}

main().catch((e) => { console.error('FATAL:', e); process.exitCode = 1 }).finally(() => prisma.$disconnect())
