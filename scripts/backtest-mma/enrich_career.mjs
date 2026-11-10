#!/usr/bin/env node
/**
 * N°4 — complément : variantes CARRIÈRE et PARTS de style des candidates.
 * Objectif : déterminer si le signal existe sous une autre formulation
 * avant de conclure sur l'enrichissement dimensionnel.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const lines = readFileSync(new URL('./fights.jsonl', import.meta.url), 'utf8')
  .split('\n')
  .filter(Boolean);
const fights = lines.map((l) => JSON.parse(l));

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

// Variantes carrière : agrégats sur TOUS les combats antérieurs
// Variantes part : gl/ssl, ctrl/sec (indicateurs de style)
const CAREER_CANDIDATES = {
  'car-sol-frappes': { label: 'Frappes sol / min (carrière)', fn: (c) => (c.min > 0 ? c.gl / c.min : null), epsilon: 1.5, floor: 0.2, weights: [0.6, 0.8, 1.0] },
  'car-kd': { label: 'KD / 15 min (carrière)', fn: (c) => (c.min > 0 ? (15 * c.kd) / c.min : null), epsilon: 0.6, floor: 0.05, weights: [0.6, 0.8, 1.0] },
  'car-ctrl': { label: 'Contrôle / min (carrière)', fn: (c) => (c.min > 0 ? c.ctrl / c.min : null), epsilon: 1.5, floor: 0.3, weights: [0.6, 0.8, 1.0] },
  'car-tete': { label: 'Frappes tête / min (carrière)', fn: (c) => (c.min > 0 ? c.hl / c.min : null), epsilon: 2.5, floor: 0, weights: [0.6, 0.8, 1.0] },
  'car-part-sol': { label: 'Part des frappes au sol (carrière)', fn: (c) => (c.ssl > 0 ? (100 * c.gl) / c.ssl : null), epsilon: 30, floor: 5, weights: [0.6, 0.8] },
  'car-part-ctrl': { label: 'Part de temps de contrôle (carrière)', fn: (c) => (c.min > 0 ? (100 * c.ctrl) / (60 * c.min) : null), epsilon: 25, floor: 5, weights: [0.6, 0.8] },
};

function emptyState() {
  return {
    fights: 0, wins: 0, koTkoWins: 0, subWins: 0,
    sec: 0, ssl: 0, ssa: 0, tl: 0, ta: 0, sa: 0,
    kd: 0, ctrl: 0, hl: 0, gl: 0,
    window: [], results: [],
  };
}

function snapshot(st, reachInches) {
  const min = st.sec / 60;
  const career =
    st.fights === 0
      ? null
      : {
          min, kd: st.kd, ctrl: st.ctrl, hl: st.hl, gl: st.gl,
          slpM: st.sec > 0 ? st.ssl / min : null,
          sigAcc: st.ssa > 0 ? (st.ssl / st.ssa) * 100 : null,
          td15: st.sec > 0 ? (st.tl / min) * 15 : null,
          sub15: st.sec > 0 ? (st.sa / min) * 15 : null,
          koTkoPct: (st.koTkoWins / st.fights) * 100,
        };
  let derived = null;
  const win = st.window.slice(0, DERIVED_WINDOW);
  if (win.length > 0) {
    let oppSsl = 0, oppSsa = 0, oppTl = 0, oppTa = 0, sec = 0;
    for (const w of win) {
      oppSsl += w.oppSsl; oppSsa += w.oppSsa; oppTl += w.oppTl; oppTa += w.oppTa; sec += w.sec;
    }
    if (sec > 0)
      derived = {
        sapm: oppSsl / (sec / 60),
        sigDef: oppSsa > 0 ? (1 - oppSsl / oppSsa) * 100 : null,
        tdd: oppTa > 0 ? (1 - oppTl / oppTa) * 100 : null,
      };
  }
  return {
    career, derived,
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

function aggregate(dims, weights, kLogistic = 2.6, pMin = 25, pMax = 75) {
  const usable = dims.filter((d) => d.available && d.scoreA != null && (weights[d.key] ?? 0) > 0);
  if (usable.length < 3) return null;
  let wa = 0, tw = 0;
  for (const d of usable) {
    wa += weights[d.key] * (d.scoreA - 50);
    tw += weights[d.key];
  }
  const norm = wa / (tw * 50);
  return Math.min(pMax, Math.max(pMin, (1 / (1 + Math.exp(-kLogistic * norm))) * 100));
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

  if (f.res === 0 || f.res === 1)
    records.push({ year: Number(f.d.slice(0, 4)), winnerIsF1: f.res === 1, fa, fb, dims: baseDims(fa, fb) });

  for (const [st, own, opp, ownRes] of [
    [s1, f.s1, f.s2, r1],
    [s2, f.s2, f.s1, r2],
  ]) {
    st.fights++;
    st.sec += own.t; st.ssl += own.ssl; st.ssa += own.ssa;
    st.tl += own.tl; st.ta += own.ta; st.sa += own.sa;
    st.kd += own.kd; st.ctrl += own.ctrl; st.hl += own.hl; st.gl += own.gl;
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

const VAL = records.filter((r) => r.year >= 2023 && r.year < 2025);
const TEST = records.filter((r) => r.year >= 2025);

function evalConfig(extraKey, w, c) {
  const weights = { ...BASE_WEIGHTS, [extraKey]: w };
  const run = (rows) => {
    const out = [];
    for (const r of rows) {
      const dims = [...r.dims];
      const va = r.fa.career ? c.fn(r.fa.career) : null;
      const vb = r.fb.career ? c.fn(r.fb.career) : null;
      const e = edge(va, vb, false, c.epsilon, c.floor);
      dims.push({ key: extraKey, scoreA: e.scoreA, scoreB: e.scoreB, available: e.advantage !== null });
      const pA = aggregate(dims, weights);
      if (pA != null) out.push({ ...r, pA });
    }
    return out;
  };
  return { val: metrics(run(VAL)), test: metrics(run(TEST)) };
}

const baseRun = (rows) => {
  const out = [];
  for (const r of rows) {
    const pA = aggregate(r.dims, BASE_WEIGHTS);
    if (pA != null) out.push({ ...r, pA });
  }
  return out;
};
const base = { val: metrics(baseRun(VAL)), test: metrics(baseRun(TEST)) };
console.log('=== BASELINE 11 dimensions ===');
console.log(`  VAL  ll=${base.val.logloss.toFixed(4)} acc=${(base.val.acc * 100).toFixed(2)}%`);
console.log(`  TEST ll=${base.test.logloss.toFixed(4)} acc=${(base.test.acc * 100).toFixed(2)}%`);

console.log('\n=== VARIANTES CARRIÈRE / PARTS ===');
const out = [];
for (const [key, c] of Object.entries(CAREER_CANDIDATES)) {
  for (const w of c.weights) {
    const r = evalConfig(key, w, c);
    out.push({ key, w, ...r });
    const dv = r.val.logloss - base.val.logloss;
    const dt = r.test.logloss - base.test.logloss;
    console.log(
      `  ${key.padEnd(16)} w=${w}  VAL ll=${r.val.logloss.toFixed(4)} (${dv >= 0 ? '+' : ''}${dv.toFixed(4)}) acc=${(r.val.acc * 100).toFixed(2)}%  |  TEST ll=${r.test.logloss.toFixed(4)} (${dt >= 0 ? '+' : ''}${dt.toFixed(4)}) acc=${(r.test.acc * 100).toFixed(2)}%`
    );
  }
}
writeFileSync(new URL('./enrich_career_results.json', import.meta.url), JSON.stringify({ baseline: base, candidates: out }, null, 1));
console.log('\n→ enrich_career_results.json');
