"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Minus, Plus, X } from "lucide-react";
import type { Match } from "./data";
import { Crest } from "./Crest";

type Pick = "home" | "draw" | "away";

const STAKES = [10, 25, 50, 100];

export function BetSheet({
  match,
  open,
  initialPick,
  onClose,
  onPlaced,
}: {
  match: Match;
  open: boolean;
  initialPick: Pick | null;
  onClose: () => void;
  onPlaced: (pick: Pick, stake: number) => void;
}) {
  const [pick, setPick] = useState<Pick>(initialPick ?? "away");
  const [stake, setStake] = useState(25);
  const [placed, setPlaced] = useState(false);

  // auto-close shortly after the bet is confirmed
  useEffect(() => {
    if (!placed) return;
    const t = setTimeout(() => onClose(), 1700);
    return () => clearTimeout(t);
  }, [placed, onClose]);

  const options: { id: Pick; label: string; sub: string; value: number; decimal: number }[] = [
    {
      id: "home",
      label: match.home.label,
      sub: `1 · ${match.home.short}`,
      value: match.odds.home,
      decimal: match.oddsDecimal.home,
    },
    {
      id: "draw",
      label: "Draw",
      sub: "X",
      value: match.odds.draw,
      decimal: match.oddsDecimal.draw,
    },
    {
      id: "away",
      label: match.away.label,
      sub: `2 · ${match.away.short}`,
      value: match.odds.away,
      decimal: match.oddsDecimal.away,
    },
  ];

  const selected = options.find((o) => o.id === pick)!;
  const returns = (stake * selected.decimal).toFixed(2);

  return (
    <AnimatePresence>
      {open ? (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="absolute inset-0 z-40 bg-black/60 backdrop-blur-[2px]"
            aria-hidden="true"
          />
          <motion.div
            role="dialog"
            aria-label="Make bet"
            initial={{ y: "110%" }}
            animate={{ y: 0 }}
            exit={{ y: "110%" }}
            transition={{ type: "spring", damping: 28, stiffness: 300 }}
            className="absolute inset-x-0 bottom-0 z-50 rounded-t-[32px] bg-ink-2 px-5 pb-7 pt-3 shadow-[0_-20px_50px_rgba(0,0,0,0.5)]"
          >
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/20" />

            {!placed ? (
              <>
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <h2 className="font-display text-[22px] tracking-wide text-white">
                      MAKE BET
                    </h2>
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-white/45">
                      {match.home.short} vs {match.away.short} · 1X2
                    </p>
                  </div>
                  <button
                    onClick={onClose}
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-ink-3 text-white/70 transition-colors hover:bg-neon hover:text-black"
                    aria-label="Close"
                  >
                    <X size={15} strokeWidth={2.4} />
                  </button>
                </div>

                {/* pick options */}
                <div className="grid grid-cols-3 gap-2.5">
                  {options.map((o) => (
                    <button
                      key={o.id}
                      onClick={() => setPick(o.id)}
                      aria-pressed={pick === o.id}
                      className={`flex flex-col items-center rounded-[20px] px-2 py-3 transition-all ${
                        pick === o.id
                          ? "bg-neon text-black"
                          : "bg-ink-3 text-white hover:bg-[#383838]"
                      }`}
                    >
                      <span className="text-[17px] font-black leading-none">
                        {o.decimal.toFixed(2)}
                      </span>
                      <span
                        className={`mt-1 text-[8.5px] font-bold uppercase tracking-wider ${
                          pick === o.id ? "text-black/60" : "text-white/50"
                        }`}
                      >
                        {o.sub}
                      </span>
                    </button>
                  ))}
                </div>

                {/* stake */}
                <div className="mt-5 flex items-center justify-between">
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-white/45">
                    Stake
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setStake((s) => Math.max(5, s - 5))}
                      className="flex h-8 w-8 items-center justify-center rounded-full bg-ink-3 text-white transition-colors hover:bg-neon hover:text-black"
                      aria-label="Decrease stake"
                    >
                      <Minus size={14} strokeWidth={2.6} />
                    </button>
                    <span className="min-w-[76px] rounded-full bg-ink-3 px-4 py-1.5 text-center text-[15px] font-black text-white">
                      ${stake}
                    </span>
                    <button
                      onClick={() => setStake((s) => Math.min(500, s + 5))}
                      className="flex h-8 w-8 items-center justify-center rounded-full bg-ink-3 text-white transition-colors hover:bg-neon hover:text-black"
                      aria-label="Increase stake"
                    >
                      <Plus size={14} strokeWidth={2.6} />
                    </button>
                  </div>
                </div>

                <div className="mt-2.5 flex gap-2">
                  {STAKES.map((s) => (
                    <button
                      key={s}
                      onClick={() => setStake(s)}
                      className={`flex-1 rounded-full py-1.5 text-[11px] font-bold transition-colors ${
                        stake === s ? "bg-neon text-black" : "bg-ink-3 text-white/70 hover:text-white"
                      }`}
                    >
                      ${s}
                    </button>
                  ))}
                </div>

                {/* potential return */}
                <div className="mt-4 flex items-center justify-between rounded-2xl bg-black/40 px-4 py-3 ring-1 ring-white/10">
                  <span className="text-[10.5px] font-bold uppercase tracking-widest text-white/50">
                    Potential return
                  </span>
                  <span className="flex items-baseline gap-2">
                    <span className="text-[18px] font-black text-neon">${returns}</span>
                    <span className="flex items-center gap-1">
                      <Crest team={match.home} size={16} />
                      <Crest team={match.away} size={16} />
                    </span>
                  </span>
                </div>

                <button
                  onClick={() => {
                    setPlaced(true);
                    onPlaced(pick, stake);
                  }}
                  className="mt-4 flex h-[52px] w-full items-center justify-center gap-2 rounded-full bg-neon text-[15px] font-black uppercase tracking-wide text-black transition-transform hover:scale-[1.015] active:scale-[0.98]"
                >
                  Place bet · ${stake}
                </button>
              </>
            ) : (
              <div className="flex flex-col items-center py-6">
                <motion.span
                  initial={{ scale: 0.4, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: "spring", damping: 12 }}
                  className="flex h-16 w-16 items-center justify-center rounded-full bg-neon text-black"
                >
                  <Check size={30} strokeWidth={3} />
                </motion.span>
                <h3 className="mt-4 font-display text-[24px] tracking-wide text-white">
                  BET PLACED
                </h3>
                <p className="mt-1 text-[11.5px] font-semibold text-white/55">
                  {selected.sub} · ${stake} → potential ${returns}
                </p>
                <p className="mt-3 rounded-full bg-ink-3 px-3.5 py-1.5 text-[9.5px] font-bold uppercase tracking-widest text-neon">
                  Good luck!
                </p>
              </div>
            )}
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>
  );
}
