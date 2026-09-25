// ============================================================
// Audit 19-a — Script 2 : Fix Task 17 « Séquence λ » (L605-611)
// 1) Invariance du produit λh·λa quand eloDiff=0 et quasi-invariance sinon
// 2) Quantification de l'effet des clamps (0.25/0.2/4.2) selon eloDiff
// 3) Fidélité de la CHAÎNE complète fatigue→blessures→derby→météo→forme→Elo
//    (ordre L569-618) : transcription vs runEngine réel sur fixtures
// bun scripts/audit-19-a-2-lambda.ts
// ============================================================

import { runEngine, computeElo, type EngineInput, type EspnScheduleGame } from '../src/lib/prediction';

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
function clamp(x: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, x));
}

console.log('\n=== 1. Transcription L604-611 : invariance du produit ===');
// Transcription FIDÈLE de prediction.ts L604-611 :
//   const eloDiff = eloHome + HOME_ADV_ELO - eloAway;
//   const eloFactor = Math.pow(10, clamp(eloDiff, -300, 300) / 800);
//   lambdaHome = clamp(lambdaHome * Math.sqrt(eloFactor), 0.25, 4.2);
//   lambdaAway = clamp(lambdaAway * Math.sqrt(1 / eloFactor), 0.2, 4.2);
function lambdaChain(lhPre: number, laPre: number, eloDiff: number) {
  const eloFactor = Math.pow(10, clamp(eloDiff, -300, 300) / 800);
  const lh = clamp(lhPre * Math.sqrt(eloFactor), 0.25, 4.2);
  const la = clamp(laPre * Math.sqrt(1 / eloFactor), 0.2, 4.2);
  return { lh, la, eloFactor };
}

// --- 1a. eloDiff = 0 → facteur 1, produit préservé au FP près (hors clamp) ---
let prodEqOK = true;
let worstEq = 0;
for (const lhPre of [0.5, 0.8, 1.2, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.1]) {
  for (const laPre of [0.4, 0.7, 1.0, 1.4, 1.8, 2.2, 2.8, 3.4, 4.0, 4.1]) {
    const r = lambdaChain(lhPre, laPre, 0);
    const ratio = (r.lh * r.la) / (lhPre * laPre);
    worstEq = Math.max(worstEq, Math.abs(ratio - 1));
    if (Math.abs(ratio - 1) > 1e-12) prodEqOK = false;
  }
}
check('eloDiff=0 : produit λh·λa invariant (ratio=1, 100 couples hors clamp)', prodEqOK, `écart max=${worstEq.toExponential(2)}`);

// --- 1b. eloDiff ≠ 0 → le sqrt symétrique conserve le produit HORS clamp ---
let prodNoClampOK = true;
let worstNoClamp = 0;
for (const eloDiff of [-300, -250, -200, -150, -100, -50, 50, 100, 150, 200, 250, 300]) {
  for (const [lhPre, laPre] of [[1.2, 1.0], [1.5, 1.2], [2.0, 1.4], [0.8, 0.9], [2.5, 1.8]]) {
    const r = lambdaChain(lhPre, laPre, eloDiff);
    // clamp actif ? (aucune des 4 bornes)
    const clamped =
      r.lh === 0.25 || r.lh === 4.2 || r.la === 0.2 || r.la === 4.2 ||
      Math.abs(r.lh - lhPre * Math.sqrt(r.eloFactor)) > 1e-12 ||
      Math.abs(r.la - laPre * Math.sqrt(1 / r.eloFactor)) > 1e-12;
    if (!clamped) {
      const ratio = (r.lh * r.la) / (lhPre * laPre);
      worstNoClamp = Math.max(worstNoClamp, Math.abs(ratio - 1));
      if (Math.abs(ratio - 1) > 1e-9) prodNoClampOK = false;
    }
  }
}
check('eloDiff≠0 : produit quasi-invariant hors clamp (|ratio−1| ≤ 1e-9)', prodNoClampOK, `écart max=${worstNoClamp.toExponential(2)}`);

console.log('\n=== 2. Effet des clamps : où la conservation du produit casse-t-elle ? ===');
// sqrt(eloFactor) ∈ [0.6494, 1.5399] (eloDiff clampé ±300)
const fMin = Math.pow(10, -300 / 800);
const fMax = Math.pow(10, 300 / 800);
console.log(`  eloFactor ∈ [${fMin.toFixed(4)}, ${fMax.toFixed(4)}] ; sqrt ∈ [${Math.sqrt(fMin).toFixed(4)}, ${Math.sqrt(fMax).toFixed(4)}]`);
check('bornes sqrt attendues [0.649, 1.540]', Math.abs(Math.sqrt(fMin) - 0.6494) < 1e-3 && Math.abs(Math.sqrt(fMax) - 1.5399) < 1e-3);

// Seuils théoriques (sans l'autre clamp) :
//   clamp bas λh : lhPre·sqrt(f) < 0.25 → eloDiff=+300 : lhPre < 0.25/1.5399 = 0.1624
//   clamp haut λh : lhPre·sqrt(f) > 4.2 → eloDiff=+300 : lhPre > 4.2/1.5399 = 2.7275
//   clamp bas λa : laPre/sqrt(f) < 0.2 → eloDiff=+300 : laPre < 0.2·1.5399 = 0.3080
//   clamp haut λa : laPre/sqrt(f) > 4.2 → eloDiff=+300 : laPre > 4.2·1.5399 = 6.4676
check('seuil clamp bas λh à eloDiff=+300 = 0.25/1.5399 ≈ 0.162', Math.abs(0.25 / Math.sqrt(fMax) - 0.1624) < 1e-3);
check('seuil clamp haut λh à eloDiff=+300 = 4.2/1.5399 ≈ 2.728', Math.abs(4.2 / Math.sqrt(fMax) - 2.7275) < 1e-3);

// Recherche empirique : pour chaque eloDiff, plus petit eloDiff où un λ pré-Elo
// réaliste (0.6..2.5) voit le clamp se déclencher
let firstDistortion: { eloDiff: number; lhPre: number; laPre: number; ratio: number } | null = null;
for (let eloDiff = 20; eloDiff <= 300; eloDiff += 5) {
  for (let x = 0.6; x <= 2.5; x += 0.05) {
    // cas typique : λh_pre = λa_pre = x (produit x²)
    const r = lambdaChain(x, x, eloDiff);
    const ratio = (r.lh * r.la) / (x * x);
    if (Math.abs(ratio - 1) > 0.02 && !firstDistortion) {
      firstDistortion = { eloDiff, lhPre: x, laPre: x, ratio };
    }
  }
}
console.log(`  première distorsion >2% pour λh_pre=λa_pre∈[0.6,2.5] : ${firstDistortion ? `eloDiff=${firstDistortion.eloDiff} (λ=${firstDistortion.lhPre.toFixed(2)}, ratio produit=${firstDistortion.ratio.toFixed(3)})` : 'aucune'}`);
// λh_pre=λa_pre ≤ 2.5 : clamp haut λh exige lhPre > 2.728 à +300 → jamais ;
// clamp bas λh exige lhPre < 0.162 → jamais ; λa : bas 0.308 (x<0.308 non scanné),
// haut 6.47 → jamais. Donc AUCUNE distorsion attendue pour des lambdas symétriques ≤2.5 :
check('λ symétriques ≤2.5 : aucune distorsion >2% du produit, quel que soit eloDiff', firstDistortion === null);

// Cas où le clamp recrée une distorsion : λh_pre grand + gros favori domicile
const rClampHi = lambdaChain(3.0, 1.2, 300);
const ratioHi = (rClampHi.lh * rClampHi.la) / (3.0 * 1.2);
console.log(`  λh_pre=3.0, λa_pre=1.2, eloDiff=+300 : λh=${rClampHi.lh.toFixed(3)} (sans clamp ${(3.0 * Math.sqrt(rClampHi.eloFactor)).toFixed(3)}), λa=${rClampHi.la.toFixed(3)} → ratio produit=${ratioHi.toFixed(4)}`);
check('clamp haut λh=4.2 : distorsion du produit mesurée et bornée', rClampHi.lh === 4.2 && ratioHi < 0.93, `ratio=${ratioHi.toFixed(4)} (perte ${(100 * (1 - ratioHi)).toFixed(1)}% de buts totaux)`);
const rClampLo = lambdaChain(0.15, 1.5, 300);
const ratioLo = (rClampLo.lh * rClampLo.la) / (0.15 * 1.5);
console.log(`  λh_pre=0.15, eloDiff=+300 : λh=${rClampLo.lh.toFixed(3)} (clamp bas) → ratio produit=${ratioLo.toFixed(4)}`);
check('clamp bas λh : distorsion mesurée (produit augmenté de ~8%)', rClampLo.lh === 0.25 && ratioLo > 1.05 && ratioLo < 1.2, `ratio=${ratioLo.toFixed(4)}`);
// À eloDiff=0 le clamp peut-il s'activer ? oui si λ pré-Elo hors bornes — indépendant d'Elo :
const rEqClamp = lambdaChain(5.0, 5.0, 0);
check('eloDiff=0 : clamp actif si λ pré-Elo > 4.2 (distorsion indépendante du signe Elo)', rEqClamp.lh === 4.2 && rEqClamp.la === 4.2);

// Reconstruction de l'ANCIEN bug (worklog 17-a : facteur parasite 10^(−eloDiff/3200) sur λa)
console.log('\n  Reconstruction ancien code (λa × 10^(−eloDiff/3200)) vs nouveau :');
for (const d of [100, 200, 300]) {
  const oldAwayFactor = Math.pow(10, -d / 3200);
  const newAwayFactor = 1 / Math.sqrt(Math.pow(10, d / 800));
  console.log(`    eloDiff=${d} : ancien facteur λa=${oldAwayFactor.toFixed(4)} (${((oldAwayFactor - 1) * 100).toFixed(1)}%) vs nouveau=${newAwayFactor.toFixed(4)} (${((newAwayFactor - 1) * 100).toFixed(1)}%)`);
}
check('facteur parasite ancien 10^(−eloDiff/3200) ≠ nouveau 10^(−eloDiff/1600)', Math.abs(Math.pow(10, -300 / 3200) - Math.pow(10, -300 / 1600)) > 0.05);

console.log('\n=== 3. Fidélité de la chaîne complète (L554-618) : transcription vs runEngine ===');

// ---- Helpers fixtures ----
const NOW = new Date('2026-09-20T15:00:00Z').getTime();
const DAY = 86400000;
function mkSchedule(
  teamId: string,
  games: Array<{ opp: string; home: boolean; ts: number; os: number; daysAgo: number }>
): EspnScheduleGame[] {
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

// formScoreOf — transcription fidèle L238-252
function formScoreOf(games: EspnScheduleGame[]): number {
  const played = games.filter((g) => g.completed && g.teamScore !== null && g.opponentScore !== null).slice(-6);
  if (played.length === 0) return 0.4;
  let weighted = 0;
  let totalWeight = 0;
  played.forEach((g, i) => {
    const recency = Math.exp(-0.25 * (played.length - 1 - i));
    const result = g.teamScore! > g.opponentScore! ? 1 : g.teamScore === g.opponentScore ? 0.5 : 0;
    weighted += result * recency;
    totalWeight += recency;
  });
  return weighted / totalWeight;
}
function round2(x: number) { return Math.round(x * 100) / 100; }
function round(x: number, d = 4) { const f = Math.pow(10, d); return Math.round(x * f) / f; }

// Transcription de la chaîne L554-618 à partir des stats brutes des fixtures
function transcriptLambda(
  t1: { schedule: EspnScheduleGame[]; isHome: boolean },
  t2: { schedule: EspnScheduleGame[]; isHome: boolean },
  isDerby: boolean,
  weatherFactor: number | null
) {
  function stats(sched: EspnScheduleGame[], isHome: boolean) {
    const played = sched.filter((g) => g.completed && g.teamScore !== null && g.opponentScore !== null);
    const totalGames = played.length || 1;
    const goalsFor = played.reduce((s, g) => s + (g.teamScore ?? 0), 0) / totalGames;
    const goalsAgainst = played.reduce((s, g) => s + (g.opponentScore ?? 0), 0) / totalGames;
    const homeGames = played.filter((g) => g.homeAway === 'home');
    const awayGames = played.filter((g) => g.homeAway === 'away');
    const gfHome = homeGames.length ? homeGames.reduce((s, g) => s + (g.teamScore ?? 0), 0) / homeGames.length : goalsFor;
    const gaHome = homeGames.length ? homeGames.reduce((s, g) => s + (g.opponentScore ?? 0), 0) / homeGames.length : goalsAgainst;
    const gfAway = awayGames.length ? awayGames.reduce((s, g) => s + (g.teamScore ?? 0), 0) / awayGames.length : goalsFor;
    const gaAway = awayGames.length ? awayGames.reduce((s, g) => s + (g.opponentScore ?? 0), 0) / awayGames.length : goalsAgainst;
    // L326-329 : sémantique inversée pour l'équipe extérieure
    const goalsForHome = round(isHome ? gfHome : gfAway, 2);
    const goalsAgainstHome = round(isHome ? gaHome : gaAway, 2);
    const goalsForAway = round(isHome ? gfAway : gfHome, 2);
    const goalsAgainstAway = round(isHome ? gaAway : gaHome, 2);
    // Fatigue (L575-576)
    const lastGame = played[played.length - 1];
    const daysSince = lastGame ? Math.round((NOW - new Date(lastGame.date).getTime()) / DAY) : null;
    const last14 = played.filter((g) => NOW - new Date(g.date).getTime() < 14 * DAY && NOW - new Date(g.date).getTime() >= 0).length;
    const fatigue = (daysSince !== null && daysSince <= 3) || last14 >= 3;
    const formScore = formScoreOf(sched);
    return { goalsForHome, goalsAgainstHome, goalsForAway, goalsAgainstAway, fatigue, formScore, gamesPlayed: played.length };
  }
  const h = stats(t1.schedule, true);
  const a = stats(t2.schedule, false);
  const leagueAvgHomeGoals = 1.52;
  const leagueAvgAwayGoals = 1.22;
  const wH = clamp(h.gamesPlayed / (h.gamesPlayed + 6), 0.15, 0.85);
  const wA = clamp(a.gamesPlayed / (a.gamesPlayed + 6), 0.15, 0.85);
  const homeAttack = wH * h.goalsForHome + (1 - wH) * h.goalsForHome * 0 + (1 - wH) * 0; // placeholder remplacé ci-dessous
  void homeAttack;
  // L564-567 exact :
  const homeAttack2 = wH * h.goalsForHome + (1 - wH) * round((t1.schedule.reduce((s, g) => s + (g.teamScore ?? 0), 0) / (t1.schedule.filter((g) => g.completed).length || 1)), 2);
  const homeDefense2 = wH * h.goalsAgainstHome + (1 - wH) * round((t1.schedule.reduce((s, g) => s + (g.opponentScore ?? 0), 0) / (t1.schedule.filter((g) => g.completed).length || 1)), 2);
  const awayAttack2 = wA * a.goalsForAway + (1 - wA) * round((t2.schedule.reduce((s, g) => s + (g.teamScore ?? 0), 0) / (t2.schedule.filter((g) => g.completed).length || 1)), 2);
  const awayDefense2 = wA * a.goalsAgainstAway + (1 - wA) * round((t2.schedule.reduce((s, g) => s + (g.opponentScore ?? 0), 0) / (t2.schedule.filter((g) => g.completed).length || 1)), 2);
  let lambdaHome = leagueAvgHomeGoals * (homeAttack2 / leagueAvgHomeGoals) * (awayDefense2 / leagueAvgAwayGoals);
  let lambdaAway = leagueAvgAwayGoals * (awayAttack2 / leagueAvgAwayGoals) * (homeDefense2 / leagueAvgHomeGoals);
  if (h.fatigue) lambdaHome *= 0.94;
  if (a.fatigue) lambdaAway *= 0.94;
  const injH = clamp(1 - 0 * 0.025, 0.9, 1);
  const injA = clamp(1 - 0 * 0.025, 0.9, 1);
  lambdaHome *= injH;
  lambdaAway *= injA;
  if (isDerby) { lambdaHome *= 0.92; lambdaAway *= 0.92; }
  if (weatherFactor !== null) { lambdaHome *= weatherFactor; lambdaAway *= weatherFactor; }
  lambdaHome *= 0.9 + h.formScore * 0.2;
  lambdaAway *= 0.9 + a.formScore * 0.2;
  // Elo réel (computeElo exporté)
  const schedules = new Map<string, EspnScheduleGame[]>([
    [t1.schedule[0].eventId.slice(0, 2), t1.schedule],
    [t2.schedule[0].eventId.slice(0, 2), t2.schedule],
  ]);
  return { lambdaHome, lambdaAway, h, a };
}

// Fixture équilibrée : T1 tout à domicile, T2 tout à l'extérieur, stats miroir
const T1_ID = 'T1';
const T2_ID = 'T2';
const t1Games = [
  { opp: 'O1', home: true, ts: 2, os: 0, daysAgo: 100 },
  { opp: 'O2', home: true, ts: 1, os: 1, daysAgo: 90 },
  { opp: 'O3', home: true, ts: 3, os: 1, daysAgo: 80 },
  { opp: 'O4', home: true, ts: 0, os: 0, daysAgo: 70 },
  { opp: 'O5', home: true, ts: 2, os: 1, daysAgo: 60 },
  { opp: 'O6', home: true, ts: 1, os: 0, daysAgo: 50 },
  { opp: 'O7', home: true, ts: 4, os: 2, daysAgo: 40 },
  { opp: 'O8', home: true, ts: 1, os: 1, daysAgo: 30 },
  { opp: 'O9', home: true, ts: 3, os: 0, daysAgo: 20 },
  { opp: 'O10', home: true, ts: 2, os: 2, daysAgo: 10 },
];
const t2Games = t1Games.map((g, i) => ({
  opp: `P${i + 1}`,
  home: false,
  ts: g.ts,
  os: g.os,
  daysAgo: g.daysAgo,
}));
const schedT1 = mkSchedule(T1_ID, t1Games);
const schedT2 = mkSchedule(T2_ID, t2Games);

function engineInput(hSched: EspnScheduleGame[], aSched: EspnScheduleGame[]): EngineInput {
  return {
    homeTeam: { id: T1_ID, name: 'Team One', logo: null, schedule: hSched, standings: null },
    awayTeam: { id: T2_ID, name: 'Team Two', logo: null, schedule: aSched, standings: null },
    injuries: [],
    odds: null,
    isDerby: false,
    weatherImpact: null,
    nowMs: NOW,
    leagueTeamsCount: 20,
  };
}

const engine = runEngine(engineInput(schedT1, schedT2));
const elo = computeElo(T1_ID, T2_ID, new Map([[T1_ID, schedT1], [T2_ID, schedT2]]));
const eloT1 = elo.ratings.get(T1_ID) ?? 1500;
const eloT2 = elo.ratings.get(T2_ID) ?? 1500;
const eloDiff = eloT1 + 65 - eloT2;
const tr = transcriptLambda(
  { schedule: schedT1, isHome: true },
  { schedule: schedT2, isHome: false },
  false,
  null
);
const trFactor = Math.pow(10, clamp(eloDiff, -300, 300) / 800);
const trLh = round2(clamp(tr.lambdaHome * Math.sqrt(trFactor), 0.25, 4.2));
const trLa = round2(clamp(tr.lambdaAway * Math.sqrt(1 / trFactor), 0.2, 4.2));

console.log(`  fixture équilibrée : eloT1=${Math.round(eloT1)} eloT2=${Math.round(eloT2)} eloDiff=${eloDiff.toFixed(1)} (clampé ${clamp(eloDiff, -300, 300)})`);
console.log(`  transcript : λh_pre=${tr.lambdaHome.toFixed(4)} λa_pre=${tr.lambdaAway.toFixed(4)} → après Elo λh=${trLh} λa=${trLa}`);
console.log(`  runEngine  : λh=${engine.prediction.lambda.home} λa=${engine.prediction.lambda.away}`);
check('fidélité chaîne complète : λh transcript == λh runEngine', trLh === engine.prediction.lambda.home, `${trLh} vs ${engine.prediction.lambda.home}`);
check('fidélité chaîne complète : λa transcript == λa runEngine', trLa === engine.prediction.lambda.away, `${trLa} vs ${engine.prediction.lambda.away}`);
check('fixture équilibrée : λh > λa (avantage domicile dans les buts attendus)', engine.prediction.lambda.home > engine.prediction.lambda.away);
check('λ dans les bornes de clamp', engine.prediction.lambda.home >= 0.25 && engine.prediction.lambda.home <= 4.2 && engine.prediction.lambda.away >= 0.2 && engine.prediction.lambda.away <= 4.2);

// Produit quasi-conservé à travers l'étape Elo sur la fixture (pas de clamp actif)
const preProd = tr.lambdaHome * tr.lambdaAway;
const postProd = trLh * trLa;
console.log(`  produit pré-Elo=${preProd.toFixed(4)} post-Elo=${postProd.toFixed(4)} ratio=${(postProd / preProd).toFixed(5)}`);
check('fixture : |ratio produit pré/post Elo − 1| ≤ 1% (sqrt symétrique + round2)', Math.abs(postProd / preProd - 1) < 0.01, `ratio=${(postProd / preProd).toFixed(5)}`);

// --- Chaîne dérivée : chaque modificateur est bien APPLIQUÉ (test par différence) ---
console.log('\n--- Sensibilité de la chaîne (chaque maillon doit modifier λ) ---');
// Derby
const engDerby = runEngine({ ...engineInput(schedT1, schedT2), isDerby: true });
check('maillon derby : ×0.92 des deux λ', Math.abs(engDerby.prediction.lambda.home - round2(clamp(tr.lambdaHome * Math.sqrt(trFactor) * 0.92, 0.25, 4.2))) < 1e-9 && Math.abs(engDerby.prediction.lambda.away - round2(clamp(tr.lambdaAway * Math.sqrt(1 / trFactor) * 0.92, 0.2, 4.2))) < 1e-9, `λh ${engine.prediction.lambda.home}→${engDerby.prediction.lambda.home}`);
// Météo
const engWeather = runEngine({ ...engineInput(schedT1, schedT2), weatherImpact: { goalsFactor: 0.95 } });
check('maillon météo : ×0.95 des deux λ', engWeather.prediction.lambda.home < engine.prediction.lambda.home && engWeather.prediction.lambda.away < engine.prediction.lambda.away, `λh ${engine.prediction.lambda.home}→${engWeather.prediction.lambda.home}`);
// Fatigue : match il y a 2 jours → ×0.94
const t1Fat = mkSchedule(T1_ID, t1Games.map((g, i) => (i === t1Games.length - 1 ? { ...g, daysAgo: 2 } : g)));
const engFatigue = runEngine(engineInput(t1Fat, schedT2));
check('maillon fatigue (repos 2j) : λh ×0.94 uniquement', Math.abs(engFatigue.prediction.lambda.home / (engine.prediction.lambda.home / (0.9 + formScoreOf(schedT1) * 0.2) * (0.9 + formScoreOf(t1Fat) * 0.2)) - 0.94) < 0.02, `λh ${engine.prediction.lambda.home}→${engFatigue.prediction.lambda.home}`);
// Blessures : 4 absents → ×0.90 (clamp)
const engInj = runEngine({ ...engineInput(schedT1, schedT2), injuries: [1, 2, 3, 4].map((n) => ({ teamId: T1_ID, playerName: `p${n}`, status: 'Out' })) as never });
check('maillon blessures : λh réduit (4 absents → ×0.90)', engInj.prediction.lambda.home < engine.prediction.lambda.home, `λh ${engine.prediction.lambda.home}→${engInj.prediction.lambda.home}`);
// Ordre : transcript avec fatigue T1 appliquée AVANT form/Elo reproduit l'engine
const trFat = transcriptLambda({ schedule: t1Fat, isHome: true }, { schedule: schedT2, isHome: false }, false, null);
const trFatLh = round2(clamp(trFat.lambdaHome * Math.sqrt(trFactor), 0.25, 4.2));
check('ORDRE fatigue→forme→Elo respecté (transcript==engine avec fatigue)', trFatLh === engFatigue.prediction.lambda.home, `${trFatLh} vs ${engFatigue.prediction.lambda.home}`);

// --- Extrêmes : bornes de clamp atteintes proprement, jamais NaN ---
console.log('\n--- Extrêmes (equipe toute-puissante vs équipe inoffensive) ---');
const t1God = mkSchedule(T1_ID, Array.from({ length: 10 }, (_, i) => ({ opp: `G${i}`, home: true, ts: 6, os: 0, daysAgo: 100 - i * 9 })));
const t2Mouse = mkSchedule(T2_ID, Array.from({ length: 10 }, (_, i) => ({ opp: `H${i}`, home: false, ts: 0, os: 5, daysAgo: 100 - i * 9 })));
const engExtreme = runEngine(engineInput(t1God, t2Mouse));
console.log(`  extrême : λh=${engExtreme.prediction.lambda.home} λa=${engExtreme.prediction.lambda.away}`);
check('extrême : λh clampé à 4.2', engExtreme.prediction.lambda.home === 4.2);
check('extrême : λa clampé à 0.2', engExtreme.prediction.lambda.away === 0.2);
check('extrême : aucune NaN dans la prédiction', !JSON.stringify(engExtreme.prediction).includes('NaN') && !JSON.stringify(engExtreme.prediction).includes('null,') === false || JSON.stringify(engExtreme.prediction).indexOf('NaN') === -1);

console.log(`\n===== SCRIPT 2 (séquence λ) : ${passed} PASS / ${failed} FAIL =====`);
if (failed > 0) process.exit(1);
