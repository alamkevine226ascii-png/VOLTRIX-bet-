"use client";

/* ============================================================
   VOLTRIX app — Helpers d'affichage
   L'app est 100 % locale : les moteurs foot (src/lib/foot/) et
   MMA (src/lib/mma/) tournent dans le navigateur et appellent
   directement les endpoints publics ESPN. Plus d'API distante,
   plus de base de données — ce module ne garde que les
   utilitaires de formatage partagés par les écrans.
   ============================================================ */

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
