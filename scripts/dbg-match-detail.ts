// Vérifie λ post-fix sur des matchs anciennement aberrants
import type { LightMatch, MatchesResponse } from '/home/z/my-project/src/lib/types';
const BASE = 'http://localhost:3000';
const date = new Date().toISOString().slice(0, 10);
const res = await fetch(`${BASE}/api/matches?date=${date}`);
const json: MatchesResponse = await res.json();
const targets = (json.leagues.flatMap((l) => l.matches) ?? [])
  .filter((m: LightMatch) => ['Exeter', 'Bournemouth', 'Santa Fe', 'Dortmund', 'PSG', 'Paris Saint-Germain'].some(n => m.home.name.includes(n) || m.away.name.includes(n)))
  .slice(0, 6);
for (const m of targets) {
  const r = await fetch(`${BASE}/api/match/${m.id}?league=${m.leagueCode}&date=${encodeURIComponent(m.date)}`);
  if (!r.ok) { console.log(`${m.home.name} vs ${m.away.name}: HTTP ${r.status}`); continue; }
  const a = await r.json();
  const ou = a.prediction?.overUnder?.find((o: { line: number }) => o.line === 2.5);
  console.log(
    `${m.home.name} vs ${m.away.name} | λ=${a.prediction?.lambda?.home}+${a.prediction?.lambda?.away}=${a.prediction?.lambda?.total} | under2.5=${(ou?.under * 100).toFixed(1)}% | firstToScore h/a/ng=${a.prediction?.firstToScore?.home}/${a.prediction?.firstToScore?.away}/${a.prediction?.firstToScore?.noGoal}`
  );
}
