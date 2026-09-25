// ============================================================
// Audit 19-c — Preuve empirique du fix UA (Task 17) SOUS LE RUNTIME BUN.
// Exécution : bun scripts/audit-19-c-bunfetch.ts   (PAS node)
// Aucune écriture dans src/ — lecture seule.
// ============================================================

// Import du VRAI client du repo (le chemin @/lib/espn passe aussi via
// tsconfig, mais on reste explicite en relatif pour éviter toute surprise).
import { fetchScoreboard, fetchStandings } from '../src/lib/espn';

const URL_ENG = 'https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard?dates=20260905';
const UA_FIX = 'curl/8.5.0';

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function rawBunFetch(label: string, url: string, headers?: Record<string, string>) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, { headers: headers ?? {}, cache: 'no-store' as RequestCache });
    const body = await res.text();
    let events = -1;
    try {
      events = (JSON.parse(body)?.events ?? []).length;
    } catch {
      /* corps non-JSON (page Akamai 403) */
    }
    console.log(
      `[raw-bun] ${label}: HTTP ${res.status}, events=${events}, ${Date.now() - t0} ms, ` +
        `headers-envoyés=${JSON.stringify(headers ?? {})}`
    );
    return res.status;
  } catch (e) {
    console.log(`[raw-bun] ${label}: EXCEPTION ${(e as Error).message}`);
    return -1;
  }
}

async function main() {
  console.log('=== Runtime ===');
  console.log('UA-agent processus:', navigator.userAgent, '| Bun:', typeof Bun !== 'undefined' ? Bun.version : 'non-Bun');

  console.log('\n=== A. Reproduction du bug prod (fetch Bun SANS UA explicite — comportement pre-fix) ===');
  const stA = await rawBunFetch('fetch() nu, UA par défaut (Bun/x)', URL_ENG);

  await sleep(450);

  console.log('\n=== B. Fetch Bun avec UA explicite curl/8.5.0 (le fix) ===');
  const stB = await rawBunFetch('fetch() + UA curl/8.5.0', URL_ENG, {
    Accept: 'application/json',
    'User-Agent': UA_FIX,
  });

  await sleep(450);

  console.log('\n=== C. VRAI chemin du repo : espnFetch (UA curl/8.5.0) via fetchScoreboard ===');
  const t0 = Date.now();
  const sb = await fetchScoreboard('eng.1', '2026-09-05');
  console.log(
    `fetchScoreboard('eng.1','2026-09-05') → ${
      sb ? `${sb.events.length} events, leagueName="${sb.leagueName}"` : 'NULL (échec!)'
    } en ${Date.now() - t0} ms`
  );

  await sleep(450);

  const t1 = Date.now();
  const sbToday = await fetchScoreboard('bra.1', '2026-09-08');
  console.log(
    `fetchScoreboard('bra.1','2026-09-08') → ${
      sbToday ? `${sbToday.events.length} events, leagueName="${sbToday.leagueName}"` : 'NULL (échec!)'
    } en ${Date.now() - t1} ms`
  );

  await sleep(450);

  console.log('\n=== D. Bonus : fetchStandings (fusion children, fix 17-d) sous Bun ===');
  const t2 = Date.now();
  const standings = await fetchStandings('eng.1', 2025);
  console.log(
    `fetchStandings('eng.1', 2025) → ${
      standings ? `${standings.length} équipes` : 'NULL (échec!)'
    } en ${Date.now() - t2} ms`
  );

  console.log('\n=== VERDICT ===');
  const ok =
    stA === 403 && stB === 200 && sb !== null && sb.events.length > 0 && standings !== null && standings.length > 0;
  console.log(
    ok
      ? 'CONFIRMÉ : sans UA → 403 sous Bun ; UA curl/8.5.0 → 200 ; espnFetch (UA explicite) renvoie des données réelles sous Bun. Fix Task 17 opérationnel en prod bun.'
      : 'RÉGRESSION / résultat inattendu — voir lignes ci-dessus.'
  );
}

main();
