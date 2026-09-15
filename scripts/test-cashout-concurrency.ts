// Test de la concurrence bornée du cash-out (Task 21-c) — exécuter : bun scripts/test-cashout-concurrency.ts
// SANS réseau lourd : (1) vérification statique que /api/cashout a bien
// remplacé Promise.all par mapWithConcurrency(…, 4, …) sur les groupes
// (ligue,date) ; (2) preuve dynamique que mapWithConcurrency borne le
// nombre de tâches simultanées à la limite (compteur d'in-flight) —
// c'est le même utilitaire que celui utilisé par la route.
import { readFileSync } from 'node:fs';
import { mapWithConcurrency } from '../src/lib/cache';

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

console.log('— Statique : src/app/api/cashout/route.ts —');
{
  const src = readFileSync(new URL('../src/app/api/cashout/route.ts', import.meta.url), 'utf8');
  check('import mapWithConcurrency de @/lib/cache', /import\s*\{\s*mapWithConcurrency\s*\}\s*from\s*'@\/lib\/cache'/.test(src));
  check('appelle mapWithConcurrency sur groups.entries()', /mapWithConcurrency\(\s*Array\.from\(groups\.entries\(\)\),/.test(src));
  check('concurrence = 4', /mapWithConcurrency\(\s*Array\.from\(groups\.entries\(\)\),\s*4,/.test(src));
  check('plus aucun Promise.all non borné sur les groupes', !/Promise\.all\(\s*Array\.from\(groups\.entries\(\)\)/.test(src));
  // Le repli feuille J−1 (Task 19-a) et l'écriture boards.set restent intacts
  check('repli J−1 conservé (loadBoard leagueCode, prevDate)', /loadBoard\(leagueCode,\s*prevDate,\s*byId\)/.test(src));
  check('boards.set(key, byId) conservé', /boards\.set\(key,\s*byId\)/.test(src));
}

console.log('— Dynamique : mapWithConcurrency borne la concurrence —');
{
  let inFlight = 0;
  let maxInFlight = 0;
  const LIMIT = 4;
  const TASKS = 24; // > LIMIT : plusieurs vagues nécessaires
  const order: number[] = [];
  const started = Date.now();
  const results = await mapWithConcurrency(Array.from({ length: TASKS }, (_, i) => i), LIMIT, async (n) => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 10));
    inFlight--;
    order.push(n);
    return n * 2;
  });
  const elapsed = Date.now() - started;
  check('tous les résultats présents', results.length === TASKS && results.every((v, i) => v === i * 2));
  check('ordre d’itération préservé', order.every((v, i) => v === i), `got ${order.slice(0, 6).join(',')}`);
  check(`concurrence max ≤ ${LIMIT} (observé ${maxInFlight})`, maxInFlight <= LIMIT && maxInFlight > 1);
  // 24 tâches de ~10 ms à concurrence 4 ⇒ ≥ ~60 ms ; si tout était séquentiel ⇒ ~240 ms.
  check('exécution réellement parallèle (24×10ms < 200 ms)', elapsed < 200, `${elapsed} ms`);
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} OK, ${fail} échec(s)`);
process.exitCode = fail === 0 ? 0 : 1;
