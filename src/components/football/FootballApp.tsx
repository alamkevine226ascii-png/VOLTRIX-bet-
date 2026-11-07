"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Sparkles } from "lucide-react";
import { MATCHES } from "./data";
import { LeaguesScreen } from "./LeaguesScreen";
import { MatchScreen } from "./MatchScreen";
import { TacticsScreen } from "./TacticsScreen";
import { BetSheet } from "./BetSheet";
import { LiveOverlay } from "./LiveOverlay";

type Pick = "home" | "draw" | "away";

type Screen =
  | { name: "leagues" }
  | { name: "match"; matchId: string }
  | { name: "tactics"; matchId: string };

export function FootballApp() {
  const [stack, setStack] = useState<Screen[]>([{ name: "leagues" }]);
  const [direction, setDirection] = useState(1);

  const [betOpen, setBetOpen] = useState(false);
  const [betSession, setBetSession] = useState(0);
  const [betPick, setBetPick] = useState<Pick>("away");
  const [selectedPick, setSelectedPick] = useState<Pick | null>(null);
  const [liveOpen, setLiveOpen] = useState(false);
  const [liveSession, setLiveSession] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const current = stack[stack.length - 1];
  const currentMatch =
    current.name === "leagues"
      ? undefined
      : MATCHES.find((m) => m.id === current.matchId) ?? MATCHES[0];

  const push = useCallback((screen: Screen) => {
    setDirection(1);
    setStack((s) => [...s, screen]);
  }, []);

  const pop = useCallback(() => {
    setStack((s) => {
      if (s.length <= 1) return s;
      setDirection(-1);
      return s.slice(0, -1);
    });
  }, []);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2800);
  }, []);

  /* open a match (optionally straight into the bet sheet) */
  const openMatch = useCallback(
    (matchId: string, openBet = false) => {
      const match = MATCHES.find((m) => m.id === matchId);
      push({ name: "match", matchId });
      if (openBet && match) {
        setSelectedPick("away");
        setBetPick("away");
        setBetSession((s) => s + 1); // fresh sheet state per session
        setBetOpen(true);
      }
    },
    [push],
  );

  /* close overlays with Escape */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (liveOpen) setLiveOpen(false);
        else if (betOpen) setBetOpen(false);
        else if (stack.length > 1) pop();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [liveOpen, betOpen, stack.length, pop]);

  const screenKey =
    current.name === "leagues" ? "leagues" : `${current.name}-${current.matchId}`;

  const variants = {
    enter: (dir: number) => ({ x: dir > 0 ? "100%" : "-100%", opacity: 0.6 }),
    center: { x: 0, opacity: 1 },
    exit: (dir: number) => ({ x: dir > 0 ? "-32%" : "100%", opacity: 0.6 }),
  };

  return (
    <div className="relative flex min-h-dvh w-full items-center justify-center overflow-hidden bg-canvas sm:p-6">
      {/* soft glow on the canvas */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(1100px 700px at 50% 38%, rgba(255,255,255,0.16), transparent 65%)",
        }}
        aria-hidden="true"
      />

      {/* phone frame — fullscreen on mobile, framed mockup on desktop */}
      <div className="relative h-dvh w-full max-w-none overflow-hidden bg-ink sm:h-[844px] sm:max-w-[400px] sm:rounded-[46px] sm:shadow-[0_40px_90px_rgba(0,0,0,0.45),0_0_0_11px_#101010,0_0_0_13px_#2c2c2c]">
        {/* screens */}
        <AnimatePresence initial={false} custom={direction} mode="popLayout">
          <motion.div
            key={screenKey}
            custom={direction}
            variants={variants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.32, ease: [0.32, 0.72, 0, 1] }}
            className="absolute inset-0"
          >
            {current.name === "leagues" ? (
              <LeaguesScreen onOpenMatch={openMatch} />
            ) : null}

            {current.name === "match" && currentMatch ? (
              <MatchScreen
                match={currentMatch}
                onBack={pop}
                onOpenTactics={() => push({ name: "tactics", matchId: currentMatch.id })}
                onOpenLive={() => {
                  setLiveSession((s) => s + 1); // fresh viewers counter per session
                  setLiveOpen(true);
                }}
                onMakeBet={() => {
                  setBetPick(selectedPick ?? "away");
                  setBetSession((s) => s + 1); // fresh sheet state per session
                  setBetOpen(true);
                }}
                selectedPick={selectedPick}
                onSelectPick={(p) => setSelectedPick(p)}
              />
            ) : null}

            {current.name === "tactics" && currentMatch ? (
              <TacticsScreen match={currentMatch} onBack={pop} />
            ) : null}
          </motion.div>
        </AnimatePresence>

        {/* in-app toast */}
        <AnimatePresence>
          {toast ? (
            <motion.div
              initial={{ y: -60, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -60, opacity: 0 }}
              transition={{ type: "spring", damping: 22 }}
              className="absolute left-1/2 top-4 z-[70] flex -translate-x-1/2 items-center gap-2 rounded-full bg-neon px-4 py-2.5 shadow-[0_10px_26px_rgba(0,0,0,0.4)]"
              role="status"
            >
              <Sparkles size={14} className="text-black" />
              <span className="whitespace-nowrap text-[11.5px] font-bold text-black">{toast}</span>
            </motion.div>
          ) : null}
        </AnimatePresence>

        {/* overlays */}
        {currentMatch ? (
          <>
            <BetSheet
              key={`bet-${betSession}`}
              match={currentMatch}
              open={betOpen}
              initialPick={betPick}
              onClose={() => setBetOpen(false)}
              onPlaced={() => showToast("Bet placed — good luck!")}
            />
            <LiveOverlay
              key={`live-${liveSession}`}
              match={currentMatch}
              open={liveOpen}
              onClose={() => setLiveOpen(false)}
            />
          </>
        ) : null}
      </div>
    </div>
  );
}
