// ============================================================
// VOLTRIX — Task 46 : COMPLÉTION DU SCÉNARIO — reprise → SUCCESS
//
export {} // module marker (top-level await + isolation des identifiants)
// Le rehearsal (budget test 15 s) a volontairement interrompu le job
// ENTRE la phase cycle (121/121 ligues faites) et la phase contexte.
// Ce script reprend le MÊME runId avec le budget de PRODUCTION (45 s,
// défaut SYNC_WAKE_BUDGET_MS) — exactement le comportement d'une
// tranche serveur/cron — jusqu'à finalisation SUCCESS, puis prouve :
//   - status success + verrou libéré + toutes phases faites ;
//   - getSyncState → données fraîches (seules les lignes SUCCESS
//     comptent pour la fraîcheur — partial ne fait jamais foi) ;
//   - wake suivant → started:false reason:fresh (0 ESPN).
//
// Usage : bun scripts/t46-wake-complete.ts
// ============================================================

process.env.DATABASE_URL = 'postgresql://postgres@127.0.0.1:5577/postgres';
process.env.DIRECT_URL = process.env.DATABASE_URL;

const { PrismaClient } = await import('@prisma/client');
const db = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
const wakeMod = await import('../src/lib/sync/wake');
const { getSyncState, runWake } = wakeMod;
const espnMod = await import('../src/lib/espn');
const { espnStats } = espnMod;

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

const fmt = (d: unknown) => (d instanceof Date ? d.toISOString() : String(d ?? 'jamais'));

// Job interrompu du rehearsal
const interrupted = await db.syncJobRun.findFirst({
  where: { status: 'partial' },
  orderBy: { startedAt: 'desc' },
});
if (!interrupted) {
  console.error('✗ aucun job partial à reprendre');
  process.exit(1);
}
console.log(`━━ REPRISE du job interrompu runId=${interrupted.id} (budget PRODUCTION 45 s) ━━`);
const espn0 = espnStats.total;
const t0 = Date.now();

let final = await runWake({ triggerSource: 'wake-chain' }); // budget défaut 45 s
let loops = 1;
while (final.status !== 'success' && loops < 6) {
  loops++;
  console.log(`  tranche ${loops} → ${final.status}, reprise…`);
  final = await runWake({ triggerSource: 'wake-chain' });
}
console.log(`  tranches utilisées: ${loops}, statut final: ${final.status}`);

const row = await db.syncJobRun.findUnique({ where: { id: interrupted.id } });
const prog = JSON.parse(row?.progress ?? '{}') as Record<string, unknown>;
const stats = JSON.parse(row?.stats ?? '{}') as Record<string, unknown>;
const durMs = Date.now() - t0;

check('MÊME runId poursuivi (pas de nouvelle ligne)', final.runId === interrupted.id);
check('finalisation SUCCESS', final.status === 'success', `status=${final.status}`);
check('verrou libéré', row?.runningLock === null);
check('toutes les phases faites (live/cycle/teamHistory/context)', prog.liveDone === true && prog.cycleDone === true && prog.teamHistoryDone === true && prog.contextDone === true);
check('121/121 ligues', prog.leaguesDone === prog.leaguesTotal);
console.log(`  final: espnCalls=${prog.espnCalls} matchesCreated=${stats.matchesCreated} oddsUpdated=${stats.oddsUpdated} resumedCount=${prog.resumedCount}`);
console.log(`  durée de la complétion: ${(durMs / 1000).toFixed(1)} s (appels ESPN complétion: ${espnStats.total - espn0})`);

// Freshness : seuls les SUCCESS comptent
const state = await getSyncState();
console.log(`  state: stale=${state.stale} liveStale=${state.liveStale} lastSyncAt=${fmt(state.lastSyncAt)} lastLiveSyncAt=${fmt(state.lastLiveSyncAt)}`);
check('données désormais fraîches (stale=false)', state.stale === false);
check('aucun job resumable restant', state.resumable === null);

// Idempotence : un wake de plus = 0 travail, 0 ESPN
const espnBefore = espnStats.total;
const fresh = await runWake({ triggerSource: 'wake' });
check('wake suivant → fresh (0 travail)', fresh.started === false && fresh.reason === 'fresh');
check('0 appel ESPN', espnStats.total === espnBefore);

console.log(`\n${pass} PASS / ${fail} FAIL`);
await db.$disconnect();
process.exit(fail > 0 ? 1 : 0);
