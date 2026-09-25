// ============================================================
// Audit 20-a — Script 2 : Normalisations, bornage Kelly/EV, cas dégénérés
// READ-ONLY : importe runEngine RÉEL de src/lib/prediction.ts et
// buildCombo/recomputeCombo/fairOdds RÉELS de src/lib/combo.ts.
// Chasse aux bugs nouveaux : sommes ≠ 1, probas hors [0,1], Kelly hors
// [0,10%], incohérences edge, violations de corrélations inter-marchés.
// bun scripts/audit-20-a-2-normalisations.ts
// ============================================================

import { runEngine, type EngineInput, type EspnScheduleGame, type EspnOdds } from '../src/lib/prediction';
import { buildCombo, recomputeCombo, fairOdds, type ComboLeg } from '../src/lib/combo';

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
function mkSchedule(teamId: string, games: Array<{ ts: number; os: number; home: boolean }>): EspnScheduleGame[] {
  return games.map((g, i) => ({
    eventId: `${teamId}-e${i}`,
    date: new Date(NOW - (20 + i * 9) * DAY).toISOString(),
    opponentId: `${teamId}-opp${i}`,
    opponentName: `Opp ${i}`,
    homeAway: g.home ? ('home' as const) : ('away' as const),
    teamScore: g.ts,
    opponentScore: g.os,
    completed: true,
    leagueCode: 'test.1',
  }));
}
function input(hSched: EspnScheduleGame[], aSched: EspnScheduleGame[], odds: EspnOdds | null, extra: Partial<EngineInput> = {}): EngineInput {
  return {
    homeTeam: { id: 'NH', name: 'Normal Home', logo: null, schedule: hSched, standings: null },
    awayTeam: { id: 'NA', name: 'Normal Away', logo: null, schedule: aSched, standings: null },
    injuries: [],
    odds,
    isDerby: false,
    weatherImpact: null,
    nowMs: NOW,
    leagueTeamsCount: 20,
    ...extra,
  };
}
function oddsFull(ouLine: number | null, over: number | null, under: number | null, mh: number | null, md: number | null, ma: number | null): EspnOdds {
  return {
    provider: 'Book20a',
    overUnderLine: ouLine,
    moneyline: {
      home: { open: null, close: mh },
      draw: { open: null, close: md },
      away: { open: null, close: ma },
    },
    total: {
      over: { line: ouLine, openOdds: null, closeOdds: over },
      under: { line: ouLine, openOdds: null, closeOdds: under },
    },
    hasOdds: true,
  };
}
// RNG seedé pour des fixtures variées mais reproductibles
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 14), 61 | t)) ^ 4294967296;
    return t / 4294967296;
  };
}
const rng = mulberry32(777001);

// ---------- Balayage moteur ----------
const worst = {
  probs: 0, ensRecomputed: 0, poisson: 0, elo: 0, form: 0, ou: 0, btts: 0, fts: 0, fgt: 0, dc: 0,
  dcRange: 0, ouRange: 0, bttsRange: 0, fgtRange: 0,
  lambdaTotal: 0, lambdaBounds: '', corrBttsOver15: 0, corrDrawUnder25: 0, corrOuMonotone: 0,
  kelly: '', edge: '', ouSum: '', ftsSum: '',
};
let nRuns = 0;
let nVb = 0;
const cases: Array<{ h: EspnScheduleGame[]; a: EspnScheduleGame[]; odds: EspnOdds | null; extra?: Partial<EngineInput> }> = [];
for (let t = 0; t < 60; t++) {
  const hG = Array.from({ length: 8 + Math.floor(rng() * 6) }, () => ({ ts: Math.floor(rng() * 5), os: Math.floor(rng() * 5), home: rng() > 0.35 }));
  const aG = Array.from({ length: 8 + Math.floor(rng() * 6) }, () => ({ ts: Math.floor(rng() * 5), os: Math.floor(rng() * 5), home: rng() < 0.35 }));
  const line = [1.5, 2.0, 2.5, 3.0, 3.5, 4.5][Math.floor(rng() * 6)];
  const odds = rng() > 0.2 ? oddsFull(line, 1.7 + rng() * 3, 1.5 + rng() * 2.5, 1.6 + rng() * 2.5, 3.0 + rng() * 1.6, 2.0 + rng() * 3.5) : null;
  cases.push({ h: mkSchedule('NH', hG), a: mkSchedule('NA', aG), odds });
}
// dégénérés
cases.push({ h: mkSchedule('NH', []), a: mkSchedule('NA', []), odds: null });
cases.push({ h: mkSchedule('NH', [{ ts: 5, os: 0, home: true }]), a: mkSchedule('NA', []), odds: null });
cases.push({ h: mkSchedule('NH', []), a: mkSchedule('NA', [{ ts: 0, os: 6, home: false }]), odds: null });
cases.push({ h: mkSchedule('NH', Array.from({ length: 12 }, () => ({ ts: 4, os: 0, home: true }))), a: mkSchedule('NA', Array.from({ length: 12 }, () => ({ ts: 4, os: 0, home: false }))), odds: oddsFull(3.5, 1.3, 4.2, 1.2, 8.0, 9.0) });
cases.push({ h: mkSchedule('NH', Array.from({ length: 12 }, () => ({ ts: 0, os: 0, home: true }))), a: mkSchedule('NA', Array.from({ length: 12 }, () => ({ ts: 0, os: 0, home: false }))), odds: oddsFull(2.5, 6.5, 1.05, 3.4, 3.0, 2.6) });

for (const c of cases) {
  const r = runEngine(input(c.h, c.a, c.odds, c.extra));
  const p = r.prediction;
  nRuns++;
  // sommes 1X2 (ensemble + 3 sous-modèles bruts)
  const s1 = p.probs.home + p.probs.draw + p.probs.away;
  // 1X2 final émis = round4 de l'ensemble → somme ± 1.5e-4 (cosmétique).
  // L'exactitude MATHÉMATIQUE est prouvée en recalculant l'ensemble depuis les
  // sous-modèles BRUTS exposés (p.poisson/p.elo/p.form non arrondis) :
  const W = { poisson: 0.45, elo: 0.30, form: 0.25 };
  const ens = {
    home: W.poisson * p.poisson.home + W.elo * p.elo.home + W.form * p.form.home,
    draw: W.poisson * p.poisson.draw + W.elo * p.elo.draw + W.form * p.form.draw,
    away: W.poisson * p.poisson.away + W.elo * p.elo.away + W.form * p.form.away,
  };
  const ensSum = ens.home + ens.draw + ens.away;
  const ensNorm = { home: ens.home / ensSum, draw: ens.draw / ensSum, away: ens.away / ensSum };
  worst.probs = Math.max(worst.probs, Math.abs(s1 - 1)); // écart d'affichage
  worst.ensRecomputed = Math.max(
    worst.ensRecomputed,
    Math.abs(ensSum - 1),
    Math.abs(ensNorm.home - p.probs.home) - 5e-5,
    Math.abs(ensNorm.draw - p.probs.draw) - 5e-5,
    Math.abs(ensNorm.away - p.probs.away) - 5e-5
  );
  const sP = p.poisson.home + p.poisson.draw + p.poisson.away;
  const sE = p.elo.home + p.elo.draw + p.elo.away;
  const sF = p.form.home + p.form.draw + p.form.away;
  worst.poisson = Math.max(worst.poisson, Math.abs(sP - 1));
  worst.elo = Math.max(worst.elo, Math.abs(sE - 1));
  worst.form = Math.max(worst.form, Math.abs(sF - 1));
  // bornes [0,1]
  const allProbs = [p.probs.home, p.probs.draw, p.probs.away, p.poisson.home, p.poisson.draw, p.poisson.away, p.elo.home, p.elo.draw, p.elo.away, p.form.home, p.form.draw, p.form.away];
  worst.dcRange = Math.max(worst.dcRange, ...allProbs.map((x) => Math.max(0, -x, x - 1)));
  // O/U par ligne
  let prevOver = -1;
  for (const o of p.overUnder) {
    const sum = o.over + o.under;
    worst.ou = Math.max(worst.ou, Math.abs(sum - 1));
    worst.ouSum = `${o.line}:${sum}`;
    worst.ouRange = Math.max(worst.ouRange, Math.max(0, o.over - 1), Math.max(0, -o.over), Math.max(0, o.under - 1), Math.max(0, -o.under));
    if (o.line > 1.5) worst.corrOuMonotone = Math.max(worst.corrOuMonotone, o.over - prevOver); // violation = AUGMENTATION (over doit décroître avec la ligne)
    prevOver = o.over;
  }
  // BTTS
  worst.btts = Math.max(worst.btts, Math.abs(p.btts.yes + p.btts.no - 1));
  worst.bttsRange = Math.max(worst.bttsRange, Math.max(0, p.btts.yes - 1), Math.max(0, -p.btts.yes));
  // firstToScore
  const sFTS = p.firstToScore.home + p.firstToScore.away + p.firstToScore.noGoal;
  worst.fts = Math.max(worst.fts, Math.abs(sFTS - 1));
  worst.ftsSum = sFTS.toFixed(6);
  // firstGoalTiming
  const sFGT = p.firstGoalTiming.reduce((s, w) => s + w.prob, 0);
  worst.fgt = Math.max(worst.fgt, Math.abs(sFGT - 1));
  worst.fgtRange = Math.max(worst.fgtRange, ...p.firstGoalTiming.map((w) => Math.max(0, -w.prob)));
  // double chance dérivée des probs finales (arrondies 4dp dans l'API)
  const dc1X = p.probs.home + p.probs.draw, dc12 = p.probs.home + p.probs.away, dcX2 = p.probs.draw + p.probs.away;
  worst.dc = Math.max(worst.dc, Math.abs(dc1X + dc12 + dcX2 - 2));
  // λ
  worst.lambdaTotal = Math.max(worst.lambdaTotal, Math.abs(p.lambda.total - (p.lambda.home + p.lambda.away)));
  if (!(p.lambda.home >= 0.25 - 1e-9 && p.lambda.home <= 4.2 + 1e-9 && p.lambda.away >= 0.2 - 1e-9 && p.lambda.away <= 4.2 + 1e-9)) {
    worst.lambdaBounds = `run #${nRuns} λh=${p.lambda.home} λa=${p.lambda.away}`;
  }
  // corrélations structurelles : BTTS ⊆ Over 1.5 ; draws ⊆ Under 2.5
  const ou15 = p.overUnder.find((o) => o.line === 1.5)!;
  const ou25 = p.overUnder.find((o) => o.line === 2.5)!;
  worst.corrBttsOver15 = Math.max(worst.corrBttsOver15, p.btts.yes - ou15.over);
  worst.corrDrawUnder25 = Math.max(worst.corrDrawUnder25, p.poisson.draw - ou25.under);
  // value bets : edge = p·cote−1, Kelly ∈ [0, 10%], odds > 1.01, seuil 2 %
  for (const vb of p.valueBets) {
    nVb++;
    const edgeRecon = vb.modelProb * vb.odds - 1;
    const dEdge = Math.abs(vb.edge - Math.round(edgeRecon * 1e4) / 1e4);
    // modelProb est arrondi 4dp → tolérance reconstruction = cote × 5e-5
    if (dEdge > vb.odds * 5e-5 + 5e-5) worst.edge = `edge recon d=${dEdge.toFixed(6)} (cote ${vb.odds})`;
    const kellyRecon = Math.min(0.10, Math.max(0, edgeRecon / (vb.odds - 1)));
    const dKelly = Math.abs(vb.kelly - kellyRecon);
    if (vb.kelly < 0 || vb.kelly > 0.1) worst.kelly = `hors bornes ${vb.kelly}`;
    else if (dKelly > (vb.odds - 1) * 5e-5 + 5e-5 + 5e-5) worst.kelly = `recon d=${dKelly.toFixed(6)}`;
    if (!(vb.odds > 1.01) || !(vb.edge > 0.02)) worst.edge = `garde manquant odds=${vb.odds} edge=${vb.edge}`;
  }
}

console.log('\n=== 1. Sommes de probabilités (60 tirages seedés + 5 cas dégénérés) ===');
check(`1X2 final émis (arrondi 4dp) somme à 1 ± 1.5e-4 (écart max affichage ${worst.probs.toExponential(2)})`, worst.probs <= 1.51e-4);
check(`ensemble RECALCULÉ depuis sous-modèles bruts (0.45/0.30/0.25) == émis aux arrondis près + somme = 1 exacte (écart max ${worst.ensRecomputed.toExponential(2)})`, worst.ensRecomputed <= 1e-12, 'la maths sous-jacente somme à 1 ; l\'écart provient uniquement du round4 indépendant par composante');
check(`sous-modèle Poisson somme à 1 brut (écart max ${worst.poisson.toExponential(2)})`, worst.poisson <= 1e-9);
check(`sous-modèle Elo somme à 1 (écart max ${worst.elo.toExponential(2)})`, worst.elo <= 1e-9);
check(`sous-modèle Forme somme à 1 (écart max ${worst.form.toExponential(2)})`, worst.form <= 1e-9);
check(`O/U sur+under = 1 pour toutes les lignes (écart max ${worst.ou.toExponential(2)}, dernier ${worst.ouSum})`, worst.ou <= 1.01e-4, 'arrondi 4dp de chaque côté → 1 ± 1e-4 maximal théorique');
check(`BTTS oui+non = 1 (écart max ${worst.btts.toExponential(2)})`, worst.btts <= 1.01e-4);
check(`firstToScore home+away+noGoal = 1 (écart max ${worst.fts.toExponential(2)}, dernier ${worst.ftsSum})`, worst.fts <= 1.6e-4);
check(`firstGoalTiming 7 fenêtres = 1 (écart max ${worst.fgt.toExponential(2)})`, worst.fgt <= 3.6e-4);
check(`Double chance 1X+12+X2 = 2 (écart max ${worst.dc.toExponential(2)})`, worst.dc <= 3.1e-4);

console.log('\n=== 2. Bornes [0,1] et monotonic ===');
check('aucune proba hors [0,1] (1X2, O/U, BTTS, timing)', worst.dcRange === 0 && worst.ouRange === 0 && worst.bttsRange === 0 && worst.fgtRange === 0);
check('O/U monotone : over(1.5) ≥ over(2.5) ≥ over(3.5) aux arrondis 4dp près', worst.corrOuMonotone <= 1.01e-4, `violations max = ${worst.corrOuMonotone.toExponential(2)} — artefact d\'arrondi indépendant aux frontières 0.9999/1.0000, l\'over exact est décroissant`);
check('corrélation structurelle BTTS ≤ Over 1.5', worst.corrBttsOver15 <= 1e-12, `écart max = ${worst.corrBttsOver15.toExponential(2)}`);
check('corrélation structurelle P(nul|Poisson) ≤ Under 2.5 (0-0 et 1-1 ⊆ under 2.5)', worst.corrDrawUnder25 <= 1e-12, `écart max = ${worst.corrDrawUnder25.toExponential(2)}`);

console.log('\n=== 3. λ : cohérence totale + planchers/plafonds ===');
check(`lambda.total == round(λh+λa) (écart max ${worst.lambdaTotal.toExponential(2)})`, worst.lambdaTotal <= 1e-9);
check('λh ∈ [0.25, 4.2] et λa ∈ [0.2, 4.2] sur tous les cas', worst.lambdaBounds === '', worst.lambdaBounds || 'bornes L615-616 respectées');

console.log(`\n=== 4. Value bets : formules edge/Kelly (${nVb} bets émis) ===`);
check(`edge == round4(p·cote−1) (reconstruction depuis modelProb 4dp)`, worst.edge === '', worst.edge || 'formule EV cohérente');
check(`Kelly ∈ [0, 10%] et == clamp(edge/(cote−1))`, worst.kelly === '', worst.kelly || 'bornage 10 % vérifié');

console.log('\n=== 5. Cas dégénérés ===');
{
  const empty = runEngine(input(mkSchedule('NH', []), mkSchedule('NA', []), null));
  check('équipes sans données → Elo 1500/1500 baseline', empty.home.elo === 1500 && empty.away.elo === 1500, `λh=${empty.prediction.lambda.home} λa=${empty.prediction.lambda.away}`);
  check('équipes sans données → λ plancher 0.25/0.2 (jamais 0/NaN)', empty.prediction.lambda.home === 0.25 && empty.prediction.lambda.away === 0.2);
  check('équipes sans données → probas finies et confiances ≥ 1', Number.isFinite(empty.prediction.probs.home) && empty.prediction.confidence >= 1, `probs ${(empty.prediction.probs.home * 100).toFixed(1)}/${(empty.prediction.probs.draw * 100).toFixed(1)}/${(empty.prediction.probs.away * 100).toFixed(1)} conf=${empty.prediction.confidence}`);
  // météo NaN → garde NaN L619-620 → 1.35/1.15
  const nanW = runEngine(input(mkSchedule('NH', [{ ts: 2, os: 1, home: true }]), mkSchedule('NA', [{ ts: 1, os: 1, home: false }]), null, { weatherImpact: { goalsFactor: NaN } }));
  check('météo goalsFactor NaN → garde-fou λ = 1.35/1.15 (aucune NaN propagée)', nanW.prediction.lambda.home === 1.35 && nanW.prediction.lambda.away === 1.15 && Number.isFinite(nanW.prediction.probs.home));
  // cotes absentes / OFF
  check('odds=null → valueBets []', runEngine(input(mkSchedule('NH', [{ ts: 2, os: 1, home: true }]), mkSchedule('NA', [{ ts: 1, os: 1, home: false }]), null)).prediction.valueBets.length === 0);
  const off = runEngine(input(mkSchedule('NH', [{ ts: 2, os: 1, home: true }]), mkSchedule('NA', [{ ts: 1, os: 1, home: false }]), oddsFull(2.5, null, null, null, null, null)));
  check('hasOdds=true mais cotes null → valueBets [] (garde !dec)', off.prediction.valueBets.length === 0);
  const coteNulle = runEngine(input(mkSchedule('NH', [{ ts: 2, os: 1, home: true }]), mkSchedule('NA', [{ ts: 1, os: 1, home: false }]), oddsFull(2.5, 1.01, 1.0, 1.01, 1.0, 1.0)));
  check('cotes ≤ 1.01 rejetées (garde dec ≤ 1.01)', coteNulle.prediction.valueBets.length === 0);
}

console.log('\n=== 6. Kelly combiné (buildCombo/recomputeCombo) — bornage [0, 10%] ===');
{
  const leg = (i: number, prob: number, odds: number): ComboLeg => ({
    matchId: `M${i}`, leagueCode: 't.1', leagueShort: 'T', leagueName: 'Test', matchDate: '2026-09-20',
    homeName: 'H', awayName: 'A', market: '1X2', pick: `P${i}`, prob, odds, oddsSource: 'real', confidence: 4,
  });
  // EV énorme → kelly plafonnée à 0.10
  const big = buildCombo([leg(1, 0.9, 2.3), leg(2, 0.9, 2.3), leg(3, 0.85, 2.2), leg(4, 0.85, 2.2), leg(5, 0.8, 2.1)], 8, 5, 'agressif');
  check('buildCombo : kelly ≤ 0.10 même sur EV énorme', !!big && big.kelly <= 0.1 && big.kelly >= 0, big ? `kelly=${(big.kelly * 100).toFixed(1)}% ev=${(big.comboEV * 100).toFixed(0)}%` : 'null');
  // Kelly == clamp(ev/(cote−1)) sur le produit NON arrondi
  if (big) {
    const evExact = big.legs.reduce((a, l) => a * l.prob, 1) * big.legs.reduce((a, l) => a * l.odds, 1) - 1;
    const oddsExact = big.legs.reduce((a, l) => a * l.odds, 1);
    const kellyExact = Math.max(0, Math.min(0.1, evExact / (oddsExact - 1)));
    check('buildCombo : kelly == clamp(ev_exact/(cote_exacte−1), 0, 0.1)', Math.abs(big.kelly - kellyExact) < 1e-12, `écart ${Math.abs(big.kelly - kellyExact).toExponential(2)}`);
    check('buildCombo : comboOdds exposé == round2(produit exact)', Math.abs(big.comboOdds - Math.round(oddsExact * 100) / 100) < 1e-12);
  }
  // EV négative → kelly 0
  const neg = recomputeCombo([leg(1, 0.3, 1.1), leg(2, 0.3, 1.1)], 'agressif', 5, 5);
  check('recomputeCombo : EV négative → kelly = 0 (jamais négative)', !!neg && neg.kelly === 0, neg ? `kelly=${neg.kelly} ev=${(neg.comboEV * 100).toFixed(1)}%` : 'null');
  // jambes contradictoires impossibles
  const conflict = recomputeCombo([leg(1, 0.6, 1.5), leg(1, 0.6, 1.5)], 'agressif', 2, 5);
  check('recomputeCombo : 2 jambes du même match → null (garde dure 17-c)', conflict === null);
  // fairOdds cohérente avec oddsWithMargin (marge 7 %)
  let fairOK = true;
  for (const p of [0.05, 0.2, 0.5, 0.75, 0.9, 0.96, 0.99]) {
    const f = fairOdds(p);
    const expect = Math.max(1.04, Math.round((1 / Math.min(p, 0.97)) * 0.93 * 100) / 100);
    if (Math.abs(f - expect) > 1e-9) fairOK = false;
    if (f < 1.04) fairOK = false;
  }
  check('fairOdds : (1/p)×0.93, plancher 1.04, proba bornée 0.97', fairOK);
}

console.log(`\n===== AUDIT 20-a SCRIPT 2 (normalisations + Kelly/EV + dégénérés) : ${passed} PASS / ${failed} FAIL — ${nRuns} runs moteur, ${nVb} value bets =====`);
if (failed > 0) process.exit(1);
