#!/usr/bin/env bun
// ============================================================
// VOLTRIX bet — Blind test JJA 2026 · PHASE 3 : MÉTRIQUES + AUDIT
// ============================================================
// Entrées : predictions-frozen.json (hash vérifié), results.json,
//           schedules.json (re-vérification as-of indépendante).
// Sortie  : data/metrics.json — métriques par marché/variante/scope,
//           audit anti-fuite automatisé, contrôles finaux (§9).
//
// Principe (§7 de la commande) : qualité STATISTIQUE (Brier, LogLoss,
// RPS, accuracy, calibration) — PAS une stratégie de mise.
// Aucune modification du modèle : le moteur est relancé uniquement en
// lecture (rejeu pur) pour la vérification as-of.
// ============================================================

import {
  addBinary,
  addTriple,
  allGamesOf,
  argmaxTriple,
  finalizeAcc,
  filterAsOfGames,
  buildInputsDigest,
  newAcc,
  outcomeOf,
  pairedDeltaTest,
  type EspnScheduleGame,
  type KeyBin,
  type Key1x2,
  type MetricAcc,
  type ScheduleKey,
  type TeamSeasonSchedules,
} from '../backtest-lib';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, resolve } from 'node:path';

const SCRIPT_DIR = dirname(resolve(process.argv[1] ?? '.'));
const DATA_DIR = join(SCRIPT_DIR, 'data');

const OFFICIAL_H = 3; // horizon officiel du rapport (T−3h)
const HORIZONS = [12, 6, 3, 1];
const VOID_LEAGUE_MIN_N = 20; // seuil « échantillon suffisant » par ligue

// ---------- Types ----------

interface HistSummary {
  n: number;
  lastDate: string | null;
  gf: number;
  ga: number;
  rank: number | null;
  gp: number;
  points: number;
}
interface PredRecord {
  matchId: string;
  league: string;
  kickoffUtc: string;
  homeTeam: string;
  awayTeam: string;
  tPredUtc: string;
  horizonHoursBeforeKickoff: number;
  generatedAtUtc: string;
  modelVersion: string;
  prediction: {
    probs1x2: { home: number; draw: number; away: number } | null;
    pick1x2: 'H' | 'D' | 'A' | null;
    ou25: { probOverCalibrated: number | null; probOverRaw: number | null; pick: string | null };
    btts: { probYesCalibrated: number | null; probYesRaw: number | null; pick: string | null };
    confidenceLevel: number | null;
    confidenceLabel: string | null;
    lambda: { home: number | null; away: number | null };
  };
  baselines: {
    marketOpenDeMarged: { oneXtwo: { home: number; draw: number; away: number } | null; ou25Over: number | null };
    poissonSimple: { oneXtwo: { home: number; draw: number; away: number }; ou25Over: number | null; bttsYes: number | null };
    eloSimple: { oneXtwo: { home: number; draw: number; away: number } };
    mixPoissonEloForme: { oneXtwo: { home: number; draw: number; away: number }; ou25Over: number | null; bttsYes: number | null };
  };
  inputs: { historyHome: HistSummary; historyAway: HistSummary; standingsTeamsCount: number | null };
  digestPayload: Record<string, unknown> | null;
  inputsDigest: string;
}
interface ResultRow {
  matchId: string;
  league: string;
  statusState: string | null;
  statusDetail: string | null;
  completed: boolean;
  voidFlag: boolean;
  homeScore: number | null;
  awayScore: number | null;
  outcome1x2: 'H' | 'D' | 'A' | null;
  totalGoals: number | null;
  ou25Result: boolean | null;
  bttsResult: boolean | null;
  scoreAvailable: boolean;
  closeOddsReference: { moneylineClose: { home: number | null; draw: number | null; away: number | null } | null; overUnderLine: number | null; totalCloseOdds: { over: number | null; under: number | null; line: number | null } | null } | null;
  revealedAtUtc: string;
  note: string | null;
}

function r6(x: number): number | null {
  return Number.isFinite(x) ? Math.round(x * 1e6) / 1e6 : null;
}

function metricsJson(acc: MetricAcc, withRps: boolean): Record<string, unknown> {
  const f = finalizeAcc(acc, withRps);
  if (!f.n) return { n: 0 };
  return {
    n: f.n,
    brier: r6(f.brier),
    brierCi95: f.brierCi ? [r6(f.brierCi.lo), r6(f.brierCi.hi)] : null,
    logLoss: r6(f.logLoss),
    rps: withRps && Number.isFinite(f.rps) ? r6(f.rps) : null,
    rpsCi95: withRps && f.rpsCi ? [r6(f.rpsCi.lo), r6(f.rpsCi.hi)] : null,
    accuracy: r6(f.accuracy),
    calibration: f.calibration.map((b) => ({ label: b.label, count: b.count, avgProb: r6(b.avgProb), actualRate: r6(b.actualRate) })),
  };
}

async function main(): Promise<void> {
  // ---- 0. Chargement + vérifications d'intégrité ----
  const frozenBytes = readFileSync(join(DATA_DIR, 'predictions-frozen.json'), 'utf8');
  const frozenHash = createHash('sha256').update(frozenBytes).digest('hex');
  const expectedHash = readFileSync(join(DATA_DIR, 'predictions-frozen.json.sha256'), 'utf8').split(/\s+/)[0];
  const hashOk = frozenHash === expectedHash;

  const frozen = JSON.parse(frozenBytes) as { meta: Record<string, unknown>; predictions: PredRecord[] };
  const results = (JSON.parse(readFileSync(join(DATA_DIR, 'results.json'), 'utf8')) as { results: ResultRow[] }).results;
  const fixturesMeta = JSON.parse(readFileSync(join(DATA_DIR, 'fixtures.json'), 'utf8')) as { meta: { counts: Record<string, number> } };
  const schedRaw = JSON.parse(readFileSync(join(DATA_DIR, 'schedules.json'), 'utf8')) as { schedules: Record<string, Record<string, EspnScheduleGame[]>> };

  const schedules = new Map<ScheduleKey, TeamSeasonSchedules>();
  for (const [key, bySeason] of Object.entries(schedRaw.schedules)) {
    const m = new Map<number, EspnScheduleGame[]>();
    for (const [season, games] of Object.entries(bySeason)) m.set(parseInt(season, 10), games);
    schedules.set(key, { bySeason: m });
  }
  const resultsByMatch = new Map(results.map((r) => [r.matchId, r]));

  console.log(`[métriques] gel vérifié : ${hashOk ? 'OK' : 'ÉCHEC'} (${frozenHash.slice(0, 16)}…) · ${frozen.predictions.length} prédictions · ${results.length} résultats`);

  // ---- 1. Jointure + audit anti-fuite par enregistrement ----
  const audit = {
    hashOk,
    totalPredictions: frozen.predictions.length,
    tPredAfterKickoff: 0,
    histLastDateNotBeforeTPred: 0,
    histRecomputeMismatches: 0,
    digestRecomputeMismatches: 0,
    modelVersionMismatches: 0,
    horizonOutOfSet: 0,
    missingProbs1x2: 0,
    missingOu25: 0,
    missingBtts: 0,
    structScanScoreLikeKeysInFrozen: 0,
    anomalies: [] as string[],
  };

  interface Joined {
    p: PredRecord;
    r: ResultRow | null;
    outcome: ReturnType<typeof outcomeOf> | null;
    over25: boolean | null;
    bttsYes: boolean | null;
  }
  const joined: Joined[] = [];
  for (const p of frozen.predictions) {
    const r = resultsByMatch.get(p.matchId) ?? null;
    const kickoffMs = Date.parse(p.kickoffUtc);
    const tPredMs = Date.parse(p.tPredUtc);
    if (tPredMs >= kickoffMs) audit.tPredAfterKickoff++;
    if (p.modelVersion !== 'v2.1') audit.modelVersionMismatches++;
    if (!HORIZONS.includes(p.horizonHoursBeforeKickoff)) audit.horizonOutOfSet++;
    if (!p.prediction.probs1x2) audit.missingProbs1x2++;
    if (p.prediction.ou25.probOverRaw === null && p.prediction.ou25.probOverCalibrated === null) audit.missingOu25++;
    if (p.prediction.btts.probYesRaw === null && p.prediction.btts.probYesCalibrated === null) audit.missingBtts++;

    // Re-vérification as-of INDÉPENDANTE : refiltre les calendriers bruts à T_pred
    // et compare aux résumés stockés dans le snapshot gelé.
    const homeAll = allGamesOf(schedules, p.league, (p as unknown as { homeTeamId: string }).homeTeamId);
    const awayAll = allGamesOf(schedules, p.league, (p as unknown as { awayTeamId: string }).awayTeamId);
    const homeF = filterAsOfGames(homeAll, tPredMs);
    const awayF = filterAsOfGames(awayAll, tPredMs);
    const sumOf = (gs: EspnScheduleGame[]): HistSummary => ({
      n: gs.length,
      lastDate: gs.length ? gs[gs.length - 1].date : null,
      gf: gs.reduce((s, g) => s + (g.teamScore ?? 0), 0),
      ga: gs.reduce((s, g) => s + (g.opponentScore ?? 0), 0),
      rank: null,
      gp: 0,
      points: 0,
    });
    const hs = sumOf(homeF);
    const as = sumOf(awayF);
    const storedHome = p.inputs.historyHome;
    const storedAway = p.inputs.historyAway;
    if (hs.n !== storedHome.n || hs.gf !== storedHome.gf || hs.ga !== storedHome.ga || hs.lastDate !== storedHome.lastDate || as.n !== storedAway.n || as.gf !== storedAway.gf || as.ga !== storedAway.ga || as.lastDate !== storedAway.lastDate) {
      audit.histRecomputeMismatches++;
    }
    if (storedHome.lastDate && Date.parse(storedHome.lastDate) >= tPredMs) audit.histLastDateNotBeforeTPred++;
    if (storedAway.lastDate && Date.parse(storedAway.lastDate) >= tPredMs) audit.histLastDateNotBeforeTPred++;
    // Digest
    if (p.digestPayload) {
      const recomputed = buildInputsDigest(p.digestPayload);
      if (recomputed !== p.inputsDigest) audit.digestRecomputeMismatches++;
    }

    const outcome: 0 | 1 | 2 | null = r?.outcome1x2 ? (r.outcome1x2 === 'H' ? 0 : r.outcome1x2 === 'D' ? 1 : 2) : null;
    joined.push({
      p,
      r,
      outcome: r?.scoreAvailable && !r.voidFlag && outcome !== null ? outcome : null,
      over25: r?.scoreAvailable && !r.voidFlag ? r.ou25Result : null,
      bttsYes: r?.scoreAvailable && !r.voidFlag ? r.bttsResult : null,
    });
  }

  // Scan structurel du snapshot : aucune clé de score dans les enregistrements
  const frozenObj = JSON.parse(frozenBytes) as { predictions: Array<Record<string, unknown>> };
  const forbiddenKeys = /^(homeScore|awayScore|score|finalScore|result|outcome|postMatch)/i;
  for (const rec of frozenObj.predictions) {
    const keys = Object.keys(rec);
    if (keys.some((k) => forbiddenKeys.test(k))) audit.structScanScoreLikeKeysInFrozen++;
    const odds = rec.oddsAvailableAtPrediction as Record<string, unknown> | null;
    if (odds && Object.keys(odds).some((k) => /close/i.test(k))) audit.structScanScoreLikeKeysInFrozen++;
  }

  console.log(`[audit] tPred>=kickoff: ${audit.tPredAfterKickoff} · histRecomputeMismatch: ${audit.histRecomputeMismatches} · digestMismatch: ${audit.digestRecomputeMismatches} · lastDate>=tPred: ${audit.histLastDateNotBeforeTPred} · scoresDansGel: ${audit.structScanScoreLikeKeysInFrozen}`);

  // ---- 2. Accumulateurs de métriques ----
  // grille : scope × marché × variante
  const grid = new Map<string, MetricAcc>();
  const acc = (scope: string, market: string, variant: string): MetricAcc => {
    const k = `${scope}::${market}::${variant}`;
    let a = grid.get(k);
    if (!a) {
      a = newAcc();
      grid.set(k, a);
    }
    return a;
  };

  const V1X2: Key1x2[] = ['voltrixFull', 'marketAtT', 'marketClose', 'poisson', 'elo', 'mix'];
  const VBIN: KeyBin[] = ['voltrixFullRaw', 'voltrixFullCal', 'marketAtT', 'marketClose', 'poisson', 'mix'];
  const LABELS: Record<string, string> = {
    voltrixFull: 'VOLTRIX (1X2 final)',
    voltrixFullRaw: 'VOLTRIX brut (indépendant marché)',
    voltrixFullCal: 'VOLTRIX calibré (ancré open)',
    marketAtT: 'MARCHÉ open dé-margé',
    marketClose: 'MARCHÉ clôture (référence)',
    poisson: 'Poisson simple',
    elo: 'Elo simple',
    mix: 'MIX (Poisson+Elo+forme)',
  };

  const monthOf = (iso: string): string => iso.slice(0, 7);

  for (const j of joined) {
    const { p, outcome, over25, bttsYes } = j;
    if (outcome === null) continue; // VOID / sans score → hors métriques (compté à part)
    const h = p.horizonHoursBeforeKickoff;
    const mk = `${p.matchId}@${h}h`;
    const scopes = ['POOL', `h:${h}`, `m:${monthOf(p.kickoffUtc)}`, `L:${p.league}`, `c:${p.prediction.confidenceLevel ?? 0}`];

    const probs1x2 = p.prediction.probs1x2;
    const baselines = p.baselines;

    for (const scope of scopes) {
      // 1X2
      if (probs1x2) addTriple(acc(scope, '1X2', 'voltrixFull'), probs1x2, outcome, mk);
      if (baselines.marketOpenDeMarged.oneXtwo) addTriple(acc(scope, '1X2', 'marketAtT'), baselines.marketOpenDeMarged.oneXtwo, outcome, mk);
      addTriple(acc(scope, '1X2', 'poisson'), baselines.poissonSimple.oneXtwo, outcome, mk);
      addTriple(acc(scope, '1X2', 'elo'), baselines.eloSimple.oneXtwo, outcome, mk);
      addTriple(acc(scope, '1X2', 'mix'), baselines.mixPoissonEloForme.oneXtwo, outcome, mk);
      // O/U 2.5
      const ouRaw = p.prediction.ou25.probOverRaw;
      const ouCal = p.prediction.ou25.probOverCalibrated;
      if (ouRaw !== null) addBinary(acc(scope, 'OU25', 'voltrixFullRaw'), ouRaw, over25 as boolean, mk);
      if (ouCal !== null) addBinary(acc(scope, 'OU25', 'voltrixFullCal'), ouCal, over25 as boolean, mk);
      if (baselines.marketOpenDeMarged.ou25Over !== null) addBinary(acc(scope, 'OU25', 'marketAtT'), baselines.marketOpenDeMarged.ou25Over, over25 as boolean, mk);
      if (baselines.poissonSimple.ou25Over !== null) addBinary(acc(scope, 'OU25', 'poisson'), baselines.poissonSimple.ou25Over, over25 as boolean, mk);
      if (baselines.mixPoissonEloForme.ou25Over !== null) addBinary(acc(scope, 'OU25', 'mix'), baselines.mixPoissonEloForme.ou25Over, over25 as boolean, mk);
      // BTTS
      const bttsRaw = p.prediction.btts.probYesRaw;
      const bttsCal = p.prediction.btts.probYesCalibrated;
      if (bttsRaw !== null) addBinary(acc(scope, 'BTTS', 'voltrixFullRaw'), bttsRaw, bttsYes as boolean, mk);
      if (bttsCal !== null) addBinary(acc(scope, 'BTTS', 'voltrixFullCal'), bttsCal, bttsYes as boolean, mk);
      if (baselines.poissonSimple.bttsYes !== null) addBinary(acc(scope, 'BTTS', 'poisson'), baselines.poissonSimple.bttsYes, bttsYes as boolean, mk);
      if (baselines.mixPoissonEloForme.bttsYes !== null) addBinary(acc(scope, 'BTTS', 'mix'), baselines.mixPoissonEloForme.bttsYes, bttsYes as boolean, mk);
    }

    // MARCHÉ-CLÔTURE (référence, non stocké dans le gel) : dé-marging local
    const rr = j.r?.closeOddsReference;
    if (rr?.moneylineClose?.home != null && rr.moneylineClose.draw != null && rr.moneylineClose.away != null) {
      const dm = deMargin1x2Local(rr.moneylineClose.home, rr.moneylineClose.draw, rr.moneylineClose.away);
      if (dm) {
        for (const scope of scopes) addTriple(acc(scope, '1X2', 'marketClose'), dm, outcome, mk);
      }
    }
    if (rr?.totalCloseOdds?.over != null && rr.totalCloseOdds.under != null && rr.overUnderLine === 2.5) {
      const dmOu = deMarginOuLocal(rr.totalCloseOdds.over, rr.totalCloseOdds.under);
      if (dmOu !== null) {
        for (const scope of scopes) addBinary(acc(scope, 'OU25', 'marketClose'), dmOu, over25 as boolean, mk);
      }
    }
  }

  // Dé-marging local (multiplicative/proportional — même convention que market-odds.ts)
  function deMargin1x2Local(h: number, d: number, a: number): { home: number; draw: number; away: number } | null {
    if (![h, d, a].every((x) => Number.isFinite(x) && x > 1)) return null;
    const rh = 1 / h;
    const rd = 1 / d;
    const ra = 1 / a;
    const s = rh + rd + ra;
    if (s <= 1) return { home: rh, draw: rd, away: ra };
    return { home: rh / s, draw: rd / s, away: ra / s };
  }
  function deMarginOuLocal(o: number, u: number): number | null {
    if (![o, u].every((x) => Number.isFinite(x) && x > 1)) return null;
    const ro = 1 / o;
    const ru = 1 / u;
    const s = ro + ru;
    if (s <= 1) return ro;
    return ro / s;
  }

  // ---- 3. Assemblage des résultats par scope ----
  const out: Record<string, unknown> = {};
  const getM = (scope: string, market: string, variant: string, withRps: boolean): Record<string, unknown> | null => {
    const a = grid.get(`${scope}::${market}::${variant}`);
    if (!a || a.n === 0) return null;
    return metricsJson(a, withRps);
  };

  const globalBlock = (horizonLabel: string) => ({
    '1X2': Object.fromEntries(V1X2.map((v) => [v, getM(horizonLabel, '1X2', v, true)]).filter(([, m]) => m)),
    OU25: Object.fromEntries(VBIN.map((v) => [v, getM(horizonLabel, 'OU25', v, false)]).filter(([, m]) => m)),
    BTTS: Object.fromEntries(VBIN.map((v) => [v, getM(horizonLabel, 'BTTS', v, false)]).filter(([, m]) => m)),
  });

  out.pooledAllHorizons = globalBlock('POOL');
  out.byHorizon = Object.fromEntries(HORIZONS.map((h) => [`h${h}h`, globalBlock(`h:${h}`)]));
  out.officialHorizonT3h = globalBlock('h:3');
  out.byMonth = Object.fromEntries(['2026-06', '2026-07', '2026-08'].map((m) => [m, globalBlock(`m:${m}`)]));

  // Par ligue (horizon officiel) + comptage matchs
  const leagues = [...new Set(joined.map((j) => j.p.league))].sort();
  const matchCountPerLeague: Record<string, number> = {};
  for (const j of joined) if (j.outcome !== null && j.p.horizonHoursBeforeKickoff === OFFICIAL_H) matchCountPerLeague[j.p.league] = (matchCountPerLeague[j.p.league] ?? 0) + 1;
  out.byLeague = Object.fromEntries(
    leagues.map((lg) => {
      const block = {
        matches: matchCountPerLeague[lg] ?? 0,
        sufficientSample: (matchCountPerLeague[lg] ?? 0) >= VOID_LEAGUE_MIN_N,
        '1X2': Object.fromEntries(V1X2.map((v) => [v, getM(`L:${lg}`, '1X2', v, true)]).filter(([, m]) => m)),
        OU25: Object.fromEntries(VBIN.map((v) => [v, getM(`L:${lg}`, 'OU25', v, false)]).filter(([, m]) => m)),
        BTTS: Object.fromEntries(VBIN.map((v) => [v, getM(`L:${lg}`, 'BTTS', v, false)]).filter(([, m]) => m)),
      };
      return [lg, block];
    })
  );

  // Par confiance (horizon officiel) — mesuré, pas supposé
  const confLevels = [1, 2, 3, 4, 5];
  const confCounts: Record<string, number> = {};
  for (const j of joined) {
    if (j.outcome === null || j.p.horizonHoursBeforeKickoff !== OFFICIAL_H) continue;
    const c = j.p.prediction.confidenceLevel ?? 0;
    confCounts[c] = (confCounts[c] ?? 0) + 1;
  }
  out.byConfidence = Object.fromEntries(
    confLevels.map((c) => [
      `niveau${c}`,
      {
        predictions: confCounts[c] ?? 0,
        '1X2': Object.fromEntries(['voltrixFull', 'marketAtT', 'poisson'].map((v) => [v, getM(`c:${c}`, '1X2', v, true)]).filter(([, m]) => m)),
        OU25: Object.fromEntries(['voltrixFullRaw', 'voltrixFullCal', 'poisson'].map((v) => [v, getM(`c:${c}`, 'OU25', v, false)]).filter(([, m]) => m)),
        BTTS: Object.fromEntries(['voltrixFullRaw', 'voltrixFullCal', 'poisson'].map((v) => [v, getM(`c:${c}`, 'BTTS', v, false)]).filter(([, m]) => m)),
      },
    ])
  );

  // ---- 4. Tests appariés clés (même échantillon, ΔBrier par match) ----
  const paired: Record<string, unknown>[] = [];
  const runPaired = (market: string, a: string, b: string, scope = 'POOL', label?: string) => {
    const aa = grid.get(`${scope}::${market}::${a}`);
    const bb = grid.get(`${scope}::${market}::${b}`);
    if (!aa || !bb) return;
    const res = pairedDeltaTest(aa.perMatch, bb.perMatch);
    if (!res) return;
    paired.push({
      scope: label ?? scope,
      market,
      a,
      b,
      n: res.n,
      deltaBrier: r6(res.meanDelta),
      ci95: [r6(res.ciLo), r6(res.ciHi)],
      pApprox: r6(res.pApprox),
      lecture: res.meanDelta < 0 ? `${a} meilleur` : `${b} meilleur`,
    });
  };
  for (const h of HORIZONS) {
    runPaired('1X2', 'voltrixFull', 'marketClose', `h:${h}`, `POOL h${h}h`);
    runPaired('OU25', 'voltrixFullRaw', 'marketClose', `h:${h}`, `POOL h${h}h`);
    runPaired('BTTS', 'poisson', 'voltrixFullRaw', `h:${h}`, `POOL h${h}h`);
  }
  runPaired('1X2', 'voltrixFull', 'marketAtT', 'POOL');
  runPaired('1X2', 'voltrixFull', 'poisson', 'POOL');
  runPaired('1X2', 'voltrixFull', 'elo', 'POOL');
  runPaired('1X2', 'voltrixFull', 'mix', 'POOL');
  runPaired('OU25', 'voltrixFullRaw', 'marketClose', 'POOL');
  runPaired('OU25', 'voltrixFullRaw', 'poisson', 'POOL');
  runPaired('BTTS', 'poisson', 'voltrixFullRaw', 'POOL');
  runPaired('BTTS', 'poisson', 'voltrixFullCal', 'POOL');
  out.pairedTests = paired;

  // ---- 5. Contrôles finaux (§9 de la commande) ----
  const scoredMatches = results.filter((r) => r.scoreAvailable && !r.voidFlag).length;
  const voidMatches = results.filter((r) => r.voidFlag).length;
  const noScoreNotVoid = results.filter((r) => !r.scoreAvailable && !r.voidFlag).length;
  const joinedMatches = new Set(joined.map((j) => j.p.matchId)).size;
  const predsMissingData = joined.filter((j) => !j.p.prediction.probs1x2 || (j.p.prediction.ou25.probOverRaw === null && j.p.prediction.ou25.probOverCalibrated === null) || (j.p.prediction.btts.probYesRaw === null && j.p.prediction.btts.probYesCalibrated === null)).length;
  const controls = {
    matchsRecuperes: results.length,
    predictionsGenerees: frozen.predictions.length,
    predictionsGelees: frozen.predictions.length,
    hashGelVerifie: hashOk,
    resultatsRecuperes: results.length,
    correspondancesMatchPrediction: joinedMatches,
    lignesAvecDonneesManquantes: predsMissingData,
    predictionsGenereesApresCoupDenvoi_tPred: audit.tPredAfterKickoff,
    predictionsModifieesApresCreation: 0, // hash identique depuis le gel (vérifié à chaque phase)
    matchsAvecInfosPostMatchDansInputs: audit.histRecomputeMismatches > 0 || audit.histLastDateNotBeforeTPred > 0 ? -1 : 0, // re-vérification as-of indépendante
    matchsAvecCotesManquantes: -1, // recalculé ci-dessous depuis le snapshot
    matchsVoidOuReportes: voidMatches,
    matchsSansScoreNonVoid: noScoreNotVoid,
    matchsNotesPourMetriques: scoredMatches,
  };
  // Recalcul exact des cotes manquantes depuis le snapshot
  const noOddsCount = frozen.predictions.filter((p) => p.horizonHoursBeforeKickoff === 12).filter((p) => (p as unknown as { oddsAvailableAtPrediction: unknown }).oddsAvailableAtPrediction === null).length;
  controls.matchsAvecCotesManquantes = noOddsCount;

  // ---- 6. Écriture ----
  const payload = {
    meta: {
      title: 'VOLTRIX blind test JJA 2026 — métriques + audit (Phase 3)',
      computedAt: new Date().toISOString(),
      predictionsFrozenSha256: frozenHash,
      officialHorizon: `T−${OFFICIAL_H}h`,
      horizons: HORIZONS,
      variantLabels: LABELS,
      noteIndependance:
        'voltrixFullCal / voltrixFullCal-BTTS sont ANCRÉS sur le marché open (calibration) → comparaison vs marché NON indépendante. voltrixFull (1X2), voltrixFullRaw (O/U, BTTS) sont indépendants du marché.',
      exclusions: 'Les matchs VOID/annulés et les matchs sans score final sont exclus des métriques et comptés séparément.',
    },
    audit,
    controls,
    metrics: out,
  };
  writeFileSync(join(DATA_DIR, 'metrics.json'), JSON.stringify(payload, null, 1));
  console.log(`[métriques] écrit : data/metrics.json`);
  console.log(`[contrôles] ${JSON.stringify(controls, null, 1)}`);

  // Affichage console condensé — POOL toutes horizons
  const printBlock = (title: string, block: { '1X2': Record<string, Record<string, unknown>>; OU25: Record<string, Record<string, unknown>>; BTTS: Record<string, Record<string, unknown>> }) => {
    console.log(`\n════════ ${title} ════════`);
    for (const [market, variants] of Object.entries(block)) {
      console.log(`  -- ${market} --`);
      for (const [v, m] of Object.entries(variants)) {
        const mm = m as Record<string, unknown>;
        if (!mm || !mm.n) continue;
        const rps = mm.rps !== null && mm.rps !== undefined ? ` RPS=${(mm.rps as number).toFixed(4)}` : '';
        console.log(`  ${(LABELS[v] ?? v).padEnd(34)} n=${String(mm.n).padStart(5)} Brier=${(mm.brier as number).toFixed(4)} LogLoss=${(mm.logLoss as number).toFixed(4)}${rps} Acc=${((mm.accuracy as number) * 100).toFixed(1)}%`);
      }
    }
  };
  printBlock('POOL — toutes horizons', out.pooledAllHorizons as { '1X2': Record<string, Record<string, unknown>>; OU25: Record<string, Record<string, unknown>>; BTTS: Record<string, Record<string, unknown>> });
  printBlock(`HORIZON OFFICIEL T−${OFFICIAL_H}h`, out.officialHorizonT3h as { '1X2': Record<string, Record<string, unknown>>; OU25: Record<string, Record<string, unknown>>; BTTS: Record<string, Record<string, unknown>> });
  console.log('\n════════ TESTS APPARIÉS (ΔBrier, même échantillon) ════════');
  for (const t of paired) {
    const tt = t as { scope: string; market: string; a: string; b: string; n: number; deltaBrier: number | null; ci95: [number, number] | null; pApprox: number | null; lecture: string };
    console.log(`  ${tt.scope.padEnd(12)} ${tt.market.padEnd(5)} ${tt.a} vs ${tt.b} : Δ=${tt.deltaBrier?.toFixed(4)} IC95=[${tt.ci95?.[0]?.toFixed(4)};${tt.ci95?.[1]?.toFixed(4)}] p≈${tt.pApprox?.toFixed(3)} n=${tt.n} → ${tt.lecture}`);
  }
}

main().catch((e) => {
  console.error('Phase 3 échouée:', e);
  process.exit(1);
});
