// ============================================================
// Task 19-a — Finding ④ : biais λ modèle vs marché, APRÈS correctifs
// (Elo signe corrigé). Version STANDALONE : appelle analyzeBatch
// directement dans un process Bun neuf (cache analyse vierge) —
// le cache serveur (TTL 30 min pre-match) garderait sinon les
// analyses calculées AVANT le correctif.
// Exécuter : bun scripts/test-lambda-bias-standalone.ts [nbMax]
// ============================================================

import type { LightMatch, MatchesResponse } from '../src/lib/types';
import { deMarginOverUnder } from '../src/lib/market-odds';
import { analyzeBatch } from '../src/lib/analyze';

const BASE = 'http://localhost:3000';
const NB_MAX = Number(process.argv[2] ?? 60);

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

// Inversion : λ tel que P(Poisson(λ) ≤ line) = pUnder (décroissante en λ)
function invertLambda(pUnder: number, line: number): number {
  let lo = 0.05;
  let hi = 8;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (poissonUnder(mid, line) > pUnder) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

async function main() {
  const dates = [new Date().toISOString().slice(0, 10), new Date(Date.now() + 86400000).toISOString().slice(0, 10)];
  const upcoming: Array<{ matchId: string; leagueCode: string; date: string; label: string }> = [];
  for (const date of dates) {
    const res = await fetch(`${BASE}/api/matches?date=${date}`);
    const json: MatchesResponse = await res.json();
    for (const l of json.leagues ?? []) {
      for (const m of (l.matches as LightMatch[]) ?? []) {
        if (m.status === 'pre' && m.ouLine) {
          upcoming.push({ matchId: m.id, leagueCode: m.leagueCode, date: m.date, label: `${m.home.name} vs ${m.away.name}` });
        }
      }
    }
  }
  const sample = upcoming.slice(0, NB_MAX);
  console.log(`Biais λ standalone (process neuf, moteur APRÈS fix) : ${sample.length} matchs avec ligne O/U réelle`);

  const results = await analyzeBatch(
    sample.map((m) => ({ matchId: m.matchId, leagueCode: m.leagueCode, date: m.date })),
    6
  );

  const rows: Array<{ m: string; line: number; lambdaModel: number; lambdaMarket: number; ratio: number }> = [];
  for (let i = 0; i < sample.length; i++) {
    const a = results[i];
    if (!a?.odds?.hasOdds) continue;
    const line = a.odds.overUnderLine;
    const over = a.odds.total.over.closeOdds ?? a.odds.total.over.openOdds;
    const under = a.odds.total.under.closeOdds ?? a.odds.total.under.openOdds;
    if (!line || !over || !under) continue;
    const dm = deMarginOverUnder(over, under);
    if (!dm) continue;
    const lambdaMarket = invertLambda(dm.pUnder, line);
    const lambdaModel = a.prediction.lambda.total;
    if (!Number.isFinite(lambdaMarket) || lambdaMarket <= 0.05) continue;
    rows.push({ m: sample[i].label, line, lambdaModel, lambdaMarket, ratio: lambdaModel / lambdaMarket });
  }

  if (rows.length === 0) {
    console.log('Aucun match comparable (pas de cotes O/U réelles).');
    process.exit(1);
  }

  const within20 = rows.filter((r) => Math.abs(r.ratio - 1) <= 0.2).length;
  const within30 = rows.filter((r) => Math.abs(r.ratio - 1) <= 0.3).length;
  const ratios = rows.map((r) => r.ratio).sort((a, b) => a - b);
  const mean = ratios.reduce((s, r) => s + r, 0) / ratios.length;
  const median = ratios.length % 2 ? ratios[(ratios.length - 1) / 2] : (ratios[ratios.length / 2 - 1] + ratios[ratios.length / 2]) / 2;

  const under = rows.filter((r) => r.ratio < 0.8).sort((a, b) => a.ratio - b.ratio);
  const over = rows.filter((r) => r.ratio > 1.2).sort((a, b) => b.ratio - a.ratio);
  console.log('\n--- Hors ±20 % (sous-estimés) ---');
  for (const r of under.slice(0, 10)) console.log(`ligne ${r.line} | λ modèle ${r.lambdaModel.toFixed(2)} vs marché ${r.lambdaMarket.toFixed(2)} (ratio ${r.ratio.toFixed(2)}) | ${r.m}`);
  console.log('--- Hors ±20 % (sur-estimés) ---');
  for (const r of over.slice(0, 10)) console.log(`ligne ${r.line} | λ modèle ${r.lambdaModel.toFixed(2)} vs marché ${r.lambdaMarket.toFixed(2)} (ratio ${r.ratio.toFixed(2)}) | ${r.m}`);

  console.log(`\nRatio modèle/marché : moyenne ${mean.toFixed(3)} | médiane ${median.toFixed(3)} | min ${ratios[0].toFixed(2)} | max ${ratios[ratios.length - 1].toFixed(2)}`);
  console.log(`Dans ±20 % : ${within20}/${rows.length} | dans ±30 % : ${within30}/${rows.length}`);
}

await main();
