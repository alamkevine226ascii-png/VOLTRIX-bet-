// ============================================================
// VOLTRIX — Task 45 §26 : WAKE ON DEMAND — APPLICATION NEON
//
// Pose sur la base (Neon en production) :
//   1. Les 4 colonnes d'état de SyncJobRun (status / triggerSource /
//      runningLock / progress) — NULLABLES, l'historique du worker
//      reste intact (aucune donnée supprimée ni réécrite) ;
//   2. L'index unique PARTIEL SyncJobRun_running_lock_uidx — la garantie
//      d'EXCLUSIVITÉ au niveau PostgreSQL : une seule ligne peut porter
//      runningLock='RUNNING' → 20 clics simultanés = 1 seule sync.
//
// Idempotent : ré-exécutable sans erreur (IF NOT EXISTS partout).
// ATTENTION : les credentials Neon restent HORS du repo (post-leak) —
// exécuter avec l'environnement adéquat :
//   DATABASE_URL="postgresql://…neon…" bun scripts/apply-wake-sync.ts
// Usage : bun scripts/apply-wake-sync.ts
// ============================================================

import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

async function main() {
  // 0) Garde-fou : ne JAMAIS toucher une base SQLite locale par mégarde.
  const url = process.env.DATABASE_URL ?? '';
  if (!url.includes('postgres')) {
    throw new Error('DATABASE_URL n’est pas PostgreSQL — application Neon uniquement (creds hors repo)');
  }

  console.log('→ Colonnes d’état SyncJobRun (§26 Wake-on-Demand)…');
  await db.$executeRawUnsafe(`ALTER TABLE "SyncJobRun" ADD COLUMN IF NOT EXISTS "status" TEXT;`);
  await db.$executeRawUnsafe(`ALTER TABLE "SyncJobRun" ADD COLUMN IF NOT EXISTS "triggerSource" TEXT;`);
  await db.$executeRawUnsafe(`ALTER TABLE "SyncJobRun" ADD COLUMN IF NOT EXISTS "runningLock" TEXT;`);
  await db.$executeRawUnsafe(`ALTER TABLE "SyncJobRun" ADD COLUMN IF NOT EXISTS "progress" TEXT;`);
  console.log('  ✓ status, triggerSource, runningLock, progress présents');

  console.log('→ Index unique partiel (verrou anti-concurrence)…');
  await db.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS "SyncJobRun_running_lock_uidx" ON "SyncJobRun"("runningLock") WHERE "runningLock" IS NOT NULL;`
  );

  // ---- Vérifications ----
  const cols = await db.$queryRawUnsafe<Array<{ column_name: string }>>(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'SyncJobRun' AND column_name IN ('status','triggerSource','runningLock','progress') ORDER BY column_name;`
  );
  if (cols.length !== 4) throw new Error(`colonnes manquantes : ${cols.map((c) => c.column_name).join(', ')}`);
  console.log(`  ✓ 4/4 colonnes vérifiées`);

  const idx = await db.$queryRawUnsafe<Array<{ indexname: string }>>(
    `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'SyncJobRun_running_lock_uidx';`
  );
  if (idx.length !== 1) throw new Error('index SyncJobRun_running_lock_uidx absent');
  console.log('  ✓ index unique partiel présent');

  // Preuve du verrou : un 2e INSERT concurrent avec runningLock='RUNNING'
  // doit être rejeté par PostgreSQL lui-même.
  const probe = await db.$transaction(async (tx) => {
    const a = await tx.syncJobRun.create({
      data: { phase: 'probe', status: 'running', triggerSource: 'manual', runningLock: 'RUNNING', startedAt: new Date() },
      select: { id: true },
    });
    let secondRejected = false;
    try {
      await tx.syncJobRun.create({
        data: { phase: 'probe', status: 'running', triggerSource: 'manual', runningLock: 'RUNNING', startedAt: new Date() },
      });
    } catch {
      secondRejected = true;
    }
    await tx.syncJobRun.delete({ where: { id: a.id } });
    return secondRejected;
  });
  if (!probe) throw new Error('le verrou unique n’a PAS rejeté un 2e job RUNNING — index inopérant');
  console.log('  ✓ preuve verrou : 2e job RUNNING rejeté par PostgreSQL (sonde nettoyée)');

  // Rappel de l'état des protections existantes (§20/§20bis — non modifiées ici).
  const triggers = await db.$queryRawUnsafe<Array<{ count: bigint }>>(
    `SELECT count(*) AS count FROM pg_trigger WHERE tgname LIKE 'Prediction_freeze_%' OR tgname LIKE '%_no_update%' OR tgname LIKE '%_no_delete%';`
  );
  console.log(`→ Rappel : ${triggers[0]?.count ?? '?'} triggers d'immutabilité (§20 + §20bis) présents et inchangés`);
}

main()
  .then(() => console.log('✓ Wake-on-Demand §26 appliqué — verrou anti-concurrence opérationnel'))
  .catch((e) => {
    console.error('✗ Erreur:', e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
