"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { formatViewers, type Match } from "./data";

/** Equalizer bars that give the "streaming" feel */
function Equalizer() {
  const bars = [0, 1, 2, 3, 4, 5, 6];
  const delays = ["0s", "0.15s", "0.3s", "0.45s", "0.2s", "0.35s", "0.1s"];
  return (
    <div className="flex h-10 items-end gap-[5px]" aria-hidden="true">
      {bars.map((b) => (
        <span
          key={b}
          className="eq-bar block w-[5px] rounded-full bg-neon"
          style={{ height: `${22 + ((b * 13) % 18)}px`, animationDelay: delays[b] }}
        />
      ))}
    </div>
  );
}

export function LiveOverlay({
  match,
  open,
  onClose,
}: {
  match: Match;
  open: boolean;
  onClose: () => void;
}) {
  const [viewers, setViewers] = useState(match.viewers ?? 0);

  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => {
      setViewers((v) => v + Math.floor(Math.random() * 6) + 2);
    }, 1800);
    return () => clearInterval(t);
  }, [open]);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          role="dialog"
          aria-label="Live stream"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          className="absolute inset-0 z-[60] flex flex-col bg-black"
        >
          <Image
            src="/hero-match.jpg"
            alt="Live football stream"
            fill
            priority
            sizes="(max-width: 640px) 100vw, 400px"
            className="object-cover opacity-60"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/20 to-black/85" />

          {/* top row */}
          <div className="relative z-10 flex items-center justify-between px-5 pt-6">
            <div className="flex items-center gap-2.5 rounded-full bg-black/55 px-3.5 py-2 ring-1 ring-white/15 backdrop-blur">
              <span className="text-[12px] font-black text-white">
                {match.home.short} {match.score ? `${match.score[0]}:${match.score[1]}` : "vs"} {match.away.short}
              </span>
            </div>
            <button
              onClick={onClose}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-black/55 text-white ring-1 ring-white/15 backdrop-blur transition-colors hover:bg-neon hover:text-black"
              aria-label="Close live stream"
            >
              <X size={17} strokeWidth={2.4} />
            </button>
          </div>

          {/* center live indicator */}
          <div className="relative z-10 flex flex-1 flex-col items-center justify-center gap-4">
            <motion.div
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.15, type: "spring", damping: 14 }}
              className="flex items-center gap-2 rounded-full bg-neon px-4 py-1.5"
            >
              <span className="live-dot h-2 w-2 rounded-full bg-black" />
              <span className="text-[11px] font-black uppercase tracking-[0.2em] text-black">
                Live streaming
              </span>
            </motion.div>
            <Equalizer />
            <p className="text-[11.5px] font-semibold text-white/70">
              {formatViewers(viewers)} watching now
            </p>
          </div>

          {/* bottom mini score */}
          <div className="relative z-10 mx-4 mb-6 flex items-center justify-between rounded-3xl bg-black/55 px-5 py-3.5 ring-1 ring-white/15 backdrop-blur">
            <div className="flex flex-col items-center gap-1">
              <span className="text-[11px] font-extrabold text-white">{match.home.short}</span>
            </div>
            <span className="font-display text-[26px] tracking-wide text-neon">
              {match.score ? `${match.score[0]}:${match.score[1]}` : `${match.time}`}
            </span>
            <div className="flex flex-col items-center gap-1">
              <span className="text-[11px] font-extrabold text-white">{match.away.short}</span>
            </div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
