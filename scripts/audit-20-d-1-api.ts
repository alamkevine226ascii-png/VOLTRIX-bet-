// ============================================================
// Audit 20-d — Script 1 : Sécurité / API (lecture seule)
// 1. /api/matches : dates arbitraires qui passent la regex → scan 143 ligues
//    + entrée Map bodies non bornée (amplification + mémoire)
// 2. /api/bankroll/resolve : pas de cap sur legs → amplification ESPN
// 3. /api/match/[id] : injection leagueCode/date dans l'URL ESPN outbound
// 4. /api/predictions : cap 12, inputs arbitraires, pollution DB
// Toutes les frappes directes ESPN sont espacées de 250-450 ms via l'API dev.
// ============================================================

const DEV = 'http://localhost:3000';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function timedFetch(url: string, init?: RequestInit): Promise<{ status: number; ms: number; bytes: number; cache: string; body: string }> {
  const t0 = Date.now();
  const res = await fetch(url, init);
  const body = await res.text();
  return {
    status: res.status,
    ms: Date.now() - t0,
    bytes: body.length,
    cache: res.headers.get('X-Cache') ?? '-',
    body,
  };
}

async function main() {
  console.log('=== [1] /api/matches : dates arbitraires (regex ^\\d{4}-\\d{2}-\\d{2}$) ===');

  // 1a. Date TOTALEMENT invalide mais regex-conforme (mois 99)
  let r = await timedFetch(`${DEV}/api/matches?date=2026-99-99`);
  console.log(`date=2026-99-99          → HTTP ${r.status} X-Cache=${r.cache} ${r.ms}ms ${r.bytes}B totalMatches=${safeTotal(r.body)}`);
  await sleep(300);
  r = await timedFetch(`${DEV}/api/matches?date=2026-99-99`);
  console.log(`  ↳ 2e appel (cache ?)   → HTTP ${r.status} X-Cache=${r.cache} ${r.ms}ms  ← si HIT : l'entrée vivra dans la Map`);
  await sleep(300);

  // 1b. Année 9999 : scan complet à chaque nouvelle date valide
  r = await timedFetch(`${DEV}/api/matches?date=9999-12-31`);
  console.log(`date=9999-12-31         → HTTP ${r.status} X-Cache=${r.cache} ${r.ms}ms ${r.bytes}B totalMatches=${safeTotal(r.body)} (coût d'un scan à froid)`);
  await sleep(300);

  // 1c. Taille d'un corps de journée chargée (pour la projection mémoire)
  for (const d of ['2026-09-06', '2026-09-05']) {
    const x = await timedFetch(`${DEV}/api/matches?date=${d}`);
    console.log(`corps journée ${d}   → ${x.bytes} octets, ${x.ms}ms, X-Cache=${x.cache}, total=${safeTotal(x.body)}`);
    await sleep(300);
  }

  console.log('\n=== [2] /api/bankroll/resolve : PAS de cap sur legs ===');
  // 8 ligues distinctes × 1 date = 8 groupes → 7 boards par groupe (JJ±1, +2e passe JJ±2/±3 si introuvable)
  // = jusqu'à 56 requêtes ESPN pour UNE requête client. Extrapolation : N legs de N ligues → 7N fetches.
  const legs = Array.from({ length: 8 }, (_, i) => ({
    matchId: `99999${i}`,
    leagueCode: ['eng.1', 'esp.1', 'ita.1', 'ger.1', 'fra.1', 'ned.1', 'por.1', 'tur.1'][i],
    matchDate: '2026-09-07',
    market: '1X2',
    pick: 'Match nul',
  }));
  r = await timedFetch(`${DEV}/api/bankroll/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ legs }),
  });
  let verdicts: unknown[] = [];
  try {
    verdicts = JSON.parse(r.body).results;
  } catch {}
  console.log(`POST 8 legs / 8 ligues  → HTTP ${r.status} en ${r.ms} ms, ${verdicts.length} verdicts (extrapolation : 1 leg/ligue inconnue = ~7 fetches ESPN ; 1000 legs forgés = ~7000 fetches, sans limite)`);
  await sleep(300);

  // Jambes dégradées : types absurdes — l'API doit rester propre
  r = await timedFetch(`${DEV}/api/bankroll/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ legs: [{ matchId: '../../etc/passwd', leagueCode: 'eng.1/../../x', matchDate: 'garbage', market: 42, pick: null }] }),
  });
  console.log(`legs pourries (travers., date garbage) → HTTP ${r.status} ${r.ms}ms body=${r.body.slice(0, 120)}`);
  await sleep(300);

  console.log('\n=== [3] /api/match/[id] : injection dans l\'URL ESPN outbound ===');
  // leagueCode traversé → undici normalise ../ : l'hôte reste ESPN, mais le chemin arbitraire part chez ESPN
  const lg = encodeURIComponent('../../v2/sports/soccer/nfl');
  r = await timedFetch(`${DEV}/api/match/401875636?league=${lg}&date=2026-09-08T16:45Z`);
  console.log(`league traversée        → HTTP ${r.status} ${r.ms}ms body=${r.body.slice(0, 100).replace(/\n/g, ' ')}`);
  await sleep(300);
  // date garbage → dates=XXXXXXXXXX envoyé brut à ESPN
  r = await timedFetch(`${DEV}/api/match/401875636?league=ned.1&date=AAAAAAAAAA`);
  console.log(`date=AAAAAAAAAA         → HTTP ${r.status} ${r.ms}ms body=${r.body.slice(0, 100).replace(/\n/g, ' ')}`);
  await sleep(300);
  // id non numérique arbitraire
  r = await timedFetch(`${DEV}/api/match/%2E%2E%2Fboom?league=ned.1&date=2026-09-08`);
  console.log(`id=../boom              → HTTP ${r.status} ${r.ms}ms body=${r.body.slice(0, 100).replace(/\n/g, ' ')}`);
  await sleep(300);

  console.log('\n=== [4] /api/predictions : cap 12 + inputs arbitraires (pollution DB possible) ===');
  const fake = Array.from({ length: 20 }, (_, i) => ({ matchId: `audit20d_${i}`, leagueCode: 'eng.1', date: '2026-09-08T12:00Z' }));
  r = await timedFetch(`${DEV}/api/predictions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ matches: fake }),
  });
  let nResults = -1;
  try {
    nResults = JSON.parse(r.body).results.length;
  } catch {}
  console.log(`POST 20 matchs fictifs  → HTTP ${r.status} en ${r.ms} ms, résultats=${nResults} (cap 12 attendu) — rows DB insérées si status=pre`);
  await sleep(300);
  r = await timedFetch(`${DEV}/api/predictions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ matches: [{ matchId: { evil: 1 }, leagueCode: 5, date: null }] }),
  });
  console.log(`types absurdes          → HTTP ${r.status} ${r.ms}ms body=${r.body.slice(0, 140).replace(/\n/g, ' ')}`);
  await sleep(300);

  console.log('\n=== [5] Fuite d\'erreurs internes ===');
  r = await timedFetch(`${DEV}/api/match/401875636?league=zzz.fake&date=2026-09-08`);
  console.log(`ligue inexistante       → HTTP ${r.status} body=${r.body.slice(0, 140).replace(/\n/g, ' ')}`);
  console.log('\n✅ Script 1 terminé (aucune écriture dans src/).');
}

function safeTotal(body: string): number | string {
  try {
    return JSON.parse(body).totalMatches;
  } catch {
    return '?';
  }
}

main();
