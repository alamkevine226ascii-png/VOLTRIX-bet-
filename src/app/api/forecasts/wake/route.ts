// ============================================================
// VOLTRIX bet — Task 49 (GO 4B) : API /api/forecasts/wake
//
// Génération « Forecast Wake on Demand » — miroir de /api/sync/wake
// (Task 45 §26 + §26-bis) pour la FABRICATION des snapshots :
//
//   Wake sync (ESPN → Neon)
//     ↓ déclenchement post-sync (voir /api/sync/wake — GO 4B)
//   détection des matchs nécessitant un snapshot   ← cette route
//     ↓ tranche bornée (budget 45 s)                     + cron GET
//   moteur v2.1 (analyzeMatch — inchangé)
//     ↓ §6 : predictionTime < kickoff (garde absolue)
//   ForecastSnapshot INSERT-ONLY (immuable, figé)
//
// GARANTIES :
//   - IDEMPOTENT : aucun match futur sans snapshot →
//     { started:false, reason:'complete' } sans aucun appel ESPN.
//   - ANTI-CONCURRENCE (verrou PostgreSQL — index unique partiel sur
//     ForecastJobRun.runningLock) : 20 déclenchements simultanés →
//     UNE seule génération ; les autres reçoivent
//     { started:false, reason:'already_running', runId }.
//   - REPRISABLE : si le budget temps de la tranche s'épuise, le
//     curseur (progress) est conservé dans Neon (ForecastJobRun).
//   - CHAÎNE SERVEUR (§26-bis) : quand une tranche se termine en
//     « partial », la route programme la suite via after() — le
//     passage tranche N → tranche N+1 est piloté PAR LE SERVEUR,
//     dans la MÊME invocation (mur FORECAST_CHAIN_MAX_WALL_MS=110 s
//     avec vérification anticipée < maxDuration 120 s — plafond du
//     plan Vercel Hobby). La complétion s'étale sur 2-3 invocations
//     enchaînées : l'utilisateur peut fermer son navigateur dès la
//     première réponse — le cron (GET ci-dessous), le déclenchement
//     post-sync et le prochain wake reprennent le curseur sans lui.
//
// Contrairement à /api/forecasts/tick (403 sous Vercel — rôle exclusif
// du worker permanent), cette route EST le mécanisme de génération
// sous Vercel. Le worker local/VPS (boucle 5 min + tick) reste actif
// en transition douce : le verrou DB et la contrainte UNIQUE
// (matchId, version) rendent la coexistence inoffensive (jamais deux
// snapshots pour le même [matchId, version]).
//
// GET = point d'entrée Vercel Cron (vercel.json, quotidien — limite
// du plan Hobby : 2 crons/jour) : balayage idempotent qui reprend tout
// job partial/failed/orphelin SANS aucune intervention utilisateur ;
// no-op (0 ESPN) si tous les matchs ont leur snapshot.
// ============================================================

import { after } from 'next/server';
import { NextResponse } from 'next/server';
import {
  runForecastWake,
  runForecastWakeChainUntilDone,
  type ForecastWakeResult,
} from '@/lib/forecast/wake';

export const dynamic = 'force-dynamic';
// 120 s = plafond des fonctions serverless du plan Vercel Hobby actuel
// (les déploiements échouent au-delà — mesuré 2026-09-17, miroir du
// constat sync). Le budget interne d'une tranche (45 s par défaut,
// FORECAST_WAKE_BUDGET_MS) reste très en dessous : la progression est
// sauvegardée dans Neon à chaque match, et la chaîne serveur (after())
// enchaîne les tranches suivantes dans la même invocation (mur 110 s,
// vérification anticipée avec marge 20 s — grain fin : une analyse
// ≈ 3-10 s). Sur un plan supérieur : maxDuration 300 +
// FORECAST_CHAIN_MAX_WALL_MS=240000 restaure un backlog complet en
// UNE invocation.
export const maxDuration = 120;

/**
 * Exécute UNE tranche puis, s'il reste du travail, programme la
 * continuation serveur. t0 est capturé AVANT la tranche : le mur de la
 * chaîne (110 s) couvre l'invocation entière, pas seulement la suite.
 */
async function forecastOnceAndScheduleChain(triggerSource: string): Promise<ForecastWakeResult> {
  const t0 = Date.now();
  const result = await runForecastWake({ triggerSource });
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
        const chain = await runForecastWakeChainUntilDone(t0);
        console.log(
          `[VOLTRIX FORECAST] SOURCE=WAKE STATUS=CHAIN_DONE loops=${chain.loops} ended=${chain.ended}${chain.runId ? ` runId=${chain.runId}` : ''}`
        );
      } catch (e) {
        console.error(
          `[VOLTRIX FORECAST] SOURCE=WAKE STATUS=CHAIN_ERROR error="${e instanceof Error ? e.message : String(e)}" (curseur conservé dans Neon — reprise par cron GET / déclenchement post-sync / prochain wake)`
        );
      }
    });
  } catch {
    // after() indisponible hors contexte de requête Next (dev, appels
    // directs en test) — la continuité reste assurée par le cron GET et
    // le déclenchement post-sync. Aucune perte de curseur.
    console.warn('[VOLTRIX FORECAST] SOURCE=WAKE STATUS=CHAIN_UNAVAILABLE (after() hors contexte — fallback cron/post-sync actif)');
  }
}

function errorResponse(e: unknown): NextResponse {
  return NextResponse.json(
    { ok: false, error: e instanceof Error ? e.message : 'Erreur de génération' },
    { status: 500 }
  );
}

/** Déclenchement manuel / bouton / worker externe : UNE tranche + chaîne. */
export async function POST() {
  try {
    const result = await forecastOnceAndScheduleChain('manual');
    return NextResponse.json({ ok: true, chain: 'server', ...result });
  } catch (e) {
    return errorResponse(e);
  }
}

/** Point d'entrée Vercel Cron (les crons Vercel émettent des GET) :
 *  filet de sécurité INFRASTRUCTURE — aucune interaction utilisateur
 *  requise pour reprendre un job interrompu (partial/failed/orphelin)
 *  ou absorber le backlog des nouvelles synchronisations. */
export async function GET() {
  try {
    const result = await forecastOnceAndScheduleChain('cron');
    return NextResponse.json({ ok: true, chain: 'server', ...result });
  } catch (e) {
    return errorResponse(e);
  }
}
