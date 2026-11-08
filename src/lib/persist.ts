/**
 * VOLTRIX — Cache persistant local (localStorage, TTL).
 *
 * Exigence produit (retour utilisateur 2026-11-09) : « quand je quitte
 * l'App et que j'y reviens 3 secondes après, le moteur ne doit pas
 * recalculer tout à zéro — il doit sauvegarder les informations en
 * arrière-plan pendant au moins 10 minutes. »
 *
 * sessionStorage meurt quand la webview mobile est tuée ; localStorage
 * survit. Ce module fournit un stockage clé→valeur JSON avec expiration,
 * partagé par tous les caches de l'app (ESPN foot + UFC, analyses,
 * indicateurs dérivés). Les TTL restent définis par chaque appelant :
 * les ressources vivantes (scoreboards du jour) expirent en 1-10 min,
 * les ressources stables (fiches, palmarès) en 12-24 h.
 *
 * Robustesse quota (~5 Mo) : à chaque écriture refusée, on évacue les
 * entrées expirées puis les plus anciennes, puis on retente une fois.
 */

const MAX_RETRY_EVICTIONS = 24

interface Wrapped {
  v: unknown
  exp: number // epoch ms ; Infinity = pas d'expiration
}

function ls(): Storage | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null
    return window.localStorage
  } catch {
    return null
  }
}

export function persistGet<T>(key: string): T | null {
  const store = ls()
  if (!store) return null
  try {
    const raw = store.getItem(key)
    if (!raw) return null
    const w = JSON.parse(raw) as Wrapped
    if (typeof w.exp === "number" && w.exp < Date.now()) {
      store.removeItem(key)
      return null
    }
    return w.v as T
  } catch {
    return null
  }
}

export function persistSet(key: string, value: unknown, ttlMs: number): boolean {
  const store = ls()
  if (!store) return false
  const w: Wrapped = { v: value, exp: ttlMs > 0 ? Date.now() + ttlMs : Infinity }
  const raw = JSON.stringify(w)
  try {
    store.setItem(key, raw)
    return true
  } catch {
    /* quota dépassé : évacuation puis re-tentative unique */
  }
  evict(store, key)
  try {
    store.setItem(key, raw)
    return true
  } catch {
    return false // le cache mémoire de l'appelant suffit
  }
}

export function persistRemove(key: string): void {
  const store = ls()
  if (!store) return
  try {
    store.removeItem(key)
  } catch {
    /* ignore */
  }
}

/** Supprime les clés persistantes correspondant à un préfixe. */
export function persistClearPrefix(prefixes: string[]): void {
  const store = ls()
  if (!store) return
  try {
    const toRemove: string[] = []
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i)
      if (k && prefixes.some((p) => k.startsWith(p))) toRemove.push(k)
    }
    for (const k of toRemove) store.removeItem(k)
  } catch {
    /* ignore */
  }
}

/**
 * Évacuation : entrées expirées d'abord, puis plus anciennes (approximation
 * LRU par horodatage d'écriture stocké côté valeur impossible sans re-parse
 * global — on utilise l'ordre d'insertion du storage, suffisant ici).
 */
function evict(store: Storage, protectKey: string): void {
  try {
    const now = Date.now()
    const candidates: string[] = []
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i)
      if (!k || k === protectKey) continue
      let exp: number | null = null
      try {
        const w = JSON.parse(store.getItem(k) ?? "") as Wrapped
        if (typeof w.exp === "number") exp = w.exp
      } catch {
        exp = 0 // valeur illisible : prioritaire à l'évacuation
      }
      if (exp !== null && exp < now) store.removeItem(k)
      else candidates.push(k)
    }
    for (let i = 0; i < Math.min(MAX_RETRY_EVICTIONS, candidates.length); i++) {
      store.removeItem(candidates[i])
      if (candidates[i] !== protectKey) break
    }
  } catch {
    /* ignore */
  }
}
