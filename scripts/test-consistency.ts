// ============================================================
// VOLTRIX bet — Task 21-b : cohérence du moteur
// Un MÊME match (λ déterministes + cotes factices) doit donner :
//   1) des probabilités O/U + BTTS IDENTIQUES entre la sortie
//      runEngine et le chemin du Combinator (écart max 1e-9),
//      y compris après sérialisation JSON (como /api/predictions) ;
//   2) un BTTS conforme à la forme fermée (1 − e^−λh)(1 − e^−λa)
//      (écart max 1e-6) — la même formule que market-odds.ts ;
//   3) une somme 1X2 = 1 exactement (précision machine ≤ 1e-9,
//      et exactement 1 à la précision d'affichage 4 décimales).
// Bonus Task 21-b : value non circulaire (valueBets sur le BRUT),
// météo sans influence sur les λ, confiance = formule × consensus argmax.
// bun scripts/test-consistency.ts
// ============================================================

import { runEngine, type EngineInput, type MatchPrediction } from '../src/lib/prediction';
import type { EspnOdds, EspnScheduleGame } from '../src/lib/espn';
import { bttsProb, calibrateTotals, deMarginOverUnder, oddsWithMargin } from '../src/lib/market-odds';
import type { ComboLeg } from '../src/lib/combo';

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    passed++;
    console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const NOW = Date.now();

// ---------- Schedule déterministe (λ stables ≈ 1.5 / 1.2, cf. test-engine-fix) ----------
let evCounter = 0;
function avgSchedule(): EspnScheduleGame[] {
  const games: EspnScheduleGame[] = [];
  const push = (homeAway: 'home' | 'away', gf: number, ga: number, i: number) => {
    games.push({
      eventId: `e${evCounter}-${homeAway}${i}`,
      date: new Date(NOW - (300 - i * 10) * 86400000).toISOString(),
      opponentId: `o${evCounter}-${homeAway}${i}`,
      opponentName: `Opp ${i}`,
      homeAway,
      teamScore: gf,
      opponentScore: ga,
      completed: true,
      leagueCode: 'test.1',
    });
  };
  const homePat: Array<[number, number]> = [
    ...Array(12).fill([2, 1]), ...Array(5).fill([1, 1]), ...Array(5).fill([1, 2]),
  ] as Array<[number, number]>;
  const awayPat: Array<[number, number]> = [
    ...Array(12).fill([1, 2]), ...Array(5).fill([1, 1]), ...Array(2).fill([2, 1]),
  ] as Array<[number, number]>;
  homePat.forEach(([gf, ga], i) => push('home', gf, ga, i));
  awayPat.forEach(([gf, ga], i) => push('away', gf, ga, 22 + i));
  const recent: Array<['home' | 'away', number, number]> = [
    ['home', 2, 1], ['away', 1, 2], ['home', 1, 1], ['away', 2, 1], ['home', 1, 2], ['away', 1, 1],
  ];
  recent.forEach(([ha, gf, ga], i) => {
    games.push({
      eventId: `e${evCounter}-r${i}`,
      date: new Date(NOW - (26 - i * 1.5) * 86400000).toISOString(),
      opponentId: `o${evCounter}-r${i}`,
      opponentName: `OppR ${i}`,
      homeAway: ha,
      teamScore: gf,
      opponentScore: ga,
      completed: true,
      leagueCode: 'test.1',
    });
  });
  evCounter++;
  return games;
}

// ---------- Cotes factices (ligne 2.5, over chère → value brute attendue) ----------
const FAKE_ODDS: EspnOdds = {
  provider: 'TestBook',
  overUnderLine: 2.5,
  moneyline: {
    home: { open: 1.9, close: 1.85 },
    draw: { open: 3.7, close: 3.6 },
    away: { open: 4.4, close: 4.2 },
  },
  total: {
    over: { line: 2.5, openOdds: 2.0, closeOdds: 2.05 },
    under: { line: 2.5, openOdds: 1.85, closeOdds: 1.8 },
  },
  hasOdds: true,
};

function makeInput(odds: EspnOdds | null, weatherGoalsFactor: number | null): EngineInput {
  return {
    homeTeam: { id: 'H', name: 'Home FC', logo: null, schedule: avgSchedule(), standings: null },
    awayTeam: { id: 'A', name: 'Away FC', logo: null, schedule: avgSchedule(), standings: null },
    injuries: [],
    odds,
    isDerby: false,
    weatherImpact: weatherGoalsFactor !== null ? { goalsFactor: weatherGoalsFactor } : null,
    nowMs: NOW,
    leagueTeamsCount: 20,
  };
}

// ---------- Chemin Combinator (réplique EXACTE de src/app/combo/page.tsx) ----------
// Task 21-b : p.overUnder / p.btts consommés DIRECTEMENT (déjà calibrés par
// runEngine) — aucune re-calibration. realOu ne sert qu'aux cotes.
const LINES = [1.5, 2.5, 3.5];
interface ComboPredLike {
  probs: { home: number; draw: number; away: number };
  lambda: { home: number; away: number; total: number };
  overUnder: Array<{ line: number; over: number; under: number }>;
  btts: { yes: number; no: number };
  ouOdds: { line: number | null; over: number | null; under: number | null } | null;
}
function comboLegsFrom(pred: ComboPredLike): ComboLeg[] {
  const legs: ComboLeg[] = [];
  const base = { matchId: 'X1', leagueCode: 'tst.1', leagueShort: 'TST', leagueName: 'Test', matchDate: '2026-01-01T18:00Z', homeName: 'Home FC', awayName: 'Away FC', homeLogo: null, awayLogo: null, confidence: 3 };
  const realOu =
    pred.ouOdds?.line != null && pred.ouOdds?.over != null && pred.ouOdds?.under != null
      ? { line: pred.ouOdds.line, over: pred.ouOdds.over, under: pred.ouOdds.under }
      : null;
  for (const line of LINES) {
    const modelLine = pred.overUnder.find((o) => o.line === line);
    const isRealLine = realOu != null && Math.abs(realOu.line - line) < 0.01;
    const overP = modelLine?.over ?? 0;
    const underP = modelLine?.under ?? 0;
    if (!Number.isFinite(overP) || !Number.isFinite(underP) || overP <= 0.02 || underP <= 0.02) continue;
    const derivedSource: ComboLeg['oddsSource'] = realOu != null ? 'market' : 'estimate';
    legs.push({ ...base, market: `O/U ${line}`, pick: `Plus de ${line} buts`, prob: overP, odds: isRealLine ? realOu!.over! : oddsWithMargin(overP), oddsSource: isRealLine ? 'real' : derivedSource });
    legs.push({ ...base, market: `O/U ${line}`, pick: `Moins de ${line} buts`, prob: underP, odds: isRealLine ? realOu!.under! : oddsWithMargin(underP), oddsSource: isRealLine ? 'real' : derivedSource });
  }
  legs.push({ ...base, market: 'BTTS', pick: 'Les 2 équipes marquent : Oui', prob: pred.btts.yes, odds: 1 / pred.btts.yes, oddsSource: 'estimate' });
  legs.push({ ...base, market: 'BTTS', pick: 'Les 2 équipes marquent : Non', prob: pred.btts.no, odds: 1 / pred.btts.no, oddsSource: 'estimate' });
  return legs;
}

function toComboPred(p: MatchPrediction, odds: EspnOdds | null): ComboPredLike {
  return {
    probs: p.probs,
    lambda: p.lambda,
    overUnder: p.overUnder,
    btts: p.btts,
    ouOdds:
      odds && odds.hasOdds
        ? { line: odds.overUnderLine, over: odds.total.over.closeOdds ?? odds.total.over.openOdds, under: odds.total.under.closeOdds ?? odds.total.under.openOdds }
        : null,
  };
}

const maxDiff = (a: number[], b: number[]): number => Math.max(...a.map((x, i) => Math.abs(x - b[i])));

// ============================================================
console.log('\n=== CAS A : même match AVEC cotes factices (calibration active) ===');
// ============================================================
const pA = runEngine(makeInput(FAKE_ODDS, null)).prediction;

// A.1 — référence de calibration indépendante (l'ancien chemin du Combinator,
// désormais exécuté UNIQUEMENT dans runEngine) : deMargin + calibrateTotals
// sur p.lambda et la ligne marché.
const dmA = deMarginOverUnder(FAKE_ODDS.total.over.closeOdds!, FAKE_ODDS.total.under.closeOdds!);
check('deMarginOverUnder(cotes factices) valide', dmA !== null);
if (dmA) {
  const calA = calibrateTotals(pA.lambda.home, pA.lambda.away, FAKE_ODDS.overUnderLine!, dmA.pOver, LINES);
  const overDiff = maxDiff(pA.overUnder.map((o) => o.over), LINES.map((l) => round4(calA.over[l])));
  check('runEngine = calibration de référence (O/U, arrondi 4 déc.)', overDiff <= 5.1e-5, `écart max ${overDiff.toExponential(2)}`);
  check('runEngine = calibration de référence (BTTS, ≤1e-9)', Math.abs(pA.btts.yes - calA.btts) <= 1e-9, `écart ${Math.abs(pA.btts.yes - calA.btts).toExponential(2)}`);
  check('la calibration a bien DÉPLACÉ les probabilités (≠ brut)', Math.abs(pA.overUnder.find((o) => o.line === 2.5)!.over - pA.raw.overUnder.find((o) => o.line === 2.5)!.over) > 0.01, `calibré ${(pA.overUnder.find((o) => o.line === 2.5)!.over).toFixed(4)} vs brut ${(pA.raw.overUnder.find((o) => o.line === 2.5)!.over).toFixed(4)}`);
}

// A.2 — LA condition d'audit : runEngine ↔ chemin Combinator IDENTIQUES (≤1e-9),
// y compris via le round-trip JSON (comme /api/predictions → QuickPred → combo).
const viaJson: ComboPredLike = JSON.parse(JSON.stringify(toComboPred(pA, FAKE_ODDS)));
const legsCombo = comboLegsFrom(viaJson);
const legOver25 = legsCombo.find((l) => l.market === 'O/U 2.5' && l.pick.startsWith('Plus de'))!;
const legUnder25 = legsCombo.find((l) => l.market === 'O/U 2.5' && l.pick.startsWith('Moins de'))!;
const legBttsYes = legsCombo.find((l) => l.market === 'BTTS' && l.pick.endsWith('Oui'))!;
const legBttsNo = legsCombo.find((l) => l.market === 'BTTS' && l.pick.endsWith('Non'))!;
const dOu = maxDiff(
  [legOver25.prob, legUnder25.prob],
  [pA.overUnder.find((o) => o.line === 2.5)!.over, pA.overUnder.find((o) => o.line === 2.5)!.under]
);
const dBtts = Math.max(Math.abs(legBttsYes.prob - pA.btts.yes), Math.abs(legBttsNo.prob - pA.btts.no));
check('Combinator ≡ runEngine — O/U 2.5 (≤1e-9, JSON round-trip)', dOu <= 1e-9, `écart ${dOu.toExponential(2)}`);
check('Combinator ≡ runEngine — BTTS oui/non (≤1e-9, JSON round-trip)', dBtts <= 1e-9, `écart ${dBtts.toExponential(2)}`);
check('Combinator ≡ runEngine — toutes lignes O/U (≤1e-9)', maxDiff(
  LINES.flatMap((l) => {
    const e = pA.overUnder.find((o) => o.line === l)!;
    const ov = legsCombo.find((x) => x.market === `O/U ${l}` && x.pick.startsWith('Plus de'))!;
    const un = legsCombo.find((x) => x.market === `O/U ${l}` && x.pick.startsWith('Moins de'))!;
    return [ov.prob - e.over, un.prob - e.under];
  }),
  LINES.flatMap(() => [0, 0])
) <= 1e-9);
check('cote jambe réelle = cote marché factice (produit exact préservé)', legOver25.odds === 2.05 && legUnder25.odds === 1.8);

// A.3 — value NON circulaire : la value bet O/U 2.5 doit être calculée sur le
// BRUT (indépendant du marché), pas sur le calibré (recalé SUR le même marché).
const rawOver25 = pA.raw.overUnder.find((o) => o.line === 2.5)!.over;
const calOver25 = pA.overUnder.find((o) => o.line === 2.5)!.over;
const vb = pA.valueBets.find((v) => v.market === 'Over/Under 2.5' && v.pick.startsWith('Plus de'));
check('value bet O/U 2.5 présente (edge brute > 2 %)', vb !== undefined, vb ? `edge ${vb.edge}` : 'absente');
if (vb) {
  check('edge calculée sur le BRUT : modelProb = raw over 2.5', Math.abs(vb.modelProb - round4(rawOver25)) <= 1e-9, `modelProb ${vb.modelProb} vs raw ${round4(rawOver25)}`);
  check('value non circulaire : modelProb ≠ calibré', Math.abs(vb.modelProb - calOver25) > 0.01, `brut ${round4(rawOver25)} vs calibré ${calOver25}`);
  check('edge cohérente : modelProb × cote − 1', Math.abs(vb.edge - round4(vb.modelProb * 2.05 - 1)) <= 1e-9);
}

// ============================================================
console.log('\n=== CAS B : même match SANS cotes (brut conservé) ===');
// ============================================================
const pB = runEngine(makeInput(null, null)).prediction;

// B.1 — BTTS = forme fermée (MÊME formule que market-odds.ts), ≤1e-6
const closedFormB = (1 - Math.exp(-pB.lambda.home)) * (1 - Math.exp(-pB.lambda.away));
const sharedFormB = bttsProb(pB.lambda.home, pB.lambda.away);
check('BTTS ≈ forme fermée (1−e^−λh)(1−e^−λa), ≤1e-6', Math.abs(pB.btts.yes - closedFormB) <= 1e-6, `écart ${Math.abs(pB.btts.yes - closedFormB).toExponential(2)}`);
check('BTTS ≡ bttsProb(market-odds.ts) — formule partagée', pB.btts.yes === sharedFormB);
check('BTTS oui + non = 1 (précision machine ≤1e-15)', Math.abs(pB.btts.yes + pB.btts.no - 1) <= 1e-15);

// B.2 — sans cotes : p.overUnder / p.btts = brut (identité)
check('sans cotes : overUnder ≡ raw.overUnder', JSON.stringify(pB.overUnder) === JSON.stringify(pB.raw.overUnder));
check('sans cotes : btts ≡ raw.btts', pB.btts.yes === pB.raw.btts.yes && pB.btts.no === pB.raw.btts.no);

// B.3 — chemin Combinator sans cotes : identité ≤1e-9
const legsB = comboLegsFrom(JSON.parse(JSON.stringify(toComboPred(pB, null))));
const dOuB = maxDiff(
  LINES.flatMap((l) => {
    const e = pB.overUnder.find((o) => o.line === l)!;
    const ov = legsB.find((x) => x.market === `O/U ${l}` && x.pick.startsWith('Plus de'))!;
    const un = legsB.find((x) => x.market === `O/U ${l}` && x.pick.startsWith('Moins de'))!;
    return [ov.prob - e.over, un.prob - e.under];
  }),
  LINES.flatMap(() => [0, 0])
);
check('Combinator ≡ runEngine sans cotes — O/U (≤1e-9)', dOuB <= 1e-9, `écart ${dOuB.toExponential(2)}`);
check('Combinator ≡ runEngine sans cotes — BTTS (≤1e-9)', Math.max(
  Math.abs(legsB.find((x) => x.pick.endsWith('Oui'))!.prob - pB.btts.yes),
  Math.abs(legsB.find((x) => x.pick.endsWith('Non'))!.prob - pB.btts.no)
) <= 1e-9);

// ============================================================
console.log('\n=== SOMMES EXACTES (1X2, O/U) — cas A et B ===');
// ============================================================
for (const [label, p] of [['A (cotes)', pA], ['B (brut)', pB]] as Array<[string, MatchPrediction]>) {
  const sum = p.probs.home + p.probs.draw + p.probs.away;
  check(`[${label}] somme 1X2 = 1 (précision machine ≤1e-9)`, Math.abs(sum - 1) <= 1e-9, `somme ${sum}`);
  check(`[${label}] somme 1X2 = 1 EXACTEMENT à l'affichage (4 déc.)`, Math.round(sum * 10000) === 10000);
  const sumPoisson = p.poisson.home + p.poisson.draw + p.poisson.away;
  check(`[${label}] somme Poisson (grille renormalisée) = 1 (≤1e-12)`, Math.abs(sumPoisson - 1) <= 1e-12, `écart ${Math.abs(sumPoisson - 1).toExponential(2)}`);
  const ouOk = p.overUnder.every((o) => Math.round((o.over + o.under) * 10000) === 10000);
  check(`[${label}] over + under ≡ 1 exactement (lignes 1.5/2.5/3.5)`, ouOk);
}

// ============================================================
console.log('\n=== FIX 3 — confiance = formule × consensus ARGMAX ===');
// ============================================================
// La formule de confiance est conservée, le critère devenant un vrai
// consensus d'argmax : on reconstruit la valeur attendue depuis les sorties
// (poisson / elo / form exportés) et on vérifie que confidence la respecte.
function argmaxOutcome(p: { home: number; draw: number; away: number }): 'home' | 'draw' | 'away' {
  return p.home >= p.draw && p.home >= p.away ? 'home' : p.away >= p.home && p.away >= p.draw ? 'away' : 'draw';
}
for (const [label, p] of [['A (cotes)', pA], ['B (brut)', pB]] as Array<[string, MatchPrediction]>) {
  const models = [p.poisson, p.elo, p.form];
  const consensus = models.every((m) => argmaxOutcome(m) === argmaxOutcome(models[0]));
  const ranked = [
    { k: 'home', v: p.probs.home },
    { k: 'draw', v: p.probs.draw },
    { k: 'away', v: p.probs.away },
  ].sort((a, b) => b.v - a.v);
  const gap = ranked[0].v - ranked[1].v;
  const dataBonus = 0.5 + 0.5; // 50+ matchs par équipe dans le harnais
  const expected = Math.round(Math.min(5, Math.max(1, 1 + Math.min(2, Math.max(0, gap * 10)) + (consensus ? 1 : 0) + dataBonus)));
  check(`[${label}] confiance = 1 + gap×10 (≤2) + consensus argmax + données`, p.confidence === expected, `modèles argmax=[${models.map(argmaxOutcome).join(',')}] consensus=${consensus} → attendu ${expected}, obtenu ${p.confidence}`);
}

// ============================================================
console.log('\n=== FIX 5 — la météo n\'influence plus les λ (descriptive) ===');
// ============================================================
const pWx = runEngine(makeInput(FAKE_ODDS, 0.95)).prediction;
check('λ identiques avec/sans weatherImpact (influence retirée)', pWx.lambda.home === pA.lambda.home && pWx.lambda.away === pA.lambda.away, `λ ${pWx.lambda.home}/${pWx.lambda.away} vs ${pA.lambda.home}/${pA.lambda.away}`);
check('probabilités identiques avec/sans weatherImpact', pWx.overUnder.every((o, i) => o.over === pA.overUnder[i].over) && pWx.btts.yes === pA.btts.yes);

// ============================================================
console.log(`\n=== RÉSULTAT : ${passed} OK · ${failed} ÉCHEC(S) ===`);
if (failed > 0) process.exit(1);

function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}
