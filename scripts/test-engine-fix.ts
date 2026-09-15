// Test de non-régression du moteur de prédiction corrigé.
// Scénario 1 : deux équipes strictement moyennes (aux moyennes de ligue,
//   forme neutre ~0.46, pas de fatigue/blessures)
//   → λ attendu ≈ 1.52 / 1.22 (total 2.74), P(under 2.5) ≈ 48 %.
// Scénario 2 : échantillon minuscule (coupe, 2 matchs)
//   → λ restent proches des références (pas d'explosion).
// Scénario 3 : bornes réalistes + cohérence 1X2/firstToScore.
import { runEngine, type EngineInput } from '../src/lib/prediction';
import type { EspnScheduleGame } from '../src/lib/espn';

let evCounter = 0;
const NOW = Date.now();

function avgSchedule(): EspnScheduleGame[] {
  // 22 matchs à domicile ~ (GF 1.545 / GA 1.227), 22 à l'extérieur
  // ~ (GF 1.227 / GA 1.545), puis 6 matchs récents (W,L,D,W,L,D) qui
  // stabilisent la moyenne à GF_dom 1.52 / GA_dom 1.24 / GF_ext 1.24 /
  // GA_ext 1.52 avec une forme neutre (formScore ≈ 0.46 → facteur ≈ 0.99)
  // et zéro fatigue (tous à J-19 ou avant).
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
    ...Array(12).fill([1, 2]), ...Array(5).fill([1, 1]), ...Array(5).fill([2, 1]),
  ] as Array<[number, number]>;
  homePat.forEach(([gf, ga], i) => push('home', gf, ga, i));
  awayPat.forEach(([gf, ga], i) => push('away', gf, ga, 22 + i));
  // 6 récents (J-26 .. J-19) : W, L, D, W, L, D
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

function tinySchedule(): EspnScheduleGame[] {
  // Coupe : 2 matchs seulement (1 dom 3-0, 1 ext 0-2) — ratios bruts extrêmes
  const base = NOW - 20 * 86400000;
  return [
    { eventId: 't0', date: new Date(base).toISOString(), opponentId: 'o1', opponentName: 'O1', homeAway: 'home', teamScore: 3, opponentScore: 0, completed: true, leagueCode: 'cup.1' },
    { eventId: 't1', date: new Date(base + 7 * 86400000).toISOString(), opponentId: 'o2', opponentName: 'O2', homeAway: 'away', teamScore: 0, opponentScore: 2, completed: true, leagueCode: 'cup.1' },
  ];
}

function makeInput(homeSched: EspnScheduleGame[], awaySched: EspnScheduleGame[]): EngineInput {
  return {
    homeTeam: { id: 'H', name: 'Home FC', logo: null, schedule: homeSched, standings: null },
    awayTeam: { id: 'A', name: 'Away FC', logo: null, schedule: awaySched, standings: null },
    injuries: [],
    odds: null,
    isDerby: false,
    weatherImpact: null,
    nowMs: NOW,
    leagueTeamsCount: 20,
  };
}

function poissonUnder(lambdaTotal: number): number {
  const p0 = Math.exp(-lambdaTotal);
  const p1 = p0 * lambdaTotal;
  const p2 = (p1 * lambdaTotal) / 2;
  return p0 + p1 + p2;
}

let failed = false;

// ---------- Scénario 1 : équipes moyennes ----------
const r1 = runEngine(makeInput(avgSchedule(), avgSchedule()));
console.log('=== Scénario 1 : deux équipes moyennes (50 matchs, forme neutre) ===');
console.log(`λ home=${r1.prediction.lambda.home} (attendu ~1.52) | λ away=${r1.prediction.lambda.away} (attendu ~1.22)`);
console.log(`λ total=${r1.prediction.lambda.total} (attendu ~2.74) | P(under 2.5)=${(poissonUnder(r1.prediction.lambda.total) * 100).toFixed(1)}% (référence ~48%)`);
const ou25 = r1.prediction.overUnder.find((o) => o.line === 2.5)!;
console.log(`Modèle O/U 2.5 : over ${(ou25.over * 100).toFixed(1)}% / under ${(ou25.under * 100).toFixed(1)}%`);
const gap1 = Math.abs(r1.prediction.lambda.total - 2.74);
const pass1 = gap1 < 0.25;
if (!pass1) failed = true;
console.log(pass1 ? '✓ PASS (λ total dans ±0.25 de la référence)' : `✗ FAIL (écart ${gap1.toFixed(2)})`);

// ---------- Scénario 2 : échantillon minuscule (coupe) ----------
const r2 = runEngine(makeInput(tinySchedule(), tinySchedule()));
console.log('\n=== Scénario 2 : historique coupe (2 matchs, ratios bruts 3.0/0.0) ===');
console.log(`λ home=${r2.prediction.lambda.home} | λ away=${r2.prediction.lambda.away} | total=${r2.prediction.lambda.total}`);
const gap2 = Math.abs(r2.prediction.lambda.total - 2.74);
const pass2 = gap2 < 0.9;
if (!pass2) failed = true;
console.log(pass2 ? "✓ PASS (pas d'explosion malgré l'échantillon minuscule)" : `✗ FAIL (écart ${gap2.toFixed(2)})`);

// ---------- Scénario 3 : bornes ----------
const r3 = runEngine(makeInput(avgSchedule(), avgSchedule()));
console.log('\n=== Scénario 3 : bornes et cohérence ===');
const b1 = r3.prediction.lambda.home <= 3.8 && r3.prediction.lambda.home >= 0.3;
const b2 = r3.prediction.lambda.away <= 3.4 && r3.prediction.lambda.away >= 0.25;
if (!b1 || !b2) failed = true;
console.log(`λ home=${r3.prediction.lambda.home} ∈ [0.3, 3.8] ? ${b1} | λ away=${r3.prediction.lambda.away} ∈ [0.25, 3.4] ? ${b2}`);
const sum1x2 = r3.prediction.probs.home + r3.prediction.probs.draw + r3.prediction.probs.away;
console.log(`1X2: home ${(r3.prediction.probs.home * 100).toFixed(1)}% / nul ${(r3.prediction.probs.draw * 100).toFixed(1)}% / away ${(r3.prediction.probs.away * 100).toFixed(1)}% (somme ${(sum1x2 * 100).toFixed(1)}%)`);
const fts = r3.prediction.firstToScore;
console.log(`firstToScore: home=${fts.home} away=${fts.away} noGoal=${fts.noGoal} (somme=${(fts.home + fts.away + fts.noGoal).toFixed(3)})`);
const sumOk = Math.abs(sum1x2 - 1) < 0.01;
if (!sumOk) failed = true;
console.log(sumOk ? '✓ PASS (sommes cohérentes)' : '✗ FAIL (sommes incohérentes)');

process.exit(failed ? 1 : 0);
