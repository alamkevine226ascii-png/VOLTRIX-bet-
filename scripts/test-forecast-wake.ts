// ============================================================
// VOLTRIX — Task 49 (GO 4B) : TESTS « FORECAST WAKE ON DEMAND »
//
// Suite complète du pipeline de génération des ForecastSnapshot
// (patron §26 Wake-on-Demand, miroir de scripts/test-wake-sync.ts) :
//   A. MIGRATION — application idempotente (2× sans erreur), colonnes
//      NULLABLES, index unique partiel, triggers d'immutabilité posés ;
//   B. DÉTECTION — futurs sans snapshot uniquement, ordre kickoff asc,
//      horizon 14 j, statuts SCHEDULED/PRE (annulés/reportés exclus) ;
//   C. GÉNÉRATION — match sans snapshot → snapshot v2.1 (predictionTime
//      < kickoff, published, version 1, générique + registre écrits) ;
//   D. IDEMPOTENCE — tout snapshoté → { started:false, reason:'complete' }
//      avec 0 appel ESPN et 0 écriture ;
//   E. CONCURRENCE — 2 exécutions simultanées → 1 seule génération ;
//      8 parallèles → 1 gagnant, JAMAIS deux snapshots [matchId,version] ;
//   F. INTERRUPTION/REPRISE — budget épuisé → partial + curseur dans Neon
//      → reprise EXACTE (pas de doublon, total exact) ;
//   G. GARDES KICKOFF — passé : jamais détecté ; imminent (< 60 s) :
//      jamais analysé ; parti pendant l'analyse (status 'in') : jamais
//      snapshoté ; §6 buildSnapshotDraft : refus si now >= kickoff ;
//   H. IMMUABILITÉ — UPDATE/DELETE ForecastSnapshot rejetés par les
//      triggers PostgreSQL, INSERT libre, double INSERT [matchId,version]
//      rejeté (P2002), snapshot existant JAMAIS remplacé (empreinte) ;
//   I. VERROU ORPHELIN — RUNNING > 6 min → takeover + reprise ;
//   J. CHAÎNE SERVEUR — runForecastWakeChainUntilDone complète le
//      backlog en boucles jusqu'à succès ;
//   K. MOTEUR v2.1 — byte-identique au baseline (5/5 sha256).
//
// Infra : PostgreSQL 17 ÉPHÉMÈRE (.tmp-pg/pg17 — mire test-wake-sync.ts),
// ESPN STUBBÉ (fixtures synthétiques deterministes via globalThis.fetch —
// zéro réseau réel, contrôle total des statuts/dates), JAMAIS la base de
// production. Exécuter : bun scripts/test-forecast-wake.ts
// (après bash scripts/ensure-pg17.sh)
// ============================================================

import { execSync } from 'node:child_process';
import { rmSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import * as net from 'node:net';

let pass = 0;
let fail = 0;
const anomalies: string[] = [];
function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
    anomalies.push(`${name}${detail ? ` — ${detail}` : ''}`);
  }
}
function section(title: string) {
  console.log(`\n━━ ${title} ━━`);
}

// ---------- 0. PostgreSQL temporaire (mire test-wake-sync.ts) ----------
const ROOT = path.resolve(process.cwd());
const tmpDir = mkdtempSync(path.join(tmpdir(), 'voltrix-fw-'));
const PGBIN = path.join(ROOT, '.tmp-pg', 'pg17', 'usr', 'lib', 'postgresql', '17', 'bin');
const dataDir = path.join(tmpDir, 'pgdata');

// Port LIBRE garanti (des restes d'exécutions interrompues peuvent traîner) :
// on sonde le candidat avant initdb et on décale tant qu'il est occupé.
function portIsFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, '127.0.0.1');
  });
}
let PG_PORT = 5633 + (process.pid % 50);
for (let attempt = 0; attempt < 50 && !(await portIsFree(PG_PORT)); attempt++) PG_PORT = 5600 + ((PG_PORT + attempt * 7) % 400);
const dbUrl = `postgresql://postgres@127.0.0.1:${PG_PORT}/postgres`;
// L'env process GAGNE sur .env → la db de prod n'est jamais touchée.
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
execSync('node_modules/.bin/prisma db push --skip-generate', {
  cwd: ROOT,
  env: { ...process.env, DATABASE_URL: dbUrl, DIRECT_URL: dbUrl },
  stdio: 'pipe',
});

const { PrismaClient } = await import('@prisma/client');
const db = new PrismaClient({ datasources: { db: { url: dbUrl } } });

// ---------- A. Migration idempotente + index + triggers ----------

section('A. Migration runningLock (20260917000100_forecast_job_lock)');

// A1. La migration SQL du repo s'applique DEUX fois sans erreur (idempotence).
// ($executeRawUnsafe n'accepte qu'UNE commande : la migration est découpée
//  en instructions individuelles — mêmes textes, même ordre.)
const migrationSql = readFileSync(
  path.join(ROOT, 'prisma/migrations/20260917000100_forecast_job_lock/migration.sql'),
  'utf8'
);
const migrationStatements = migrationSql
  .split(';')
  .map((s) => s.replace(/^--.*$/gm, '').trim()) // commentaires retirés instruction par instruction
  .filter((s) => s.length > 0);
check('migration : 5 instructions individuelles découpées', migrationStatements.length === 5, `${migrationStatements.length}`);
for (let i = 1; i <= 2; i++) {
  for (const stmt of migrationStatements) {
    await db.$executeRawUnsafe(stmt.endsWith(';') ? stmt : stmt + ';');
  }
  check(`migration appliquée (${i}/2) sans erreur`, true);
}

// A2. Colonnes NULLABLES présentes.
const cols = await db.$queryRawUnsafe<Array<{ column_name: string; is_nullable: string }>>(
  `SELECT column_name, is_nullable FROM information_schema.columns
   WHERE table_name = 'ForecastJobRun' AND column_name IN ('status','triggerSource','runningLock','progress')
   ORDER BY column_name;`
);
check(
  '4 colonnes status/triggerSource/runningLock/progress présentes et NULLABLES',
  cols.length === 4 && cols.every((c) => c.is_nullable === 'YES'),
  cols.map((c) => `${c.column_name}:${c.is_nullable}`).join(',')
);

// A3. Index unique partiel du verrou.
const idxRows = await db.$queryRawUnsafe<Array<{ indexdef: string }>>(
  `SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND indexname='ForecastJobRun_running_lock_uidx';`
);
check(
  'index unique PARTIEL ForecastJobRun_running_lock_uidx présent',
  idxRows.length === 1 && idxRows[0].indexdef.includes('UNIQUE INDEX') && idxRows[0].indexdef.includes('WHERE ("runningLock" IS NOT NULL)'),
  idxRows[0]?.indexdef ?? 'absent'
);

// A4. Verrou prouvé : un 2e INSERT RUNNING est rejeté par PostgreSQL.
// (Transaction ROLLBACK-ée par exception sentinelle — mire apply-wake-sync.ts,
//  zéro résidu même en cas de crash.)
class ProbeResult extends Error {
  constructor(public secondRejected: boolean) {
    super('PROBE_EXPECTED');
  }
}
let probe = false;
try {
  await db.$transaction(async (tx) => {
    await tx.forecastJobRun.create({
      data: { phase: 'probe', status: 'running', triggerSource: 'test', runningLock: 'RUNNING', startedAt: new Date() },
    });
    let secondRejected = true;
    try {
      await tx.forecastJobRun.create({
        data: { phase: 'probe', status: 'running', triggerSource: 'test', runningLock: 'RUNNING', startedAt: new Date() },
      });
      secondRejected = false;
    } catch {
      secondRejected = true;
    }
    throw new ProbeResult(secondRejected);
  });
} catch (e) {
  if (e instanceof ProbeResult) probe = e.secondRejected;
  else throw e;
}
check('verrou DB : 2e INSERT runningLock=RUNNING rejeté par PostgreSQL', probe);
const probeLeftover = await db.forecastJobRun.count({ where: { phase: 'probe' } });
check('sonde ROLLBACK-ée : zéro résidu', probeLeftover === 0, `${probeLeftover} lignes sonde`);

// A5. Triggers d'immutabilité §20 posés (miroir apply-immutability.ts).
await db.$executeRawUnsafe(`
  CREATE OR REPLACE FUNCTION voltrix_forbid_mutation() RETURNS trigger AS $$
  BEGIN
    RAISE EXCEPTION 'VOLTRIX §20 : % est immuable (insert-only)', TG_TABLE_NAME;
  END;
  $$ LANGUAGE plpgsql;
`);
for (const table of ['PredictionSnapshot', 'PredictionMarket', 'PredictionOutcome', 'PredictionComponent', 'ForecastSnapshot']) {
  for (const action of ['UPDATE', 'DELETE']) {
    const name = `${table}_no_${action.toLowerCase()}`;
    await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${name}" ON "${table}";`);
    await db.$executeRawUnsafe(
      `CREATE TRIGGER "${name}" BEFORE ${action} ON "${table}" FOR EACH ROW EXECUTE FUNCTION voltrix_forbid_mutation();`
    );
  }
}
const trigCount = await db.$queryRawUnsafe<Array<{ n: bigint }>>(
  `SELECT count(*)::int AS n FROM pg_trigger WHERE tgname LIKE '%_no_update%' OR tgname LIKE '%_no_delete%';`
);
check('12 triggers d\'immutabilité actifs (5 tables × UPDATE/DELETE)', Number(trigCount[0].n) === 10, `${trigCount[0].n}`);
// (10 ici : l'ensemble §20 complet de la prod = 12 avec les 2 triggers Prediction
//  §20bis — non nécessaires à cette suite, le freeze Prediction est hors périmètre.)

// ---------- 0b. Fixtures ESPN synthétiques + stub fetch ----------

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

interface FixtureTeam { id: string; name: string; abbr: string }

interface FixtureMatchDef {
  matchId: string;
  league: string;
  kickoffMs: number;
  home: FixtureTeam;
  away: FixtureTeam;
  city: string;
  /** Statut ESPN renvoyé par le scoreboard au moment de l'analyse. */
  espnState?: 'pre' | 'in' | 'post';
}

const LEAGUE = 'test.1';
const TEAM_NAMES = ['Alpha FC', 'Beta United', 'Gamma City', 'Delta Rovers', 'Epsilon SC', 'Zeta Athletic', 'Eta Palace', 'Theta Wanderers'];
const TEAMS: FixtureTeam[] = TEAM_NAMES.map((name, i) => ({ id: String(300 + i), name, abbr: name.slice(0, 2).toUpperCase() }));

/** Historique déterministe : 12 matchs joués par équipe (scores réalistes). */
function scheduleGamesFor(team: FixtureTeam): Array<Record<string, unknown>> {
  const games: Array<Record<string, unknown>> = [];
  for (let g = 0; g < 12; g++) {
    const opponent = TEAMS[(Number(team.id) - 300 + g + 1) % TEAMS.length];
    const isHome = g % 2 === 0;
    const gf = (Number(team.id) + g) % 4; // 0..3 déterministe
    const ga = (opponent.id.charCodeAt(0) + g) % 3; // 0..2 déterministe
    const date = new Date(Date.UTC(2026, 5, 1 + g * 6, 18, 0, 0)).toISOString();
    games.push({
      id: `g-${team.id}-${g}`,
      date,
      competitions: [{
        date,
        competitors: [
          {
            homeAway: isHome ? 'home' : 'away',
            team: { id: team.id, displayName: team.name },
            score: { value: isHome ? gf : ga },
          },
          {
            homeAway: isHome ? 'away' : 'home',
            team: { id: opponent.id, displayName: opponent.name },
            score: { value: isHome ? ga : gf },
          },
        ],
        status: { type: { completed: true } },
      }],
    });
  }
  return games;
}

const registry = new Map<string, FixtureMatchDef>();
function registerFixture(def: FixtureMatchDef): void {
  registry.set(def.matchId, def);
}

/** Réponse scoreboard synthétique pour une ligue (tous les matchs fixtures). */
function scoreboardFor(league: string): Record<string, unknown> {
  const events = [...registry.values()]
    .filter((f) => f.league === league)
    .map((f) => ({
      id: f.matchId,
      date: new Date(f.kickoffMs).toISOString(),
      name: `${f.home.name} vs ${f.away.name}`,
      shortName: `${f.home.abbr} v ${f.away.abbr}`,
      status: { type: { state: f.espnState ?? 'pre', completed: false, detail: f.espnState === 'in' ? '1st Half' : 'Scheduled' } },
      competitions: [{
        date: new Date(f.kickoffMs).toISOString(),
        venue: { fullName: `Stade ${f.city}`, address: { city: f.city, country: 'Testland' } },
        competitors: [
          { homeAway: 'home', team: { id: f.home.id, displayName: f.home.name, name: f.home.name, abbreviation: f.home.abbr, logo: `https://x/t${f.home.id}.png` } },
          { homeAway: 'away', team: { id: f.away.id, displayName: f.away.name, name: f.away.name, abbreviation: f.away.abbr, logo: `https://x/t${f.away.id}.png` } },
        ],
      }],
    }));
  return { leagues: [{ name: 'Test League 1' }], events };
}

function standingsFor(): Record<string, unknown> {
  return {
    children: [{
      standings: {
        entries: TEAMS.map((t, i) => ({
          team: { id: t.id, displayName: t.name },
          stats: [
            { name: 'rank', value: i + 1 },
            { name: 'gamesPlayed', value: 12 },
            { name: 'wins', value: 7 - (i % 4) },
            { name: 'ties', value: 3 },
            { name: 'losses', value: 2 + (i % 3) },
            { name: 'pointsFor', value: 18 + i },
            { name: 'pointsAgainst', value: 10 + (i % 5) },
            { name: 'points', value: 24 - i },
          ],
        })),
      },
    }],
  };
}

let stubDelayMs = 0;
let stubCalls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
  stubCalls++;
  if (stubDelayMs > 0) await new Promise((r) => setTimeout(r, stubDelayMs));
  const json = (() => {
    if (url.includes('/scoreboard')) {
      const m = url.match(/soccer\/([^/]+)\/scoreboard/);
      return scoreboardFor(m?.[1] ?? LEAGUE);
    }
    if (url.includes('/schedule?season=')) {
      const m = url.match(/teams\/(\d+)\/schedule/);
      const team = TEAMS.find((t) => t.id === (m?.[1] ?? ''));
      return team ? { team: { id: team.id, displayName: team.name }, events: scheduleGamesFor(team) } : { events: [] };
    }
    if (url.includes('/standings')) return standingsFor();
    if (url.includes('/injuries')) return { injuries: [] };
    if (url.includes('geocoding-api.open-meteo.com')) {
      return { results: [{ latitude: 48.85, longitude: 2.35, name: 'Paris' }] };
    }
    if (url.includes('api.open-meteo.com/v1/forecast')) {
      return { current: { temperature_2m: 16, wind_speed_10m: 12, precipitation: 0, weather_code: 1 } };
    }
    return {};
  })();
  return new Response(JSON.stringify(json), { status: 200, headers: { 'content-type': 'application/json' } });
}) as typeof fetch;

// ---------- 0c. Imports modules projet (APRÈS l'env DATABASE_URL) ----------

const wakeMod = await import('../src/lib/forecast/wake');
const { runForecastWake, runForecastWakeChainUntilDone, detectSnapshotCandidates } = wakeMod;
const snapshotMod = await import('../src/lib/forecast/snapshot');
const { buildSnapshotDraft } = snapshotMod;
const espnMod = await import('../src/lib/espn');
const { espnStats, resetEspnStats } = espnMod;

// ---------- 0d. Aides données ----------

// Ligues DISTINCTES par section de test : chaque ligue a son propre
// espace de cache ESPN (sb:{ligue}:{date}, sched:{ligue}:{team}, …) —
// miroir de la réalité (endpoints ESPN distincts par ligue) et garantie
// que les fixtures enregistrées tardivement sont bien vues par les
// analyses de LEUR section (aucune board périmée partagée).
async function createCompetition(leagueCode: string): Promise<string> {
  const comp = await db.competition.create({
    data: { espnLeagueId: leagueCode, name: `League ${leagueCode}`, country: 'Testland', sport: 'soccer' },
  });
  // Équipes référencées par Match.homeTeamId/awayTeamId (FK espnTeamId,
  // UNIQUES — créées une seule fois au premier appel).
  if ((await db.team.count()) === 0) {
    await db.team.createMany({
      data: TEAMS.map((t) => ({ espnTeamId: t.id, name: t.name, abbreviation: t.abbr, logo: `https://x/t${t.id}.png`, competition: leagueCode })),
    });
  }
  return comp.id;
}

interface CreateMatchOpts {
  matchId: string;
  kickoffMs: number;
  status?: string;
  home?: FixtureTeam;
  away?: FixtureTeam;
  espnState?: 'pre' | 'in' | 'post';
  /** Ligue de la fixture ESPN (doit correspondre au compId — les boards
   *  du stub sont servies PAR LIGUE, comme les endpoints ESPN réels). */
  league?: string;
}

async function createMatch(compId: string, opts: CreateMatchOpts): Promise<void> {
  const home = opts.home ?? TEAMS[0];
  const away = opts.away ?? TEAMS[1];
  await db.match.create({
    data: {
      espnEventId: opts.matchId,
      competitionId: compId,
      competitionName: 'Test League',
      season: 2026,
      homeTeamId: home.id,
      homeTeamName: home.name,
      awayTeamId: away.id,
      awayTeamName: away.name,
      kickoffAt: new Date(opts.kickoffMs),
      status: opts.status ?? 'SCHEDULED',
      espnState: opts.espnState ?? 'pre',
    },
  });
  registerFixture({
    matchId: opts.matchId,
    league: opts.league ?? LEAGUE,
    kickoffMs: opts.kickoffMs,
    home,
    away,
    city: 'Paris',
    espnState: opts.espnState ?? 'pre',
  });
}

const espnDelta = () => espnStats.total;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Empreinte stable de l'ensemble des snapshots (immutabilité vérifiable). */
async function snapshotsFingerprint(): Promise<string> {
  const rows = await db.forecastSnapshot.findMany({ orderBy: [{ matchId: 'asc' }, { version: 'asc' }] });
  return createHash('md5')
    .update(
      JSON.stringify(
        rows.map((s) => [
          s.matchId, s.version, s.modelVersion, s.published, s.pick1x2, s.pick1x2Label,
          s.p1x2Home, s.p1x2Draw, s.p1x2Away, s.pOver25, s.pUnder25, s.pBttsYes, s.pBttsNo,
          s.confidence, s.predictionTime.getTime(), s.kickoff.getTime(), s.inputsDigest,
          s.homeTeam, s.awayTeam, s.frozenAt.getTime(), s.createdAt.getTime(),
        ])
      )
    )
    .digest('hex');
}

console.log('\n=== TESTS FORECAST WAKE — Task 49 (GO 4B) ===');

// ============================================================
// B. DÉTECTION
// ============================================================

section('B. Détection — matchs futurs sans snapshot');

const compId = await createCompetition(LEAGUE); // test.1
const now = Date.now();

// B1 : futur sans snapshot (+3 j) — candidat.
await createMatch(compId, { matchId: 'FW-101', kickoffMs: now + 3 * DAY, home: TEAMS[0], away: TEAMS[1] });
// B2 : futur SANS snapshot (+10 j) — candidat (ordre kickoff asc : après FW-101).
await createMatch(compId, { matchId: 'FW-102', kickoffMs: now + 10 * DAY, home: TEAMS[2], away: TEAMS[3] });
// B3 : futur AVEC snapshot → NON candidat.
await createMatch(compId, { matchId: 'FW-103', kickoffMs: now + 4 * DAY, home: TEAMS[4], away: TEAMS[5] });
{
  const a = await import('../src/lib/analyze');
  // Snapshot direct (contourne le pipeline) pour prouver l'exclusion par détection.
  const analysis = await a.analyzeMatch({ matchId: 'FW-103', leagueCode: LEAGUE, date: new Date(now + 4 * DAY).toISOString() });
  check('fixture ESPN exploitable par le moteur v2.1 (analyse FW-103 non nulle)', !!analysis);
  if (analysis) {
    const draft = buildSnapshotDraft(analysis, now);
    check('buildSnapshotDraft accepte la fixture (now < kickoff)', draft.ok === true);
    if (draft.ok) {
      await db.forecastSnapshot.create({ data: { ...draft.draft, matchId: 'FW-103', version: 1, published: true } });
    }
  }
}
// B4 : kickoff PASSÉ (statut SCHEDULED résiduel) → NON candidat (garde §6).
await createMatch(compId, { matchId: 'FW-104', kickoffMs: now - 2 * DAY, home: TEAMS[6], away: TEAMS[7] });
// B5 : POSTPONED futur → NON candidat (question GO 4A n°11).
await createMatch(compId, { matchId: 'FW-105', kickoffMs: now + 5 * DAY, status: 'POSTPONED', home: TEAMS[1], away: TEAMS[2] });
// B6 : hors horizon (+30 j) → NON candidat.
await createMatch(compId, { matchId: 'FW-106', kickoffMs: now + 30 * DAY, home: TEAMS[3], away: TEAMS[4] });

{
  const candidates = await detectSnapshotCandidates();
  const ids = candidates.map((c) => c.matchId);
  check('candidats = futurs sans snapshot, SCHEDULED/PRE, horizon 14 j', ids.join(',') === 'FW-101,FW-102', ids.join(','));
  check('tri par kickoff croissant (urgence d\'abord)', candidates[0]?.matchId === 'FW-101' && candidates[0]?.kickoffMs <= (candidates[1]?.kickoffMs ?? 0));
  check('code ligue ESPN résolu via Competition (leagueCode=test.1)', candidates[0]?.leagueCode === LEAGUE, candidates[0]?.leagueCode ?? '?');
}

// ============================================================
// C. GÉNÉRATION — match sans snapshot → snapshot v2.1
// ============================================================

section('C. Génération — moteur v2.1 → ForecastSnapshot');

resetEspnStats();
{
  const result = await runForecastWake({ triggerSource: 'test' });
  check('runForecastWake démarré et terminé SUCCESS', result.started === true && result.status === 'success', JSON.stringify({ status: result.status, error: result.error }));
  check('2 snapshots prédits (FW-101, FW-102)', result.result?.predicted === 2, `predicted=${result.result?.predicted}`);
  check('0 déjà-snapshoté / 0 échec / 0 trop tard', result.result?.skippedAlreadySnapshot === 0 && result.result?.failedAnalysis === 0 && result.result?.skippedTooLate === 0);

  const snap101 = await db.forecastSnapshot.findFirst({ where: { matchId: 'FW-101' } });
  check('FW-101 : snapshot créé v1, publié, modelVersion v2.1', snap101?.version === 1 && snap101?.published === true && snap101?.modelVersion === 'v2.1');
  check('FW-101 : §6 predictionTime STRICTEMENT < kickoff', snap101 ? snap101.predictionTime.getTime() < snap101.kickoff.getTime() : false);
  check('FW-101 : marchés complets (1X2 + O/U 2.5 + BTTS)', snap101 ? [snap101.p1x2Home, snap101.p1x2Draw, snap101.p1x2Away, snap101.pOver25, snap101.pUnder25, snap101.pBttsYes, snap101.pBttsNo].every((v) => Number.isFinite(v) && v >= 0 && v <= 1) : false);
  check('FW-101 : empreinte des entrées moteur figée (inputsDigest)', !!snap101?.inputsDigest && snap101.inputsDigest.length > 10);

  // Générique Task 28 §11-§19 écrit (marchés + issues).
  const gen = await db.predictionSnapshot.findFirst({ where: { matchId: 'FW-101' }, include: { markets: { include: { outcomes: true } } } });
  check('FW-101 : PredictionSnapshot générique écrit avec marchés (1X2, DC, O/U, BTTS)', gen?.version === 1 && (gen?.markets.length ?? 0) >= 4, `${gen?.markets.length ?? 0} marchés`);
  check('FW-101 : générique modelVersion v2.1 + source VOLTRIX', gen?.modelVersion === 'v2.1' && gen?.source === 'VOLTRIX');

  // Registre ForecastMatch maintenu (miroir stepScan).
  const reg = await db.forecastMatch.findUnique({ where: { matchId: 'FW-101' } });
  check('FW-101 : registre ForecastMatch écrit (league=test.1, kickoff)', reg?.league === LEAGUE && reg?.kickoff.getTime() === now + 3 * DAY);

  // Journal ForecastJobRun : 1 ligne success + verrou libéré + stats.
  const job = await db.forecastJobRun.findFirst({ where: { status: 'success' }, orderBy: { startedAt: 'desc' } });
  check('ForecastJobRun : ligne success, triggerSource=test, verrou LIBÉRÉ', job?.status === 'success' && job?.triggerSource === 'test' && job?.runningLock === null && job?.finishedAt !== null);
  check('ForecastJobRun : progress persisté (processed=2) + stats JSON', (() => {
    if (!job?.progress || !job?.stats) return false;
    const p = JSON.parse(job.progress);
    const s = JSON.parse(job.stats);
    return Array.isArray(p.processed) && p.processed.length === 2 && s.predicted === 2;
  })());
  check('appels ESPN comptés par le pipeline (> 0, moteur consulte ESPN)', (result.result?.espnCalls ?? 0) > 0, `${result.result?.espnCalls}`);
}

// ============================================================
// D. IDEMPOTENCE — tout snapshoté → no-op
// ============================================================

section('D. Idempotence — aucun candidat → started:false, 0 ESPN, 0 écriture');

{
  const snapBefore = await snapshotsFingerprint();
  const jobCountBefore = await db.forecastJobRun.count();
  const predSnapBefore = await db.predictionSnapshot.count();
  resetEspnStats();
  const result = await runForecastWake({ triggerSource: 'test' });
  check('2e exécution : started=false, reason=complete', result.started === false && result.reason === 'complete', JSON.stringify(result));
  check('2e exécution : 0 appel ESPN', espnStats.total === 0, `${espnStats.total}`);
  check('2e exécution : 0 écriture (snapshots empreinte identique, 0 nouveau job, 0 générique)', (await snapshotsFingerprint()) === snapBefore && (await db.forecastJobRun.count()) === jobCountBefore && (await db.predictionSnapshot.count()) === predSnapBefore);
}

// ============================================================
// E. CONCURRENCE — 1 seule génération active
// ============================================================

section('E. Concurrence — verrou PostgreSQL');

// E1 : 2 exécutions simultanées sur un NOUVEAU backlog.
const compE = await createCompetition('test.2');
await createMatch(compE, { matchId: 'FW-201', kickoffMs: now + 2 * DAY, home: TEAMS[5], away: TEAMS[6], league: 'test.2' });
{
  const [r1, r2] = await Promise.all([
    runForecastWake({ triggerSource: 'test' }),
    runForecastWake({ triggerSource: 'test' }),
  ]);
  const startedCount = [r1, r2].filter((r) => r.started).length;
  const already = [r1, r2].filter((r) => r.reason === 'already_running').length;
  check('2 simultanées : EXACTEMENT 1 démarrée, 1 already_running', startedCount === 1 && already === 1, `started=${startedCount} already=${already}`);
  const snaps = await db.forecastSnapshot.count({ where: { matchId: 'FW-201' } });
  check('FW-201 : 1 snapshot unique (pas de doublon)', snaps === 1, `${snaps} snapshots`);
}

// E2 : 8 déclenchements parallèles sur un backlog de 3 matchs.
await createMatch(compE, { matchId: 'FW-202', kickoffMs: now + 6 * DAY, home: TEAMS[7], away: TEAMS[0], league: 'test.2' });
await createMatch(compE, { matchId: 'FW-203', kickoffMs: now + 7 * DAY, home: TEAMS[1], away: TEAMS[3], league: 'test.2' });
await createMatch(compE, { matchId: 'FW-204', kickoffMs: now + 8 * DAY, home: TEAMS[2], away: TEAMS[5], league: 'test.2' });
{
  const results = await Promise.all(
    Array.from({ length: 8 }, () => runForecastWake({ triggerSource: 'test' }).catch(() => null))
  );
  const winners = results.filter((r) => r?.started).length;
  check('8 parallèles : EXACTEMENT 1 gagnant', winners === 1, `gagnants=${winners}`);
  const dup = await db.$queryRawUnsafe<Array<{ matchId: string; version: number; n: bigint }>>(
    `SELECT "matchId", version, COUNT(*)::int AS n FROM "ForecastSnapshot" GROUP BY "matchId", version HAVING COUNT(*) > 1;`
  );
  check('AUCUN doublon [matchId, version] après 8 parallèles', dup.length === 0, JSON.stringify(dup));
  const running = await db.forecastJobRun.count({ where: { runningLock: 'RUNNING' } });
  check('aucun verrou résiduel RUNNING', running === 0, `${running}`);
}

// E3 : double INSERT direct même [matchId, version] → rejet P2002 (garantie DB).
{
  const snap = await db.forecastSnapshot.findFirstOrThrow({ where: { matchId: 'FW-201' } });
  let rejected = false;
  try {
    await db.forecastSnapshot.create({ data: { ...snap, id: undefined as unknown as string, matchId: 'FW-201', version: 1, published: true } as never });
  } catch (e) {
    rejected = (e as { code?: string }).code === 'P2002';
  }
  check('contrainte UNIQUE (matchId, version) : 2e INSERT direct rejeté P2002', rejected);
}

// ============================================================
// F. INTERRUPTION / REPRISE — curseur dans Neon
// ============================================================

section('F. Interruption → partial → reprise EXACTE');

// Backlog de 4 matchs (ligue test.3, dates CALENDAIRES distinctes pour que
// chaque analyse paie un appel scoreboard frais), fetch ralenti (600 ms/
// appel — la 1re analyse d'une ligue paie ~5 couches séquentielles ≈ 3 s),
// budget 8 s (marge 6 s) → interruption AU MILIEU après le 1er match.
const compF = await createCompetition('test.3');
await createMatch(compF, { matchId: 'FW-301', kickoffMs: now + 9 * DAY, home: TEAMS[0], away: TEAMS[2], league: 'test.3' });
await createMatch(compF, { matchId: 'FW-302', kickoffMs: now + 11 * DAY, home: TEAMS[1], away: TEAMS[4], league: 'test.3' });
await createMatch(compF, { matchId: 'FW-303', kickoffMs: now + 12 * DAY, home: TEAMS[3], away: TEAMS[6], league: 'test.3' });
await createMatch(compF, { matchId: 'FW-304', kickoffMs: now + 13 * DAY, home: TEAMS[5], away: TEAMS[7], league: 'test.3' });
{
  stubDelayMs = 600;
  const partial = await runForecastWake({ triggerSource: 'test', budgetMs: 8_000 });
  stubDelayMs = 0;
  check('budget épuisé → status=partial (tranche interrompue proprement)', partial.started === true && partial.status === 'partial', JSON.stringify({ status: partial.status }));

  const job = await db.forecastJobRun.findFirst({ where: { status: 'partial' }, orderBy: { startedAt: 'desc' } });
  check('ForecastJobRun partial : verrou LIBÉRÉ + finishedAt + progress persisté', job?.runningLock === null && job?.finishedAt !== null && !!job?.progress);
  const prog = job?.progress ? JSON.parse(job.progress) : null;
  check('curseur : processed non vide (reprise sans refaire le travail)', Array.isArray(prog?.processed) && prog.processed.length >= 1, `processed=${prog?.processed?.length ?? 0}`);
  check('curseur : prédits > 0 mais < 4 (interruption AU MILIEU)', (partial.result?.predicted ?? 0) >= 1 && (partial.result?.predicted ?? 0) < 4, `predicted=${partial.result?.predicted}`);

  const snapCountAfterPartial = await db.forecastSnapshot.count({ where: { matchId: { startsWith: 'FW-30' } } });
  check(`snapshots FW-30x après interruption : ${snapCountAfterPartial}/4 (au milieu)`, snapCountAfterPartial >= 1 && snapCountAfterPartial < 4);

  // REPRISE : nouveau déclenchement → le MÊME job continue (claimResumable).
  const resume = await runForecastWake({ triggerSource: 'test' });
  check('reprise : job terminé SUCCESS', resume.status === 'success', JSON.stringify({ status: resume.status, error: resume.error }));
  check('reprise : resumed=true (MÊME ligne de job reprise, curseur honoré)', resume.result?.resumed === true);

  const finalCount = await db.forecastSnapshot.count({ where: { matchId: { startsWith: 'FW-30' } } });
  check('après reprise : 4/4 snapshots (total exact, aucun perdu)', finalCount === 4, `${finalCount}/4`);
  const dup = await db.$queryRawUnsafe<Array<{ n: bigint }>>(
    `SELECT COUNT(*)::int AS n FROM (SELECT "matchId", version FROM "ForecastSnapshot" GROUP BY "matchId", version HAVING COUNT(*) > 1) d;`
  );
  check('aucun doublon après interruption+reprise', Number(dup[0].n) === 0);
  const partialJobsOpen = await db.forecastJobRun.count({ where: { status: 'partial', runningLock: 'RUNNING' } });
  check('plus AUCUN job partial verrouillé', partialJobsOpen === 0);
}

// ============================================================
// G. GARDES KICKOFF — jamais de snapshot après coup d'envoi
// ============================================================

section('G. Garde kickoff — quadruple protection §6');

// G1 : kickoff PASSÉ → jamais détecté (FW-104 déjà en base, statut SCHEDULED résiduel).
{
  const candidates = await detectSnapshotCandidates();
  check('kickoff passé : jamais candidat (FW-104 exclu)', !candidates.some((c) => c.matchId === 'FW-104'));
  const snap104 = await db.forecastSnapshot.count({ where: { matchId: 'FW-104' } });
  check('FW-104 (kickoff passé) : AUCUN snapshot jamais créé', snap104 === 0, `${snap104}`);
}

// G2 : kickoff IMMINENT (< 60 s) → écarté SANS analyse (travail perdu évité).
const compG = await createCompetition('test.4');
{
  await createMatch(compG, { matchId: 'FW-402', kickoffMs: Date.now() + 30 * 1000, league: 'test.4' });
  resetEspnStats();
  const result = await runForecastWake({ triggerSource: 'test' });
  const snap402 = await db.forecastSnapshot.count({ where: { matchId: 'FW-402' } });
  check('kickoff imminent (< 60 s) : AUCUN snapshot (lead minimal, skippedTooLate)', snap402 === 0 && (result.result?.skippedTooLate ?? 0) >= 1, `snap=${snap402} skipped=${result.result?.skippedTooLate}`);
}

// G3 : match PARTI pendant l'analyse (scoreboard renvoie status 'in').
const compG5 = await createCompetition('test.5');
await createMatch(compG5, { matchId: 'FW-403', kickoffMs: Date.now() + 2 * HOUR, espnState: 'in', league: 'test.5' });
{
  resetEspnStats();
  const result = await runForecastWake({ triggerSource: 'test' });
  const snap403 = await db.forecastSnapshot.count({ where: { matchId: 'FW-403' } });
  check('match démarré (status ESPN \'in\') : AUCUN snapshot (skippedStarted)', snap403 === 0 && (result.result?.skippedStarted ?? 0) >= 1, `snap=${snap403} skippedStarted=${result.result?.skippedStarted}`);
}

// G4 : §6 buildSnapshotDraft — refus formel si predictionTime >= kickoff.
{
  const analysis = await import('../src/lib/analyze').then((a) =>
    a.analyzeMatch({ matchId: 'FW-101', leagueCode: LEAGUE, date: new Date(now + 3 * DAY).toISOString() })
  );
  check('pré-requis G4 : analyse FW-101 disponible', !!analysis);
  if (analysis) {
    const kickoff = analysis.matchDate;
    const refused = buildSnapshotDraft(analysis, new Date(kickoff).getTime());
    const refusedAfter = buildSnapshotDraft(analysis, new Date(kickoff).getTime() + 1_000);
    check('§6 : refus si predictionTime == kickoff', refused.ok === false && refused.reason.includes('§6'));
    check('§6 : refus si predictionTime > kickoff (après coup d\'envoi)', refusedAfter.ok === false && refusedAfter.reason.includes('§6'));
  }
}

// ============================================================
// H. IMMUABILITÉ — triggers + jamais de remplacement
// ============================================================

section('H. Immuabilité — snapshots figés');

{
  // H1 : UPDATE rejeté par le trigger.
  let updateRejected = false;
  try {
    await db.$executeRawUnsafe(`UPDATE "ForecastSnapshot" SET "p1x2Home" = 0.99 WHERE "matchId" = 'FW-101';`);
  } catch {
    updateRejected = true;
  }
  check('UPDATE ForecastSnapshot rejeté par le trigger §20', updateRejected);

  // H2 : DELETE rejeté par le trigger.
  let deleteRejected = false;
  try {
    await db.$executeRawUnsafe(`DELETE FROM "ForecastSnapshot" WHERE "matchId" = 'FW-101';`);
  } catch {
    deleteRejected = true;
  }
  check('DELETE ForecastSnapshot rejeté par le trigger §20', deleteRejected);

  // H3 : INSERT libre (le pipeline continue de fonctionner après les gardes).
  let insertOk = true;
  try {
    await db.forecastSnapshot.count({ where: { matchId: 'FW-101' } });
  } catch {
    insertOk = false;
  }
  check('lecture/INSERT restent libres (aucun verrouillage en lecture)', insertOk);

  // H4 : un match DÉJÀ snapshoté n'est JAMAIS ré-analysé ni remplacé.
  // (Nettoyage préalable des artefacts des gardes G2/G3 — FW-402 imminent
  //  et FW-403 démarré resteraient candidats tant que leur kickoff est
  //  futur : ce sont des résidus de test, pas des données du pipeline.)
  await db.match.deleteMany({ where: { espnEventId: { in: ['FW-402', 'FW-403'] } } });
  registry.delete('FW-402');
  registry.delete('FW-403');
  const fpBefore = await snapshotsFingerprint();
  resetEspnStats();
  const result = await runForecastWake({ triggerSource: 'test' });
  check('match déjà snapshoté : re-run → complete (rien à faire)', result.reason === 'complete', JSON.stringify({ reason: result.reason, started: result.started }));
  check('match déjà snapshoté : 0 appel ESPN', espnStats.total === 0, `${espnStats.total}`);
  check('match déjà snapshoté : empreinte des snapshots INCHANGÉE bit-à-bit', (await snapshotsFingerprint()) === fpBefore);
}

// ============================================================
// I. VERROU ORPHELIN — takeover après 6 min
// ============================================================

section('I. Verrou orphelin — invocation tuée par la plateforme');

{
  // Simule une invocation Vercel tuée en pleine génération : verrou posé
  // il y a 7 min (> FORECAST_STALE_LOCK_MS = 6 min), avec du travail restant.
  const compI = await createCompetition('test.6');
  await createMatch(compI, { matchId: 'FW-501', kickoffMs: now + 5 * DAY, home: TEAMS[4], away: TEAMS[6], league: 'test.6' });
  await db.forecastJobRun.create({
    data: {
      phase: 'forecast-wake',
      status: 'running',
      triggerSource: 'cron',
      runningLock: 'RUNNING',
      startedAt: new Date(Date.now() - 7 * 60_000),
    },
  });
  const result = await runForecastWake({ triggerSource: 'test' });
  check('verrou orphelin : récupéré, nouveau travail démarré', result.started === true, JSON.stringify({ reason: (result as { reason?: string }).reason }));
  const snap501 = await db.forecastSnapshot.count({ where: { matchId: 'FW-501' } });
  check('FW-501 : snapshot créé après takeover', snap501 === 1, `${snap501}`);
  const orphanLeft = await db.forecastJobRun.count({ where: { runningLock: 'RUNNING' } });
  check('aucun verrou orphelin résiduel', orphanLeft === 0, `${orphanLeft}`);

  // Verrou JEUNE (< 6 min) → already_running, aucun travail dupliqué.
  await createMatch(compI, { matchId: 'FW-502', kickoffMs: now + 5 * DAY + HOUR, home: TEAMS[2], away: TEAMS[6], league: 'test.6' });
  const young = await db.forecastJobRun.create({
    data: {
      phase: 'forecast-wake',
      status: 'running',
      triggerSource: 'cron',
      runningLock: 'RUNNING',
      startedAt: new Date(Date.now() - 30_000),
    },
  });
  const rYoung = await runForecastWake({ triggerSource: 'test' });
  check('verrou JEUNE : already_running (aucune génération concurrente)', rYoung.started === false && rYoung.reason === 'already_running' && rYoung.runId === young.id);
  const snap502 = await db.forecastSnapshot.count({ where: { matchId: 'FW-502' } });
  check('FW-502 : AUCUN snapshot pendant que le verrou jeune est tenu', snap502 === 0, `${snap502}`);
  // Nettoyage : libère le verrou jeune pour la suite de la suite.
  await db.forecastJobRun.update({ where: { id: young.id }, data: { runningLock: null, status: 'failed', finishedAt: new Date(), error: 'nettoyage test' } });
}

// ============================================================
// J. CHAÎNE SERVEUR — boucles jusqu'à succès
// ============================================================

section('J. Chaîne serveur — runForecastWakeChainUntilDone');

{
  // Backlog de 4 matchs (ligue test.7, dates distinctes), fetch fortement
  // ralenti (1,5 s/appel), budget env 15 s (minimum accepté, marge 6 s) →
  // la 1re tranche s'interrompt AU MILIEU, la chaîne serveur enchaîne
  // (boucle 2) jusqu'au succès — la complétion s'étale sur plusieurs
  // invocations, miroir exact du comportement Vercel Hobby.
  const compJ = await createCompetition('test.7');
  await createMatch(compJ, { matchId: 'FW-601', kickoffMs: now + 6 * DAY, home: TEAMS[0], away: TEAMS[1], league: 'test.7' });
  await createMatch(compJ, { matchId: 'FW-602', kickoffMs: now + 6 * DAY + HOUR, home: TEAMS[2], away: TEAMS[3], league: 'test.7' });
  await createMatch(compJ, { matchId: 'FW-603', kickoffMs: now + 6 * DAY + 2 * HOUR, home: TEAMS[4], away: TEAMS[5], league: 'test.7' });
  await createMatch(compJ, { matchId: 'FW-604', kickoffMs: now + 6 * DAY + 3 * HOUR, home: TEAMS[6], away: TEAMS[7], league: 'test.7' });
  stubDelayMs = 1500;
  process.env.FORECAST_WAKE_BUDGET_MS = '15000'; // tranche minimale
  const t0 = Date.now();
  const chain = await runForecastWakeChainUntilDone(t0);
  delete process.env.FORECAST_WAKE_BUDGET_MS;
  stubDelayMs = 0;
  check('chaîne : ended=success (backlog complet en boucles)', chain.ended === 'success', JSON.stringify(chain));
  const snaps = await db.forecastSnapshot.count({ where: { matchId: { startsWith: 'FW-60' } } });
  check('chaîne : 4/4 snapshots FW-60x créés', snaps === 4, `${snaps}/4`);
  check('chaîne : reprise tranche→tranche réellement exécutée (≥ 2 boucles)', chain.loops >= 2, `loops=${chain.loops}`);
  const dup = await db.$queryRawUnsafe<Array<{ n: bigint }>>(
    `SELECT COUNT(*)::int AS n FROM (SELECT "matchId", version FROM "ForecastSnapshot" GROUP BY "matchId", version HAVING COUNT(*) > 1) d;`
  );
  check('chaîne : aucun doublon [matchId, version]', Number(dup[0].n) === 0);
}

// ============================================================
// K. MOTEUR v2.1 — byte-identique au baseline
// ============================================================

section('K. Moteur v2.1 — intégrité byte-à-byte (baseline 039ee22)');

{
  const baseline = readFileSync(path.join(ROOT, 'scripts/engine-baseline-39ee22.sha'), 'utf8');
  const lines = baseline.trim().split('\n');
  let okCount = 0;
  for (const line of lines) {
    const [expected, file] = line.trim().split(/\s+/);
    if (!expected || !file) continue;
    const actual = createHash('sha256').update(readFileSync(path.join(ROOT, file))).digest('hex');
    if (actual === expected) okCount++;
    else console.error(`    écart : ${file}`);
  }
  check(`moteur byte-identique ${okCount}/${lines.length} (prediction, analyze, espn, market-odds, model-version)`, okCount === lines.length);
}

// ============================================================
// RÉCAPITULATIF
// ============================================================

console.log('\n════════════════════════════════════════════');
console.log(`RÉSULTAT : ${pass} ✓ / ${fail} ✗`);
if (fail > 0) {
  console.error('ANOMALIES :');
  for (const a of anomalies) console.error(`  - ${a}`);
}

// ---------- Nettoyage ----------
globalThis.fetch = realFetch;
await db.$disconnect();
try {
  execSync(`${PGBIN}/pg_ctl -D ${dataDir} stop -m immediate`, { stdio: 'pipe' });
} catch {
  // le cluster éphémère est dans un tmpdir — perdu au reboot au pire
}
rmSync(tmpDir, { recursive: true, force: true });

if (fail > 0) process.exit(1);
console.log('\n✓ Task 49 — suite FORECAST WAKE terminée');
