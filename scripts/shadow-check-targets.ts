// Vérification ciblée : équipes des top-20 écarts du run 1 (rus.1/bol.1/esp.1/eng.league_cup)
// Combien de FINAL par équipe+compétition dans Neon maintenant ? + état TeamHistorySyncState
import { db } from '../src/lib/db';

const TARGETS: { league: string; name: string }[] = [
  { league: 'rus.1', name: 'Lokomotiv Moscow' }, { league: 'rus.1', name: 'Krylia Sovetov' },
  { league: 'rus.1', name: 'FC Baltika Kaliningrad' }, { league: 'rus.1', name: 'Zenit St Petersburg' },
  { league: 'rus.1', name: 'Spartak Moscow' }, { league: 'rus.1', name: 'Fakel Voronezh' },
  { league: 'rus.1', name: 'Rodina Moscow' }, { league: 'rus.1', name: 'Rubin Kazan' },
  { league: 'bol.1', name: 'Nacional Potosí' }, { league: 'bol.1', name: 'Always Ready' },
  { league: 'bol.1', name: 'Guabirá' }, { league: 'bol.1', name: 'Aurora' },
  { league: 'bol.1', name: 'Real Oruro' }, { league: 'bol.1', name: 'Real Potosí' },
  { league: 'bol.1', name: 'ABB' }, { league: 'bol.1', name: 'The Strongest' },
  { league: 'esp.1', name: 'Rayo Vallecano' }, { league: 'esp.1', name: 'Espanyol' },
  { league: 'eng.league_cup', name: 'West Ham United' }, { league: 'eng.league_cup', name: 'Fulham' },
];

async function main() {
  const comps = await db.competition.findMany({ select: { id: true, espnLeagueId: true } });
  const compOf = new Map(comps.map((c) => [c.espnLeagueId, c.id]));
  const states = await db.teamHistorySyncState.findMany();
  const stateByName = new Map(states.map((s) => [(s.teamName ?? '').toLowerCase(), s]));

  for (const t of TARGETS) {
    const compId = compOf.get(t.league);
    const team = await db.team.findFirst({ where: { name: { equals: t.name, mode: 'insensitive' } }, select: { id: true, name: true } });
    if (!team || !compId) { console.log(`${t.league} ${t.name} : équipe/compétition introuvable`); continue; }
    const scoped = await db.match.count({
      where: { status: 'FINAL', competitionId: compId, homeScore: { not: null }, awayScore: { not: null },
        OR: [{ homeTeamId: team.id }, { awayTeamId: team.id }] },
    });
    const st = stateByName.get(t.name.toLowerCase());
    const stTxt = st ? `${st.matchesImported} matchs importés, ${st.lastResult}, sync ${st.lastSyncedAt?.toISOString()?.slice(0, 16) ?? '—'}` : 'NON TRACÉE';
    console.log(`${t.league} | ${t.name} : FINAL Neon en compétition = ${String(scoped).padStart(3)} | sweep: ${stTxt}`);
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
