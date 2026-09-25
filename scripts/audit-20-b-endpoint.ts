// Audit 20-b — Tests E2E du endpoint /api/bankroll/resolve (dev :3000).
// Scénarios : match LIVE → PENDING (garde VOID), Utrecht replanifié → VOID via
// 2e passe ±3, orphelin sans leagueCode → FALLBACK_LEAGUES (passe 1 et passe 2),
// grading FT, idempotence double POST, chronométrage du pire cas orphelin froid.
// Endpoint STATELESS (aucune écriture serveur) — aucun pari placé, aucun crédit.
const BASE = 'http://localhost:3000/api/bankroll/resolve';
let failures = 0;
const check = (label: string, cond: boolean, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'} — ${label}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures++;
};
interface Verdict { matchId: string; market: string; pick: string; status: string; score: string | null }

async function post(legs: unknown[]): Promise<{ status: number; body: { results: Verdict[] } | { error: string }; ms: number }> {
  const t0 = Date.now();
  const res = await fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ legs }),
  });
  const body = await res.json();
  return { status: res.status, body, ms: Date.now() - t0 };
}
const find = (body: { results?: Verdict[] }, matchId: string) => (body.results ?? []).find((r) => r.matchId === matchId);

// ---------- 1. Match EN DIRECT réel (usa.ncaa.m.1 #401898555, in/15') ----------
console.log('=== 1. Match LIVE (in) → PENDING, jamais VOID/WIN/LOSE ===');
const liveLeg = {
  matchId: '401898555',
  leagueCode: 'usa.ncaa.m.1',
  matchDate: '2026-09-07', // board nocturne JJ-1 (kickoff 2026-09-08T02:00Z)
  market: '1X2',
  pick: 'Victoire Grand Canyon',
};
const r1 = await post([liveLeg]);
console.log(`HTTP ${r1.status} en ${r1.ms} ms :`, JSON.stringify(find(r1.body, '401898555')));
check('match LIVE → verdict PENDING', r1.status === 200 && find(r1.body, '401898555')?.status === 'PENDING');

// ---------- 2. Utrecht #401875619 replanifié 0905→0908 (2e passe groupes) ----------
console.log('\n=== 2. Utrecht (replanifié +3 j) → 2e passe groupes → VOID ===');
const utrechtLeg = {
  matchId: '401875619',
  leagueCode: 'ned.1',
  matchDate: '2026-09-05', // date ORIGINALE stockée ; match vit maintenant sur board 0908
  market: 'O/U 2.5',
  pick: 'Plus de 2.5',
};
const r2 = await post([utrechtLeg]);
console.log(`HTTP ${r2.status} en ${r2.ms} ms :`, JSON.stringify(find(r2.body, '401875619')));
const ut = find(r2.body, '401875619');
check('Utrecht trouvé via 2e passe (+3 j) et gradé', ut !== undefined && ut.status !== 'PENDING', JSON.stringify(ut));
// ESPN affiche state=post + detail='Suspended' (score figé 1-3) → le garde NOT_PLAYED
// doit donner VOID, JAMAIS un WIN/LOSE calculé sur le score fictif.
check('statut exotique post+Suspended → VOID (score non gradé)', ut?.status === 'VOID', `score=${ut?.score}`);

// ---------- 3. Même jambe SANS leagueCode (orpheline) ----------
console.log('\n=== 3. Orpheline sans leagueCode → FALLBACK_LEAGUES (passe 2 +3 j) ===');
const orphanUtrecht = { ...utrechtLeg, leagueCode: '' };
const r3 = await post([orphanUtrecht]);
console.log(`HTTP ${r3.status} en ${r3.ms} ms :`, JSON.stringify(find(r3.body, '401875619')));
check('orpheline Utrecht rattrapée par FALLBACK_LEAGUES → VOID', find(r3.body, '401875619')?.status === 'VOID');

// Orpheline rattrapée dès la passe 1 (offset 0) : bra.1 #401841222 Vitória-Grêmio (FT 1-0 le 06/09)
// NB : Grêmio est À L'EXTÉRIEUR → pick 'Victoire Grêmio' attendu LOSE (le grading
// sait identifier le côté par le nom, preuve inverse utile).
const orphanFT = { matchId: '401841222', leagueCode: '', matchDate: '2026-09-06', market: '1X2', pick: 'Victoire Grêmio' };
const r3b = await post([orphanFT]);
console.log(`orpheline FT passe 1 :`, JSON.stringify(find(r3b.body, '401841222')));
check('orpheline rattrapée dès la passe 1 → LOSE (pick extérieur sur 1-0)', find(r3b.body, '401841222')?.status === 'LOSE', JSON.stringify(find(r3b.body, '401841222')));

// ---------- 4. Grading FT de référence (avec ligue) ----------
console.log('\n=== 4. Grading FT référence ===');
const ftLeg = { matchId: '401841222', leagueCode: 'bra.1', matchDate: '2026-09-06', market: '1X2', pick: 'Victoire Vitória' };
const r4 = await post([ftLeg]);
console.log(`HTTP ${r4.status} :`, JSON.stringify(find(r4.body, '401841222')));
check('Vitória (dom.) 1-0 → WIN + score exact', find(r4.body, '401841222')?.status === 'WIN' && find(r4.body, '401841222')?.score === '1 - 0');

// ---------- 5. Introuvables → PENDING (nom inconnu, marché inconnu) ----------
console.log('\n=== 5. Cas limites ===');
const r5 = await post([
  { matchId: '999999999', leagueCode: 'eng.1', matchDate: '2026-09-06', market: '1X2', pick: 'Victoire X' },
  { matchId: '401841222', leagueCode: 'bra.1', matchDate: '2026-09-06', market: 'Marché inconnu', pick: 'Zz' },
  { matchId: '401841222', leagueCode: 'bra.1', matchDate: '2026-09-06', market: '1X2', pick: 'Victoire Équipe Qui Nexiste Pas' },
]);
const vUnk = find(r5.body, '999999999');
const vUnkMkt = (r5.body.results ?? []).find((x) => x.matchId === '401841222' && x.market === 'Marché inconnu');
const vUnkName = (r5.body.results ?? []).find((x) => x.matchId === '401841222' && x.pick.startsWith('Victoire Équipe'));
check('matchId inconnu → PENDING', vUnk?.status === 'PENDING');
check('marché inconnu → PENDING (jamais VOID arbitraire)', vUnkMkt?.status === 'PENDING', JSON.stringify(vUnkMkt));
check('nom de pick non reconnu → PENDING (on ne devine pas)', vUnkName?.status === 'PENDING', JSON.stringify(vUnkName));

// ---------- 6. Idempotence : double POST (séquentiel + simultané) ----------
console.log('\n=== 6. Idempotence double POST ===');
const batch = [liveLeg, utrechtLeg, orphanUtrecht, orphanFT, ftLeg];
const ra = await post(batch);
const rb = await post(batch);
const same = JSON.stringify(ra.body.results) === JSON.stringify(rb.body.results);
check('double POST séquentiel → réponses identiques', ra.status === 200 && rb.status === 200 && same);
const [rc, rd] = await Promise.all([post(batch), post(batch)]);
check('double POST simultané → réponses identiques', JSON.stringify(rc.body.results) === JSON.stringify(rd.body.results));
check('2e passe rejouée → Utrecht toujours VOID (pas de bascule WIN/LOSE)', find(rb.body, '401875619')?.status === 'VOID');

// ---------- 7. Pire cas orphelin : date froide introuvable (95 fetch ESPN) ----------
console.log('\n=== 7. Performance : orphelin sur date froide (passe 1 : 19 ligues × 3 offsets, passe 2 : 19 × 2) ===');
const t0 = Date.now();
const r7 = await post([{ matchId: '999999999', leagueCode: '', matchDate: '2026-09-20' }]);
const cold = Date.now() - t0;
console.log(`1er POST (cache froid) : ${cold} ms → status=${find(r7.body, '999999999')?.status}`);
check('leg orpheline introuvable partout → PENDING', find(r7.body, '999999999')?.status === 'PENDING');
const t1 = Date.now();
await post([{ matchId: '999999999', leagueCode: '', matchDate: '2026-09-20' }]);
const warm = Date.now() - t1;
console.log(`2e POST (cache chaud 10 min) : ${warm} ms`);
check('cache rend le re-scan gratuit (< 1 s)', warm < 1000, `${warm} ms vs ${cold} ms froid`);
check('aucun 429/dégradation visible sur le burst de 95 fetch', r7.status === 200);

// ---------- 8. GET /api/performance (drain, lecture) ----------
console.log('\n=== 8. GET /api/performance ===');
const t2 = Date.now();
const perf = await fetch('http://localhost:3000/api/performance');
const perfBody = (await perf.json()) as { newlyResolved: number; pendingCount: number; totalResolved: number };
console.log(`HTTP ${perf.status} en ${Date.now() - t2} ms : newlyResolved=${perfBody.newlyResolved} pendingCount=${perfBody.pendingCount} totalResolved=${perfBody.totalResolved}`);
check('GET /api/performance 200', perf.status === 200);

console.log(`\n=== audit-20-b-endpoint : ${failures === 0 ? 'ALL PASS' : failures + ' FAIL'} ===`);
process.exit(failures === 0 ? 0 : 1);
