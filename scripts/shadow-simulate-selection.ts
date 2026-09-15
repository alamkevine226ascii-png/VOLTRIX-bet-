// Simule la sélection EXACTE du shadow-run (36 avec ancres + 12 sans, cap 6/ligue,
// kickoff asc) et vérifie la profondeur Neon des équipes impliquées.
// Lecture seule.
import { db } from '../src/lib/db';

async function main() {
  const now = new Date();
  const from = new Date(now.getTime() + 30 * 60_000);
  const to = new Date(now.getTime() + 7 * 24 * 3_600_000);

  const candidates = await db.match.findMany({
    where: { kickoffAt: { gte: from, lte: to }, status: 'SCHEDULED', homeTeamId: { not: null }, awayTeamId: { not: null }, competitionId: { not: null } },
    orderBy: { kickoffAt: 'asc' },
    select: { espnEventId: true, kickoffAt: true, homeTeamId: true, homeTeamName: true, awayTeamId: true, awayTeamName: true, competitionId: true },
  });
  const comps = await db.competition.findMany({ select: { id: true, espnLeagueId: true } });
  const leagueOf = new Map(comps.map((c) => [c.id, c.espnLeagueId]));
  const withLeague = candidates.map((m) => ({ ...m, league: leagueOf.get(m.competitionId!) ?? '' })).filter((m) => !!m.league);

  const ids = withLeague.map((m) => m.espnEventId);
  const oddsIds = new Set((await db.oddsOpenClose.groupBy({ by: ['matchId'], where: { matchId: { in: ids } } })).map((o) => o.matchId));

  const leagueCount = new Map<string, number>();
  const picked: typeof withLeague = [];
  const pick = (m: (typeof withLeague)[number]) => {
    const c = leagueCount.get(m.league) ?? 0;
    if (c >= 6) return false;
    if (picked.find((p) => p.espnEventId === m.espnEventId)) return false;
    leagueCount.set(m.league, c + 1); picked.push(m); return true;
  };
  for (const m of withLeague) if (oddsIds.has(m.espnEventId) && picked.length < 36) pick(m);
  for (const m of withLeague) if (!oddsIds.has(m.espnEventId) && picked.length < 48) pick(m);

  // Profondeur historique par équipe (clé = ID numérique ESPN dans Match)
  const states = await db.teamHistorySyncState.findMany({ select: { espnTeamId: true, lastSyncedAt: true } });
  const traced = new Set(states.map((s) => s.espnTeamId));

  const teamIds = new Set<string>();
  for (const m of picked) { teamIds.add(m.homeTeamId!); teamIds.add(m.awayTeamId!); }
  const finals = await db.match.groupBy({
    by: ['homeTeamId'], where: { status: 'FINAL', homeTeamId: { in: [...teamIds] }, homeScore: { not: null } }, _count: { _all: true },
  });
  const finalsA = await db.match.groupBy({
    by: ['awayTeamId'], where: { status: 'FINAL', awayTeamId: { in: [...teamIds] }, homeScore: { not: null } }, _count: { _all: true },
  });
  const cnt = new Map<string, number>();
  for (const r of finals) if (r.homeTeamId) cnt.set(r.homeTeamId, (cnt.get(r.homeTeamId) ?? 0) + r._count._all);
  for (const r of finalsA) if (r.awayTeamId) cnt.set(r.awayTeamId, (cnt.get(r.awayTeamId) ?? 0) + r._count._all);

  const shallow: string[] = [];
  for (const m of picked) {
    const h = cnt.get(m.homeTeamId!) ?? 0; const a = cnt.get(m.awayTeamId!) ?? 0;
    const tag = (n: number) => (n === 0 ? 'ABSENT' : n < 8 ? 'faible' : 'ok');
    const th = tag(h), ta = tag(a);
    if (th !== 'ok' || ta !== 'ok') shallow.push(`${m.kickoffAt.toISOString().slice(5, 16)} ${m.homeTeamName}[${h},${th},tracé:${traced.has(m.homeTeamId!)}] - ${m.awayTeamName}[${a},${ta},tracé:${traced.has(m.awayTeamId!)}] (${m.league})`);
  }
  console.log(`Sélection shadow simulée: ${picked.length} matchs (${picked.filter((m) => oddsIds.has(m.espnEventId)).length} avec ancres)`);
  console.log(`Matchs avec ≥1 équipe à historique Neon faible/absent (<8 FINAL): ${shallow.length}`);
  for (const s of shallow.slice(0, 30)) console.log('  ', s);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
