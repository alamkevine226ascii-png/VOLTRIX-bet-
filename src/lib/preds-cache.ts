// ============================================================
// VOLTRIX bet — Cache session des analyses IA (par date)
// ============================================================
// Problème (Task 11-b) : le state `preds` de la page accueil est PERDU à
// chaque navigation (démontage du composant de page) → au retour : barre
// « Analyse 0/N », skeletons partout, et re-POST de TOUS les lots vers
// /api/predictions (lenteur perçue + trafic inutile).
//
// Solution : miroir persistant du state dans sessionStorage — survit aux
// navigations intra-onglet (client-side routing Next.js) et au rechargement,
// est cloisonné par onglet (pas de partage inter-utilisateurs, pas de
// staleness inter-onglets) — idéal pour ce besoin. Structure par date :
//
//   clé  `voltrix_preds_v1:<date>`   (ex : voltrix_preds_v1:2025-01-15)
//   valeur  JSON { savedAt, preds: { matchId: QuickPred } }
//
// - QuickPred (src/lib/types.ts) est 100 % sérialisable en JSON (nombres,
//   chaînes, tableaux, objets plats) → stocké tel quel.
// - TTL d'entrée par date (2 h) : au-delà, l'entrée est ignorée ET supprimée
//   (re-analyse normale). Les matchs passés en « post » conservent leur
//   analyse dans l'entrée tant qu'elle est fraîche (comparaison modèle/réel).
// - Écritures fusionnées (merge par matchId) et throttlées : une fenêtre de
//   SAVE_THROTTLE_MS groupe les lots d'analyse qui arrivent par vagues de 6.
//   1re écriture de la fenêtre immédiate (leading), reliquat écrit en fin de
//   fenêtre (trailing), flush de sécurité sur pagehide / visibilitychange
//   (l'onglet ne doit jamais perdre les derniers lots en naviguant).
// - Fallback silencieux si sessionStorage est indisponible (SSR, tests,
//   navigation privée stricte, quota) : l'app fonctionne sans cache.
// ============================================================

import type { QuickPred } from '@/lib/types';

const PREFIX = 'voltrix_preds_v1:';

// TTL d'une entrée (par date) : 2 h — au-delà, re-analyse normale.
export const PREDS_TTL_MS = 2 * 60 * 60 * 1000;

// Fenêtre de regroupement des écritures (les lots d'analyse arrivent toutes
// les ~1-2 s ; inutile de sérialiser + écrire le JSON complet à chacune).
const SAVE_THROTTLE_MS = 800;

interface PredsEntry {
  savedAt: number;
  preds: Record<string, QuickPred>;
}

// ---------- Storage défensif (peut lever en navigation privée / iframe) ----------

function getStorage(): Storage | null {
  try {
    if (typeof window === 'undefined' || !window.sessionStorage) return null;
    // Test d'écriture : certains navigateurs lèvent sur setItem en mode privé
    const probe = '__voltrix_probe__';
    window.sessionStorage.setItem(probe, '1');
    window.sessionStorage.removeItem(probe);
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function readEntry(storage: Storage, date: string): PredsEntry | null {
  try {
    const raw = storage.getItem(PREFIX + date);
    if (!raw) return null;
    const entry = JSON.parse(raw) as PredsEntry;
    if (
      !entry ||
      typeof entry.savedAt !== 'number' ||
      !entry.preds ||
      typeof entry.preds !== 'object'
    ) {
      return null;
    }
    return entry;
  } catch {
    return null; // JSON corrompu → traité comme absence
  }
}

// ---------- API publique ----------

/**
 * Analyses en cache pour une date ({} si absent, expiré ou illisible).
 * Une entrée au-delà du TTL est supprimée au passage (re-analyse normale).
 */
export function loadCachedPreds(date: string): Record<string, QuickPred> {
  const storage = getStorage();
  if (!storage || !date) return {};
  const entry = readEntry(storage, date);
  if (!entry) return {};
  if (Date.now() - entry.savedAt > PREDS_TTL_MS) {
    try {
      storage.removeItem(PREFIX + date);
    } catch {
      /* ignore */
    }
    return {};
  }
  return entry.preds;
}

/**
 * Écriture immédiate (interne) : fusionne `updates` dans l'entrée stockée
 * (les nouvelles analyses écrasent les anciennes par matchId) et remet
 * l'horodatage `savedAt` à zéro (TTL glissant par date).
 */
function writeEntry(date: string, updates: Record<string, QuickPred>) {
  const storage = getStorage();
  if (!storage || !date) return;
  const prev = readEntry(storage, date);
  const entry: PredsEntry = {
    savedAt: Date.now(),
    preds: { ...(prev?.preds ?? {}), ...updates },
  };
  try {
    storage.setItem(PREFIX + date, JSON.stringify(entry));
  } catch {
    // Quota probablement dépassé : éviction des dates les plus anciennes
    // (hors date courante) puis une seule tentative de plus — sinon abandon.
    evictOldest(storage, date);
    try {
      storage.setItem(PREFIX + date, JSON.stringify(entry));
    } catch {
      /* abandon silencieux — l'app vit sans cache */
    }
  }
}

/** Évacue la moitié la plus ancienne des entrées (hors `keepDate`). */
function evictOldest(storage: Storage, keepDate: string) {
  const items: Array<{ key: string; savedAt: number }> = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key || !key.startsWith(PREFIX) || key === PREFIX + keepDate) continue;
    const entry = readEntry(storage, key.slice(PREFIX.length));
    items.push({ key, savedAt: entry?.savedAt ?? 0 });
  }
  items.sort((a, b) => a.savedAt - b.savedAt);
  const n = Math.max(1, Math.floor(items.length / 2));
  for (let i = 0; i < n; i++) {
    try {
      storage.removeItem(items[i].key);
    } catch {
      /* ignore */
    }
  }
}

// ---------- Écritures fusionnées + throttlées ----------

let pendingDate: string | null = null;
let pendingUpdates: Record<string, QuickPred> = {};
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function flushNow() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  const date = pendingDate;
  const updates = pendingUpdates;
  pendingDate = null;
  pendingUpdates = {};
  if (date && Object.keys(updates).length > 0) writeEntry(date, updates);
}

/**
 * Enregistre de nouvelles analyses pour une date (merge par matchId).
 * Throttle leading+trailing : la 1re écriture d'une fenêtre est immédiate,
 * les suivantes sont accumulées puis écrites groupées en fin de fenêtre —
 * au plus une écriture réelle par lot d'analyse, souvent moins.
 * Un changement de date pendant la fenêtre écrit d'abord ce qui pendait
 * pour l'ancienne date (aucun mélange entre dates).
 */
export function saveCachedPreds(date: string, updates: Record<string, QuickPred>) {
  if (!date || Object.keys(updates).length === 0) return;
  if (pendingDate !== date && Object.keys(pendingUpdates).length > 0) flushNow();
  pendingDate = date;
  pendingUpdates = { ...pendingUpdates, ...updates };
  if (saveTimer) return; // fenêtre en cours : accumulation (flush trailing)
  // Fenêtre neuve : écriture immédiate (leading)…
  flushNow();
  // …puis fenêtre d'accumulation pour les lots suivants (trailing)
  saveTimer = setTimeout(() => {
    saveTimer = null;
    flushNow();
  }, SAVE_THROTTLE_MS);
}

/**
 * Supprime l'entrée en cache d'une date (et toute écriture pendante la
 * concernant) — la prochaine visite re-analysera normalement.
 */
export function clearCachedPreds(date: string) {
  if (pendingDate === date) {
    pendingDate = null;
    pendingUpdates = {};
  }
  try {
    getStorage()?.removeItem(PREFIX + date);
  } catch {
    /* ignore */
  }
}

// Flush de sécurité avant un déchargement / masquage de l'onglet : le throttle
// ne doit jamais perdre les derniers lots (fermeture, navigation, bfcache).
// Garde SSR/tests : window/document peuvent être absents.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushNow);
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushNow();
    });
  }
}
