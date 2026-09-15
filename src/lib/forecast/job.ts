// ============================================================
// VOLTRIX bet — Prévisions hebdomadaires : JOB AUTOMATIQUE (§20)
//
// Un « tick » exécute les 8 étapes du cahier des charges :
//   1. récupère les matchs de la semaine (+ semaine suivante) ;
//   2. identifie les nouveaux matchs ;
//   3. génère les prédictions avec le moteur PRODUCTION (v2.1) ;
//   4. les FIGE (insert-only — §5 : jamais écrasées) ;
//   5. surveille les matchs terminés ;
//   6. récupère les résultats (stockés SÉPARÉMENT — §8) ;
//   7. évalue automatiquement les prédictions (§19 Evaluation) ;
//   8. met à jour les statistiques (recalculées à la volée).
//
// Garde-fous :
//   - §6 : une prédiction n'est publiée que si predictionTime < kickoff ;
//   - §5 : le job ne ré-analyse JAMAIS un match déjà prédit
//          (2e exécution = 0 doublon, 0 modification — testé) ;
//   - les écritures SQLite sont séquentielles (1 écrivain) ;
//   - budget de temps par tick (le reliquat passe au tick suivant).
// ============================================================

import { db } from '@/lib/db';
import { analyzeMatch } from '../analyze';
import { buildSnapshotDraft, persistGenericSnapshot } from './snapshot';
import { isFinalStatus, gradeSnapshot, resultKeyOf } from './evaluate';
import { currentWeekStart, nextWeekStart, weekEnd, DAY_MS } from './week';

// Task 28 — AUDIT UTILISATEUR (§7/§8) : le job forecast n'appelle PLUS
// ESPN. La synchronisation (src/lib/sync/sync-job.ts) est la SEULE voie
// d'entrée des données (ESPN → Neon, idempotent par espn_event_id) ; le
// registre ForecastMatch et les résultats sont désormais alimentés
// DEPUIS NEON (table `matches` + `match_results` synchronisées).

export interface TickStats {
  scanned: number;
  newMatches: number;
  predicted: number;
  skippedTooLate: number;
  failedAnalysis: number;
  resultsUpdated: number;
  evaluated: number;
  durationMs: number;
  errors: string[];
}

interface TickOptions {
  /** nombre max de nouvelles prédictions par tick (budget temps sinon) */
  maxPredict?: number;
  /** budget de temps en ms (au-delà, on rend la main) */
  timeBudgetMs?: number;
  /** semaines à scanner (défaut : semaine courante + suivante) */
  weeks?: Date[];
  /** journaliser un ForecastJobRun (défaut true) */
  log?: boolean;
}

// Verrous en mémoire (un seul tick à la fois, un scan par semaine)
const g = globalThis as unknown as {
  __forecastTickRunning?: boolean;
  __forecastLoopStarted?: boolean;
  __forecastWeekScanAt?: Map<string, number>;
};

const MAX_PREDICT_DEFAULT = 12;
const TIME_BUDGET_DEFAULT = 45_000;

/**
 * Étape 1+2 : registre des semaines → ForecastMatch.
 * SOURCE = Neon (table `matches` synchronisée) — plus aucun appel ESPN.
 * Les logos viennent de la table `teams`, le code/nom de ligue de
 * `competitions` (rejoint par competition_id). Les MatchResult ne sont
 * plus écrits ici : la synchronisation est propriétaire de cette table
 * (Task 28 — stepResults ne fait plus que réconcilier depuis Neon).
 */
async function stepScan(weeks: Date[], stats: TickStats): Promise<void> {
  const seen = new Set<string>();
  for (const weekStart of weeks) {
    const rows = await db.match.findMany({
      where: { kickoffAt: { gte: weekStart, lt: weekEnd(weekStart) } },
    });
    // Code/nom de ligue (join compétition) + logos des équipes — 2 aller-retours
    const compIds = [...new Set(rows.map((m) => m.competitionId).filter((x): x is string => !!x))];
    const comps = compIds.length
      ? await db.competition.findMany({ where: { id: { in: compIds } }, select: { id: true, espnLeagueId: true } })
      : [];
    const leagueById = new Map(comps.map((c) => [c.id, c.espnLeagueId]));
    // Logos des équipes de la semaine (un seul aller-retour)
    const teamIds = [...new Set(rows.flatMap((m) => [m.homeTeamId, m.awayTeamId]).filter((x): x is string => !!x))];
    const teams = teamIds.length
      ? await db.team.findMany({ where: { espnTeamId: { in: teamIds } }, select: { espnTeamId: true, logo: true } })
      : [];
    const logoById = new Map(teams.map((t) => [t.espnTeamId, t.logo]));

    for (const m of rows) {
      if (seen.has(m.espnEventId)) continue; // doublon inter-semaines
      seen.add(m.espnEventId);
      const d = {
        league: m.competitionId ? leagueById.get(m.competitionId) ?? '' : '', // code ESPN (ex: eng.1) — entrée du moteur
        leagueName: m.competitionName ?? '',
        kickoff: m.kickoffAt,
        homeTeamId: m.homeTeamId ?? '',
        homeTeam: m.homeTeamName,
        homeLogo: m.homeTeamId ? logoById.get(m.homeTeamId) ?? null : null,
        awayTeamId: m.awayTeamId ?? '',
        awayTeam: m.awayTeamName,
        awayLogo: m.awayTeamId ? logoById.get(m.awayTeamId) ?? null : null,
        espnState: m.espnState ?? (m.status === 'FINAL' ? 'post' : 'pre'),
        statusDetail: m.statusDetail,
      };
      const prev = await db.forecastMatch.findUnique({ where: { matchId: m.espnEventId }, select: { firstSeenAt: true, league: true } });
      if (!prev) stats.newMatches += 1;
      await db.forecastMatch.upsert({
        where: { matchId: m.espnEventId },
        create: { ...d, matchId: m.espnEventId },
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
        }, // registre mutable (état ESPN) — la prédiction, elle, est figée
      });
      stats.scanned += 1;
    }
  }
}

/** Étape 3+4 : prédictions production → snapshot figé (insert-only). */
async function stepPredict(stats: TickStats, opts: Required<Pick<TickOptions, 'maxPredict' | 'timeBudgetMs'>>): Promise<void> {
  const now = Date.now();
  const candidates = await db.forecastMatch.findMany({
    where: { kickoff: { gt: new Date(now) } },
    orderBy: { kickoff: 'asc' },
    select: { matchId: true, league: true, kickoff: true },
  });
  if (candidates.length === 0) return;
  const predicted = await db.forecastSnapshot.findMany({
    where: { matchId: { in: candidates.map((c) => c.matchId) } },
    select: { matchId: true },
  });
  const done = new Set(predicted.map((p) => p.matchId));
  const todo = candidates.filter((c) => !done.has(c.matchId));
  if (todo.length === 0) return;

  const deadline = now + opts.timeBudgetMs;
  let budget = opts.maxPredict;
  for (const c of todo) {
    if (budget <= 0 || Date.now() > deadline) break; // reliquat → tick suivant
    if (new Date(c.kickoff).getTime() <= Date.now()) {
      stats.skippedTooLate += 1; // §6 : trop tard, jamais publié
      continue;
    }
    try {
      const analysis = await analyzeMatch({ matchId: c.matchId, leagueCode: c.league, date: new Date(c.kickoff).toISOString() });
      if (!analysis) {
        stats.failedAnalysis += 1;
        stats.errors.push(`analyse indisponible: ${c.matchId}`);
        continue;
      }
      const draft = buildSnapshotDraft(analysis, Date.now());
      if (!draft.ok) {
        if (draft.reason.includes('§6')) stats.skippedTooLate += 1;
        else stats.errors.push(`snapshot refusé ${c.matchId}: ${draft.reason}`);
        continue;
      }
      const existing = await db.forecastSnapshot.count({ where: { matchId: c.matchId } });
      const version = existing + 1;
      await db.forecastSnapshot.create({
        data: { ...draft.draft, matchId: c.matchId, version, published: true },
      });
      // Task 28 §11-§19 : persistance générique (tous les marchés +
      // composants Poisson/Elo/Forme) dans Neon — INSERT-ONLY §20.
      // Tolerant : un échec ici ne remet jamais en cause le snapshot
      // ForecastSnapshot déjà publié (rétrocompatibilité Task 25).
      try {
        await persistGenericSnapshot(analysis, draft.draft, c.matchId, version);
      } catch (eGen) {
        stats.errors.push(`snapshot générique ${c.matchId}: ${eGen instanceof Error ? eGen.message : String(eGen)}`);
      }
      stats.predicted += 1;
      budget -= 1;
    } catch (e) {
      stats.failedAnalysis += 1;
      stats.errors.push(`exception ${c.matchId}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

/**
 * Étape 5+6 : réconciliation des résultats des matchs passés non
 * définitifs — DEPUIS NEON uniquement (table `matches` synchronisée).
 * La synchronisation (cycle 10 min + live 90 s) est responsable des
 * appels ESPN ; ici on aligne MatchResult sur Match (filet de sécurité
 * si une ingestion a échoué), sans aucune requête ESPN.
 */
async function stepResults(stats: TickStats, timeBudgetMs: number): Promise<void> {
  const now = Date.now();
  const stale = await db.forecastMatch.findMany({
    where: { kickoff: { lt: new Date(now + 30 * 60_000) } }, // passés ou imminents
    orderBy: { kickoff: 'desc' },
    select: { matchId: true, kickoff: true },
  });
  if (stale.length === 0) return;
  const results = await db.matchResult.findMany({
    where: { matchId: { in: stale.map((s) => s.matchId) } },
  });
  const resultMap = new Map(results.map((r) => [r.matchId, r]));
  const finalIds = new Set(results.filter((r) => isFinalStatus(r.status)).map((r) => r.matchId));
  const todo = stale
    .filter((s) => !finalIds.has(s.matchId))
    .filter((s) => now - new Date(s.kickoff).getTime() < 21 * DAY_MS) // fenêtre de rattrapage 3 semaines
    .slice(0, 60);
  if (todo.length === 0) return;

  // Réconciliation NEON : statut/scores viennent de Match (synchronisés)
  const syncRows = await db.match.findMany({
    where: { espnEventId: { in: todo.map((t) => t.matchId) } },
  });
  const matchMap = new Map(syncRows.map((m) => [m.espnEventId, m]));
  for (const s of todo) {
    const m = matchMap.get(s.matchId);
    if (!m) continue; // pas encore dans la base → le sync l'apportera
    const status = m.status; // canonique (ingestStatus côté sync)
    const existing = resultMap.get(s.matchId) ?? null;
    const data = {
      status,
      statusDetail: m.statusDetail,
      // §6 : scores uniquement si définitif — jamais effacer un score connu
      homeScore: status === 'FINAL' ? (m.homeScore ?? existing?.homeScore ?? null) : existing?.status === 'FINAL' ? existing.homeScore : null,
      awayScore: status === 'FINAL' ? (m.awayScore ?? existing?.awayScore ?? null) : existing?.status === 'FINAL' ? existing.awayScore : null,
      retrievedAt: new Date(),
    };
    const winner =
      status === 'FINAL' && data.homeScore != null && data.awayScore != null
        ? data.homeScore > data.awayScore!
          ? 'HOME'
          : data.homeScore < data.awayScore!
            ? 'AWAY'
            : 'DRAW'
        : null;
    if (existing && existing.status === data.status && existing.homeScore === data.homeScore && existing.awayScore === data.awayScore) {
      continue; // rien de nouveau — pas d'écriture inutile
    }
    await db.matchResult.upsert({
      where: { matchId: s.matchId },
      create: { matchId: s.matchId, ...data, winner },
      update: { ...data, winner: winner ?? existing?.winner ?? null }, // anti-retour : winner connu jamais effacé
    });
    stats.resultsUpdated += 1;
  }
}

/** Étape 7 : évalue les snapshots publiés face aux résultats définitifs. */
async function stepEvaluate(stats: TickStats): Promise<void> {
  const snaps = await db.forecastSnapshot.findMany({ where: { published: true } });
  if (snaps.length === 0) return;
  const results = await db.matchResult.findMany({
    where: { matchId: { in: snaps.map((s) => s.matchId) } },
  });
  const resultMap = new Map(results.map((r) => [r.matchId, r]));
  const evals = await db.forecastEvaluation.findMany({
    where: { matchId: { in: snaps.map((s) => s.matchId) } },
  });
  const evalMap = new Map(evals.map((e) => [e.matchId, e]));

  for (const snap of snaps) {
    const r = resultMap.get(snap.matchId);
    if (!r || !isFinalStatus(r.status)) continue; // §9 : rien sans résultat définitif
    const key = resultKeyOf(r);
    const prev = evalMap.get(snap.matchId);
    if (prev && prev.snapshotId === snap.id && prev.resultKey === key) continue; // déjà à jour
    const grades = gradeSnapshot(snap, r);
    const data = {
      snapshotId: snap.id,
      grade1x2: grades.grade1x2,
      gradeOu25: grades.gradeOu25,
      gradeBtts: grades.gradeBtts,
      resultKey: key,
      evaluatedAt: new Date(),
    };
    await db.forecastEvaluation.upsert({
      where: { matchId: snap.matchId },
      create: { matchId: snap.matchId, ...data },
      update: data, // dérivée recalculable — la snapshot, elle, reste intouchée
    });
    stats.evaluated += 1;
  }
}

/** Exécute un tick complet (les étapes sont tolérantes aux pannes individuelles). */
export async function runForecastTick(opts: TickOptions = {}): Promise<TickStats> {
  if (g.__forecastTickRunning) {
    return {
      scanned: 0,
      newMatches: 0,
      predicted: 0,
      skippedTooLate: 0,
      failedAnalysis: 0,
      resultsUpdated: 0,
      evaluated: 0,
      durationMs: 0,
      errors: ['tick déjà en cours (ignoré)'],
    };
  }
  g.__forecastTickRunning = true;
  const startedAt = new Date();
  const stats: TickStats = {
    scanned: 0,
    newMatches: 0,
    predicted: 0,
    skippedTooLate: 0,
    failedAnalysis: 0,
    resultsUpdated: 0,
    evaluated: 0,
    durationMs: 0,
    errors: [],
  };
  const weeks = opts.weeks ?? [currentWeekStart(), nextWeekStart(currentWeekStart())];
  const timeBudget = opts.timeBudgetMs ?? TIME_BUDGET_DEFAULT;
  const runId = opts.log === false ? null : await db.forecastJobRun.create({ data: { startedAt, phase: 'scan' } }).then((r) => r.id).catch(() => null);

  try {
    await stepScan(weeks, stats);
    if (runId) await db.forecastJobRun.update({ where: { id: runId }, data: { phase: 'predict' } }).catch(() => {});
    await stepPredict(stats, { maxPredict: opts.maxPredict ?? MAX_PREDICT_DEFAULT, timeBudgetMs: timeBudget });
    if (runId) await db.forecastJobRun.update({ where: { id: runId }, data: { phase: 'results' } }).catch(() => {});
    await stepResults(stats, Math.max(10_000, timeBudget / 2));
    if (runId) await db.forecastJobRun.update({ where: { id: runId }, data: { phase: 'evaluate' } }).catch(() => {});
    await stepEvaluate(stats);
    stats.durationMs = Date.now() - startedAt.getTime();
    if (runId) {
      await db.forecastJobRun
        .update({
          where: { id: runId },
          data: { phase: 'done', finishedAt: new Date(), stats: JSON.stringify({ ...stats, errors: stats.errors.slice(0, 10) }) },
        })
        .catch(() => {});
    }
  } catch (e) {
    stats.errors.push(e instanceof Error ? e.message : String(e));
    stats.durationMs = Date.now() - startedAt.getTime();
    if (runId) {
      await db.forecastJobRun
        .update({
          where: { id: runId },
          data: { phase: 'error', finishedAt: new Date(), error: stats.errors.join(' | ').slice(0, 500), stats: JSON.stringify({ ...stats, errors: stats.errors.slice(0, 10) }) },
        })
        .catch(() => {});
    }
  } finally {
    g.__forecastTickRunning = false;
  }
  return stats;
}

/**
 * Boucle d'arrière-plan (sécurité quand personne n'a la page ouverte) :
 * un tick toutes les 5 minutes, démarré paresseusement au premier
 * accès aux endpoints forecast. L'UI déclenche aussi des ticks
 * rapprochés quand elle est ouverte (ping 90 s) — les verrous
 * rendent les doublons inoffensifs.
 */
export function ensureForecastLoop(): void {
  if (g.__forecastLoopStarted) return;
  g.__forecastLoopStarted = true;
  const LOOP_MS = 5 * 60_000;
  const loop = () => {
    runForecastTick().catch(() => {});
  };
  setTimeout(loop, 20_000); // premier tick 20 s après le boot du module
  setInterval(loop, LOOP_MS);
}

/**
 * Task 28 — AUDIT UTILISATEUR (§7) : plus aucun scan ESPN à la
 * consultation. Les semaines sont servies par la table Neon `matches`
 * (synchronisation : backfill 21 j arrière / 14 j à venir) ; le registre
 * et les prédictions sont alimentés par la boucle du job (stepScan depuis
 * Neon). La fonction reste exportée pour compatibilité (no-op).
 */
export function ensureWeekScanned(_weekStart: Date): boolean {
  return false;
}

/** État du dernier job (affiché dans l'UI). */
export async function lastJobInfo() {
  const last = await db.forecastJobRun.findFirst({ orderBy: { startedAt: 'desc' } });
  if (!last) return null;
  let stats: unknown = null;
  try {
    stats = last.stats ? JSON.parse(last.stats) : null;
  } catch {
    stats = null;
  }
  return { startedAt: last.startedAt, finishedAt: last.finishedAt, phase: last.phase, error: last.error, stats };
}
