// Shadow-run ESPN vs Neon — pré-vol LECTURE SEULE
// Vérifie : connectivité Neon, volume de matchs à venir testables,
// couverture cotes open/close + standings, blessures.
import { db } from '../src/lib/db';

async function main() {
  const now = Date.now();
  const from = new Date(now + 30 * 60_000); // > 30 min (pre-match)
  const to = new Date(now + 7 * 24 * 3_600_000); // 7 jours

  const upcoming = await db.match.findMany({
    where: {
      kickoffAt: { gte: from, lte: to },
      homeTeamId: { not: null },
      awayTeamId: { not: null },
      status: 'SCHEDULED',
    },
    select: { espnEventId: true, competitionId: true },
  });
  console.log('upcoming 7j (SCHEDULED, équipes connues):', upcoming.length);

  const ids = upcoming.map((m) => m.espnEventId);
  const oddsMarks = await db.oddsOpenClose.groupBy({
    by: ['matchId'],
    where: { matchId: { in: ids } },
    _count: { _all: true },
  });
  console.log('upcoming avec ancrage OddsOpenClose:', oddsMarks.length);

  const comps = await db.competition.findMany({ select: { espnLeagueId: true } });
  console.log('compétitions:', comps.length);

  const standLatest = await db.standingsSnapshot.findMany({
    orderBy: { snapshotDate: 'desc' },
    take: 1,
    select: { snapshotDate: true, espnLeagueId: true },
  });
  console.log('standings dernier snapshot:', standLatest);

  const [inj, wthr, teams, finals] = await Promise.all([
    db.injurySnapshot.count(),
    db.weatherSnapshot.count(),
    db.team.count(),
    db.match.count({ where: { status: 'FINAL' } }),
  ]);
  console.log({ injuries: inj, weather: wthr, teams, finals });

  // Répartition par jour
  const byDay = new Map<string, number>();
  for (const m of upcoming) {
    void m;
  }
  const rows = await db.match.findMany({
    where: { kickoffAt: { gte: from, lte: to }, homeTeamId: { not: null }, awayTeamId: { not: null }, status: 'SCHEDULED' },
    select: { kickoffAt: true },
  });
  for (const r of rows) {
    const d = r.kickoffAt.toISOString().slice(0, 10);
    byDay.set(d, (byDay.get(d) ?? 0) + 1);
  }
  console.log('par jour:', [...byDay.entries()].sort());
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('ERREUR pré-vol:', e.message?.slice(0, 300));
    process.exit(1);
  });
