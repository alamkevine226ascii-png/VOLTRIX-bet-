// ============================================================
// Audit 19-a — Script 4 : Matrice Poisson des scores exacts
// poissonModel (prediction.ts L387-432) — coins, sommes, O/U, BTTS,
// top scores, biais de troncature 0..8
// bun scripts/audit-19-a-4-poisson.ts
// ============================================================

import { poissonModel } from '../src/lib/prediction';

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    passed++;
    console.log(`  PASS ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failed++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

// PMF Poisson indépendante (référence haute précision via lgamma approx non nécessaire :
// k ≤ 200, factorielle directe OK en double jusqu'à ~170! ; on utilise la récurrence)
function pmfRef(lambda: number, k: number): number {
  // récurrence stable : p0 = e^-λ ; p_k = p_{k-1}·λ/k
  let p = Math.exp(-lambda);
  for (let i = 1; i <= k; i++) p = (p * lambda) / i;
  return p;
}
// Vraie loi 1X2 / totals / BTTS sans troncature (k jusqu'à 400)
function trueModel(lh: number, la: number) {
  let h = 0, d = 0, a = 0, btts = 0;
  const tot: number[] = new Array(801).fill(0);
  for (let i = 0; i <= 400; i++) {
    const pi = pmfRef(lh, i);
    if (pi < 1e-18 && i > lh * 2) break;
    for (let j = 0; j <= 400; j++) {
      const pj = pmfRef(la, j);
      if (pj < 1e-18 && j > la * 2) break;
      const p = pi * pj;
      if (i > j) h += p; else if (i === j) d += p; else a += p;
      if (i > 0 && j > 0) btts += p;
      if (i + j <= 800) tot[i + j] += p;
    }
  }
  const over = (line: number) => tot.reduce((s, v, k) => (k > line ? s + v : s), 0);
  return { h, d, a, btts, over15: over(1.5), over25: over(2.5), over35: over(3.5) };
}

console.log('\n=== 1. Grille de coins : λh ∈ {0.25..4.2} × λa ∈ {0.2..4.2} (100 combos) ===');
const lhGrid = [0.25, 0.5, 0.8, 1.0, 1.35, 1.6, 2.0, 2.5, 3.0, 4.2];
const laGrid = [0.2, 0.5, 0.8, 1.0, 1.15, 1.6, 2.0, 2.5, 3.5, 4.2];

let sumOK = true;
let ouOK = true;
let bttsOK = true;
let bttsCoherent = true;
let topOK = true;
let worstTrunc1x2 = 0;
let worstTruncOU = 0;
let worstPair = '';
let worstOUPair = '';
let minMatrixMass = 1;
for (const lh of lhGrid) {
  for (const la of laGrid) {
    const m = poissonModel(lh, la);
    // 1X2 renormalisé → somme 1
    const s = m.probs.home + m.probs.draw + m.probs.away;
    if (Math.abs(s - 1) > 1e-9) sumOK = false;
    // O/U : over + under = 1 (arrondis 4dp)
    for (const o of m.overUnder) {
      if (Math.abs(o.over + o.under - 1) > 2.1e-4) ouOK = false;
      if (o.over <= 0 || o.over >= 1) ouOK = false;
    }
    if (m.overUnder[0].over < m.overUnder[1].over || m.overUnder[1].over < m.overUnder[2].over) ouOK = false;
    // BTTS
    if (Math.abs(m.btts.yes + m.btts.no - 1) > 2.1e-4) bttsOK = false;
    if (m.btts.yes > m.overUnder[0].over + 2e-4) bttsCoherent = false; // BTTS ≤ Over 1.5
    // top scores
    if (m.topScores.length !== 3) topOK = false;
    for (let i = 1; i < m.topScores.length; i++) {
      if (m.topScores[i].prob > m.topScores[i - 1].prob) topOK = false;
    }
    // Comparaison vraie loi non tronquée
    const t = trueModel(lh, la);
    const trunc1x2 = Math.max(
      Math.abs(m.probs.home - t.h),
      Math.abs(m.probs.draw - t.d),
      Math.abs(m.probs.away - t.a)
    );
    if (trunc1x2 > worstTrunc1x2) { worstTrunc1x2 = trunc1x2; worstPair = `λh=${lh} λa=${la}`; }
    const mOU35 = m.overUnder.find((o) => o.line === 3.5)!;
    const truncOU = Math.abs(mOU35.over - t.over35);
    if (truncOU > worstTruncOU) { worstTruncOU = truncOU; worstOUPair = `λh=${lh} λa=${la} (modèle ${(mOU35.over * 100).toFixed(2)}% vs vrai ${(t.over35 * 100).toFixed(2)}%)`; }
    // masse de la matrice 0..8 (2 axes)
    const mass = (s === 0 ? 0 : 1) * m.probs.home + 0; // placeholder — recalcul ci-dessous
    void mass;
    let mHome = 0, mDraw = 0, mAway = 0;
    for (let i = 0; i <= 8; i++) for (let j = 0; j <= 8; j++) {
      const p = pmfRef(lh, i) * pmfRef(la, j);
      if (i > j) mHome += p; else if (i === j) mDraw += p; else mAway += p;
    }
    minMatrixMass = Math.min(minMatrixMass, mHome + mDraw + mAway);
  }
}
check('1X2 somme = 1 sur toute la grille', sumOK);
check('O/U : over+under = 1 ± 2e-4, décroissance en ligne, bornes (0,1)', ouOK);
check('BTTS : yes+no = 1 ± 2e-4', bttsOK);
check('BTTS ≤ Over 1.5 (cohérence structurelle)', bttsCoherent);
check('topScores : 3 scores triés desc', topOK);
console.log(`  pire biais 1X2 vs loi non tronquée : ${(worstTrunc1x2 * 100).toFixed(2)} pts (${worstPair})`);
console.log(`  pire biais Over 3.5 vs vrai : ${(worstTruncOU * 100).toFixed(2)} pts (${worstOUPair})`);
console.log(`  masse matrice 0..8 min sur grille : ${(minMatrixMass * 100).toFixed(2)}% (λ=4.2/4.2 attendu ≈ 94.5%)`);
check('biais 1X2 de troncature ≤ 1.5 pt (renormalisation efficace)', worstTrunc1x2 <= 0.015, `max=${(worstTrunc1x2 * 100).toFixed(2)} pts`);
check('biais Over 3.5 de troncature ≤ 1.2 pt (renormalisation efficace)', worstTruncOU <= 0.012, `max=${(worstTruncOU * 100).toFixed(2)} pts`);
check('masse matrice min ≈ 94.4% (pas de perte massive)', minMatrixMass > 0.93 && minMatrixMass < 0.96);

console.log('\n=== 2. Cornes exactes de la matrice ===');
const corner1 = poissonModel(0.25, 0.2);
console.log(`  coin bas (0.25/0.2) : 1X2=${(corner1.probs.home * 100).toFixed(1)}/${(corner1.probs.draw * 100).toFixed(1)}/${(corner1.probs.away * 100).toFixed(1)} O2.5=${(corner1.overUnder[1].over * 100).toFixed(1)}% BTTS=${(corner1.btts.yes * 100).toFixed(1)}%`);
check('coin bas : 0-0 score le plus probable', corner1.topScores[0].score === '0-0', corner1.topScores[0].score);
check('coin bas : Over 2.5 faible', corner1.overUnder[1].over < 0.12, `${(corner1.overUnder[1].over * 100).toFixed(1)}%`);
const corner2 = poissonModel(4.2, 4.2);
console.log(`  coin haut (4.2/4.2) : 1X2=${(corner2.probs.home * 100).toFixed(1)}/${(corner2.probs.draw * 100).toFixed(1)}/${(corner2.probs.away * 100).toFixed(1)} O2.5=${(corner2.overUnder[1].over * 100).toFixed(1)}% BTTS=${(corner2.btts.yes * 100).toFixed(1)}%`);
check('coin haut : Over 2.5 > 75%', corner2.overUnder[1].over > 0.75, `${(corner2.overUnder[1].over * 100).toFixed(1)}%`);
check('coin haut : BTTS > 85%', corner2.btts.yes > 0.85, `${(corner2.btts.yes * 100).toFixed(1)}%`);
const corner3 = poissonModel(4.2, 0.2);
check('asymétrie forte : home > 85%, away < 5%', corner3.probs.home > 0.85 && corner3.probs.away < 0.05, `${(corner3.probs.home * 100).toFixed(1)}/${(corner3.probs.away * 100).toFixed(1)}`);

console.log('\n=== 3. Calibration O/U depuis la matrice (indépendance ligne) ===');
const m = poissonModel(1.5, 1.2);
const t = trueModel(1.5, 1.2);
console.log(`  λ=1.5/1.2 : O1.5 mod=${(m.overUnder[0].over * 100).toFixed(2)}% vrai=${(t.over15 * 100).toFixed(2)}% | O2.5 mod=${(m.overUnder[1].over * 100).toFixed(2)}% vrai=${(t.over25 * 100).toFixed(2)}% | O3.5 mod=${(m.overUnder[2].over * 100).toFixed(2)}% vrai=${(t.over35 * 100).toFixed(2)}%`);
check('calibration O/U fidèle au Poisson vrai (≤ 0.5 pt à λ modérés)',
  Math.abs(m.overUnder[0].over - t.over15) < 0.005 &&
  Math.abs(m.overUnder[1].over - t.over25) < 0.005 &&
  Math.abs(m.overUnder[2].over - t.over35) < 0.005);

console.log('\n=== 4. Poisson pmf du moteur vs référence (récurrence) ===');
// (transcription de poissonPmf L137-141 pour vérifier l'exactitude numérique)
function pmfEngine(lambda: number, k: number): number {
  let fact = 1;
  for (let i = 2; i <= k; i++) fact *= i;
  return (Math.exp(-lambda) * Math.pow(lambda, k)) / fact;
}
let pmfOK = true;
let worstPmf = 0;
for (const lam of [0.25, 1.0, 2.5, 4.2, 8.4]) {
  for (let k = 0; k <= 20; k++) {
    const diff = Math.abs(pmfEngine(lam, k) - pmfRef(lam, k));
    if (diff > worstPmf) worstPmf = diff;
    if (diff > 1e-12) pmfOK = false;
  }
}
check('pmf du moteur == référence récursive (k≤20, λ≤8.4)', pmfOK, `écart max=${worstPmf.toExponential(2)}`);

console.log(`\n===== SCRIPT 4 (matrice Poisson) : ${passed} PASS / ${failed} FAIL =====`);
if (failed > 0) process.exit(1);
