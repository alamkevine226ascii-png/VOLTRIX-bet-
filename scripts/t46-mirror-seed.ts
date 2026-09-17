// ============================================================
// VOLTRIX — Task 46 : MIRROR NEON — seed + baseline pré-migration
//
// Prépare sur le PG 17 local persistant (port 5577) une mire
// représentative du contenu PRODUCTION Neon (formes de modèles
// réelles du schema.prisma), puis capture un baseline exact
// (comptages + empreintes par table) AVANT l'application de la
// migration Wake-on-Demand.
//
// Objectif : prouver que apply-wake-sync.ts ne modifie NI ne
// supprime AUCUNE donnée existante (contrainte #9).
//
// Usage : DATABASE_URL=postgresql://postgres@127.0.0.1:5577/postgres bun scripts/t46-mirror-seed.ts
// ============================================================

import { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const db = new PrismaClient();

function hashRows(rows: unknown[]): string {
  const s = JSON.stringify(rows, (_k, v) => (typeof v === 'bigint' ? Number(v) : v));
  return createHash('md5').update(s).digest('hex');
}

async function tableFingerprint(name: string): Promise<{ count: number; md5: string }> {
  const rows = await db.$queryRawUnsafe<Record<string, unknown>[]>(`SELECT * FROM "${name}" ORDER BY 1`);
  return { count: rows.length, md5: hashRows(rows) };
}

const TABLES = [
  'Competition',
  'Team',
  'Match',
  'MatchResult',
  'OddsSnapshot',
  'PredictionSnapshot',
  'PredictionMarket',
  'PredictionOutcome',
  'SyncJobRun',
];

async function main() {
  const url = process.env.DATABASE_URL ?? '';
  if (!url.includes('postgres')) throw new Error('DATABASE_URL doit être PostgreSQL (mire mirror-Neon)');

  // ---------- 1. MIRE PRODUCTION-LIKE (formes réelles du schéma) ----------
  console.log('→ Seed mire production-like…');

  const compsData = [
    { espnLeagueId: 'eng.1', name: 'Premier League', country: 'Angleterre' },
    { espnLeagueId: 'esp.1', name: 'LaLiga', country: 'Espagne' },
    { espnLeagueId: 'fra.1', name: 'Ligue 1', country: 'France' },
  ];
  const compIds: string[] = [];
  for (const c of compsData) {
    const row = await db.competition.upsert({
      where: { espnLeagueId: c.espnLeagueId },
      update: {},
      create: c,
      select: { id: true },
    });
    compIds.push(row.id);
  }

  const teamIds = ['t1', 't2', 't3', 't4', 't5', 't6']; // = espnTeamId (clé référencée par Match)
  const names = ['Arsenal', 'Chelsea', 'Real Madrid', 'Barcelona', 'Marseille', 'Lyon'];
  for (let i = 0; i < teamIds.length; i++) {
    await db.team.upsert({
      where: { espnTeamId: teamIds[i] },
      update: {},
      create: { espnTeamId: teamIds[i], name: names[i], competition: compsData[i % 3].espnLeagueId },
    });
  }

  const now = Date.now();
  const matchIds: string[] = [];
  for (let i = 0; i < 10; i++) {
    // 10 matchs passés FINAL + résultat + cotes historisées (2 captures de valeur différente)
    const created = await db.match.create({
      data: {
        espnEventId: `100000${i}`,
        competitionId: compIds[i % 3],
        competitionName: compsData[i % 3].name,
        homeTeamId: teamIds[i % 6],
        homeTeamName: names[i % 6],
        awayTeamId: teamIds[(i + 1) % 6],
        awayTeamName: names[(i + 1) % 6],
        kickoffAt: new Date(now - (i + 1) * 86_400_000),
        status: 'FINAL',
        statusDetail: 'FT',
        espnState: 'post',
        homeScore: i % 3,
        awayScore: (i + 1) % 2,
        venue: 'Stadium',
        venueCity: 'London',
        venueCountry: 'Angleterre',
      },
      select: { id: true },
    });
    matchIds.push(created.id);
    await db.matchResult.create({
      data: {
        matchId: created.id,
        status: 'FINAL',
        statusDetail: 'FT',
        homeScore: i % 3,
        awayScore: (i + 1) % 2,
        winner: i % 3 > (i + 1) % 2 ? 'HOME' : i % 3 === (i + 1) % 2 ? 'DRAW' : 'AWAY',
        retrievedAt: new Date(now - (i + 1) * 86_400_000 + 7_200_000),
      },
    });
    await db.oddsSnapshot.create({ data: { matchId: created.id, marketType: '1X2', outcome: 'HOME', odds: 1.85 + i * 0.01, bookmaker: 'DraftKings', capturedAt: new Date(now - (i + 1) * 86_400_000 + 3_600_000) } });
    await db.oddsSnapshot.create({ data: { matchId: created.id, marketType: '1X2', outcome: 'HOME', odds: 1.9 + i * 0.01, bookmaker: 'DraftKings', capturedAt: new Date(now - (i + 1) * 86_400_000 + 5_400_000) } });
    await db.oddsSnapshot.create({ data: { matchId: created.id, marketType: 'OVER_UNDER', outcome: 'OVER', line: 2.5, odds: 1.9, bookmaker: 'DraftKings', capturedAt: new Date(now - (i + 1) * 86_400_000 + 3_600_000) } });
  }
  for (let i = 0; i < 10; i++) {
    await db.match.create({
      data: {
        espnEventId: `200000${i}`,
        competitionId: compIds[i % 3],
        competitionName: compsData[i % 3].name,
        homeTeamId: teamIds[(i + 2) % 6],
        homeTeamName: names[(i + 2) % 6],
        awayTeamId: teamIds[(i + 3) % 6],
        awayTeamName: names[(i + 3) % 6],
        kickoffAt: new Date(now + (i + 1) * 86_400_000),
        status: 'SCHEDULED',
        espnState: 'pre',
        venue: 'Stadium',
      },
    });
  }

  // 2 PredictionSnapshot §27 (3 marchés, issues calibrées + picks)
  for (let i = 0; i < 2; i++) {
    await db.predictionSnapshot.create({
      data: {
        matchId: matchIds[i],
        version: 1,
        competitionId: compsData[i % 3].espnLeagueId,
        competition: compsData[i % 3].name,
        kickoffAt: new Date(now - (i + 1) * 86_400_000),
        homeTeamId: teamIds[i % 6],
        homeTeamName: names[i % 6],
        awayTeamId: teamIds[(i + 1) % 6],
        awayTeamName: names[(i + 1) % 6],
        predictionTime: new Date(now - (i + 1) * 86_400_000 - 3_600_000),
        modelVersion: '2.1',
        inputsDigest: `digest-${i}`,
        confidence: 62,
        source: 'VOLTRIX',
        markets: {
          create: [
            {
              marketKey: '1X2',
              outcomes: {
                create: [
                  { outcomeKey: 'HOME_WIN', probability: 0.55, rawProbability: 0.53, pick: true },
                  { outcomeKey: 'DRAW', probability: 0.25, rawProbability: 0.27 },
                  { outcomeKey: 'AWAY_WIN', probability: 0.2, rawProbability: 0.2 },
                ],
              },
            },
            {
              marketKey: 'DOUBLE_CHANCE',
              outcomes: { create: [{ outcomeKey: '1X', probability: 0.78, rawProbability: 0.77, pick: true }] },
            },
            {
              marketKey: 'OVER_UNDER',
              line: 2.5,
              outcomes: {
                create: [
                  { outcomeKey: 'OVER', probability: 0.52, rawProbability: 0.51, pick: true },
                  { outcomeKey: 'UNDER', probability: 0.48, rawProbability: 0.49 },
                ],
              },
            },
          ],
        },
      },
    });
  }

  // 8 SyncJobRun = HISTORIQUE WORKER (status/triggerSource/runningLock/progress NULL)
  for (let i = 0; i < 8; i++) {
    await db.syncJobRun.create({
      data: {
        phase: i % 2 === 0 ? 'cycle' : 'live',
        startedAt: new Date(now - (i + 2) * 3_600_000),
        finishedAt: new Date(now - (i + 2) * 3_600_000 + 120_000),
        stats: JSON.stringify({ espnCalls: 40 + i, matchesUpdated: 3, oddsUpdated: 5 }),
        error: null,
      },
    });
  }

  // ---------- 2. BASELINE PRÉ-MIGRATION ----------
  const baseline: Record<string, { count: number; md5: string }> = {};
  for (const t of TABLES) baseline[t] = await tableFingerprint(t);
  writeFileSync('/home/z/my-project/scripts/t46-baseline.json', JSON.stringify(baseline, null, 2));
  console.log('→ Baseline capturé (pré-migration) :');
  for (const [t, v] of Object.entries(baseline)) console.log(`    ${t.padEnd(22)} count=${String(v.count).padStart(4)} md5=${v.md5.slice(0, 10)}`);
  console.log('✓ Mire + baseline prêts');
}

main()
  .catch((e) => {
    console.error('✗', e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
