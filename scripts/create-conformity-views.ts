/**
 * Vues de conformité au cahier des charges — version GÉNÉRIQUE.
 * Chaque vue expose les colonnes converties camelCase → snake_case,
 * construites dynamiquement depuis information_schema.columns.
 * Additif + idempotent : aucune table réelle n'est modifiée.
 */
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

const VIEWS: Array<[string, string]> = [
  ['matches', 'Match'],
  ['teams', 'Team'],
  ['competitions', 'Competition'],
  ['odds', 'OddsSnapshot'],
  ['prediction_snapshots', 'PredictionSnapshot'],
  ['prediction_markets', 'PredictionMarket'],
  ['prediction_outcomes', 'PredictionOutcome'],
  ['prediction_components', 'PredictionComponent'],
  ['results', 'MatchResult'],
  ['sync_job_runs', 'SyncJobRun'],
]

const camelToSnake = (s: string): string => s.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase())

async function main() {
  for (const [view, table] of VIEWS) {
    const cols: Array<{ column_name: string }> = await prisma.$queryRawUnsafe(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position;`,
      table
    )
    if (!cols.length) {
      console.log(`⚠ table source introuvable : ${table}`)
      continue
    }
    const select = cols
      .map((c) => {
        const snake = camelToSnake(c.column_name)
        return snake === c.column_name ? `"${c.column_name}"` : `"${c.column_name}" AS "${snake}"`
      })
      .join(', ')
    await prisma.$executeRawUnsafe(`DROP VIEW IF EXISTS "${view}" CASCADE;`)
    await prisma.$executeRawUnsafe(`CREATE VIEW "${view}" AS SELECT ${select} FROM "${table}";`)
    console.log(`vue créée : ${view} → ${table} (${cols.length} colonnes)`)
  }
  await prisma.$disconnect()
}
main().catch((e) => { console.error("ERREUR COMPLETE:", e?.message ?? e); process.exit(1) })
