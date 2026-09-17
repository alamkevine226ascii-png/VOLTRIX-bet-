// ============================================================
// VOLTRIX — Task 47 : VÉRIFICATION POST-MIGRATION sur NEON RÉEL
//
// Compare l'état actuel au baseline pré-migration :
//   - 20 tables : comptage + MD5 (listes de colonnes GELÉES du
//     baseline → les 4 nouvelles colonnes de SyncJobRun ne
//     faussent pas la comparaison) — TOUT écart = ÉCHEC ;
//   - 4 colonnes §26 : présentes, TEXT, NULLABLE ;
//   - index unique PARTIEL SyncJobRun_running_lock_uidx ;
//   - aucun doublon runningLock, aucun résidu de sonde ;
//   - triggers inchangés (comparaison au baseline) ;
//   - AUCUNE nouvelle ligne SyncJobRun (max startedAt inchangé).
//
// Usage : DATABASE_URL="postgresql://…neon…" bun scripts/t47-neon-verify-post.ts
// ============================================================

import { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const db = new PrismaClient();

if (!process.env.DATABASE_URL?.includes('neon.tech')) {
  console.error('✗ DATABASE_URL ne pointe pas vers Neon — abandon (garde-fou production)');
  process.exit(1);
}

function hashRows(rows: unknown[]): string {
  const s = JSON.stringify(rows, (_k, v) => (typeof v === 'bigint' ? Number(v) : v));
  return createHash('md5').update(s).digest('hex');
}

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function main() {
  const baseline = JSON.parse(
    readFileSync('/home/z/my-project/backups/t47-neon-baseline.json', 'utf-8')
  ) as {
    fingerprints: Record<string, { count: number; md5: string; columns: string[] }>;
    triggers: Array<{ tgname: string; relname: string }>;
    syncJobRunMaxStartedAt: string | null;
    syncJobRunTotalRows: number;
    prismaMigrationsCount: number;
  };

  console.log('━━ 1. DONNÉES EXISTANTES (20 tables, MD5 bit-à-bit sur colonnes gelées) ━━');
  let identical = 0;
  for (const [t, before] of Object.entries(baseline.fingerprints)) {
    const colList = before.columns.map((c) => `"${c}"`).join(', ');
    const rows = await db.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT ${colList} FROM "${t}" ORDER BY 1;`
    );
    const md5 = hashRows(rows);
    const ok = rows.length === before.count && md5 === before.md5;
    if (ok) identical++;
    else {
      fail++;
      console.error(`  ✗ ${t}: ${before.count}→${rows.length} lignes, md5 ${before.md5.slice(0, 8)}→${md5.slice(0, 8)} MODIFIÉ`);
    }
  }
  check(`20/20 tables BIT-À-BIT IDENTIQUES (0 ligne modifiée, 0 ligne supprimée)`, identical === 20, `${identical}/20`);

  const pmNow = await db.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*)::bigint AS n FROM "_prisma_migrations";`);
  check(`_prisma_migrations inchangée (${baseline.prismaMigrationsCount})`, Number(pmNow[0].n) === baseline.prismaMigrationsCount, `${pmNow[0].n}`);

  console.log('━━ 2. STRUCTURE §26 (4 colonnes + index unique partiel) ━━');
  const cols = await db.$queryRawUnsafe<Array<{ column_name: string; data_type: string; is_nullable: string }>>(
    `SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='SyncJobRun' AND column_name IN ('status','triggerSource','runningLock','progress') ORDER BY column_name;`
  );
  check(
    '4/4 colonnes §26 présentes, TEXT, NULLABLE (rétrocompatible worker)',
    cols.length === 4 && cols.every((c) => c.data_type === 'text' && c.is_nullable === 'YES'),
    JSON.stringify(cols)
  );

  const idx = await db.$queryRawUnsafe<Array<{ indexname: string; indexdef: string }>>(
    `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname='public' AND indexname='SyncJobRun_running_lock_uidx';`
  );
  check(
    'index unique PARTIEL présent (UNIQUE … WHERE "runningLock" IS NOT NULL)',
    idx.length === 1 && idx[0].indexdef.includes('UNIQUE') && idx[0].indexdef.toLowerCase().includes('where'),
    idx[0]?.indexdef ?? 'ABSENT'
  );

  console.log('━━ 3. PROPRIÉTÉS DU VERROU ━━');
  const dup = await db.$queryRawUnsafe<Array<{ lock: string | null; n: bigint }>>(
    `SELECT "runningLock" AS lock, count(*)::bigint AS n FROM "SyncJobRun" WHERE "runningLock" IS NOT NULL GROUP BY 1 HAVING count(*) > 1;`
  );
  check('aucun doublon de verrou (runningLock)', dup.length === 0, `${dup.length} groupe(s)`);

  const probe = await db.$queryRawUnsafe<Array<{ n: bigint }>>(
    `SELECT count(*)::bigint AS n FROM "SyncJobRun" WHERE phase = 'probe';`
  );
  check('zéro résidu de sonde (phase=probe)', Number(probe[0].n) === 0, `${probe[0].n} ligne(s)`);

  const runningNow = await db.$queryRawUnsafe<Array<{ n: bigint }>>(
    `SELECT count(*)::bigint AS n FROM "SyncJobRun" WHERE "runningLock" IS NOT NULL;`
  );
  check('aucun verrou résiduel en base (runningLock NOT NULL = 0)', Number(runningNow[0].n) === 0, `${runningNow[0].n}`);

  console.log('━━ 4. HISTORIQUE & TRIGGERS ━━');
  const lastAct = await db.$queryRawUnsafe<Array<{ mx: Date | null; n: bigint }>>(
    `SELECT max("startedAt") AS mx, count(*)::bigint AS n FROM "SyncJobRun";`
  );
  check(
    `aucune nouvelle ligne SyncJobRun (${baseline.syncJobRunTotalRows} avant)`,
    Number(lastAct[0].n) === baseline.syncJobRunTotalRows &&
      lastAct[0].mx?.toISOString() === baseline.syncJobRunMaxStartedAt,
    `${lastAct[0].n} lignes, max=${lastAct[0].mx?.toISOString()}`
  );

  const triggersNow = await db.$queryRawUnsafe<Array<{ tgname: string; relname: string }>>(
    `SELECT t.tgname, c.relname FROM pg_trigger t JOIN pg_class c ON t.tgrelid = c.oid
      JOIN pg_namespace n ON c.relnamespace = n.oid
      WHERE n.nspname = 'public' AND NOT t.tgisinternal ORDER BY c.relname, t.tgname;`
  );
  const sig = (arr: Array<{ tgname: string; relname: string }>) => arr.map((t) => `${t.relname}::${t.tgname}`).join('|');
  check(
    `10 triggers d'immutabilité §20 inchangés`,
    triggersNow.length === baseline.triggers.length && sig(triggersNow) === sig(baseline.triggers),
    `avant=${baseline.triggers.length} après=${triggersNow.length}`
  );

  console.log(`\n${pass} PASS / ${fail} FAIL`);
  if (fail > 0) process.exit(1);
  console.log('✓✓ MIGRATION PUREMENT ADDITIVE CONFIRMÉE — 0 donnée supprimée, 0 donnée modifiée');
}

main()
  .catch((e) => {
    console.error('✗', e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
