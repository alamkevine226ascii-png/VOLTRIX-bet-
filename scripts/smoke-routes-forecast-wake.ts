// ============================================================
// GO 4B — SMOKE TEST ROUTES : import des handlers hors runtime
// Next (bun direct) : vérifie que les modules de route se chargent,
// que GET/POST existent, et que le câblage post-sync est présent.
// ============================================================

import { execSync } from 'node:child_process';
import { rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as net from 'node:net';

const ROOT = path.resolve(process.cwd());
const tmpDir = mkdtempSync(path.join(tmpdir(), 'voltrix-smoke-'));
const PGBIN = path.join(ROOT, '.tmp-pg', 'pg17', 'usr', 'lib', 'postgresql', '17', 'bin');
const dataDir = path.join(tmpDir, 'pgdata');

function portIsFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, '127.0.0.1');
  });
}
let PG_PORT = 5633 + (process.pid % 50);
for (let a = 0; a < 50 && !(await portIsFree(PG_PORT)); a++) PG_PORT = 5600 + ((PG_PORT + a * 7) % 400);
const dbUrl = `postgresql://postgres@127.0.0.1:${PG_PORT}/postgres`;
process.env.DATABASE_URL = dbUrl;
process.env.DIRECT_URL = dbUrl;

execSync(`${PGBIN}/initdb -D ${dataDir} -U postgres -A trust -E UTF8 --no-locale`, { stdio: 'pipe' });
execSync(`${PGBIN}/pg_ctl -D ${dataDir} -o "-p ${PG_PORT} -c listen_addresses=127.0.0.1 -k ${tmpDir}" -l ${path.join(tmpDir, 'pg.log')} start`, { stdio: 'pipe' });
for (let i = 0; i < 50; i++) {
  try { execSync(`${PGBIN}/pg_isready -h 127.0.0.1 -p ${PG_PORT}`, { stdio: 'pipe' }); break; }
  catch { await new Promise((r) => setTimeout(r, 200)); }
}
execSync('node_modules/.bin/prisma db push --skip-generate', {
  cwd: ROOT, env: { ...process.env, DATABASE_URL: dbUrl, DIRECT_URL: dbUrl }, stdio: 'pipe',
});
const { PrismaClient } = await import('@prisma/client');
const db = new PrismaClient({ datasources: { db: { url: dbUrl } } });
await db.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "ForecastJobRun_running_lock_uidx" ON "ForecastJobRun"("runningLock") WHERE "runningLock" IS NOT NULL`);

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}

console.log('━━ SMOKE — modules de route (chargement hors runtime Next) ━━');

// 1) La nouvelle route forecast wake se charge et expose GET + POST.
const fwRoute = await import('../src/app/api/forecasts/wake/route');
check('/api/forecasts/wake : GET (cron Vercel) + POST (manuel) exportés', typeof fwRoute.GET === 'function' && typeof fwRoute.POST === 'function');

// 2) La route sync wake se charge toujours (non cassée par le trigger post-sync).
const syncRoute = await import('../src/app/api/sync/wake/route');
check('/api/sync/wake : GET + POST toujours exportés (diff additif uniquement)', typeof syncRoute.GET === 'function' && typeof syncRoute.POST === 'function');

// 3) Le câblage post-sync est présent dans le source de la route sync.
const syncRouteSrc = await import('node:fs').then((fs) => fs.readFileSync(path.join(ROOT, 'src/app/api/sync/wake/route.ts'), 'utf8'));
check('câblage post-sync : import runForecastWakeChainUntilDone présent', syncRouteSrc.includes("from '@/lib/forecast/wake'"));
check('câblage post-sync : déclenchement après succès direct (schedulePostSyncForecastWake)', syncRouteSrc.includes("schedulePostSyncForecastWake(t0);"));
check('câblage post-sync : déclenchement après succès de la chaîne', syncRouteSrc.includes("if (chain.ended === 'success')"));

// 4) GET /api/forecasts/wake en conditions réelles (hors Next) :
//    données vides → complete, réponse JSON propre, after() hors contexte
//    toléré (warning) — NE casse PAS la requête.
const res = await fwRoute.GET();
const body = await res.json();
check('GET /api/forecasts/wake (base vide) : HTTP 200', res.status === 200);
check('GET /api/forecasts/wake : { started:false, reason:\'complete\' } — no-op idempotent', body.started === false && body.reason === 'complete' && body.ok === true, JSON.stringify(body));

// 5) POST : même comportement idempotent.
const resPost = await fwRoute.POST();
const bodyPost = await resPost.json();
check('POST /api/forecasts/wake : HTTP 200 + complete (idempotent)', resPost.status === 200 && bodyPost.reason === 'complete');

// 6) Le pipeline n'a créé AUCUNE ligne de job pour un no-op.
const jobs = await db.forecastJobRun.count();
check('no-op complet : 0 ligne ForecastJobRun créée (0 écriture)', jobs === 0, `${jobs} lignes`);

await db.$disconnect();
try { execSync(`${PGBIN}/pg_ctl -D ${dataDir} stop -m immediate`, { stdio: 'pipe' }); } catch {}
rmSync(tmpDir, { recursive: true, force: true });

console.log(`\nRÉSULTAT SMOKE : ${pass} ✓ / ${fail} ✗`);
if (fail > 0) process.exit(1);
