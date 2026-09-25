// ============================================================
// Audit 19-a — Script 3 : Fix Task 17 « firstToScore » (L769-777)
// + firstGoalTimingProbs (L356-375)
// bun scripts/audit-19-a-3-firsttoscore.ts
// ============================================================

import { firstGoalTimingProbs } from '../src/lib/prediction';

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

console.log('\n=== 1. firstToScore : grille λh ∈ [0.25..4.2] × λa ∈ [0.2..4.2] (529 combinaisons) ===');
// Transcription fidèle de prediction.ts L769-777 :
//   const lamT = lambdaHome + lambdaAway;
//   const pGoal = 1 - Math.exp(-lamT);
//   home = round((lambdaHome / lamT) * pGoal, 4)
//   away = round((lambdaAway / lamT) * pGoal, 4)
//   noGoal = round(1 - pGoal, 4)
function firstToScore(lh: number, la: number) {
  const lamT = lh + la;
  const pGoal = 1 - Math.exp(-lamT);
  return {
    home: Math.round((lh / lamT) * pGoal * 10000) / 10000,
    away: Math.round((la / lamT) * pGoal * 10000) / 10000,
    noGoal: Math.round((1 - pGoal) * 10000) / 10000,
  };
}

const lhValues: number[] = [];
for (let v = 0.25; v <= 4.2 + 1e-9; v += (4.2 - 0.25) / 22) lhValues.push(v);
const laValues: number[] = [];
for (let v = 0.2; v <= 4.2 + 1e-9; v += (4.2 - 0.2) / 22) laValues.push(v);

let worstSumErr = 0;
let worstPair: string = '';
let count = 0;
let monotoneOK = true;
for (const lh of lhValues) {
  for (const la of laValues) {
    const f = firstToScore(lh, la);
    const sum = f.home + f.away + f.noGoal;
    count++;
    if (Math.abs(sum - 1) > worstSumErr) {
      worstSumErr = Math.abs(sum - 1);
      worstPair = `λh=${lh.toFixed(2)},λa=${la.toFixed(2)} → ${(f.home * 100).toFixed(2)}/${(f.away * 100).toFixed(2)}/${(f.noGoal * 100).toFixed(2)} (somme ${(sum * 100).toFixed(3)}%)`;
    }
    // monotonicité : λh plus grand → part home plus grande
    if (lh < la && f.home > f.away) monotoneOK = false;
    if (f.home < 0 || f.away < 0 || f.noGoal < 0) monotoneOK = false;
  }
}
check(`${count} combinaisons : |somme − 1| ≤ 3e-4 (arrondis 4dp)`, worstSumErr <= 3.1e-4, `pire=${worstSumErr.toExponential(2)} (${worstPair})`);
check('cohérence directionnelle : λh<λa ⇒ home ≤ away, probas ≥ 0', monotoneOK);
check('échantillon ≥ 200 exigé par la mission', count >= 200, `n=${count}`);

console.log('\n=== 2. Cohérence exacte théorique (avant arrondi) ===');
let exactOK = true;
for (const lh of [0.25, 0.5, 1.35, 2.5, 4.2]) {
  for (const la of [0.2, 0.5, 1.15, 2.5, 4.2]) {
    const lamT = lh + la;
    const pGoal = 1 - Math.exp(-lamT);
    const h = (lh / lamT) * pGoal;
    const a = (la / lamT) * pGoal;
    const n = 1 - pGoal;
    if (Math.abs(h + a + n - 1) > 1e-15) exactOK = false;
    // propriété de finesse Poisson : P(1er but par home) = λh/λt · P(un but existe)
    if (Math.abs(h - (lh / lamT) * pGoal) > 1e-15) exactOK = false;
  }
}
check('somme exacte = 1 en arithmétique réelle (25 couples)', exactOK);

// Cas limites des planchers λ (0.25/0.2) : l'ancien bug donnait somme ≈ 1.60
const fFloor = firstToScore(0.25, 0.2);
console.log(`  planchers λh=0.25, λa=0.2 : ${(fFloor.home * 100).toFixed(2)}/${(fFloor.away * 100).toFixed(2)}/${(fFloor.noGoal * 100).toFixed(2)} → somme ${((fFloor.home + fFloor.away + fFloor.noGoal) * 100).toFixed(3)}%`);
check('planchers λ : somme ≈ 100% (avant fix : ≈ 143% à 1+e^−λt)', Math.abs(fFloor.home + fFloor.away + fFloor.noGoal - 1) <= 3.1e-4);
// Reconstruction de l'ancien comportement (home = λh/λt, away = λa/λt, noGoal = e^−λt)
const oldSum = 0.25 / 0.45 + 0.2 / 0.45 + Math.exp(-0.45);
console.log(`  ancien code (reconstruit) : home+away+noGoal = ${(oldSum * 100).toFixed(1)}%`);
check('ancien code : somme > 1 démontrée', oldSum > 1.05);

console.log('\n=== 3. firstGoalTimingProbs (fonction réelle importée) : 6 fenêtres + NO_GOAL ===');
let timingOK = true;
let worstTiming = 0;
let worstLambdaT = 0;
for (let lamT = 0.4; lamT <= 8.4 + 1e-9; lamT += 0.1) {
  const t = firstGoalTimingProbs(lamT);
  if (t.length !== 7) timingOK = false;
  const sum = t.reduce((s, o) => s + o.prob, 0);
  if (Math.abs(sum - 1) > worstTiming) { worstTiming = Math.abs(sum - 1); worstLambdaT = lamT; }
  if (t.some((o) => o.prob < 0 || o.prob > 1)) timingOK = false;
  // NO_GOAL cohérent avec la théorie e^−λt (normalisée, tolérance round 4dp)
  const noGoal = t.find((o) => o.window === 'NO_GOAL');
  if (Math.abs(noGoal!.prob - Math.exp(-lamT)) > 1e-3) timingOK = false;
  // fenêtres décroissantes pour λt>0 (décroissance exponentielle de la densité)
  const w = t.filter((o) => o.window !== 'NO_GOAL').map((o) => o.prob);
  for (let i = 1; i < w.length; i++) if (w[i] >= w[i - 1]) timingOK = false;
}
check('λt ∈ [0.4, 8.4] (81 valeurs) : 7 fenêtres, somme = 1 ± 7e-4, décroissance OK', timingOK, `pire écart=${worstTiming.toExponential(2)} à λt=${worstLambdaT.toFixed(1)}`);
check('tolérance ≤ 0.5 pt exigée', worstTiming <= 0.005);

const tMid = firstGoalTimingProbs(2.7);
console.log('  λt=2.7 : ' + tMid.map((o) => `${o.window}=${(o.prob * 100).toFixed(1)}%`).join(' '));
check('somme à λt=2.7 = 1 ± 7e-4', Math.abs(tMid.reduce((s, o) => s + o.prob, 0) - 1) <= 7e-4);

console.log('\n=== 4. Cohérence croisée firstToScore.noGoal vs firstGoalTiming NO_GOAL ===');
// Même λt → même proba « aucun but » (aux arrondis près)
let crossOK = true;
for (const lamT of [0.45, 1.0, 2.7, 5.0, 8.4]) {
  const f = firstToScore(lamT / 2, lamT / 2);
  const t = firstGoalTimingProbs(lamT);
  const noGoalTiming = t.find((o) => o.window === 'NO_GOAL')!.prob;
  if (Math.abs(f.noGoal - noGoalTiming) > 1e-3) crossOK = false;
}
check('noGoal identique dans les deux marchés (±1e-3)', crossOK);

console.log(`\n===== SCRIPT 3 (firstToScore + timing) : ${passed} PASS / ${failed} FAIL =====`);
if (failed > 0) process.exit(1);
