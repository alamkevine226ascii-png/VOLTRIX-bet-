"use client";

/* ============================================================
   VOLTRIX app — Racine de l'application mobile
   Vrai logo, navigation par pile d'écrans (accueil / réglages /
   détail match / détail combat) et barre d'onglets capsule
   flottante façon iOS 27. Toutes les données sont réelles et
   calculées localement (ESPN direct) — plus de mode démo.
   Option A (correctif « rechargement du moteur ») : l'écran
   d'onglet reste monté sous les fiches détaillées — retour
   instantané, listes, filtres, défilement et pronos conservés.
   ============================================================ */

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2 } from "lucide-react";
import { Home, Settings } from "lucide-react";
import { HomeScreen } from "./HomeScreen";
import { MatchScreen } from "./MatchScreen";
import { MmaFightScreen } from "./MmaFightScreen";
import { SettingsScreen } from "./SettingsScreen";
import { CombinatorScreen } from "./CombinatorScreen";
import type { LightMatch } from "@/lib/voltrix-types";

export type TabId = "home" | "settings";

export type Screen =
  | { name: TabId }
  | { name: "match"; matchId: string; leagueCode: string; date: string; light?: LightMatch }
  | { name: "fight"; fightId: string }
  | { name: "combinator"; date: string };

function LogoBadge() {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/logo.png"
      alt="VOLTRIX"
      className="h-11 w-11 rounded-2xl object-contain drop-shadow-[0_4px_16px_rgba(198,242,17,0.25)]"
    />
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

  const current = stack[stack.length - 1];

  /* Fiche détaillée ouverte ? L'écran d'onglet courant reste alors
     monté dessous (option A) : jamais démonté, jamais rechargé. */
  const isDetail =
    current.name === "match" || current.name === "fight" || current.name === "combinator";

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

  const openFight = useCallback(
    (fightId: string) => {
      push({ name: "fight", fightId });
    },
    [push],
  );

  const openCombinator = useCallback(
    (date: string) => {
      push({ name: "combinator", date });
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

  /* Variantes des fiches détaillées : glissement latéral complet
     (entrée depuis un bord, sortie vers le bord opposé). */
  const detailVariants = {
    enter: (dir: number) => ({ x: dir > 0 ? "100%" : "-100%", opacity: 0.6 }),
    center: { x: 0, opacity: 1 },
    exit: (dir: number) => ({ x: dir > 0 ? "-32%" : "100%", opacity: 0.6 }),
  };

  /* Variantes de la couche d'onglet : glissement uniquement lors d'un
     changement d'onglet. Quand une fiche est empilée par-dessus, elle
     reste en place et se rétracte très légèrement — effet de profondeur
     des applications natives, cœur de l'option A. */
  const tabVariants = {
    enter: (dir: number) => ({ x: dir > 0 ? "100%" : "-100%", opacity: 0.6 }),
    center: { x: 0, opacity: 1, scale: 1 },
    covered: { x: 0, opacity: 1, scale: 0.955 },
    exit: (dir: number) => ({ x: dir > 0 ? "-32%" : "100%", opacity: 0.6 }),
  };

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
          {/* Couche fond — écran d'onglet (accueil / réglages).
              OPTION A du diagnostic « rechargement du moteur » : cette
              couche n'est JAMAIS démontée quand une fiche s'ouvre
              par-dessus. Retour instantané depuis une fiche : date,
              filtres, listes, pronos et position de défilement restent
              intacts, aucune requête réseau n'est relancée. Inerte
              tant qu'une fiche la recouvre. */}
          <motion.div
            key={`tab-${tab}`}
            custom={direction}
            variants={tabVariants}
            initial="enter"
            animate={isDetail ? "covered" : "center"}
            exit="exit"
            transition={{ duration: 0.32, ease: [0.32, 0.72, 0, 1] }}
            className="absolute inset-0"
            inert={isDetail}
            style={{ pointerEvents: isDetail ? "none" : undefined }}
          >
            {tab === "home" ? (
              <HomeScreen
                onOpenMatch={openMatch}
                onOpenFight={openFight}
                onOpenCombinator={openCombinator}
                showToast={showToast}
              />
            ) : (
              <SettingsScreen headerSlot={<LogoBadge />} />
            )}
          </motion.div>

          {/* Fiches détaillées — empilées par-dessus l'écran d'onglet
              (z-10) ; seule la fiche courante est rendue, elle est
              démontée au retour. */}
          {current.name === "match" ? (
            <motion.div
              key={`match-${current.matchId}`}
              custom={direction}
              variants={detailVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.32, ease: [0.32, 0.72, 0, 1] }}
              className="absolute inset-0 z-10"
            >
              <MatchScreen
                matchId={current.matchId}
                leagueCode={current.leagueCode}
                date={current.date}
                light={current.light}
                onBack={pop}
              />
            </motion.div>
          ) : null}

          {current.name === "fight" ? (
            <motion.div
              key={`fight-${current.fightId}`}
              custom={direction}
              variants={detailVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.32, ease: [0.32, 0.72, 0, 1] }}
              className="absolute inset-0 z-10"
            >
              <MmaFightScreen fightId={current.fightId} onBack={pop} />
            </motion.div>
          ) : null}

          {current.name === "combinator" ? (
            <motion.div
              key={`combinator-${current.date}`}
              custom={direction}
              variants={detailVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.32, ease: [0.32, 0.72, 0, 1] }}
              className="absolute inset-0 z-10"
            >
              <CombinatorScreen
                date={current.date}
                onBack={pop}
                onOpenMatch={openMatch}
              />
            </motion.div>
          ) : null}
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

        {/* barre d'onglets — capsule flottante arrondie façon iOS 27 :
            verre sombre, contenu qui défile derrière, pastille active
            animée (layoutId) qui glisse entre les onglets ;
            masquée sur les écrans détail (match / combat) */}
        {!isDetail ? (
          <nav
            className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center"
            style={{ paddingBottom: "max(env(safe-area-inset-bottom), 14px)" }}
            aria-label="Navigation principale"
          >
            <div className="pointer-events-auto flex items-center gap-1 rounded-full bg-ink-2/80 p-1.5 ring-1 ring-white/10 shadow-[0_16px_44px_rgba(0,0,0,0.6),0_2px_10px_rgba(0,0,0,0.4)] backdrop-blur-xl">
              {TABS.map((t) => {
                const Icon = t.icon;
                const active = t.id === tab;
                return (
                  <button
                    key={t.id}
                    onClick={() => goTab(t.id)}
                    aria-label={t.label}
                    aria-current={active ? "page" : undefined}
                    className={`relative flex items-center gap-2 rounded-full px-5 py-2.5 transition-colors duration-150 ease-out ${
                      active ? "text-ink" : "text-white/50 hover:text-white/80"
                    }`}
                  >
                    {active ? (
                      <motion.span
                        layoutId="tab-pill"
                        className="absolute inset-0 rounded-full bg-neon shadow-[0_5px_18px_rgba(198,242,17,0.4)]"
                        transition={{ type: "spring", stiffness: 480, damping: 38 }}
                        aria-hidden="true"
                      />
                    ) : null}
                    <Icon
                      size={17}
                      strokeWidth={active ? 2.4 : 2}
                      className="relative z-10"
                    />
                    <span
                      className={`relative z-10 text-[13px] leading-none tracking-tight ${
                        active ? "font-bold" : "font-medium"
                      }`}
                    >
                      {t.label}
                    </span>
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
