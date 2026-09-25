// ============================================================
// Audit 20-a — Script 1 : Vérification du fix poissonPmf (Task 19)
// READ-ONLY : importe runEngine/poissonModel RÉELS de src/lib/prediction.ts.
//
// Preuves empilées :
//  Part 0 — assertions SOURCE : l'appel L488 est poissonPmf(lam, k), la
//          matrice L393 est (lambdaHome, i)/(lambdaAway, j), aucune trace
//          de l'ancien appel inversé, les 2 copies de poissonPmf (prediction
//          vs market-odds) sont texte-identiques.
//  Part A — CHEMIN RÉEL : balayage de fixtures synthétiques → le moteur
//          produit λ variés ; pour chaque (fixture, ligne bookmaker hors
//          grille {0.5, 2, 3, 4, 4.5}) la branche FALLBACK (L476-497) est
//          déclenchée via cotes sonde, et modelProb émis est comparé à une
//          loi de Poisson de RÉFÉRENCE indépendante (récurrence pk=p(k-1)·λ/k).
//  Part B — matrice L393 : poissonModel() comparé à une référence
//          indépendante en pleine précision (probas Poisson NON arrondies)
//          + test d'orientation des arguments (λh ≠ λa).
//  Part C — réplique source de la branche vs référence sur λ 0.2→5.0 ×
//          lignes {0.5,1.5,2,2.5,3.5,4.5} à la précision machine.
// bun scripts/audit-20-a-1-poisson-fix.ts
// ============================================================

import { readFileSync } from 'node:fs';
import { runEngine, poissonModel, type EngineInput, type EspnScheduleGame, type EspnOdds } from '../src/lib/prediction';

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

// ---------- Référence Poisson INDÉPENDANTE (récurrence stable) ----------
function pmfRef(lambda: number, k: number): number {
  let p = Math.exp(-lambda);
  for (let i = 1; i <= k; i++) p = (p * lambda) / i;
  return p;
}
const clampF = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const round4 = (x: number) => Math.round(x * 1e4) / 1e4;

/** Vraie loi P(X>k line) / P(X<line) avec push sur ligne entière, k ≤ 200 */
function trueOU(lamT: number, line: number) {
  let pBelow = 0, pEq = 0;
  for (let k = 0; k <= 200; k++) {
    const p = pmfRef(lamT, k);
    if (k < line - 1e-9) pBelow += p;
    else if (Math.abs(k - line) < 1e-9) pEq += p;
  }
  const played = 1 - pEq;
  return {
    pOver: clampF((1 - pBelow - pEq) / played, 0.01, 0.99),
    pUnder: clampF(pBelow / played, 0.01, 0.99),
  };
}

/** Réplique TEXTELLE de l'algorithme source (prediction.ts L479-494) :
 *  pmf = exp(−λ)·λ^k/k! (boucle factorielle), k ≤ 12, fenêtre pEq 0.01,
 *  played = max(1e-6, 1−pEq), clamps [0.01, 0.99]. */
function pmfSrcAlgo(lambda: number, k: number): number {
  let fact = 1;
  for (let i = 2; i <= k; i++) fact *= i;
  return (Math.exp(-lambda) * Math.pow(lambda, k)) / fact;
}
function srcFallbackOU(lamT: number, line: number) {
  let pBelow = 0, pEq = 0;
  for (let k = 0; k <= 12; k++) {
    const p = pmfSrcAlgo(lamT, k);
    if (k < line - 1e-9) pBelow += p;
    else if (Math.abs(k - line) < 0.01) pEq += p;
  }
  const played = Math.max(1e-6, 1 - pEq);
  return {
    pOver: clampF((1 - pBelow - pEq) / played, 0.01, 0.99),
    pUnder: clampF(pBelow / played, 0.01, 0.99),
  };
}

/** Ancienne formule BUGGÉE (anti-régression) : poissonPmf(k, lam) */
function swappedOU(lamT: number, line: number) {
  const pmfSw = (k: number) => {
    let fact = 1;
    for (let i = 2; i <= lamT; i++) fact *= i;
    return (Math.exp(-k) * Math.pow(k, lamT)) / fact;
  };
  let pBelow = 0, pEq = 0;
  for (let k = 0; k <= 12; k++) {
    const p = pmfSw(k);
    if (k < line - 1e-9) pBelow += p;
    else if (Math.abs(k - line) < 0.01) pEq += p;
  }
  const played = Math.max(1e-6, 1 - pEq);
  return {
    pOver: clampF((1 - pBelow - pEq) / played, 0.01, 0.99),
    pUnder: clampF(pBelow / played, 0.01, 0.99),
  };
}

// ---------- Fixtures synthétiques ----------
const NOW = new Date('2026-09-20T15:00:00Z').getTime();
const DAY = 86400000;
type RawGame = { opp: string; home: boolean; ts: number; os: number; daysAgo: number };
function mkSchedule(teamId: string, games: RawGame[]): EspnScheduleGame[] {
  return games.map((g, i) => ({
    eventId: `${teamId}-e${i}`,
    date: new Date(NOW - g.daysAgo * DAY).toISOString(),
    opponentId: g.opp,
    opponentName: g.opp,
    homeAway: g.home ? ('home' as const) : ('away' as const),
    teamScore: g.ts,
    opponentScore: g.os,
    completed: true,
    leagueCode: 'test.1',
  }));
}
function input(hSched: EspnScheduleGame[], aSched: EspnScheduleGame[], odds: EspnOdds | null): EngineInput {
  return {
    homeTeam: { id: 'TH', name: 'Team Home', logo: null, schedule: hSched, standings: null },
    awayTeam: { id: 'TA', name: 'Team Away', logo: null, schedule: aSched, standings: null },
    injuries: [],
    odds,
    isDerby: false,
    weatherImpact: null,
    nowMs: NOW,
    leagueTeamsCount: 20,
  };
}
function probeOdds(ouLine: number, overClose: number | null, underClose: number | null): EspnOdds {
  return {
    provider: 'ProbeBook',
    overUnderLine: ouLine,
    moneyline: {
      home: { open: null, close: null },
      draw: { open: null, close: null },
      away: { open: null, close: null },
    },
    total: {
      over: { line: ouLine, openOdds: null, closeOdds: overClose },
      under: { line: ouLine, openOdds: null, closeOdds: underClose },
    },
    hasOdds: true,
  };
}

// ============================================================
console.log('\n=== PART 0 — Assertions SOURCE (prediction.ts / market-odds.ts) ===');
const srcPred = readFileSync('src/lib/prediction.ts', 'utf8');
const srcMkt = readFileSync('src/lib/market-odds.ts', 'utf8');
// retirer les commentaires de ligne AVANT de chercher les appels (le commentaire
// d'audit L483-487 cite l'ancien appel inversé — il ne doit pas fausser le test)
const stripComments = (src: string) => src.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
const srcPredCode = stripComments(srcPred);
const srcMktCode = stripComments(srcMkt);
const count = (hay: string, needle: string) => hay.split(needle).length - 1;
check('L488 : appel fallback = poissonPmf(lam, k) (présent 1×)', count(srcPredCode, 'const p = poissonPmf(lam, k);') === 1);
check(
  'L393 : matrice = poissonPmf(lambdaHome, i) * poissonPmf(lambdaAway, j) (présent 1×)',
  count(srcPredCode, 'poissonPmf(lambdaHome, i) * poissonPmf(lambdaAway, j)') === 1
);
check('Aucun appel inversé poissonPmf(k, …) dans le CODE de prediction.ts (hors commentaires d\'audit)', count(srcPredCode, 'poissonPmf(k,') === 0);
check('market-odds.ts : signature (lambda, k) + appel poissonPmf(safeLambda, k), jamais inversé', count(srcMktCode, 'function poissonPmf(lambda: number, k: number): number') === 1 && count(srcMktCode, 'poissonPmf(safeLambda, k)') === 1 && count(srcMktCode, 'poissonPmf(k,') === 0);
const extractFn = (src: string) => {
  const m = src.match(/function poissonPmf\(lambda: number, k: number\): number \{[\s\S]*?\n\}/);
  return m ? m[0].replace(/\s+/g, ' ').trim() : '(introuvable)';
};
check('Les 2 copies de poissonPmf (prediction.ts L137 vs market-odds.ts L16) sont texte-identiques', extractFn(srcPred) === extractFn(srcMkt), extractFn(srcPred).slice(0, 110) + '…');

// Compteurs globaux pour le bilan final
let nPmfTotal = 0, nOuTotal = 0;

// ============================================================
console.log('\n=== PART A — Chemin RÉEL : branche fallback (L476-497) vs loi de Poisson de référence ===');
// Fixtures : équipe dom marque hf / encaisse hcon (tous matchs à domicile),
// équipe ext marque af / encaisse acon (tous à l'extérieur), n matchs chacun.
function fixture(hf: number, hcon: number, af: number, acon: number, n: number) {
  const hGames: RawGame[] = [];
  const aGames: RawGame[] = [];
  for (let i = 0; i < n; i++) {
    const daysAgo = 20 + i * 10;
    hGames.push({ opp: `O${i}`, home: true, ts: hf, os: hcon, daysAgo });
    aGames.push({ opp: `P${i}`, home: false, ts: af, os: acon, daysAgo });
  }
  return { h: mkSchedule('TH', hGames), a: mkSchedule('TA', aGames) };
}
const EMPTY = { h: mkSchedule('TH', []), a: mkSchedule('TA', []) };
void EMPTY;

// Générateur large : grilles déterministes + fixtures aléatoires seedées pour
// remplir les buckets λt de 0.1 but (les produits hf·acon sont trop grossiers seuls).
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 14), 61 | t)) ^ 4294967296;
    return t / 4294967296;
  };
}
const rng = mulberry32(20209); // seed fixe → reproductible
const seen = new Set<string>();
type Fxt = { name: string; f: ReturnType<typeof fixture>; lh: number; la: number; lamT: number };
const fixtures: Fxt[] = [];
const TARGET_BUCKETS = new Set<number>();
for (let b = 5; b <= 50; b++) TARGET_BUCKETS.add(b); // λt 0.5→5.0 pas de 0.1 (0.45→bucket 5 par arrondi)
function tryFixture(label: string, mkScores: (i: number) => [{ ts: number; os: number }, { ts: number; os: number }], n: number): boolean {
  const hGames: RawGame[] = [];
  const aGames: RawGame[] = [];
  for (let i = 0; i < n; i++) {
    const [hs, as] = mkScores(i);
    const daysAgo = 20 + i * 10;
    hGames.push({ opp: `O${i}`, home: true, ts: hs.ts, os: hs.os, daysAgo });
    aGames.push({ opp: `P${i}`, home: false, ts: as.ts, os: as.os, daysAgo });
  }
  const f = { h: mkSchedule('TH', hGames), a: mkSchedule('TA', aGames) };
  const base = runEngine(input(f.h, f.a, null));
  const lh = base.prediction.lambda.home;
  const la = base.prediction.lambda.away;
  const lamT = lh + la;
  const bucket = Math.round(lamT * 10);
  const key = `${lh}_${la}`; // paire exacte (2dp) — admit enough fixtures to fill every λt bucket
  if (seen.has(key)) return false;
  seen.add(key);
  fixtures.push({ name: label, f, lh, la, lamT });
  if (lamT >= 0.45 - 1e-9 && lamT <= 5.0 + 1e-9) TARGET_BUCKETS.delete(bucket);
  return TARGET_BUCKETS.size === 0;
}
// (a) équipes vides (λ plancher 0.45)
tryFixture('equipes-vides', () => [{ ts: 0, os: 0 }, { ts: 0, os: 0 }], 0);
// (b) grilles déterministes uniformes
for (const hf of [0, 1, 2, 3, 4]) for (const hcon of [0, 1, 2, 3]) for (const af of [0, 1, 2, 3, 4]) for (const acon of [0, 1, 2, 3]) {
  tryFixture(`uni hf${hf}/hcon${hcon}/af${af}/acon${acon}`, () => [{ ts: hf, os: hcon }, { ts: af, os: acon }], 10);
}
// (c) aléatoire seedé : scores 0..4 indépendants par match → λ continus
for (let t = 0; t < 20000 && TARGET_BUCKETS.size > 0 && fixtures.length < 1500; t++) {
  tryFixture(`rnd#${t}`, () => [{ ts: Math.floor(rng() * 5), os: Math.floor(rng() * 5) }, { ts: Math.floor(rng() * 5), os: Math.floor(rng() * 5) }], 10);
}
const lamValues = fixtures.map((x) => x.lamT);
console.log(`  ${fixtures.length} fixtures dédupliquées ; λt ∈ [${Math.min(...lamValues).toFixed(2)} → ${Math.max(...lamValues).toFixed(2)}]`);
if (TARGET_BUCKETS.size > 0) console.log(`  buckets λt manquants : ${[...TARGET_BUCKETS].sort((a, b) => a - b).map((b) => (b / 10).toFixed(1)).join(', ')}`);

const PROBE_LINES = [0.5, 2.0, 3.0, 4.0, 4.5]; // hors grille modèle {1.5, 2.5, 3.5} → branche fallback
let nReal = 0, nRealBad = 0, worstReal = { d: 0, label: '' };
let nAntiSwap = 0, nAntiSwapFail = 0, minSwapDist = Infinity;
const bucketsCovered = new Set<number>();
for (const item of fixtures) {
  for (const line of PROBE_LINES) {
    const lamT = item.lamT;
    const bucket = Math.round(lamT * 10);
    if (lamT >= 0.2 - 1e-9 && lamT <= 5.0 + 1e-9) bucketsCovered.add(bucket);
    const ref = trueOU(lamT, line);
    const sw = swappedOU(lamT, line);
    // Cotes sonde 1000 : edge = p·1000−1 > 0.02 dès p > 0.00102 → les DEUX picks sont émis,
    // y compris après clamp [0.01, 0.99] (0.01·1000−1 = 9 > 0.02).
    const eng = runEngine(input(item.f.h, item.f.a, probeOdds(line, 1000, 1000)));
    const vb = eng.prediction.valueBets.filter((v) => v.market.startsWith('Over/Under'));
    const vbOver = vb.find((v) => v.pick.includes('Plus'));
    const vbUnder = vb.find((v) => v.pick.includes('Moins'));
    for (const [vbSide, refP, swP] of [
      [vbOver, ref.pOver, sw.pOver],
      [vbUnder, ref.pUnder, sw.pUnder],
    ] as const) {
      if (!vbSide) {
        nRealBad++;
        console.log(`    MANQUANT ${item.name} ligne ${line} ${vbSide === vbOver ? 'Plus' : 'Moins'} (λt=${lamT.toFixed(2)})`);
        continue;
      }
      nReal++;
      const dExact = Math.abs(vbSide.modelProb - round4(refP));
      const d = Math.abs(vbSide.modelProb - refP);
      if (d > worstReal.d) worstReal = { d, label: `${item.name} · ligne ${line} · ${vbSide.pick} · λt=${lamT.toFixed(2)}` };
      if (dExact > 1e-9 || d > 5e-5 + 1e-9) {
        nRealBad++;
        console.log(`    ÉCART ${item.name} ligne ${line} ${vbSide.pick} : émis=${vbSide.modelProb} vrai=${refP} (λt=${lamT.toFixed(2)})`);
      }
      const dSwap = Math.abs(vbSide.modelProb - swP);
      // La comparaison anti-swap n'a de sens que hors des paliers de clamp
      // (0.01/0.99 peuvent coïncider entre formules même correctes/inversées).
      const trueUnclamped = (() => {
        let pBelow = 0, pEq = 0;
        for (let k = 0; k <= 200; k++) {
          const p = pmfRef(lamT, k);
          if (k < line - 1e-9) pBelow += p;
          else if (Math.abs(k - line) < 1e-9) pEq += p;
        }
        return vbSide.pick.includes('Plus') ? (1 - pBelow - pEq) / (1 - pEq) : pBelow / (1 - pEq);
      })();
      if (trueUnclamped > 0.02 && trueUnclamped < 0.98) {
        minSwapDist = Math.min(minSwapDist, dSwap);
        if (dSwap < 1e-4) nAntiSwapFail++;
        else nAntiSwap++;
      }
      if (!(vbSide.kelly >= 0 && vbSide.kelly <= 0.1)) {
        nRealBad++;
        console.log(`    KELLY HORS BORNES ${item.name} ligne ${line} : ${vbSide.kelly}`);
      }
    }
  }
}
check(
  `modelProb (fallback réel) == vraie Poisson sur ${nReal} comparaisons (fixtures × lignes × sides)`,
  nRealBad === 0,
  `écart max = ${worstReal.d.toExponential(2)} à ${worstReal.label} (résolution d'affichage 4dp = 5e-5)`
);
check('Jamais la formule inversée hors zones de clamp (anti-régression)', nAntiSwapFail === 0, `${nAntiSwap} comparaisons utiles, distance min à l'ancienne formule = ${minSwapDist === Infinity ? 'n/a' : minSwapDist.toFixed(4)}`);
const wantBuckets = 46; // buckets 0.1 de 0.45→5.0 = 46 valeurs atteignables par le moteur (planchers 0.25+0.2)
check(
  `couverture λt 0.45→5.0 : ${46 - TARGET_BUCKETS.size}/46 buckets de 0.1 buts touchés (chemin réel)`,
  TARGET_BUCKETS.size <= 3,
  TARGET_BUCKETS.size
    ? `buckets absents = quantification λ (round 2dp + clamps) — couverts à la précision machine par la Part C (${[...TARGET_BUCKETS].sort((a, b) => a - b).map((b) => (b / 10).toFixed(1)).join(', ')})`
    : 'couverture complète'
);
console.log(`  note : λt < 0.45 inatteignable par construction (planchers λh=0.25, λa=0.2, clamp L615-616) → couvert en Part C au niveau pmf/branche`);

// Lignes DANS la grille (1.5/2.5/3.5) : la branche exacte doit servir la grille modèle, pas un recalcul
{
  const item = fixtures.find((x) => x.lamT > 1.5 && x.lamT < 3.5)!;
  const eng = runEngine(input(item.f.h, item.f.a, probeOdds(2.5, 3.0, 2.0)));
  const grid = runEngine(input(item.f.h, item.f.a, null)).prediction.overUnder.find((o) => o.line === 2.5)!;
  const vb = eng.prediction.valueBets.filter((v) => v.market === 'Over/Under 2.5');
  check(
    'lignes grille {1.5,2.5,3.5} : branchent sur la grille modèle (ouExact), jamais sur le fallback',
    vb.every((v) => Math.abs(v.modelProb - (v.pick.includes('Plus') ? grid.over : grid.under)) < 1e-12)
  );
}

// ============================================================
console.log('\n=== PART B — Matrice L393 : poissonModel() vs référence indépendante (pleine précision) ===');
{
  const grid = [0.0, 0.2, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.2];
  let worstProbs = 0, worstOu = 0, worstBtts = 0, nPairs = 0, nOrientation = 0, minOrientDist = Infinity;
  for (const lh of grid) {
    for (const la of grid) {
      const res = poissonModel(lh, la);
      // référence : matrice complète 0..12 (même troncature MAX=12 que le
      // moteur depuis l'audit 20-a — l'ancien miroir 8×8 divergeait de ~0,9 pt)
      let pH = 0, pD = 0, pA = 0, btts = 0, total = 0;
      const M: number[][] = [];
      for (let i = 0; i <= 12; i++) {
        M[i] = [];
        for (let j = 0; j <= 12; j++) {
          M[i][j] = pmfRef(lh, i) * pmfRef(la, j);
          total += M[i][j];
          if (i > j) pH += M[i][j];
          else if (i === j) pD += M[i][j];
          else pA += M[i][j];
          if (i > 0 && j > 0) btts += M[i][j];
        }
      }
      const rH = pH / total, rD = pD / total, rA = pA / total;
      worstProbs = Math.max(worstProbs, Math.abs(res.probs.home - rH), Math.abs(res.probs.draw - rD), Math.abs(res.probs.away - rA));
      worstBtts = Math.max(worstBtts, Math.abs(res.btts.yes - round4(btts / total)));
      for (const line of [1.5, 2.5, 3.5]) {
        let over = 0;
        for (let i = 0; i <= 12; i++) for (let j = 0; j <= 12; j++) if (i + j > line) over += M[i][j];
        worstOu = Math.max(worstOu, Math.abs(res.overUnder.find((o) => o.line === line)!.over - round4(over / total)));
      }
      nPairs++;
      // orientation des arguments : avec λh ≠ λa, inverser les λ change forcément les probas
      if (lh !== la) {
        const swapped = poissonModel(la, lh);
        const d = Math.abs(res.probs.home - swapped.probs.away) + Math.abs(res.lambdaHome - lh) + Math.abs(res.lambdaAway - la);
        minOrientDist = Math.min(minOrientDist, Math.abs(res.probs.home - swapped.probs.home));
        if (res.lambdaHome === lh && res.lambdaAway === la && res.probs.home !== swapped.probs.home) nOrientation++;
      }
    }
  }
  check(
    `probas Poisson BRUTES (non arrondies) == référence sur ${nPairs} couples (λh,λa) ∈ [0, 4.2]²`,
    worstProbs <= 1e-12,
    `écart max = ${worstProbs.toExponential(2)} — prouve poissonPmf(λ,k) ET l'orientation (λ, k) de L393`
  );
  check(`orientation λh/λa : ${nOrientation}/${nPairs - grid.length} couples asymétriques distinguables (jamais d'inversion)`, nOrientation === nPairs - grid.length, `distance min home(swappé) = ${minOrientDist.toFixed(4)}`);
  check(`O/U grille + BTTS == référence aux arrondis 4dp`, worstOu <= 5e-5 + 1e-9 && worstBtts <= 5e-5 + 1e-9, `écart max O/U = ${worstOu.toExponential(2)}, BTTS = ${worstBtts.toExponential(2)}`);
  // cas dégénéré λ=0 : pmf(0,0)=1 (Math.pow(0,0)=1) → 0-0 certain
  const zero = poissonModel(0, 0);
  check('cas dégénéré λ=0 : P(0-0)=1 → nul 100 %, O/U over=0, BTTS=0', Math.abs(zero.probs.draw - 1) < 1e-12 && zero.overUnder.every((o) => Math.abs(o.over) < 1e-12) && Math.abs(zero.btts.yes) < 1e-12);
}

// ============================================================
console.log('\n=== PART C — Réplique source de la branche vs référence : λ 0.2→5.0 × 6 lignes (précision machine) ===');
{
let worstPmf = 0, worstOu = 0, nPmf = 0, nOu = 0;
  for (let lam = 0.2; lam <= 5.0 + 1e-9; lam = Math.round((lam + 0.05) * 100) / 100) {
    for (let k = 0; k <= 12; k++) {
      worstPmf = Math.max(worstPmf, Math.abs(pmfSrcAlgo(lam, k) - pmfRef(lam, k)));
      nPmf++;
    }
    for (const line of [0.5, 1.5, 2.0, 2.5, 3.5, 4.5]) {
      const ref = trueOU(lam, line);
      const rep = srcFallbackOU(lam, line);
      worstOu = Math.max(worstOu, Math.abs(rep.pOver - ref.pOver), Math.abs(rep.pUnder - ref.pUnder));
      nOu++;
    }
  }
  nPmfTotal = nPmf; nOuTotal = nOu;
  check(`pmf (algorithme source exp(−λ)·λ^k/k!) == référence récurrence : ${nPmf} valeurs (λ 0.2→5.0, k 0→12)`, worstPmf <= 1e-12, `écart max = ${worstPmf.toExponential(2)}`);
  check(`branche (push+clamp+normalisation) == vraie loi : ${nOu} couples (λ, ligne)`, worstOu <= 1e-12, `écart max = ${worstOu.toExponential(2)} — troncature k≤12 sans effet (under ne demande que k<line≤4.5, over reçoit la queue par complément)`);
}

console.log(`\n===== AUDIT 20-a SCRIPT 1 (fix poissonPmf) : ${passed} PASS / ${failed} FAIL — ${nReal + nAntiSwap + nPmfTotal + nOuTotal} comparaisons numériques internes =====`);
if (failed > 0) process.exit(1);
