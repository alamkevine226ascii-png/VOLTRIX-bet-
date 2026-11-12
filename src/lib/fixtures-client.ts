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
 */

import type { MatchesResponse, QuickPred } from "./voltrix-types";
import type { MmaEventsResponse, MmaQuickPred } from "./mma-types";
import { analyzeFootballMatch, type FootballDetail } from "./foot/bridge";
import { loadMmaFightDetail } from "./mma-bridge";

export type { FootballDetail };

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
 * se réveiller après une période d'inactivité (premier visiteur). */
export async function fetchDayFixtures(
  date: string,
  timeoutMs = 6000,
): Promise<DayFixtures | null> {
  const j = (await fetchJson(`/api/fixtures?date=${encodeURIComponent(date)}`, timeoutMs)) as
    | (Omit<DayFixtures, "foot"> & { foot: MatchesResponse | null; error?: string })
    | null;
  if (!j || (!j.foot && !j.mma) || j.error) return null;
  return {
    foot: j.foot ?? null,
    footPreds: j.footPreds ?? null,
    mma: j.mma ?? null,
    mmaPreds: j.mmaPreds ?? null,
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
 * pré-calcul si disponible et non périmée, sinon moteur navigateur.
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
    if (!staleLive) return row.predFull as FootballDetail;
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
    if (!staleLive) return row.predFull as Awaited<ReturnType<typeof loadMmaFightDetail>>;
  }
  return loadMmaFightDetail(fightId);
}
