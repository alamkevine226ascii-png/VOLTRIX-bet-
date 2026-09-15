// ============================================================
// VOLTRIX bet — Task 22-b : instrument d'ablation contextMode
// (plan V2→V3 étape 11 — décomposer VOLTRIX : blend Poisson+Elo+forme
//  SANS modificateurs de contexte vs VOLTRIX complet)
//
// (a) runEngine SANS le champ ≡ runEngine contextMode:'full'
//     (identité exacte — JSON identique + écarts numériques ≤ 1e-12)
// (b) 'mix' neutralise bien les modificateurs de contexte sur les λ :
//     derby ×0.92, fatigue ×0.94, blessures ×[0.92..1]. Preuve par le
//     total λ : la redistribution Elo préserve λ_home+λ_away, donc
//     total_full / total_mix = produit exact des facteurs neutralisés
//     (± arrondi 2 décimales). Preuve par neutralisation : en 'mix',
//     isDerby / blessures / récence du calendrier n'ont PLUS AUCUN
//     effet sur p.prediction (identité JSON).
// (c) 'mix' sur un cas SANS contexte (pas de fatigue, isDerby:false,
//     blessures []) ≡ 'full' (identité exacte).
// (d) Traçabilité + baseline « Poisson+Elo+forme » (plan étape 6) :
//     odds:null + 'mix' → aucune calibration (overUnder ≡ raw.overUnder,
//     btts ≡ raw.btts, valueBets vides) ; avec cotes, la calibration
//     tourne toujours en 'mix' (blend + marchés inchangés).
// bun scripts/test-ablation.ts
// ============================================================

import { runEngine, type EngineInput, type MatchAnalysis } from '../src/lib/prediction';
import type { EspnInjury, EspnOdds, EspnScheduleGame } from '../src/lib/espn';

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
let evCounter = 0;

// ---------- Calendriers synthétiques ----------
// 44 matchs « historiques » tous PASSÉS (600..385 jours, motif moyen cf.
// test-engine-fix : λ base ≈ 1.52/1.22 hors modificateurs) + 6 matchs
// récents W,L,D,W,L,D dans le MÊME ordre pour les deux variantes →
// forces att/déf, forme ET ordre chronologique du Elo strictement
// identiques ; seule la RÉCENCE (source de la fatigue) diffère entre
// calmSchedule et busySchedule → toute différence λ full/mix est
// attribuable au SEUL modificateur de fatigue.
function buildSchedule(recentOffsetsDays: number[]): EspnScheduleGame[] {
  const games: EspnScheduleGame[] = [];
  const push = (homeAway: 'home' | 'away', gf: number, ga: number, i: number) => {
    games.push({
      eventId: `e${evCounter}-${homeAway}${i}`,
      date: new Date(NOW - (600 - i * 5) * 86400000).toISOString(),
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
  const recent: Array<['home' | 'away', number, number]> = [
    ['home', 2, 1], ['away', 1, 2], ['home', 1, 1], ['away', 2, 1], ['home', 1, 2], ['away', 1, 1],
  ];
  recent.forEach(([ha, gf, ga], i) => {
    games.push({
      eventId: `e${evCounter}-r${i}`,
      date: new Date(NOW - recentOffsetsDays[i] * 86400000).toISOString(),
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
// Aucun match sur 14 jours (le plus récent à J-16) → pas de fatigue
const calmSchedule = () => buildSchedule([26, 24, 22, 20, 18, 16]);
// Dernier match J-2 (< 4 jours de repos) ET 6 matchs sur 14 jours → fatigue (double déclencheur)
const busySchedule = () => buildSchedule([12, 10, 8, 6, 4, 2]);

function injuriesFor(teamId: string, n: number): EspnInjury[] {
  return Array.from({ length: n }, (_, i) => ({
    teamId,
    playerName: `Absente ${i + 1}`,
    position: 'FW',
    status: 'Out',
  }));
}

interface Opts {
  schedule?: () => EspnScheduleGame[];
  isDerby?: boolean;
  injuriesPerTeam?: number;
  odds?: EspnOdds | null;
  contextMode?: 'full' | 'mix';
}
function makeInput(opts: Opts = {}): EngineInput {
  const sched = (opts.schedule ?? calmSchedule)();
  return {
    homeTeam: { id: 'H', name: 'Home FC', logo: null, schedule: sched, standings: null },
    awayTeam: { id: 'A', name: 'Away FC', logo: null, schedule: sched, standings: null },
    injuries: [...injuriesFor('H', opts.injuriesPerTeam ?? 0), ...injuriesFor('A', opts.injuriesPerTeam ?? 0)],
    odds: opts.odds ?? null,
    isDerby: opts.isDerby ?? false,
    weatherImpact: null,
    nowMs: NOW,
    leagueTeamsCount: 20,
    ...(opts.contextMode !== undefined ? { contextMode: opts.contextMode } : {}),
  };
}

// JSON de la prédiction seule (sans le champ traçabilité contextMode)
const predJson = (r: MatchAnalysis): string => JSON.stringify(r.prediction);
// JSON complet hors champ contextMode (comparaisons d'identité)
const stripJson = (r: MatchAnalysis): string =>
  JSON.stringify({ ...r, contextMode: undefined });

// Écart max sur tous les nombres du marché (λ, 1X2, O/U, BTTS)
function maxNumDiff(a: MatchAnalysis, b: MatchAnalysis): number {
  const pa = a.prediction, pb = b.prediction;
  const nums = (p: MatchAnalysis['prediction']): number[] => [
    p.lambda.home, p.lambda.away, p.lambda.total,
    p.probs.home, p.probs.draw, p.probs.away,
    p.poisson.home, p.poisson.draw, p.poisson.away,
    p.elo.home, p.elo.draw, p.elo.away,
    p.form.home, p.form.draw, p.form.away,
    ...p.overUnder.flatMap((o) => [o.over, o.under]),
    p.btts.yes, p.btts.no,
  ];
  return Math.max(...nums(pa).map((x, i) => Math.abs(x - nums(pb)[i])));
}

const total = (r: MatchAnalysis): number => r.prediction.lambda.home + r.prediction.lambda.away;

// ============================================================
console.log('\n=== (a) NON-RÉGRESSION : champ absent ≡ contextMode \'full\' ===');
// ============================================================
const rAbsent = runEngine(makeInput({}));
const rFull = runEngine(makeInput({ contextMode: 'full' }));
check('sortie sans champ = sortie \'full\' (JSON intégral identique)', JSON.stringify(rAbsent) === JSON.stringify(rFull));
check('identité numérique ≤ 1e-12 (λ, 1X2, O/U, BTTS)', maxNumDiff(rAbsent, rFull) <= 1e-12, `écart max ${maxNumDiff(rAbsent, rFull).toExponential(2)}`);
check('trace contextMode = \'full\' quand le champ est absent', rAbsent.contextMode === 'full' && rFull.contextMode === 'full');

// ============================================================
console.log('\n=== (b) ABLATION : \'mix\' neutralise derby / fatigue / blessures ===');
// ============================================================
// b1 — Derby seul : isDerby:true, historique calme, blessures []
const derbyFull = runEngine(makeInput({ isDerby: true, contextMode: 'full' }));
const derbyMix = runEngine(makeInput({ isDerby: true, contextMode: 'mix' }));
const ratioDerby = total(derbyFull) / total(derbyMix);
check('derby : λ_home et λ_away baissent en \'full\' (×0.92 attendu)',
  derbyFull.prediction.lambda.home < derbyMix.prediction.lambda.home &&
  derbyFull.prediction.lambda.away < derbyMix.prediction.lambda.away,
  `full ${derbyFull.prediction.lambda.home}/${derbyFull.prediction.lambda.away} vs mix ${derbyMix.prediction.lambda.home}/${derbyMix.prediction.lambda.away}`);
check('derby : ratio total full/mix ≈ 0.92 (±0.01)', Math.abs(ratioDerby - 0.92) <= 0.01, `ratio ${ratioDerby.toFixed(4)}`);
check('derby : en \'mix\', isDerby n\'a PLUS AUCUN effet (prédiction identique à isDerby:false)',
  predJson(derbyMix) === predJson(runEngine(makeInput({ isDerby: false, contextMode: 'mix' }))));
check('derby : \'full\' ≠ \'mix\' (les λ diffèrent)', predJson(derbyFull) !== predJson(derbyMix));

// b2 — Fatigue seule : calendrier serré (J-2, 6 matchs/14j), isDerby:false
const fatFull = runEngine(makeInput({ schedule: busySchedule, contextMode: 'full' }));
const fatMix = runEngine(makeInput({ schedule: busySchedule, contextMode: 'mix' }));
const ratioFat = total(fatFull) / total(fatMix);
check('fatigue : λ baissent en \'full\' (×0.94 attendu par équipe)',
  fatFull.prediction.lambda.home < fatMix.prediction.lambda.home &&
  fatFull.prediction.lambda.away < fatMix.prediction.lambda.away,
  `full ${fatFull.prediction.lambda.home}/${fatFull.prediction.lambda.away} vs mix ${fatMix.prediction.lambda.home}/${fatMix.prediction.lambda.away}`);
check('fatigue : ratio total full/mix ≈ 0.94 (±0.01)', Math.abs(ratioFat - 0.94) <= 0.01, `ratio ${ratioFat.toFixed(4)}`);
check('fatigue : en \'mix\', la récence du calendrier n\'a PLUS AUCUN effet (mix(calme) ≡ mix(serré), ordre Elo identique)',
  predJson(fatMix) === predJson(runEngine(makeInput({ schedule: calmSchedule, contextMode: 'mix' }))));
check('fatigue : en \'mix\', λ strictement identiques calme vs serré',
  fatMix.prediction.lambda.home === runEngine(makeInput({ schedule: calmSchedule, contextMode: 'mix' })).prediction.lambda.home);

// b3 — Contexte complet : derby + fatigue + 4 blessures par équipe
//      produit attendu = 0.92 × 0.94 × 0.96 = 0.8302 (4 absents → inj ×0.96)
const allFull = runEngine(makeInput({ schedule: busySchedule, isDerby: true, injuriesPerTeam: 4, contextMode: 'full' }));
const allMix = runEngine(makeInput({ schedule: busySchedule, isDerby: true, injuriesPerTeam: 4, contextMode: 'mix' }));
const ratioAll = total(allFull) / total(allMix);
check('contexte complet : λ baissent en \'full\'', allFull.prediction.lambda.home < allMix.prediction.lambda.home && allFull.prediction.lambda.away < allMix.prediction.lambda.away);
check('contexte complet : ratio total full/mix ≈ 0.92×0.94×0.96 = 0.8302 (±0.01)', Math.abs(ratioAll - 0.830208) <= 0.01, `ratio ${ratioAll.toFixed(4)}`);
check('blessures : en \'mix\', 4 absents par équipe n\'ont PLUS AUCUN effet (≡ 0 absent)',
  predJson(allMix) === predJson(runEngine(makeInput({ schedule: busySchedule, isDerby: true, injuriesPerTeam: 0, contextMode: 'mix' }))));

// b4 — Sémantique : en 'mix' seuls les λ sont ablatés, les notes
//      descriptives de contexte restent calculées (affichage intact)
check('\'mix\' : notes descriptives de fatigue conservées (seuls les λ changent)',
  allMix.context.fatigueNoteHome !== null && allMix.context.fatigueNoteAway !== null);
check('\'mix\' : somme 1X2 toujours ≡ 1 (4 déc.)', Math.round((allMix.prediction.probs.home + allMix.prediction.probs.draw + allMix.prediction.probs.away) * 10000) === 10000);
check('\'mix\' : trace contextMode = \'mix\' en sortie', allMix.contextMode === 'mix' && derbyMix.contextMode === 'mix');

// ============================================================
console.log('\n=== (c) CAS SANS CONTEXTE : \'mix\' ≡ \'full\' (identité) ===');
// ============================================================
const calmFull = runEngine(makeInput({ schedule: calmSchedule, isDerby: false, injuriesPerTeam: 0, contextMode: 'full' }));
const calmMix = runEngine(makeInput({ schedule: calmSchedule, isDerby: false, injuriesPerTeam: 0, contextMode: 'mix' }));
check('sans contexte : JSON identique hors champ traçabilité', stripJson(calmFull) === stripJson(calmMix));
check('sans contexte : identité numérique ≤ 1e-12', maxNumDiff(calmFull, calmMix) <= 1e-12, `écart max ${maxNumDiff(calmFull, calmMix).toExponential(2)}`);
check('sans contexte : λ strictement identiques', calmFull.prediction.lambda.home === calmMix.prediction.lambda.home && calmFull.prediction.lambda.away === calmMix.prediction.lambda.away);

// ============================================================
console.log('\n=== (d) BASELINE « Poisson+Elo+forme » (plan étape 6) : odds:null + \'mix\' ===');
// ============================================================
// Recette documentée (rapport 22-b) : EngineInput avec injuries:[],
// odds:null, isDerby:false, weatherImpact:null, standings:null,
// contextMode:'mix' → λ = base att/déf × forme × redistribution Elo,
// SANS calibration (cotes absentes → brut conservé), SANS contexte.
const baseMix = runEngine(makeInput({ schedule: busySchedule, isDerby: true, injuriesPerTeam: 4, contextMode: 'mix', odds: null }));
check('baseline sans cotes : overUnder ≡ raw.overUnder (aucune calibration)', JSON.stringify(baseMix.prediction.overUnder) === JSON.stringify(baseMix.prediction.raw.overUnder));
check('baseline sans cotes : btts ≡ raw.btts', baseMix.prediction.btts.yes === baseMix.prediction.raw.btts.yes && baseMix.prediction.btts.no === baseMix.prediction.raw.btts.no);
check('baseline sans cotes : valueBets vides (pas de cotes)', baseMix.prediction.valueBets.length === 0);
check('baseline : λ = λ du cas \'mix\' équivalent (neutralisation confirmée)', baseMix.prediction.lambda.home === allMix.prediction.lambda.home && baseMix.prediction.lambda.away === allMix.prediction.lambda.away);

// Avec cotes : en 'mix', le blend + la calibration marchent toujours
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
const mixWithOdds = runEngine(makeInput({ schedule: busySchedule, isDerby: true, injuriesPerTeam: 4, contextMode: 'mix', odds: FAKE_ODDS }));
check('\'mix\' avec cotes : la calibration marché s\'applique toujours (calibré ≠ brut)',
  Math.abs(mixWithOdds.prediction.overUnder.find((o) => o.line === 2.5)!.over - mixWithOdds.prediction.raw.overUnder.find((o) => o.line === 2.5)!.over) > 0.01);
check('\'mix\' avec cotes : λ identiques à ceux sans cotes (calibration ne touche pas les λ)',
  mixWithOdds.prediction.lambda.home === baseMix.prediction.lambda.home && mixWithOdds.prediction.lambda.away === baseMix.prediction.lambda.away);
check('\'mix\' avec cotes : somme 1X2 ≡ 1 (4 déc.)', Math.round((mixWithOdds.prediction.probs.home + mixWithOdds.prediction.probs.draw + mixWithOdds.prediction.probs.away) * 10000) === 10000);

// ============================================================
console.log(`\n=== RÉSULTAT : ${passed} OK · ${failed} ÉCHEC(S) ===`);
if (failed > 0) process.exit(1);
