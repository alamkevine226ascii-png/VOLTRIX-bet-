/**
 * Preuve SQL (§9 de l'audit utilisateur) — exécutée DIRECTEMENT sur Neon.
 * Équivalent psql de la requête demandée + comptages exacts.
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('=== PREUVE SQL —', new Date().toISOString(), '===\n')

  // Requête EXACTE demandée par l'utilisateur
  const rows: Array<{ jour: Date; matchs: bigint }> =
    await prisma.$queryRawUnsafe(`
      SELECT
        DATE(kickoff_at) AS jour,
        COUNT(*) AS matchs
      FROM matches
      WHERE kickoff_at >= NOW()
        AND kickoff_at < NOW() + INTERVAL '8 days'
      GROUP BY DATE(kickoff_at)
      ORDER BY jour;
    `)

  console.log('Requête utilisateur (matches par jour, 8 prochains jours) :')
  let total = 0n
  for (const r of rows) {
    console.log(`  ${r.jour.toISOString().slice(0, 10)}  ${r.matchs}`)
    total += r.matchs
  }
  console.log(`  TOTAL J+0→J+7 = ${total}`)

  const [{ total_futur }] = await prisma.$queryRawUnsafe<Array<{ total_futur: bigint }>>(
    `SELECT COUNT(*) AS total_futur FROM matches WHERE kickoff_at >= NOW();`
  )
  console.log(`\nMatchs futurs dans Neon (toutes dates confondues) = ${total_futur}`)

  const [{ total_matches }] = await prisma.$queryRawUnsafe<Array<{ total_matches: bigint }>>(
    `SELECT COUNT(*) AS total_matches FROM matches;`
  )
  console.log(`Total lignes matches = ${total_matches}`)

  // Colonnes exigées §7 : espn_event_id, home_team_id, away_team_id, kickoff_at, competition_id, status
  console.log('\n=== Complétude des colonnes exigées (§7) sur les matchs futurs ===')
  const [completeness] = await prisma.$queryRawUnsafe<Array<{
    avec_espn_event_id: bigint; avec_home: bigint; avec_away: bigint; avec_competition: bigint; avec_status: bigint; futurs: bigint
  }>>(
    `SELECT
       COUNT(espn_event_id) AS avec_espn_event_id,
       COUNT(home_team_id)  AS avec_home,
       COUNT(away_team_id)  AS avec_away,
       COUNT(competition_id) AS avec_competition,
       COUNT(status)         AS avec_status,
       COUNT(*)              AS futurs
     FROM matches
     WHERE kickoff_at >= NOW();`
  )
  console.log(JSON.stringify(completeness, (k, v) => (typeof v === 'bigint' ? Number(v) : v)))

  // Doublons espn_event_id (idempotence §5)
  const [dup] = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
    `SELECT COUNT(*) AS n FROM (SELECT espn_event_id FROM matches GROUP BY espn_event_id HAVING COUNT(*) > 1) x;`
  )
  console.log(`\nDoublons espn_event_id = ${dup.n} (doit être 0)`)

  // Un match précis : chaîne ESPN → Neon → API (§10)
  console.log('\n=== Match témoin (le plus proche coup d\u2019envoi futur) ===')
  const [sample] = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT m.espn_event_id, m.home_team_name, m.away_team_name, m.kickoff_at, m.status,
            c.espn_league_id, c.name AS competition_name
     FROM matches m LEFT JOIN competitions c ON c.id = m.competition_id
     WHERE m.kickoff_at >= NOW() AND m.status = 'SCHEDULED'
     ORDER BY m.kickoff_at ASC LIMIT 1;`
  )
  console.log(JSON.stringify(sample, (k, v) => (typeof v === 'bigint' ? Number(v) : typeof v === 'Date' ? v.toISOString() : v), 2))

  await prisma.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
