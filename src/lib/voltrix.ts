"use client";

/* ============================================================
   VOLTRIX front — Client API
   Toutes les requêtes passent par le proxy même-origine
   /api/voltrix/... (évite tout blocage CORS côté VOLTRIX API)
   avec l'URL de base transmise via l'en-tête x-voltrix-base.
   Sans URL configurée (ou en échec) → repli DONNÉES DÉMO.
   ============================================================ */

import type {
  BankrollResolveResponse,
  CashoutResponse,
  IdentityResponse,
  LineupsResponse,
  MatchesResponse,
  MatchDetailDTO,
  PerformanceDTO,
  PredictionsResponse,
  SyncStatusResponse,
  WeekResponse,
} from "./voltrix-types";

const LS_KEY = "voltrix.apiBase";

export function getApiBase(): string {
  if (typeof window === "undefined") return "";
  return (localStorage.getItem(LS_KEY) ?? "").trim();
}

export function setApiBase(url: string): void {
  const clean = url.trim().replace(/\/+$/, "");
  if (clean) localStorage.setItem(LS_KEY, clean);
  else localStorage.removeItem(LS_KEY);
}

export function normalizeBase(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

/** Une base est-elle candidate plausible ? (http/https, pas de credentials) */
export function isValidBase(url: string): boolean {
  try {
    const u = new URL(url);
    return (u.protocol === "http:" || u.protocol === "https:") && !!u.hostname && !u.username && !u.password;
  } catch {
    return false;
  }
}

export type Mode = "demo" | "live" | "connecting";

class VoltrixError extends Error {}

async function request<T>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const base = getApiBase();
  if (!base) throw new VoltrixError("Mode démo — aucune URL d'API configurée");
  const { timeoutMs = 45_000, ...rest } = init ?? {};
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`/api/voltrix${path}`, {
      ...rest,
      headers: {
        ...(rest.body ? { "Content-Type": "application/json" } : {}),
        "x-voltrix-base": base,
        ...(rest.headers ?? {}),
      },
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      let msg = `Erreur ${res.status}`;
      try {
        const j = JSON.parse(text) as { error?: string };
        if (j.error) msg = j.error;
      } catch { /* corps non JSON */ }
      throw new VoltrixError(msg);
    }
    return JSON.parse(text) as T;
  } finally {
    clearTimeout(timer);
  }
}

/* ---------- Appels API (mêmes signatures que VOLTRIX) ---------- */

export async function fetchIdentity(): Promise<IdentityResponse> {
  return request<IdentityResponse>("/api");
}

export async function fetchMatches(date: string): Promise<MatchesResponse> {
  return request<MatchesResponse>(`/api/matches?date=${encodeURIComponent(date)}`);
}

export async function fetchPredictions(
  matches: Array<{ matchId: string; leagueCode: string; date: string }>,
): Promise<PredictionsResponse> {
  return request<PredictionsResponse>("/api/predictions", {
    method: "POST",
    body: JSON.stringify({ matches }),
    timeoutMs: 120_000,
  });
}

export async function fetchMatchDetail(matchId: string, leagueCode: string, date: string): Promise<MatchDetailDTO> {
  const q = `league=${encodeURIComponent(leagueCode)}&date=${encodeURIComponent(date)}`;
  return request<MatchDetailDTO>(`/api/match/${encodeURIComponent(matchId)}?${q}`, { timeoutMs: 60_000 });
}

export async function fetchLineups(matchId: string, leagueCode: string): Promise<LineupsResponse> {
  const q = `league=${encodeURIComponent(leagueCode)}`;
  return request<LineupsResponse>(`/api/match/${encodeURIComponent(matchId)}/lineups?${q}`, { timeoutMs: 60_000 });
}

export async function fetchPerformance(): Promise<PerformanceDTO> {
  return request<PerformanceDTO>("/api/performance", { timeoutMs: 120_000 });
}

export async function fetchWeek(start?: string): Promise<WeekResponse> {
  const q = start ? `?start=${encodeURIComponent(start)}` : "";
  return request<WeekResponse>(`/api/forecasts/week${q}`, { timeoutMs: 60_000 });
}

export async function fetchCashout(payload: {
  legs: Array<{ matchId: string; leagueCode: string; matchDate: string; market: string; pick: string; prob: number; homeName?: string; awayName?: string }>;
  stake: number;
  offered: number;
  totalOdds?: number | null;
}): Promise<CashoutResponse> {
  return request<CashoutResponse>("/api/cashout", {
    method: "POST",
    body: JSON.stringify(payload),
    timeoutMs: 60_000,
  });
}

export async function resolveTicketLegs(
  legs: Array<{ matchId: string; leagueCode: string; matchDate: string; market: string; pick: string }>,
): Promise<BankrollResolveResponse> {
  return request<BankrollResolveResponse>("/api/bankroll/resolve", {
    method: "POST",
    body: JSON.stringify({ legs }),
    timeoutMs: 60_000,
  });
}

export async function fetchSyncStatus(): Promise<SyncStatusResponse> {
  return request<SyncStatusResponse>("/api/sync/status", { timeoutMs: 30_000 });
}

export async function wakeSync(): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>("/api/sync/wake", { method: "POST", timeoutMs: 30_000 });
}

/** URL proxy téléchargeable (rapport PDF / export CSV d'une semaine). */
export function proxiedUrl(path: string): string | null {
  const base = getApiBase();
  if (!base) return null;
  return `/api/voltrix${path}${path.includes("?") ? "&" : "?"}__base=${encodeURIComponent(base)}`;
}

/* ---------- Helpers d'affichage ---------- */

export const pct = (x: number | null | undefined, digits = 0): string =>
  x == null ? "—" : `${(x * 100).toFixed(digits)} %`;

export const pctRound = (x: number | null | undefined): number =>
  x == null ? 0 : Math.round(x * 100);

export const oddsFmt = (x: number | null | undefined): string =>
  x == null ? "—" : x.toFixed(2);

export const moneyFmt = (x: number | null | undefined): string =>
  x == null ? "—" : `${x >= 0 ? "" : "-"}${Math.abs(x).toFixed(2)} €`;

/** Date ISO → "sam. 08 nov." */
export function dayLabel(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "short" });
}

/** Date ISO → "14:30" (heure locale du navigateur) */
export function timeLabel(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

/** Date ISO → "08 nov. 2026" */
export function dateLabel(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
}

/** Confidence 1..5 → étoiles */
export function confidenceStars(c: number): string {
  return "★★★★★".slice(0, Math.max(0, Math.min(5, Math.round(c))));
}

/** Grade brut ("CORRECT"/"INCORRECT"/"VOID") → libellé FR court */
export function gradeLabel(g: string | null | undefined): { text: string; tone: "good" | "bad" | "void" | "none" } {
  if (!g) return { text: "—", tone: "none" };
  if (g === "CORRECT") return { text: "OK", tone: "good" };
  if (g === "INCORRECT") return { text: "KO", tone: "bad" };
  if (g === "VOID") return { text: "ANN", tone: "void" };
  return { text: g, tone: "none" };
}
