"use client";

/* ============================================================
   VOLTRIX front — Portefeuille
   Tickets enregistrés localement. Règlement via POST
   /api/bankroll/resolve (WIN/LOSE/VOID/PENDING par jambe),
   conseil de vente via POST /api/cashout (valeur juste, edge,
   décision VENDRE/GARDER/ZONE GRISE).
   ============================================================ */

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { HandCoins, RefreshCw, Ticket as TicketIcon, Trash2, Wallet as WalletIcon } from "lucide-react";
import { fetchCashout, getApiBase, moneyFmt, pct, resolveTicketLegs } from "@/lib/voltrix";
import { removeTicket, updateTicket, useTickets, writeWallet, readWallet } from "@/lib/tickets";
import type { CashoutResponse, Ticket } from "@/lib/voltrix-types";
import { TeamBadge } from "./TeamBadge";
import { DemoBadge, ErrorPanel, KpiTile, LoadingPanel, SectionTitle } from "./ui-bits";

/* ---------- Verdict d'un ticket selon ses jambes ---------- */
function ticketVerdict(legs: Array<{ verdict?: string }>): "won" | "lost" | "void" | "pending" {
  const vs = legs.map((l) => l.verdict ?? "PENDING");
  if (vs.some((v) => v === "PENDING")) return "pending";
  if (vs.some((v) => v === "LOSE")) return "lost";
  if (vs.every((v) => v === "VOID")) return "void";
  if (vs.every((v) => v === "WIN" || v === "VOID")) return "won";
  return "pending";
}

const STATUS_STYLE: Record<Ticket["status"], { label: string; cls: string }> = {
  pending: { label: "En cours", cls: "bg-ink-3 text-neon" },
  won: { label: "Gagné", cls: "bg-neon text-black" },
  lost: { label: "Perdu", cls: "bg-[#ff5d5d] text-white" },
  void: { label: "Rendu", cls: "bg-white/20 text-white/70" },
  "cashed-out": { label: "Vendu", cls: "bg-white text-black" },
};

/* ---------- Simulateurs démo (mêmes formes que l'API) ---------- */
function demoResolve(ticket: Ticket): Array<{ matchId: string; market: string; pick: string; verdict: "WIN" | "LOSE" | "VOID" | "PENDING"; score: string | null }> {
  return ticket.legs.map((l) => {
    const r = Math.random();
    const verdict = r > 0.55 ? "WIN" : r > 0.12 ? "LOSE" : "VOID";
    const hs = Math.floor(Math.random() * 4);
    const as = Math.floor(Math.random() * 3);
    return { matchId: l.matchId, market: l.market, pick: l.pick, verdict, score: `${hs}-${as}` };
  });
}

function demoCashout(ticket: Ticket, offered: number): CashoutResponse {
  const p = ticket.legs.reduce((acc, l) => acc * Math.max(0.05, l.prob), 1);
  const fair = ticket.stake * (ticket.totalOdds ?? 2) * p;
  const edge = fair > 0 ? offered / fair - 1 : 0;
  const decision: CashoutResponse["decision"] = edge > 0.06 ? "SELL" : edge < -0.12 ? "HOLD" : "MAYBE";
  return {
    legs: ticket.legs.map((l) => ({
      matchId: l.matchId,
      market: l.market,
      pick: l.pick,
      phase: "pre" as const,
      statusDetail: "",
      score: null,
      verdict: "PENDING",
      pInit: l.prob,
      pNow: l.prob,
      note: "Pas encore commencé — probabilité initiale",
    })),
    jointProb: p,
    fairValue: Math.round(fair * 100) / 100,
    offered,
    edge: Math.round(edge * 1000) / 1000,
    decision,
    message:
      decision === "SELL"
        ? "L'offre dépasse la valeur juste — vendre"
        : decision === "HOLD"
          ? "L'offre est en dessous de la valeur juste — garder"
          : "Zone grise — proche de la valeur juste",
    asOf: Date.now(),
  };
}

/* ---------- Carte ticket ---------- */
function TicketCard({
  ticket,
  onToast,
  refreshKey,
}: {
  ticket: Ticket;
  onToast: (m: string) => void;
  refreshKey: number;
}) {
  const [busy, setBusy] = useState<"resolve" | "cashout" | null>(null);
  const [offered, setOffered] = useState("");
  const [advice, setAdvice] = useState<CashoutResponse | null>(null);
  const [legsState, setLegsState] = useState<Array<{ verdict?: string; score?: string | null }>>(() =>
    ticket.legs.map(() => ({})),
  );
  const isLive = getApiBase().length > 0;

  const pending = ticket.status === "pending";
  const style = STATUS_STYLE[ticket.status];

  const doResolve = async () => {
    setBusy("resolve");
    try {
      let verdicts: Array<{ matchId: string; market: string; pick: string; verdict: string; score: string | null }>;
      if (isLive) {
        const res = await resolveTicketLegs(
          ticket.legs.map((l) => ({
            matchId: l.matchId,
            leagueCode: l.leagueCode,
            matchDate: l.matchDate,
            market: l.market,
            pick: l.pick,
          })),
        );
        verdicts = res.legs.map((l) => ({ ...l, score: l.score ?? null }));
      } else {
        verdicts = demoResolve(ticket);
      }
      setLegsState(verdicts.map((v) => ({ verdict: v.verdict, score: v.score })));
      const v = ticketVerdict(verdicts);
      if (v === "pending") {
        onToast("Ticket toujours en attente — matchs non terminés");
      } else if (v === "won") {
        const payout = ticket.totalOdds != null ? ticket.stake * ticket.totalOdds : ticket.stake;
        updateTicket(ticket.id, { status: "won", payout });
        writeWallet(readWallet() + payout);
        onToast(`Ticket gagné ! +${payout.toFixed(2)} €`);
      } else if (v === "void") {
        updateTicket(ticket.id, { status: "void", payout: ticket.stake });
        writeWallet(readWallet() + ticket.stake);
        onToast("Ticket rendu — mise remboursée");
      } else {
        updateTicket(ticket.id, { status: "lost", payout: 0 });
        onToast("Ticket perdu");
      }
    } catch (e) {
      onToast(e instanceof Error ? e.message : "Règlement impossible");
    } finally {
      setBusy(null);
    }
  };

  const evaluateCashout = async () => {
    const val = Number(offered.replace(",", "."));
    if (!Number.isFinite(val) || val <= 0) {
      onToast("Saisis un montant proposé par le bookmaker");
      return;
    }
    setBusy("cashout");
    try {
      const res = isLive
        ? await fetchCashout({
            legs: ticket.legs.map((l) => ({
              matchId: l.matchId,
              leagueCode: l.leagueCode,
              matchDate: l.matchDate,
              market: l.market,
              pick: l.pick,
              prob: l.prob,
              homeName: l.homeName,
              awayName: l.awayName,
            })),
            stake: ticket.stake,
            offered: val,
            totalOdds: ticket.totalOdds,
          })
        : demoCashout(ticket, val);
      setAdvice(res);
    } catch (e) {
      onToast(e instanceof Error ? e.message : "Évaluation impossible");
    } finally {
      setBusy(null);
    }
  };

  const confirmSell = () => {
    if (!advice) return;
    updateTicket(ticket.id, { status: "cashed-out", payout: advice.offered, cashoutValue: advice.offered });
    writeWallet(readWallet() + advice.offered);
    onToast(`Ticket vendu pour ${advice.offered.toFixed(2)} €`);
  };

  return (
    <article className="rounded-[22px] bg-ink-2 p-3.5 ring-1 ring-white/5">
      {/* en-tête */}
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[8.5px] font-black uppercase tracking-widest text-white/35">
          <TicketIcon size={11} strokeWidth={2.6} />
          {new Date(ticket.createdAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" })} ·{" "}
          {new Date(ticket.createdAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
        </span>
        <span className="flex items-center gap-1.5">
          <span className={`rounded-full px-2.5 py-0.5 text-[8.5px] font-black uppercase tracking-wider ${style.cls}`}>
            {style.label}
          </span>
          <button
            onClick={() => removeTicket(ticket.id)}
            className="flex h-6 w-6 items-center justify-center rounded-full bg-ink-3 text-white/40 transition-colors hover:bg-[#ff5d5d] hover:text-white"
            aria-label="Supprimer le ticket"
          >
            <Trash2 size={11} strokeWidth={2.4} />
          </button>
        </span>
      </div>

      {/* jambes */}
      <div className="mt-2.5 space-y-1.5">
        {ticket.legs.map((l, i) => {
          const st = legsState[i];
          const v = st?.verdict ?? (ticket.status === "won" ? "WIN" : ticket.status === "lost" ? "LOSE" : ticket.status === "void" ? "VOID" : undefined);
          return (
            <div key={`${l.matchId}-${l.market}`} className="rounded-2xl bg-panel p-3 text-black">
              <div className="flex items-center gap-2.5">
                <div className="flex shrink-0 -space-x-1.5">
                  <TeamBadge name={l.homeName} logo={null} size={24} />
                  <TeamBadge name={l.awayName} logo={null} size={24} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11px] font-black">{l.pick}</p>
                  <p className="truncate text-[8.5px] font-bold uppercase tracking-wide text-black/45">
                    {l.homeName} – {l.awayName} · {l.market}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-[13px] font-black leading-none">{l.odds != null ? l.odds.toFixed(2) : "—"}</p>
                  <p className="text-[7.5px] font-bold uppercase tracking-wider text-black/40">cote</p>
                </div>
              </div>
              <div className="mt-1.5 flex items-center justify-between text-[8.5px] font-bold">
                <span className="text-black/50">Proba moteur {pct(l.prob)}{st?.score ? ` · score ${st.score}` : ""}</span>
                {v ? (
                  <span
                    className={`rounded-full px-2 py-0.5 font-black uppercase tracking-wider ${
                      v === "WIN" ? "bg-black text-[#c6f211]" : v === "LOSE" ? "bg-[#ff5d5d] text-white" : v === "VOID" ? "bg-black/10 text-black/60" : "bg-black/5 text-black/50"
                    }`}
                  >
                    {v === "WIN" ? "Gagnée" : v === "LOSE" ? "Perdue" : v === "VOID" ? "Rendue" : "En attente"}
                  </span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      {/* pied : mise / cote / gain */}
      <div className="mt-2.5 grid grid-cols-3 gap-2">
        <KpiTile label="Mise" value={`${ticket.stake} €`} />
        <KpiTile label="Cote" value={ticket.totalOdds != null ? ticket.totalOdds.toFixed(2) : "—"} tone="neon" />
        <KpiTile
          label={ticket.status === "cashed-out" ? "Vendu" : ticket.status === "won" ? "Gain" : "Potentiel"}
          value={ticket.payout != null ? `${ticket.payout.toFixed(2)} €` : ticket.totalOdds != null ? `${(ticket.stake * ticket.totalOdds).toFixed(2)} €` : "—"}
          tone={ticket.status === "lost" ? "bad" : "default"}
        />
      </div>

      {/* actions */}
      {pending ? (
        <div className="mt-3 space-y-2">
          <div className="flex gap-2">
            <button
              onClick={() => void doResolve()}
              disabled={busy != null}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-neon px-3 py-2.5 text-[9.5px] font-black uppercase tracking-wider text-black transition-transform active:scale-95 disabled:opacity-50"
            >
              <RefreshCw size={12} strokeWidth={2.8} className={busy === "resolve" ? "animate-spin" : ""} />
              Résoudre
            </button>
            <div className="flex flex-1 items-center gap-1.5 rounded-full bg-ink-3 px-3 py-1.5">
              <HandCoins size={13} className="shrink-0 text-neon" />
              <input
                value={offered}
                onChange={(e) => setOffered(e.target.value)}
                inputMode="decimal"
                placeholder="Offre €"
                aria-label="Montant proposé pour la vente"
                className="w-full min-w-0 bg-transparent text-[11px] font-black text-white placeholder:text-white/30 focus:outline-none"
              />
              <button
                onClick={() => void evaluateCashout()}
                disabled={busy != null}
                className="shrink-0 rounded-full bg-white px-2.5 py-1 text-[9px] font-black uppercase text-black disabled:opacity-50"
              >
                {busy === "cashout" ? "…" : "Évaluer"}
              </button>
            </div>
          </div>

          <AnimatePresence>
            {advice ? (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="rounded-2xl bg-black/50 p-3 ring-1 ring-white/10">
                  <div className="flex items-center justify-between">
                    <span
                      className={`rounded-full px-2.5 py-1 text-[9.5px] font-black uppercase tracking-wider ${
                        advice.decision === "SELL"
                          ? "bg-neon text-black"
                          : advice.decision === "HOLD"
                            ? "bg-white/15 text-white"
                            : advice.decision === "MAYBE"
                              ? "bg-[#8b5cf6]/30 text-[#c4b5fd]"
                              : "bg-[#ff5d5d]/80 text-white"
                      }`}
                    >
                      {advice.decision === "SELL" ? "Vendre" : advice.decision === "HOLD" ? "Garder" : advice.decision === "MAYBE" ? "Zone grise" : advice.decision === "WON" ? "Déjà gagné" : "Déjà perdu"}
                    </span>
                    <span className="text-[9px] font-bold text-white/45">
                      Valeur juste {advice.fairValue.toFixed(2)} € · edge {(advice.edge >= 0 ? "+" : "") + Math.round(advice.edge * 100)} %
                    </span>
                  </div>
                  <p className="mt-2 text-[10px] font-semibold leading-relaxed text-white/65">{advice.message}</p>
                  <p className="mt-1 text-[8.5px] font-semibold text-white/35">
                    Proba jointe {pct(advice.jointProb, 1)} · jambes :{" "}
                    {advice.legs.map((l) => `${l.pNow != null ? Math.round(l.pNow * 100) : "?"}%`).join(" · ")}
                  </p>
                  {advice.decision === "SELL" ? (
                    <button
                      onClick={confirmSell}
                      className="mt-2.5 w-full rounded-full bg-neon py-2 text-[10px] font-black uppercase tracking-wider text-black"
                    >
                      Vendre maintenant · {advice.offered.toFixed(2)} €
                    </button>
                  ) : null}
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      ) : null}
    </article>
  );
}

/* ---------- Écran ---------- */
export function PortfolioScreen({ apiEpoch, onToast }: { apiEpoch: number; onToast: (m: string) => void }) {
  const { tickets, wallet } = useTickets();
  const refreshKey = apiEpoch;

  const stats = useMemo(() => {
    const staked = tickets.reduce((a, t) => a + t.stake, 0);
    const payout = tickets.reduce((a, t) => a + (t.payout ?? 0), 0);
    return {
      count: tickets.length,
      staked,
      payout,
      roi: staked > 0 ? payout / staked - 1 : null,
      pending: tickets.filter((t) => t.status === "pending").length,
    };
  }, [tickets]);

  return (
    <div className="flex h-full flex-col bg-ink">
      {/* en-tête */}
      <header className="px-5 pt-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.22em] text-white/45">
              Simulation locale {getApiBase().length === 0 ? <DemoBadge /> : null}
            </p>
            <h1 className="font-display text-[30px] leading-none tracking-wide text-white">PORTEFEUILLE</h1>
          </div>
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-ink-3">
            <WalletIcon size={20} className="text-neon" strokeWidth={2.2} />
          </span>
        </div>

        {/* solde */}
        <div className="mt-4 rounded-[26px] bg-neon px-5 py-4 text-black">
          <p className="text-[9px] font-black uppercase tracking-[0.22em] text-black/50">Solde</p>
          <div className="flex items-baseline justify-between">
            <p className="font-display text-[38px] leading-none tracking-wide">{wallet.toFixed(2)} €</p>
            {stats.roi != null ? (
              <span className={`rounded-full bg-black px-3 py-1 text-[10px] font-black ${stats.roi >= 0 ? "text-neon" : "text-[#ff8a8a]"}`}>
                {stats.roi >= 0 ? "+" : ""}
                {(stats.roi * 100).toFixed(1)} % ROI
              </span>
            ) : null}
          </div>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2">
          <KpiTile label="Tickets" value={String(stats.count)} />
          <KpiTile label="En cours" value={String(stats.pending)} tone="neon" />
          <KpiTile label="Rendu" value={moneyFmt(stats.payout)} tone={stats.payout >= stats.staked ? "good" : "default"} />
        </div>
      </header>

      {/* liste */}
      <main className="no-scrollbar mt-4 flex-1 overflow-y-auto px-5 pb-28">
        {tickets.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-14 text-center">
            <span className="text-[32px]">🎟️</span>
            <p className="text-[12px] font-semibold text-white/50">Aucun ticket pour le moment.</p>
            <p className="max-w-[250px] text-[10.5px] leading-relaxed text-white/35">
              Sélectionne un prono sur l&apos;Accueil ou dans un match pour créer ton premier ticket.
            </p>
          </div>
        ) : (
          <>
            <SectionTitle>Tickets</SectionTitle>
            <div className="space-y-3">
              {tickets.map((t) => (
                <TicketCard key={t.id} ticket={t} onToast={onToast} refreshKey={refreshKey} />
              ))}
            </div>
            <p className="mt-5 text-center text-[8.5px] leading-relaxed text-white/25">
              Règlement via /api/bankroll/resolve · vente conseillée via /api/cashout — les tickets vivent
              uniquement dans ce navigateur.
            </p>
          </>
        )}
      </main>
    </div>
  );
}
