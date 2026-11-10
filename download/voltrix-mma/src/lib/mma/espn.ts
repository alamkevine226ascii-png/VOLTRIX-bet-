/**
 * VOLTRIX — Adaptateur ESPN 100 % navigateur.
 *
 * Application frontend pure : AUCUN serveur, AUCUNE base de données.
 * Les endpoints publics d'ESPN (access-control-allow-origin: *, vérifié le
 * 2026-11-09) sont appelés directement depuis le navigateur de l'utilisateur.
 *
 * Endpoints utilisés (tous vérifiés lors de l'audit initial) :
 *  - GET site.api.espn.com/apis/site/v2/sports/mma/{league}/scoreboard?dates=YYYYMMDD-YYYYMMDD
 *  - GET sports.core.api.espn.com/v2/sports/mma/leagues/{league}/events/{eid}/competitions/{cid}
 *  - GET .../competitions/{cid}/status
 *  - GET .../competitions/{cid}/competitors/{aid}/statistics
 *  - GET sports.core.api.espn.com/v2/sports/mma/athletes/{aid}
 *  - GET .../athletes/{aid}/statistics
 *  - GET .../athletes/{aid}/records/0
 *  - GET site.web.api.espn.com/apis/common/v3/sports/mma/athletes/{aid}  (historique)
 *
 * Robustesse :
 *  - cache en mémoire + sessionStorage (TTL par type de ressource) ;
 *  - file à concurrence limitée (4 requêtes simultanées max) ;
 *  - une relance polie (2,5 s) sur les réponses 403/429 (bridage CDN) ;
 *  - 404 -> null : une donnée absente chez la source n'est jamais fabriquée.
 */

/* Bases ESPN — par défaut appelées DIRECTEMENT depuis le navigateur
   (CORS ouvert, vérifié : access-control-allow-origin: *). Sur un réseau
   verrouillé qui bloque les origines tierces, on peut pointer ces bases
   vers un relai même-origine (voir rewrites next.config.ts). */
const SITE_BASE = process.env.NEXT_PUBLIC_ESPN_SITE_BASE ?? 'https://site.api.espn.com'
const SITEWEB_BASE = process.env.NEXT_PUBLIC_ESPN_SITEWEB_BASE ?? 'https://site.web.api.espn.com'
const CORE_BASE = process.env.NEXT_PUBLIC_ESPN_CORE_BASE ?? 'https://sports.core.api.espn.com'

const SITE = `${SITE_BASE}/apis/site/v2/sports/mma`
const CORE = `${CORE_BASE}/v2/sports/mma`
const CORE_LEAGUES = `${CORE}/leagues`
const COMMON_V3 = `${SITEWEB_BASE}/apis/common/v3/sports/mma`

/** Codes de ligue contenus dans les UID ESPN (vérifiés à l'audit). */
export const ESPN_LEAGUE_UIDS: Record<string, string> = {
  '3321': 'ufc',
  '3347': 'pfl',
  '3323': 'bellator',
}

export const ESPN_LEAGUES: Record<string, string> = {
  UFC: 'ufc',
  PFL: 'pfl',
  BELLATOR: 'bellator',
}

/**
 * Organisations actives côté liste d'événements. Directive produit
 * (2026-11-09) : l'analyse MMA se focalise sur l'UFC UNIQUEMENT.
 * PFL/Bellator restent décodables (historiques croisés) mais ne sont
 * plus scannés pour les listes d'événements ni les pronos.
 */
export const ACTIVE_ORGS: string[] = ['UFC']

export function parseFightUid(uid: string): { leagueId: string; eventId: string; competitionId: string } | null {
  const m = uid.match(/~l:(\d+)~e:(\d+)~c:(\d+)/)
  if (!m) return null
  return { leagueId: m[1], eventId: m[2], competitionId: m[3] }
}

// ---------------------------------------------------------------------------
// Cache navigateur (mémoire + sessionStorage) et file de concurrence
// ---------------------------------------------------------------------------

export const CACHE_TTL = {
  scoreboard: 10 * 60 * 1000,
  competition: 60 * 60 * 1000,
  athlete: 24 * 60 * 60 * 1000,
  athleteStats: 12 * 60 * 60 * 1000,
  athleteHistory: 24 * 60 * 60 * 1000,
  fightStats: 60 * 60 * 1000,
} as const

interface CacheEntry {
  payload: unknown
  expiresAt: number
}

import { persistGet, persistSet } from '../persist'

const SS_PREFIX = 'voltrix:espn:'
const memory = new Map<string, CacheEntry>()

function loadSession(key: string): CacheEntry | null {
  const mem = memory.get(key)
  if (mem && mem.expiresAt > Date.now()) return mem
  const stored = persistGet<CacheEntry>(SS_PREFIX + key)
  if (!stored) return null
  if (stored.expiresAt < Date.now()) {
    persistRemoveKey(SS_PREFIX + key)
    return null
  }
  memory.set(key, stored)
  return stored
}

function persistRemoveKey(fullKey: string): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return
    window.localStorage.removeItem(fullKey)
  } catch {
    /* ignore */
  }
}

function saveSession(key: string, entry: CacheEntry): void {
  // Cache PERSISTANT (localStorage) : survit à la fermeture de l'App —
  // retour au moins 10 min sans recalcul réseau (exigence produit).
  persistSet(SS_PREFIX + key, entry, Math.max(0, entry.expiresAt - Date.now()))
}

export interface CacheStats {
  entries: number
  approxSizeKb: number
  providers: { host: string; count: number }[]
}

/** Statistiques du cache local (affichées dans Paramètres). */
export function getCacheStats(): CacheStats {
  const keys = new Set<string>(memory.keys())
  try {
    if (typeof sessionStorage !== 'undefined') {
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i)
        if (k && k.startsWith(SS_PREFIX)) keys.add(k.slice(SS_PREFIX.length))
      }
    }
  } catch {
    /* ignore */
  }
  let size = 0
  const hosts = new Map<string, number>()
  for (const k of keys) {
    try {
      if (typeof sessionStorage !== 'undefined') {
        size += (sessionStorage.getItem(SS_PREFIX + k) ?? '').length
      }
    } catch {
      /* ignore */
    }
    const host = k.split(':')[1] ?? '?'
    hosts.set(host, (hosts.get(host) ?? 0) + 1)
  }
  return {
    entries: keys.size,
    approxSizeKb: Math.round(size / 1024),
    providers: [...hosts.entries()].map(([host, count]) => ({ host, count })),
  }
}

/** Vide entièrement le cache local (mémoire + stockage persistant). */
export function clearCache(): void {
  memory.clear()
  try {
    if (typeof window === 'undefined' || !window.localStorage) return
    const toRemove: string[] = []
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i)
      if (k && (k.startsWith(SS_PREFIX) || k.startsWith('voltrix:derived:'))) toRemove.push(k)
    }
    for (const k of toRemove) window.localStorage.removeItem(k)
  } catch {
    /* ignore */
  }
}

// File à concurrence limitée : 4 requêtes simultanées maximum vers ESPN.
const MAX_CONCURRENT = 4
let active = 0
const waiting: (() => void)[] = []

async function acquire(): Promise<void> {
  if (active < MAX_CONCURRENT) {
    active++
    return
  }
  await new Promise<void>((resolve) => waiting.push(resolve))
  active++
}

function release(): void {
  active = Math.max(0, active - 1)
  const next = waiting.shift()
  if (next) next()
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * GET JSON vers ESPN avec cache et limitation de concurrence.
 * Retourne null sur 404 (donnée absente chez le fournisseur).
 * Relance une fois poliment sur 403/429 (bridage intermittent du CDN).
 */
export async function espnFetch<T>(
  url: string,
  opts: { cacheKey: string; ttlMs: number } = { cacheKey: url, ttlMs: 0 }
): Promise<T | null> {
  const { cacheKey, ttlMs } = opts

  if (ttlMs > 0) {
    const mem = memory.get(cacheKey)
    if (mem && mem.expiresAt > Date.now()) return mem.payload as T
    const ss = loadSession(cacheKey)
    if (ss) {
      memory.set(cacheKey, ss)
      return ss.payload as T
    }
  }

  await acquire()
  const controller = new AbortController()
  /* 45 s (audit 2026-11-09) : les grands scans (prior rounds UFC :
     ~130 requêtes) passent par le relai même-origine qui débite limite
     les appels pour éviter les 403 en rafale du CDN ESPN — une requête
     peut légitimement patienter en file > 15 s. */
  const timer = setTimeout(() => controller.abort(), 45000)
  try {
    // User-Agent explicite : hors navigateur (scripts, SSR), le CDN ESPN
    // rejette les clients inconnus (403 — vérifié à l'audit ; Bun envoie
    // « Bun/x.y »). Dans un vrai navigateur, cet en-tête est interdit et
    // donc silencieusement ignoré — aucun effet de bord.
    const headers: Record<string, string> = { 'User-Agent': 'Mozilla/5.0 (VOLTRIX)' }
    let res = await fetch(url, { signal: controller.signal, cache: 'no-store', headers })
    if (res.status === 403 || res.status === 429) {
      await sleep(2500)
      res = await fetch(url, { signal: controller.signal, cache: 'no-store', headers })
    }
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`ESPN HTTP ${res.status} — ${new URL(url).host}`)
    const json = (await res.json()) as T
    if (ttlMs > 0) {
      const entry: CacheEntry = { payload: json, expiresAt: Date.now() + ttlMs }
      memory.set(cacheKey, entry)
      saveSession(cacheKey, entry)
    }
    return json
  } finally {
    clearTimeout(timer)
    release()
  }
}

/** Parcourt des tâches avec concurrence limitée (utilitaire public). */
export async function mapLimited<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++
      results[i] = await fn(items[i], i)
    }
  })
  await Promise.all(workers)
  return results
}

// ---------------------------------------------------------------------------
// Types bruts ESPN (partiels, tolérants — la source reste hétérogène)
// ---------------------------------------------------------------------------

interface EspnAddress {
  city?: string
  country?: string
}
interface EspnVenue {
  fullName?: string
  address?: EspnAddress
}
interface EspnStatusType {
  state?: string
  name?: string
  completed?: boolean
  description?: string
}
interface EspnStatus {
  clock?: number
  displayClock?: string
  period?: number
  type?: EspnStatusType
  result?: { name?: string | null; description?: string | null }
}
interface EspnRecord {
  summary?: string
  type?: string
}
export interface EspnCompetitor {
  id?: string
  order?: number
  winner?: boolean
  athlete?: { displayName?: string; fullName?: string }
  records?: EspnRecord[]
}
interface EspnCompetition {
  id?: string
  date?: string
  status?: EspnStatus
  format?: { regulation?: { periods?: number } }
  competitors?: EspnCompetitor[]
}
interface EspnEvent {
  id?: string
  name?: string
  shortName?: string
  date?: string
  status?: EspnStatus
  venues?: EspnVenue[]
  competitions?: EspnCompetition[]
}

interface CoreAthlete {
  fullName?: string
  nickname?: string
  dateOfBirth?: string
  citizenship?: string
  height?: number
  reach?: number
  weight?: number
  weightClass?: { text?: string }
  stance?: { text?: string }
  styles?: { text?: string }[]
  status?: { type?: string }
  headshot?: { href?: string }
  flag?: { href?: string }
}

interface CoreStatItem {
  name?: string
  value?: number
  displayValue?: string
}
interface CoreStatistics {
  splits?: { categories?: { name?: string; stats?: CoreStatItem[] }[] }
}
interface CoreRecordStats {
  stats?: CoreStatItem[]
}

interface CoreCompetition {
  type?: { text?: string }
  format?: { regulation?: { periods?: number } }
  cardSegment?: { description?: string }
  matchNumber?: number
  status?: EspnStatus
  date?: string
}

interface CommonV3Athlete {
  events?: string[]
  eventsMap?: Record<
    string,
    {
      id?: string
      uid?: string
      name?: string
      gameDate?: string
      gameResult?: string
      titleFight?: boolean
      opponent?: { id?: string; displayName?: string }
    }
  >
}

// ---------------------------------------------------------------------------
// DTO normalisés du domaine (mêmes formes que l'ancienne couche serveur)
// ---------------------------------------------------------------------------

export interface ScoreboardFightDTO {
  externalId: string
  espnCompetitionId: string
  status: string
  rawStatus: string | null
  date: string
  /** Round de fin tel que publié dans le scoreboard (status.period). */
  statusPeriod: number | null
  /** Rounds prévus (format.regulation.periods) — 3 ou 5. */
  scheduledRounds: number | null
  /** Secondes écoulées dans le round de fin (status.clock) — sert à
   *  distinguer une décision (round complet) d'une fin anticipée. */
  clockSeconds: number | null
  fighters: {
    externalId: string
    espnAthleteId: string
    fullName: string
    recordAtFight: string | null
    isWinner: boolean | null
    corner: number | null
  }[]
}

export interface ScoreboardEventDTO {
  externalId: string
  espnEventId: string
  organization: string
  league: string
  name: string
  shortName: string | null
  date: string
  status: string
  rawStatus: string | null
  venueName: string | null
  city: string | null
  country: string | null
  fights: ScoreboardFightDTO[]
}

export interface FightDetailDTO {
  externalId: string
  weightClass: string | null
  scheduledRounds: number | null
  cardSegment: string | null
  matchNumber: number | null
  status: string
  rawStatus: string | null
  durationSeconds: number | null
  resultMethod: string | null
  resultDetail: string | null
  winnerExternalId: string | null
}

export interface FighterProfileDTO {
  externalId: string
  espnAthleteId: string
  fullName: string | null
  nickname: string | null
  birthDate: string | null
  nationality: string | null
  heightInches: number | null
  reachInches: number | null
  weightLbs: number | null
  weightClass: string | null
  stance: string | null
  fightingStyle: string | null
  active: boolean | null
  imageUrl: string | null
  flagUrl: string | null
  sourceUrl: string
}

export interface FighterStatsDTO {
  sigStrikesLandedPerMin: number | null
  strikingAccuracy: number | null
  takedownsPer15Min: number | null
  takedownAccuracy: number | null
  submissionsPer15Min: number | null
  koPercentage: number | null
  tkoPercentage: number | null
  decisionPercentage: number | null
}

export interface FighterRecordDTO {
  wins: number | null
  losses: number | null
  draws: number | null
  noContests: number | null
  winsByKo: number | null
  winsBySub: number | null
  titleWins: number | null
  /** Méthodes de DÉFAITE (records/0) — base du byMethod « adversaire ».
   *  Vérifié sur Gane : tkoLosses=0, submissionLosses=1 ; decisionLosses
   *  n'est pas publié = losses − tkoLosses − submissionLosses. */
  tkoLosses: number | null
  submissionLosses: number | null
}

export interface FightHistoryEntryDTO {
  externalFightKey: string
  espnEventId: string | null
  espnCompetitionId: string | null
  espnLeagueId: string | null
  eventName: string | null
  eventDate: string
  result: string
  opponentName: string
  opponentExternalId: string | null
  titleFight: boolean
}

export interface FightStatsBreakdown {
  sigStrikesLanded: number | null
  sigStrikesAttempted: number | null
  takedownsLanded: number | null
  takedownsAttempted: number | null
  submissions: number | null
  knockdowns: number | null
  controlSeconds: number | null
}

// Import des mappages purs (statuts, durées, méthodes) — voir mma/types.ts.
import {
  fightDurationSeconds,
  mapEspnStatus,
  resultMethodDetail,
} from './types'

function fmtDate(d: Date): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}${m}${day}`
}

// ---------------------------------------------------------------------------
// Lecture des ressources ESPN
// ---------------------------------------------------------------------------

/** Scoreboard d'une organisation sur une fenêtre de dates (UTC). */
export async function getScoreboard(org: string, from: Date, to: Date): Promise<ScoreboardEventDTO[]> {
  const league = ESPN_LEAGUES[org] ?? org.toLowerCase()
  const range = `${fmtDate(from)}-${fmtDate(to)}`
  const url = `${SITE}/${league}/scoreboard?dates=${range}`
  const data = await espnFetch<{ events?: EspnEvent[] }>(url, {
    cacheKey: `espn:site:${league}:scoreboard:${range}`,
    ttlMs: CACHE_TTL.scoreboard,
  })
  if (!data?.events) return []
  return data.events.filter((e) => e.id && e.date).map((e) => mapEvent(e, org, league))
}

function mapEvent(e: EspnEvent, org: string, league: string): ScoreboardEventDTO {
  const date = new Date(e.date as string)
  const venue = e.venues?.[0]
  const fights = (e.competitions ?? [])
    .filter((c) => c.id)
    .map((c) => mapCompetition(c, date))
  return {
    externalId: `espn:${league}:event:${e.id}`,
    espnEventId: e.id as string,
    organization: org,
    league,
    name: e.name ?? 'Événement sans nom',
    shortName: e.shortName ?? null,
    date: date.toISOString(),
    status: mapEspnStatus(e.status?.type, date),
    rawStatus: e.status?.type?.state ?? null,
    venueName: venue?.fullName ?? null,
    city: venue?.address?.city ?? null,
    country: venue?.address?.country ?? null,
    fights,
  }
}

function mapCompetition(c: EspnCompetition, eventDate: Date): ScoreboardFightDTO {
  const fighters = (c.competitors ?? [])
    .filter((comp) => comp.id && (comp.athlete?.displayName || comp.athlete?.fullName))
    .map((comp) => {
      const record = (comp.records ?? []).find((r) => r.type === 'total') ?? comp.records?.[0]
      return {
        externalId: `espn:athlete:${comp.id}`,
        espnAthleteId: comp.id as string,
        fullName: comp.athlete?.displayName ?? (comp.athlete?.fullName as string),
        recordAtFight: record?.summary ?? null,
        isWinner: comp.winner === true ? true : comp.winner === false ? false : null,
        corner: comp.order ?? null,
      }
    })
  const date = c.date ? new Date(c.date) : eventDate
  return {
    externalId: `espn:competition:${c.id}`,
    espnCompetitionId: c.id as string,
    status: mapEspnStatus(c.status?.type, date),
    rawStatus: c.status?.type?.state ?? null,
    date: date.toISOString(),
    statusPeriod: Number.isFinite(Number(c.status?.period)) ? Number(c.status?.period) : null,
    scheduledRounds:
      c.format?.regulation?.periods === 5 ? 5 : c.format?.regulation?.periods === 3 ? 3 : null,
    clockSeconds: Number.isFinite(Number(c.status?.clock)) ? Number(c.status?.clock) : null,
    fighters,
  }
}

/** Détail d'un combat (catégorie, rounds, segment, résultat, durée). */
export async function getCompetitionDetail(league: string, espnEventId: string, espnCompetitionId: string): Promise<FightDetailDTO | null> {
  const base = `${CORE_LEAGUES}/${league}/events/${espnEventId}/competitions/${espnCompetitionId}`
  const comp = await espnFetch<CoreCompetition>(`${base}?lang=en&region=us`, {
    cacheKey: `espn:core:competition:${espnCompetitionId}`,
    ttlMs: CACHE_TTL.competition,
  })
  if (!comp) return null

  const status = await espnFetch<EspnStatus>(`${base}/status?lang=en&region=us`, {
    cacheKey: `espn:core:competition-status:${espnCompetitionId}`,
    ttlMs: CACHE_TTL.competition,
  })

  const date = comp.date ? new Date(comp.date) : new Date()
  const mappedStatus = mapEspnStatus(status?.type ?? comp.status?.type, date)
  const { method, detail } = resultMethodDetail(status?.result ?? null)
  return {
    externalId: `espn:competition:${espnCompetitionId}`,
    weightClass: comp.type?.text ?? null,
    scheduledRounds: comp.format?.regulation?.periods ?? null,
    cardSegment: comp.cardSegment?.description ?? null,
    matchNumber: comp.matchNumber ?? null,
    status: mappedStatus,
    rawStatus: status?.type?.state ?? comp.status?.type?.state ?? null,
    durationSeconds: mappedStatus === 'TERMINE' ? fightDurationSeconds(status ?? null) : null,
    resultMethod: mappedStatus === 'TERMINE' ? method : null,
    resultDetail: mappedStatus === 'TERMINE' ? detail : null,
    winnerExternalId: null, // déterminé par le scoreboard (competitors[].winner)
  }
}

/** Fiche biographique d'un combattant. */
export async function getAthlete(espnAthleteId: string): Promise<FighterProfileDTO | null> {
  const a = await espnFetch<CoreAthlete>(`${CORE}/athletes/${espnAthleteId}?lang=en&region=us`, {
    cacheKey: `espn:core:athlete:${espnAthleteId}`,
    ttlMs: CACHE_TTL.athlete,
  })
  if (!a) return null
  return {
    externalId: `espn:athlete:${espnAthleteId}`,
    espnAthleteId,
    fullName: a.fullName ?? null,
    nickname: a.nickname ?? null,
    birthDate: a.dateOfBirth ?? null,
    nationality: a.citizenship ?? null,
    heightInches: a.height ?? null,
    reachInches: a.reach ?? null,
    weightLbs: a.weight ?? null,
    weightClass: a.weightClass?.text ?? null,
    stance: a.stance?.text ?? null,
    fightingStyle: a.styles?.[0]?.text ?? null,
    active: a.status?.type ? a.status.type === 'active' : null,
    imageUrl: a.headshot?.href ?? null,
    flagUrl: a.flag?.href ?? null,
    sourceUrl: `https://www.espn.com/mma/fighter/_/id/${espnAthleteId}`,
  }
}

/** Statistiques de carrière (SLpM, précision, takedowns, soumissions...). */
export async function getAthleteStats(espnAthleteId: string): Promise<FighterStatsDTO | null> {
  const data = await espnFetch<CoreStatistics>(`${CORE}/athletes/${espnAthleteId}/statistics?lang=en&region=us`, {
    cacheKey: `espn:core:athlete-stats:${espnAthleteId}`,
    ttlMs: CACHE_TTL.athleteStats,
  })
  if (!data) return null
  const items = (data.splits?.categories ?? []).flatMap((c) => c.stats ?? [])
  const get = (name: string): number | null => {
    const it = items.find((s) => s.name === name)
    if (!it || it.value == null || !Number.isFinite(Number(it.value))) return null
    return Number(it.value)
  }
  return {
    sigStrikesLandedPerMin: get('strikeLPM'),
    strikingAccuracy: get('strikeAccuracy'),
    takedownsPer15Min: get('takedownAvg'),
    takedownAccuracy: get('takedownAccuracy'),
    submissionsPer15Min: get('submissionAvg'),
    koPercentage: get('koPercentage'),
    tkoPercentage: get('tkoPercentage'),
    decisionPercentage: get('decisionPercentage'),
  }
}

/** Palmarès détaillé (victoires par méthode, combats de titre). */
export async function getAthleteRecord(espnAthleteId: string): Promise<FighterRecordDTO | null> {
  const data = await espnFetch<CoreRecordStats>(`${CORE}/athletes/${espnAthleteId}/records/0?lang=en&region=us`, {
    cacheKey: `espn:core:athlete-records:${espnAthleteId}`,
    ttlMs: CACHE_TTL.athleteStats,
  })
  if (!data?.stats) return null
  const get = (name: string): number | null => {
    const it = data.stats?.find((s) => s.name === name)
    if (!it || it.value == null || !Number.isFinite(Number(it.value))) return null
    return Number(it.value)
  }
  return {
    wins: get('wins'),
    losses: get('losses'),
    draws: get('draws'),
    noContests: get('noContests'),
    winsByKo: get('tkos'),
    winsBySub: get('submissions'),
    titleWins: get('titleWins'),
    tkoLosses: get('tkoLosses'),
    submissionLosses: get('submissionLosses'),
  }
}

/** Historique des combats (résultats, adversaires). */
export async function getAthleteHistory(espnAthleteId: string): Promise<FightHistoryEntryDTO[]> {
  const data = await espnFetch<CommonV3Athlete>(`${COMMON_V3}/athletes/${espnAthleteId}`, {
    cacheKey: `espn:common:athlete-history:${espnAthleteId}`,
    ttlMs: CACHE_TTL.athleteHistory,
  })
  const entries = Object.values(data?.eventsMap ?? {})
  return entries
    .filter((e) => e.gameDate && e.gameResult && e.opponent?.displayName && e.uid)
    .map((e) => {
      const uid = e.uid as string
      const parts = parseFightUid(uid)
      return {
        externalFightKey: `espn:uid:${uid}`,
        espnEventId: parts?.eventId ?? null,
        espnCompetitionId: parts?.competitionId ?? null,
        espnLeagueId: parts?.leagueId ?? null,
        eventName: e.name ?? null,
        eventDate: new Date(e.gameDate as string).toISOString(),
        result: (e.gameResult as string).toUpperCase(),
        opponentName: e.opponent?.displayName as string,
        opponentExternalId: e.opponent?.id ? `espn:athlete:${e.opponent.id}` : null,
        titleFight: e.titleFight === true,
      }
    })
}

/** Statistiques détaillées d'un combattant dans un combat donné. */
export async function getFightStatsFor(
  espnEventId: string,
  espnCompetitionId: string,
  espnAthleteId: string,
  league = 'ufc'
): Promise<FightStatsBreakdown | null> {
  const url = `${CORE_LEAGUES}/${league}/events/${espnEventId}/competitions/${espnCompetitionId}/competitors/${espnAthleteId}/statistics?lang=en&region=us`
  const data = await espnFetch<CoreStatistics>(url, {
    cacheKey: `espn:core:fight-stats:${espnCompetitionId}:${espnAthleteId}`,
    ttlMs: CACHE_TTL.fightStats,
  })
  if (!data) return null
  const items = (data.splits?.categories ?? []).flatMap((c) => c.stats ?? [])
  const num = (name: string): number | null => {
    const it = items.find((s) => s.name === name)
    if (!it || it.value == null || !Number.isFinite(Number(it.value))) return null
    return Number(it.value)
  }
  const control = items.find((s) => s.name === 'timeInControl')?.displayValue
  let controlSeconds: number | null = null
  if (control) {
    const m = control.match(/^(\d+):(\d{2})$/)
    if (m) controlSeconds = Number(m[1]) * 60 + Number(m[2])
  }
  return {
    sigStrikesLanded: num('sigStrikesLanded'),
    sigStrikesAttempted: num('sigStrikesAttempted'),
    takedownsLanded: num('takedownsLanded'),
    takedownsAttempted: num('takedownsAttempted'),
    submissions: num('submissions'),
    knockdowns: num('knockDowns'),
    controlSeconds,
  }
}

/** Statut d'une compétition (durée + méthode de victoire + round de fin). */
export async function getCompetitionStatus(
  league: string,
  espnEventId: string,
  espnCompetitionId: string
): Promise<{
  durationSeconds: number | null
  resultMethod: string | null
  resultDetail: string | null
  /** Round de fin PUBLIÉ PAR ESPN (`status.period`) — audité 2026-11-09 :
   *  présent sur tous les combats terminés testés (fins comme décisions). */
  period: number | null
  /** Nom brut du résultat ESPN (ex: "kotko", "no-contest") — distingue
   *  un no-contest d'un nul dans l'historique. */
  resultName: string | null
  raw: { clock: number | null; period: number | null }
} | null> {
  const url = `${CORE_LEAGUES}/${league}/events/${espnEventId}/competitions/${espnCompetitionId}/status?lang=en&region=us`
  const status = await espnFetch<EspnStatus>(url, {
    cacheKey: `espn:core:competition-status:${espnCompetitionId}`,
    // TTL court (60 s) : suit le round courant d'un combat EN COURS ; les
    // consommateurs de plus haut niveau (dérivés, prior rounds) cachent
    // leurs propres agrégats, donc ce TTL ne multiplie pas les requêtes.
    ttlMs: 60 * 1000,
  })
  if (!status) return null
  const { method, detail } = resultMethodDetail(status.result ?? null)
  return {
    durationSeconds: fightDurationSeconds(status),
    resultMethod: method,
    resultDetail: detail,
    period: Number.isFinite(Number(status.period)) ? Number(status.period) : null,
    resultName: status.result?.name ?? null,
    raw: { clock: status.clock ?? null, period: status.period ?? null },
  }
}
