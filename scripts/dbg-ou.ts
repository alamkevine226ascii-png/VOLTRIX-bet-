import type { LightMatch, MatchesResponse, QuickPred } from '/home/z/my-project/src/lib/types';
import { deMarginOverUnder } from '/home/z/my-project/src/lib/market-odds';
const BASE = 'http://localhost:3000';
const date = new Date().toISOString().slice(0, 10);
const res = await fetch(`${BASE}/api/matches?date=${date}`);
const json: MatchesResponse = await res.json();
const upcoming = (json.leagues.flatMap((l) => l.matches) ?? [])
  .filter((m: LightMatch) => m.status === "pre")
  .filter((m: LightMatch) => ['Liverpool', 'Blackburn', 'Defensores', 'Chicago'].some(n => m.home.name.includes(n) || m.away.name.includes(n)));
for (const m of upcoming) {
  const r = await fetch(`${BASE}/api/predictions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ matches: [{ matchId: m.id, leagueCode: m.leagueCode, date: m.date }] }),
  });
  const j = await r.json();
  const p: QuickPred | null = j.results?.[0] ?? null;
  console.log(`\n${m.home.name} vs ${m.away.name} | ouLine match=${m.ouLine}`);
  console.log(`  ouOdds = ${JSON.stringify(p?.ouOdds)}`);
  if (p?.ouOdds?.over && p?.ouOdds?.under) {
    const dm = deMarginOverUnder(p.ouOdds.over, p.ouOdds.under);
    console.log(`  dé-margé = ${JSON.stringify(dm)}`);
  }
  console.log(`  lambda = ${JSON.stringify(p?.lambda)}`);
}
