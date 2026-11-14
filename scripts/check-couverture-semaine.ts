/** Vérifie la couverture de la base Neon jour par jour (foot). */
import { PrismaClient } from "@prisma/client";

const URL = (
  process.env.NEON_POOLER_URL ??
  "postgresql://neondb_owner:npg_D1OymYeRSnr2@ep-round-cloud-ae3m3lka-pooler.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require"
).replace(/[?&]channel_binding=[^&]*/g, "");

const prisma = new PrismaClient({ datasourceUrl: URL });

async function main() {
  const today = new Date();
  today.setUTCHours(12, 0, 0, 0);
  for (let off = -2; off <= 8; off++) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() + off);
    const key = d.toISOString().slice(0, 10);
    const [foot, mma] = await Promise.all([
      prisma.fixture.count({ where: { sport: "foot", dayKeys: { has: key } } }),
      prisma.fixture.count({
        where: {
          sport: "mma",
          kickoff: { gte: `${key}T00:00:00Z`, lt: `${key}T23:59:59Z` },
        },
      }),
    ]);
    const wd = d.toLocaleDateString("fr-FR", { weekday: "short", timeZone: "UTC" });
    console.log(`${key} (${wd}) J${off >= 0 ? "+" : ""}${off} : foot=${foot} mma=${mma}`);
  }
  const total = await prisma.fixture.count();
  const last = await prisma.fixture.findFirst({
    orderBy: { computedAt: "desc" },
    select: { computedAt: true },
  });
  console.log(`\nTotal lignes : ${total} · dernier calcul : ${last?.computedAt?.toISOString()}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
