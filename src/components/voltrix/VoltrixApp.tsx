"use client";

/* ============================================================
   VOLTRIX front — Racine de l'application
   Design conservé du front KickOff (cadre téléphone, encre +
   lime néon, Anton) — données et écrans adaptés à l'API VOLTRIX :
   pronos moteur, marchés, value bets, prévisions figées,
   performance, portefeuille.
   ============================================================ */

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Sparkles, Zap } from "lucide-react";
import { CalendarRange, Home, Settings, Target, Wallet } from "lucide-react";
import { getApiBase } from "@/lib/voltrix";
import { HomeScreen } from "./HomeScreen";
import { MatchScreen } from "./MatchScreen";
import { PrevisionsScreen } from "./PrevisionsScreen";
import { PrecisionScreen } from "./PrecisionScreen";
import { PortfolioScreen } from "./PortfolioScreen";
import { SettingsScreen } from "./SettingsScreen";
import { TicketSheet } from "./TicketSheet";
import type { LightMatch } from "@/lib/voltrix-types";

export type TabId = "home" | "previsions" | "precision" | "portfolio" | "settings";

export type Screen =
  | { name: TabId }
  | { name: "match"; matchId: string; leagueCode: string; date: string; light?: LightMatch };

/** Contexte de sélection passé au TicketSheet. */
export interface SelectionDraft {
  matchId: string;
  leagueCode: string;
  matchDate: string;
  market: string;
  pick: string;
  prob: number;
  odds: number | null;
  homeName: string;
  awayName: string;
  homeLogo: string | null;
  awayLogo: string | null;
}

const TABS: Array<{ id: TabId; icon: typeof Home; label: string }> = [
  { id: "home", icon: Home, label: "Accueil" },
  { id: "previsions", icon: CalendarRange, label: "Prévisions" },
  { id: "precision", icon: Target, label: "Précision" },
  { id: "portfolio", icon: Wallet, label: "Portefeuille" },
  { id: "settings", icon: Settings, label: "Réglages" },
];

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

export function VoltrixApp() {
  const [stack, setStack] = useState<Screen[]>([{ name: "home" }]);
  const [direction, setDirection] = useState(1);
  const [tab, setTab] = useState<TabId>("home");
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* Ticket sheet */
  const [ticketOpen, setTicketOpen] = useState(false);
  const [ticketSession, setTicketSession] = useState(0);
  const [draft, setDraft] = useState<SelectionDraft | null>(null);

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

  const openTicket = useCallback((d: SelectionDraft) => {
    setDraft(d);
    setTicketSession((s) => s + 1);
    setTicketOpen(true);
  }, []);

  /* Échap : ferme les overlays puis dépile */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (ticketOpen) setTicketOpen(false);
        else if (stack.length > 1) pop();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ticketOpen, stack.length, pop]);

  const screenKey =
    current.name === "match" ? `match-${current.matchId}` : `tab-${current.name}`;

  const variants = {
    enter: (dir: number) => ({ x: dir > 0 ? "100%" : "-100%", opacity: 0.6 }),
    center: { x: 0, opacity: 1 },
    exit: (dir: number) => ({ x: dir > 0 ? "-32%" : "100%", opacity: 0.6 }),
  };

  const isLive = getApiBase().length > 0;

  return (
    <div className="relative flex min-h-dvh w-full items-center justify-center overflow-hidden bg-canvas sm:p-6">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(1100px 700px at 50% 38%, rgba(255,255,255,0.16), transparent 65%)",
        }}
        aria-hidden="true"
      />

      {/* cadre téléphone — plein écran sur mobile, maquette cadrée sur desktop */}
      <div className="relative h-dvh w-full max-w-none overflow-hidden bg-ink sm:h-[844px] sm:max-w-[400px] sm:rounded-[46px] sm:shadow-[0_40px_90px_rgba(0,0,0,0.45),0_0_0_11px_#101010,0_0_0_13px_#2c2c2c]">
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
              <HomeScreen
                onOpenMatch={openMatch}
                onQuickTicket={openTicket}
                apiEpoch={apiEpoch}
              />
            ) : null}

            {current.name === "previsions" ? (
              <PrevisionsScreen apiEpoch={apiEpoch} />
            ) : null}

            {current.name === "precision" ? <PrecisionScreen apiEpoch={apiEpoch} /> : null}

            {current.name === "portfolio" ? (
              <PortfolioScreen apiEpoch={apiEpoch} onToast={showToast} />
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
                onTicket={openTicket}
              />
            ) : null}
          </motion.div>
        </AnimatePresence>

        {/* toast applicatif */}
        <AnimatePresence>
          {toast ? (
            <motion.div
              initial={{ y: -60, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -60, opacity: 0 }}
              transition={{ type: "spring", damping: 22 }}
              className="absolute left-1/2 top-4 z-[70] flex max-w-[85%] -translate-x-1/2 items-center gap-2 rounded-full bg-neon px-4 py-2.5 shadow-[0_10px_26px_rgba(0,0,0,0.4)]"
              role="status"
            >
              <Sparkles size={14} className="shrink-0 text-black" />
              <span className="text-[11.5px] font-bold text-black">{toast}</span>
            </motion.div>
          ) : null}
        </AnimatePresence>

        {/* feuille de ticket */}
        {draft ? (
          <TicketSheet
            key={`ticket-${ticketSession}`}
            draft={draft}
            open={ticketOpen}
            onClose={() => setTicketOpen(false)}
            onPlaced={() => showToast("Ticket enregistré au Portefeuille")}
          />
        ) : null}

        {/* barre d'onglets — masquée sur l'écran détail match */}
        {current.name !== "match" ? (
          <nav
            className="absolute inset-x-4 bottom-4 z-30 flex items-center justify-between rounded-full bg-ink-2 px-3 py-2.5 shadow-[0_14px_30px_rgba(0,0,0,0.5)]"
            aria-label="Navigation principale"
          >
            {TABS.map((t) => {
              const Icon = t.icon;
              const active = t.id === tab;
              const isMiddle = t.id === "precision";
              return (
                <button
                  key={t.id}
                  onClick={() => goTab(t.id)}
                  aria-label={t.label}
                  aria-current={active}
                  className={`flex items-center justify-center rounded-full transition-[color,background-color,box-shadow] duration-150 ease-out ${
                    isMiddle ? "h-12 w-12" : "h-11 w-11"
                  } ${
                    active
                      ? "bg-neon text-black shadow-[0_6px_16px_rgba(198,242,17,0.4)]"
                      : "bg-ink-3 text-white/70 hover:text-white"
                  }`}
                >
                  {isMiddle && active ? (
                    <span className="flex items-center gap-1">
                      <Zap size={19} strokeWidth={2.4} />
                    </span>
                  ) : (
                    <Icon size={19} strokeWidth={2.2} />
                  )}
                </button>
              );
            })}
          </nav>
        ) : null}
      </div>
    </div>
  );
}
