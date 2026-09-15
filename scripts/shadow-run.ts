// ============================================================
// VOLTRIX bet — SHADOW-RUN ESPN vs NEON (moteur v2.1, aucun basculement)
//
// Objectif : vérifier que runEngine v2.1 produit les MÊMES résultats
// avec les données Neon qu'avec les données ESPN, sur un échantillon
// de matchs à venir, en utilisant :
//   - EXACTEMENT le même moteur (import direct de runEngine, NON modifié) ;
//   - EXACTEMENT le même instant de référence nowMs pour les 2 calculs ;
//   - des entrées ESPN reconstruites à l'identique d'analyzeMatch
//     (mêmes fonctions espn.ts, même logique de dates adjacentes,
//     même saison) ;
//   - des entrées Neon lues depuis les tables centralisées
//     (Match, OddsOpenClose, StandingsSnapshot, InjurySnapshot).
//
// GARANTIES :
//   - AUCUNE écriture en base (SELECT uniquement) ;
//   - AUCUNE modification du moteur (prediction.ts / analyze.ts intacts) ;
//   - AUCUNE modification des prédictions de production ;
//   - la météo est passée à null des DEUX côtés : input.weatherImpact
//     n'est JAMAIS lu par runEngine v2.1 (audit 21-b FIX 5 — grep :
//     seule la déclaration ligne 584 et le commentaire ligne 718),
//     donc ce choix ne peut créer AUCUNE différence de sortie.
// ============================================================

import { db } from '../src/lib/db';
import { runEngine, type MatchAnalysis } from '../src/lib/prediction';
import { buildInputsDigest, currentSeasonYear, PREV_SEASON } from '../src/lib/analyze';
import {
  fetchScoreboard,
  fetchTeamSchedule,
  fetchStandings,
  fetchInjuries,
  espnStats,
  type EspnScheduleGame,
  type EspnStandingsTeam,
  type EspnInjury,
  type EspnOdds,
  type EspnEvent,
} from '../src/lib/espn';
import { MODEL_VERSION } from '../src/lib/model-version';

// ---------- Paramètres de l'échantillon ----------
const CAP_WITH_ODDS = Number(process.env.SHADOW_CAP_ODDS ?? 36);
const CAP_NO_ODDS = Number(process.env.SHADOW_CAP_NOODDS ?? 12);
const LEAGUE_CAP = Number(process.env.SHADOW_LEAGUE_CAP ?? 6);
const CONCURRENCY = 4;
// Source des cotes côté Neon :
//   'anchor' (défaut) = ancre OddsOpenClose (espnClose ?? close) — état du process
//   'series'          = dernière valeur de la SÉRIE OddsSnapshot (fraîche, 90 s/10 min)
// Le process serveur actuel (démarré 13:49, AVANT le code Task 29) insère la
// série mais ne met pas encore à jour les ancres → 'series' montre la parité
// atteignable dès que les marques Task 29 seront actives (redémarrage).
const ODDS_SOURCE = (process.env.NEON_ODDS_SOURCE ?? 'anchor') as 'anchor' | 'series';

// ---------- Utilitaires ----------
const round4 = (x: number) => Math.round(x * 10000) / 10000;
const diffPp = (a: number, b: number) => round4(Math.abs(a - b) * 100); // points de pourcentage

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

// ============================================================
// CÔTÉ NEON — reconstruction des entrées du moteur depuis la base
// (ce que ferait un analyzeMatch 100 % Neon — sans le moindre appel ESPN)
// ============================================================

async function neonSchedule(teamId: string, leagueScope: string | null, leagueOfComp: Map<string, string>): Promise<{ scoped: EspnScheduleGame[]; rich: EspnScheduleGame[] }> {
  const rows = await db.match.findMany({
    where: {
      status: 'FINAL',
      homeScore: { not: null },
      awayScore: { not: null },
      OR: [{ homeTeamId: teamId }, { awayTeamId: teamId }],
    },
    select: {
      espnEventId: true, kickoffAt: true, homeTeamId: true, awayTeamId: true,
      homeTeamName: true, awayTeamName: true, homeScore: true, awayScore: true,
      competitionId: true,
    },
  });
  const build = (rowsSel: typeof rows): EspnScheduleGame[] => {
    const games: EspnScheduleGame[] = rowsSel.map((m) => {
      const home = m.homeTeamId === teamId;
      return {
        eventId: m.espnEventId,
        date: m.kickoffAt.toISOString(),
        opponentId: (home ? m.awayTeamId : m.homeTeamId) ?? '',
        opponentName: home ? m.awayTeamName : m.homeTeamName,
        homeAway: home ? 'home' : 'away',
        teamScore: home ? m.homeScore : m.awayScore,
        opponentScore: home ? m.awayScore : m.homeScore,
        completed: true,
        leagueCode: (m.competitionId ? leagueOfComp.get(m.competitionId) : '') ?? '',
      };
    });
    games.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    return games;
  };
  // MODE RICHE : toutes compétitions confondues (superset de la vue ESPN)
  const rich = build(rows);
  // MODE ÉQUIVALENCE : historique borné à la compétition du match analysé
  // (hypothèse validée par le pilote : le calendrier ESPN {ligue}/teams/{id}
  // ne couvre que CETTE compétition — le miroir Neon doit donc scopé pareil
  // pour produire les mêmes entrées sans toucher au moteur).
  const scopedRows = leagueScope ? rows.filter((m) => (m.competitionId ? leagueOfComp.get(m.competitionId) : null) === leagueScope) : rows;
  const scoped = build(scopedRows);
  return { scoped, rich };
}

async function neonStandings(league: string, season: number): Promise<{ list: EspnStandingsTeam[]; byTeam: Map<string, EspnStandingsTeam>; day: Date | null }> {
  let day = (
    await db.standingsSnapshot.findFirst({
      where: { espnLeagueId: league, season },
      orderBy: [{ snapshotDate: 'desc' }, { capturedAt: 'desc' }],
      select: { snapshotDate: true },
    })
  )?.snapshotDate;
  if (!day) {
    // repli : dernier jour disponible pour la ligue (quelle que soit la saison étiquetée)
    day = (
      await db.standingsSnapshot.findFirst({
        where: { espnLeagueId: league },
        orderBy: { snapshotDate: 'desc' },
        select: { snapshotDate: true },
      })
    )?.snapshotDate;
  }
  if (!day) return { list: [], byTeam: new Map(), day: null };
  const rows = await db.standingsSnapshot.findMany({
    where: { espnLeagueId: league, snapshotDate: day },
  });
  const list: EspnStandingsTeam[] = rows.map((r) => ({
    teamId: r.espnTeamId,
    teamName: r.teamName,
    rank: r.rank,
    gamesPlayed: r.gamesPlayed,
    wins: r.wins,
    ties: r.ties,
    losses: r.losses,
    pointsFor: r.pointsFor,
    pointsAgainst: r.pointsAgainst,
    points: r.points,
  }));
  const byTeam = new Map(list.map((s) => [s.teamId, s]));
  return { list, byTeam, day };
}

async function neonInjuries(league: string): Promise<EspnInjury[]> {
  const day = (
    await db.injurySnapshot.findFirst({
      where: { espnLeagueId: league },
      orderBy: { snapshotDate: 'desc' },
      select: { snapshotDate: true },
    })
  )?.snapshotDate;
  if (!day) return [];
  const rows = await db.injurySnapshot.findMany({
    where: { espnLeagueId: league, snapshotDate: day },
    select: { espnTeamId: true, playerName: true, position: true, status: true },
  });
  return rows.map((r) => ({ teamId: r.espnTeamId, playerName: r.playerName, position: r.position, status: r.status }));
}

async function neonOdds(matchId: string): Promise<{ odds: EspnOdds | null; lastCapturedAt: Date | null }> {
  const rows = await db.oddsOpenClose.findMany({ where: { matchId } });
  if (!rows.length) return { odds: null, lastCapturedAt: null };
  // Série fraîche (mode 'series') : dernière valeur capturée par (marché, issue, ligne)
  // NB fenêtre 400 : avec l'insert-on-change, une jambe QUI N'A PAS BOUGÉ peut ne
  // pas avoir été re-capturée depuis des heures — une fenêtre trop courte perdrait
  // sa valeur courante (c'est la valeur ESPN actuelle, inchangée par définition).
  const seriesLatest = new Map<string, { odds: number; at: Date }>();
  if (ODDS_SOURCE === 'series') {
    const snaps = await db.oddsSnapshot.findMany({
      where: { matchId },
      orderBy: { capturedAt: 'desc' },
      take: 400,
      select: { marketType: true, outcome: true, line: true, odds: true, capturedAt: true },
    });
    for (const s of snaps) {
      const k = `${s.marketType}|${s.outcome}|${s.line ?? ''}`;
      if (!seriesLatest.has(k)) seriesLatest.set(k, { odds: s.odds, at: s.capturedAt });
    }
  }
  // ---- SÉLECTION DE LIGNE O/U ANTI-OSCILLATION (Task 30bis) ----
  // Les bookmakers oscillent (ex. 2.5 → 3.5 → 2.5). La jambe non modifiée n'est
  // PAS re-capturée (insert-on-change) : sa valeur courante peut être ancienne
  // tout en étant exacte. Il faut donc choisir la ligne par l'ACTIVITÉ LA PLUS
  // RÉCENTE de l'une OU l'autre jambe (pas seulement l'OVER), puis assembler les
  // deux jambes SUR CETTE MÊME ligne — sinon on mélange deux épisodes de ligne.
  const ouLines = [...new Set(rows.filter((r) => r.marketType === 'OVER_UNDER' && r.line != null).map((r) => r.line as number))];
  const legFresh = (r?: (typeof rows)[number]): number => {
    if (!r) return 0;
    if (ODDS_SOURCE === 'series') {
      const s = seriesLatest.get(`${r.marketType}|${r.outcome}|${r.line ?? ''}`);
      return (s?.at ?? r.closeCapturedAt ?? r.updatedAt ?? null)?.getTime() ?? 0; // repli horodatage ancre si jambe hors fenêtre série
    }
    return (r.closeCapturedAt ?? r.updatedAt ?? null)?.getTime() ?? 0;
  };
  let line: number | null = null;
  let lineFresh = 0;
  for (const L of ouLines) {
    const oL = rows.find((r) => r.marketType === 'OVER_UNDER' && r.outcome === 'OVER' && r.line === L);
    const uL = rows.find((r) => r.marketType === 'OVER_UNDER' && r.outcome === 'UNDER' && r.line === L);
    if (!oL && !uL) continue;
    const fresh = Math.max(legFresh(oL), legFresh(uL));
    if (fresh > lineFresh) { lineFresh = fresh; line = L; }
  }
  const over = line != null ? rows.find((r) => r.marketType === 'OVER_UNDER' && r.outcome === 'OVER' && r.line === line) ?? null : null;
  const under = line != null ? rows.find((r) => r.marketType === 'OVER_UNDER' && r.outcome === 'UNDER' && r.line === line) ?? null : null;
  const open = (r?: (typeof rows)[number]) => (r ? r.espnOpenOdds ?? r.openOdds ?? null : null); // déclaré ESPN, repli capture effective
  const close = (r?: (typeof rows)[number]) => {
    if (!r) return null;
    if (ODDS_SOURCE === 'series') {
      const s = seriesLatest.get(`${r.marketType}|${r.outcome}|${r.line ?? ''}`);
      if (s) return s.odds; // valeur de série fraîche — la plus proche de l'état ESPN
    }
    return r.espnCloseOdds ?? r.closeOdds ?? null;
  };
  const ml = (outcome: string) => rows.find((r) => r.marketType === '1X2' && r.outcome === outcome);
  const h = ml('HOME');
  const d = ml('DRAW');
  const a = ml('AWAY');
  const hasML = !!(close(h) || close(a) || close(d));
  const hasTotal =
    !!(over && (close(over) != null || open(over) != null)) ||
    !!(under && (close(under) != null || open(under) != null));
  const hasOdds = hasML || hasTotal;
  const lastCapturedAt = rows
    .flatMap((r) => [r.closeCapturedAt, r.openCapturedAt, r.updatedAt])
    .filter((d): d is Date => !!d)
    .sort((x, y) => y.getTime() - x.getTime())[0] ?? null;
  const seriesNewest = [...seriesLatest.values()].sort((x, y) => y.at.getTime() - x.at.getTime())[0]?.at ?? null;
  const newest = [lastCapturedAt, seriesNewest].filter((d): d is Date => !!d).sort((x, y) => y.getTime() - x.getTime())[0] ?? null;
  return {
    odds: {
    provider: over?.bookmaker ?? h?.bookmaker ?? 'Bookmaker',
    overUnderLine: line,
    moneyline: {
      home: { open: open(h), close: close(h) },
      draw: { open: open(d), close: close(d) },
      away: { open: open(a), close: close(a) },
    },
    total: {
      over: { line, openOdds: over ? open(over) : null, closeOdds: over ? close(over) : null },
      under: { line, openOdds: under ? open(under) : null, closeOdds: under ? close(under) : null },
    },
    hasOdds,
    },
    lastCapturedAt: newest,
  };
}

// ============================================================
// CÔTÉ ESPN — reconstruction à l'IDENTIQUE d'analyzeMatch
// (mêmes fetchs, même repli dates adjacentes, même saison)
// ============================================================

interface EspnSide {
  event: EspnEvent;
  homeSchedule: EspnScheduleGame[];
  awaySchedule: EspnScheduleGame[];
  standings: EspnStandingsTeam[];
  injuries: EspnInjury[];
  season: number;
}

async function espnSide(leagueCode: string, matchId: string, dateISO: string): Promise<EspnSide | null> {
  // 1. Scoreboard + repli dates adjacentes (copie conforme analyzeMatch)
  const dateParam = dateISO.slice(0, 10);
  let board = await fetchScoreboard(leagueCode, dateParam);
  if (board && !board.events.some((e) => e.id === matchId)) {
    const prev = new Date(new Date(dateParam + 'T12:00:00Z').getTime() - 86400000).toISOString().slice(0, 10);
    const next = new Date(new Date(dateParam + 'T12:00:00Z').getTime() + 86400000).toISOString().slice(0, 10);
    board =
      (await fetchScoreboard(leagueCode, next))?.events.some((e) => e.id === matchId)
        ? await fetchScoreboard(leagueCode, next)
        : (await fetchScoreboard(leagueCode, prev))?.events.some((e) => e.id === matchId)
          ? await fetchScoreboard(leagueCode, prev)
          : board;
  }
  if (!board) return null;
  const event = board.events.find((e) => e.id === matchId);
  if (!event || !event.home || !event.away) return null;

  const season = currentSeasonYear(dateISO, leagueCode);
  const seasons = [PREV_SEASON, season].filter((s) => s > 0);

  // 2. Historiques des 2 équipes (saison courante + précédente)
  let homeSchedule: EspnScheduleGame[] = [];
  let awaySchedule: EspnScheduleGame[] = [];
  try {
    const [hs, as] = await Promise.all([
      fetchTeamSchedule(leagueCode, event.home.team.id, seasons),
      fetchTeamSchedule(leagueCode, event.away.team.id, seasons),
    ]);
    homeSchedule = hs;
    awaySchedule = as;
  } catch {
    /* identique analyzeMatch : repli vide */
  }

  // 3. Classement + blessures (par ligue)
  let standings: EspnStandingsTeam[] = [];
  let injuries: EspnInjury[] = [];
  try {
    const [st, inj] = await Promise.all([fetchStandings(leagueCode, season), fetchInjuries(leagueCode)]);
    standings = st;
    injuries = inj;
  } catch {
    standings = [];
  }

  return { event, homeSchedule, awaySchedule, standings, injuries, season };
}

// ============================================================
// COMPARAISON
// ============================================================

interface NumericDiff { key: string; espn: number; neon: number; diff: number }

function collectDiffs(a: MatchAnalysis, b: MatchAnalysis): { prob: NumericDiff[]; lambda: NumericDiff[]; team: NumericDiff[] } {
  const P = (x: number) => x * 100; // → points de pourcentage
  const prob: NumericDiff[] = [];
  const addP = (key: string, ea: number, na: number) => prob.push({ key, espn: round4(P(ea)), neon: round4(P(na)), diff: diffPp(ea, na) });

  addP('p1x2_home', a.prediction.probs.home, b.prediction.probs.home);
  addP('p1x2_draw', a.prediction.probs.draw, b.prediction.probs.draw);
  addP('p1x2_away', a.prediction.probs.away, b.prediction.probs.away);
  addP('poisson_home', a.prediction.poisson.home, b.prediction.poisson.home);
  addP('poisson_draw', a.prediction.poisson.draw, b.prediction.poisson.draw);
  addP('poisson_away', a.prediction.poisson.away, b.prediction.poisson.away);
  addP('elo_home', a.prediction.elo.home, b.prediction.elo.home);
  addP('elo_draw', a.prediction.elo.draw, b.prediction.elo.draw);
  addP('elo_away', a.prediction.elo.away, b.prediction.elo.away);
  addP('form_home', a.prediction.form.home, b.prediction.form.home);
  addP('form_draw', a.prediction.form.draw, b.prediction.form.draw);
  addP('form_away', a.prediction.form.away, b.prediction.form.away);
  const ouA = a.prediction.overUnder.find((o) => o.line === 2.5);
  const ouB = b.prediction.overUnder.find((o) => o.line === 2.5);
  if (ouA && ouB) {
    addP('ou25_over', ouA.over, ouB.over);
    addP('ou25_under', ouA.under, ouB.under);
  }
  const rawA = a.prediction.raw.overUnder.find((o) => o.line === 2.5);
  const rawB = b.prediction.raw.overUnder.find((o) => o.line === 2.5);
  if (rawA && rawB) {
    addP('ou25_raw_over', rawA.over, rawB.over);
    addP('ou25_raw_under', rawA.under, rawB.under);
  }
  addP('btts_yes', a.prediction.btts.yes, b.prediction.btts.yes);
  addP('btts_no', a.prediction.btts.no, b.prediction.btts.no);
  addP('btts_raw_yes', a.prediction.raw.btts.yes, b.prediction.raw.btts.yes);
  addP('btts_raw_no', a.prediction.raw.btts.no, b.prediction.raw.btts.no);

  const lambda: NumericDiff[] = [
    { key: 'lambda_home', espn: a.prediction.lambda.home, neon: b.prediction.lambda.home, diff: round4(Math.abs(a.prediction.lambda.home - b.prediction.lambda.home)) },
    { key: 'lambda_away', espn: a.prediction.lambda.away, neon: b.prediction.lambda.away, diff: round4(Math.abs(a.prediction.lambda.away - b.prediction.lambda.away)) },
  ];

  const team: NumericDiff[] = [
    { key: 'elo_dom', espn: a.home.elo, neon: b.home.elo, diff: Math.abs(a.home.elo - b.home.elo) },
    { key: 'elo_ext', espn: a.away.elo, neon: b.away.elo, diff: Math.abs(a.away.elo - b.away.elo) },
    { key: 'formScore_dom', espn: round4(a.home.formScore), neon: round4(b.home.formScore), diff: round4(Math.abs(a.home.formScore - b.home.formScore)) },
    { key: 'formScore_ext', espn: round4(a.away.formScore), neon: round4(b.away.formScore), diff: round4(Math.abs(a.away.formScore - b.away.formScore)) },
    { key: 'gamesHome_dom', espn: a.home.gamesHome, neon: b.home.gamesHome, diff: Math.abs(a.home.gamesHome - b.home.gamesHome) },
    { key: 'gamesAway_dom', espn: a.home.gamesAway, neon: b.home.gamesAway, diff: Math.abs(a.home.gamesAway - b.home.gamesAway) },
    { key: 'gamesHome_ext', espn: a.away.gamesHome, neon: b.away.gamesHome, diff: Math.abs(a.away.gamesHome - b.away.gamesHome) },
    { key: 'gamesAway_ext', espn: a.away.gamesAway, neon: b.away.gamesAway, diff: Math.abs(a.away.gamesAway - b.away.gamesAway) },
  ];

  return { prob, lambda, team };
}

interface MatchReport {
  matchId: string;
  league: string;
  home: string;
  away: string;
  kickoff: string;
  nowMs: string;
  status: 'OK' | 'ESPN_INTROUVABLE' | 'ERREUR';
  neonComplete: boolean;
  digestEqual: boolean;
  digestE: string;
  digestN: string;
  maxProbDiffPp: number;
  maxProbDiffRichPp: number;
  maxLambdaDiff: number;
  prob: NumericDiff[];
  lambda: NumericDiff[];
  team: NumericDiff[];
  confidenceE: number;
  confidenceN: number;
  valueBetsE: string;
  valueBetsN: string;
  causes: string[];
  inputs: {
    espn: Record<string, unknown>;
    neon: Record<string, unknown>;
  };
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

// ---------- Programme principal ----------

async function main() {
  const t0 = Date.now();
  const now = Date.now();
  const from = new Date(now + 30 * 60_000);
  const to = new Date(now + 7 * 24 * 3_600_000);

  console.log('== SHADOW-RUN ESPN vs NEON — moteur v2.1, lecture seule ==');
  console.log('MODEL_VERSION:', MODEL_VERSION);

  // 1. Sélection des matchs (Neon, lecture seule)
  const candidates = await db.match.findMany({
    where: {
      kickoffAt: { gte: from, lte: to },
      status: 'SCHEDULED',
      homeTeamId: { not: null },
      awayTeamId: { not: null },
      competitionId: { not: null },
    },
    orderBy: { kickoffAt: 'asc' },
    select: {
      espnEventId: true, kickoffAt: true, homeTeamId: true, homeTeamName: true,
      awayTeamId: true, awayTeamName: true, competitionId: true, season: true,
    },
  });
  const compRows = await db.competition.findMany({ select: { id: true, espnLeagueId: true } });
  const leagueOf = new Map(compRows.map((c) => [c.id, c.espnLeagueId]));
  const withLeague = candidates
    .map((m) => ({ ...m, league: (m.competitionId ? leagueOf.get(m.competitionId) : null) ?? '' }))
    .filter((m) => !!m.league);

  const ids = withLeague.map((m) => m.espnEventId);
  const oddsIds = new Set((await db.oddsOpenClose.groupBy({ by: ['matchId'], where: { matchId: { in: ids } } })).map((o) => o.matchId));

  // Stratification : avec cotes d'abord (chemin calibration actif), plafond par ligue
  const leagueCount = new Map<string, number>();
  const picked: typeof withLeague = [];
  const pick = (m: (typeof withLeague)[number]) => {
    const c = leagueCount.get(m.league) ?? 0;
    if (c >= LEAGUE_CAP) return false;
    if (picked.find((p) => p.espnEventId === m.espnEventId)) return false;
    leagueCount.set(m.league, c + 1);
    picked.push(m);
    return true;
  };
  for (const m of withLeague) if (oddsIds.has(m.espnEventId) && picked.length < CAP_WITH_ODDS) pick(m);
  for (const m of withLeague) if (!oddsIds.has(m.espnEventId) && picked.length < CAP_WITH_ODDS + CAP_NO_ODDS) pick(m);

  console.log(`Sélection : ${picked.length} matchs (cibles ${CAP_WITH_ODDS} avec cotes + ${CAP_NO_ODDS} sans) sur ${withLeague.length} candidats, ${leagueCount.size} ligues`);
  espnStats.total = 0;

  const reports: MatchReport[] = [];
  let espnUnfindable = 0;
  let errors = 0;

  await mapLimit(picked, CONCURRENCY, async (m) => {
    const nowMs = Date.now(); // MÊME instant de référence pour les 2 calculs
    const kickoffISO = m.kickoffAt.toISOString();
    const season = currentSeasonYear(kickoffISO, m.league);

    try {
      // ---- CÔTÉ ESPN (entrées conformes analyzeMatch) ----
      const E = await espnSide(m.league, m.espnEventId, kickoffISO);
      if (!E) {
        espnUnfindable++;
        reports.push(emptyReport(m, kickoffISO, nowMs, 'ESPN_INTROUVABLE'));
        return;
      }

      // ---- CÔTÉ NEON (entrées 100 % base — 2 variantes de périmètre) ----
      const [histHomeN, histAwayN, standN, injN, oddsNres] = await Promise.all([
        neonSchedule(m.homeTeamId!, m.league, leagueOf),
        neonSchedule(m.awayTeamId!, m.league, leagueOf),
        neonStandings(m.league, season),
        neonInjuries(m.league),
        neonOdds(m.espnEventId),
      ]);
      const oddsN = oddsNres.odds;
      const oddsLastCap = oddsNres.lastCapturedAt;
      const schedHomeN = histHomeN.scoped; // mode ÉQUIVALENCE (même périmètre que ESPN)
      const schedAwayN = histAwayN.scoped;
      const schedHomeNR = histHomeN.rich; // mode RICHE (toutes compétitions)
      const schedAwayNR = histAwayN.rich;

      // ---- runEngine v2.1 : DEUX appels, moteur identique, nowMs identique ----
      const homeStandE = E.standings.find((s) => s.teamId === E.event.home!.team.id) ?? null;
      const awayStandE = E.standings.find((s) => s.teamId === E.event.away!.team.id) ?? null;
      const analysisE = runEngine({
        homeTeam: { id: E.event.home!.team.id, name: E.event.home!.team.displayName, logo: E.event.home!.team.logo, schedule: E.homeSchedule, standings: homeStandE },
        awayTeam: { id: E.event.away!.team.id, name: E.event.away!.team.displayName, logo: E.event.away!.team.logo, schedule: E.awaySchedule, standings: awayStandE },
        injuries: E.injuries,
        odds: E.event.odds,
        isDerby: false,
        weatherImpact: null, // jamais lu par runEngine v2.1 (grep : ligne 584 déclaration, 718 commentaire)
        nowMs,
        leagueTeamsCount: E.standings.length || 20,
      });
      const analysisN = runEngine({
        homeTeam: { id: m.homeTeamId!, name: m.homeTeamName, logo: null, schedule: schedHomeN, standings: standN.byTeam.get(m.homeTeamId!) ?? null },
        awayTeam: { id: m.awayTeamId!, name: m.awayTeamName, logo: null, schedule: schedAwayN, standings: standN.byTeam.get(m.awayTeamId!) ?? null },
        injuries: injN,
        odds: oddsN,
        isDerby: false,
        weatherImpact: null,
        nowMs,
        leagueTeamsCount: standN.list.length || 20,
      });
      // Variante RICHE (documentaire) : historique multi-compétitions —
      // montre ce que changerait un enrichissement SANS retoucher le moteur.
      const analysisNR = runEngine({
        homeTeam: { id: m.homeTeamId!, name: m.homeTeamName, logo: null, schedule: schedHomeNR, standings: standN.byTeam.get(m.homeTeamId!) ?? null },
        awayTeam: { id: m.awayTeamId!, name: m.awayTeamName, logo: null, schedule: schedAwayNR, standings: standN.byTeam.get(m.awayTeamId!) ?? null },
        injuries: injN,
        odds: oddsN,
        isDerby: false,
        weatherImpact: null,
        nowMs,
        leagueTeamsCount: standN.list.length || 20,
      });
      const { prob: probR, lambda: lambdaR } = collectDiffs(analysisE, analysisNR);
      const maxProbDiffRichPp = Math.max(...probR.map((d) => d.diff), 0);

      // ---- digest des entrées (empreinte production buildInputsDigest) ----
      const pseudoE = { ...analysisE, odds: E.event.odds } as never;
      const pseudoN = { ...analysisN, odds: oddsN } as never;
      const digestE = buildInputsDigest(pseudoE);
      const digestN = buildInputsDigest(pseudoN);

      // ---- comparaison ----
      const { prob, lambda, team } = collectDiffs(analysisE, analysisN);
      const maxProbDiffPp = Math.max(...prob.map((d) => d.diff), 0);
      const maxLambdaDiff = Math.max(...lambda.map((d) => d.diff), 0);
      const causes = diagnose(E, { schedHomeN, schedAwayN, standN, injN, oddsN }, analysisE, analysisN, m);

      // complétude (mode équivalence) : MÊME nombre de matchs joués que ESPN
      // + standings + cotes + blessures — la parité stricte exige l'égalité.
      const espnPlayedHome = analysisE.home.gamesHome + analysisE.home.gamesAway;
      const espnPlayedAway = analysisE.away.gamesHome + analysisE.away.gamesAway;
      const neonPlayedHome = analysisN.home.gamesHome + analysisN.home.gamesAway;
      const neonPlayedAway = analysisN.away.gamesHome + analysisN.away.gamesAway;
      const histFull = espnPlayedHome > 0 && espnPlayedAway > 0 && neonPlayedHome === espnPlayedHome && neonPlayedAway === espnPlayedAway;
      const standFull = (homeStandE != null) === (standN.byTeam.has(m.homeTeamId!)) && (awayStandE != null) === (standN.byTeam.has(m.awayTeamId!));
      const oddsE = E.event.odds;
      const oddsCloseParity = oddsE?.hasOdds && oddsN?.hasOdds
        ? Math.abs((oddsE.total.over.closeOdds ?? 0) - (oddsN.total.over.closeOdds ?? 0)) < 0.001 &&
          Math.abs((oddsE.total.under.closeOdds ?? 0) - (oddsN.total.under.closeOdds ?? 0)) < 0.001
        : true;
      const oddsParity = (!!oddsE?.hasOdds) === (!!oddsN?.hasOdds) && (oddsE?.hasOdds ? oddsE.overUnderLine === oddsN?.overUnderLine : true) && oddsCloseParity;
      const injParity = E.injuries.filter((i) => i.teamId === E.event.home!.team.id).length === analysisN.home.injuriesCount && E.injuries.filter((i) => i.teamId === E.event.away!.team.id).length === analysisN.away.injuriesCount;
      const neonComplete = histFull && standFull && oddsParity && injParity;

      reports.push({
        matchId: m.espnEventId,
        league: m.league,
        home: m.homeTeamName,
        away: m.awayTeamName,
        kickoff: kickoffISO,
        nowMs: new Date(nowMs).toISOString(),
        status: 'OK',
        neonComplete,
        digestEqual: digestE === digestN,
        digestE,
        digestN,
        maxProbDiffPp,
        maxProbDiffRichPp,
        maxLambdaDiff,
        prob,
        lambda,
        team,
        confidenceE: analysisE.prediction.confidence,
        confidenceN: analysisN.prediction.confidence,
        valueBetsE: JSON.stringify(analysisE.prediction.valueBets),
        valueBetsN: JSON.stringify(analysisN.prediction.valueBets),
        causes,
        inputs: {
          espn: {
            schedHome: E.homeSchedule.length, schedAway: E.awaySchedule.length,
            playedHome: espnPlayedHome, playedAway: espnPlayedAway,
            standingsTeams: E.standings.length, rankDom: homeStandE?.rank ?? null, rankExt: awayStandE?.rank ?? null,
            injuries: E.injuries.length, hasOdds: oddsE?.hasOdds ?? false, ouLine: oddsE?.overUnderLine ?? null,
            overClose: oddsE?.total.over.closeOdds ?? null, underClose: oddsE?.total.under.closeOdds ?? null,
            mlHomeClose: oddsE?.moneyline.home.close ?? null,
            leagueTeamsCount: E.standings.length || 20,
          },
          neon: {
            schedHome: schedHomeN.length, schedAway: schedAwayN.length,
            schedHomeRich: schedHomeNR.length, schedAwayRich: schedAwayNR.length,
            playedHome: neonPlayedHome, playedAway: neonPlayedAway,
            standingsTeams: standN.list.length, standingsDay: standN.day?.toISOString().slice(0, 10) ?? null,
            rankDom: standN.byTeam.get(m.homeTeamId!)?.rank ?? null, rankExt: standN.byTeam.get(m.awayTeamId!)?.rank ?? null,
            injuries: injN.length, hasOdds: oddsN?.hasOdds ?? false, ouLine: oddsN?.overUnderLine ?? null,
            overClose: oddsN?.total.over.closeOdds ?? null, underClose: oddsN?.total.under.closeOdds ?? null,
            mlHomeClose: oddsN?.moneyline.home.close ?? null,
            oddsDerniereCapture: oddsLastCap?.toISOString() ?? null,
            oddsAgeMinutes: oddsLastCap ? Math.round((nowMs - oddsLastCap.getTime()) / 60000) : null,
            leagueTeamsCount: standN.list.length || 20,
          },
        },
      });
      console.log(`  [${reports.length}/${picked.length}] ${m.homeTeamName} - ${m.awayTeamName} (${m.league}) : maxProb=${maxProbDiffPp}pp maxLambda=${maxLambdaDiff} ${neonComplete ? 'COMPLET' : 'partiel'}`);
    } catch (e) {
      errors++;
      reports.push(emptyReport(m, kickoffISO, nowMs, 'ERREUR'));
      console.log(`  ERREUR ${m.espnEventId}: ${(e as Error).message?.slice(0, 120)}`);
    }
  });

  // ---------- Agrégats ----------
  const ok = reports.filter((r) => r.status === 'OK');
  const maxProbs = ok.map((r) => r.maxProbDiffPp).sort((a, b) => a - b);
  const maxLams = ok.map((r) => r.maxLambdaDiff).sort((a, b) => a - b);
  const stats = (sorted: number[]) => ({
    moyenne: sorted.length ? round4(sorted.reduce((s, x) => s + x, 0) / sorted.length) : 0,
    max: sorted.length ? sorted[sorted.length - 1] : 0,
    p95: round4(percentile(sorted, 95)),
    sup05: sorted.filter((x) => x > 0.5).length,
    sup1: sorted.filter((x) => x > 1).length,
    sup2: sorted.filter((x) => x > 2).length,
    zero: sorted.filter((x) => x === 0).length,
  });
  const probStats = stats(maxProbs);
  const lamStats = stats(maxLams);
  const oddsAges = ok
    .map((r) => (r.inputs.neon as Record<string, unknown>).oddsAgeMinutes as number | null)
    .filter((x): x is number => x != null)
    .sort((a, b) => a - b);

  const top20 = [...ok].sort((a, b) => b.maxProbDiffPp - a.maxProbDiffPp || b.maxLambdaDiff - a.maxLambdaDiff).slice(0, 20);
  const espnCalls = espnStats.total;
  const dur = Math.round((Date.now() - t0) / 1000);

  const summary = {
    horodatage: new Date().toISOString(),
    modelVersion: MODEL_VERSION,
    sourceCotesNeon: ODDS_SOURCE,
    echantillon: { selectionnes: picked.length, compares: ok.length, espnIntrouvables: espnUnfindable, erreurs: errors, ligues: leagueCount.size },
    espnAppelsParLeShadow: espnCalls,
    dureeSecondes: dur,
    completudeNeon: { complets: ok.filter((r) => r.neonComplete).length, partiels: ok.filter((r) => !r.neonComplete).length },
    digestEgaux: { oui: ok.filter((r) => r.digestEqual).length, non: ok.filter((r) => !r.digestEqual).length },
    fraicheurCotesNeon_minutes: oddsAges.length
      ? { mediane: percentile(oddsAges, 50), moyenne: Math.round(oddsAges.reduce((s, x) => s + x, 0) / oddsAges.length), max: oddsAges[oddsAges.length - 1] }
      : null,
    differencesProbabilites_pp: probStats,
    differencesLambda_buts: lamStats,
    varianteRiche_toutesCompetitions: {
      note: "historique multi-compétitions : ce que changerait un enrichissement sans retoucher le moteur — ce n'est PAS la parité de référence",
      diffMoyenne_pp: round4(ok.length ? ok.reduce((s, r) => s + r.maxProbDiffRichPp, 0) / ok.length : 0),
      diffMax_pp: ok.length ? Math.max(...ok.map((r) => r.maxProbDiffRichPp)) : 0,
      differents: ok.filter((r) => r.maxProbDiffRichPp > 0.5).length,
    },
    confianceDifferente: ok.filter((r) => r.confidenceE !== r.confidenceN).length,
    valueBetsDifferents: ok.filter((r) => r.valueBetsE !== r.valueBetsN).length,
    identiquesParfaits: ok.filter((r) => r.maxProbDiffPp === 0 && r.maxLambdaDiff === 0).length,
  };
  console.log('\n== RÉSUMÉ ==');
  console.log(JSON.stringify(summary, null, 2));

  // ---------- Sauvegardes (fichiers uniquement — aucune écriture DB) ----------
  const stamp = new Date().toISOString().slice(0, 10) + (ODDS_SOURCE === 'series' ? '-series' : '');
  const { writeFileSync, mkdirSync } = await import('node:fs');
  mkdirSync('/home/z/my-project/download', { recursive: true });
  writeFileSync(`/home/z/my-project/download/shadow-run-${stamp}.json`, JSON.stringify({ summary, top20: top20.map(slim), reports: reports.map(slim) }, null, 2));
  console.log(`\nJSON complet : download/shadow-run-${stamp}.json`);
  console.log('Top 20 écarts :');
  for (const t of top20) {
    console.log(`  ${t.maxProbDiffPp}pp / λΔ${t.maxLambdaDiff} — ${t.home} - ${t.away} (${t.league}) :: ${t.causes.slice(0, 3).join(' | ') || 'écart numérique pur'}`);
  }
}

function slim(r: MatchReport) {
  return { ...r, prob: r.prob.filter((d) => d.diff > 0), lambda: r.lambda.filter((d) => d.diff > 0), team: r.team.filter((d) => d.diff > 0) };
}

function emptyReport(m: { espnEventId: string; homeTeamName: string; awayTeamName: string; league: string }, kickoffISO: string, nowMs: number, status: MatchReport['status']): MatchReport {
  return {
    matchId: m.espnEventId, league: m.league, home: m.homeTeamName, away: m.awayTeamName,
    kickoff: kickoffISO, nowMs: new Date(nowMs).toISOString(), status,
    neonComplete: false, digestEqual: false, digestE: '', digestN: '',
    maxProbDiffPp: 0, maxProbDiffRichPp: 0, maxLambdaDiff: 0, prob: [], lambda: [], team: [],
    confidenceE: 0, confidenceN: 0, valueBetsE: '', valueBetsN: '', causes: [], inputs: { espn: {}, neon: {} },
  };
}

// ---------- Diagnostic des causes (écarts d'ENTRÉES uniquement) ----------
function diagnose(
  E: EspnSide,
  N: { schedHomeN: EspnScheduleGame[]; schedAwayN: EspnScheduleGame[]; standN: { byTeam: Map<string, EspnStandingsTeam>; list: EspnStandingsTeam[] }; injN: EspnInjury[]; oddsN: EspnOdds | null },
  a: MatchAnalysis,
  b: MatchAnalysis,
  m: { homeTeamId: string | null; awayTeamId: string | null }
): string[] {
  const causes: string[] = [];
  const homeId = E.event.home!.team.id;
  const awayId = E.event.away!.team.id;
  const espnPlayedH = a.home.gamesHome + a.home.gamesAway;
  const espnPlayedA = a.away.gamesHome + a.away.gamesAway;
  const neonPlayedH = b.home.gamesHome + b.home.gamesAway;
  const neonPlayedA = b.away.gamesHome + b.away.gamesAway;

  if (neonPlayedH === 0 && espnPlayedH > 0) causes.push(`historique dom ABSENT de Neon (ESPN ${espnPlayedH} matchs) — forces att/déf + Elo + forme recalculées sur valeur neutre`);
  else if (neonPlayedH < espnPlayedH) causes.push(`historique dom partiel : Neon ${neonPlayedH} vs ESPN ${espnPlayedH} matchs (${Math.round((neonPlayedH / Math.max(1, espnPlayedH)) * 100)} %)`);
  if (neonPlayedA === 0 && espnPlayedA > 0) causes.push(`historique ext ABSENT de Neon (ESPN ${espnPlayedA} matchs)`);
  else if (neonPlayedA < espnPlayedA) causes.push(`historique ext partiel : Neon ${neonPlayedA} vs ESPN ${espnPlayedA} matchs (${Math.round((neonPlayedA / Math.max(1, espnPlayedA)) * 100)} %)`);

  const homeStandE = E.standings.find((s) => s.teamId === homeId) ?? null;
  const awayStandE = E.standings.find((s) => s.teamId === awayId) ?? null;
  const homeStandN = N.standN.byTeam.get(m.homeTeamId ?? homeId) ?? null;
  const awayStandN = N.standN.byTeam.get(m.awayTeamId ?? awayId) ?? null;
  if (!!homeStandE !== !!homeStandN) causes.push(`standings dom : ESPN rank ${homeStandE?.rank ?? '—'} vs Neon ${homeStandN ? 'rank ' + homeStandN.rank : 'ABSENT'} (enjeux/affichage)`);
  if (!!awayStandE !== !!awayStandN) causes.push(`standings ext : ESPN rank ${awayStandE?.rank ?? '—'} vs Neon ${awayStandN ? 'rank ' + awayStandN.rank : 'ABSENT'}`);
  if (homeStandE && homeStandN && (homeStandE.gamesPlayed !== homeStandN.gamesPlayed || homeStandE.points !== homeStandN.points)) causes.push(`standings dom désynchronisés (MJ ${homeStandE.gamesPlayed}/${homeStandN.gamesPlayed}, pts ${homeStandE.points}/${homeStandN.points})`);
  if (awayStandE && awayStandN && (awayStandE.gamesPlayed !== awayStandN.gamesPlayed || awayStandE.points !== awayStandN.points)) causes.push(`standings ext désynchronisés (MJ ${awayStandE.gamesPlayed}/${awayStandN.gamesPlayed}, pts ${awayStandE.points}/${awayStandN.points})`);

  const injE_h = E.injuries.filter((i) => i.teamId === homeId).length;
  const injE_a = E.injuries.filter((i) => i.teamId === awayId).length;
  if (injE_h !== b.home.injuriesCount || injE_a !== b.away.injuriesCount) causes.push(`blessures actives ESPN [${injE_h},${injE_a}] vs Neon [${b.home.injuriesCount},${b.away.injuriesCount}] (modificateur λ ±2 %/absent au-delà de 2)`);

  const oE = E.event.odds;
  const oN = N.oddsN;
  if ((!!oE?.hasOdds) !== (!!oN?.hasOdds)) causes.push(`cotes : hasOdds ESPN ${oE?.hasOdds ? 1 : 0} vs Neon ${oN?.hasOdds ? 1 : 0} → calibration marché ${oE?.hasOdds ? 'DÉSACTIVÉE' : 'ACTIVE'} côté Neon`);
  else if (oE?.hasOdds && oN?.hasOdds) {
    if (oE.overUnderLine !== oN.overUnderLine) causes.push(`ligne O/U différente : ESPN ${oE.overUnderLine} vs Neon ${oN.overUnderLine} (ancre de calibration)`);
    if ((oE.total.over.closeOdds ?? null) !== (oN.total.over.closeOdds ?? null)) causes.push(`cote Over close ${oE.total.over.closeOdds} (ESPN) vs ${oN.total.over.closeOdds} (Neon)`);
    if ((oE.total.under.closeOdds ?? null) !== (oN.total.under.closeOdds ?? null)) causes.push(`cote Under close ${oE.total.under.closeOdds} (ESPN) vs ${oN.total.under.closeOdds} (Neon)`);
  }
  if (E.standings.length !== N.standN.list.length && (a.context.stakesHome !== b.context.stakesHome || a.context.stakesAway !== b.context.stakesAway)) causes.push(`taille ligue ${E.standings.length} vs ${N.standN.list.length} (libellés enjeux)`);
  if (a.home.fatigueDaysSinceLast !== b.home.fatigueDaysSinceLast || a.home.matchesLast14Days !== b.home.matchesLast14Days) causes.push(`fatigue dom différente (repos ESPN ${a.home.fatigueDaysSinceLast}/Neon ${b.home.fatigueDaysSinceLast}, 14j ${a.home.matchesLast14Days}/${b.home.matchesLast14Days}) — modificateur λ ×0.94`);
  if (a.away.fatigueDaysSinceLast !== b.away.fatigueDaysSinceLast || a.away.matchesLast14Days !== b.away.matchesLast14Days) causes.push(`fatigue ext différente (repos ESPN ${a.away.fatigueDaysSinceLast}/Neon ${b.away.fatigueDaysSinceLast}, 14j ${a.away.matchesLast14Days}/${b.away.matchesLast14Days}) — modificateur λ ×0.94`);
  return causes;
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('ERREUR FATALE shadow-run:', e);
    process.exit(1);
  });
