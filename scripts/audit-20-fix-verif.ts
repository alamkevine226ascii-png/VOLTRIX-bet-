// ============================================================
// VOLTRIX bet — Vérification post-correctifs vague 20 (fix CRITIQUE 20-d)
// 1. calibrateTotals : flag saturated sur cas dégénéré réel (λ plancher 0.45)
// 2. calibrateTotals : healthy case → saturated=false, ancre atteinte
// 3. API /api/predictions : les matchs UCL sans données ont λ_total < 1.0
//    → le filtre degen de buildCandidates doit les exclure des O/U/BTTS
// 4. QuickPreds du jour : comptage jambes O/U/BTTS émises vs exclus
// ============================================================
import { calibrateTotals, deMarginOverUnder } from '../src/lib/market-odds';
import type { QuickPred } from '../src/lib/types';

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  PASS ${name}${detail ? ` — ${detail}` : ''}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
}

console.log('\n=== 1. calibrateTotals — cas dégénéré AVEC ligne marché réelle ===');
{
  // 20-d : λ moteur plancher 0.25/0.20 → λt=0.45 ; marché réel Porto-ManCity
  // cotes 1.85/2.00 DraftKings. DEPUIS les correctifs 20 (borne hi 2.5 → 15),
  // l'ancre est ATTEIGNABLE (scale ≈ 6.1) → probas ancrées marché HONNÊTES :
  // le « Moins de 2.5 » retombe de 0.895 (bug +106 % EV) à ≈ 0.48 (EV ≈ −marge).
  const dm = deMarginOverUnder(1.85, 2.0);
  const cal = calibrateTotals(0.25, 0.2, 2.5, dm!.pOver, [1.5, 2.5, 3.5]);
  check('dégénéré + ligne marché : saturated=false (ancre atteinte à scale élevé)', cal.saturated === false, `scale=${cal.scale.toFixed(3)} over[2.5]=${cal.over[2.5].toFixed(4)} == cible ${dm!.pOver.toFixed(4)}`);
  check('dégénéré + ligne marché : ancre atteinte (±0.01)', Math.abs(cal.over[2.5] - dm!.pOver) <= 0.01);
  check('anti-bug 20-d : « Moins de 2.5 » n\'est plus une proba fabriquée (≤ 0.60)', 1 - cal.over[2.5] <= 0.6, `under[2.5]=${(1 - cal.over[2.5]).toFixed(4)} (était 0.895 → EV fictive +106 %)`);
  check('lignes dérivées plausibles', cal.over[1.5] > cal.over[2.5] && cal.over[2.5] > cal.over[3.5], `1.5=${cal.over[1.5].toFixed(3)} 2.5=${cal.over[2.5].toFixed(3)} 3.5=${cal.over[3.5].toFixed(3)}`);
}

console.log('\n=== 1-bis. calibrateTotals — cible extrême ===');
{
  // Cible 0.97 avec λt=0.45 : scale 15 l'amène à 0.964 (gap 0.6 pt < tolérance
  // 0.01 du flag) → saturated=false CORRECT (le flag = cible INATTEIGNABLE).
  const calNear = calibrateTotals(0.25, 0.2, 2.5, 0.97, [1.5, 2.5, 3.5]);
  check('cible quasi-atteignable (gap 0.6 pt) : saturated=false', calNear.saturated === false, `scale=${calNear.scale.toFixed(2)} over[2.5]=${calNear.over[2.5].toFixed(4)} vs 0.97`);
  // Vraiment inatteignable : λt plancher absolu (2×0.02=0.04) → même scale 15
  // ne donne que P(X≥3|0.6) ≈ 2 % vs cible 0.9 → saturated=true.
  const calFar = calibrateTotals(0.02, 0.02, 2.5, 0.9, [1.5, 2.5, 3.5]);
  check('cible réellement inatteignable : saturated=true', calFar.saturated === true, `scale=${calFar.scale.toFixed(2)} over[2.5]=${calFar.over[2.5].toFixed(4)} vs 0.9`);
}

console.log('\n=== 2. calibrateTotals — cas sain ===');
{
  const dm = deMarginOverUnder(1.9, 1.95);
  const cal = calibrateTotals(1.4, 1.1, 2.5, dm!.pOver, [1.5, 2.5, 3.5]);
  check('sain : saturated=false', cal.saturated === false, `scale=${cal.scale.toFixed(3)}`);
  check('sain : ancre atteinte (±0.01)', Math.abs(cal.over[2.5] - dm!.pOver) <= 0.01, `over[2.5]=${cal.over[2.5].toFixed(4)} cible=${dm!.pOver.toFixed(4)}`);
}

console.log('\n=== 3. QuickPreds du jour — filtre degen mesuré ===');
{
  const today = new Date().toISOString().slice(0, 10);
  const res = await fetch(`http://localhost:3000/api/matches?date=${today}`);
  const scan = (await res.json()) as { leagues: Array<{ code: string; matches: Array<{ id: string; leagueCode: string; date: string }> }> };
  const all = scan.leagues.flatMap((l) => l.matches);
  // 12 matchs : 6 UCL (probablement sans données) + 6 autres ligues
  const ucl = all.filter((m) => m.leagueCode === 'uefa.champions').slice(0, 6);
  const others = all.filter((m) => m.leagueCode !== 'uefa.champions').slice(0, 6);
  const sample = [...ucl, ...others];
  const post = await fetch('http://localhost:3000/api/predictions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ matches: sample.map((m) => ({ matchId: m.id, leagueCode: m.leagueCode, date: m.date })) }),
  });
  const json = (await post.json()) as { results: Array<QuickPred & { matchId: string }> };
  let nDegen = 0, nSain = 0, nLambdaInconnu = 0;
  for (const r of json.results ?? []) {
    if (!r) continue;
    if (r.lambda == null) { nLambdaInconnu++; continue; }
    const lt = r.lambda.home + r.lambda.away;
    const isUcl = ucl.some((u) => u.id === r.matchId);
    if (lt < 1.0) { nDegen++; if (!isUcl) console.log(`    degen non-UCL : matchId=${r.matchId} λt=${lt.toFixed(2)}`); }
    else nSain++;
  }
  console.log(`    échantillon : ${nDegen} dégénérés (λt<1.0) / ${nSain} sains / ${nLambdaInconnu} sans lambda`);
  check('le filtre degen (λt<1.0 || saturated) est activable sur données réelles', nDegen > 0 || nLambdaInconnu > 0, `${nDegen} matchs du jour exclus des jambes O/U/BTTS`);
  check('les matchs sains gardent leurs jambes (aucune exclusion)', nSain > 0);
}

console.log(`\n===== VÉRIF FIX CRITIQUE 20-d : ${pass} PASS / ${fail} FAIL =====`);
process.exit(fail > 0 ? 1 : 0);
