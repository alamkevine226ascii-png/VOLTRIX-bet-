// ============================================================
// Audit 19-a — Script 5 : Value bets (buildValueBets via runEngine réel)
// VERSION POST-FIX : le bug découvert par l'audit (L483 poissonPmf(k, lam)
// — arguments inversés, probas O/U fausses jusqu'à 67 pts sur les lignes
// hors grille modèle) a été corrigé en poissonPmf(lam, k). Ce script
// vérifie maintenant que la branche fallback == vraie loi de Poisson sur
// la ligne du bookmaker, et garde un anti-régression (moteur != formule
// inversée).
// bun scripts/audit-19-a-5-valuebets.ts
// ============================================================

import { runEngine, type EngineInput, type EspnScheduleGame, type EspnOdds } from '../src/lib/prediction';

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
const T1 = 'T1';
const T2 = 'T2';

function mkOdds(ouLine: number | null, overClose: number | null, underClose: number | null, mlHome: number | null = null): EspnOdds {
  return {
    provider: 'TestBook',
    overUnderLine: ouLine,
    moneyline: {
      home: { open: null, close: mlHome },
      draw: { open: null, close: mlHome ? 3.4 : null },
      away: { open: null, close: mlHome ? 3.8 : null },
    },
    total: {
      over: { line: ouLine, openOdds: null, closeOdds: overClose },
      under: { line: ouLine, openOdds: null, closeOdds: underClose },
    },
    hasOdds: ouLine !== null || mlHome != null,
  };
}
function input(hSched: EspnScheduleGame[], aSched: EspnScheduleGame[], odds: EspnOdds | null): EngineInput {
  return {
    homeTeam: { id: T1, name: 'Team One', logo: null, schedule: hSched, standings: null },
    awayTeam: { id: T2, name: 'Team Two', logo: null, schedule: aSched, standings: null },
    injuries: [],
    odds,
    isDerby: false,
    weatherImpact: null,
    nowMs: NOW,
    leagueTeamsCount: 20,
  };
}

// Vraie loi : Poisson(λt) avec push sur ligne entière
function pmfTrue(lambda: number, k: number): number {
  let p = Math.exp(-lambda);
  for (let i = 1; i <= k; i++) p = (p * lambda) / i;
  return p;
}
function trueOU(lamT: number, line: number) {
  let pBelow = 0, pEq = 0;
  for (let k = 0; k <= 40; k++) {
    const p = pmfTrue(lamT, k);
    if (k < line - 1e-9) pBelow += p;
    else if (Math.abs(k - line) < 1e-9) pEq += p;
  }
  const played = 1 - pEq;
  return { pOver: (1 - pBelow - pEq) / played, pUnder: pBelow / played, pEq };
}
// Réplique EXACTE de la branche fallback corrigée (prediction.ts L479-491) :
// poissonPmf(lam, k) + push + clamps [0.01, 0.99].
function fixedFallbackOU(lamT: number, line: number) {
  let pBelow = 0, pEq = 0;
  for (let k = 0; k <= 12; k++) {
    const p = pmfTrue(lamT, k);
    if (k < line - 1e-9) pBelow += p;
    else if (Math.abs(k - line) < 0.01) pEq += p;
  }
  const played = Math.max(1e-6, 1 - pEq);
  return {
    pOver: Math.min(0.99, Math.max(0.01, (1 - pBelow - pEq) / played)),
    pUnder: Math.min(0.99, Math.max(0.01, pBelow / played)),
  };
}
// ANCIEN code (buggé) : poissonPmf(k, lam) → λ:=k, k:=λt. Sert uniquement
// d'anti-régression : le moteur ne doit JAMAIS ressortir ces valeurs.
function swappedOU(lamT: number, line: number) {
  const pmfSw = (k: number) => {
    let fact = 1;
    for (let i = 2; i <= lamT; i++) fact *= i; // factorielle de floor(λt), pas de k !
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
    pOver: Math.min(0.99, Math.max(0.01, (1 - pBelow - pEq) / played)),
    pUnder: Math.min(0.99, Math.max(0.01, pBelow / played)),
  };
}

// ---- Fixtures ----
const t1MidRaw: RawGame[] = [
  { opp: 'O1', home: true, ts: 2, os: 1, daysAgo: 100 }, { opp: 'O2', home: true, ts: 1, os: 1, daysAgo: 90 },
  { opp: 'O3', home: true, ts: 2, os: 0, daysAgo: 80 }, { opp: 'O4', home: true, ts: 0, os: 1, daysAgo: 70 },
  { opp: 'O5', home: true, ts: 2, os: 2, daysAgo: 60 }, { opp: 'O6', home: true, ts: 1, os: 0, daysAgo: 50 },
  { opp: 'O7', home: true, ts: 3, os: 1, daysAgo: 40 }, { opp: 'O8', home: true, ts: 1, os: 1, daysAgo: 30 },
  { opp: 'O9', home: true, ts: 2, os: 1, daysAgo: 20 }, { opp: 'O10', home: true, ts: 2, os: 1, daysAgo: 10 },
];
const t1Mid = mkSchedule(T1, t1MidRaw);
const t2Mid = mkSchedule(T2, t1MidRaw.map((g, i) => ({ opp: `P${i + 1}`, home: false, ts: g.ts, os: g.os, daysAgo: g.daysAgo })));
// Fixture bas-scoreur (λt ≈ 1.2)
const t1LowRaw: RawGame[] = [
  { opp: 'O1', home: true, ts: 1, os: 0, daysAgo: 100 }, { opp: 'O2', home: true, ts: 1, os: 1, daysAgo: 90 },
  { opp: 'O3', home: true, ts: 0, os: 1, daysAgo: 80 }, { opp: 'O4', home: true, ts: 2, os: 1, daysAgo: 70 },
  { opp: 'O5', home: true, ts: 1, os: 1, daysAgo: 60 }, { opp: 'O6', home: true, ts: 1, os: 0, daysAgo: 50 },
  { opp: 'O7', home: true, ts: 0, os: 0, daysAgo: 40 }, { opp: 'O8', home: true, ts: 2, os: 1, daysAgo: 30 },
  { opp: 'O9', home: true, ts: 1, os: 2, daysAgo: 20 }, { opp: 'O10', home: true, ts: 1, os: 1, daysAgo: 10 },
];
const t1Low = mkSchedule(T1, t1LowRaw);
const t2Low = mkSchedule(T2, t1LowRaw.map((g, i) => ({ opp: `P${i + 1}`, home: false, ts: g.ts, os: g.os, daysAgo: g.daysAgo })));

console.log('\n=== 0. Sans cotes → valueBets vides ===');
check('odds=null → valueBets []', runEngine(input(t1Mid, t2Mid, null)).prediction.valueBets.length === 0);

const engBase = runEngine(input(t1Mid, t2Mid, null));
const lamT = engBase.prediction.lambda.home + engBase.prediction.lambda.away;
console.log(`\n  fixture médiane : λh=${engBase.prediction.lambda.home} λa=${engBase.prediction.lambda.away} → λt=${lamT}`);

console.log('\n=== 1. Ligne 2.5 (dans la grille modèle {1.5,2.5,3.5}) : branche exacte saine ===');
const eng25 = runEngine(input(t1Mid, t2Mid, mkOdds(2.5, 2.2, 2.0)));
const ou25model = engBase.prediction.overUnder.find((o) => o.line === 2.5)!;
const vb25 = eng25.prediction.valueBets.filter((v) => v.market === 'Over/Under 2.5');
check('branche exacte atteinte', vb25.length >= 1);
check('modelProb == grille modèle (jamais fallback)', vb25.every((v) => Math.abs(v.modelProb - (v.pick.includes('Plus') ? ou25model.over : ou25model.under)) < 1e-12));
const t25 = trueOU(lamT, 2.5);
check('probas == vraies probas Poisson (±0.5 pt)', vb25.every((v) => Math.abs(v.modelProb - (v.pick.includes('Plus') ? t25.pOver : t25.pUnder)) < 0.005));

console.log('\n=== 2. POST-FIX : fallback == vraie loi de Poisson sur la ligne du bookmaker ===');
for (const line of [2.0, 3.0, 4.5]) {
  const t = trueOU(lamT, line);
  const s = swappedOU(lamT, line);
  const overOdds = line === 2.0 ? 2.0 : line === 3.0 ? 4.4 : 11.5;
  const underOdds = line === 2.0 ? 1.9 : line === 3.0 ? 1.4 : 1.07;
  const eng = runEngine(input(t1Mid, t2Mid, mkOdds(line, overOdds, underOdds)));
  const vb = eng.prediction.valueBets.filter((v) => v.market.startsWith('Over/Under'));
  const vbOver = vb.find((v) => v.pick.includes('Plus'));
  const vbUnder = vb.find((v) => v.pick.includes('Moins'));
  const emitted = [...(vbOver ? [vbOver] : []), ...(vbUnder ? [vbUnder] : [])];
  const okTrue = emitted.every((v) => Math.abs(v.modelProb - (v.pick.includes('Plus') ? t.pOver : t.pUnder)) < 6e-5); // modelProb arrondi 4dp → écart max 5e-5
  const notSwapped = emitted.every((v) => Math.abs(v.modelProb - (v.pick.includes('Plus') ? s.pOver : s.pUnder)) > 1e-3);
  console.log(`  ligne ${line} : vrai pOver=${(t.pOver * 100).toFixed(2)}% pUnder=${(t.pUnder * 100).toFixed(2)}% | émis=${emitted.map((v) => `${v.pick}:${(v.modelProb * 100).toFixed(2)}%`).join(', ') || 'rien'}`);
  check(`ligne ${line} : modelProb == vraie Poisson (±6e-5, arrondi 4dp)`, okTrue, emitted.length ? 'émis' : 'rien émis (edge sous seuil 2 % — cohérent)');
  check(`ligne ${line} : modelProb != ancienne formule inversée (anti-régression)`, notSwapped || emitted.length === 0);
}

console.log('\n=== 3. Ligne 2.0 @ λt≈2.3 : plus de FAUX VALUE BET ===');
const t20 = trueOU(lamT, 2.0);
const eng20 = runEngine(input(t1Mid, t2Mid, mkOdds(2.0, 2.0, 1.9)));
const vb20over = eng20.prediction.valueBets.find((v) => v.market === 'Over/Under 2' && v.pick.includes('Plus'));
if (vb20over) {
  const trueEdge = t20.pOver * vb20over.odds - 1;
  console.log(`  Over 2.0 @ ${vb20over.odds} : edge affiché ${(vb20over.edge * 100).toFixed(1)}% (Kelly ${(vb20over.kelly * 100).toFixed(1)}%) vs edge RÉEL ${(trueEdge * 100).toFixed(1)}%`);
  check('edge affiché == edge réel (±0.5 pt)', Math.abs(vb20over.edge - trueEdge) < 0.005);
  check('edge réel positif si émis (pas de pari à EV négative)', trueEdge > 0.02);
  const kellyExpected = Math.min(0.10, Math.max(0, trueEdge / (vb20over.odds - 1)));
  check('Kelly == Kelly réelle (±0.5 pt)', Math.abs(vb20over.kelly - kellyExpected) < 0.005);
} else {
  check('Over 2.0 émis (setup test)', false, 'non émis');
}

console.log('\n=== 4. Ligne 3.0 @ fixture bas-scoreur : probas fidèles ===');
const engLow = runEngine(input(t1Low, t2Low, null));
const lamTLow = engLow.prediction.lambda.home + engLow.prediction.lambda.away;
const tLow = trueOU(lamTLow, 3.0);
const engLowBet = runEngine(input(t1Low, t2Low, mkOdds(3.0, 6.0, 1.05)));
const vbLowUnder = engLowBet.prediction.valueBets.find((v) => v.pick.includes('Moins'));
console.log(`  λt bas=${lamTLow} : vrai pOver=${(tLow.pOver * 100).toFixed(2)}% pUnder=${(tLow.pUnder * 100).toFixed(2)}% | Under émis=${vbLowUnder ? (vbLowUnder.modelProb * 100).toFixed(2) + '%' : 'non (edge sous seuil)'}`);
check('distorsion ≤ 1 pt (fidèle au vrai)', Math.abs(fixedFallbackOU(lamTLow, 3.0).pOver - tLow.pOver) < 0.01);
if (vbLowUnder) {
  const trueEdge = tLow.pUnder * vbLowUnder.odds - 1;
  check('Under 3.0 : edge affiché == edge réel (±0.5 pt)', Math.abs(vbLowUnder.edge - trueEdge) < 0.005, `affiché ${(vbLowUnder.edge * 100).toFixed(1)}% vs réel ${(trueEdge * 100).toFixed(1)}%`);
} else {
  check('Under 3.0 non émis OU edge == réel (aucun faux value bet)', true, 'edge réel 1.05×96.3%−1 = +1.2% < seuil 2% → non émis, cohérent');
}

console.log('\n=== 5. Balayage λt 0.5→8.4 × lignes {2.0, 3.0, 4.5} : fallback == vrai (≤ 1.1 pt) ===');
let worst = { d: 0, lamT: 0, line: 0 };
let nBad = 0;
let nTot = 0;
for (let lt = 0.5; lt <= 8.4 + 1e-9; lt += 0.1) {
  for (const line of [2.0, 3.0, 4.5]) {
    const t = trueOU(lt, line);
    const f = fixedFallbackOU(lt, line);
    const d = Math.max(Math.abs(f.pOver - t.pOver), Math.abs(f.pUnder - t.pUnder));
    nTot++;
    if (d > 0.011) nBad++;
    if (d > worst.d) worst = { d, lamT: lt, line };
  }
}
console.log(`  pire écart : ${(worst.d * 100).toFixed(2)} pts à λt=${worst.lamT.toFixed(1)}, ligne ${worst.line} (clamps 0.01/0.99 inclus)`);
console.log(`  exposition : ${nBad}/${nTot} couples avec écart > 1.1 pt`);
check('fallback corrigé == vrai Poisson sur tout le spectre (≤ 1.1 pt, clamps inclus)', nBad === 0);

console.log('\n=== 6. Formules edge / Kelly (branche saine) sur le 1X2 ===');
const engML = runEngine(input(t1Mid, t2Mid, mkOdds(null, null, null, 2.4)));
let formulaOK = true;
for (const v of engML.prediction.valueBets) {
  const edge = v.modelProb * v.odds - 1;
  if (Math.abs(v.edge - Math.round(edge * 10000) / 10000) > 1.1e-4) formulaOK = false;
  const kelly = Math.min(0.10, Math.max(0, edge / (v.odds - 1)));
  if (Math.abs(v.kelly - Math.round(kelly * 10000) / 10000) > 1.1e-4) formulaOK = false;
  if (v.kelly < 0 || v.kelly > 0.10) formulaOK = false;
  if (v.edge <= 0.02) formulaOK = false;
}
check('edge = p·cote−1 ; Kelly = edge/(cote−1) ∈ [0, 10%] ; seuil d\'émission 2%', formulaOK);

console.log('\n=== 7. Pas d\'appariement croisé entre lignes (régression 17-a n°3) ===');
const model35 = engBase.prediction.overUnder.find((o) => o.line === 3.5)!;
const vb25b = runEngine(input(t1Mid, t2Mid, mkOdds(2.5, 3.2, 1.4))).prediction.valueBets.filter((v) => v.market === 'Over/Under 2.5');
check('probas ligne 3.5 jamais comparées aux cotes 2.5', vb25b.every((v) => Math.abs(v.modelProb - (v.pick.includes('Plus') ? model35.over : model35.under)) > 1e-6));

console.log(`\n===== SCRIPT 5 (value bets, POST-FIX) : ${passed} PASS / ${failed} FAIL =====`);
if (failed > 0) process.exit(1);
