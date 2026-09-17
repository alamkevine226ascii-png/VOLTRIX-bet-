// ============================================================
// VOLTRIX — Task 46 : RÉPÉTITION GÉNÉRALE « WAKE ON DEMAND »
// (miroir local du test réel Neon — mêmes briques, PG 17 local + ESPN RÉEL)
export {} // module marker (top-level await + isolation des identifiants)
//
// Scénario (5 bullets utilisateur) :
//   1. CRÉATION d'un wake      → nouvelle ligne SyncJobRun verrouillée
//   2. PROGRESSION             → curseur progress JSON avancé à chaque lot
//   3. REPRISE                 → interruption volontaire ENTRE DEUX PHASES,
//                                reprise sur le MÊME runId + curseur exact
//   4. LOCK anti-concurrence   → 2e runWake rejeté + INSERT brut rejeté
//                                par l'index unique partiel PostgreSQL
//   5. FINALISATION SUCCESS    → chaîne complétée, verrou libéré, état frais
//
// Usage : DATABASE_URL=postgresql://postgres@127.0.0.1:5577/postgres bun scripts/t46-wake-rehearsal.ts
// ============================================================

process.env.DATABASE_URL = 'postgresql://postgres@127.0.0.1:5577/postgres';
process.env.DIRECT_URL = process.env.DATABASE_URL;

const { PrismaClient } = await import('@prisma/client');
const db = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

const wakeMod = await import('../src/lib/sync/wake');
const { getSyncState, runWake } = wakeMod;
const espnMod = await import('../src/lib/espn');
const { espnStats } = espnMod;

const BUDGET = 15_000; // tranche courte → plusieurs tranches = plusieurs reprises observables
// NOTE Task 46 : BUDGET doit rester > CONTEXT_MIN_MS (25 s) + TEAM_HISTORY_MIN_MS (12 s)
// pour que la chaîne puisse FINIR (sinon boucle partial sur la phase contexte —
// comportement attendu : le mur/wall + maxLoops de la chaîne serveur limitent la boucle).
// En production le défaut 45 s (SYNC_WAKE_BUDGET_MS) couvre les deux (43 s restants au pire).
// La démonstration ci-dessous utilise 15 s POUR FORCER l'interruption entre phases ;
// la complétion est faite par scripts/t46-wake-complete.ts (budget production 45 s).
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

async function lastRun() {
  return db.syncJobRun.findFirst({
    where: { status: { not: null } },
    orderBy: { startedAt: 'desc' },
  });
}

const tStart = Date.now();

// ---------- ÉTAT INITIAL ----------
section('ÉTAT INITIAL (historique worker status=NULL, ancienneté > 10 min)');
const state0 = await getSyncState();
const fmt = (d: unknown) => (d instanceof Date ? d.toISOString() : String(d ?? 'jamais'));
console.log(`  state: stale=${state0.stale} liveStale=${state0.liveStale} contextStale=${state0.contextStale} lastSyncAt=${fmt(state0.lastSyncAt)}`);
check('données perçues périmées → wake nécessaire', state0.stale || state0.liveStale);
check('aucun job actif au départ', !state0.running);
const espn0 = espnStats.total;

// ---------- 1+2 : CRÉATION + PROGRESSION (tranche 1 en arrière-plan) ----------
section('1. CRÉATION DU WAKE + 2. PROGRESSION (tranche 1, budget 15 s)');
const tranche1 = runWake({ triggerSource: 'wake', budgetMs: BUDGET });
await new Promise((r) => setTimeout(r, 4_000)); // claim + LIVE en cours

const runningRow = await db.syncJobRun.findFirst({ where: { runningLock: 'RUNNING' } });
check('ligne SyncJobRun créée avec verrou tenu', !!runningRow, 'aucune ligne RUNNING');
check('runningLock = RUNNING', runningRow?.runningLock === 'RUNNING');
check('status = running', runningRow?.status === 'running');
check('triggerSource = wake', runningRow?.triggerSource === 'wake');

// ---------- 4 : LOCK ANTI-CONCURRENCE (pendant que la tranche 1 tient le verrou) ----------
section('4. LOCK ANTI-CONCURRENCE (verrou tenu par la tranche 1)');
const concurrent = await runWake({ triggerSource: 'wake', budgetMs: BUDGET });
check('2e runWake rejeté (already_running)', concurrent.started === false && concurrent.reason === 'already_running');
check('le 2e appel référence le MÊME runId', concurrent.runId === runningRow?.id, `runId=${concurrent.runId}`);

try {
  await db.$executeRawUnsafe(
    `INSERT INTO "SyncJobRun" (id, phase, status, "runningLock", "startedAt") VALUES (gen_random_uuid()::text, 'probe', 'running', 'RUNNING', now());`
  );
  check('INSERT brut 2e RUNNING rejeté par PostgreSQL', false, 'INSERT accepté — index inopérant !');
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  check('INSERT brut 2e RUNNING rejeté par PostgreSQL', msg.includes('SyncJobRun_running_lock_uidx') || msg.includes('unique'), msg.slice(0, 120));
}

const t1 = await tranche1;
console.log(`  tranche 1 → status=${t1.status} runId=${t1.runId}`);
check('tranche 1 = partial (budget épuisé, travail restant)', t1.started === true && t1.status === 'partial');

const row1 = t1.runId ? await db.syncJobRun.findUnique({ where: { id: t1.runId } }) : null;
check('verrou LIBÉRÉ après partial', row1?.runningLock === null);
check('status = partial (JAMAIS success)', row1?.status === 'partial');
check('curseur conservé (progress JSON présent)', !!row1?.progress);
const prog1: Prog = JSON.parse(row1?.progress ?? '{}');
console.log(`  curseur tranche 1: chunk=${prog1.chunk} leaguesDone=${prog1.leaguesDone}/${prog1.leaguesTotal} liveDone=${prog1.liveDone} espnCalls=${prog1.espnCalls} resumedCount=${prog1.resumedCount}`);
check('progression réelle effectuée (LIVE fait + cycle entamé)', prog1.liveDone === true && (prog1.leaguesDone ?? 0) > 0);

// ---------- 3 : REPRISE (interruption volontaire ENTRE DEUX PHASES) ----------
section('3. REPRISE après interruption volontaire (entre cycle et fin)');
const t2 = await runWake({ triggerSource: 'wake', budgetMs: BUDGET });
console.log(`  tranche 2 → status=${t2.status} runId=${t2.runId}`);
check('MÊME runId repris (pas de nouvelle ligne)', t2.runId === t1.runId);
const row2 = t2.runId ? await db.syncJobRun.findUnique({ where: { id: t2.runId } }) : null;
const prog2: Prog = JSON.parse(row2?.progress ?? '{}');
console.log(`  curseur tranche 2: chunk=${prog2.chunk} leaguesDone=${prog2.leaguesDone}/${prog2.leaguesTotal} resumedCount=${prog2.resumedCount}`);
check('reprise sur le curseur (leaguesDone ADVANCE, pas de restart)', (prog2.leaguesDone ?? 0) > (prog1.leaguesDone ?? 0));
check('resumedCount incrémenté', (prog2.resumedCount ?? 0) === 1);
check('ligne unique — pas de doublon créé', (await db.syncJobRun.count({ where: { phase: 'wake' } })) === 1);

// ---------- 5 : FINALISATION SUCCESS ----------
section('5. FINALISATION SUCCESS (chaîne de reprises jusqu’à completion)');
let final = t2;
let loops = 0;
while (final.status !== 'success' && loops < 30) {
  loops++;
  final = await runWake({ triggerSource: 'wake-chain', budgetMs: BUDGET });
  if (final.status === 'failed') {
    console.error(`  échec tranche ${loops + 2}: ${final.error}`);
    break;
  }
  process.stdout.write(`  tranche ${loops + 2} → ${final.status} (leaguesDone=${(JSON.parse((await lastRun())?.progress ?? '{}') as Prog).leaguesDone})\n`);
}
const rowF = final.runId ? await db.syncJobRun.findUnique({ where: { id: final.runId } }) : null;
check('finalisation SUCCESS atteinte', final.status === 'success');
check('verrou libéré au SUCCESS', rowF?.runningLock === null);
check('finishedAt renseigné', !!rowF?.finishedAt);
const progF: Prog = JSON.parse(rowF?.progress ?? '{}');
const statsF = JSON.parse(rowF?.stats ?? '{}') as Record<string, unknown>;
console.log(`  final: espnCalls=${progF.espnCalls} leaguesDone=${progF.leaguesDone}/${progF.leaguesTotal} liveDone=${progF.liveDone} cycleDone=${progF.cycleDone} teamHistoryDone=${progF.teamHistoryDone} contextDone=${progF.contextDone} resumedCount=${progF.resumedCount}`);
console.log(`  stats: ${JSON.stringify(statsF).slice(0, 220)}`);
check('cycle complet 121/121 ligues', progF.leaguesDone === progF.leaguesTotal);
check('toutes les phases faites', progF.liveDone === true && progF.cycleDone === true && progF.teamHistoryDone === true && progF.contextDone === true);
check('aucun verrou résiduel en base', (await db.syncJobRun.count({ where: { runningLock: 'RUNNING' } })) === 0);

// ---------- IDEMPOTENCE POST-SUCCÈS ----------
section('IDEMPOTENCE : wake sur données fraîches = 0 travail');
const espnBeforeFresh = espnStats.total;
const fresh = await runWake({ triggerSource: 'wake', budgetMs: BUDGET });
check('fresh → started:false (0 ESPN)', fresh.started === false && fresh.reason === 'fresh');
check('0 appel ESPN sur le wake frais', espnStats.total === espnBeforeFresh);

// ---------- ÉTAT FINAL ----------
section('BILAN');
const stateF = await getSyncState();
console.log(`  state final: stale=${stateF.stale} liveStale=${stateF.liveStale} lastSyncAt=${fmt(stateF.lastSyncAt)}`);
check('données désormais fraîches', !stateF.stale && !stateF.liveStale);
const matchesTotal = await db.match.count();
const oddsTotal = await db.oddsSnapshot.count();
const durTotalMs = Date.now() - tStart;
console.log(`  Match en base: ${matchesTotal} (mire initiale 20) — OddsSnapshot: ${oddsTotal} (mire initiale 30)`);
console.log(`  Appels ESPN cumulés (compteur global): ${espnStats.total - espn0}`);
console.log(`  Durée totale du scénario: ${(durTotalMs / 1000).toFixed(1)} s`);

console.log(`\n${pass} PASS / ${fail} FAIL`);
if (fail > 0) process.exit(1);
await db.$disconnect();
process.exit(0);
