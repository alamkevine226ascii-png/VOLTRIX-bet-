// ============================================================
// VOLTRIX bet — Client API ESPN (endpoints publics non officiels)
// + conversion des cotes américaines -> décimales
// ============================================================

import { cached } from './cache';

const SITE = 'https://site.api.espn.com/apis/site/v2/sports/soccer';
const TTL_SCOREBOARD_PRE = 10 * 60 * 1000; // 10 min avant match
const TTL_SCOREBOARD_DAY = 60 * 1000; // 1 min le jour J
const TTL_TEAM_SCHEDULE = 3 * 60 * 60 * 1000; // 3 h
const TTL_STANDINGS = 3 * 60 * 60 * 1000; // 3 h
const TTL_INJURIES = 6 * 60 * 60 * 1000; // 6 h

// ---------- Types ----------

export interface EspnTeam {
  id: string;
  name: string;
  displayName: string;
  shortDisplayName: string;
  abbreviation: string;
  logo: string | null;
}

export interface EspnCompetitor {
  homeAway: 'home' | 'away';
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
  status: 'pre' | 'in' | 'post';
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
  homeAway: 'home' | 'away';
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
  pointsFor: number; // buts pour (foot)
  pointsAgainst: number; // buts contre
  points: number;
}

// ---------- Utilitaires réseau ----------

// Task 19-a (finding ③) : ESPN renvoie 403 aux UA « exotiques » (Bun/1.x
// notamment) — en prod Bun, chaque fetch ESPN échouait alors qu'il passait
// en dev (runtime Node). On force des headers explicites type curl/8.5.0,
// identiques sur TOUTES les URLs ESPN (scoreboard, schedules, standings,
// injuries) pour rendre le comportement indépendant du runtime.
const ESPN_HEADERS: Record<string, string> = {
  'User-Agent': 'curl/8.5.0',
  Accept: 'application/json',
};

// ---------- Instrumentation des appels ESPN (Task 28-b : preuve de centralisation) ----------
// Compteur global + journal horodaté des 60 derniers appels sortants vers ESPN.
// Observabilité PURE : aucun changement de comportement réseau, de cache ou de moteur.
// `source` distingue les appels de CONSULTATION (client) des appels de
// SYNCHRONISATION ESPN → Neon (sync) — preuve chiffrée « 0 ESPN à la consultation ».
export interface EspnCallEntry {
  t: number;
  url: string;
  source: 'client' | 'sync';
  ok: boolean;
}
interface EspnStats {
  total: number;
  bySource: { client: number; sync: number };
  recent: EspnCallEntry[];
}
const gEspn = globalThis as unknown as { __voltrixEspnStats?: EspnStats };
export const espnStats: EspnStats = (gEspn.__voltrixEspnStats ??= {
  total: 0,
  bySource: { client: 0, sync: 0 },
  recent: [],
});

export function logEspnCall(url: string, source: 'client' | 'sync', ok: boolean): void {
  espnStats.total += 1;
  espnStats.bySource[source] += 1;
  espnStats.recent.push({ t: Date.now(), url, source, ok });
  if (espnStats.recent.length > 60) espnStats.recent.splice(0, espnStats.recent.length - 60);
}

export function resetEspnStats(): void {
  espnStats.total = 0;
  espnStats.bySource.client = 0;
  espnStats.bySource.sync = 0;
  espnStats.recent.length = 0;
}

async function espnFetch<T>(url: string, timeoutMs = 8000, source: 'client' | 'sync' = 'client'): Promise<T | null> {
  // 2 tentatives : un timeout/rate-limit ponctuel ne doit pas faire échouer l'analyse
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(url, {
        signal: controller.signal,
        headers: ESPN_HEADERS,
        cache: 'no-store',
      });
      clearTimeout(timer);
      logEspnCall(url, source, res.ok);
      if (!res.ok) {
        if (attempt === 0) {
          await new Promise((r) => setTimeout(r, 600));
          continue;
        }
        return null;
      }
      return (await res.json()) as T;
    } catch {
      logEspnCall(url, source, false);
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 600));
        continue;
      }
      return null;
    }
  }
  return null;
}

// ---------- Cotes ----------

export function americanToDecimal(american: number | null | undefined): number | null {
  if (american === null || american === undefined || Number.isNaN(american)) return null;
  if (american > 0) return Math.round((1 + american / 100) * 100) / 100;
  if (american < 0) return Math.round((1 + 100 / Math.abs(american)) * 100) / 100;
  return 1.0;
}

function parseAmerican(str: unknown): number | null {
  if (typeof str !== 'string') return null;
  const n = parseInt(str.replace(/[+]/, ''), 10);
  if (Number.isNaN(n)) return null;
  // "+120" -> 120, "-145" -> -145
  return str.trim().startsWith('-') ? -Math.abs(n) : Math.abs(n);
}

function parseLine(line: unknown): number | null {
  if (typeof line !== 'string') return null;
  const n = parseFloat(line.replace(/[ouOU]/, ''));
  return Number.isNaN(n) ? null : n;
}

// ---------- Scoreboard par ligue ----------

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
    logo?: string; // format soccer scoreboard : chaîne simple
    logos?: Array<{ href: string; rel?: string[] }>; // autres endpoints : tableau
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
  if (typeof score === 'object' && score !== null && 'value' in (score as Record<string, unknown>)) {
    const v = (score as { value?: number }).value;
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  }
  if (typeof score === 'number' && Number.isFinite(score)) return score;
  if (typeof score === 'string' && score.trim() !== '' && !Number.isNaN(parseInt(score, 10))) {
    return parseInt(score, 10);
  }
  return null;
}

function mapCompetitor(c: RawCompetitor | undefined, side: 'home' | 'away'): EspnCompetitor | null {
  if (!c?.team) return null;
  const scoreVal = parseScore(c.score);
  // ESPN soccer scoreboard fournit team.logo (chaîne) avec logos=[] ; les autres endpoints fournissent logos[]
  const logoArr = c.team.logos ?? [];
  const logo =
    c.team.logo ??
    logoArr.find((l) => l.rel?.includes('default'))?.href ??
    logoArr[0]?.href ??
    null;
  return {
    homeAway: side,
    team: {
      id: c.team.id,
      name: c.team.name ?? c.team.displayName ?? '',
      displayName: c.team.displayName ?? c.team.name ?? '',
      shortDisplayName: c.team.shortDisplayName ?? c.team.abbreviation ?? '',
      abbreviation: c.team.abbreviation ?? '',
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
  const hasML = !!(ml?.home?.close?.odds || ml?.away?.close?.odds || raw.drawOdds?.moneyLine !== undefined || ml?.draw?.close?.odds);
  const hasTotal = !!(total?.over?.close?.line || total?.under?.close?.line || raw.overUnder !== undefined);
  return {
    provider: raw.provider?.name ?? 'Bookmaker',
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

export async function fetchScoreboard(
  leagueCode: string,
  dateISO?: string,
  source: 'client' | 'sync' = 'client'
): Promise<EspnScoreboard | null> {
  const url = dateISO
    ? `${SITE}/${leagueCode}/scoreboard?dates=${dateISO.replace(/-/g, '')}`
    : `${SITE}/${leagueCode}/scoreboard`;
  const key = `sb:${leagueCode}:${dateISO ?? 'today'}`;
  const ttl = dateISO ? TTL_SCOREBOARD_PRE : TTL_SCOREBOARD_DAY;
  return cached(
    key,
    ttl,
    async () => {
      const raw = await espnFetch<RawScoreboard>(url, 8000, source);
      if (!raw) return null; // échec réseau : renvoyé avec un TTL court (voir ci-dessous)
      const events: EspnEvent[] = (raw.events ?? []).map((ev) => {
      const comp = ev.competitions?.[0];
      const competitors = comp?.competitors ?? [];
      const homeRaw = competitors.find((c) => c.homeAway === 'home') ?? competitors[0];
      const awayRaw = competitors.find((c) => c.homeAway === 'away') ?? competitors[1];
      const statusType = comp?.status?.type ?? ev.status?.type;
      return {
        id: ev.id,
        date: comp?.date ?? ev.date,
        name: ev.name,
        shortName: ev.shortName,
        status: (statusType?.state as 'pre' | 'in' | 'post') ?? 'pre',
        statusDetail: statusType?.detail ?? statusType?.description ?? '',
        completed: statusType?.completed ?? false,
        venue: {
          name: comp?.venue?.fullName ?? null,
          city: comp?.venue?.address?.city ?? null,
          country: comp?.venue?.address?.country ?? null,
        },
        home: mapCompetitor(homeRaw, 'home'),
        away: mapCompetitor(awayRaw, 'away'),
        odds: mapOdds(comp?.odds?.[0]),
      };
    });
    return {
      leagueCode,
      leagueName: raw.leagues?.[0]?.name ?? leagueCode,
      seasonYear: raw.season?.year ?? raw.leagues?.[0]?.season?.year ?? null,
      events,
    };
    },
    {
      // Un scoreboard null (timeout ESPN…) n'est mis en cache que 15 s,
      // pour que le prochain passage retente au lieu d'échouer 10 min.
      failureValue: (v) => v === null,
      failureTtlMs: 15 * 1000,
    }
  );
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
  scheduleSource: 'client' | 'sync' = 'client'
): Promise<EspnScheduleGame[]> {
  const key = `sched:${leagueCode}:${teamId}:${seasons.join(',')}`;
  return cached(key, TTL_TEAM_SCHEDULE, async () => {
    const games: EspnScheduleGame[] = [];
    await Promise.all(
      seasons.map(async (season) => {
        const raw = await espnFetch<RawSchedule>(
          `${SITE}/${leagueCode}/teams/${teamId}/schedule?season=${season}`,
          8000,
          scheduleSource
        );
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
            date: comp.date ?? ev.date ?? '',
            opponentId: opp.team.id,
            opponentName: opp.team.displayName ?? '',
            homeAway: (own.homeAway as 'home' | 'away') ?? 'home',
            teamScore: ownScore,
            opponentScore: oppScore,
            completed: comp.status?.type?.completed ?? false,
            leagueCode,
          });
        }
      })
    );
    games.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    return games;
    },
    {
      // Un calendrier vide peut être un simple échec réseau : TTL court (2 min)
      failureValue: (v) => v.length === 0,
      failureTtlMs: 2 * 60 * 1000,
    }
  );
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
  const key = `stand:${leagueCode}:${season}`;
  return cached(key, TTL_STANDINGS, async () => {
    const raw = await espnFetch<RawStandings>(`https://site.api.espn.com/apis/v2/sports/soccer/${leagueCode}/standings?season=${season}`);
    const entries = raw?.children?.[0]?.standings?.entries ?? [];
    const out: EspnStandingsTeam[] = [];
    for (const e of entries) {
      if (!e.team?.id) continue;
      const stats = new Map<string, number | null>();
      for (const s of e.stats ?? []) {
        stats.set(s.name ?? '', s.value ?? null);
      }
      out.push({
        teamId: e.team.id,
        teamName: e.team.displayName ?? '',
        rank: stats.get('rank') ?? null,
        gamesPlayed: stats.get('gamesPlayed') ?? 0,
        wins: stats.get('wins') ?? 0,
        ties: stats.get('ties') ?? 0,
        losses: stats.get('losses') ?? 0,
        pointsFor: stats.get('pointsFor') ?? 0,
        pointsAgainst: stats.get('pointsAgainst') ?? 0,
        points: stats.get('points') ?? 0,
      });
    }
    return out;
    },
    {
      // Un classement vide peut être un échec réseau : TTL court (2 min)
      failureValue: (v) => v.length === 0,
      failureTtlMs: 2 * 60 * 1000,
    }
  );
}

// ---------- Blessures ----------

export interface EspnInjury {
  teamId: string;
  playerName: string;
  position: string | null;
  status: string | null;
}

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
  return cached(`inj:${leagueCode}`, TTL_INJURIES, async () => {
    const raw = await espnFetch<RawInjuries>(`${SITE}/${leagueCode}/injuries`);
    const out: EspnInjury[] = [];
    for (const group of raw?.injuries ?? []) {
      const teamId = group.team?.id ?? '';
      for (const inj of group.injuries ?? []) {
        out.push({
          teamId,
          playerName: inj.athlete?.displayName ?? '',
          position: inj.athlete?.position?.abbreviation ?? null,
          status: inj.status ?? null,
        });
      }
    }
    return out;
    },
    {
      // Blessures vides (échec réseau ou aucune blessure) : TTL court (10 min)
      failureValue: (v) => v.length === 0,
      failureTtlMs: 10 * 60 * 1000,
    }
  );
}
