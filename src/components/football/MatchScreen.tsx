"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { ChevronLeft, Eye, Share2, Play } from "lucide-react";
import { formatViewers, type FormResult, type Match } from "./data";
import { Crest } from "./Crest";

function FormSegments({ results, align = "right" }: { results: FormResult[]; align?: "left" | "right" }) {
  const color = (r: FormResult) =>
    r === "W" ? "bg-neon" : r === "D" ? "bg-white/80" : "bg-white/25";
  return (
    <span className={`flex items-center gap-[3px] ${align === "left" ? "justify-start" : "justify-end"}`}>
      {results.map((r, i) => (
        <span key={i} className={`h-[7px] w-[11px] rounded-[2px] ${color(r)}`} />
      ))}
    </span>
  );
}

function ProbabilityPill({
  value,
  label,
  variant,
  selected,
  onSelect,
}: {
  value: number;
  label: string;
  variant: "lime" | "white";
  selected: boolean;
  onSelect: () => void;
}) {
  const height = Math.round(58 + (value / 47) * 40); // 47% -> tallest
  return (
    <button
      onClick={onSelect}
      aria-pressed={selected}
      style={{ height }}
      className={`flex w-[88px] flex-col items-center justify-center rounded-[24px] transition-all duration-200 ${
        variant === "white"
          ? "bg-white text-black"
          : "bg-neon text-black ring-1 ring-black/15 shadow-[0_8px_18px_rgba(0,0,0,0.22)]"
      } ${selected ? "scale-[1.05] shadow-[0_12px_24px_rgba(0,0,0,0.3)]" : ""}`}
    >
      <span className="text-[21px] font-black leading-none">{value}%</span>
      <span className="mt-1 text-[9px] font-bold uppercase tracking-widest">{label}</span>
    </button>
  );
}

export function MatchScreen({
  match,
  onBack,
  onOpenTactics,
  onOpenLive,
  onMakeBet,
  selectedPick,
  onSelectPick,
}: {
  match: Match;
  onBack: () => void;
  onOpenTactics: () => void;
  onOpenLive: () => void;
  onMakeBet: () => void;
  selectedPick: "home" | "draw" | "away" | null;
  onSelectPick: (pick: "home" | "draw" | "away") => void;
}) {
  const [viewers, setViewers] = useState(match.viewers ?? 0);
  const [showHint, setShowHint] = useState(false);

  // live viewers slowly ticking up
  useEffect(() => {
    if (!match.isLive) return;
    const t = setInterval(() => {
      setViewers((v) => v + Math.floor(Math.random() * 4) + 1);
    }, 2600);
    return () => clearInterval(t);
  }, [match.isLive]);

  // one-time hint: crests open tactics
  useEffect(() => {
    const show = setTimeout(() => setShowHint(true), 1200);
    const hide = setTimeout(() => setShowHint(false), 5600);
    return () => {
      clearTimeout(show);
      clearTimeout(hide);
    };
  }, []);

  const picks = [
    { id: "away" as const, value: match.odds.away, label: match.away.short, variant: "lime" as const },
    { id: "home" as const, value: match.odds.home, label: match.home.short, variant: "white" as const },
    { id: "draw" as const, value: match.odds.draw, label: "DRAW", variant: "lime" as const },
  ];

  return (
    <div className="relative flex h-full flex-col bg-ink">
      {/* top bar */}
      <header className="flex items-center justify-between px-5 pt-6">
        <button
          onClick={onBack}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-ink-3 text-white transition-colors hover:bg-neon hover:text-black"
          aria-label="Back"
        >
          <ChevronLeft size={18} strokeWidth={2.4} />
        </button>

        <div className="flex items-center gap-2">
          <Eye size={15} className="text-white/80" strokeWidth={2.2} />
          <span className="text-[12px] font-semibold text-white/80">
            {match.isLive ? formatViewers(viewers) : match.date}
          </span>
          {match.isLive ? (
            <span className="flex items-center gap-1.5 rounded-full bg-neon px-2.5 py-1 text-[9.5px] font-black uppercase tracking-wide text-black">
              <span className="live-dot h-1.5 w-1.5 rounded-full bg-black" />
              Live
            </span>
          ) : (
            <span className="rounded-full bg-ink-3 px-2.5 py-1 text-[9.5px] font-black uppercase tracking-wide text-white/80">
              Soon
            </span>
          )}
        </div>

        <button
          onClick={onOpenLive}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-ink-3 text-white transition-colors hover:bg-neon hover:text-black"
          aria-label="Share or open live stream"
        >
          <Share2 size={15} strokeWidth={2.2} />
        </button>
      </header>

      {/* score header — tap to open tactics */}
      <button
        onClick={onOpenTactics}
        className="group mt-4 grid grid-cols-[1fr_auto_1fr] items-center px-6"
        aria-label="View match tactics"
      >
        <div className="flex flex-col items-center gap-2 transition-transform duration-200 group-hover:scale-105">
          <Crest team={match.home} size={58} />
          <span className="max-w-[104px] text-center text-[8.5px] font-extrabold leading-[1.3] tracking-wide text-white">
            {match.home.label}
          </span>
        </div>

        <div className="mx-3 px-2">
          <span className="font-display text-[46px] leading-none tracking-wide text-white">
            {match.score ? `${match.score[0]}:${match.score[1]}` : "VS"}
          </span>
          <span className="mt-1.5 block text-center text-[8.5px] font-semibold uppercase tracking-widest text-white/40">
            {match.time}
          </span>
        </div>

        <div className="flex flex-col items-center gap-2 transition-transform duration-200 group-hover:scale-105">
          <Crest team={match.away} size={58} />
          <span className="max-w-[104px] text-center text-[8.5px] font-extrabold leading-[1.3] tracking-wide text-white">
            {match.away.label}
          </span>
        </div>
      </button>

      {/* hero photo + past games — flexes to fill the space above the lime panel */}
      <div className="relative mx-4 mt-5 min-h-44 flex-1 overflow-hidden rounded-[26px]">
        {/* hint toast — floats over the photo so nothing important is hidden */}
        {showHint ? (
          <div className="absolute left-1/2 top-3 z-30 -translate-x-1/2 whitespace-nowrap rounded-full bg-black/70 px-4 py-2 text-[10.5px] font-semibold text-white shadow-xl ring-1 ring-white/15 backdrop-blur">
            Tap a team crest to view <span className="text-neon">tactics</span>
          </div>
        ) : null}
        <Image
          src="/hero-match.jpg"
          alt="Live football action"
          fill
          priority
          sizes="(max-width: 640px) 100vw, 400px"
          className="object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-black/25" />

        {/* play button */}
        <button
          onClick={onOpenLive}
          aria-label="Watch live"
          className="play-pulse absolute left-1/2 top-[42%] flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-neon text-black transition-transform hover:scale-110"
        >
          <Play size={19} className="ml-0.5" fill="currentColor" />
        </button>

        {/* past games band */}
        <div className="absolute inset-x-0 bottom-0 flex items-end justify-between px-4 pb-3">
          <span className="text-[15px] font-semibold text-white">Past Games</span>
          <div className="flex flex-col items-end gap-1.5">
            <div className="flex items-center gap-2">
              <span className="text-[9px] font-bold uppercase tracking-wider text-white/70">
                {match.home.short}
              </span>
              <FormSegments results={match.form.home} />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[9px] font-bold uppercase tracking-wider text-white/70">
                {match.away.short}
              </span>
              <FormSegments results={match.form.away} />
            </div>
          </div>
        </div>
      </div>

      {/* lime panel with probabilities + CTA */}
      <div className="mt-5 rounded-t-[34px] bg-neon px-5 pb-6 pt-6">
        <div className="flex items-end justify-center gap-3">
          {picks.map((p) => (
            <ProbabilityPill
              key={p.id}
              value={p.value}
              label={p.label}
              variant={p.variant}
              selected={selectedPick === p.id}
              onSelect={() => onSelectPick(p.id)}
            />
          ))}
        </div>

        <button
          onClick={onMakeBet}
          className="mt-5 flex h-[52px] w-full items-center justify-center rounded-full bg-black text-[15px] font-semibold text-white shadow-[0_14px_28px_rgba(0,0,0,0.35)] transition-transform hover:scale-[1.015] active:scale-[0.98]"
        >
          Make bet
        </button>
      </div>
    </div>
  );
}
