"use client";

/* ============================================================
   VOLTRIX app — Suivi des paris (v2.5)
   Le tableau de bord du PARIEUR : registre local (localStorage,
   rien ne quitte l'appareil) des value bets auto ET des paris
   saisis à la main. Résolution automatique par les scores ESPN,
   ROI réel (mises engagées), taux de réussite, Brier du moteur,
   historique complet.
   ============================================================ */

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { ClipboardList, Plus, RefreshCw, Trash2 } from "lucide-react";
import { loadBankroll } from "@/lib/bankroll";
import {
  betsLedgerClear,
  betsLedgerRecent,
  betsLedgerStats,
  recordManualBet,
  resolvePendingBets,
  type BetSlip,
} from "@/lib/foot/bets-ledger";
import { KpiTile, SectionTitle, Segmented } from "./ui-bits";

type Filter = "all" | "pending" | "resolved";

const fmtMoney = (n: number, currency: string) =>
  `${Math.round(n).toLocaleString("fr-FR")} ${currency}`.trim();

const fmtPct = (n: number | null) => (n == null ? "—" : `${(n * 100).toFixed(1)} %`);

export function BetsScreen({ headerSlot }: { headerSlot?: React.ReactNode }) {
  const [slips, setSlips] = useState<BetSlip[]>([]);
  const [resolving, setResolving] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [manualOpen, setManualOpen] = useState(false);
  const currency = useMemo(() => loadBankroll().currency, []);

  const reload = useCallback(() => {
    setSlips(betsLedgerRecent(80));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  /* auto-résolution à l'ouverture : les matchs terminés depuis > 3 h
     sont réglés par les scores ESPN (cache partagé — peu coûteux) */
  const resolveNow = useCallback(async () => {
    if (resolving) return;
    setResolving(true);
    try {
      await resolvePendingBets();
      reload();
    } finally {
      setResolving(false);
    }
  }, [resolving, reload]);

  useEffect(() => {
    void resolveNow();
     
  }, []);

  const stats = useMemo(() => betsLedgerStats(), [slips]);
  const visible = useMemo(
    () =>
      filter === "all"
        ? slips
        : slips.filter((s) =>
            filter === "pending" ? s.status === "pending" : s.status === "won" || s.status === "lost",
          ),
    [slips, filter],
  );

  return (
    <div className="flex h-full flex-col bg-ink">
      {/* en-tête */}
      <header className="flex items-center justify-between px-5 pt-6">
        <div className="flex items-center gap-3">
          {headerSlot}
          <div>
            <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.22em] text-white/45">
              <ClipboardList size={11} strokeWidth={2.6} />
              registre local
            </p>
            <h1 className="font-display text-[30px] leading-none tracking-wide text-white">SUIVI</h1>
          </div>
        </div>
        <button
          onClick={() => void resolveNow()}
          disabled={resolving}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-ink-3 text-white transition-colors hover:bg-neon hover:text-black"
          aria-label="Résoudre les paris en attente"
        >
          <RefreshCw size={15} strokeWidth={2.2} className={resolving ? "animate-spin" : ""} />
        </button>
      </header>

      <main className="no-scrollbar mt-5 flex-1 overflow-y-auto px-5 pb-28">
        {/* KPI parieur */}
        <SectionTitle>Performance réelle</SectionTitle>
        <div className="grid grid-cols-2 gap-2">
          <KpiTile
            label="ROI (mises réelles)"
            value={fmtPct(stats.roi)}
            tone={stats.roi != null && stats.roi > 0 ? "good" : stats.roi != null ? "bad" : "default"}
          />
          <KpiTile label="Taux de réussite" value={fmtPct(stats.hitRate)} tone="neon" />
          <KpiTile label="Profit net" value={fmtMoney(stats.profit, currency)} tone={stats.profit > 0 ? "good" : stats.profit < 0 ? "bad" : "default"} />
          <KpiTile label="Engagé (résolus)" value={fmtMoney(stats.staked, currency)} />
          <KpiTile label="Paris gagnés" value={`${stats.won}/${stats.resolved}`} />
          <KpiTile label="En attente" value={`${stats.pending}`} />
        </div>
        {stats.resolved > 0 ? (
          <p className="mt-2 text-[10px] leading-relaxed text-white/30">
            Brier du moteur sur vos paris résolus : {stats.brier?.toFixed(3) ?? "—"} (plus petit = mieux) · cote
            moyenne {stats.avgOdds?.toFixed(2) ?? "—"} · les mises inconnues comptent pour 1 unité.
          </p>
        ) : (
          <p className="mt-2 text-[10.5px] leading-relaxed text-white/35">
            Aucun pari résolu pour l&apos;instant : les value bets consultés s&apos;enregistrent automatiquement, ou
            ajoutez vos paris ci-dessous. Les résultats tombent dès la fin des matchs.
          </p>
        )}

        {/* saisie manuelle */}
        <SectionTitle
          right={
            <button
              onClick={() => setManualOpen((v) => !v)}
              className="flex items-center gap-1.5 rounded-full bg-neon px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-black transition-transform active:scale-95"
            >
              <Plus size={11} strokeWidth={2.8} />
              Pari
            </button>
          }
        >
          Vos paris
        </SectionTitle>
        {manualOpen ? <ManualBetForm onDone={() => { setManualOpen(false); reload(); }} /> : null}

        {/* historique */}
        <div className="mt-1">
          <Segmented<Filter>
            options={[
              { id: "all", label: `Tous ${slips.length}` },
              { id: "pending", label: `En attente ${stats.pending}` },
              { id: "resolved", label: `Résolus ${stats.resolved}` },
            ]}
            value={filter}
            onChange={setFilter}
          />
        </div>

        <div className="mt-2.5 space-y-1.5">
          {visible.length === 0 ? (
            <p className="rounded-2xl bg-ink-2 px-4 py-5 text-center text-[10.5px] font-semibold text-white/35">
              {filter === "all" ? "Registre vide — consultez une fiche match pour enregistrer ses value bets." : "Aucun pari dans ce filtre."}
            </p>
          ) : (
            visible.map((s) => <SlipRow key={s.id} slip={s} currency={currency} />)
          )}
        </div>

        {slips.length > 0 ? (
          <button
            onClick={() => {
              betsLedgerClear();
              reload();
            }}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-full bg-ink-3 px-4 py-2.5 text-[10px] font-black uppercase tracking-wider text-white/60 transition-colors hover:text-[#ff5d5d]"
          >
            <Trash2 size={12} strokeWidth={2.6} />
            Vider le registre
          </button>
        ) : null}
      </main>
    </div>
  );
}

/* ---------- Ligne d'un pari ---------- */
function SlipRow({ slip, currency }: { slip: BetSlip; currency: string }) {
  const stake = slip.stake ?? 1;
  const color =
    slip.status === "won" ? "text-neon" : slip.status === "lost" ? "text-[#ff5d5d]" : slip.status === "void" ? "text-white/30" : "text-white/55";
  const statusLabel =
    slip.status === "won" ? "gagné" : slip.status === "lost" ? "perdu" : slip.status === "void" ? "annulé" : "en jeu";
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl bg-ink-2 px-3.5 py-2.5 ring-1 ring-white/5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[11px] font-black text-white/85">
          {slip.pick}
          <span className="ml-1.5 text-[9.5px] font-bold uppercase tracking-wider text-white/35">
            @{slip.odds.toFixed(2)}
            {slip.manual ? " · manuel" : ""}
          </span>
        </p>
        <p className="mt-0.5 truncate text-[10px] font-semibold text-white/40">
          {slip.homeName} – {slip.awayName}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className={`text-[10.5px] font-black uppercase tracking-wide ${color}`}>{statusLabel}</p>
        {slip.status === "won" || slip.status === "lost" ? (
          <p className={`text-[10px] font-bold ${slip.profit != null && slip.profit > 0 ? "text-neon" : slip.profit != null && slip.profit < 0 ? "text-[#ff5d5d]" : "text-white/35"}`}>
            {slip.profit != null ? `${slip.profit > 0 ? "+" : ""}${Math.round(slip.profit).toLocaleString("fr-FR")} ${currency}` : "—"}
            <span className="ml-1 text-white/30">/ {Math.round(stake).toLocaleString("fr-FR")}</span>
          </p>
        ) : null}
      </div>
    </div>
  );
}

/* ---------- Formulaire de saisie manuelle ---------- */
function ManualBetForm({ onDone }: { onDone: () => void }) {
  const [match, setMatch] = useState({ home: "", away: "", leagueCode: "eng.1" });
  const [market, setMarket] = useState<"1X2:H" | "1X2:D" | "1X2:A" | "DC:1X" | "DC:12" | "DC:X2" | "BTTS:Y" | "BTTS:N" | "OU:O:2.5" | "OU:U:2.5">("1X2:H");
  const [odds, setOdds] = useState("1.85");
  const [stake, setStake] = useState("1000");
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = useCallback(() => {
    const o = Number(odds.replace(",", "."));
    const st = Number(stake.replace(",", "."));
    if (!(o > 1) || !(st > 0)) {
      setErr("Cote > 1 et mise > 0 obligatoires.");
      return;
    }
    if (!match.home.trim() || !match.away.trim()) {
      setErr("Renseignez les deux équipes.");
      return;
    }
    /* Les paris manuels sans match ESPN suivi sont rattachés à un id
       synthétique : pas de résolution auto, statut réglable à la main
       via le profit réel après coup (champ profitReal). Ici on stocke
       en attente — la ligne d'historique garde le détail. */
    recordManualBet({
      matchId: `manual-${Date.now()}`,
      leagueCode: match.leagueCode || "eng.1",
      matchDate: new Date().toISOString(),
      homeName: match.home.trim(),
      awayName: match.away.trim(),
      market: market.startsWith("OU") ? "Total buts 2.5" : market.startsWith("DC") ? "Double chance" : market.startsWith("BTTS") ? "Deux équipes marquent" : "1X2",
      pick: marketLabel(market, match.home.trim(), match.away.trim()),
      code: market,
      odds: o,
      stake: st,
    });
    setErr(null);
    setSaved(true);
    setTimeout(() => onDone(), 900);
  }, [odds, stake, match, market, onDone]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="mb-3 rounded-[26px] bg-ink-2 p-4 ring-1 ring-white/5"
    >
      <div className="grid grid-cols-2 gap-2">
        <input
          type="text"
          placeholder="Équipe domicile"
          value={match.home}
          onChange={(e) => setMatch((m) => ({ ...m, home: e.target.value }))}
          className="rounded-xl bg-black/40 px-3 py-2.5 text-[12px] font-bold text-white outline-none ring-1 ring-white/10 focus:ring-neon/60"
        />
        <input
          type="text"
          placeholder="Équipe extérieure"
          value={match.away}
          onChange={(e) => setMatch((m) => ({ ...m, away: e.target.value }))}
          className="rounded-xl bg-black/40 px-3 py-2.5 text-[12px] font-bold text-white outline-none ring-1 ring-white/10 focus:ring-neon/60"
        />
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2">
        <select
          value={market}
          onChange={(e) => setMarket(e.target.value as typeof market)}
          aria-label="Marché"
          className="rounded-xl bg-black/40 px-2.5 py-2.5 text-[11px] font-black text-white outline-none ring-1 ring-white/10 focus:ring-neon/60"
        >
          <option value="1X2:H">1 · domicile</option>
          <option value="1X2:D">X · nul</option>
          <option value="1X2:A">2 · extérieur</option>
          <option value="DC:1X">DC 1X</option>
          <option value="DC:12">DC 12</option>
          <option value="DC:X2">DC X2</option>
          <option value="BTTS:Y">BTTS oui</option>
          <option value="BTTS:N">BTTS non</option>
          <option value="OU:O:2.5">Over 2.5</option>
          <option value="OU:U:2.5">Under 2.5</option>
        </select>
        <input
          type="text"
          inputMode="decimal"
          placeholder="Cote"
          value={odds}
          onChange={(e) => setOdds(e.target.value)}
          aria-label="Cote"
          className="rounded-xl bg-black/40 px-3 py-2.5 text-right text-[12px] font-black text-white outline-none ring-1 ring-white/10 focus:ring-neon/60"
        />
        <input
          type="text"
          inputMode="decimal"
          placeholder="Mise"
          value={stake}
          onChange={(e) => setStake(e.target.value)}
          aria-label="Mise"
          className="rounded-xl bg-black/40 px-3 py-2.5 text-right text-[12px] font-black text-white outline-none ring-1 ring-white/10 focus:ring-neon/60"
        />
      </div>
      {err ? <p className="mt-2 text-[10px] font-bold text-[#ff5d5d]">{err}</p> : null}
      <button
        onClick={submit}
        disabled={saved}
        className="mt-2.5 flex w-full items-center justify-center gap-2 rounded-full bg-neon px-4 py-2.5 text-[10px] font-black uppercase tracking-wider text-black transition-transform active:scale-[0.98] disabled:opacity-60"
      >
        {saved ? "Pari enregistré" : "Enregistrer le pari"}
      </button>
      <p className="mt-2 text-[9.5px] leading-relaxed text-white/30">
        Les paris rattachés à un match suivi par l&apos;app se règlent tout seuls au coup de sifflet final.
      </p>
    </motion.div>
  );
}

function marketLabel(code: string, home: string, away: string): string {
  switch (code) {
    case "1X2:H": return `Victoire ${home}`;
    case "1X2:D": return "Match nul";
    case "1X2:A": return `Victoire ${away}`;
    case "DC:1X": return `1X — ${home} ou nul`;
    case "DC:12": return "12 — pas de nul";
    case "DC:X2": return `X2 — ${away} ou nul`;
    case "BTTS:Y": return "Deux équipes marquent — Oui";
    case "BTTS:N": return "Deux équipes marquent — Non";
    case "OU:O:2.5": return "Plus de 2.5 buts";
    case "OU:U:2.5": return "Moins de 2.5 buts";
    default: return code;
  }
}
