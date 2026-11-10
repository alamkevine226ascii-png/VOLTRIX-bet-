"use client";

/* ============================================================
   VOLTRIX app — Analyse complète d'un match football (client)
   Portage navigateur de src/lib/analyze.ts du dépôt VOLTRIX-bet :
   orchestration identique (scoreboard → historiques → classement
   → blessures → météo → moteur), mais SANS base de données —
   cache mémoire + stockage local persistant (10 min minimum,
   exigence produit : reprise sans recalcul après fermeture).
   ============================================================ */

import {
  fetchInjuries,
  fetchScoreboard,
  fetchStandings,
  fetchTeamSchedule,
  fetchWeather,
  type EspnEvent,
  type EspnScheduleGame,
} from "./espn";
import { runEngine, type MatchAnalysis } from "./prediction";
import { fetchTeamFirstGoals } from "./first-goal";
import { getLeague } from "./leagues";
// Implémentation n°2 (backtest 2026-11) : moyennes de buts EMPIRIQUES
// par championnat (saison précédente, football-data.co.uk — zéro
// fuite) injectées dans le moteur. Effet mesuré (val+test) :
// +0,3 pt de précision O/U 2,5, log-loss O/U −0,0013, neutre 1X2.
// Ligue non couverte → null → constantes globales (v2.1 inchangé).
import { leagueGoalAverages } from "./league-params";
import { recordValueBets } from "./bets-ledger";
import { persistGet, persistSet } from "../persist";

/* Altitude des villes de football connues au-dessus de ~1 500 m
 * (nov. 2026, modificateur environnemental du moteur — implémentation
 * n°1). Les ligues européennes couvertes par l'app n'en contiennent
 * AUCUNE : ce mappe est dormant, il ne s'active que pour des
 * compétitions futures à domicile en altitude (qualifications
 * Coupe du monde, Libertadores…). Sources : élévations usuelles.
 */
const VENUE_ALTITUDE_M: Record<string, number> = {
  "mexico city": 2240,
  "mexico": 2240,
  guadalajara: 1566,
  toluca: 2667,
  puebla: 2135,
  quito: 2850,
  bogota: 2640,
  "bogotá": 2640,
  "la paz": 3640,
  cuzco: 3400,
  cusco: 3400,
  johannesburg: 1753,
  pretoria: 1339, // < 1 500 m : inertant, conservé pour mémoire
  nairobi: 1795,
  "addis ababa": 2355,
  denver: 1609,
  "sana'a": 2250,
  sanaa: 2250,
  "salt lake city": 1288, // < 1 500 m : inertant
};

function cityAltitude(city: string | null): number | null {
  if (!city) return null;
  const key = city
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
  return VENUE_ALTITUDE_M[key] ?? null;
}

export interface AnalyzeRequest {
  matchId: string;
  leagueCode: string;
  date: string; // ISO
}

export interface AnalyzeResult extends MatchAnalysis {
  matchId: string;
  leagueCode: string;
  leagueName: string;
  matchDate: string;
  status: "pre" | "in" | "post";
  statusDetail: string;
  homeScore: number | null;
  awayScore: number | null;
  venue: { name: string | null; city: string | null; country: string | null };
  odds:
    | {
        provider: string;
        hasOdds: boolean;
        moneyline: {
          home: { open: number | null; close: number | null };
          draw: { open: number | null; close: number | null };
          away: { open: number | null; close: number | null };
        };
        overUnderLine: number | null;
        total: {
          over: { line: number | null; openOdds: number | null; closeOdds: number | null };
          under: { line: number | null; openOdds: number | null; closeOdds: number | null };
        };
      }
    | null;
  h2h: Array<{
    date: string;
    homeTeam: string;
    awayTeam: string;
    score: string;
    winner: "home" | "away" | "draw";
  }>;
  h2hSummary: { homeWins: number; draws: number; awayWins: number; total: number };
}

export const PREV_SEASON = 2025;

const CALENDAR_YEAR_LEAGUES: ReadonlySet<string> = new Set([
  "usa.1",
  "usa.nwsl",
  "bra.1",
  "bra.2",
  "arg.1",
  "jpn.1",
  "nor.1",
  "swe.1",
  "fin.1",
  "irl.1",
]);

export function currentSeasonYear(matchDate: string, leagueCode: string): number {
  const d = new Date(matchDate);
  const year = d.getUTCFullYear();
  if (CALENDAR_YEAR_LEAGUES.has(leagueCode)) return year;
  const month = d.getUTCMonth() + 1;
  return month >= 7 ? year : year - 1;
}

/* ---------- Cache local (mémoire + stockage persistant) ---------- */

interface CacheEntry<T> {
  payload: T;
  expiresAt: number;
}

const SS_PREFIX = "voltrix:foot:";
const memory = new Map<string, CacheEntry<unknown>>();

function cacheGet<T>(key: string): T | null {
  const mem = memory.get(key);
  if (mem && mem.expiresAt > Date.now()) return mem.payload as T;
  try {
    const stored = persistGet<CacheEntry<T>>(SS_PREFIX + key);
    if (!stored) return null;
    if (stored.expiresAt < Date.now()) return null;
    memory.set(key, stored);
    /* Instrument de vérification (test utilisateur « pas de recalcul ») :
       chaque lecture servie depuis le stockage persistant est comptée —
       window.__voltrixAnalysisCacheHits est lisible depuis la console ou
       l'automatisation navigateur. */
    if (typeof window !== "undefined") {
      const w = window as typeof window & { __voltrixAnalysisCacheHits?: number };
      w.__voltrixAnalysisCacheHits = (w.__voltrixAnalysisCacheHits ?? 0) + 1;
    }
    return stored.payload;
  } catch {
    return null;
  }
}

function cacheSet<T>(key: string, payload: T, ttlMs: number): void {
  const entry: CacheEntry<T> = { payload, expiresAt: Date.now() + ttlMs };
  memory.set(key, entry);
  // Stockage PERSISTANT : l'analyse survit à la fermeture de l'App
  // (au moins 10 min — TTL 30 min avant match, 1 min en direct).
  persistSet(SS_PREFIX + key, entry, ttlMs);
}

export function clearFootballCache(): void {
  memory.clear();
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    const toRemove: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(SS_PREFIX)) toRemove.push(k);
    }
    for (const k of toRemove) window.localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}

/* ---------- Analyse complète ---------- */

export interface AnalyzeOptions {
  /** skip la météo (pronos rapides de la liste) */
  light?: boolean;
}

export async function analyzeMatch(
  req: AnalyzeRequest,
  opts: AnalyzeOptions = {},
): Promise<AnalyzeResult | null> {
  const { matchId, leagueCode, date } = req;
  /* TTL de l'analyse (le calcul LOURD — moteur + historiques) :
   *   à venir  → 30 min ;
   *   en direct → 10 min (exigence produit : calculé une fois, pas de
   *               recalcul au retour dans l'App, même 5 min après) ;
   *   terminé  → 6 h (un match fini ne bouge plus).
   * Le score en direct reste frais via le scoreboard (TTL propre,
   * 60 s le jour J) rafraîchi séparément — jamais via le moteur. */
  const matchTime = new Date(date).getTime();
  const isFinished = (() => {
    if (!Number.isFinite(matchTime)) return false;
    return Date.now() > matchTime + 3 * 60 * 60 * 1000;
  })();
  const isLive = (() => {
    if (!Number.isFinite(matchTime)) return false;
    return !isFinished && Date.now() > matchTime - 60 * 60 * 1000;
  })();
  const ttl = isFinished ? 6 * 60 * 60 * 1000 : isLive ? 10 * 60 * 1000 : 30 * 60 * 1000;

  const key = `analysis:${matchId}`;
  const cachedEntry = cacheGet<AnalyzeResult>(key);
  if (cachedEntry) return cachedEntry;

  /* 1. Scoreboard de la ligue (données de base + cotes), avec dates adjacentes
     en repli si le match est classé sur une autre journée par ESPN */
  const dateParam = date.slice(0, 10);
  let board = await fetchScoreboard(leagueCode, dateParam);
  if (board && !board.events.some((e) => e.id === matchId)) {
    const prev = new Date(new Date(`${dateParam}T12:00:00Z`).getTime() - 86400000)
      .toISOString()
      .slice(0, 10);
    const next = new Date(new Date(`${dateParam}T12:00:00Z`).getTime() + 86400000)
      .toISOString()
      .slice(0, 10);
    const boardNext = await fetchScoreboard(leagueCode, next);
    if (boardNext?.events.some((e) => e.id === matchId)) board = boardNext;
    else {
      const boardPrev = await fetchScoreboard(leagueCode, prev);
      if (boardPrev?.events.some((e) => e.id === matchId)) board = boardPrev;
    }
  }
  if (!board) return null;
  const event: EspnEvent | undefined = board.events.find((e) => e.id === matchId);
  if (!event || !event.home || !event.away) return null;

  const season = currentSeasonYear(date, leagueCode);

  /* 2. Historiques des 2 équipes (saison courante + précédente).
     Audit 2026-11-09 (agent A) : l'ancien [PREV_SEASON, season] avec
     constante fixe dupliquait les matchs quand les deux coincideaient —
     dorénavant [season - 1, season]. */
  const seasons = [season - 1, season].filter((s) => s > 0);
  const [homeSchedule, awaySchedule, firstGoalsHome, firstGoalsAway] = await Promise.all([
    fetchTeamSchedule(leagueCode, event.home.team.id, seasons).catch(() => [] as EspnScheduleGame[]),
    fetchTeamSchedule(leagueCode, event.away.team.id, seasons).catch(() => [] as EspnScheduleGame[]),
    /* minutes RÉELLES des 1ers buts (12 derniers matchs par équipe) —
     * moteur dédié first-goal.ts, uniquement pour l'analyse complète
     * (page détail) : les summaries sont mis en cache (clé
     * `foot:summary:{ligue}:{eventId}`). */
    opts.light
      ? Promise.resolve(null)
      : fetchTeamFirstGoals(leagueCode, event.home.team.id, seasons, event.date).catch(() => null),
    opts.light
      ? Promise.resolve(null)
      : fetchTeamFirstGoals(leagueCode, event.away.team.id, seasons, event.date).catch(() => null),
  ]);

  /* 3. Classement + blessures (par ligue) */
  const [standings, injuries] = await Promise.all([
    fetchStandings(leagueCode, season).catch(() => []),
    fetchInjuries(leagueCode).catch(() => []),
  ]);

  /* 4. Météo (ville du stade) — optionnelle */
  const weather = opts.light ? null : await fetchWeather(event.venue.city, event.venue.country).catch(() => null);

  const leagueDef = getLeague(leagueCode);

  /* 5. Moteur ! */
  const analysis = runEngine({
    homeTeam: {
      id: event.home.team.id,
      name: event.home.team.displayName,
      logo: event.home.team.logo,
      schedule: homeSchedule,
      standings: standings.find((s) => s.teamId === event.home!.team.id) ?? null,
    },
    awayTeam: {
      id: event.away.team.id,
      name: event.away.team.displayName,
      logo: event.away.team.logo,
      schedule: awaySchedule,
      standings: standings.find((s) => s.teamId === event.away!.team.id) ?? null,
    },
    injuries,
    odds: event.odds,
    isDerby: false,
    weatherImpact: weather ? { goalsFactor: weather.goalsFactor } : null,
    nowMs: Date.now(),
    leagueTeamsCount: standings.length || 20,
    firstGoals: { home: firstGoalsHome, away: firstGoalsAway },
    venueAltitudeM: cityAltitude(event.venue.city),
    // Implémentation n°2 : moyennes de buts par ligue (league-params.ts).
    leagueGoalAverages: leagueGoalAverages(leagueCode),
  });

  /* H2H : sortie BILATÉRALE du moteur (union des deux calendriers,
   * dédupliquée par eventId — Task 28 §7). L'ancien scan mono-côté
   * d'analyze.ts écrasait ce résultat et manquait les confrontations
   * « B reçoit A » (audit 2026-11-09, agent A). */
  const { h2h, h2hSummary } = { h2h: analysis.h2h, h2hSummary: analysis.h2hSummary };

  const result: AnalyzeResult = {
    ...analysis,
    matchId,
    leagueCode,
    leagueName: leagueDef?.name ?? board.leagueName,
    matchDate: event.date,
    status: event.status,
    statusDetail: event.statusDetail,
    homeScore: event.home.score,
    awayScore: event.away.score,
    venue: event.venue,
    odds: event.odds,
    h2h,
    h2hSummary,
  };

  // Implémentation n°5 : enregistrement des value bets dans le registre
  // persistant ROI/Brier (bets-ledger.ts) — idempotent, best-effort,
  // jamais bloquant pour l'analyse. Résolu quand le match sera terminé.
  recordValueBets({
    matchId,
    leagueCode,
    matchDate: event.date,
    homeName: event.home.team.displayName,
    awayName: event.away.team.displayName,
    valueBets: analysis.prediction.valueBets,
  });

  cacheSet(key, result, ttl);
  return result;
}
