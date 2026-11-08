"use client";

/* ============================================================
   VOLTRIX app — Bridge football : ESPN → types UI
   Chargement progressif de la journée par vague de priorité
   (top ligues d'abord), pronos rapides en arrière-plan,
   analyse complète à la demande. 100 % local, sans base.
   ============================================================ */

import { LEAGUES, getLeague } from "./leagues";
import { fetchScoreboard, mapLimited, type EspnEvent, type EspnScoreboard } from "./espn";
import { analyzeMatch, type AnalyzeResult } from "./analyze";
import type { LightMatch, MatchesResponse, QuickPred } from "../voltrix-types";

/* ---------- Journée : scan progressif par priorité ---------- */

export interface DayProgress {
  leagues: MatchesResponse["leagues"];
  scanned: number;
}

function toLightMatches(board: EspnScoreboard): LightMatch[] {
  const def = getLeague(board.leagueCode);
  return board.events
    .filter((e) => e.home && e.away)
    .map((e) => {
      const ev: EspnEvent = e;
      const home = ev.home!;
      const away = ev.away!;
      const hasScore = home.score != null && away.score != null;
      return {
        id: ev.id,
        leagueCode: board.leagueCode,
        leagueName: def?.name ?? board.leagueName,
        leagueShort: def?.shortName ?? board.leagueCode.toUpperCase(),
        region: def?.region ?? "europe",
        date: ev.date,
        status: ev.status,
        statusDetail:
          ev.status === "pre" && !hasScore
            ? ""
            : ev.statusDetail || (ev.completed ? "FT" : ""),
        home: {
          id: home.team.id,
          name: home.team.displayName,
          shortName: home.team.shortDisplayName || home.team.abbreviation || home.team.displayName,
          logo: home.team.logo,
          score: home.score,
          form: home.form,
          record: home.recordSummary,
        },
        away: {
          id: away.team.id,
          name: away.team.displayName,
          shortName: away.team.shortDisplayName || away.team.abbreviation || away.team.displayName,
          logo: away.team.logo,
          score: away.score,
          form: away.form,
          record: away.recordSummary,
        },
        hasOdds: ev.odds?.hasOdds ?? false,
        oddsProvider: ev.odds?.provider ?? null,
        ouLine: ev.odds?.overUnderLine ?? null,
        mlHome: ev.odds?.moneyline.home.close ?? null,
        mlDraw: ev.odds?.moneyline.draw.close ?? null,
        mlAway: ev.odds?.moneyline.away.close ?? null,
        venue: ev.venue,
      } satisfies LightMatch;
    });
}

function sortLeagueGroup(a: MatchesResponse["leagues"][number], b: MatchesResponse["leagues"][number]) {
  const pa = getLeague(a.code)?.priority ?? 9;
  const pb = getLeague(b.code)?.priority ?? 9;
  if (pa !== pb) return pa - pb;
  return a.name.localeCompare(b.name, "fr");
}

/**
 * Charge tous les matchs d'une journée : vague 1 = top ligues (priorité 1),
 * puis priorité 2, puis 3. `onProgress` est appelé après chaque sous-vague
 * pour afficher les matchs au fur et à mesure.
 */
export async function loadFootballDay(
  dateISO: string,
  onProgress?: (p: DayProgress) => void,
): Promise<MatchesResponse> {
  const groups = new Map<string, MatchesResponse["leagues"][number]>();
  let scanned = 0;

  const waves: Array<{ codes: string[]; size: number }> = [];
  for (const prio of [1, 2, 3]) {
    const codes = LEAGUES.filter((l) => l.priority === prio).map((l) => l.code);
    const size = prio === 1 ? 22 : prio === 2 ? 18 : 16;
    for (let i = 0; i < codes.length; i += size) {
      waves.push({ codes: codes.slice(i, i + size), size });
    }
  }

  for (const wave of waves) {
    await mapLimited(wave.codes, 4, async (code) => {
      const board = await fetchScoreboard(code, dateISO).catch(() => null);
      scanned++;
      if (!board || board.events.length === 0) return;
      const def = getLeague(code);
      const matches = toLightMatches(board);
      if (matches.length === 0) return;
      groups.set(code, {
        code,
        name: def?.name ?? board.leagueName,
        shortName: def?.shortName ?? code.toUpperCase(),
        region: def?.region ?? "europe",
        matches,
      });
    });
    onProgress?.({
      leagues: [...groups.values()].sort(sortLeagueGroup),
      scanned,
    });
  }

  const leagues = [...groups.values()].sort(sortLeagueGroup);
  return {
    date: dateISO,
    totalMatches: leagues.reduce((n, l) => n + l.matches.length, 0),
    leagues,
    scanMs: 0,
  };
}

/* ---------- Analyse complète (page détail) ---------- */

export type FootballDetail = AnalyzeResult;

export function analyzeFootballMatch(
  matchId: string,
  leagueCode: string,
  date: string,
  opts: { light?: boolean } = {},
): Promise<FootballDetail | null> {
  return analyzeMatch({ matchId, leagueCode, date }, opts);
}

/* ---------- Pronos rapides (cartes de l'accueil) ---------- */

/** QuickPred dérivé d'une analyse complète (mêmes champs que l'API historique). */
export function quickPredOf(a: FootballDetail): QuickPred {
  return {
    matchId: a.matchId,
    leagueCode: a.leagueCode,
    leagueName: a.leagueName,
    status: a.status,
    probs: a.prediction.probs,
    lambda: a.prediction.lambda,
    confidence: a.prediction.confidence,
    confidenceLabel: a.prediction.confidenceLabel,
    recommendedBets: a.prediction.recommendedBets,
    overUnder: a.prediction.overUnder,
    btts: a.prediction.btts,
    topScores: a.prediction.topScores,
    valueBetsCount: a.prediction.valueBets.length,
    ouOdds: a.odds
      ? {
          line: a.odds.overUnderLine,
          over: a.odds.total.over.closeOdds,
          under: a.odds.total.under.closeOdds,
        }
      : null,
  };
}

/**
 * Calcule les pronos d'une liste de matchs à venir, par petits lots,
 * et émet chaque résultat dès qu'il est prêt (analyse complète moteur,
 * mise en cache par match — les historiques/Classements sont partagés
 * entre matchs d'une même ligue).
 */
export async function computeQuickPreds(
  matches: Array<{ id: string; leagueCode: string; date: string }>,
  onPred: (pred: QuickPred) => void,
  opts: { max?: number } = {},
): Promise<void> {
  const cap = opts.max ?? 24;
  const queue = matches.slice(0, cap);
  await mapLimited(queue, 2, async (m) => {
    const res = await analyzeFootballMatch(m.id, m.leagueCode, m.date, { light: true }).catch(() => null);
    if (res) onPred(quickPredOf(res));
  });
}
