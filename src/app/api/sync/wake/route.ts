// ============================================================
// VOLTRIX bet — Task 45 §26 (+ §26-bis) : API /api/sync/wake
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
//     { started:false, reason:'already_running', runId }.
//   - REPRISABLE : si le budget temps de la tranche s'épuise, la
//     progression (curseur) est conservée dans Neon (SyncJobRun.progress).
//   - CHAÎNE SERVEUR (§26-bis) : quand une tranche se termine en
//     « partial », la route programme la suite via after() — le passage
//     tranche N → tranche N+1 est piloté PAR LE SERVEUR, dans la MÊME
//     invocation (mur SYNC_CHAIN_MAX_WALL_MS=110 s avec vérification
//     anticipée < maxDuration 120 s — plafond du plan). La complétion
//     s'étale sur 2-3 invocations enchaînées : l'utilisateur peut fermer
//     son navigateur dès la première réponse — le cron (GET ci-dessous)
//     et le prochain wake reprennent le curseur sans lui. La boucle de
//     secours du bouton frontend reste un filet additionnel.
//   - GET = point d'entrée Vercel Cron (vercel.json, quotidien — limite
//     du plan) : balayage idempotent — reprend tout job
//     partial/failed/orphelin SANS AUCUNE intervention utilisateur ;
//     no-op (0 ESPN) si les données sont fraîches et aucun job en
//     attente. Ce GET reste appelable par tout planificateur externe
//     (uptime monitor, worker, etc.) pour une reprise plus fréquente.
//
// Contrairement à /api/sync/tick (403 sous Vercel — rôle exclusif du
// worker permanent), cette route EST le mécanisme de synchronisation
// sous Vercel. Le worker actuel reste actif (transition douce) : le
// verrou et l'ingestion idempotente rendent la coexistence inoffensive.
// ============================================================

import { after } from 'next/server';
import { NextResponse } from 'next/server';
import { runWake, runWakeChainUntilDone, type WakeResult } from '@/lib/sync/wake';

export const dynamic = 'force-dynamic';
// Budget interne d'une tranche : 45 s par défaut (SYNC_WAKE_BUDGET_MS) —
// très en dessous de cette limite plateforme, la progression étant
// sauvegardée dans Neon à chaque lot, et la chaîne serveur (after())
// enchaînant les tranches suivantes dans la même invocation (mur 110 s,
// vérification anticipée avec marge 60 s).
// 120 s = plafond des fonctions serverless du plan Vercel actuel (les
// déploiements échouent au-delà — mesuré 2026-09-17) ; sur un plan
// supérieur, remonter à 300 + SYNC_CHAIN_MAX_WALL_MS=240000 restaure
// la sync complète en UNE invocation.
export const maxDuration = 120;

/**
 * Exécute UNE tranche puis, si elle reste du travail, programme la
 * continuation serveur. t0 est capturé AVANT la tranche : le mur de la
 * chaîne (110 s) couvre l'invocation entière, pas seulement la suite.
 */
async function wakeOnceAndScheduleChain(triggerSource: string): Promise<WakeResult> {
  const t0 = Date.now();
  const result = await runWake({ triggerSource });
  if (result.started && result.status === 'partial') {
    scheduleServerChain(t0);
  }
  return result;
}

/** §26-bis — continuation pilotée par le serveur (after() = runtime Next). */
function scheduleServerChain(t0: number): void {
  try {
    after(async () => {
      try {
        const chain = await runWakeChainUntilDone(t0);
        console.log(
          `[VOLTRIX SYNC] SOURCE=WAKE STATUS=CHAIN_DONE loops=${chain.loops} ended=${chain.ended}${chain.runId ? ` runId=${chain.runId}` : ''}`
        );
      } catch (e) {
        console.error(
          `[VOLTRIX SYNC] SOURCE=WAKE STATUS=CHAIN_ERROR error="${e instanceof Error ? e.message : String(e)}" (curseur conservé dans Neon — reprise par cron GET / prochain wake)`
        );
      }
    });
  } catch {
    // after() indisponible hors contexte de requête Next (dev, appels
    // directs en test) — la continuité reste assurée par la boucle de
    // secours du frontend et/ou le cron GET. Aucune perte de curseur.
    console.warn('[VOLTRIX SYNC] SOURCE=WAKE STATUS=CHAIN_UNAVAILABLE (after() hors contexte — fallback frontend/cron actif)');
  }
}

function errorResponse(e: unknown): NextResponse {
  return NextResponse.json(
    { ok: false, error: e instanceof Error ? e.message : 'Erreur de synchronisation' },
    { status: 500 }
  );
}

export async function POST() {
  try {
    const result = await wakeOnceAndScheduleChain('wake');
    return NextResponse.json({ ok: true, chain: 'server', ...result });
  } catch (e) {
    return errorResponse(e);
  }
}

/** Point d'entrée Vercel Cron (les crons Vercel émettent des GET) :
 *  filet de sécurité INFRASTRUCTURE — aucune interaction utilisateur
 *  requise pour reprendre un job interrompu (partial/failed/orphelin). */
export async function GET() {
  try {
    const result = await wakeOnceAndScheduleChain('cron');
    return NextResponse.json({ ok: true, chain: 'server', ...result });
  } catch (e) {
    return errorResponse(e);
  }
}
