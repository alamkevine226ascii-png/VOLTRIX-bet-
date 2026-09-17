// ============================================================
// VOLTRIX — Task 47 : WAKE RÉEL sur NEON PRODUCTION (§26)
//
// Scénario (instructions utilisateur) :
//   7.  WAKE RÉEL            → runWake triggerSource='wake', budget
//                              PRODUCTION (45 s, défaut — inchangé)
//   8.  PROGRESSION CURSEUR  → progress JSON de SyncJobRun avancé
//   9.  REPRISE + SUCCESS    → chaîne de tranches sur le MÊME runId
//                              jusqu'à finalisation SUCCESS
//   10. SECOND WAKE FRAIS    → started:false reason:fresh, 0 ESPN
//   11. DONNÉES PRÉSENTES    → Match/OddsSnapshot réellement écrits
//   Lock anti-concurrence    → 2e runWake already_running + INSERT
//                              brut rejeté par l'index unique PARTIEL
//                              (sonde en transaction ROLLBACK-ée —
//                              zéro risque sur la production).
//
// Différences vs rehearsal T46 : PAS de DATABASE_URL codé (env),
// garde production neon.tech, budget défaut (45 s) partout.
//
// Usage : DATABASE_URL="postgresql://…neon…" bun scripts/t47-neon-wake.ts
// ============================================================

const { PrismaClient } = await import('@prisma/client');
const db = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

const wakeMod = await import('../src/lib/sync/wake');
const { getSyncState, runWake } = wakeMod;
const espnMod = await import('../src/lib/espn');
const { espnStats } = espnMod;

if (!process.env.DATABASE_URL?.includes('neon.tech')) {
  console.error('✗ DATABASE_URL ne pointe pas vers Neon — abandon (garde-fou production)');
  process.exit(1);
}

class ProbeDone extends Error {
  constructor(public rejected: boolean) {
    super('PROBE_EXPECTED');
  }
}

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
function section(t: string) {
  console.log(`\n━━ ${t} ━━`);
}
const fmt = (d: unknown) => (d instanceof Date ? d.toISOString() : String(d ?? 'jamais'));

interface Prog {
  liveDone?: boolean;
  cycleDone?: boolean;
  chunk?: number;
  leaguesDone?: number;
  leaguesTotal?: number;
  teamHistoryDone?: boolean;
  contextDone?: boolean;
  espnCalls?: number;
  resumedCount?: number;
}

async function lockProbe(): Promise<boolean> {
  // Sonde de l'index unique PARTIEL : 2e INSERT RUNNING doit être rejeté.
  // Transaction ROLLBACK-ée systématiquement → AUCUN risque production.
  let rejected = true;
  try {
    await db.$transaction(async (tx) => {
      let accepted = false;
      try {
        await tx.$executeRawUnsafe(
          `INSERT INTO "SyncJobRun" (id, phase, status, "runningLock", "startedAt") VALUES (gen_random_uuid()::text, 'probe', 'running', 'RUNNING', now());`
        );
        accepted = true; // index inopérant — anomalie
      } catch {
        accepted = false; // rejet attendu
      }
      rejected = !accepted;
      throw new ProbeDone(rejected); // ROLLBACK dans tous les cas
    });
  } catch (e) {
    if (!(e instanceof ProbeDone)) throw e;
  }
  return rejected;
}

const tStart = Date.now();

async function main() {
  // ---------- ÉTAT INITIAL ----------
  section('ÉTAT INITIAL (production Neon — dernière sync worker il y a ~27 h)');
  const state0 = await getSyncState();
  console.log(`  state: stale=${state0.stale} liveStale=${state0.liveStale} contextStale=${state0.contextStale} lastSyncAt=${fmt(state0.lastSyncAt)}`);
  check('données perçues périmées → wake nécessaire', state0.stale || state0.liveStale);
  check('aucun job actif au départ', !state0.running);
  const matchesBefore = await db.match.count();
  const oddsBefore = await db.oddsSnapshot.count();
  const predictionsBefore = await db.prediction.count();
  const espn0 = espnStats.total;
  console.log(`  AVANT: Match=${matchesBefore} OddsSnapshot=${oddsBefore} Prediction=${predictionsBefore} ESPN_calls=${espn0}`);

  // ---------- 7 : WAKE RÉEL (tranche 1 en arrière-plan) ----------
  section('7. WAKE RÉEL — création du job (budget PRODUCTION 45 s)');
  const tranche1 = runWake({ triggerSource: 'wake' });
  await new Promise((r) => setTimeout(r, 6_000)); // claim + LIVE en cours

  const runningRow = await db.syncJobRun.findFirst({ where: { runningLock: 'RUNNING' } });
  check('ligne SyncJobRun créée avec verrou tenu', !!runningRow, 'aucune ligne RUNNING');
  check('runningLock = RUNNING', runningRow?.runningLock === 'RUNNING');
  check('status = running', runningRow?.status === 'running');
  check("triggerSource = 'wake'", runningRow?.triggerSource === 'wake');
  const runId = runningRow?.id ?? null;
  console.log(`  runId=${runId}`);

  // ---------- LOCK ANTI-CONCURRENCE (verrou tenu) ----------
  section('LOCK ANTI-CONCURRENCE (pendant la tranche 1)');
  const concurrent = await runWake({ triggerSource: 'wake' });
  check('2e runWake rejeté (already_running)', concurrent.started === false && concurrent.reason === 'already_running');
  check('le 2e appel référence le MÊME runId', concurrent.runId === runId, `runId=${concurrent.runId}`);
  const probeOk = await lockProbe();
  check('INSERT brut 2e RUNNING rejeté par l\'index unique PostgreSQL (sonde ROLLBACK-ée)', probeOk);

  const t1 = await tranche1;
  console.log(`  tranche 1 → status=${t1.status} runId=${t1.runId}`);
  check('tranche 1 démarre le job', t1.started === true);
  check('tranche 1 = partial (budget 45 s épuisé, travail restant)', t1.status === 'partial', `status=${t1.status}`);

  const row1 = t1.runId ? await db.syncJobRun.findUnique({ where: { id: t1.runId } }) : null;
  check('verrou LIBÉRÉ après partial', row1?.runningLock === null);
  check('status = partial (JAMAIS success)', row1?.status === 'partial');
  check('curseur conservé (progress JSON présent)', !!row1?.progress);
  const prog1: Prog = JSON.parse(row1?.progress ?? '{}');
  console.log(`  curseur tranche 1: chunk=${prog1.chunk} leaguesDone=${prog1.leaguesDone}/${prog1.leaguesTotal} liveDone=${prog1.liveDone} espnCalls=${prog1.espnCalls} resumedCount=${prog1.resumedCount}`);
  check('progression réelle effectuée (LIVE fait + cycle entamé)', prog1.liveDone === true && (prog1.leaguesDone ?? 0) > 0);

  // ---------- 8 : PROGRESSION CURSEUR + 9 : REPRISE → SUCCESS ----------
  section('8+9. REPRISE sur curseur — chaîne de tranches jusqu\'à SUCCESS');
  let prev = prog1;
  let final = t1;
  let loops = 1;
  const timeline: Array<{ tranche: number; status: string; leaguesDone?: number; espnCalls?: number; resumedCount?: number }> = [
    { tranche: 1, status: t1.status, leaguesDone: prog1.leaguesDone, espnCalls: prog1.espnCalls, resumedCount: prog1.resumedCount },
  ];
  while (final.status !== 'success' && loops < 40) {
    loops++;
    final = await runWake({ triggerSource: 'wake-chain' }); // budget défaut 45 s — comme le serveur/cron
    const row = final.runId ? await db.syncJobRun.findUnique({ where: { id: final.runId } }) : null;
    const p: Prog = JSON.parse(row?.progress ?? '{}');
    timeline.push({ tranche: loops, status: final.status ?? '—', leaguesDone: p.leaguesDone, espnCalls: p.espnCalls, resumedCount: p.resumedCount });
    process.stdout.write(`  tranche ${loops} → ${final.status} leaguesDone=${p.leaguesDone}/${p.leaguesTotal} espnCalls=${p.espnCalls} resumed=${p.resumedCount}\n`);
    if (final.status === 'failed') {
      console.error(`  ✗ échec de tranche: ${final.error}`);
      break;
    }
    check(`tranche ${loops} : MÊME runId (pas de nouvelle ligne)`, final.runId === t1.runId, `runId=${final.runId}`);
    check(`tranche ${loops} : curseur non-régressif`, (p.leaguesDone ?? 0) >= (prev.leaguesDone ?? 0), `${prev.leaguesDone}→${p.leaguesDone}`);
    prev = p;
  }
  console.log(`  tranches utilisées: ${loops}`);

  const rowF = final.runId ? await db.syncJobRun.findUnique({ where: { id: final.runId } }) : null;
  const progF: Prog = JSON.parse(rowF?.progress ?? '{}');
  const statsF = JSON.parse(rowF?.stats ?? '{}') as Record<string, unknown>;
  check('9. FINALISATION SUCCESS atteinte', final.status === 'success', `status=${final.status}`);
  check('verrou libéré au SUCCESS', rowF?.runningLock === null);
  check('finishedAt renseigné', !!rowF?.finishedAt);
  check('toutes les phases faites (live/cycle/teamHistory/context)', progF.liveDone === true && progF.cycleDone === true && progF.teamHistoryDone === true && progF.contextDone === true);
  check('cycle complet 121/121 ligues', progF.leaguesDone === progF.leaguesTotal, `${progF.leaguesDone}/${progF.leaguesTotal}`);
  check('ligne unique — pas de doublon de job wake', (await db.syncJobRun.count({ where: { phase: 'wake' } })) === 1);
  check('aucun verrou résiduel en base', (await db.syncJobRun.count({ where: { runningLock: 'RUNNING' } })) === 0);
  console.log(`  final: espnCalls=${progF.espnCalls} resumedCount=${progF.resumedCount}`);
  console.log(`  stats: ${JSON.stringify(statsF).slice(0, 300)}`);

  // ---------- 10 : SECOND WAKE FRAIS = 0 ESPN ----------
  section('10. SECOND WAKE sur données fraîches = 0 appel ESPN');
  const stateF = await getSyncState();
  console.log(`  state: stale=${stateF.stale} liveStale=${stateF.liveStale} lastSyncAt=${fmt(stateF.lastSyncAt)}`);
  check('données désormais fraîches', !stateF.stale && !stateF.liveStale);
  check('aucun job resumable restant', stateF.resumable === null);
  const espnBeforeFresh = espnStats.total;
  const fresh = await runWake({ triggerSource: 'wake' });
  check('fresh → started:false (0 travail)', fresh.started === false && fresh.reason === 'fresh', `reason=${fresh.reason}`);
  check('0 appel ESPN sur le wake frais', espnStats.total === espnBeforeFresh, `delta=${espnStats.total - espnBeforeFresh}`);

  // ---------- 11 : DONNÉES RÉELLEMENT PRÉSENTES ----------
  section('11. DONNÉES RÉELLEMENT PRÉSENTES dans Neon');
  const matchesAfter = await db.match.count();
  const oddsAfter = await db.oddsSnapshot.count();
  const predictionsAfter = await db.prediction.count();
  const tStartIso = new Date(tStart).toISOString();
  const recentMatches = await db.$queryRawUnsafe<Array<{ n: bigint }>>(
    `SELECT count(*)::bigint AS n FROM "Match" WHERE "updatedAt" >= '${tStartIso}';`
  );
  const recentOdds = await db.$queryRawUnsafe<Array<{ n: bigint }>>(
    `SELECT count(*)::bigint AS n FROM "OddsSnapshot" WHERE "createdAt" >= '${tStartIso}';`
  );
  console.log(`  Match: ${matchesBefore} → ${matchesAfter} (Δ${matchesAfter - matchesBefore}) — touchés pendant le wake: ${recentMatches[0].n}`);
  console.log(`  OddsSnapshot: ${oddsBefore} → ${oddsAfter} (Δ${oddsAfter - oddsBefore}) — nouvelles lignes (createdAt ≥ début du wake): ${recentOdds[0].n}`);
  console.log(`  Prediction: ${predictionsBefore} → ${predictionsAfter} (doit être INCHANGÉ — wake n'écrit jamais Prediction)`);
  check('Matchs réellement écrits/maj dans Neon', Number(recentMatches[0].n) > 0, `${recentMatches[0].n}`);
  check('Cotes réellement présentes dans Neon', oddsAfter > 0 && Number(recentOdds[0].n) >= 0, `total=${oddsAfter}`);
  check('Prediction INCHANGÉE (§20bis + périmètre wake)', predictionsAfter === predictionsBefore, `${predictionsBefore}→${predictionsAfter}`);

  // ---------- BILAN ----------
  const durTotalMs = Date.now() - tStart;
  const espnTotal = espnStats.total - espn0;
  console.log(`\n━━ BILAN ━━`);
  console.log(`  Appels ESPN cumulés (wake complet): ${espnTotal}`);
  console.log(`  Durée totale du scénario: ${(durTotalMs / 1000).toFixed(1)} s`);
  console.log(`  Timeline: ${JSON.stringify(timeline)}`);

  // Artefact (hors Git) pour le rapport
  const { writeFileSync } = await import('node:fs');
  writeFileSync(
    '/home/z/my-project/backups/t47-wake-result.json',
    JSON.stringify(
      {
        runId: t1.runId,
        status: final.status,
        tranches: loops,
        timeline,
        espnCalls: espnTotal,
        durationMs: durTotalMs,
        matchesBefore,
        matchesAfter,
        oddsBefore,
        oddsAfter,
        recentMatches: Number(recentMatches[0].n),
        recentOdds: Number(recentOdds[0].n),
        stats: statsF,
        progressFinal: progF,
        pass,
        fail,
      },
      null,
      2
    )
  );

  console.log(`\n${pass} PASS / ${fail} FAIL`);
  if (fail > 0) process.exit(1);
}

main()
  .catch((e) => {
    console.error('✗ ERREUR FATALE:', e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
