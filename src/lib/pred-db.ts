/**
 * VOLTRIX — BASE DE DONNÉES LOCALE DES PRONOSTICS (IndexedDB).
 *
 * Exigence produit (retour utilisateur 2026-11-09) : « quand le calcul
 * est fait une fois, même si l'utilisateur quitte l'App et revient
 * 5 minutes après, le système ne doit pas tout recalculer — tu peux
 * créer une base de données pour stocker les pronostics. »
 *
 * IndexedDB est la vraie base de données du navigateur : elle survit à
 * la fermeture de l'App (contrairement à la mémoire et à sessionStorage)
 * et son quota (centaines de Mo) dépasse largement localStorage. Un
 * repli localStorage (persist.ts) reste prévu si IndexedDB est absent
 * ou bloqué : la promesse « calcul une fois, restore ensuite » tient
 * dans tous les cas où le stockage est disponible.
 *
 * Chaque enregistrement : { id, kind, payload, computedAt, expiresAt }.
 * TTL décidés par l'appelant — alignés sur l'exigence « au moins
 * 10 minutes » : 15 min avant match, 10 min en direct, 6 h une fois
 * le match terminé (un résultat ne change plus).
 */

const DB_NAME = "voltrix-pred-db";
const DB_VERSION = 1;
const STORE = "preds";
const LS_PREFIX = "voltrix:preddb:";

export type PredKind = "foot" | "mma";

interface PredRecord {
  id: string;
  kind: PredKind;
  payload: unknown;
  computedAt: number;
  expiresAt: number; // epoch ms
}

/* ---------- ouverture paresseuse (une seule promesse partagée) ---------- */

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined" || !indexedDB) {
        resolve(null);
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: ["kind", "id"] });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

/* ---------- repli localStorage ---------- */

function lsKey(kind: PredKind, id: string): string {
  return `${LS_PREFIX}${kind}:${id}`;
}

function lsGet(kind: PredKind, id: string): PredRecord | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    const raw = window.localStorage.getItem(lsKey(kind, id));
    if (!raw) return null;
    const rec = JSON.parse(raw) as PredRecord;
    if (typeof rec.expiresAt === "number" && rec.expiresAt < Date.now()) return null;
    return rec;
  } catch {
    return null;
  }
}

function lsPut(rec: PredRecord): void {
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    window.localStorage.setItem(lsKey(rec.kind, rec.id), JSON.stringify(rec));
  } catch {
    /* quota : le cache mémoire de l'appelant suffit */
  }
}

/* ---------- API ---------- */

/** Enregistre un pronostic calculé (écrase l'existant pour cet id). */
export async function predDbPut(
  kind: PredKind,
  id: string,
  payload: unknown,
  ttlMs: number,
): Promise<void> {
  const rec: PredRecord = {
    id,
    kind,
    payload,
    computedAt: Date.now(),
    expiresAt: Date.now() + Math.max(60_000, ttlMs),
  };
  const db = await openDb();
  if (!db) {
    lsPut(rec);
    return;
  }
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(rec);
      tx.oncomplete = () => resolve();
      tx.onerror = () => {
        lsPut(rec); // repli silencieux
        resolve();
      };
      tx.onabort = () => {
        lsPut(rec);
        resolve();
      };
    } catch {
      lsPut(rec);
      resolve();
    }
  });
}

/** Lit un pronostic encore valide (null si absent/expiré). */
export async function predDbGet<T>(kind: PredKind, id: string): Promise<T | null> {
  const db = await openDb();
  if (!db) {
    const rec = lsGet(kind, id);
    return rec ? (rec.payload as T) : null;
  }
  const rec = await new Promise<PredRecord | null>((resolve) => {
    try {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get([kind, id]);
      req.onsuccess = () => resolve((req.result as PredRecord | undefined) ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  if (!rec) {
    const fb = lsGet(kind, id);
    return fb ? (fb.payload as T) : null;
  }
  if (rec.expiresAt < Date.now()) return null;
  return rec.payload as T;
}

/** Tous les pronostics valides d'un type (foot ou mma), mappés par id.
 *  Évacue au passage les entrées expirées. */
export async function predDbGetAll<T>(kind: PredKind): Promise<Record<string, T>> {
  const db = await openDb();
  const out: Record<string, T> = {};
  const now = Date.now();
  const collect = (recs: PredRecord[]) => {
    for (const rec of recs) {
      if (rec.kind !== kind) continue;
      if (typeof rec.expiresAt === "number" && rec.expiresAt < now) continue;
      out[rec.id] = rec.payload as T;
    }
  };

  /* couche localStorage d'abord (repli toujours rempli) */
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      const ids = new Set<string>();
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (k && k.startsWith(LS_PREFIX)) ids.add(k);
      }
      const recs: PredRecord[] = [];
      for (const k of ids) {
        try {
          recs.push(JSON.parse(window.localStorage.getItem(k) ?? "") as PredRecord);
        } catch {
          /* entrée illisible : ignorée */
        }
      }
      collect(recs);
    }
  } catch {
    /* ignore */
  }

  if (db) {
    const recs = await new Promise<PredRecord[]>((resolve) => {
      try {
        const tx = db.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).getAll();
        req.onsuccess = () => resolve((req.result as PredRecord[]) ?? []);
        req.onerror = () => resolve([]);
      } catch {
        resolve([]);
      }
    });
    collect(recs);
    /* évacuation des expirés (feu et oubli) */
    try {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      for (const rec of recs) {
        if (typeof rec.expiresAt === "number" && rec.expiresAt < now) {
          store.delete([rec.kind, rec.id]);
        }
      }
    } catch {
      /* ignore */
    }
  }
  return out;
}

/** Statistiques pour l'écran Réglages. */
export interface PredDbStats {
  entries: number;
  /** millisecondes depuis le calcul le plus récent (null si vide) */
  freshestAgeMs: number | null;
  storage: "indexeddb" | "localstorage" | "aucun";
}

export async function predDbStats(): Promise<PredDbStats> {
  const db = await openDb();
  const now = Date.now();
  let count = 0;
  let freshest = 0;
  const scan = (recs: PredRecord[]) => {
    for (const rec of recs) {
      if (typeof rec.expiresAt === "number" && rec.expiresAt < now) continue;
      count++;
      if (rec.computedAt > freshest) freshest = rec.computedAt;
    }
  };
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (!k || !k.startsWith(LS_PREFIX)) continue;
        try {
          scan([JSON.parse(window.localStorage.getItem(k) ?? "") as PredRecord]);
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    /* ignore */
  }
  if (db) {
    const recs = await new Promise<PredRecord[]>((resolve) => {
      try {
        const tx = db.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).getAll();
        req.onsuccess = () => resolve((req.result as PredRecord[]) ?? []);
        req.onerror = () => resolve([]);
      } catch {
        resolve([]);
      }
    });
    scan(recs);
  }
  return {
    entries: count,
    freshestAgeMs: freshest > 0 ? now - freshest : null,
    storage: db ? "indexeddb" : count > 0 ? "localstorage" : "aucun",
  };
}

/** Vide la base (Réglages → Vider le cache). */
export async function predDbClear(): Promise<void> {
  const db = await openDb();
  if (db) {
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    const toRemove: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(LS_PREFIX)) toRemove.push(k);
    }
    for (const k of toRemove) window.localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}
