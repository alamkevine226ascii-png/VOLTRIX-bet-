"use client";

/* ============================================================
   VOLTRIX app — MOTEUR DÉDIÉ : minute du premier but (football)
   ------------------------------------------------------------
   Demandé explicitement : « crée un moteur à part avec pour
   unique but de calculer à quel minute aura lieu le premier but ».
   Séparé du moteur de prédiction principal (prediction.ts) et du
   moteur de compositions (lineups.ts) — celui-ci ne fait QUE ça.

   PRINCIPE (règle d'honnêteté : aucune donnée inventée) :
   1. La quantité prédite est la minute du 1er but D'UN MATCH.
      On l'observe donc directement : pour chaque équipe, les
      minutes réelles du 1er but des 12 derniers matchs TERMINÉS
      (summaries ESPN, keyEvents scoringPlay, plus petit but du
      match — buts des DEUX équipes confondus, car le 1er but
      d'un match dépend du tempo des deux camps).
   2. Chaque équipe donne une distribution empirique « fenêtre du
      1er but » (6 fenêtres de 15 min + 0-0), lissée vers le
      profil de ligue (retrait bayésien, α = 6 pseudo-matchs).
   3. Fusion des deux équipes par ADDITION DES HAZARDS cumulés :
      deux équipes dont les matchs s'ouvrent tard → 1er but
      réellement prédit tard ; deux équipes à ouverture rapide →
      tôt. C'est ce qui manquait à l'ancien modèle (toutes les
      fenêtres max tombaient sur 0-15 / 16-30 pour tous les
      matchs).
   4. Mise à l'échelle par le λ du match : un match à λ élevé
      (beaucoup de buts attendus) avance le 1er but, un match
      fermé le retarde (ρ = λ_match / λ_échantillon, borné).
   5. Sorties : 6 fenêtres + 0-0 (somme EXACTEMENT 1), la minute
      MÉDIANE attendue (« 1er but attendu vers la 32e ») et les
      tempo médians des deux équipes pour l'interface.

   Baseline EMPIRIQUE documentée (aucune valeur inventée) :
   échantillon ESPN de 66 matchs terminés des 5 grands
   championnats (1er-8 nov. 2026, 168 buts) — distribution du
   1er but par fenêtre [28,8 / 18,2 / 18,2 / 13,6 / 9,1 / 7,6] %
   + 4,5 % de 0-0 ; moyenne 2,545 buts/match. Le profil médian
   qui en découle (≈ 32e minute) colle à la réalité connue du
   football : le 1er but tombe RAREMENT avant la 16e.
   ============================================================ */

import { espnFetch } from "../mma/espn";
import { fetchTeamSchedule, SITE, type EspnScheduleGame } from "./espn";

// ---------- Constantes ----------

const TTL_PAST_SUMMARY = 6 * 60 * 60 * 1000; // 6 h : un match fini ne bouge plus
const MAX_RECENT_MATCHES = 12; // fenêtre d'historique par équipe

/** Retrait bayésien vers le profil de ligue : α pseudo-matchs.
 *  12 matchs réels → 67 % de poids aux données de l'équipe. */
const ALPHA = 6;

/** Distribution EMPIRIQUE de la fenêtre du 1er but (échantillon
 *  documenté ci-dessus) — repli quand aucune donnée d'équipe. */
export const BASELINE_FIRST_GOAL_WINDOWS: readonly number[] = [
  0.2879, 0.1818, 0.1818, 0.1364, 0.0909, 0.0758,
];
/** Part des 0-0 du même échantillon (3/66). */
export const BASELINE_NO_GOAL = 0.0455;
/** Moyenne de buts/match du même échantillon (168/66). */
export const SAMPLE_AVG_GOALS = 168 / 66;

/** Bornes de mise à l'échelle λ (garde-fou anti-extrême). */
const RHO_MIN = 0.55;
const RHO_MAX = 1.9;
/** λ de référence minimal (un échantillon très fermé ne doit pas
 *  diviser le hazard par plus de ~3). */
const LAMBDA_REF_MIN = 0.8;

// ---------- Types publics ----------

/** Historique RÉEL des 1ers buts des matchs d'une équipe. */
export interface TeamFirstGoals {
  /** Minute du 1er but de chaque match parsé (1..90), ou null si 0-0.
   *  Conventions : 45'+2 → 45 ; 90'+x / 105' / 120' → 90. */
  minuteOf: Array<number | null>;
  /** Nombre de matchs réellement parsés (summaries disponibles). */
  matches: number;
  /** Buts TOTAUX des matchs parsés (scores du calendrier ESPN) —
   *  référence de λ pour la mise à l'échelle du match à venir. */
  goalsInSample: number;
}

/** Titre du pronostic « 1er but » affiché par l'interface. */
export interface FirstGoalHeadline {
  /** Minute médiane attendue du 1er but (interp. linéaire de la
   *  survie entre bords de fenêtres). Null si P(aucun but) ≥ 50 %. */
  expectedMinute: number | null;
  /** Index de la fenêtre la plus probable (0..5). */
  bestWindow: number;
  /** Probabilité de cette fenêtre (0..1). */
  bestWindowProb: number;
  /** P(match sans but) — repli d'affichage. */
  noGoalProb: number;
  /** Tempo médian des matchs de chaque équipe (minutes), si observé. */
  homeMedianMinute: number | null;
  awayMedianMinute: number | null;
  /** Source : 'equipes' = 1ers buts réels observés ; 'ligue' = profil
   *  empirique seul (aucune donnée d'équipe exploitable). */
  basis: "equipes" | "ligue";
  /** Matchs réellement parsés (les deux équipes cumulées). */
  sampleMatches: number;
  /** Facteur d'échelle λ appliqué (traçabilité du calcul). */
  lambdaScale: number;
}

export interface GoalTimingEntry {
  window: string;
  label: string;
  prob: number;
  basis: "equipes" | "ligue";
  sampleMatches: number;
}

export interface FirstGoalPrediction {
  entries: GoalTimingEntry[];
  headline: FirstGoalHeadline;
}

// ---------- Fenêtres / labels ----------

export const GOAL_WINDOWS: ReadonlyArray<{ window: string; label: string }> = [
  { window: "0-15", label: "Avant la 16e" },
  { window: "16-30", label: "Entre la 16e et 30e" },
  { window: "31-45", label: "Entre la 31e et 45e" },
  { window: "46-60", label: "Entre la 46e et 60e" },
  { window: "61-75", label: "Entre la 61e et 75e" },
  { window: "76-90", label: "Après la 76e" },
];

// ---------- Parsing de l'horloge ESPN ----------
//
// clock.displayValue des buts : "72'" ou "45'+2'" (l'arrêt de jeu porte
// lui-même une apostrophe finale — la regex naive perdait ces buts).

const CLOCK_RE = /^(\d+)'\s*(?:\+\s*(\d+)')?\s*$/;

/** Minute réglementaire (1..90) d'une horloge ESPN, ou null. */
export function goalMinuteFromClock(displayValue: string): number | null {
  if (typeof displayValue !== "string") return null;
  const m = CLOCK_RE.exec(displayValue.trim());
  if (!m) return null;
  const base = parseInt(m[1] ?? "", 10);
  if (!Number.isFinite(base) || base < 1) return null;
  return Math.min(base, 90); // 45'+2 → 45 ; 90'+5 / 105' / 120' → 90
}

/** Fenêtre (0..5) d'une minute (1..90). */
export function windowOfMinute(minute: number): number {
  return Math.min(5, Math.floor((Math.min(minute, 90) - 1) / 15));
}

// ---------- Récupération des 1ers buts réels ----------

interface RawGoalSummary {
  keyEvents?: Array<{
    scoringPlay?: boolean;
    clock?: { displayValue?: string };
  }>;
}

/**
 * Historique des minutes du 1er but d'une équipe : les 12 derniers
 * matchs TERMINÉS avant `beforeISO`, lus dans les summaries ESPN
 * (cache PARTAGÉ avec lineups.ts, clé `foot:summary:{ligue}:{eventId}`,
 * TTL 6 h). Pour chaque match : le PLUS PETIT but du match (toutes
 * équipes confondues) = minute du 1er but ; 0-0 → null (compté quand
 * même : un match sans but informe la survie). Un match sans summary
 * est ignoré, jamais fabriqué. Retourne null si rien d'exploitable.
 */
export async function fetchTeamFirstGoals(
  leagueCode: string,
  teamId: string,
  seasons: number[],
  beforeISO: string,
): Promise<TeamFirstGoals | null> {
  const schedule = await fetchTeamSchedule(leagueCode, teamId, seasons).catch(() => [] as EspnScheduleGame[]);
  const beforeMs = new Date(beforeISO).getTime();
  if (!Number.isFinite(beforeMs)) return null;

  const seen = new Set<string>();
  const recent = schedule
    .filter((g) => {
      if (!g || !g.eventId || seen.has(g.eventId)) return false;
      seen.add(g.eventId);
      return (
        g.completed &&
        g.teamScore !== null &&
        g.opponentScore !== null &&
        new Date(g.date).getTime() < beforeMs
      );
    })
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, MAX_RECENT_MATCHES);
  if (recent.length === 0) return null;

  const minuteOf: Array<number | null> = [];
  let goalsInSample = 0;
  await Promise.all(
    recent.map(async (g) => {
      const raw = await espnFetch<RawGoalSummary>(`${SITE}/${leagueCode}/summary?event=${g.eventId}`, {
        cacheKey: `foot:summary:${leagueCode}:${g.eventId}`,
        ttlMs: TTL_PAST_SUMMARY,
      }).catch(() => null);
      if (!raw || !Array.isArray(raw.keyEvents)) return; // summary absent → ignoré
      let first: number | null = null;
      for (const ke of raw.keyEvents) {
        if (!ke || ke.scoringPlay !== true) continue;
        const minute = goalMinuteFromClock(ke.clock?.displayValue ?? "");
        if (minute === null) continue;
        if (first === null || minute < first) first = minute;
      }
      minuteOf.push(first);
      goalsInSample += (g.teamScore ?? 0) + (g.opponentScore ?? 0);
    }),
  );
  if (minuteOf.length === 0) return null;
  return { minuteOf, matches: minuteOf.length, goalsInSample };
}

// ---------- Modèle : fusion par hazards + mise à l'échelle λ ----------

/** Distribution (fenêtres + 0-0) d'une équipe, lissée vers la ligue. */
interface WindowDist {
  pWin: number[]; // 6 parts
  pNo: number; // 0-0
}

function teamWindowDist(t: TeamFirstGoals | null): WindowDist | null {
  if (!t || t.matches <= 0) return null;
  const counts = [0, 0, 0, 0, 0, 0];
  let noGoal = 0;
  for (const m of t.minuteOf) {
    if (m === null) noGoal++;
    else counts[windowOfMinute(m)]++;
  }
  const n = t.matches;
  const pWin = counts.map((c, i) => (c + ALPHA * BASELINE_FIRST_GOAL_WINDOWS[i]) / (n + ALPHA));
  const pNo = (noGoal + ALPHA * BASELINE_NO_GOAL) / (n + ALPHA);
  const sum = pWin.reduce((s, v) => s + v, 0) + pNo;
  if (!(sum > 0)) return null;
  return { pWin: pWin.map((v) => v / sum), pNo: pNo / sum };
}

/** Hazard cumulé aux BORDS de fenêtres [0,15,30,45,60,75,90]. */
function cumHazards(d: WindowDist): number[] {
  const edges: number[] = [0];
  let surv = 1;
  for (let w = 0; w < 6; w++) {
    surv -= d.pWin[w];
    edges.push(-Math.log(Math.max(surv, 1e-9)));
  }
  return edges;
}

/** Médiane des minutes observées (null si aucune). */
function medianOf(minutes: Array<number | null>): number | null {
  const obs = minutes.filter((m): m is number => m !== null).sort((a, b) => a - b);
  if (obs.length === 0) return null;
  const mid = Math.floor(obs.length / 2);
  const med = obs.length % 2 === 1 ? obs[mid] : (obs[mid - 1] + obs[mid]) / 2;
  return Math.max(1, Math.round(med));
}

/**
 * PRÉDICTION DU 1ER BUT.
 *
 * @param lambdaTotal buts totaux attendus du match (moteur principal)
 * @param home        historique 1ers buts de l'équipe domicile (ou null)
 * @param away        historique 1ers buts de l'équipe extérieure (ou null)
 *
 * Math : à chaque bord de fenêtre, hazard cumulé du match =
 *   (wH/2)·H_domicile + (wA/2)·H_extérieur + (1−(wH+wA)/2)·H_ligue,
 * avec wT = m_T/(m_T+α) le poids des données de l'équipe T, puis
 * multiplié par ρ = λ_match / λ_référence_des_échantillons.
 * P(fenêtre w) = S(w−1) − S(w) → somme EXACTEMENT 1 par télescopage.
 */
export function predictFirstGoal(
  lambdaTotal: number,
  home: TeamFirstGoals | null,
  away: TeamFirstGoals | null,
): FirstGoalPrediction {
  /* --- distributions par équipe (repli : baseline de ligue pure) --- */
  const homeDist = teamWindowDist(home);
  const awayDist = teamWindowDist(away);
  const baseDist: WindowDist = {
    pWin: [...BASELINE_FIRST_GOAL_WINDOWS],
    pNo: BASELINE_NO_GOAL,
  };

  /* --- hazards cumulés aux 7 bords --- */
  const HBase = cumHazards(baseDist);
  const HHome = homeDist ? cumHazards(homeDist) : null;
  const HAway = awayDist ? cumHazards(awayDist) : null;
  const wHome = home ? home.matches / (home.matches + ALPHA) : 0;
  const wAway = away ? away.matches / (away.matches + ALPHA) : 0;

  const HMatch = HBase.map((_, i) => {
    let h = (1 - (wHome + wAway) / 2) * HBase[i];
    if (HHome) h += (wHome / 2) * HHome[i];
    if (HAway) h += (wAway / 2) * HAway[i];
    return h;
  });

  /* --- mise à l'échelle par le λ du match --- */
  const lam = Number.isFinite(lambdaTotal) && lambdaTotal > 0 ? lambdaTotal : SAMPLE_AVG_GOALS;
  const lamRefs: number[] = [];
  if (home && home.matches > 0) lamRefs.push(home.goalsInSample / home.matches);
  if (away && away.matches > 0) lamRefs.push(away.goalsInSample / away.matches);
  const lamRef = Math.max(
    LAMBDA_REF_MIN,
    lamRefs.length > 0 ? lamRefs.reduce((s, v) => s + v, 0) / lamRefs.length : SAMPLE_AVG_GOALS,
  );
  const rho = Math.min(RHO_MAX, Math.max(RHO_MIN, lam / lamRef));

  const HFinal = HMatch.map((h) => h * rho);

  /* --- probabilités par fenêtre (télescopage exact) --- */
  const survAt = (edgeIdx: number): number => Math.exp(-HFinal[edgeIdx]);
  const raw: number[] = [];
  for (let w = 0; w < 6; w++) {
    raw.push(survAt(w) - survAt(w + 1));
  }
  const noGoalRaw = survAt(6);

  /* arrondi 4 décimales : 5 fenêtres arrondies, 0-0 arrondi, la 6e
     absorbe le résidu → les 7 entrées somment EXACTEMENT à 1. */
  const rounded = raw.map((p) => Math.max(0, Math.round(p * 10000) / 10000));
  const noGoal = Math.max(0, Math.min(1, Math.round(noGoalRaw * 10000) / 10000));
  let acc = 0;
  for (let w = 0; w < 5; w++) acc += rounded[w];
  rounded[5] = Math.max(0, Math.round((1 - noGoal - acc) * 10000) / 10000);

  /* --- fenêtre la plus probable --- */
  let bestWindow = 0;
  for (let w = 1; w < 6; w++) if (rounded[w] > rounded[bestWindow]) bestWindow = w;

  /* --- minute médiane attendue (interpolation linéaire de la survie) --- */
  let expectedMinute: number | null = null;
  if (1 - noGoalRaw >= 0.5) {
    // plus petite minute t telle que P(1er but ≤ t) ≥ 50 %
    if (1 - survAt(0) >= 0.5) {
      expectedMinute = Math.max(1, Math.round((0.5 / (1 - survAt(0))) * 15));
    } else {
      for (let w = 0; w < 6; w++) {
        const sLo = survAt(w);
        const sHi = survAt(w + 1);
        if (sLo > 0.5 && sHi <= 0.5) {
          const t = 15 * w + 15 * ((sLo - 0.5) / Math.max(1e-9, sLo - sHi));
          expectedMinute = Math.max(1, Math.min(90, Math.round(t)));
          break;
        }
      }
      if (expectedMinute === null) expectedMinute = 90; // défense
    }
  }

  const sampleMatches = (home?.matches ?? 0) + (away?.matches ?? 0);
  const basis: "equipes" | "ligue" = homeDist || awayDist ? "equipes" : "ligue";

  const entries: GoalTimingEntry[] = rounded.map((p, i) => ({
    window: GOAL_WINDOWS[i].window,
    label: GOAL_WINDOWS[i].label,
    prob: p,
    basis,
    sampleMatches,
  }));
  entries.push({ window: "NO_GOAL", label: "Aucun but (0-0)", prob: noGoal, basis, sampleMatches });

  return {
    entries,
    headline: {
      expectedMinute,
      bestWindow,
      bestWindowProb: rounded[bestWindow],
      noGoalProb: noGoal,
      homeMedianMinute: home ? medianOf(home.minuteOf) : null,
      awayMedianMinute: away ? medianOf(away.minuteOf) : null,
      basis,
      sampleMatches,
      lambdaScale: Math.round(rho * 100) / 100,
    },
  };
}
