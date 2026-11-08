"use client";

/* ============================================================
   VOLTRIX front — Feuille de ticket
   Sélection (marché + pick + proba moteur + cote) + mise.
   Le ticket est enregistré dans le Portefeuille local ;
   son règlement passera par /api/bankroll/resolve, sa vente
   par /api/cashout.
   ============================================================ */

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Minus, Plus, Ticket, X } from "lucide-react";
import { pct } from "@/lib/voltrix";
import { addTicket, writeWallet, readWallet } from "@/lib/tickets";
import { TeamBadge } from "./TeamBadge";
import type { SelectionDraft } from "./VoltrixApp";

const STAKES = [5, 10, 25, 50];

export function TicketSheet({
  draft,
  open,
  onClose,
  onPlaced,
}: {
  draft: SelectionDraft;
  open: boolean;
  onClose: () => void;
  onPlaced: () => void;
}) {
  const [stake, setStake] = useState(10);
  const [placed, setPlaced] = useState(false);

  useEffect(() => {
    if (!placed) return;
    const t = setTimeout(onClose, 1700);
    return () => clearTimeout(t);
  }, [placed, onClose]);

  const returns = useMemo(
    () => (draft.odds != null ? (stake * draft.odds).toFixed(2) : null),
    [draft.odds, stake],
  );

  const place = () => {
    addTicket({
      id: `t-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      createdAt: Date.now(),
      legs: [
        {
          matchId: draft.matchId,
          leagueCode: draft.leagueCode,
          matchDate: draft.matchDate,
          market: draft.market,
          pick: draft.pick,
          prob: draft.prob,
          odds: draft.odds,
          homeName: draft.homeName,
          awayName: draft.awayName,
        },
      ],
      stake,
      totalOdds: draft.odds,
      status: "pending",
    });
    writeWallet(readWallet() - stake);
    setPlaced(true);
    onPlaced();
  };

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
            aria-label="Créer un ticket"
            initial={{ y: "110%" }}
            animate={{ y: 0 }}
            exit={{ y: "110%" }}
            transition={{ type: "spring", stiffness: 380, damping: 38 }}
            className="absolute inset-x-0 bottom-0 z-50 rounded-t-[34px] bg-ink-2 px-5 pb-8 pt-2.5 shadow-[0_-16px_40px_rgba(0,0,0,0.5)]"
          >
            {/* poignée iOS */}
            <div className="mx-auto mb-4 h-[5px] w-9 rounded-full bg-white/25" />

            {!placed ? (
              <>
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-[22px] font-bold tracking-[-0.015em] text-white">Ticket</h2>
                    <p className="truncate text-[12px] text-white/45">
                      {draft.homeName} vs {draft.awayName}
                    </p>
                  </div>
                  <button
                    onClick={onClose}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-white/70 transition-transform duration-150 ease-out active:scale-95"
                    aria-label="Fermer"
                  >
                    <X size={15} strokeWidth={2.4} />
                  </button>
                </div>

                {/* sélection */}
                <div className="flex items-center gap-3 rounded-2xl bg-ink-3 p-3.5">
                  <div className="flex shrink-0 -space-x-2">
                    <TeamBadge name={draft.homeName} logo={draft.homeLogo} size={30} />
                    <TeamBadge name={draft.awayName} logo={draft.awayLogo} size={30} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-semibold text-white">{draft.pick}</p>
                    <p className="text-[11px] text-white/45">
                      {draft.market} · proba moteur {pct(draft.prob)}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-[17px] font-bold leading-none text-white">{draft.odds != null ? draft.odds.toFixed(2) : "—"}</p>
                    <p className="mt-0.5 text-[10px] text-white/40">cote</p>
                  </div>
                </div>

                {/* mise */}
                <div className="mt-5 flex items-center justify-between">
                  <p className="text-[13px] font-medium text-white/55">Mise</p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setStake((s) => Math.max(1, s - 5))}
                      className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white transition-transform duration-150 ease-out active:scale-95"
                      aria-label="Diminuer la mise"
                    >
                      <Minus size={14} strokeWidth={2.4} />
                    </button>
                    <span className="min-w-[76px] rounded-full bg-ink-3 px-4 py-1.5 text-center text-[15px] font-semibold text-white">
                      {stake} €
                    </span>
                    <button
                      onClick={() => setStake((s) => Math.min(500, s + 5))}
                      className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white transition-transform duration-150 ease-out active:scale-95"
                      aria-label="Augmenter la mise"
                    >
                      <Plus size={14} strokeWidth={2.4} />
                    </button>
                  </div>
                </div>

                <div className="mt-2.5 flex gap-2">
                  {STAKES.map((s) => (
                    <button
                      key={s}
                      onClick={() => setStake(s)}
                      className={`flex-1 rounded-[10px] py-1.5 text-[13px] font-semibold transition-colors duration-150 ease-out ${
                        stake === s ? "bg-neon text-black" : "bg-white/8 text-white/70"
                      }`}
                    >
                      {s} €
                    </button>
                  ))}
                </div>

                {/* gain potentiel */}
                <div className="mt-4 flex items-center justify-between rounded-2xl bg-ink-3 px-4 py-3">
                  <span className="text-[12px] font-medium text-white/50">Gain potentiel</span>
                  <span className="text-[18px] font-bold text-neon">
                    {returns != null ? `${returns} €` : "— (pas de cote)"}
                  </span>
                </div>

                <button
                  onClick={place}
                  className="mt-4 flex h-[50px] w-full items-center justify-center gap-2 rounded-[14px] bg-neon text-[15px] font-semibold text-black transition-transform duration-150 ease-out active:scale-[0.98]"
                >
                  <Ticket size={17} strokeWidth={2.4} />
                  Placer le ticket · {stake} €
                </button>
                <p className="mt-2 text-center text-[11px] text-white/35">
                  Simulation — aucun pari réel n&apos;est placé
                </p>
              </>
            ) : (
              <div className="flex flex-col items-center py-6">
                <motion.span
                  initial={{ scale: 0.4, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: "spring", stiffness: 400, damping: 22 }}
                  className="flex h-16 w-16 items-center justify-center rounded-full bg-neon text-black"
                >
                  <Check size={30} strokeWidth={3} />
                </motion.span>
                <h3 className="mt-4 text-[22px] font-bold tracking-[-0.015em] text-white">Enregistré</h3>
                <p className="mt-1 text-[13px] text-white/55">
                  {draft.pick} · {stake} € → {returns != null ? `${returns} €` : "suivi sans cote"}
                </p>
                <p className="mt-3 rounded-full bg-white/8 px-3.5 py-1.5 text-[12px] font-semibold text-neon">
                  Suivi dans le Portefeuille
                </p>
              </div>
            )}
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>
  );
}
