-- ============================================================
-- VOLTRIX bet — Task 45 (§26 Wake-on-Demand)
-- État de synchronisation + verrou anti-concurrence sur SyncJobRun.
-- Colonnes NULLABLES → rétrocompatible avec l'historique du worker
-- (status/triggerSource NULL = lignes worker existantes, inchangées).
-- Idempotent : les garde-fous IF NOT EXISTS permettent une ré-application
-- sans erreur (scripts/apply-wake-sync.ts sur Neon, migrate deploy en build).
-- ============================================================

ALTER TABLE "SyncJobRun" ADD COLUMN IF NOT EXISTS "status" TEXT;
ALTER TABLE "SyncJobRun" ADD COLUMN IF NOT EXISTS "triggerSource" TEXT;
ALTER TABLE "SyncJobRun" ADD COLUMN IF NOT EXISTS "runningLock" TEXT;
ALTER TABLE "SyncJobRun" ADD COLUMN IF NOT EXISTS "progress" TEXT;

-- Garantie d'EXCLUSIVITÉ au niveau base : une seule ligne peut porter
-- runningLock='RUNNING' → un seul job de synchronisation actif, même sous
-- 20 clics simultanés (le 2e INSERT est rejeté par PostgreSQL lui-même).
CREATE UNIQUE INDEX IF NOT EXISTS "SyncJobRun_running_lock_uidx"
  ON "SyncJobRun"("runningLock")
  WHERE "runningLock" IS NOT NULL;
