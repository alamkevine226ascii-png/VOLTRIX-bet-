// Quantification du biais « Moins 2.5 » :
// compare la proba modèle P(Under 2.5) brute à la proba marché dé-margée
// pour chaque match ayant une ligne O/U réelle ESPN.
// Un biais systématique positif = modèle trop optimiste sur le Under.
import type { LightMatch, MatchesResponse, QuickPred } from '../src/lib/types';
import { deMarginOverUnder } from '../src/lib/market-odds';

const BASE = 'http://localhost:3000';

function poissonUnder(lambdaTotal: number, line = 2.5): number {
  // P(total <= 2)
  let p0 = Math.exp(-lambdaTotal);
  let p1 = p0 * lambdaTotal;
  let p2 = p1 * lambdaTotal / 2;
  return p0 + p1 + p2;
}

async function main() {
  const dates = [new Date().toISOString().slice(0, 10)];
  // + demain pour élargir l'échantillon
  dates.push(new Date(Date.now() + 86400000).toISOString().slice(0, 10));
  let compared = 0;
  let sumGap = 0; // modèle − marché
  let sumLambda = 0;
  let nLambda = 0;
  const rows: Array<{ m: string; lambdaTotal: number; modelUnder: number; marketUnder: number; gap: number }> = [];

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
      const modelUnderRaw = poissonUnder(p.lambda.total);
      const gap = modelUnderRaw - dm.pUnder;
      sumGap += gap;
      sumLambda += p.lambda.total;
      nLambda++;
      compared++;
      rows.push({ m: `${m.home.name} vs ${m.away.name}`, lambdaTotal: p.lambda.total, modelUnder: modelUnderRaw, marketUnder: dm.pUnder, gap });
    }
  }

  console.log(`\n=== Biais Under 2.5 : ${compared} matchs comparés ===`);
  rows.sort((a, b) => b.gap - a.gap);
  for (const r of rows.slice(0, 10)) {
    console.log(
      `λ=${r.lambdaTotal.toFixed(2)} | modèle under ${(r.modelUnder * 100).toFixed(1)}% | marché under ${(r.marketUnder * 100).toFixed(1)}% | écart ${(r.gap * 100).toFixed(1)} pts | ${r.m.slice(0, 45)}`
    );
  }
  console.log('...');
  for (const r of rows.slice(-5)) {
    console.log(
      `λ=${r.lambdaTotal.toFixed(2)} | modèle under ${(r.modelUnder * 100).toFixed(1)}% | marché under ${(r.marketUnder * 100).toFixed(1)}% | écart ${(r.gap * 100).toFixed(1)} pts | ${r.m.slice(0, 45)}`
    );
  }
  if (compared > 0) {
    console.log(`\nÉcart moyen modèle−marché : ${(sumGap / compared * 100).toFixed(1)} points`);
    console.log(`λ total moyen du modèle : ${(sumLambda / nLambda).toFixed(2)} (référence réaliste : ~2.6-2.8)`);
    console.log(`P(under 2.5) à λ=2.74 : ${(poissonUnder(2.74) * 100).toFixed(1)}% — référence marché ~48-52%`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
