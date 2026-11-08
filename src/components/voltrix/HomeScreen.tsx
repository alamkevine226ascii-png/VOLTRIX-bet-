"use client";

/* ============================================================
   VOLTRIX front — Accueil : matchs du jour
   GET /api/matches?date=…  → cartes par ligue (logos ESPN, score
   live, forme, cotes 1X2)
   POST /api/predictions    → triplet de probabilités moteur,
   confiance, value bets (lots ≤ 30, statut pre uniquement).
   ============================================================ */

import { useCallback, useEffect, useMemo, useRef, useState, type UIEvent } from "react";
import { CalendarDays, RefreshCw } from "lucide-react";
import {
  fetchMatches,
  fetchPredictions,
  getApiBase,
  timeLabel,
} from "@/lib/voltrix";
import { demoMatchesFor, demoPredictions } from "@/lib/demo-data";
import type { LightMatch, MatchesResponse, QuickPred } from "@/lib/voltrix-types";
import { TeamBadge } from "./TeamBadge";
import {
  CardSkeleton,
  DemoBadge,
  ErrorPanel,
  FormDots,
  LoadingPanel,
  confidenceStars,
} from "./ui-bits";
import type { SelectionDraft } from "./VoltrixApp";

const PRED_CHUNK = 30;
const PRED_MAX_CHUNKS = 3; // borne anti-charge : 90 matchs max par journée

function isoAddDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/* ---------- Bandeau de dates (7 jours, compact) ---------- */
function DateStrip({ value, onChange }: { value: string; onChange: (d: string) => void }) {
  const days = useMemo(() => {
    const t = todayISO();
    return [-2, -1, 0, 1, 2, 3, 4].map((off) => isoAddDays(t, off));
  }, []);
  return (
    <div className="no-scrollbar flex gap-1.5 overflow-x-auto px-5">
      {days.map((d) => {
        const active = d === value;
        const dt = new Date(`${d}T12:00:00Z`);
        const isToday = d === todayISO();
        return (
          <button
            key={d}
            onClick={() => onChange(d)}
            aria-pressed={active}
            className={`flex w-[46px] shrink-0 flex-col items-center rounded-xl px-1 py-1.5 transition-colors ${
              active ? "bg-neon text-black" : "bg-ink-3 text-white hover:bg-[#383838]"
            }`}
          >
            <span className={`text-[8px] font-bold uppercase tracking-wider ${active ? "text-black/60" : isToday ? "text-neon" : "text-white/50"}`}>
              {isToday ? "Auj." : dt.toLocaleDateString("fr-FR", { weekday: "short" })}
            </span>
            <span className="text-[15px] font-black leading-tight">{dt.getUTCDate()}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ---------- Triplet de probabilités compact ---------- */
function ProbsStrip({ pred }: { pred: QuickPred }) {
  const items: Array<{ k: string; v: number }> = [
    { k: "1", v: pred.probs.home },
    { k: "X", v: pred.probs.draw },
    { k: "2", v: pred.probs.away },
  ];
  const best = items.reduce((a, b) => (b.v > a.v ? b : a));
  return (
    <div className="flex items-center gap-1.5">
      {items.map((it) => (
        <span
          key={it.k}
          className={`flex min-w-[44px] flex-col items-center rounded-xl px-1.5 py-1 ${
            it === best ? "bg-black text-neon" : "bg-black/5 text-black/60"
          }`}
        >
          <span className="text-[8px] font-black uppercase tracking-wider opacity-60">{it.k}</span>
          <span className="text-[13px] font-black leading-none">{Math.round(it.v * 100)}%</span>
        </span>
      ))}
      <span className="ml-1 flex flex-col items-end gap-0.5">
        <span className="text-[10px] leading-none tracking-[0.1em] text-black/80" title={`Confiance ${pred.confidence}/5`}>
          {confidenceStars(pred.confidence)}
        </span>
        {pred.valueBetsCount > 0 ? (
          <span className="rounded-full bg-black px-1.5 py-[1px] text-[7.5px] font-black uppercase tracking-wider text-neon">
            {pred.valueBetsCount} value
          </span>
        ) : null}
      </span>
    </div>
  );
}

/* ---------- Carte match ---------- */
function MatchCard({
  match,
  pred,
  leagueShort,
  onOpen,
  onQuickTicket,
}: {
  match: LightMatch;
  pred?: QuickPred;
  leagueShort: string;
  onOpen: () => void;
  onQuickTicket: () => void;
}) {
  const live = match.status === "in";
  const done = match.status === "post";
  const hasScore = match.home.score != null && match.away.score != null;

  return (
    <article
      onClick={onOpen}
      className={`cursor-pointer rounded-[24px] bg-panel p-4 pb-3.5 shadow-[0_10px_24px_rgba(0,0,0,0.35)] transition-transform duration-200 active:scale-[0.97] sm:hover:scale-[1.015] ${done ? "opacity-80" : ""}`}
    >
      <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-1">
        {/* domicile */}
        <div className="flex flex-col items-center gap-2 pt-1">
          <TeamBadge name={match.home.name} logo={match.home.logo} size={56} />
          <div className="flex flex-col items-center gap-1">
            <span className="max-w-[96px] text-center text-[9px] font-extrabold leading-[1.25] tracking-wide text-black">
              {match.home.name.toUpperCase()}
            </span>
            <FormDots form={match.home.form} align="left" />
          </div>
        </div>

        {/* centre */}
        <div className="flex w-[104px] flex-col items-center">
          {hasScore ? (
            <span className="font-display text-[30px] leading-none tracking-wide text-black">
              {match.home.score}:{match.away.score}
            </span>
          ) : (
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-black font-display text-[14px] tracking-wide text-white shadow-[0_6px_14px_rgba(0,0,0,0.4)]">
              VS
            </span>
          )}
          {hasScore ? (
            <span className="mt-1.5 text-[10px] font-bold uppercase tracking-wide text-black/45">
              {match.statusDetail || "FT"}
            </span>
          ) : (
            <span className="mt-2.5 text-[20px] font-black leading-none text-black">{timeLabel(match.date)}</span>
          )}
          {live ? (
            <span className="mt-1.5 flex items-center gap-1 rounded-full bg-neon px-2 py-[3px] text-[8px] font-black uppercase text-black">
              <span className="live-dot h-1.5 w-1.5 rounded-full bg-black" />
              Live
            </span>
          ) : null}
        </div>

        {/* extérieur */}
        <div className="flex flex-col items-center gap-2 pt-1">
          <TeamBadge name={match.away.name} logo={match.away.logo} size={56} />
          <div className="flex flex-col items-center gap-1">
            <span className="max-w-[96px] text-center text-[9px] font-extrabold leading-[1.25] tracking-wide text-black">
              {match.away.name.toUpperCase()}
            </span>
            <FormDots form={match.away.form} />
          </div>
        </div>
      </div>

      {/* bandeau bas : ligue + triplet moteur / cotes */}
      <div className="mt-3.5 flex items-center justify-between gap-2 rounded-2xl bg-panel-2 px-3 py-2">
        <span className="shrink-0 rounded-full bg-white px-2.5 py-[3px] text-[8px] font-extrabold uppercase tracking-wider text-black shadow-sm">
          {leagueShort}
        </span>
        {pred ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onQuickTicket();
            }}
            className="transition-transform active:scale-95"
            aria-label="Sélection rapide du prono moteur"
          >
            <ProbsStrip pred={pred} />
          </button>
        ) : match.hasOdds && match.mlHome != null ? (
          <div className="flex items-center gap-1">
            {[
              { k: "1", v: match.mlHome },
              { k: "X", v: match.mlDraw },
              { k: "2", v: match.mlAway },
            ].map((o) => (
              <span key={o.k} className="flex min-w-[40px] flex-col items-center rounded-xl bg-white px-1.5 py-1 text-black/70">
                <span className="text-[8px] font-black uppercase opacity-60">{o.k}</span>
                <span className="text-[12px] font-black leading-none">{o.v?.toFixed(2)}</span>
              </span>
            ))}
          </div>
        ) : (
          <span className="text-[9px] font-bold uppercase tracking-wider text-black/35">Pas de cotes</span>
        )}
      </div>
    </article>
  );
}

/* ---------- Écran ---------- */
export function HomeScreen({
  onOpenMatch,
  onQuickTicket,
  apiEpoch,
}: {
  onOpenMatch: (matchId: string, leagueCode: string, date: string, light?: LightMatch) => void;
  onQuickTicket: (draft: SelectionDraft) => void;
  apiEpoch: number;
}) {
  const [date, setDate] = useState(todayISO());
  const [data, setData] = useState<MatchesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [preds, setPreds] = useState<Record<string, QuickPred>>({});
  const [loadingPreds, setLoadingPreds] = useState(false);
  const [activeLeague, setActiveLeague] = useState("all");
  const abortRef = useRef<number>(0);

  /* bandeau dates + ligues : se replie quand on défile vers le bas,
     réapparaît dès qu'on remonte */
  const [barsHidden, setBarsHidden] = useState(false);
  const lastScrollY = useRef(0);
  const mainRef = useRef<HTMLDivElement>(null);

  const handleScroll = useCallback((e: UIEvent<HTMLDivElement>) => {
    const y = e.currentTarget.scrollTop;
    if (y < 8) setBarsHidden(false);
    else if (y > lastScrollY.current + 6 && y > 70) setBarsHidden(true);
    else if (y < lastScrollY.current - 6) setBarsHidden(false);
    lastScrollY.current = y;
  }, []);

  const changeDate = useCallback((d: string) => {
    setDate(d);
    setBarsHidden(false);
    lastScrollY.current = 0;
    mainRef.current?.scrollTo({ top: 0 });
  }, []);

  const isLive = getApiBase().length > 0;

  const load = useCallback(
    async (d: string) => {
      const run = ++abortRef.current;
      setLoading(true);
      setError(null);
      setData(null);
      setPreds({});
      try {
        const res = isLive ? await fetchMatches(d) : demoMatchesFor(d);
        if (run !== abortRef.current) return;
        setData(res);
      } catch (e) {
        if (run !== abortRef.current) return;
        setError(e instanceof Error ? e.message : "Chargement impossible");
      } finally {
        if (run === abortRef.current) setLoading(false);
      }
    },
    [isLive],
  );

  useEffect(() => {
    void load(date);
  }, [date, apiEpoch, load]);

  /* Pronos en lot (matchs à venir uniquement) */
  useEffect(() => {
    if (!data) return;
    const upcoming = data.leagues.flatMap((l) =>
      l.matches.filter((m) => m.status === "pre" && m.leagueCode && m.date),
    );
    if (upcoming.length === 0) return;
    let cancelled = false;

    const run = async () => {
      setLoadingPreds(true);
      const acc: Record<string, QuickPred> = {};
      try {
        if (!isLive) {
          demoPredictions(upcoming.slice(0, PRED_CHUNK * PRED_MAX_CHUNKS)).forEach((p) => {
            acc[p.matchId] = p;
          });
          if (!cancelled) setPreds({ ...acc });
        } else {
          for (let c = 0; c < PRED_MAX_CHUNKS; c++) {
            const chunk = upcoming.slice(c * PRED_CHUNK, (c + 1) * PRED_CHUNK);
            if (chunk.length === 0) break;
            const payload = chunk.map((m) => ({
              matchId: m.id,
              leagueCode: m.leagueCode,
              date: m.date,
            }));
            const res = await fetchPredictions(payload);
            if (cancelled) return;
            res.results.forEach((r) => {
              if (r) acc[r.matchId] = r;
            });
            setPreds({ ...acc });
          }
        }
      } catch {
        /* les pronos échoués ne bloquent pas l'affichage des matchs */
      } finally {
        if (!cancelled) setLoadingPreds(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [data, isLive]);

  /* Listes dérivées */
  const leagueChips = useMemo(() => {
    if (!data) return [];
    return data.leagues.map((l) => ({ code: l.code, label: l.shortName || l.code, name: l.name }));
  }, [data]);

  const groups = useMemo(() => {
    if (!data) return [];
    if (activeLeague !== "all") {
      const lg = data.leagues.find((l) => l.code === activeLeague);
      return lg ? [{ code: lg.code, name: lg.name, shortName: lg.shortName, matches: lg.matches }] : [];
    }
    return data.leagues;
  }, [data, activeLeague]);

  const openMatch = (m: LightMatch) => onOpenMatch(m.id, m.leagueCode, m.date, m);

  const quickTicket = (m: LightMatch, pred: QuickPred) => {
    const best = pred.recommendedBets[0];
    if (!best) return;
    onQuickTicket({
      matchId: m.id,
      leagueCode: m.leagueCode,
      matchDate: m.date,
      market: best.market,
      pick: best.pick,
      prob: best.prob,
      odds:
        best.market === "1X2"
          ? best.pick.startsWith("1 ")
            ? m.mlHome
            : best.pick.startsWith("2 ")
              ? m.mlAway
              : m.mlDraw
          : best.market === "O/U 2.5"
            ? pred.ouOdds?.over ?? null
            : null,
      homeName: m.home.name,
      awayName: m.away.name,
      homeLogo: m.home.logo,
      awayLogo: m.away.logo,
    });
  };

  const dt = new Date(`${date}T12:00:00Z`);

  return (
    <div className="flex h-full flex-col bg-ink">
      {/* en-tête */}
      <header className="flex items-center justify-between px-5 pt-6">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-neon shadow-[0_4px_18px_rgba(198,242,17,0.35)]">
            <svg width="24" height="24" viewBox="0 0 24 24" role="img" aria-label="Logo VOLTRIX">
              <path d="M4 12 L8 5 H16 L20 12 L16 19 H8 Z" fill="none" stroke="#141414" strokeWidth="2.2" strokeLinejoin="round" />
              <path d="M12 7.5 L15.5 12 L12 16.5 L8.5 12 Z" fill="#141414" />
              <circle cx="12" cy="12" r="1.3" fill="#c6f211" />
            </svg>
          </span>
          <div>
            <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.22em] text-white/45">
              {isLive ? "API connectée" : "Mode démo"}
              {!isLive ? <DemoBadge /> : null}
            </p>
            <h1 className="font-display text-[30px] leading-none tracking-wide text-white">VOLTRIX</h1>
          </div>
        </div>
        <button
          onClick={() => void load(date)}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-ink-3 text-white transition-colors hover:bg-neon hover:text-black"
          aria-label="Rafraîchir"
        >
          <RefreshCw size={15} strokeWidth={2.2} className={loading ? "animate-spin" : ""} />
        </button>
      </header>

      {/* bandeau de dates + ligues — compact, se replie au défilement */}
      <div
        aria-hidden={barsHidden}
        className={`grid transition-[grid-template-rows,opacity,transform,visibility] duration-300 ease-out ${
          barsHidden
            ? "invisible grid-rows-[0fr] -translate-y-2 opacity-0"
            : "grid-rows-[1fr] translate-y-0 opacity-100"
        } mt-3`}
      >
        <div className="overflow-hidden">
          <DateStrip value={date} onChange={changeDate} />
          {leagueChips.length > 0 ? (
            <div className="no-scrollbar mt-2 flex gap-1.5 overflow-x-auto px-5">
              <button
                onClick={() => setActiveLeague("all")}
                aria-pressed={activeLeague === "all"}
                className={`whitespace-nowrap rounded-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide transition-colors ${
                  activeLeague === "all" ? "bg-neon text-black" : "bg-ink-3 text-white hover:bg-[#383838]"
                }`}
              >
                Toutes · {data?.totalMatches ?? 0}
              </button>
              {leagueChips.map((l) => (
                <button
                  key={l.code}
                  onClick={() => setActiveLeague(l.code)}
                  aria-pressed={activeLeague === l.code}
                  title={l.name}
                  className={`whitespace-nowrap rounded-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide transition-colors ${
                    activeLeague === l.code ? "bg-neon text-black" : "bg-ink-3 text-white hover:bg-[#383838]"
                  }`}
                >
                  {l.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {/* contenu */}
      <main ref={mainRef} onScroll={handleScroll} className="no-scrollbar flex-1 space-y-5 overflow-y-auto px-5 pb-28 pt-4">
        <div className="flex items-center justify-between">
          <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-white/45">
            <CalendarDays size={12} strokeWidth={2.4} />
            {dt.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}
          </p>
          {loadingPreds ? (
            <span className="text-[9.5px] font-bold uppercase tracking-widest text-neon">Moteur en analyse…</span>
          ) : null}
        </div>

        {loading ? (
          <div className="space-y-5">
            <CardSkeleton />
            <CardSkeleton />
            <CardSkeleton />
          </div>
        ) : error ? (
          <ErrorPanel
            message={error}
            onRetry={() => void load(date)}
            isDemo={!isLive}
          />
        ) : groups.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-14 text-center">
            <span className="text-[32px]">⚽</span>
            <p className="text-[12px] font-semibold text-white/50">Aucun match synchronisé pour cette date.</p>
            <p className="max-w-[260px] text-[10.5px] leading-relaxed text-white/35">
              La base se remplit via la synchronisation ESPN (onglet Réglages → Réveiller la synchronisation).
            </p>
          </div>
        ) : (
          groups.map((lg) => (
            <section key={lg.code} aria-label={lg.name}>
              <div className="mb-2.5 flex items-center gap-2">
                <span className="h-[3px] w-4 rounded-full bg-neon" />
                <h2 className="text-[11px] font-black uppercase tracking-[0.14em] text-white/70">{lg.name}</h2>
                <span className="text-[9.5px] font-bold text-white/30">{lg.matches.length}</span>
              </div>
              <div className="space-y-4">
                {lg.matches.map((m) => (
                  <MatchCard
                    key={m.id}
                    match={m}
                    pred={preds[m.id]}
                    leagueShort={lg.shortName || m.leagueShort}
                    onOpen={() => openMatch(m)}
                    onQuickTicket={() => quickTicket(m, preds[m.id])}
                  />
                ))}
              </div>
            </section>
          ))
        )}

        {loadingPreds && groups.length > 0 ? (
          <div className="pt-1">
            <LoadingPanel label="Le moteur VOLTRIX analyse les matchs à venir…" />
          </div>
        ) : null}
      </main>
    </div>
  );
}
