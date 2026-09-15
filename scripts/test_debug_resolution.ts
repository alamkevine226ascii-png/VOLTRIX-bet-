// Debug : teste la chaîne de résolution étape par étape
import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();

async function main() {
  const cutoff = new Date(Date.now() - 3 * 3600 * 1000);
  console.log('cutoff:', cutoff.toISOString());

  const pending = await db.prediction.findMany({
    where: { resolved: false, matchDate: { lt: cutoff } },
    take: 300,
  });
  console.log('pending trouvés:', pending.length);
  for (const p of pending) {
    console.log(' -', p.matchId, p.league, p.market, '| matchDate:', p.matchDate.toISOString());
  }

  // Test fetchScoreboard simulé (fetch direct)
  const res = await fetch('https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard?dates=20260831');
  const board = await res.json();
  console.log('ESPN events:', board.events?.length ?? 0, '| premier id:', board.events?.[0]?.id);
  await db.$disconnect();
}
main();
