#!/usr/bin/env node
/**
 * IMPLÉMENTATION N°4 — Enrichissement dimensionnel MMA.
 * Teste des dimensions candidates (cibles, positions, knockdowns, contrôle)
 * sur le harnais de backtest, SÉLECTION sur validation 2023-24,
 * CONFIRMATION sur test 2025-26.
 *
 * Les candidates sont calculées sur la fenêtre de 8 derniers combats
 * (stats propres du combattant) — exactement ce que l'app peut obtenir
 * via getFightStatsFor étendu aux champs cibles/positions.
 *
 * Usage : node enrich.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';

const lines = readFileSync(new URL('./fights.jsonl', import.meta.url), 'utf8')
  .split('\n')
  .filter(Boolean);
const fights = lines.map((l) => JSON.parse(l));

// ---------------------------------------------------------------------------
// Moteur (identique à replay.mjs)
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
  if (floor > 0 && Math.max(a, b) < floor) return { scoreA: null, scoreB: null, advantage: null };
  if (a === 0 && b === 0) return { scoreA: 50, scoreB: 50, advantage: '=' };
  const [x, y] = lowerBetter ? [b, a] : [a, b];
  const denom = x + y + epsilon;
  const shareX = denom <= 0 ? 50 : 50 + (50 * (x - y)) / denom;
  const scoreA = lowerBetter ? 100 - shareX : shareX;
  const scoreB = 100 - scoreA;
  const advantage = Math.abs(scoreA - scoreB) < 6 ? '=' : scoreA > scoreB ? 'A' : 'B';
  return { scoreA, scoreB, advantage };
}

const KO_METHODS = new Set(['KO/TKO', "TKO - Doctor's Stoppage", 'Could Not Continue']);

const BASE_WEIGHTS = {
  forme: 1.5, volume: 1.2, precision: 1.2, absorption: 1.2,
  'defense-frappes': 1.0, lutte: 1.0, 'defense-takedown': 1.0,
  sol: 0.8, puissance: 1.0, experience: 0.8, physique: 0.6,
};
const CORE_DIMENSIONS = ['forme', 'volume', 'precision', 'absorption', 'lutte', 'puissance'];

/** Dimensions candidates — clé, fonction feature, ε, floor, poids par défaut. */
const CANDIDATES = {
  'frappes-tete': {
    label: 'Frappes à la tête (fenêtre 8 combats)',
    fn: (w) => (w.sec > 0 ? w.hl / (w.sec / 60) : null),
    epsilon: 2.5, floor: 0, weights: [0.6, 0.8, 1.0],
  },
  'sol-frappes': {
    label: 'Frappes au sol (fenêtre 8 combats)',
    fn: (w) => (w.sec > 0 ? w.gl / (w.sec / 60) : null),
    epsilon: 1.5, floor: 0.2, weights: [0.6, 0.8, 1.0],
  },
  'cibles-bas': {
    label: 'Frappes corps+jambes (fenêtre 8 combats)',
    fn: (w) => (w.sec > 0 ? (w.bl + w.ll) / (w.sec / 60) : null),
    epsilon: 1.5, floor: 0.2, weights: [0.6, 0.8],
  },
  'clinch': {
    label: 'Volume en clinch (fenêtre 8 combats)',
    fn: (w) => (w.sec > 0 ? w.cl / (w.sec / 60) : null),
    epsilon: 1.0, floor: 0.15, weights: [0.6, 0.8],
  },
  'distance-volume': {
    label: 'Volume à distance (fenêtre 8 combats)',
    fn: (w) => (w.sec > 0 ? w.dl / (w.sec / 60) : null),
    epsilon: 2.5, floor: 0, weights: [0.6, 0.8],
  },
  'knockdowns': {
    label: 'Knockdowns / 15 min (fenêtre 8 combats)',
    fn: (w) => (w.sec > 0 ? (15 * w.kd) / (w.sec / 60) : null),
    epsilon: 0.6, floor: 0.05, weights: [0.6, 0.8, 1.0],
  },
  'controle': {
    label: 'Temps de contrôle / min de combat (fenêtre 8 combats)',
    fn: (w) => (w.sec > 0 ? w.ctrl / (w.sec / 60) : null),
    epsilon: 1.5, floor: 0.3, weights: [0.6, 0.8, 1.0],
  },
};

// ---------------------------------------------------------------------------
// Passe 1 — états séquentiels avec agrégats de fenêtre étendus
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
  let own = null;
  if (win.length > 0) {
    let oppSsl = 0, oppSsa = 0, oppTl = 0, oppTa = 0, sec = 0;
    let kd = 0, ctrl = 0, hl = 0, bl = 0, ll = 0, dl = 0, cl = 0, gl = 0;
    for (const w of win) {
      oppSsl += w.oppSsl; oppSsa += w.oppSsa; oppTl += w.oppTl; oppTa += w.oppTa;
      sec += w.sec;
      kd += w.ownKd; ctrl += w.ownCtrl;
      hl += w.ownHl; bl += w.ownBl; ll += w.ownLl;
      dl += w.ownDl; cl += w.ownCl; gl += w.ownGl;
    }
    if (sec > 0) {
      derived = {
        sapm: oppSsl / (sec / 60),
        sigDef: oppSsa > 0 ? (1 - oppSsl / oppSsa) * 100 : null,
        tdd: oppTa > 0 ? (1 - oppTl / oppTa) * 100 : null,
      };
      own = { sec, kd, ctrl, hl, bl, ll, dl, cl, gl };
    }
  }
  return {
    career, derived, own,
    forme: st.results.length ? formScore(st.results.join(',')) : null,
    totalFights: st.fights,
    reachCm: reachInches != null ? reachInches * 2.54 : null,
  };
}

function baseDims(fa, fb) {
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

/** Ajoute les dimensions candidates actives à la liste. */
function enrichDims(dims, fa, fb, active) {
  for (const key of active) {
    const c = CANDIDATES[key];
    if (!c) continue;
    const va = fa.own ? c.fn(fa.own) : null;
    const vb = fb.own ? c.fn(fb.own) : null;
    const e = edge(va, vb, false, c.epsilon, c.floor);
    dims.push({ key, scoreA: e.scoreA, scoreB: e.scoreB, available: e.advantage !== null });
  }
  return dims;
}

function aggregate(dims, weights, kLogistic = 2.6, pMin = 25, pMax = 75) {
  const usable = dims.filter((d) => d.available && d.scoreA != null && (weights[d.key] ?? 0) > 0);
  if (usable.length < 3) return null;
  let wa = 0, tw = 0;
  for (const d of usable) {
    wa += weights[d.key] * (d.scoreA - 50);
    tw += weights[d.key];
  }
  const norm = wa / (tw * 50);
  const rawP = 1 / (1 + Math.exp(-kLogistic * norm));
  return Math.min(pMax, Math.max(pMin, rawP * 100));
}

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

// ---------------------------------------------------------------------------
// Rejeu
// ---------------------------------------------------------------------------
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

  if (f.res === 0 || f.res === 1) {
    records.push({
      year: Number(f.d.slice(0, 4)),
      winnerIsF1: f.res === 1,
      fa, fb,
      dims: baseDims(fa, fb),
    });
  }

  for (const [st, own, opp, ownRes] of [
    [s1, f.s1, f.s2, r1],
    [s2, f.s2, f.s1, r2],
  ]) {
    st.fights++;
    st.sec += own.t; st.ssl += own.ssl; st.ssa += own.ssa;
    st.tl += own.tl; st.ta += own.ta; st.sa += own.sa;
    st.window.unshift({
      oppSsl: opp.ssl, oppSsa: opp.ssa, oppTl: opp.tl, oppTa: opp.ta, sec: own.t,
      ownKd: own.kd, ownCtrl: own.ctrl,
      ownHl: own.hl, ownBl: own.bl, ownLl: own.ll,
      ownDl: own.dl, ownCl: own.cl, ownGl: own.gl,
    });
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
// Évaluation
// ---------------------------------------------------------------------------
const VAL = records.filter((r) => r.year >= 2023 && r.year < 2025);
const TEST = records.filter((r) => r.year >= 2025);

function evalConfig(active, extraWeights) {
  const weights = { ...BASE_WEIGHTS, ...extraWeights };
  const run = (rows) => {
    const out = [];
    for (const r of rows) {
      const dims = active.length ? enrichDims([...r.dims], r.fa, r.fb, active) : r.dims;
      const pA = aggregate(dims, weights);
      if (pA != null) out.push({ ...r, pA });
    }
    return out;
  };
  return { val: metrics(run(VAL)), test: metrics(run(TEST)) };
}

// Baseline : les 11 dimensions actuelles
const base = evalConfig([], {});
console.log('=== BASELINE voltrix-mma-v1 (11 dimensions) ===');
console.log(`  VAL  n=${base.val.n}  acc=${(base.val.acc * 100).toFixed(2)}%  ll=${base.val.logloss.toFixed(4)}`);
console.log(`  TEST n=${base.test.n} acc=${(base.test.acc * 100).toFixed(2)}%  ll=${base.test.logloss.toFixed(4)}`);

// Chaque candidate × grille de poids
console.log('\n=== CANDIDATES (ajoutées une à une aux 11) ===');
console.log('(seuil de bruit VAL : ±0,004 logloss / ±1,9 pt précision)');
const results = [];
for (const [key, c] of Object.entries(CANDIDATES)) {
  for (const w of c.weights) {
    const r = evalConfig([key], { [key]: w });
    results.push({ key, w, ...r });
    console.log(
      `  ${key.padEnd(16)} w=${w}  VAL ll=${r.val.logloss.toFixed(4)} (${(100 * (r.val.logloss - base.val.logloss)).toFixed(+3) >= 0 ? '+' : ''}${(r.val.logloss - base.val.logloss).toFixed(4)}) acc=${(r.val.acc * 100).toFixed(2)}%  |  TEST ll=${r.test.logloss.toFixed(4)} (${(r.test.logloss - base.test.logloss >= 0 ? '+' : '')}${(r.test.logloss - base.test.logloss).toFixed(4)}) acc=${(r.test.acc * 100).toFixed(2)}%`
    );
  }
}

// Meilleures candidates (VAL logloss < baseline) → combinaisons
const bestSolo = results
  .filter((r) => r.val.logloss < base.val.logloss)
  .sort((a, b) => a.val.logloss - b.val.logloss);
console.log(`\nCandidates battant la baseline en VAL : ${bestSolo.map((r) => `${r.key}(w=${r.w})`).join(', ') || 'aucune'}`);

if (bestSolo.length >= 1) {
  // essayer toutes les combinaisons des candidates utiles (max 3)
  const keys = [...new Set(bestSolo.map((r) => r.key))].slice(0, 4);
  const combos = [];
  const n = keys.length;
  for (let mask = 1; mask < 2 ** n; mask++) {
    const sel = keys.filter((_, i) => mask & (1 << i));
    if (sel.length > 3) continue;
    // poids = meilleur poids solo de chaque candidate
    const extraWeights = Object.fromEntries(
      sel.map((k) => {
        const best = results.filter((r) => r.key === k).sort((a, b) => a.val.logloss - b.val.logloss)[0];
        return [k, best.w];
      })
    );
    const r = evalConfig(sel, extraWeights);
    combos.push({ sel, extraWeights, ...r });
  }
  combos.sort((a, b) => a.val.logloss - b.val.logloss);
  console.log('\n=== MEILLEURES COMBINAISONS (sélection VAL) ===');
  for (const c of combos.slice(0, 6)) {
    console.log(
      `  [${c.sel.join(' + ')}]  VAL ll=${c.val.logloss.toFixed(4)} acc=${(c.val.acc * 100).toFixed(2)}%  |  TEST ll=${c.test.logloss.toFixed(4)} acc=${(c.test.acc * 100).toFixed(2)}% (baseline ${(base.test.acc * 100).toFixed(2)}%)`
    );
  }
  writeFileSync(new URL('./enrich_results.json', import.meta.url), JSON.stringify({
    baseline: { val: base.val, test: base.test },
    candidates: results,
    combos: combos.slice(0, 10),
  }, null, 1));
  console.log('\n→ enrich_results.json');
}
