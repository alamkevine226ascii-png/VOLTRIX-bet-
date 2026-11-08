/**
 * VOLTRIX — Moteur d'analyse statistique (portage 100 % frontend).
 *
 * Principes inchangés :
 *  1. Données observées et interprétations STRICTEMENT séparées.
 *  2. Une statistique manquante est "Non disponible", jamais estimée.
 *  3. Les indicateurs non fournis par la source (frappes reçues/minute,
 *     défenses, temps moyen) sont CALCULÉS dans le navigateur à partir des
 *     statistiques par combat sur une fenêtre explicite (8 combats), mis en
 *     cache sessionStorage, et étiquetés comme tels.
 *  4. Le pronostic (prediction.ts) agrège les dimensions observées en une
 *     probabilité bornée et documentée ; jamais de donnée inventée.
 */
import type {
  FighterProfileDTO,
  FighterRecordDTO,
  FighterStatsDTO,
  FightHistoryEntryDTO,
} from './espn'
import {
  ESPN_LEAGUE_UIDS,
  getCompetitionStatus,
  getFightStatsFor,
  parseFightUid,
} from './espn'
import { persistGet, persistSet } from '../persist'
import {
  formScore,
  inchesToCm,
  lastResultsFromHistory,
} from './types'
import { computePrediction, type PredictionView } from './prediction'

/** Fenêtre de calcul des indicateurs avancés (limité côté navigateur). */
export const DERIVED_WINDOW = 8

// ---------------------------------------------------------------------------
// Vues sérialisables (mêmes formes que l'ancienne API — l'UI est conservée)
// ---------------------------------------------------------------------------

export interface FighterView {
  id: string
  externalId: string
  fullName: string
  nickname: string | null
  imageUrl: string | null
  flagUrl: string | null
  nationality: string | null
  birthDate: string | null
  age: number | null
  heightCm: number | null
  reachCm: number | null
  weightLbs: number | null
  weightClass: string | null
  stance: string | null
  fightingStyle: string | null
  record: { wins: number | null; losses: number | null; draws: number | null; noContests: number | null; winsByKo: number | null; winsBySub: number | null; tkoLosses: number | null; submissionLosses: number | null }
  lastResults: string[]
  totalFights: number | null
  stats: {
    sigStrikesLandedPerMin: number | null
    strikingAccuracy: number | null
    takedownsPer15Min: number | null
    takedownAccuracy: number | null
    submissionsPer15Min: number | null
    koPercentage: number | null
    tkoPercentage: number | null
    decisionPercentage: number | null
    syncedAt: string | null
  } | null
  derived: DerivedResult | null
  recentHistory: {
    eventDate: string
    eventName: string | null
    result: string
    opponentName: string
    titleFight: boolean
  }[]
  sourceUrl: string | null
  lastSyncedAt: string
}

export interface ObservedRow {
  label: string
  valueA: string
  valueB: string
  kind: 'bio' | 'record' | 'career' | 'derived'
  origin: string
}

export interface DimensionScore {
  key: string
  label: string
  scoreA: number | null
  scoreB: number | null
  advantage: 'A' | 'B' | '=' | null
  detail: string
  basis: string
  available: boolean
}

export interface CommentaryBlock {
  title: string
  text: string
}

export interface FightAnalysis {
  fight: {
    id: string
    status: string
    weightClass: string | null
    scheduledRounds: number | null
    cardSegment: string | null
    resultMethod: string | null
    resultDetail: string | null
    winner: string | null
  }
  event: {
    id: string
    name: string
    organization: string
    date: string
    venue: string | null
    city: string | null
    country: string | null
  }
  fighters: [FighterView, FighterView]
  observed: ObservedRow[]
  dimensions: DimensionScore[]
  radar: { dimension: string; A: number | null; B: number | null }[]
  commentary: CommentaryBlock[]
  prediction: PredictionView
  limitations: string[]
  sources: { name: string; url: string | null; detail: string; syncedAt: string }[]
  derivedPending: boolean
}

// ---------------------------------------------------------------------------
// Construction des vues combattant depuis les données ESPN
// ---------------------------------------------------------------------------

export interface FighterBundle {
  profile: FighterProfileDTO | null
  stats: FighterStatsDTO | null
  record: FighterRecordDTO | null
  history: FightHistoryEntryDTO[]
  derived: FighterView['derived'] | null
}

function calcAge(birth: string | null): number | null {
  if (!birth) return null
  const b = new Date(birth)
  if (Number.isNaN(b.getTime())) return null
  const now = new Date()
  let age = now.getUTCFullYear() - b.getUTCFullYear()
  const m = now.getUTCMonth() - b.getUTCMonth()
  if (m < 0 || (m === 0 && now.getUTCDate() < b.getUTCDate())) age--
  return age >= 15 && age <= 60 ? age : null // garde-fou contre les dates aberrantes
}

export function toFighterView(bundle: FighterBundle): FighterView {
  const { profile, stats, record, history, derived } = bundle
  const now = new Date().toISOString()
  const sortedHistory = [...history].sort(
    (a, b) => new Date(b.eventDate).getTime() - new Date(a.eventDate).getTime()
  )
  const lastResults = lastResultsFromHistory(sortedHistory) ?? null
  const totalFights =
    record?.wins != null || record?.losses != null
      ? (record?.wins ?? 0) + (record?.losses ?? 0) + (record?.draws ?? 0) + (record?.noContests ?? 0)
      : null
  return {
    id: profile?.externalId ?? 'unknown',
    externalId: profile?.externalId ?? 'unknown',
    fullName: profile?.fullName ?? 'Combattant',
    nickname: profile?.nickname ?? null,
    imageUrl: profile?.imageUrl ?? null,
    flagUrl: profile?.flagUrl ?? null,
    nationality: profile?.nationality ?? null,
    birthDate: profile?.birthDate ?? null,
    age: calcAge(profile?.birthDate ?? null),
    heightCm: inchesToCm(profile?.heightInches ?? null),
    reachCm: inchesToCm(profile?.reachInches ?? null),
    weightLbs: profile?.weightLbs ?? null,
    weightClass: profile?.weightClass ?? null,
    stance: profile?.stance ?? null,
    fightingStyle: profile?.fightingStyle ?? null,
    record: {
      wins: record?.wins ?? null,
      losses: record?.losses ?? null,
      draws: record?.draws ?? null,
      noContests: record?.noContests ?? null,
      winsByKo: record?.winsByKo ?? null,
      winsBySub: record?.winsBySub ?? null,
      tkoLosses: record?.tkoLosses ?? null,
      submissionLosses: record?.submissionLosses ?? null,
    },
    lastResults: lastResults ? lastResults.split(',') : [],
    totalFights,
    stats: stats
      ? {
          sigStrikesLandedPerMin: stats.sigStrikesLandedPerMin,
          strikingAccuracy: stats.strikingAccuracy,
          takedownsPer15Min: stats.takedownsPer15Min,
          takedownAccuracy: stats.takedownAccuracy,
          submissionsPer15Min: stats.submissionsPer15Min,
          koPercentage: stats.koPercentage,
          tkoPercentage: stats.tkoPercentage,
          decisionPercentage: stats.decisionPercentage,
          syncedAt: now,
        }
      : null,
    derived,
    recentHistory: sortedHistory.slice(0, 10).map((h) => ({
      eventDate: h.eventDate,
      eventName: h.eventName,
      result: h.result,
      opponentName: h.opponentName,
      titleFight: h.titleFight === true,
    })),
    sourceUrl: profile?.sourceUrl ?? null,
    lastSyncedAt: now,
  }
}

// ---------------------------------------------------------------------------
// Indicateurs avancés calculés dans le navigateur (fenêtre explicite, cachés)
// ---------------------------------------------------------------------------

export interface DerivedResult {
  windowSize: number
  sigStrikesAbsorbedPerMin: number | null
  strikingDefense: number | null
  takedownDefense: number | null
  avgFightSeconds: number | null
  fightsUsed: number
  fightsSkipped: number
  computedAt: string
  /**
   * Combats documentés de la fenêtre, avec le round de fin PUBLIÉ PAR ESPN
   * (`status.period`) et la méthode (KO/SUB/DÉCISION/NC). Base du modèle de
   * rounds personnalisé — les statuts sont déjà récupérés par le calcul des
   * dérivés, donc cette collecte ne coûte AUCUNE requête supplémentaire.
   * `result` est corrigé : un no-contest étiqueté « D » par l'historique
   * ESPN devient « NC » ici (vérifié : Gane–Aspinall 2025).
   */
  fights: {
    eventDate: string
    result: 'W' | 'L' | 'D' | 'NC'
    method: 'KO_TKO' | 'SOUMISSION' | 'DECISION' | null
    period: number | null
  }[]
}

// v2 : invalidation des caches calculés avec l'ancienne formule de durée
// (temps intra-round inversé — audit 2026-11-09). Stockage PERSISTANT
// (localStorage) : survit à la fermeture de l'App (exigence 10 min min).
const DERIVED_SS_PREFIX = 'voltrix:derived:v2:'
const derivedInFlight = new Map<string, Promise<DerivedResult | null>>()

function readDerivedCache(athleteId: string): DerivedResult | null {
  try {
    const raw = persistGet<{ v?: unknown } | DerivedResult>(DERIVED_SS_PREFIX + athleteId)
    const d = unwrapDerived(raw)
    if (!d) return null
    if (Date.now() - new Date(d.computedAt).getTime() > 12 * 60 * 60 * 1000) return null
    return d
  } catch {
    return null
  }
}

/** Tolère les anciens formats d'enveloppe ({v, exp} ou valeur directe). */
function unwrapDerived(raw: unknown): DerivedResult | null {
  if (!raw || typeof raw !== 'object') return null
  const w = raw as { v?: unknown }
  const d = (w.v ?? raw) as DerivedResult
  return Array.isArray(d.fights) ? d : null
}

/** Lecture du cache dérivé sans déclencher de calcul (utilisé par les loaders). */
export function peekDerivedCache(athleteId: string): DerivedResult | null {
  return readDerivedCache(athleteId)
}

function writeDerivedCache(athleteId: string, d: DerivedResult): void {
  persistSet(DERIVED_SS_PREFIX + athleteId, d, 12 * 60 * 60 * 1000)
}

/** Marque un calcul dérivé terminé sans résultat (évite de re-poler indéfiniment). */
function markDerivedFailed(athleteId: string): void {
  persistSet(DERIVED_SS_PREFIX + 'none:' + athleteId, { at: Date.now() }, 12 * 60 * 60 * 1000)
}

/** Un calcul dérivé a-t-il déjà été tenté sans résultat (TTL 12 h) ? */
export function hasDerivedFailed(athleteId: string): boolean {
  try {
    const raw = persistGet<{ v?: { at?: number } } | { at?: number }>(DERIVED_SS_PREFIX + 'none:' + athleteId)
    if (!raw) return false
    const at = (raw as { v?: { at?: number } }).v?.at ?? (raw as { at?: number }).at
    if (!at) return false
    return Date.now() - Number(at) < 12 * 60 * 60 * 1000
  } catch {
    return false
  }
}

/**
 * Calcule SApM / défenses / temps moyen sur les N derniers combats terminés,
 * en interrogeant les stats par combat d'ESPN directement depuis le navigateur.
 * Le résultat est mis en cache (sessionStorage, 12 h) pour ne pas refaire
 * les requêtes à chaque consultation.
 */
export function computeDerivedStats(
  espnAthleteId: string,
  history: FightHistoryEntryDTO[],
  onProgress?: (done: number, total: number) => void
): Promise<DerivedResult | null> {
  const cached = readDerivedCache(espnAthleteId)
  if (cached) return Promise.resolve(cached)
  const inFlight = derivedInFlight.get(espnAthleteId)
  if (inFlight) return inFlight

  const task = (async (): Promise<DerivedResult | null> => {
    const usable = history
      .filter(
        (h) =>
          h.espnEventId &&
          h.espnCompetitionId &&
          h.espnLeagueId &&
          h.opponentExternalId &&
          ESPN_LEAGUE_UIDS[h.espnLeagueId]
      )
      .sort((a, b) => new Date(b.eventDate).getTime() - new Date(a.eventDate).getTime())
      .slice(0, DERIVED_WINDOW)

    let oppSigLanded = 0
    let oppSigAttempted = 0
    let oppTdl = 0
    let oppTda = 0
    let totalSeconds = 0
    let fightsUsed = 0
    let fightsSkipped = 0
    // Collecte des combats documentés (résultat corrigé NC, méthode, round
    // de fin) pour le modèle de rounds personnalisé — statuts DÉJÀ récupérés
    // ci-dessous, donc coût réseau nul.
    const fights: DerivedResult['fights'] = []

    for (let i = 0; i < usable.length; i++) {
      const h = usable[i]
      const league = ESPN_LEAGUE_UIDS[h.espnLeagueId as string]
      const oppId = (h.opponentExternalId as string).split(':').pop() as string
      try {
        const [oppStats, status] = await Promise.all([
          getFightStatsFor(h.espnEventId as string, h.espnCompetitionId as string, oppId, league),
          getCompetitionStatus(league, h.espnEventId as string, h.espnCompetitionId as string),
        ])
        // Correction NC : l'historique ESPN étiquette « D » un no-contest
        // (vérifié : Gane–Aspinall 2025, result.name = 'no-contest').
        const isNc = status?.resultName?.toLowerCase().includes('no-contest') === true
        const correctedResult = isNc ? 'NC' : h.result
        const method =
          status?.resultMethod === 'KO_TKO'
            ? 'KO_TKO'
            : status?.resultMethod === 'SOUMISSION'
              ? 'SOUMISSION'
              : status?.resultMethod === 'DECISION'
                ? 'DECISION'
                : null
        fights.push({
          eventDate: h.eventDate,
          result: correctedResult as 'W' | 'L' | 'D' | 'NC',
          method: isNc ? null : method,
          period: status?.period ?? null,
        })
        const duration = status?.durationSeconds ?? null
        const ok =
          oppStats?.sigStrikesLanded != null &&
          oppStats?.sigStrikesAttempted != null &&
          duration != null &&
          duration > 0
        if (!ok) {
          fightsSkipped++
        } else {
          oppSigLanded += oppStats?.sigStrikesLanded ?? 0
          oppSigAttempted += oppStats?.sigStrikesAttempted ?? 0
          oppTdl += oppStats?.takedownsLanded ?? 0
          oppTda += oppStats?.takedownsAttempted ?? 0
          totalSeconds += duration as number
          fightsUsed++
        }
      } catch {
        fightsSkipped++
      }
      onProgress?.(i + 1, usable.length)
    }

    if (fightsUsed === 0 || totalSeconds === 0) {
      // Calcul tenté mais inexploitable (données ESPN absentes ou réseau) :
      // on marque l'échec pour ne pas re-tenter indéfiniment.
      markDerivedFailed(espnAthleteId)
      return null
    }

    const totalMinutes = totalSeconds / 60
    const result: DerivedResult = {
      windowSize: DERIVED_WINDOW,
      sigStrikesAbsorbedPerMin: round2(oppSigLanded / totalMinutes),
      strikingDefense: oppSigAttempted > 0 ? round2((1 - oppSigLanded / oppSigAttempted) * 100) : null,
      takedownDefense: oppTda > 0 ? round2((1 - oppTdl / oppTda) * 100) : null,
      avgFightSeconds: Math.round(totalSeconds / fightsUsed),
      fightsUsed,
      fightsSkipped,
      computedAt: new Date().toISOString(),
      fights,
    }
    writeDerivedCache(espnAthleteId, result)
    return result
  })()

  derivedInFlight.set(espnAthleteId, task)
  task.finally(() => derivedInFlight.delete(espnAthleteId)).catch(() => undefined)
  return task
}

// ---------------------------------------------------------------------------
// Tableau des données observées
// ---------------------------------------------------------------------------

function fmt(n: number | null | undefined, unit = '', digits = 2): string {
  if (n == null || !Number.isFinite(n)) return 'Non disponible'
  const v = digits === 0 ? String(Math.round(n)) : n.toFixed(digits).replace(/\.?0+$/, '')
  return `${v}${unit ? ` ${unit}` : ''}`
}

export function buildObservedTable(a: FighterView, b: FighterView): ObservedRow[] {
  const rows: ObservedRow[] = []
  const push = (label: string, va: string, vb: string, kind: ObservedRow['kind'], origin: string) =>
    rows.push({ label, valueA: va, valueB: vb, kind, origin })

  // Fiche
  push('Âge', a.age != null ? `${a.age} ans` : 'Non disponible', b.age != null ? `${b.age} ans` : 'Non disponible', 'bio', 'ESPN · fiche (âge calculé)')
  push('Taille', fmt(a.heightCm, 'cm', 1), fmt(b.heightCm, 'cm', 1), 'bio', 'ESPN · fiche (pouces → cm)')
  push('Allonge', fmt(a.reachCm, 'cm', 1), fmt(b.reachCm, 'cm', 1), 'bio', 'ESPN · fiche (pouces → cm)')
  push('Garde', a.stance ?? 'Non disponible', b.stance ?? 'Non disponible', 'bio', 'ESPN · fiche combattant')
  push('Catégorie', a.weightClass ?? 'Non disponible', b.weightClass ?? 'Non disponible', 'bio', 'ESPN · fiche combattant')

  // Palmarès
  push('Palmarès (V-D-N)',
    a.record.wins != null ? `${a.record.wins}-${a.record.losses ?? '?'}-${a.record.draws ?? '?'}` : 'Non disponible',
    b.record.wins != null ? `${b.record.wins}-${b.record.losses ?? '?'}-${b.record.draws ?? '?'}` : 'Non disponible',
    'record', 'ESPN · palmarès officiel')
  push('Combat sans décision', String(a.record.noContests ?? 'Non disponible'), String(b.record.noContests ?? 'Non disponible'), 'record', 'ESPN · palmarès officiel')
  push('Victoires par KO/TKO', String(a.record.winsByKo ?? 'Non disponible'), String(b.record.winsByKo ?? 'Non disponible'), 'record', 'ESPN · palmarès officiel')
  push('Victoires par soumission', String(a.record.winsBySub ?? 'Non disponible'), String(b.record.winsBySub ?? 'Non disponible'), 'record', 'ESPN · palmarès officiel')
  push('Forme (5 derniers)',
    a.lastResults.length ? formFr(a.lastResults) : 'Non disponible',
    b.lastResults.length ? formFr(b.lastResults) : 'Non disponible',
    'record', 'ESPN · historique des combats')

  // Stats de carrière
  const sA = a.stats
  const sB = b.stats
  const career = 'ESPN · stats de carrière'
  push('Frappes significatives portées / min', fmt(sA?.sigStrikesLandedPerMin), fmt(sB?.sigStrikesLandedPerMin), 'career', career)
  push('Précision des frappes', fmt(sA?.strikingAccuracy, '%', 1), fmt(sB?.strikingAccuracy, '%', 1), 'career', career)
  push('Takedowns réussis / 15 min', fmt(sA?.takedownsPer15Min), fmt(sB?.takedownsPer15Min), 'career', career)
  push('Précision des takedowns', fmt(sA?.takedownAccuracy, '%', 1), fmt(sB?.takedownAccuracy, '%', 1), 'career', career)
  push('Soumissions tentées / 15 min', fmt(sA?.submissionsPer15Min), fmt(sB?.submissionsPer15Min), 'career', career)

  // Dérivés
  const dA = a.derived
  const dB = b.derived
  const derivedLabel = `Calcul VOLTRIX · ${DERIVED_WINDOW} derniers combats (stats par combat ESPN)`
  push('Frappes significatives reçues / min', fmt(dA?.sigStrikesAbsorbedPerMin), fmt(dB?.sigStrikesAbsorbedPerMin), 'derived', derivedLabel)
  push('Défense contre les frappes', fmt(dA?.strikingDefense, '%', 1), fmt(dB?.strikingDefense, '%', 1), 'derived', derivedLabel)
  push('Défense contre les takedowns', fmt(dA?.takedownDefense, '%', 1), fmt(dB?.takedownDefense, '%', 1), 'derived', derivedLabel)
  push('Temps moyen de combat', dA?.avgFightSeconds != null ? formatDuration(dA.avgFightSeconds) : 'Non disponible', dB?.avgFightSeconds != null ? formatDuration(dB.avgFightSeconds) : 'Non disponible', 'derived', derivedLabel)
  return rows
}

/** Forme en notation française : V (victoire), N (nul), D (défaite), NC. */
export function formFr(results: string[]): string {
  const map: Record<string, string> = { W: 'V', L: 'D', D: 'N', NC: 'NC' }
  return results.map((r) => map[r] ?? r).join(' · ')
}

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

// ---------------------------------------------------------------------------
// Dimensions d'interprétation
// ---------------------------------------------------------------------------

/**
 * Indice relatif 0-100 entre deux valeurs observées.
 *
 * Audit 2026-11-09 (agent B, point A4) : l'ancienne normalisation x/(x+y)
 * transformait du bruit en signaux massifs (SLpM 0,1 vs 0,15 → 40/60 ;
 * TD 0 vs 0,5 → 0/100). Nouvelle règle, amortie et gardée :
 *  - score = 50 + 50·(x−y)/(x+y+ε) : l'écart est RAMENÉ à l'échelle réelle
 *    de la dimension (ε = plancher de bruit, calibré par dimension) ;
 *  - si les DEUX valeurs sont sous le plancher absolu `floor`, la dimension
 *    est déclarée indisponible : l'absence d'activité n'est pas une faiblesse
 *    (un pur striker sans takedown n'est pas « mauvais en lutte », c'est un
 *    style — l'indice ne doit pas le prétendre).
 */
function edge(
  a: number | null,
  b: number | null,
  lowerBetter = false,
  epsilon = 0,
  floor = 0
): { scoreA: number | null; scoreB: number | null; advantage: 'A' | 'B' | '=' | null } {
  if (a == null || b == null) return { scoreA: null, scoreB: null, advantage: null }
  if (floor > 0 && Math.max(a, b) < floor) {
    return { scoreA: null, scoreB: null, advantage: null }
  }
  if (a === 0 && b === 0) return { scoreA: 50, scoreB: 50, advantage: '=' }
  const [x, y] = lowerBetter ? [b, a] : [a, b]
  const denom = x + y + epsilon
  const shareX = denom <= 0 ? 50 : 50 + (50 * (x - y)) / denom
  const scoreA = lowerBetter ? 100 - shareX : shareX
  const scoreB = 100 - scoreA
  const advantage = Math.abs(scoreA - scoreB) < 6 ? '=' : scoreA > scoreB ? 'A' : 'B'
  return { scoreA: round2(scoreA), scoreB: round2(scoreB), advantage }
}

export function buildDimensions(a: FighterView, b: FighterView): DimensionScore[] {
  const dims: DimensionScore[] = []
  // Amortissement (ε) et plancher (floor) par dimension — valeurs calibrées
  // sur les échelles réelles des statistiques ESPN (audit 2026-11-09) :
  // ε ≈ l'écart typique sous lequel deux carrières ne se distinguent pas.
  const add = (
    key: string,
    label: string,
    va: number | null,
    vb: number | null,
    detail: (sa: number | null, sb: number | null) => string,
    basis: string,
    lowerBetter = false,
    damping: { epsilon?: number; floor?: number } = {}
  ) => {
    const e = edge(va, vb, lowerBetter, damping.epsilon ?? 0, damping.floor ?? 0)
    dims.push({
      key,
      label,
      scoreA: e.scoreA,
      scoreB: e.scoreB,
      advantage: e.advantage,
      detail: detail(va, vb),
      basis,
      available: e.advantage !== null,
    })
  }

  const career = 'Carrière (ESPN)'
  const derivedBasis = `${DERIVED_WINDOW} derniers combats (calculé)`

  add('forme', 'Forme récente', formScore(a.lastResults.join(',') || null), formScore(b.lastResults.join(',') || null),
    (x, y) => `Forme sur 5 combats : ${pct(x)} contre ${pct(y)}`, 'Historique (ESPN)')

  add('volume', 'Volume de frappes', a.stats?.sigStrikesLandedPerMin ?? null, b.stats?.sigStrikesLandedPerMin ?? null,
    (x, y) => `${fmt(x)} frappe(s) significative(s) par minute contre ${fmt(y)}`, career, false, { epsilon: 2 })

  add('precision', 'Précision des frappes', a.stats?.strikingAccuracy ?? null, b.stats?.strikingAccuracy ?? null,
    (x, y) => `Précision : ${fmt(x, '%', 1)} contre ${fmt(y, '%', 1)}`, career, false, { epsilon: 20 })

  add('absorption', 'Frappes absorbées', a.derived?.sigStrikesAbsorbedPerMin ?? null, b.derived?.sigStrikesAbsorbedPerMin ?? null,
    (x, y) => `${fmt(x)} frappe(s) reçue(s) par minute contre ${fmt(y)} (moins = mieux)`, derivedBasis, true, { epsilon: 2 })

  add('defense-frappes', 'Défense contre les frappes', a.derived?.strikingDefense ?? null, b.derived?.strikingDefense ?? null,
    (x, y) => `Défense : ${fmt(x, '%', 1)} contre ${fmt(y, '%', 1)}`, derivedBasis, false, { epsilon: 20 })

  add('lutte', 'Lutte (takedowns)', a.stats?.takedownsPer15Min ?? null, b.stats?.takedownsPer15Min ?? null,
    (x, y) => `${fmt(x)} takedown(s) par 15 min contre ${fmt(y)}`, career, false, { epsilon: 1.5, floor: 0.3 })

  add('defense-takedown', 'Défense contre les takedowns', a.derived?.takedownDefense ?? null, b.derived?.takedownDefense ?? null,
    (x, y) => `Défense : ${fmt(x, '%', 1)} contre ${fmt(y, '%', 1)}`, derivedBasis, false, { epsilon: 20 })

  add('sol', 'Soumissions', a.stats?.submissionsPer15Min ?? null, b.stats?.submissionsPer15Min ?? null,
    (x, y) => `${fmt(x)} soumission(s) tentée(s) par 15 min contre ${fmt(y)}`, career, false, { epsilon: 0.8, floor: 0.15 })

  add('puissance', 'Pouvoir de finition', a.stats ? (a.stats.koPercentage ?? 0) + (a.stats.tkoPercentage ?? 0) : null,
    b.stats ? (b.stats.koPercentage ?? 0) + (b.stats.tkoPercentage ?? 0) : null,
    (x, y) => `${fmt(x, '%', 1)} des combats finis par KO/TKO contre ${fmt(y, '%', 1)}`, career, false, { epsilon: 25 })

  add('experience', 'Expérience', a.totalFights, b.totalFights,
    (x, y) => `${x ?? '?'} combat(s) disputé(s) contre ${y ?? '?'}`, 'Palmarès (ESPN)', false, { epsilon: 6 })

  add('physique', 'Envergure physique',
    a.reachCm != null && b.reachCm != null ? a.reachCm : null,
    a.reachCm != null && b.reachCm != null ? b.reachCm : null,
    (x, y) => `Allonge : ${fmt(x, 'cm', 1)} contre ${fmt(y, 'cm', 1)}`, 'Fiche (ESPN)', false, { epsilon: 10 })

  return dims
}

function pct(x: number | null | undefined): string {
  if (x == null) return 'non disponible'
  return `${Math.round(x * 100)} %`
}

// ---------------------------------------------------------------------------
// Commentaires et limites
// ---------------------------------------------------------------------------

export function buildCommentary(a: FighterView, b: FighterView, dims: DimensionScore[], weightClass: string | null): CommentaryBlock[] {
  const blocks: CommentaryBlock[] = []
  const nameA = a.fullName
  const nameB = b.fullName

  const advA = dims.filter((d) => d.advantage === 'A')
  const advB = dims.filter((d) => d.advantage === 'B')
  blocks.push({
    title: 'Lecture d\'ensemble',
    text: `Sur les ${dims.filter((d) => d.available).length} dimensions comparables (sur ${dims.length}), ${nameA} présente un écart statistique favorable sur ${advA.length} et ${nameB} sur ${advB.length}${weightClass ? `, en ${weightClass}` : ''}. Ces écarts reflètent les données observées ci-dessus ; ils ne préjugent pas du déroulement du combat.`,
  })

  for (const d of dims) {
    if (!d.available || d.advantage === '=' || d.advantage === null) continue
    const winner = d.advantage === 'A' ? nameA : nameB
    const loser = d.advantage === 'A' ? nameB : nameA
    const score = d.advantage === 'A' ? d.scoreA : d.scoreB
    blocks.push({
      title: d.label,
      text: `${d.detail}. Selon les données observées (${d.basis.toLowerCase()}), avantage statistique à ${winner} (indice relatif ${Math.round(score ?? 0)}/100). Cet écart est une lecture descriptive, pas une prédiction — l'adversaire ${loser} conserve des axes de jeu identifiés dans le tableau détaillé.`,
    })
  }

  const styleA = a.fightingStyle ?? 'style non documenté'
  const styleB = b.fightingStyle ?? 'style non documenté'
  const stanceA = a.stance ?? 'garde non documentée'
  const stanceB = b.stance ?? 'garde non documentée'
  blocks.push({
    title: 'Analyse des styles',
    text: `${nameA} est répertorié « ${styleA} » (${stanceA}) ; ${nameB} « ${styleB} » (${stanceB}). ${
      a.stance && b.stance && a.stance !== b.stance
        ? 'La différence de garde (orthodoxe contre gaucher ou alterné) produit classiquement des angles d\'attaque inhabituels pour les deux combattants.'
        : 'Les gardes identiques ou non documentées réduisent cet effet d\'angle.'
    } ${a.totalFights != null && b.totalFights != null && Math.abs(a.totalFights - b.totalFights) > 8 ? `L'écart d'expérience (${a.totalFights} contre ${b.totalFights} combats) peut influer sur la gestion des phases critiques.` : 'Les expériences sont comparables.'}`,
  })
  return blocks
}

export function buildLimitations(a: FighterView, b: FighterView): string[] {
  const lim: string[] = []
  const missingFor = (f: FighterView): string[] => {
    const m: string[] = []
    if (!f.stats) m.push('statistiques de carrière')
    if (!f.derived) m.push(`indicateurs calculés (fenêtre ${DERIVED_WINDOW} combats)`)
    if (f.age == null) m.push('date de naissance')
    if (f.reachCm == null) m.push('allonge')
    if (f.heightCm == null) m.push('taille')
    if (f.lastResults.length === 0) m.push('forme récente')
    return m
  }
  for (const f of [a, b]) {
    const m = missingFor(f)
    if (m.length) lim.push(`${f.fullName} : données non disponibles chez la source — ${m.join(', ')}.`)
  }
  if (a.derived && a.derived.fightsUsed < DERIVED_WINDOW) {
    lim.push(`${a.fullName} : indicateurs calculés sur ${a.derived.fightsUsed} combats seulement (fenêtre cible ${DERIVED_WINDOW}).`)
  }
  if (b.derived && b.derived.fightsUsed < DERIVED_WINDOW) {
    lim.push(`${b.fullName} : indicateurs calculés sur ${b.derived.fightsUsed} combats seulement (fenêtre cible ${DERIVED_WINDOW}).`)
  }
  lim.push('Les indices relatifs par dimension (0-100) comparent les deux combattants entre eux ; la probabilité du pronostic agrège ces dimensions dans un modèle pondéré distinct.')
  lim.push('Le pronostic est une estimation statistique bornée (25-75 %), pas une certitude ; aucune cote n\'est éditée.')
  return lim
}

export function buildSources(a: FighterView, b: FighterView, eventName: string): FightAnalysis['sources'] {
  const now = new Date().toISOString()
  const src: FightAnalysis['sources'] = []
  src.push({
    name: 'ESPN — carte de l\'événement',
    url: null,
    detail: `Événement « ${eventName} » : combats, statuts, palmarès affichés`,
    syncedAt: now,
  })
  for (const f of [a, b]) {
    if (f.sourceUrl) {
      src.push({
        name: `ESPN — fiche ${f.fullName}`,
        url: f.sourceUrl,
        detail: 'Fiche combattant : biographie, palmarès, statistiques de carrière',
        syncedAt: f.lastSyncedAt,
      })
    }
    if (f.derived) {
      src.push({
        name: `VOLTRIX — calcul ${f.fullName}`,
        url: null,
        detail: `Frappes reçues/minute, défenses et temps moyen calculés sur ${f.derived.fightsUsed} combats terminés (stats par combat ESPN)`,
        syncedAt: f.derived.computedAt,
      })
    }
  }
  return src
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100
}

// Ré-export pratique pour les loaders.
export { computePrediction }
