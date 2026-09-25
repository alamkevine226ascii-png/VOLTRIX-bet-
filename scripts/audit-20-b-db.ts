// Audit 20-b — Lecture READ-ONLY de la DB (db/custom.db) via bun:sqlite
// Vérifie le cas Utrecht #401875619 + l'état VOID/PENDING global.
// AUCUNE écriture : ouverture en mode readonly + fileMustExist.
import { Database } from 'bun:sqlite';

const DB_PATH = '/home/z/my-project/db/custom.db';
// mode 1 = SQLITE_OPEN_READONLY
const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });

let failures = 0;
const check = (label: string, cond: boolean, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'} — ${label}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures++;
};

console.log('=== 1. Schéma (tables) ===');
const tables = db.query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as Array<{ name: string }>;
console.log(tables.map((t) => t.name).join(', '));

console.log('\n=== 2. Cas Utrecht ned.1 #401875619 ===');
const utrecht = db
  .query("SELECT id, matchId, league, leagueName, market, pick, resolved, result, matchDate, odds FROM Prediction WHERE matchId = '401875619'")
  .all() as Array<Record<string, unknown>>;
if (utrecht.length === 0) {
  console.log('Aucune ligne Prediction pour matchId 401875619');
  failures++;
} else {
  for (const r of utrecht) {
    console.log(JSON.stringify(r));
  }
  const allVoid = utrecht.every((r) => r.resolved === 1 && r.result === 'VOID');
  check(`Utrecht #401875619 : ${utrecht.length} pronos tous resolved=VOID`, allVoid);
}

console.log('\n=== 3. Comptage global resolved / result ===');
const counts = db
  .query('SELECT resolved, result, COUNT(*) as n FROM Prediction GROUP BY resolved, result ORDER BY resolved, result')
  .all() as Array<{ resolved: number; result: string; n: number }>;
for (const c of counts) console.log(`resolved=${c.resolved} result=${String(c.result).padEnd(8)} n=${c.n}`);
const total = counts.reduce((a, c) => a + c.n, 0);
const resolvedAll = counts.filter((c) => c.resolved === 1).reduce((a, c) => a + c.n, 0);
const voidAll = counts.filter((c) => c.resolved === 1 && c.result === 'VOID').reduce((a, c) => a + c.n, 0);
console.log(`total=${total} resolved=${resolvedAll} dont VOID=${voidAll}`);

console.log('\n=== 4. Pronos PENDING sortis de la fenêtre 10 j (zombies potentiels) ===');
// NB : Prisma/SQLite stocke DateTime en EPOCH MILLISECONDS (INTEGER) —
// comparer à datetime('now') (TEXT) est faux (ordre de types SQLite : tout
// entier < tout texte). On compare en ms.
const nowMs = Date.now();
const cutoff = nowMs - 10 * 86_400_000;
const zombies = db
  .query('SELECT COUNT(*) as n, MIN(matchDate) as oldest, MAX(matchDate) as newest FROM Prediction WHERE resolved = 0 AND matchDate < ?')
  .get(cutoff) as { n: number; oldest: number | null; newest: string | null };
const iso = (ms: number | null) => (ms ? new Date(ms).toISOString() : '—');
console.log(JSON.stringify({ ...zombies, oldestISO: iso(zombies.oldest as unknown as number) }));
check(
  '0 prono PENDING plus vieux que 10 jours (hors fenêtre de drain = zombie définitif)',
  zombies.n === 0,
  `n=${zombies.n} oldest=${iso(zombies.oldest as unknown as number)}`
);

console.log('\n=== 4b. PENDING plus vieux que maintenant-3h (drainables) vs futurs ===');
const old3h = db
  .query('SELECT COUNT(*) as n FROM Prediction WHERE resolved = 0 AND matchDate < ?')
  .get(nowMs - 3 * 3600 * 1000) as { n: number };
const future = db
  .query('SELECT COUNT(*) as n, MIN(matchDate) as oldest FROM Prediction WHERE resolved = 0 AND matchDate >= ?')
  .get(nowMs - 3 * 3600 * 1000) as { n: number; oldest: number | null };
console.log(`drainables (< now-3h) : ${old3h.n} | futurs (>= now-3h) : ${future.n} (plus ancien futur ${iso(future.oldest as unknown as number)})`);

console.log('\n=== 5. PENDING dans la fenêtre (échantillon par ligue, top 12) ===');
const pend = db
  .query(
    "SELECT league, COUNT(*) as n FROM Prediction WHERE resolved = 0 GROUP BY league ORDER BY n DESC LIMIT 12"
  )
  .all() as Array<{ league: string; n: number }>;
console.log(pend.map((p) => `${p.league || '(vide)'}: ${p.n}`).join(' | '));

console.log('\n=== 6. Tous les VOID (détail) ===');
const voids = db
  .query("SELECT matchId, league, leagueName, market, pick, matchDate FROM Prediction WHERE resolved = 1 AND result = 'VOID' ORDER BY matchDate")
  .all() as Array<Record<string, unknown>>;
for (const v of voids) console.log(`${v.league}/${v.matchId} ${v.matchDate} ${v.market} « ${v.pick} »`);

db.close();
console.log(`\n=== audit-20-b-db : ${failures === 0 ? 'ALL PASS' : failures + ' FAIL'} ===`);
process.exit(failures === 0 ? 0 : 1);
