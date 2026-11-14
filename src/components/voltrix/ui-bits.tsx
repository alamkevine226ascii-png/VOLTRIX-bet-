"use client";

/* ============================================================
   VOLTRIX front — Briques UI partagées
   (forme W/D/L, barres de probabilités, étoiles de confiance,
   badges de grade, anneau de progression, skeletons, panneaux
   d'erreur/démo, titres de section)
   ============================================================ */

import type { ReactNode } from "react";
import { Loader2, WifiOff, RefreshCw } from "lucide-react";
import { confidenceStars, pct } from "@/lib/voltrix";

/* ---------- Forme W/D/L : 5 segments néon ---------- */
export function FormDots({ form, align = "right" }: { form: string | null | undefined; align?: "left" | "right" }) {
  const letters = (form ?? "").slice(-5).split("");
  const color = (r: string) => (r === "W" ? "bg-neon" : r === "D" ? "bg-white/70" : r === "L" ? "bg-[#ff5d5d]" : "bg-white/20");
  return (
    <span className={`flex items-center gap-[3px] ${align === "left" ? "justify-start" : "justify-end"}`} aria-label={`Forme ${form ?? "inconnue"}`}>
      {letters.length === 0 ? <span className="text-[10.5px] text-white/30">—</span> : letters.map((r, i) => (
        <span key={i} className={`h-[7px] w-[10px] rounded-[2px] ${color(r)}`} title={r} />
      ))}
    </span>
  );
}

/* ---------- Barre de probabilité horizontale ---------- */
export function ProbBar({
  label,
  value,
  odds,
  highlight = false,
  compact = false,
}: {
  label: string;
  value: number | null | undefined;
  odds?: number | null;
  highlight?: boolean;
  compact?: boolean;
}) {
  const v = value == null ? 0 : Math.round(value * 100);
  return (
    <div className={`rounded-2xl px-3 ${compact ? "py-1.5" : "py-2"} ${highlight ? "bg-neon text-black" : "bg-ink-3 text-white"}`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className={`truncate text-[10px] font-bold uppercase tracking-wide ${highlight ? "text-black/70" : "text-white/60"}`}>{label}</span>
        <span className="flex items-baseline gap-1.5">
          <span className="text-[13px] font-black leading-none">{v}%</span>
          {odds != null ? <span className={`text-[10px] font-bold ${highlight ? "text-black/55" : "text-white/40"}`}>{odds.toFixed(2)}</span> : null}
        </span>
      </div>
      <div className={`mt-1.5 h-[5px] overflow-hidden rounded-full ${highlight ? "bg-black/20" : "bg-black/50"}`}>
        <div className={`h-full rounded-full ${highlight ? "bg-black" : "bg-neon"}`} style={{ width: `${v}%` }} />
      </div>
    </div>
  );
}

/* ---------- Étoiles de confiance + libellé ---------- */
export function ConfidenceChip({ confidence, label }: { confidence: number; label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 ring-1 ring-white/15">
      <span className="text-[11px] leading-none tracking-[0.12em] text-neon" aria-label={`Confiance ${confidence}/5`}>
        {confidenceStars(confidence)}
      </span>
      {label ? <span className="text-[10.5px] font-bold uppercase tracking-wider text-white/60">{label}</span> : null}
    </span>
  );
}

/* ---------- Grade semaine (OK / KO / ANN / —) ---------- */
export function GradeBadge({ grade }: { grade: string | null | undefined }) {
  const map: Record<string, string> = {
    CORRECT: "bg-neon text-black",
    INCORRECT: "bg-[#ff5d5d] text-white",
    VOID: "bg-white/20 text-white/70",
  };
  const txt: Record<string, string> = { CORRECT: "OK", INCORRECT: "KO", VOID: "ANN" };
  const g = grade ?? "";
  return (
    <span className={`inline-flex h-[22px] min-w-[34px] items-center justify-center rounded-full px-1.5 text-[10.5px] font-black uppercase tracking-wide ${map[g] ?? "bg-ink-3 text-white/35"}`}>
      {txt[g] ?? "—"}
    </span>
  );
}

/* ---------- Résultat WIN/LOSE/VOID ---------- */
export function ResultBadge({ result }: { result: string | null }) {
  if (!result) return <span className="rounded-full bg-ink-3 px-2 py-0.5 text-[10.5px] font-black uppercase tracking-wider text-white/40">En attente</span>;
  const map: Record<string, string> = {
    WIN: "bg-neon text-black",
    LOSE: "bg-[#ff5d5d] text-white",
    VOID: "bg-white/20 text-white/70",
  };
  const txt: Record<string, string> = { WIN: "GAGNÉ", LOSE: "PERDU", VOID: "RENDU" };
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-black uppercase tracking-wider ${map[result] ?? "bg-ink-3 text-white/50"}`}>
      {txt[result] ?? result}
    </span>
  );
}

/* ---------- Anneau de progression SVG ---------- */
export function ProgressRing({
  value,
  size = 118,
  stroke = 11,
  label,
  sub,
}: {
  value: number | null | undefined; // 0..1
  size?: number;
  stroke?: number;
  label?: string;
  sub?: string;
}) {
  const v = value == null ? 0 : Math.max(0, Math.min(1, value));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="#c6f211"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - v)}
          style={{ transition: "stroke-dashoffset 0.7s cubic-bezier(0.32,0.72,0,1)" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-display text-[24px] leading-none tracking-wide text-white">{Math.round(v * 100)}%</span>
        {label ? <span className="mt-1 text-[10px] font-bold uppercase tracking-widest text-white/50">{label}</span> : null}
        {sub ? <span className="mt-0.5 text-[10.5px] font-semibold text-neon">{sub}</span> : null}
      </div>
    </div>
  );
}

/* ---------- Double barre calibrage (prédit vs réel) ---------- */
export function CalibrationRow({ label, predicted, actual, count }: { label: string; predicted?: number; actual?: number; count: number }) {
  const p = predicted == null ? 0 : Math.round(predicted * 100);
  const a = actual == null ? 0 : Math.round(actual * 100);
  return (
    <div className="grid grid-cols-[52px_1fr_34px] items-center gap-2.5">
      <span className="text-[10.5px] font-bold uppercase tracking-wide text-white/50">{label}</span>
      <div className="space-y-1">
        <div className="flex h-[8px] items-center overflow-hidden rounded-full bg-black/50">
          <div className="h-full rounded-full bg-neon" style={{ width: `${p}%` }} />
        </div>
        <div className="flex h-[8px] items-center overflow-hidden rounded-full bg-black/50">
          <div className="h-full rounded-full bg-white/75" style={{ width: `${a}%` }} />
        </div>
      </div>
      <span className="text-right text-[10.5px] font-bold text-white/45">n={count}</span>
    </div>
  );
}

/* ---------- Titre de section (sobre, cohérent avec l'accueil) ---------- */
export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-2.5 mt-5 flex items-center justify-between gap-2">
      <h2 className="flex min-w-0 items-center gap-2 text-[11px] font-black uppercase tracking-[0.14em] text-white/70">
        <span className="h-[3px] w-3.5 shrink-0 rounded-full bg-neon" aria-hidden="true" />
        <span className="truncate">{children}</span>
      </h2>
      {right}
    </div>
  );
}


/* ---------- Skeletons ---------- */
export function CardSkeleton() {
  return (
    <div className="animate-pulse rounded-[24px] bg-panel p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-full bg-black/10" />
          <div className="h-3 w-24 rounded bg-black/10" />
        </div>
        <div className="h-12 w-12 rounded-full bg-black/10" />
      </div>
      <div className="mt-4 h-8 rounded-full bg-black/10" />
    </div>
  );
}

export function RowSkeleton({ n = 3 }: { n?: number }) {
  return (
    <div className="space-y-2.5">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="animate-pulse rounded-2xl bg-ink-3 px-4 py-3.5">
          <div className="flex items-center justify-between">
            <div className="h-3 w-32 rounded bg-white/10" />
            <div className="h-3 w-12 rounded bg-white/10" />
          </div>
          <div className="mt-2.5 h-2 w-full rounded bg-white/5" />
        </div>
      ))}
    </div>
  );
}

/* ---------- Panneau d'état : chargement / erreur / démo ---------- */
export function LoadingPanel({ label = "Analyse du moteur…" }: { label?: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-14 text-center">
      <Loader2 size={26} className="animate-spin text-neon" strokeWidth={2.4} />
      <p className="text-[11.5px] font-semibold text-white/55">{label}</p>
    </div>
  );
}

export function ErrorPanel({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3 py-12 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-ink-3">
        <WifiOff size={20} className="text-white/50" />
      </span>
      <p className="max-w-[280px] text-[11.5px] font-semibold leading-relaxed text-white/60">{message}</p>
      {onRetry ? (
        <button
          onClick={onRetry}
          className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-neon px-4 py-2 text-[10.5px] font-black uppercase tracking-wider text-black transition-transform active:scale-95"
        >
          <RefreshCw size={12} strokeWidth={2.8} />
          Réessayer
        </button>
      ) : null}
    </div>
  );
}

/* ---------- Statistique KPI ---------- */
export function KpiTile({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "good" | "bad" | "neon" }) {
  const toneCls =
    tone === "good" ? "text-[#3ddc84]" : tone === "bad" ? "text-[#ff5d5d]" : tone === "neon" ? "text-neon" : "text-white";
  return (
    <div className="rounded-2xl bg-ink-3 px-3 py-2.5">
      <p className="text-[10px] font-bold uppercase tracking-widest text-white/45">{label}</p>
      <p className={`mt-1 text-[16px] font-black leading-none ${toneCls}`}>{value}</p>
    </div>
  );
}

/* ---------- Chip segmentée (sélecteur) ---------- */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<{ id: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex gap-1.5 rounded-full bg-ink-3 p-1">
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          aria-pressed={value === o.id}
          className={`flex-1 whitespace-nowrap rounded-full px-3 py-1.5 text-[10px] font-black uppercase tracking-wide transition-colors ${
            value === o.id ? "bg-neon text-black" : "text-white/60 hover:text-white"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ---------- Valeur monétaire compacte ---------- */
export function eurCompact(v: number | null | undefined): string {
  if (v == null) return "—";
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(v % 1_000_000 === 0 ? 0 : 1)} M€`;
  if (v >= 1_000) return `${Math.round(v / 1_000)} k€`;
  return `${v} €`;
}

/* ---------- Petite pastille "value bet" ---------- */
export function EdgeChip({ edge }: { edge: number }) {
  const positive = edge > 0;
  return (
    <span className={`rounded-full px-1.5 py-0.5 text-[10.5px] font-black ${positive ? "bg-neon text-black" : "bg-white/15 text-white/50"}`}>
      {positive ? "+" : ""}
      {Math.round(edge * 100)} %
    </span>
  );
}

export { pct, confidenceStars };
