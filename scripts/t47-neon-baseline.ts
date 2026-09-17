// ============================================================
// VOLTRIX — Task 47 : BASELINE PRÉ-MIGRATION sur NEON RÉEL
//
// Capture l'état COMPLET de la base de production AVANT
// l'application de la migration Wake-on-Demand :
//   - TOUTES les tables du schéma public (sauf _prisma_migrations,
//     comptée à part) : comptage + empreinte MD5 ligne-à-ligne avec
//     liste de colonnes GELÉE (shape-stable → la comparaison
//     post-migration ne peut pas être faussée par les 4 nouvelles
//     colonnes de SyncJobRun) ;
//   - structure SyncJobRun (colonnes — preuve que les 4 colonnes
//     §26 sont ABSENTES avant migration) + index existants ;
//   - inventaire COMPLET des triggers (§20 + §20bis) ;
//   - activité SyncJobRun (max startedAt → preuve d'absence
//     d'écriture concurrente worker pendant la fenêtre).
//
// Artefact : backups/t47-neon-baseline.json (dossier HORS Git).
// Usage : DATABASE_URL="postgresql://…neon…" bun scripts/t47-neon-baseline.ts
// ============================================================

import { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';

const db = new PrismaClient();

// Garde-fou production : ce script NE DOIT tourner que sur le Neon réel.
if (!process.env.DATABASE_URL?.includes('neon.tech')) {
  console.error('✗ DATABASE_URL ne pointe pas vers Neon — abandon (garde-fou production)');
  process.exit(1);
}

function hashRows(rows: unknown[]): string {
  const s = JSON.stringify(rows, (_k, v) => (typeof v === 'bigint' ? Number(v) : v));
  return createHash('md5').update(s).digest('hex');
}

async function main() {
  // 1) Tables du schéma public
  const tablesRes = await db.$queryRawUnsafe<Array<{ tablename: string }>>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE '\\_%' ORDER BY 1;`
  );
  const tables = tablesRes.map((t) => t.tablename);
  console.log(`→ ${tables.length} tables détectées : ${tables.join(', ')}`);

  const fingerprints: Record<string, { count: number; md5: string; columns: string[] }> = {};
  for (const t of tables) {
    // Colonnes gelées (ordre physique) — garantit une comparaison shape-stable
    const colsRes = await db.$queryRawUnsafe<Array<{ column_name: string }>>(
      `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position;`,
      t
    );
    const cols = colsRes.map((c) => `"${c.column_name}"`);
    const rows = await db.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT ${cols.join(', ')} FROM "${t}" ORDER BY 1;`
    );
    fingerprints[t] = { count: rows.length, md5: hashRows(rows), columns: colsRes.map((c) => c.column_name) };
    console.log(`  · ${t.padEnd(24)} ${String(rows.length).padStart(6)} lignes  md5=${fingerprints[t].md5.slice(0, 10)}…`);
  }

  // _prisma_migrations comptée à part (journal des migrations — ne doit pas bouger ici)
  const pm = await db.$queryRawUnsafe<Array<{ n: bigint }>>(
    `SELECT count(*)::bigint AS n FROM "_prisma_migrations";`
  );

  // 2) Structure SyncJobRun AVANT migration (preuve : colonnes §26 absentes)
  const sjrCols = await db.$queryRawUnsafe<Array<{ column_name: string; data_type: string; is_nullable: string }>>(
    `SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='SyncJobRun' ORDER BY ordinal_position;`
  );
  const sjrIndexes = await db.$queryRawUnsafe<Array<{ indexname: string; indexdef: string }>>(
    `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='SyncJobRun' ORDER BY 1;`
  );
  console.log(`→ SyncJobRun colonnes AVANT : ${sjrCols.map((c) => c.column_name).join(', ')}`);
  const hasWakeCols = sjrCols.some((c) => ['status', 'triggerSource', 'runningLock', 'progress'].includes(c.column_name));
  console.log(`  ${hasWakeCols ? '✗ colonnes §26 DÉJÀ présentes (inattendu)' : '✓ colonnes §26 absentes (état pré-migration confirmé)'}`);

  // 3) Triggers (inventaire complet, hors internes)
  const triggers = await db.$queryRawUnsafe<Array<{ tgname: string; relname: string }>>(
    `SELECT t.tgname, c.relname FROM pg_trigger t JOIN pg_class c ON t.tgrelid = c.oid
      JOIN pg_namespace n ON c.relnamespace = n.oid
      WHERE n.nspname = 'public' AND NOT t.tgisinternal ORDER BY c.relname, t.tgname;`
  );
  console.log(`→ ${triggers.length} triggers (non internes) :`);
  for (const tr of triggers) console.log(`  - ${tr.relname} :: ${tr.tgname}`);

  // 4) Activité SyncJobRun (détection d'écritures concurrentes)
  const lastAct = await db.$queryRawUnsafe<Array<{ mx: Date | null; n: bigint }>>(
    `SELECT max("startedAt") AS mx, count(*)::bigint AS n FROM "SyncJobRun";`
  );
  console.log(`→ SyncJobRun : ${lastAct[0].n} lignes, dernière activité ${lastAct[0].mx?.toISOString() ?? 'jamais'}`);

  // 5) Artefact JSON (HORS Git — backups/ ignoré)
  mkdirSync('/home/z/my-project/backups', { recursive: true });
  const artifact = {
    capturedAt: new Date().toISOString(),
    database: 'neon (production)',
    pgVersion: (await db.$queryRawUnsafe<Array<{ v: string }>>(`SELECT version() AS v;`))[0].v,
    tables,
    fingerprints,
    prismaMigrationsCount: Number(pm[0]?.n ?? -1),
    syncJobRunColumnsBefore: sjrCols,
    syncJobRunIndexesBefore: sjrIndexes,
    triggers,
    syncJobRunMaxStartedAt: lastAct[0].mx?.toISOString() ?? null,
    syncJobRunTotalRows: Number(lastAct[0].n),
  };
  const out = '/home/z/my-project/backups/t47-neon-baseline.json';
  writeFileSync(out, JSON.stringify(artifact, null, 2));
  console.log(`\n✓ baseline écrite → ${out} (hors Git)`);
}

main()
  .catch((e) => {
    console.error('✗', e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
