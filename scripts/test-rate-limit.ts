// Test du rate limiter mémoire (Task 21-c) — exécuter : bun scripts/test-rate-limit.ts
// Appelle rateLimit directement avec des objets Request factices
// (header x-forwarded-for) : fenêtre glissante, refus au-delà de la
// limite avec retryAfterSec > 0, buckets indépendants par IP.
import { rateLimit } from '../src/lib/rate-limit';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name} ${detail}`);
  }
}

function fakeReq(ip: string | null, realIp?: string): Request {
  const headers = new Headers();
  if (ip) headers.set('x-forwarded-for', ip);
  if (realIp) headers.set('x-real-ip', realIp);
  return new Request('http://localhost:3000/api/test', { method: 'GET', headers });
}

console.log('— Sous la limite → autorisé —');
{
  const ip = '10.0.0.1';
  const r1 = rateLimit(fakeReq(ip), 'rl-test-a', 3, 60_000);
  const r2 = rateLimit(fakeReq(ip), 'rl-test-a', 3, 60_000);
  const r3 = rateLimit(fakeReq(ip), 'rl-test-a', 3, 60_000);
  check('3 appels sous limite 3/min → allowed', r1.allowed && r2.allowed && r3.allowed);
  check('retryAfterSec = 0 quand autorisé', r1.retryAfterSec === 0 && r2.retryAfterSec === 0 && r3.retryAfterSec === 0);

  console.log('— À la limite+1 → refusé avec retryAfterSec > 0 —');
  const r4 = rateLimit(fakeReq(ip), 'rl-test-a', 3, 60_000);
  const r5 = rateLimit(fakeReq(ip), 'rl-test-a', 3, 60_000);
  check('4e appel (limite 3) → refusé', !r4.allowed);
  check('4e appel → retryAfterSec > 0', r4.retryAfterSec > 0, `got ${r4.retryAfterSec}`);
  check('retryAfterSec ≤ fenêtre (60 s)', r4.retryAfterSec <= 60, `got ${r4.retryAfterSec}`);
  check('refus ne consomme pas de quota (5e appel même verdict)', !r5.allowed && r5.retryAfterSec > 0 && Math.abs(r5.retryAfterSec - r4.retryAfterSec) <= 1);
}

console.log('— Deux IPs distinctes → buckets indépendants —');
{
  const r1a = rateLimit(fakeReq('10.0.0.2'), 'rl-test-b', 2, 60_000);
  const r1b = rateLimit(fakeReq('10.0.0.2'), 'rl-test-b', 2, 60_000);
  check('IP A : 2/2 autorisés', r1a.allowed && r1b.allowed);
  const r1c = rateLimit(fakeReq('10.0.0.2'), 'rl-test-b', 2, 60_000);
  check('IP A : 3e appel refusé', !r1c.allowed, `got allowed=${r1c.allowed}`);
  const r2a = rateLimit(fakeReq('10.0.0.3'), 'rl-test-b', 2, 60_000);
  const r2b = rateLimit(fakeReq('10.0.0.3'), 'rl-test-b', 2, 60_000);
  check('IP B : bucket INDÉPENDANT → 2/2 autorisés', r2a.allowed && r2b.allowed, `got ${r2a.allowed}/${r2b.allowed}`);
  const r2c = rateLimit(fakeReq('10.0.0.3'), 'rl-test-b', 2, 60_000);
  check('IP B : 3e appel refusé à son tour', !r2c.allowed);
}

console.log('— Fenêtre glissante : le quota se libère —');
{
  const r1 = rateLimit(fakeReq('10.0.0.4'), 'rl-test-c', 1, 120);
  check('limite 1/min(120 ms) → 1er autorisé', r1.allowed);
  const r2 = rateLimit(fakeReq('10.0.0.4'), 'rl-test-c', 1, 120);
  check('2e immédiat → refusé', !r2.allowed);
  check('retryAfterSec reflète la fenêtre restante', r2.retryAfterSec >= 0 && r2.retryAfterSec <= 1, `got ${r2.retryAfterSec}`);
  await new Promise((resolve) => setTimeout(resolve, 160));
  const r3 = rateLimit(fakeReq('10.0.0.4'), 'rl-test-c', 1, 120);
  check('après expiration de la fenêtre → ré-autorisé', r3.allowed, `got allowed=${r3.allowed}`);
}

console.log('— Extraction IP : x-forwarded-for multi-valeurs, x-real-ip, repli local —');
{
  const rMulti = rateLimit(fakeReq('203.0.113.9, 70.41.3.18'), 'rl-test-d', 100, 60_000);
  check('x-forwarded-for « a, b » accepté', rMulti.allowed);
  // 100 requêtes : la 101e d'UNE même IP doit refuser — vérifie que le multi-XFF
  // n'a pas créé une clé par appel (sinon jamais de refus).
  let refused = false;
  for (let i = 0; i < 101; i++) {
    const r = rateLimit(fakeReq('198.51.100.7, 70.41.3.18'), 'rl-test-e', 100, 60_000);
    if (!r.allowed) {
      refused = true;
      break;
    }
  }
  check('1re IP du XFF utilisée (clé stable)', refused);
  const rReal = rateLimit(fakeReq(null, '192.0.2.50'), 'rl-test-f', 1, 60_000);
  const rReal2 = rateLimit(fakeReq(null, '192.0.2.50'), 'rl-test-f', 1, 60_000);
  check('x-real-ip fallback → clé stable (2e refusé)', rReal.allowed && !rReal2.allowed);
  const rLocal1 = rateLimit(fakeReq(null), 'rl-test-g', 1, 60_000);
  const rLocal2 = rateLimit(fakeReq(null), 'rl-test-g', 1, 60_000);
  check('sans header → repli local (clé partagée, 2e refusé)', rLocal1.allowed && !rLocal2.allowed);
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} OK, ${fail} échec(s)`);
process.exitCode = fail === 0 ? 0 : 1;
