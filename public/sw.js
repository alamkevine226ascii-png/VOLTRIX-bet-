// ============================================================
// VOLTRIX bet — Service Worker
// Cache de l'app shell + stale-while-revalidate pour l'API
// (réponse immédiate depuis le cache, rafraîchissement en fond)
// + cache-first pour les logos ESPN
//
// ⚠️ CACHE_NAME : incrémenter à CHAQUE déploiement d'une nouvelle
// version de l'app (v3, v4, …). Le handler 'activate' purge alors
// tous les caches antérieurs → plus jamais de vieille UI collée.
// ============================================================

const CACHE_NAME = 'voltrix-v5'; // Task 48 : bouton installation PWA (Profil)
const APP_SHELL = [
  '/',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

// TTL de fraîcheur par chemin d'API : tant qu'une réponse est plus jeune que
// son TTL elle est servie instantanément (le réseau ne fait que rafraîchir).
// Au-delà, on repasse en réseau d'abord avec repli cache si offline.
const API_TTLS = [
  { re: /^\/api\/matches/, ttl: 60 * 1000 },      // scores (données live)
  { re: /^\/api\/performance/, ttl: 120 * 1000 }, // stats quasi statiques
  { re: /^\/api\/match\//, ttl: 120 * 1000 },     // détail match
  { re: /^\/api\//, ttl: 120 * 1000 },            // défaut
];
const API_CACHE_MAX_ENTRIES = 60;

function apiTtlMs(pathname) {
  for (const { re, ttl } of API_TTLS) {
    if (re.test(pathname)) return ttl;
  }
  return 120 * 1000;
}

// Horodatage de mise en cache (la Date des Response n'est pas fiable ici).
// Vit le temps de vie du SW : après son redémarrage, les entrées sont
// simplement considérées périmées (repli réseau, jamais bloquant).
const cachedAt = new Map();

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

async function putApiCache(cache, request, response) {
  cachedAt.set(request.url, Date.now());
  await cache.put(request, response);
  // Éviction douce : ne pas faire croître le cache API sans limite
  if (cachedAt.size > API_CACHE_MAX_ENTRIES) {
    const oldest = [...cachedAt.entries()].sort((a, b) => a[1] - b[1]);
    for (const [entryUrl] of oldest.slice(0, cachedAt.size - API_CACHE_MAX_ENTRIES)) {
      cachedAt.delete(entryUrl);
      await cache.delete(entryUrl).catch(() => {});
    }
  }
}

async function apiStaleWhileRevalidate(event) {
  const request = event.request;
  const cache = await caches.open(CACHE_NAME);
  const hit = await cache.match(request);
  const age =
    hit && cachedAt.has(request.url)
      ? Date.now() - cachedAt.get(request.url)
      : Infinity;
  const ttl = apiTtlMs(new URL(request.url).pathname);

  const refresh = () =>
    fetch(request)
      .then((res) => {
        if (res && res.ok) {
          // ⚠️ cache.put CONSOME le corps : on met un clone en cache et on
          // rend l'original intact à la page (sinon corps vide côté client).
          const copy = res.clone();
          return putApiCache(cache, request, copy).then(() => res);
        }
        return res;
      })
      .catch(() => null);

  // Fraîche → réponse immédiate depuis le cache + rafraîchissement en fond
  if (hit && age < ttl) {
    event.waitUntil(refresh());
    return hit;
  }

  // Périmée ou absente → réseau d'abord, repli cache (même périmée) si offline
  const fresh = await refresh();
  if (fresh) return fresh;
  if (hit) return hit;
  // Ni réseau ni cache : on échoue comme le ferait le réseau (le try/catch
  // de la page gère déjà ce cas), au lieu de renvoyer un JSON inattendu.
  throw new Error('VOLTRIX SW : offline, pas de cache pour ' + request.url);
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;

  // API GET : stale-while-revalidate (réponse instantanée + refresh en fond)
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(apiStaleWhileRevalidate(event));
    return;
  }

  // Icônes ESPN et assets statiques : cache-first
  // (catch : en cas d'échec réseau sans cache, on renvoie une
  // réponse 504 explicite au lieu de laisser respondWith recevoir
  // `undefined` — même effet qu'une erreur réseau pour l'<img>,
  // mais sans rejet non géré dans le worker).
  if (url.hostname.includes('espncdn.com')) {
    event.respondWith(
      caches.match(event.request).then(
        (hit) =>
          hit ||
          fetch(event.request).then((res) => {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone)).catch(() => {});
            return res;
          }).catch(() => new Response('', { status: 504, statusText: 'Offline' }))
      )
    );
    return;
  }

  // Navigation : network-first, repli cache en cas d'échec réseau
  // (page exacte si disponible, sinon la coquille '/')
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() =>
        caches.match(event.request).then((hit) => hit || caches.match('/'))
      )
    );
  }
});
