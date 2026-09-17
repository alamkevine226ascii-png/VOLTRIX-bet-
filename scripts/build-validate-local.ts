// ============================================================
// GO 4B — BUILD DE VALIDATION : prisma migrate deploy + next build
// contre un PostgreSQL 17 local ÉPHÉMÈRE (jamais Neon).
// Valide :
//   1. la migration 20260917000100_forecast_job_lock s'applique via
//      `prisma migrate deploy` (LE mécanisme du build Vercel) ;
//   2. l'application compile intégralement (routes, imports, types).
// ============================================================

import { execSync } from 'node:child_process';
import { rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as net from 'node:net';

const ROOT = path.resolve(process.cwd());
const tmpDir = mkdtempSync(path.join(tmpdir(), 'voltrix-build-'));
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

try {
  // 1) migrate deploy — exactement ce que fait le build Vercel.
  console.log('→ prisma migrate deploy (mécanisme du build Vercel)…');
  execSync('bunx prisma migrate deploy', { cwd: ROOT, stdio: 'inherit', env: { ...process.env, DATABASE_URL: dbUrl, DIRECT_URL: dbUrl } });
  console.log('  ✓ migrations appliquées (dont 20260917000100_forecast_job_lock)');

  // 1b) Idempotence : re-run = no-op.
  execSync('bunx prisma migrate deploy', { cwd: ROOT, stdio: 'inherit', env: { ...process.env, DATABASE_URL: dbUrl, DIRECT_URL: dbUrl } });
  console.log('  ✓ migrate deploy ré-exécuté sans erreur (idempotent)');

  // 1c) Colonnes + index présents après migrate deploy.
  const { PrismaClient } = await import('@prisma/client');
  const db = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  const cols = await db.$queryRawUnsafe<Array<{ column_name: string }>>(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'ForecastJobRun' AND column_name IN ('status','triggerSource','runningLock','progress') ORDER BY 1;`
  );
  const idx = await db.$queryRawUnsafe<Array<{ indexname: string }>>(
    `SELECT indexname FROM pg_indexes WHERE schemaname='public' AND indexname='ForecastJobRun_running_lock_uidx';`
  );
  if (cols.length !== 4 || idx.length !== 1) throw new Error(`post-migrate KO (cols=${cols.length}, idx=${idx.length})`);
  console.log('  ✓ 4 colonnes + index unique partiel vérifiés en base');
  await db.$disconnect();

  // 2) next build (compile toute l'app : routes API, lib, types).
  console.log('→ next build…');
  execSync('bunx next build', { cwd: ROOT, stdio: 'inherit', timeout: 540_000, env: { ...process.env, DATABASE_URL: dbUrl, DIRECT_URL: dbUrl } });
  console.log('  ✓ build complet OK');
  console.log('\n✓ BUILD DE VALIDATION RÉUSSI (migrate deploy + next build)');
} finally {
  try { execSync(`${PGBIN}/pg_ctl -D ${dataDir} stop -m immediate`, { stdio: 'pipe' }); } catch {}
  rmSync(tmpDir, { recursive: true, force: true });
}
