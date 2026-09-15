// ============================================================
// VOLTRIX bet — Task 29 : SYNCHRONISATION CONTEXTUELLE ESPN → NEON
//
// Centralise les entrées du moteur encore consultées en DIRECT sur ESPN,
// SANS toucher au moteur v2.1 (analyze.ts / prediction.ts restent intacts
// et continuent de lire ESPN — le basculement est une étape ultérieure).
//
// Périmètre (priorités utilisateur) :
//   1. CLASSEMENTS   → StandingsSnapshot   (1 ligne / ligue+season+équipe+JOUR)
//   2. BLESSURES     → InjurySnapshot      (1 ligne / ligue+équipe+joueur+JOUR)
//   3. HISTORIQUES   → sweep systématique des équipes des matchs à venir
//                      (calendriers 2 saisons → table Match, via
//                      syncTeamHistory) + traçabilité TeamHistorySyncState
//   5. MÉTÉO         → WeatherSnapshot     (facteur buts par match, Open-Meteo)
// (Priorité 4 — cotes open/close — est capturée dans ingestBatch, espn-sync.ts.)
//
// Propriétés (identiques au noyau Task 28) :
//   - IDEMPOTENT : contraintes d'unicité (jour UTC), re-run = update du jour ;
//   - HISTORISÉ : append-only par jour, aucune donnée supprimée ;
//   - Lié aux identifiants ESPN + horodaté (capturedAt / snapshotDate) ;
//   - Appels ESPN étiquetés source='sync' (voie d'ingestion légitime).
//
// RÈGLE D'ARCHITECTURE (héritée de espn-sync.ts) : ce module n'importe
// JAMAIS le moteur (prediction.ts) ni analyze.ts — cycle interdit.
// La saison est déduite de Competition.season (écrite par l'ingestion) avec
// repli sur la règle calendaire locale (copie documentée de analyze.ts).
// ============================================================

import { db } from '@/lib/db';
import { mapWithConcurrency } from '../cache';
import { logEspnCall } from '../espn';
import { fetchWeather } from '../weather';
import { syncTeamHistory } from './espn-sync';

// ---------- Réseau ESPN (convention espn.ts — UA curl, source='sync') ----------

const SITE = 'https://site.api.espn.com/apis/site/v2/sports/soccer';
const STANDINGS_URL = (league: string, season: number) =>
  `https://site.api.espn.com/apis/v2/sports/soccer/${league}/standings?season=${season}`;
const INJURIES_URL = (league: string) => `${SITE}/${league}/injuries`;

const ESPN_HEADERS: Record<string, string> = {
  'User-Agent': 'curl/8.5.0',
  Accept: 'application/json',
};

async function espnRawJson<T>(url: string, timeoutMs = 12_000, attempts = 2): Promise<T | null> {
  for (let i = 0; i < attempts; i++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      const res = await fetch(url, { headers: ESPN_HEADERS, cache: 'no-store', signal: ctrl.signal });
      clearTimeout(t);
      logEspnCall(url, 'sync', res.ok);
      if (!res.ok) continue;
      return (await res.json()) as T;
    } catch {
      logEspnCall(url, 'sync', false);
    }
  }
  return null;
}

// ---------- Saisons (copie LOCALE de la règle analyze.ts — import interdit) ----------

const CALENDAR_YEAR_LEAGUES: ReadonlySet<string> = new Set([
  'usa.1', 'usa.nwsl', 'bra.1', 'bra.2', 'arg.1', 'jpn.1', 'kor.1', 'chn.1',
  'nor.1', 'swe.1', 'fin.1', 'irl.1',
]);

/** Saison ESPN de référence pour une date donnée (même convention que le moteur). */
export function seasonForDate(leagueCode: string, d: Date): number {
  const year = d.getUTCFullYear();
  if (CALENDAR_YEAR_LEAGUES.has(leagueCode)) return year;
  const month = d.getUTCMonth() + 1;
  return month >= 7 ? year : year - 1;
}

/** Les 2 saisons consommées par le moteur (précédente + courante). */
export function engineSeasons(leagueCode: string, d: Date): number[] {
  const cur = seasonForDate(leagueCode, d);
  return [cur - 1, cur];
}

// ---------- Utilitaires ----------

/** Jour UTC courant (minuit) — clé d'idempotence des snapshots quotidiens. */
function utcDay(d = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

async function runChunked<T>(items: T[], size: number, fn: (item: T) => Promise<unknown>): Promise<number> {
  let n = 0;
  for (let i = 0; i < items.length; i += size) {
    const results = await Promise.allSettled(items.slice(i, i + size).map(fn));
    n += results.filter((r) => r.status === 'fulfilled').length;
  }
  return n;
}

// ---------- Priorité 1 : CLASSEMENTS ----------

interface RawStandings {
  children?: Array<{
    standings?: {
      entries?: Array<{
        team?: { id?: string; displayName?: string };
        stats?: Array<{ name?: string; value?: number }>;
      }>;
    };
  }>;
}

/**
 * Capture le classement COURANT d'une ligue dans StandingsSnapshot (jour UTC).
 * Idempotent : re-run le même jour = update des valeurs du jour, jamais de doublon.
 * Retourne le nombre de lignes écrites (créées + mises à jour).
 */
export async function syncStandingsLeague(leagueCode: string, season: number): Promise<number> {
  const raw = await espnRawJson<RawStandings>(STANDINGS_URL(leagueCode, season));
  const entries = raw?.children?.[0]?.standings?.entries ?? [];
  if (!entries.length) return 0;
  const day = utcDay();
  const capturedAt = new Date();

  type Row = { espnTeamId: string; teamName: string; rank: number | null; gamesPlayed: number; wins: number; ties: number; losses: number; pointsFor: number; pointsAgainst: number; points: number };
  const rows: Row[] = [];
  for (const e of entries) {
    if (!e.team?.id) continue;
    const stats = new Map<string, number | null>();
    for (const s of e.stats ?? []) stats.set(s.name ?? '', s.value ?? null);
    rows.push({
      espnTeamId: e.team.id,
      teamName: e.team.displayName ?? '',
      rank: stats.get('rank') ?? null,
      gamesPlayed: stats.get('gamesPlayed') ?? 0,
      wins: stats.get('wins') ?? 0,
      ties: stats.get('ties') ?? 0,
      losses: stats.get('losses') ?? 0,
      pointsFor: stats.get('pointsFor') ?? 0,
      pointsAgainst: stats.get('pointsAgainst') ?? 0,
      points: stats.get('points') ?? 0,
    });
  }
  if (!rows.length) return 0;

  const existing = await db.standingsSnapshot.findMany({
    where: { espnLeagueId: leagueCode, season, snapshotDate: day },
    select: { id: true, espnTeamId: true, rank: true, gamesPlayed: true, wins: true, ties: true, losses: true, pointsFor: true, pointsAgainst: true, points: true },
  });
  const exMap = new Map(existing.map((r) => [r.espnTeamId, r]));
  const toCreate = rows.filter((r) => !exMap.has(r.espnTeamId));
  const toUpdate = rows.filter((r) => {
    const prev = exMap.get(r.espnTeamId);
    if (!prev) return false;
    return (
      (prev.rank ?? null) !== r.rank ||
      prev.gamesPlayed !== r.gamesPlayed ||
      prev.wins !== r.wins || prev.ties !== r.ties || prev.losses !== r.losses ||
      prev.pointsFor !== r.pointsFor || prev.pointsAgainst !== r.pointsAgainst || prev.points !== r.points
    );
  });

  let written = 0;
  if (toCreate.length) {
    for (let i = 0; i < toCreate.length; i += 200) {
      await db.standingsSnapshot
        .createMany({
          data: toCreate.slice(i, i + 200).map((r) => ({ ...r, espnLeagueId: leagueCode, season, snapshotDate: day, capturedAt, source: 'ESPN' })),
          skipDuplicates: true,
        })
        .catch(() => {});
    }
    written += toCreate.length;
  }
  if (toUpdate.length) {
    written += await runChunked(toUpdate, 10, (r) =>
      db.standingsSnapshot.update({
        where: { espnLeagueId_season_espnTeamId_snapshotDate: { espnLeagueId: leagueCode, season, espnTeamId: r.espnTeamId, snapshotDate: day } },
        data: { rank: r.rank, gamesPlayed: r.gamesPlayed, wins: r.wins, ties: r.ties, losses: r.losses, pointsFor: r.pointsFor, pointsAgainst: r.pointsAgainst, points: r.points, capturedAt },
      })
    );
  }
  return written;
}

// ---------- Priorité 2 : BLESSURES ----------

interface RawInjuries {
  injuries?: Array<{
    team?: { id?: string };
    injuries?: Array<{
      athlete?: { displayName?: string; position?: { abbreviation?: string } };
      status?: string;
    }>;
  }>;
}

/**
 * Capture les blessés ACTIFS d'une ligue dans InjurySnapshot (jour UTC).
 * Append-only par jour : une blessure guérie reste lisible dans l'historique.
 */
export async function syncInjuriesLeague(leagueCode: string): Promise<number> {
  const raw = await espnRawJson<RawInjuries>(INJURIES_URL(leagueCode));
  const groups = raw?.injuries ?? [];
  if (!groups.length) return 0;
  const day = utcDay();
  const capturedAt = new Date();

  type Row = { espnTeamId: string; playerName: string; position: string | null; status: string | null };
  const rows: Row[] = [];
  for (const group of groups) {
    const teamId = group.team?.id ?? '';
    if (!teamId) continue;
    for (const inj of group.injuries ?? []) {
      const name = inj.athlete?.displayName ?? '';
      if (!name) continue;
      rows.push({ espnTeamId: teamId, playerName: name, position: inj.athlete?.position?.abbreviation ?? null, status: inj.status ?? null });
    }
  }
  if (!rows.length) return 0;

  const existing = await db.injurySnapshot.findMany({
    where: { espnLeagueId: leagueCode, snapshotDate: day },
    select: { id: true, espnTeamId: true, playerName: true, position: true, status: true },
  });
  const exMap = new Map(existing.map((r) => [`${r.espnTeamId}|${r.playerName}`, r]));
  const toCreate = rows.filter((r) => !exMap.has(`${r.espnTeamId}|${r.playerName}`));
  const toUpdate = rows.filter((r) => {
    const prev = exMap.get(`${r.espnTeamId}|${r.playerName}`);
    if (!prev) return false;
    return (prev.position ?? null) !== (r.position ?? null) || (prev.status ?? null) !== (r.status ?? null);
  });

  let written = 0;
  if (toCreate.length) {
    for (let i = 0; i < toCreate.length; i += 200) {
      await db.injurySnapshot
        .createMany({
          data: toCreate.slice(i, i + 200).map((r) => ({ ...r, espnLeagueId: leagueCode, snapshotDate: day, capturedAt, source: 'ESPN' })),
          skipDuplicates: true,
        })
        .catch(() => {});
    }
    written += toCreate.length;
  }
  if (toUpdate.length) {
    written += await runChunked(toUpdate, 10, (r) =>
      db.injurySnapshot.update({
        where: { espnLeagueId_espnTeamId_playerName_snapshotDate: { espnLeagueId: leagueCode, espnTeamId: r.espnTeamId, playerName: r.playerName, snapshotDate: day } },
        data: { position: r.position, status: r.status, capturedAt },
      })
    );
  }
  return written;
}

// ---------- Priorité 5 : MÉTÉO (Open-Meteo — pas ESPN) ----------

/**
 * Capture la météo (facteur buts) des matchs à venir < 48 h disposant d'une
 * ville. Une capture par match et par jour UTC (re-run = skip) — la valeur
 * persistée est celle qui SERT aux prédictions du jour (replay possible).
 */
export async function captureWeatherUpcoming(): Promise<number> {
  const now = Date.now();
  const soon = await db.match.findMany({
    where: {
      kickoffAt: { gte: new Date(now), lte: new Date(now + 48 * 3_600_000) },
      status: { in: ['SCHEDULED', 'PRE'] },
      venueCity: { not: null },
    },
    select: { espnEventId: true, venueCity: true, venueCountry: true },
    take: 300,
  });
  if (!soon.length) return 0;

  const dayStart = utcDay();
  const already = await db.weatherSnapshot.findMany({
    where: { espnEventId: { in: soon.map((m) => m.espnEventId) }, capturedAt: { gte: dayStart } },
    select: { espnEventId: true },
  });
  const done = new Set(already.map((w) => w.espnEventId));
  const todo = soon.filter((m) => !done.has(m.espnEventId));
  if (!todo.length) return 0;

  let captured = 0;
  await mapWithConcurrency(todo, 3, async (m) => {
    try {
      const w = await fetchWeather(m.venueCity, m.venueCountry);
      if (!w) return;
      await db.weatherSnapshot.create({
        data: {
          espnEventId: m.espnEventId,
          city: m.venueCity,
          country: m.venueCountry,
          tempC: w.tempC,
          windKmh: w.windKmh,
          precipitationMm: w.precipitationMm,
          weatherCode: null,
          description: w.description,
          goalsFactor: w.goalsFactor,
          capturedAt: new Date(),
          source: 'Open-Meteo',
        },
      });
      captured++;
    } catch {
      // tolérant : la météo se rattrapera au prochain passage
    }
  });
  return captured;
}

// ---------- Priorité 3 : SWEEP SYSTÉMATIQUE DES HISTORIQUES ÉQUIPES ----------

const TEAM_SWEEP_TTL_MS = 24 * 3_600_000; // une équipe resynchronisée au max toutes les 24 h par le sweep

/**
 * Couverture SYSTÉMATIQUE des historiques d'équipes (fini le 4/cycle opaque) :
 * parcourt les équipes des matchs à venir (< 7 jours), resynchronise celles
 * dont l'état est périmé (> 24 h) dans la limite du budget, et trace chaque
 * équipe dans TeamHistorySyncState (idempotent par espnTeamId).
 */
export async function sweepTeamHistory(budget = 40): Promise<{ teams: number; imported: number }> {
  const now = Date.now();
  const upcoming = await db.match.findMany({
    where: { kickoffAt: { gte: new Date(now - 3_600_000), lte: new Date(now + 7 * 24 * 3_600_000) }, homeTeamId: { not: null }, awayTeamId: { not: null } },
    orderBy: { kickoffAt: 'asc' },
    take: 400,
    select: { competitionId: true, homeTeamId: true, homeTeamName: true, awayTeamId: true, awayTeamName: true },
  });
  if (!upcoming.length) return { teams: 0, imported: 0 };

  const compIds = [...new Set(upcoming.map((m) => m.competitionId).filter((x): x is string => !!x))];
  const comps = compIds.length
    ? await db.competition.findMany({ where: { id: { in: compIds } }, select: { id: true, espnLeagueId: true } })
    : [];
  const leagueById = new Map(comps.map((c) => [c.id, c.espnLeagueId]));

  // file d'équipes ordonnée par kickoff (dédupe par ID)
  const queue: Array<{ teamId: string; teamName: string; league: string }> = [];
  const seen = new Set<string>();
  for (const m of upcoming) {
    const league = m.competitionId ? leagueById.get(m.competitionId) : null;
    if (!league) continue;
    for (const [tid, tname] of [[m.homeTeamId!, m.homeTeamName], [m.awayTeamId!, m.awayTeamName]] as const) {
      if (seen.has(tid)) continue;
      seen.add(tid);
      queue.push({ teamId: tid, teamName: tname, league });
    }
  }
  if (!queue.length) return { teams: 0, imported: 0 };

  const states = await db.teamHistorySyncState.findMany({
    where: { espnTeamId: { in: queue.map((q) => q.teamId) } },
    select: { espnTeamId: true, lastSyncedAt: true },
  });
  const staleAt = new Map(states.map((s) => [s.espnTeamId, s.lastSyncedAt?.getTime() ?? 0]));
  const stale = queue.filter((q) => now - (staleAt.get(q.teamId) ?? 0) > TEAM_SWEEP_TTL_MS);
  const batch = stale.slice(0, budget);
  if (!batch.length) return { teams: 0, imported: 0 };

  let imported = 0;
  for (const q of batch) {
    const seasons = engineSeasons(q.league, new Date());
    let n = 0;
    let result = 'ok';
    try {
      n = await syncTeamHistory(q.league, q.teamId, q.teamName, seasons);
      if (n <= 0) result = 'vide';
      imported += Math.max(n, 0);
    } catch {
      result = 'échec';
    }
    await db.teamHistorySyncState
      .upsert({
        where: { espnTeamId: q.teamId },
        create: { espnTeamId: q.teamId, leagueCode: q.league, teamName: q.teamName, seasonsSynced: seasons.join(','), matchesImported: Math.max(n, 0), lastSyncedAt: new Date(), lastResult: result },
        update: { leagueCode: q.league, teamName: q.teamName, seasonsSynced: seasons.join(','), matchesImported: { increment: Math.max(n, 0) }, lastSyncedAt: new Date(), lastResult: result },
      })
      .catch(() => {});
  }
  return { teams: batch.length, imported };
}

// ---------- Orchestrateur ----------

export interface ContextSyncStats {
  leaguesTotal: number;
  leaguesFailed: number;
  standingsUpserted: number;
  injuriesUpserted: number;
  weatherCaptured: number;
  teamHistoryTeams: number;
  teamHistoryImported: number;
  startedAt: string;
  durationMs: number;
}

/**
 * Cycle contextuel complet : standings + blessures des ligues actives
 * (matchs dans [-1 j ; +14 j]), météo des matchs < 48 h, sweep historiques.
 * Journalisé dans SyncJobRun (phase='context').
 */
export async function runContextSync(opts?: { teamBudget?: number; phase?: string }): Promise<ContextSyncStats> {
  const t0 = Date.now();
  const stats: ContextSyncStats = {
    leaguesTotal: 0,
    leaguesFailed: 0,
    standingsUpserted: 0,
    injuriesUpserted: 0,
    weatherCaptured: 0,
    teamHistoryTeams: 0,
    teamHistoryImported: 0,
    startedAt: new Date(t0).toISOString(),
    durationMs: 0,
  };

  // Ligues actives = compétitions avec des matchs dans la fenêtre utile.
  const now = new Date();
  const active = await db.competition.findMany({
    where: { matches: { some: { kickoffAt: { gte: new Date(now.getTime() - 24 * 3_600_000), lte: new Date(now.getTime() + 14 * 24 * 3_600_000) } } } },
    select: { espnLeagueId: true, season: true },
  });
  stats.leaguesTotal = active.length;

  await mapWithConcurrency(active, 4, async (comp) => {
    try {
      const season = comp.season ?? seasonForDate(comp.espnLeagueId, now);
      stats.standingsUpserted += await syncStandingsLeague(comp.espnLeagueId, season);
    } catch {
      stats.leaguesFailed++;
    }
    try {
      stats.injuriesUpserted += await syncInjuriesLeague(comp.espnLeagueId);
    } catch {
      // tolérant : blessures rattrapées au cycle suivant
    }
  });

  try {
    stats.weatherCaptured = await captureWeatherUpcoming();
  } catch {
    // tolérant
  }
  try {
    const sweep = await sweepTeamHistory(opts?.teamBudget ?? 40);
    stats.teamHistoryTeams = sweep.teams;
    stats.teamHistoryImported = sweep.imported;
  } catch {
    // tolérant
  }

  stats.durationMs = Date.now() - t0;
  try {
    await db.syncJobRun.create({
      data: { startedAt: new Date(t0), finishedAt: new Date(), phase: opts?.phase ?? 'context', stats: JSON.stringify(stats) },
    });
  } catch {
    // le journal ne doit jamais faire échouer la synchronisation
  }
  return stats;
}
