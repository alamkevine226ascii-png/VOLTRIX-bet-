// ============================================================
// Audit 20-a — Script 3 : market-odds.ts vs prediction.ts (deux routes Poisson)
// READ-ONLY : importe les fonctions RÉELLES de src/lib/market-odds.ts et
// poissonModel de src/lib/prediction.ts.
// Questions :
//  1. la 2e copie poissonPmf (market-odds L16) est-elle cohérente ? (identité pmf)
//  2. totalGoalsDist : erreur de troncature k≤12 + renormalisation (facteur 1/P(X≤12))
//  3. calibrateTotals : dichotomie exacte ? distorsion induite sur les lignes non-ancre ?
//  4. écart entre les DEUX routes « Over » du repo : matrice conditionnée (prediction)
//     vs dist renormalisée (market-odds) — même λ, mêmes lignes.
//  5. BTTS : formule exacte (market-odds) vs matrice conditionnée (prediction).
//  6. deMargin / dcFromMarket / oddsWithMargin : normalisations et bornes.
// bun scripts/audit-20-a-3-market-odds.ts
// ============================================================

import {
  totalGoalsDist,
  overProb,
  bttsProb,
  deMargin1x2,
  deMarginOverUnder,
  dcFromMarket,
  calibrateTotals,
  oddsWithMargin,
} from '../src/lib/market-odds';
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

// Référence Poisson indépendante (récurrence), k jusqu'à 200
function pmfRef(lambda: number, k: number): number {
  let p = Math.exp(-lambda);
  for (let i = 1; i <= k; i++) p = (p * lambda) / i;
  return p;
}
function trueOver(lamT: number, line: number): number {
  let over = 0;
  for (let k = 0; k <= 200; k++) if (k > line) over += pmfRef(lamT, k);
  return over;
}
function trueBtts(lh: number, la: number): number {
  return (1 - Math.exp(-lh)) * (1 - Math.exp(-la));
}

console.log('\n=== 1. totalGoalsDist : somme, pmf vs référence, facteur de renormalisation ===');
{
  let worstPmf = 0, worstSum = 0;
  const lamList = [0.05, 0.2, 0.45, 1, 2, 2.5, 3.5, 5, 8.4, 12, 15, 21];
  let worstRenorm = { f: 1, lam: 0 };
  for (const lam of lamList) {
    const dist = totalGoalsDist(lam);
    worstSum = Math.max(worstSum, Math.abs(dist.reduce((s, p) => s + p, 0) - 1));
    // pmf individuelle (l'algo source est identique à prediction.ts — prouvé script 1 Part 0)
    // CORRECTIF 20-a : plage adaptative kMax (même formule que totalGoalsDist)
    const kMax = Math.max(12, Math.ceil(lam + 8 * Math.sqrt(lam) + 8));
    let cum = 0;
    for (let k = 0; k <= kMax; k++) cum += pmfRef(lam, k);
    worstRenorm = { f: Math.max(worstRenorm.f, 1 / cum), lam: 1 / cum > worstRenorm.f ? lam : worstRenorm.lam };
    for (let k = 0; k <= 12; k++) {
      // dist[k] = pmf/cum ; vérifie pmf = dist[k]·cum == référence
      worstPmf = Math.max(worstPmf, Math.abs(dist[k] * cum - pmfRef(lam, k)));
    }
  }
  check(`totalGoalsDist somme à 1 après renormalisation (écart max ${worstSum.toExponential(2)})`, worstSum <= 1e-12);
  check(`pmf sous-jacente == référence récurrence (écart max ${worstPmf.toExponential(2)})`, worstPmf <= 1e-12);
  check('facteur de renormalisation quantifié', worstRenorm.f <= 41, `1/P(X≤12) max = ×${worstRenorm.f.toFixed(1)} à λ=21 (borne du calibrateTotals : λt moteur ≤ 8.4 × scale ≤ 2.5) ; à λ réaliste ≤ 8.4 le facteur reste ≤ ×1.06`);
  // plancher safeLambda
  const d0 = totalGoalsDist(0);
  check('λ=0 / non fini → plancher 0.05 (dist valide, aucune NaN)', Number.isFinite(d0[0]) && Math.abs(d0.reduce((s, p) => s + p, 0) - 1) < 1e-12);
  const dNan = totalGoalsDist(NaN);
  check('λ=NaN → plancher 0.05', Number.isFinite(dNan[3]));
}

console.log('\n=== 2. overProb : seuils X.5 et lignes entières ===');
{
  const dist = totalGoalsDist(2.6);
  const o15 = overProb(dist, 1.5), o2 = overProb(dist, 2), o25 = overProb(dist, 2.5);
  check('seuils X.5 corrects : 1.5 → k≥2 ; 2.5 → k≥3', Math.abs(o15 - trueOver(2.6, 1.5)) < 1e-9 && Math.abs(o25 - trueOver(2.6, 2.5)) < 1e-9, `over1.5=${o15.toFixed(4)} over2.5=${o25.toFixed(4)}`);
  // CORRECTIF APPLIQUÉ (audit 20-a, seuil = Math.floor(line) + 1) : over 2.0
  // gagne à 3+ buts (push à 2) → P(k≥3), les X.5 sont inchangés.
  const fixed = Math.abs(o2 - trueOver(2.6, 2)) < 1e-9;
  check('overProb(2.0) PUSH-AWARE : P(k≥3) (push à 2 exclu)', fixed, `retourné ${o2.toFixed(4)} ; attendu P(k≥3) = ${trueOver(2.6, 2).toFixed(4)}`);
  check('over(2.0) ≠ over(1.5) — les lignes entières sont désormais distinguées', Math.abs(o2 - o15) > 1e-6);
}

console.log('\n=== 3. calibrateTotals : ancrage exact + distorsion des autres lignes ===');
{
  // Cas réalistes : (λh, λa) du moteur, ligne ancre réelle, pOver dé-margé du marché
  const cases: Array<[number, number, number, number]> = [
    [1.4, 1.1, 2.5, 0.55], [1.8, 1.3, 2.5, 0.60], [2.2, 1.6, 3.5, 0.52], [0.9, 0.7, 2.0, 0.45],
    [1.5, 1.2, 2.5, 0.50], [2.5, 2.0, 3.5, 0.65], [1.2, 1.0, 1.5, 0.35], [3.0, 2.2, 3.5, 0.72],
    [1.4, 1.1, 3.0, 0.52], [1.6, 1.2, 2.0, 0.58],
  ];
  let worstAnchor = 0, worstDistortion = { d: 0, desc: '' };
  let worstIntegerBug = { d: 0, desc: '' };
  for (const [lh, la, anchor, pOverMkt] of cases) {
    const lines = [...new Set([1.5, 2.5, 3.5, anchor])];
    const cal = calibrateTotals(lh, la, anchor, pOverMkt, lines);
    // l'ancre retombe sur la cible (dichotomie 60 iters → précision machine)
    // CORRECTIF 20-a : convention — cal.over[ancre] = P(k>ancre) BRUTE (prob de
    // gain, push exclu du gain mais remboursé) ; pour une ancre ENTIÈRE la
    // cible marché est CONDITIONNELLE (P(over | over ou under)) → on compare
    // la conditionnelle du modèle à la cible, et la brute à P(k>ancre) vraie.
    {
      if (Number.isInteger(anchor)) {
        const lamS0 = cal.scale * (lh + la);
        let over = 0, eq = 0;
        for (let k = 0; k <= 200; k++) {
          const p = pmfRef(lamS0, k);
          if (k > anchor) over += p;
          else if (k === anchor) eq += p;
        }
        const cond = over / (1 - eq);
        const raw = cal.over[anchor];
        worstAnchor = Math.max(worstAnchor, Math.abs(cond - pOverMkt), Math.abs(raw - over));
      } else {
        worstAnchor = Math.max(worstAnchor, Math.abs(cal.over[anchor] - pOverMkt));
      }
    }
    const lamT = lh + la;
    const isIntegerLine = Number.isInteger(anchor);
    // scale CORRECT (push-aware) : cible conditionnelle P(k>ancre)/(1−P(k=ancre))
    let scaleCorr = 1;
    {
      const condOverAt = (s: number): number => {
        let over = 0, eq = 0;
        for (let k = 0; k <= 200; k++) {
          const p = pmfRef(s * lamT, k);
          if (k > anchor) over += p;
          else if (k === anchor) eq += p;
        }
        return over / (1 - eq);
      };
      let lo = 0.25, hi = 2.5;
      for (let i = 0; i < 60; i++) {
        const mid = (lo + hi) / 2;
        if (condOverAt(mid) < pOverMkt) lo = mid;
        else hi = mid;
      }
      scaleCorr = (lo + hi) / 2;
    }
    const lamS = cal.scale * lamT;
    for (const line of lines) {
      const t = trueOver(lamS, line);
      const d = Math.abs(cal.over[line] - t);
      if (d > worstDistortion.d) worstDistortion = { d, desc: `λh=${lh} λa=${la} ancre ${anchor} @${pOverMkt} → scale=${cal.scale.toFixed(3)} λs=${lamS.toFixed(2)} ligne ${line} : calibré=${cal.over[line].toFixed(4)} vrai=${t.toFixed(4)}` };
      // distorsion vs le calibrage CORRECT (pertinente surtout pour ancre entière)
      const tCorr = trueOver(scaleCorr * lamT, line);
      const dCorr = Math.abs(cal.over[line] - tCorr);
      if (isIntegerLine && line !== anchor && dCorr > worstIntegerBug.d) worstIntegerBug = { d: dCorr, desc: `ancre ENTIÈRE ${anchor} @${pOverMkt} (λt=${lamT}) : scale buggé=${cal.scale.toFixed(3)} vs correct=${scaleCorr.toFixed(3)} → ligne ${line} : émis=${cal.over[line].toFixed(4)} vs juste=${tCorr.toFixed(4)}` };
    }
  }
  check('ancre : P(over|ancre) == cible marché (±1e-6)', worstAnchor <= 1e-6, `écart max = ${worstAnchor.toExponential(2)}`);
  check('distorsion lignes non-ancre vs vrai Poisson au λ calibré', worstDistortion.d <= 0.02, `pire cas : ${worstDistortion.desc}`);
  // CORRECTIF APPLIQUÉ (audit 20-a : calibrateTotals push-aware sur ancre
  // entière — cible conditionnelle P(k>ancre)/(1−P(k=ancre))) : la distorsion
  // vs le calibrage push-aware correct doit désormais être ≈ 0.
  check('ancre ENTIÈRE : calibrage PUSH-AWARE, distorsion ≤ 0.02 vs calibrage conditionnel correct', worstIntegerBug.d <= 0.02, `pire écart : ${(worstIntegerBug.d * 100).toFixed(2)} pts — ${worstIntegerBug.desc}`);
  // cas extrême : saturation (λ·scale grand) — documentation du comportement
  const extreme = calibrateTotals(4.2, 3.8, 2.5, 0.97, [1.5, 2.5, 3.5]);
  const lamS = extreme.scale * 8.0;
  const t15 = trueOver(lamS, 1.5);
  console.log(`  extrême marché 0.97 : scale=${extreme.scale.toFixed(3)} λs=${lamS.toFixed(2)} → over1.5 calibré=${extreme.over[1.5].toFixed(4)} vs vrai=${t15.toFixed(4)} (clamp [0.03,0.97] + bornes scale [0.25,2.5] : échec best-effort assumé)`);
  check('extrême : jamais de NaN ni de proba hors [0,1]', Object.values(extreme.over).every((v) => Number.isFinite(v) && v >= 0 && v <= 1) && Number.isFinite(extreme.btts) && extreme.btts >= 0 && extreme.btts <= 1);
  check('extrême : BTTS calibré ≤ 1', extreme.btts <= 1);
}

console.log('\n=== 4. Deux routes « Over » du repo : matrice conditionnée (prediction) vs dist renormalisée (market-odds) ===');
{
  const grid = [0.25, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.2];
  let worst = { d: 0, lh: 0, la: 0, line: 0, pm: 0, mo: 0 };
  let worstRealistic = { d: 0, lh: 0, la: 0, line: 0 };
  for (const lh of grid) {
    for (const la of grid) {
      const pm = poissonModel(lh, la);
      const dist = totalGoalsDist(lh + la);
      for (const line of [1.5, 2.5, 3.5]) {
        const mo = overProb(dist, line);
        const d = Math.abs(pm.overUnder.find((o) => o.line === line)!.over - mo);
        if (d > worst.d) worst = { d, lh, la, line, pm: pm.overUnder.find((o) => o.line === line)!.over, mo };
        if (lh <= 3.5 && la <= 3.5 && d > worstRealistic.d) worstRealistic = { d, lh, la, line };
      }
    }
  }
  check(
    'les 2 routes coincident à λ réaliste (λh, λa ≤ 3.5)',
    worstRealistic.d <= 2e-3,
    `pire écart λ≤3.5 : ${(worstRealistic.d * 100).toFixed(3)} pts (λh=${worstRealistic.lh} λa=${worstRealistic.la} ligne ${worstRealistic.line})`
  );
  check(
    'écart quantifié aux λ extrêmes (matrice tronquée 8×8 conditionnée vs dist k≤12 renormalisée)',
    worst.d <= 0.02,
    `pire écart global : ${(worst.d * 100).toFixed(2)} pts à λh=${worst.lh} λa=${worst.la} ligne ${worst.line} (matrice=${worst.pm.toFixed(4)} dist=${worst.mo.toFixed(4)}) — conditionnement i,j≤8 : P(X>8|4.2) ≈ 2.4 % de masse ôtée, essentiellement du côté over`
  );
  // BTTS : formule exacte (market-odds) vs matrice conditionnée (prediction)
  let worstBtts = { d: 0, lh: 0, la: 0 };
  for (const lh of grid) {
    for (const la of grid) {
      const pm = poissonModel(lh, la);
      const exact = bttsProb(lh, la);
      const d = Math.abs(pm.btts.yes - exact);
      if (d > worstBtts.d) worstBtts = { d, lh, la };
    }
  }
  check(
    'BTTS : matrice (prediction) vs formule exacte (market-odds)',
    worstBtts.d <= 0.03,
    `pire écart : ${(worstBtts.d * 100).toFixed(2)} pts à λh=${worstBtts.lh} λa=${worstBtts.la} (conditionnement i,j≤8 retire du BTTS : pires cas aux 2 λ max)`
  );
}

console.log('\n=== 5. De-margage / Double Chance / proba→cote ===');
{
  // exemple doc : 1.85/3.60/4.20
  const dm = deMargin1x2(1.85, 3.6, 4.2)!;
  check('deMargin1x2 : probas dé-margées somment à 1', Math.abs(dm.pH + dm.pD + dm.pA - 1) < 1e-12, `pH=${(dm.pH * 100).toFixed(1)}% pD=${(dm.pD * 100).toFixed(1)}% pA=${(dm.pA * 100).toFixed(1)}% marge=${(dm.margin * 100).toFixed(1)}%`);
  check('deMargin1x2 : rejette cotes invalides / marges invraisemblables', deMargin1x2(1.01, 3.6, 4.2) === null && deMargin1x2(1.85, 3.6, 400) === null && deMargin1x2(NaN, 3.6, 4.2) === null);
  const dou = deMarginOverUnder(1.9, 1.9)!;
  check('deMarginOverUnder : pOver+pUnder = 1', Math.abs(dou.pOver + dou.pUnder - 1) < 1e-12, `marge=${(dou.margin * 100).toFixed(1)}%`);
  const dc = dcFromMarket(1.85, 3.6, 4.2)!;
  check('dcFromMarket : 1X+12+X2 = 2 exact', Math.abs(dc.prob1X + dc.prob12 + dc.probX2 - 2) < 1e-12);
  check('dcFromMarket : chaque DC ∈ (0,1) et marge réappliquée bornée [0.03, 0.08]', [dc.prob1X, dc.prob12, dc.probX2].every((p) => p > 0 && p < 1) && dc.odds1X > 1 && dc.odds12 > 1 && dc.oddsX2 > 1);
  check('dcFromMarket : cohérence cote = oddsWithMargin(proba, marge bornée)', Math.abs(dc.odds1X - oddsWithMargin(dc.prob1X, Math.min(0.08, Math.max(0.03, dm.margin)))) < 1e-12);
  // oddsWithMargin : bornes et plancher
  let omOK = true;
  for (const p of [-0.1, 0, 0.01, 0.02, 0.5, 0.97, 1.5, NaN]) {
    const o = oddsWithMargin(p);
    if (!Number.isFinite(o) || o < 1.04) omOK = false;
  }
  check('oddsWithMargin : plancher 1.04, jamais NaN/hors bornes', omOK);
  check('oddsWithMargin(0.5, 0.07) = 1.86 (doc)', Math.abs(oddsWithMargin(0.5) - 1.86) < 1e-12, `=${oddsWithMargin(0.5)}`);
}

console.log('\n=== 6. Usage : qui importe quoi (inventaire statique) ===');
console.log('  cf. rapport : market-odds.ts importé UNIQUEMENT par src/app/combo/page.tsx (calibrateTotals, dcFromMarket, deMarginOverUnder, oddsWithMargin) ;');
console.log('  prediction.ts (poissonPmf privé L137) n\'importe PAS market-odds → 2 routes Poisson parallèles, copies texte-identiques aujourd\'hui (script 1 Part 0).');

console.log(`\n===== AUDIT 20-a SCRIPT 3 (market-odds vs prediction) : ${passed} PASS / ${failed} FAIL =====`);
if (failed > 0) process.exit(1);
