// ============================================================
// VOLTRIX bet — API /api/matches
// Task 28-b — CENTRALISATION NEON : la liste des matchs vient
// DÉSORMAIS de la table centrale `Match` (Neon PostgreSQL),
// synchronisée ESPN → Neon (idempotent par espn_event_id).
// AUCUN appel ESPN à la consultation : la boucle de synchronisation
// (sync-job : backfill 21 j / cycle 10 min / live 90 s) est la seule
// voie d'entrée des données. L'historique n'est JAMAIS supprimé —
// la route filtre par FENÊTRE TEMPORELLE (journée calendaire UTC
// stricte [JJ 00:00 → JJ+1 00:00), règle Task 14) et par statut.
//   - Fenêtre UTC : protège toutes les pages (accueil, combiné,
//     vente) du débordement EDT d'ESPN (Task 14).
//   - Forme (W/D/L) dérivée de l'HISTORIQUE FINAL en base
//     (5 derniers matchs, du plus ancien au plus récent).
//   - Cotes : dernières captures OddsSnapshot (1X2 + ligne O/U).
// + cache de réponse serveur (stale-while-revalidate), single-flight
//   des requêtes concurrentes et préchauffage en tâche de fond.
// MOTEUR v2.1 : AUCUN rapport — cette route ne touche aucune
// formule/pondération/logique prédictive.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { LEAGUES, type LeagueDef } from '@/lib/leagues';
import { db } from '@/lib/db';
import { ensureSyncLoop } from '@/lib/sync/sync-job';
import { rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface LightMatch {
  id: string;
  leagueCode: string;
  leagueName: string;
  leagueShort: string;
  region: string;
  date: string;
  status: 'pre' | 'in' | 'post';
  statusDetail: string;
  home: {
    id: string; name: string; shortName: string; logo: string | null;
    score: number | null; form: string | null; record: string | null;
  };
  away: {
    id: string; name: string; shortName: string; logo: string | null;
    score: number | null; form: string | null; record: string | null;
  };
  hasOdds: boolean;
  oddsProvider: string | null;
  ouLine: number | null;
  mlHome: number | null;
  mlDraw: number | null;
  mlAway: number | null;
  venue: { name: string | null; city: string | null; country: string | null };
}

// ---------- Cache de réponse (lecture Neon rapide, mais cohérence
// des rafraîchissements live 90 s conservée) ----------
// Fraîcheur : 60 s le jour J (scores live), 5 min pour les autres dates.
// Grâce "stale" : au-delà de la fraîcheur, la copie est encore servie
// instantanément (jusqu'à +30 s / +2 min) pendant qu'une relecture part en fond.
const FRESH_TTL_TODAY_MS = 60 * 1000;
const FRESH_TTL_OTHER_MS = 5 * 60 * 1000;
const STALE_GRACE_TODAY_MS = 30 * 1000;
const STALE_GRACE_OTHER_MS = 2 * 60 * 1000;
// Intervalle de préchauffage : la journée du jour est relue toutes les 5 min.
const WARM_INTERVAL_MS = 5 * 60 * 1000;
// Éviction du cache : on ne garde jamais plus de 8 journées en mémoire.
const MAX_CACHED_DATES = 8;

interface ResponseEntry {
  body: string;
  scannedAt: number;
  freshUntil: number;
  staleUntil: number;
}

interface ScanResult {
  body: string;
  totalMatches: number;
}

// Stockage accroché à globalThis : survit au hot-reload dev.
const g = globalThis as unknown as {
  __voltrixMatchesBodies?: Map<string, ResponseEntry>;
  __voltrixMatchesInFlight?: Map<string, Promise<StructuredScan>>;
  __voltrixMatchesWarming?: Set<string>;
  __voltrixMatchesWarmer?: unknown;
};

const bodies = (g.__voltrixMatchesBodies ??= new Map<string, ResponseEntry>());
const inFlight = (g.__voltrixMatchesInFlight ??= new Map<string, Promise<StructuredScan>>());
const warming = (g.__voltrixMatchesWarming ??= new Set<string>());

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function ttlsFor(dateParam: string): { fresh: number; stale: number } {
  return dateParam === todayISO()
    ? { fresh: FRESH_TTL_TODAY_MS, stale: STALE_GRACE_TODAY_MS }
    : { fresh: FRESH_TTL_OTHER_MS, stale: STALE_GRACE_OTHER_MS };
}

function storeResult(dateParam: string, result: ScanResult): void {
  const now = Date.now();
  const { fresh, stale } = ttlsFor(dateParam);
  bodies.set(dateParam, {
    body: result.body,
    scannedAt: now,
    freshUntil: now + fresh,
    staleUntil: now + fresh + stale,
  });
  if (bodies.size > MAX_CACHED_DATES) {
    const oldest = [...bodies.entries()].sort((a, b) => a[1].scannedAt - b[1].scannedAt);
    for (let i = 0; i < bodies.size - MAX_CACHED_DATES; i++) bodies.delete(oldest[i][0]);
  }
}

// ---------- Lecture Neon (single-flight par date) ----------

interface StructuredLeague {
  code: string;
  name: string;
  shortName: string;
  region: string;
  matches: LightMatch[];
}

interface StructuredScan {
  totalMatches: number;
  leagues: StructuredLeague[];
  scanMs: number;
}

/** Métadonnées de ligue : catalogue local (statique) puis repli compétition Neon. */
function leagueMeta(code: string, compName: string | null): { name: string; short: string; region: string; priority: number } {
  const def = LEAGUES.find((l: LeagueDef) => l.code === code);
  if (def) return { name: def.name, short: def.shortName, region: def.region, priority: def.priority };
  return { name: compName ?? code, short: code.toUpperCase().slice(0, 6), region: 'international', priority: 9 };
}

/** Statut brut ESPN ('pre' | 'in' | 'post') — même sémantique que l'ancien scan. */
function rawStatus(status: string, espnState: string | null): 'pre' | 'in' | 'post' {
  if (espnState === 'pre' || espnState === 'in' || espnState === 'post') return espnState;
  if (status === 'FINAL' || status === 'POST') return 'post';
  if (status === 'LIVE' || status === 'HALFTIME') return 'in';
  return 'pre';
}

/** Forme W/D/L par équipe : 5 derniers matchs FINAL de l'historique Neon,
 * du plus ancien au plus récent (convention ESPN — FormDots coupe les 5 derniers). */
async function deriveForms(teamIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!teamIds.length) return out;
  const teamSet = new Set(teamIds);
  const hist = await db.match.findMany({
    where: {
      status: 'FINAL',
      homeScore: { not: null },
      awayScore: { not: null },
      OR: [{ homeTeamId: { in: teamIds } }, { awayTeamId: { in: teamIds } }],
    },
    orderBy: { kickoffAt: 'desc' },
    take: 3000,
    select: { homeTeamId: true, awayTeamId: true, homeScore: true, awayScore: true },
  });
  const acc = new Map<string, string[]>();
  for (const m of hist) {
    // Ordre desc : le premier résultat collecté par équipe est le PLUS RÉCENT.
    for (const [tid, gf, ga] of [
      [m.homeTeamId, m.homeScore, m.awayScore],
      [m.awayTeamId, m.awayScore, m.homeScore],
    ] as const) {
      if (!tid || !teamSet.has(tid)) continue;
      const arr = acc.get(tid) ?? [];
      if (arr.length >= 5) continue;
      arr.push((gf ?? 0) > (ga ?? 0) ? 'W' : (gf ?? 0) < (ga ?? 0) ? 'L' : 'D');
      acc.set(tid, arr);
    }
  }
  for (const [tid, arr] of acc) out.set(tid, arr.reverse().join(''));
  return out;
}

/** Stade : Match.venue stocke "Nom, Ville" (ingestion) — redécoupé pour la carte. */
function parseVenue(venue: string | null): { name: string | null; city: string | null; country: string | null } {
  if (!venue) return { name: null, city: null, country: null };
  const parts = venue.split(', ').map((s) => s.trim()).filter(Boolean);
  return { name: parts[0] ?? null, city: parts[1] ?? null, country: null };
}

async function structuredScan(dateParam: string): Promise<StructuredScan> {
  const running = inFlight.get(dateParam);
  if (running) return running;

  const task = (async (): Promise<StructuredScan> => {
    const t0 = Date.now();
    // Fenêtre du jour calendaire UTC [JJ 00:00 → JJ+1 00:00) — Task 14.
    const dayStartMs = Date.parse(`${dateParam}T00:00:00Z`);
    const dayEndMs = dayStartMs + 86_400_000;

    // 1. Matchs de la fenêtre — SOURCE CENTRALE NEON (jamais supprimés : le
    //    filtrage se fait ici, par fenêtre/statut, pas en base).
    const matches = await db.match.findMany({
      where: { kickoffAt: { gte: new Date(dayStartMs), lt: new Date(dayEndMs) } },
      orderBy: { kickoffAt: 'asc' },
    });

    // 2-4. Compétitions + équipes + dernières cotes + forme — EN PARALLÈLE
    //      (une seule vague d'allers-retours Neon après la lecture des matchs).
    const compIds = [...new Set(matches.map((m) => m.competitionId).filter((x): x is string => !!x))];
    const teamIds = [...new Set(matches.flatMap((m) => [m.homeTeamId, m.awayTeamId]).filter((x): x is string => !!x))];
    const eventIds = matches.map((m) => m.espnEventId);
    type CompRow = { id: string; espnLeagueId: string; name: string };
    type TeamRow = { espnTeamId: string; name: string; shortName: string | null; abbreviation: string | null; logo: string | null };
    type OddsRow = { matchId: string; marketType: string; outcome: string; line: number | null; odds: number; bookmaker: string | null };
    const compP: Promise<CompRow[]> = compIds.length
      ? db.competition.findMany({ where: { id: { in: compIds } }, select: { id: true, espnLeagueId: true, name: true } })
      : Promise.resolve([]);
    const teamP: Promise<TeamRow[]> = teamIds.length
      ? db.team.findMany({
          where: { espnTeamId: { in: teamIds } },
          select: { espnTeamId: true, name: true, shortName: true, abbreviation: true, logo: true },
        })
      : Promise.resolve([]);
    const oddsP: Promise<OddsRow[]> = eventIds.length
      ? db.oddsSnapshot.findMany({
          where: { matchId: { in: eventIds } },
          orderBy: { capturedAt: 'desc' },
        })
      : Promise.resolve([]);
    const [competitions, teams, oddsRows, formByTeam] = await Promise.all([compP, teamP, oddsP, deriveForms(teamIds)]);

    const compById = new Map(competitions.map((c) => [c.id, c]));
    const teamById = new Map(teams.map((t) => [t.espnTeamId, t]));
    const latestOdds = new Map<string, { odds: number; book: string | null; line: number | null }>();
    for (const r of oddsRows) {
      const k = `${r.matchId}|${r.marketType}|${r.outcome}`;
      if (!latestOdds.has(k)) latestOdds.set(k, { odds: r.odds, book: r.bookmaker, line: r.line });
    }

    // 4. (forme intégrée au Promise.all ci-dessus)

    // 5. Groupement par ligue (top ligues du catalogue d'abord)
    const byLeague = new Map<string, typeof matches>();
    for (const m of matches) {
      const code = m.competitionId ? compById.get(m.competitionId)?.espnLeagueId ?? '' : '';
      const arr = byLeague.get(code) ?? [];
      arr.push(m);
      byLeague.set(code, arr);
    }
    const sortedCodes = [...byLeague.keys()].sort((a, b) => {
      const la = leagueMeta(a, null).priority;
      const lb = leagueMeta(b, null).priority;
      return la - lb || a.localeCompare(b);
    });

    const leagues: StructuredLeague[] = [];
    let totalMatches = 0;

    for (const code of sortedCodes) {
      const rows = byLeague.get(code)!;
      const compName = rows[0]?.competitionId ? compById.get(rows[0].competitionId!)?.name ?? null : null;
      const meta = leagueMeta(code, compName);
      const light: LightMatch[] = rows.map((m) => {
        const homeOdds = latestOdds.get(`${m.espnEventId}|1X2|HOME`);
        const drawOdds = latestOdds.get(`${m.espnEventId}|1X2|DRAW`);
        const awayOdds = latestOdds.get(`${m.espnEventId}|1X2|AWAY`);
        const ouOver = latestOdds.get(`${m.espnEventId}|OVER_UNDER|OVER`);
        const ouUnder = latestOdds.get(`${m.espnEventId}|OVER_UNDER|UNDER`);
        const book = homeOdds?.book ?? drawOdds?.book ?? awayOdds?.book ?? ouOver?.book ?? null;
        const hasOdds = !!(homeOdds || drawOdds || awayOdds || ouOver || ouUnder);
        const home = m.homeTeamId ? teamById.get(m.homeTeamId) : undefined;
        const away = m.awayTeamId ? teamById.get(m.awayTeamId) : undefined;
        return {
          id: m.espnEventId,
          leagueCode: code,
          leagueName: meta.name,
          leagueShort: meta.short,
          region: meta.region,
          date: m.kickoffAt.toISOString(),
          status: rawStatus(m.status, m.espnState),
          statusDetail: m.statusDetail ?? '',
          home: {
            id: m.homeTeamId ?? '',
            name: m.homeTeamName,
            shortName: home?.shortName ?? home?.abbreviation ?? m.homeTeamName,
            logo: home?.logo ?? null,
            score: m.homeScore,
            form: m.homeTeamId ? formByTeam.get(m.homeTeamId) ?? null : null,
            record: null, // bilan saisonnier ESPN non stocké — non utilisé par l'UI
          },
          away: {
            id: m.awayTeamId ?? '',
            name: m.awayTeamName,
            shortName: away?.shortName ?? away?.abbreviation ?? m.awayTeamName,
            logo: away?.logo ?? null,
            score: m.awayScore,
            form: m.awayTeamId ? formByTeam.get(m.awayTeamId) ?? null : null,
            record: null,
          },
          hasOdds,
          oddsProvider: hasOdds ? book ?? 'Bookmaker' : null,
          ouLine: ouOver?.line ?? ouUnder?.line ?? null,
          mlHome: homeOdds?.odds ?? null,
          mlDraw: drawOdds?.odds ?? null,
          mlAway: awayOdds?.odds ?? null,
          venue: parseVenue(m.venue),
        };
      });
      leagues.push({ code, name: meta.name, shortName: meta.short, region: meta.region, matches: light });
      totalMatches += light.length;
    }

    const scanMs = Date.now() - t0;
    console.log(`[matches] ${dateParam}: ${totalMatches} matchs DEPUIS NEON, ${leagues.length} ligues, ${scanMs} ms`);
    return { totalMatches, leagues, scanMs };
  })();

  inFlight.set(dateParam, task);
  try {
    return await task;
  } finally {
    inFlight.delete(dateParam);
  }
}

function serializeScan(dateParam: string, s: StructuredScan): string {
  return JSON.stringify({
    date: dateParam,
    totalMatches: s.totalMatches,
    catalogueSize: LEAGUES.length,
    leagues: s.leagues,
    scanMs: s.scanMs,
  });
}

async function scanDate(dateParam: string): Promise<ScanResult> {
  const s = await structuredScan(dateParam);
  return { body: serializeScan(dateParam, s), totalMatches: s.totalMatches };
}

// ---------- Préchauffage en tâche de fond (déclenché au 1er appel) ----------

function warmInBackground(dateParam: string): void {
  if (warming.has(dateParam)) return;
  warming.add(dateParam);
  const task = scanDate(dateParam);
  task
    .then((result) => {
      // Garde-fou : ne pas remplacer un résultat correct par une lecture
      // catastrophiquement vide (Neon momentanément indisponible au réveil).
      const prev = bodies.get(dateParam);
      const prevTotal = prev ? (JSON.parse(prev.body) as { totalMatches?: number }).totalMatches ?? 0 : 0;
      if (result.totalMatches === 0 && prevTotal > 0) return;
      if (prevTotal > 0 && result.totalMatches < prevTotal * 0.6) return;
      storeResult(dateParam, result);
    })
    .catch(() => {})
    .finally(() => warming.delete(dateParam));
}

function ensureWarmer(): void {
  if (g.__voltrixMatchesWarmer) return;
  const timer = setInterval(() => {
    warmInBackground(todayISO());
  }, WARM_INTERVAL_MS) as unknown as { unref?: () => void };
  timer.unref?.();
  g.__voltrixMatchesWarmer = timer;
}

// ---------- Route ----------

function matchesResponse(body: string, cacheState: 'HIT' | 'STALE' | 'MISS'): NextResponse {
  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'X-Cache': cacheState,
      'X-Source': 'neon', // Task 28-b : marqueur de centralisation (preuve)
      'Cache-Control': 'no-store',
    },
  });
}

export async function GET(req: NextRequest) {
  // Task 21-c : anti-abus — 60 req/min/IP.
  const rl = rateLimit(req, 'matches', 60, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: `Trop de requêtes, réessaie dans ${rl.retryAfterSec} s` },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } }
    );
  }

  const { searchParams } = new URL(req.url);
  const rawDate = searchParams.get('date');
  const dateParam = rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : todayISO();

  // Task 28-b : l'Accueil est un point d'entrée — la boucle de synchronisation
  // (seule voie d'entrée ESPN → Neon) doit vivre même si personne n'ouvre Prévisions.
  ensureSyncLoop();
  ensureWarmer();

  const now = Date.now();
  const entry = bodies.get(dateParam);
  if (entry) {
    if (now < entry.freshUntil) {
      return matchesResponse(entry.body, 'HIT');
    }
    if (now < entry.staleUntil) {
      warmInBackground(dateParam);
      return matchesResponse(entry.body, 'STALE');
    }
  }

  const result = await scanDate(dateParam);
  // Garde-fou anti-lecture dégradée : une copie riche n'est jamais remplacée
  // par une lecture quasi vide (panne Neon passagère).
  const prev = bodies.get(dateParam);
  if (prev && Date.now() - prev.scannedAt < 24 * 3600 * 1000) {
    const prevTotal = (JSON.parse(prev.body) as { totalMatches?: number }).totalMatches ?? 0;
    if (prevTotal > 0 && result.totalMatches < prevTotal * 0.6) {
      return matchesResponse(prev.body, 'STALE');
    }
  }
  storeResult(dateParam, result);
  return matchesResponse(result.body, 'MISS');
}
