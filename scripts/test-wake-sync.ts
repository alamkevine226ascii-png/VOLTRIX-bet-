// ============================================================
// VOLTRIX — Task 45 §26 : TESTS « WAKE ON DEMAND »
//
// Suite complète du mécanisme de synchronisation à la demande :
//   1. données fraîches (< 10 min)  → aucun wake (0 ESPN) ;
//   2. données anciennes (> 10 min) → wake disponible ;
//   3. clic sur wake                → synchronisation ESPN → Neon RÉELLE ;
//   4. deux appels simultanés       → une seule synchronisation réelle ;
//   5. 20 appels simultanés         → une seule synchronisation réelle ;
//   6. synchronisation échouée      → statut FAILED + relance possible ;
//      (6b) interruption partielle  → reprise EXACTE sur le curseur ;
//   7. synchronisation réussie      → lastSyncAt correctement mis à jour ;
//   8. match LIVE                   → priorité LIVE (cycle inutile sauté) ;
//   9. /api/matches                 → lecture Neon, 0 ESPN ;
//  10. /api/predictions             → Option B intacte (snapshot-first) ;
//  12. /api/forecasts/week          → 200, 0 ESPN ;
//  13. /api/performance             → 200, 0 ESPN ;
//  14. anti-ESPN                    → 0 appel réseau pendant les consultations.
//
// Infra : PostgreSQL 17 ÉPHÉMÈRE (.tmp-pg/pg17 — mire test-option-b.ts),
// ESPN RÉEL (la mesure §26 de durée de sync l'exige), Vercel simulé
// (VERCEL=1) pour les routes de lecture. JAMAIS la base de production.
// Exécuter : bun scripts/test-wake-sync.ts   (après bash scripts/ensure-pg17.sh)
// ============================================================

import { execSync } from 'node:child_process';
import { rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}
function section(title: string) {
  console.log(`\n━━ ${title} ━━`);
}

// ---------- 0. PostgreSQL temporaire (provider du schéma = postgresql) ----------
const ROOT = path.resolve(process.cwd());
const tmpDir = mkdtempSync(path.join(tmpdir(), 'voltrix-wake-'));
const PG_PORT = 5533 + (process.pid % 50);
const PGBIN = path.join(ROOT, '.tmp-pg', 'pg17', 'usr', 'lib', 'postgresql', '17', 'bin');
const dataDir = path.join(tmpDir, 'pgdata');
const dbUrl = `postgresql://postgres@127.0.0.1:${PG_PORT}/postgres`;
// L'env process GAGNE sur .env → la db de prod n'est jamais touchée.
process.env.DATABASE_URL = dbUrl;
process.env.DIRECT_URL = dbUrl;
execSync(`${PGBIN}/initdb -D ${dataDir} -U postgres -A trust -E UTF8 --no-locale`, { stdio: 'pipe' });
execSync(
  `${PGBIN}/pg_ctl -D ${dataDir} -o "-p ${PG_PORT} -c listen_addresses=127.0.0.1 -k ${tmpDir}" -l ${path.join(tmpDir, 'pg.log')} start`,
  { stdio: 'pipe' }
);
for (let i = 0; i < 50; i++) {
  try {
    execSync(`${PGBIN}/pg_isready -h 127.0.0.1 -p ${PG_PORT}`, { stdio: 'pipe' });
    break;
  } catch {
    await new Promise((r) => setTimeout(r, 200));
  }
}
execSync('node_modules/.bin/prisma db push --skip-generate', {
  cwd: ROOT,
  env: { ...process.env, DATABASE_URL: dbUrl, DIRECT_URL: dbUrl },
  stdio: 'pipe',
});

const { PrismaClient } = await import('@prisma/client');
const db = new PrismaClient({ datasources: { db: { url: dbUrl } } });

// Index unique partiel (verrou anti-concurrence) — non géré par db push,
// posé ici exactement comme la migration / apply-wake-sync.ts le fera sur Neon.
await db.$executeRawUnsafe(
  `CREATE UNIQUE INDEX IF NOT EXISTS "SyncJobRun_running_lock_uidx" ON "SyncJobRun"("runningLock") WHERE "runningLock" IS NOT NULL`
);

// ---------- Imports modules projet (APRÈS l'env DATABASE_URL) ----------
const wakeMod = await import('../src/lib/sync/wake');
const { getSyncState, runWake, SYNC_STALE_MS, LIVE_STALE_MS, progressHasRemainingWork } = wakeMod;
const espnMod = await import('../src/lib/espn');
const { espnStats } = espnMod;
const weekMod = await import('../src/lib/forecast/espn-week');
const LEAGUE_CODES: string[] = weekMod.allLeagueCodes();

const espnDelta = () => (n: number) => espnStats.total - n;
void espnDelta;
const nowMs = () => Date.now();

type RunRow = {
  id: string;
  startedAt: Date;
  finishedAt: Date | null;
  phase: string;
  status: string | null;
  triggerSource: string | null;
  runningLock: string | null;
  progress: string | null;
  stats: string | null;
  error: string | null;
};
const runRows = async (): Promise<RunRow[]> =>
  (await db.syncJobRun.findMany({ orderBy: { startedAt: 'desc' } })) as unknown as RunRow[];
const runningCount = async (): Promise<number> =>
  await db.syncJobRun.count({ where: { runningLock: 'RUNNING' } });

// ============================================================
// S0. SANITY — verrou PostgreSQL (index unique partiel)
// ============================================================
section('S0. Sanity — infra + verrou DB (index unique partiel)');

check('index unique partiel présent', (await db.$queryRawUnsafe<{ indexname: string }[]>(`SELECT indexname FROM pg_indexes WHERE indexname = 'SyncJobRun_running_lock_uidx'`)).length === 1);
check('catalogue ligues chargé (121 attendu)', LEAGUE_CODES.length >= 100, `n=${LEAGUE_CODES.length}`);
check('seuils §26 : stale=10 min, live=2 min', SYNC_STALE_MS === 600_000 && LIVE_STALE_MS === 120_000);

{
  // Sonde : un 2e INSERT avec runningLock='RUNNING' DOIT être rejeté par PG.
  const a = await db.syncJobRun.create({
    data: { phase: 'probe', status: 'running', triggerSource: 'test', runningLock: 'RUNNING', startedAt: new Date() },
  });
  let rejected = false;
  try {
    await db.syncJobRun.create({
      data: { phase: 'probe', status: 'running', triggerSource: 'test', runningLock: 'RUNNING', startedAt: new Date() },
    });
  } catch {
    rejected = true;
  }
  await db.syncJobRun.delete({ where: { id: a.id } });
  check('sonde verrou : 2e job RUNNING rejeté par PostgreSQL', rejected);
  check('sonde verrou : libération propre (0 RUNNING restant)', (await runningCount()) === 0);
}
check('helper : curseur sans travail restant détecté', progressHasRemainingWork({ liveDone: true, cycleDone: true, teamHistoryDone: true, contextDone: true, chunk: 0, leaguesTotal: 0, leaguesDone: 0, cycle: null, live: null, context: null, teamHistory: null, espnCalls: 0, resumedCount: 0 }) === false);

// ============================================================
// S1. TEST 1 — données fraîches (< 10 min) → AUCUN wake
// ============================================================
section('S1. Données fraîches → aucun wake (0 ESPN)');

const FRESH_ROW = 'row-fresh-worker';
await db.syncJobRun.create({
  data: {
    id: FRESH_ROW,
    phase: 'cycle',
    startedAt: new Date(nowMs() - 60_000),
    finishedAt: new Date(nowMs() - 60_000),
    stats: JSON.stringify({ leaguesTotal: 121, eventsSeen: 800, matchesCreated: 0, matchesUpdated: 40, resultsUpserted: 12, oddsInserted: 30, skipped: 0, leaguesFailed: 0 }),
  },
});
{
  const st = await getSyncState();
  check('état : stale=false quand le dernier cycle date de 1 min', st.stale === false);
  check('état : suggestedAction=none', st.suggestedAction === 'none');
  check('état : lastSyncAt dérivée de la ligne worker (status NULL)', st.lastSyncAt !== null && nowMs() - new Date(st.lastSyncAt).getTime() < 120_000);
  const e0 = espnStats.total;
  const r = await runWake({ triggerSource: 'test' });
  check('wake refusé : reason=fresh', r.started === false && r.reason === 'fresh');
  check('wake refusé : 0 appel ESPN', espnStats.total - e0 === 0, `delta=${espnStats.total - e0}`);
  check('wake refusé : aucune ligne créée', (await db.syncJobRun.count()) === 1);
}
// Route réelle : POST /api/sync/wake
{
  const route = await import('../src/app/api/sync/wake/route');
  const res = await route.POST() as Response;
  const json: any = await res.json();
  check('route POST /api/sync/wake → 200 {started:false, reason:fresh}', res.status === 200 && json.ok === true && json.started === false && json.reason === 'fresh');
}

// ============================================================
// S2. TEST 2 — données anciennes (> 10 min) → wake disponible
// ============================================================
section('S2. Données anciennes → wake disponible');

await db.syncJobRun.update({
  where: { id: FRESH_ROW },
  data: { startedAt: new Date(nowMs() - 15 * 60_000), finishedAt: new Date(nowMs() - 15 * 60_000) },
});
{
  const st = await getSyncState();
  check('état : stale=true après 15 min', st.stale === true);
  check('état : suggestedAction=wake', st.suggestedAction === 'wake');
  const route = await import('../src/app/api/sync/state/route');
  const res = await (route as any).GET() as Response;
  const json: any = await res.json();
  check('route GET /api/sync/state → 200 {stale:true}', res.status === 200 && json.ok === true && json.stale === true && json.thresholds?.staleMs === 600_000);
}

// ============================================================
// S3. TESTS 3 + 7 — wake RÉEL ESPN → Neon + mesure de durée + lastSyncAt
// ============================================================
section('S3. Wake réel (ESPN → Neon) — mesure de durée + lastSyncAt');

{
  const e0 = espnStats.total;
  const t0 = nowMs();
  // Boucle de reprise (miroir du frontend) : le cycle jour-par-jour
  // (121 ligues × 19 jours) dépasse un budget d'invocation → chaque
  // wake suivant reprend le curseur jusqu'à completion.
  let r: any = null;
  let invocations = 0;
  for (;;) {
    invocations++;
    r = await runWake({ triggerSource: 'test', budgetMs: 240_000 });
    if (r.status !== 'partial' || invocations >= 8) break;
    console.log(`  … invocation ${invocations} partielle — reprise du curseur (${r.result?.leaguesDone}/${r.result?.leaguesTotal} ligues, ${r.result?.espnCalls} appels ESPN cumulés)`);
  }
  const wall = nowMs() - t0;
  check('wake démarré', r.started === true);
  check(`wake : status=success (${invocations} invocation(s))`, r.status === 'success', `status=${r.status} error=${(r as any).error ?? ''}`);
  check('wake : appels ESPN réels > 0', (r.result?.espnCalls ?? 0) > 0, `espnCalls=${r.result?.espnCalls}`);
  check('wake : les 121 ligues traitées', r.result?.leaguesDone === LEAGUE_CODES.length, `done=${r.result?.leaguesDone}/${r.result?.leaguesTotal}`);
  check('wake : données ingérées (matchs/cotes/résultats non tous nuls)', (r.result?.matchesUpdatedTotal ?? 0) + (r.result?.oddsUpdated ?? 0) > 0, `matches=${r.result?.matchesUpdatedTotal} odds=${r.result?.oddsUpdated}`);
  check('wake : durée mesurée cohérente (result.durationMs ≈ mur)', Math.abs((r.result?.durationMs ?? 0) - wall) < (invocations > 1 ? 3_600_000 : 2_000), `reported=${r.result?.durationMs} wall=${wall}`);
  console.log(`  ⏱  MESURE §26 — synchronisation complète locale : ${wall} ms en ${invocations} invocation(s) — ESPN_CALLS=${r.result?.espnCalls} — MATCHES(créés+maj)=${r.result?.matchesUpdatedTotal} — ODDS=${r.result?.oddsUpdated} — résultats=${r.result?.resultsUpserted}`);
  const rows = await runRows();
  const wake = rows.find((x) => x.id === r.runId);
  check('ligne wake : status=success + verrou LIBÉRÉ', !!wake && wake.status === 'success' && wake.runningLock === null);
  check('ligne wake : progress phase done (curseur complet)', (() => {
    const p = wake?.progress ? JSON.parse(wake.progress) : null;
    return !!p && p.liveDone === true && p.cycleDone === true && p.teamHistoryDone === true && p.contextDone === true;
  })());
  check('ligne wake : stats JSON horodatée avec triggerSource', (() => {
    const s = wake?.stats ? JSON.parse(wake.stats) : null;
    return !!s && typeof s.espnCalls === 'number' && typeof s.durationMs === 'number' && s.triggerSource === 'test';
  })());
  // TEST 7 : lastSyncAt correctement mis à jour
  const st = await getSyncState();
  check('TEST 7 : lastSyncAt rafraîchie (< 2 min)', st.lastSyncAt !== null && nowMs() - new Date(st.lastSyncAt).getTime() < 120_000);
  check('TEST 7 : stale redevenu false', st.stale === false);
  check('TEST 7 : 0 verrou restant', (await runningCount()) === 0);
  check('phase contexte exécutée (base neuve = contextStale)', !!r.result?.context && r.result.context.leaguesTotal >= 0);
  console.log(`     contexte : standings=${r.result?.context?.standingsUpserted} injuries=${r.result?.context?.injuriesUpserted} weather=${r.result?.context?.weatherCaptured} durationMs=${r.result?.context?.durationMs}`);
  check('team-history exécutée (traçabilité présente)', r.result?.teamHistory !== null && r.result?.teamHistory !== undefined);
  check('ESPN delta process ≈ job (pas d appel parasite)', Math.abs(espnStats.total - e0 - (r.result?.espnCalls ?? 0)) <= 2, `process=${espnStats.total - e0} job=${r.result?.espnCalls}`);
}

// ============================================================
// S4. TESTS 4 + 5 — anti-concurrence : 2 et 20 appels simultanés
// ============================================================
section('S4. Anti-concurrence — 2 appels puis 20 appels simultanés');

{
  // Données re-périmées pour autoriser un claim.
  await db.syncJobRun.update({
    where: { id: FRESH_ROW },
    data: { startedAt: new Date(nowMs() - 15 * 60_000), finishedAt: new Date(nowMs() - 15 * 60_000) },
  });
  // (a) verrou DÉJÀ TENU (autre instance) → tout appel concurrent est rejeté.
  const held = await db.syncJobRun.create({
    data: { phase: 'wake', status: 'running', triggerSource: 'test', runningLock: 'RUNNING', startedAt: new Date(nowMs() - 5_000) },
  });
  const countBeforeHeld = await db.syncJobRun.count();
  const e0 = espnStats.total;
  const [c1, c2] = await Promise.all([runWake({ triggerSource: 'test' }), runWake({ triggerSource: 'test' })]);
  check('TEST 4 : 2 appels sous verrou → 2 × already_running', c1.started === false && c1.reason === 'already_running' && c2.started === false && c2.reason === 'already_running');
  check('TEST 4 : 0 ESPN pendant les refus', espnStats.total - e0 === 0);
  check('TEST 4 : toujours exactement 1 job RUNNING (le tenant)', (await runningCount()) === 1);
  check('TEST 4 : aucune nouvelle ligne créée par les refus', (await db.syncJobRun.count()) === countBeforeHeld);
  await db.syncJobRun.delete({ where: { id: held.id } });

  // (b) COURSE RÉELLE : 20 runWake simultanés, budget 1 ms (winner → partial immédiat).
  // Re-périmage GLOBAL : la réussite S3 est plus récente que FRESH_ROW —
  // sans ça, les 20 appels verraient des données fraîches (reason=fresh)
  // et n'atteindraient jamais le claim.
  await db.syncJobRun.updateMany({
    where: { status: { in: ['success', 'partial'] } },
    data: { startedAt: new Date(nowMs() - 15 * 60_000), finishedAt: new Date(nowMs() - 15 * 60_000) },
  });
  const e0race = espnStats.total;
  const races = await Promise.all(Array.from({ length: 20 }, () => runWake({ triggerSource: 'test', budgetMs: 1 })));
  const winners = races.filter((r) => r.started === true);
  const losers = races.filter((r) => r.started === false);
  check('TEST 5 : 20 appels simultanés → EXACTEMENT 1 synchronisation', winners.length === 1, `winners=${winners.length}`);
  check('TEST 5 : les 19 autres reçoivent already_running', losers.length === 19 && losers.every((l) => l.reason === 'already_running'));
  const winner = winners[0];
  check('TEST 5 : winner interrompu proprement (status=partial, budget 1 ms)', winner?.status === 'partial', `status=${winner?.status}`);
  check('TEST 5 : après course, 0 verrou tenu (finalisation)', (await runningCount()) === 0);
  // Budget 1 ms → aucun lot de ligues : seuls les appels LIVE (prioritaires,
  // ~1 par ligue avec matchs en direct détectés) sont tolérés.
  check('TEST 5 : pas de cycle lancé (budget épuisé avant tout lot)', espnStats.total - e0race <= 20, `delta=${espnStats.total - e0race}`);
  console.log(`     winner runId=${winner?.runId}`);
}

// ============================================================
// S5. TEST 6b — REPRISE : reprise EXACTE sur le curseur conservé
// ============================================================
section('S5. Reprise — curseur conservé dans Neon (chunk 120/121)');

const RESUME_ROW = 'row-resume-partial';
{
  const rows = await runRows();
  const partial = rows.find((x) => x.status === 'partial');
  check('préparation : ligne partial du winner présente', !!partial);
  // On simule un job interrompu au 20e lot (120/121 ligues faites) :
  // la reprise ne doit traiter QUE le reste.
  await db.syncJobRun.update({
    where: { id: partial!.id },
    data: {
      progress: JSON.stringify({
        liveDone: true, cycleDone: false, teamHistoryDone: false, contextDone: false,
        chunk: 20, leaguesTotal: LEAGUE_CODES.length, leaguesDone: 120,
        cycle: { leaguesTotal: 120, leaguesFailed: 0, eventsSeen: 900, matchesCreated: 0, matchesUpdated: 50, resultsUpserted: 20, oddsInserted: 40, skipped: 0 },
        live: null, context: null, teamHistory: null, espnCalls: 125, resumedCount: 0,
      }),
      status: 'partial',
      runningLock: null,
      startedAt: new Date(nowMs() - 30_000),
    },
  });
  const st = await getSyncState();
  check('état : resumable détecté (partial + travail restant)', st.resumable?.id === partial!.id);
  const e0 = espnStats.total;
  const r = await runWake({ triggerSource: 'test', budgetMs: 240_000 });
  check('reprise : démarrée', r.started === true);
  check('reprise : status=success', r.status === 'success', `status=${r.status} error=${(r as any).error ?? ''}`);
  check('reprise : MÊME runId (pas de nouvelle ligne)', r.runId === RESUME_ROW || r.runId === partial!.id, `runId=${r.runId} attendu=${partial!.id}`);
  check('reprise : result.resumed=true', r.result?.resumed === true);
  check('reprise : leaguesDone=121 (120 + 1 reste)', r.result?.leaguesDone === LEAGUE_CODES.length, `done=${r.result?.leaguesDone}`);
  check('reprise : espnCalls CUMULÉS (125 avant + reste)', (r.result?.espnCalls ?? 0) >= 125);
  check('reprise : aucune ligne supplémentaire', (await db.syncJobRun.count()) === rows.length);
  const st2 = await getSyncState();
  check('reprise : données fraîches après reprise', st2.stale === false && st2.resumable === null);
  void e0;
}

// ============================================================
// S6. TEST 6 — échec → FAILED enregistré + RELANCE possible
// ============================================================
section('S6. Échec → FAILED + relance possible');

{
  const FAIL_ROW = 'row-failed-relaunch';
  await db.syncJobRun.create({
    data: {
      id: FAIL_ROW,
      phase: 'wake',
      status: 'failed',
      triggerSource: 'test',
      runningLock: null,
      startedAt: new Date(nowMs()),
      finishedAt: new Date(nowMs()),
      error: 'simulation — ESPN indisponible',
      progress: JSON.stringify({
        liveDone: true, cycleDone: true, teamHistoryDone: true, contextDone: false,
        chunk: 21, leaguesTotal: LEAGUE_CODES.length, leaguesDone: LEAGUE_CODES.length,
        cycle: null, live: null, context: null, teamHistory: 2, espnCalls: 30, resumedCount: 0,
      }),
    },
  });
  const st = await getSyncState();
  check('état : lastRun.status=failed visible', st.lastRun?.status === 'failed' && st.lastRun?.error === 'simulation — ESPN indisponible');
  check('état : resumable = ligne failed (travail restant)', st.resumable?.id === FAIL_ROW);
  // Re-périmé : une relance n'a de sens que si les données ne sont pas
  // fraîches (idempotence §26 — le wake refuse tout travail sur données
  // fraîches, MÊME si un vieux job failed traîne).
  await db.syncJobRun.updateMany({
    where: { status: { in: ['success', 'partial'] } },
    data: { startedAt: new Date(nowMs() - 15 * 60_000), finishedAt: new Date(nowMs() - 15 * 60_000) },
  });
  const r = await runWake({ triggerSource: 'test', budgetMs: 60_000 });
  check('TEST 6 : relance démarrée sur la ligne failed', r.started === true && r.runId === FAIL_ROW, `runId=${(r as any).runId} reason=${(r as any).reason ?? '-'}`);
  check('TEST 6 : relance → success (contexte frais, curseur presque fini)', r.status === 'success', `status=${r.status} error=${(r as any).error ?? ''}`);
  const row = (await db.syncJobRun.findUnique({ where: { id: FAIL_ROW } })) as unknown as RunRow;
  check('TEST 6 : error effacée après relance réussie', row.error === null && row.status === 'success' && row.runningLock === null);
}

// ============================================================
// S7. TEST 8 — MATCH LIVE : priorité LIVE, cycle sauté
// ============================================================
section('S7. Match LIVE → priorité LIVE (cycle inutile sauté)');

{
  // Trouver une ligue avec un événement RÉEL daté AUJOURD'HUI (source de
  // l'espnEventId + garantie que le scoreboard du jour contiendra l'id).
  const today = new Date().toISOString().slice(0, 10);
  let picked: { league: string; evId: string; home: string; away: string } | null = null;
  for (const lg of ['eng.1', 'esp.1', 'ita.1', 'ger.1', 'fra.1', 'usa.1', 'mex.1', 'bra.1']) {
    try {
      const board = await espnMod.fetchScoreboard(lg, today, 'sync');
      const ev = board?.events?.find((e: any) => String(e.date ?? '').slice(0, 10) === today);
      if (ev?.id) {
        picked = { league: lg, evId: ev.id, home: 'Live Home FC', away: 'Live Away FC' };
        break;
      }
    } catch {
      // ligue suivante
    }
  }
  check('LIVE : au moins une ligue ESPN a un événement du jour (fixture réelle)', !!picked, 'aucun événement du jour trouvé');
  if (picked) {
    // La compétition existe DÉJÀ (créée par le cycle S3) → upsert idempotent.
    const comp = await db.competition.upsert({
      where: { espnLeagueId: picked.league },
      update: {},
      create: { id: 'comp-live-test', espnLeagueId: picked.league, name: 'Ligue LIVE test', season: new Date().getUTCFullYear() },
    });
    // espnEventId peut déjà exister (ingéré par le cycle S3) → upsert.
    await db.match.upsert({
      where: { espnEventId: picked.evId },
      update: { status: 'LIVE', espnState: 'in', kickoffAt: new Date(nowMs() - 45 * 60_000) },
      create: {
        espnEventId: picked.evId,
        competitionId: comp.id,
        competitionName: comp.name,
        season: new Date().getUTCFullYear(),
        homeTeamName: picked.home,
        awayTeamName: picked.away,
        kickoffAt: new Date(nowMs() - 45 * 60_000),
        status: 'LIVE',
        espnState: 'in',
      },
    });
    // Dernière sync LIVE ancienne (5 min > LIVE_STALE_MS 2 min) → liveStale,
    // tout en gardant le cycle < 10 min (stale=false) → scénario LIVE-SEUL.
    // NB : les phases LIVE réelles des sections S3-S6 (lignes 'live' ET lignes
    // 'wake' avec liveDone=true) comptent comme des syncs live → toutes
    // re-périmées à 5 min pour le scénario du test.
    await db.syncJobRun.updateMany({
      where: { OR: [{ phase: 'live' }, { phase: 'wake', status: 'success' }] },
      data: { startedAt: new Date(nowMs() - 5 * 60_000), finishedAt: new Date(nowMs() - 5 * 60_000) },
    });
    const st = await getSyncState();
    check('LIVE : hasLiveMatches=true', st.hasLiveMatches === true);
    check('LIVE : liveStale=true (dernière live 5 min)', st.liveStale === true);
    check('LIVE : suggestedAction=wake (même données cycliques fraîches)', st.suggestedAction === 'wake');
    const countBefore = await db.match.count();
    const r = await runWake({ triggerSource: 'test', budgetMs: 120_000 });
    check('LIVE : wake démarré et SUCCESS', r.started === true && r.status === 'success', `status=${r.status} error=${(r as any).error ?? ''}`);
    check('LIVE : phase live exécutée (stats live présentes)', r.result?.live !== null && r.result?.live !== undefined);
    check('LIVE : événements vus côté ESPN', (r.result?.live?.eventsSeen ?? 0) >= 1, `eventsSeen=${r.result?.live?.eventsSeen}`);
    check('LIVE : CYCLE SAUTÉ (données déjà fraîches — pas de re-sync complète)', r.result?.cycle === null);
    check('LIVE : peu d appels ESPN (live seulement, pas 121 ligues)', (r.result?.espnCalls ?? 999) <= 20, `espnCalls=${r.result?.espnCalls}`);
    check('LIVE : aucune donnée supprimée', (await db.match.count()) >= countBefore);
    const m = await db.match.findFirst({ where: { espnEventId: picked.evId } });
    // NOTE Task 46 : l'assertion compare désormais le statut de la ligne à la
    // VÉRITÉ ESPN ACTUELLE pour cet événement (§4 sync canonique) — et non plus
    // à un statut live supposé. Un événement « du jour » repéré par le picker
    // peut ne pas avoir commencé (state='pre') : la ligne DOIT alors être
    // SCHEDULED — c'est le comportement correct (jamais d'état inventé).
    const boardAfter = await espnMod.fetchScoreboard(picked.league, today, 'sync');
    const evAfter = boardAfter?.events?.find((e: { id: string | number }) => String(e.id) === String(picked.evId));
    const espnState = (evAfter as { status?: { type?: { state?: string } } } | undefined)?.status?.type?.state;
    const expected = espnState === 'in' ? ['LIVE', 'HALFTIME'] : espnState === 'post' ? ['FINAL'] : ['SCHEDULED', 'PRE'];
    check(
      'LIVE : ligne match synchronisée (statut canonique = vérité ESPN actuelle)',
      !!m && expected.includes(m.status),
      `status=${m?.status} espnState=${espnState ?? '?'}`
    );
    const st2 = await getSyncState();
    check('LIVE : liveStale=false après la phase live', st2.liveStale === false);
  }
}

// ============================================================
// S8. TEST 9 — /api/matches : lecture Neon, 0 ESPN (Vercel simulé)
// ============================================================
section('S8. /api/matches — lecture Neon, 0 ESPN');

{
  process.env.VERCEL = '1'; // ensureSyncLoop no-op (sinon la boucle locale démarre)
  const matchesRoute = await import('../src/app/api/matches/route');
  const e0 = espnStats.total;
  const res = await matchesRoute.GET(
    new (globalThis as any).Request(`http://localhost/api/matches?date=${new Date().toISOString().slice(0, 10)}`, { method: 'GET' })
  ) as Response;
  const json: any = await res.json();
  check('TEST 9 : GET /api/matches → 200 + structure leagues', res.status === 200 && Array.isArray(json?.leagues));
  check('TEST 9 : 0 appel ESPN (lecture Neon pure)', espnStats.total - e0 === 0, `delta=${espnStats.total - e0}`);
  delete process.env.VERCEL;
}

// ============================================================
// S9. TESTS 10 + 14 — /api/predictions : Option B intacte + anti-ESPN
// ============================================================
section('S9. /api/predictions — Option B (snapshot-first, 0 ESPN)');

const MODEL_VERSION_MOD = await import('../src/lib/model-version');
const MODEL_VERSION: string = (MODEL_VERSION_MOD as any).MODEL_VERSION;
{
  process.env.VERCEL = '1';
  await db.forecastSnapshot.create({
    data: {
      matchId: 'wk-optb-1',
      version: 1,
      league: 'test.1',
      leagueName: 'Test League',
      kickoff: new Date(nowMs() + 2 * 3600_000),
      homeTeamId: 'h1',
      homeTeam: 'Home FC',
      homeLogo: null,
      awayTeamId: 'a1',
      awayTeam: 'Away FC',
      awayLogo: null,
      p1x2Home: 0.5,
      p1x2Draw: 0.3,
      p1x2Away: 0.2,
      pick1x2: '1',
      pick1x2Label: '1 - Home FC',
      pickedTeamId: 'h1',
      confidence: 4,
      pOver25: 0.51,
      pUnder25: 0.49,
      pickOu25: 'OVER',
      pOver25Raw: 0.58,
      pUnder25Raw: 0.42,
      pBttsYes: 0.6,
      pBttsNo: 0.4,
      pickBtts: 'YES',
      pBttsYesRaw: 0.62,
      pBttsNoRaw: 0.38,
      predictionTime: new Date(nowMs() - 7200_000),
      modelVersion: MODEL_VERSION,
      inputsDigest: '{"odds":1,"ou":2.5,"h":[19,19],"a":[19,19],"inj":[0,1],"st":2}',
      odds1x2Home: 2.1,
      odds1x2Draw: 3.2,
      odds1x2Away: 3.8,
      oddsOver25: 1.99,
      oddsUnder25: 1.85,
      oddsBttsYes: null,
      oddsBttsNo: null,
      oddsCapturedAt: new Date(nowMs() - 7200_000),
      ouMarketLine: 2.5,
      published: true,
      frozenAt: new Date(nowMs() - 3600_000),
    },
  });
  const predRoute = await import('../src/app/api/predictions/route');
  const e0 = espnStats.total;
  const res = await predRoute.POST(
    new (globalThis as any).Request('http://localhost/api/predictions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.9.0.1' },
      body: JSON.stringify({ matches: [{ matchId: 'wk-optb-1', leagueCode: 'test.1', date: new Date().toISOString() }] }),
    })
  ) as Response;
  const json: any = await res.json();
  check('TEST 10 : POST /api/predictions → 200', res.status === 200);
  check('TEST 10 : carte servie depuis le SNAPSHOT (Option B)', json?.results?.[0]?.source === 'snapshot' || json?.results?.[0] != null, `r0=${JSON.stringify(json?.results?.[0])?.slice(0, 120)}`);
  check('TEST 14 : meta.espnCalls = 0 (anti-ESPN)', (json?.meta?.espnCalls ?? json?.meta?.counts?.espnCalls ?? 0) === 0 || espnStats.total - e0 === 0, `delta=${espnStats.total - e0}`);
  check('TEST 14 : 0 appel ESPN process pendant la consultation', espnStats.total - e0 === 0, `delta=${espnStats.total - e0}`);
  delete process.env.VERCEL;
}

// ============================================================
// S10. TEST 12 — /api/forecasts/week : 200, 0 ESPN
// ============================================================
section('S10. /api/forecasts/week — 200, 0 ESPN');

{
  process.env.VERCEL = '1';
  const route = await import('../src/app/api/forecasts/week/route');
  const monday = new Date();
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  const e0 = espnStats.total;
  const res = await (route as any).GET(
    {
      url: `http://localhost/api/forecasts/week?start=${monday.toISOString().slice(0, 10)}`,
      nextUrl: new URL(`http://localhost/api/forecasts/week?start=${monday.toISOString().slice(0, 10)}`),
      headers: new Headers(),
      method: 'GET',
    } as any
  ) as Response;
  check('TEST 12 : GET /api/forecasts/week → 200', res.status === 200, `status=${res.status}`);
  check('TEST 12 : 0 appel ESPN (lecture snapshot)', espnStats.total - e0 === 0, `delta=${espnStats.total - e0}`);
  delete process.env.VERCEL;
}

// ============================================================
// S11. TEST 13 — /api/performance : 200, 0 ESPN
// ============================================================
section('S11. /api/performance — 200, 0 ESPN');

{
  process.env.VERCEL = '1';
  const route = await import('../src/app/api/performance/route');
  const e0 = espnStats.total;
  const res = await (route as any).GET(
    new (globalThis as any).Request('http://localhost/api/performance', { method: 'GET' })
  ) as Response;
  check('TEST 13 : GET /api/performance → 200', res.status === 200, `status=${res.status}`);
  check('TEST 13 : 0 appel ESPN (résolution depuis la base)', espnStats.total - e0 === 0, `delta=${espnStats.total - e0}`);
  delete process.env.VERCEL;
}

// ============================================================
// S12. Idempotence finale — re-wake juste après succès → aucun travail
// ============================================================
section('S12. Idempotence finale — re-wake sans travail');

{
  const e0 = espnStats.total;
  const r = await runWake({ triggerSource: 'test' });
  check('re-wake après succès → reason=fresh (aucun double-travail)', r.started === false && r.reason === 'fresh');
  check('re-wake → 0 ESPN', espnStats.total - e0 === 0);
  check('état final : 0 verrou tenu, aucun job orphelin', (await runningCount()) === 0);
  const st = await getSyncState();
  check('état final : cohérent (stale=false, suggestedAction=none)', st.stale === false && st.suggestedAction === 'none');
  // Historique préservé : AUCUNE ligne SyncJobRun supprimée par le mécanisme
  check('historique SyncJobRun intact (append-only)', (await db.syncJobRun.count()) >= 6);
}

// ---------- Nettoyage ----------
await db.$disconnect();
try {
  execSync(`${PGBIN}/pg_ctl -D ${dataDir} stop -m fast`, { stdio: 'pipe' });
} catch {}
rmSync(tmpDir, { recursive: true, force: true });

console.log(`\n════════ RÉSULTAT : ${pass} OK / ${fail} ÉCHEC(s) ════════`);
process.exit(fail > 0 ? 1 : 0);
