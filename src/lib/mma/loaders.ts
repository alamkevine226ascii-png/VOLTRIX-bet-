/**
 * VOLTRIX — Loaders côté navigateur.
 *
 * Ces fonctions assemblent, à partir des endpoints ESPN appelés directement
 * par le navigateur, les mêmes formes de données que l'ancienne API serveur.
 * L'interface n'a donc pas changé : seule la source de données a changé.
 */
import {
  ACTIVE_ORGS,
  getAthlete,
  getAthleteHistory,
  getAthleteRecord,
  getAthleteStats,
  getCompetitionDetail,
  getScoreboard,
  mapLimited,
  type ScoreboardEventDTO,
  type FightDetailDTO,
} from './espn'
import {
  buildCommentary,
  buildDimensions,
  buildLimitations,
  buildObservedTable,
  buildSources,
  computeDerivedStats,
  hasDerivedFailed,
  peekDerivedCache,
  toFighterView,
  type FightAnalysis,
  type FighterBundle,
  type FighterView,
} from './analysis'
import { computePrediction } from './prediction'
import {
  computeExpressPrediction,
  type ExpressPredictionView,
} from './prediction'
import {
  isPlaceholderFighter,
  normalizeName,
  parseRecord,
  weightClassFr,
} from './types'

// ---------------------------------------------------------------------------
// Contexte de navigation (état React entre vues)
// ---------------------------------------------------------------------------

export interface FightContext {
  espnEventId: string
  espnCompetitionId: string
  league: string
  event: {
    id: string
    name: string
    organization: string
    date: string
    venue: string | null
    city: string | null
    country: string | null
  }
  fight?: {
    weightClass: string | null
    scheduledRounds: number | null
    cardSegment: string | null
    status: string
    resultMethod: string | null
    resultDetail: string | null
    durationSeconds: number | null
  }
  fighters: {
    espnAthleteId: string
    fullName: string
    recordAtFight: string | null
    isWinner: boolean | null
  }[]
}

// ---------------------------------------------------------------------------
// Liste des événements (Accueil)
// ---------------------------------------------------------------------------

export interface MmaEventListItem {
  id: string
  name: string
  shortName: string | null
  organization: string
  date: string
  status: string
  venue: string | null
  city: string | null
  country: string | null
  fightsCount: number
  mainEvent: string | null
  detailsSynced: boolean
  lastSyncedAt: string
}

export interface MmaEventsResponse {
  events: MmaEventListItem[]
  /** DTO complets (combats, identifiants) pour la navigation vers les vues détail. */
  dtos: ScoreboardEventDTO[]
  lastSyncAt: string | null
  syncStatus: string | null
}

/** Tête d'affiche déduite du nom de l'événement (« UFC 334: Gane vs. Hokit »). */
function mainEventFromName(event: ScoreboardEventDTO): string | null {
  const m = event.name.match(/:\s*(.+?)\s+(?:vs\.?|v)\s+(.+)$/i)
  if (m) {
    const lastA = normalizeName(m[1]).split(' ').pop() ?? ''
    const lastB = normalizeName(m[2]).split(' ').pop() ?? ''
    const match = event.fights.find((f) => {
      const names = f.fighters.map((x) => normalizeName(x.fullName))
      return (
        names.length === 2 &&
        names.every((n) => !isPlaceholderFighter(n)) &&
        names.some((n) => n.endsWith(lastA)) &&
        names.some((n) => n.endsWith(lastB))
      )
    })
    if (match) {
      const [x, y] = match.fighters
      return `${x.fullName} vs. ${y.fullName}`
    }
  }
  const first = event.fights.find((f) => f.fighters.length === 2 && !f.fighters.some((x) => isPlaceholderFighter(x.fullName)))
  if (first) return `${first.fighters[0].fullName} vs. ${first.fighters[1].fullName}`
  return null
}

/**
 * Charge la liste des événements (à venir ou passés) pour les organisations
 * actives. Appels directs au scoreboard ESPN, mis en cache 10 min.
 */
export async function loadEvents(window: 'upcoming' | 'past'): Promise<MmaEventsResponse> {
  const now = new Date()
  const from = window === 'upcoming' ? startOfUtcDay(now) : new Date(now.getTime() - 60 * 86400000)
  const to = window === 'upcoming' ? new Date(now.getTime() + 120 * 86400000) : endOfUtcDay(now)

  const events: ScoreboardEventDTO[] = []
  let orgFailures = 0
  for (const org of ACTIVE_ORGS) {
    try {
      events.push(...(await getScoreboard(org, from, to)))
    } catch {
      orgFailures++
    }
  }

  // Toutes les organisations ont échoué : c'est une erreur réseau, pas une
  // absence d'événements — on la remonte pour afficher le bouton Réessayer.
  if (orgFailures === ACTIVE_ORGS.length) {
    throw new Error(
      'Impossible de joindre les serveurs ESPN depuis votre navigateur (réseau indisponible ou temporairement bloqué). Réessayez dans un instant.'
    )
  }

  const filtered = events.filter((e) => {
    const date = new Date(e.date).getTime()
    if (window === 'upcoming') return date >= startOfUtcDay(now).getTime() && e.status !== 'TERMINE'
    return e.status === 'TERMINE' || date < startOfUtcDay(now).getTime()
  })

  filtered.sort((a, b) => {
    const d = new Date(a.date).getTime() - new Date(b.date).getTime()
    return window === 'upcoming' ? d : -d
  })

  return {
    events: filtered.map((e) => ({
      id: e.externalId,
      name: e.name,
      shortName: e.shortName,
      organization: e.organization,
      date: e.date,
      status: e.status,
      venue: e.venueName,
      city: e.city,
      country: e.country,
      fightsCount: e.fights.length,
      mainEvent: mainEventFromName(e),
      detailsSynced: false,
      lastSyncedAt: new Date().toISOString(),
    })),
    dtos: filtered,
    lastSyncAt: new Date().toISOString(),
    syncStatus: null,
  }
}

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}
function endOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59))
}

// ---------------------------------------------------------------------------
// Carte d'un événement
// ---------------------------------------------------------------------------

export interface MmaEventFighter {
  id: string
  externalId: string
  espnAthleteId: string
  fullName: string
  nickname: string | null
  imageUrl: string | null
  flagUrl: string | null
  recordAtFight: string | null
  wins: number | null
  losses: number | null
  draws: number | null
  lastResults: string | null
  isWinner: boolean | null
  profileSynced: boolean
}

export interface MmaEventFight {
  id: string
  espnCompetitionId: string
  weightClass: string | null
  weightClassFr: string | null
  scheduledRounds: number | null
  cardSegment: string | null
  matchNumber: number | null
  status: string
  resultMethod: string | null
  resultDetail: string | null
  durationSeconds: number | null
  winnerExternalId: string | null
  expressPrediction: ExpressPredictionView | null
  fighters: MmaEventFighter[]
}

export interface MmaEventDetail {
  id: string
  espnEventId: string
  league: string
  name: string
  shortName: string | null
  organization: string
  date: string
  status: string
  venue: string | null
  city: string | null
  country: string | null
  lastSyncedAt: string
  fights: MmaEventFight[]
}

/**
 * Charge la carte complète d'un événement : détails de chaque combat
 * (catégorie, rounds, segment, résultat) depuis l'API core ESPN.
 */
export async function loadEventDetail(event: ScoreboardEventDTO): Promise<MmaEventDetail> {
  const details = await mapLimited(event.fights, 4, (f) =>
    getCompetitionDetail(event.league, event.espnEventId, f.espnCompetitionId).catch(() => null)
  )

  const fights: MmaEventFight[] = event.fights.map((f, i) => {
    const d = details[i]
    const fighters: MmaEventFighter[] = f.fighters.map((x) => {
      const rec = parseRecord(x.recordAtFight)
      return {
        id: x.externalId,
        externalId: x.externalId,
        espnAthleteId: x.espnAthleteId,
        fullName: x.fullName,
        nickname: null,
        imageUrl: null,
        flagUrl: null,
        recordAtFight: x.recordAtFight,
        wins: rec?.wins ?? null,
        losses: rec?.losses ?? null,
        draws: rec?.draws ?? null,
        lastResults: null,
        isWinner: x.isWinner,
        profileSynced: true,
      }
    })
    const winner = f.fighters.find((x) => x.isWinner === true)
    // Règle VOLTRIX : un combat PROGRAMME passe à CONFIRME quand sa catégorie
    // est connue et ses deux combattants identifiés.
    const complete = d?.weightClass != null && fighters.length === 2
    const status = f.status === 'PROGRAMME' && complete ? 'CONFIRME' : (d?.status ?? f.status)
    const express =
      status === 'TERMINE' || fighters.length !== 2
        ? null
        : computeExpressPrediction(fighters[0], fighters[1])
    return {
      id: f.externalId,
      espnCompetitionId: f.espnCompetitionId,
      weightClass: d?.weightClass ?? null,
      weightClassFr: weightClassFr(d?.weightClass) ?? null,
      scheduledRounds: d?.scheduledRounds ?? null,
      cardSegment: d?.cardSegment ?? null,
      matchNumber: d?.matchNumber ?? null,
      status,
      resultMethod: d?.resultMethod ?? null,
      resultDetail: d?.resultDetail ?? null,
      durationSeconds: d?.durationSeconds ?? null,
      winnerExternalId: winner?.externalId ?? null,
      expressPrediction: express,
      fighters,
    }
  })

  return {
    id: event.externalId,
    espnEventId: event.espnEventId,
    league: event.league,
    name: event.name,
    shortName: event.shortName,
    organization: event.organization,
    date: event.date,
    status: event.status,
    venue: event.venueName,
    city: event.city,
    country: event.country,
    lastSyncedAt: new Date().toISOString(),
    fights,
  }
}

/**
 * Enrichissement progressif de la carte : formes récentes des combattants
 * (une requête d'historique par combattant, en cache) puis pronostics
 * express recalculés sur « palmarès + forme ».
 */
export async function enhanceEventWithForms(detail: MmaEventDetail): Promise<MmaEventDetail> {
  const ids = new Set<string>()
  for (const f of detail.fights) for (const x of f.fighters) ids.add(x.espnAthleteId)
  const uniqueIds = [...ids]

  const histories = await mapLimited(uniqueIds, 3, async (id) => {
    try {
      const h = await getAthleteHistory(id)
      const sorted = [...h].sort((a, b) => new Date(b.eventDate).getTime() - new Date(a.eventDate).getTime())
      const last = sorted
        .filter((x) => ['W', 'L', 'D', 'NC'].includes(x.result))
        .slice(0, 5)
        .map((x) => x.result)
        .join(',')
      return [id, last || null] as const
    } catch {
      return [id, null] as const
    }
  })
  const formById = new Map(histories)

  const fights = detail.fights.map((f) => {
    const fighters = f.fighters.map((x) => ({
      ...x,
      lastResults: formById.get(x.espnAthleteId) ?? null,
    }))
    const express =
      f.status === 'TERMINE' || fighters.length !== 2
        ? null
        : computeExpressPrediction(fighters[0], fighters[1])
    return { ...f, fighters, expressPrediction: express }
  })

  return { ...detail, fights }
}

// ---------------------------------------------------------------------------
// Analyse complète d'un combat (page combat)
// ---------------------------------------------------------------------------

async function loadFighterBundle(espnAthleteId: string): Promise<FighterBundle> {
  const [profile, stats, record, history] = await Promise.all([
    getAthlete(espnAthleteId).catch(() => null),
    getAthleteStats(espnAthleteId).catch(() => null),
    getAthleteRecord(espnAthleteId).catch(() => null),
    getAthleteHistory(espnAthleteId).catch(() => [] as never),
  ])
  return { profile, stats, record, history: history ?? [], derived: peekDerivedCache(espnAthleteId) }
}

/**
 * Charge l'analyse complète d'un combat : fiches des deux combattants,
 * statistiques, historique, dimensions, pronostic, sources.
 * Les indicateurs avancés (dérivés) sont inclus s'ils sont déjà en cache ;
 * sinon leur calcul est lancé en arrière-plan et derivedPending=true invite
 * l'interface à recharger.
 */
export async function loadFightAnalysis(ctx: FightContext): Promise<FightAnalysis> {
  if (ctx.fighters.length !== 2) {
    throw new Error('Combat incomplet : combattants manquants')
  }

  const detail: FightDetailDTO | null =
    ctx.fight != null
      ? {
          externalId: `espn:competition:${ctx.espnCompetitionId}`,
          weightClass: ctx.fight.weightClass,
          scheduledRounds: ctx.fight.scheduledRounds,
          cardSegment: ctx.fight.cardSegment,
          matchNumber: null,
          status: ctx.fight.status,
          rawStatus: null,
          durationSeconds: ctx.fight.durationSeconds,
          resultMethod: ctx.fight.resultMethod,
          resultDetail: ctx.fight.resultDetail,
          winnerExternalId: null,
        }
      : await getCompetitionDetail(ctx.league, ctx.espnEventId, ctx.espnCompetitionId)

  const [bundleA, bundleB] = await Promise.all([
    loadFighterBundle(ctx.fighters[0].espnAthleteId),
    loadFighterBundle(ctx.fighters[1].espnAthleteId),
  ])

  const viewA = toFighterView(bundleA)
  const viewB = toFighterView(bundleB)

  // Lancement (ou reprise) du calcul des indicateurs avancés en arrière-plan,
  // séquentiellement pour rester discret vis-à-vis de l'API. Un calcul déjà
  // tenté sans résultat (marqueur négatif) n'est pas relancé.
  const needDerived = [bundleA, bundleB].filter(
    (b) => b.stats != null && b.derived == null && b.history.length > 0 && !hasDerivedFailed(b.profile?.espnAthleteId ?? '')
  )
  if (needDerived.length > 0) {
    void (async () => {
      for (const b of needDerived) {
        const id = b.profile?.espnAthleteId
        if (id) await computeDerivedStats(id, b.history).catch(() => null)
      }
    })()
  }

  const observed = buildObservedTable(viewA, viewB)
  const dimensions = buildDimensions(viewA, viewB)
  const radar = dimensions
    .filter((d) => d.available && ['volume', 'precision', 'absorption', 'lutte', 'sol', 'forme'].includes(d.key))
    .map((d) => ({ dimension: d.label, A: d.scoreA, B: d.scoreB }))
  const prediction = computePrediction(viewA, viewB, dimensions)

  const winnerExternalId =
    ctx.fighters.find((x) => x.isWinner === true)?.espnAthleteId != null
      ? `espn:athlete:${ctx.fighters.find((x) => x.isWinner === true)!.espnAthleteId}`
      : null

  const fightStatus = detail?.status ?? 'PROGRAMME'

  return {
    fight: {
      id: `espn:competition:${ctx.espnCompetitionId}`,
      status: fightStatus,
      weightClass: detail?.weightClass ?? null,
      scheduledRounds: detail?.scheduledRounds ?? null,
      cardSegment: detail?.cardSegment ?? null,
      resultMethod: fightStatus === 'TERMINE' ? (detail?.resultMethod ?? null) : null,
      resultDetail: fightStatus === 'TERMINE' ? (detail?.resultDetail ?? null) : null,
      winner: winnerExternalId,
    },
    event: {
      id: ctx.event.id,
      name: ctx.event.name,
      organization: ctx.event.organization,
      date: ctx.event.date,
      venue: ctx.event.venue,
      city: ctx.event.city,
      country: ctx.event.country,
    },
    fighters: [viewA, viewB],
    observed,
    dimensions,
    radar,
    commentary: buildCommentary(viewA, viewB, dimensions, detail?.weightClass ?? null),
    prediction,
    limitations: buildLimitations(viewA, viewB),
    sources: buildSources(viewA, viewB, ctx.event.name),
    derivedPending: needDerived.length > 0,
  }
}

// ---------------------------------------------------------------------------
// Vérification du modèle (Paramètres) — backtest navigateur borné
// ---------------------------------------------------------------------------

export interface ModelCheckRow {
  eventName: string | null
  fighterA: string
  fighterB: string
  predictedFavorite: string
  probability: number
  actualWinner: string
  correct: boolean
  confidence: string
}

export interface ModelCheckResult {
  model: string
  analyzed: number
  correct: number
  accuracyPct: number | null
  rows: ModelCheckRow[]
  skipped: number
  notes: string[]
}

/**
 * Vérification publique du modèle : recalcul du pronostic sur les combats
 * terminés des derniers événements passés, confronté aux vainqueurs réels.
 * Le résultat est publié tel quel, y compris s'il est défavorable.
 */
export async function runModelCheck(
  onProgress?: (done: number, total: number, row: ModelCheckRow | null) => void
): Promise<ModelCheckResult> {
  const { MODEL_VERSION, P_MIN, P_MAX } = await import('./prediction')

  const now = new Date()
  const from = new Date(now.getTime() - 60 * 86400000)
  const pastEvents: ScoreboardEventDTO[] = []
  // Directive produit : vérification du modèle sur l'UFC uniquement.
  for (const org of ['UFC']) {
    try {
      const evts = (await getScoreboard(org, from, endOfUtcDay(now)))
        .filter((e) => e.status === 'TERMINE')
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      pastEvents.push(...evts)
    } catch {
      /* organisation indisponible : on continue */
    }
  }
  pastEvents.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

  // Jusqu'à 3 événements terminés, 12 combats analysables maximum.
  const candidates: { event: ScoreboardEventDTO; fight: ScoreboardEventDTO['fights'][number] }[] = []
  for (const e of pastEvents.slice(0, 3)) {
    for (const f of e.fights) {
      if (candidates.length >= 12) break
      const winner = f.fighters.find((x) => x.isWinner === true)
      const both = f.fighters.length === 2 && !f.fighters.some((x) => isPlaceholderFighter(x.fullName))
      if (f.status === 'TERMINE' && both && winner) candidates.push({ event: e, fight: f })
    }
    if (candidates.length >= 12) break
  }

  const rows: ModelCheckRow[] = []
  let skipped = 0
  for (let i = 0; i < candidates.length; i++) {
    const { event, fight } = candidates[i]
    onProgress?.(i, candidates.length, null)
    try {
      const [bundleA, bundleB] = await Promise.all([
        loadFighterBundle(fight.fighters[0].espnAthleteId),
        loadFighterBundle(fight.fighters[1].espnAthleteId),
      ])
      const viewA: FighterView = toFighterView(bundleA)
      const viewB: FighterView = toFighterView(bundleB)
      const dims = buildDimensions(viewA, viewB)
      const p = computePrediction(viewA, viewB, dims)
      if (!p.available || p.favorite == null) {
        skipped++
      } else {
        const winnerExternalId = `espn:athlete:${fight.fighters.find((x) => x.isWinner === true)!.espnAthleteId}`
        rows.push({
          eventName: event.name,
          fighterA: viewA.fullName,
          fighterB: viewB.fullName,
          predictedFavorite: p.favoriteName ?? '?',
          probability: p.favorite === 'A' ? (p.probabilityA as number) : (p.probabilityB as number),
          actualWinner:
            winnerExternalId === viewA.externalId ? viewA.fullName : viewB.fullName,
          correct: p.favoriteExternalId === winnerExternalId,
          confidence: p.confidence?.label ?? 'n/d',
        })
      }
    } catch {
      skipped++
    }
    onProgress?.(i + 1, candidates.length, rows[rows.length - 1] ?? null)
  }

  const analyzed = rows.length
  const correct = rows.filter((r) => r.correct).length
  return {
    model: MODEL_VERSION,
    analyzed,
    correct,
    accuracyPct: analyzed > 0 ? Math.round((correct / analyzed) * 100) : null,
    rows,
    skipped,
    notes: [
      'Vérification exécutée dans votre navigateur sur les combats terminés des derniers événements passés (données ESPN appelées en direct).',
      'Biais de recul : les statistiques de carrière utilisées sont celles connues aujourd\'hui, pas celles au moment du combat — le taux est indicatif.',
      'Cette vérification n\'inclut pas les indicateurs avancés calculés (fenêtre 8 combats) : elle repose sur les dimensions de carrière, de palmarès et de forme.',
      `Les probabilités du modèle restent bornées entre ${P_MIN} % et ${P_MAX} % ; aucun conseil de paris n'est fourni.`,
    ],
  }
}
