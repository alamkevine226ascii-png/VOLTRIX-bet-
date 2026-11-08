"use client";

/* ============================================================
   VOLTRIX app — Analyse complète d'un match football (client)
   Portage navigateur de src/lib/analyze.ts du dépôt VOLTRIX-bet :
   orchestration identique (scoreboard → historiques → classement
   → blessures → météo → moteur), mais SANS base de données —
   cache mémoire + sessionStorage uniquement.
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
import { getLeague } from "./leagues";

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

/* ---------- Cache local (mémoire + sessionStorage) ---------- */

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
    const raw = sessionStorage.getItem(SS_PREFIX + key);
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry<T>;
    if (entry.expiresAt < Date.now()) {
      sessionStorage.removeItem(SS_PREFIX + key);
      return null;
    }
    memory.set(key, entry);
    return entry.payload;
  } catch {
    return null;
  }
}

function cacheSet<T>(key: string, payload: T, ttlMs: number): void {
  const entry: CacheEntry<T> = { payload, expiresAt: Date.now() + ttlMs };
  memory.set(key, entry);
  try {
    sessionStorage.setItem(SS_PREFIX + key, JSON.stringify(entry));
  } catch {
    /* quota : le cache mémoire suffit */
  }
}

export function clearFootballCache(): void {
  memory.clear();
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith(SS_PREFIX)) toRemove.push(k);
    }
    for (const k of toRemove) sessionStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}

/* ---------- H2H : confrontations directes tirées des calendriers ---------- */

function computeH2hFromSchedules(
  homeId: string,
  homeName: string,
  awayId: string,
  awayName: string,
  homeSchedule: EspnScheduleGame[],
) {
  const rows: AnalyzeResult["h2h"] = [];
  for (const g of homeSchedule) {
    if (g.opponentId !== awayId || !g.completed) continue;
    if (g.teamScore == null || g.opponentScore == null) continue;
    const isHome = g.homeAway === "home";
    const hs = isHome ? g.teamScore : g.opponentScore;
    const as = isHome ? g.opponentScore : g.teamScore;
    rows.push({
      date: g.date,
      homeTeam: isHome ? homeName : awayName,
      awayTeam: isHome ? awayName : homeName,
      score: `${hs}-${as}`,
      winner: hs > as ? "home" : hs < as ? "away" : "draw",
    });
  }
  rows.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const top = rows.slice(0, 8);
  return {
    h2h: top,
    h2hSummary: {
      homeWins: top.filter((r) => r.winner === "home").length,
      draws: top.filter((r) => r.winner === "draw").length,
      awayWins: top.filter((r) => r.winner === "away").length,
      total: top.length,
    },
  };
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
  const isLiveOrDone = (() => {
    const matchTime = new Date(date).getTime();
    return Date.now() > matchTime - 60 * 60 * 1000;
  })();
  const ttl = isLiveOrDone ? 60 * 1000 : 30 * 60 * 1000;

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

  /* 2. Historiques des 2 équipes (saison courante + précédente) */
  const seasons = [PREV_SEASON, season].filter((s) => s > 0);
  const [homeSchedule, awaySchedule] = await Promise.all([
    fetchTeamSchedule(leagueCode, event.home.team.id, seasons).catch(() => [] as EspnScheduleGame[]),
    fetchTeamSchedule(leagueCode, event.away.team.id, seasons).catch(() => [] as EspnScheduleGame[]),
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
  });

  const { h2h, h2hSummary } = computeH2hFromSchedules(
    event.home.team.id,
    event.home.team.displayName,
    event.away.team.id,
    event.away.team.displayName,
    homeSchedule,
  );

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

  cacheSet(key, result, ttl);
  return result;
}
