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
            transition={{ type: "spring", damping: 28, stiffness: 300 }}
            className="absolute inset-x-0 bottom-0 z-50 rounded-t-[32px] bg-ink-2 px-5 pb-7 pt-3 shadow-[0_-20px_50px_rgba(0,0,0,0.5)]"
          >
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/20" />

            {!placed ? (
              <>
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="font-display text-[22px] tracking-wide text-white">TICKET</h2>
                    <p className="truncate text-[10px] font-semibold uppercase tracking-widest text-white/45">
                      {draft.homeName} vs {draft.awayName}
                    </p>
                  </div>
                  <button
                    onClick={onClose}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink-3 text-white/70 transition-colors hover:bg-neon hover:text-black"
                    aria-label="Fermer"
                  >
                    <X size={15} strokeWidth={2.4} />
                  </button>
                </div>

                {/* sélection */}
                <div className="flex items-center gap-3 rounded-[20px] bg-panel p-3.5 text-black">
                  <div className="flex shrink-0 -space-x-2">
                    <TeamBadge name={draft.homeName} logo={draft.homeLogo} size={30} />
                    <TeamBadge name={draft.awayName} logo={draft.awayLogo} size={30} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-black">{draft.pick}</p>
                    <p className="text-[9px] font-bold uppercase tracking-wider text-black/50">
                      {draft.market} · proba moteur {pct(draft.prob)}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-[17px] font-black leading-none">{draft.odds != null ? draft.odds.toFixed(2) : "—"}</p>
                    <p className="text-[8px] font-bold uppercase tracking-wider text-black/45">cote</p>
                  </div>
                </div>

                {/* mise */}
                <div className="mt-5 flex items-center justify-between">
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-white/45">Mise</p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setStake((s) => Math.max(1, s - 5))}
                      className="flex h-8 w-8 items-center justify-center rounded-full bg-ink-3 text-white transition-colors hover:bg-neon hover:text-black"
                      aria-label="Diminuer la mise"
                    >
                      <Minus size={14} strokeWidth={2.6} />
                    </button>
                    <span className="min-w-[76px] rounded-full bg-ink-3 px-4 py-1.5 text-center text-[15px] font-black text-white">
                      {stake} €
                    </span>
                    <button
                      onClick={() => setStake((s) => Math.min(500, s + 5))}
                      className="flex h-8 w-8 items-center justify-center rounded-full bg-ink-3 text-white transition-colors hover:bg-neon hover:text-black"
                      aria-label="Augmenter la mise"
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
                      {s} €
                    </button>
                  ))}
                </div>

                {/* gain potentiel */}
                <div className="mt-4 flex items-center justify-between rounded-2xl bg-black/40 px-4 py-3 ring-1 ring-white/10">
                  <span className="text-[10.5px] font-bold uppercase tracking-widest text-white/50">Gain potentiel</span>
                  <span className="text-[18px] font-black text-neon">
                    {returns != null ? `${returns} €` : "— (pas de cote)"}
                  </span>
                </div>

                <button
                  onClick={place}
                  className="mt-4 flex h-[52px] w-full items-center justify-center gap-2 rounded-full bg-neon text-[15px] font-black uppercase tracking-wide text-black transition-transform hover:scale-[1.015] active:scale-[0.98]"
                >
                  <Ticket size={17} strokeWidth={2.6} />
                  Placer · {stake} €
                </button>
                <p className="mt-2 text-center text-[8.5px] font-semibold uppercase tracking-widest text-white/30">
                  Simulation — aucun pari réel n&apos;est placé
                </p>
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
                <h3 className="mt-4 font-display text-[24px] tracking-wide text-white">ENREGISTRÉ</h3>
                <p className="mt-1 text-[11.5px] font-semibold text-white/55">
                  {draft.pick} · {stake} € → {returns != null ? `${returns} €` : "suivi sans cote"}
                </p>
                <p className="mt-3 rounded-full bg-ink-3 px-3.5 py-1.5 text-[9.5px] font-bold uppercase tracking-widest text-neon">
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
