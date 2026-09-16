// ============================================================
// VOLTRIX bet — Task 45 §26 : SYNCHRONISATION « WAKE ON DEMAND »
//
// Remplace la DÉPENDANCE au worker permanent : quand un utilisateur
// ouvre VOLTRIX et constate que les données sont trop anciennes, le
// frontend affiche « Actualiser les données » et déclenche
// POST /api/sync/wake → UNE seule synchronisation ESPN → Neon.
//
// Garanties :
//   - ANTI-CONCURRENCE au niveau PostgreSQL : le job actif porte
//     runningLock='RUNNING' protégé par un index unique PARTIEL
//     (SyncJobRun_running_lock_uidx). 20 appels simultanés → 1 seul
//     gagnant (les 19 autres reçoivent already_running, sans lancer
//     une deuxième synchronisation).
//   - IDEMPOTENT : données fraîches (< 10 min) → aucun travail.
//   - REPRISABLE : budget temps par invocation (limites Vercel) —
//     le curseur (progress) est conservé dans Neon, chaque invocation
//     reprend là où la précédente s'est arrêtée.
//   - LIVE PRIORITAIRE : refreshLiveMatches d'abord (comme le worker),
//     sans jamais lancer plusieurs synchronisations concurrentes.
//   - AUCUNE suppression de données (ingestion idempotente §5 :
//     insert/update par espn_event_id, cotes append-only §10).
//
// RÉUTILISATION du worker (contrainte Task 45 n°3) : le pipeline
// réemploie EXACTEMENT les briques du worker — refreshLiveMatches,
// syncLeagueWindow, syncTeamHistory (espn-sync.ts), runContextSync
// (context-sync.ts) — avec les mêmes paramètres de fenêtre
// (daysBack 4 / daysAhead 14, lot de 6 ligues concurrentes).
// espn-sync.ts et context-sync.ts restent INCHANGÉS.
//
// Logs structurés (diagnostic post-déploiement) :
//   [VOLTRIX SYNC] SOURCE=WAKE|EXISTING_WORKER STATUS=STARTED|RUNNING|SUCCESS|FAILED|PARTIAL|LOCK_RECOVERED
//                  ESPN_CALLS=n MATCHES_UPDATED=n ODDS_UPDATED=n DURATION_MS=n
// ============================================================

import { db } from '@/lib/db';
import { espnStats } from '@/lib/espn';
import { mapWithConcurrency } from '../cache';
import {
  syncLeagueWindow,
  syncTeamHistory,
  refreshLiveMatches,
  type SyncStats,
} from './espn-sync';
import { runContextSync, type ContextSyncStats } from './context-sync';

// ---------- Seuils (cahier des charges §26) ----------

/** Seuil de fraîcheur global : au-delà, le frontend propose le bouton. */
export const SYNC_STALE_MS = 10 * 60_000; // 10 min
/** Fraîcheur LIVE : un match en direct exige une sync LIVE plus récente. */
export const LIVE_STALE_MS = 2 * 60_000; // 2 min
/** Verrou orphelin : au-delà, une invocation RUNNING est considérée tuée
 *  (fonction Vercel terminée de force) et peut être reprise. Doit rester
 *  > maxDuration de la route (300 s) avec marge. */
export const STALE_LOCK_MS = 6 * 60_000; // 6 min
/** Cadence du contexte (standings/blessures/météo) — miroir sync-job.ts. */
const CONTEXT_INTERVAL_MS = 6 * 3_600_000; // 6 h

/** Fenêtre du cycle — identique au worker (sync-job.ts CYCLE_*). */
const CYCLE_DAYS_BACK = 4;
const CYCLE_DAYS_AHEAD = 14;
/** Taille d'un lot de ligues — identique au worker (concurrency 6). */
const LEAGUE_BATCH = 6;
/** Marge de sécurité avant budget épuisé (un lot ≈ 2-4 s). */
const MIN_REMAINING_MS = 6_000;
/** Budget minimal pour démarrer la phase team-history (≤ 8 appels ESPN). */
const TEAM_HISTORY_MIN_MS = 12_000;
/** Budget minimal pour démarrer la phase contexte (monolithique ≈ 15-60 s). */
const CONTEXT_MIN_MS = 25_000;
/** Budget par invocation — sous la limite Vercel (maxDuration 300 s) pour
 *  garantir une réponse propre + une progression sauvegardée. Surchargable. */
const DEFAULT_BUDGET_MS = 45_000;

function getBudgetMs(): number {
  const raw = parseInt(process.env.SYNC_WAKE_BUDGET_MS ?? '', 10);
  if (Number.isFinite(raw) && raw >= 15_000 && raw <= 240_000) return raw;
  return DEFAULT_BUDGET_MS;
}

// ---------- Progression (curseur de reprise conservé dans Neon) ----------

export interface WakeProgress {
  liveDone: boolean;
  cycleDone: boolean;
  teamHistoryDone: boolean;
  contextDone: boolean;
  /** Prochain lot de ligues à traiter (phase cycle). */
  chunk: number;
  leaguesTotal: number;
  leaguesDone: number;
  cycle: SyncStats | null;
  live: SyncStats | null;
  context: ContextSyncStats | null;
  /** Équipes dont l'historique H2H a été importé (traçabilité). */
  teamHistory: number | null;
  /** Appels ESPN cumulés sur TOUTES les invocations du job. */
  espnCalls: number;
  resumedCount: number;
}

function freshProgress(): WakeProgress {
  return {
    liveDone: false,
    cycleDone: false,
    teamHistoryDone: false,
    contextDone: false,
    chunk: 0,
    leaguesTotal: 0,
    leaguesDone: 0,
    cycle: null,
    live: null,
    context: null,
    teamHistory: null,
    espnCalls: 0,
    resumedCount: 0,
  };
}

function parseProgress(raw: string | null): WakeProgress | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Partial<WakeProgress>;
    return { ...freshProgress(), ...p };
  } catch {
    return null;
  }
}

function mergeSyncStats(a: SyncStats | null, b: SyncStats): SyncStats {
  if (!a) return b;
  return {
    leaguesTotal: a.leaguesTotal + b.leaguesTotal,
    leaguesFailed: a.leaguesFailed + b.leaguesFailed,
    eventsSeen: a.eventsSeen + b.eventsSeen,
    matchesCreated: a.matchesCreated + b.matchesCreated,
    matchesUpdated: a.matchesUpdated + b.matchesUpdated,
    resultsUpserted: a.resultsUpserted + b.resultsUpserted,
    oddsInserted: a.oddsInserted + b.oddsInserted,
    skipped: a.skipped + b.skipped,
  };
}

function emptySyncStats(): SyncStats {
  return {
    leaguesTotal: 0,
    leaguesFailed: 0,
    eventsSeen: 0,
    matchesCreated: 0,
    matchesUpdated: 0,
    resultsUpserted: 0,
    oddsInserted: 0,
    skipped: 0,
  };
}

// ---------- Logs structurés (diagnostic §26) ----------

function syncLog(status: string, extra: string = ''): void {
  const line = `[VOLTRIX SYNC] SOURCE=WAKE STATUS=${status}${extra ? ' ' + extra : ''}`;
  console.log(line);
}

// ---------- Garde-fou : index unique partiel (verrou DB) ----------

const gWake = globalThis as unknown as { __voltrixWakeIndexChecked?: boolean };

/**
 * Garantit la présence de l'index unique partiel qui matérialise le verrou
 * anti-concurrence. Normalement posé par la migration / apply-wake-sync.ts ;
 * appelé ici par précaution (IF NOT EXISTS = no-op si déjà présent).
 * Un échec (droits DDL) n'empêche pas le wake : le claim conditionnel
 * reste sûr sous READ COMMITTED, l'index est la garantie forte.
 */
async function ensureWakeIndex(): Promise<void> {
  if (gWake.__voltrixWakeIndexChecked) return;
  gWake.__voltrixWakeIndexChecked = true;
  try {
    const rows = await db.$queryRaw<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public' AND indexname = 'SyncJobRun_running_lock_uidx'
      ) AS exists`;
    if (rows[0]?.exists) return;
    await db.$executeRawUnsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS "SyncJobRun_running_lock_uidx" ON "SyncJobRun"("runningLock") WHERE "runningLock" IS NOT NULL`
    );
    syncLog('INDEX_ENSURED', 'index=SyncJobRun_running_lock_uidx');
  } catch (e) {
    // Ne bloque jamais le wake — le verrou conditionnel reste opérationnel.
    console.warn(`[VOLTRIX SYNC] index verrou non posé (${e instanceof Error ? e.message : 'erreur'}) — apply-wake-sync.ts requis`);
  }
}

// ---------- État de synchronisation (lu par le frontend) ----------

export interface SyncRunningInfo {
  id: string;
  startedAt: Date;
  triggerSource: string | null;
}

export interface SyncState {
  now: string;
  /** Dernière synchronisation COMPLÈTE (cycle/backfill/wake terminé). */
  lastSyncAt: string | null;
  /** Dernière synchronisation LIVE (phase live ou wake avec live fait). */
  lastLiveSyncAt: string | null;
  /** Dernière synchronisation contexte (standings/blessures/météo). */
  lastContextAt: string | null;
  lastRun: {
    id: string;
    phase: string;
    status: string | null;
    triggerSource: string | null;
    startedAt: string;
    finishedAt: string | null;
    error: string | null;
  } | null;
  running: SyncRunningInfo | null;
  resumable: { id: string; startedAt: string; progress: WakeProgress } | null;
  hasLiveMatches: boolean;
  /** true = données > 10 min → bouton « Actualiser les données ». */
  stale: boolean;
  /** true = match LIVE + sync LIVE > 2 min → bouton (priorité LIVE). */
  liveStale: boolean;
  contextStale: boolean;
  suggestedAction: 'none' | 'wake';
  thresholds: { staleMs: number; liveStaleMs: number; contextStaleMs: number };
}

type RunRow = {
  id: string;
  startedAt: Date;
  finishedAt: Date | null;
  phase: string;
  status: string | null;
  triggerSource: string | null;
  runningLock: string | null;
  progress: string | null;
  error: string | null;
};

/** Travail restant dans un curseur de progression (false = job fini). */
export function progressHasRemainingWork(p: WakeProgress | null): boolean {
  if (!p) return false;
  return !(p.liveDone && p.cycleDone && p.teamHistoryDone && p.contextDone);
}

/**
 * État de synchronisation pour le frontend — dérivé UNIQUEMENT de
 * SyncJobRun (aucune nouvelle table). Les lignes du worker historique
 * (status NULL + finishedAt) comptent comme des synchronisations valides
 * : tant que le worker vit, le bouton n'apparaît pas (transition douce).
 */
export async function getSyncState(): Promise<SyncState> {
  const now = new Date();
  const [rows, liveCount] = await Promise.all([
    db.syncJobRun.findMany({
      orderBy: { startedAt: 'desc' },
      take: 50,
      select: {
        id: true, startedAt: true, finishedAt: true, phase: true,
        status: true, triggerSource: true, runningLock: true, progress: true, error: true,
      },
    }),
    db.match.count({ where: { status: { in: ['LIVE', 'HALFTIME'] } } }),
  ]);

  const typed = rows as unknown as RunRow[];
  let lastSyncMs: number | null = null;
  let lastLiveMs: number | null = null;
  let lastContextMs: number | null = null;
  let running: SyncRunningInfo | null = null;
  let lastRow: RunRow | null = typed[0] ?? null;

  for (const r of typed) {
    const endMs = (r.finishedAt ?? r.startedAt).getTime();
    const prog = r.progress ? parseProgress(r.progress) : null;
    const isWakeDone = r.status === 'success' && r.phase === 'wake';
    const isWorkerDone = r.status === null && r.finishedAt !== null;

    if (r.runningLock === 'RUNNING' && (!running || r.startedAt > running.startedAt)) {
      running = { id: r.id, startedAt: r.startedAt, triggerSource: r.triggerSource };
    }
    // Un job 'running' qui dépasse STALE_LOCK_MS est orphelin (fonction tuée)
    // — il ne doit pas masquer la fraîcheur réelle des données.
    const runningOrphan = r.runningLock === 'RUNNING' && now.getTime() - r.startedAt.getTime() >= STALE_LOCK_MS;

    if ((isWakeDone || isWorkerDone) && !runningOrphan) {
      if (r.phase === 'cycle' || r.phase === 'backfill' || r.phase === 'wake') {
        if (lastSyncMs === null || endMs > lastSyncMs) lastSyncMs = endMs;
      }
      if (r.phase === 'wake' && prog?.liveDone) {
        if (lastLiveMs === null || endMs > lastLiveMs) lastLiveMs = endMs;
      }
    }
    if (!runningOrphan && ((r.status === 'success' && r.phase === 'live') || (r.status === null && r.phase === 'live' && r.finishedAt))) {
      if (lastLiveMs === null || endMs > lastLiveMs) lastLiveMs = endMs;
    }
    if (!runningOrphan && ((r.status === 'success' && r.phase === 'context') || (r.status === null && r.phase === 'context' && r.finishedAt))) {
      if (lastContextMs === null || endMs > lastContextMs) lastContextMs = endMs;
    }
  }

  // Reprise possible : dernier job partial/failed avec du travail restant,
  // à condition qu'aucune réussite ne soit arrivée après lui.
  let resumable: SyncState['resumable'] = null;
  for (const r of typed) {
    if (r.status !== 'partial' && r.status !== 'failed') continue;
    if (lastSyncMs !== null && r.startedAt.getTime() < lastSyncMs) break; // une réussite plus récente existe
    const prog = parseProgress(r.progress);
    if (!prog || !progressHasRemainingWork(prog)) continue;
    resumable = { id: r.id, startedAt: r.startedAt.toISOString(), progress: prog };
    break;
  }

  const stale = lastSyncMs === null || now.getTime() - lastSyncMs > SYNC_STALE_MS;
  const liveStale = liveCount > 0 && (lastLiveMs === null || now.getTime() - lastLiveMs > LIVE_STALE_MS);
  const contextStale =
    lastContextMs === null || now.getTime() - lastContextMs > CONTEXT_INTERVAL_MS;

  const toISO = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());

  return {
    now: now.toISOString(),
    lastSyncAt: toISO(lastSyncMs),
    lastLiveSyncAt: toISO(lastLiveMs),
    lastContextAt: toISO(lastContextMs),
    lastRun: lastRow
      ? {
          id: lastRow.id,
          phase: lastRow.phase,
          status: lastRow.status,
          triggerSource: lastRow.triggerSource,
          startedAt: lastRow.startedAt.toISOString(),
          finishedAt: lastRow.finishedAt ? lastRow.finishedAt.toISOString() : null,
          error: lastRow.error,
        }
      : null,
    running,
    resumable,
    hasLiveMatches: liveCount > 0,
    stale,
    liveStale,
    contextStale,
    suggestedAction: stale || liveStale ? 'wake' : 'none',
    thresholds: { staleMs: SYNC_STALE_MS, liveStaleMs: LIVE_STALE_MS, contextStaleMs: CONTEXT_INTERVAL_MS },
  };
}

// ---------- Réultat d'un appel wake ----------

export interface WakeResultSummary {
  durationMs: number;
  espnCalls: number;
  matchesCreated: number;
  matchesUpdated: number;
  matchesUpdatedTotal: number;
  resultsUpserted: number;
  oddsUpdated: number;
  leaguesDone: number;
  leaguesTotal: number;
  live: SyncStats | null;
  cycle: SyncStats | null;
  context: ContextSyncStats | null;
  teamHistory: number | null;
  resumed: boolean;
  remainingLeagues: number;
}

export interface WakeResult {
  started: boolean;
  reason?: 'fresh' | 'already_running';
  runId?: string;
  status?: 'success' | 'partial' | 'failed';
  error?: string;
  result?: WakeResultSummary;
}

function buildSummary(prog: WakeProgress, durationMs: number): WakeResultSummary {
  const cycle = prog.cycle ?? emptySyncStats();
  const live = prog.live ?? emptySyncStats();
  return {
    durationMs,
    espnCalls: prog.espnCalls,
    matchesCreated: cycle.matchesCreated + live.matchesCreated,
    matchesUpdated: cycle.matchesUpdated + live.matchesUpdated,
    matchesUpdatedTotal:
      cycle.matchesCreated + cycle.matchesUpdated + live.matchesCreated + live.matchesUpdated,
    resultsUpserted: cycle.resultsUpserted + live.resultsUpserted,
    oddsUpdated: cycle.oddsInserted + live.oddsInserted,
    leaguesDone: prog.leaguesDone,
    leaguesTotal: prog.leaguesTotal,
    live: prog.live,
    cycle: prog.cycle,
    context: prog.context,
    teamHistory: prog.teamHistory,
    resumed: prog.resumedCount > 0,
    remainingLeagues: Math.max(0, prog.leaguesTotal - prog.leaguesDone),
  };
}

// ---------- Verrou : claim / takeover / libération ----------

/**
 * Tente de REPRENDRE un job résumable (partial/failed avec curseur).
 * UPDATE conditionnel (runningLock IS NULL) → sûr sous READ COMMITTED :
 * un seul concurrent obtient rowCount=1, l'index unique partiel sert de
 * ceinture de sécurité. Retourne le job réclamé ou null.
 */
async function claimResumable(id: string): Promise<boolean> {
  const claimed = await db.syncJobRun.updateMany({
    where: { id, runningLock: null },
    data: { runningLock: 'RUNNING', status: 'running', error: null, startedAt: new Date() },
  });
  return claimed.count === 1;
}

/** Crée un NOUVEAU job verrouillé. Échoue (null) si un concurrent tient le verrou. */
async function claimNewRun(triggerSource: string): Promise<{ id: string } | null> {
  try {
    const created = await db.syncJobRun.create({
      data: {
        phase: 'wake',
        status: 'running',
        triggerSource,
        runningLock: 'RUNNING',
        startedAt: new Date(),
      },
      select: { id: true },
    });
    return created;
  } catch {
    // P2002 / violation index unique partiel → le verrou est tenu ailleurs.
    return null;
  }
}

/** Marque un job terminé + LIBÈRE le verrou (toujours, succès comme échec). */
async function finalizeRun(
  id: string,
  status: 'success' | 'partial' | 'failed',
  prog: WakeProgress,
  durationMs: number,
  triggerSource: string,
  error?: string
): Promise<void> {
  const summary = buildSummary(prog, durationMs);
  try {
    await db.syncJobRun.update({
      where: { id },
      data: {
        status,
        finishedAt: new Date(),
        runningLock: null,
        error: error ?? null,
        stats: JSON.stringify({ ...summary, triggerSource }),
        progress: JSON.stringify(prog),
      },
    });
  } catch (e) {
    // La libération du verrou ne doit JAMAIS échouer silencieusement :
    // sans ça, tous les wakes suivants seraient rejetés jusqu'au takeover.
    console.error(`[VOLTRIX SYNC] finalize ${id} a échoué (${e instanceof Error ? e.message : '?'}) — libération forcée du verrou`);
    await db.syncJobRun.updateMany({ where: { id, runningLock: 'RUNNING' }, data: { runningLock: null } }).catch(() => {});
  }
}

// ---------- Phases internes ----------

/** §7 : historique H2H des équipes à venir — réplique la section du
 *  runSyncCycle worker (budget 4 équipes, TTL interne 6 h). */
async function wakeTeamHistory(): Promise<number> {
  const upcoming = await db.match.findMany({
    where: {
      kickoffAt: { gte: new Date(Date.now() - 3_600_000), lte: new Date(Date.now() + 48 * 3_600_000) },
      homeTeamId: { not: null },
      awayTeamId: { not: null },
    },
    orderBy: { kickoffAt: 'asc' },
    take: 8,
    select: { competitionId: true, homeTeamId: true, homeTeamName: true, awayTeamId: true, awayTeamName: true },
  });
  const comps = upcoming.length
    ? await db.competition.findMany({
        where: { id: { in: [...new Set(upcoming.map((m) => m.competitionId).filter((x): x is string => !!x))] } },
        select: { id: true, espnLeagueId: true },
      })
    : [];
  const leagueById = new Map(comps.map((c) => [c.id, c.espnLeagueId]));
  const seasonNow = new Date().getUTCFullYear();
  const seen = new Set<string>();
  let synced = 0;
  for (const m of upcoming) {
    if (synced >= 4) break;
    const league = m.competitionId ? leagueById.get(m.competitionId) : null;
    if (!league) continue;
    for (const [tid, tname] of [
      [m.homeTeamId!, m.homeTeamName],
      [m.awayTeamId!, m.awayTeamName],
    ] as const) {
      if (seen.has(tid) || synced >= 4) continue;
      seen.add(tid);
      const n = await syncTeamHistory(league, tid, tname, [seasonNow - 1, seasonNow]).catch(() => 0);
      if (n > 0) synced++;
    }
  }
  return synced;
}

// ---------- Pipeline principal ----------

/**
 * Exécute UNE synchronisation à la demande (verrouillée, idempotente,
 * reprise sur curseur). Ordre des phases : LIVE (prioritaire) → cycle
 * (lots de 6 ligues) → team-history (H2H) → contexte (6 h).
 */
export async function runWake(opts?: { triggerSource?: string; budgetMs?: number }): Promise<WakeResult> {
  const triggerSource = opts?.triggerSource ?? 'wake';
  const budgetMs = opts?.budgetMs ?? getBudgetMs();
  const t0 = Date.now();
  await ensureWakeIndex();

  const state = await getSyncState();

  // 1) Un job est-il déjà actif ?
  if (state.running) {
    const age = Date.now() - state.running.startedAt.getTime();
    if (age < STALE_LOCK_MS) {
      syncLog('SKIPPED', `reason=already_running runId=${state.running.id} ageMs=${age}`);
      return { started: false, reason: 'already_running', runId: state.running.id };
    }
    // Verrou orphelin (fonction tuée par la plateforme) → reprise contrôlée.
    const taken = await db.syncJobRun.updateMany({
      where: { id: state.running.id, runningLock: 'RUNNING' },
      data: {
        status: 'failed',
        error: 'verrou orphelin repris — invocation précédente terminée de force (timeout/maxDuration)',
        runningLock: null,
        finishedAt: new Date(),
      },
    });
    if (taken.count === 0) {
      syncLog('SKIPPED', `reason=already_running runId=${state.running.id} (repris par un concurrent)`);
      return { started: false, reason: 'already_running', runId: state.running.id };
    }
    syncLog('LOCK_RECOVERED', `runId=${state.running.id} ageMs=${age} (verrou orphelin)`);
  }

  // 2) Données fraîches (et pas de LIVE périmé) → aucun travail (idempotence).
  if (!state.stale && !state.liveStale) {
    syncLog('SKIPPED', `reason=fresh lastSyncAt=${state.lastSyncAt ?? 'jamais'} liveStale=false`);
    return { started: false, reason: 'fresh' };
  }

  // 3) Reprise d'un job interrompu (curseur conservé dans Neon)…
  let run: { id: string } | null = null;
  let prog: WakeProgress = freshProgress();
  let resumed = false;

  if (state.resumable) {
    const ok = await claimResumable(state.resumable.id);
    if (ok) {
      run = { id: state.resumable.id };
      prog = state.resumable.progress;
      prog.resumedCount += 1;
      resumed = true;
    }
  }
  // …sinon nouveau job (null = un concurrent vient de prendre le verrou).
  if (!run) {
    run = await claimNewRun(triggerSource);
    if (!run) {
      syncLog('SKIPPED', 'reason=already_running (verrou pris par un concurrent pendant le claim)');
      return { started: false, reason: 'already_running' };
    }
  }

  if (!resumed) {
    // Premier passage du job : les phases dont les données sont déjà
    // fraîches sont marquées faites — un wake déclenché par un LIVE
    // périmé (données cycliques < 10 min) ne doit PAS relancer un cycle
    // complet inutilement (priorité LIVE, §26). La reprise, elle, suit
    // strictement son curseur.
    if (!state.stale) {
      prog.cycleDone = true;
      prog.teamHistoryDone = true;
    }
    if (!state.contextStale) prog.contextDone = true;
  }

  const espnMark = { v: espnStats.total };
  const markEspn = () => {
    const d = espnStats.total - espnMark.v;
    espnMark.v = espnStats.total;
    prog.espnCalls += d;
    return d;
  };

  const saveProgress = async (phase: string) => {
    await db.syncJobRun
      .update({
        where: { id: run!.id },
        data: {
          progress: JSON.stringify(prog),
          stats: JSON.stringify({ ...buildSummary(prog, Date.now() - t0), phase, running: true, triggerSource: 'wake' }),
        },
      })
      .catch(() => {});
  };

  syncLog('STARTED', `runId=${run.id} resumed=${resumed} triggerSource=${triggerSource} budgetMs=${budgetMs} stale=${state.stale} liveStale=${state.liveStale} contextStale=${state.contextStale}`);

  try {
    // ---- PHASE 1 : LIVE (priorité absolue — scores/statuts/cotes des
    //      matchs en direct, exactement la brique du worker) ----
    if (!prog.liveDone) {
      const live = await refreshLiveMatches();
      prog.live = mergeSyncStats(prog.live, live);
      prog.liveDone = true;
      const calls = markEspn();
      await saveProgress('live');
      syncLog('RUNNING', `runId=${run.id} phase=live espnCalls=${calls} matchesUpdated=${(prog.live.matchesCreated + prog.live.matchesUpdated)} oddsUpdated=${prog.live.oddsInserted} elapsedMs=${Date.now() - t0}`);
    }

    // ---- PHASE 2 : CYCLE (matchs futurs + résultats récents + cotes —
    //      mêmes fenêtres que le worker, par lots de 6 ligues) ----
    if (!prog.cycleDone) {
      const { allLeagueCodes } = await import('../forecast/espn-week');
      const codes = allLeagueCodes();
      prog.leaguesTotal = codes.length;
      const from = new Date(Date.now() - CYCLE_DAYS_BACK * 24 * 3_600_000);
      const to = new Date(Date.now() + CYCLE_DAYS_AHEAD * 24 * 3_600_000);
      const season = from.getUTCFullYear();
      let batchNo = prog.chunk;
      let exhausted = false;

      for (let i = prog.chunk * LEAGUE_BATCH; i < codes.length; i += LEAGUE_BATCH) {
        const remaining = budgetMs - (Date.now() - t0);
        if (remaining < MIN_REMAINING_MS) {
          exhausted = true;
          break;
        }
        const batch = codes.slice(i, i + LEAGUE_BATCH);
        const results = await mapWithConcurrency(batch, LEAGUE_BATCH, async (code) => {
          try {
            return { r: await syncLeagueWindow(code, from, to, season), failed: false };
          } catch {
            return { r: { events: 0, failed: true, matchesCreated: 0, matchesUpdated: 0, resultsUpserted: 0, oddsInserted: 0 }, failed: true };
          }
        });
        for (const { r, failed } of results) {
          prog.cycle = mergeSyncStats(prog.cycle, {
            leaguesTotal: 1,
            leaguesFailed: r.failed || failed ? 1 : 0,
            eventsSeen: r.events,
            matchesCreated: r.matchesCreated,
            matchesUpdated: r.matchesUpdated,
            resultsUpserted: r.resultsUpserted,
            oddsInserted: r.oddsInserted,
            skipped: 0,
          });
          prog.leaguesDone++;
        }
        batchNo = Math.floor(i / LEAGUE_BATCH) + 1;
        prog.chunk = batchNo;
        await saveProgress(`cycle:${batchNo}`);
      }
      markEspn();

      if (exhausted && prog.leaguesDone < prog.leaguesTotal) {
        const durationMs = Date.now() - t0;
        await finalizeRun(run.id, 'partial', prog, durationMs, triggerSource);
        syncLog('PARTIAL', `runId=${run.id} phase=cycle chunk=${prog.chunk} leaguesDone=${prog.leaguesDone}/${prog.leaguesTotal} ESPN_CALLS=${prog.espnCalls} MATCHES_UPDATED=${buildSummary(prog, durationMs).matchesUpdatedTotal} ODDS_UPDATED=${buildSummary(prog, durationMs).oddsUpdated} DURATION_MS=${durationMs} (reprise au prochain wake)`);
        return { started: true, runId: run.id, status: 'partial', result: buildSummary(prog, durationMs) };
      }
      prog.cycleDone = true;
      await saveProgress('cycle-done');
      syncLog('RUNNING', `runId=${run.id} phase=cycle-done leaguesDone=${prog.leaguesDone}/${prog.leaguesTotal} matchesUpdated=${(prog.cycle?.matchesCreated ?? 0) + (prog.cycle?.matchesUpdated ?? 0)} oddsUpdated=${prog.cycle?.oddsInserted ?? 0} elapsedMs=${Date.now() - t0}`);
    }

    // ---- PHASE 3 : TEAM-HISTORY (§7 — H2H des équipes à venir, 4 équipes) ----
    if (!prog.teamHistoryDone) {
      if (budgetMs - (Date.now() - t0) < TEAM_HISTORY_MIN_MS) {
        const durationMs = Date.now() - t0;
        await finalizeRun(run.id, 'partial', prog, durationMs, triggerSource);
        syncLog('PARTIAL', `runId=${run.id} phase=team-history ESPN_CALLS=${prog.espnCalls} DURATION_MS=${durationMs} (reprise au prochain wake)`);
        return { started: true, runId: run.id, status: 'partial', result: buildSummary(prog, durationMs) };
      }
      const n = await wakeTeamHistory().catch(() => 0);
      prog.teamHistory = n;
      prog.teamHistoryDone = true;
      markEspn();
      await saveProgress('team-history');
      syncLog('RUNNING', `runId=${run.id} phase=team-history teamsImported=${n} elapsedMs=${Date.now() - t0}`);
    }

    // ---- PHASE 4 : CONTEXTE (standings/blessures/météo — cadence 6 h) ----
    if (!prog.contextDone) {
      const contextFresh = !state.contextStale;
      if (contextFresh) {
        prog.contextDone = true; // rien à faire — contexte < 6 h
      } else if (budgetMs - (Date.now() - t0) < CONTEXT_MIN_MS) {
        const durationMs = Date.now() - t0;
        await finalizeRun(run.id, 'partial', prog, durationMs, triggerSource);
        syncLog('PARTIAL', `runId=${run.id} phase=context ESPN_CALLS=${prog.espnCalls} DURATION_MS=${durationMs} (budget insuffisant — reprise au prochain wake)`);
        return { started: true, runId: run.id, status: 'partial', result: buildSummary(prog, durationMs) };
      } else {
        // teamBudget réduit (12 vs 40) : passe bornée, idempotente par jour UTC.
        const ctx = await runContextSync({ teamBudget: 12 });
        prog.context = ctx;
        prog.contextDone = true;
        markEspn();
        await saveProgress('context');
        syncLog('RUNNING', `runId=${run.id} phase=context standings=${ctx.standingsUpserted} injuries=${ctx.injuriesUpserted} weather=${ctx.weatherCaptured} elapsedMs=${Date.now() - t0}`);
      }
    }

    // ---- SUCCÈS ----
    const durationMs = Date.now() - t0;
    const summary = buildSummary(prog, durationMs);
    await finalizeRun(run.id, 'success', prog, durationMs, triggerSource);
    syncLog('SUCCESS', `runId=${run.id} ESPN_CALLS=${summary.espnCalls} MATCHES_UPDATED=${summary.matchesUpdatedTotal} ODDS_UPDATED=${summary.oddsUpdated} DURATION_MS=${durationMs} leaguesDone=${summary.leaguesDone}/${summary.leaguesTotal}`);
    return { started: true, runId: run.id, status: 'success', result: summary };
  } catch (e) {
    const durationMs = Date.now() - t0;
    const msg = e instanceof Error ? e.message : String(e);
    await finalizeRun(run.id, 'failed', prog, durationMs, triggerSource, msg);
    syncLog('FAILED', `runId=${run.id} error="${msg}" ESPN_CALLS=${prog.espnCalls} DURATION_MS=${durationMs} (relançable — curseur conservé)`);
    return { started: true, runId: run.id, status: 'failed', error: msg, result: buildSummary(prog, durationMs) };
  }
}
