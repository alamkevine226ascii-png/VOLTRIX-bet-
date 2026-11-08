"use client";

/* ============================================================
   VOLTRIX front — Racine de l'application
   Design conservé du front KickOff (cadre téléphone, encre +
   lime néon, Anton) — données et écrans adaptés à l'API VOLTRIX :
   pronos moteur, marchés, value bets, réglages.
   ============================================================ */

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2 } from "lucide-react";
import { Home, Settings } from "lucide-react";
import { getApiBase } from "@/lib/voltrix";
import { HomeScreen } from "./HomeScreen";
import { MatchScreen } from "./MatchScreen";
import { SettingsScreen } from "./SettingsScreen";
import type { LightMatch } from "@/lib/voltrix-types";

export type TabId = "home" | "settings";

export type Screen =
  | { name: TabId }
  | { name: "match"; matchId: string; leagueCode: string; date: string; light?: LightMatch };

function LogoBadge() {
  return (
    <span className="flex h-11 w-11 items-center justify-center rounded-full bg-neon shadow-[0_4px_18px_rgba(198,242,17,0.35)]">
      <svg width="24" height="24" viewBox="0 0 24 24" role="img" aria-label="Logo VOLTRIX">
        <path
          d="M4 12 L8 5 H16 L20 12 L16 19 H8 Z"
          fill="none"
          stroke="#141414"
          strokeWidth="2.2"
          strokeLinejoin="round"
        />
        <path d="M12 7.5 L15.5 12 L12 16.5 L8.5 12 Z" fill="#141414" />
        <circle cx="12" cy="12" r="1.3" fill="#c6f211" />
      </svg>
    </span>
  );
}

const TABS: Array<{ id: TabId; icon: typeof Home; label: string }> = [
  { id: "home", icon: Home, label: "Accueil" },
  { id: "settings", icon: Settings, label: "Réglages" },
];

export function VoltrixApp() {
  const [stack, setStack] = useState<Screen[]>([{ name: "home" }]);
  const [direction, setDirection] = useState(1);
  const [tab, setTab] = useState<TabId>("home");
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* incrémente à chaque changement d'URL d'API pour recharger les écrans */
  const [apiEpoch, setApiEpoch] = useState(0);

  const current = stack[stack.length - 1];

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

  const goTab = useCallback((t: TabId) => {
    setDirection(t === "home" ? -1 : 1);
    setTab(t);
    setStack([{ name: t }]);
  }, []);

  const openMatch = useCallback(
    (matchId: string, leagueCode: string, date: string, light?: LightMatch) => {
      push({ name: "match", matchId, leagueCode, date, light });
    },
    [push],
  );

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2800);
  }, []);

  /* Échap : dépile */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && stack.length > 1) pop();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stack.length, pop]);

  const screenKey =
    current.name === "match" ? `match-${current.matchId}` : `tab-${current.name}`;

  const variants = {
    enter: (dir: number) => ({ x: dir > 0 ? "100%" : "-100%", opacity: 0.6 }),
    center: { x: 0, opacity: 1 },
    exit: (dir: number) => ({ x: dir > 0 ? "-32%" : "100%", opacity: 0.6 }),
  };

  const isLive = getApiBase().length > 0;

  return (
    <div className="relative flex min-h-dvh w-full items-center justify-center overflow-hidden bg-black sm:p-6">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(1100px 700px at 50% 32%, rgba(198,242,17,0.07), transparent 60%), radial-gradient(900px 600px at 50% 100%, rgba(255,255,255,0.05), transparent 65%)",
        }}
        aria-hidden="true"
      />

      {/* cadre téléphone — plein écran sur mobile, maquette cadrée sur desktop */}
      <div className="relative h-dvh w-full max-w-none overflow-hidden bg-black sm:h-[844px] sm:max-w-[400px] sm:rounded-[46px] sm:shadow-[0_40px_90px_rgba(0,0,0,0.55),0_0_0_11px_#1a1a1c,0_0_0_13px_#3a3a3c]">
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
            {current.name === "home" ? (
              <HomeScreen onOpenMatch={openMatch} apiEpoch={apiEpoch} />
            ) : null}

            {current.name === "settings" ? (
              <SettingsScreen
                apiEpoch={apiEpoch}
                onBaseChanged={() => setApiEpoch((e) => e + 1)}
                headerSlot={<LogoBadge />}
                isLive={isLive}
              />
            ) : null}

            {current.name === "match" ? (
              <MatchScreen
                matchId={current.matchId}
                leagueCode={current.leagueCode}
                date={current.date}
                light={current.light}
                onBack={pop}
              />
            ) : null}
          </motion.div>
        </AnimatePresence>

        {/* toast — pilule en haut */}
        <AnimatePresence>
          {toast ? (
            <motion.div
              initial={{ y: -70, opacity: 0, scale: 0.96 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: -70, opacity: 0, scale: 0.96 }}
              transition={{ type: "spring", stiffness: 420, damping: 32 }}
              className="absolute left-1/2 top-3 z-[70] flex max-w-[88%] -translate-x-1/2 items-center gap-2 rounded-full bg-ink-2 px-4 py-2.5 shadow-[0_8px_24px_rgba(0,0,0,0.4)] ring-1 ring-white/10"
              role="status"
            >
              <CheckCircle2 size={16} className="shrink-0 text-neon" />
              <span className="text-[13px] font-semibold text-white">{toast}</span>
            </motion.div>
          ) : null}
        </AnimatePresence>

        {/* barre d'onglets — matériau sombre, le contenu défile derrière ;
            masquée sur l'écran détail match */}
        {current.name !== "match" ? (
          <nav
            className="absolute inset-x-0 bottom-0 z-30 border-t border-white/10 bg-ink/95 backdrop-blur"
            style={{ paddingBottom: "max(env(safe-area-inset-bottom), 6px)" }}
            aria-label="Navigation principale"
          >
            <div className="flex items-stretch px-1 pt-1.5">
              {TABS.map((t) => {
                const Icon = t.icon;
                const active = t.id === tab;
                return (
                  <button
                    key={t.id}
                    onClick={() => goTab(t.id)}
                    aria-label={t.label}
                    aria-current={active}
                    className={`flex flex-1 flex-col items-center gap-[3px] rounded-lg py-1.5 transition-colors duration-150 ease-out ${
                      active ? "text-neon" : "text-white/40"
                    }`}
                  >
                    <Icon size={22} strokeWidth={active ? 2.3 : 1.9} />
                    <span className={`text-[10px] ${active ? "font-semibold" : "font-medium"}`}>{t.label}</span>
                  </button>
                );
              })}
            </div>
          </nav>
        ) : null}
      </div>
    </div>
  );
}
