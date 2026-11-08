/**
 * VOLTRIX — Moteur de pronostics (portage 100 % frontend, fonctions pures).
 *
 * Un pronostic FIABLE et CLAIR :
 *  1. fondé uniquement sur des données réellement observées (ESPN + calculs
 *     étiquetés) — jamais de valeurs inventées ou extrapolées ;
 *  2. explicite : chaque dimension utilisée est listée avec son poids ;
 *  3. honnête : probabilités bornées (25-75 %) ; combat trop serré -> indécis ;
 *  4. refusé si les données sont insuffisantes (< 3 dimensions comparables) ;
 *  5. informatif : aucune cote, aucun conseil de paris.
 *
 * Modèle voltrix-mma-v1 : agrégation pondérée d'indices relatifs 0-100 par
 * dimension, transformation logistique, bornage.
 */
import type { DimensionScore, FighterView } from './analysis'
import { formScore, parseRecord } from './types'

export const MODEL_VERSION = 'voltrix-mma-v1'

/** Bornes de probabilité : au-delà, le modèle mentirait sur sa précision. */
export const P_MIN = 25
export const P_MAX = 75

/** Pente de la logistique. */
const K_LOGISTIC = 2.6

/** Dimensions minimales pour émettre un pronostic. */
const MIN_DIMENSIONS = 3

/** Dimensions « cœur » : celles qui portent l'essentiel du pronostic. */
const CORE_DIMENSIONS = ['forme', 'volume', 'precision', 'absorption', 'lutte', 'puissance']

/**
 * Poids des dimensions — publics et affichés dans l'interface.
 * Justification : les échanges debout décident la majorité des combats
 * (volume + précision + absorption), la forme récente est le meilleur signal
 * simple disponible, la lutte conditionne le choix du terrain.
 */
export const DIMENSION_WEIGHTS: Record<string, number> = {
  forme: 1.5,
  volume: 1.2,
  precision: 1.2,
  absorption: 1.2,
  'defense-frappes': 1.0,
  lutte: 1.0,
  'defense-takedown': 1.0,
  sol: 0.8,
  puissance: 1.0,
  experience: 0.8,
  physique: 0.6,
}

// ---------------------------------------------------------------------------
// Types de sortie
// ---------------------------------------------------------------------------

export interface PredictionFactor {
  key: string
  label: string
  weight: number
  scoreA: number
  scoreB: number
  edge: number
}

export interface PredictionConfidence {
  score: number
  label: 'Bonne' | 'Moyenne' | 'Limitée'
  dimensionsUsed: number
  dimensionsTotal: number
  missing: string[]
}

export interface PredictionMethod {
  label: 'KO/TKO' | 'Soumission' | 'Décision'
  share: number | null
  detail: string
}

export interface PredictionView {
  available: boolean
  unavailabilityReason: string | null
  favorite: 'A' | 'B' | null
  favoriteName: string | null
  favoriteExternalId: string | null
  underdogName: string | null
  probabilityA: number | null
  probabilityB: number | null
  marginLabel: string | null
  confidence: PredictionConfidence | null
  method: PredictionMethod | null
  keyFactors: { title: string; text: string }[]
  watchOuts: { title: string; text: string }[]
  model: {
    version: string
    computedAt: string
    factors: PredictionFactor[]
    notes: string[]
  }
}

export interface ExpressPredictionView {
  available: boolean
  favoriteName: string | null
  probability: number | null
  level: 'avantage net' | 'avantage léger' | 'indécis'
  basis: string
}

// ---------------------------------------------------------------------------
// Pronostic complet (page combat)
// ---------------------------------------------------------------------------

export function computePrediction(
  a: FighterView,
  b: FighterView,
  dimensions: DimensionScore[]
): PredictionView {
  const empty: PredictionView = {
    available: false,
    unavailabilityReason: null,
    favorite: null,
    favoriteName: null,
    favoriteExternalId: null,
    underdogName: null,
    probabilityA: null,
    probabilityB: null,
    marginLabel: null,
    confidence: null,
    method: null,
    keyFactors: [],
    watchOuts: [],
    model: { version: MODEL_VERSION, computedAt: new Date().toISOString(), factors: [], notes: [] },
  }

  const usable = dimensions.filter(
    (d) => d.available && d.scoreA != null && d.scoreB != null && (DIMENSION_WEIGHTS[d.key] ?? 0) > 0
  )

  if (usable.length < MIN_DIMENSIONS) {
    return {
      ...empty,
      unavailabilityReason: `Données insuffisantes pour un pronostic fiable : ${usable.length} dimension(s) comparable(s) sur ${dimensions.length} (minimum requis : ${MIN_DIMENSIONS}). VOLTRIX refuse d'extrapoler sur cette base.`,
    }
  }

  // Agrégation pondérée : somme des poids × (indice − 50)
  let weightedAdvantage = 0
  let totalWeight = 0
  const factors: PredictionFactor[] = []
  for (const d of usable) {
    const w = DIMENSION_WEIGHTS[d.key]
    const scoreA = d.scoreA as number
    const scoreB = d.scoreB as number
    weightedAdvantage += w * (scoreA - 50)
    totalWeight += w
    factors.push({
      key: d.key,
      label: d.label,
      weight: w,
      scoreA,
      scoreB,
      edge: Math.round((scoreA - 50) * 10) / 10,
    })
  }
  factors.sort((x, y) => Math.abs(y.edge * y.weight) - Math.abs(x.edge * x.weight))

  // Avantage normalisé ∈ [-1, 1] -> logistique -> bornage
  const normalizedAdvantage = weightedAdvantage / (totalWeight * 50)
  const rawP = 1 / (1 + Math.exp(-K_LOGISTIC * normalizedAdvantage))
  const probabilityA = Math.round(clamp(rawP * 100, P_MIN, P_MAX))
  const probabilityB = 100 - probabilityA

  const favorite: 'A' | 'B' | null = probabilityA === 50 ? null : probabilityA > 50 ? 'A' : 'B'
  const favView = favorite === 'A' ? a : favorite === 'B' ? b : null
  const otherView = favorite === 'A' ? b : favorite === 'B' ? a : null
  const margin = Math.abs(probabilityA - 50)
  const marginLabel =
    favorite == null
      ? 'indécis'
      : margin < 6
        ? 'avantage léger'
        : margin < 15
          ? 'avantage marqué'
          : 'avantage net'

  const coreUsed = CORE_DIMENSIONS.filter((k) => usable.some((d) => d.key === k)).length
  const coverage = usable.length / dimensions.length
  const coreCoverage = coreUsed / CORE_DIMENSIONS.length
  const confidenceScore = Math.round(100 * (0.45 * coverage + 0.55 * coreCoverage))
  const confidence: PredictionConfidence = {
    score: confidenceScore,
    label: confidenceScore >= 60 ? 'Bonne' : confidenceScore >= 35 ? 'Moyenne' : 'Limitée',
    dimensionsUsed: usable.length,
    dimensionsTotal: dimensions.length,
    missing: dimensions.filter((d) => !d.available).map((d) => d.label),
  }

  const method = favView ? predictMethod(favView) : null

  const forFavorite = favorite ? usable.filter((d) => d.advantage === favorite) : []
  const forOther = favorite ? usable.filter((d) => d.advantage !== favorite && d.advantage !== null && d.advantage !== '=') : []
  const byStrength = (list: DimensionScore[]) =>
    [...list].sort(
      (x, y) =>
        Math.abs((y.scoreA ?? 50) - 50) * DIMENSION_WEIGHTS[y.key] -
        Math.abs((x.scoreA ?? 50) - 50) * DIMENSION_WEIGHTS[x.key]
    )
  const keyFactors = byStrength(forFavorite)
    .slice(0, 3)
    .map((d) => ({ title: d.label, text: `${d.detail} (${d.basis.toLowerCase()}).` }))
  const watchOuts = byStrength(forOther)
    .slice(0, 2)
    .map((d) => ({
      title: d.label,
      text: `${d.advantage === 'A' ? a.fullName : b.fullName} garde l'avantage sur ce point : ${d.detail.toLowerCase()} (${d.basis.toLowerCase()}).`,
    }))

  return {
    available: true,
    unavailabilityReason: null,
    favorite,
    favoriteName: favView?.fullName ?? null,
    favoriteExternalId: favView?.externalId ?? null,
    underdogName: otherView?.fullName ?? null,
    probabilityA,
    probabilityB,
    marginLabel,
    confidence,
    method,
    keyFactors,
    watchOuts,
    model: {
      version: MODEL_VERSION,
      computedAt: new Date().toISOString(),
      factors,
      notes: [
        `Modèle ${MODEL_VERSION} : ${usable.length} dimensions comparables agrégées avec des poids publics.`,
        'Les probabilités sont volontairement bornées entre 25 % et 75 % : aucun combat de MMA n\u2019est une certitude statistique.',
        'Ce pronostic est une lecture statistique des données observées ; il ne tient compte ni de la préparation récente, ni des blessures, ni des stratégies de camp.',
        'Pronostic informatif : VOLTRIX n\u2019édite aucune cote et ne donne aucun conseil de paris.',
      ],
    },
  }
}

/** Méthode de victoire la plus fréquente dans le palmarès du combattant. */
function predictMethod(f: FighterView): PredictionMethod {
  const wins = f.record.wins
  const rates: { label: PredictionMethod['label']; rate: number | null }[] = []

  if (wins != null && wins > 0) {
    const ko = (f.record.winsByKo ?? 0) / wins
    const sub = (f.record.winsBySub ?? 0) / wins
    rates.push({ label: 'KO/TKO', rate: ko })
    rates.push({ label: 'Soumission', rate: sub })
    rates.push({ label: 'Décision', rate: Math.max(0, 1 - ko - sub) })
  }

  const s = f.stats
  if (s) {
    const career: { label: PredictionMethod['label']; rate: number | null }[] = [
      { label: 'KO/TKO', rate: pct2rate(s.koPercentage) != null ? pct2rate(s.koPercentage)! + pct2rate(s.tkoPercentage)! : null },
      { label: 'Soumission', rate: null },
      { label: 'Décision', rate: pct2rate(s.decisionPercentage) },
    ]
    for (const c of career) {
      if (c.rate == null) continue
      const existing = rates.find((r) => r.label === c.label)
      if (existing && existing.rate != null) existing.rate = (existing.rate + c.rate) / 2
      else if (!existing) rates.push({ label: c.label, rate: c.rate })
    }
  }

  const valid = rates.filter((r) => r.rate != null && Number.isFinite(r.rate)) as { label: PredictionMethod['label']; rate: number }[]
  if (valid.length === 0) {
    return {
      label: 'Décision',
      share: null,
      detail: `Répartition des méthodes de victoire non disponible dans les données ESPN de ${f.fullName} — méthode non déterminable.`,
    }
  }
  valid.sort((x, y) => y.rate - x.rate)
  const best = valid[0]
  const share = Math.round(best.rate * 100)
  return {
    label: best.label,
    share,
    detail: `${share} % des victoires répertoriées de ${f.fullName} ont été obtenues par ${best.label.toLowerCase()} (source : palmarès ESPN)${valid.length < 3 ? ' — répartition partielle' : ''}.`,
  }
}

function pct2rate(p: number | null): number | null {
  if (p == null || !Number.isFinite(p)) return null
  return p > 1 ? p / 100 : p
}

// ---------------------------------------------------------------------------
// Pronostic express (lignes de carte d'événement)
// ---------------------------------------------------------------------------

export interface ExpressFighterInput {
  fullName: string
  wins: number | null
  losses: number | null
  draws: number | null
  lastResults: string | null
  recordAtFight: string | null
}

export function computeExpressPrediction(x: ExpressFighterInput, y: ExpressFighterInput): ExpressPredictionView {
  const scoreOf = (f: ExpressFighterInput): { score: number | null; parts: string[] } => {
    const parts: string[] = []
    let winRate: number | null = null
    if (f.wins != null && f.losses != null && f.wins + f.losses > 0) {
      winRate = f.wins / (f.wins + f.losses)
      parts.push('palmarès')
    } else {
      const rec = parseRecord(f.recordAtFight)
      if (rec && rec.wins + rec.losses > 0) {
        winRate = rec.wins / (rec.wins + rec.losses)
        parts.push('palmarès affiché')
      }
    }
    const form = formScore(f.lastResults)
    if (form != null) parts.push('forme')
    if (winRate == null && form == null) return { score: null, parts }
    if (winRate == null) return { score: form, parts }
    if (form == null) return { score: winRate, parts }
    return { score: 0.6 * winRate + 0.4 * form, parts }
  }

  const sx = scoreOf(x)
  const sy = scoreOf(y)
  if (sx.score == null || sy.score == null) {
    return { available: false, favoriteName: null, probability: null, level: 'indécis', basis: 'données insuffisantes' }
  }

  const diff = sx.score - sy.score
  const rawP = 1 / (1 + Math.exp(-2.2 * diff))
  const p = Math.round(clamp(rawP * 100, 30, 70))
  const favoriteName = p === 50 ? null : p > 50 ? x.fullName : y.fullName
  const level: ExpressPredictionView['level'] =
    favoriteName == null || Math.abs(p - 50) < 5 ? 'indécis' : Math.abs(p - 50) < 10 ? 'avantage léger' : 'avantage net'

  return {
    available: true,
    favoriteName,
    probability: favoriteName == null ? null : Math.max(p, 100 - p),
    level,
    basis: [...new Set([...sx.parts, ...sy.parts])].join(' + ') || 'palmarès',
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}
