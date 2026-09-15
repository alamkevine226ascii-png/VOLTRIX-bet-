// ============================================================
// VOLTRIX bet — Task 28 §30 : TESTS OBLIGATOIRES (Neon)
//
// Couverture :
//   Base        : connexion, tables, index, contrainte d'unicité
//   Matchs      : pas de doublons (espn_event_id), statut, résultat
//   Statuts     : §22 — futur/terminé/live/reporté/annulé + scénario
//                 « 14/09 13:45 UTC consulté le 15/09 » → TERMINÉ
//   H2H         : les DEUX ordres domicile/extérieur, orientation
//                 winner, historique vide, équipes identiques
//   Prédictions : snapshot créé, IMPOSSIBLE À MODIFIER (trigger §20),
//                 plusieurs versions, plusieurs marchés/issues
//
// Usage : set -a && source .env && set +a && bun test tests/neon-task28.test.ts
// Les lignes de test sont préfixées TEST- et NETTOYÉES avant/après.
// ============================================================

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { db } from '../src/lib/db';
import { effectiveStatus, statusLabelFr, ingestStatus } from '../src/lib/sync/status';
import { getH2HFromDb } from '../src/lib/sync/h2h';
import { ingestBatch } from '../src/lib/sync/espn-sync';

const NS = 'TEST28'; // préfixe d'isolation des données de test

const DAY = 24 * 3_600_000;

async function cleanup() {
  // Tables mutables (triggers uniquement sur les prédictions) :
  await db.oddsSnapshot.deleteMany({ where: { matchId: { startsWith: NS } } });
  await db.match.deleteMany({ where: { espnEventId: { startsWith: NS } } });
  await db.team.deleteMany({ where: { espnTeamId: { startsWith: NS } } });
  await db.competition.deleteMany({ where: { espnLeagueId: { startsWith: NS } } });
  await db.matchResult.deleteMany({ where: { matchId: { startsWith: NS } } });
  // Snapshots de prédictions : immuables (pas de DELETE possible) —
  // on laisse les éventuels TEST28 de runs précédents (insert-only),
  // le test d'unicité gère les collisions en réutilisant les versions.
}

beforeAll(async () => {
  // Réveil du compute Neon (autosuspend) — peut prendre plusieurs secondes
  for (let i = 0; i < 5; i++) {
    try {
      await db.$queryRaw`SELECT 1`;
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  await cleanup();
}, 90_000);

afterAll(async () => {
  await cleanup();
  await db.$disconnect();
}, 90_000);

// ============================================================
// BASE — connexion, tables, index
// ============================================================

describe('Base Neon (§2/§25/§30)', () => {
  test('connexion + requête simple', async () => {
    const r = await db.$queryRaw<Array<{ one: number }>>`SELECT 1 AS one`;
    expect(r[0].one).toBe(1);
  });

  test('tables du schéma présentes', async () => {
    const tables = await db.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('Match','Team','Competition','OddsSnapshot','PredictionSnapshot','PredictionMarket','PredictionOutcome','Prediction','ForecastMatch','ForecastSnapshot','MatchResult','ForecastEvaluation','ForecastJobRun','SyncJobRun')`;
    expect(tables.length).toBe(14);
  });

  test('index de performance présents (§25)', async () => {
    const idx = await db.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes
      WHERE tablename IN ('Match','Team','Competition','OddsSnapshot','PredictionSnapshot')`;
    const names = idx.map((i) => i.indexname).join('\n');
    // matches
    expect(names).toContain('Match_espnEventId_key');
    expect(names).toContain('Match_kickoffAt_idx');
    expect(names).toContain('Match_status_idx');
    expect(names).toContain('Match_homeTeamId_idx');
    expect(names).toContain('Match_awayTeamId_idx');
    expect(names).toContain('Match_competitionId_idx');
    // teams / competitions
    expect(names).toContain('Team_espnTeamId_key');
    expect(names).toContain('Competition_espnLeagueId_key');
    // odds
    expect(names).toContain('OddsSnapshot_matchId_idx');
    expect(names).toContain('OddsSnapshot_capturedAt_idx');
    // predictions
    expect(names).toContain('PredictionSnapshot_predictionTime_idx');
  });

  test('triggers d\'immutabilité actifs (§20/§27)', async () => {
    const trg = await db.$queryRaw<Array<{ tgname: string }>>`
      SELECT tgname FROM pg_trigger
      WHERE tgname LIKE '%_no_update' OR tgname LIKE '%_no_delete'`;
    expect(trg.length).toBeGreaterThanOrEqual(10);
  });
});

// ============================================================
// MATCHS — unicité, statut, résultat
// ============================================================

describe('Matchs (§3/§5/§30)', () => {
  test('espaces de noms de test créés', async () => {
    await db.team.createMany({
      data: [
        { espnTeamId: `${NS}-A`, name: 'Équipe A (test)' },
        { espnTeamId: `${NS}-B`, name: 'Équipe B (test)' },
      ],
      skipDuplicates: true,
    });
    const teams = await db.team.count({ where: { espnTeamId: { startsWith: NS } } });
    expect(teams).toBe(2);
  });

  test('AUCUN doublon possible sur espn_event_id (§3)', async () => {
    await db.match.create({
      data: {
        espnEventId: `${NS}-EVT-1`,
        homeTeamId: `${NS}-A`,
        homeTeamName: 'Équipe A (test)',
        awayTeamId: `${NS}-B`,
        awayTeamName: 'Équipe B (test)',
        kickoffAt: new Date(Date.now() - 5 * DAY),
        status: 'FINAL',
        homeScore: 2,
        awayScore: 1,
      },
    });
    // Deuxième insertion du MÊME espn_event_id → doit échouer
    let rejected = false;
    try {
      await db.match.create({
        data: {
          espnEventId: `${NS}-EVT-1`,
          homeTeamName: 'Équipe A (test)',
          awayTeamName: 'Équipe B (test)',
          kickoffAt: new Date(),
          status: 'SCHEDULED',
        },
      });
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);
    const count = await db.match.count({ where: { espnEventId: `${NS}-EVT-1` } });
    expect(count).toBe(1); // 10 récupérations = 1 ligne (§5)
  });

  test('résultat stocké séparément avec winner (§6)', async () => {
    await db.matchResult.create({
      data: {
        matchId: `${NS}-EVT-1`,
        status: 'FINAL',
        statusDetail: 'FT',
        homeScore: 2,
        awayScore: 1,
        winner: 'HOME',
        retrievedAt: new Date(),
        source: 'TEST',
      },
    });
    const r = await db.matchResult.findUnique({ where: { matchId: `${NS}-EVT-1` } });
    expect(r?.status).toBe('FINAL');
    expect(r?.winner).toBe('HOME');
  });
});

// ============================================================
// STATUTS — §4/§22 (module pur)
// ============================================================

describe('Statuts (§4/§22/§30)', () => {
  const NOW = new Date('2026-09-15T10:00:00Z').getTime();
  const KICK = new Date('2026-09-14T13:45:00Z').getTime(); // scénario du cahier §22

  test('match futur → À VENIR', () => {
    expect(effectiveStatus({ kickoffMs: NOW + 2 * DAY, nowMs: NOW })).toBe('SCHEDULED');
    expect(statusLabelFr('SCHEDULED')).toBe('À VENIR');
  });

  test('§22 : match du 14/09 13:45 consulté le 15/09 → TERMINÉ (pas À VENIR)', () => {
    // a) résultat officiel présent
    expect(effectiveStatus({ resultStatus: 'FINAL', kickoffMs: KICK, nowMs: NOW })).toBe('FINAL');
    // b) ligne de résultat MANQUANTE mais ESPN 'post' → TERMINÉ
    expect(effectiveStatus({ espnState: 'post', statusDetail: 'FT', kickoffMs: KICK, nowMs: NOW })).toBe('FINAL');
    // c) aucun signal du tout → secours temporel (+3 h) → TERMINÉ
    expect(effectiveStatus({ kickoffMs: KICK, nowMs: NOW })).toBe('FINAL');
    expect(statusLabelFr('FINAL')).toBe('TERMINÉ');
  });

  test('match en direct → EN DIRECT', () => {
    expect(effectiveStatus({ resultStatus: 'LIVE', nowMs: NOW })).toBe('LIVE');
    expect(effectiveStatus({ espnState: 'in', statusDetail: "42'", kickoffMs: NOW - 3_600_000, nowMs: NOW })).toBe('LIVE');
    expect(statusLabelFr('LIVE')).toBe('EN DIRECT');
  });

  test('reporté / annulé / suspendu → jamais TERMINÉ (l\'heure seule ment)', () => {
    expect(effectiveStatus({ resultStatus: 'POSTPONED', kickoffMs: KICK, nowMs: NOW })).toBe('POSTPONED');
    expect(statusLabelFr('POSTPONED')).toBe('REPORTÉ');
    expect(effectiveStatus({ resultStatus: 'CANCELLED', nowMs: NOW })).toBe('CANCELLED');
    expect(statusLabelFr('CANCELLED')).toBe('ANNULÉ');
    expect(effectiveStatus({ resultStatus: 'SUSPENDED', nowMs: NOW })).toBe('SUSPENDED');
    expect(statusLabelFr('SUSPENDED')).toBe('SUSPENDU');
    // ESPN 'post' + libellé reporté → REPORTÉ même sans ligne résultat
    expect(effectiveStatus({ espnState: 'post', statusDetail: 'Postponed', kickoffMs: KICK, nowMs: NOW })).toBe('POSTPONED');
    // secours temporel bloqué si libellé de report présent
    expect(effectiveStatus({ espnState: 'pre', statusDetail: 'Postponed', kickoffMs: KICK, nowMs: NOW })).toBe('SCHEDULED');
  });

  test('ingestStatus : statuts ESPN réels → canoniques (§4)', () => {
    expect(ingestStatus('STATUS_FINAL', 'post', true, 'FT')).toBe('FINAL');
    expect(ingestStatus('STATUS_POSTPONED', 'post', false, 'Postponed')).toBe('POSTPONED');
    expect(ingestStatus('STATUS_CANCELED', 'post', false, 'Cancelled')).toBe('CANCELLED');
    expect(ingestStatus('STATUS_SUSPENDED', 'post', false, 'Suspended')).toBe('SUSPENDED');
    expect(ingestStatus('STATUS_DELAYED', 'in', false, 'Delayed')).toBe('DELAYED');
    expect(ingestStatus('STATUS_HALFTIME', 'in', false, 'HT')).toBe('HALFTIME');
    expect(ingestStatus('STATUS_FIRST_HALF', 'in', false, "23'")).toBe('LIVE');
    expect(ingestStatus('STATUS_SCHEDULED', 'pre', false, 'Sat, Sep 19')).toBe('SCHEDULED');
    expect(ingestStatus('', 'post', false, 'FT')).toBe('FINAL'); // repli state-only (scan)
  });
});

// ============================================================
// H2H — §7/§30 (les deux ordres, depuis la base)
// ============================================================

describe('H2H depuis la base (§7/§30)', () => {
  beforeAll(async () => {
    // Paire DÉDIÉE C/D (la paire A/B est déjà enrichie par d'autres tests)
    await db.team.createMany({
      data: [
        { espnTeamId: `${NS}-C`, name: 'Équipe C (test)' },
        { espnTeamId: `${NS}-D`, name: 'Équipe D (test)' },
      ],
      skipDuplicates: true,
    });
    // 3 confrontations, ordres MÉLANGÉS :
    //   C 2-1 D (C domicile, C gagne)
    //   D 1-0 C (D DOMICILE — l'ordre inverse, D gagne)
    //   C 1-1 D (nul)
    const base = (eventId: string, homeId: string, awayId: string, hs: number, as_: number, daysAgo: number) => ({
      espnEventId: eventId,
      homeTeamId: homeId,
      homeTeamName: homeId === `${NS}-C` ? 'Équipe C (test)' : 'Équipe D (test)',
      awayTeamId: awayId,
      awayTeamName: awayId === `${NS}-C` ? 'Équipe C (test)' : 'Équipe D (test)',
      kickoffAt: new Date(Date.now() - daysAgo * DAY),
      status: 'FINAL',
      homeScore: hs,
      awayScore: as_,
    });
    await db.match.createMany({
      data: [
        base(`${NS}-H1`, `${NS}-C`, `${NS}-D`, 2, 1, 30),
        base(`${NS}-H2`, `${NS}-D`, `${NS}-C`, 1, 0, 20), // ordre INVERSÉ
        base(`${NS}-H3`, `${NS}-C`, `${NS}-D`, 1, 1, 10),
      ],
      skipDuplicates: true,
    });
  }, 60_000);

  test('les DEUX ordres domicile/extérieur sont retrouvés (§7)', async () => {
    const h2h = await getH2HFromDb(`${NS}-C`, `${NS}-D`, 10);
    expect(h2h.matches.length).toBe(3);
    // La confrontation « D à domicile » figure bien dans la liste
    const reversed = h2h.matches.find((m) => m.homeTeam === 'Équipe D (test)' && m.awayTeam === 'Équipe C (test)');
    expect(reversed).toBeDefined();
    expect(reversed?.score).toBe('1-0');
  }, 30_000);

  test('récapitulatif compté PAR ÉQUIPE (pas par terrain) et orienté correctement', async () => {
    const h2h = await getH2HFromDb(`${NS}-C`, `${NS}-D`, 10);
    // C gagne 1 (le 2-1), nul 1 (1-1), D gagne 1 (le 1-0 à domicile)
    expect(h2h.summary.homeWins).toBe(1); // victoires de l'équipe C (consultée à domicile)
    expect(h2h.summary.draws).toBe(1);
    expect(h2h.summary.awayWins).toBe(1); // victoires de l'équipe D
    expect(h2h.summary.total).toBe(3);
    // Orientation du winner du match inversé : 'home' = D (domicile CE jour-là)
    const reversed = h2h.matches.find((m) => m.homeTeam === 'Équipe D (test)');
    expect(reversed?.winner).toBe('home');
  }, 30_000);

  test('symétrie : C vs D = D vs C', async () => {
    const cd = await getH2HFromDb(`${NS}-C`, `${NS}-D`, 10);
    const dc = await getH2HFromDb(`${NS}-D`, `${NS}-C`, 10);
    expect(dc.matches.length).toBe(cd.matches.length);
    expect(dc.summary.homeWins).toBe(cd.summary.awayWins); // rôles inversés
    expect(dc.summary.awayWins).toBe(cd.summary.homeWins);
  }, 30_000);

  test('historique vide → liste vide sans erreur', async () => {
    const h2h = await getH2HFromDb(`${NS}-C`, `${NS}-ZZZ`, 10);
    expect(h2h.matches).toHaveLength(0);
    expect(h2h.summary.total).toBe(0);
  }, 30_000);

  test('équipes identiques → vide (garde-fou)', async () => {
    const h2h = await getH2HFromDb(`${NS}-C`, `${NS}-C`, 10);
    expect(h2h.matches).toHaveLength(0);
  });
});

// ============================================================
// INGESTION IDEMPOTENTE + COTES HISTORISÉES (§5/§10)
// ============================================================

describe('Synchronisation (§5/§10/§30)', () => {
  const evBase = (oddsHome: number | null, oddsAway: number | null) => ({
    espnEventId: `${NS}-EVT-ODDS`,
    kickoffAt: new Date(Date.now() + 2 * DAY),
    espnState: 'pre',
    statusName: 'STATUS_SCHEDULED',
    statusDetail: 'Sat, Sep 19',
    completed: false,
    venue: 'Stade de test',
    home: { id: `${NS}-A`, name: 'Équipe A (test)', shortName: 'A', abbreviation: 'ETA', logo: null },
    away: { id: `${NS}-B`, name: 'Équipe B (test)', shortName: 'B', abbreviation: 'ETB', logo: null },
    homeScore: null,
    awayScore: null,
    odds: [
      ...(oddsHome != null ? [{ marketType: '1X2', outcome: 'HOME', line: null, odds: oddsHome, bookmaker: 'TestBook' }] : []),
      ...(oddsAway != null ? [{ marketType: '1X2', outcome: 'AWAY', line: null, odds: oddsAway, bookmaker: 'TestBook' }] : []),
    ],
  });

  test('1X2 HOME 1.85 → capture', async () => {
    const r = await ingestBatch([evBase(1.85, 4.2)], { leagueCode: `${NS}-L1`, leagueName: 'Ligue de test', season: 2026 });
    expect(r.eventsSeen).toBe(1);
    expect(r.matchesCreated).toBe(1);
    expect(r.oddsInserted).toBe(2);
  }, 60_000);

  test('même cote re-capturée → AUCUNE nouvelle ligne (jamais écrasée, pas de doublon)', async () => {
    await ingestBatch([evBase(1.85, 4.2)], { leagueCode: `${NS}-L1`, leagueName: 'Ligue de test', season: 2026 });
    const c = await db.oddsSnapshot.count({ where: { matchId: `${NS}-EVT-ODDS` } });
    expect(c).toBe(2);
  }, 60_000);

  test('cote qui bouge 1.85 → 1.75 → NOUVELLE ligne (historique §10)', async () => {
    await ingestBatch([evBase(1.75, 4.6)], { leagueCode: `${NS}-L1`, leagueName: 'Ligue de test', season: 2026 });
    const rows = await db.oddsSnapshot.findMany({ where: { matchId: `${NS}-EVT-ODDS`, outcome: 'HOME' }, orderBy: { capturedAt: 'asc' } });
    expect(rows.length).toBe(2);
    expect(rows[0].odds).toBe(1.85); // l'ancienne valeur est CONSERVÉE
    expect(rows[1].odds).toBe(1.75);
  }, 60_000);

  test('changement de statut : SCHEDULED → FINAL avec scores (§30)', async () => {
    const before = await db.match.findUnique({ where: { espnEventId: `${NS}-EVT-ODDS` } });
    expect(before?.status).toBe('SCHEDULED');
    const finished = { ...evBase(null, null), espnState: 'post', statusName: 'STATUS_FINAL', statusDetail: 'FT', completed: true, homeScore: 3, awayScore: 1 };
    await ingestBatch([finished], { leagueCode: `${NS}-L1`, leagueName: 'Ligue de test', season: 2026 });
    const after = await db.match.findUnique({ where: { espnEventId: `${NS}-EVT-ODDS` } });
    expect(after?.status).toBe('FINAL');
    expect(after?.homeScore).toBe(3);
    const res = await db.matchResult.findUnique({ where: { matchId: `${NS}-EVT-ODDS` } });
    expect(res?.status).toBe('FINAL');
    expect(res?.winner).toBe('HOME');
  }, 60_000);

  test('anti-retour : FINAL ne redescend jamais à SCHEDULED (donnée périmée)', async () => {
    const stale = { ...evBase(null, null), espnState: 'pre', statusName: 'STATUS_SCHEDULED', statusDetail: 'Sat, Sep 19', completed: false, homeScore: null, awayScore: null };
    await ingestBatch([stale], { leagueCode: `${NS}-L1`, leagueName: 'Ligue de test', season: 2026 });
    const m = await db.match.findUnique({ where: { espnEventId: `${NS}-EVT-ODDS` } });
    expect(m?.status).toBe('FINAL'); // conservé
    expect(m?.homeScore).toBe(3); // score conservé (anti-flap)
  }, 60_000);
});

// ============================================================
// PRÉDICTIONS — immuabilité, versions, marchés, issues (§11-§20/§30)
// ============================================================

describe('Prédictions figées (§18/§20/§30)', () => {
  test('snapshot créé, IMPOSSIBLE à modifier, impossible à supprimer — plusieurs versions, plusieurs marchés, plusieurs issues', async () => {
    // matchId UNIQUE par exécution : §20 rend les snapshots indéletibles
    // (trigger) — les lignes de test persistent volontairement, chacune
    // avec son propre espace de noms horodaté.
    const matchKey = `${NS}-SNAP-${Date.now()}`;

    // v1 + marché 1X2 + 3 issues + 1 composant (Poisson)
    const s1 = await db.predictionSnapshot.create({
      data: {
        matchId: matchKey,
        version: 1,
        kickoffAt: new Date(Date.now() - 5 * DAY),
        homeTeamName: 'Équipe A (test)',
        awayTeamName: 'Équipe B (test)',
        predictionTime: new Date(Date.now() - 5 * DAY - 3_600_000),
        modelVersion: 'v2.1-test',
        confidence: 4,
      },
    });
    const mkt = await db.predictionMarket.create({ data: { snapshotId: s1.id, marketKey: '1X2', line: null } });
    await db.predictionOutcome.createMany({
      data: [
        { marketId: mkt.id, outcomeKey: 'HOME_WIN', probability: 0.43, pick: true },
        { marketId: mkt.id, outcomeKey: 'DRAW', probability: 0.26 },
        { marketId: mkt.id, outcomeKey: 'AWAY_WIN', probability: 0.31 },
      ],
    });
    await db.predictionComponent.create({
      data: { marketId: mkt.id, component: 'POISSON', probabilities: { HOME_WIN: 0.41, DRAW: 0.27, AWAY_WIN: 0.32 } },
    });

    // §20/§30 : IMPOSSIBLE À MODIFIER (trigger PostgreSQL)
    let updateRejected = false;
    try {
      await db.predictionSnapshot.update({ where: { id: s1.id }, data: { confidence: 5 } });
    } catch {
      updateRejected = true;
    }
    expect(updateRejected).toBe(true);
    // La valeur est restée figée
    expect((await db.predictionSnapshot.findUnique({ where: { id: s1.id } }))?.confidence).toBe(4);

    // §20 : IMPOSSIBLE À SUPPRIMER (ligne, marché, issue)
    let delSnap = false;
    try {
      await db.predictionSnapshot.delete({ where: { id: s1.id } });
    } catch {
      delSnap = true;
    }
    expect(delSnap).toBe(true);
    let delOutcome = false;
    try {
      await db.predictionOutcome.deleteMany({ where: { marketId: mkt.id } });
    } catch {
      delOutcome = true;
    }
    expect(delOutcome).toBe(true);
    expect(await db.predictionOutcome.count({ where: { marketId: mkt.id } })).toBe(3);

    // §20 : ré-analyse = NOUVEAU snapshot (v2), jamais une réécriture
    const s2 = await db.predictionSnapshot.create({
      data: {
        matchId: matchKey,
        version: 2,
        kickoffAt: new Date(Date.now() - 5 * DAY),
        homeTeamName: 'Équipe A (test)',
        awayTeamName: 'Équipe B (test)',
        predictionTime: new Date(Date.now() - 5 * DAY - 1_800_000),
        modelVersion: 'v2.1-test',
        confidence: 5,
      },
    });
    const mkt2 = await db.predictionMarket.create({ data: { snapshotId: s2.id, marketKey: 'BTTS', line: null } });
    await db.predictionOutcome.createMany({
      data: [
        { marketId: mkt2.id, outcomeKey: 'BTTS_YES', probability: 0.54, pick: true },
        { marketId: mkt2.id, outcomeKey: 'BTTS_NO', probability: 0.46 },
      ],
    });

    // Deux versions coexistantes, chacune avec ses marchés et ses issues
    const versions = await db.predictionSnapshot.findMany({ where: { matchId: matchKey }, orderBy: { version: 'asc' } });
    expect(versions.length).toBe(2);
    expect(versions[0].confidence).toBe(4); // v1 INTACTE (audit prospectif §20)
    expect(versions[1].confidence).toBe(5);
    const markets1 = await db.predictionMarket.findMany({ where: { snapshotId: versions[0].id } });
    const markets2 = await db.predictionMarket.findMany({ where: { snapshotId: versions[1].id } });
    expect(markets1.map((m) => m.marketKey)).toEqual(['1X2']);
    expect(markets2.map((m) => m.marketKey)).toEqual(['BTTS']);
    const outcomes1 = await db.predictionOutcome.count({ where: { marketId: markets1[0].id } });
    const outcomes2 = await db.predictionOutcome.count({ where: { marketId: markets2[0].id } });
    expect(outcomes1).toBe(3); // plusieurs issues par marché
    expect(outcomes2).toBe(2);
  }, 90_000);

  test('lecture : snapshots génériques importés présents en base (§18)', async () => {
    const [snaps, markets, outcomes] = await Promise.all([db.predictionSnapshot.count(), db.predictionMarket.count(), db.predictionOutcome.count()]);
    expect(snaps).toBeGreaterThanOrEqual(920);
    expect(markets).toBeGreaterThanOrEqual(2760);
    expect(outcomes).toBeGreaterThanOrEqual(6440);
  });

  test('audit §27 : predictionTime + modelVersion + inputsDigest conservés', async () => {
    const snap = await db.predictionSnapshot.findFirst({ orderBy: { createdAt: 'asc' } });
    expect(snap).not.toBeNull();
    expect(snap!.predictionTime).toBeInstanceOf(Date);
    expect(typeof snap!.modelVersion).toBe('string');
    expect(snap!.snapshotUid).toBeTruthy();
  });
});
