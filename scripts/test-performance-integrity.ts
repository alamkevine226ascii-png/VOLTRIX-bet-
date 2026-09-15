// ============================================================
// Task 21-a (FIX 1 + FIX 3) — intégrité de la mesure : ROI/accuracy
// Assertions PURES sur computePerformanceStats (src/lib/analyze.ts)
// — aucune dépendance au serveur ni à la DB.
//
// Constat audit (vérifié en base avant correctif) : 946 des 2 154
// pronos réglés n'avaient PAS de cote réelle (BTTS notamment) et
// l'ancien code les comptait comme cote 2.00 → faux ROI.
// ============================================================
import { computePerformanceStats, hasRealOdds, type PerfStatRow } from '../src/lib/analyze';

let pass = 0;
let fail = 0;
function check(label: string, cond: boolean, detail = '') {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}
function row(partial: Partial<PerfStatRow> & { id: string }): PerfStatRow {
  return {
    leagueName: 'Test League',
    market: '1X2',
    pick: '1 - X',
    probability: 0.5,
    odds: null,
    confidence: 3,
    resolved: true,
    result: 'WIN',
    ...partial,
  };
}

console.log('\n[1] hasRealOdds — une cote absente/≤ 1 n\'est pas une cote');
check('null → false', hasRealOdds(null) === false);
check('undefined → false', hasRealOdds(undefined) === false);
check('0 → false', hasRealOdds(0) === false);
check('1.0 → false (strictement > 1, règle historique conservée)', hasRealOdds(1.0) === false);
check('1.01 → true', hasRealOdds(1.01) === true);
check('2.5 → true', hasRealOdds(2.5) === true);

console.log('\n[2] FIX 1 — les sélections SANS cote réelle sont hors économique, dans le prédictif');
{
  const rows: PerfStatRow[] = [
    row({ id: 'a', result: 'WIN', odds: 1.85, probability: 0.6, market: '1X2' }),   // économique
    row({ id: 'b', result: 'WIN', odds: null, probability: 0.55, market: 'BTTS' }), // sans cote (BTTS)
    row({ id: 'c', result: 'LOSE', odds: 2.5, probability: 0.45, market: '1X2' }),  // économique
    row({ id: 'd', result: 'LOSE', odds: null, probability: 0.5, market: 'BTTS' }), // sans cote
    row({ id: 'e', result: 'WIN', odds: 1.0, probability: 0.7, market: 'O/U 2.5' }),// cote 1.00 → hors économique
  ];
  const s = computePerformanceStats(rows, 10);

  // Prédictif : TOUS les réglés WIN/LOSE
  check('totalResolved = 5 (avec ET sans cote)', s.totalResolved === 5, `got ${s.totalResolved}`);
  check('wins = 3 → winRate 0.6 (accuracy sur tous)', s.wins === 3 && Math.abs(s.winRate - 0.6) < 1e-12, `got ${s.wins}/${s.winRate}`);
  check('byMarket.BTTS.total = 2 (accuracy par marché inclut les sans-cote)', s.byMarket['BTTS']?.total === 2);

  // Économique : uniquement a (1.85) et c (2.5)
  check('economic.settledWithOdds = 2', s.economic.settledWithOdds === 2, `got ${s.economic.settledWithOdds}`);
  check('economic.staked = 20 (2 × 10 €)', s.economic.staked === 20, `got ${s.economic.staked}`);
  check('economic.returned = 18.5 (WIN 1.85 × 10 ; LOSE → 0)', s.economic.returned === 18.5, `got ${s.economic.returned}`);
  check('economic.roi = -7.5 %', Math.abs(s.economic.roi - -0.075) < 1e-12, `got ${s.economic.roi}`);
  check('staked/returned/roi top-level = bloc economic (compat JSON)',
    s.staked === s.economic.staked && s.returned === s.economic.returned && s.roi === s.economic.roi);

  // Preuve du défaut corrigé : l'ANCIEN code aurait compté b et e à 2.00 sur WIN
  // (a 1.85, b→2.00, c LOSE→0, d LOSE→0, e 1.00→2.00) : 58.5 retournés / 50 misés = +17 %
  const oldReturned = 1.85 * 10 + 2 * 10 + 2 * 10; // WIN a (1.85) + WIN b (2.00) + WIN e (2.00) ; LOSE → 0
  check('l\'ancien fallback 2.00 donnait ROI +17 % (faux) vs -7.5 % corrigé',
    oldReturned === 58.5 && s.roi < 0);

  // Brier sur tous (prédictif)
  const expectedBrier = ((0.6 - 1) ** 2 + (0.55 - 1) ** 2 + 0.45 ** 2 + 0.5 ** 2 + (0.7 - 1) ** 2) / 5;
  check('brierScore sur TOUS les réglés (5)', Math.abs(s.calibration.brierScore - expectedBrier) < 1e-12, `got ${s.calibration.brierScore}`);
  check('calibration.sample = 5', s.calibration.sample === 5);
  check('sample = { settled: 5, withOdds: 2, source: "full-history" }',
    s.sample.settled === 5 && s.sample.withOdds === 2 && s.sample.source === 'full-history');
}

console.log('\n[3] VOID et en attente — ni réussite ni perte, ni mise');
{
  const rows: PerfStatRow[] = [
    row({ id: 'w', result: 'WIN', odds: 2.0 }),
    row({ id: 'v', result: 'VOID', odds: 2.0 }),       // annulé → remboursé : hors métriques
    row({ id: 'p', resolved: false, result: null }),   // en attente
  ];
  const s = computePerformanceStats(rows, 10);
  check('VOID exclu de totalResolved', s.totalResolved === 1, `got ${s.totalResolved}`);
  check('VOID exclu du ROI (staked = 10, pas 30)', s.economic.staked === 10 && s.economic.settledWithOdds === 1, `got ${s.economic.staked}`);
  check('pendingCount = 1', s.pendingCount === 1);
  check('totalPredictions = 3', s.totalPredictions === 3);
  check('roi = 0.0 (2.00 gagnant)', Math.abs(s.roi - 1.0) < 1e-12, `got ${s.roi}`);
}

console.log('\n[4] Cas limites — zéro cote réelle, mise paramétrable');
{
  const rows: PerfStatRow[] = [row({ id: 'b1', result: 'WIN', odds: null }), row({ id: 'b2', result: 'LOSE', odds: null })];
  const s = computePerformanceStats(rows, 10);
  check('aucune cote → staked 0, roi 0 (pas de division par zéro)', s.economic.staked === 0 && s.economic.roi === 0);
  check('accuracy toujours calculée (winRate 0.5)', Math.abs(s.winRate - 0.5) < 1e-12);

  const s20 = computePerformanceStats(
    [row({ id: 'x', result: 'WIN', odds: 3.0 }), row({ id: 'y', result: 'LOSE', odds: 1.5 })],
    20
  );
  check('mise 20 € : staked 40, returned 60, roi +50 %',
    s20.economic.staked === 40 && s20.economic.returned === 60 && Math.abs(s20.economic.roi - 0.5) < 1e-12);
}

console.log('\n[5] Agrégats par marché / confiance / ligue + buckets de calibrage');
{
  const rows: PerfStatRow[] = Array.from({ length: 4 }, (_, i) =>
    row({ id: `k${i}`, result: i < 3 ? 'WIN' : 'LOSE', odds: 1.9, probability: 0.9 + i * 0.01, confidence: 4, leagueName: 'Ligue A' })
  );
  const s = computePerformanceStats(rows, 10);
  check('byConfidence["4"].total = 4, wins = 3', s.byConfidence['4']?.total === 4 && s.byConfidence['4']?.wins === 3);
  check('byLeague["Ligue A"].winRate = 0.75', Math.abs((s.byLeague['Ligue A']?.winRate ?? 0) - 0.75) < 1e-12);
  check('bucket 90-100 % rempli (proba ≥ 0.9)', s.calibration.buckets.some((b) => b.label === '90-100 %' && b.count === 4));
  check('buckets < 3 occurrences filtrés (une seule tranche ici)', s.calibration.buckets.length === 1);
  check('economic.settledWithOdds = 4 (tous avec cote 1.9)', s.economic.settledWithOdds === 4);
}

console.log(`\n=== ${pass} OK / ${fail} KO ===`);
if (fail > 0) process.exit(1);
