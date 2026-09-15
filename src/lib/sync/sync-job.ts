// ============================================================
// VOLTRIX bet — Task 28 §24 : CACHE / SYNCHRONISATION PÉRIODIQUE
//
// Fréquences différenciées :
//   - Matchs EN DIRECT        → refreshLiveMatches() toutes les 90 s
//                               (synchronisation TRÈS fréquente) ;
//   - Matchs FUTURS (8 j)     → runSyncCycle() toutes les 10 min
//                               (synchronisation fréquente) ;
//   - Matchs TERMINÉS récents → couverts par le cycle (2 j arrière),
//                               jusqu'à confirmation du résultat final ;
//   - Historique récent (21 j)→ backfill unique au démarrage
//                               (synchronisation peu fréquente).
//
// L'objectif (§1) : ESPN alimente la base, l'application lit la base —
// plus aucun appel ESPN direct par consultation.
//
// Mécanisme identique à la boucle Forecast (Task 25) : démarrage
// paresseux, gardes globalThis (compatibles hot-reload Turbopack),
// verrous anti-chevauchement. Jamais de cron externe nécessaire.
// ============================================================

import { db } from '@/lib/db';
import { runSyncCycle, refreshLiveMatches } from './espn-sync';
import { runContextSync } from './context-sync';

interface SyncLoopState {
  __voltrixSyncLoopStarted?: boolean;
  __voltrixSyncBackfillChecked?: boolean;
  __voltrixSyncCycleRunning?: boolean;
  __voltrixSyncLiveRunning?: boolean;
  __voltrixSyncContextRunning?: boolean;
  __voltrixSyncContextBooted?: boolean;
}

const g = globalThis as unknown as SyncLoopState;

const CYCLE_INTERVAL_MS = 10 * 60_000; // 10 min — matchs futurs/résultats
const LIVE_INTERVAL_MS = 90_000; // 90 s — matchs en direct
const CONTEXT_INTERVAL_MS = 6 * 3_600_000; // Task 29 — 6 h : standings/blessures/météo/sweep historiques
const BACKFILL_COOLDOWN_MS = 12 * 3_600_000; // backfill complet au max toutes les 12 h
// Task 28 — AUDIT UTILISATEUR (§8) : la fenêtre à venir couvre AU MINIMUM
// aujourd'hui + 7 jours ; 14 j garantit la totalité de la navigation
// Prévisions (semaine courante + semaine suivante, lundi→dimanche) sans
// surcoût ESPN (scoreboard par PLAGE = 1 appel/ligue quel que soit l'ampli).
const CYCLE_DAYS_BACK = 4; // résultats récents jusqu'à confirmation (week-end compris)
const CYCLE_DAYS_AHEAD = 14; // aujourd'hui + 7 jours au minimum, semaine complète au-delà
const BACKFILL_DAYS_BACK = 21;
const BACKFILL_DAYS_AHEAD = 14;

/** Un backfill récent existe-t-il déjà ? (évite de re-scanner 21 j à chaque démarrage) */
async function backfillRecent(): Promise<boolean> {
  try {
    const last = await db.syncJobRun.findFirst({
      where: { phase: { in: ['backfill', 'seed'] } },
      orderBy: { startedAt: 'desc' },
    });
    return !!last && Date.now() - last.startedAt.getTime() < BACKFILL_COOLDOWN_MS;
  } catch {
    return false;
  }
}

/**
 * Démarre la boucle de synchronisation (idempotent — gardes globalThis).
 * À appeler paresseusement depuis les routes API.
 *
 * Task 35 — GARDE VERCEL : sur le runtime serverless Vercel, un
 * setInterval ne survit pas à l'invocation (processus gelé/terminé) et
 * chaque cold start relancerait un backfill — incompatibilité démontrée
 * par l'audit Task 34. La synchronisation ESPN → Neon est le rôle
 * EXCLUSIF du worker permanent (architecture hybride Task 31). Ici la
 * fonction devient un no-op : TOUS les appelants (routes de lecture
 * matches / sync/status / forecasts/week / sync/tick) sont protégés
 * sans modification individuelle. Localement (VERCEL absent) :
 * comportement strictement inchangé.
 */
export function ensureSyncLoop(): void {
  if (process.env.VERCEL === '1') return;
  if (g.__voltrixSyncLoopStarted) return;
  g.__voltrixSyncLoopStarted = true;

  // Backfill initial (historique 21 j + 8 j à venir) — une seule fois
  // par processus, et seulement si aucun backfill récent en base.
  setTimeout(async () => {
    if (g.__voltrixSyncBackfillChecked) return;
    g.__voltrixSyncBackfillChecked = true;
    try {
      if (await backfillRecent()) {
        // base déjà remplie récemment → cycle léger uniquement
        await runSyncCycle({ daysBack: CYCLE_DAYS_BACK, daysAhead: CYCLE_DAYS_AHEAD, phase: 'cycle' });
        return;
      }
      await runSyncCycle({ daysBack: BACKFILL_DAYS_BACK, daysAhead: BACKFILL_DAYS_AHEAD, phase: 'backfill' });
    } catch {
      // tolerant : le cycle suivant réessaiera
    }
  }, 15_000);

  // Cycle régulier — matchs futurs + résultats récents (§24).
  setInterval(() => {
    if (g.__voltrixSyncCycleRunning) return;
    g.__voltrixSyncCycleRunning = true;
    runSyncCycle({ daysBack: CYCLE_DAYS_BACK, daysAhead: CYCLE_DAYS_AHEAD, phase: 'cycle' })
      .catch(() => {})
      .finally(() => {
        g.__voltrixSyncCycleRunning = false;
      });
  }, CYCLE_INTERVAL_MS);

  // Matchs en direct — synchronisation très fréquente (§24).
  setInterval(() => {
    if (g.__voltrixSyncLiveRunning) return;
    g.__voltrixSyncLiveRunning = true;
    refreshLiveMatches()
      .catch(() => {})
      .finally(() => {
        g.__voltrixSyncLiveRunning = false;
      });
  }, LIVE_INTERVAL_MS);

  // Task 29 — synchronisation CONTEXTUELLE (standings, blessures, météo,
  // sweep historiques équipes) : passe initiale 60 s après le boot puis
  // toutes les 6 h. Idempotente (jour UTC) — aucune donnée supprimée.
  setTimeout(() => {
    if (g.__voltrixSyncContextBooted) return;
    g.__voltrixSyncContextBooted = true;
    if (g.__voltrixSyncContextRunning) return;
    g.__voltrixSyncContextRunning = true;
    runContextSync({ teamBudget: 40 })
      .catch(() => {})
      .finally(() => {
        g.__voltrixSyncContextRunning = false;
      });
  }, 60_000);
  setInterval(() => {
    if (g.__voltrixSyncContextRunning) return;
    g.__voltrixSyncContextRunning = true;
    runContextSync({ teamBudget: 40 })
      .catch(() => {})
      .finally(() => {
        g.__voltrixSyncContextRunning = false;
      });
  }, CONTEXT_INTERVAL_MS);
}

/** Exécute un cycle à la demande (route /api/sync/tick). */
export async function runSyncTick(opts?: { daysBack?: number; daysAhead?: number; phase?: string }) {
  return runSyncCycle(opts);
}
