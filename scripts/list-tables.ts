import { PrismaClient } from '@prisma/client'
console.log("SCRIPT DEMARRÉ")
const prisma = new PrismaClient()

async function main() {
  const tables: Array<{ table_name: string; rows: bigint }> = await prisma.$queryRawUnsafe(`
    SELECT c.relname AS table_name, c.reltuples::bigint AS rows
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
    ORDER BY c.relname;
  `)
  console.log('Tables réelles dans Neon (public) :')
  for (const t of tables) console.log(`  ${t.table_name.padEnd(25)} ~${t.rows}`)
  await prisma.$disconnect()
}
main().catch((e) => { console.error("ERREUR COMPLETE:", e?.message ?? e); process.exit(1) })
