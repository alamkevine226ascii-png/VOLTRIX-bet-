// ============================================================
// VOLTRIX bet — Task 45 §26 : API POST /api/sync/wake
//
// Synchronisation « Wake on Demand » ESPN → Neon, déclenchée à la
// demande quand le frontend détecte des données > 10 min (ou une
// sync LIVE périmée pendant un match en direct).
//
// GARANTIES :
//   - IDEMPOTENT : données fraîches → { started:false, reason:'fresh' }
//     sans aucun appel ESPN.
//   - ANTI-CONCURRENCE (verrou PostgreSQL — index unique partiel sur
//     SyncJobRun.runningLock) : 20 appels simultanés → UNE seule
//     synchronisation ; les autres reçoivent
//     { started:false, reason:'already_running', runId } et le
//     frontend suit la progression au lieu de relancer.
//   - REPRISABLE : si le budget temps de l'invocation s'épuise
//     (limites function serverless), la progression est conservée
//     dans Neon (SyncJobRun.progress) et le prochain appel reprend
//     exactement là où celui-ci s'est arrêté.
//
// Contrairement à /api/sync/tick (403 sous Vercel — rôle exclusif du
// worker permanent), cette route EST le mécanisme de synchronisation
// sous Vercel. Le worker actuel reste actif (transition douce) : le
// verrou et l'ingestion idempotente rendent la coexistence inoffensive.
// ============================================================

import { NextResponse } from 'next/server';
import { runWake } from '@/lib/sync/wake';

export const dynamic = 'force-dynamic';
// Budget interne du wake : 45 s par défaut (SYNC_WAKE_BUDGET_MS) — très
// en dessous de cette limite plateforme, la progression étant sauvegardée
// dans Neon à chaque lot. 300 s = maximum des fonctions serverless Fluid.
export const maxDuration = 300;

export async function POST() {
  try {
    const result = await runWake({ triggerSource: 'wake' });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Erreur de synchronisation' },
      { status: 500 }
    );
  }
}
