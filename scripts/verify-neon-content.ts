import { PrismaClient, Prisma } from "@prisma/client";
/* VOLTRIX — vérification finale du contenu de la base Neon après run. */
const p = new PrismaClient({
  datasourceUrl: process.env.DATABASE_URL!.replace(/[?&]channel_binding=[^&]*/g, ""),
});

const total = await p.fixture.count();
const avecProno = await p.fixture.count({
  where: { predQuick: { not: Prisma.DbNull } },
});
const parSport = await p.fixture.groupBy({
  by: ["sport"],
  _count: { _all: true },
});
const parJour = await p.fixture.groupBy({
  by: ["status"],
  _count: { _all: true },
});

console.log(`Total lignes Fixture : ${total}`);
console.log(`Avec pronostic (predQuick non null) : ${avecProno}`);
for (const s of parSport) console.log(`  sport ${s.sport} : ${s._count._all}`);
for (const s of parJour) console.log(`  statut ${s.status} : ${s._count._all}`);

// Échantillon de pronostics concrets
const exemples = await p.fixture.findMany({
  where: { predQuick: { not: Prisma.DbNull } },
  take: 3,
  select: {
    id: true,
    sport: true,
    kickoff: true,
    leagueCode: true,
    data: true,
    predQuick: true,
  },
});
for (const ex of exemples) {
  const d = ex.data as Record<string, unknown>;
  const q = ex.predQuick as Record<string, unknown>;
  const home = (d.homeTeam as Record<string, unknown>)?.name ?? (d.home as Record<string, unknown>)?.name ?? "?";
  const away = (d.awayTeam as Record<string, unknown>)?.name ?? (d.away as Record<string, unknown>)?.name ?? "?";
  const pick = q.pick ?? q.label ?? q.leg ?? "?";
  const prob = q.prob ?? q.p ?? "?";
  console.log(`\n${ex.sport} | ${ex.kickoff} | ${ex.leagueCode}`);
  console.log(`  ${home} vs ${away}`);
  console.log(`  pick: ${JSON.stringify(pick)} | prob: ${JSON.stringify(prob)}`);
}

await p.$disconnect();
