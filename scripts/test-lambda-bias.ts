// Mesure CORRECTE du biais λ : convertit (ligne O/U marché, pUnder dé-margé)
// en λ marché implicite par inversion de Poisson, puis compare λ_modèle
// vs λ_marché — indépendamment de la ligne publiée par ESPN.
import type { LightMatch, MatchesResponse, QuickPred } from '../src/lib/types';
import { deMarginOverUnder } from '../src/lib/market-odds';

const BASE = 'http://localhost:3000';

function poissonUnder(lambdaTotal: number, line: number): number {
  const kMax = Math.floor(line); // under 2.5 → P(≤2 buts)
  let p = Math.exp(-lambdaTotal);
  let cum = p;
  for (let k = 1; k <= kMax; k++) {
    p *= lambdaTotal / k;
    cum += p;
  }
  return cum;
}

// Inversion : λ tel que P(Poisson(λ) ≤ line) = pUnder (fonction DÉCROISSANTE en λ)
function invertLambda(pUnder: number, line: number): number {
  let lo = 0.05;
  let hi = 8;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (poissonUnder(mid, line) > pUnder) lo = mid; // P trop grande → λ trop petit → monter
    else hi = mid;
  }
  return (lo + hi) / 2;
}

async function main() {
  const dates = [new Date().toISOString().slice(0, 10), new Date(Date.now() + 86400000).toISOString().slice(0, 10)];
  const rows: Array<{ m: string; line: number; lambdaModel: number; lambdaMarket: number; ratio: number }> = [];

  for (const date of dates) {
    const res = await fetch(`${BASE}/api/matches?date=${date}`);
    const json: MatchesResponse = await res.json();
    const upcoming = (json.leagues.flatMap((l) => l.matches) ?? [])
      .filter((m: LightMatch) => m.status === "pre");

    const map = new Map<string, QuickPred>();
    for (let i = 0; i < upcoming.length; i += 6) {
      const batch = upcoming.slice(i, i + 6);
      try {
        const r = await fetch(`${BASE}/api/predictions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ matches: batch.map((m) => ({ matchId: m.id, leagueCode: m.leagueCode, date: m.date })) }),
        });
        const j = await r.json();
        for (const res2 of j.results ?? []) if (res2) map.set(res2.matchId, res2);
      } catch { /* ignore */ }
    }

    for (const m of upcoming) {
      const p = map.get(m.id);
      if (!p?.lambda || !p.ouOdds?.line || !p.ouOdds.over || !p.ouOdds.under) continue;
      const dm = deMarginOverUnder(p.ouOdds.over, p.ouOdds.under);
      if (!dm) continue;
      const lambdaMarket = invertLambda(dm.pUnder, p.ouOdds.line);
      rows.push({
        m: `${m.home.name} vs ${m.away.name}`,
        line: p.ouOdds.line,
        lambdaModel: p.lambda.total,
        lambdaMarket,
        ratio: p.lambda.total / lambdaMarket,
      });
    }
  }

  rows.sort((a, b) => a.ratio - b.ratio);
  console.log(`=== Biais λ (modèle / marché) : ${rows.length} matchs ===\n`);
  console.log('--- Sous-estimés (ratio < 1) ---');
  for (const r of rows.slice(0, 8)) {
    console.log(`ligne ${r.line} | λ modèle ${r.lambdaModel.toFixed(2)} vs marché ${r.lambdaMarket.toFixed(2)} (ratio ${r.ratio.toFixed(2)}) | ${r.m.slice(0, 42)}`);
  }
  console.log('--- Sur-estimés (ratio > 1) ---');
  for (const r of rows.slice(-8)) {
    console.log(`ligne ${r.line} | λ modèle ${r.lambdaModel.toFixed(2)} vs marché ${r.lambdaMarket.toFixed(2)} (ratio ${r.ratio.toFixed(2)}) | ${r.m.slice(0, 42)}`);
  }
  const ratios = rows.map((r) => r.ratio).sort((a, b) => a - b);
  const mean = ratios.reduce((s, r) => s + r, 0) / ratios.length;
  const median = ratios[Math.floor(ratios.length / 2)];
  const within20 = ratios.filter((r) => r > 0.8 && r < 1.2).length;
  const within30 = ratios.filter((r) => r > 0.7 && r < 1.3).length;
  console.log(`\nRatio modèle/marché : moyenne ${mean.toFixed(3)} | médiane ${median.toFixed(3)} | min ${ratios[0].toFixed(2)} | max ${ratios[ratios.length - 1].toFixed(2)}`);
  console.log(`Dans ±20 % : ${within20}/${rows.length} | dans ±30 % : ${within30}/${rows.length}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
