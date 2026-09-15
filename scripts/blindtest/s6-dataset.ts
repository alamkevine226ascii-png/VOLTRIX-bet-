#!/usr/bin/env bun
// ============================================================
// VOLTRIX bet — Blind test JJA 2026 · PHASE 4 : DATASET FINAL (JSON)
// ============================================================
// Assemble le livrable n°1 :
//   download/VOLTRIX_blind_test_JUNE_JULY_AUGUST_2026.json
// Contenu : match par match (identité, 4 prédictions gelées avec
// digest/inputs/cotes, résultat révélé) + agrégats + audit + contrôles.
// Objectif : permettre à un tiers de RECALCULER toutes les métriques
// sans le moteur VOLTRIX.
// ============================================================

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

const SCRIPT_DIR = dirname(resolve(process.argv[1] ?? '.'));
const DATA_DIR = join(SCRIPT_DIR, 'data');
const OUT_PATH = resolve(SCRIPT_DIR, '..', '..', 'download', 'VOLTRIX_blind_test_JUNE_JULY_AUGUST_2026.json');

interface FrozenPred {
  matchId: string;
  league: string;
  kickoffUtc: string;
  homeTeam: string;
  awayTeam: string;
  homeTeamId: string;
  awayTeamId: string;
  tPredUtc: string;
  horizonHoursBeforeKickoff: number;
  generatedAtUtc: string;
  timestampSource: string;
  modelVersion: string;
  engine: string;
  prediction: Record<string, unknown>;
  baselines: Record<string, unknown>;
  oddsAvailableAtPrediction: Record<string, unknown> | null;
  oddsCapturedAtUtc: string | null;
  oddsNote: string;
  inputs: Record<string, unknown>;
  digestPayload: Record<string, unknown>;
  inputsDigest: string;
}
interface ResultRow {
  matchId: string;
  revealedAtUtc: string;
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
  closeOddsReference: Record<string, unknown> | null;
  note: string | null;
}

const COMPETITION_NAMES: Record<string, string> = {
  'fifa.world': 'Coupe du Monde FIFA 2026',
  'eng.1': 'Premier League (Angleterre)',
  'fra.1': 'Ligue 1 (France)',
  'esp.1': 'LaLiga (Espagne)',
  'ita.1': 'Serie A (Italie)',
  'ger.1': 'Bundesliga (Allemagne)',
  'bra.1': 'Brasileirão (Brésil)',
  'usa.1': 'MLS (États-Unis)',
  'mex.1': 'Liga MX (Mexique)',
  'arg.1': 'Liga Profesional (Argentine)',
  'nor.1': 'Eliteserien (Norvège)',
  'swe.1': 'Allsvenskan (Suède)',
  'irl.1': 'Premier Division (Irlande)',
  'den.1': 'Superliga (Danemark)',
  'fin.1': 'Veikkausliiga (Finlande)',
  'col.1': 'Primera A (Colombie)',
  'chi.1': 'Primera División (Chili)',
  'uru.1': 'Primera División (Uruguay)',
  'par.1': 'Primera División (Paraguay)',
  'per.1': 'Liga 1 (Pérou)',
  'ecu.1': 'LigaPro (Équateur)',
  'usa.nwsl': 'NWSL (États-Unis, féminine)',
  'jpn.1': 'J1 League (Japon)',
  'chn.1': 'Chinese Super League (Chine)',
  'kor.1': 'K League 1 (Corée du Sud)',
  'aus.1': 'A-League (Australie)',
  'conmebol.libertadores': 'Copa Libertadores',
  'conmebol.sudamericana': 'Copa Sudamericana',
  'uefa.champions': 'Ligue des Champions (qualifs)',
  'uefa.europa': 'Ligue Europa (qualifs)',
  'uefa.europa.conf': 'Conference League (qualifs)',
};

async function main(): Promise<void> {
  const frozen = JSON.parse(readFileSync(join(DATA_DIR, 'predictions-frozen.json'), 'utf8')) as { meta: Record<string, unknown>; predictions: FrozenPred[] };
  const results = (JSON.parse(readFileSync(join(DATA_DIR, 'results.json'), 'utf8')) as { meta: Record<string, unknown>; results: ResultRow[] }).results;
  const metrics = JSON.parse(readFileSync(join(DATA_DIR, 'metrics.json'), 'utf8')) as Record<string, unknown>;
  const fixturesMeta = JSON.parse(readFileSync(join(DATA_DIR, 'fixtures.json'), 'utf8')) as { meta: Record<string, unknown> };
  const oddsMeta = JSON.parse(readFileSync(join(DATA_DIR, 'odds-open.json'), 'utf8')) as { meta: Record<string, unknown> };
  const frozenHash = (metrics.meta as Record<string, string>).predictionsFrozenSha256;

  // Regroupe les prédictions par match (ordre horizons croissants de délai : 12→1)
  const predsByMatch = new Map<string, FrozenPred[]>();
  for (const p of frozen.predictions) {
    const list = predsByMatch.get(p.matchId) ?? [];
    list.push(p);
    predsByMatch.set(p.matchId, list);
  }
  for (const list of predsByMatch.values()) list.sort((a, b) => b.horizonHoursBeforeKickoff - a.horizonHoursBeforeKickoff);
  const resultsByMatch = new Map(results.map((r) => [r.matchId, r]));

  const matches: Record<string, unknown>[] = [];
  for (const [matchId, preds] of predsByMatch) {
    const first = preds[0];
    const r = resultsByMatch.get(matchId) ?? null;
    matches.push({
      matchId,
      competition: COMPETITION_NAMES[first.league] ?? first.league,
      leagueCode: first.league,
      date: first.kickoffUtc.slice(0, 10),
      kickoffUtc: first.kickoffUtc,
      homeTeam: first.homeTeam,
      awayTeam: first.awayTeam,
      homeTeamId: first.homeTeamId,
      awayTeamId: first.awayTeamId,
      // ---- PRÉDICTIONS GELÉES (Phase 1) — une par horizon ----
      predictions: preds.map((p) => ({
        tPredUtc: p.tPredUtc,
        horizonHoursBeforeKickoff: p.horizonHoursBeforeKickoff,
        generatedAtUtc: p.generatedAtUtc,
        timestampSource: p.timestampSource,
        modelVersion: p.modelVersion,
        engine: p.engine,
        probabilitiesAndPicks: p.prediction,
        oddsAvailableAtPrediction: p.oddsAvailableAtPrediction,
        oddsCapturedAtUtc: p.oddsCapturedAtUtc,
        oddsNote: p.oddsNote,
        inputsAsOf: p.inputs,
        inputsDigest: p.inputsDigest,
        digestPayload: p.digestPayload,
        baselinesSameInputs: p.baselines,
      })),
      // ---- RÉSULTAT RÉVÉLÉ (Phase 2, après gel) ----
      result: r
        ? {
            revealedAtUtc: r.revealedAtUtc,
            statusState: r.statusState,
            statusDetail: r.statusDetail,
            completed: r.completed,
            voidFlag: r.voidFlag,
            scoreFinal: r.scoreAvailable ? `${r.homeScore}-${r.awayScore}` : null,
            homeScore: r.homeScore,
            awayScore: r.awayScore,
            resultat1x2: r.outcome1x2,
            totalButs: r.totalGoals,
            resultatOverUnder25: r.ou25Result,
            resultatBtts: r.bttsResult,
            marketCloseOddsReference: r.closeOddsReference,
            note: r.note,
          }
        : null,
    });
  }

  matches.sort((a, b) => String(a.kickoffUtc).localeCompare(String(b.kickoffUtc)) || String(a.matchId).localeCompare(String(b.matchId)));

  const dataset = {
    meta: {
      title: 'VOLTRIX blind test JUIN-JUILLET-AOÛT 2026 — données brutes match par match',
      description:
        'Simulation aveugle rétrospective de validation du modèle VOLTRIX. Phase 1 : prédictions générées exclusivement depuis des données pré-match as-of, gelées et scellées (SHA-256). Phase 2 : résultats révélés APRÈS le gel et stockés séparément. Une personne extérieure peut recalculer toutes les métriques à partir de ce fichier, sans le moteur VOLTRIX.',
      generatedAtUtc: new Date().toISOString(),
      period: { from: '2026-06-01', to: '2026-08-31', months: ['juin 2026', 'juillet 2026', 'août 2026'] },
      source: {
        fixtures: 'ESPN scoreboard par (ligue, date) — 31 ligues candidates, scores strippés en Phase 1',
        preMatchData: 'ESPN team schedules (2-3 saisons, filtrés < T_pred à l’évaluation) ; cotes : ESPN summary pickcenter DraftKings, vue OPEN uniquement',
        results: 'ESPN summary (header.competitions) — récupéré en Phase 2 uniquement',
      },
      model: { version: 'v2.1', engine: 'runEngine (VOLTRIX-FULL : Poisson 45% + Elo 30% + Forme 25% + contexte v2.1, calibration O/U+BTTS ancrée open)', unchanged: 'Aucun paramètre, pondération ou règle du moteur n’a été modifié pour cette simulation.' },
      horizons: ['T-12h', 'T-6h', 'T-3h', 'T-1h'],
      officialHorizon: 'T-3h (prédictions principales du rapport PDF)',
      predictionsFrozen: {
        sha256: frozenHash,
        frozenAt: frozen.meta.frozenAt,
        file: 'predictions-frozen.json (artefact intermédiaire, copie intégrée ci-dessous)',
      },
      counts: {
        matches: matches.length,
        predictions: frozen.predictions.length,
        resultsRevealed: results.length,
        scoredMatches: results.filter((r) => r.scoreAvailable && !r.voidFlag).length,
        voidMatches: results.filter((r) => r.voidFlag).length,
        matchesWithoutOpenOdds: frozen.predictions.filter((p) => p.horizonHoursBeforeKickoff === 12 && p.oddsAvailableAtPrediction === null).length,
        perMonth: fixturesMeta.meta.counts ?? undefined,
      },
      threeStagesSeparation:
        'DONNÉES DISPONIBLES AVANT PRÉDICTION = inputsAsOf + oddsAvailableAtPrediction (open) · PRÉDICTION GELÉE = predictions[] (scellées SHA-256) · RÉSULTAT RÉVÉLÉ APRÈS MATCH = result (Phase 2, fichier séparé au moment de la révélation).',
      limitations: [
        'Simulation rétrospective : les matchs étaient déjà joués au moment de la collecte ; la discipline « blind » repose sur le filtrage as-of strict des entrées (vérifié par re-calcul indépendant) et sur la séparation en deux phases avec gel intermédiaire, PAS sur un horodatage tiers.',
        'Les cotes utilisées sont les OPEN du pickcenter ESPN (DraftKings) : ESPN ne publie aucun timestamp de cote, l’open est le proxy « disponible à T_pred » à tous les horizons (approximation documentée, section F du rapport).',
        'Blessures exclues (endpoint ESPN = état actuel = fuite) et météo neutre (hors λ depuis l’audit 21-b) — choix identiques au harnais de backtest 21-d/22-c.',
        'Les cotes CLOSE servent uniquement de référence « marché-clôture » (jamais d’entrée du moteur).',
        'Les cotes open O/U ne sont exploitables en baseline que pour les matchs à ligne exactement 2.5 (échantillons marché réduits : n indiqués dans les agrégats).',
        'Classement = table synthétisée as-of (partielle, honnête) depuis les matchs antérieurs à T_pred — jamais l’endpoint standings ESPN (fuite).',
      ],
    },
    matches,
    aggregates: metrics.metrics,
    audit: { ...(metrics.audit as Record<string, unknown>), ...(metrics.controls as Record<string, unknown>) ? { controls: metrics.controls } : {} },
  };

  writeFileSync(OUT_PATH, JSON.stringify(dataset, null, 1));
  const sizeMb = require('node:fs').statSync(OUT_PATH).size / 1e6;
  console.log(`[dataset] écrit : ${OUT_PATH}`);
  console.log(`[dataset] ${matches.length} matchs · ${frozen.predictions.length} prédictions · ${sizeMb.toFixed(1)} Mo`);
}

main().catch((e) => {
  console.error('Phase 4 échouée:', e);
  process.exit(1);
});
