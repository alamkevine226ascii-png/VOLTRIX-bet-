#!/usr/bin/env bun
// ============================================================
// VOLTRIX bet — Blind test JJA 2026 · PHASE 1c : PRÉDICTIONS + GEL
// ============================================================
// PHASE 1 (prédictions) — étape 3/3.
// Pour chaque match × horizon (T−12h, T−6h, T−3h, T−1h) :
//   - entrées as-of STRICTES (evaluateMatchV3, harnais 21-d/22-c inchangé) :
//       · historiques équipes : matchs COMPLÉTÉS de date STRICTEMENT < T_pred ;
//       · classement : synthétisé depuis ces matchs (aucun endpoint standings) ;
//       · blessures : [] (endpoint ESPN = état actuel = fuite → exclues) ;
//       · météo : null (hors λ depuis 21-b) ;
//       · cotes : OPEN uniquement (close INTERDITE en input).
//   - moteur VOLTRIX (runEngine, MODEL_VERSION) + baselines (marché-open,
//     Poisson simple, Elo simple, MIX) sur les MÊMES entrées.
//   - confiance : lecture directe d'un runEngine sur l'input EXACT de la
//     variante VOLTRIX-FULL (vérification d'égalité bit à bit des probs).
// Puis GEL : écriture du snapshot, hash SHA-256 du fichier, horodatage.
// AUCUN score n'est lu par ce script (fixtures.json n'en contient pas).
//
// Sorties :
//   data/predictions-frozen.json       (snapshot des prédictions)
//   data/predictions-frozen.json.sha256 (empreinte du snapshot)
// ============================================================

import { MODEL_VERSION } from '../../src/lib/model-version';
import { runEngine, type EngineInput } from '../../src/lib/prediction';
import {
  evaluateMatchV3,
  allGamesOf,
  filterAsOfGames,
  synthStandings,
  buildInputsDigest,
  type EvalMatchRef,
  type EspnOdds,
  type EspnScheduleGame,
  type ScheduleKey,
  type TeamSeasonSchedules,
} from '../backtest-lib';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, resolve } from 'node:path';

const SCRIPT_DIR = dirname(resolve(process.argv[1] ?? '.'));
const DATA_DIR = join(SCRIPT_DIR, 'data');

const HORIZONS = [12, 6, 3, 1]; // heures avant le coup d'envoi (décroissant)

interface Fixture {
  matchId: string;
  league: string;
  kickoff: string;
  homeId: string;
  homeName: string;
  awayId: string;
  awayName: string;
  status: string;
  statusDetail: string;
  completed: boolean;
}

interface OpenOddsEntry {
  hasOpen: boolean;
  provider: string | null;
  moneyline: { home: number | null; draw: number | null; away: number | null } | null;
  overUnderLine: number | null;
  total: { overOpenOdds: number | null; underOpenOdds: number | null; line: number | null } | null;
}

function r6(x: number): number | null {
  return Number.isFinite(x) ? Math.round(x * 1e6) / 1e6 : null;
}

function rebuildOpenOdds(e: OpenOddsEntry | undefined): EspnOdds | null {
  if (!e || !e.hasOpen) return null;
  return {
    provider: e.provider ?? 'ESPN',
    overUnderLine: e.overUnderLine,
    moneyline: {
      home: { open: e.moneyline?.home ?? null, close: null }, // close FORCÉMENT null (phase 1)
      draw: { open: e.moneyline?.draw ?? null, close: null },
      away: { open: e.moneyline?.away ?? null, close: null },
    },
    total: {
      over: { line: e.total?.line ?? null, openOdds: e.total?.overOpenOdds ?? null, closeOdds: null },
      under: { line: e.total?.line ?? null, openOdds: e.total?.underOpenOdds ?? null, closeOdds: null },
    },
    hasOdds: true,
  };
}

async function main(): Promise<void> {
  const fixtures = (JSON.parse(readFileSync(join(DATA_DIR, 'fixtures.json'), 'utf8')) as { fixtures: Fixture[] }).fixtures;
  const schedRaw = JSON.parse(readFileSync(join(DATA_DIR, 'schedules.json'), 'utf8')) as {
    schedules: Record<string, Record<string, EspnScheduleGame[]>>;
  };
  const oddsRaw = JSON.parse(readFileSync(join(DATA_DIR, 'odds-open.json'), 'utf8')) as { meta: { capturedAt: string }; odds: Record<string, OpenOddsEntry> };
  const oddsCapturedAt = oddsRaw.meta.capturedAt;

  const schedules = new Map<ScheduleKey, TeamSeasonSchedules>();
  for (const [key, bySeason] of Object.entries(schedRaw.schedules)) {
    const m = new Map<number, EspnScheduleGame[]>();
    for (const [season, games] of Object.entries(bySeason)) m.set(parseInt(season, 10), games);
    schedules.set(key, { bySeason: m });
  }

  console.log(`[prédictions] ${fixtures.length} matchs × ${HORIZONS.length} horizons (T−${HORIZONS.join('h, T−')}h) · modèle ${MODEL_VERSION}…`);

  const records: Record<string, unknown>[] = [];
  let noOpenOdds = 0;
  let shortHistory = 0;
  let digestMismatches = 0;
  let probsMismatch = 0;
  const startedAt = Date.now();

  for (let i = 0; i < fixtures.length; i++) {
    const f = fixtures[i];
    const fx: EvalMatchRef = {
      id: f.matchId,
      league: f.league,
      kickoff: f.kickoff,
      homeId: f.homeId,
      homeName: f.homeName,
      homeLogo: null,
      awayId: f.awayId,
      awayName: f.awayName,
      awayLogo: null,
    };
    const oddsOpen = rebuildOpenOdds(oddsRaw.odds[f.matchId]);
    if (!oddsOpen) noOpenOdds++;
    const oddsCloseRef: EspnOdds | null = null; // INTERDIT en phase 1
    const homeGamesAll = allGamesOf(schedules, f.league, f.homeId);
    const awayGamesAll = allGamesOf(schedules, f.league, f.awayId);

    for (const h of HORIZONS) {
      const ev = evaluateMatchV3(fx, oddsOpen, oddsCloseRef, homeGamesAll, awayGamesAll, null, h);

      // --- Confiance + inputs reconstitués (MÊME construction que la variante
      //     VOLTRIX-FULL d'evaluateMatchV3 — fonction pure, aucun réseau) ---
      const kickoffMs = Date.parse(f.kickoff);
      const tPredMs = ev.tPredMs;
      const homeGames = filterAsOfGames(homeGamesAll, tPredMs);
      const awayGames = filterAsOfGames(awayGamesAll, tPredMs);
      const standings = synthStandings(f.homeId, homeGames, f.awayId, awayGames);
      const engineInput: EngineInput = {
        homeTeam: { id: f.homeId, name: f.homeName, logo: null, schedule: homeGames, standings: standings.home },
        awayTeam: { id: f.awayId, name: f.awayName, logo: null, schedule: awayGames, standings: standings.away },
        injuries: [],
        odds: oddsOpen,
        isDerby: false,
        weatherImpact: null,
        nowMs: tPredMs,
        leagueTeamsCount: standings.teamsCount,
      };
      const fullRes = runEngine(engineInput);
      const sameProbs =
        Math.abs(fullRes.prediction.probs.home - (ev.oneXtwo.voltrixFull?.home ?? NaN)) < 1e-12 &&
        Math.abs(fullRes.prediction.probs.draw - (ev.oneXtwo.voltrixFull?.draw ?? NaN)) < 1e-12 &&
        Math.abs(fullRes.prediction.probs.away - (ev.oneXtwo.voltrixFull?.away ?? NaN)) < 1e-12;
      if (!sameProbs) probsMismatch++;

      // --- Payload du digest reconstruit à l'identique d'evaluateMatchV3 ---
      const digestPayload = {
        v: MODEL_VERSION,
        id: f.matchId,
        league: f.league,
        tPred: new Date(tPredMs).toISOString(),
        horizonH: h,
        home: ev.hist.home,
        away: ev.hist.away,
        standingsTeamsCount: standings.teamsCount,
        oddsOpen: oddsOpen
          ? {
              ml: [oddsOpen.moneyline.home.open, oddsOpen.moneyline.draw.open, oddsOpen.moneyline.away.open],
              line: oddsOpen.overUnderLine,
              ou: [oddsOpen.total.over.openOdds, oddsOpen.total.under.openOdds],
            }
          : null,
        leagueParams: null,
      };
      const recomputedDigest = buildInputsDigest(digestPayload);
      if (recomputedDigest !== ev.digest) digestMismatches++;

      if (ev.hist.home.n < 3 || ev.hist.away.n < 3) shortHistory++;

      const pick1x2 = ev.oneXtwo.voltrixFull;
      const pickIdx = pick1x2 ? (pick1x2.home >= pick1x2.draw && pick1x2.home >= pick1x2.away ? 'H' : pick1x2.away >= pick1x2.home && pick1x2.away >= pick1x2.draw ? 'A' : 'D') : null;
      const ouCal = ev.ou25.voltrixFullCal ?? ev.ou25.voltrixFullRaw;
      const bttsCal = ev.btts.voltrixFullCal ?? ev.btts.voltrixFullRaw;

      const oddsEcho = oddsOpen
        ? {
            provider: oddsOpen.provider,
            moneylineOpen: { home: oddsOpen.moneyline.home.open, draw: oddsOpen.moneyline.draw.open, away: oddsOpen.moneyline.away.open },
            overUnderLine: oddsOpen.overUnderLine,
            totalOpenOdds: { over: oddsOpen.total.over.openOdds, under: oddsOpen.total.under.openOdds, line: oddsOpen.total.over.line },
          }
        : null;

      records.push({
        // ---- identité du match ----
        matchId: f.matchId,
        league: f.league,
        kickoffUtc: f.kickoff,
        homeTeam: f.homeName,
        awayTeam: f.awayName,
        homeTeamId: f.homeId,
        awayTeamId: f.awayId,
        // ---- temps ----
        tPredUtc: new Date(tPredMs).toISOString(),
        horizonHoursBeforeKickoff: h,
        generatedAtUtc: new Date().toISOString(),
        timestampSource: 'T_pred simulé = kickoff − horizon (simulation rétrospective) ; generatedAtUtc = horodatage du pipeline',
        // ---- modèle ----
        modelVersion: MODEL_VERSION,
        engine: 'VOLTRIX-FULL (runEngine, contexte v2.1 complet)',
        // ---- prédiction VOLTRIX ----
        prediction: {
          probs1x2: pick1x2 ? { home: r6(pick1x2.home), draw: r6(pick1x2.draw), away: r6(pick1x2.away) } : null,
          pick1x2: pickIdx,
          ou25: {
            probOverCalibrated: r6(ev.ou25.voltrixFullCal ?? Number.NaN),
            probOverRaw: r6(ev.ou25.voltrixFullRaw ?? Number.NaN),
            pick: ouCal !== undefined ? (ouCal >= 0.5 ? 'Over' : 'Under') : null,
          },
          btts: {
            probYesCalibrated: r6(ev.btts.voltrixFullCal ?? Number.NaN),
            probYesRaw: r6(ev.btts.voltrixFullRaw ?? Number.NaN),
            pick: bttsCal !== undefined ? (bttsCal >= 0.5 ? 'Oui' : 'Non') : null,
          },
          confidenceLevel: fullRes.prediction.confidence,
          confidenceLabel: fullRes.prediction.confidenceLabel,
          lambda: { home: r6(fullRes.prediction.lambda.home), away: r6(fullRes.prediction.lambda.away) },
        },
        // ---- baselines (mêmes entrées, mêmes matchs) ----
        baselines: {
          marketOpenDeMarged: {
            oneXtwo: ev.oneXtwo.marketAtT ? { home: r6(ev.oneXtwo.marketAtT.home), draw: r6(ev.oneXtwo.marketAtT.draw), away: r6(ev.oneXtwo.marketAtT.away) } : null,
            ou25Over: r6(ev.ou25.marketAtT ?? Number.NaN),
          },
          poissonSimple: {
            oneXtwo: { home: r6(ev.oneXtwo.poisson.home), draw: r6(ev.oneXtwo.poisson.draw), away: r6(ev.oneXtwo.poisson.away) },
            ou25Over: r6(ev.ou25.poisson),
            bttsYes: r6(ev.btts.poisson),
            lambda: { home: r6(ev.lambdas.poisson.h), away: r6(ev.lambdas.poisson.a) },
          },
          eloSimple: { oneXtwo: { home: r6(ev.oneXtwo.elo.home), draw: r6(ev.oneXtwo.elo.draw), away: r6(ev.oneXtwo.elo.away) } },
          mixPoissonEloForme: {
            oneXtwo: { home: r6(ev.oneXtwo.mix.home), draw: r6(ev.oneXtwo.mix.draw), away: r6(ev.oneXtwo.mix.away) },
            ou25Over: r6(ev.ou25.mix),
            bttsYes: r6(ev.btts.mix),
          },
        },
        // ---- cotes disponibles au moment de la prédiction ----
        oddsAvailableAtPrediction: oddsEcho,
        oddsCapturedAtUtc: oddsEcho ? oddsCapturedAt : null,
        oddsNote: oddsEcho
          ? 'Open DraftKings (dé-margée pour la baseline marché) ; ESPN ne fournit aucun timestamp de cote — limitation documentée au rapport.'
          : 'Aucune cote open disponible pour ce match.',
        // ---- entrées as-of (audit / reproductibilité) ----
        inputs: {
          policy: 'historiques strictement < T_pred · classement synthétisé as-of · blessures=[] · météo=null · cotes=open-only',
          historyHome: ev.hist.home,
          historyAway: ev.hist.away,
          standingsTeamsCount: standings.teamsCount,
          injuries: [],
          weather: null,
        },
        digestPayload,
        inputsDigest: ev.digest,
      });
    }
    if ((i + 1) % 100 === 0) console.log(`[prédictions] ${i + 1}/${fixtures.length} matchs · ${records.length} enregistrements`);
  }

  const frozenAt = new Date().toISOString();
  const elapsedS = Math.round((Date.now() - startedAt) / 1000);
  const perMonth: Record<string, number> = { '2026-06': 0, '2026-07': 0, '2026-08': 0 };
  for (const r of records) perMonth[((r as { kickoffUtc: string }).kickoffUtc).slice(0, 7)]++;

  const payload = {
    meta: {
      title: 'VOLTRIX blind test JJA 2026 — PRÉDICTIONS GELÉES (Phase 1)',
      frozenAt,
      modelVersion: MODEL_VERSION,
      horizons: HORIZONS,
      counts: {
        matches: fixtures.length,
        predictions: records.length,
        matchesWithoutOpenOdds: noOpenOdds,
        predictionsWithShortHistoryLt3: shortHistory,
        digestMismatches,
        probsMismatchVsEngineRerun: probsMismatch,
      },
      perMonth,
      freezePolicy: 'Snapshot écrit une seule fois puis scellé (SHA-256). Aucune réécriture autorisée après gel.',
      antiLeakage:
        'Aucun score/post-match accessible à ce stade : fixtures.json ne contient aucun score ; entrées as-of strictes (< T_pred) ; cotes open uniquement ; close absente de la Phase 1.',
    },
    predictions: records,
  };

  const outPath = join(DATA_DIR, 'predictions-frozen.json');
  const json = JSON.stringify(payload, null, 0);
  writeFileSync(outPath, json);
  const hash = createHash('sha256').update(json).digest('hex');
  writeFileSync(`${outPath}.sha256`, `${hash}  predictions-frozen.json\n`);
  console.log(`\n[gel] ${records.length} prédictions figées (${perMonth['2026-06']} juin / ${perMonth['2026-07']} juillet / ${perMonth['2026-08']} août)`);
  console.log(`[gel] sans cotes open : ${noOpenOdds} matchs · historique court (<3 matchs) : ${shortHistory} prédictions`);
  console.log(`[gel] contrôles internes : digestMismatch=${digestMismatches} probsMismatch=${probsMismatch} (attendu 0/0)`);
  console.log(`[gel] SHA-256 : ${hash}`);
  console.log(`[gel] écrit : ${outPath} (+ .sha256) · ${Math.round(json.length / 1e6)} Mo · ${elapsedS}s`);
}

main().catch((e) => {
  console.error('Phase 1c échouée:', e);
  process.exit(1);
});
