// ============================================================
// VOLTRIX bet — Task 28 : SYNCHRONISATION ESPN → NEON
//
// Architecture cible (cahier des charges §28) :
//   ESPN → DATA INGESTION (ce module) → NEON → VOLTRIX
//
// Propriétés garanties (§5) :
//   - IDEMPOTENT : reconnaissance par espn_event_id (jamais par les
//     noms d'équipes) — le même match récupéré 10 fois = 1 ligne.
//   - INSERT si nouveau, UPDATE si existant.
//   - Cotes HISTORISÉES (§10) : une nouvelle capture n'écrase jamais
//     la précédente — insertion uniquement si la valeur a bougé.
//   - Statuts ESPN synchronisés (§4) — jamais déduits de l'heure.
//   - Résultats stockés séparément (MatchResult, §6) avec winner,
//     définitifs uniquement quand ESPN indique FINAL.
//
// PERFORMANCE : la latence Neon (~300-600 ms/aller-retour depuis ce
// déploiement) impose un mode BATCH — une ingestion par LIGUE avec un
// aller-retour par table (findMany + createMany + updates parallèles),
// jamais un upsert par événement.
//
// Ce module n'importe JAMAIS le moteur (prediction.ts) ni analyze.ts
// (cycle interdit) — analyse.ts importe ici, pas l'inverse.
// ============================================================

import { db } from '@/lib/db';
import { mapWithConcurrency } from '../cache';
import { getLeague } from '../leagues';
import { fetchTeamSchedule, type EspnEvent } from '../espn';
import { logEspnCall } from '../espn';
import { ingestStatus } from './status';

// ---------- Constantes réseau (convention espn.ts — UA curl, Task 19-a) ----------

const SITE = 'https://site.api.espn.com/apis/site/v2/sports/soccer';
const ESPN_HEADERS: Record<string, string> = {
  'User-Agent': 'curl/8.5.0',
  Accept: 'application/json',
};

async function espnRawJson<T>(url: string, timeoutMs = 12_000, attempts = 2): Promise<T | null> {
  for (let i = 0; i < attempts; i++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      const res = await fetch(url, { headers: ESPN_HEADERS, cache: 'no-store', signal: ctrl.signal });
      clearTimeout(t);
      logEspnCall(url, 'sync', res.ok); // Task 28-b : compteur source='sync'
      if (!res.ok) continue;
      return (await res.json()) as T;
    } catch {
      logEspnCall(url, 'sync', false);
      // nouvelle tentative
    }
  }
  return null;
}

// ---------- Types bruts ESPN (convention espn.ts) ----------

interface RawStatusType {
  name?: string;
  state?: string;
  completed?: boolean;
  detail?: string;
  description?: string;
}
interface RawEventFull {
  id: string;
  date?: string;
  name?: string;
  status?: { type?: RawStatusType };
  competitions?: Array<{
    date?: string;
    status?: { type?: RawStatusType };
    venue?: { fullName?: string; address?: { city?: string; country?: string } };
    competitors?: RawCompetitorFull[];
    odds?: RawOddsFull[];
  }>;
}
interface RawCompetitorFull {
  homeAway?: string;
  winner?: boolean;
  score?: { value?: number } | string | number;
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
interface RawOddsFull {
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

// ---------- Cotes : conversion américaine → décimale (convention espn.ts §10) ----------

function americanToDecimal(american: number | null | undefined): number | null {
  if (american === null || american === undefined || Number.isNaN(american)) return null;
  if (american > 0) return Math.round((1 + american / 100) * 100) / 100;
  if (american < 0) return Math.round((1 + 100 / Math.abs(american)) * 100) / 100;
  return 1.0;
}
function parseAmerican(str: unknown): number | null {
  if (typeof str !== 'string') return null;
  const n = parseInt(str.replace(/[+]/, ''), 10);
  if (Number.isNaN(n)) return null;
  return str.trim().startsWith('-') ? -Math.abs(n) : Math.abs(n);
}
function parseLine(line: unknown): number | null {
  if (typeof line !== 'string') return null;
  const n = parseFloat(line.replace(/[ouOU]/, ''));
  return Number.isNaN(n) ? null : n;
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

// ---------- Forme normalisée d'un événement à ingérer ----------

export interface NormalizedTeam {
  id: string;
  name: string;
  shortName: string | null;
  abbreviation: string | null;
  logo: string | null;
}

export interface NormalizedOddsRow {
  marketType: string;
  outcome: string;
  line: number | null;
  odds: number;
  bookmaker: string | null;
  // Task 29 : open/close DÉCLARÉS par ESPN (décimales) — ancrage du mouvement
  // (la valeur `odds` reste la valeur EFFECTIVE capturée = close ?? open).
  open?: number | null;
  close?: number | null;
}

export interface NormalizedEvent {
  espnEventId: string;
  kickoffAt: Date;
  espnState: string | null;
  statusName: string;
  statusDetail: string | null;
  completed: boolean;
  venue: string | null;
  // Task 29 : ville/pays du stade seuls — clé de la capture météo (WeatherSnapshot)
  venueCity?: string | null;
  venueCountry?: string | null;
  home: NormalizedTeam | null;
  away: NormalizedTeam | null;
  homeScore: number | null;
  awayScore: number | null;
  odds: NormalizedOddsRow[];
}

const r2 = (x: number): number => Math.round(x * 100) / 100;

function normalizeOdds(raw: RawOddsFull | undefined): NormalizedOddsRow[] {
  if (!raw) return [];
  const bookmaker = raw.provider?.name ?? 'Bookmaker';
  const rows: NormalizedOddsRow[] = [];
  const ml = raw.moneyline;
  const mlHomeOpen = americanToDecimal(parseAmerican(ml?.home?.open?.odds));
  const mlHomeClose = americanToDecimal(parseAmerican(ml?.home?.close?.odds));
  const mlDrawOpen = americanToDecimal(parseAmerican(ml?.draw?.open?.odds));
  const mlDrawClose =
    americanToDecimal(parseAmerican(ml?.draw?.close?.odds)) ??
    americanToDecimal(parseAmerican(raw.drawOdds?.moneyLine ?? null));
  const mlAwayOpen = americanToDecimal(parseAmerican(ml?.away?.open?.odds));
  const mlAwayClose = americanToDecimal(parseAmerican(ml?.away?.close?.odds));
  const mlHome = mlHomeClose ?? mlHomeOpen;
  const mlDraw = mlDrawClose ?? mlDrawOpen;
  const mlAway = mlAwayClose ?? mlAwayOpen;
  if (mlHome != null) rows.push({ marketType: '1X2', outcome: 'HOME', line: null, odds: r2(mlHome), bookmaker, open: mlHomeOpen, close: mlHomeClose });
  if (mlDraw != null) rows.push({ marketType: '1X2', outcome: 'DRAW', line: null, odds: r2(mlDraw), bookmaker, open: mlDrawOpen, close: mlDrawClose });
  if (mlAway != null) rows.push({ marketType: '1X2', outcome: 'AWAY', line: null, odds: r2(mlAway), bookmaker, open: mlAwayOpen, close: mlAwayClose });

  const total = raw.total;
  const ouLine = raw.overUnder ?? parseLine(total?.over?.close?.line) ?? null;
  const overOpen = americanToDecimal(parseAmerican(total?.over?.open?.odds));
  const overClose = americanToDecimal(parseAmerican(total?.over?.close?.odds));
  const underOpen = americanToDecimal(parseAmerican(total?.under?.open?.odds));
  const underClose = americanToDecimal(parseAmerican(total?.under?.close?.odds));
  const overOdds = overClose ?? overOpen;
  const underOdds = underClose ?? underOpen;
  if (ouLine != null && overOdds != null) rows.push({ marketType: 'OVER_UNDER', outcome: 'OVER', line: ouLine, odds: r2(overOdds), bookmaker, open: overOpen, close: overClose });
  if (ouLine != null && underOdds != null) rows.push({ marketType: 'OVER_UNDER', outcome: 'UNDER', line: ouLine, odds: r2(underOdds), bookmaker, open: underOpen, close: underClose });
  return rows;
}

function normalizeCompetitor(c: RawCompetitorFull | undefined): NormalizedTeam | null {
  if (!c?.team?.id) return null;
  const logoArr = c.team.logos ?? [];
  const logo = c.team.logo ?? logoArr.find((l) => l.rel?.includes('default'))?.href ?? logoArr[0]?.href ?? null;
  return {
    id: c.team.id,
    name: c.team.name ?? c.team.displayName ?? '',
    shortName: c.team.shortDisplayName ?? null,
    abbreviation: c.team.abbreviation ?? null,
    logo,
  };
}

function normalizeRawEvent(ev: RawEventFull): NormalizedEvent | null {
  if (!ev?.id) return null;
  const comp = ev.competitions?.[0];
  const status = comp?.status?.type ?? ev.status?.type ?? {};
  const kickoffISO = comp?.date ?? ev.date;
  const kickoffMs = kickoffISO ? new Date(kickoffISO).getTime() : NaN;
  if (!Number.isFinite(kickoffMs)) return null;
  const competitors = comp?.competitors ?? [];
  const homeRaw = competitors.find((c) => c.homeAway === 'home') ?? competitors[0];
  const awayRaw = competitors.find((c) => c.homeAway === 'away') ?? competitors[1];
  const venueBits = [comp?.venue?.fullName, comp?.venue?.address?.city].filter(Boolean) as string[];
  return {
    espnEventId: ev.id,
    kickoffAt: new Date(kickoffMs),
    espnState: status.state ?? null,
    statusName: status.name ?? '',
    statusDetail: status.detail ?? status.description ?? null,
    completed: status.completed ?? false,
    venue: venueBits.length ? venueBits.join(', ') : null,
    venueCity: comp?.venue?.address?.city ?? null,
    venueCountry: comp?.venue?.address?.country ?? null,
    home: normalizeCompetitor(homeRaw),
    away: normalizeCompetitor(awayRaw),
    homeScore: homeRaw ? parseScore(homeRaw.score) : null,
    awayScore: awayRaw ? parseScore(awayRaw.score) : null,
    odds: normalizeOdds(comp?.odds?.[0]),
  };
}

/** Adaptateur : EspnEvent (fetchScoreboard espn.ts) → NormalizedEvent. */
export function normalizeFromEspnEvent(ev: EspnEvent): NormalizedEvent | null {
  if (!ev?.id) return null;
  const kickoffMs = new Date(ev.date).getTime();
  if (!Number.isFinite(kickoffMs)) return null;
  const rows: NormalizedOddsRow[] = [];
  if (ev.odds?.hasOdds) {
    const bookmaker = ev.odds.provider ?? 'Bookmaker';
    const mh = ev.odds.moneyline.home.close ?? ev.odds.moneyline.home.open;
    const md = ev.odds.moneyline.draw.close ?? ev.odds.moneyline.draw.open;
    const ma = ev.odds.moneyline.away.close ?? ev.odds.moneyline.away.open;
    const line = ev.odds.overUnderLine ?? ev.odds.total.over.line ?? ev.odds.total.under.line ?? null;
    const ov = ev.odds.total.over.closeOdds ?? ev.odds.total.over.openOdds;
    const un = ev.odds.total.under.closeOdds ?? ev.odds.total.under.openOdds;
    if (mh != null) rows.push({ marketType: '1X2', outcome: 'HOME', line: null, odds: r2(mh), bookmaker, open: ev.odds.moneyline.home.open, close: ev.odds.moneyline.home.close });
    if (md != null) rows.push({ marketType: '1X2', outcome: 'DRAW', line: null, odds: r2(md), bookmaker, open: ev.odds.moneyline.draw.open, close: ev.odds.moneyline.draw.close });
    if (ma != null) rows.push({ marketType: '1X2', outcome: 'AWAY', line: null, odds: r2(ma), bookmaker, open: ev.odds.moneyline.away.open, close: ev.odds.moneyline.away.close });
    if (line != null && ov != null) rows.push({ marketType: 'OVER_UNDER', outcome: 'OVER', line, odds: r2(ov), bookmaker, open: ev.odds.total.over.openOdds, close: ev.odds.total.over.closeOdds });
    if (line != null && un != null) rows.push({ marketType: 'OVER_UNDER', outcome: 'UNDER', line, odds: r2(un), bookmaker, open: ev.odds.total.under.openOdds, close: ev.odds.total.under.closeOdds });
  }
  const venueBits = [ev.venue.name, ev.venue.city].filter(Boolean) as string[];
  return {
    espnEventId: ev.id,
    kickoffAt: new Date(kickoffMs),
    espnState: ev.status ?? null,
    statusName: '',
    statusDetail: ev.statusDetail ?? null,
    completed: ev.completed ?? false,
    venue: venueBits.length ? venueBits.join(', ') : null,
    venueCity: ev.venue.city ?? null,
    venueCountry: ev.venue.country ?? null,
    home: ev.home
      ? { id: ev.home.team.id, name: ev.home.team.name, shortName: ev.home.team.shortDisplayName ?? null, abbreviation: ev.home.team.abbreviation ?? null, logo: ev.home.team.logo ?? null }
      : null,
    away: ev.away
      ? { id: ev.away.team.id, name: ev.away.team.name, shortName: ev.away.team.shortDisplayName ?? null, abbreviation: ev.away.team.abbreviation ?? null, logo: ev.away.team.logo ?? null }
      : null,
    homeScore: ev.home?.score ?? null,
    awayScore: ev.away?.score ?? null,
    odds: rows,
  };
}

// ---------- Caches mémoire (latence Neon — batching obligatoire) ----------

interface MemCache {
  compIds?: Map<string, { id: string; at: number }>; // code ligue → id
  teamIds?: Map<string, { id: string; at: number }>; // espnTeamId → id
}
const gMem = globalThis as unknown as MemCache;
gMem.compIds ??= new Map();
gMem.teamIds ??= new Map();
const MEM_TTL_MS = 60 * 60_000; // 1 h — un renommage d'équipe reste possible ensuite

const expired = (e: { at: number } | undefined): boolean => !e || Date.now() - e.at > MEM_TTL_MS;

async function ensureCompetitionId(leagueCode: string, leagueName: string | null, season: number | null): Promise<string> {
  const cache = gMem.compIds!;
  const hit = cache.get(leagueCode);
  if (!expired(hit) && hit) return hit.id;
  const name = leagueName ?? getLeague(leagueCode)?.name ?? leagueCode;
  const row = await db.competition.upsert({
    where: { espnLeagueId: leagueCode },
    create: { espnLeagueId: leagueCode, name, sport: 'soccer', season: season ?? null },
    update: { name, ...(season != null ? { season } : {}) },
  });
  cache.set(leagueCode, { id: row.id, at: Date.now() });
  return row.id;
}

async function upsertTeamsBatch(teams: NormalizedTeam[], competition: string | null): Promise<Map<string, string>> {
  const uniq = new Map<string, NormalizedTeam>();
  for (const t of teams) {
    if (t?.id && !uniq.has(t.id)) uniq.set(t.id, t);
  }
  if (!uniq.size) return new Map();
  const ids = [...uniq.keys()];
  const cache = gMem.teamIds!;
  const out = new Map<string, string>();
  const missing: NormalizedTeam[] = [];
  // Cache mémoire d'abord (évite des centaines d'allers-retours)
  const cacheHits: string[] = [];
  for (const id of ids) {
    const hit = cache.get(id);
    if (!expired(hit) && hit) {
      out.set(id, hit.id);
      cacheHits.push(id);
    } else {
      missing.push(uniq.get(id)!);
    }
  }
  if (!missing.length) return out;
  const existing = await db.team.findMany({
    where: { espnTeamId: { in: missing.map((t) => t.id) } },
    select: { id: true, espnTeamId: true, name: true, shortName: true, abbreviation: true, logo: true, competition: true },
  });
  const existingMap = new Map(existing.map((t) => [t.espnTeamId, t]));
  const toCreate = missing.filter((t) => !existingMap.has(t.id));
  // Les équipes existantes : mise à jour UNIQUEMENT si un champ a réellement
  // changé (évitons les bursts d'updates qui saturent le pool de connexions),
  // par chunks séquentiels.
  const toUpdate = missing.filter((t) => {
    const e = existingMap.get(t.id);
    if (!e) return false;
    return e.name !== (t.name || t.id) || (e.shortName ?? null) !== t.shortName || (e.abbreviation ?? null) !== t.abbreviation || (!!t.logo && e.logo !== t.logo) || (!!competition && e.competition !== competition);
  });
  await runChunked(toUpdate, 5, (t) =>
    db.team
      .update({ where: { espnTeamId: t.id }, data: { name: t.name || t.id, shortName: t.shortName, abbreviation: t.abbreviation, ...(t.logo ? { logo: t.logo } : {}), ...(competition ? { competition } : {}) } })
      .then((r) => {
        cache.set(t.id, { id: r.id, at: Date.now() });
        out.set(t.id, r.id);
      })
      .catch(() => {})
  );
  for (const t of missing.filter((x) => existingMap.has(x.id) && !toUpdate.includes(x))) {
    const id = existingMap.get(t.id)!.id;
    cache.set(t.id, { id, at: Date.now() });
    out.set(t.id, id);
  }
  if (toCreate.length) {
    await db.team
      .createMany({
        data: toCreate.map((t) => ({
          espnTeamId: t.id,
          name: t.name || t.id,
          shortName: t.shortName,
          abbreviation: t.abbreviation,
          logo: t.logo,
          competition,
        })),
        skipDuplicates: true,
      })
      .catch(() => {});
    const created = await db.team.findMany({ where: { espnTeamId: { in: toCreate.map((t) => t.id) } }, select: { id: true, espnTeamId: true } });
    for (const t of created) {
      cache.set(t.espnTeamId, { id: t.id, at: Date.now() });
      out.set(t.espnTeamId, t.id);
    }
  }
  return out;
}

// ---------- Statuts : anti-retour (ne jamais dégrader FINAL) ----------

function statusDowngrade(current: string, next: string): boolean {
  return current === 'FINAL' && (next === 'SCHEDULED' || next === 'UNKNOWN' || next === 'PRE');
}

// ---------- Ingestion BATCH (par ligue) ----------

export interface BatchResult {
  eventsSeen: number;
  matchesCreated: number;
  matchesUpdated: number;
  teamsUpserted: number;
  resultsCreated: number;
  resultsUpdated: number;
  oddsInserted: number;
}

const emptyBatch = (): BatchResult => ({ eventsSeen: 0, matchesCreated: 0, matchesUpdated: 0, teamsUpserted: 0, resultsCreated: 0, resultsUpdated: 0, oddsInserted: 0 });

async function runChunked<T>(items: T[], size: number, fn: (item: T) => Promise<unknown>): Promise<number> {
  let n = 0;
  for (let i = 0; i < items.length; i += size) {
    const results = await Promise.allSettled(items.slice(i, i + size).map(fn));
    n += results.filter((r) => r.status === 'fulfilled').length;
  }
  return n;
}

/**
 * Ingestion idempotente d'un LOT d'événements (une ligue) :
 * 1 aller-retour par table + updates parallèles — dimensionné pour la
 * latence Neon. Insert si nouveau, update si changé (§5), cotes
 * historisées en diff (§10), résultat séparé avec winner (§6).
 */
export async function ingestBatch(
  events: NormalizedEvent[],
  ctx: { leagueCode: string; leagueName: string | null; season: number | null; withOdds?: boolean }
): Promise<BatchResult> {
  const stats = emptyBatch();
  const live = events.filter((e) => e?.espnEventId);
  if (!live.length) return stats;
  stats.eventsSeen = live.length;

  const competitionId = await ensureCompetitionId(ctx.leagueCode, ctx.leagueName, ctx.season);
  const competitionName = ctx.leagueName ?? getLeague(ctx.leagueCode)?.name ?? ctx.leagueCode;

  // --- 1. Équipes (§8) ---
  const teamObjects = live.flatMap((e) => [e.home, e.away]).filter((t): t is NormalizedTeam => !!t?.id);
  const teamMap = await upsertTeamsBatch(teamObjects, ctx.leagueCode);
  stats.teamsUpserted = teamMap.size;

  // --- 2. Matchs (§3) — un upsert par espn_event_id ---
  const eventIds = live.map((e) => e.espnEventId);
  const existing = await db.match.findMany({ where: { espnEventId: { in: eventIds } } });
  const exMap = new Map(existing.map((m) => [m.espnEventId, m]));
  const toCreate: Array<Record<string, unknown>> = [];
  const toUpdate: Array<{ espnEventId: string; data: Record<string, unknown> }> = [];
  for (const ev of live) {
    const status = ingestStatus(ev.statusName, ev.espnState, ev.completed, ev.statusDetail);
    const prev = exMap.get(ev.espnEventId);
    const base = {
      competitionId,
      competitionName,
      season: ctx.season ?? prev?.season ?? null,
      homeTeamId: ev.home?.id ?? null,
      homeTeamName: ev.home?.name ?? prev?.homeTeamName ?? 'Inconnu',
      awayTeamId: ev.away?.id ?? null,
      awayTeamName: ev.away?.name ?? prev?.awayTeamName ?? 'Inconnu',
      kickoffAt: ev.kickoffAt,
      status: statusDowngrade(prev?.status ?? '', status) ? (prev!.status as string) : status,
      statusDetail: ev.statusDetail,
      espnState: ev.espnState,
      homeScore: ev.homeScore ?? prev?.homeScore ?? null, // anti-flap : jamais effacer un score connu
      awayScore: ev.awayScore ?? prev?.awayScore ?? null,
      venue: ev.venue ?? prev?.venue ?? null,
      venueCity: ev.venueCity ?? prev?.venueCity ?? null, // Task 29 : ville du stade (météo)
      venueCountry: ev.venueCountry ?? prev?.venueCountry ?? null, // Task 29 : pays du stade
    };
    if (!prev) {
      toCreate.push({ espnEventId: ev.espnEventId, ...base });
    } else {
      const changed =
        prev.kickoffAt.getTime() !== base.kickoffAt.getTime() ||
        prev.status !== base.status ||
        (prev.statusDetail ?? null) !== (base.statusDetail ?? null) ||
        (prev.espnState ?? null) !== (base.espnState ?? null) ||
        prev.homeScore !== base.homeScore ||
        prev.awayScore !== base.awayScore ||
        (prev.venue ?? null) !== (base.venue ?? null) ||
        (prev.venueCity ?? null) !== (base.venueCity ?? null) ||
        (prev.venueCountry ?? null) !== (base.venueCountry ?? null) ||
        prev.homeTeamName !== base.homeTeamName ||
        prev.awayTeamName !== base.awayTeamName ||
        prev.competitionId !== base.competitionId ||
        prev.homeTeamId !== base.homeTeamId ||
        prev.awayTeamId !== base.awayTeamId;
      if (changed) toUpdate.push({ espnEventId: ev.espnEventId, data: base });
    }
  }
  if (toCreate.length) {
    for (let i = 0; i < toCreate.length; i += 200) {
      await db.match.createMany({ data: toCreate.slice(i, i + 200) as never, skipDuplicates: true }).catch(() => {});
    }
    stats.matchesCreated = toCreate.length;
  }
  if (toUpdate.length) {
    stats.matchesUpdated = await runChunked(toUpdate, 10, (u) => db.match.update({ where: { espnEventId: u.espnEventId }, data: u.data }));
  }

  // --- 3. Résultats séparés (§6) + winner ---
  const existingResults = await db.matchResult.findMany({ where: { matchId: { in: eventIds } } });
  const erMap = new Map(existingResults.map((r) => [r.matchId, r]));
  const resCreate: Array<Record<string, unknown>> = [];
  const resUpdate: Array<{ matchId: string; data: Record<string, unknown> }> = [];
  for (const ev of live) {
    const status = ingestStatus(ev.statusName, ev.espnState, ev.completed, ev.statusDetail);
    const winner = status === 'FINAL' && ev.homeScore != null && ev.awayScore != null ? (ev.homeScore > ev.awayScore ? 'HOME' : ev.homeScore < ev.awayScore ? 'AWAY' : 'DRAW') : null;
    const prev = erMap.get(ev.espnEventId);
    if (!prev) {
      resCreate.push({
        matchId: ev.espnEventId,
        status,
        statusDetail: ev.statusDetail,
        homeScore: status === 'FINAL' ? ev.homeScore : null, // §6 : scores uniquement si définitif
        awayScore: status === 'FINAL' ? ev.awayScore : null,
        winner,
        retrievedAt: new Date(),
        source: 'ESPN',
      });
    } else {
      const nextScores = status === 'FINAL';
      const winnerNext = winner ?? prev.winner;
      const changed =
        prev.status !== status ||
        (prev.statusDetail ?? null) !== (ev.statusDetail ?? null) ||
        (nextScores && ((prev.homeScore ?? null) !== (ev.homeScore ?? null) || (prev.awayScore ?? null) !== (ev.awayScore ?? null))) ||
        (prev.winner ?? null) !== (winnerNext ?? null);
      if (changed) {
        resUpdate.push({
          matchId: ev.espnEventId,
          data: {
            status,
            statusDetail: ev.statusDetail,
            homeScore: nextScores ? (ev.homeScore ?? prev.homeScore) : prev.status === 'FINAL' ? prev.homeScore : null,
            awayScore: nextScores ? (ev.awayScore ?? prev.awayScore) : prev.status === 'FINAL' ? prev.awayScore : null,
            winner: winnerNext,
            retrievedAt: new Date(),
          },
        });
      }
    }
  }
  if (resCreate.length) {
    for (let i = 0; i < resCreate.length; i += 200) {
      await db.matchResult.createMany({ data: resCreate.slice(i, i + 200) as never, skipDuplicates: true }).catch(() => {});
    }
    stats.resultsCreated = resCreate.length;
  }
  if (resUpdate.length) {
    stats.resultsUpdated = await runChunked(resUpdate, 10, (u) => db.matchResult.update({ where: { matchId: u.matchId }, data: u.data }));
  }

  // --- 4. Cotes historisées (§10) — insertion si changement ---
  if (ctx.withOdds !== false) {
    const oddsRows: Array<{ matchId: string; marketType: string; outcome: string; line: number | null; odds: number; bookmaker: string | null; open?: number | null; close?: number | null }> = [];
    for (const ev of live) {
      for (const r of ev.odds) oddsRows.push({ matchId: ev.espnEventId, ...r });
    }
    if (oddsRows.length) {
      const existingOdds = await db.oddsSnapshot.findMany({
        where: { matchId: { in: eventIds } },
        orderBy: { capturedAt: 'desc' },
        take: Math.min(eventIds.length * 12 + 50, 2500),
        select: { matchId: true, marketType: true, outcome: true, line: true, odds: true },
      });
      const latest = new Map<string, number>();
      for (const r of existingOdds) {
        const k = `${r.matchId}|${r.marketType}|${r.outcome}|${r.line ?? ''}`;
        if (!latest.has(k)) latest.set(k, r.odds);
      }
      const capturedAt = new Date();
      const toInsert = oddsRows.filter((r) => {
        const k = `${r.matchId}|${r.marketType}|${r.outcome}|${r.line ?? ''}`;
        const prev = latest.get(k);
        return prev === undefined || Math.abs(prev - r.odds) >= 0.001;
      });
      if (toInsert.length) {
        for (let i = 0; i < toInsert.length; i += 300) {
          // NB : open/close (déclarés ESPN) restent dans les MARKS (4bis) —
          // la série OddsSnapshot ne stocke que la valeur effective capturée.
          await db.oddsSnapshot
            .createMany({ data: toInsert.slice(i, i + 300).map(({ open, close, ...rest }) => ({ ...rest, capturedAt, source: 'ESPN' })) })
            .catch(() => {});
        }
        stats.oddsInserted = toInsert.length;
      }

      // --- 4bis. Task 29 : ANCRAGE OPEN/CLOSE par (match, marché, issue, ligne) ---
      // 1 ligne idempotente dans OddsOpenClose par clé — le détail des mouvements
      // reste dans la série OddsSnapshot ci-dessus. openOdds = première capture
      // effective (jamais réécrite) ; closeOdds = dernière capture effective ;
      // espnOpenOdds/espnCloseOdds = valeurs DÉCLARÉES par ESPN (dernière vue).
      const marks = new Map<string, { matchId: string; marketType: string; outcome: string; line: number | null; odds: number; open: number | null; close: number | null }>();
      for (const r of oddsRows) {
        const k = `${r.matchId}|${r.marketType}|${r.outcome}|${r.line ?? ''}`;
        const prev = marks.get(k);
        if (!prev) marks.set(k, { matchId: r.matchId, marketType: r.marketType, outcome: r.outcome, line: r.line, odds: r.odds, open: r.open ?? null, close: r.close ?? null });
        else {
          if (prev.open == null && r.open != null) prev.open = r.open;
          if (r.close != null) prev.close = r.close;
        }
      }
      if (marks.size) {
        const existingMarks = await db.oddsOpenClose.findMany({
          where: { matchId: { in: eventIds } },
          select: { id: true, matchId: true, marketType: true, outcome: true, line: true, openOdds: true, closeOdds: true, espnOpenOdds: true, espnCloseOdds: true },
        });
        const exMarkMap = new Map(existingMarks.map((m) => [`${m.matchId}|${m.marketType}|${m.outcome}|${m.line ?? ''}`, m]));
        const nowOc = new Date();
        const markCreates: Array<Record<string, unknown>> = [];
        const markUpdates: Array<{ id: string; data: Record<string, unknown> }> = [];
        for (const [k, m] of marks) {
          const ex = exMarkMap.get(k);
          const effOpen = m.open ?? m.odds;
          const effClose = m.close ?? m.odds;
          if (!ex) {
            markCreates.push({
              matchId: m.matchId, marketType: m.marketType, outcome: m.outcome, line: m.line,
              openOdds: effOpen, openCapturedAt: nowOc, closeOdds: effClose, closeCapturedAt: nowOc,
              espnOpenOdds: m.open, espnCloseOdds: m.close, captures: 1, source: 'ESPN',
            });
          } else {
            const closeChanged = ex.closeOdds !== effClose;
            const openToFill = ex.openOdds == null;
            const espnChanged =
              (m.open != null && ex.espnOpenOdds !== m.open) || (m.close != null && ex.espnCloseOdds !== m.close);
            if (closeChanged || openToFill || espnChanged) {
              const data: Record<string, unknown> = { captures: { increment: 1 } };
              if (closeChanged) { data.closeOdds = effClose; data.closeCapturedAt = nowOc; }
              if (openToFill) { data.openOdds = effOpen; data.openCapturedAt = nowOc; }
              if (m.open != null && ex.espnOpenOdds !== m.open) data.espnOpenOdds = m.open;
              if (m.close != null && ex.espnCloseOdds !== m.close) data.espnCloseOdds = m.close;
              markUpdates.push({ id: ex.id, data });
            }
          }
        }
        if (markCreates.length) {
          for (let i = 0; i < markCreates.length; i += 300) {
            await db.oddsOpenClose.createMany({ data: markCreates.slice(i, i + 300) as never, skipDuplicates: true }).catch(() => {});
          }
        }
        if (markUpdates.length) {
          await runChunked(markUpdates, 10, (u) => db.oddsOpenClose.update({ where: { id: u.id }, data: u.data }));
        }
      }
    }
  }

  return stats;
}

/** Ingestion d'un événement unique (compatibilité — utilise le batch). */
export async function ingestEvent(
  ev: NormalizedEvent,
  ctx: { leagueCode: string; leagueName: string | null; season: number | null; withOdds?: boolean }
): Promise<{ match: 'created' | 'updated' | 'unchanged'; result: boolean; odds: number }> {
  const r = await ingestBatch([ev], ctx);
  return {
    match: r.matchesCreated > 0 ? 'created' : r.matchesUpdated > 0 ? 'updated' : 'unchanged',
    result: r.resultsCreated > 0 || r.resultsUpdated > 0,
    odds: r.oddsInserted,
  };
}

// ---------- Synchronisation par fenêtre (§5/§24) ----------

export interface SyncStats {
  leaguesTotal: number;
  leaguesFailed: number;
  eventsSeen: number;
  matchesCreated: number;
  matchesUpdated: number;
  resultsUpserted: number;
  oddsInserted: number;
  skipped: number;
}

const emptyStats = (): SyncStats => ({
  leaguesTotal: 0,
  leaguesFailed: 0,
  eventsSeen: 0,
  matchesCreated: 0,
  matchesUpdated: 0,
  resultsUpserted: 0,
  oddsInserted: 0,
  skipped: 0,
});

const yyyymmdd = (d: Date): string => d.toISOString().slice(0, 10).replace(/-/g, '');

export interface LeagueSyncResult {
  events: number;
  failed: boolean;
  matchesCreated: number;
  matchesUpdated: number;
  resultsUpserted: number;
  oddsInserted: number;
}

/** Récupère le scoreboard d'une ligue sur une plage et l'ingère en batch (idempotent). */
export async function syncLeagueWindow(leagueCode: string, from: Date, to: Date, season: number | null): Promise<LeagueSyncResult> {
  const out: LeagueSyncResult = { events: 0, failed: false, matchesCreated: 0, matchesUpdated: 0, resultsUpserted: 0, oddsInserted: 0 };
  const url = `${SITE}/${leagueCode}/scoreboard?dates=${yyyymmdd(from)}-${yyyymmdd(to)}&limit=400`;
  const raw = await espnRawJson<{ leagues?: Array<{ name?: string }>; season?: { year?: number }; events?: RawEventFull[] }>(url);
  if (!raw) return { ...out, failed: true };
  const leagueName = raw.leagues?.[0]?.name ?? getLeague(leagueCode)?.name ?? null;
  const seasonYear = season ?? raw.season?.year ?? null;
  const events = (raw.events ?? []).map(normalizeRawEvent).filter((e): e is NormalizedEvent => e !== null);
  out.events = events.length;
  try {
    const r = await ingestBatch(events, { leagueCode, leagueName, season: seasonYear });
    out.matchesCreated = r.matchesCreated;
    out.matchesUpdated = r.matchesUpdated;
    out.resultsUpserted = r.resultsCreated + r.resultsUpdated;
    out.oddsInserted = r.oddsInserted;
  } catch {
    out.events = 0;
  }
  return out;
}

/**
 * Cycle de synchronisation (§24) :
 *  - backfill : historique récent + fenêtre à venir (démarrage) ;
 *  - cycle    : fenêtre courte fréquente (matchs futurs + résultats récents).
 * Les matchs EN DIRECT sont rafraîchis séparément et plus fréquemment
 * (refreshLiveMatches, §24 « synchronisation très fréquente »).
 */
export async function runSyncCycle(opts?: { daysBack?: number; daysAhead?: number; phase?: string }): Promise<SyncStats> {
  const daysBack = opts?.daysBack ?? 2;
  const daysAhead = opts?.daysAhead ?? 8;
  const phase = opts?.phase ?? 'cycle';
  const stats = emptyStats();
  const from = new Date(Date.now() - daysBack * 24 * 3_600_000);
  const to = new Date(Date.now() + daysAhead * 24 * 3_600_000);
  const { allLeagueCodes } = await import('../forecast/espn-week');
  const codes = allLeagueCodes();
  stats.leaguesTotal = codes.length;

  const season = from.getUTCFullYear();
  await mapWithConcurrency(codes, 6, async (code) => {
    try {
      const r = await syncLeagueWindow(code, from, to, season);
      stats.eventsSeen += r.events;
      stats.matchesCreated += r.matchesCreated;
      stats.matchesUpdated += r.matchesUpdated;
      stats.resultsUpserted += r.resultsUpserted;
      stats.oddsInserted += r.oddsInserted;
      if (r.failed) stats.leaguesFailed++;
    } catch {
      stats.leaguesFailed++;
    }
  });

  // §7 (Task 28) : alimentation de l'HISTORIQUE des équipes à venir
  // (< 48 h) pour que le H2H du détail soit servi par la base AVANT
  // même la première consultation. Budget borné : 4 équipes/cycle
  // (TTL interne 6 h par équipe) — aucun impact sur la latence des
  // analyses (dissocié d'analyzeMatch).
  try {
    const upcoming = await db.match.findMany({
      where: { kickoffAt: { gte: new Date(Date.now() - 3_600_000), lte: new Date(Date.now() + 48 * 3_600_000) }, homeTeamId: { not: null }, awayTeamId: { not: null } },
      orderBy: { kickoffAt: 'asc' },
      take: 8,
      select: { competitionId: true, homeTeamId: true, homeTeamName: true, awayTeamId: true, awayTeamName: true },
    });
    const comps = upcoming.length
      ? await db.competition.findMany({ where: { id: { in: [...new Set(upcoming.map((m) => m.competitionId).filter((x): x is string => !!x))] } }, select: { id: true, espnLeagueId: true } })
      : [];
    const leagueById = new Map(comps.map((c) => [c.id, c.espnLeagueId]));
    const seasonNow = new Date().getUTCFullYear();
    const seen = new Set<string>();
    let synced = 0;
    for (const m of upcoming) {
      if (synced >= 4) break;
      const league = m.competitionId ? leagueById.get(m.competitionId) : null;
      if (!league) continue;
      for (const [tid, tname] of [
        [m.homeTeamId!, m.homeTeamName],
        [m.awayTeamId!, m.awayTeamName],
      ] as const) {
        if (seen.has(tid) || synced >= 4) continue;
        seen.add(tid);
        const n = await syncTeamHistory(league, tid, tname, [seasonNow - 1, seasonNow]).catch(() => 0);
        if (n > 0) synced++;
      }
    }
    if (synced > 0) {
      stats.resultsUpserted += synced; // traçabilité : historiques ajoutés ce cycle
    }
  } catch {
    // tolerant : l'historique se rattrapera au cycle suivant
  }

  await logSyncRun(phase, stats);
  return stats;
}

/** §24 : matchs EN DIRECT (ou imminents) — rafraîchissement très fréquent. */
export async function refreshLiveMatches(): Promise<SyncStats> {
  const stats = emptyStats();
  const now = Date.now();
  const live = await db.match.findMany({
    where: {
      OR: [
        { status: { in: ['LIVE', 'HALFTIME'] } },
        { status: 'SCHEDULED', kickoffAt: { gte: new Date(now - 3 * 3_600_000), lte: new Date(now + 4 * 3_600_000) } },
      ],
    },
    select: { espnEventId: true, competitionId: true },
  });
  if (!live.length) return stats;
  const leagueIds = [...new Set(live.map((m) => m.competitionId).filter((x): x is string => !!x))];
  const competitions = leagueIds.length
    ? await db.competition.findMany({ where: { id: { in: leagueIds } }, select: { espnLeagueId: true, name: true } })
    : [];
  const leagueByCode = new Map(competitions.map((c) => [c.espnLeagueId, c.name]));
  const codes = [...leagueByCode.keys()];
  stats.leaguesTotal = codes.length;
  const dayISO = new Date(now).toISOString().slice(0, 10);
  const wanted = new Set(live.map((m) => m.espnEventId));
  const espn = await import('../espn');

  await mapWithConcurrency(codes, 6, async (code) => {
    const board = await espn.fetchScoreboard(code, dayISO, 'sync');
    if (!board) {
      stats.leaguesFailed++;
      return;
    }
    const events = board.events.filter((ev) => wanted.has(ev.id)).map(normalizeFromEspnEvent).filter((e): e is NormalizedEvent => e !== null);
    if (!events.length) return;
    try {
      const r = await ingestBatch(events, { leagueCode: code, leagueName: leagueByCode.get(code) ?? null, season: board.seasonYear ?? null });
      stats.eventsSeen += r.eventsSeen;
      stats.matchesCreated += r.matchesCreated;
      stats.matchesUpdated += r.matchesUpdated;
      stats.resultsUpserted += r.resultsCreated + r.resultsUpdated;
      stats.oddsInserted += r.oddsInserted;
    } catch {
      stats.skipped++;
    }
  });
  await logSyncRun('live', stats);
  return stats;
}

/** Journal de traçabilité §5/§27 (SyncJobRun). */
async function logSyncRun(phase: string, stats: SyncStats): Promise<void> {
  try {
    await db.syncJobRun.create({
      data: { startedAt: new Date(), finishedAt: new Date(), phase, stats: JSON.stringify(stats) },
    });
  } catch {
    // le journal ne doit jamais faire échouer la synchronisation
  }
}

// ---------- Historique par équipe (§7 : H2H depuis la base) ----------

const gTeam = globalThis as unknown as { __voltrixTeamSyncAt?: Map<string, number> };
gTeam.__voltrixTeamSyncAt ??= new Map();
const TEAM_SYNC_TTL_MS = 6 * 3_600_000; // une équipe resynchronisée au plus toutes les 6 h

/**
 * Alimente la base avec l'historique COMPLET d'une équipe (2 saisons,
 * convention analyze.ts) depuis fetchTeamSchedule — appelé paresseusement
 * avant un calcul H2H (§7 : les confrontations doivent venir de la base,
 * pas d'un appel ESPN par affichage). Idempotent par espn_event_id.
 * BATCH : 1 aller-retour par table pour tout l'historique.
 */
export async function syncTeamHistory(leagueCode: string, teamId: string, teamName: string, seasons: number[]): Promise<number> {
  const key = `${leagueCode}:${teamId}:${seasons.join(',')}`;
  const last = gTeam.__voltrixTeamSyncAt!.get(key) ?? 0;
  if (Date.now() - last < TEAM_SYNC_TTL_MS) return 0;
  gTeam.__voltrixTeamSyncAt!.set(key, Date.now());

  const games = await fetchTeamSchedule(leagueCode, teamId, seasons, 'sync');
  if (!games.length) return 0;
  const events: NormalizedEvent[] = [];
  for (const gm of games) {
    if (!gm.completed || gm.teamScore === null || gm.opponentScore === null) continue; // §7 : seuls les matchs joués alimentent le H2H
    const kickoffMs = new Date(gm.date).getTime();
    if (!Number.isFinite(kickoffMs)) continue;
    const self: NormalizedTeam = { id: teamId, name: teamName, shortName: null, abbreviation: null, logo: null };
    const opp: NormalizedTeam = { id: gm.opponentId, name: gm.opponentName, shortName: null, abbreviation: null, logo: null };
    events.push({
      espnEventId: gm.eventId,
      kickoffAt: new Date(kickoffMs),
      espnState: 'post',
      statusName: 'STATUS_FINAL',
      statusDetail: 'FT',
      completed: true,
      venue: null,
      home: gm.homeAway === 'home' ? self : opp,
      away: gm.homeAway === 'home' ? opp : self,
      homeScore: gm.homeAway === 'home' ? gm.teamScore : gm.opponentScore,
      awayScore: gm.homeAway === 'home' ? gm.opponentScore : gm.teamScore,
      odds: [],
    });
  }
  if (!events.length) return 0;
  const league = events[0] ? (games[0]?.leagueCode || leagueCode) : leagueCode;
  let count = 0;
  // Un batch par ligue d'origine des matchs (amicaux/coupes → codes différents)
  const byLeague = new Map<string, NormalizedEvent[]>();
  for (const ev of events) {
    const code = games.find((g) => g.eventId === ev.espnEventId)?.leagueCode || leagueCode;
    const arr = byLeague.get(code) ?? [];
    arr.push(ev);
    byLeague.set(code, arr);
  }
  for (const [code, evs] of byLeague) {
    try {
      const r = await ingestBatch(evs, { leagueCode: code, leagueName: getLeague(code)?.name ?? null, season: null, withOdds: false });
      count += r.eventsSeen;
    } catch {
      // tolerant : l'historique d'une ligue en échec n'interrompt pas les autres
    }
  }
  return count;
}
