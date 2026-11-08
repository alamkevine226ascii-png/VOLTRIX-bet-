"use client";

/* ============================================================
   VOLTRIX app — Adaptateur ESPN football (100 % navigateur)
   Portage client du dépôt VOLTRIX-bet (src/lib/espn.ts) :
   mêmes endpoints, mêmes mappages, mêmes TTL — mais appelés
   directement depuis le téléphone, sans serveur ni base de
   données (les endpoints publics ESPN ont un CORS ouvert).
   Cache + file de concurrence : réutilisés depuis src/lib/mma/espn.ts.
   ============================================================ */

import { espnFetch, mapLimited } from "../mma/espn";
import { isValidLeagueCode } from "./leagues";

/* Base ESPN — par défaut appelée DIRECTEMENT depuis le navigateur (CORS
   ouvert). Réseau verrouillé ? Voir NEXT_PUBLIC_ESPN_SITE_BASE + rewrites
   next.config.ts. */
const SITE_BASE = process.env.NEXT_PUBLIC_ESPN_SITE_BASE ?? "https://site.api.espn.com";

const SITE = `${SITE_BASE}/apis/site/v2/sports/soccer`;

export { SITE };

const TTL_SCOREBOARD_PRE = 10 * 60 * 1000; // 10 min — journée passée ou future
const TTL_SCOREBOARD_DAY = 60 * 1000; // 1 min — journée en cours (scores live frais)
const TTL_TEAM_SCHEDULE = 3 * 60 * 60 * 1000; // 3 h
const TTL_STANDINGS = 3 * 60 * 60 * 1000; // 3 h
const TTL_INJURIES = 6 * 60 * 60 * 1000; // 6 h

// ---------- Types publics (mêmes formes que le dépôt) ----------

export interface EspnTeam {
  id: string;
  name: string;
  displayName: string;
  shortDisplayName: string;
  abbreviation: string;
  logo: string | null;
}

export interface EspnCompetitor {
  homeAway: "home" | "away";
  team: EspnTeam;
  score: number | null;
  winner: boolean | null;
  form: string | null; // ex "WWDLW"
  recordSummary: string | null;
}

export interface EspnOdds {
  provider: string;
  overUnderLine: number | null;
  moneyline: {
    home: { open: number | null; close: number | null };
    draw: { open: number | null; close: number | null };
    away: { open: number | null; close: number | null };
  };
  total: {
    over: { line: number | null; openOdds: number | null; closeOdds: number | null };
    under: { line: number | null; openOdds: number | null; closeOdds: number | null };
  };
  hasOdds: boolean;
}

export interface EspnEvent {
  id: string;
  date: string; // ISO
  name: string;
  shortName: string;
  status: "pre" | "in" | "post";
  statusDetail: string;
  completed: boolean;
  venue: { name: string | null; city: string | null; country: string | null };
  home: EspnCompetitor | null;
  away: EspnCompetitor | null;
  odds: EspnOdds | null;
}

export interface EspnScoreboard {
  leagueCode: string;
  leagueName: string;
  seasonYear: number | null;
  events: EspnEvent[];
}

export interface EspnScheduleGame {
  eventId: string;
  date: string;
  opponentId: string;
  opponentName: string;
  homeAway: "home" | "away";
  teamScore: number | null;
  opponentScore: number | null;
  completed: boolean;
  leagueCode: string;
}

export interface EspnStandingsTeam {
  teamId: string;
  teamName: string;
  rank: number | null;
  gamesPlayed: number;
  wins: number;
  ties: number;
  losses: number;
  pointsFor: number; // buts pour
  pointsAgainst: number; // buts contre
  points: number;
}

export interface EspnInjury {
  teamId: string;
  playerName: string;
  position: string | null;
  status: string | null;
}

// ---------- Cotes ----------

export function americanToDecimal(american: number | null | undefined): number | null {
  if (american === null || american === undefined || Number.isNaN(american)) return null;
  if (american > 0) return Math.round((1 + american / 100) * 100) / 100;
  if (american < 0) return Math.round((1 + 100 / Math.abs(american)) * 100) / 100;
  return 1.0;
}

function parseAmerican(str: unknown): number | null {
  if (typeof str !== "string") return null;
  const n = parseInt(str.replace(/[+]/, ""), 10);
  if (Number.isNaN(n)) return null;
  return str.trim().startsWith("-") ? -Math.abs(n) : Math.abs(n);
}

function parseLine(line: unknown): number | null {
  if (typeof line !== "string") return null;
  const n = parseFloat(line.replace(/[ouOU]/, ""));
  return Number.isNaN(n) ? null : n;
}

// ---------- Types bruts ESPN ----------

interface RawScoreboard {
  leagues?: Array<{ id?: string; name?: string; abbreviation?: string; season?: { year?: number } }>;
  season?: { year?: number };
  events?: RawEvent[];
}

interface RawEvent {
  id: string;
  date: string;
  name: string;
  shortName: string;
  competitions?: RawCompetition[];
  status?: { type?: { state?: string; description?: string; completed?: boolean; detail?: string } };
}

interface RawCompetition {
  date?: string;
  status?: { type?: { state?: string; description?: string; completed?: boolean; detail?: string } };
  venue?: { fullName?: string; address?: { city?: string; country?: string } };
  competitors?: RawCompetitor[];
  odds?: RawOdds[];
}

interface RawCompetitor {
  homeAway?: string;
  form?: string;
  winner?: boolean;
  score?: { value?: number } | string | number;
  records?: Array<{ summary?: string; type?: string }>;
  team?: {
    id: string;
    displayName?: string;
    shortDisplayName?: string;
    name?: string;
    abbreviation?: string;
    logo?: string;
    logos?: Array<{ href: string; rel?: string[] }>;
  };
}

interface RawOdds {
  provider?: { name?: string };
  overUnder?: number;
  drawOdds?: { moneyLine?: number };
  moneyline?: {
    home?: { open?: { odds?: string }; close?: { odds?: string } };
    draw?: { open?: { odds?: string }; close?: { odds?: string } };
    away?: { open?: { odds?: string }; close?: { odds?: string } };
  };
  total?: {
    over?: { line?: string; open?: { odds?: string }; close?: { line?: string; odds?: string } };
    under?: { line?: string; open?: { odds?: string }; close?: { line?: string; odds?: string } };
  };
}

function parseScore(score: unknown): number | null {
  if (typeof score === "object" && score !== null && "value" in (score as Record<string, unknown>)) {
    const v = (score as { value?: number }).value;
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  }
  if (typeof score === "number" && Number.isFinite(score)) return score;
  if (typeof score === "string" && score.trim() !== "" && !Number.isNaN(parseInt(score, 10))) {
    return parseInt(score, 10);
  }
  return null;
}

function mapCompetitor(c: RawCompetitor | undefined, side: "home" | "away"): EspnCompetitor | null {
  if (!c?.team) return null;
  const scoreVal = parseScore(c.score);
  const logoArr = c.team.logos ?? [];
  const logo =
    c.team.logo ??
    logoArr.find((l) => l.rel?.includes("default"))?.href ??
    logoArr[0]?.href ??
    null;
  return {
    homeAway: side,
    team: {
      id: c.team.id,
      name: c.team.name ?? c.team.displayName ?? "",
      displayName: c.team.displayName ?? c.team.name ?? "",
      shortDisplayName: c.team.shortDisplayName ?? c.team.abbreviation ?? "",
      abbreviation: c.team.abbreviation ?? "",
      logo,
    },
    score: scoreVal,
    winner: c.winner ?? null,
    form: c.form ?? null,
    recordSummary: c.records?.[0]?.summary ?? null,
  };
}

function mapOdds(raw: RawOdds | undefined): EspnOdds | null {
  if (!raw) return null;
  const ml = raw.moneyline;
  const total = raw.total;
  const hasML = !!(
    ml?.home?.close?.odds ||
    ml?.away?.close?.odds ||
    raw.drawOdds?.moneyLine !== undefined ||
    ml?.draw?.close?.odds
  );
  const hasTotal = !!(total?.over?.close?.line || total?.under?.close?.line || raw.overUnder !== undefined);
  return {
    provider: raw.provider?.name ?? "Bookmaker",
    overUnderLine: raw.overUnder ?? parseLine(total?.over?.close?.line) ?? null,
    moneyline: {
      home: {
        open: americanToDecimal(parseAmerican(ml?.home?.open?.odds)),
        close: americanToDecimal(parseAmerican(ml?.home?.close?.odds)),
      },
      draw: {
        open: americanToDecimal(parseAmerican(ml?.draw?.open?.odds)),
        close:
          americanToDecimal(parseAmerican(ml?.draw?.close?.odds)) ??
          americanToDecimal(raw.drawOdds?.moneyLine ?? null),
      },
      away: {
        open: americanToDecimal(parseAmerican(ml?.away?.open?.odds)),
        close: americanToDecimal(parseAmerican(ml?.away?.close?.odds)),
      },
    },
    total: {
      over: {
        line: parseLine(total?.over?.close?.line),
        openOdds: americanToDecimal(parseAmerican(total?.over?.open?.odds)),
        closeOdds: americanToDecimal(parseAmerican(total?.over?.close?.odds)),
      },
      under: {
        line: parseLine(total?.under?.close?.line),
        openOdds: americanToDecimal(parseAmerican(total?.under?.open?.odds)),
        closeOdds: americanToDecimal(parseAmerican(total?.under?.close?.odds)),
      },
    },
    hasOdds: hasML || hasTotal,
  };
}

// ---------- Scoreboard par ligue ----------

export async function fetchScoreboard(leagueCode: string, dateISO?: string): Promise<EspnScoreboard | null> {
  if (!isValidLeagueCode(leagueCode)) return null;
  const url = dateISO
    ? `${SITE}/${leagueCode}/scoreboard?dates=${dateISO.replace(/-/g, "")}`
    : `${SITE}/${leagueCode}/scoreboard`;
  /* TTL : 60 s pour la JOURNÉE EN COURSE (les scores en direct doivent
     rester frais), 10 min pour toute autre journée (passée : figée ;
     future : quasi stable). Le scan d'une journée au retour dans
     l'App reste ainsi quasi gratuit, sans recalcul du moteur. */
  const isToday = (() => {
    const now = new Date();
    const today = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}`;
    return !dateISO || dateISO === today;
  })();
  const ttl = isToday ? TTL_SCOREBOARD_DAY : TTL_SCOREBOARD_PRE;
  const raw = await espnFetch<RawScoreboard>(url, {
    cacheKey: `foot:sb:${leagueCode}:${dateISO ?? "today"}`,
    ttlMs: ttl,
  }).catch(() => null);
  if (!raw) return null;

  const events: EspnEvent[] = (raw.events ?? []).map((ev) => {
    const comp = ev.competitions?.[0];
    const competitors = comp?.competitors ?? [];
    const homeRaw = competitors.find((c) => c.homeAway === "home") ?? competitors[0];
    const awayRaw = competitors.find((c) => c.homeAway === "away") ?? competitors[1];
    const statusType = comp?.status?.type ?? ev.status?.type;
    return {
      id: ev.id,
      date: comp?.date ?? ev.date,
      name: ev.name,
      shortName: ev.shortName,
      status: (statusType?.state as "pre" | "in" | "post") ?? "pre",
      statusDetail: statusType?.detail ?? statusType?.description ?? "",
      completed: statusType?.completed ?? false,
      venue: {
        name: comp?.venue?.fullName ?? null,
        city: comp?.venue?.address?.city ?? null,
        country: comp?.venue?.address?.country ?? null,
      },
      home: mapCompetitor(homeRaw, "home"),
      away: mapCompetitor(awayRaw, "away"),
      odds: mapOdds(comp?.odds?.[0]),
    };
  });

  return {
    leagueCode,
    leagueName: raw.leagues?.[0]?.name ?? leagueCode,
    seasonYear: raw.season?.year ?? raw.leagues?.[0]?.season?.year ?? null,
    events,
  };
}

// ---------- Calendrier équipe (historique) ----------

interface RawSchedule {
  team?: { id?: string; displayName?: string };
  events?: Array<{
    id: string;
    date?: string;
    competitions?: Array<{
      date?: string;
      competitors?: Array<{
        homeAway?: string;
        team?: { id?: string; displayName?: string };
        score?: { value?: number } | number;
      }>;
      status?: { type?: { completed?: boolean } };
    }>;
  }>;
}

export async function fetchTeamSchedule(
  leagueCode: string,
  teamId: string,
  seasons: number[],
): Promise<EspnScheduleGame[]> {
  if (!isValidLeagueCode(leagueCode)) return [];
  const games: EspnScheduleGame[] = [];
  await Promise.all(
    seasons.map(async (season) => {
      const raw = await espnFetch<RawSchedule>(
        `${SITE}/${leagueCode}/teams/${teamId}/schedule?season=${season}`,
        { cacheKey: `foot:sched:${leagueCode}:${teamId}:${season}`, ttlMs: TTL_TEAM_SCHEDULE },
      ).catch(() => null);
      if (!raw?.events) return;
      for (const ev of raw.events) {
        const comp = ev.competitions?.[0];
        if (!comp) continue;
        const comps = comp.competitors ?? [];
        const own = comps.find((c) => c.team?.id === teamId);
        const opp = comps.find((c) => c.team?.id !== teamId);
        if (!own || !opp?.team?.id) continue;
        const ownScore = parseScore(own.score);
        const oppScore = parseScore(opp.score);
        games.push({
          eventId: ev.id,
          date: comp.date ?? ev.date ?? "",
          opponentId: opp.team.id,
          opponentName: opp.team.displayName ?? "",
          homeAway: (own.homeAway as "home" | "away") ?? "home",
          teamScore: ownScore,
          opponentScore: oppScore,
          completed: comp.status?.type?.completed ?? false,
          leagueCode,
        });
      }
    }),
  );
  games.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  return games;
}

// ---------- Classement ----------

interface RawStandings {
  children?: Array<{
    standings?: {
      entries?: Array<{
        team?: { id?: string; displayName?: string };
        stats?: Array<{ name?: string; value?: number }>;
      }>;
    };
  }>;
}

export async function fetchStandings(leagueCode: string, season: number): Promise<EspnStandingsTeam[]> {
  if (!isValidLeagueCode(leagueCode)) return [];
  const raw = await espnFetch<RawStandings>(
    `${SITE_BASE}/apis/v2/sports/soccer/${leagueCode}/standings?season=${season}`,
    { cacheKey: `foot:stand:${leagueCode}:${season}`, ttlMs: TTL_STANDINGS },
  ).catch(() => null);
  const entries = raw?.children?.[0]?.standings?.entries ?? [];
  const out: EspnStandingsTeam[] = [];
  for (const e of entries) {
    if (!e.team?.id) continue;
    const stats = new Map<string, number | null>();
    for (const s of e.stats ?? []) {
      stats.set(s.name ?? "", s.value ?? null);
    }
    out.push({
      teamId: e.team.id,
      teamName: e.team.displayName ?? "",
      rank: stats.get("rank") ?? null,
      gamesPlayed: stats.get("gamesPlayed") ?? 0,
      wins: stats.get("wins") ?? 0,
      ties: stats.get("ties") ?? 0,
      losses: stats.get("losses") ?? 0,
      pointsFor: stats.get("pointsFor") ?? 0,
      pointsAgainst: stats.get("pointsAgainst") ?? 0,
      points: stats.get("points") ?? 0,
    });
  }
  return out;
}

// ---------- Blessures ----------

interface RawInjuries {
  injuries?: Array<{
    team?: { id?: string };
    injuries?: Array<{
      athlete?: { displayName?: string; position?: { abbreviation?: string } };
      status?: string;
    }>;
  }>;
}

export async function fetchInjuries(leagueCode: string): Promise<EspnInjury[]> {
  if (!isValidLeagueCode(leagueCode)) return [];
  const raw = await espnFetch<RawInjuries>(`${SITE}/${leagueCode}/injuries`, {
    cacheKey: `foot:inj:${leagueCode}`,
    ttlMs: TTL_INJURIES,
  }).catch(() => null);
  const out: EspnInjury[] = [];
  for (const group of raw?.injuries ?? []) {
    const teamId = group.team?.id ?? "";
    for (const inj of group.injuries ?? []) {
      out.push({
        teamId,
        playerName: inj.athlete?.displayName ?? "",
        position: inj.athlete?.position?.abbreviation ?? null,
        status: inj.status ?? null,
      });
    }
  }
  return out;
}

// ---------- Météo (Open-Meteo — gratuit, sans clé, CORS ouvert) ----------

export interface WeatherInfo {
  description: string;
  tempC: number;
  windKmh: number;
  precipitationMm: number;
  impact: string;
  goalsFactor: number;
}

const WEATHER_CODES: Record<number, string> = {
  0: "Ciel dégagé",
  1: "Plutôt dégagé",
  2: "Partiellement nuageux",
  3: "Couvert",
  45: "Brouillard",
  48: "Brouillard givrant",
  51: "Bruine légère",
  53: "Bruine",
  55: "Bruine dense",
  61: "Pluie légère",
  63: "Pluie",
  65: "Forte pluie",
  71: "Neige légère",
  73: "Neige",
  75: "Fortes chutes de neige",
  80: "Averses légères",
  81: "Averses",
  82: "Fortes averses",
  95: "Orage",
  96: "Orage avec grêle",
  99: "Orage violent avec grêle",
};

interface GeoResponse {
  results?: Array<{ name: string; latitude: number; longitude: number; country?: string }>;
}

interface ForecastResponse {
  current?: {
    temperature_2m?: number;
    wind_speed_10m?: number;
    precipitation?: number;
    weather_code?: number;
  };
}

function weatherImpact(code: number, wind: number, precip: number): { impact: string; goalsFactor: number } {
  if (code >= 95 || precip > 4 || wind > 45)
    return { impact: "Conditions difficiles — jeu ralenti, buts moins nombreux", goalsFactor: 0.88 };
  if (precip > 1 || wind > 30)
    return { impact: "Vent/pluie sensibles — rythme légèrement réduit", goalsFactor: 0.95 };
  return { impact: "Conditions neutres pour le jeu", goalsFactor: 1.0 };
}

export async function fetchWeather(city: string | null, country: string | null): Promise<WeatherInfo | null> {
  if (!city) return null;
  const geo = await espnFetch<GeoResponse>(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=fr&format=json`,
    { cacheKey: `foot:geo:${city}:${country ?? ""}`, ttlMs: 30 * 24 * 60 * 60 * 1000 },
  ).catch(() => null);
  const loc = geo?.results?.[0];
  if (!loc) return null;
  const fc = await espnFetch<ForecastResponse>(
    `https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&current=temperature_2m,wind_speed_10m,precipitation,weather_code`,
    { cacheKey: `foot:wx:${loc.latitude}:${loc.longitude}`, ttlMs: 6 * 60 * 60 * 1000 },
  ).catch(() => null);
  const cur = fc?.current;
  if (!cur) return null;
  const code = cur.weather_code ?? 0;
  const wind = Math.round(cur.wind_speed_10m ?? 0);
  const precip = cur.precipitation ?? 0;
  const { impact, goalsFactor } = weatherImpact(code, wind, precip);
  return {
    description: WEATHER_CODES[code] ?? "—",
    tempC: Math.round(cur.temperature_2m ?? 0),
    windKmh: wind,
    precipitationMm: precip,
    impact,
    goalsFactor,
  };
}

export { mapLimited };
