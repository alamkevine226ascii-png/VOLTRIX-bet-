// Test E2E : injecte des pronos pour un match terminé, la résolution doit les marquer
import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();

async function main() {
  // Aston Villa 0-1 Arsenal (31 août 2026) — match réel terminé
  const matchId = '401879295';
  const rows = [
    { market: '1X2', pick: '2 - Arsenal', probability: 0.44, odds: 1.85, expected: 'WIN' },
    { market: 'O/U 2.5', pick: 'Moins de 2.5', probability: 0.58, odds: 1.7, expected: 'WIN' },
    { market: 'BTTS', pick: 'Non', probability: 0.55, odds: null, expected: 'WIN' },
  ];
  for (const r of rows) {
    await db.prediction.upsert({
      where: { matchId_market: { matchId, market: r.market } },
      create: {
        matchId,
        league: 'eng.1',
        leagueName: 'Premier League',
        matchDate: new Date('2026-08-31T19:00:00Z'),
        homeTeam: 'Aston Villa',
        awayTeam: 'Arsenal',
        market: r.market,
        pick: r.pick,
        probability: r.probability,
        odds: r.odds,
        confidence: 4,
      },
      update: { resolved: false, result: null },
    });
  }
  console.log('3 pronos injectés pour match terminé (attendu: 3x WIN)');
  await db.$disconnect();
}
main();
