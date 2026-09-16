// ============================================================
// VOLTRIX — Task 45 §26-bis : TESTS de la CHAÎNE DE CONTINUATION
//
// Question vérifiée (exigence utilisateur) : la chaîne de tranches
// Wake #1 → Wake #2 → … → Wake #N continue-t-elle SANS navigateur ?
//
// ⚠️  EXÉCUTION PAR PHASES (le sandbox tue les processus détachés) :
//   bun scripts/test-wake-chain.ts inproc   # S1-S5 in-process (~3 min)
//   bun scripts/test-wake-chain.ts build    # next build production (~2 min)
//   bun scripts/test-wake-chain.ts s7       # SCÉNARIO OBLIGATOIRE (~6 min)
//   bun scripts/test-wake-chain.ts s89      # course + cron + logs (~5 min)
// PostgreSQL 17 PERSISTANT entre phases (.tmp/wake-chain-pgdata, port 5577).
// Infra : ESPN RÉEL, serveur Next de production réel. JAMAIS la base prod.
// ============================================================

import { execSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, rmSync } from 'node:fs';
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
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const nowMs = () => Date.now();

const ROOT = path.resolve(process.cwd());
const PGBIN = path.join(ROOT, '.tmp-pg', 'pg17', 'usr', 'lib', 'postgresql', '17', 'bin');
const PG_DIR = path.join(ROOT, '.tmp', 'wake-chain-pgdata');
const SOCK_DIR = path.join(ROOT, '.tmp', 'wake-chain-sock');
const PG_LOG = path.join(ROOT, '.tmp', 'wake-chain-pg.log');
const PG_PORT = 5577;
const dbUrl = `postgresql://postgres@127.0.0.1:${PG_PORT}/postgres`;
const SERVER_LOG = path.join(ROOT, '.tmp', 'wake-chain-server.log');

/** Boot le PG persistant (idempotent — le sandbox peut le couper entre phases). */
function ensurePg(): void {
  mkdirSync(SOCK_DIR, { recursive: true });
  if (!existsSync(PG_DIR)) {
    execSync(`${PGBIN}/initdb -D ${PG_DIR} -U postgres -A trust -E UTF8 --no-locale`, { stdio: 'pipe' });
  }
  try {
    execSync(`${PGBIN}/pg_isready -h 127.0.0.1 -p ${PG_PORT}`, { stdio: 'pipe' });
    return; // déjà en marche
  } catch {
    // pas en marche → démarrer
  }
  execSync(
    `${PGBIN}/pg_ctl -D ${PG_DIR} -o "-p ${PG_PORT} -c listen_addresses=127.0.0.1 -k ${SOCK_DIR}" -l ${PG_LOG} start`,
    { stdio: 'pipe' }
  );
  for (let i = 0; i < 50; i++) {
    try {
      execSync(`${PGBIN}/pg_isready -h 127.0.0.1 -p ${PG_PORT}`, { stdio: 'pipe' });
      return;
    } catch {
      execSync('sleep 0.2');
    }
  }
  throw new Error('PostgreSQL persistant introuvable après démarrage');
}

function stopPg(): void {
  try {
    execSync(`${PGBIN}/pg_ctl -D ${PG_DIR} stop -m fast`, { stdio: 'pipe' });
  } catch {}
}

async function main() {
  const PHASE = process.argv[2] ?? '';
  if (!['inproc', 'build', 's7', 's89'].includes(PHASE)) {
    console.error('Usage : bun scripts/test-wake-chain.ts <inproc|build|s7|s89>');
    process.exit(2);
  }
  console.log(`═══ PHASE ${PHASE} ═══`);
  ensurePg();
  process.env.DATABASE_URL = dbUrl; // l'env process GAGNE sur .env → prod jamais touchée
  process.env.DIRECT_URL = dbUrl;

  let server: ChildProcess | null = null;
  const PORT = 3377;

  try {
    if (PHASE === 'inproc') {
      execSync('node_modules/.bin/prisma generate', { cwd: ROOT, env: { ...process.env }, stdio: 'pipe' });
      execSync('node_modules/.bin/prisma db push --skip-generate', { cwd: ROOT, env: { ...process.env }, stdio: 'pipe' });
    }

    const { PrismaClient } = await import('@prisma/client');
    const db = new PrismaClient({ datasources: { db: { url: dbUrl } } });

    // Index unique partiel (verrou anti-concurrence) — idempotent.
    await db.$executeRawUnsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS "SyncJobRun_running_lock_uidx" ON "SyncJobRun"("runningLock") WHERE "runningLock" IS NOT NULL`
    );

    const wakeMod = await import('../src/lib/sync/wake');
    const { getSyncState, runWake, progressHasRemainingWork } = wakeMod;
    const weekMod = await import('../src/lib/forecast/espn-week');
    const LEAGUE_CODES: string[] = weekMod.allLeagueCodes();

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
    const rowOf = async (id: string): Promise<RunRow | null> =>
      (await db.syncJobRun.findUnique({ where: { id } })) as unknown as RunRow | null;
    const craftRow = async (id: string, data: Record<string, unknown>) => {
      await db.syncJobRun.deleteMany({ where: { id } });
      await db.syncJobRun.create({ data: { id, phase: 'wake', triggerSource: 'wake', ...data } as never });
    };

    /** Re-périmer TOUTES les réussites (> 10 min) — idempotence §26. */
    const restale = async () => {
      await db.syncJobRun.updateMany({
        where: { status: { in: ['success', 'partial', 'failed'] } },
        data: { startedAt: new Date(nowMs() - 15 * 60_000), finishedAt: new Date(nowMs() - 15 * 60_000) },
      });
    };

    /** Curseur type — mire exacte de WakeProgress. */
    const mkProg = (over: Record<string, unknown> = {}) => ({
      liveDone: false,
      cycleDone: false,
      teamHistoryDone: false,
      contextDone: false,
      chunk: 0,
      leaguesTotal: LEAGUE_CODES.length,
      leaguesDone: 0,
      cycle: null,
      live: null,
      context: null,
      teamHistory: null,
      espnCalls: 0,
      resumedCount: 0,
      ...over,
    });

    // ============================================================
    // PHASE inproc — S1 → S5 (aucun serveur ; runWake appelé en process)
    // ============================================================
    if (PHASE === 'inproc') {
      // ---------- S1. SANITY ----------
      section('S1. Sanity — infra + verrou DB + curseurs');

      check(
        'index unique partiel présent',
        (
          await db.$queryRawUnsafe<{ indexname: string }[]>(
            `SELECT indexname FROM pg_indexes WHERE indexname = 'SyncJobRun_running_lock_uidx'`
          )
        ).length === 1
      );
      check('catalogue ligues chargé', LEAGUE_CODES.length >= 100, `n=${LEAGUE_CODES.length}`);
      {
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
        check('sonde verrou : 0 RUNNING restant', (await runningCount()) === 0);
      }
      check(
        'helper : curseur incomplet = travail restant',
        progressHasRemainingWork(mkProg({ liveDone: true, cycleDone: false }) as never) === true
      );
      check(
        'helper : curseur complet = rien à faire',
        progressHasRemainingWork(
          mkProg({ liveDone: true, cycleDone: true, teamHistoryDone: true, contextDone: true }) as never
        ) === false
      );

      // ---------- S2. FIXTURES ----------
      section('S2. Fixtures — compétition + match à venir');

      await db.competition.upsert({
        where: { id: 'comp-chain-test' },
        update: {},
        create: { id: 'comp-chain-test', espnLeagueId: 'eng.1', name: 'Chain Test League', season: new Date().getUTCFullYear() },
      });
      await db.match.upsert({
        where: { espnEventId: 'chain-live-1' },
        update: { kickoffAt: new Date(nowMs() + 30 * 60_000), status: 'SCHEDULED' },
        create: {
          espnEventId: 'chain-live-1',
          competitionId: 'comp-chain-test',
          competitionName: 'Chain Test League',
          season: new Date().getUTCFullYear(),
          homeTeamName: 'Chain Home FC',
          awayTeamName: 'Chain Away FC',
          kickoffAt: new Date(nowMs() + 30 * 60_000),
          status: 'SCHEDULED',
        },
      });
      check('fixture : compétition + match à venir présents', (await db.match.count({ where: { espnEventId: 'chain-live-1' } })) === 1);

      // ---------- S3. ERREUR DE PHASE → PROGRESSION CONSERVÉE ----------
      section('S3. Erreur de phase (panne DB réelle) → curseur intact, relance OK');

      const P1 = 'chain-row-phase-error';
      {
        await craftRow(P1, {
          status: 'partial',
          runningLock: null,
          startedAt: new Date(nowMs() - 30_000),
          progress: JSON.stringify(
            mkProg({
              liveDone: false,
              cycleDone: true,
              teamHistoryDone: true,
              contextDone: true,
              chunk: 21,
              leaguesDone: LEAGUE_CODES.length,
              cycle: { leaguesTotal: LEAGUE_CODES.length, leaguesFailed: 0, eventsSeen: 950, matchesCreated: 40, matchesUpdated: 90, resultsUpserted: 12, oddsInserted: 55, skipped: 0 },
              espnCalls: 125,
            })
          ),
        });
        const st = await getSyncState();
        check('préparation : P1 resumable (LIVE restant)', st.resumable?.id === P1);

        // — injection : panne base pendant la phase LIVE —
        await db.$executeRawUnsafe(`ALTER TABLE "Competition" RENAME TO "Competition_inject"`);
        let r: any = null;
        try {
          r = await runWake({ triggerSource: 'test', budgetMs: 60_000 });
        } finally {
          await db.$executeRawUnsafe(`ALTER TABLE "Competition_inject" RENAME TO "Competition"`);
        }
        check('injection : wake démarré puis FAILED (erreur de phase)', r?.started === true && r?.status === 'failed', `status=${r?.status} error=${r?.error ?? ''}`);
        check('injection : erreur liée à la table renommée', String(r?.error ?? '').includes('Competition'), r?.error);

        const row = await rowOf(P1);
        const prog = row?.progress ? JSON.parse(row.progress) : null;
        check('PROGRESSION CONSERVÉE : status=failed (jamais success)', row?.status === 'failed');
        check('PROGRESSION CONSERVÉE : verrou LIBÉRÉ (relançable)', row?.runningLock === null);
        check('PROGRESSION CONSERVÉE : leaguesDone=121 intact', prog?.leaguesDone === LEAGUE_CODES.length, `ld=${prog?.leaguesDone}`);
        check('PROGRESSION CONSERVÉE : stats cycle intactes', prog?.cycle?.matchesCreated === 40 && prog?.cycle?.oddsInserted === 55);
        check('PROGRESSION CONSERVÉE : espnCalls cumulés intact', prog?.espnCalls === 125);

        // — relance : reprise EXACTE du curseur, même ligne —
        const r2 = await runWake({ triggerSource: 'test', budgetMs: 120_000 });
        check('relance : démarrée sur la MÊME ligne (runId P1)', r2.started === true && r2.runId === P1, `runId=${(r2 as any).runId}`);
        check('relance : resumed=true', r2.result?.resumed === true);
        check('relance : status=success', r2.status === 'success', `status=${r2.status} error=${(r2 as any).error ?? ''}`);
        const row2 = await rowOf(P1);
        check('relance : ligne P1 = success + verrou libéré + error effacée', row2?.status === 'success' && row2?.runningLock === null && row2?.error === null);
        const prog2 = row2?.progress ? JSON.parse(row2.progress) : null;
        check('relance : curseur final complet (liveDone, 121/121)', prog2?.liveDone === true && prog2?.leaguesDone === LEAGUE_CODES.length);
        check('relance : resumedCount incrémenté 2× (échec repris + relance) — traçabilité', prog2?.resumedCount === 2, `rc=${prog2?.resumedCount}`);
        const st3 = await getSyncState();
        check('relance : données fraîches + plus rien de resumable', st3.stale === false && st3.resumable === null);
      }

      // ---------- S4. ORPHELIN > 6 MIN → TAKEOVER + MÊME CURSEUR ----------
      section('S4. Verrou orphelin > 6 min → takeover + MÊME curseur');

      const O1 = 'chain-row-orphan-7min';
      {
        await restale();
        await craftRow(O1, {
          status: 'running',
          runningLock: 'RUNNING',
          startedAt: new Date(nowMs() - 7 * 60_000), // > STALE_LOCK_MS (6 min)
          progress: JSON.stringify(
            mkProg({
              liveDone: true,
              cycleDone: false,
              chunk: 20,
              leaguesDone: 120,
              cycle: { leaguesTotal: 120, leaguesFailed: 0, eventsSeen: 900, matchesCreated: 30, matchesUpdated: 70, resultsUpserted: 10, oddsInserted: 40, skipped: 0 },
              espnCalls: 118,
            })
          ),
        });
        const r = await runWake({ triggerSource: 'test', budgetMs: 240_000 });
        check('takeover : wake démarré', r.started === true, `reason=${(r as any).reason ?? '-'}`);
        check('takeover : MÊME runId repris (curseur conservé, pas de restart)', r.runId === O1, `runId=${(r as any).runId}`);
        check('takeover : resumed=true', r.result?.resumed === true);
        check('takeover : status=success', r.status === 'success', `status=${r.status} error=${(r as any).error ?? ''}`);
        check('takeover : leaguesDone 120 → 121 (1 seule ligue retraitée)', r.result?.leaguesDone === LEAGUE_CODES.length, `done=${r.result?.leaguesDone}`);
        const row = await rowOf(O1);
        check('takeover : ligne O1 = success + verrou libéré', row?.status === 'success' && row?.runningLock === null);
        check('takeover : 0 RUNNING restant', (await runningCount()) === 0);

        // — négatif : orphelin RÉCENT (< 6 min) → PAS de takeover —
        const O2 = 'chain-row-orphan-2min';
        await restale();
        await craftRow(O2, {
          status: 'running',
          runningLock: 'RUNNING',
          startedAt: new Date(nowMs() - 2 * 60_000),
        });
        const r2 = await runWake({ triggerSource: 'test', budgetMs: 30_000 });
        check('orphelin récent : déjà_running, takeover refusé', r2.started === false && r2.reason === 'already_running' && (r2 as any).runId === O2);
        check('orphelin récent : ligne intacte (toujours RUNNING)', (await rowOf(O2))?.runningLock === 'RUNNING');
        await db.syncJobRun.delete({ where: { id: O2 } });
      }

      // ---------- S5. NOUVEAU WAKE REPREND UN JOB EXISTANT ----------
      section('S5. Nouveau wake → reprise automatique du job existant');

      const P2 = 'chain-row-resume-other-user';
      {
        await restale();
        await craftRow(P2, {
          status: 'partial',
          runningLock: null,
          startedAt: new Date(nowMs() - 30_000),
          progress: JSON.stringify(
            mkProg({
              liveDone: true,
              cycleDone: false,
              teamHistoryDone: true,
              contextDone: true,
              chunk: 20,
              leaguesDone: 120,
              cycle: { leaguesTotal: 120, leaguesFailed: 0, eventsSeen: 880, matchesCreated: 25, matchesUpdated: 60, resultsUpserted: 8, oddsInserted: 33, skipped: 0 },
              espnCalls: 110,
            })
          ),
        });
        const before = await db.syncJobRun.count();
        const r = await runWake({ triggerSource: 'test', budgetMs: 120_000 });
        check('utilisateur B : wake démarré sur la ligne existante', r.started === true && r.runId === P2);
        check('utilisateur B : status=success (reprise achevée)', r.status === 'success', `status=${r.status}`);
        check('utilisateur B : AUCUNE nouvelle ligne créée (même curseur)', (await db.syncJobRun.count()) === before);
        check('utilisateur B : leaguesDone=121', r.result?.leaguesDone === LEAGUE_CODES.length);
      }
    }

    // ============================================================
    // PHASE build — build production (pour le serveur Next réel)
    // ============================================================
    if (PHASE === 'build') {
      section('BUILD production (next build)');
      console.log('  … next build — peut prendre 1-2 min');
      execSync('node_modules/.bin/next build', {
        cwd: ROOT,
        env: { ...process.env, DATABASE_URL: dbUrl, DIRECT_URL: dbUrl },
        stdio: 'pipe',
        timeout: 480_000,
      });
      check('build production OK (artefact .next présent)', existsSync(path.join(ROOT, '.next', 'BUILD_ID')));
    }

    // ---------- Serveur Next (phases s7 / s89) ----------
    const startServer = () => {
      // 'w' = tronque le log à chaque phase → chaque phase observe SON serveur.
      const outFd = openSync(SERVER_LOG, 'w');
      server = spawn('node_modules/.bin/next', ['start', '-p', String(PORT)], {
        cwd: ROOT,
        env: {
          ...process.env,
          DATABASE_URL: dbUrl,
          DIRECT_URL: dbUrl,
          VERCEL: '1', // boucles worker no-op ; /api/sync/tick 403 ; wake autorisé
          SYNC_WAKE_BUDGET_MS: '15000', // tranche courte → plusieurs tranches réelles
          SYNC_CHAIN_MAX_WALL_MS: '900000', // mur large pour le test (prod : 240 s)
          SYNC_CHAIN_MAX_LOOPS: '50',
        },
        stdio: ['ignore', outFd, outFd],
      });
    };
    const waitReady = async (): Promise<boolean> => {
      for (let i = 0; i < 60; i++) {
        try {
          const res = await fetch(`http://127.0.0.1:${PORT}/api/sync/state`, { cache: 'no-store' });
          if (res.ok) {
            const j: any = await res.json();
            if (j?.ok === true) return true;
          }
        } catch {
          // pas encore prêt
        }
        await sleep(1_000);
      }
      return false;
    };

    // ============================================================
    // PHASE s7 — SCÉNARIO OBLIGATOIRE (arrêt volontaire + fermeture
    // navigateur + continuation serveur jusqu'à SUCCESS)
    // ============================================================
    if (PHASE === 's7') {
      section('S7. SCÉNARIO OBLIGATOIRE — continuation serveur sans navigateur');

      startServer();
      check('serveur Next démarré (next start, VERCEL=1)', await waitReady());

      const R1 = { id: '' };
      await restale();
      const rowsBefore = await db.syncJobRun.count();

      // 1) L'utilisateur clique sur « Actualiser les données ».
      const tPost = nowMs();
      const res = await fetch(`http://127.0.0.1:${PORT}/api/sync/wake`, { method: 'POST', cache: 'no-store' });
      const json: any = await res.json();
      check('clic : POST /api/sync/wake → 200 ok', res.status === 200 && json?.ok === true);
      check('clic : tranche 1 démarrée puis PARTIELLE (budget atteint)', json.started === true && json.status === 'partial', `status=${json.status}`);
      check('clic : la route confirme la chaîne serveur (chain=server)', json.chain === 'server');
      R1.id = String(json.runId ?? '');
      check('clic : runId renvoyé', R1.id.length > 0);

      // 2-3) La tranche 1 s'est arrêtée ENTRE DEUX PHASES : LIVE fait,
      //      cycle entamé mais inachevé — curseur sauvegardé dans la base.
      check(
        'ARRÊT ENTRE DEUX PHASES : LIVE fait, cycle entamé non achevé',
        json.result?.live !== null && json.result?.live !== undefined && json.result?.leaguesDone > 0 && json.result?.leaguesDone < json.result?.leaguesTotal,
        `live=${json.result?.live !== null} ld=${json.result?.leaguesDone}/${json.result?.leaguesTotal}`
      );
      const afterChunk1 = await rowOf(R1.id);
      const prog1 = afterChunk1?.progress ? JSON.parse(afterChunk1.progress) : null;
      check('curseur en base après tranche 1 : leaguesDone > 0 persisté', prog1?.leaguesDone > 0, `ld=${prog1?.leaguesDone}`);
      // Baseline APRÈS le clic initial (le clic crée légitimement R1) :
      // la chaîne serveur ne doit plus créer AUCUNE ligne wake ensuite.
      const wakeRowsAfterClick = await db.syncJobRun.count({ where: { phase: 'wake' } });

      // 4-6) L'UTILISATEUR FERME L'APPLICATION. Plus AUCUN appel HTTP
      //      jusqu'à la fin — seules des lectures Prisma directes.
      console.log('  … navigateur fermé — observation de la base uniquement (plus aucun appel HTTP)');
      const samples: { status: string | null; ld: number; locked: boolean }[] = [];
      const progressSeen = new Map<string, Set<string>>();
      let maxRunning = 0;
      let violations = 0;
      const deadline = nowMs() + 20 * 60_000;
      let finalRow: RunRow | null = null;
      while (nowMs() < deadline) {
        const rows = await runRows();
        maxRunning = Math.max(maxRunning, rows.filter((r) => r.runningLock === 'RUNNING').length);
        for (const r of rows) {
          if (!r.progress) continue;
          const set = progressSeen.get(r.id) ?? new Set<string>();
          set.add(r.progress);
          progressSeen.set(r.id, set);
        }
        finalRow = rows.find((r) => r.id === R1.id) ?? null;
        if (finalRow) {
          const p = finalRow.progress ? JSON.parse(finalRow.progress) : null;
          const incomplete = p && !(p.liveDone && p.cycleDone && p.teamHistoryDone && p.contextDone);
          if (finalRow.status === 'success' && incomplete) violations++;
          samples.push({ status: finalRow.status, ld: p?.leaguesDone ?? 0, locked: finalRow.runningLock !== null });
          if (finalRow.status === 'success') break;
        }
        await sleep(200);
      }

      const wall = nowMs() - tPost;
      // 7) La synchronisation a dû se terminer SEULE, côté serveur.
      check('CHAÎNE SANS NAVIGATEUR : status final = SUCCESS', finalRow?.status === 'success', `status=${finalRow?.status}`);
      check('CHAÎNE SANS NAVIGATEUR : verrou libéré à la fin', finalRow?.runningLock === null);
      const finalProg = finalRow?.progress ? JSON.parse(finalRow.progress) : null;
      check('CHAÎNE SANS NAVIGATEUR : 121/121 ligues (curseur mené au bout)', finalProg?.leaguesDone === LEAGUE_CODES.length, `ld=${finalProg?.leaguesDone}`);
      check('CHAÎNE SANS NAVIGATEUR : 4 phases done', finalProg?.liveDone === true && finalProg?.cycleDone === true && finalProg?.teamHistoryDone === true && finalProg?.contextDone === true);
      check('CHAÎNE MULTI-TRANCHES : reprises serveur enregistrées (resumedCount ≥ 3)', (finalProg?.resumedCount ?? 0) >= 3, `rc=${finalProg?.resumedCount}`);
      check('CHAÎNE SANS NAVIGATEUR : appels ESPN réels cumulés', (finalProg?.espnCalls ?? 0) > 500, `espn=${finalProg?.espnCalls}`);
      check('INVARIANT : jamais 2 workers simultanés (échantillonnage 200 ms)', maxRunning <= 1, `maxRunning=${maxRunning}`);
      check('INVARIANT : partiel JAMAIS marqué success (0 violation)', violations === 0);
      check('INVARIANT : un seul curseur a avancé (R1 — pas de job parasite)', (() => {
        const advanced = [...progressSeen.entries()].filter(([, set]) => set.size > 1).map(([id]) => id);
        return advanced.length === 1 && advanced[0] === R1.id;
      })());
      check('INVARIANT : la chaîne n’a créé aucune ligne WAKE après le clic initial', (await db.syncJobRun.count({ where: { phase: 'wake' } })) === wakeRowsAfterClick);
      console.log(`     observations : échantillons=${samples.length} partial_vus=${samples.filter((s) => s.status === 'partial').length} running_vus=${samples.filter((s) => s.status === 'running').length} (la preuve multi-tranches = resumedCount)`);
      const stEnd = await getSyncState();
      check('fin de scénario : données fraîches (lastSyncAt à jour)', stEnd.stale === false);
      console.log(`  ⏱  Scénario obligatoire complet SANS navigateur : ${Math.round(wall / 1000)} s — tranches=${(finalProg?.resumedCount ?? 0) + 1} — ESPN=${finalProg?.espnCalls}`);

      // Preuve par les logs du serveur (1 clic → N tranches SERVEUR) :
      const log7 = readFileSync(SERVER_LOG, 'utf8');
      const clicks7 = (log7.match(/STATUS=STARTED[^\n]*triggerSource=wake(?!-)/g) ?? []).length;
      const chain7 = (log7.match(/STATUS=STARTED[^\n]*triggerSource=wake-chain/g) ?? []).length;
      check('logs s7 : EXACTEMENT 1 clic utilisateur (les tranches = wake-chain)', clicks7 === 1, `n=${clicks7}`);
      check('logs s7 : tranches serveur enchaînées sans navigateur (≥ 3)', chain7 >= 3, `n=${chain7}`);
      check('logs s7 : chaîne serveur terminée SUCCESS (CHAIN_DONE ended=success)', (log7.match(/STATUS=CHAIN_DONE[^\n]*ended=success/g) ?? []).length >= 1);
      check('logs s7 : aucune erreur de chaîne / after() toujours disponible', !log7.includes('CHAIN_ERROR') && !log7.includes('CHAIN_UNAVAILABLE'));
    }

    // ============================================================
    // PHASE s89 — S8 (course 5 clics) + S9 (cron GET) + S10 (logs)
    // ============================================================
    if (PHASE === 's89') {
      // ---------- S8. 5 CLICS SIMULTANÉS → 1 SEUL RUNNER ----------
      section('S8. 5 appels simultanés → exactement 1 synchronisation (même curseur)');

      startServer();
      check('serveur Next démarré (phase s89)', await waitReady());

      const P3 = 'chain-row-race-5-clicks';
      {
        await restale();
        await craftRow(P3, {
          status: 'partial',
          runningLock: null,
          startedAt: new Date(nowMs() - 30_000),
          progress: JSON.stringify(
            mkProg({
              liveDone: true,
              teamHistoryDone: true,
              contextDone: true,
              chunk: 10,
              leaguesDone: 60,
              cycle: { leaguesTotal: 60, leaguesFailed: 0, eventsSeen: 420, matchesCreated: 12, matchesUpdated: 30, resultsUpserted: 4, oddsInserted: 18, skipped: 0 },
              espnCalls: 60,
            })
          ),
        });
        const responses = await Promise.all(
          Array.from({ length: 5 }, () =>
            fetch(`http://127.0.0.1:${PORT}/api/sync/wake`, { method: 'POST', cache: 'no-store' }).then((r) => r.json())
          )
        );
        const winners = responses.filter((r: any) => r.started === true);
        const losers = responses.filter((r: any) => r.started === false);
        check('COURSE : exactement 1 appel a démarré la synchronisation', winners.length === 1, `winners=${winners.length}`);
        check('COURSE : les 4 autres = already_running', losers.length === 4 && losers.every((l: any) => l.reason === 'already_running'), JSON.stringify(losers.map((l: any) => l.reason)));
        check('COURSE : le gagnant a repris la MÊME ligne (runId P3)', winners[0]?.runId === P3, `runId=${winners[0]?.runId}`);

        // Le navigateur du gagnant ferme aussitôt : la chaîne serveur finit seule.
        let finalRow: RunRow | null = null;
        let maxRunning = 0;
        const deadline = nowMs() + 10 * 60_000;
        while (nowMs() < deadline) {
          const rows = await runRows();
          maxRunning = Math.max(maxRunning, rows.filter((r) => r.runningLock === 'RUNNING').length);
          finalRow = rows.find((r) => r.id === P3) ?? null;
          if (finalRow?.status === 'success') break;
          await sleep(500);
        }
        check('COURSE : achèvement SANS navigateur (status=success)', finalRow?.status === 'success', `status=${finalRow?.status}`);
        check('COURSE : invariant ≤ 1 RUNNING maintenu', maxRunning <= 1, `maxRunning=${maxRunning}`);
        const fp = finalRow?.progress ? JSON.parse(finalRow.progress) : null;
        check('COURSE : 121/121 ligues', fp?.leaguesDone === LEAGUE_CODES.length, `ld=${fp?.leaguesDone}`);
      }

      // ---------- S9. CRON GET (INFRASTRUCTURE) ----------
      section('S9. Cron GET /api/sync/wake → reprise sans utilisateur');

      const P4 = 'chain-row-cron-sweep';
      {
        await restale();
        await craftRow(P4, {
          status: 'partial',
          runningLock: null,
          startedAt: new Date(nowMs() - 30_000),
          progress: JSON.stringify(
            mkProg({
              liveDone: true,
              teamHistoryDone: true,
              contextDone: true,
              chunk: 10,
              leaguesDone: 60,
              cycle: { leaguesTotal: 60, leaguesFailed: 0, eventsSeen: 410, matchesCreated: 10, matchesUpdated: 28, resultsUpserted: 4, oddsInserted: 16, skipped: 0 },
              espnCalls: 58,
            })
          ),
        });
        // Le cron Vercel émet un GET — aucun POST, aucun navigateur.
        const res = await fetch(`http://127.0.0.1:${PORT}/api/sync/wake`, { method: 'GET', cache: 'no-store' });
        const json: any = await res.json();
        check('CRON : GET → 200 ok', res.status === 200 && json?.ok === true);
        check('CRON : reprise démarrée sur le job existant (runId P4)', json.started === true && json.runId === P4, `runId=${json.runId}`);
        let finalRow: RunRow | null = null;
        const deadline = nowMs() + 10 * 60_000;
        while (nowMs() < deadline) {
          finalRow = (await rowOf(P4)) ?? null;
          if (finalRow?.status === 'success') break;
          await sleep(500);
        }
        check('CRON : achèvement SANS utilisateur (status=success)', finalRow?.status === 'success', `status=${finalRow?.status}`);
        const fp = finalRow?.progress ? JSON.parse(finalRow.progress) : null;
        check('CRON : 121/121 ligues + verrou libéré', fp?.leaguesDone === LEAGUE_CODES.length && finalRow?.runningLock === null);
      }

      // ---------- S10. LOGS SERVEUR ----------
      section('S10. Logs serveur — traçabilité de la chaîne');

      {
        const log = readFileSync(SERVER_LOG, 'utf8');
        const startedWake = (log.match(/STATUS=STARTED[^\n]*triggerSource=wake(?!-)/g) ?? []).length;
        const startedChain = (log.match(/STATUS=STARTED[^\n]*triggerSource=wake-chain/g) ?? []).length;
        const startedCron = (log.match(/STATUS=STARTED[^\n]*triggerSource=cron/g) ?? []).length;
        const chainDone = (log.match(/STATUS=CHAIN_DONE[^\n]*ended=success/g) ?? []).length;
        const partials = (log.match(/STATUS=PARTIAL/g) ?? []).length;
        check('logs : 1 clic utilisateur seulement (S8) — PAS un par tranche', startedWake === 1, `n=${startedWake}`);
        check('logs : tranches serveur enchaînées (wake-chain ≥ 5)', startedChain >= 5, `n=${startedChain}`);
        check('logs : 1 passage cron (S9)', startedCron === 1, `n=${startedCron}`);
        check('logs : 2 chaînes serveur terminées en SUCCESS (S8 + S9)', chainDone >= 2, `n=${chainDone}`);
        check('logs : tranches partielles journalisées (STATUS=PARTIAL)', partials >= 2, `n=${partials}`);
        check('logs : AUCUNE erreur de chaîne', !log.includes('CHAIN_ERROR'));
        check('logs : after() TOUJOURS disponible côté serveur (pas de fallback)', !log.includes('CHAIN_UNAVAILABLE'));
      }
    }

    // ---------- Nettoyage par phase ----------
    await db.$disconnect();
    if (server) server.kill('SIGKILL');
    if (PHASE === 's89') {
      stopPg();
      rmSync(PG_DIR, { recursive: true, force: true });
      console.log('\n(nettoyage : PostgreSQL persistant arrêté et supprimé ; logs conservés dans .tmp/)');
    }

    console.log(`\n════════ PHASE ${PHASE} — RÉSULTAT : ${pass} OK / ${fail} ÉCHEC(s) ════════`);
    process.exit(fail > 0 ? 1 : 0);
  } catch (e) {
    console.error('ERREUR FATALE SUITE DE TESTS :', e);
    // NB : TS rétrécit `server` à null dans le catch (assignations du try non
    // suivies) — assertion explicite pour le nettoyage défensif.
    (server as ChildProcess | null)?.kill('SIGKILL');
    process.exit(1);
  }
}

main();
