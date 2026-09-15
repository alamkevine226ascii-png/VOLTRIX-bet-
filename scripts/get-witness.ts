import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  const r: any[] = await prisma.$queryRawUnsafe(`SELECT m.espn_event_id, c.espn_league_id, m.home_team_name, m.away_team_name, m.kickoff_at, m.status FROM matches m JOIN competitions c ON c.id = m.competition_id WHERE DATE(m.kickoff_at) = DATE(NOW()) AND m.kickoff_at > NOW() ORDER BY m.kickoff_at LIMIT 2`)
  for (const x of r) console.log(JSON.stringify({ id: x.espn_event_id, league: x.espn_league_id, home: x.home_team_name, away: x.away_team_name, kickoff: new Date(x.kickoff_at).toISOString(), status: x.status }))
  const c: any = await prisma.$queryRawUnsafe(`SELECT COUNT(*) c FROM matches WHERE DATE(kickoff_at) = DATE(NOW())`)
  console.log('TOTAL AUJOURDHUI EN NEON:', Number(c[0].c))
  await prisma.$disconnect()
}
main().catch(async e => { console.error(e.message); process.exit(1) })
