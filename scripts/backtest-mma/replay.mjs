#!/usr/bin/env node
/**
 * BACKTEST VOLTRIX MMA — voltrix-mma-v1 sur dataset DanMcInerney/mma-ai
 * (ufcstats.com brut, 7 704 combats UFC 1998-2026, cotes BestFightOdds).
 *
 * Méthodologie anti-fuite :
 *  - passes séquentielles dans l'ordre chronologique (date, fight_id) ;
 *  - pour chaque combat, les stats « carrière » et « 8 derniers combats »
 *    sont des instantanés AVANT le combat (strictement antérieurs) ;
 *  - aucune stat du combat évalué n'entre dans ses propres features ;
 *  - les cotes servent uniquement de baseline (jamais en feature).
 *
 * Artéfacts du dataset documentés :
 *  - avant 2010, fighter1 est TOUJOURS le vainqueur (ordre « vainqueur
 *    d'abord », vérifié sur Serra-GSP 2007, Liddell-Silva 2007...) : les
 *    issues restent correctes, seul le label positionnel est biaisé ;
 *  - le moteur étant SYMÉTRIQUE (dimensions A↔B), sa précision/Brier/
 *    log-loss sont invariants par échange des combattants → évaluation
 *    valide sur toute la période ; l'affichage calibration est symétrisé
 *    (chaque combat compté dans les deux orientations) pour neutraliser
 *    le taux de base positionnel ;
 *  - la baseline « toujours f1 » n'est rapportée que sur 2010+.
 *
 * Portage fidèle de src/lib/mma/{types,analysis,prediction}.ts.
 */

import { readFileSync, writeFileSync } from 'node:fs';

const lines = readFileSync(new URL('./fights.jsonl', import.meta.url), 'utf8')
  .split('\n')
  .filter(Boolean);
const fights = lines.map((l) => JSON.parse(l));

// ---------------------------------------------------------------------------
// Portage du moteur
// ---------------------------------------------------------------------------
const DERIVED_WINDOW = 8;

function formScore(lastResults, count = 5) {
  if (!lastResults) return null;
  const results = lastResults.split(',').filter(Boolean).slice(0, count);
  if (results.length === 0) return null;
  const total = results.reduce((acc, r) => acc + (r === 'W' ? 1 : r === 'D' ? 0.5 : 0), 0);
  return total / results.length;
}

function edge(a, b, lowerBetter = false, epsilon = 0, floor = 0) {
  if (a == null || b == null) return { scoreA: null, scoreB: null, advantage: null };
  if (floor > 0 && Math.max(a, b) < floor) {
    return { scoreA: null, scoreB: null, advantage: null };
  }
  if (a === 0 && b === 0) return { scoreA: 50, scoreB: 50, advantage: '=' };
  const [x, y] = lowerBetter ? [b, a] : [a, b];
  const denom = x + y + epsilon;
  const shareX = denom <= 0 ? 50 : 50 + (50 * (x - y)) / denom;
  const scoreA = lowerBetter ? 100 - shareX : shareX;
  const scoreB = 100 - scoreA;
  const advantage = Math.abs(scoreA - scoreB) < 6 ? '=' : scoreA > scoreB ? 'A' : 'B';
  return { scoreA, scoreB, advantage };
}

const DIMENSION_WEIGHTS = {
  forme: 1.5, volume: 1.2, precision: 1.2, absorption: 1.2,
  'defense-frappes': 1.0, lutte: 1.0, 'defense-takedown': 1.0,
  sol: 0.8, puissance: 1.0, experience: 0.8, physique: 0.6,
};
const CORE_DIMENSIONS = ['forme', 'volume', 'precision', 'absorption', 'lutte', 'puissance'];
const KO_METHODS = new Set(['KO/TKO', "TKO - Doctor's Stoppage", 'Could Not Continue']);

/** Les 11 dimensions — INDEPENDANTES des paramètres (précalculées une fois). */
function buildDimensions(fa, fb) {
  const dims = [];
  const add = (key, va, vb, lowerBetter = false, epsilon = 0, floor = 0) => {
    const e = edge(va, vb, lowerBetter, epsilon, floor);
    dims.push({ key, scoreA: e.scoreA, scoreB: e.scoreB, available: e.advantage !== null });
  };
  const a = fa.career, b = fb.career, da = fa.derived, db = fb.derived;
  add('forme', fa.forme, fb.forme);
  add('volume', a ? a.slpM : null, b ? b.slpM : null, false, 2);
  add('precision', a ? a.sigAcc : null, b ? b.sigAcc : null, false, 20);
  add('absorption', da ? da.sapm : null, db ? db.sapm : null, true, 2);
  add('defense-frappes', da ? da.sigDef : null, db ? db.sigDef : null, false, 20);
  add('lutte', a ? a.td15 : null, b ? b.td15 : null, false, 1.5, 0.3);
  add('defense-takedown', da ? da.tdd : null, db ? db.tdd : null, false, 20);
  add('sol', a ? a.sub15 : null, b ? b.sub15 : null, false, 0.8, 0.15);
  add('puissance', a ? a.koTkoPct : null, b ? b.koTkoPct : null, false, 25);
  add('experience', fa.totalFights, fb.totalFights, false, 6);
  add('physique', fa.reachCm != null && fb.reachCm != null ? fa.reachCm : null,
      fa.reachCm != null && fb.reachCm != null ? fb.reachCm : null, false, 10);
  return dims;
}

/** Agrégation pondérée → logistique → bornage (paramètres calibrables). */
function aggregate(dims, params) {
  const K = params.kLogistic;
  const weights = params.weights;
  const usable = dims.filter((d) => d.available && d.scoreA != null && (weights[d.key] ?? 0) > 0);
  if (usable.length < 3) return null;
  let wa = 0, tw = 0;
  for (const d of usable) {
    wa += weights[d.key] * (d.scoreA - 50);
    tw += weights[d.key];
  }
  const norm = wa / (tw * 50);
  const rawP = 1 / (1 + Math.exp(-K * norm));
  const pA = Math.min(params.pMax, Math.max(params.pMin, rawP * 100));
  const coreUsed = CORE_DIMENSIONS.filter((k) => usable.some((d) => d.key === k)).length;
  return {
    pA,
    nDims: usable.length,
    confidence: 100 * (0.45 * (usable.length / dims.length) + 0.55 * (coreUsed / CORE_DIMENSIONS.length)),
  };
}

function predictMethod(f) {
  const c = f.career;
  if (!c || c.wins <= 0) return null;
  const ko = c.koTkoWins / c.wins;
  const sub = c.subWins / c.wins;
  const dec = Math.max(0, 1 - ko - sub);
  const best = { ko, sub, dec };
  const label = Object.keys(best).reduce((a, b) => (best[a] >= best[b] ? a : b));
  return { label, share: best[label] };
}

// ---------------------------------------------------------------------------
// Passe 1 — replay séquentiel : états + instantanés + dimensions précalculées
// ---------------------------------------------------------------------------
function emptyState() {
  return {
    fights: 0, wins: 0, koTkoWins: 0, subWins: 0,
    sec: 0, ssl: 0, ssa: 0, tl: 0, ta: 0, sa: 0,
    window: [], results: [],
  };
}

function snapshot(st, reachInches) {
  const career =
    st.fights === 0
      ? null
      : {
          slpM: st.sec > 0 ? st.ssl / (st.sec / 60) : null,
          sigAcc: st.ssa > 0 ? (st.ssl / st.ssa) * 100 : null,
          td15: st.sec > 0 ? (st.tl / (st.sec / 60)) * 15 : null,
          sub15: st.sec > 0 ? (st.sa / (st.sec / 60)) * 15 : null,
          koTkoPct: (st.koTkoWins / st.fights) * 100,
          wins: st.wins, koTkoWins: st.koTkoWins, subWins: st.subWins,
        };
  let derived = null;
  const win = st.window.slice(0, DERIVED_WINDOW);
  if (win.length > 0) {
    let oppSsl = 0, oppSsa = 0, oppTl = 0, oppTa = 0, sec = 0;
    for (const w of win) {
      oppSsl += w.oppSsl; oppSsa += w.oppSsa; oppTl += w.oppTl; oppTa += w.oppTa; sec += w.sec;
    }
    if (sec > 0) {
      derived = {
        sapm: oppSsl / (sec / 60),
        sigDef: oppSsa > 0 ? (1 - oppSsl / oppSsa) * 100 : null,
        tdd: oppTa > 0 ? (1 - oppTl / oppTa) * 100 : null,
      };
    }
  }
  return {
    career, derived,
    forme: st.results.length ? formScore(st.results.join(',')) : null,
    totalFights: st.fights,
    reachCm: reachInches != null ? reachInches * 2.54 : null,
  };
}

const state = new Map();
const records = [];

for (const f of fights) {
  const s1 = state.get(f.f1.id) ?? emptyState();
  const s2 = state.get(f.f2.id) ?? emptyState();
  const fa = snapshot(s1, f.f1.reach);
  const fb = snapshot(s2, f.f2.reach);

  let r1 = 'NC', r2 = 'NC';
  if (f.res === 1) { r1 = 'W'; r2 = 'L'; }
  else if (f.res === 0) { r1 = 'L'; r2 = 'W'; }
  else if (f.res === 2) { r1 = 'D'; r2 = 'D'; }
  const koTko = KO_METHODS.has(f.m);
  const sub = f.m === 'Submission';

  records.push({
    id: f.id, date: f.d, year: Number(f.d.slice(0, 4)),
    decided: f.res === 0 || f.res === 1,
    winnerIsF1: f.res === 1,
    method: f.m, methodClass: koTko ? 'ko' : sub ? 'sub' : 'dec', endRound: f.r,
    fa, fb,
    dims: buildDimensions(fa, fb), // précalculé — indépendant des paramètres
    odds: f.o1 && f.o2 ? { ip1: f.o1.ip, ip2: f.o2.ip } : null,
    n1: f.f1.n, n2: f.f2.n,
  });

  for (const [st, own, opp, ownRes] of [
    [s1, f.s1, f.s2, r1],
    [s2, f.s2, f.s1, r2],
  ]) {
    st.fights++;
    st.sec += own.t; st.ssl += own.ssl; st.ssa += own.ssa;
    st.tl += own.tl; st.ta += own.ta; st.sa += own.sa;
    st.window.unshift({ oppSsl: opp.ssl, oppSsa: opp.ssa, oppTl: opp.tl, oppTa: opp.ta, sec: own.t });
    st.results.unshift(ownRes);
    if (ownRes === 'W') {
      st.wins++;
      if (koTko) st.koTkoWins++;
      else if (sub) st.subWins++;
    }
  }
  state.set(f.f1.id, s1);
  state.set(f.f2.id, s2);
}

// ---------------------------------------------------------------------------
// Métriques
// ---------------------------------------------------------------------------
function metrics(rows) {
  const n = rows.length;
  if (n === 0) return { n: 0 };
  let correct = 0, brier = 0, logloss = 0;
  for (const r of rows) {
    const y = r.winnerIsF1 ? 1 : 0;
    const p = r.pA / 100;
    if ((r.pA > 50 && y === 1) || (r.pA < 50 && y === 0)) correct++;
    brier += (p - y) ** 2;
    const pc = Math.min(1 - 1e-9, Math.max(1e-9, p));
    logloss += -(y * Math.log(pc) + (1 - y) * Math.log(1 - pc));
  }
  return { n, acc: correct / n, brier: brier / n, logloss: logloss / n };
}

function evaluate(params, rows) {
  const out = [];
  for (const r of rows) {
    if (!r.decided) continue;
    const agg = aggregate(r.dims, params);
    if (!agg) continue;
    out.push({ ...r, pA: agg.pA, confidence: agg.confidence, nDims: agg.nDims });
  }
  return out;
}

function marketMetrics(rows) {
  let correct = 0, brier = 0, logloss = 0, n = 0;
  for (const r of rows) {
    if (!r.odds) continue;
    const y = r.winnerIsF1 ? 1 : 0;
    const p = r.odds.ip1;
    if (Math.abs(p - 0.5) < 1e-9) continue;
    if ((p > 0.5 && y === 1) || (p < 0.5 && y === 0)) correct++;
    brier += (p - y) ** 2;
    const pc = Math.min(1 - 1e-9, Math.max(1e-9, p));
    logloss += -(y * Math.log(pc) + (1 - y) * Math.log(1 - pc));
    n++;
  }
  return { n, acc: n ? correct / n : null, brier: n ? brier / n : null, logloss: n ? logloss / n : null };
}

const SPLIT_VAL = 2023, SPLIT_TEST = 2025;
const splitOf = (r) => (r.year < SPLIT_VAL ? 'TRAIN' : r.year < SPLIT_TEST ? 'VAL' : 'TEST');

const AS_BUILT = { kLogistic: 2.6, pMin: 25, pMax: 75, weights: DIMENSION_WEIGHTS };

// ---------------------------------------------------------------------------
// Résultats — moteur tel que construit
// ---------------------------------------------------------------------------
const asBuilt = evaluate(AS_BUILT, records);
const bySplit = { TRAIN: [], VAL: [], TEST: [] };
for (const r of asBuilt) bySplit[splitOf(r)].push(r);

console.log('=== VOLTRIX-MMA-V1 TEL QUE CONSTRUIT (K=2.6, bornes [25,75]) ===');
for (const s of ['TRAIN', 'VAL', 'TEST']) {
  const m = metrics(bySplit[s]);
  const mk = marketMetrics(bySplit[s]);
  console.log(
    `${s.padEnd(5)} n=${String(m.n).padStart(5)}  précision=${(m.acc * 100).toFixed(2)}%  Brier=${m.brier.toFixed(4)}  logloss=${m.logloss.toFixed(4)}  | marché (clôture) : n=${mk.n} précision=${(mk.acc * 100).toFixed(2)}% Brier=${mk.brier.toFixed(4)}`
  );
}
// variante 2010+ (sans l'ère « vainqueur d'abord », plus lisible)
const asBuilt2010 = asBuilt.filter((r) => r.year >= 2010);
const m2010 = metrics(asBuilt2010);
console.log(`2010+  n=${m2010.n}  précision=${(m2010.acc * 100).toFixed(2)}%  Brier=${m2010.brier.toFixed(4)}  logloss=${m2010.logloss.toFixed(4)}`);

const decided = records.filter((r) => r.decided);
console.log(`\nCouverture : ${asBuilt.length}/${decided.length} combats décidés prédits (${((asBuilt.length / decided.length) * 100).toFixed(1)} %), ${decided.length - asBuilt.length} refusés (< 3 dimensions)`);

// Calibration symétrisée (chaque combat compté dans les deux orientations)
function calibrationBins(rows) {
  const bins = Array.from({ length: 10 }, (_, i) => ({ lo: i * 10, hi: (i + 1) * 10, n: 0, sum: 0, wins: 0 }));
  for (const r of rows) {
    const y = r.winnerIsF1 ? 1 : 0;
    for (const [p, w] of [[r.pA, y], [100 - r.pA, 1 - y]]) {
      const b = bins[Math.min(9, Math.floor(p / 10))];
      b.n++; b.sum += p; b.wins += w;
    }
  }
  return bins;
}
const bins = calibrationBins(asBuilt);
console.log('\nCalibration symétrisée (probabilité prédite vs fréquence observée) :');
for (const b of bins) if (b.n > 0)
  console.log(`  ${String(b.lo).padStart(2)}-${String(b.hi).padStart(2)} %  n=${String(b.n).padStart(5)}  prédit=${(b.sum / b.n).toFixed(1)} %  observé=${((b.wins / b.n) * 100).toFixed(1)} %`);

// Précision par niveau de confiance de l'app
console.log('\nPrécision par étiquette de confiance de l\'app :');
for (const [label, lo, hi] of [['Limitée (<35)', 0, 35], ['Moyenne (35-60)', 35, 60], ['Bonne (≥60)', 60, 101]]) {
  const rs = asBuilt.filter((r) => r.confidence >= lo && r.confidence < hi);
  if (rs.length) {
    const m = metrics(rs);
    console.log(`  ${label.padEnd(16)} n=${String(m.n).padStart(5)}  précision=${(m.acc * 100).toFixed(2)} %  Brier=${m.brier.toFixed(4)}`);
  }
}

// Désaccord avec le marché
const withOdds = asBuilt.filter((r) => r.odds && Math.abs(r.odds.ip1 - 0.5) > 1e-9);
const disagree = withOdds.filter((r) => Math.sign(r.odds.ip1 - 0.5) !== Math.sign(r.pA - 50));
console.log(`\nDésaccord modèle/marché : ${disagree.length}/${withOdds.length} (${((disagree.length / withOdds.length) * 100).toFixed(1)} %) — précision du modèle sur ces combats : ${(metrics(disagree).acc * 100).toFixed(1)} %`);

// Méthode de victoire (predictMethod du favori, évalué quand le favori gagne)
let methN = 0, methCorrect = 0;
for (const r of asBuilt) {
  const fav = r.pA >= 50 ? r.fa : r.fb;
  const favIsWinner = (r.pA >= 50) === r.winnerIsF1;
  if (!favIsWinner) continue; // on évalue la prédiction de méthode quand le favori gagne
  const pm = predictMethod(fav);
  if (!pm) continue;
  methN++;
  if (pm.label === r.methodClass) methCorrect++;
}
console.log(`Méthode de victoire (quand le favori du modèle gagne) : ${(100 * methCorrect / Math.max(1, methN)).toFixed(1)} % correctes (n=${methN}) — hasard ≈ 45 % (répartition empirique KO/déc/soumission)`);

// ---------------------------------------------------------------------------
// Grille de calibration
// ---------------------------------------------------------------------------
const grid = [];
const kGrid = [2.6, 3.5, 4.5, 6, 8, 10, 12];
const boundsGrid = [[25, 75], [20, 80], [15, 85], [10, 90]];
const formeGrid = [1.0, 1.5, 2.0, 2.5];
for (const k of kGrid)
  for (const [pMin, pMax] of boundsGrid)
    for (const wf of formeGrid) {
      const params = { kLogistic: k, pMin, pMax, weights: { ...DIMENSION_WEIGHTS, forme: wf } };
      grid.push({
        params,
        train: metrics(evaluate(params, records.filter((r) => r.year < SPLIT_VAL))),
        val: metrics(evaluate(params, records.filter((r) => r.year >= SPLIT_VAL && r.year < SPLIT_TEST))),
      });
    }
grid.sort((a, b) => a.val.logloss - b.val.logloss);
console.log('\n=== GRILLE DE CALIBRATION — top 10 par log-loss VALIDATION ===');
for (const g of grid.slice(0, 10))
  console.log(`  K=${String(g.params.kLogistic).padStart(4)} bornes=[${g.params.pMin},${g.params.pMax}] wForme=${g.params.weights.forme}  TRAIN ll=${g.train.logloss.toFixed(4)} acc=${(g.train.acc * 100).toFixed(2)} %  VAL ll=${g.val.logloss.toFixed(4)} acc=${(g.val.acc * 100).toFixed(2)} %`);

const best = grid[0];
const testBest = metrics(evaluate(best.params, records.filter((r) => r.year >= SPLIT_TEST)));
const testBuilt = metrics(bySplit.TEST);
console.log(`\nMeilleure config, TEST 2025-26 : n=${testBest.n} précision=${(testBest.acc * 100).toFixed(2)} % (as-built ${(testBuilt.acc * 100).toFixed(2)} %) Brier=${testBest.brier.toFixed(4)} (as-built ${testBuilt.brier.toFixed(4)}) logloss=${testBest.logloss.toFixed(4)} (as-built ${testBuilt.logloss.toFixed(4)})`);

// Calibration symétrisée de la meilleure config (pour vérifier la correction)
const bestRows = evaluate(best.params, records);
const bestBins = calibrationBins(bestRows.filter((r) => r.year >= SPLIT_TEST));
console.log('\nCalibration symétrisée TEST de la meilleure config :');
for (const b of bestBins) if (b.n > 0)
  console.log(`  ${String(b.lo).padStart(2)}-${String(b.hi).padStart(2)} %  n=${String(b.n).padStart(4)}  prédit=${(b.sum / b.n).toFixed(1)} %  observé=${((b.wins / b.n) * 100).toFixed(1)} %`);

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------
const yearRows = Object.entries(
  asBuilt.reduce((acc, r) => ((acc[r.year] ??= []).push(r), acc), {})
).map(([y, rs]) => ({ year: +y, ...metrics(rs) })).sort((a, b) => a.year - b.year);

writeFileSync(new URL('./replay_results.json', import.meta.url), JSON.stringify({
  model: 'voltrix-mma-v1 (portage fidèle)',
  dataset: 'DanMcInerney/mma-ai — 7 704 combats UFC 1998-2026, stats brutes ufcstats, cotes BestFightOdds',
  caveats: [
    'avant 2010 le dataset liste le vainqueur en fighter1 (vérifié) — issues correctes, moteur symétrique donc métriques valides',
    'moyennes carrière dérivées du seul historique UFC du dataset (ESPN = UFC-only aussi)',
    'la forme ESPN peut inclure des combats pré-UFC absents du dataset (écart mineur)',
  ],
  splits: { TRAIN: '<2023', VAL: '2023-24', TEST: '2025-26' },
  asBuilt: { TRAIN: metrics(bySplit.TRAIN), VAL: metrics(bySplit.VAL), TEST: metrics(bySplit.TEST), since2010: m2010 },
  market: { TRAIN: marketMetrics(bySplit.TRAIN), VAL: marketMetrics(bySplit.VAL), TEST: marketMetrics(bySplit.TEST) },
  coverage: { predicted: asBuilt.length, decided: decided.length, refused: decided.length - asBuilt.length },
  byYear: yearRows,
  calibrationSym: bins.map((b) => ({ ...b, avgPred: b.n ? b.sum / b.n : null })),
  confidenceBuckets: [
    ['Limitée', asBuilt.filter((r) => r.confidence < 35)],
    ['Moyenne', asBuilt.filter((r) => r.confidence >= 35 && r.confidence < 60)],
    ['Bonne', asBuilt.filter((r) => r.confidence >= 60)],
  ].map(([label, rs]) => ({ label, ...metrics(rs) })),
  marketDisagreement: { n: disagree.length, total: withOdds.length, modelAccOnDisagree: metrics(disagree).acc },
  methodPrediction: { n: methN, acc: methCorrect / Math.max(1, methN) },
  gridTop: grid.slice(0, 10).map((g) => ({ ...g.params, weights: undefined, forme: g.params.weights.forme, train: g.train, val: g.val })),
  best: { ...best.params, weights: undefined, forme: best.params.weights.forme, test: testBest },
  rows: asBuilt.map((r) => ({
    id: r.id, date: r.date, year: r.year, split: splitOf(r),
    f1: r.n1, f2: r.n2, winnerIsF1: r.winnerIsF1,
    pA: +r.pA.toFixed(2), confidence: +r.confidence.toFixed(1), nDims: r.nDims,
    method: r.method, methodClass: r.methodClass, endRound: r.endRound,
    marketIp1: r.odds ? +r.odds.ip1.toFixed(4) : null,
  })),
}, null, 1));
console.log('\n→ replay_results.json');
