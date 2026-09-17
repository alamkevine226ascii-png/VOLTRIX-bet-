// ============================================================
// VOLTRIX — Task 49 (GO 4B) : FORECAST WAKE ON DEMAND —
// APPLICATION NEON
//
// Pose sur la base (Neon en production) — MIROIR EXACT de
// scripts/apply-wake-sync.ts (Task 45 §26, appliqué en production le
// 2026-09-17 sans incident) :
//   1. Les 4 colonnes d'état de ForecastJobRun (status / triggerSource /
//      runningLock / progress) — NULLABLES, les 101 lignes du worker
//      historique restent intactes (aucune donnée supprimée ni réécrite) ;
//   2. L'index unique PARTIEL ForecastJobRun_running_lock_uidx — la
//      garantie d'EXCLUSIVITÉ au niveau PostgreSQL : une seule ligne peut
//      porter runningLock='RUNNING' → 20 déclenchements simultanés
//      (cron + post-sync + manuel) = 1 SEULE génération de snapshot.
//
// IDENTIQUE à prisma/migrations/20260917000100_forecast_job_lock/
// migration.sql (double passage = no-op, garde-fous IF NOT EXISTS).
//
// Idempotent : ré-exécutable sans erreur.
// ATTENTION : les credentials Neon restent HORS du repo (post-leak) —
// exécuter avec l'environnement adéquat :
//   DATABASE_URL="postgresql://…neon…" bun scripts/apply-forecast-lock.ts
// Usage : bun scripts/apply-forecast-lock.ts
// ============================================================

import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

async function main() {
  // 0) Garde-fou : ne JAMAIS toucher une base locale par mégarde.
  const url = process.env.DATABASE_URL ?? '';
  if (!url.includes('postgres')) {
    throw new Error('DATABASE_URL n’est pas PostgreSQL — application Neon uniquement (creds hors repo)');
  }

  console.log('→ Colonnes d’état ForecastJobRun (Task 49 — Forecast Wake)…');
  await db.$executeRawUnsafe(`ALTER TABLE "ForecastJobRun" ADD COLUMN IF NOT EXISTS "status" TEXT;`);
  await db.$executeRawUnsafe(`ALTER TABLE "ForecastJobRun" ADD COLUMN IF NOT EXISTS "triggerSource" TEXT;`);
  await db.$executeRawUnsafe(`ALTER TABLE "ForecastJobRun" ADD COLUMN IF NOT EXISTS "runningLock" TEXT;`);
  await db.$executeRawUnsafe(`ALTER TABLE "ForecastJobRun" ADD COLUMN IF NOT EXISTS "progress" TEXT;`);
  console.log('  ✓ status, triggerSource, runningLock, progress présents');

  console.log('→ Index unique partiel (verrou anti-concurrence génération)…');
  await db.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS "ForecastJobRun_running_lock_uidx" ON "ForecastJobRun"("runningLock") WHERE "runningLock" IS NOT NULL;`
  );

  // ---- Vérifications ----
  const cols = await db.$queryRawUnsafe<Array<{ column_name: string }>>(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'ForecastJobRun' AND column_name IN ('status','triggerSource','runningLock','progress') ORDER BY column_name;`
  );
  if (cols.length !== 4) throw new Error(`colonnes manquantes : ${cols.map((c) => c.column_name).join(', ')}`);
  console.log(`  ✓ 4/4 colonnes vérifiées`);

  const idx = await db.$queryRawUnsafe<Array<{ indexname: string }>>(
    `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'ForecastJobRun_running_lock_uidx';`
  );
  if (idx.length !== 1) throw new Error('index ForecastJobRun_running_lock_uidx absent');
  console.log('  ✓ index unique partiel présent');

  // Preuve du verrou : un 2e INSERT concurrent avec runningLock='RUNNING'
  // doit être rejeté par PostgreSQL lui-même. Miroir du correctif Task 46 :
  // la transaction est toujours ROLLBACK-ée via une exception sentinelle
  // (aucune ligne sonde ne peut subsister, aucun verrou orphelin possible,
  // même en cas de crash — 25P02 impossible).
  class ProbeResult extends Error {
    constructor(public secondRejected: boolean) {
      super('PROBE_EXPECTED');
    }
  }
  let probe: boolean;
  try {
    await db.$transaction(async (tx) => {
      await tx.forecastJobRun.create({
        data: { phase: 'probe', status: 'running', triggerSource: 'manual', runningLock: 'RUNNING', startedAt: new Date() },
      });
      let secondRejected = true;
      try {
        await tx.forecastJobRun.create({
          data: { phase: 'probe', status: 'running', triggerSource: 'manual', runningLock: 'RUNNING', startedAt: new Date() },
        });
        secondRejected = false; // l'index n'a PAS rejeté → verrou inopérant
      } catch {
        secondRejected = true; // rejet attendu (P2002 — index unique partiel)
      }
      throw new ProbeResult(secondRejected); // force le ROLLBACK dans tous les cas
    });
    probe = false; // inatteignable — ProbeResult est toujours levée
  } catch (e) {
    if (e instanceof ProbeResult) probe = e.secondRejected;
    else throw e;
  }
  if (!probe) throw new Error('le verrou unique n’a PAS rejeté un 2e job RUNNING — index inopérant');
  console.log('  ✓ preuve verrou : 2e job RUNNING rejeté par PostgreSQL (sonde ROLLBACK-ée — zéro résidu)');

  // Rappel de l'état des protections existantes (§20/§20bis — non modifiées ici).
  const triggers = await db.$queryRawUnsafe<Array<{ count: bigint }>>(
    `SELECT count(*) AS count FROM pg_trigger WHERE tgname LIKE 'Prediction_freeze_%' OR tgname LIKE '%_no_update%' OR tgname LIKE '%_no_delete%';`
  );
  console.log(`→ Rappel : ${triggers[0]?.count ?? '?'} triggers d'immutabilité (§20 + §20bis) présents et inchangés`);

  // L'historique du worker (101 lignes) reste à NULL — preuve d'additivité.
  const legacy = await db.$queryRawUnsafe<Array<{ n: bigint }>>(
    `SELECT count(*) AS n FROM "ForecastJobRun" WHERE "status" IS NULL AND "runningLock" IS NULL;`
  );
  console.log(`→ Historique worker intact : ${legacy[0]?.n ?? '?'} lignes status/runningLock=NULL (aucune réécriture)`);
}

main()
  .then(() => console.log('✓ Task 49 — verrou ForecastJobRun appliqué, génération anti-concurrence opérationnelle'))
  .catch((e) => {
    console.error('✗ Erreur:', e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
