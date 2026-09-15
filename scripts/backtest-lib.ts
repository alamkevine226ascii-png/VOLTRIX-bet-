// ============================================================
// VOLTRIX bet — Task 21-d : bibliothèque backtest walk-forward
// ============================================================
// Harnais d'évaluation expérimentale (audit externe) : « Quand
// VOLTRIX dit 65 %, cela arrive-t-il 65 % du temps, et apporte-t-il
// quelque chose AU-DELÀ du marché ? »
//
// Discipline as-of STRICTE (zéro fuite d'information future) :
//   - historiques équipes : fetchTeamSchedule (saison courante +
//     précédente), puis filtre STRICT date < T (kickoff) — c'est le
//     walk-forward ;
//   - classement : JAMAIS l'endpoint standings ESPN (il reflète
//     l'état ACTUEL = fuite) — synthétisé depuis les matchs filtrés
//     < T (points, différence de buts, matchs joués, rang) ;
//   - blessures : [] — l'endpoint ESPN ne renvoie que les blessures
//     ACTUELLES (fuite) ; choix documenté dans le rapport ;
//   - météo : null (influence retirée des λ en 21-b de toute façon) ;
//   - cotes : celles réellement disponibles avant coup d'envoi. Le
//     scoreboard HISTORIQUE d'ESPN ne conserve PAS les cotes des
//     matchs terminés (competitions[].odds = [null] vérifié), on
//     lit donc l'endpoint summary du match (pickcenter DraftKings,
//     open + close, figés avant kickoff) — discipline as-of
//     respectée (la clôture est connue au coup d'envoi).
//
// Process bun SÉPARÉ (pas le serveur dev), cache partagé cache.ts,
// concurrence ≤ 5 partout (mapWithConcurrency).
// ============================================================

import {
  americanToDecimal,
  fetchScoreboard,
  fetchTeamSchedule,
  type EspnOdds,
  type EspnScheduleGame,
  type EspnStandingsTeam,
} from '../src/lib/espn';
import { isVoidStatusDetail } from '../src/lib/grade';
import { mapWithConcurrency } from '../src/lib/cache';
// poissonModel = matrice Poisson renormalisée du moteur (21-b FIX 2) — la
// baseline « Poisson simple » partage EXACTEMENT la même mécanique de grille.
// V3 (22-c) : runEngine (VOLTRIX complet + MIX 22-b), computeElo/eloToProbs
// (baseline Elo simple), MODEL_VERSION (empreinte des runs).
import { computeElo, eloToProbs, poissonModel, runEngine, type EngineInput } from '../src/lib/prediction';
import { deMargin1x2, deMarginOverUnder } from '../src/lib/market-odds';
import { MODEL_VERSION } from '../src/lib/model-version';
import { createHash } from 'node:crypto';

// ---------- Types publics du harnais ----------

export interface CollectedMatch {
  id: string;
  league: string;
  kickoff: string; // ISO UTC
  homeId: string;
  homeName: string;
  homeLogo: string | null;
  awayId: string;
  awayName: string;
  awayLogo: string | null;
  homeScore: number;
  awayScore: number;
}

export interface RequestStats {
  scoreboard: number;
  schedule: number;
  summary: number;
  excluded: { voidOrCancelled: number; notFinalOrNoScore: number; noTeams: number; outsideWindow: number };
}

// ---------- Dates ----------

/** Jours UTC YYYY-MM-DD de `from` à `to` inclus. */
export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return out;
  for (let t = start; t <= end; t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

// ---------- Collecte des matchs terminés (scoreboards historiques) ----------

/** Match éligible : event completed avec score final parsable ET status post, non VOID. */
function isEligibleEvent(e: {
  completed: boolean;
  status: string;
  statusDetail: string;
  home: { score: number | null } | null;
  away: { score: number | null } | null;
}): boolean {
  if (isVoidStatusDetail(e.statusDetail)) return false; // annulé/reporté → hors backtest
  return e.completed && e.status === 'post' && !!e.home && !!e.away && typeof e.home.score === 'number' && typeof e.away.score === 'number';
}

export async function collectMatches(opts: {
  from: string;
  to: string;
  leagues: string[];
  max: number;
  stats: RequestStats;
  onProgress?: (msg: string) => void;
}): Promise<CollectedMatch[]> {
  const { from, to, leagues, max, stats, onProgress } = opts;
  const dates = datesBetween(from, to);
  const seen = new Set<string>();
  const matches: CollectedMatch[] = [];
  let dayIndex = 0;

  for (const date of dates) {
    // Concurrence ≤ 5 (mapWithConcurrency, même helper que le serveur)
    const boards = await mapWithConcurrency(leagues, 5, async (league) => {
      stats.scoreboard++;
      try {
        return { league, board: await fetchScoreboard(league, date) };
      } catch {
        return { league, board: null };
      }
    });
    for (const { league, board } of boards) {
      if (!board) continue;
      for (const e of board.events) {
        if (seen.has(e.id)) continue;
        seen.add(e.id); // dédoublonnage : un même event peut figurer sur 2 feuilles (regroupement US Eastern, Task 19-a)
        const kickoffDay = (e.date ?? '').slice(0, 10);
        if (kickoffDay < from || kickoffDay > to) {
          stats.excluded.outsideWindow++;
          continue;
        }
        if (!e.home || !e.away || !e.home.team || !e.away.team) {
          stats.excluded.noTeams++;
          continue;
        }
        if (!isEligibleEvent(e)) {
          if (isVoidStatusDetail(e.statusDetail)) stats.excluded.voidOrCancelled++;
          else stats.excluded.notFinalOrNoScore++;
          continue;
        }
        matches.push({
          id: e.id,
          league,
          kickoff: e.date,
          homeId: e.home.team.id,
          homeName: e.home.team.displayName ?? e.home.team.name ?? '',
          homeLogo: e.home.team.logo,
          awayId: e.away.team.id,
          awayName: e.away.team.displayName ?? e.away.team.name ?? '',
          awayLogo: e.away.team.logo,
          homeScore: e.home.score as number,
          awayScore: e.away.score as number,
        });
      }
    }
    dayIndex++;
    onProgress?.(`[collecte] jour ${dayIndex}/${dates.length} (${date}) — ${matches.length} matchs éligibles`);
    // Borne --max : arrêt de la collecte dès le quota atteint (granularité journée),
    // puis troncature exacte après tri par coup d'envoi.
    if (matches.length >= max) break;
  }

  matches.sort((a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff));
  return matches.slice(0, max);
}

// ---------- Historiques équipes (saison par saison, pour tag walk-forward) ----------

export type ScheduleKey = string; // `${league}:${teamId}`

export function scheduleKey(league: string, teamId: string): ScheduleKey {
  return `${league}:${teamId}`;
}

export interface TeamSeasonSchedules {
  bySeason: Map<number, EspnScheduleGame[]>;
}

/**
 * Récupère les calendriers par (ligue, équipe, saison) — 1 requête ESPN par
 * saison (concurrence ≤ 5, cache cache.ts). Le découpage PAR SAISON permet
 * d'estimer les paramètres de ligue (Task 21-d #9) sur la saison PRÉCÉDENTE
 * uniquement (zéro fuite walk-forward).
 */
export async function fetchTeamSchedules(
  teamsByLeague: Map<string, Set<string>>,
  seasons: number[],
  stats: RequestStats,
  onProgress?: (msg: string) => void
): Promise<Map<ScheduleKey, TeamSeasonSchedules>> {
  const out = new Map<ScheduleKey, TeamSeasonSchedules>();
  const tasks: Array<{ league: string; teamId: string; season: number }> = [];
  for (const [league, teams] of teamsByLeague) {
    for (const teamId of teams) {
      for (const season of seasons) {
        tasks.push({ league, teamId, season });
      }
    }
  }
  let done = 0;
  await mapWithConcurrency(tasks, 5, async ({ league, teamId, season }) => {
    stats.schedule++;
    let games: EspnScheduleGame[] = [];
    try {
      games = await fetchTeamSchedule(league, teamId, [season]);
    } catch {
      games = [];
    }
    const key = scheduleKey(league, teamId);
    let entry = out.get(key);
    if (!entry) {
      entry = { bySeason: new Map() };
      out.set(key, entry);
    }
    entry.bySeason.set(season, games ?? []);
    done++;
    if (done % 50 === 0) onProgress?.(`[calendriers] ${done}/${tasks.length}`);
  });
  return out;
}

/** Tous les matchs (2 saisons) d'une équipe, triés par date. */
export function allGamesOf(sched: Map<ScheduleKey, TeamSeasonSchedules>, league: string, teamId: string): EspnScheduleGame[] {
  const entry = sched.get(scheduleKey(league, teamId));
  if (!entry) return [];
  const all: EspnScheduleGame[] = [];
  for (const games of entry.bySeason.values()) all.push(...games);
  return all.sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
}

// ---------- Cotes historiques (summary ESPN, pickcenter open/close) ----------

const SUMMARY_SITE = 'https://site.api.espn.com/apis/site/v2/sports/soccer';

export interface RawMLOdd {
  open?: { odds?: string };
  close?: { odds?: string };
}
export interface RawSideOdd {
  open?: { line?: string; odds?: string };
  close?: { line?: string; odds?: string };
}
export interface RawPickcenter {
  provider?: { name?: string };
  overUnder?: number;
  moneyline?: { home?: RawMLOdd; draw?: RawMLOdd; away?: RawMLOdd };
  total?: { over?: RawSideOdd; under?: RawSideOdd };
  homeTeamOdds?: { moneyLine?: number };
  awayTeamOdds?: { moneyLine?: number };
  drawOdds?: { moneyLine?: number };
  overOdds?: number; // format plat du summary (américain)
  underOdds?: number;
}

function parseAmericanStr(s: unknown): number | null {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  if (t === '' || t === 'EVEN') return t === 'EVEN' ? 100 : null;
  const n = parseInt(t.replace('+', ''), 10);
  return Number.isNaN(n) ? null : t.startsWith('-') ? -Math.abs(n) : Math.abs(n);
}

function parseLineStr(s: unknown): number | null {
  if (typeof s !== 'string') return null;
  const n = parseFloat(s.replace(/[ouOU]/, ''));
  return Number.isNaN(n) ? null : n;
}

/** pickcenter (format summary) → EspnOdds (même forme que le scoreboard). */
export function pickcenterToOdds(pc: RawPickcenter | undefined): EspnOdds | null {
  if (!pc) return null;
  const ml = pc.moneyline;
  const closeFrom = (side: RawMLOdd | undefined, fallbackNumber: number | undefined): number | null =>
    americanToDecimal(parseAmericanStr(side?.close?.odds) ?? (typeof fallbackNumber === 'number' ? fallbackNumber : null));
  const openFrom = (side: RawMLOdd | undefined): number | null => americanToDecimal(parseAmericanStr(side?.open?.odds));
  const home = { open: openFrom(ml?.home), close: closeFrom(ml?.home, pc.homeTeamOdds?.moneyLine) };
  const draw = { open: openFrom(ml?.draw), close: closeFrom(ml?.draw, pc.drawOdds?.moneyLine) };
  const away = { open: openFrom(ml?.away), close: closeFrom(ml?.away, pc.awayTeamOdds?.moneyLine) };
  const overLine = parseLineStr(pc.total?.over?.close?.line) ?? parseLineStr(pc.total?.over?.open?.line) ?? (typeof pc.overUnder === 'number' ? pc.overUnder : null);
  const underLine = parseLineStr(pc.total?.under?.close?.line) ?? parseLineStr(pc.total?.under?.open?.line) ?? overLine;
  const over = {
    line: overLine,
    openOdds: americanToDecimal(parseAmericanStr(pc.total?.over?.open?.odds)),
    closeOdds: americanToDecimal(parseAmericanStr(pc.total?.over?.close?.odds)) ?? americanToDecimal(typeof pc.overOdds === 'number' ? pc.overOdds : null),
  };
  const under = {
    line: underLine,
    openOdds: americanToDecimal(parseAmericanStr(pc.total?.under?.open?.odds)),
    closeOdds: americanToDecimal(parseAmericanStr(pc.total?.under?.close?.odds)) ?? americanToDecimal(typeof pc.underOdds === 'number' ? pc.underOdds : null),
  };
  const hasOdds = !!(home.close || away.close || draw.close || over.closeOdds || under.closeOdds);
  if (!hasOdds) return null;
  return {
    provider: pc.provider?.name ?? 'ESPN',
    overUnderLine: typeof pc.overUnder === 'number' ? pc.overUnder : overLine,
    moneyline: { home, draw, away },
    total: { over, under },
    hasOdds,
  };
}

/**
 * Cotes historiques par match — endpoint summary ESPN (pickcenter, provider
 * DraftKings). Le scoreboard historique ne conserve PAS les cotes (vérifié :
 * competitions[].odds = [null] une fois le match 'post') ; le pickcenter du
 * summary fige open/close connus avant le coup d'envoi → as-of respecté.
 */
export async function fetchHistoricalOdds(
  matches: CollectedMatch[],
  stats: RequestStats,
  onProgress?: (msg: string) => void
): Promise<Map<string, EspnOdds | null>> {
  const out = new Map<string, EspnOdds | null>();
  let done = 0;
  await mapWithConcurrency(matches, 5, async (m) => {
    stats.summary++;
    let odds: EspnOdds | null = null;
    try {
      const res = await fetch(`${SUMMARY_SITE}/${m.league}/summary?event=${m.id}`, {
        headers: { 'User-Agent': 'curl/8.5.0', Accept: 'application/json' },
      });
      if (res.ok) {
        const json = (await res.json()) as { pickcenter?: RawPickcenter[] };
        odds = pickcenterToOdds(json.pickcenter?.[0]);
      }
    } catch {
      odds = null;
    }
    out.set(m.id, odds);
    done++;
    if (done % 50 === 0) onProgress?.(`[cotes] ${done}/${matches.length}`);
  });
  return out;
}

// ---------- Construction as-of ----------

/**
 * Filtre WALK-FORWARD strict : seuls les matchs COMPLÈTES avec score et
 * de date STRICTEMENT antérieure au coup d'envoi T comptent. Tri par date
 * croissante (la forme récente de analyzeTeam/utilisateurs en dépend).
 */
export function filterAsOfGames(all: EspnScheduleGame[], kickoffMs: number): EspnScheduleGame[] {
  return all
    .filter((g) => g.completed && g.teamScore !== null && g.opponentScore !== null && Date.parse(g.date) < kickoffMs)
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
}

export interface SynthStandingsResult {
  entries: EspnStandingsTeam[];
  home: EspnStandingsTeam | null;
  away: EspnStandingsTeam | null;
  teamsCount: number;
}

/**
 * Classement SYNTHÉTISÉ as-of : construit depuis les matchs filtrés < T des
 * deux historiques (perspective propriétaire → match canonique home/away),
 * dédupliqués par eventId. Table PARTIELLE honnête : les deux équipes ont
 * leur bilan exact, les adversaires seulement leurs matchs contre elles —
 * le rang est calculé DANS cette table (aucun appel standings ESPN = aucune
 * fuite). Seuls gamesPlayed/rank/points sont consommés par le moteur
 * (pondérations venue/global + affichage enjeux).
 */
export function synthStandings(
  homeId: string,
  homeGames: EspnScheduleGame[],
  awayId: string,
  awayGames: EspnScheduleGame[]
): SynthStandingsResult {
  interface Row {
    teamId: string;
    gp: number;
    w: number;
    d: number;
    l: number;
    gf: number;
    ga: number;
    points: number;
  }
  const rows = new Map<string, Row>();
  const rowOf = (teamId: string): Row => {
    let r = rows.get(teamId);
    if (!r) {
      r = { teamId, gp: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, points: 0 };
      rows.set(teamId, r);
    }
    return r;
  };
  const seenEvents = new Set<string>();
  const addFrom = (ownerId: string, games: EspnScheduleGame[]) => {
    for (const g of games) {
      if (!g.completed || g.teamScore === null || g.opponentScore === null) continue;
      if (seenEvents.has(g.eventId)) continue;
      seenEvents.add(g.eventId);
      const homeIdG = g.homeAway === 'home' ? ownerId : g.opponentId;
      const awayIdG = g.homeAway === 'home' ? g.opponentId : ownerId;
      const hs = g.homeAway === 'home' ? g.teamScore : g.opponentScore;
      const as = g.homeAway === 'home' ? g.opponentScore : g.teamScore;
      const rh = rowOf(homeIdG);
      const ra = rowOf(awayIdG);
      rh.gp++;
      ra.gp++;
      rh.gf += hs;
      rh.ga += as;
      ra.gf += as;
      ra.ga += hs;
      if (hs > as) {
        rh.w++;
        rh.points += 3;
        ra.l++;
      } else if (hs === as) {
        rh.d++;
        ra.d++;
        rh.points++;
        ra.points++;
      } else {
        ra.w++;
        ra.points += 3;
        rh.l++;
      }
    }
  };
  addFrom(homeId, homeGames);
  addFrom(awayId, awayGames);

  const sorted = [...rows.values()].sort(
    (a, b) => b.points - a.points || b.gf - b.ga - (a.gf - a.ga) || b.gf - a.gf || a.teamId.localeCompare(b.teamId)
  );
  const entries: EspnStandingsTeam[] = sorted.map((r, i) => ({
    teamId: r.teamId,
    teamName: '',
    rank: i + 1,
    gamesPlayed: r.gp,
    wins: r.w,
    ties: r.d,
    losses: r.l,
    pointsFor: r.gf,
    pointsAgainst: r.ga,
    points: r.points,
  }));
  const find = (teamId: string): EspnStandingsTeam | null => {
    const found = entries.find((e) => e.teamId === teamId);
    if (found) return found;
    // équipe sans match as-of : entrée neutre (le moteur gère gamesPlayed 0)
    return { teamId, teamName: '', rank: null, gamesPlayed: 0, wins: 0, ties: 0, losses: 0, pointsFor: 0, pointsAgainst: 0, points: 0 };
  };
  return { entries, home: find(homeId), away: find(awayId), teamsCount: Math.max(entries.length, 2) };
}

// ---------- Métriques ----------

export interface Triple {
  home: number;
  draw: number;
  away: number;
}

export type OutcomeIndex = 0 | 1 | 2; // 0 = home, 1 = draw, 2 = away (ordre H-D-A imposé pour le RPS)

export function outcomeOf(hs: number, as: number): OutcomeIndex {
  return hs > as ? 0 : hs === as ? 1 : 2;
}

/** Argmax déterministe (même convention que le moteur : égalité → domicile puis extérieur). */
export function argmaxTriple(p: Triple): OutcomeIndex {
  if (p.home >= p.draw && p.home >= p.away) return 0;
  if (p.away >= p.home && p.away >= p.draw) return 2;
  return 1;
}

export const EPS = 1e-10;

export interface CalibrationBucket {
  label: string;
  count: number;
  avgProb: number;
  actualRate: number;
}

export const CAL_BUCKET_DEFS: Array<{ label: string; min: number; max: number }> = [
  { label: '0-50', min: 0, max: 0.5 },
  { label: '50-60', min: 0.5, max: 0.6 },
  { label: '60-70', min: 0.6, max: 0.7 },
  { label: '70-80', min: 0.7, max: 0.8 },
  { label: '80-100', min: 0.8, max: 1.0001 },
];

export interface MetricAcc {
  n: number;
  brierSum: number;
  logLossSum: number;
  rpsSum: number;
  correct: number;
  buckets: Array<{ label: string; min: number; max: number; count: number; probSum: number; hits: number }>;
  // V3 (22-c, plan étapes 7-8) : contribution PAR MATCH — clé
  // `${matchId}@${horizon}h` — pour intervalles bootstrap et tests appariés
  // ΔBrier A vs B sur un MÊME ensemble de matchs.
  perMatch: Map<string, { brier: number; rps: number | null }>;
}

export function newAcc(): MetricAcc {
  return {
    n: 0,
    brierSum: 0,
    logLossSum: 0,
    rpsSum: 0,
    correct: 0,
    buckets: CAL_BUCKET_DEFS.map((b) => ({ ...b, count: 0, probSum: 0, hits: 0 })),
    perMatch: new Map(),
  };
}

function bucketFor(acc: MetricAcc, prob: number) {
  const b = acc.buckets.find((b) => prob >= b.min && prob < b.max);
  if (b) {
    b.count++;
    b.probSum += prob;
  }
  return b;
}

/** Ajoute une prédiction 1X2 (Brier multiclasses, LogLoss, RPS ordre H-D-A, précision du pick). */
export function addTriple(acc: MetricAcc, p: Triple, outcome: OutcomeIndex, matchKey?: string): void {
  const y = outcome === 0 ? [1, 0, 0] : outcome === 1 ? [0, 1, 0] : [0, 0, 1];
  const arr = [p.home, p.draw, p.away];
  acc.n++;
  const brier = arr.reduce((s, pi, i) => s + (pi - y[i]) ** 2, 0);
  acc.brierSum += brier;
  acc.logLossSum += -Math.log(Math.max(arr[outcome], EPS));
  // RPS : ordre imposé domicile < nul < extérieur, normalisation k−1 = 2
  const cumP1 = p.home;
  const cumP2 = p.home + p.draw;
  const cumY1 = outcome === 0 ? 1 : 0;
  const cumY2 = outcome <= 1 ? 1 : 0;
  const rps = ((cumP1 - cumY1) ** 2 + (cumP2 - cumY2) ** 2) / 2;
  acc.rpsSum += rps;
  const pick = argmaxTriple(p);
  const hit = pick === outcome;
  if (hit) acc.correct++;
  const b = bucketFor(acc, arr[pick]);
  if (b && hit) b.hits++;
  if (matchKey) acc.perMatch.set(matchKey, { brier, rps });
}

/** Ajoute une prédiction binaire (O/U 2.5, BTTS) : p = proba du côté « oui » (over / BTTS oui). */
export function addBinary(acc: MetricAcc, p: number, yes: boolean, matchKey?: string): void {
  const q = Math.min(Math.max(p, EPS), 1 - EPS);
  const y = yes ? 1 : 0;
  acc.n++;
  const brier = (p - y) ** 2;
  acc.brierSum += brier;
  acc.logLossSum += -Math.log(y ? q : 1 - q);
  const pickYes = p >= 0.5;
  const hit = pickYes === yes;
  if (hit) acc.correct++;
  const b = bucketFor(acc, pickYes ? p : 1 - p); // proba du côté piqué
  if (b && hit) b.hits++;
  if (matchKey) acc.perMatch.set(matchKey, { brier, rps: null });
}

export interface FinalMetrics {
  n: number;
  brier: number;
  logLoss: number;
  rps: number;
  accuracy: number;
  calibration: CalibrationBucket[];
  // V3 (22-c, plan étape 7) : intervalles bootstrap percentile 2,5-97,5 sur la
  // moyenne des contributions par match (B et RPS). null si n < 5 (CI dégénéré).
  brierCi: { lo: number; hi: number } | null;
  rpsCi: { lo: number; hi: number } | null;
}

// Cache de finalisation : le bootstrap (B=1000) n'est recalculé qu'une fois
// par accumulateur (buildByScope + tables console + ablation réutilisent les
// MÊMES accs). Déterministe (seed fixe) → objet identique à chaque appel.
const finalizeCache = new WeakMap<MetricAcc, FinalMetrics>();

export function finalizeAcc(acc: MetricAcc, withRps: boolean): FinalMetrics {
  const cached = finalizeCache.get(acc);
  if (cached) return cached;
  const brierVals = [...acc.perMatch.values()].map((v) => v.brier);
  const rpsVals = withRps
    ? ([...acc.perMatch.values()].map((v) => v.rps).filter((x): x is number => x !== null) as number[])
    : [];
  const result: FinalMetrics = {
    n: acc.n,
    brier: acc.n ? acc.brierSum / acc.n : Number.NaN,
    logLoss: acc.n ? acc.logLossSum / acc.n : Number.NaN,
    rps: withRps && acc.n ? acc.rpsSum / acc.n : Number.NaN,
    accuracy: acc.n ? acc.correct / acc.n : Number.NaN,
    calibration: acc.buckets
      .filter((b) => b.count > 0)
      .map((b) => ({ label: b.label, count: b.count, avgProb: b.probSum / b.count, actualRate: b.count ? b.hits / b.count : 0 })),
    brierCi: brierVals.length >= 5 ? bootstrapCI(brierVals) : null,
    rpsCi: rpsVals.length >= 5 ? bootstrapCI(rpsVals) : null,
  };
  finalizeCache.set(acc, result);
  return result;
}

// ---------- Baseline POISSON SIMPLE ----------

// Mêmes constantes globales que prediction.ts (baseline fidèle au projet).
export const POIS_LEAGUE_HOME = 1.52;
export const POIS_LEAGUE_AWAY = 1.22;
const POIS_TEAM = (POIS_LEAGUE_HOME + POIS_LEAGUE_AWAY) / 2; // 1.37 par équipe
const POIS_SHRINK_K = 5; // retrait léger vers 1 (K plus petit que le moteur : baseline « simple »)

function clampNum(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/**
 * Baseline POISSON SIMPLE (1X2 + O/U 2.5 + BTTS).
 * λ = moyenne ligue globale (1.52/1.22, constantes du moteur) × force
 * attaquante as-of de l'équipe × faiblesse défensive as-of de l'adversaire.
 * Choix documenté : ratios GLOBAUX (pas de contexte domicile/extérieur par
 * équipe — « simple »), retrait léger vers 1 n/(n+5), bornes [0.3, 2.5],
 * λ bornés [0.2, 3.5]. La matrice Poisson renormalisée (grille 0..12) et la
 * forme fermée BTTS sont celles du moteur (poissonModel, 21-b FIX 2).
 */
export function poissonSimpleProbs(
  homeGames: EspnScheduleGame[],
  awayGames: EspnScheduleGame[]
): { probs: Triple; lambdaHome: number; lambdaAway: number; ou25: number; bttsYes: number } {
  const sh = simpleStrength(homeGames);
  const sa = simpleStrength(awayGames);
  let lambdaHome = clampNum(POIS_LEAGUE_HOME * sh.att * sa.def, 0.2, 3.5);
  let lambdaAway = clampNum(POIS_LEAGUE_AWAY * sa.att * sh.def, 0.2, 3.5);
  if (!Number.isFinite(lambdaHome) || lambdaHome <= 0) lambdaHome = POIS_LEAGUE_HOME;
  if (!Number.isFinite(lambdaAway) || lambdaAway <= 0) lambdaAway = POIS_LEAGUE_AWAY;
  const model = poissonModel(lambdaHome, lambdaAway);
  const ou25 = model.overUnder.find((o) => o.line === 2.5);
  return {
    probs: model.probs,
    lambdaHome,
    lambdaAway,
    ou25: ou25?.over ?? 0.5,
    bttsYes: model.btts.yes,
  };
}

/** Forces att/déf basiques : buts marqués/encaissés moyens as-of ÷ moyenne ligue, retrait n/(n+K). */
function simpleStrength(games: EspnScheduleGame[]): { att: number; def: number; n: number } {
  const n = games.length;
  if (n === 0) return { att: 1, def: 1, n: 0 };
  const gf = games.reduce((s, g) => s + (g.teamScore ?? 0), 0) / n;
  const ga = games.reduce((s, g) => s + (g.opponentScore ?? 0), 0) / n;
  const w = n / (n + POIS_SHRINK_K);
  const att = clampNum(1 + (gf / POIS_TEAM - 1) * w, 0.3, 2.5);
  const def = clampNum(1 + (ga / POIS_TEAM - 1) * w, 0.3, 2.5);
  return { att, def, n };
}

// ---------- Paramètres de ligue empiriques (audit #9) ----------

export interface LeagueGoalParams {
  homeAvg: number;
  awayAvg: number;
  drawRate: number;
  sample: number;
}

/**
 * Estime, PAR LIGUE, les moyennes de buts domicile/extérieur + taux de nul
 * sur les matchs de `season` (saison PRÉCÉDENTE — entièrement antérieure à
 * la fenêtre backtest : zéro fuite walk-forward), depuis les calendriers
 * déjà récupérés (dédupliqués par eventId ; l'endpoint schedule par équipe
 * ne renvoie que les matchs de la ligue — vérifié).
 */
export function estimateLeagueParams(
  sched: Map<ScheduleKey, TeamSeasonSchedules>,
  season: number
): { byLeague: Record<string, LeagueGoalParams>; global: LeagueGoalParams } {
  // matchs canoniques dédupliqués par ligue
  const perLeague = new Map<string, Map<string, { hs: number; as: number }>>();
  for (const [key, entry] of sched) {
    const league = key.slice(0, key.indexOf(':'));
    const games = entry.bySeason.get(season) ?? [];
    let bag = perLeague.get(league);
    if (!bag) {
      bag = new Map();
      perLeague.set(league, bag);
    }
    for (const g of games) {
      if (!g.completed || g.teamScore === null || g.opponentScore === null) continue;
      const homeIdG = g.homeAway === 'home';
      const hs = homeIdG ? g.teamScore : g.opponentScore;
      const as = homeIdG ? g.opponentScore : g.teamScore;
      bag.set(g.eventId, { hs: hs as number, as: as as number });
    }
  }

  const byLeague: Record<string, LeagueGoalParams> = {};
  let gHome = 0;
  let gAway = 0;
  let gDraw = 0;
  let gN = 0;
  for (const [league, bag] of perLeague) {
    let home = 0;
    let away = 0;
    let draws = 0;
    const n = bag.size;
    for (const { hs, as } of bag.values()) {
      home += hs;
      away += as;
      if (hs === as) draws++;
    }
    if (n === 0) continue;
    byLeague[league] = {
      homeAvg: Math.round((home / n) * 1000) / 1000,
      awayAvg: Math.round((away / n) * 1000) / 1000,
      drawRate: Math.round((draws / n) * 1000) / 1000,
      sample: n,
    };
    gHome += home;
    gAway += away;
    gDraw += draws;
    gN += n;
  }
  const global: LeagueGoalParams = gN
    ? {
        homeAvg: Math.round((gHome / gN) * 1000) / 1000,
        awayAvg: Math.round((gAway / gN) * 1000) / 1000,
        drawRate: Math.round((gDraw / gN) * 1000) / 1000,
        sample: gN,
      }
    : { homeAvg: POIS_LEAGUE_HOME, awayAvg: POIS_LEAGUE_AWAY, drawRate: 0.25, sample: 0 };
  return { byLeague, global };
}

// ════════════════════════════════════════════════════════════════════════
// VOLTRIX bet — Task 22-c : extensions V3 (horizons T−Xh, cotes-à-T,
// incertitude bootstrap, tests appariés, évaluation multi-variantes).
// ════════════════════════════════════════════════════════════════════════

// ---------- Incertitude (plan étape 7) ----------

/** PRNG déterministe (mulberry32) — runs reproductibles bit à bit. */
export function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let x = Math.imul(t ^ (t >>> 15), t | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

export const BOOTSTRAP_B = 1000; // plan étape 7 : 1000 rééchantillons

/** IC bootstrap percentile 2,5-97,5 de la MOYENNE de `values` (B rééchantillons, seed fixe). */
export function bootstrapCI(values: number[], B: number = BOOTSTRAP_B, seed = 22000): { lo: number; hi: number } {
  const n = values.length;
  if (n === 0) return { lo: Number.NaN, hi: Number.NaN };
  const rnd = mulberry32(seed);
  const boots: number[] = new Array(B);
  for (let i = 0; i < B; i++) {
    let s = 0;
    for (let j = 0; j < n; j++) s += values[(rnd() * n) | 0];
    boots[i] = s / n;
  }
  boots.sort((a, b) => a - b);
  return { lo: boots[Math.floor(0.025 * B)], hi: boots[Math.ceil(0.975 * B) - 1] };
}

export interface PairedResult {
  n: number;
  meanDelta: number; // Δ = a − b (négatif ⇒ a « meilleur » sur une erreur)
  ciLo: number;
  ciHi: number;
  pApprox: number; // bootstrap percentile add-one, bilatéral
}

/**
 * Test APPARIÉ A vs B (plan étape 7-8) : ΔBrier par match sur l'intersection
 * des clés de matchs, IC bootstrap percentile de la moyenne de Δ et p-value
 * approchée (part de la distribution bootstrap de part et d'autre de 0,
 * convention add-one). null si moins de 5 paires communes.
 */
export function pairedDeltaTest(
  a: Map<string, { brier: number }>,
  b: Map<string, { brier: number }>,
  B: number = BOOTSTRAP_B,
  seed = 22001
): PairedResult | null {
  const d: number[] = [];
  for (const [k, va] of a) {
    const vb = b.get(k);
    if (vb) d.push(va.brier - vb.brier);
  }
  if (d.length < 5) return null;
  const mean = d.reduce((s, x) => s + x, 0) / d.length;
  const rnd = mulberry32(seed);
  let le = 0;
  let ge = 0;
  const boots: number[] = new Array(B);
  for (let i = 0; i < B; i++) {
    let s = 0;
    for (let j = 0; j < d.length; j++) s += d[(rnd() * d.length) | 0];
    boots[i] = s / d.length;
    if (boots[i] <= 0) le++;
    else ge++;
  }
  boots.sort((x, y) => x - y);
  const p = 2 * Math.min((le + 1) / (B + 1), (ge + 1) / (B + 1));
  return { n: d.length, meanDelta: mean, ciLo: boots[Math.floor(0.025 * B)], ciHi: boots[Math.ceil(0.975 * B) - 1], pApprox: Math.min(1, p) };
}

// ---------- Cotes-à-T : sémantique open/close séparée (plan étapes 3-4) ----------

/**
 * pickcenter → cotes OPEN UNIQUEMENT (proxy « cotes-à-T »). Limitation ESPN
 * documentée : aucun timestamp de cote dans le pickcenter ; l'OPEN est la
 * seule valeur raisonnablement disponible plusieurs heures avant le coup
 * d'envoi. Les CLOSE (clôture) sont INTERDITES en input modèle (étape 3) et
 * conservées à part comme référence « Marché-clôture ». Ici : champs close
 * forcés à null, ligne = ligne OPEN (repli overUnder pickcenter).
 */
export function pickcenterToOpenOnlyOdds(pc: RawPickcenter | undefined): EspnOdds | null {
  if (!pc) return null;
  const openFrom = (side: RawMLOdd | undefined): number | null => americanToDecimal(parseAmericanStr(side?.open?.odds));
  const home = openFrom(pc.moneyline?.home);
  const draw = openFrom(pc.moneyline?.draw);
  const away = openFrom(pc.moneyline?.away);
  const openLine =
    parseLineStr(pc.total?.over?.open?.line) ??
    parseLineStr(pc.total?.under?.open?.line) ??
    (typeof pc.overUnder === 'number' ? pc.overUnder : null);
  const over = { line: openLine, openOdds: americanToDecimal(parseAmericanStr(pc.total?.over?.open?.odds)), closeOdds: null };
  const under = { line: openLine, openOdds: americanToDecimal(parseAmericanStr(pc.total?.under?.open?.odds)), closeOdds: null };
  const hasAny = !!(home || draw || away || over.openOdds || under.openOdds);
  if (!hasAny) return null;
  return {
    provider: pc.provider?.name ?? 'ESPN',
    overUnderLine: openLine,
    moneyline: { home: { open: home, close: null }, draw: { open: draw, close: null }, away: { open: away, close: null } },
    total: { over, under },
    hasOdds: true,
  };
}

export interface HistoricalOdds {
  full: EspnOdds | null; // open + close (close = référence Marché-clôture UNIQUEMENT)
  openOnly: EspnOdds | null; // input modèle « cotes-à-T » (close = null)
}

/**
 * Cotes historiques V3 — summary ESPN (pickcenter DraftKings). Retourne les
 * DEUX vues : full (open+close, référence) et openOnly (input modèle à T).
 * Le scoreboard historique ne conserve PAS les cotes (vérifié 21-d).
 */
export async function fetchHistoricalOddsV3(
  matches: CollectedMatch[],
  stats: RequestStats,
  onProgress?: (msg: string) => void
): Promise<Map<string, HistoricalOdds>> {
  const out = new Map<string, HistoricalOdds>();
  let done = 0;
  await mapWithConcurrency(matches, 5, async (m) => {
    stats.summary++;
    let full: EspnOdds | null = null;
    let openOnly: EspnOdds | null = null;
    try {
      const res = await fetch(`${SUMMARY_SITE}/${m.league}/summary?event=${m.id}`, {
        headers: { 'User-Agent': 'curl/8.5.0', Accept: 'application/json' },
      });
      if (res.ok) {
        const json = (await res.json()) as { pickcenter?: RawPickcenter[] };
        const pc = json.pickcenter?.[0];
        full = pickcenterToOdds(pc);
        openOnly = pickcenterToOpenOnlyOdds(pc);
      }
    } catch {
      full = null;
      openOnly = null;
    }
    out.set(m.id, { full, openOnly });
    done++;
    if (done % 50 === 0) onProgress?.(`[cotes] ${done}/${matches.length}`);
  });
  return out;
}

/** MARCHÉ 1X2 dé-margé — STRICTEMENT un seul côté (open OU close), zéro repli croisé. */
export function market1x2Side(odds: EspnOdds | null, side: 'open' | 'close'): Triple | null {
  if (!odds) return null;
  const pick = (s: { open: number | null; close: number | null }): number | null => (side === 'open' ? s.open : s.close);
  const dm = deMargin1x2(pick(odds.moneyline.home) ?? NaN, pick(odds.moneyline.draw) ?? NaN, pick(odds.moneyline.away) ?? NaN);
  return dm ? { home: dm.pH, draw: dm.pD, away: dm.pA } : null;
}

/** MARCHÉ O/U `line` dé-margé — STRICTEMENT un côté ; open exige la ligne OPEN exacte. */
export function marketOu25Side(odds: EspnOdds | null, side: 'open' | 'close', line = 2.5): number | null {
  if (!odds) return null;
  if (side === 'open') {
    if (odds.total.over.line !== line) return null;
    const dm = deMarginOverUnder(odds.total.over.openOdds ?? NaN, odds.total.under.openOdds ?? NaN);
    return dm ? dm.pOver : null;
  }
  if (odds.overUnderLine !== line) return null;
  const dm = deMarginOverUnder(odds.total.over.closeOdds ?? NaN, odds.total.under.closeOdds ?? NaN);
  return dm ? dm.pOver : null;
}

// ---------- Variantes V3 (plan étapes 6 et 8) ----------

export type Key1x2 = 'marketAtT' | 'marketClose' | 'poisson' | 'elo' | 'mix' | 'voltrixFull' | 'voltrixLeague';
export type KeyBin =
  | 'marketAtT'
  | 'marketClose'
  | 'poisson'
  | 'mix'
  | 'mixCal'
  | 'voltrixFullRaw'
  | 'voltrixFullCal'
  | 'voltrixLeagueRaw'
  | 'voltrixLeagueCal';

export const VARIANT_LABELS: Record<string, string> = {
  marketAtT: 'MARCHÉ-À-T (open dé-margé)',
  marketClose: 'MARCHÉ-CLÔTURE (référence)',
  poisson: 'POISSON-SIMPLE',
  elo: 'ELO-SIMPLE',
  mix: 'MIX (Poisson+Elo+forme)',
  mixCal: 'VOLTRIX-MIX-CAL',
  voltrixFull: 'VOLTRIX-FULL',
  voltrixFullCal: 'VOLTRIX-FULL-CAL (ancré open)',
  voltrixFullRaw: 'VOLTRIX-FULL-RAW',
  voltrixLeague: 'VOLTRIX-LEAGUE',
  voltrixLeagueRaw: 'VOLTRIX-LEAGUE-RAW',
  voltrixLeagueCal: 'VOLTRIX-LEAGUE-CAL (ancré open)',
};

// Indépendance (plan étape 8) : les variantes CALIBRÉES sont ancrées sur le
// marché (open) — toute comparaison « calibré vs marché qui l'a ancré » est
// NON-INDÉPENDANTE ; marché vs marché = même source (non-indépendant aussi).
const CAL_ANCHORED = new Set<string>(['mixCal', 'voltrixFullCal', 'voltrixLeagueCal']);
const MARKET_KEYS = new Set<string>(['marketAtT', 'marketClose']);

export function independenceOf(a: string, b: string): 'independant' | 'non-indépendant' {
  if (MARKET_KEYS.has(a) && MARKET_KEYS.has(b)) return 'non-indépendant';
  if ((CAL_ANCHORED.has(a) && MARKET_KEYS.has(b)) || (CAL_ANCHORED.has(b) && MARKET_KEYS.has(a))) return 'non-indépendant';
  return 'independant';
}

export interface EvalVariants {
  oneXtwo: Partial<Record<Key1x2, Triple>>;
  ou25: Partial<Record<KeyBin, number>>;
  btts: Partial<Record<KeyBin, number>>;
  lambdas: {
    poisson: { h: number; a: number };
    mix: { h: number; a: number };
    full: { h: number; a: number };
    league: { h: number; a: number };
  };
  hist: {
    home: { n: number; lastDate: string | null; gf: number; ga: number; rank: number | null; gp: number; points: number };
    away: { n: number; lastDate: string | null; gf: number; ga: number; rank: number | null; gp: number; points: number };
  };
  digest: string; // empreinte SHA-256 des entrées as-of GELÉES (plan étape 5)
  tPredMs: number;
}

export interface EvalMatchRef {
  id: string;
  league: string;
  kickoff: string;
  homeId: string;
  homeName: string;
  homeLogo: string | null;
  awayId: string;
  awayName: string;
  awayLogo: string | null;
}

function histSummary(games: EspnScheduleGame[], st: EspnStandingsTeam | null) {
  return {
    n: games.length,
    lastDate: games.length ? games[games.length - 1].date : null,
    gf: games.reduce((s, g) => s + (g.teamScore ?? 0), 0),
    ga: games.reduce((s, g) => s + (g.opponentScore ?? 0), 0),
    rank: st?.rank ?? null,
    gp: st?.gamesPlayed ?? 0,
    points: st?.points ?? 0,
  };
}

/** Empreinte courte des entrées as-of (reconstructibilité / anti-fuite). */
export function buildInputsDigest(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 16);
}

/**
 * Évaluation V3 d'UN match à UN horizon — fonction PURE (aucun réseau, aucune
 * mutation d'input) : T_pred = kickoff − horizonH h ; historiques STRICT < T_pred ;
 * classement synthétisé < T_pred ; blessures [] ; météo null ; cotes input
 * modèle = OPEN ONLY (close interdites, plan étape 3) — la clôture n'entre
 * QUE comme référence Marché-clôture, jamais dans runEngine.
 *
 * Variantes (plan étape 6) : MARCHÉ-À-T (open dé-margé), MARCHÉ-CLÔTURE
 * (référence), POISSON-SIMPLE, ELO-SIMPLE, MIX (22-b : contextMode 'mix',
 * odds null, standings null), VOLTRIX-FULL (cal ancré open + raw),
 * VOLTRIX-LEAGUE (leagueGoalAverages saison précédente), VOLTRIX-MIX-CAL.
 */
export function evaluateMatchV3(
  m: EvalMatchRef,
  oddsOpen: EspnOdds | null,
  oddsCloseRef: EspnOdds | null,
  homeGamesAll: EspnScheduleGame[],
  awayGamesAll: EspnScheduleGame[],
  leagueParams: { home: number; away: number } | null,
  horizonH: number
): EvalVariants {
  const kickoffMs = Date.parse(m.kickoff);
  const tPredMs = kickoffMs - horizonH * 3_600_000;
  const homeGames = filterAsOfGames(homeGamesAll, tPredMs);
  const awayGames = filterAsOfGames(awayGamesAll, tPredMs);
  const standings = synthStandings(m.homeId, homeGames, m.awayId, awayGames);

  const baseInput = (over: Partial<EngineInput>, withStandings: boolean): EngineInput => ({
    homeTeam: {
      id: m.homeId,
      name: m.homeName,
      logo: m.homeLogo,
      schedule: homeGames,
      standings: withStandings ? standings.home : null,
    },
    awayTeam: {
      id: m.awayId,
      name: m.awayName,
      logo: m.awayLogo,
      schedule: awayGames,
      standings: withStandings ? standings.away : null,
    },
    injuries: [], // as-of : endpoint ESPN = état ACTUEL (fuite) → vide
    odds: null,
    isDerby: false, // détection rivalités codée DANS runEngine
    weatherImpact: null,
    nowMs: tPredMs, // T_pred : fatigue/14 jours as-of
    leagueTeamsCount: withStandings ? standings.teamsCount : 20,
    ...over,
  });

  const out: EvalVariants = {
    oneXtwo: {},
    ou25: {},
    btts: {},
    lambdas: {
      poisson: { h: Number.NaN, a: Number.NaN },
      mix: { h: Number.NaN, a: Number.NaN },
      full: { h: Number.NaN, a: Number.NaN },
      league: { h: Number.NaN, a: Number.NaN },
    },
    hist: { home: histSummary(homeGames, standings.home), away: histSummary(awayGames, standings.away) },
    digest: '',
    tPredMs,
  };

  // A. MARCHÉ-À-T = open dé-margé STRICT (aucun repli close) ; MARCHÉ-CLÔTURE = référence.
  const mOpen = market1x2Side(oddsOpen, 'open');
  if (mOpen) out.oneXtwo.marketAtT = mOpen;
  const mOpenOu = marketOu25Side(oddsOpen, 'open');
  if (mOpenOu !== null) out.ou25.marketAtT = mOpenOu;
  const mClose = market1x2Side(oddsCloseRef, 'close');
  if (mClose) out.oneXtwo.marketClose = mClose;
  const mCloseOu = marketOu25Side(oddsCloseRef, 'close');
  if (mCloseOu !== null) out.ou25.marketClose = mCloseOu;
  // BTTS : ESPN ne publie aucune cote BTTS → marché absent (documenté).

  // B. POISSON-SIMPLE
  const pois = poissonSimpleProbs(homeGames, awayGames);
  out.oneXtwo.poisson = pois.probs;
  out.ou25.poisson = pois.ou25;
  out.btts.poisson = pois.bttsYes;
  out.lambdas.poisson = { h: pois.lambdaHome, a: pois.lambdaAway };

  // C. ELO-SIMPLE (historiques as-of uniquement)
  const elo = computeElo(m.homeId, m.awayId, new Map([
    [m.homeId, homeGames],
    [m.awayId, awayGames],
  ]));
  out.oneXtwo.elo = eloToProbs(elo.ratings.get(m.homeId) ?? 1500, elo.ratings.get(m.awayId) ?? 1500);

  // D. MIX (recette 22-b : contextMode 'mix', odds null, standings null)
  const mixRes = runEngine(baseInput({ contextMode: 'mix' }, false));
  out.oneXtwo.mix = mixRes.prediction.probs;
  const mixOu = mixRes.prediction.raw.overUnder.find((o) => o.line === 2.5);
  if (mixOu) out.ou25.mix = mixOu.over;
  out.btts.mix = mixRes.prediction.raw.btts.yes;
  out.lambdas.mix = { h: mixRes.prediction.lambda.home, a: mixRes.prediction.lambda.away };

  // E. VOLTRIX-FULL : input cotes = OPEN ONLY → calibration ancrée OPEN ;
  //    p.raw inchangée par la calibration (brut = indépendant marché).
  const fullRes = runEngine(baseInput({ odds: oddsOpen }, true));
  out.oneXtwo.voltrixFull = fullRes.prediction.probs;
  const fullRawOu = fullRes.prediction.raw.overUnder.find((o) => o.line === 2.5);
  if (fullRawOu) out.ou25.voltrixFullRaw = fullRawOu.over;
  out.btts.voltrixFullRaw = fullRes.prediction.raw.btts.yes;
  if (oddsOpen) {
    const calOu = fullRes.prediction.overUnder.find((o) => o.line === 2.5);
    if (calOu) out.ou25.voltrixFullCal = calOu.over;
    out.btts.voltrixFullCal = fullRes.prediction.btts.yes;
  }
  out.lambdas.full = { h: fullRes.prediction.lambda.home, a: fullRes.prediction.lambda.away };

  // F. VOLTRIX-LEAGUE : moyennes de buts EMPIRIQUES (saison précédente, zéro fuite)
  const leagueRes = runEngine(
    baseInput(leagueParams ? { odds: oddsOpen, leagueGoalAverages: { home: leagueParams.home, away: leagueParams.away } } : { odds: oddsOpen }, true)
  );
  out.oneXtwo.voltrixLeague = leagueRes.prediction.probs;
  const lgRawOu = leagueRes.prediction.raw.overUnder.find((o) => o.line === 2.5);
  if (lgRawOu) out.ou25.voltrixLeagueRaw = lgRawOu.over;
  out.btts.voltrixLeagueRaw = leagueRes.prediction.raw.btts.yes;
  if (oddsOpen) {
    const lgCalOu = leagueRes.prediction.overUnder.find((o) => o.line === 2.5);
    if (lgCalOu) out.ou25.voltrixLeagueCal = lgCalOu.over;
    out.btts.voltrixLeagueCal = leagueRes.prediction.btts.yes;
  }
  out.lambdas.league = { h: leagueRes.prediction.lambda.home, a: leagueRes.prediction.lambda.away };

  // G. VOLTRIX-MIX-CAL (utile : isole l'effet calibration dans le mode mix)
  if (oddsOpen) {
    const mixCalRes = runEngine(baseInput({ contextMode: 'mix', odds: oddsOpen }, false));
    const mcOu = mixCalRes.prediction.overUnder.find((o) => o.line === 2.5);
    if (mcOu) out.ou25.mixCal = mcOu.over;
    out.btts.mixCal = mixCalRes.prediction.btts.yes;
  }

  // Empreinte des entrées GELÉES (plan étape 5) — le modèle ne voit JAMAIS
  // les cotes close (seule la référence marché-clôture les conserve).
  out.digest = buildInputsDigest({
    v: MODEL_VERSION,
    id: m.id,
    league: m.league,
    tPred: new Date(tPredMs).toISOString(),
    horizonH,
    home: out.hist.home,
    away: out.hist.away,
    standingsTeamsCount: standings.teamsCount,
    oddsOpen: oddsOpen
      ? { ml: [oddsOpen.moneyline.home.open, oddsOpen.moneyline.draw.open, oddsOpen.moneyline.away.open], line: oddsOpen.overUnderLine, ou: [oddsOpen.total.over.openOdds, oddsOpen.total.under.openOdds] }
      : null,
    leagueParams,
  });
  return out;
}
