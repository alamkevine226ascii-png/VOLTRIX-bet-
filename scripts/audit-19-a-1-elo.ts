// ============================================================
// Audit 19-a — Script 1 : Fix Task 17 « Avantage domicile Elo »
// prediction.ts L155 (HOME_ADV_ELO=65), L207, L227 (eloToProbs), L605
// bun scripts/audit-19-a-1-elo.ts
// ============================================================

import { eloToProbs } from '../src/lib/prediction';

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

const HOME_ADV = 65; // transcription fidèle de prediction.ts:155
const eHomeOf = (h: number, a: number) => 1 / (1 + Math.pow(10, (a - HOME_ADV - h) / 400));

console.log('\n=== 1. eHome à ratings égaux ≈ 0.592 ===');
const eH = eHomeOf(1500, 1500);
check('eHome(1500,1500) ∈ [0.587, 0.597]', Math.abs(eH - 0.592) < 0.005, `eHome=${eH.toFixed(6)}`);
check('eHome > 0.5 (le domicile est favori à égalité)', eH > 0.5);

console.log('\n=== 2. eloToProbs(1500,1500) → ~46/25/28, home > away, somme = 1 ===');
const pEq = eloToProbs(1500, 1500);
console.log(`  eloToProbs(1500,1500) = ${(pEq.home * 100).toFixed(2)} / ${(pEq.draw * 100).toFixed(2)} / ${(pEq.away * 100).toFixed(2)}`);
check('home > away', pEq.home > pEq.away, `${pEq.home.toFixed(4)} > ${pEq.away.toFixed(4)}`);
check('home ≈ 0.466', Math.abs(pEq.home - 0.466) < 0.01, `home=${pEq.home.toFixed(4)}`);
check('draw ≈ 0.252', Math.abs(pEq.draw - 0.252) < 0.01, `draw=${pEq.draw.toFixed(4)}`);
check('away ≈ 0.281', Math.abs(pEq.away - 0.281) < 0.01, `away=${pEq.away.toFixed(4)}`);
check('somme 1X2 = 1 exactement (normalisée)', Math.abs(pEq.home + pEq.draw + pEq.away - 1) < 1e-12);

console.log('\n=== 3. Symétrie / antisymétrie ===');
// L'identité exacte pour le même modèle SANS avantage : eHome(h,a) + eHome(a,h) = 1.
// Ici l'avantage 65 pts casse volontairement cette identité : l'excès doit être
// > 0 (domicile avantagé dans les deux sens) et raisonnable (< 0.25).
let maxExcess = 0;
let minExcess = Infinity;
let mirrorDirOK = true;
let drawSymAtEqual = true;
let drawAsymMeasured = 0;
for (let h = 1250; h <= 1750; h += 25) {
  for (let a = 1250; a <= 1750; a += 25) {
    const excess = eHomeOf(h, a) + eHomeOf(a, h) - 1;
    maxExcess = Math.max(maxExcess, excess);
    minExcess = Math.min(minExcess, excess);
    const p1 = eloToProbs(h, a);
    const p2 = eloToProbs(a, h);
    // Direction : être à domicile aide toujours (P(dom gagne | h dom) > P(h gagne | h ext))
    if (!(p1.home > p2.away)) mirrorDirOK = false;
    // Chaque appel somme à 1
    if (Math.abs(p1.home + p1.draw + p1.away - 1) > 1e-9) mirrorDirOK = false;
    if (Math.abs(p2.home + p2.draw + p2.away - 1) > 1e-9) mirrorDirOK = false;
    // Le nul doit être symétrique à ratings égaux (même paire, sens inverse)
    if (h === a && Math.abs(p1.draw - p2.draw) > 1e-12) drawSymAtEqual = false;
    // Quantification de l'asymétrie du nul par venue (paire non égalitaire)
    if (h !== a) drawAsymMeasured = Math.max(drawAsymMeasured, Math.abs(p1.draw - p2.draw));
  }
}
check('excès eHome(h,a)+eHome(a,h)-1 toujours > 0 (avantage domicile)', minExcess > 0, `min=${minExcess.toFixed(4)} max=${maxExcess.toFixed(4)}`);
check('excès borné < 0.25 (pas de distorsion excessive)', maxExcess < 0.25, `max=${maxExcess.toFixed(4)}`);
check('direction : eloToProbs(h,a).home > eloToProbs(a,h).away + sommes=1 sur la grille', mirrorDirOK);
check('nul symétrique à ratings égaux', drawSymAtEqual);
const pMirror = eloToProbs(1600, 1500);
const pMirrorSwap = eloToProbs(1500, 1600);
console.log(`  eloToProbs(1600,1500) = ${(pMirror.home * 100).toFixed(1)}/${(pMirror.draw * 100).toFixed(1)}/${(pMirror.away * 100).toFixed(1)}`);
console.log(`  eloToProbs(1500,1600) = ${(pMirrorSwap.home * 100).toFixed(1)}/${(pMirrorSwap.draw * 100).toFixed(1)}/${(pMirrorSwap.away * 100).toFixed(1)}`);
console.log(`  asymétrie max du nul par venue (h≠a) : ${(drawAsymMeasured * 100).toFixed(1)} pts`);
check('équipe +100 Elo à domicile favorite (home ∈ 0.60..0.72)', pMirror.home > 0.60 && pMirror.home < 0.72, `home=${pMirror.home.toFixed(3)}`);

console.log('\n=== 4. Monotonie : domicile plus fort → eHome croissant, home prob croissante, away décroissante ===');
let monoOK = true;
let prevE = -1, prevH = -1, prevA = 2;
for (let h = 1200; h <= 1800; h += 10) {
  const e = eHomeOf(h, 1500);
  const p = eloToProbs(h, 1500);
  if (e <= prevE) monoOK = false;
  if (p.home <= prevH) monoOK = false;
  if (p.away >= prevA) monoOK = false;
  prevE = e; prevH = p.home; prevA = p.away;
}
check('monotonie stricte eHome/home/away vs eloHome (eloAway=1500 fixe)', monoOK);

console.log('\n=== 5. Grille 23×23 : sommes = 1 et cohérence de signe avec L605 ===');
let gridOK = true;
let signOK = true;
for (let h = 1200; h <= 1800; h += 25) {
  for (let a = 1200; a <= 1800; a += 25) {
    const p = eloToProbs(h, a);
    if (Math.abs(p.home + p.draw + p.away - 1) > 1e-9) gridOK = false;
    if (p.home < 0 || p.draw < 0 || p.away < 0) gridOK = false;
    // Cohérence L605 : eloDiff = eloHome + 65 - eloAway > 0  <=>  eHome > 0.5  <=>  home > away
    const eloDiff = h + HOME_ADV - a;
    const eH2 = eHomeOf(h, a);
    if ((eloDiff > 0) !== (eH2 > 0.5)) signOK = false;
    if ((eH2 > 0.5) !== (p.home > p.away)) signOK = false;
  }
}
check('grille 25 pts : somme 1X2 = 1 partout', gridOK);
check('signe L605 cohérent : eloDiff>0 <=> eHome>0.5 <=> home>away', signOK);

console.log('\n=== 6. Cas limites eloToProbs (écrasements de clamp) ===');
const pExtremeDom = eloToProbs(1800, 1200); // écrasé
const pExtremeExt = eloToProbs(1200, 1800);
console.log(`  extrême dom: ${(pExtremeDom.home * 100).toFixed(1)}/${(pExtremeDom.draw * 100).toFixed(1)}/${(pExtremeDom.away * 100).toFixed(1)}`);
console.log(`  extrême ext: ${(pExtremeExt.home * 100).toFixed(1)}/${(pExtremeExt.draw * 100).toFixed(1)}/${(pExtremeExt.away * 100).toFixed(1)}`);
check('clamp 0.95 home : pas de proba > 0.95', pExtremeDom.home <= 0.951);
check('sommes encore 1 aux extrêmes', Math.abs(pExtremeDom.home + pExtremeDom.draw + pExtremeDom.away - 1) < 1e-9 && Math.abs(pExtremeExt.home + pExtremeExt.draw + pExtremeExt.away - 1) < 1e-9);
check('NaN impossible (grille + extrêmes)', [pEq, pExtremeDom, pExtremeExt].every((p) => Number.isFinite(p.home) && Number.isFinite(p.draw) && Number.isFinite(p.away)));

console.log(`\n===== SCRIPT 1 (Elo domicile) : ${passed} PASS / ${failed} FAIL =====`);
if (failed > 0) process.exit(1);
