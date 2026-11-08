"use client";

/* ============================================================
   VOLTRIX app — Minute du premier but (football)
   Règle d'honnêteté du projet : JAMAIS de donnée inventée.
   1. Histogrammes RÉELS des buts par fenêtre de 15 min, extraits
      des summaries ESPN (keyEvents, scoringPlay === true) des
      10 derniers matchs terminés de chaque équipe — buts POUR et
      CONTRE, car le hazard du 1er but dépend de tous les buts
      du match, pas seulement de ceux de l'équipe suivie.
   2. Profil de base EMPIRIQUE calculé sur un vrai échantillon
      ESPN (LEAGUE_BASELINE_SHARES ci-dessous, source citée).
   3. Modèle : processus de Poisson par morceaux (hazard non
      homogène) — P(1er but en fenêtre w) = e^(−Σ λv) × (1 − e^(−λw)),
      ce qui dépend enfin de QUAND chaque équipe marque vraiment.
   4. Fusion des deux équipes + retrait vers la baseline par
      shrinkage bayésien n/(n+K).
   Import : goal-timing → espn (+ mma/espn). Aucun cycle —
   espn.ts n'importe jamais goal-timing.ts.
   ============================================================ */

import { espnFetch } from "../mma/espn";
import { fetchTeamSchedule, SITE, type EspnScheduleGame } from "./espn";

// ---------- Constantes ----------

const TTL_PAST_SUMMARY = 6 * 60 * 60 * 1000; // 6 h : un match fini ne bouge plus (même TTL que lineups.ts)
const MAX_RECENT_MATCHES = 10; // fenêtre d'historique par équipe

/** Shrinkage bayésien vers la baseline : poids des données d'équipe n/(n+K).
 *  K = 60 buts : une équipe (10 matchs × ~2,5 buts ≈ 25 buts) pèse ~29 %,
 *  les deux équipes réunies (~50 buts) ~45 % — le reste vient du profil
 *  de ligue. Un histogramme bruité ne peut jamais dominer la référence. */
const BLEND_K = 60;

// ---------- Types publics ----------

/** Histogramme réel des minutes de buts d'une équipe (buts pour ET contre). */
export interface TeamGoalTiming {
  /** Buts par fenêtre : 0-15, 16-30, 31-45, 46-60, 61-75, 76-90. */
  windowGoals: number[];
  /** Nombre total de buts parsés (somme de windowGoals). */
  totalGoals: number;
  /** Nombre de matchs réellement parsés (summaries disponibles). */
  matches: number;
}

/** Source des parts réellement utilisées pour un pronostic de timing. */
export type GoalTimingBasis = "equipes" | "ligue" | "modele";

export interface GoalTimingEntry {
  window: string;
  label: string;
  prob: number;
}

export interface BlendedGoalTiming {
  /** 6 parts sommant à 1. */
  shares: number[];
  basis: GoalTimingBasis;
  sampleGoals: number;
}

// ---------- Fenêtres / labels (identiques à l'ancien marché du moteur) ----------

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
// clock.displayValue des buts : "72'" ou "45'+2'" (arrêt de jeu).
// NB : l'arrêt de jeu porte LUI-MÊME une apostrophe finale. La regex naive
// ^(\d+)'\s*(?:\+(\d+))?$ ne matche PAS "45'+2'" (apostrophe résiduelle) —
// vérifié sur 168 buts réels : 18 buts d'arrêt de jeu (10,7 % de l'échantillon,
// tous en fin de mi-temps) étaient perdus sans le second ['].

const CLOCK_RE = /^(\d+)'\s*(?:\+\s*(\d+)')?\s*$/;

/** Fenêtre (0..5) d'une horloge ESPN, ou null si non parsable.
 *  Convention : seul le TEMPS RÉGLEMENTAIRE compte pour le 1er but —
 *  45'+x reste dans la fenêtre 31-45 ; 90'+x, 105'+x et 120'+x
 *  (prolongations éventuelles) sont rabattus dans la fenêtre 76-90. */
export function goalWindowFromClock(displayValue: string): number | null {
  if (typeof displayValue !== "string") return null;
  const m = CLOCK_RE.exec(displayValue.trim());
  if (!m) return null;
  const base = parseInt(m[1] ?? "", 10);
  if (!Number.isFinite(base) || base < 1) return null;
  const minute = Math.min(base, 90); // 45'+2 → 45 ; 90'+5 / 105' / 120' → 90
  const w = Math.floor((minute - 1) / 15);
  return w >= 0 && w <= 5 ? w : null;
}

// ---------- Profil de base EMPIRIQUE (aucune valeur inventée) ----------

/**
 * Répartition réelle des buts par fenêtre de 15 minutes dans les 5 grandes
 * ligues européennes, calculée depuis les summaries ESPN :
 *   - échantillon : 66 matchs terminés, 168 buts ;
 *   - journées du 1er au 8 novembre 2026, ligues eng.1, esp.1, ger.1,
 *     ita.1, fra.1 (scoreboards quotidiens puis keyEvents de chaque match) ;
 *   - contrôles : 0 horloge non parsée, 0 écart entre buts comptés et
 *     scores finaux affichés.
 * Buts par fenêtre : 21 / 22 / 27 / 29 / 29 / 40 → parts ci-dessous.
 * La réalité connue du football est confirmée : moins de buts en tout début
 * de match, montée en puissance dans chaque mi-temps, fenêtre 76-90
 * (arrêts de jeu inclus) la plus prolifique : 23,8 % contre 16,7 % pour
 * un Poisson homogène. Sur les mêmes matchs, la distribution EMPIRIQUE du
 * 1er but était [28,8 / 18,2 / 18,2 / 13,6 / 9,1 / 7,6 %] + 4,5 % de 0-0 —
 * précieux point de comparaison pour le modèle ci-dessous.
 */
export const LEAGUE_BASELINE_SHARES: readonly number[] = [0.125, 0.131, 0.1607, 0.1726, 0.1726, 0.2381];

/** Moyenne de buts/match du même échantillon (168/66 ≈ 2,545) — repli
 *  défensif si lambdaTotal est inutilisable (NaN, négatif). */
export const SAMPLE_AVG_GOALS = 168 / 66;

/** Normalise 6 parts en probabilités (ou null si inutilisable). */
function normalizeShares(shares: number[]): number[] | null {
  if (!Array.isArray(shares) || shares.length !== 6) return null;
  let sum = 0;
  const vals = shares.map((x) => (Number.isFinite(x) && x > 0 ? x : 0));
  for (const v of vals) sum += v;
  if (sum <= 0) return null;
  return vals.map((v) => v / sum);
}

// ---------- Récupération des minutes réelles ----------

interface RawGoalSummary {
  keyEvents?: Array<{
    scoringPlay?: boolean;
    clock?: { displayValue?: string };
  }>;
}

/**
 * Histogramme des minutes de buts d'une équipe : les 10 derniers matchs
 * TERMINÉS avant `beforeISO` (les plus récents d'abord), lus dans les
 * summaries ESPN — cache PARTAGÉ avec lineups.ts (clé exacte
 * `foot:summary:{leagueCode}:{eventId}`, TTL 6 h). Les buts POUR et CONTRE
 * l'équipe comptent tous : le hazard du 1er but dépend de l'intensité
 * offensive des DEUX équipes du match.
 * Un match sans summary disponible est ignoré (jamais fabriqué) ; un 0-0
 * compte comme match parsé sans but. Retourne null si rien d'exploitable.
 */
export async function fetchTeamGoalTiming(
  leagueCode: string,
  teamId: string,
  seasons: number[],
  beforeISO: string,
): Promise<TeamGoalTiming | null> {
  const schedule = await fetchTeamSchedule(leagueCode, teamId, seasons).catch(() => [] as EspnScheduleGame[]);
  const beforeMs = new Date(beforeISO).getTime();
  if (!Number.isFinite(beforeMs)) return null;

  // Derniers matchs terminés avant la date analysée, sans doublon d'eventId
  // (un appelant peut fournir par erreur deux fois la même saison : chaque
  // fetch repousse ses events dans le calendrier).
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

  const windowGoals = [0, 0, 0, 0, 0, 0];
  let matches = 0;
  // espnFetch limite déjà la concurrence réseau à 4 ; les summaries sont
  // de petits JSON déjà mis en cache pour l'écran Compositions.
  await Promise.all(
    recent.map(async (g) => {
      const raw = await espnFetch<RawGoalSummary>(`${SITE}/${leagueCode}/summary?event=${g.eventId}`, {
        cacheKey: `foot:summary:${leagueCode}:${g.eventId}`,
        ttlMs: TTL_PAST_SUMMARY,
      }).catch(() => null);
      if (!raw || !Array.isArray(raw.keyEvents)) return; // summary absent → match ignoré
      for (const ke of raw.keyEvents) {
        if (!ke || ke.scoringPlay !== true) continue;
        const w = goalWindowFromClock(ke.clock?.displayValue ?? "");
        if (w === null) continue; // horloge absente/inattendue → but non compté
        windowGoals[w]++;
      }
      matches++;
    }),
  );
  if (matches === 0) return null;
  const totalGoals = windowGoals.reduce((s, n) => s + n, 0);
  return { windowGoals, totalGoals, matches };
}

// ---------- Modèle : Poisson par morceaux (hazard non homogène) ----------

/**
 * P(1er but dans la fenêtre w) pour un total attendu de `lambdaTotal` buts
 * répartis selon `shares` (6 parts sommant à 1) :
 *   λw = lambdaTotal × share_w            (buts attendus dans la fenêtre)
 *   P(w) = e^(−Σ_{v<w} λv) × (1 − e^(−λw))  (survie × risque)
 *   P(aucun but) = e^(−lambdaTotal)
 * La somme vaut exactement 1 par télescopage ; renormalisation défensive,
 * puis arrondi à 4 décimales tel que les 7 entrées somment EXACTEMENT à 1.
 * Sortie : 6 fenêtres + NO_GOAL, mêmes labels que l'ancien marché.
 */
export function firstGoalTimingFromHazard(lambdaTotal: number, shares: number[]): GoalTimingEntry[] {
  const lam =
    Number.isFinite(lambdaTotal) && lambdaTotal > 0
      ? Math.min(lambdaTotal, 8) // garde-fou : aucun match réel n'attend > 8 buts
      : SAMPLE_AVG_GOALS; // repli : moyenne de l'échantillon empirique
  // Parts : fournies → normalisées ; sinon baseline empirique (constante
  // contrôlée sommant à 1) ; dernier repli théorique : uniforme.
  const s =
    normalizeShares(shares) ??
    normalizeShares([...LEAGUE_BASELINE_SHARES]) ?? [1 / 6, 1 / 6, 1 / 6, 1 / 6, 1 / 6, 1 / 6];

  const probs: number[] = [];
  let cum = 0;
  let sum = 0;
  for (let w = 0; w < 6; w++) {
    const lambdaW = lam * s[w];
    probs.push(Math.exp(-cum) * (1 - Math.exp(-lambdaW)));
    sum += probs[w];
    cum += lambdaW;
  }
  const noGoal = Math.exp(-lam);
  sum += noGoal;
  const scale = sum > 0 ? 1 / sum : 1; // défense contre les erreurs flottantes

  // Arrondi exact : 5 premières fenêtres arrondies, NO_GOAL arrondi, la
  // 6e fenêtre absorbe le reste → somme totale = 1 à 4 décimales.
  const rounded = probs.map((p) => Math.round(p * scale * 10000) / 10000);
  const noGoalR = Math.max(0, Math.min(1, Math.round(noGoal * scale * 10000) / 10000));
  let acc = 0;
  for (let w = 0; w < 5; w++) acc += rounded[w];
  rounded[5] = Math.max(0, Math.round((1 - noGoalR - acc) * 10000) / 10000);

  const out: GoalTimingEntry[] = rounded.map((p, i) => ({
    window: GOAL_WINDOWS[i].window,
    label: GOAL_WINDOWS[i].label,
    prob: p,
  }));
  out.push({ window: "NO_GOAL", label: "Aucun but (0-0)", prob: noGoalR });
  return out;
}

// ---------- Fusion des deux équipes ----------

/**
 * Fusionne les histogrammes des deux équipes et retire le résultat vers la
 * baseline par shrinkage bayésien n/(n+K) :
 *   share_w = [n/(n+K)] × (buts observés en w / n) + [K/(n+K)] × baseline_w
 * - pooling des buts des DEUX équipes (pondération implicite par le nombre
 *   de buts) ; si les deux équipes se sont récemment rencontrées, ce match
 *   commun compte deux fois — au plus 1 match sur ~20, noyé par le shrinkage ;
 * - aucune donnée d'équipe (ou zéro but observé) → baseline pure, base 'ligue'.
 */
export function blendGoalTiming(
  home: TeamGoalTiming | null,
  away: TeamGoalTiming | null,
  baseline: number[] = [...LEAGUE_BASELINE_SHARES],
): BlendedGoalTiming {
  const base = normalizeShares(baseline) ?? normalizeShares([...LEAGUE_BASELINE_SHARES]);
  if (!base) return { shares: [1 / 6, 1 / 6, 1 / 6, 1 / 6, 1 / 6, 1 / 6], basis: "ligue", sampleGoals: 0 };

  const pooled = [0, 0, 0, 0, 0, 0];
  for (const t of [home, away]) {
    if (!t || !Array.isArray(t.windowGoals)) continue;
    for (let w = 0; w < 6; w++) {
      const n = t.windowGoals[w];
      if (Number.isFinite(n) && n > 0) pooled[w] += n;
    }
  }
  const n = pooled.reduce((s, v) => s + v, 0);
  if (n <= 0) {
    // Données d'équipe fournies mais zéro but observé (0-0 en série,
    // summaries sans horloge) → profil de ligue, honnêtement étiqueté.
    return { shares: base, basis: "ligue", sampleGoals: 0 };
  }
  const wTeam = n / (n + BLEND_K);
  const shares = pooled.map((c, i) => wTeam * (c / n) + (1 - wTeam) * base[i]);
  const sum = shares.reduce((s, v) => s + v, 0); // = 1 par construction, re-sécurisé
  return {
    shares: sum > 0 ? shares.map((v) => v / sum) : base,
    basis: "equipes",
    sampleGoals: n,
  };
}

/** Étiquette d'honnêteté de la source des parts utilisées :
 *  - 'equipes' : au moins un but réel observé dans les histogrammes d'équipe ;
 *  - 'ligue'   : données d'équipe fournies mais zéro but → baseline pure ;
 *  - 'modele'  : aucune donnée fournie → l'appeleur replie sur le modèle
 *                homogène (firstGoalTimingProbs, prediction.ts). */
export function goalTimingBasis(
  home: TeamGoalTiming | null,
  away: TeamGoalTiming | null,
): { basis: GoalTimingBasis; sampleGoals: number } {
  if (!home && !away) return { basis: "modele", sampleGoals: 0 };
  const goals = (t: TeamGoalTiming | null): number =>
    t && Number.isFinite(t.totalGoals) && t.totalGoals > 0 ? t.totalGoals : 0;
  const n = goals(home) + goals(away);
  if (n > 0) return { basis: "equipes", sampleGoals: n };
  return { basis: "ligue", sampleGoals: 0 };
}
