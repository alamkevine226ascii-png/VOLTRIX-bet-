"use client";

/* ============================================================
   VOLTRIX — Registre persistant des value bets (impl. n°5)
   Objectif : suivre dans la durée la performance RÉELLE des
   value bets proposés par le moteur — ROI en mise plate et
   score de Brier des probabilités annoncées — pour confronter
   l'app à ses propres chiffres (éthique VOLTRIX : publier les
   résultats, y compris défavorables).

   Stockage : localStorage via persist.ts, SANS expiration
   (ttlMs = 0 → Infinity) — un registre ne doit jamais expirer.
   Résolution : le scoreboard ESPN (déjà mis en cache par l'app)
   fournit le score final ; chaque pari est marqué gagné/perdu
   quand le match est terminé, annulé si introuvable après 30 j.

   Contexte backtest (11/2026, football-data.co.uk, test 2024-26,
   mise plate) : la discipline actuelle (seuil d'edge 5 % + cote
   ≤ 2,5) mesure un ROI de −3,7 % sur 766 paris, contre −12,8 %
   pour l'ancienne règle (seuil 2 %, sans plafond). Le suivi
   in-app dira si l'app fait mieux que sa propre simulation.
   ============================================================ */

import { persistGet, persistSet } from "../persist";
import { fetchScoreboard } from "./espn";

const LEDGER_KEY = "voltrix:bets-ledger:v1";
const MAX_SLIPS = 600; // taille plafonnée (quota localStorage ~5 Mo)
const VOID_AFTER_DAYS = 30;

export type BetStatus = "pending" | "won" | "lost" | "void";

export interface BetSlip {
  id: string;           // `${matchId}#${code}` — idempotence
  matchId: string;
  leagueCode: string;
  matchDate: string;    // ISO du coup d'envoi
  homeName: string;
  awayName: string;
  market: string;       // libellé affiché (ex. "1X2")
  pick: string;         // libellé affiché (ex. "Victoire domicile")
  code: string;         // machine : 1X2:H | 1X2:D | 1X2:A | OU:O:2.5 | OU:U:3.5
  modelProb: number;
  odds: number;
  edge: number;
  kelly: number;
  recordedAt: number;
  status: BetStatus;
  resolvedAt?: number;
  profit?: number;      // mise plate 1u : odds-1 (gagné) / -1 (perdu) / 0 (annulé)
}

function loadLedger(): BetSlip[] {
  const slips = persistGet<BetSlip[]>(LEDGER_KEY);
  return Array.isArray(slips) ? slips : [];
}

function saveLedger(slips: BetSlip[]): void {
  // plafond : on évacue d'abord les annulés, puis les plus anciens résolus
  if (slips.length > MAX_SLIPS) {
    const rank = (s: BetSlip): number =>
      s.status === "void" ? 0 : s.status === "pending" ? 2 : 1;
    slips = [...slips].sort((a, b) => rank(b) - rank(a) || a.recordedAt - b.recordedAt)
      .slice(0, MAX_SLIPS);
  }
  persistSet(LEDGER_KEY, slips, 0); // Infinity : jamais d'expiration
}

/** Enregistre les value bets d'une analyse (idempotent, fire-and-forget). */
export function recordValueBets(analysis: {
  matchId: string;
  leagueCode: string;
  matchDate: string;
  homeName: string;
  awayName: string;
  valueBets: Array<{ market: string; pick: string; code: string; modelProb: number;
                     odds: number; edge: number; kelly: number }>;
}): void {
  try {
    if (!analysis.valueBets?.length) return;
    const slips = loadLedger();
    const known = new Set(slips.map((s) => s.id));
    let added = false;
    for (const b of analysis.valueBets) {
      const id = `${analysis.matchId}#${b.code}`;
      if (known.has(id)) continue;
      slips.push({
        id,
        matchId: analysis.matchId,
        leagueCode: analysis.leagueCode,
        matchDate: analysis.matchDate,
        homeName: analysis.homeName,
        awayName: analysis.awayName,
        market: b.market,
        pick: b.pick,
        code: b.code,
        modelProb: b.modelProb,
        odds: b.odds,
        edge: b.edge,
        kelly: b.kelly,
        recordedAt: Date.now(),
        status: "pending",
      });
      added = true;
    }
    if (added) saveLedger(slips);
  } catch {
    /* registre best-effort : jamais casser une analyse */
  }
}

/** Un pari est-il gagné au vu du score final ? */
function slipWon(code: string, homeScore: number, awayScore: number): boolean {
  if (code === "1X2:H") return homeScore > awayScore;
  if (code === "1X2:D") return homeScore === awayScore;
  if (code === "1X2:A") return homeScore < awayScore;
  const parts = code.split(":"); // OU:O:2.5 → ["OU", "O", "2.5"]
  if (parts[0] === "OU" && parts.length === 3) {
    const line = Number(parts[2]);
    if (!Number.isFinite(line)) return false;
    return parts[1] === "O" ? homeScore + awayScore > line : homeScore + awayScore < line;
  }
  return false;
}

/**
 * Résout les paris en attente dont le match est terminé (3 h après
 * le coup d'envoi). Utilise le scoreboard ESPN — déjà mis en cache
 * par le reste de l'app (TTL 10 min), donc rejouer la résolution
 * est peu coûteux. Renvoie le nombre de paris résolus.
 */
export async function resolvePendingBets(): Promise<number> {
  const slips = loadLedger();
  const pending = slips.filter((s) => s.status === "pending");
  if (!pending.length) return 0;

  const now = Date.now();
  let resolved = 0;
  // regrouper par (ligue, date) pour limiter les appels scoreboard
  const byBoard = new Map<string, BetSlip[]>();
  for (const s of pending) {
    const t = Date.parse(s.matchDate);
    if (!Number.isFinite(t)) continue;
    if (now < t + 3 * 3600_000) continue;          // pas encore terminé
    if (now > t + VOID_AFTER_DAYS * 86400_000) {    // introuvable depuis 30 j
      s.status = "void";
      s.resolvedAt = now;
      s.profit = 0;
      resolved++;
      continue;
    }
    const key = `${s.leagueCode}|${s.matchDate.slice(0, 10)}`;
    const list = byBoard.get(key) ?? [];
    list.push(s);
    byBoard.set(key, list);
  }

  for (const [key, group] of byBoard) {
    const [leagueCode, dateStr] = key.split("|");
    try {
      const board = await fetchScoreboard(leagueCode, dateStr);
      if (!board) continue;
      for (const s of group) {
        const ev = board.events.find((e) => e.id === s.matchId);
        if (!ev || ev.status !== "post") continue;
        const hs = ev.home?.score;
        const as = ev.away?.score;
        if (typeof hs !== "number" || typeof as !== "number") continue;
        const won = slipWon(s.code, hs, as);
        s.status = won ? "won" : "lost";
        s.resolvedAt = Date.now();
        s.profit = won ? s.odds - 1 : -1;
        resolved++;
      }
    } catch {
      /* scoreboard indisponible : restera en attente, repris au prochain appel */
    }
  }

  if (resolved > 0) saveLedger(slips);
  return resolved;
}

export interface BetsLedgerStats {
  total: number;
  pending: number;
  resolved: number;     // won + lost (void exclu)
  void: number;
  won: number;
  hitRate: number | null;   // won / resolved
  profit: number;           // mise plate 1u par pari
  roi: number | null;       // profit / resolved
  avgEdge: number | null;   // edge moyen des paris RESOLUS
  brier: number | null;     // mean((p_model - issue)²) sur les résolus
  avgOdds: number | null;
}

/** Statistiques du registre (ROI/Brier) pour l'écran Réglages. */
export function betsLedgerStats(): BetsLedgerStats {
  const slips = loadLedger();
  const resolvedSlips = slips.filter((s) => s.status === "won" || s.status === "lost");
  const won = resolvedSlips.filter((s) => s.status === "won").length;
  const profit = resolvedSlips.reduce((sum, s) => sum + (s.profit ?? 0), 0);
  const n = resolvedSlips.length;
  const brier = n
    ? resolvedSlips.reduce((sum, s) => sum + Math.pow(s.modelProb - (s.status === "won" ? 1 : 0), 2), 0) / n
    : null;
  return {
    total: slips.length,
    pending: slips.filter((s) => s.status === "pending").length,
    resolved: n,
    void: slips.filter((s) => s.status === "void").length,
    won,
    hitRate: n ? won / n : null,
    profit,
    roi: n ? profit / n : null,
    avgEdge: n ? resolvedSlips.reduce((s, x) => s + x.edge, 0) / n : null,
    brier,
    avgOdds: n ? resolvedSlips.reduce((s, x) => s + x.odds, 0) / n : null,
  };
}

/** Derniers paris du registre (affichage compact). */
export function betsLedgerRecent(limit = 6): BetSlip[] {
  return loadLedger()
    .filter((s) => s.status !== "void")
    .sort((a, b) => b.recordedAt - a.recordedAt)
    .slice(0, limit);
}

/** Vide le registre (bouton Réglages). */
export function betsLedgerClear(): void {
  persistSet(LEDGER_KEY, [], 0);
}
