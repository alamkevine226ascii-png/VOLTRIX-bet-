/**
 * VOLTRIX — Modèle de rounds personnalisé (UFC).
 *
 * Remplace les constantes codées en dur (40/33/27 % et 33/28/21/12/6 %) :
 * l'ancienne note de modèle affirmait faussement qu'« ESPN ne publie pas
 * le round de fin des combats passés » — audit 2026-11-09 : `status.period`
 * le publie pour tous les combats terminés (fins ET décisions).
 *
 * Deux briques, zéro donnée inventée :
 *
 * 1. PRIOR UFC CALCULÉ (`fetchUfcRoundPrior`) : scan des 6 derniers
 *    événements UFC terminés ; pour chaque combat, le détail (format
 *    3 ou 5 rounds) et le statut (round de fin, méthode) d'ESPN. La
 *    distribution agrégée des fins par round + part des décisions, par
 *    format, est mise en cache localStorage 7 jours. Ces mêmes statuts
 *    sont réutilisés par le calcul des indicateurs dérivés (clés de
 *    cache partagées) : au second passage, le scan ne coûte presque rien.
 *
 * 2. TAUX PERSONNALISÉS (`personalRoundRates`) : les victoires du
 *    combattant (issues de sa fenêtre dérivée, rounds de fin réels)
 *    sont fondues avec le prior par rétrécissement de type Dirichlet
 *    (n0 = 6 pseudo-victoires). Moins de 3 victoires documentées →
 *    le taux rejoint le prior, et l'étiquette l'indique honnêtement.
 */
import { getCompetitionDetail, getCompetitionStatus, getScoreboard, mapLimited } from './espn'
import { persistGet, persistSet } from '../persist'
import type { DerivedResult } from './analysis'

const PRIOR_KEY = 'voltrix:rounds:prior:v1'
const PRIOR_TTL = 7 * 24 * 60 * 60 * 1000
/** Nombre d'événements UFC terminés scannés pour le prior. */
const PRIOR_EVENTS = 6
/** Pseudo-victoires du rétrécissement bayésien (force du prior). */
export const SHRINK_N0 = 6

export interface RoundPrior {
  /** Format à 3 rounds : parts des fins par round [R1, R2, R3] + décision. */
  prior3: { finishByRound: number[]; decisionShare: number }
  /** Format à 5 rounds : parts des fins par round [R1..R5] + décision. */
  prior5: { finishByRound: number[]; decisionShare: number }
  fightsSampled: number
  eventsSampled: string[]
  computedAt: string
}

export interface PersonalRoundRates {
  /** P(victoire de ce combattant finie au round r) — parts par round. */
  finishByRound: number[]
  /** P(victoire de ce combattant aux points). */
  decisionShare: number
  /** Victoires documentées réellement observées dans la fenêtre. */
  documentedWins: number
  /** Part du prior dans le résultat (0 = 100 % observé, 1 = 100 % prior). */
  priorWeight: number
  basis: 'combattant' | 'prior UFC'
}

/** Lecture du prior en cache (7 jours) sans déclencher de scan. */
export function peekRoundPrior(): RoundPrior | null {
  const raw = persistGet<RoundPrior>(PRIOR_KEY)
  if (!raw || !raw.prior3 || !raw.prior5) return null
  return raw
}

/**
 * Prior UFC : distribution des fins par round (et part des décisions),
 * par format de combat, calculée sur les 6 derniers événements terminés.
 */
export async function fetchUfcRoundPrior(): Promise<RoundPrior | null> {
  const cached = peekRoundPrior()
  if (cached) return cached

  const now = new Date()
  const from = new Date(now.getTime() - 120 * 86400000)
  const to = new Date(now.getTime() - 2 * 86400000) // événements passés seulement
  const events = await getScoreboard('UFC', from, to).catch(() => [])
  const done = events
    .filter((e) => e.status === 'TERMINE')
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, PRIOR_EVENTS)

  const finish3 = [0, 0, 0]
  let dec3 = 0
  const finish5 = [0, 0, 0, 0, 0]
  let dec5 = 0
  let sampled = 0
  const eventNames: string[] = []

  for (const ev of done) {
    eventNames.push(ev.name)
    await mapLimited(ev.fights, 3, async (f) => {
      const detail = await getCompetitionDetail(ev.league, ev.espnEventId, f.espnCompetitionId).catch(() => null)
      const status = await getCompetitionStatus(ev.league, ev.espnEventId, f.espnCompetitionId).catch(() => null)
      if (!detail || !status || f.status !== 'TERMINE') return
      const rounds = detail.scheduledRounds === 5 ? 5 : detail.scheduledRounds === 3 ? 3 : null
      const period = status.period
      if (rounds == null || period == null || period < 1) return
      if (status.resultName?.toLowerCase().includes('no-contest')) return
      sampled++
      if (status.resultMethod === 'DECISION') {
        if (rounds === 5) dec5++
        else dec3++
      } else if (period <= rounds) {
        if (rounds === 5) finish5[period - 1]++
        else finish3[Math.min(period, 3) - 1]++
      }
    })
  }

  if (sampled < 20) return null // échantillon insuffisant : pas de prior fabriqué

  const total3 = finish3.reduce((a, b) => a + b, 0) + dec3
  const total5 = finish5.reduce((a, b) => a + b, 0) + dec5
  if (total3 < 8 || total5 < 4) return null

  const prior: RoundPrior = {
    prior3: {
      finishByRound: finish3.map((n) => n / total3),
      decisionShare: dec3 / total3,
    },
    prior5: {
      finishByRound: finish5.map((n) => n / total5),
      decisionShare: dec5 / total5,
    },
    fightsSampled: sampled,
    eventsSampled: eventNames,
    computedAt: new Date().toISOString(),
  }
  persistSet(PRIOR_KEY, prior, PRIOR_TTL)
  return prior
}

/**
 * Taux personnalisés d'un combattant : victoires par round de fin (réels,
 * fenêtre dérivée) fondues avec le prior UFC par rétrécissement.
 *
 * @param fights    fenêtre dérivée du combattant (résultats corrigés NC)
 * @param prior     prior UFC (format correspondant au combat à prédire)
 * @param rounds    rounds prévus du combat à prédire (3 ou 5)
 */
export function personalRoundRates(
  fights: DerivedResult['fights'] | null | undefined,
  prior: RoundPrior | null,
  rounds: 3 | 5
): PersonalRoundRates | null {
  const p = rounds === 5 ? prior?.prior5 : prior?.prior3
  const finishPrior = p?.finishByRound ?? null
  const decisionPrior = p?.decisionShare ?? null

  // Victoires documentées avec round de fin connu (fins) ou méthode
  // décision (le round d'une décision = rounds prévus, sans intérêt ici).
  const winsFinish: number[] = new Array(rounds).fill(0)
  let winsDecision = 0
  for (const f of fights ?? []) {
    if (f.result !== 'W') continue
    if (f.method === 'DECISION') winsDecision++
    else if (f.method != null && f.period != null && f.period >= 1 && f.period <= rounds) {
      winsFinish[f.period - 1]++
    }
  }
  const documentedWins = winsFinish.reduce((a, b) => a + b, 0) + winsDecision

  // Sans prior disponible : uniquement l'observé, à condition d'être
  // suffisamment documenté (sinon pas de modèle du tout).
  if (!finishPrior || decisionPrior == null) {
    if (documentedWins < 5) return null
    const total = documentedWins
    return {
      finishByRound: winsFinish.map((n) => n / total),
      decisionShare: winsDecision / total,
      documentedWins,
      priorWeight: 0,
      basis: 'combattant',
    }
  }

  // Rétrécissement de type Dirichlet vers le prior (n0 pseudo-victoires).
  const n0 = SHRINK_N0
  const mix = (observed: number, priorShare: number) =>
    (n0 * priorShare + observed) / (n0 + documentedWins)
  const finishByRound = winsFinish.map((n, i) => mix(n, finishPrior[i] ?? 0))
  const decisionShare = mix(winsDecision, decisionPrior)
  return {
    finishByRound,
    decisionShare,
    documentedWins,
    priorWeight: documentedWins > 0 ? n0 / (n0 + documentedWins) : 1,
    basis: documentedWins >= 3 ? 'combattant' : 'prior UFC',
  }
}

/**
 * Fusion des deux combattants en distribution du combat :
 *   P(fini au round r) = pA·rateA[r] + pB·rateB[r]
 *   P(décision)        = pA·decA    + pB·decB
 * La somme vaut exactement 1 (chaque rate somme à 1 par construction).
 */
export function fuseRoundDistribution(
  pA: number,
  ratesA: PersonalRoundRates | null,
  pB: number,
  ratesB: PersonalRoundRates | null,
  rounds: 3 | 5
): { finishByRound: number[]; decisionShare: number } | null {
  if (!ratesA && !ratesB) return null
  const out: number[] = new Array(rounds).fill(0)
  let decision = 0
  for (const [p, rates] of [
    [pA, ratesA],
    [pB, ratesB],
  ] as const) {
    if (!rates) continue
    for (let r = 0; r < rounds; r++) {
      out[r] += p * (rates.finishByRound[r] ?? 0)
    }
    decision += p * rates.decisionShare
  }
  return { finishByRound: out, decisionShare: decision }
}
