"use client";

/* ============================================================
   VOLTRIX front — Détail match
   GET /api/match/{id}?league=&date= → MatchDetailDTO complet :
   probabilités calibrées (blend), composantes Poisson/Elo/Forme,
   échelle O/U, BTTS, value bets (edge/Kelly), scores exacts,
   premier but, H2H base, contexte (derby, enjeux, météo, blessures).
   Onglet Compos : GET /api/match/{id}/lineups.
   ============================================================ */

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { ChevronLeft, Loader2, RefreshCw, Ticket, TrendingUp, Umbrella } from "lucide-react";
import {
  fetchLineups,
  fetchMatchDetail,
  getApiBase,
  moneyFmt,
  oddsFmt,
  pct,
  timeLabel,
} from "@/lib/voltrix";
import { demoLineups, demoMatchDetail } from "@/lib/demo-data";
import type {
  MatchDetailDTO,
  PlayerLineupsDTO,
  TeamAnalysisDTO,
  TeamLineupsDTO,
} from "@/lib/voltrix-types";
import type { LightMatch } from "@/lib/voltrix-types";
import { TeamBadge } from "./TeamBadge";
import {
  CalibrationRow,
  ConfidenceChip,
  DemoBadge,
  EdgeChip,
  ErrorPanel,
  FormDots,
  LoadingPanel,
  ProbBar,
  SectionTitle,
  confidenceStars,
  eurCompact,
} from "./ui-bits";
import type { SelectionDraft } from "./VoltrixApp";

type TabId = "analyse" | "marches" | "h2h" | "contexte" | "compos";

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "analyse", label: "Analyse" },
  { id: "marches", label: "Marchés" },
  { id: "h2h", label: "H2H" },
  { id: "contexte", label: "Contexte" },
  { id: "compos", label: "Compos" },
];

/* ---------- Pilule de probabilité (1X2) ---------- */
function ProbPill({
  value,
  label,
  odds,
  featured,
  selected,
  onSelect,
}: {
  value: number;
  label: string;
  odds?: number | null;
  featured: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const height = Math.round(56 + value * 44);
  return (
    <button
      onClick={onSelect}
      aria-pressed={selected}
      style={{ height }}
      className={`flex w-[88px] flex-col items-center justify-center rounded-[22px] transition-all duration-200 ${
        selected
          ? "bg-black text-neon ring-2 ring-black shadow-[0_12px_24px_rgba(0,0,0,0.3)] scale-[1.05]"
          : featured
            ? "bg-white text-black ring-1 ring-black/15 shadow-[0_8px_18px_rgba(0,0,0,0.22)]"
            : "bg-ink-3 text-white"
      }`}
    >
      <span className="text-[20px] font-black leading-none">{Math.round(value * 100)}%</span>
      <span className={`mt-1 max-w-[80px] truncate text-[8.5px] font-bold uppercase tracking-widest ${selected ? "text-white/60" : featured ? "text-black/55" : "text-white/50"}`}>
        {label}
      </span>
      {odds != null ? (
        <span className={`mt-0.5 text-[9.5px] font-bold ${selected ? "text-neon" : featured ? "text-black/60" : "text-white/45"}`}>
          {odds.toFixed(2)}
        </span>
      ) : null}
    </button>
  );
}

/* ---------- Bloc composante moteur ---------- */
function ComponentRow({ name, probs, note }: { name: string; probs: { home: number; draw: number; away: number }; note?: string }) {
  return (
    <div className="rounded-2xl bg-ink-3 px-3.5 py-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-black uppercase tracking-widest text-white/70">{name}</span>
        {note ? <span className="text-[9px] font-semibold text-white/35">{note}</span> : null}
      </div>
      <div className="mt-2 grid grid-cols-3 gap-1.5">
        <ProbBar label="1" value={probs.home} compact />
        <ProbBar label="X" value={probs.draw} compact />
        <ProbBar label="2" value={probs.away} compact />
      </div>
    </div>
  );
}

/* ---------- Terrain (Compos) ---------- */
function Pitch({ team }: { team: TeamLineupsDTO }) {
  const rows: Record<string, PlayerLineupsDTO[]> = { G: [], D: [], M: [], F: [] };
  team.starters.forEach((p) => {
    const k = p.position ?? "M";
    if (!rows[k]) rows[k] = [];
    rows[k].push(p);
  });
  const order = ["F", "M", "D", "G"];
  return (
    <div className="rounded-3xl bg-pitch p-3 ring-1 ring-white/10">
      <div className="relative flex aspect-[3/4] w-full flex-col justify-between rounded-2xl border-2 border-pitch-line bg-[linear-gradient(rgba(255,255,255,0.045)_1px,transparent_1px)] bg-[length:100%_12.5%]">
        {/* lignes du terrain */}
        <div className="absolute inset-x-0 top-1/2 h-[2px] bg-pitch-line" />
        <div className="absolute left-1/2 top-1/2 h-14 w-14 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-pitch-line" />
        <div className="absolute inset-x-[22%] top-0 h-10 border-x-2 border-b-2 border-pitch-line" />
        <div className="absolute inset-x-[22%] bottom-0 h-10 border-x-2 border-t-2 border-pitch-line" />

        {order.map((k) => {
          const players = rows[k];
          if (players.length === 0) return null;
          return (
            <div key={k} className="relative z-10 flex items-start justify-center gap-1 px-2">
              {players.map((p) => (
                <div key={p.athleteId} className="flex w-[52px] flex-col items-center">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-neon text-[11px] font-black text-black ring-2 ring-black/30">
                    {p.jersey ?? "?"}
                  </span>
                  <span className="mt-1 max-w-full truncate rounded bg-black/60 px-1 py-[1px] text-[7.5px] font-bold uppercase tracking-wide text-white/85">
                    {p.shortName ?? p.name}
                  </span>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- Écran ---------- */
export function MatchScreen({
  matchId,
  leagueCode,
  date,
  light,
  onBack,
  onTicket,
}: {
  matchId: string;
  leagueCode: string;
  date: string;
  light?: LightMatch;
  onBack: () => void;
  onTicket: (draft: SelectionDraft) => void;
}) {
  const [detail, setDetail] = useState<MatchDetailDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>("analyse");
  const [selected, setSelected] = useState<"home" | "draw" | "away" | null>(null);
  const [lineups, setLineups] = useState<Awaited<ReturnType<typeof loadLineups>>>(null);
  const [lineupsLoading, setLineupsLoading] = useState(false);
  const isLive = getApiBase().length > 0;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = isLive ? await fetchMatchDetail(matchId, leagueCode, date) : demoMatchDetail(matchId);
      setDetail(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analyse indisponible");
    } finally {
      setLoading(false);
    }
  }, [matchId, leagueCode, date, isLive]);

  useEffect(() => {
    void load();
  }, [load]);

  async function loadLineups(): Promise<ReturnType<typeof demoLineups> | null> {
    if (isLive) return fetchLineups(matchId, leagueCode);
    return demoLineups(matchId);
  }

  useEffect(() => {
    if (tab !== "compos" || lineups || lineupsLoading) return;
    let cancelled = false;
    setLineupsLoading(true);
    loadLineups()
      .then((r) => {
        if (!cancelled) setLineups(r);
      })
      .catch(() => {
        if (!cancelled) setLineups(null);
      })
      .finally(() => {
        if (!cancelled) setLineupsLoading(false);
      });
    return () => {
      cancelled = true;
    };
     
  }, [tab]);

  /* Onglet Compos : équipe affichée */
  const [composSide, setComposSide] = useState<"home" | "away">("home");

  const pred = detail?.prediction;
  const bestPick = useMemo(() => pred?.recommendedBets[0] ?? null, [pred]);

  const probsToPills = useMemo(() => {
    if (!pred) return [];
    return [
      { id: "home" as const, value: pred.probs.home, label: (light?.home.shortName ?? detail?.home.name ?? "Domicile").slice(0, 10), odds: light?.mlHome ?? detail?.odds?.moneyline.home.close ?? null, featured: pred.probs.home >= Math.max(pred.probs.draw, pred.probs.away) },
      { id: "draw" as const, value: pred.probs.draw, label: "NUL", odds: light?.mlDraw ?? detail?.odds?.moneyline.draw.close ?? null, featured: pred.probs.home < Math.max(pred.probs.draw, pred.probs.away) && pred.probs.draw >= pred.probs.away },
      { id: "away" as const, value: pred.probs.away, label: (light?.away.shortName ?? detail?.away.name ?? "Extérieur").slice(0, 10), odds: light?.mlAway ?? detail?.odds?.moneyline.away.close ?? null, featured: pred.probs.away > Math.max(pred.probs.draw, pred.probs.home) },
    ];
  }, [pred, light, detail]);

  const openTicketFor = (id: "home" | "draw" | "away") => {
    if (!detail || !pred) return;
    const pick1x2 =
      id === "home" ? `1 - ${detail.home.name}` : id === "away" ? `2 - ${detail.away.name}` : "Match nul";
    onTicket({
      matchId,
      leagueCode,
      matchDate: detail.matchDate,
      market: "1X2",
      pick: pick1x2,
      prob: id === "home" ? pred.probs.home : id === "away" ? pred.probs.away : pred.probs.draw,
      odds:
        id === "home"
          ? light?.mlHome ?? detail.odds?.moneyline.home.close ?? null
          : id === "away"
            ? light?.mlAway ?? detail.odds?.moneyline.away.close ?? null
            : light?.mlDraw ?? detail.odds?.moneyline.draw.close ?? null,
      homeName: detail.home.name,
      awayName: detail.away.name,
      homeLogo: light?.home.logo ?? null,
      awayLogo: light?.away.logo ?? null,
    });
  };

  const openTicketMarket = (market: string, pick: string, prob: number, odds: number | null) => {
    if (!detail) return;
    onTicket({
      matchId,
      leagueCode,
      matchDate: detail.matchDate,
      market,
      pick,
      prob,
      odds,
      homeName: detail.home.name,
      awayName: detail.away.name,
      homeLogo: light?.home.logo ?? null,
      awayLogo: light?.away.logo ?? null,
    });
  };

  const live = detail?.status === "in" || light?.status === "in";
  const hasScore = detail && detail.homeScore != null && detail.awayScore != null;

  const teamBlock = (t: TeamAnalysisDTO, side: "home" | "away") => (
    <div className="rounded-2xl bg-ink-3 p-3.5">
      <div className="flex items-center gap-2.5">
        <TeamBadge name={t.name} logo={t.logo} size={38} />
        <div className="min-w-0">
          <p className="truncate text-[12px] font-black uppercase tracking-wide text-white">{t.name}</p>
          <p className="text-[9.5px] font-bold text-white/40">
            Elo {t.elo} {t.rank ? `· ${t.rank}e` : ""} {t.points ? `· ${t.points} pts` : ""}
          </p>
        </div>
      </div>
      <div className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[9.5px]">
        {[
          ["Forme", `${Math.round(t.formScore * 100)}/100`],
          ["Buts/match", t.goalsForPerMatch.toFixed(2)],
          ["Encaissés/match", t.goalsAgainstPerMatch.toFixed(2)],
          ["Clean sheets", `${t.cleanSheetsPct}%`],
          ["Sans marquer", `${t.failedToScorePct}%`],
          ["Blessés (clés)", `${t.injuriesCount} (${t.injuriesKey})`],
          ["Matchs/14 j", String(t.matchesLast14Days)],
          ["Dernier match", t.fatigueDaysSinceLast != null ? `il y a ${t.fatigueDaysSinceLast} j` : "—"],
        ].map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-1 border-b border-white/5 pb-1">
            <span className="text-white/40">{k}</span>
            <span className="font-bold text-white/85">{v}</span>
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between">
        <span className="text-[8.5px] font-bold uppercase tracking-widest text-white/35">Forme</span>
        <FormDots form={t.form.map((f) => f.result).join("")} />
      </div>
      {side === "home" ? null : null}
    </div>
  );

  return (
    <div className="flex h-full flex-col bg-ink">
      {/* barre supérieure */}
      <header className="flex items-center justify-between px-5 pt-6">
        <button
          onClick={onBack}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-ink-3 text-white transition-colors hover:bg-neon hover:text-black"
          aria-label="Retour"
        >
          <ChevronLeft size={18} strokeWidth={2.4} />
        </button>
        <div className="flex items-center gap-2">
          <span className="max-w-[180px] truncate text-[10px] font-black uppercase tracking-widest text-white/55">
            {detail?.leagueName ?? light?.leagueName ?? leagueCode}
          </span>
          {live ? (
            <span className="flex items-center gap-1 rounded-full bg-neon px-2.5 py-1 text-[9px] font-black uppercase text-black">
              <span className="live-dot h-1.5 w-1.5 rounded-full bg-black" />
              Live
            </span>
          ) : (
            <span className="rounded-full bg-ink-3 px-2.5 py-1 text-[9px] font-black uppercase tracking-wide text-white/70">
              {detail?.status === "post" ? "Terminé" : "À venir"}
            </span>
          )}
        </div>
        <button
          onClick={() => void load()}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-ink-3 text-white transition-colors hover:bg-neon hover:text-black"
          aria-label="Réanalyser"
        >
          <RefreshCw size={15} strokeWidth={2.2} className={loading ? "animate-spin" : ""} />
        </button>
      </header>

      {/* en-tête score */}
      <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center px-6">
        <div className="flex flex-col items-center gap-2">
          <TeamBadge name={detail?.home.name ?? light?.home.name ?? "?"} logo={light?.home.logo ?? detail?.home.logo ?? null} size={58} />
          <span className="max-w-[104px] text-center text-[8.5px] font-extrabold leading-[1.3] tracking-wide text-white">
            {(detail?.home.name ?? light?.home.name ?? "").toUpperCase()}
          </span>
        </div>
        <div className="mx-3 px-2 text-center">
          <span className="font-display text-[40px] leading-none tracking-wide text-white">
            {hasScore ? `${detail!.homeScore}:${detail!.awayScore}` : "VS"}
          </span>
          <span className="mt-1.5 block text-[8.5px] font-semibold uppercase tracking-widest text-white/40">
            {detail ? timeLabel(detail.matchDate) : light ? timeLabel(light.date) : ""} {detail?.statusDetail ? `· ${detail.statusDetail}` : ""}
          </span>
        </div>
        <div className="flex flex-col items-center gap-2">
          <TeamBadge name={detail?.away.name ?? light?.away.name ?? "?"} logo={light?.away.logo ?? detail?.away.logo ?? null} size={58} />
          <span className="max-w-[104px] text-center text-[8.5px] font-extrabold leading-[1.3] tracking-wide text-white">
            {(detail?.away.name ?? light?.away.name ?? "").toUpperCase()}
          </span>
        </div>
      </div>

      {/* contenu */}
      {loading ? (
        <LoadingPanel label="Le moteur VOLTRIX analyse le match…" />
      ) : error || !detail || !pred ? (
        <ErrorPanel message={error ?? "Analyse indisponible"} onRetry={() => void load()} isDemo={!isLive} />
      ) : (
        <main className="no-scrollbar mt-4 flex-1 overflow-y-auto px-5 pb-32">
          {/* panneau lime : prono du moteur */}
          <div className="rounded-t-[30px] bg-neon px-5 pb-5 pt-4 text-black">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-[9px] font-black uppercase tracking-[0.2em] text-black/50">Prono du moteur</p>
                <p className="mt-0.5 font-display text-[24px] leading-tight tracking-wide text-black">
                  {bestPick ? bestPick.pick.toUpperCase() : "—"}
                </p>
                {bestPick ? (
                  <p className="text-[10px] font-bold text-black/60">
                    {pct(bestPick.prob)} {bestPick.market}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-col items-end gap-1.5">
                <span className="rounded-full bg-black px-2.5 py-1 text-[9px] font-black uppercase tracking-wider text-neon">
                  λ {pred.lambda.total.toFixed(2)} buts
                </span>
                <span className="rounded-full bg-black/85 px-2.5 py-1 text-[9px] font-black uppercase tracking-wider text-white">
                  {confidenceStars(pred.confidence)} {pred.confidenceLabel}
                </span>
              </div>
            </div>

            {/* pilules 1X2 sélectionnables */}
            <div className="mt-4 flex items-end justify-center gap-3">
              {probsToPills.map((p) => (
                <ProbPill
                  key={p.id}
                  value={p.value}
                  label={p.label}
                  odds={p.odds}
                  featured={p.featured}
                  selected={selected === p.id}
                  onSelect={() => {
                    setSelected(p.id);
                    openTicketFor(p.id);
                  }}
                />
              ))}
            </div>
          </div>

          {/* onglets */}
          <div className="no-scrollbar sticky top-0 z-20 -mx-5 mt-4 flex gap-1.5 overflow-x-auto bg-ink/95 px-5 py-2 backdrop-blur">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                aria-pressed={tab === t.id}
                className={`whitespace-nowrap rounded-full px-3.5 py-1.5 text-[10px] font-black uppercase tracking-wide transition-colors ${
                  tab === t.id ? "bg-neon text-black" : "bg-ink-3 text-white/60 hover:text-white"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <motion.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22 }}>
            {/* ---------------- ANALYSE ---------------- */}
            {tab === "analyse" ? (
              <div>
                <SectionTitle>Composantes du moteur</SectionTitle>
                <div className="space-y-2.5">
                  <ComponentRow name="VOLTRIX (final)" probs={pred.probs} note="calibré" />
                  <ComponentRow name="Poisson" probs={pred.poisson} note="buts attendus" />
                  <ComponentRow name="Elo" probs={pred.elo} note="force relative" />
                  <ComponentRow name="Forme" probs={pred.form} note="5 derniers" />
                </div>

                <SectionTitle>Buts attendus (λ)</SectionTitle>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { k: detail.home.name, v: pred.lambda.home },
                    { k: "Total", v: pred.lambda.total },
                    { k: detail.away.name, v: pred.lambda.away },
                  ].map((x) => (
                    <div key={x.k} className="rounded-2xl bg-ink-3 px-2 py-2.5 text-center">
                      <p className="truncate text-[8.5px] font-bold uppercase tracking-wider text-white/40">{x.k}</p>
                      <p className="mt-1 text-[17px] font-black text-neon">{x.v.toFixed(2)}</p>
                    </div>
                  ))}
                </div>

                <SectionTitle>Scores exacts les plus probables</SectionTitle>
                <div className="space-y-1.5">
                  {pred.topScores.slice(0, 5).map((s) => (
                    <div key={s.score} className="flex items-center gap-3 rounded-2xl bg-ink-3 px-3.5 py-2">
                      <span className="w-10 text-center font-display text-[16px] tracking-wide text-white">{s.score}</span>
                      <div className="h-[6px] flex-1 overflow-hidden rounded-full bg-black/50">
                        <div className="h-full rounded-full bg-neon" style={{ width: `${Math.min(100, s.prob * 500)}%` }} />
                      </div>
                      <span className="w-11 text-right text-[11px] font-black text-white/80">{pct(s.prob, 1)}</span>
                    </div>
                  ))}
                </div>

                <SectionTitle>Premier but</SectionTitle>
                <div className="space-y-1.5">
                  {pred.firstGoalTiming.map((w) => (
                    <div key={w.window} className="flex items-center gap-3 rounded-2xl bg-ink-3 px-3.5 py-2">
                      <span className="w-[110px] text-[9.5px] font-bold text-white/60">{w.label}</span>
                      <div className="h-[6px] flex-1 overflow-hidden rounded-full bg-black/50">
                        <div className="h-full rounded-full bg-white/70" style={{ width: `${Math.min(100, w.prob * 300)}%` }} />
                      </div>
                      <span className="w-11 text-right text-[11px] font-black text-white/80">{pct(w.prob, 1)}</span>
                    </div>
                  ))}
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    {[
                      { k: detail.home.name, v: pred.firstToScore.home },
                      { k: "Aucun but", v: pred.firstToScore.noGoal },
                      { k: detail.away.name, v: pred.firstToScore.away },
                    ].map((x) => (
                      <div key={x.k} className="rounded-2xl bg-ink-3 px-2 py-2 text-center">
                        <p className="truncate text-[8.5px] font-bold uppercase tracking-wider text-white/40">{x.k}</p>
                        <p className="mt-1 text-[14px] font-black text-white">{pct(x.v)}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}

            {/* ---------------- MARCHÉS ---------------- */}
            {tab === "marches" ? (
              <div>
                <SectionTitle>Plus/Moins — échelle du moteur</SectionTitle>
                <div className="space-y-2">
                  {pred.overUnder.map((ou) => {
                    const oddsOver = detail.odds?.total.over.line === ou.line ? detail.odds.total.over.closeOdds : null;
                    const oddsUnder = detail.odds?.total.under.line === ou.line ? detail.odds.total.under.closeOdds : null;
                    return (
                      <div key={ou.line} className="rounded-2xl bg-ink-3 px-3.5 py-2.5">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-black text-white">Ligne {ou.line.toFixed(1)}</span>
                          {ou.line === 2.5 ? (
                            <button
                              onClick={() => openTicketMarket("O/U 2.5", ou.over >= 0.5 ? "Plus de 2.5" : "Moins de 2.5", Math.max(ou.over, ou.under), ou.over >= 0.5 ? oddsOver : oddsUnder)}
                              className="rounded-full bg-neon px-2.5 py-1 text-[8.5px] font-black uppercase tracking-wider text-black"
                            >
                              Prendre le prono
                            </button>
                          ) : null}
                        </div>
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          <ProbBar label={`Over ${oddsOver ? oddsFmt(oddsOver) : ""}`} value={ou.over} compact />
                          <ProbBar label={`Under ${oddsUnder ? oddsFmt(oddsUnder) : ""}`} value={ou.under} compact />
                        </div>
                      </div>
                    );
                  })}
                </div>

                <SectionTitle>Les deux équipes marquent</SectionTitle>
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => openTicketMarket("BTTS", "Oui", pred.btts.yes, null)} className="text-left">
                    <ProbBar label="BTTS Oui" value={pred.btts.yes} />
                  </button>
                  <button onClick={() => openTicketMarket("BTTS", "Non", pred.btts.no, null)} className="text-left">
                    <ProbBar label="BTTS Non" value={pred.btts.no} />
                  </button>
                </div>
                {pred.raw ? (
                  <p className="mt-2 text-[9px] leading-relaxed text-white/35">
                    Probabilités brutes (pré-calibrage marché) : Over {pct(pred.raw.overUnder[0]?.over, 1)} · BTTS Oui {pct(pred.raw.btts.yes, 1)}. La calibration marché s&apos;applique aux totals.
                  </p>
                ) : null}

                <SectionTitle right={pred.valueBets.length ? <span className="rounded-full bg-neon px-2 py-0.5 text-[8.5px] font-black uppercase text-black">{pred.valueBets.length} value</span> : undefined}>
                  Value bets (edge / Kelly)
                </SectionTitle>
                {pred.valueBets.length === 0 ? (
                  <p className="rounded-2xl bg-ink-3 px-4 py-3 text-[10.5px] font-semibold text-white/45">
                    Aucune value bet détectée — le marché est aligné avec le modèle.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {pred.valueBets.map((vb, i) => (
                      <button
                        key={i}
                        onClick={() => openTicketMarket(vb.market, vb.pick, vb.modelProb, vb.odds)}
                        className="w-full rounded-2xl bg-ink-3 px-3.5 py-3 text-left transition-transform active:scale-[0.98]"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="min-w-0">
                            <span className="block truncate text-[12px] font-black text-white">{vb.pick}</span>
                            <span className="text-[9px] font-bold uppercase tracking-wider text-white/40">
                              {vb.market} · modèle {pct(vb.modelProb)} · cote {oddsFmt(vb.odds)}
                            </span>
                          </span>
                          <span className="flex shrink-0 items-center gap-1.5">
                            <EdgeChip edge={vb.edge} />
                            <span className="rounded-full bg-black/60 px-2 py-0.5 text-[9px] font-black text-white/70">
                              K {Math.round(vb.kelly * 100)}%
                            </span>
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {pred.oddsMovement ? (
                  <div className="mt-4 flex items-start gap-2 rounded-2xl bg-black/50 px-3.5 py-3 ring-1 ring-white/10">
                    <TrendingUp size={14} className="mt-0.5 shrink-0 text-neon" />
                    <p className="text-[10px] font-semibold leading-relaxed text-white/65">{pred.oddsMovement}</p>
                  </div>
                ) : null}

                {detail.odds ? (
                  <p className="mt-3 text-center text-[9px] font-semibold uppercase tracking-widest text-white/30">
                    Cotes {detail.odds.provider} · open/close capturées à la prédiction
                  </p>
                ) : null}
              </div>
            ) : null}

            {/* ---------------- H2H ---------------- */}
            {tab === "h2h" ? (
              <div>
                <SectionTitle>Confrontations (base Neon)</SectionTitle>
                <div className="mb-3 grid grid-cols-3 gap-2">
                  {[
                    { k: detail.home.name, v: detail.h2hSummary.homeWins, tone: "bg-neon text-black" },
                    { k: "Nuls", v: detail.h2hSummary.draws, tone: "bg-white/15 text-white" },
                    { k: detail.away.name, v: detail.h2hSummary.awayWins, tone: "bg-[#ff5d5d]/80 text-white" },
                  ].map((x) => (
                    <div key={x.k} className={`rounded-2xl px-2 py-3 text-center ${x.tone}`}>
                      <p className="truncate text-[8.5px] font-bold uppercase tracking-wider opacity-70">{x.k}</p>
                      <p className="mt-1 font-display text-[22px] leading-none">{x.v}</p>
                    </div>
                  ))}
                </div>
                <div className="space-y-1.5">
                  {detail.h2h.map((h, i) => (
                    <div key={i} className="flex items-center justify-between rounded-2xl bg-ink-3 px-3.5 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-[11px] font-bold text-white">
                          {h.homeTeam} <span className="mx-1 rounded bg-black/50 px-1.5 py-0.5 font-display text-[12px] text-neon">{h.score}</span> {h.awayTeam}
                        </p>
                        <p className="text-[9px] font-semibold text-white/35">
                          {new Date(h.date).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" })}
                        </p>
                      </div>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[8.5px] font-black uppercase ${
                        h.winner === "home" ? "bg-neon text-black" : h.winner === "away" ? "bg-[#ff5d5d] text-white" : "bg-white/15 text-white/70"
                      }`}>
                        {h.winner === "draw" ? "Nul" : "Victoire"}
                      </span>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-[9px] leading-relaxed text-white/30">
                  Historique synchronisé depuis ESPN (2 saisons) — comptage par identifiant d&apos;équipe, les deux ordres domicile/extérieur.
                </p>
              </div>
            ) : null}

            {/* ---------------- CONTEXTE ---------------- */}
            {tab === "contexte" ? (
              <div>
                {detail.context.isDerby ? (
                  <div className="mt-4 flex items-center gap-2 rounded-2xl bg-neon px-3.5 py-3 text-black">
                    <span className="text-[16px]">🔥</span>
                    <p className="text-[11px] font-black uppercase tracking-wide">{detail.context.derbyLabel ?? "Derby"}</p>
                  </div>
                ) : null}

                <SectionTitle>Enjeux</SectionTitle>
                <div className="space-y-2">
                  <div className="rounded-2xl bg-ink-3 px-3.5 py-3">
                    <p className="text-[9px] font-black uppercase tracking-widest text-white/40">{detail.home.name}</p>
                    <p className="mt-1 text-[11px] font-semibold leading-relaxed text-white/80">{detail.context.stakesHome}</p>
                  </div>
                  <div className="rounded-2xl bg-ink-3 px-3.5 py-3">
                    <p className="text-[9px] font-black uppercase tracking-widest text-white/40">{detail.away.name}</p>
                    <p className="mt-1 text-[11px] font-semibold leading-relaxed text-white/80">{detail.context.stakesAway}</p>
                  </div>
                </div>

                {detail.context.weather ? (
                  <>
                    <SectionTitle>Météo (Open-Meteo)</SectionTitle>
                    <div className="flex items-center gap-3 rounded-2xl bg-ink-3 px-3.5 py-3">
                      <Umbrella size={18} className="shrink-0 text-neon" />
                      <div className="min-w-0 flex-1">
                        <p className="text-[11.5px] font-black text-white">
                          {detail.context.weather.description} · {detail.context.weather.tempC}°C · vent {detail.context.weather.windKmh} km/h
                        </p>
                        <p className="text-[9.5px] font-semibold text-white/45">Impact moteur : {detail.context.weather.impact}</p>
                      </div>
                    </div>
                  </>
                ) : null}

                <SectionTitle>Alertes effectifs &amp; fatigue</SectionTitle>
                <div className="space-y-1.5">
                  {[
                    { team: detail.home.name, inj: detail.context.injuriesNoteHome, fat: detail.context.fatigueNoteHome },
                    { team: detail.away.name, inj: detail.context.injuriesNoteAway, fat: detail.context.fatigueNoteAway },
                  ].map((x) => (
                    <div key={x.team} className="rounded-2xl bg-ink-3 px-3.5 py-3">
                      <p className="text-[10px] font-black uppercase tracking-wide text-white/70">{x.team}</p>
                      <p className="mt-1 text-[10.5px] font-semibold text-white/60">🚑 {x.inj ?? "—"}</p>
                      <p className="mt-0.5 text-[10.5px] font-semibold text-white/60">⏱ {x.fat ?? "—"}</p>
                    </div>
                  ))}
                </div>

                <SectionTitle>Profils équipes</SectionTitle>
                <div className="grid gap-2.5">
                  {teamBlock(detail.home, "home")}
                  {teamBlock(detail.away, "away")}
                </div>

                <SectionTitle>Stade</SectionTitle>
                <p className="rounded-2xl bg-ink-3 px-3.5 py-3 text-[11px] font-semibold text-white/75">
                  {detail.venue.name ?? "Stade inconnu"}
                  {detail.venue.city ? ` · ${detail.venue.city}` : ""}
                  {detail.venue.country ? `, ${detail.venue.country}` : ""}
                </p>
              </div>
            ) : null}

            {/* ---------------- COMPOS ---------------- */}
            {tab === "compos" ? (
              <div>
                {lineupsLoading ? (
                  <LoadingPanel label="Chargement des compositions…" />
                ) : !lineups || (!lineups.home && !lineups.away) ? (
                  <ErrorPanel message="Compositions indisponibles pour ce match." isDemo={!isLive} />
                ) : (
                  <div>
                    <div className="mt-4 rounded-2xl bg-ink-3 px-3.5 py-3">
                      <p className="text-[11.5px] font-black text-white">
                        {lineups.venue.name ?? "Stade inconnu"}
                        {lineups.venue.city ? ` · ${lineups.venue.city}` : ""}
                      </p>
                      <p className="mt-0.5 text-[9.5px] font-semibold text-white/45">
                        {lineups.attendance ? `${lineups.attendance.toLocaleString("fr-FR")} spectateurs · ` : ""}
                        {lineups.weather ? `${lineups.weather.description} ${lineups.weather.tempC ?? ""}°C` : ""}
                      </p>
                    </div>

                    {!lineups.home?.lineupsPublished ? (
                      <p className="mt-2 rounded-2xl bg-black/50 px-3.5 py-2.5 text-[9.5px] font-semibold leading-relaxed text-white/50 ring-1 ring-white/10">
                        Compositions non publiées par ESPN — formation déduite des postes, aucune position inventée.
                      </p>
                    ) : null}

                    <div className="mt-3 flex gap-1.5 rounded-full bg-ink-3 p-1">
                      {(["home", "away"] as const).map((s) => {
                        const t = s === "home" ? lineups.home : lineups.away;
                        return (
                          <button
                            key={s}
                            onClick={() => setComposSide(s)}
                            aria-pressed={composSide === s}
                            className={`flex-1 truncate rounded-full px-3 py-1.5 text-[10px] font-black uppercase tracking-wide transition-colors ${
                              composSide === s ? "bg-neon text-black" : "text-white/60"
                            }`}
                          >
                            {t?.shortName ?? t?.name ?? s}
                          </button>
                        );
                      })}
                    </div>

                    {(() => {
                      const t = composSide === "home" ? lineups.home : lineups.away;
                      if (!t) return null;
                      return (
                        <div className="mt-3">
                          <div className="mb-2.5 flex items-center justify-between">
                            <span className="text-[10px] font-black uppercase tracking-widest text-white/60">
                              {t.formation ? `${t.formation.text}${t.formation.source === "deduced" ? " (déduite)" : ""}` : "Formation ?"}
                            </span>
                            {t.squadValueEur != null ? (
                              <span className="rounded-full bg-ink-3 px-2.5 py-1 text-[9px] font-black text-neon">
                                Effectif {eurCompact(t.squadValueEur)}
                              </span>
                            ) : null}
                          </div>
                          <Pitch team={t} />

                          <SectionTitle>Banc</SectionTitle>
                          <div className="grid grid-cols-2 gap-1.5">
                            {t.bench.map((p) => (
                              <div key={p.athleteId} className="flex items-center gap-2 rounded-xl bg-ink-3 px-2.5 py-2">
                                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/10 text-[9.5px] font-black text-white/70">
                                  {p.jersey ?? "?"}
                                </span>
                                <span className="min-w-0 flex-1 truncate text-[10px] font-bold text-white/80">{p.shortName ?? p.name}</span>
                                {p.tm?.valueEur ? <span className="text-[8.5px] font-black text-neon">{eurCompact(p.tm.valueEur)}</span> : null}
                              </div>
                            ))}
                          </div>

                          {t.coach ? (
                            <p className="mt-3 text-center text-[9.5px] font-semibold text-white/40">Coach : {t.coach}</p>
                          ) : null}
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>
            ) : null}
          </motion.div>
        </main>
      )}

      {/* CTA bas : prono moteur → ticket */}
      {!loading && detail && pred ? (
        <div className="absolute inset-x-0 bottom-0 z-30 bg-gradient-to-t from-ink via-ink/95 to-transparent px-5 pb-6 pt-8">
          <button
            onClick={() =>
              bestPick
                ? openTicketMarket(
                    bestPick.market,
                    bestPick.pick,
                    bestPick.prob,
                    bestPick.market === "1X2"
                      ? bestPick.pick.startsWith("1 ")
                        ? detail.odds?.moneyline.home.close ?? light?.mlHome ?? null
                        : bestPick.pick.startsWith("2 ")
                          ? detail.odds?.moneyline.away.close ?? light?.mlAway ?? null
                          : detail.odds?.moneyline.draw.close ?? light?.mlDraw ?? null
                      : null,
                  )
                : undefined
            }
            className="flex h-[52px] w-full items-center justify-center gap-2 rounded-full bg-neon text-[14px] font-black uppercase tracking-wide text-black shadow-[0_14px_28px_rgba(0,0,0,0.35)] transition-transform hover:scale-[1.015] active:scale-[0.98]"
          >
            <Ticket size={17} strokeWidth={2.6} />
            {bestPick ? `Ticket · ${bestPick.pick} (${pct(bestPick.prob)})` : "Créer un ticket"}
          </button>
        </div>
      ) : null}

      {/* pastille mode démo */}
      {!isLive ? (
        <div className="absolute right-4 top-[70px] z-20">
          <DemoBadge />
        </div>
      ) : null}

      {loading ? (
        <div className="absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-black/70 px-3.5 py-2 ring-1 ring-white/10">
          <Loader2 size={12} className="animate-spin text-neon" />
          <span className="text-[9.5px] font-bold uppercase tracking-widest text-white/60">Analyse…</span>
        </div>
      ) : null}
    </div>
  );
}
