// ============================================================
// VOLTRIX — Task 44 §20bis : tests de la protection DB « Prediction »
//
// Préuve exigée (GO utilisateur) :
//   1) pose idempotente — exactement 2 triggers + 1 fonction, re-pose
//      sans doublon ;
//   2) INSERT toujours libre (création = seule voie d'entrée) ;
//   3) mutations INTERDITES réellement rejetées par PostgreSQL :
//      19 colonnes figées testées une par une (payload + identité) ;
//   4) mutations de RÉSOLUTION légitimes passent : resolved:false→true,
//      result NULL→WIN/LOSE/VOID, closingOdds NULL→valeur (les 2 shapes
//      de analyze.ts settleRow, Task 21-a FIX 2) ;
//   5) ligne résolue = dossier clos : plus AUCUNE mutation (one-way) ;
//   6) DELETE interdit (pending ET résolu) ;
//   7) no-op / upsert update:{} (réplique Option B) passe inchangé ;
//   8) isolation : §20bis ne touche QUE Prediction (snapshots libres
//      sur ce cluster — les triggers §20 de apply-immutability.ts
//      sont un mécanisme séparé, non posé ici) ;
//   9) /api/performance : computePerformanceStats sur lignes résolues
//      via le trigger (WIN/LOSE/VOID + repli sans closingOdds) +
//      appel RÉEL de GET /api/performance (route importée, 0 ESPN) ;
//  10) messages d'erreur « VOLTRIX §20bis » avec colonne nominative.
//
// PostgreSQL 17 temporaire (NE JAMAIS toucher la db de prod — mire
// scripts/test-option-b.ts : cluster éphémère, port dérivé du PID,
// datadir dans tmpdir, supprimé en fin). Exécuter : bun scripts/test-prediction-freeze.ts
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
async function expectReject(name: string, run: () => Promise<unknown>, mustContain: string) {
  try {
    await run();
    check(name, false, 'mutation ACCEPTÉE (aucune exception levée)');
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    check(name, msg.includes(mustContain), msg.slice(0, 170));
  }
}

// ---------- 0. PostgreSQL 17 temporaire ----------
const ROOT = path.resolve(import.meta.dir, '..');
const tmpDir = mkdtempSync(path.join(tmpdir(), 'voltrix-freeze-'));
const PGBIN = path.join(ROOT, '.tmp-pg', 'pg17', 'usr', 'lib', 'postgresql', '17', 'bin');
const PG_PORT = 5433 + (process.pid % 50);
const dataDir = path.join(tmpDir, 'pgdata');
const dbUrl = `postgresql://postgres@127.0.0.1:${PG_PORT}/postgres`;
process.env.DATABASE_URL = dbUrl; // l'env process GAGNE sur .env → prod jamais touchée
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
execSync('bunx prisma db push --skip-generate', {
  cwd: ROOT,
  env: { ...process.env, DATABASE_URL: dbUrl, DIRECT_URL: dbUrl },
  stdio: 'pipe',
});

const { PrismaClient } = await import('@prisma/client');
const db = new PrismaClient({ datasources: { db: { url: dbUrl } } });
const { FREEZE_STATEMENTS } = await import('./prediction-freeze-sql');
const { computePerformanceStats } = await import('../src/lib/analyze');

const NOW = Date.now();

// Fabrique de ligne Prediction (shape complet Task 21-a/22-a)
// NB : les overrides EXPLICITES null doivent passer (lignes legacy) → test `in o`, pas ??
const baseRow = (o: any) => ({
  matchId: o.matchId,
  league: 'league' in o ? o.league : 'eng.1',
  leagueName: 'leagueName' in o ? o.leagueName : 'Premier League',
  matchDate: 'matchDate' in o ? o.matchDate : new Date(NOW - 3 * 86400_000),
  homeTeam: 'homeTeam' in o ? o.homeTeam : 'Arsenal',
  awayTeam: 'awayTeam' in o ? o.awayTeam : 'Chelsea',
  market: 'market' in o ? o.market : '1X2',
  pick: 'pick' in o ? o.pick : '1 - Arsenal',
  probability: 'probability' in o ? o.probability : 0.55,
  odds: 'odds' in o ? o.odds : 2.1,
  pickedTeamId: 'pickedTeamId' in o ? o.pickedTeamId : 'h1',
  oddsCapturedAt: 'oddsCapturedAt' in o ? o.oddsCapturedAt : new Date(NOW - 7200_000),
  predictionTime: 'predictionTime' in o ? o.predictionTime : new Date(NOW - 7200_000),
  modelVersion: 'modelVersion' in o ? o.modelVersion : 'v2.1',
  rawProbability: 'rawProbability' in o ? o.rawProbability : 0.52,
  inputsDigest: 'inputsDigest' in o ? o.inputsDigest : '{"odds":1,"ou":2.5,"h":[19,19]}',
  confidence: 'confidence' in o ? o.confidence : 4,
});
const fingerprint = (r: any) =>
  JSON.stringify([
    r.id, r.matchId, r.market, r.league, r.leagueName, r.matchDate?.getTime(), r.homeTeam, r.awayTeam,
    r.pick, r.pickedTeamId, r.probability, r.rawProbability, r.inputsDigest, r.predictionTime?.getTime(),
    r.modelVersion, r.confidence, r.odds, r.oddsCapturedAt?.getTime(), r.resolved, r.result, r.closingOdds, r.createdAt?.getTime(),
  ]);

// ============================================================
section('1. Pose §20bis — 2 triggers + 1 fonction, idempotente');
// ============================================================
for (const stmt of FREEZE_STATEMENTS) await db.$executeRawUnsafe(stmt);

const trigCount = async () => {
  const rows = await db.$queryRawUnsafe<Array<{ cnt: bigint }>>(
    `SELECT count(*) AS cnt FROM pg_trigger WHERE tgrelid = '"Prediction"'::regclass AND tgname LIKE 'Prediction_freeze_%' AND NOT tgisinternal;`
  );
  return Number(rows[0].cnt);
};
const fnCount = async () => {
  const rows = await db.$queryRawUnsafe<Array<{ cnt: bigint }>>(
    `SELECT count(*) AS cnt FROM pg_proc WHERE proname = 'voltrix_prediction_freeze_guard';`
  );
  return Number(rows[0].cnt);
};
check('exactement 2 triggers Prediction_freeze_* (update + delete)', (await trigCount()) === 2);
check('exactement 1 fonction voltrix_prediction_freeze_guard', (await fnCount()) === 1);

for (const stmt of FREEZE_STATEMENTS) await db.$executeRawUnsafe(stmt); // RE-POSE (idempotence)
check('re-pose idempotente : toujours 2 triggers, 0 doublon', (await trigCount()) === 2);
check('re-pose idempotente : toujours 1 fonction (CREATE OR REPLACE)', (await fnCount()) === 1);

// ============================================================
section('2. Isolation — §20bis ne touche QUE Prediction (snapshots libres ici)');
// ============================================================
const isoSnap = await db.predictionSnapshot.create({
  data: {
    matchId: 'fz-iso',
    kickoffAt: new Date(NOW + 3600_000),
    homeTeamName: 'Iso Home',
    awayTeamName: 'Iso Away',
    predictionTime: new Date(NOW - 7200_000),
    modelVersion: 'v2.1',
    confidence: 4,
  },
});
const isoMkt = await db.predictionMarket.create({ data: { snapshotId: isoSnap.id, marketKey: '1X2' } });
await db.predictionOutcome.createMany({
  data: [
    { marketId: isoMkt.id, outcomeKey: 'HOME_WIN', probability: 0.5 },
    { marketId: isoMkt.id, outcomeKey: 'DRAW', probability: 0.3 },
  ],
});
let isoMutated = false;
try {
  await db.predictionSnapshot.update({ where: { id: isoSnap.id }, data: { confidence: 2 } });
  isoMutated = true;
} catch {}
check('PredictionSnapshot.update LIBRE sur ce cluster (§20bis ne pose rien ailleurs)', isoMutated);
await db.predictionMarket.delete({ where: { id: isoMkt.id } }); // cascade PredictionOutcome
check('PredictionMarket.delete LIBRE (+ cascade outcomes)', !(await db.predictionMarket.findFirst({ where: { id: isoMkt.id } })) && (await db.predictionOutcome.count({ where: { marketId: isoMkt.id } })) === 0);
await db.predictionSnapshot.delete({ where: { id: isoSnap.id } });
check('PredictionSnapshot.delete LIBRE (le §20 apply-immutability.ts reste un mécanisme séparé)', !(await db.predictionSnapshot.findFirst({ where: { id: isoSnap.id } })));

// ============================================================
section('3. Création — INSERT toujours libre (full shape + legacy NULL)');
// ============================================================
const rowA = await db.prediction.create({ data: baseRow({ matchId: 'fz-full' }) });
const rowLegacy = await db.prediction.create({
  data: baseRow({ matchId: 'fz-legacy', modelVersion: null, predictionTime: null, rawProbability: null, inputsDigest: null, oddsCapturedAt: null, pickedTeamId: null, odds: null, probability: 0.4, pick: '2 - Chelsea', confidence: 2, league: 'esp.1', leagueName: 'LaLiga' }),
});
check('INSERT full shape (Task 21-a/22-a) accepté', !!rowA?.id);
check('INSERT legacy (modelVersion/predictionTime NULL — jamais réétiquetés) accepté', !!rowLegacy?.id && rowLegacy.modelVersion === null && rowLegacy.predictionTime === null);

// ============================================================
section('4. Résolution légitime — les 2 shapes settleRow (analyze.ts:427-437) passent');
// ============================================================
const rowC = await db.prediction.create({ data: baseRow({ matchId: 'fz-void', odds: null, probability: 0.3, market: 'O/U 2.5', pick: 'Moins de 2.5', rawProbability: 0.28 }) });
const rowD = await db.prediction.create({ data: baseRow({ matchId: 'fz-pending', matchDate: new Date(NOW + 2 * 3600_000), probability: 0.62, odds: 2.5 }) });

await db.prediction.update({ where: { id: rowA.id }, data: { resolved: true, result: 'WIN', closingOdds: 2.3 } });
await db.prediction.update({ where: { id: rowLegacy.id }, data: { resolved: true, result: 'LOSE' } });
await db.prediction.update({ where: { id: rowC.id }, data: { resolved: true, result: 'VOID' } });

const aAfter = await db.prediction.findUniqueOrThrow({ where: { id: rowA.id } });
const lAfter = await db.prediction.findUniqueOrThrow({ where: { id: rowLegacy.id } });
const cAfter = await db.prediction.findUniqueOrThrow({ where: { id: rowC.id } });
check('WIN + closingOdds 2.3 appliqués (shape complet settleRow)', aAfter.resolved === true && aAfter.result === 'WIN' && aAfter.closingOdds === 2.3);
check('LOSE sans closingOdds appliqué (shape repli Task 21-a)', lAfter.resolved === true && lAfter.result === 'LOSE' && lAfter.closingOdds === null);
check('VOID appliqué (annulation/report — hors métriques)', cAfter.resolved === true && cAfter.result === 'VOID');

// ============================================================
section('5. Rejets payload — 19 colonnes figées testées une par une (PostgreSQL)');
// ============================================================
const fpRejBefore = fingerprint(await db.prediction.findUniqueOrThrow({ where: { id: rowD.id } }));
const muts: Array<[string, unknown]> = [
  ['matchId', 'fz-other'], ['market', 'BTTS'], ['league', 'esp.1'], ['leagueName', 'LaLiga'],
  ['matchDate', new Date(NOW + 9 * 86400_000)], ['homeTeam', 'X United'], ['awayTeam', 'Y City'],
  ['pick', '2 - Chelsea'], ['pickedTeamId', 'zz9'], ['probability', 0.999], ['rawProbability', 0.888],
  ['inputsDigest', '{"x":1}'], ['predictionTime', new Date(NOW - 1000)], ['modelVersion', 'X-FALSE'],
  ['confidence', 1], ['odds', 9.99], ['oddsCapturedAt', new Date(NOW - 500)], ['id', 'fz-rej-new'], ['createdAt', new Date(NOW + 1000)],
];
for (const [field, value] of muts) {
  await expectReject(
    `rejet ${field} (payload figé)`,
    () => db.prediction.update({ where: { id: rowD.id }, data: { [field]: value } as any }),
    'VOLTRIX §20bis'
  );
}
const fpRejAfter = fingerprint(await db.prediction.findUniqueOrThrow({ where: { id: rowD.id } }));
check('après 19 rejets : ligne bit-identique (aucune mutation partielle)', fpRejBefore === fpRejAfter);

// Message nominatif : la colonne fautive figure dans l'erreur
let msgSample = '';
try {
  await db.prediction.update({ where: { id: rowD.id }, data: { probability: 0.123 } });
} catch (e: any) {
  msgSample = String(e?.message ?? e);
}
check('message d\'erreur nominatif (« VOLTRIX §20bis » + colonne probability)', msgSample.includes('VOLTRIX §20bis') && msgSample.includes('probability'), msgSample.slice(0, 150));

// ============================================================
section('6. Dossier clos — ligne résolue : plus AUCUNE mutation (one-way)');
// ============================================================
await expectReject('rejet result WIN→LOSE sur ligne résolue', () => db.prediction.update({ where: { id: rowA.id }, data: { result: 'LOSE' } }), 'dossier clos');
await expectReject('rejet closingOdds→9.99 sur ligne résolue', () => db.prediction.update({ where: { id: rowA.id }, data: { closingOdds: 9.99 } }), 'dossier clos');
await expectReject('rejet resolved:true→false (retour arrière interdit)', () => db.prediction.update({ where: { id: rowA.id }, data: { resolved: false } }), 'dossier clos');
await expectReject('rejet probability sur ligne résolue (double garde)', () => db.prediction.update({ where: { id: rowA.id }, data: { probability: 0.7 } }), 'VOLTRIX §20bis');
let noopOk = false;
try {
  await db.prediction.update({ where: { id: rowA.id }, data: { resolved: true, result: 'WIN', closingOdds: 2.3 } });
  noopOk = true;
} catch {}
check('no-op (valeurs IS DISTINCT FROM toutes fausses) passe même sur ligne résolue', noopOk);

// ============================================================
section('7. DELETE interdit (pending ET résolu)');
// ============================================================
await expectReject('DELETE pending rejeté', () => db.prediction.delete({ where: { id: rowD.id } }), 'DELETE interdit');
await expectReject('DELETE résolu rejeté', () => db.prediction.delete({ where: { id: rowA.id } }), 'DELETE interdit');

// ============================================================
section('8. Réplique upsert route (update:{}) — création seule, no-op sur existant');
// ============================================================
const up1 = await db.prediction.upsert({
  where: { matchId_market: { matchId: 'fz-ups', market: '1X2' } },
  create: baseRow({ matchId: 'fz-ups', probability: 0.58, odds: 2.0, matchDate: new Date(NOW + 3 * 3600_000) }),
  update: {},
});
const fpUps1 = fingerprint(await db.prediction.findUniqueOrThrow({ where: { id: up1.id } }));
const up2 = await db.prediction.upsert({
  where: { matchId_market: { matchId: 'fz-ups', market: '1X2' } },
  create: baseRow({ matchId: 'fz-ups', probability: 0.91, odds: 5.5, pick: 'X - Draw' }), // create IGNORED sur existant
  update: {},
});
const fpUps2 = fingerprint(await db.prediction.findUniqueOrThrow({ where: { id: up1.id } }));
check('upsert update:{} : même id, valeurs inchangées (create ignoré)', up2.id === up1.id && fpUps1 === fpUps2);
const hist = await db.prediction.upsert({
  where: { matchId_market: { matchId: 'fz-hist', market: 'BTTS' } },
  create: { matchId: 'fz-hist', league: 'eng.1', leagueName: 'Premier League', matchDate: new Date(NOW + 3600_000), homeTeam: 'A', awayTeam: 'B', market: 'BTTS', pick: 'Oui', probability: 0.6, confidence: 3 },
  update: {},
});
const hist2 = await db.prediction.upsert({
  where: { matchId_market: { matchId: 'fz-hist', market: 'BTTS' } },
  create: { matchId: 'fz-hist', league: 'eng.1', leagueName: 'Premier League', matchDate: new Date(NOW + 3600_000), homeTeam: 'A', awayTeam: 'B', market: 'BTTS', pick: 'Non', probability: 0.99, confidence: 5 },
  update: {},
});
check('shape historique (sans colonnes 21-a/22-a) : création + re-upsert no-op OK', hist2.id === hist.id && (await db.prediction.findUniqueOrThrow({ where: { id: hist.id } })).pick === 'Oui');
check('aucun doublon créé par les re-upserts (unicité matchId+market)', (await db.prediction.count({ where: { matchId: { startsWith: 'fz-ups' } } })) === 1 && (await db.prediction.count({ where: { matchId: 'fz-hist' } })) === 1);

// ============================================================
section('9. computePerformanceStats — lignes résolues VIA le trigger (réplique /api/performance)');
// ============================================================
const perfRows = await db.prediction.findMany({
  select: { id: true, matchDate: true, leagueName: true, homeTeam: true, awayTeam: true, market: true, pick: true, probability: true, odds: true, confidence: true, resolved: true, result: true, modelVersion: true },
});
const stats = computePerformanceStats(perfRows, 10);
// 6 lignes : A WIN (p 0.55, odds 2.1, v2.1) · B LOSE (p 0.40, odds null, legacy)
// C VOID (hors métriques) · fz-pending/fz-ups/fz-hist pending (matchDate future)
check('totalPredictions = 6 · pending = 3 · réglés WIN/LOSE = 2 · wins = 1', stats.totalPredictions === 6 && stats.pendingCount === 3 && stats.totalResolved === 2 && stats.wins === 1);
check('winRate = 0.5', Math.abs(stats.winRate - 0.5) < 1e-12);
// ROI économique : seules les sélections AVEC cote réelle (Task 21-a FIX 1) — A seule
check('économique : settledWithOdds=1 · staked=10 · returned=21 · roi=1.1', stats.economic.settledWithOdds === 1 && Math.abs(stats.economic.staked - 10) < 1e-9 && Math.abs(stats.economic.returned - 21) < 1e-9 && Math.abs(stats.economic.roi - 1.1) < 1e-9);
// Brier : ((0.55−1)² + (0.40−0)²) / 2 = (0.2025+0.16)/2 = 0.18125
check('calibrage : brier = 0.18125 sur sample 2 (proba historiques intactes)', Math.abs(stats.calibration.brierScore - 0.18125) < 1e-9 && stats.calibration.sample === 2);
check('byVersion : v2.1 n=1 wins=1 · legacy n=1 wins=0 (VOID/pending exclus)', stats.byVersion['v2.1']?.n === 1 && stats.byVersion['v2.1']?.wins === 1 && stats.byVersion['legacy']?.n === 1 && stats.byVersion['legacy']?.wins === 0);

// ============================================================
section('10. Route RÉELLE GET /api/performance avec trigger actif (0 ESPN — aucun pending dans la fenêtre)');
// ============================================================
const perfModule = await import('../src/app/api/performance/route');
const resPerf = await perfModule.GET(
  new (globalThis as any).Request('http://localhost/api/performance', {
    headers: { 'x-forwarded-for': '10.9.0.7' },
  })
) as Response;
const jsonPerf: any = await resPerf.json();
check('HTTP 200 avec protection §20bis active', resPerf.status === 200);
check('stats route : totalPredictions=6 · réglés=2 · wins=1 · newlyResolved=0 (aucun ESPN)', jsonPerf.totalPredictions === 6 && jsonPerf.totalResolved === 2 && jsonPerf.wins === 1 && jsonPerf.newlyResolved === 0);
check('stats route : winRate=0.5 · pending=3', Math.abs(jsonPerf.winRate - 0.5) < 1e-12 && jsonPerf.pendingCount === 3);
check('stats route : roi économique = 1.1 (cote figée 2.1, mise 10)', jsonPerf.economic && Math.abs(jsonPerf.economic.roi - 1.1) < 1e-9);

// ============================================================
// Nettoyage
// ============================================================
await db.$disconnect();
try {
  execSync(`${PGBIN}/pg_ctl -D ${dataDir} stop -m fast`, { stdio: 'pipe' });
} catch {}
rmSync(tmpDir, { recursive: true, force: true });

console.log(`\n════════ RÉSULTAT : ${pass} OK / ${fail} ÉCHEC(s) ════════`);
process.exit(fail > 0 ? 1 : 0);
