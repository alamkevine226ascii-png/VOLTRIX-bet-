// ============================================================
// VOLTRIX bet — Rate limiter mémoire (anti-abus, Task 21-c)
// ============================================================
// Zéro dépendance, pattern cohérent avec src/lib/cache.ts (Task 18-a) :
//   - buckets accrochés à globalThis (survivent au hot-reload dev,
//     un seul état partagé par le process)
//   - fenêtre GLISSANTE par clé `name:ip` (horodatages des requêtes
//     autorisées, purge à chaque contrôle — plus juste qu'un fixe)
//   - seule une requête AUTORISÉE consomme du quota : un 429 ne
//     prolonge jamais le blocage (pas de lockout auto-entretenu)
//   - sweep périodique 60 s des buckets vides/expirés (anti-fuite,
//     même discipline que le cache) + plafond 10 000 buckets avec
//     éviction LRU (le Map réinsère le bucket le plus récent en fin)
// Limites appelées « généreuses » : l'app analyse par lots de 6 et
// rafraîchit toutes les ~60 s — l'usage normal ne doit JAMAIS voir
// un 429 (60 req/min/IP sur /api/matches, 15 req/min/IP sur /api/cashout).
// ============================================================

interface RateBucket {
  hits: number[]; // horodatages (epoch ms) des requêtes AUTORISÉES
  windowMs: number; // fenêtre utilisée pour cette clé (max vu, pour le sweep)
}

// 10 000 buckets ≈ quelques Mo au pire (chaque bucket = un tableau court
// de timestamps) — budget mémoire négligeable, borné quoi qu'il arrive.
const MAX_BUCKETS = 10_000;
const SWEEP_INTERVAL_MS = 60 * 1000;

// Accroché à globalThis : survit au hot-reload dev (pas de duplication
// d'état ni de timer à chaque ré-évaluation du module).
const g = globalThis as unknown as {
  __voltrixRateBuckets?: Map<string, RateBucket>;
  __voltrixRateSweeper?: unknown;
};

const buckets = (g.__voltrixRateBuckets ??= new Map<string, RateBucket>());

/** IP client : x-forwarded-for (1re entrée) → x-real-ip → repli 'local'. */
function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get('x-real-ip');
  if (real) return real.trim();
  return 'local';
}

/**
 * Contrôle de quota en fenêtre glissante. Synchrone, sans I/O.
 * @param name     nom logique du endpoint (ex. 'matches', 'cashout')
 * @param limit    nb max de requêtes AUTORISÉES par fenêtre et par IP
 * @param windowMs taille de la fenêtre glissante en ms (ex. 60_000)
 */
export function rateLimit(
  req: Request,
  name: string,
  limit: number,
  windowMs: number
): { allowed: boolean; retryAfterSec: number } {
  const key = `${name}:${clientIp(req)}`;
  const now = Date.now();

  const bucket = buckets.get(key);
  if (bucket) {
    // LRU : réinsère en fin de Map (client le plus récemment vu)
    buckets.delete(key);
    bucket.hits = bucket.hits.filter((t) => now - t < bucket.windowMs);
    bucket.windowMs = Math.max(bucket.windowMs, windowMs);
  }
  const current = bucket ?? { hits: [] as number[], windowMs };

  if (current.hits.length >= limit) {
    // Refus : AUCUN hit consommé. Retry-After = temps avant que la plus
    // ancienne requête autorisée sorte de la fenêtre glissante.
    buckets.set(key, current);
    const oldest = current.hits[0] ?? now;
    const retryAfterSec = Math.max(1, Math.ceil((oldest + current.windowMs - now) / 1000));
    return { allowed: false, retryAfterSec };
  }

  current.hits.push(now);
  buckets.set(key, current);
  // Éviction LRU : au-delà du plafond, les buckets les plus anciens sautent.
  while (buckets.size > MAX_BUCKETS) {
    const oldestKey = buckets.keys().next();
    if (oldestKey.done) break;
    buckets.delete(oldestKey.value);
  }
  ensureRateSweep();
  return { allowed: true, retryAfterSec: 0 };
}

// ---------- Maintenance périodique (anti-fuite, cf. cache.ts) ----------

function sweepBuckets(): number {
  const now = Date.now();
  let removed = 0;
  for (const [key, b] of buckets) {
    b.hits = b.hits.filter((t) => now - t < b.windowMs);
    if (b.hits.length === 0) {
      buckets.delete(key);
      removed++;
    }
  }
  return removed;
}

/** Démarre (une seule fois) le balayage périodique des buckets. */
function ensureRateSweep(): void {
  if (g.__voltrixRateSweeper) return;
  const timer = setInterval(() => {
    sweepBuckets();
  }, SWEEP_INTERVAL_MS) as unknown as { unref?: () => void };
  timer.unref?.(); // ne doit jamais empêcher l'arrêt du processus
  g.__voltrixRateSweeper = timer;
}

/** Diagnostic : nb de buckets actifs (observabilité [mem]-like). */
export function rateLimitStats(): { buckets: number } {
  return { buckets: buckets.size };
}
