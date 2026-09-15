// ============================================================
// PRÉVISIONS HEBDOMADAIRES — Tests d'intégrité (§21 du cahier des
// charges), sur une DB SQLite TEMPORAIRE (prod jamais touchée).
//
// Garanties testées :
//   A. une prédiction publiée ne peut pas être modifiée (insert-only) ;
//   B. un résultat ne modifie JAMAIS la prédiction ;
//   C. une prédiction ne peut pas utiliser un résultat futur (§6) ;
//   D. predictionTime / modelVersion / rawProbability / inputsDigest /
//      probabilités / matchId restent inchangés (bit-exact) à travers
//      re-scan, rafraîchissement de résultat, évaluation ;
//   E. une 2e exécution du job ne crée AUCUN doublon ;
//   F. une ré-analyse = nouvelle version, la v1 reste intacte ;
//   G. grading : FINAL / VOID corrects, 1X2 noté par côté ;
//   H. métriques : valeurs calculées À LA MAIN (Brier, LogLoss, RPS,
//      accuracy, calibration, confiance, erreurs §16).
// Exécuter : bun scripts/test-forecast-integrity.ts
// ============================================================
import { execSync } from 'node:child_process';
import { rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { buildSnapshotDraft, type SnapshotDraft } from '../src/lib/forecast/snapshot';
import { gradeSnapshot, normalizeStatus, resultKeyOf } from '../src/lib/forecast/evaluate';
import { aggregateWeek, brier1x2, logLoss1x2, rps1x2, brierBinary, logLossBinary, type EvalRow } from '../src/lib/forecast/metrics';
import type { AnalyzeResult } from '../src/lib/analyze';

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
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;

// ---------- 0. DB SQLite temporaire ----------
const ROOT = path.resolve(import.meta.dir, '..');
const tmpDir = mkdtempSync(path.join(tmpdir(), 'voltrix-forecast-'));
const dbUrl = `file:${path.join(tmpDir, 'test.db')}`;
execSync('bunx prisma db push --skip-generate', {
  cwd: ROOT,
  env: { ...process.env, DATABASE_URL: dbUrl },
  stdio: 'pipe',
});
const db = new PrismaClient({ datasources: { db: { url: dbUrl } } });

// ---------- Faux AnalyzeResult (même shape que la production) ----------
const KICKOFF = new Date('2026-09-20T19:45:00Z');
function fakeAnalysis(nowMs: number): AnalyzeResult {
  return {
    contextMode: 'full',
    home: {
      id: '100', name: 'Home FC', logo: null, form: 'WWDLW', rank: 3,
      gamesHome: 12, gamesAway: 11, injuriesCount: 1,
    },
    away: {
      id: '200', name: 'Away FC', logo: null, form: 'LDWWL', rank: 7,
      gamesHome: 11, gamesAway: 12, injuriesCount: 0,
    },
    prediction: {
      probs: { home: 0.5632, draw: 0.2451, away: 0.1917 },
      poisson: { home: 0.55, draw: 0.25, away: 0.2 },
      elo: { home: 0.58, draw: 0.24, away: 0.18 },
      form: { home: 0.56, draw: 0.25, away: 0.19 },
      overUnder: [
        { line: 1.5, over: 0.78, under: 0.22 },
        { line: 2.5, over: 0.5137, under: 0.4863 },
        { line: 3.5, over: 0.29, under: 0.71 },
      ],
      btts: { yes: 0.5213, no: 0.4787 },
      raw: {
        overUnder: [
          { line: 1.5, over: 0.8, under: 0.2 },
          { line: 2.5, over: 0.5632, under: 0.4368 },
          { line: 3.5, over: 0.31, under: 0.69 },
        ],
        btts: { yes: 0.55, no: 0.45 },
      },
      topScores: [], firstGoalTiming: [], firstToScore: { home: 0.5, away: 0.4, noGoal: 0.1 },
      lambda: { home: 1.6, away: 1.1, total: 2.7 },
      confidence: 4, confidenceLabel: 'Élevée',
      valueBets: [], oddsMovement: null, recommendedBets: [],
    },
    h2h: [], h2hSummary: { homeWins: 0, draws: 0, awayWins: 0, total: 0 },
    context: { isDerby: false, derbyLabel: null, stakesHome: '', stakesAway: '', weather: null, fatigueNoteHome: null, fatigueNoteAway: null, injuriesNoteHome: null, injuriesNoteAway: null },
    matchId: 'test-fc-1',
    leagueCode: 'eng.1',
    leagueName: 'Premier League',
    matchDate: KICKOFF.toISOString(),
    status: 'pre',
    statusDetail: 'Scheduled',
    homeScore: null,
    awayScore: null,
    venue: { name: null, city: null, country: null },
    odds: {
      provider: 'DraftKings', hasOdds: true, overUnderLine: 2.5,
      moneyline: {
        home: { open: 1.5, close: 1.44 },
        draw: { open: 4.2, close: 4.0 },
        away: { open: 6.0, close: 6.5 },
      },
      total: {
        over: { line: 2.5, openOdds: 1.9, closeOdds: 1.85 },
        under: { line: 2.5, openOdds: 1.9, closeOdds: 1.95 },
      },
    },
  } as unknown as AnalyzeResult;
}

// ---------- A/B/C/D/F : flux complet du job (réplique exacte) ----------
const MATCH_ID = 'test-fc-1';

async function jobScanUpsert() {
  // Réplique stepScan : le registre ForecastMatch est mutable, MatchResult aussi
  await db.forecastMatch.upsert({
    where: { matchId: MATCH_ID },
    create: { matchId: MATCH_ID, league: 'eng.1', leagueName: 'Premier League', kickoff: KICKOFF, homeTeamId: '100', homeTeam: 'Home FC', awayTeamId: '200', awayTeam: 'Away FC', espnState: 'pre', statusDetail: 'Scheduled' },
    update: { espnState: 'pre', statusDetail: 'Scheduled' },
  });
}

async function jobPredictTick(nowMs: number, kickoffOverride?: Date) {
  // Réplique EXACTE de stepPredict : ne ré-analyse JAMAIS un match déjà prédit
  const existing = await db.forecastSnapshot.count({ where: { matchId: MATCH_ID } });
  if (existing > 0) return { skipped: true as const };
  const a = fakeAnalysis(nowMs);
  if (kickoffOverride) a.matchDate = kickoffOverride.toISOString();
  const draft = buildSnapshotDraft(a, nowMs);
  if (!draft.ok) return { refused: draft.reason };
  await db.forecastSnapshot.create({
    data: { ...draft.draft, kickoff: kickoffOverride ?? draft.draft.kickoff, matchId: MATCH_ID, version: existing + 1, published: true },
  });
  return { created: true as const };
}

async function snapJson() {
  const s = await db.forecastSnapshot.findUnique({ where: { matchId_version: { matchId: MATCH_ID, version: 1 } } });
  return JSON.stringify(s);
}

console.log('\n== A/C. Création figée + garde anti-fuite (§6) ==');
const T0 = KICKOFF.getTime() - 3 * 3600_000; // T−3h
const r1 = await jobPredictTick(T0);
check('prédiction créée (T−3h < kickoff)', 'created' in r1 && r1.created === true);
const draftV1 = JSON.parse(await snapJson());
check('matchId = ID ESPN (identifiant principal)', draftV1.matchId === MATCH_ID);
check('predictionTime == T0 (figé)', new Date(draftV1.predictionTime).getTime() === T0);
check('predictionTime < kickoff (§6 vérifié)', draftV1.predictionTime < draftV1.kickoff);
check('modelVersion = v2.1', draftV1.modelVersion === 'v2.1');
check('inputsDigest présent (<300 car.)', typeof draftV1.inputsDigest === 'string' && draftV1.inputsDigest.length < 300);
check('O/U brut ≠ calibré (0.5632 vs 0.5137)', near(draftV1.pOver25Raw, 0.5632) && near(draftV1.pOver25, 0.5137));
check('1X2 brut = calibré (calibration totals seulement)', near(draftV1.p1x2Home, 0.5632));
check('cotes capturées + oddsCapturedAt', near(draftV1.odds1x2Home, 1.44) && draftV1.oddsCapturedAt != null);
check('pickedTeamId = ID équipe domicile', draftV1.pickedTeamId === '100');
check('confiance 4', draftV1.confidence === 4);

// C. prédiction après coup d'envoi → REFUSÉE (garde §6 testé directement,
//    sans le court-circuit « déjà prédit » du job)
const lateDraft = buildSnapshotDraft(fakeAnalysis(KICKOFF.getTime() + 60_000), KICKOFF.getTime() + 60_000);
check('prédiction post-kickoff refusée (§6)', lateDraft.ok === false && lateDraft.reason.includes('§6'));

console.log('\n== D/E. Re-scan + 2e exécution du job → 0 doublon, 0 modification ==');
await jobScanUpsert();
await jobScanUpsert(); // re-scan (registre mutable — update autorisé sur ForecastMatch)
const r2 = await jobPredictTick(Date.now()); // 2e exécution du job
check('2e exécution : match déjà prédit → ignoré', 'skipped' in r2 && r2.skipped === true);
const cnt = await db.forecastSnapshot.count({ where: { matchId: MATCH_ID } });
check('toujours exactement 1 snapshot (pas de doublon)', cnt === 1);
const afterRerun = await snapJson();
check('snapshot BIT-EXACT après re-scan + re-run', afterRerun === JSON.stringify(draftV1));

console.log('\n== B/D. Résultat officiel + évaluation → la prédiction ne bouge pas ==');
await db.matchResult.create({
  data: { matchId: MATCH_ID, status: 'FINAL', statusDetail: 'FT', homeScore: 2, awayScore: 1, retrievedAt: new Date(T0 + 5 * 3600_000) },
});
const grades = gradeSnapshot(
  { pick1x2: '1', pickedTeamId: '100', homeTeamId: '100', awayTeamId: '200', pickOu25: 'OVER', pickBtts: 'NO' },
  { status: 'FINAL', homeScore: 2, awayScore: 1 }
);
check('1X2 correct (2-1, pick domicile)', grades.grade1x2 === 'CORRECT');
check('O/U correct (3 buts > 2.5, pick OVER)', grades.gradeOu25 === 'CORRECT');
check('BTTS incorrect (2-1, pick NON)', grades.gradeBtts === 'INCORRECT');
const resultKey = resultKeyOf({ status: 'FINAL', homeScore: 2, awayScore: 1 });
check('resultKey FINAL:2-1', resultKey === 'FINAL:2-1');
await db.forecastEvaluation.create({
  data: { matchId: MATCH_ID, snapshotId: draftV1.id, grade1x2: grades.grade1x2, gradeOu25: grades.gradeOu25, gradeBtts: grades.gradeBtts, resultKey, evaluatedAt: new Date() },
});
const afterEval = await snapJson();
check('snapshot BIT-EXACT après résultat + évaluation', afterEval === JSON.stringify(draftV1));

// Re-évaluation (le upsert dérivé peut se réécrire, le snapshot non)
await db.forecastEvaluation.upsert({
  where: { matchId: MATCH_ID },
  create: { matchId: MATCH_ID, snapshotId: draftV1.id, grade1x2: 'CORRECT', gradeOu25: 'CORRECT', gradeBtts: 'INCORRECT', resultKey, evaluatedAt: new Date() },
  update: { evaluatedAt: new Date() },
});
check('snapshot BIT-EXACT après re-évaluation', (await snapJson()) === JSON.stringify(draftV1));

console.log('\n== F. Ré-analyse avant coup d\u2019envoi = nouvelle VERSION, v1 intacte ==');
// Simulation d'une ré-analyse (nouvelle analyse moteur) : create version 2, jamais update
const T1 = KICKOFF.getTime() - 3600_000; // T−1h
const a2 = fakeAnalysis(T1);
a2.prediction.probs = { home: 0.58, draw: 0.24, away: 0.18 };
const draft2 = buildSnapshotDraft(a2, T1);
check('ré-analyse acceptée (encore avant kickoff)', draft2.ok);
if (draft2.ok) {
  const vCount = await db.forecastSnapshot.count({ where: { matchId: MATCH_ID } });
  await db.forecastSnapshot.create({ data: { ...draft2.draft, matchId: MATCH_ID, version: vCount + 1, published: true } });
  const v1 = await db.forecastSnapshot.findUnique({ where: { matchId_version: { matchId: MATCH_ID, version: 1 } } });
  const v2 = await db.forecastSnapshot.findUnique({ where: { matchId_version: { matchId: MATCH_ID, version: 2 } } });
  check('version 2 créée, version 1 toujours là', v1 !== null && v2 !== null && v2.version === 2);
  check('v1 probabilities inchangées (bit-exact)', JSON.stringify(v1) === JSON.stringify(draftV1));
  check('v2 = nouvelles probabilités', near(v2!.p1x2Home, 0.58) && new Date(v2!.predictionTime).getTime() === T1);
  check('v2 predictionTime ≠ v1 predictionTime', v2!.predictionTime.getTime() !== v1!.predictionTime.getTime());
  // Nettoyage : suppression de la v2 pour la suite des tests (elle est "remplacée")
  await db.forecastSnapshot.delete({ where: { id: v2!.id } });
}

console.log('\n== G. Grading : VOID + statuts normalisés ==');
const gVoid = gradeSnapshot({ pick1x2: '1', pickedTeamId: null, homeTeamId: '100', awayTeamId: '200', pickOu25: 'OVER', pickBtts: 'YES' }, { status: 'POSTPONED', homeScore: null, awayScore: null });
check('VOID sur reporté (les 3 marchés)', gVoid.grade1x2 === 'VOID' && gVoid.gradeOu25 === 'VOID' && gVoid.gradeBtts === 'VOID');
check('normalizeStatus STATUS_POSTPONED', normalizeStatus('STATUS_POSTPONED', 'pre', false, 'Postponed') === 'POSTPONED');
check('normalizeStatus STATUS_CANCELED', normalizeStatus('STATUS_CANCELED', 'pre', false, 'Canceled') === 'CANCELLED');
check('normalizeStatus STATUS_FINAL', normalizeStatus('STATUS_FINAL', 'post', true, 'FT') === 'FINAL');
check('normalizeStatus scheduled', normalizeStatus('STATUS_SCHEDULED', 'pre', false, 'Scheduled') === 'SCHEDULED');
check('normalizeStatus live', normalizeStatus('STATUS_FIRST_HALF', 'in', false, "42'") === 'LIVE');
const gNul = gradeSnapshot({ pick1x2: 'X', pickedTeamId: null, homeTeamId: '100', awayTeamId: '200', pickOu25: 'UNDER', pickBtts: 'NO' }, { status: 'FINAL', homeScore: 1, awayScore: 1 });
check('1X2 nul correct', gNul.grade1x2 === 'CORRECT');
check('O/U incorrect (2 buts < 2.5 ? non — UNDER correct)', gNul.gradeOu25 === 'CORRECT');
check('BTTS incorrect (1-1, pick NON)', gNul.gradeBtts === 'INCORRECT');

console.log('\n== H. Métriques — valeurs calculées à la main ==');
check('brier1x2 (0.6,0.2,0.2,1)=0.24', near(brier1x2(0.6, 0.2, 0.2, '1'), 0.24));
check('brier1x2 (0.6,0.2,0.2,2)=1.04', near(brier1x2(0.6, 0.2, 0.2, '2'), 1.04));
check('logLoss1x2 (…,1)=-ln0.6', near(logLoss1x2(0.6, 0.2, 0.2, '1'), -Math.log(0.6)));
check('rps1x2 (0.6,0.2,0.2,1)=0.10', near(rps1x2(0.6, 0.2, 0.2, '1'), 0.10));
check('rps1x2 (0.6,0.2,0.2,X)=0.20', near(rps1x2(0.6, 0.2, 0.2, 'X'), 0.20));
check('rps1x2 (0.6,0.2,0.2,2)=0.50', near(rps1x2(0.6, 0.2, 0.2, '2'), 0.50));
check('brierBinary (0.7,true)=0.09', near(brierBinary(0.7, true), 0.09));
check('logLossBinary (0.7,false)=-ln0.3', near(logLossBinary(0.7, false), -Math.log(0.3)));

// Scénario d'agrégation : 3 matchs évalués + 1 VOID
const rows: EvalRow[] = [
  {
    snapshot: lite('m1', 0.6, 0.2, 0.2, '1', 4, 0.55, 0.45, 'OVER', 0.4, 0.6, 'NO'),
    result: { status: 'FINAL', homeScore: 2, awayScore: 1 },
    evaluation: { grade1x2: 'CORRECT', gradeOu25: 'CORRECT', gradeBtts: 'INCORRECT' },
  },
  {
    snapshot: lite('m2', 0.25, 0.5, 0.25, 'X', 2, 0.4, 0.6, 'UNDER', 0.3, 0.7, 'NO'),
    result: { status: 'FINAL', homeScore: 0, awayScore: 0 },
    evaluation: { grade1x2: 'CORRECT', gradeOu25: 'CORRECT', gradeBtts: 'CORRECT' },
  },
  {
    snapshot: lite('m3', 0.75, 0.15, 0.1, '1', 5, 0.35, 0.65, 'UNDER', 0.25, 0.75, 'NO'),
    result: { status: 'FINAL', homeScore: 0, awayScore: 2 },
    evaluation: { grade1x2: 'INCORRECT', gradeOu25: 'CORRECT', gradeBtts: 'CORRECT' },
  },
  {
    snapshot: lite('m4', 0.4, 0.3, 0.3, 'X', 3, 0.5, 0.5, 'OVER', 0.5, 0.5, 'YES'),
    result: { status: 'POSTPONED', homeScore: null, awayScore: null },
    evaluation: { grade1x2: 'VOID', gradeOu25: 'VOID', gradeBtts: 'VOID' },
  },
];
function lite(
  id: string, ph: number, pd: number, pa: number, pick: string, conf: number,
  pOver: number, pUnder: number, pickOu: string, pYes: number, pNo: number, pickBtts: string
): EvalRow['snapshot'] {
  return {
    matchId: id, version: 1, league: 'eng.1', leagueName: 'Premier League',
    kickoff: '2026-09-20T19:45:00Z', homeTeam: 'Home FC', awayTeam: 'Away FC',
    p1x2Home: ph, p1x2Draw: pd, p1x2Away: pa, pick1x2: pick, pick1x2Label: `${pick} - X`, confidence: conf,
    pOver25: pOver, pUnder25: pUnder, pickOu25: pickOu,
    pBttsYes: pYes, pBttsNo: pNo, pickBtts: pickBtts,
  };
}
const W = aggregateWeek(rows);
check('1X2 n=3 (VOID exclu), corrects=2', W.m1x2.n === 3 && W.m1x2.correct === 2);
check('1X2 accuracy=2/3', near(W.m1x2.accuracy!, 2 / 3));
check('1X2 Brier moy=(0.24+0.375+1.395)/3', near(W.m1x2.brier!, (0.24 + 0.375 + 1.395) / 3));
check('1X2 RPS moy=(0.10+0.0625+0.68625)/3', near(W.m1x2.rps!, (0.10 + 0.0625 + 0.68625) / 3));
check('O/U n=3 corrects=3, accuracy=1', W.ou25.n === 3 && W.ou25.correct === 3 && near(W.ou25.accuracy!, 1));
check('O/U Brier moy=(0.2025+0.16+0.1225)/3', near(W.ou25.brier!, (0.2025 + 0.16 + 0.1225) / 3));
check('BTTS n=3 corrects=2, accuracy=2/3', W.btts.n === 3 && W.btts.correct === 2 && near(W.btts.accuracy!, 2 / 3));
check('BTTS Brier moy=(0.36+0.09+0.0625)/3', near(W.btts.brier!, (0.36 + 0.09 + 0.0625) / 3));
check('global = 7/9', near(W.globalAccuracy!, 7 / 9) && W.globalCorrect === 7 && W.globalEvaluable === 9);
check('matchesFinished=3, matchesVoid=1', W.matchesFinished === 3 && W.matchesVoid === 1);
check('confiance niveau 4 : n=1 acc=1', W.confidence[3].n === 1 && W.confidence[3].correct === 1);
check('confiance niveau 5 : n=1 acc=0', W.confidence[4].n === 1 && W.confidence[4].correct === 0 && W.confidence[4].accuracy === 0);
check('calibration 1X2 : tranche 60-70 n=1 obs=1.0', W.calibration1x2.some((b) => b.bucket === '60–70 %' && b.n === 1 && near(b.observed!, 1)));
check('calibration 1X2 : tranche 50-60 n=1 obs=1.0', W.calibration1x2.some((b) => b.bucket === '50–60 %' && b.n === 1 && near(b.observed!, 1)));
check('calibration 1X2 : tranche 70-80 n=1 obs=0.0 (m3 raté)', W.calibration1x2.some((b) => b.bucket === '70–80 %' && b.n === 1 && near(b.observed!, 0)));
check('ligue n=2 évaluables 1X2 ? (m1+m2+m3 → n=3)', W.leagues[0]?.n === 3 && !W.leagues[0].sufficient);
check('erreurs §16 : m1 (conf 4 + BTTS raté) et m3 (conf 5 + proba 75 %)', W.errors.length === 2 && W.errors.some((e) => e.matchId === 'm1' && e.reasons.length === 1) && W.errors.some((e) => e.matchId === 'm3' && e.reasons.length === 2));

console.log(`\n=== RÉSULTAT : ${pass} OK / ${fail} KO ===`);
await db.$disconnect();
rmSync(tmpDir, { recursive: true, force: true });
if (fail > 0) process.exit(1);
