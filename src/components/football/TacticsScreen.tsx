"use client";

import { useState } from "react";
import { ChevronLeft, Eye, MoreHorizontal } from "lucide-react";
import { formatViewers, STATS, TABLE, type Match, type Player } from "./data";
import { Crest, MiniCrest } from "./Crest";
import { Jersey, BallDot } from "./Jersey";

type TacticsTab = "lineup" | "tactics" | "stats" | "table";

/* ---------------- pitch with jerseys ---------------- */

function Pitch({ match }: { match: Match }) {
  const [selected, setSelected] = useState<Player | null>(null);

  return (
    <div className="relative mx-4 mt-3 flex-1 overflow-hidden rounded-[26px] bg-pitch">
      {/* field markings */}
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 300 460"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <g stroke="#2A3320" strokeWidth="2.5" fill="none">
          <rect x="14" y="14" width="272" height="432" rx="6" />
          <line x1="14" y1="230" x2="286" y2="230" />
          <circle cx="150" cy="230" r="42" />
          <circle cx="150" cy="230" r="3" fill="#2A3320" />
          {/* top penalty area */}
          <rect x="75" y="14" width="150" height="66" />
          <rect x="112" y="14" width="76" height="26" />
          <circle cx="150" cy="58" r="3" fill="#2A3320" />
          {/* bottom penalty area */}
          <rect x="75" y="380" width="150" height="66" />
          <rect x="112" y="420" width="76" height="26" />
          <circle cx="150" cy="402" r="3" fill="#2A3320" />
          {/* corner arcs */}
          <path d="M14 26 A12 12 0 0 0 26 14" />
          <path d="M274 14 A12 12 0 0 0 286 26" />
          <path d="M286 434 A12 12 0 0 0 274 446" />
          <path d="M26 446 A12 12 0 0 0 14 434" />
        </g>
        {/* soft mow stripes */}
        <g fill="#FFFFFF" opacity="0.016">
          <rect x="14" y="14" width="272" height="54" />
          <rect x="14" y="122" width="272" height="54" />
          <rect x="14" y="230" width="272" height="54" />
          <rect x="14" y="338" width="272" height="54" />
        </g>
      </svg>

      {/* players */}
      {match.players.map((p) => (
        <button
          key={p.id}
          onClick={() => setSelected(selected?.id === p.id ? null : p)}
          style={{ left: `${p.x}%`, top: `${p.y}%` }}
          className="absolute -translate-x-1/2 -translate-y-1/2 transition-transform duration-200 hover:scale-110"
          aria-label={`${p.name}, ${p.pos}, number ${p.number}`}
          aria-pressed={selected?.id === p.id}
        >
          <span className="flex flex-col items-center">
            <span className="relative">
              <Jersey size={34} color={p.highlight ? "#C6F211" : "#FFFFFF"} />
              {p.hasBall ? (
                <span className="absolute -right-2 -top-1">
                  <BallDot size={11} />
                </span>
              ) : null}
              {selected?.id === p.id ? (
                <span className="absolute -inset-1.5 rounded-full ring-2 ring-neon" />
              ) : null}
            </span>
            <span
              className={`mt-0.5 rounded px-1 text-[8px] font-semibold leading-tight ${
                selected?.id === p.id ? "bg-neon text-black" : "text-white"
              }`}
            >
              {p.name}
            </span>
          </span>
        </button>
      ))}

      {/* selected player card */}
      {selected ? (
        <div className="absolute inset-x-4 bottom-3 flex items-center gap-3 rounded-2xl bg-black/85 px-4 py-2.5 ring-1 ring-white/10 backdrop-blur">
          <Jersey size={30} color={selected.highlight ? "#C6F211" : "#FFFFFF"} withNumber number={selected.number} />
          <div className="flex-1">
            <p className="text-[13px] font-bold leading-tight text-white">{selected.name}</p>
            <p className="text-[9.5px] font-semibold uppercase tracking-wider text-white/50">
              {match.home.short} · #{selected.number} · {selected.pos}
            </p>
          </div>
          <span className="rounded-full bg-neon px-2.5 py-1 text-[9px] font-black uppercase text-black">
            {selected.pos}
          </span>
        </div>
      ) : null}
    </div>
  );
}

/* ---------------- lineup list ---------------- */

const POS_ORDER: { key: Player["pos"]; label: string }[] = [
  { key: "GK", label: "Goalkeeper" },
  { key: "DEF", label: "Defence" },
  { key: "MID", label: "Midfield" },
  { key: "FWD", label: "Attack" },
];

function Lineup({ match }: { match: Match }) {
  return (
    <div className="no-scrollbar mx-4 mt-3 flex-1 space-y-4 overflow-y-auto pb-2">
      <div className="flex items-center justify-between">
        <p className="text-[13px] font-semibold text-white/80">Starting XI</p>
        <span className="rounded-full bg-ink-3 px-3 py-1 text-[10px] font-bold text-neon">
          {match.formation}
        </span>
      </div>
      {POS_ORDER.map(({ key, label }) => (
        <section key={key}>
          <h3 className="mb-2 text-[9.5px] font-black uppercase tracking-[0.18em] text-neon">
            {label}
          </h3>
          <div className="overflow-hidden rounded-[20px] bg-panel">
            {match.players
              .filter((p) => p.pos === key)
              .map((p, i) => (
                <div
                  key={p.id}
                  className={`flex items-center gap-3 px-3.5 py-2.5 ${
                    i > 0 ? "border-t border-black/8" : ""
                  }`}
                >
                  <span className="w-7 text-center text-[15px] font-black text-black/80">
                    {p.number}
                  </span>
                  <Jersey size={26} color={p.highlight ? "#C6F211" : "#FFFFFF"} />
                  <span className="flex-1 text-[13px] font-bold text-black">{p.name}</span>
                  {p.highlight ? (
                    <span className="rounded-full bg-neon px-2 py-[3px] text-[8px] font-black uppercase text-black">
                      Key player
                    </span>
                  ) : null}
                </div>
              ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/* ---------------- stats ---------------- */

function StatBar({ label, home, away, unit, homeColor, awayColor }: {
  label: string;
  home: number;
  away: number;
  unit?: string;
  homeColor: string;
  awayColor: string;
}) {
  const total = home + away || 1;
  const homePct = Math.round((home / total) * 100);
  return (
    <div className="rounded-[18px] bg-ink-2 px-4 py-3.5">
      <div className="flex items-center justify-between text-[13px] font-black text-white">
        <span>
          {home}
          {unit ?? ""}
        </span>
        <span className="text-[9.5px] font-bold uppercase tracking-widest text-white/45">
          {label}
        </span>
        <span>
          {away}
          {unit ?? ""}
        </span>
      </div>
      <div className="mt-2 flex h-[7px] gap-1 overflow-hidden rounded-full">
        <div className="flex flex-1 justify-end overflow-hidden rounded-l-full bg-white/10">
          <div
            className="h-full rounded-l-full transition-all duration-500"
            style={{ width: `${homePct}%`, backgroundColor: homeColor }}
          />
        </div>
        <div className="flex flex-1 overflow-hidden rounded-r-full bg-white/10">
          <div
            className="h-full rounded-r-full transition-all duration-500"
            style={{ width: `${100 - homePct}%`, backgroundColor: awayColor }}
          />
        </div>
      </div>
    </div>
  );
}

function Stats({ match }: { match: Match }) {
  return (
    <div className="no-scrollbar mx-4 mt-3 flex-1 space-y-2.5 overflow-y-auto pb-2">
      <div className="flex items-center justify-between px-1">
        <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-white/80">
          <Crest team={match.home} size={22} /> {match.home.short}
        </span>
        <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-white/80">
          {match.away.short} <Crest team={match.away} size={22} />
        </span>
      </div>
      {STATS.map((s) => (
        <StatBar
          key={s.label}
          label={s.label}
          home={s.home}
          away={s.away}
          unit={s.unit}
          homeColor={match.home.primary}
          awayColor={match.away.primary}
        />
      ))}
    </div>
  );
}

/* ---------------- table ---------------- */

function LeagueTable({ match }: { match: Match }) {
  return (
    <div className="no-scrollbar mx-4 mt-3 flex-1 overflow-y-auto pb-2">
      <div className="overflow-hidden rounded-[20px] bg-panel">
        <table className="w-full text-left">
          <thead>
            <tr className="bg-panel-2 text-[8.5px] font-black uppercase tracking-widest text-black/50">
              <th className="px-3 py-2.5 pl-4">#</th>
              <th className="px-1 py-2.5">Club</th>
              <th className="px-1.5 py-2.5 text-center">P</th>
              <th className="px-1.5 py-2.5 text-center">GD</th>
              <th className="px-2.5 py-2.5 pr-4 text-center">Pts</th>
            </tr>
          </thead>
          <tbody>
            {TABLE.map((row, i) => {
              const involved = row.team.id === match.home.id || row.team.id === match.away.id;
              return (
                <tr
                  key={row.team.id}
                  className={`text-[11.5px] font-bold text-black ${involved ? "bg-neon/70" : ""} ${
                    i > 0 ? "border-t border-black/8" : ""
                  }`}
                >
                  <td className="px-3 py-2.5 pl-4 text-black/50">{i + 1}</td>
                  <td className="px-1 py-2">
                    <span className="flex items-center gap-2">
                      <Crest team={row.team} size={20} />
                      <span className="truncate">{row.team.label}</span>
                    </span>
                  </td>
                  <td className="px-1.5 py-2.5 text-center text-black/60">{row.played}</td>
                  <td className="px-1.5 py-2.5 text-center text-black/60">
                    {row.gd > 0 ? `+${row.gd}` : row.gd}
                  </td>
                  <td className="px-2.5 py-2.5 pr-4 text-center text-[13px] font-black">
                    {row.points}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 px-1 text-[9px] font-semibold uppercase tracking-widest text-white/35">
        Standings · demo data
      </p>
    </div>
  );
}

/* ---------------- screen ---------------- */

export function TacticsScreen({
  match,
  onBack,
  initialTab = "tactics",
}: {
  match: Match;
  onBack: () => void;
  initialTab?: TacticsTab;
}) {
  const [tab, setTab] = useState<TacticsTab>(initialTab);

  const tabs: { id: TacticsTab; label: string }[] = [
    { id: "lineup", label: "Lineup" },
    { id: "tactics", label: "Tactics" },
    { id: "stats", label: "Stats" },
    { id: "table", label: "Table" },
  ];

  return (
    <div className="flex h-full flex-col bg-ink">
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
            {match.isLive ? formatViewers(match.viewers ?? 0) : match.date}
          </span>
          {match.isLive ? (
            <span className="flex items-center gap-1.5 rounded-full bg-neon px-2.5 py-1 text-[9.5px] font-black uppercase tracking-wide text-black">
              <span className="live-dot h-1.5 w-1.5 rounded-full bg-black" />
              Live
            </span>
          ) : null}
        </div>

        <button
          className="flex h-9 w-9 items-center justify-center rounded-full bg-ink-3 text-white transition-colors hover:bg-neon hover:text-black"
          aria-label="More options"
        >
          <MoreHorizontal size={17} strokeWidth={2.2} />
        </button>
      </header>

      {/* title + club badges */}
      <div className="flex items-end justify-between px-5 pt-4">
        <div>
          <p className="text-[15px] font-normal text-white/70">Explore</p>
          <h1 className="font-display text-[40px] leading-[1.02] tracking-wide text-white">
            TACTICS
          </h1>
        </div>
        <div className="flex items-center gap-1.5 pb-2">
          <MiniCrest team={match.away} size={30} />
          <MiniCrest team={match.home} size={30} highlighted />
        </div>
      </div>

      {/* tab content */}
      {tab === "tactics" ? <Pitch match={match} /> : null}
      {tab === "lineup" ? <Lineup match={match} /> : null}
      {tab === "stats" ? <Stats match={match} /> : null}
      {tab === "table" ? <LeagueTable match={match} /> : null}

      {/* bottom tab bar */}
      <nav
        className="mx-4 mb-5 mt-3 flex items-center justify-between rounded-full bg-ink-2 px-2.5 py-2.5 shadow-[0_14px_30px_rgba(0,0,0,0.5)]"
        aria-label="Match sections"
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            aria-pressed={t.id === tab}
            className={`h-10 flex-1 rounded-full text-[10.5px] font-bold uppercase tracking-wide transition-colors ${
              t.id === tab ? "bg-neon text-black" : "text-white/60 hover:text-white"
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
