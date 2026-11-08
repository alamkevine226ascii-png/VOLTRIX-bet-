"use client";

/* ============================================================
   VOLTRIX front — Briques UI partagées (design Apple / iOS)
   Typographie SF, surfaces élevées #1C1C1E/#2C2C2E, en-têtes
   de section groupée, étoiles jaunes façon App Store, contrôles
   segmentés iOS, séparateurs cheveux.
   ============================================================ */

import type { ReactNode } from "react";
import { Loader2, WifiOff, FlaskConical, RefreshCw } from "lucide-react";
import { confidenceStars, pct } from "@/lib/voltrix";

/* ---------- Forme W/D/L : 5 segments (couleurs système) ---------- */
export function FormDots({ form, align = "right" }: { form: string | null | undefined; align?: "left" | "right" }) {
  const letters = (form ?? "").slice(-5).split("");
  const color = (r: string) =>
    r === "W" ? "bg-[#30d158]" : r === "D" ? "bg-white/45" : r === "L" ? "bg-[#ff453a]" : "bg-white/20";
  return (
    <span className={`flex items-center gap-[3px] ${align === "left" ? "justify-start" : "justify-end"}`} aria-label={`Forme ${form ?? "inconnue"}`}>
      {letters.length === 0 ? <span className="text-[9px] text-white/30">—</span> : letters.map((r, i) => (
        <span key={i} className={`h-[6px] w-[9px] rounded-[2px] ${color(r)}`} title={r} />
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
    <div className={`rounded-xl px-3 ${compact ? "py-1.5" : "py-2"} ${highlight ? "bg-neon text-black" : "bg-ink-3 text-white"}`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className={`truncate text-[11px] font-medium ${highlight ? "text-black/70" : "text-white/55"}`}>{label}</span>
        <span className="flex items-baseline gap-1.5">
          <span className={`text-[14px] font-bold leading-none ${highlight ? "" : "text-white"}`}>{v}%</span>
          {odds != null ? <span className={`text-[10px] font-semibold ${highlight ? "text-black/55" : "text-white/40"}`}>{odds.toFixed(2)}</span> : null}
        </span>
      </div>
      <div className={`mt-1.5 h-[4px] overflow-hidden rounded-full ${highlight ? "bg-black/20" : "bg-white/10"}`}>
        <div className={`h-full rounded-full ${highlight ? "bg-black" : "bg-neon"}`} style={{ width: `${v}%` }} />
      </div>
    </div>
  );
}

/* ---------- Étoiles de confiance + libellé (jaune App Store) ---------- */
export function ConfidenceChip({ confidence, label }: { confidence: number; label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-white/8 px-2.5 py-1">
      <span className="text-[11px] leading-none tracking-[0.08em] text-[#ffd60a]" aria-label={`Confiance ${confidence}/5`}>
        {confidenceStars(confidence)}
      </span>
      {label ? <span className="text-[10px] font-semibold text-white/60">{label}</span> : null}
    </span>
  );
}

/* ---------- Grade semaine (OK / KO / ANN / —) ---------- */
export function GradeBadge({ grade }: { grade: string | null | undefined }) {
  const map: Record<string, string> = {
    CORRECT: "bg-neon text-black",
    INCORRECT: "bg-[#ff453a] text-white",
    VOID: "bg-white/15 text-white/70",
  };
  const txt: Record<string, string> = { CORRECT: "OK", INCORRECT: "KO", VOID: "ANN" };
  const g = grade ?? "";
  return (
    <span className={`inline-flex h-[22px] min-w-[36px] items-center justify-center rounded-md px-1.5 text-[10px] font-bold ${map[g] ?? "bg-white/10 text-white/40"}`}>
      {txt[g] ?? "—"}
    </span>
  );
}

/* ---------- Résultat WIN/LOSE/VOID ---------- */
export function ResultBadge({ result }: { result: string | null }) {
  if (!result) return <span className="rounded-md bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-white/45">En attente</span>;
  const map: Record<string, string> = {
    WIN: "bg-[#30d158] text-black",
    LOSE: "bg-[#ff453a] text-white",
    VOID: "bg-white/15 text-white/70",
  };
  const txt: Record<string, string> = { WIN: "Gagné", LOSE: "Perdu", VOID: "Rendu" };
  return (
    <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${map[result] ?? "bg-white/10 text-white/50"}`}>
      {txt[result] ?? result}
    </span>
  );
}

/* ---------- Anneau de progression SVG (anneau Fitness) ---------- */
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
        <span className="text-[26px] font-bold leading-none tracking-[-0.02em] text-white">{Math.round(v * 100)}%</span>
        {label ? <span className="mt-1 text-[10px] font-medium uppercase tracking-[0.06em] text-white/50">{label}</span> : null}
        {sub ? <span className="mt-0.5 text-[11px] font-semibold text-neon">{sub}</span> : null}
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
      <span className="text-[11px] font-medium text-white/55">{label}</span>
      <div className="space-y-1">
        <div className="flex h-[7px] items-center overflow-hidden rounded-full bg-white/10">
          <div className="h-full rounded-full bg-neon" style={{ width: `${p}%` }} />
        </div>
        <div className="flex h-[7px] items-center overflow-hidden rounded-full bg-white/10">
          <div className="h-full rounded-full bg-white/75" style={{ width: `${a}%` }} />
        </div>
      </div>
      <span className="text-right text-[11px] font-medium text-white/45">n={count}</span>
    </div>
  );
}

/* ---------- Titre de section (en-tête groupé iOS) ---------- */
export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-2.5 mt-6 flex items-end justify-between gap-2 px-0.5">
      <h2 className="min-w-0 truncate text-[13px] font-normal uppercase tracking-[0.08em] text-white/45">{children}</h2>
      {right}
    </div>
  );
}

/* ---------- Badge DÉMO (violet système) ---------- */
export function DemoBadge({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full bg-[#bf5af2]/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.04em] text-[#d59cf7] ${className}`}>
      <FlaskConical size={10} strokeWidth={2.4} />
      Démo
    </span>
  );
}

/* ---------- Skeletons ---------- */
export function CardSkeleton() {
  return (
    <div className="animate-pulse rounded-2xl bg-ink-2 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-full bg-white/10" />
          <div className="h-3 w-24 rounded bg-white/10" />
        </div>
        <div className="h-3 w-10 rounded bg-white/10" />
      </div>
      <div className="mt-3 flex items-center gap-3">
        <div className="h-8 w-8 rounded-full bg-white/10" />
        <div className="h-3 w-28 rounded bg-white/10" />
      </div>
      <div className="mt-4 h-8 rounded-xl bg-white/6" />
    </div>
  );
}

export function RowSkeleton({ n = 3 }: { n?: number }) {
  return (
    <div className="space-y-2.5">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="animate-pulse rounded-2xl bg-ink-2 px-4 py-3.5">
          <div className="flex items-center justify-between">
            <div className="h-3 w-32 rounded bg-white/10" />
            <div className="h-3 w-12 rounded bg-white/10" />
          </div>
          <div className="mt-2.5 h-2 w-full rounded bg-white/6" />
        </div>
      ))}
    </div>
  );
}

/* ---------- Panneau d'état : chargement / erreur / démo ---------- */
export function LoadingPanel({ label = "Analyse du moteur…" }: { label?: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-14 text-center">
      <Loader2 size={26} className="animate-spin text-white/40" strokeWidth={2.2} />
      <p className="text-[13px] text-white/50">{label}</p>
    </div>
  );
}

export function ErrorPanel({
  message,
  onRetry,
  isDemo,
}: {
  message: string;
  onRetry?: () => void;
  isDemo?: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-3 py-12 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/8">
        {isDemo ? <FlaskConical size={20} className="text-[#d59cf7]" /> : <WifiOff size={20} className="text-white/50" />}
      </span>
      <p className="max-w-[280px] text-[13px] leading-relaxed text-white/55">{message}</p>
      {onRetry ? (
        <button
          onClick={onRetry}
          className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-neon px-5 py-2 text-[13px] font-semibold text-black transition-transform duration-150 ease-out active:scale-95"
        >
          <RefreshCw size={13} strokeWidth={2.6} />
          Réessayer
        </button>
      ) : null}
    </div>
  );
}

/* ---------- Statistique KPI (tuile élevée) ---------- */
export function KpiTile({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "good" | "bad" | "neon" }) {
  const toneCls =
    tone === "good" ? "text-[#30d158]" : tone === "bad" ? "text-[#ff453a]" : tone === "neon" ? "text-neon" : "text-white";
  return (
    <div className="rounded-xl bg-ink-2 px-3 py-2.5">
      <p className="text-[11px] font-medium text-white/45">{label}</p>
      <p className={`mt-0.5 text-[17px] font-bold leading-tight tracking-[-0.01em] ${toneCls}`}>{value}</p>
    </div>
  );
}

/* ---------- Contrôle segmenté iOS ---------- */
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
    <div className="flex gap-[3px] rounded-[10px] bg-white/8 p-[3px]">
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          aria-pressed={value === o.id}
          className={`flex-1 whitespace-nowrap rounded-[8px] px-3 py-[7px] text-[13px] font-semibold transition-colors duration-150 ease-out ${
            value === o.id ? "bg-[#636366] text-white shadow-sm" : "text-white/60"
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
    <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${positive ? "bg-neon/15 text-neon" : "bg-white/8 text-white/40"}`}>
      {positive ? "+" : ""}
      {Math.round(edge * 100)} %
    </span>
  );
}

export { pct, confidenceStars };
