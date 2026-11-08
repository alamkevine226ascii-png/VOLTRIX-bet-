"use client";

import { Bell, Home, CalendarDays, ChartNoAxesColumn, User, Search } from "lucide-react";
import { useState } from "react";
import { LEAGUES, MATCHES, type Match } from "./data";
import { Crest } from "./Crest";

function LogoBadge() {
  return (
    <span className="flex h-11 w-11 items-center justify-center rounded-full bg-neon shadow-[0_4px_18px_rgba(198,242,17,0.35)]">
      {/* stylized wing / flame logo */}
      <svg width="24" height="24" viewBox="0 0 24 24" role="img" aria-label="App logo">
        <path
          d="M3 13 C6 11 8 8 9 4 C11 8 13 10 16 11 C14 12 12.5 13 12 15 C14.5 14.5 16.5 13 18 10 C19 14 17 18 13 20 C9 22 4.5 19.5 3 13 Z"
          fill="#141414"
        />
        <circle cx="15.2" cy="17.2" r="1.4" fill="#C6F211" />
      </svg>
    </span>
  );
}

function MatchCard({
  match,
  tag,
  onOpen,
  onQuickBet,
}: {
  match: Match;
  tag: string;
  onOpen: () => void;
  onQuickBet: () => void;
}) {
  return (
    <article
      onClick={onOpen}
      className="cursor-pointer rounded-[24px] bg-panel p-4 pb-3.5 shadow-[0_10px_24px_rgba(0,0,0,0.35)] transition-transform duration-200 active:scale-[0.97] sm:hover:scale-[1.015]"
    >
      <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-1">
        {/* home team */}
        <div className="flex flex-col items-center gap-2 pt-1">
          <Crest team={match.home} size={60} />
          <span className="max-w-[96px] text-center text-[9px] font-extrabold leading-[1.25] tracking-wide text-black">
            {match.home.label}
          </span>
        </div>

        {/* center — VS, time, date */}
        <div className="flex w-[112px] flex-col items-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-black font-display text-[14px] tracking-wide text-white shadow-[0_6px_14px_rgba(0,0,0,0.4)]">
            VS
          </span>
          <span className="mt-2.5 text-[24px] font-black leading-none text-black">
            {match.time}
          </span>
          <span className="mt-1.5 text-[9px] font-semibold uppercase tracking-wide text-black/45">
            {match.date}
          </span>
          {match.isLive ? (
            <span className="mt-1.5 flex items-center gap-1 rounded-full bg-neon px-2 py-[3px] text-[8px] font-black uppercase text-black">
              <span className="live-dot h-1.5 w-1.5 rounded-full bg-black" />
              Live
            </span>
          ) : null}
        </div>

        {/* away team */}
        <div className="flex flex-col items-center gap-2 pt-1">
          <Crest team={match.away} size={60} />
          <span className="max-w-[96px] text-center text-[9px] font-extrabold leading-[1.25] tracking-wide text-black">
            {match.away.label}
          </span>
        </div>
      </div>

      {/* bottom strip — league tag + quick pick */}
      <div className="mt-3.5 flex items-center justify-between rounded-full bg-panel-2 px-3 py-2">
        <span className="rounded-full bg-white px-2.5 py-[3px] text-[8px] font-extrabold uppercase tracking-wider text-black shadow-sm">
          {tag}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onQuickBet();
          }}
          className="rounded-full bg-white px-2.5 py-[3px] text-[8px] font-extrabold uppercase tracking-wider text-black shadow-sm transition-colors hover:bg-neon"
          aria-label={`Quick bet on ${match.away.short}`}
        >
          1X2 {match.away.short}
        </button>
      </div>
    </article>
  );
}

export function LeaguesScreen({
  onOpenMatch,
}: {
  onOpenMatch: (matchId: string, openBet?: boolean) => void;
}) {
  const [activeLeague, setActiveLeague] = useState("premier");
  const [tab, setTab] = useState<"home" | "calendar" | "stats" | "profile">("home");

  const league = LEAGUES.find((l) => l.id === activeLeague) ?? LEAGUES[0];
  const matches = MATCHES.filter((m) => m.leagueId === activeLeague);

  const tabs = [
    { id: "home" as const, icon: Home, label: "Home" },
    { id: "calendar" as const, icon: CalendarDays, label: "Calendar" },
    { id: "stats" as const, icon: ChartNoAxesColumn, label: "Stats" },
    { id: "profile" as const, icon: User, label: "Profile" },
  ];

  return (
    <div className="flex h-full flex-col bg-ink">
      {/* header */}
      <header className="flex items-center justify-between px-5 pt-6">
        <LogoBadge />
        <div className="flex items-center gap-2.5">
          <button
            className="flex h-9 w-9 items-center justify-center rounded-full bg-ink-3 text-white transition-colors hover:bg-neon hover:text-black"
            aria-label="Search"
          >
            <Search size={16} strokeWidth={2.2} />
          </button>
          <button
            className="relative flex h-9 w-9 items-center justify-center rounded-full bg-ink-3 text-white transition-colors hover:bg-neon hover:text-black"
            aria-label="Notifications"
          >
            <Bell size={16} strokeWidth={2.2} />
            <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-neon" />
          </button>
        </div>
      </header>

      {/* title */}
      <div className="px-5 pt-5">
        <p className="text-[15px] font-normal text-white/70">Explore</p>
        <h1 className="font-display text-[44px] leading-[1.02] tracking-wide text-white">
          LEAGUES
        </h1>
      </div>

      {/* league chips */}
      <div className="no-scrollbar mt-4 flex gap-2 overflow-x-auto px-5 pb-1">
        {LEAGUES.map((l) => (
          <button
            key={l.id}
            onClick={() => setActiveLeague(l.id)}
            className={`whitespace-nowrap rounded-full px-4 py-2 text-[11px] font-bold uppercase tracking-wide transition-colors ${
              l.id === activeLeague
                ? "bg-neon text-black"
                : "bg-ink-3 text-white hover:bg-[#383838]"
            }`}
            aria-pressed={l.id === activeLeague}
          >
            {l.label}
          </button>
        ))}
      </div>

      {/* match cards */}
      <main className="no-scrollbar flex-1 space-y-5 overflow-y-auto px-5 pb-4 pt-4">
        {matches.map((m) => (
          <MatchCard
            key={m.id}
            match={m}
            tag={league.tag}
            onOpen={() => onOpenMatch(m.id)}
            onQuickBet={() => onOpenMatch(m.id, true)}
          />
        ))}
      </main>

      {/* bottom tab bar */}
      <nav
        className="flex items-center justify-between rounded-full bg-ink-2 px-5 py-2.5 mx-4 mb-5 shadow-[0_14px_30px_rgba(0,0,0,0.5)]"
        aria-label="Primary"
      >
        {tabs.map((t) => {
          const Icon = t.icon;
          const active = t.id === tab;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              aria-label={t.label}
              aria-current={active}
              className={`flex h-11 w-11 items-center justify-center rounded-full transition-all ${
                active
                  ? "bg-neon text-black shadow-[0_6px_16px_rgba(198,242,17,0.4)]"
                  : "bg-ink-3 text-white/70 hover:text-white"
              }`}
            >
              <Icon size={19} strokeWidth={2.2} />
            </button>
          );
        })}
      </nav>
    </div>
  );
}
