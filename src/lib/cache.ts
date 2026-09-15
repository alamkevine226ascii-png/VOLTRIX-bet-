// ============================================================
// VOLTRIX bet — Cache mémoire TTL borné (anti-fuite, Task 18-a)
// ============================================================
// Historique : ce store était un Map sans limite — chaque clé
// `sb:{ligue}:{date}` / `sched:{ligue}:{team}` / `wx:{ville}` y
// restait MÊME après expiration (suppression uniquement à la
// relecture). Une rafale d'analyses (POST /api/predictions) ou un
// scan de performance accumulait donc des centaines de payloads
// ESPN → OOM du serveur dev (2 crashes, heap 2 Go épuisé).
//
// Garanties désormais :
//   1. TTL par entrée (inchangé)
//   2. LRU : au-delà de MAX_ENTRIES, les entrées les plus anciennes
//      (les moins récemment utilisées) sont évincées
//   3. Sweep périodique (60 s) : toute entrée expirée est supprimée
//      même si personne ne la relit
//   4. Log discret [mem] (max 1 / 60 s, uniquement si activité)
//      donnant RSS/heap + tailles par préfixe pour le diagnostic
// ============================================================

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

// 600 entrées plafonnées : un scoreboard mappé pèse ~10-60 Ko, un
// calendrier d'équipe ~15 Ko → budget mémoire ≈ 10-20 Mo au pire.
const MAX_ENTRIES = 600;

const store = new Map<string, CacheEntry<unknown>>();

export function cacheGet<T>(key: string): T | undefined {
  const entry = store.get(key) as CacheEntry<T> | undefined;
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return undefined;
  }
  // LRU : réinsère en fin de Map (la plus récemment utilisée)
  store.delete(key);
  store.set(key, entry as CacheEntry<unknown>);
  g.__voltrixMemActive = true; // activité → le prochain tick publiera [mem]
  return entry.value;
}

export function cacheSet<T>(key: string, value: T, ttlMs: number): void {
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
  // Éviction LRU : supprime les entrées les plus anciennes au-delà du plafond
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next();
    if (oldest.done) break;
    store.delete(oldest.value);
  }
  g.__voltrixMemActive = true; // activité → le prochain tick publiera [mem]
  ensureMaintenance();
}

export async function cached<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>,
  options?: {
    // Si le fetcher renvoie une "valeur d'échec" (null, tableau vide…),
    // on la met en cache très brièvement pour ne pas bloquer les retries.
    failureValue?: (value: T) => boolean;
    failureTtlMs?: number;
  }
): Promise<T> {
  const hit = cacheGet<T>(key);
  if (hit !== undefined) return hit;
  const value = await fetcher();
  const isFailure = options?.failureValue?.(value) ?? false;
  cacheSet(key, value, isFailure ? (options?.failureTtlMs ?? 15 * 1000) : ttlMs);
  return value;
}

// ---------- Maintenance périodique (sweep + observabilité) ----------

// Accroché à globalThis : survit au hot-reload dev (un seul timer,
// pas de duplication à chaque ré-évaluation du module).
const g = globalThis as unknown as {
  __voltrixCacheSweeper?: unknown;
  __voltrixMemActive?: boolean;
};

/** Tailles du cache par préfixe de clé (diagnostic mémoire). */
export function cacheStats(): { total: number; byPrefix: Record<string, number> } {
  const byPrefix: Record<string, number> = {};
  for (const key of store.keys()) {
    const prefix = key.split(':', 1)[0] || '?';
    byPrefix[prefix] = (byPrefix[prefix] ?? 0) + 1;
  }
  return { total: store.size, byPrefix };
}

function sweepExpired(): number {
  const now = Date.now();
  let removed = 0;
  for (const [key, entry] of store) {
    if (now > entry.expiresAt) {
      store.delete(key);
      removed++;
    }
  }
  return removed;
}

const SWEEP_INTERVAL_MS = 60 * 1000;
const MB = (bytes: number) => Math.round(bytes / (1024 * 1024));

function maintenanceTick(): void {
  const removed = sweepExpired();
  const active = g.__voltrixMemActive;
  g.__voltrixMemActive = false;
  // Log [mem] au plus toutes les 60 s, et seulement s'il y a eu de
  // l'activité depuis le dernier tick (pas de bruit au repos).
  if (!active) return;
  const { total, byPrefix } = cacheStats();
  const mem = process.memoryUsage();
  const matchesBody =
    (globalThis as unknown as { __voltrixMatchesBodies?: Map<string, unknown> }).__voltrixMatchesBodies?.size ?? 0;
  const parts = Object.entries(byPrefix)
    .map(([p, n]) => `${p}=${n}`)
    .join(' ');
  console.log(
    `[mem] rss=${MB(mem.rss)}Mo heap=${MB(mem.heapUsed)}Mo matches=${matchesBody} cache=${total}${parts ? ' ' + parts : ''}${removed ? ` evict=${removed}` : ''}`
  );
}

/** Démarre (une seule fois) le balayage périodique du cache. */
export function ensureMaintenance(): void {
  if (g.__voltrixCacheSweeper) return;
  const timer = setInterval(maintenanceTick, SWEEP_INTERVAL_MS) as unknown as { unref?: () => void };
  timer.unref?.(); // ne doit jamais empêcher l'arrêt du processus
  g.__voltrixCacheSweeper = timer;
}

// Exécution en parallèle avec limite de concurrence
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}
