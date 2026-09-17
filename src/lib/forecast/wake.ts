// ============================================================
// VOLTRIX bet — Task 49 (GO 4B) : FORECAST WAKE ON DEMAND
//
// Génération des ForecastSnapshot « à la demande », selon le MÊME
// patron que la synchronisation Wake §26 (Task 45) — patron déjà
// validé en production (verrou PostgreSQL + tranches + reprise sur
// curseur + chaîne serveur after()) :
//
//   Wake sync (ESPN → Neon)
//     ↓ déclenchement post-sync (route /api/sync/wake)
//   DÉTECTION : matchs futurs de Neon sans AUCUN snapshot
//     ↓ tranche bornée par un budget temps
//   moteur v2.1 (analyzeMatch — chemin production 100 % inchangé)
//     ↓ §6 : predictionTime < kickoff (garde ABSOLUE)
//   ForecastSnapshot INSERT-ONLY (+ PredictionSnapshot générique)
//
// CONTEXTE : depuis le 15/09 16:58 UTC (arrêt du worker), plus aucun
// snapshot n'était fabriqué — /api/forecasts/tick répond 403 sous
// Vercel et ensureForecastLoop() est un no-op (VERCEL=1). Les 934
// snapshots existants sont v2.1/figés/immuables ; ce module n'en
// MODIFIE ni n'en REMPLACE aucun : il ne fait qu'INSÉRER des
// snapshots pour les matchs qui n'en ont encore AUCUN (§5 : un match
// déjà prédit n'est JAMAIS ré-analysé).
//
// GARANTIES (miroir §26 + exigences GO 4B) :
//   - ANTI-CONCURRENCE PostgreSQL : le job actif porte
//     runningLock='RUNNING' protégé par un index unique PARTIEL
//     (ForecastJobRun_running_lock_uidx). 20 déclenchements
//     simultanés (cron + post-sync + manuel) → 1 SEUL gagnant ; les
//     autres reçoivent { started:false, reason:'already_running' }.
//   - IDEMPOTENT : aucun match sans snapshot → { started:false,
//     reason:'complete' } sans AUCUN appel ESPN ni écriture.
//   - REPRISABLE : budget temps par tranche (limites Vercel Hobby,
//     maxDuration 120 s) — le curseur (progress.processed, la liste
//     des matchs déjà traités par CE job) est conservé dans Neon ;
//     chaque invocation détecte les candidats À JOUR (un match
//     snapshoté entre-temps sort naturellement de la file).
//   - IMMUABLE : INSERT-only, protégé en base par les 12 triggers
//     §20/§20bis (UPDATE/DELETE ForecastSnapshot rejetés) + la
//     contrainte UNIQUE (matchId, version) → JAMAIS deux snapshots
//     pour le même [matchId, version], JAMAIS de remplacement.
//   - JAMAIS après coup d'envoi : quadruple garde — (1) détection
//     kickoff strictement futur + statut SCHEDULED/PRE, (2) lead
//     minimal avant l'analyse (match imminent = travail perdu
//     évité), (3) statut d'analyse 'pre' exigé, (4) §6 de
//     buildSnapshotDraft (predictionTime < kickoff, garde ABSOLUE).
//   - MOTEUR v2.1 INTouché : ce module ne contient AUCUNE formule —
//     il orchestre analyzeMatch/buildSnapshotDraft/persistGenericSnapshot
//     exactement comme l'ancien job (src/lib/forecast/job.ts
//     stepPredict, inchangé et conservé pour le worker local/VPS).
// ============================================================

import { db } from '@/lib/db';
import { espnStats } from '../espn';
import { analyzeMatch } from '../analyze';
import { buildSnapshotDraft, persistGenericSnapshot } from './snapshot';

// ---------- Seuils (patron §26, adapté à la génération) ----------

/** Verrou orphelin : au-delà, une invocation RUNNING est considérée tuée
 *  (fonction Vercel terminée de force) et peut être reprise. Doit rester
 *  > maxDuration de la route (120 s) avec marge — miroir §26. */
export const FORECAST_STALE_LOCK_MS = 6 * 60_000; // 6 min

/** Horizon de détection — miroir de la fenêtre du cycle de sync
 *  (CYCLE_DAYS_AHEAD = 14 j) : seuls les matchs que la synchronisation
 *  amène réellement dans Neon sont candidats. Les matchs plus lointains
 *  entrent dans la fenêtre au fil des sync suivantes (chaque sync
 *  réussie redéclenche la détection). */
const HORIZON_MS = 14 * 24 * 3_600_000;

/** Lead minimal avant de LANCER une analyse : un match qui kick-off dans
 *  moins de 60 s coûterait une analyse complète (5-9 appels ESPN + moteur)
 *  pour se faire refuser par §6 quelques secondes plus tard — travail
 *  perdu, on l'écarte d'office. La garde §6 (buildSnapshotDraft) reste
 *  l'autorité ABSOLUE, celle-ci n'est qu'une optimisation de budget. */
const KICKOFF_MIN_LEAD_MS = 60_000;

/** Marge de sécurité avant budget épuisé (une analyse ≈ 3-10 s). */
const MIN_REMAINING_MS = 6_000;

/** Plafond de candidats par détection (ceinture de sécurité — le backlog
 *  réel mesuré au 17/09 est de 139 matchs). */
const MAX_CANDIDATES = 400;

/** Budget par invocation — sous la limite Vercel (maxDuration 120 s),
 *  miroir SYNC_WAKE_BUDGET_MS. Surchargable par env. */
const DEFAULT_BUDGET_MS = 45_000;

function getBudgetMs(): number {
  const raw = parseInt(process.env.FORECAST_WAKE_BUDGET_MS ?? '', 10);
  if (Number.isFinite(raw) && raw >= 15_000 && raw <= 240_000) return raw;
  return DEFAULT_BUDGET_MS;
}

/** Chaîne serveur : plafond d'itérations internes d'UNE invocation. */
function getChainMaxLoops(): number {
  const raw = parseInt(process.env.FORECAST_CHAIN_MAX_LOOPS ?? '', 10);
  if (Number.isFinite(raw) && raw >= 1 && raw <= 50) return raw;
  return 8;
}

/** Chaîne serveur : mur temporel compté depuis le DÉBUT de l'invocation.
 *  Miroir SYNC_CHAIN_MAX_WALL_MS (110 s < maxDuration 120 s) — chaque
 *  tranche ne démarre que si elapsed + budget + marge tient sous le mur
 *  → finalisation TOUJOURS propre (partial + verrou libéré + curseur
 *  conservé), jamais de kill plateforme. */
function getChainMaxWallMs(): number {
  const raw = parseInt(process.env.FORECAST_CHAIN_MAX_WALL_MS ?? '', 10);
  if (Number.isFinite(raw) && raw >= 30_000 && raw <= 900_000) return raw;
  return 110_000;
}

/** Marge de dépassement d'une tranche — grain FIN ici (une analyse
 *  ≈ 3-10 s, pas de phase monolithique comme le contexte de sync). */
const CHAIN_TRANCHE_OVERSHOOT_MS = 20_000;

// ---------- Progression (curseur de reprise conservé dans Neon) ----------

export interface ForecastWakeProgress {
  v: 1;
  /** Candidats détectés au démarrage du job (info/traçabilité). */
  detected: number;
  /** MatchIds déjà TRAITÉS par CE job (prédit, écarté §6, refusé,
   *  échoué — peu importe : on ne retente pas dans le même job).
   *  Un nouveau job (prochain déclenchement) repart d'une détection
   *  fraîche : les échecs ponctuels (réseau ESPN…) sont ainsi retentés
   *  au cycle suivant, sans jamais boucler sur un échec permanent. */
  processed: string[];
  predicted: number;
  /** Snapshot apparu entre-temps (un autre écrivain — worker local,
   *  vieille génération — a gagné la course : contrainte UNIQUE). */
  skippedAlreadySnapshot: number;
  /** Kickoff trop proche (lead < 60 s) ou §6 refusé après analyse. */
  skippedTooLate: number;
  /** Analyse terminée mais match déjà commencé/fini (status != 'pre'). */
  skippedStarted: number;
  failedAnalysis: number;
  /** Appels ESPN cumulés sur TOUTES les invocations du job. */
  espnCalls: number;
  resumedCount: number;
  /** Erreurs (plafonnées — traçabilité). */
  errors: string[];
}

function freshProgress(detected = 0): ForecastWakeProgress {
  return {
    v: 1,
    detected,
    processed: [],
    predicted: 0,
    skippedAlreadySnapshot: 0,
    skippedTooLate: 0,
    skippedStarted: 0,
    failedAnalysis: 0,
    espnCalls: 0,
    resumedCount: 0,
    errors: [],
  };
}

function parseProgress(raw: string | null): ForecastWakeProgress | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Partial<ForecastWakeProgress>;
    if (!Array.isArray(p.processed)) return null;
    return { ...freshProgress(), ...p, processed: [...p.processed] };
  } catch {
    return null;
  }
}

// ---------- Logs structurés (diagnostic — miroir §26) ----------

function forecastLog(status: string, extra: string = ''): void {
  console.log(`[VOLTRIX FORECAST] SOURCE=WAKE STATUS=${status}${extra ? ' ' + extra : ''}`);
}

// ---------- Garde-fou : index unique partiel (verrou DB) ----------

const gForecast = globalThis as unknown as { __voltrixForecastIndexChecked?: boolean };

/**
 * Garantit la présence de l'index unique partiel qui matérialise le
 * verrou anti-concurrence. Normalement posé par la migration
 * 20260917000100_forecast_job_lock / scripts/apply-forecast-lock.ts ;
 * appelé ici par précaution (IF NOT EXISTS = no-op si déjà présent).
 * Un échec (droits DDL) n'empêche pas le wake : le claim conditionnel
 * reste sûr sous READ COMMITTED, l'index est la garantie forte.
 */
async function ensureForecastWakeIndex(): Promise<void> {
  if (gForecast.__voltrixForecastIndexChecked) return;
  gForecast.__voltrixForecastIndexChecked = true;
  try {
    const rows = await db.$queryRaw<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public' AND indexname = 'ForecastJobRun_running_lock_uidx'
      ) AS exists`;
    if (rows[0]?.exists) return;
    await db.$executeRawUnsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS "ForecastJobRun_running_lock_uidx" ON "ForecastJobRun"("runningLock") WHERE "runningLock" IS NOT NULL`
    );
    forecastLog('INDEX_ENSURED', 'index=ForecastJobRun_running_lock_uidx');
  } catch (e) {
    console.warn(`[VOLTRIX FORECAST] index verrou non posé (${e instanceof Error ? e.message : 'erreur'}) — apply-forecast-lock.ts requis`);
  }
}

// ---------- État des jobs (running / resumable) ----------

interface ForecastRunRow {
  id: string;
  startedAt: Date;
  finishedAt: Date | null;
  phase: string;
  status: string | null;
  triggerSource: string | null;
  runningLock: string | null;
  progress: string | null;
  error: string | null;
}

interface ForecastRunState {
  running: { id: string; startedAt: Date; triggerSource: string | null } | null;
  resumable: { id: string; startedAt: Date; progress: ForecastWakeProgress } | null;
}

/** Lit l'état du job de génération depuis ForecastJobRun — miroir
 *  (simplifié) de getSyncState : un job 'running' récent → verrou ;
 *  le plus récent partial/failed sans réussite postérieure → reprise. */
async function getForecastRunState(): Promise<ForecastRunState> {
  const rows = (await db.forecastJobRun.findMany({
    orderBy: { startedAt: 'desc' },
    take: 25,
    select: {
      id: true, startedAt: true, finishedAt: true, phase: true,
      status: true, triggerSource: true, runningLock: true, progress: true, error: true,
    },
  })) as unknown as ForecastRunRow[];

  let running: ForecastRunState['running'] = null;
  for (const r of rows) {
    if (r.runningLock === 'RUNNING') {
      if (!running || r.startedAt > running.startedAt) {
        running = { id: r.id, startedAt: r.startedAt, triggerSource: r.triggerSource };
      }
    }
  }

  // Réussite la plus récente (wake moderne ou worker historique 'done').
  let lastDoneMs: number | null = null;
  for (const r of rows) {
    const isDone = r.status === 'success' || (r.status === null && r.finishedAt !== null && r.phase === 'done');
    if (isDone) {
      const endMs = (r.finishedAt ?? r.startedAt).getTime();
      if (lastDoneMs === null || endMs > lastDoneMs) lastDoneMs = endMs;
    }
  }

  let resumable: ForecastRunState['resumable'] = null;
  for (const r of rows) {
    if (r.status !== 'partial' && r.status !== 'failed') continue;
    if (lastDoneMs !== null && r.startedAt.getTime() < lastDoneMs) break; // une réussite plus récente existe
    const prog = parseProgress(r.progress);
    if (!prog) continue;
    resumable = { id: r.id, startedAt: r.startedAt, progress: prog };
    break;
  }

  return { running, resumable };
}

// ---------- Détection : matchs futurs de Neon SANS snapshot ----------

export interface SnapshotCandidate {
  matchId: string;
  kickoffMs: number;
  kickoffISO: string;
  leagueCode: string; // code ESPN (ex: eng.1) — entrée du moteur
  competitionId: string | null;
  competitionName: string | null;
  homeTeamId: string | null;
  homeTeamName: string;
  awayTeamId: string | null;
  awayTeamName: string;
  status: string;
  espnState: string | null;
  statusDetail: string | null;
}

/**
 * DÉTECTION (l'étape « détection des matchs nécessitant un snapshot »
 * de l'architecture validée) — 2 SELECT Neon, ZÉRO ESPN :
 *   - matchs dont le kickoff est strictement futur, dans l'horizon 14 j
 *     (fenêtre réelle de la sync), statut SCHEDULED/PRE (les matchs
 *     annulés/reportés/terminés ne sont JAMAIS candidats) ;
 *   - SANS aucun ForecastSnapshot existant (§5 : ne jamais ré-analyser
 *     un match déjà prédit — quelque soit la version/modèle, le
 *     snapshot historique fait foi) ;
 *   - ordonnés par kickoff CROISSANT (les plus urgents d'abord).
 */
export async function detectSnapshotCandidates(now: Date = new Date()): Promise<SnapshotCandidate[]> {
  const rows = await db.match.findMany({
    where: {
      kickoffAt: { gt: now, lt: new Date(now.getTime() + HORIZON_MS) },
      status: { in: ['SCHEDULED', 'PRE'] },
    },
    orderBy: { kickoffAt: 'asc' },
    take: MAX_CANDIDATES,
    select: {
      espnEventId: true, kickoffAt: true, competitionId: true, competitionName: true,
      homeTeamId: true, homeTeamName: true, awayTeamId: true, awayTeamName: true,
      status: true, espnState: true, statusDetail: true,
    },
  });
  if (rows.length === 0) return [];

  const snapped = await db.forecastSnapshot.findMany({
    where: { matchId: { in: rows.map((r) => r.espnEventId) } },
    select: { matchId: true },
  });
  const done = new Set(snapped.map((s) => s.matchId));

  // Code ligue ESPN (entrée du moteur) — join compétition (miroir stepScan).
  const compIds = [...new Set(rows.map((r) => r.competitionId).filter((x): x is string => !!x))];
  const comps = compIds.length
    ? await db.competition.findMany({ where: { id: { in: compIds } }, select: { id: true, espnLeagueId: true } })
    : [];
  const leagueById = new Map(comps.map((c) => [c.id, c.espnLeagueId]));

  return rows
    .filter((r) => !done.has(r.espnEventId))
    .map((r) => ({
      matchId: r.espnEventId,
      kickoffMs: r.kickoffAt.getTime(),
      kickoffISO: r.kickoffAt.toISOString(),
      leagueCode: r.competitionId ? leagueById.get(r.competitionId) ?? '' : '',
      competitionId: r.competitionId,
      competitionName: r.competitionName,
      homeTeamId: r.homeTeamId,
      homeTeamName: r.homeTeamName,
      awayTeamId: r.awayTeamId,
      awayTeamName: r.awayTeamName,
      status: r.status,
      espnState: r.espnState,
      statusDetail: r.statusDetail,
    }));
}

// ---------- Registre ForecastMatch (miroir stepScan, au candidat près) ----------

/**
 * Maintient le registre ForecastMatch pour le candidat traité — même
 * mapping que stepScan (job.ts) : le registre est MUTABLE par design
 * (état d'affichage), seule la prédiction est figée. Écriture limitée
 * aux candidats effectivement analysés (quelques lignes/jour), pas de
 * re-scan complet de fenêtre.
 */
async function upsertRegistryForCandidate(
  c: SnapshotCandidate,
  leagueCode: string,
  logoById: Map<string, string | null>
): Promise<void> {
  const d = {
    league: leagueCode,
    leagueName: c.competitionName ?? '',
    kickoff: new Date(c.kickoffMs),
    homeTeamId: c.homeTeamId ?? '',
    homeTeam: c.homeTeamName,
    homeLogo: c.homeTeamId ? logoById.get(c.homeTeamId) ?? null : null,
    awayTeamId: c.awayTeamId ?? '',
    awayTeam: c.awayTeamName,
    awayLogo: c.awayTeamId ? logoById.get(c.awayTeamId) ?? null : null,
    espnState: c.espnState ?? (c.status === 'FINAL' ? 'post' : 'pre'),
    statusDetail: c.statusDetail,
  };
  await db.forecastMatch.upsert({
    where: { matchId: c.matchId },
    create: { ...d, matchId: c.matchId },
    update: {
      // NB : le code ligue historique du registre est conservé (les
      // snapshots le référencent) ; les champs d'affichage sont rafraîchis.
      leagueName: d.leagueName,
      kickoff: d.kickoff,
      homeTeamId: d.homeTeamId,
      homeTeam: d.homeTeam,
      homeLogo: d.homeLogo,
      awayTeamId: d.awayTeamId,
      awayTeam: d.awayTeam,
      awayLogo: d.awayLogo,
      espnState: d.espnState,
      statusDetail: d.statusDetail,
    },
  });
}

// ---------- Verrou : claim / takeover / libération (miroir §26) ----------

/** Tente de REPRENDRE un job résumable (partial/failed avec curseur).
 *  UPDATE conditionnel (runningLock IS NULL) → sûr sous READ COMMITTED :
 *  un seul concurrent obtient rowCount=1, l'index unique partiel sert de
 *  ceinture de sécurité. */
async function claimResumable(id: string): Promise<boolean> {
  const claimed = await db.forecastJobRun.updateMany({
    where: { id, runningLock: null },
    data: { runningLock: 'RUNNING', status: 'running', error: null, startedAt: new Date() },
  });
  return claimed.count === 1;
}

/** Crée un NOUVEAU job verrouillé. Échoue (null) si un concurrent tient
 *  le verrou (P2002 / violation index unique partiel). */
async function claimNewRun(triggerSource: string): Promise<{ id: string } | null> {
  try {
    const created = await db.forecastJobRun.create({
      data: {
        phase: 'forecast-wake',
        status: 'running',
        triggerSource,
        runningLock: 'RUNNING',
        startedAt: new Date(),
      },
      select: { id: true },
    });
    return created;
  } catch {
    return null;
  }
}

function isUniqueViolation(e: unknown): boolean {
  return (
    typeof e === 'object' && e !== null && 'code' in e && (e as { code?: string }).code === 'P2002'
  );
}

/** Marque un job terminé + LIBÈRE le verrou (toujours, succès comme échec). */
async function finalizeRun(
  id: string,
  status: 'success' | 'partial' | 'failed',
  prog: ForecastWakeProgress,
  durationMs: number,
  triggerSource: string,
  error?: string
): Promise<void> {
  const summary = buildSummary(prog, durationMs);
  try {
    await db.forecastJobRun.update({
      where: { id },
      data: {
        status,
        phase: status === 'failed' ? 'error' : 'done',
        finishedAt: new Date(),
        runningLock: null,
        error: error ?? null,
        stats: JSON.stringify({ ...summary, triggerSource }),
        progress: JSON.stringify(prog),
      },
    });
  } catch (e) {
    // La libération du verrou ne doit JAMAIS échouer silencieusement :
    // sans ça, tous les déclenchements suivants seraient rejetés jusqu'au
    // takeover. Miroir §26.
    console.error(`[VOLTRIX FORECAST] finalize ${id} a échoué (${e instanceof Error ? e.message : '?'}) — libération forcée du verrou`);
    await db.forecastJobRun.updateMany({ where: { id, runningLock: 'RUNNING' }, data: { runningLock: null } }).catch(() => {});
  }
}

// ---------- Résultat d'un appel forecast wake ----------

export interface ForecastWakeSummary {
  durationMs: number;
  espnCalls: number;
  detected: number;
  predicted: number;
  skippedAlreadySnapshot: number;
  skippedTooLate: number;
  skippedStarted: number;
  failedAnalysis: number;
  processed: number;
  resumed: boolean;
  errors: string[];
}

export interface ForecastWakeResult {
  started: boolean;
  reason?: 'complete' | 'already_running';
  runId?: string;
  status?: 'success' | 'partial' | 'failed';
  error?: string;
  result?: ForecastWakeSummary;
}

function buildSummary(prog: ForecastWakeProgress, durationMs: number): ForecastWakeSummary {
  return {
    durationMs,
    espnCalls: prog.espnCalls,
    detected: prog.detected,
    predicted: prog.predicted,
    skippedAlreadySnapshot: prog.skippedAlreadySnapshot,
    skippedTooLate: prog.skippedTooLate,
    skippedStarted: prog.skippedStarted,
    failedAnalysis: prog.failedAnalysis,
    processed: prog.processed.length,
    resumed: prog.resumedCount > 0,
    errors: prog.errors.slice(0, 10),
  };
}

// ---------- Chaîne de continuation SERVEUR (miroir §26-bis) ----------

export interface ForecastChainResult {
  loops: number;
  ended: 'success' | 'failed' | 'budget' | 'stopped';
  runId?: string;
}

/**
 * Enchaîne les tranches de génération CÔTÉ SERVEUR jusqu'à completion.
 * Appelée par la route /api/forecasts/wake via after() (et par la route
 * sync/wake après une sync réussie) : le passage d'une tranche à la
 * suivante NE DÉPEND PAS du navigateur — l'utilisateur peut fermer
 * l'application dès la première réponse, la chaîne continue dans
 * l'invocation serveur (Neon = source de vérité du curseur).
 *
 * Chaque itération repasse par runForecastWake → claim conditionnel :
 * il n'existe JAMAIS deux générateurs simultanés, un seul obtient le
 * curseur, l'autre reçoit already_running et s'arrête.
 */
export async function runForecastWakeChainUntilDone(startedAtMs: number): Promise<ForecastChainResult> {
  const maxLoops = getChainMaxLoops();
  const maxWall = getChainMaxWallMs();
  let loops = 0;
  for (;;) {
    const elapsed = Date.now() - startedAtMs;
    // Vérification ANTICIPÉE : n'amorce une nouvelle tranche que si
    // elapsed + budget + marge tient sous le mur → l'invocation se
    // termine toujours PROPREMENT (partial finalisé, verrou libéré)
    // bien avant le kill plateforme (maxDuration).
    if (loops >= maxLoops || elapsed + getBudgetMs() + CHAIN_TRANCHE_OVERSHOOT_MS > maxWall) {
      forecastLog('RUNNING', `phase=chain-stop loops=${loops} maxLoops=${maxLoops} (budget invocation atteint — curseur conservé, reprise par cron GET / prochain déclenchement)`);
      return { loops, ended: 'budget' };
    }
    loops++;
    const r = await runForecastWake({ triggerSource: 'forecast-chain' });
    if (r.started && r.status === 'success') {
      return { loops, ended: 'success', runId: r.runId };
    }
    if (r.status === 'failed') {
      forecastLog('RUNNING', `phase=chain-failed loops=${loops} runId=${r.runId ?? '-'} (chaîne stoppée sur échec — reprise ultérieure)`);
      return { loops, ended: 'failed', runId: r.runId };
    }
    if (r.status !== 'partial') {
      // complete / already_running : plus rien à enchaîner dans CETTE
      // invocation — s'arrêter proprement sans polluer.
      return { loops, ended: 'stopped', runId: r.runId };
    }
  }
}

// ---------- Pipeline principal ----------

/**
 * Exécute UNE tranche de génération (verrouillée, idempotente, reprise
 * sur curseur). Flow :
 *   1. verrou : job actif < 6 min → already_running ; orphelin → takeover ;
 *   2. détection : 0 candidat → complete (NO-OP, 0 ESPN, 0 écriture) ;
 *   3. claim : reprise du job interrompu (curseur) ou nouveau job ;
 *   4. tranche : analyse moteur v2.1 + snapshot INSERT-ONLY, match après
 *      match (le plus urgent d'abord), jusqu'à épuisement du budget ;
 *   5. finalisation : success (tout traité) / partial (budget — curseur
 *      conservé) / failed (erreur DB — curseur conservé).
 */
export async function runForecastWake(opts?: { triggerSource?: string; budgetMs?: number }): Promise<ForecastWakeResult> {
  const triggerSource = opts?.triggerSource ?? 'forecast-wake';
  const budgetMs = opts?.budgetMs ?? getBudgetMs();
  const t0 = Date.now();
  await ensureForecastWakeIndex();

  const state = await getForecastRunState();

  // Job dont le verrou orphelin sera récupéré plus bas (curseur à reprendre).
  let recovered: string | null = null;

  // 1) Un job de génération est-il déjà actif ?
  if (state.running) {
    const age = Date.now() - state.running.startedAt.getTime();
    if (age < FORECAST_STALE_LOCK_MS) {
      forecastLog('SKIPPED', `reason=already_running runId=${state.running.id} ageMs=${age}`);
      return { started: false, reason: 'already_running', runId: state.running.id };
    }
    // Verrou orphelin (fonction tuée par la plateforme) → reprise contrôlée.
    const taken = await db.forecastJobRun.updateMany({
      where: { id: state.running.id, runningLock: 'RUNNING' },
      data: {
        status: 'failed',
        error: 'verrou orphelin repris — invocation précédente terminée de force (timeout/maxDuration)',
        runningLock: null,
        finishedAt: new Date(),
      },
    });
    if (taken.count === 0) {
      forecastLog('SKIPPED', `reason=already_running runId=${state.running.id} (repris par un concurrent)`);
      return { started: false, reason: 'already_running', runId: state.running.id };
    }
    forecastLog('LOCK_RECOVERED', `runId=${state.running.id} ageMs=${age} (verrou orphelin)`);
    recovered = state.running.id;
  }

  // 2) Détection — l'idempotence se mesure ICI (0 candidat = rien à faire).
  const candidates = await detectSnapshotCandidates();
  if (candidates.length === 0 && !state.resumable && !recovered) {
    forecastLog('SKIPPED', 'reason=complete (aucun match futur sans snapshot — 0 ESPN)');
    return { started: false, reason: 'complete' };
  }

  // 3) Reprise d'un job interrompu (curseur conservé dans Neon)…
  let run: { id: string } | null = null;
  let prog: ForecastWakeProgress = freshProgress(candidates.length);
  let resumed = false;

  if (state.resumable) {
    const ok = await claimResumable(state.resumable.id);
    if (ok) {
      run = { id: state.resumable.id };
      prog = state.resumable.progress;
      prog.detected = Math.max(prog.detected, candidates.length);
      prog.resumedCount += 1;
      resumed = true;
    }
  }
  // …y compris le job dont le verrou orphelin vient d'être récupéré.
  if (!run && recovered) {
    const ok = await claimResumable(recovered);
    if (ok) {
      const row = await db.forecastJobRun.findUnique({ where: { id: recovered }, select: { progress: true } });
      run = { id: recovered };
      prog = parseProgress(row?.progress ?? null) ?? freshProgress(candidates.length);
      prog.detected = Math.max(prog.detected, candidates.length);
      prog.resumedCount += 1;
      resumed = true;
      forecastLog('RUNNING', `runId=${run.id} phase=recovered-resume processed=${prog.processed.length} (curseur orphelin repris)`);
    }
  }
  // …sinon nouveau job (null = un concurrent vient de prendre le verrou).
  if (!run) {
    run = await claimNewRun(triggerSource);
    if (!run) {
      forecastLog('SKIPPED', 'reason=already_running (verrou pris par un concurrent pendant le claim)');
      return { started: false, reason: 'already_running' };
    }
  }

  const processedSet = new Set(prog.processed);
  const espnMark = { v: espnStats.total };
  const markEspn = () => {
    const d = espnStats.total - espnMark.v;
    espnMark.v = espnStats.total;
    prog.espnCalls += d;
    return d;
  };

  const saveProgress = async (phase: string) => {
    await db.forecastJobRun
      .update({
        where: { id: run!.id },
        data: {
          progress: JSON.stringify(prog),
          stats: JSON.stringify({ ...buildSummary(prog, Date.now() - t0), phase, running: true, triggerSource }),
        },
      })
      .catch(() => {});
  };

  forecastLog('STARTED', `runId=${run.id} resumed=${resumed} triggerSource=${triggerSource} budgetMs=${budgetMs} detected=${candidates.length} pending=${candidates.filter((c) => !processedSet.has(c.matchId)).length}`);

  try {
    // Logos du registre (un seul aller-retour pour les candidats de la tranche).
    const teamIds = [...new Set(candidates.flatMap((c) => [c.homeTeamId, c.awayTeamId]).filter((x): x is string => !!x))];
    const teams = teamIds.length
      ? await db.team.findMany({ where: { espnTeamId: { in: teamIds } }, select: { espnTeamId: true, logo: true } })
      : [];
    const logoById = new Map<string, string | null>(teams.map((t) => [t.espnTeamId, t.logo]));

    let i = 0;
    for (const c of candidates) {
      i++;
      if (processedSet.has(c.matchId)) continue; // déjà traité par CE job (curseur)

      // Budget : rendre la main AVANT d'amorcer une analyse complète.
      if (Date.now() - t0 > budgetMs - MIN_REMAINING_MS) {
        const durationMs = Date.now() - t0;
        await finalizeRun(run.id, 'partial', prog, durationMs, triggerSource);
        forecastLog('PARTIAL', `runId=${run.id} phase=predict at=${i}/${candidates.length} predicted=${prog.predicted} processed=${prog.processed.length} ESPN_CALLS=${prog.espnCalls} DURATION_MS=${durationMs} (reprise au prochain déclenchement — curseur conservé)`);
        return { started: true, runId: run.id, status: 'partial', result: buildSummary(prog, durationMs) };
      }

      // Garde (2) : lead minimal — match imminent, l'analyse serait refusée
      // par §6 avant même de finir (optimisation de budget, pas une autorité).
      if (c.kickoffMs <= Date.now() + KICKOFF_MIN_LEAD_MS) {
        processedSet.add(c.matchId);
        prog.processed.push(c.matchId);
        prog.skippedTooLate += 1;
        continue;
      }

      // Registre ForecastMatch (miroir stepScan — pure Neon, pas d'ESPN).
      await upsertRegistryForCandidate(c, c.leagueCode, logoById).catch(() => {});

      // Analyse moteur v2.1 — chemin production 100 % inchangé
      // (analyzeMatch : scoreboard + historiques + classement + blessures
      //  + météo ESPN/Open-Meteo, puis runEngine v2.1 NON modifié).
      let analysis: Awaited<ReturnType<typeof analyzeMatch>> = null;
      try {
        analysis = await analyzeMatch({ matchId: c.matchId, leagueCode: c.leagueCode, date: c.kickoffISO });
      } catch (e) {
        markEspn(); // les appels éventuels ont bien eu lieu (comptage exact)
        processedSet.add(c.matchId);
        prog.processed.push(c.matchId);
        prog.failedAnalysis += 1;
        if (prog.errors.length < 10) prog.errors.push(`exception ${c.matchId}: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
      if (!analysis) {
        markEspn(); // idem : les fetchs ESPN ont été tentés avant l'échec
        processedSet.add(c.matchId);
        prog.processed.push(c.matchId);
        prog.failedAnalysis += 1;
        if (prog.errors.length < 10) prog.errors.push(`analyse indisponible: ${c.matchId}`);
        continue;
      }

      // Garde (3) : le match a démarré entre la détection et la fin de
      // l'analyse → AUCUN snapshot (même si §6 n'a pas encore parlé).
      if (analysis.status !== 'pre') {
        processedSet.add(c.matchId);
        prog.processed.push(c.matchId);
        prog.skippedStarted += 1;
        markEspn();
        continue;
      }

      // Snapshot draft — garde (4) §6 ABSOLUE : predictionTime < kickoff.
      const draft = buildSnapshotDraft(analysis, Date.now());
      if (!draft.ok) {
        processedSet.add(c.matchId);
        prog.processed.push(c.matchId);
        if (draft.reason.includes('§6')) prog.skippedTooLate += 1;
        else if (prog.errors.length < 10) prog.errors.push(`snapshot refusé ${c.matchId}: ${draft.reason}`);
        markEspn();
        continue;
      }
      markEspn();

      // Version = nb de snapshots existants + 1 (miroir stepPredict) —
      // la contrainte UNIQUE (matchId, version) est la garantie DB
      // « jamais deux snapshots pour le même [matchId, version] ».
      const existing = await db.forecastSnapshot.count({ where: { matchId: c.matchId } });
      const version = existing + 1;

      try {
        await db.forecastSnapshot.create({
          data: { ...draft.draft, matchId: c.matchId, version, published: true },
        });
      } catch (e) {
        if (isUniqueViolation(e)) {
          // Un autre écrivain (worker local, génération précédente) a gagné
          // la course : le snapshot N'EST PAS dupliqué — on l'acte et on
          // passe au match suivant. Le générique n'est PAS écrit (le
          // ForecastSnapshot est le passage obligé).
          processedSet.add(c.matchId);
          prog.processed.push(c.matchId);
          prog.skippedAlreadySnapshot += 1;
          continue;
        }
        throw e; // erreur DB réelle → failed (curseur conservé)
      }

      // Architecture générique (§11-§19 : tous les marchés + composants) —
      // INSERT-ONLY, tolérant (miroir stepPredict : un échec ici ne remet
      // jamais en cause le ForecastSnapshot déjà publié).
      try {
        await persistGenericSnapshot(analysis, draft.draft, c.matchId, version);
      } catch (eGen) {
        if (prog.errors.length < 10) prog.errors.push(`snapshot générique ${c.matchId}: ${eGen instanceof Error ? eGen.message : String(eGen)}`);
      }

      processedSet.add(c.matchId);
      prog.processed.push(c.matchId);
      prog.predicted += 1;
      await saveProgress('predict');
    }

    // ---- SUCCÈS : tous les candidats détectés ont été traités ----
    const durationMs = Date.now() - t0;
    const summary = buildSummary(prog, durationMs);
    await finalizeRun(run.id, 'success', prog, durationMs, triggerSource);
    forecastLog('SUCCESS', `runId=${run.id} PREDICTED=${summary.predicted} PROCESSED=${summary.processed}/${candidates.length} ESPN_CALLS=${summary.espnCalls} DURATION_MS=${durationMs}`);
    return { started: true, runId: run.id, status: 'success', result: summary };
  } catch (e) {
    const durationMs = Date.now() - t0;
    const msg = e instanceof Error ? e.message : String(e);
    await finalizeRun(run.id, 'failed', prog, durationMs, triggerSource, msg);
    forecastLog('FAILED', `runId=${run.id} error="${msg}" PREDICTED=${prog.predicted} DURATION_MS=${durationMs} (relançable — curseur conservé)`);
    return { started: true, runId: run.id, status: 'failed', error: msg, result: buildSummary(prog, durationMs) };
  }
}

// ---------- Vue d'ensemble (diagnostic route/UI) ----------

export interface ForecastWakeOverview {
  now: string;
  running: { id: string; startedAt: string; triggerSource: string | null } | null;
  resumable: { id: string; startedAt: string; processed: number } | null;
  /** Candidats actuels (matchs futurs sans snapshot, horizons 14 j). */
  pending: number;
  lastRun: {
    id: string; phase: string; status: string | null; triggerSource: string | null;
    startedAt: string; finishedAt: string | null; error: string | null;
  } | null;
}

/** État lisible du pipeline de génération (route GET / diagnostic). */
export async function getForecastWakeOverview(): Promise<ForecastWakeOverview> {
  const [state, candidates, last] = await Promise.all([
    getForecastRunState(),
    detectSnapshotCandidates(),
    db.forecastJobRun.findFirst({ orderBy: { startedAt: 'desc' }, select: { id: true, phase: true, status: true, triggerSource: true, startedAt: true, finishedAt: true, error: true } }),
  ]);
  return {
    now: new Date().toISOString(),
    running: state.running
      ? { id: state.running.id, startedAt: state.running.startedAt.toISOString(), triggerSource: state.running.triggerSource }
      : null,
    resumable: state.resumable
      ? { id: state.resumable.id, startedAt: state.resumable.startedAt.toISOString(), processed: state.resumable.progress.processed.length }
      : null,
    pending: candidates.length,
    lastRun: last
      ? {
          id: last.id,
          phase: last.phase,
          status: last.status,
          triggerSource: last.triggerSource,
          startedAt: last.startedAt.toISOString(),
          finishedAt: last.finishedAt ? last.finishedAt.toISOString() : null,
          error: last.error,
        }
      : null,
  };
}
