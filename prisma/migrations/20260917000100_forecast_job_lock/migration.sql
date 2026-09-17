-- ============================================================
-- VOLTRIX bet — Task 49 (GO 4B) : Forecast Wake on Demand
-- État du job de prévisions + verrou anti-concurrence sur
-- ForecastJobRun — MIROIR EXACT de la migration §26 SyncJobRun
-- (20250917000000_wake_sync_state), appliquée en production le
-- 2026-09-17 sans incident.
--
-- Pourquoi : depuis le 15/09 16:58 UTC (arrêt du worker), plus
-- AUCUN ForecastSnapshot n'est fabriqué en production — les routes
-- worker (/api/forecasts/tick → 403) et la boucle paresseuse
-- (ensureForecastLoop → no-op sous VERCEL) sont neutralisées sur
-- Vercel. Le nouveau pipeline « Forecast Wake » (patron §26 :
-- verrou, tranches, reprise sur curseur, chaîne serveur after())
-- journalise ses exécutions dans ForecastJobRun.
--
-- Colonnes NULLABLES → rétrocompatibles avec les 101 lignes du
-- worker historique (status/triggerSource NULL = worker ancien,
-- exactement comme SyncJobRun). ADDITIVE : aucune colonne ni table
-- supprimée, aucune donnée réécrite, aucun historique touché.
--
-- Idempotent : garde-fous IF NOT EXISTS partout → ré-application
-- sans erreur (scripts/apply-forecast-lock.ts sur Neon, et
-- `prisma migrate deploy` au build Vercel — un double passage est
-- un no-op).
-- ============================================================

ALTER TABLE "ForecastJobRun" ADD COLUMN IF NOT EXISTS "status" TEXT;
ALTER TABLE "ForecastJobRun" ADD COLUMN IF NOT EXISTS "triggerSource" TEXT;
ALTER TABLE "ForecastJobRun" ADD COLUMN IF NOT EXISTS "runningLock" TEXT;
ALTER TABLE "ForecastJobRun" ADD COLUMN IF NOT EXISTS "progress" TEXT;

-- Garantie d'EXCLUSIVITÉ au niveau base : une seule ligne peut porter
-- runningLock='RUNNING' → un seul job de génération actif, même sous
-- 20 déclenchements simultanés (cron + post-sync + manuel) — le 2e
-- INSERT est rejeté par PostgreSQL lui-même (index unique PARTIEL,
-- les lignes historiques runningLock=NULL restent libres).
CREATE UNIQUE INDEX IF NOT EXISTS "ForecastJobRun_running_lock_uidx"
  ON "ForecastJobRun"("runningLock")
  WHERE "runningLock" IS NOT NULL;
