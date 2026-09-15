// Diagnostic : pourquoi les matchs importés par le sweep ne comptent pas
// dans la compétition ciblée (duplicates équipes ? competitionId différent ?)
import { db } from '../src/lib/db';

async function main() {
  // Toutes les competitions bol.1 / rus.1
  const comps = await db.competition.findMany({ where: { espnLeagueId: { in: ['bol.1', 'rus.1'] } }, select: { id: true, name: true, espnLeagueId: true, season: true } });
  for (const c of comps) console.log('Competition:', c.espnLeagueId, '| id:', c.id, '|', c.name, '| season:', c.season);

  // Équipes Real Oruro (toutes homonymes)
  const teams = await db.team.findMany({ where: { name: { contains: 'Oruro', mode: 'insensitive' } }, select: { id: true, name: true, espnTeamId: true } });
  for (const t of teams) console.log('Team Oruro:', t.id, t.name, 'espn:', t.espnTeamId);

  // Les matchs de ces équipes (par espnTeamId ou id)
  const ids = teams.map((t) => t.id);
  const ms = await db.match.findMany({
    where: { OR: [{ homeTeamId: { in: ids } }, { awayTeamId: { in: ids } }], status: 'FINAL' },
    orderBy: { kickoffAt: 'desc' }, take: 12,
    select: { kickoffAt: true, homeTeamName: true, awayTeamName: true, homeScore: true, awayScore: true, competitionId: true, espnEventId: true },
  });
  for (const m of ms) {
    const comp = comps.find((c) => c.id === m.competitionId);
    console.log(`  FINAL ${m.kickoffAt.toISOString().slice(0, 10)} ${m.homeTeamName} ${m.homeScore}-${m.awayScore} ${m.awayTeamName} | comp=${m.competitionId} (${comp?.espnLeagueId ?? 'INCONNU'}) src=${(m as { source?: string }).source ?? '?'}`);
  }

  // Prochain match bol.1 à venir : ses équipes et competitionId
  const up = await db.match.findFirst({
    where: { status: 'SCHEDULED', kickoffAt: { gte: new Date() }, competitionId: comps.find((c) => c.espnLeagueId === 'bol.1')?.id },
    select: { kickoffAt: true, homeTeamId: true, homeTeamName: true, awayTeamId: true, awayTeamName: true },
  });
  if (up) console.log('Prochain bol.1:', up.homeTeamName, '-', up.awayTeamName, up.kickoffAt.toISOString(), '| homeId:', up.homeTeamId, 'awayId:', up.awayTeamId);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
