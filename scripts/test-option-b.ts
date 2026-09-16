// ============================================================
// Option B — Tests : service des cartes accueil depuis les
// ForecastSnapshot publiés (ZÉRO ESPN / ZÉRO moteur), fallback
// analyzeMatch si snapshot absent, persistance Prediction figée.
//
// 1) UNITAIRES (0 réseau, 0 DB) : computeValueBetsCount (mire
//    buildValueBets prediction.ts:502-539), confidenceLabelOf
//    (prediction.ts:796), mapping QuickPred, buildFrozenPicks
//    (mire extractPicks analyze.ts:272-341).
// 2) INTÉGRATION (SQLite temporaire — JAMAIS la db de prod) : la
//    VRAIE route POST /api/predictions est appelée sur un lot mixte
//    (snapshots valides / absents / non publiés / mauvaise version /
//    kickoff passé) → ordre préservé, sources exactes, persistance
//    figée colonne par colonne, idempotence re-POST, ANTI-ESPN
//    (espion fetch : 0 appel sortant sur lot 100 % couvert),
//    échec DB lecture snapshot → tout le lot en chemin moteur.
// 3) VALIDATION CROISÉE données RÉELLES (GET lecture seule
//    voltrixbet.vercel.app — zéro secret, aucun POST/tick) :
//    computeValueBetsCount reproduit la formule sur les snapshots
//    publiés de la semaine (audit Task 39 : cartes sans cotes
//    figées → 0).
// Exécuter : bun scripts/test-option-b.ts
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
const ROOT = path.resolve(import.meta.dir, '..');
const tmpDir = mkdtempSync(path.join(tmpdir(), 'voltrix-option-b-'));
// Binaires PG 17 Debian extraits localement (.tmp-pg/pg17 — NEVER la db de
// prod : cluster éphémère sur un port dérivé du PID, datadir dans tmpdir).
const PG_PORT = 5433 + (process.pid % 50);
const PGBIN = path.join(ROOT, '.tmp-pg', 'pg17', 'usr', 'lib', 'postgresql', '17', 'bin');
const dataDir = path.join(tmpDir, 'pgdata');
const dbUrl = `postgresql://postgres@127.0.0.1:${PG_PORT}/postgres`;
// L'env process GAGNE sur .env → la db de prod n'est jamais touchée.
// Défini AVANT tout import dynamique de @/lib/db (singleton du module).
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
execSync('bunx prisma db push --skip-generate', {
  cwd: ROOT,
  env: { ...process.env, DATABASE_URL: dbUrl, DIRECT_URL: dbUrl },
  stdio: 'pipe',
});

const { PrismaClient } = await import('@prisma/client');
const db = new PrismaClient({ datasources: { db: { url: dbUrl } } });
const { MODEL_VERSION } = await import('../src/lib/model-version');
const {
  computeValueBetsCount,
  confidenceLabelOf,
  buildQuickPredFromSnapshot,
  buildFrozenPicks,
  startFetchCapture,
  endFetchCapture,
} = await import('../src/lib/forecast/snapshot-serve');
const { db: routeDb } = await import('../src/lib/db');
const routeModule = await import('../src/app/api/predictions/route');

const NOW = Date.now();

// ---------- Fabrique ForecastSnapshot (fixtures unitaires) ----------
type SnapOverrides = Partial<Record<string, unknown>> & { matchId: string; kickoff?: Date };
function mkSnap(o: SnapOverrides): any {
  return {
    id: 'id-' + o.matchId,
    matchId: o.matchId,
    version: 1,
    league: 'test.1',
    leagueName: 'Test League',
    kickoff: o.kickoff ?? new Date(NOW + 2 * 3600_000),
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
    predictionTime: new Date(NOW - 7200_000),
    modelVersion: MODEL_VERSION,
    inputsDigest: '{"odds":1,"ou":2.5,"h":[19,19],"a":[19,19],"inj":[0,1],"st":2}',
    odds1x2Home: 2.1,
    odds1x2Draw: 3.2,
    odds1x2Away: 3.8,
    oddsOver25: 1.99,
    oddsUnder25: 1.85,
    oddsBttsYes: null,
    oddsBttsNo: null,
    oddsCapturedAt: new Date(NOW - 7200_000),
    ouMarketLine: 2.5,
    published: true,
    frozenAt: new Date(NOW - 3600_000),
    createdAt: new Date(NOW - 3600_000),
    ...o,
  };
}

// Fixture unitaire par défaut (arité value bets vérifiée en float JS) :
//   home  0.5×2.10−1 =  0.05   → INCLUS
//   draw  0.3×3.20−1 = −0.04   → exclu
//   away  0.2×3.80−1 = −0.24   → exclu
//   O/U over BRUT 0.58×1.99−1 = 0.1542 → INCLUS (le calibré 0.51×1.99−1 =
//   0.0149 serait exclu → la jambe prouve que le BRUT est utilisé)
//   O/U under BRUT 0.42×1.85−1 = −0.223 → exclu
//   → valueBetsCount = 2.

// ============================================================
// 1. UNITAIRES — computeValueBetsCount (mire buildValueBets)
// ============================================================
section('1. computeValueBetsCount — mire exacte de buildValueBets (prediction.ts:502-539)');

// Fixture par défaut : 1X2 home edge = 0.5×2.10−1 = 0.05 ✓ ; draw 0.3×3.20−1 < 0 ✗ ;
// away 0.2×3.80−1 < 0 ✗ ; O/U ligne 2.5 en BRUT : 0.58×1.99−1 = 0.1542 ✓ (le
// CALIBRÉ 0.51×1.99−1 = 0.0149 serait exclu → preuve que le brut est utilisé) ;
// under 0.42×1.85−1 < 0 ✗. Total = 2.
check('cas nominal : 2 jambes (1X2 home + O/U over en BRUT)', computeValueBetsCount(mkSnap({ matchId: 'u1' }), null) === 2);
check('cas nominal : la jambe O/U utilise pOver25Raw (0.58) et non le calibré (0.51)', (() => {
  // Si le calibré était utilisé : 0.51×1.99−1 = 0.0149 ≤ 0.02 → 0 jambe O/U → count 1.
  return computeValueBetsCount(mkSnap({ matchId: 'u1b' }), null) === 2;
})());
check('toutes cotes null → 0', computeValueBetsCount(mkSnap({ matchId: 'u2', odds1x2Home: null, odds1x2Draw: null, odds1x2Away: null, oddsOver25: null, oddsUnder25: null }), null) === 0);
check('cote ≤ 1.01 → jambe ignorée', computeValueBetsCount(mkSnap({ matchId: 'u3', odds1x2Home: 1.01 }), null) === 1); // reste O/U over
check('edge 0.01 → exclu (strict > 0.02)', (() => {
  const s = mkSnap({ matchId: 'u4', p1x2Draw: 0.2, odds1x2Draw: 5.05, odds1x2Home: null, odds1x2Away: null, oddsOver25: null, oddsUnder25: null, ouMarketLine: null });
  return computeValueBetsCount(s, null) === 0;
})());
check('parité arithmétique JS du moteur : 0.3×3.4−1 = 0.0200…018 → INCLUS', (() => {
  // buildValueBets (prediction.ts:514-515) calcule edge = p×dec−1 en JS : avec
  // p=0.3/dec=3.4 l'edge vaut 0.020000000000000018 > 0.02 → la jambe est
  // INCLUSE par le moteur. La réplique doit produire EXACTEMENT pareil.
  const s = mkSnap({ matchId: 'u5', p1x2Draw: 0.3, odds1x2Draw: 3.4, odds1x2Home: null, odds1x2Away: null, oddsOver25: null, oddsUnder25: null, ouMarketLine: null });
  return computeValueBetsCount(s, null) === 1;
})());
check('tri desc + plafond 4 (5 jambes éligibles → 4)', (() => {
  const s = mkSnap({
    matchId: 'u6',
    p1x2Home: 0.55, odds1x2Home: 2.0, // 0.10
    p1x2Draw: 0.35, odds1x2Draw: 3.2, // 0.12
    p1x2Away: 0.15, odds1x2Away: 8.0, // 0.20
    pOver25Raw: 0.5, oddsOver25: 2.2, // 0.10
    pUnder25Raw: 0.5, oddsUnder25: 2.2, // 0.10
  });
  return computeValueBetsCount(s, null) === 4;
})());
check('BTTS JAMAIS compté (mire buildValueBets) malgré oddsBtts énormes', (() => {
  const s = mkSnap({ matchId: 'u7', odds1x2Home: null, odds1x2Draw: null, odds1x2Away: null, oddsOver25: null, oddsUnder25: null, oddsBttsYes: 10, oddsBttsNo: 10 });
  return computeValueBetsCount(s, null) === 0;
})());
check('ouMarketLine = 3.5 + PredictionSnapshot présent → issues O/U 3.5 (brutes)', (() => {
  const s = mkSnap({ matchId: 'u8', ouMarketLine: 3.5, pOver25Raw: 0.2, pUnder25Raw: 0.1 });
  const pSnap: any = {
    matchId: 'u8',
    version: 1,
    markets: [
      {
        marketKey: 'OVER_UNDER',
        line: 3.5,
        outcomes: [
          { outcomeKey: 'OVER', probability: 0.3, rawProbability: 0.35 },
          { outcomeKey: 'UNDER', probability: 0.7, rawProbability: 0.75 },
        ],
      },
    ],
  };
  // under brut 0.75×1.85−1 = 0.3875 ✓ → 1 (+ home 1X2) = 2 (draw 3.2 → exclu).
  return computeValueBetsCount(s, pSnap) === 2;
})());
check('ouMarketLine = 3.5 SANS PredictionSnapshot → seules les jambes 1X2 (plan §5 cas dégradé)', (() => {
  const s = mkSnap({ matchId: 'u9', ouMarketLine: 3.5 });
  return computeValueBetsCount(s, null) === 1; // home 1X2 seulement
})());
check('ouMarketLine null → aucune jambe O/U', (() => {
  const s = mkSnap({ matchId: 'u10', ouMarketLine: null });
  return computeValueBetsCount(s, null) === 1; // home 1X2 seulement
})());

// ============================================================
// 2. UNITAIRES — confidenceLabelOf (mire prediction.ts:796-797)
// ============================================================
section('2. confidenceLabelOf — mire des libellés moteur');
check('1 → Très faible', confidenceLabelOf(1) === 'Très faible');
check('2 → Faible', confidenceLabelOf(2) === 'Faible');
check('3 → Moyen', confidenceLabelOf(3) === 'Moyen');
check('4 → Bon', confidenceLabelOf(4) === 'Bon');
check('5 → Élevé', confidenceLabelOf(5) === 'Élevé');
check('hors bornes clampées (0 → Très faible, 9 → Élevé)', confidenceLabelOf(0) === 'Très faible' && confidenceLabelOf(9) === 'Élevé');

// ============================================================
// 3. UNITAIRES — mapping QuickPred + picks figés
// ============================================================
section('3. buildQuickPredFromSnapshot / buildFrozenPicks — mire mapping');

check("pick 1X2 = 'Victoire Home FC' (mire recommendedBets prediction.ts:843)", (() => {
  const qp = buildQuickPredFromSnapshot('m', { snap: mkSnap({ matchId: 'm1' }), pSnap: null }, NOW);
  return qp.recommendedBets[0].pick === 'Victoire Home FC' && qp.recommendedBets[0].prob === 0.5;
})());
check("pick 1X2 = 'Victoire Away FC' quand pick1x2='2'", (() => {
  const qp = buildQuickPredFromSnapshot('m', { snap: mkSnap({ matchId: 'm2', pick1x2: '2', pick1x2Label: '2 - Away FC' }), pSnap: null }, NOW);
  return qp.recommendedBets[0].pick === 'Victoire Away FC' && qp.recommendedBets[0].prob === 0.2;
})());
check("pick 1X2 = 'Match nul' quand pick1x2='X'", (() => {
  const qp = buildQuickPredFromSnapshot('m', { snap: mkSnap({ matchId: 'm3', pick1x2: 'X', pick1x2Label: 'X - Nul' }), pSnap: null }, NOW);
  return qp.recommendedBets[0].pick === 'Match nul' && qp.recommendedBets[0].prob === 0.3;
})());
check('note 1X2 reconstruite à l’identique (confiance N/5)', (() => {
  const qp = buildQuickPredFromSnapshot('m', { snap: mkSnap({ matchId: 'm4', confidence: 3 }), pSnap: null }, NOW);
  return qp.recommendedBets[0].note === 'Meilleur choix du modèle (confiance 3/5)';
})());
check('probs = p1x2* figées, confidence + label cohérents', (() => {
  const qp = buildQuickPredFromSnapshot('m', { snap: mkSnap({ matchId: 'm5' }), pSnap: null }, NOW);
  return qp.probs.home === 0.5 && qp.probs.draw === 0.3 && qp.probs.away === 0.2 && qp.confidence === 4 && qp.confidenceLabel === 'Bon';
})());
check('overUnder COMPLET (1.5/2.5/3.5) depuis PredictionSnapshot, trié, CALIBRÉ', (() => {
  const pSnap: any = {
    matchId: 'm6',
    version: 1,
    markets: [3.5, 1.5, 2.5].map((line) => ({
      marketKey: 'OVER_UNDER',
      line,
      outcomes: [
        { outcomeKey: 'OVER', probability: 0.3 + (3.5 - line) * 0.2, rawProbability: 0.35, pick: false },
        { outcomeKey: 'UNDER', probability: 0.7 - (3.5 - line) * 0.2, rawProbability: 0.65, pick: false },
      ],
    })),
  };
  const qp = buildQuickPredFromSnapshot('m', { snap: mkSnap({ matchId: 'm6' }), pSnap }, NOW);
  const lines = qp.overUnder.map((o) => o.line);
  const ou25 = qp.overUnder.find((o) => o.line === 2.5)!;
  return lines.length === 3 && lines[0] === 1.5 && lines[1] === 2.5 && lines[2] === 3.5 && ou25.over === 0.5 && ou25.under === 0.5;
})());
check('sans PredictionSnapshot → overUnder = ligne 2.5 seule (champs ForecastSnapshot)', (() => {
  const qp = buildQuickPredFromSnapshot('m', { snap: mkSnap({ matchId: 'm7' }), pSnap: null }, NOW);
  return qp.overUnder.length === 1 && qp.overUnder[0].line === 2.5 && qp.overUnder[0].over === 0.51 && qp.overUnder[0].under === 0.49;
})());
check('ouOdds = cotes figées {line, over, under} ; null si aucune cote', (() => {
  const qp1 = buildQuickPredFromSnapshot('m', { snap: mkSnap({ matchId: 'm8' }), pSnap: null }, NOW);
  const qp2 = buildQuickPredFromSnapshot('m', { snap: mkSnap({ matchId: 'm9', oddsOver25: null, oddsUnder25: null, odds1x2Home: null, odds1x2Draw: null, odds1x2Away: null, ouMarketLine: null }), pSnap: null }, NOW);
  return qp1.ouOdds?.line === 2.5 && qp1.ouOdds?.over === 1.99 && qp1.ouOdds?.under === 1.85 && qp2.ouOdds === null;
})());
check('btts = pBttsYes/No figées ; topScores = [] ; lambda ABSENT (optionnel types.ts)', (() => {
  const qp = buildQuickPredFromSnapshot('m', { snap: mkSnap({ matchId: 'm10' }), pSnap: null }, NOW);
  return qp.btts.yes === 0.6 && qp.btts.no === 0.4 && Array.isArray(qp.topScores) && qp.topScores.length === 0 && !('lambda' in qp);
})());
check("statut temporel : futur → 'pre', passé de 4 h → 'post'", (() => {
  const qp1 = buildQuickPredFromSnapshot('m', { snap: mkSnap({ matchId: 'm11' }), pSnap: null }, NOW);
  const qp2 = buildQuickPredFromSnapshot('m', { snap: mkSnap({ matchId: 'm12', kickoff: new Date(NOW - 4 * 3600_000) }), pSnap: null }, NOW);
  return qp1.status === 'pre' && qp2.status === 'post';
})());
check('valueBetsCount présent dans le QuickPred (2 sur la fixture)', (() => {
  const qp = buildQuickPredFromSnapshot('m', { snap: mkSnap({ matchId: 'm13' }), pSnap: null }, NOW);
  return qp.valueBetsCount === 2;
})());

check('buildFrozenPicks : 3 picks (1X2, O/U 2.5, BTTS) mire extractPicks', (() => {
  const picks = buildFrozenPicks(mkSnap({ matchId: 'f1' }));
  const [p1, p2, p3] = picks;
  return (
    picks.length === 3 &&
    p1.market === '1X2' && p1.pick === '1 - Home FC' && p1.probability === 0.5 && p1.rawProbability === 0.5 &&
    p1.odds === 2.1 && p1.pickedTeamId === 'h1' && p1.confidence === 4 &&
    p2.market === 'O/U 2.5' && p2.pick === 'Plus de 2.5' && p2.probability === 0.51 && p2.rawProbability === 0.58 &&
    p2.odds === 1.99 && p2.pickedTeamId === null &&
    p3.market === 'BTTS' && p3.pick === 'Oui' && p3.probability === 0.6 && p3.rawProbability === 0.62 &&
    p3.odds === null && p3.pickedTeamId === null
  );
})());
check('buildFrozenPicks : UNDER → Moins de 2.5 + cote under ; BTTS Non ; digest figé partagé', (() => {
  const snap = mkSnap({ matchId: 'f2', pickOu25: 'UNDER', pickBtts: 'NO' });
  const [p2, p3] = buildFrozenPicks(snap).slice(1);
  return p2.pick === 'Moins de 2.5' && p2.odds === 1.85 && p3.pick === 'Non' && p2.inputsDigest === snap.inputsDigest && p3.inputsDigest === snap.inputsDigest;
})());

// ============================================================
// 4. INTÉGRATION — la VRAIE route POST /api/predictions (SQLite temp)
// ============================================================
section('4. Intégration route — lot mixte (snapshot + fallback)');

const KICK_FUTURE = new Date(NOW + 2 * 3600_000);
const KICK_PAST = new Date(NOW - 4 * 3600_000);

// Fixtures DB : M1 complet (+ PredictionSnapshot), M2 sans, M3 aucun,
// M4 non publié, M5 mauvaise version, M6 publié mais kickoff passé.
const MATCHES = {
  m1: 'ob-snap-full',
  m2: 'ob-snap-nops',
  m3: 'ob-no-snap',
  m4: 'ob-unpublished',
  m5: 'ob-wrong-version',
  m6: 'ob-snap-past',
};

async function seedSnapshot(matchId: string, kickoff: Date, published: boolean, modelVersion: string) {
  await db.forecastSnapshot.create({
    data: {
      matchId,
      version: 1,
      league: 'test.1',
      leagueName: 'Test League',
      kickoff,
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
      predictionTime: new Date(NOW - 7200_000),
      modelVersion,
      inputsDigest: '{"odds":1,"ou":2.5,"h":[19,19],"a":[19,19],"inj":[0,1],"st":2}',
      odds1x2Home: 2.1,
      odds1x2Draw: 3.2,
      odds1x2Away: 3.8,
      oddsOver25: 1.99,
      oddsUnder25: 1.85,
      oddsBttsYes: null,
      oddsBttsNo: null,
      oddsCapturedAt: new Date(NOW - 7200_000),
      ouMarketLine: 2.5,
      published,
      frozenAt: new Date(NOW - 3600_000),
    },
  });
}

// M1 + M2 + M6 : snapshot valide ; M4 : non publié ; M5 : modelVersion étrangère.
await seedSnapshot(MATCHES.m1, KICK_FUTURE, true, MODEL_VERSION);
await seedSnapshot(MATCHES.m2, KICK_FUTURE, true, MODEL_VERSION);
await seedSnapshot(MATCHES.m6, KICK_PAST, true, MODEL_VERSION);
await seedSnapshot(MATCHES.m4, KICK_FUTURE, false, MODEL_VERSION);
await seedSnapshot(MATCHES.m5, KICK_FUTURE, true, 'v0.9-étrangère');

// PredictionSnapshot de M1 : lignes O/U 1.5/2.5/3.5 (calibrées + brutes).
{
  const ps = await db.predictionSnapshot.create({
    data: {
      matchId: MATCHES.m1,
      version: 1,
      competitionId: 'test.1',
      competition: 'Test League',
      kickoffAt: KICK_FUTURE,
      homeTeamId: 'h1',
      homeTeamName: 'Home FC',
      awayTeamId: 'a1',
      awayTeamName: 'Away FC',
      predictionTime: new Date(NOW - 7200_000),
      modelVersion: MODEL_VERSION,
      inputsDigest: '{"odds":1,"ou":2.5,"h":[19,19],"a":[19,19],"inj":[0,1],"st":2}',
      confidence: 4,
      source: 'VOLTRIX',
      frozenAt: new Date(NOW - 3600_000),
    },
  });
  const ouByLine: Record<number, [number, number, number, number]> = {
    1.5: [0.8, 0.2, 0.82, 0.18],
    2.5: [0.51, 0.49, 0.58, 0.42],
    3.5: [0.3, 0.7, 0.35, 0.65],
  };
  for (const [line, [o, u, ro, ru]] of Object.entries(ouByLine)) {
    const m = await db.predictionMarket.create({
      data: { snapshotId: ps.id, marketKey: 'OVER_UNDER', line: Number(line) },
    });
    await db.predictionOutcome.createMany({
      data: [
        { marketId: m.id, outcomeKey: 'OVER', label: `Plus de ${line}`, probability: o, rawProbability: ro, pick: o >= u },
        { marketId: m.id, outcomeKey: 'UNDER', label: `Moins de ${line}`, probability: u, rawProbability: ru, pick: u > o },
      ],
    });
  }
}

type ReqMatch = { matchId: string; leagueCode: string; date: string };
const iso = (d: Date) => d.toISOString();
const batchRequest = (matches: ReqMatch[], ip: string) =>
  routeModule.POST(
    new (globalThis as any).Request('http://localhost/api/predictions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
      body: JSON.stringify({ matches }),
    })
  ) as Promise<Response>;

// Lot mixte dans un ordre précis (M3/M4/M5 en leagueCode ESPN inexistant →
// analyzeMatch échoue DÉTERMINISTEMENT quel que soit l'état du réseau).
const MIXED: ReqMatch[] = [
  { matchId: MATCHES.m1, leagueCode: 'test.1', date: iso(KICK_FUTURE) },
  { matchId: MATCHES.m3, leagueCode: 'test.1', date: iso(KICK_FUTURE) },
  { matchId: MATCHES.m2, leagueCode: 'test.1', date: iso(KICK_FUTURE) },
  { matchId: MATCHES.m4, leagueCode: 'test.1', date: iso(KICK_FUTURE) },
  { matchId: MATCHES.m5, leagueCode: 'test.1', date: iso(KICK_FUTURE) },
  { matchId: MATCHES.m6, leagueCode: 'test.1', date: iso(KICK_PAST) },
];

const resMixed = await batchRequest(MIXED, '10.1.0.1');
check('HTTP 200 sur lot mixte', resMixed.status === 200, `status=${resMixed.status}`);
const jsonMixed: any = await resMixed.json();
const results: any[] = jsonMixed.results ?? [];
const metaMixed = jsonMixed.meta;

check('6 résultats, ORDRE de la demande préservé (fallback ESPN-indisponible → null aux positions attendues)', results.length === 6 && results[0]?.matchId === MATCHES.m1 && results[1] === null && results[2]?.matchId === MATCHES.m2 && results[3] === null && results[4] === null && results[5]?.matchId === MATCHES.m6);
check('meta.source = mixed (3 snapshot + fallback/failed)', metaMixed?.source === 'mixed');
check('meta.counts : 3 snapshot servis depuis Neon', metaMixed?.counts?.snapshot === 3);
check('meta.perMatch : m1/m2/m6 = snapshot ; m3/m4/m5 JAMAIS snapshot', metaMixed?.perMatch?.[MATCHES.m1] === 'snapshot' && metaMixed?.perMatch?.[MATCHES.m2] === 'snapshot' && metaMixed?.perMatch?.[MATCHES.m6] === 'snapshot' && metaMixed?.perMatch?.[MATCHES.m3] !== 'snapshot' && metaMixed?.perMatch?.[MATCHES.m4] !== 'snapshot' && metaMixed?.perMatch?.[MATCHES.m5] !== 'snapshot');
check('snapshotLookupOk = true', metaMixed?.snapshotLookupOk === true);
check('M4 non publié → PAS servi snapshot (fallback/failed)', results[3] === null && (metaMixed.perMatch[MATCHES.m4] === 'fallback' || metaMixed.perMatch[MATCHES.m4] === 'failed'));
check('M5 mauvaise version → PAS servi snapshot (sécurité future)', results[4] === null && metaMixed.perMatch[MATCHES.m5] !== 'snapshot');
check('M1 : overUnder 1.5/2.5/3.5 depuis PredictionSnapshot (calibrés)', (() => {
  const ou = results[0]?.overUnder ?? [];
  return ou.length === 3 && ou.find((x: any) => x.line === 2.5)?.over === 0.51 && ou.find((x: any) => x.line === 1.5)?.over === 0.8 && ou.find((x: any) => x.line === 3.5)?.under === 0.7;
})());
check('M2 (sans PredictionSnapshot) : overUnder 2.5 seul depuis ForecastSnapshot', (() => {
  const ou = results[2]?.overUnder ?? [];
  return ou.length === 1 && ou[0].line === 2.5 && ou[0].over === 0.51;
})());
check('M6 (kickoff passé) : snapshot QUAND MÊME servi (prono figé pré-match)', results[5] !== null && results[5].matchId === MATCHES.m6);
check('M1 : valueBetsCount = 2 (home 1X2 + over BRUT — mire buildValueBets)', results[0]?.valueBetsCount === 2);
check('M1 : shape QuickPred (lambda absent, topScores [])', results[0] && !('lambda' in results[0]) && Array.isArray(results[0].topScores) && results[0].topScores.length === 0);
check('M1 : probs/recommendedBets[0] identiques au chemin moteur attendu', results[0]?.probs?.home === 0.5 && results[0]?.recommendedBets?.[0]?.pick === 'Victoire Home FC' && results[0]?.recommendedBets?.[0]?.prob === 0.5);
check('CONTRASTE : le fallback (M3/M4/M5, cache scoreboard froid) A appelé ESPN', (metaMixed?.espnCalls ?? 0) > 0, `espnCalls=${metaMixed?.espnCalls}`);

// ---------- Persistance figée (continuité /api/performance) ----------
section('5. Persistance Prediction figée (valeurs du snapshot, idempotente)');

const rowsAfterMixed = await db.prediction.findMany({ orderBy: [{ matchId: 'asc' }, { market: 'asc' }] });
check('6 lignes créées : 3 picks × M1 et M2 uniquement (M6 passé → 0 ; fallback échoués → 0)', rowsAfterMixed.length === 6 && rowsAfterMixed.filter((r) => r.matchId === MATCHES.m1).length === 3 && rowsAfterMixed.filter((r) => r.matchId === MATCHES.m2).length === 3);
const m1x2 = rowsAfterMixed.find((r) => r.matchId === MATCHES.m1 && r.market === '1X2');
const mou = rowsAfterMixed.find((r) => r.matchId === MATCHES.m1 && r.market === 'O/U 2.5');
const mbtts = rowsAfterMixed.find((r) => r.matchId === MATCHES.m1 && r.market === 'BTTS');
check('1X2 figé : pick/proba/brut/cote/pickedTeamId identiques au snapshot', !!m1x2 && m1x2.pick === '1 - Home FC' && m1x2.probability === 0.5 && m1x2.rawProbability === 0.5 && m1x2.odds === 2.1 && m1x2.pickedTeamId === 'h1');
check('1X2 figé : predictionTime + oddsCapturedAt = ceux du snapshot (PAS maintenant)', !!m1x2 && m1x2.predictionTime?.getTime() === NOW - 7200_000 && m1x2.oddsCapturedAt?.getTime() === NOW - 7200_000);
check('1X2 figé : modelVersion/inputsDigest/confidence/league/matchDate du snapshot', !!m1x2 && m1x2.modelVersion === MODEL_VERSION && m1x2.inputsDigest?.startsWith('{"odds":1') && m1x2.confidence === 4 && m1x2.league === 'test.1' && m1x2.leagueName === 'Test League' && m1x2.matchDate.getTime() === KICK_FUTURE.getTime() && m1x2.homeTeam === 'Home FC' && m1x2.awayTeam === 'Away FC');
check('O/U 2.5 figé : pick calibré 0.51 + BRUT 0.58 + cote du côté piqué', !!mou && mou.pick === 'Plus de 2.5' && mou.probability === 0.51 && mou.rawProbability === 0.58 && mou.odds === 1.99);
check('BTTS figé : Oui 0.6 / brut 0.62 / odds null (mire extractPicks)', !!mbtts && mbtts.pick === 'Oui' && mbtts.probability === 0.6 && mbtts.rawProbability === 0.62 && mbtts.odds === null);
check('resolved = false (en attente de résolution /api/performance normale)', rowsAfterMixed.every((r) => r.resolved === false && r.result === null));

// ---------- ANTI-ESPN : lot 100 % couvert → 0 appel réseau ----------
section('6. ANTI-ESPN : lot 100 % couvert → 0 ESPN, 0 moteur, 0 réseau');

let spyCalls = 0;
const origFetch = globalThis.fetch;
globalThis.fetch = ((input: any, init?: any) => {
  spyCalls++;
  return origFetch.call(globalThis, input, init);
}) as typeof fetch;

const COVERED: ReqMatch[] = [
  { matchId: MATCHES.m1, leagueCode: 'test.1', date: iso(KICK_FUTURE) },
  { matchId: MATCHES.m2, leagueCode: 'test.1', date: iso(KICK_FUTURE) },
  { matchId: MATCHES.m6, leagueCode: 'test.1', date: iso(KICK_PAST) },
];
const resCovered = await batchRequest(COVERED, '10.1.0.2');
const jsonCovered: any = await resCovered.json();
globalThis.fetch = origFetch;

check('espion global.fetch : 0 appel sortant pendant le lot 100 % couvert', spyCalls === 0, `spyCalls=${spyCalls}`);
check('meta.espnCalls = 0 (diagnostic Option B)', jsonCovered?.meta?.espnCalls === 0);
check('meta.outboundCalls = 0 (aucun fetch, même pas météo)', jsonCovered?.meta?.outboundCalls === 0);
check('meta.source = snapshot (3/3 servis depuis Neon)', jsonCovered?.meta?.source === 'snapshot');
check('re-POST couvert : mêmes cartes servies (idempotent)', jsonCovered.results?.length === 3 && jsonCovered.results[0]?.matchId === MATCHES.m1 && jsonCovered.results[0]?.valueBetsCount === 2);

// ---------- Idempotence persistance : un re-POST ne réécrit RIEN ----------
const rowsAfterRepost = await db.prediction.findMany({ orderBy: [{ matchId: 'asc' }, { market: 'asc' }] });
const fingerprint = (rows: typeof rowsAfterMixed) =>
  JSON.stringify(rows.map((r) => [r.matchId, r.market, r.pick, r.probability, r.rawProbability, r.odds, r.pickedTeamId, r.predictionTime?.getTime(), r.oddsCapturedAt?.getTime(), r.modelVersion, r.inputsDigest, r.confidence, r.resolved, r.result]));
check('re-POST : 0 réécriture (upsert update:{} — valeurs figées intactes)', rowsAfterRepost.length === 6 && fingerprint(rowsAfterRepost) === fingerprint(rowsAfterMixed));

// ---------- Échec DB lecture snapshot → TOUT le lot en chemin moteur ----------
section('7. Échec DB lecture snapshot → repli intégral chemin moteur (plan §3)');

// Simulation RÉELLE d'une erreur DB : suppression de la table (DB temporaire).
await db.$executeRawUnsafe('DROP TABLE "ForecastSnapshot"');
const resDbFail = await batchRequest(
  [
    { matchId: MATCHES.m1, leagueCode: 'test.1', date: iso(KICK_FUTURE) },
    { matchId: MATCHES.m3, leagueCode: 'test.1', date: iso(KICK_FUTURE) },
  ],
  '10.1.0.3'
);
const jsonDbFail: any = await resDbFail.json();
check('HTTP 200 malgré l’échec DB (disponibilité > optimisation)', resDbFail.status === 200);
check('meta.snapshotLookupOk = false (diagnostic honnête)', jsonDbFail?.meta?.snapshotLookupOk === false);
check('AUCUN match servi snapshot (0 lecture possible)', jsonDbFail?.meta?.counts?.snapshot === 0);
check('m1 (couvert avant l’incident) → fallback/failed, PAS snapshot', jsonDbFail?.meta?.perMatch?.[MATCHES.m1] !== 'snapshot');
check('meta.source = fallback (0 lecture snapshot possible)', jsonDbFail?.meta?.source === 'fallback');
// NB : espnCalls peut valoir 0 ici SANS contradiction — le scoreboard ESPN
// « test.1 » a déjà été tenté par le lot mixte et son échec est mis en cache
// LRU (~10 min) : le chemin moteur est bien exécuté (résultats null +
// perMatch ≠ snapshot), mais ne re-téléphone pas au même scoreboard. La
// preuve « le fallback APPELE ESPN à cache froid » est au lot mixte ci-dessus.

// ============================================================
// 8. VALIDATION CROISÉE données réelles (GET lecture seule, sans secret)
// ============================================================
section('8. Validation croisée données réelles (GET /api/forecasts/week — lecture seule)');
try {
  const d = new Date();
  const day = (d.getUTCDay() + 6) % 7; // lundi = 0
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - day * 86400_000);
  const start = monday.toISOString().slice(0, 10);
  const wr = await fetch(`https://voltrixbet.vercel.app/api/forecasts/week?start=${start}`, {
    headers: { 'user-agent': 'voltrix-option-b-test/1.0 (lecture seule)' },
    signal: AbortSignal.timeout(45_000),
  });
  if (!wr.ok) throw new Error(`HTTP ${wr.status}`);
  const wj: any = await wr.json();
  const rows: any[] = wj.matches ?? wj.leagues?.flatMap((l: any) => l.matches) ?? [];
  check('payload semaine reçu', rows.length > 0, `${rows.length} matchs`);
  let compared = 0;
  let mismatches = 0;
  let withLegs = 0;
  let zeroOdds = 0;
  for (const row of rows) {
    const s = row.snapshot;
    if (!s) continue;
    const snapLike: any = { ...s, matchId: row.matchId, kickoff: new Date(row.kickoff), published: true };
    const got = computeValueBetsCount(snapLike, null);
    // Recalcul INDÉPENDANT (écrit différemment — vérification croisée) :
    const edges: number[] = [];
    const add = (p: number, dec: unknown) => {
      if (typeof dec === 'number' && dec > 1.01 && p > 0) {
        const e = p * dec - 1;
        if (e > 0.02) edges.push(e);
      }
    };
    add(s.p1x2Home, s.odds1x2Home);
    add(s.p1x2Draw, s.odds1x2Draw);
    add(s.p1x2Away, s.odds1x2Away);
    if (
      s.ouMarketLine != null &&
      Math.abs(s.ouMarketLine - 2.5) < 0.01 &&
      (s.oddsOver25 != null || s.oddsUnder25 != null)
    ) {
      add(s.pOver25Raw ?? s.pOver25, s.oddsOver25);
      add(s.pUnder25Raw ?? s.pUnder25, s.oddsUnder25);
    }
    const expected = edges.sort((a, b) => b - a).slice(0, 4).length;
    compared++;
    if (got !== expected) mismatches++;
    if (expected > 0) withLegs++;
    if (s.odds1x2Home == null && s.odds1x2Draw == null && s.odds1x2Away == null && s.oddsOver25 == null && s.oddsUnder25 == null) zeroOdds++;
  }
  check(`computeValueBetsCount = recalcul indépendant sur ${compared} snapshots réels`, compared > 0 && mismatches === 0, `mismatches=${mismatches}`);
  console.log(`  ℹ Agrégat semaine ${start} : ${compared} snapshots publiés ; ${withLegs} avec jambes value ; ${zeroOdds} sans aucune cote figée (→ 0).`);
  console.log('  ℹ Audit Task 39 (16/09) attendait ≈ 32 avec jambes / 24 sans cotes sur le jour J — indicatif (données vivantes).');
} catch (e) {
  console.warn(`  ⚠ validation croisée réseau ignorée : ${(e as Error).message}`);
}

// ---------- Nettoyage ----------
await db.$disconnect();
try {
  execSync(`${PGBIN}/pg_ctl -D ${dataDir} stop -m fast`, { stdio: 'pipe' });
} catch {}
rmSync(tmpDir, { recursive: true, force: true });

console.log(`\n════════ RÉSULTAT : ${pass} OK / ${fail} ÉCHEC(s) ════════`);
process.exit(fail > 0 ? 1 : 0);
