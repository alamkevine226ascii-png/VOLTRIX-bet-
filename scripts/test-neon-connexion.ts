/**
 * Test de connexion à la base Neon — VOLTRIX.
 * Teste les deux URLs (pooler et directe) avec le moteur Prisma,
 * exactement comme le feront le runtime et `prisma db push`.
 * Usage : bun scripts/test-neon-connexion.ts <url>
 */
import { PrismaClient } from "@prisma/client";

const url = process.argv[2];
if (!url) {
  console.error("Usage: bun test-neon-connexion.ts <url>");
  process.exit(2);
}

/* Le moteur Prisma ne connaît pas channel_binding : on le retire,
   comme le fait scripts/precompute/run.ts en production. */
const clean = url.replace(/[?&]channel_binding=[^&]*/g, "");

const prisma = new PrismaClient({ datasourceUrl: clean });
try {
  const info = await prisma.$queryRaw<
    { db: string; ver: string; n: bigint }[]
  >`SELECT current_database() AS db,
           current_setting('server_version') AS ver,
           (SELECT count(*) FROM information_schema.tables
             WHERE table_schema = 'public') AS n`;
  const r = info[0];
  console.log(
    `SUCCÈS — base « ${r.db} », PostgreSQL ${r.ver}, ${r.n} table(s) en public`,
  );
} catch (e) {
  console.error(`ÉCHEC — ${(e as Error).message.split("\n").slice(0, 4).join(" | ")}`);
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
