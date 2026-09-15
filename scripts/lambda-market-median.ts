// Médiane λ_marché pour caler les références de ligue
import type { LightMatch, MatchesResponse, QuickPred } from '/home/z/my-project/src/lib/types';
import { deMarginOverUnder } from '/home/z/my-project/src/lib/market-odds';
const BASE = 'http://localhost:3000';
function poissonUnder(lambdaTotal: number, line: number): number {
  const kMax = Math.floor(line);
  let p = Math.exp(-lambdaTotal); let cum = p;
  for (let k = 1; k <= kMax; k++) { p *= lambdaTotal / k; cum += p; }
  return cum;
}
function invertLambda(pUnder: number, line: number): number {
  let lo = 0.05, hi = 8;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (poissonUnder(mid, line) > pUnder) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}
async function main() {
  const dates = [new Date().toISOString().slice(0, 10), new Date(Date.now() + 86400000).toISOString().slice(0, 10)];
  const lm: number[] = [];
  for (const date of dates) {
    const res = await fetch(`${BASE}/api/matches?date=${date}`);
    const json: MatchesResponse = await res.json();
    const upcoming = (json.leagues.flatMap((l) => l.matches) ?? []).filter((m: LightMatch) => m.status === "pre");
    for (let i = 0; i < upcoming.length; i += 6) {
      const batch = upcoming.slice(i, i + 6);
      try {
        const r = await fetch(`${BASE}/api/predictions`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ matches: batch.map((m) => ({ matchId: m.id, leagueCode: m.leagueCode, date: m.date })) }),
        });
        const j = await r.json();
        for (const p of j.results ?? []) {
          if (!p?.lambda || !p.ouOdds?.line || !p.ouOdds.over || !p.ouOdds.under) continue;
          const dm = deMarginOverUnder(p.ouOdds.over, p.ouOdds.under);
          if (!dm) continue;
          lm.push({ lam: invertLambda(dm.pUnder, p.ouOdds.line), line: p.ouOdds.line });
        }
      } catch { /* ignore */ }
    }
  }
  const l25 = lm.filter((x) => x.line === 2.5).map((x) => x.lam).sort((a, b) => a - b);
  const all = lm.map((x) => x.lam).sort((a, b) => a - b);
  const med = (a: number[]) => a[Math.floor(a.length / 2)];
  console.log(`Ligne 2.5 : n=${l25.length} | médiane λ_marché=${med(l25)?.toFixed(2)} | moyenne=${(l25.reduce((s, x) => s + x, 0) / l25.length).toFixed(2)}`);
  console.log(`Toutes lignes : n=${all.length} | médiane=${med(all)?.toFixed(2)} | moyenne=${(all.reduce((s, x) => s + x, 0) / all.length).toFixed(2)}`);
}
main();
