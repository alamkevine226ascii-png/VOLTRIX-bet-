import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  console.log('=== SYNC JOB RUNS post-restart (13:49) ===')
  const runs: any[] = await prisma.$queryRawUnsafe(`SELECT phase, "startedAt", "finishedAt", stats FROM "SyncJobRun" WHERE "startedAt" > '2026-09-15T13:49:00Z' ORDER BY "startedAt" DESC LIMIT 8`)
  for (const r of runs) {
    const s = r.stats ? JSON.parse(r.stats) : {}
    console.log(`  ${new Date(r.startedAt).toISOString()} ${String(r.phase).padEnd(8)} ligues=${s.leaguesTotal ?? '-'} events=${s.eventsSeen ?? '-'} màj=${s.matchesUpdated ?? '-'} cotes=${s.oddsInserted ?? '-'} échecs=${s.leaguesFailed ?? '-'}`)
  }
  console.log(`  Total post-restart: ${runs.length}`)
  console.log('=== Match en base aujourd\'hui (témoin) ===')
  const t: any[] = await prisma.$queryRawUnsafe(`SELECT espn_event_id, home_team_name, away_team_name, status, kickoff_at FROM matches WHERE DATE(kickoff_at) = DATE(NOW()) ORDER BY kickoff_at LIMIT 3`)
  for (const r of t) console.log(`  ${r.espn_event_id} ${r.home_team_name} vs ${r.away_team_name} [${r.status}] ${new Date(r.kickoff_at).toISOString()}`)
  await prisma.$disconnect()
}
main().catch(async e => { console.error('ERR:', e.message); await prisma.$disconnect(); process.exit(1) })
