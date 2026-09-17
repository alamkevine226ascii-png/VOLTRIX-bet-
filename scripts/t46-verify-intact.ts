// ============================================================
// VOLTRIX — Task 46 : VÉRIFICATION POST-MIGRATION — données intactes
// Compare les comptages + empreintes MD5 de chaque table au baseline
// capturé AVANT la migration. TOUT écart = échec.
// Usage : DATABASE_URL=… bun scripts/t46-verify-intact.ts
// ============================================================

import { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const db = new PrismaClient();

function hashRows(rows: unknown[]): string {
  const s = JSON.stringify(rows, (_k, v) => (typeof v === 'bigint' ? Number(v) : v));
  return createHash('md5').update(s).digest('hex');
}

async function tableFingerprint(name: string): Promise<{ count: number; md5: string }> {
  const rows = await db.$queryRawUnsafe<Record<string, unknown>[]>(`SELECT * FROM "${name}" ORDER BY 1`);
  return { count: rows.length, md5: hashRows(rows) };
}

async function main() {
  const baseline: Record<string, { count: number; md5: string }> = JSON.parse(
    readFileSync('/home/z/my-project/scripts/t46-baseline.json', 'utf-8')
  );
  let fail = 0;
  console.log('→ Comparaison post-migration (baseline pré-migration vs état actuel) :');
  for (const [t, before] of Object.entries(baseline)) {
    const after = await tableFingerprint(t);
    const ok = after.count === before.count && after.md5 === before.md5;
    if (!ok) fail++;
    console.log(`  ${ok ? '✓' : '✗'} ${t.padEnd(22)} count ${before.count} → ${after.count}  md5 ${before.md5.slice(0, 8)} → ${after.md5.slice(0, 8)}  ${ok ? 'IDENTIQUE' : 'MODIFIÉ !'}`);
  }

  // Doublons : aucun (par construction l'index interdit 2 RUNNING, et la mire n'a pas de doublon)
  const dup = await db.$queryRawUnsafe<Array<{ lock: string | null; n: bigint }>>(
    `SELECT "runningLock" AS lock, count(*)::bigint AS n FROM "SyncJobRun" WHERE "runningLock" IS NOT NULL GROUP BY 1 HAVING count(*) > 1;`
  );
  console.log(`  ${dup.length === 0 ? '✓' : '✗'} aucun doublon de verrou (runningLock) — ${dup.length} groupe(s) en double`);
  if (dup.length > 0) fail++;

  // Vérifications structurelles
  const cols = await db.$queryRawUnsafe<Array<{ column_name: string; data_type: string; is_nullable: string }>>(
    `SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name='SyncJobRun' AND column_name IN ('status','triggerSource','runningLock','progress') ORDER BY column_name;`
  );
  const colsOk = cols.length === 4 && cols.every((c) => c.data_type === 'text' && c.is_nullable === 'YES');
  console.log(`  ${colsOk ? '✓' : '✗'} 4/4 colonnes présentes, type TEXT, NULLABLE (rétrocompatible worker)`);
  if (!colsOk) fail++;

  const idx = await db.$queryRawUnsafe<Array<{ indexdef: string }>>(
    `SELECT indexdef FROM pg_indexes WHERE indexname='SyncJobRun_running_lock_uidx';`
  );
  const idxOk = idx.length === 1 && idx[0].indexdef.includes('UNIQUE') && idx[0].indexdef.includes('WHERE');
  console.log(`  ${idxOk ? '✓' : '✗'} index unique PARTIEL présent : ${idx[0]?.indexdef.slice(0, 90)}`);
  if (!idxOk) fail++;

  // Historique worker intact : 8 lignes status NULL
  const hist = await db.$queryRawUnsafe<Array<{ n: bigint }>>(
    `SELECT count(*)::bigint AS n FROM "SyncJobRun" WHERE status IS NULL;`
  );
  const histOk = Number(hist[0].n) === 8;
  console.log(`  ${histOk ? '✓' : '✗'} historique worker intact : ${hist[0].n}/8 lignes status=NULL (transition douce §26)`);
  if (!histOk) fail++;

  console.log(fail === 0 ? '\n✓✓ DONNÉES EXISTANTES 100 % INTACTES — migration purement additive' : `\n✗ ${fail} écart(s) détecté(s)`);
  if (fail > 0) process.exit(1);
}

main()
  .catch((e) => {
    console.error('✗', e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
