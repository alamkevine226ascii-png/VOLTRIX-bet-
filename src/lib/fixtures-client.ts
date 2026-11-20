/**
 * VOLTRIX — accès client à la base de pré-calcul (architecture n°6).
 *
 * L'app tente d'abord la base de pré-calcul serveur (matchs, combats et
 * pronostics déjà calculés par le job GitHub Actions) ; en cas d'échec
 * (réseau, base endormie, ligne périmée), elle retombe sur le moteur
 * local du navigateur — le mode 100 % local historique reste intact.
 *
 * Ce module est consommé par les composants client : il ne fait QUE des
 * fetch vers /api/fixtures. Aucune clé de base de données ne franchit
 * cette frontière (la connexion Neon vit côté serveur uniquement).
 *
 * Garantie de fraîcheur moteur (correctif « ligne périmée ») : un prono
 * de la base n'est accepté que si son engineVersion correspond à la
 * version COURANTE du moteur embarqué dans CE bundle — sinon le
 * navigateur recalcule localement. Sans cela, l'App affichait des
 * pronos d'une version antérieure pendant toute la fenêtre entre le
 * déploiement et le passage suivant du cron (probas non calées marché,
 * premier but incohérent, combinateur héritant des probas gonflées).
 */

import type { MatchesResponse, QuickPred } from "./voltrix-types";
import type { MmaEventsResponse, MmaQuickPred } from "./mma-types";
import { analyzeFootballMatch, type FootballDetail } from "./foot/bridge";
import { loadMmaFightDetail } from "./mma-bridge";
import { FOOT_PARAMS_VERSION } from "./foot/league-params";
import { MODEL_VERSION } from "./mma/prediction";

export type { FootballDetail };

/* ---------- Version courante des moteurs embarqués ---------- */

/** Le prono foot d'une ligne de la base n'est accepté que s'il vient
 *  de CETTE version du moteur (celle embarquée dans le bundle). */
export const FOOT_ENGINE_VERSION = FOOT_PARAMS_VERSION;
/** Idem MMA. */
export const MMA_ENGINE_VERSION = MODEL_VERSION;

/* ---------- Formes de réponse ---------- */

export interface DayFixtures {
  foot: MatchesResponse | null;
  footPreds: Record<string, QuickPred> | null;
  mma: MmaEventsResponse | null;
  mmaPreds: Record<string, MmaQuickPred> | null;
  computedAt: string;
}

interface FixtureRow {
  id: string;
  sport: string;
  leagueCode: string;
  kickoff: string;
  status: string;
  data: unknown;
  predQuick: unknown;
  predFull: unknown;
  engineVersion: string;
  computedAt: string;
}

/* ---------- Fetch bornés (jamais bloquants) ---------- */

async function fetchJson(url: string, timeoutMs: number): Promise<unknown | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctl.signal, cache: "no-store" });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Journée pré-calculée (foot + MMA + pronos) — null → repli local.
 * Délai généreux : la base Neon est serverless et peut mettre 1-3 s à
 * se réveiller après une période d'inactivité (premier visiteur).
 *
 * Version moteur : chaque entrée de footPreds emporte le engineVersion
 * de sa ligne ; les pronos d'une version différente de celle embarquée
 * dans CE bundle sont écartés (le composant appelant retombe sur le
 * moteur local) — une ligne périmée ne s'affiche JAMAIS, quelle que
 * soit la fraîcheur du cron. */
export async function fetchDayFixtures(
  date: string,
  timeoutMs = 6000,
): Promise<DayFixtures | null> {
  const j = (await fetchJson(`/api/fixtures?date=${encodeURIComponent(date)}`, timeoutMs)) as
    | (Omit<DayFixtures, "foot"> & {
        foot: MatchesResponse | null;
        error?: string;
        /** Version du moteur des lignes foot/mma renvoyées (max des
         *  lignes du jour — la réponse peut mélanger après un bump). */
        engineVersions?: { foot?: string; mma?: string };
        /** Version moteur PAR match (foot) : seuls les pronos de la
         *  version courante sont conservés dans footPreds. */
        footEngine?: Record<string, string>;
        /** Version moteur PAR combat (mma). */
        mmaEngine?: Record<string, string>;
      })
    | null;
  if (!j || (!j.foot && !j.mma) || j.error) return null;

  /* Écart de version moteur par entrée : on ne garde, dans les records
   * de pronos renvoyés, que les pronos produits par la version du
   * moteur EMBARQUÉE dans ce bundle. Les autres sont laissés au
   * composant appelant, qui déclenchera le calcul local en repli. */
  const keepCurrent = <P>(
    preds: Record<string, P> | null,
    versions: Record<string, string> | undefined,
    current: string,
  ): Record<string, P> | null => {
    if (!preds) return null;
    const kept: Record<string, P> = {};
    let any = false;
    for (const [id, p] of Object.entries(preds)) {
      if (versions && versions[id] !== undefined && versions[id] !== current) continue;
      kept[id] = p;
      any = true;
    }
    return any ? kept : null;
  };

  return {
    foot: j.foot ?? null,
    footPreds: keepCurrent(j.footPreds ?? null, j.footEngine, FOOT_ENGINE_VERSION),
    mma: j.mma ?? null,
    mmaPreds: keepCurrent(j.mmaPreds ?? null, j.mmaEngine, MMA_ENGINE_VERSION),
    computedAt: j.computedAt,
  };
}

/** Ligne complète (predFull) — null → introuvable/injoignable. */
export async function fetchFixtureFull(
  fixtureId: string,
  timeoutMs = 3000,
): Promise<FixtureRow | null> {
  const j = await fetchJson(
    `/api/fixtures/${encodeURIComponent(fixtureId)}`,
    timeoutMs,
  );
  if (!j || typeof j !== "object" || !("predFull" in j)) return null;
  return j as FixtureRow;
}

/* ---------- Wrappers détail : base d'abord, moteur local en repli ---------- */

/**
 * Analyse complète d'un match football : lecture de la base de
 * pré-calcul si disponible, NON PÉRIMÉE et calculée par la version
 * moteur embarquée dans ce bundle — sinon moteur navigateur.
 */
export async function getFootballDetail(
  matchId: string,
  leagueCode: string,
  date: string,
): Promise<FootballDetail | null> {
  const row = await fetchFixtureFull(`foot:${leagueCode}:${matchId}`);
  if (row?.predFull) {
    const staleLive =
      row.status === "pre" &&
      new Date(row.kickoff).getTime() < Date.now() - 10 * 60 * 1000;
    /* Ligne calculée par une version de moteur antérieure au bundle :
       recalcul local — c'est LUI qui porte les correctifs attendus. */
    const staleEngine = row.engineVersion !== FOOT_ENGINE_VERSION;
    if (!staleLive && !staleEngine) return row.predFull as FootballDetail;
  }
  return analyzeFootballMatch(matchId, leagueCode, date);
}

/**
 * Détail d'un combat MMA : lecture de la base de pré-calcul si
 * disponible et non périmée, sinon moteur navigateur. Le type est
 * dérivé de loadMmaFightDetail pour rester couplé à sa vraie forme.
 */
export async function getMmaFightDetailById(
  fightId: string,
): Promise<Awaited<ReturnType<typeof loadMmaFightDetail>> | null> {
  const row = await fetchFixtureFull(`mma:${fightId}`);
  if (row?.predFull) {
    /* Un statut « pre » alors que le combat a commencé depuis plus de
       30 min signifie que le pré-calcul date d'avant l'événement :
       on préfère le moteur local (données fraîches). */
    const staleLive =
      row.status === "pre" &&
      new Date(row.kickoff).getTime() < Date.now() - 30 * 60 * 1000;
    /* Ligne calculée par une version de moteur antérieure au bundle :
       recalcul local, comme côté football. */
    const staleEngine = row.engineVersion !== MMA_ENGINE_VERSION;
    if (!staleLive && !staleEngine) return row.predFull as Awaited<ReturnType<typeof loadMmaFightDetail>>;
  }
  return loadMmaFightDetail(fightId);
}
