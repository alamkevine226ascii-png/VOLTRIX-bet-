// ============================================================
// Audit 19-c — Comportements de résilience d'espnFetch/cached() en réel :
// 1. Code mort (HTTP 400) → PAS de retry (leçon kor.1) → latence ~1 RTT.
// 2. Poison-cache : le null d'échec n'est conservé que 15 s.
// Exécution : bun scripts/audit-19-c-resilience.ts
// ============================================================

import { fetchScoreboard } from '../src/lib/espn';

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function timed(label: string, fn: () => Promise<unknown>) {
  const t = Date.now();
  const v = await fn();
  console.log(`${label}: ${Date.now() - t} ms → ${v === null ? 'null' : 'données'}`);
  return { ms: Date.now() - t, v };
}

async function main() {
  const dead = 'kor.1'; // retirée du catalogue Task 13 : HTTP 400 systématique chez ESPN

  console.log('=== 1. Code mort : pas de retry sur 4xx permanent ===');
  const a = await timed(`1er appel ${dead} (attendu : ~1 RTT, PAS ~2x)`, () =>
    fetchScoreboard(dead, '2026-09-08')
  );
  await timed(`2e appel ${dead} (poison-cache hit, attendu ~0 ms)`, () => fetchScoreboard(dead, '2026-09-08'));

  console.log('\n=== 2. Poison-cache : expiration après ~15 s ===');
  console.log('attente 16 s…');
  await sleep(16_000);
  const c = await timed(`3e appel ${dead} (attendu : re-fetch réseau, > 50 ms)`, () =>
    fetchScoreboard(dead, '2026-09-08')
  );

  console.log('\n=== LECTURE ===');
  console.log(
    a.ms < 700
      ? `✓ 1er appel ${a.ms} ms = une seule tentative (pas de retry 400)`
      : `⚠ 1er appel ${a.ms} ms — suggère un retry payé sur 400 (régression leçon kor.1 ?)`
  );
  console.log(
    c.ms > 50
      ? `✓ 3e appel ${c.ms} ms = le poison-cache 15 s a bien expiré (re-fetch effectif)`
      : `⚠ 3e appel ${c.ms} ms = encore en cache (poison-cache plus long que 15 s ?)`
  );
}

main();
