import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  const t0 = Date.now()
  const r1: any = await prisma.$queryRawUnsafe(`SELECT COUNT(*) c FROM "ForecastMatch" WHERE "updatedAt" > NOW() - INTERVAL '3 minutes'`)
  console.log(`ForecastMatch mis à jour <3 min: ${Number(r1[0].c)} (scan en cours si >0)`)
  const r2: any = await prisma.$queryRawUnsafe(`SELECT COUNT(*) c FROM "ForecastMatch" WHERE "updatedAt" > NOW() - INTERVAL '10 minutes'`)
  console.log(`ForecastMatch mis à jour <10 min: ${Number(r2[0].c)}`)
  const r3: any = await prisma.$queryRawUnsafe(`SELECT MAX("updatedAt") m FROM "ForecastMatch"`)
  console.log(`Dernière maj ForecastMatch: ${r3[0].m ? new Date(r3[0].m).toISOString() : 'NULL'} (maintenant = ${new Date().toISOString()})`)
  console.log(`Durée requêtes: ${Date.now() - t0} ms`)
  await prisma.$disconnect()
}
main().catch(async e => { console.error('ERR:', e.message); await prisma.$disconnect(); process.exit(1) })
