// ============================================================
// Task 22-a — Immuabilité predictionTime/modelVersion (plan V2→V3
// étapes 1/2/14) + comportement 19-a conservé, sur une DB SQLite
// TEMPORAIRE (PAS la db de prod — la db de prod n'est jamais touchée).
//
// Scénario (réplique fidèle du flux de persistance de
// src/app/api/predictions/route.ts — la route n'est pas importable
// hors Next à cause de NextRequest/analyzeBatch réseau) :
//   1) création d'un prono (upsert create fige predictionTime +
//      modelVersion + rawProbability + inputsDigest) ;
//   2) re-upsert avec valeurs DIFFÉRENTES sur prono non résolu →
//      probability/odds/raw/digest BOUGENT, predictionTime et
//      modelVersion restent EXACTEMENT identiques (bitwise) ;
//   3) résolution (resolved/result/closingOdds) ;
//   4) re-upsert sur prono RÉSOLU → plus RIEN ne bouge (19-a) ;
//   5) upsert update:{} brut sur résolu → inchangé (garde 19-a) ;
//   6) ligne « legacy » (modelVersion NULL) → jamais réétiquetée.
// + Tests unitaires extractPicks/buildInputsDigest (rawProbability
//   brut vs calibré, digest compact < 300 car., repli sans p.raw).
// Exécuter : bun scripts/test-prediction-immutability.ts
// ============================================================
import { execSync } from 'node:child_process';
import { rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { extractPicks, buildInputsDigest, type AnalyzeResult } from '../src/lib/analyze';
import { MODEL_VERSION } from '../src/lib/model-version';

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

// ---------- 0. DB SQLite temporaire (schéma projet, jamais la prod) ----------
const ROOT = path.resolve(import.meta.dir, '..');
const tmpDir = mkdtempSync(path.join(tmpdir(), 'voltrix-22a-'));
const dbUrl = `file:${path.join(tmpDir, 'test.db')}`;
execSync('bunx prisma db push --skip-generate', {
  cwd: ROOT,
  env: { ...process.env, DATABASE_URL: dbUrl }, // l'env process GAGNE sur .env → prod intacte
  stdio: 'pipe',
});
const db = new PrismaClient({ datasources: { db: { url: dbUrl } } });

const MATCH_ID = 'test-22a-immutable';
const KICKOFF = new Date('2026-09-20T19:45:00Z'); // matchDate = kickoffTime (existant, Task 22-a : DISTINCT de predictionTime)

// ---------- 1. Réplique du flux de persistance de /api/predictions ----------
interface PickLike {
  market: string;
  pick: string;
  probability: number;
  odds: number | null;
  pickedTeamId: string | null;
  rawProbability: number;
  inputsDigest: string;
  confidence: number;
}

async function persistOnce(pick: PickLike) {
  // Identique à route.ts : upsert create fige predictionTime/modelVersion, update:{} ne
  // réécrit RIEN sur une ligne existante ; le refresh conditionnel ne tourne que si !resolved.
  const row = await db.prediction.upsert({
    where: { matchId_market: { matchId: MATCH_ID, market: pick.market } },
    create: {
      matchId: MATCH_ID,
      league: 'eng.1',
      leagueName: 'Premier League',
      matchDate: KICKOFF,
      homeTeam: 'Home FC',
      awayTeam: 'Away FC',
      market: pick.market,
      pick: pick.pick,
      probability: pick.probability,
      odds: pick.odds,
      pickedTeamId: pick.pickedTeamId,
      oddsCapturedAt: new Date(),
      predictionTime: new Date(),
      modelVersion: MODEL_VERSION,
      rawProbability: pick.rawProbability,
      inputsDigest: pick.inputsDigest,
      confidence: pick.confidence,
    },
    update: {},
  });
  if (!row.resolved) {
    await db.prediction.update({
      where: { id: row.id },
      data: {
        probability: pick.probability,
        odds: pick.odds,
        confidence: pick.confidence,
        pick: pick.pick,
        pickedTeamId: pick.pickedTeamId,
        oddsCapturedAt: new Date(),
        rawProbability: pick.rawProbability, // suit la proba rafraîchie
        inputsDigest: pick.inputsDigest,
        // predictionTime et modelVersion volontairement ABSENTS (immuables)
      },
    });
  }
  return row;
}

const pickV1: PickLike = {
  market: 'O/U 2.5',
  pick: 'Plus de 2.5',
  probability: 0.5137,
  odds: 1.85,
  pickedTeamId: null,
  rawProbability: 0.5632,
  inputsDigest: '{"odds":1,"ou":2.5,"h":[8,7],"a":[6,9],"inj":[2,0],"st":1}',
  confidence: 3,
};
const pickV2: PickLike = {
  ...pickV1,
  pick: 'Moins de 2.5', // retournement complet du prono simulé
  probability: 0.7777,
  odds: 2.5,
  rawProbability: 0.8012,
  inputsDigest: '{"odds":1,"ou":3.5,"h":[12,11],"a":[11,12],"inj":[5,3],"st":2}',
  confidence: 4,
};

async function main() {
  console.log('— DB temporaire :', dbUrl);

  // ---- 1) Création : predictionTime/modelVersion figés, ≠ kickoff ----
  await persistOnce(pickV1);
  const v1 = await db.prediction.findUniqueOrThrow({
    where: { matchId_market: { matchId: MATCH_ID, market: 'O/U 2.5' } },
  });
  check('création : predictionTime renseigné', v1.predictionTime instanceof Date);
  check('création : modelVersion = MODEL_VERSION', v1.modelVersion === MODEL_VERSION, `got ${v1.modelVersion}`);
  check('predictionTime ≠ matchDate (kickoff) — jamais substitué', v1.predictionTime!.getTime() !== KICKOFF.getTime());
  check('rawProbability brute persistée (0.5632 ≠ calibré 0.5137)', v1.rawProbability === 0.5632, `got ${v1.rawProbability}`);
  check('inputsDigest persisté', v1.inputsDigest === pickV1.inputsDigest);
  check('inputsDigest compact (< 300 car.)', (v1.inputsDigest ?? '').length < 300, `len ${(v1.inputsDigest ?? '').length}`);
  JSON.parse(v1.inputsDigest ?? '');
  check('inputsDigest JSON valide', true);

  // ---- 2) Re-upsert valeurs différentes, prono NON résolu : ça bouge, sauf l'immuable ----
  await new Promise((r) => setTimeout(r, 25)); // horodatages distincts garantis
  await persistOnce(pickV2);
  const v2 = await db.prediction.findUniqueOrThrow({
    where: { matchId_market: { matchId: MATCH_ID, market: 'O/U 2.5' } },
  });
  check('non résolu : probability rafraîchie (0.7777)', v2.probability === 0.7777, `got ${v2.probability}`);
  check('non résolu : odds rafraîchie (2.5)', v2.odds === 2.5, `got ${v2.odds}`);
  check('non résolu : rawProbability suit (0.8012)', v2.rawProbability === 0.8012, `got ${v2.rawProbability}`);
  check('non résolu : inputsDigest suit', v2.inputsDigest === pickV2.inputsDigest);
  check('non résolu : pick suit (retournement ok)', v2.pick === 'Moins de 2.5', `got ${v2.pick}`);
  check(
    'IMMUABLE : predictionTime EXACTEMENT inchangé',
    v2.predictionTime!.getTime() === v1.predictionTime!.getTime(),
    `${v1.predictionTime!.toISOString()} → ${v2.predictionTime!.toISOString()}`,
  );
  check('IMMUABLE : modelVersion inchangée', v2.modelVersion === MODEL_VERSION && v2.modelVersion === v1.modelVersion);
  check('IMMUABLE : createdAt inchangé', v2.createdAt.getTime() === v1.createdAt.getTime());
  check('oddsCapturedAt suit la valeur réécrite (≥ création)', v2.oddsCapturedAt!.getTime() >= v1.oddsCapturedAt!.getTime());
  check('matchDate (kickoff) inchangé', v2.matchDate.getTime() === KICKOFF.getTime());

  // ---- 3) Résolution (comme resolvePredictionsForDate : resolved/result/closingOdds) ----
  await db.prediction.update({
    where: { id: v2.id },
    data: { resolved: true, result: 'WIN', closingOdds: 2.1 },
  });

  // ---- 4) Re-upsert sur prono RÉSOLU : plus RIEN ne bouge (19-a conservé) ----
  await new Promise((r) => setTimeout(r, 25));
  await persistOnce({ ...pickV1, probability: 0.1111, odds: 9.99 }); // tentative de réécriture
  const v3 = await db.prediction.findUniqueOrThrow({
    where: { matchId_market: { matchId: MATCH_ID, market: 'O/U 2.5' } },
  });
  check('RÉSOLU : probability figée (0.7777, pas 0.1111)', v3.probability === 0.7777, `got ${v3.probability}`);
  check('RÉSOLU : odds figée (2.5, pas 9.99)', v3.odds === 2.5, `got ${v3.odds}`);
  check('RÉSOLU : pick figé (Moins de 2.5)', v3.pick === 'Moins de 2.5', `got ${v3.pick}`);
  check('RÉSOLU : result conservé (WIN)', v3.result === 'WIN' && v3.resolved === true);
  check('RÉSOLU : closingOdds intacte (2.1)', v3.closingOdds === 2.1, `got ${v3.closingOdds}`);
  check('RÉSOLU : predictionTime toujours exactement inchangé', v3.predictionTime!.getTime() === v1.predictionTime!.getTime());
  check('RÉSOLU : modelVersion toujours inchangée', v3.modelVersion === MODEL_VERSION);

  // ---- 5) Garde 19-a au niveau upsert : update:{} n'écrase jamais la ligne résolue ----
  // (upsert « à la route » : create complet DIFFÉRENT + update:{} → la branche create est
  // ignorée sur une ligne existante, donc la valeur sentinelle ne passe jamais)
  await db.prediction.upsert({
    where: { matchId_market: { matchId: MATCH_ID, market: 'O/U 2.5' } },
    create: {
      matchId: MATCH_ID,
      league: 'eng.1',
      leagueName: 'Premier League',
      matchDate: KICKOFF,
      homeTeam: 'Home FC',
      awayTeam: 'Away FC',
      market: 'O/U 2.5',
      pick: 'Plus de 2.5',
      probability: 0.9999, // sentinelle : ne doit JAMAIS atterrir en base
      odds: 1.01,
      pickedTeamId: null,
      oddsCapturedAt: new Date(),
      predictionTime: new Date('2000-01-01T00:00:00Z'), // sentinelle immuable
      modelVersion: 'X-FALSE',
      confidence: 5,
    },
    update: {},
  });
  const v4 = await db.prediction.findUniqueOrThrow({ where: { id: v3.id } });
  check(
    'upsert update:{} : ligne résolue intacte (create ignoré)',
    v4.probability === 0.7777 && v4.result === 'WIN' && v4.predictionTime!.getTime() === v1.predictionTime!.getTime() && v4.modelVersion === MODEL_VERSION,
    `prob ${v4.probability}, pT ${v4.predictionTime?.toISOString()}, mv ${v4.modelVersion}`,
  );

  // ---- 6) Ligne « legacy » (pré-versionnement) : jamais réétiquetée ----
  await db.prediction.create({
    data: {
      matchId: 'test-22a-legacy',
      league: 'eng.1',
      leagueName: 'Premier League',
      matchDate: KICKOFF,
      homeTeam: 'Home FC',
      awayTeam: 'Away FC',
      market: 'BTTS',
      pick: 'Oui',
      probability: 0.55,
      odds: null,
      confidence: 2,
      // pas de predictionTime/modelVersion/rawProbability/inputsDigest → shape historique
    },
  });
  // refresh de la route sur cette ligne (non résolue) : ne doit JAMAIS backfiller
  await db.prediction.update({
    where: { matchId_market: { matchId: 'test-22a-legacy', market: 'BTTS' } },
    data: { probability: 0.66, odds: 1.9, oddsCapturedAt: new Date(), rawProbability: 0.66, inputsDigest: '{"odds":0}' },
  });
  const legacy = await db.prediction.findUniqueOrThrow({
    where: { matchId_market: { matchId: 'test-22a-legacy', market: 'BTTS' } },
  });
  check('legacy : modelVersion reste NULL (pas de réétiquetage)', legacy.modelVersion === null, `got ${legacy.modelVersion}`);
  check('legacy : predictionTime reste NULL (pas de backfill kickoff)', legacy.predictionTime === null, `got ${legacy.predictionTime}`);

  // ---- 7) extractPicks : rawProbability brut vs calibré + digest (unitaire) ----
  const fakeAnalysis = {
    home: { name: 'Home FC', id: 'h1', gamesHome: 8, gamesAway: 7, injuriesCount: 2, rank: 3 },
    away: { name: 'Away FC', id: 'a1', gamesHome: 6, gamesAway: 9, injuriesCount: 0, rank: null },
    prediction: {
      probs: { home: 0.45, draw: 0.27, away: 0.28 },
      overUnder: [{ line: 2.5, over: 0.5137, under: 0.4863 }],
      btts: { yes: 0.52, no: 0.48 },
      raw: {
        overUnder: [{ line: 2.5, over: 0.5632, under: 0.4368 }],
        btts: { yes: 0.55, no: 0.45 },
      },
      confidence: 3,
    },
    odds: {
      hasOdds: true,
      overUnderLine: 2.5,
      moneyline: {
        home: { open: 2.0, close: 1.9 },
        draw: { open: 3.4, close: 3.3 },
        away: { open: 3.8, close: 3.9 },
      },
      total: {
        over: { line: 2.5, openOdds: 1.75, closeOdds: 1.8 },
        under: { line: 2.5, openOdds: 2.1, closeOdds: 2.0 },
      },
    },
  } as unknown as AnalyzeResult;

  const picks = extractPicks(fakeAnalysis);
  check('extractPicks : 3 marchés', picks.length === 3, `got ${picks.length}`);
  const p1x2 = picks.find((p) => p.market === '1X2')!;
  const pou = picks.find((p) => p.market === 'O/U 2.5')!;
  const pbtts = picks.find((p) => p.market === 'BTTS')!;
  check('1X2 : rawProbability = probability (non calibré, v2.1)', p1x2.rawProbability === p1x2.probability && p1x2.rawProbability === 0.45, `${p1x2.rawProbability}/${p1x2.probability}`);
  check('O/U : probability = calibré (0.5137)', pou.probability === 0.5137, `got ${pou.probability}`);
  check('O/U : rawProbability = BRUT p.raw (0.5632)', pou.rawProbability === 0.5632, `got ${pou.rawProbability}`);
  check('BTTS : probability = calibré (0.52)', pbtts.probability === 0.52, `got ${pbtts.probability}`);
  check('BTTS : rawProbability = BRUT p.raw (0.55)', pbtts.rawProbability === 0.55, `got ${pbtts.rawProbability}`);
  const digest = buildInputsDigest(fakeAnalysis);
  check('digest = celui des picks (cohérence)', p1x2.inputsDigest === digest && pou.inputsDigest === digest);
  const parsed = JSON.parse(digest) as Record<string, unknown>;
  check('digest : hasOdds=1, ligne O/U=2.5', parsed.odds === 1 && parsed.ou === 2.5, digest);
  check('digest : historique h=[8,7] a=[6,9]', JSON.stringify(parsed.h) === '[8,7]' && JSON.stringify(parsed.a) === '[6,9]');
  check('digest : blessures inj=[2,0]', JSON.stringify(parsed.inj) === '[2,0]');
  check('digest : standings dispo st=1 (home classée, away non)', parsed.st === 1, `got ${parsed.st}`);
  check('digest < 300 caractères', digest.length < 300, `len ${digest.length}`);

  // Repli défensif : analyse sans p.raw (cache d'avant 21-b) → brut = calibré, jamais null
  const noRaw = JSON.parse(JSON.stringify(fakeAnalysis)) as AnalyzeResult;
  delete (noRaw.prediction as { raw?: unknown }).raw;
  const picksNoRaw = extractPicks(noRaw);
  check(
    'sans p.raw : rawProbability repli = probability (jamais null/NaN)',
    picksNoRaw.every((p) => p.rawProbability === p.probability && Number.isFinite(p.rawProbability)),
  );

  // ---- Nettoyage ----
  await db.prediction.deleteMany({ where: { matchId: { startsWith: 'test-22a' } } });

  console.log(`\n=== ${pass} OK / ${fail} KO ===`);
  if (fail > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
    rmSync(tmpDir, { recursive: true, force: true }); // la DB temporaire disparaît
    console.log('— DB temporaire supprimée (prod jamais touchée)');
  });
