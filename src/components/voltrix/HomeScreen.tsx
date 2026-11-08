"use client";

/* ============================================================
   VOLTRIX front — Accueil (design Apple Sports)
   Grand titre iOS qui se condense en barre translucide au
   défilement, bandeau de dates façon App Calendrier, cartes
   match en lignes équipe (logo · nom · forme · score) comme
   l'app Apple Sports, bandeau prono discret sous séparateur.
   GET /api/matches?date=… · POST /api/predictions.
   ============================================================ */

import { useCallback, useEffect, useMemo, useRef, useState, type UIEvent } from "react";
import { CalendarDays, ChevronLeft, RefreshCw } from "lucide-react";
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

/* ---------- Bandeau de dates (7 jours, style iOS) ---------- */
function DateStrip({ value, onChange }: { value: string; onChange: (d: string) => void }) {
  const days = useMemo(() => {
    const t = todayISO();
    return [-2, -1, 0, 1, 2, 3, 4].map((off) => isoAddDays(t, off));
  }, []);
  return (
    <div className="no-scrollbar flex gap-2 overflow-x-auto px-5">
      {days.map((d) => {
        const active = d === value;
        const dt = new Date(`${d}T12:00:00Z`);
        const isToday = d === todayISO();
        return (
          <button
            key={d}
            onClick={() => onChange(d)}
            aria-pressed={active}
            className={`flex w-[48px] shrink-0 flex-col items-center gap-[1px] rounded-[14px] px-1 py-2 transition-colors duration-150 ease-out ${
              active ? "bg-neon" : "bg-ink-2"
            }`}
          >
            <span className={`text-[11px] font-medium ${active ? "text-black/55" : "text-white/45"}`}>
              {isToday ? "Auj." : dt.toLocaleDateString("fr-FR", { weekday: "short" }).replace(".", "")}
            </span>
            <span className={`text-[18px] font-semibold leading-none tracking-[-0.01em] ${active ? "text-black" : "text-white"}`}>
              {dt.getUTCDate()}
            </span>
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
          className={`flex min-w-[42px] items-center justify-center gap-1 rounded-lg px-1.5 py-[5px] ${
            it === best ? "bg-neon text-black" : "bg-white/8 text-white/55"
          }`}
        >
          <span className="text-[11px] font-semibold">{it.k}</span>
          <span className="text-[12px] font-bold leading-none tabular-nums">{Math.round(it.v * 100)}%</span>
        </span>
      ))}
      <span className="ml-0.5 flex flex-col items-end gap-0.5">
        <span className="text-[10px] leading-none tracking-[0.06em] text-[#ffd60a]" title={`Confiance ${pred.confidence}/5`}>
          {"★".repeat(Math.max(0, Math.min(5, Math.round(pred.confidence))))}
        </span>
        {pred.valueBetsCount > 0 ? (
          <span className="rounded bg-neon/15 px-1.5 py-[1px] text-[9px] font-semibold text-neon">
            {pred.valueBetsCount} value
          </span>
        ) : null}
      </span>
    </div>
  );
}

/* ---------- Ligne équipe (style Apple Sports) ---------- */
function TeamRow({
  name,
  logo,
  form,
  score,
  live,
  dimmed,
}: {
  name: string;
  logo?: string | null;
  form: string | null;
  score: number | null;
  live: boolean;
  dimmed: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <TeamBadge name={name} logo={logo} size={26} />
      <span className={`min-w-0 flex-1 truncate text-[15px] font-semibold ${dimmed ? "text-white/50" : "text-white"}`}>{name}</span>
      {form && form.length > 0 ? <FormDots form={form} /> : null}
      {score != null ? (
        <span
          className={`w-7 text-right text-[17px] font-bold leading-none tabular-nums ${
            live ? "text-neon" : dimmed ? "text-white/45" : "text-white"
          }`}
        >
          {score}
        </span>
      ) : null}
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
  const homeWon = hasScore && (match.home.score ?? 0) > (match.away.score ?? 0);
  const awayWon = hasScore && (match.away.score ?? 0) > (match.home.score ?? 0);

  return (
    <article
      onClick={onOpen}
      className={`cursor-pointer rounded-2xl bg-ink-2 p-4 transition-transform duration-150 ease-out active:scale-[0.98] ${done ? "opacity-90" : ""}`}
    >
      {/* ligue + heure / statut */}
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-[12px] font-medium text-white/45">{leagueShort}</span>
        {live ? (
          <span className="flex shrink-0 items-center gap-1.5 text-[12px] font-semibold text-neon">
            <span className="live-dot h-[6px] w-[6px] rounded-full bg-neon" />
            {match.statusDetail || "En direct"}
          </span>
        ) : hasScore ? (
          <span className="shrink-0 text-[12px] font-medium text-white/45">{match.statusDetail || "Terminé"}</span>
        ) : (
          <span className="shrink-0 text-[12px] font-semibold text-white/70">{timeLabel(match.date)}</span>
        )}
      </div>

      {/* équipes */}
      <div className="mt-2 space-y-1.5">
        <TeamRow
          name={match.home.name}
          logo={match.home.logo}
          form={match.home.form}
          score={hasScore ? match.home.score : null}
          live={live}
          dimmed={done && !homeWon && !live}
        />
        <TeamRow
          name={match.away.name}
          logo={match.away.logo}
          form={match.away.form}
          score={hasScore ? match.away.score : null}
          live={live}
          dimmed={done && !awayWon && !live}
        />
      </div>

      {/* prono moteur : discret, sous un séparateur cheveux */}
      {pred ? (
        <div className="mt-3 border-t border-white/8 pt-2.5">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onQuickTicket();
            }}
            className="transition-transform duration-150 ease-out active:scale-95"
            aria-label="Sélection rapide du prono moteur"
          >
            <ProbsStrip pred={pred} />
          </button>
        </div>
      ) : match.hasOdds && match.mlHome != null ? (
        <div className="mt-3 flex items-center gap-1.5 border-t border-white/8 pt-2.5">
          {[
            { k: "1", v: match.mlHome },
            { k: "X", v: match.mlDraw },
            { k: "2", v: match.mlAway },
          ].map((o) => (
            <span key={o.k} className="flex min-w-[42px] items-center justify-center gap-1 rounded-lg bg-white/8 px-1.5 py-[5px] text-white/60">
              <span className="text-[11px] font-semibold">{o.k}</span>
              <span className="text-[12px] font-bold leading-none">{o.v?.toFixed(2)}</span>
            </span>
          ))}
        </div>
      ) : null}
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

  /* grand titre → barre compacte translucide quand on défile vers le bas */
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
  const dateShort = dt.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" }).replace(/\./g, "");

  return (
    <div className="flex h-full flex-col bg-black">
      {/* ===== barre compacte translucide — n'apparaît qu'en défilement ===== */}
      <div
        aria-hidden={!barsHidden}
        className={`material-bar absolute inset-x-0 top-0 z-30 border-b border-white/8 transition-transform duration-300 ease-out ${
          barsHidden ? "translate-y-0" : "-translate-y-full"
        }`}
      >
        <div className="flex h-[52px] items-center justify-between px-5">
          <button
            onClick={() => {
              setBarsHidden(false);
              mainRef.current?.scrollTo({ top: 0, behavior: "smooth" });
            }}
            aria-label="Revenir en haut"
            className="flex items-center gap-1.5"
          >
            <ChevronLeft size={15} strokeWidth={2.4} className="rotate-[-90deg] text-white/40" />
            <span className="text-[17px] font-semibold tracking-[-0.01em] text-white">VOLTRIX</span>
          </button>
          <span className="text-[13px] text-white/50">{dateShort}</span>
        </div>
      </div>

      {/* ===== en-tête : grand titre iOS ===== */}
      <header className="px-5 pt-6">
        <div className="flex items-start justify-between">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[13px] text-white/45">
              {isLive ? "API connectée" : "Mode démo"}
              {!isLive ? <DemoBadge /> : null}
            </p>
            <h1 className="mt-0.5 text-[32px] font-bold leading-none tracking-[-0.022em] text-white">VOLTRIX</h1>
          </div>
          <button
            onClick={() => void load(date)}
            className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full bg-white/8 text-white transition-transform duration-150 ease-out active:scale-95"
            aria-label="Rafraîchir"
          >
            <RefreshCw size={16} strokeWidth={2.2} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </header>

      {/* ===== bandeau de dates + ligues — se condense au défilement ===== */}
      <div
        aria-hidden={barsHidden}
        className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${
          barsHidden ? "invisible grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100"
        } mt-4`}
      >
        <div className="overflow-hidden">
          <DateStrip value={date} onChange={changeDate} />
          {leagueChips.length > 0 ? (
            <div className="no-scrollbar mt-2.5 flex gap-2 overflow-x-auto px-5">
              <button
                onClick={() => setActiveLeague("all")}
                aria-pressed={activeLeague === "all"}
                className={`whitespace-nowrap rounded-full px-3.5 py-[7px] text-[13px] font-semibold transition-colors duration-150 ease-out ${
                  activeLeague === "all" ? "bg-white text-black" : "bg-ink-2 text-white/70"
                }`}
              >
                Toutes
              </button>
              {leagueChips.map((l) => (
                <button
                  key={l.code}
                  onClick={() => setActiveLeague(l.code)}
                  aria-pressed={activeLeague === l.code}
                  title={l.name}
                  className={`whitespace-nowrap rounded-full px-3.5 py-[7px] text-[13px] font-semibold transition-colors duration-150 ease-out ${
                    activeLeague === l.code ? "bg-white text-black" : "bg-ink-2 text-white/70"
                  }`}
                >
                  {l.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {/* ===== contenu ===== */}
      <main ref={mainRef} onScroll={handleScroll} className="no-scrollbar flex-1 space-y-5 overflow-y-auto px-5 pb-24 pt-4">
        <div className="flex items-center justify-between">
          <p className="flex items-center gap-1.5 text-[13px] font-medium text-white/45">
            <CalendarDays size={13} strokeWidth={2.2} />
            {dt.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}
          </p>
          {loadingPreds ? <span className="text-[12px] text-neon">Analyse…</span> : null}
        </div>

        {loading ? (
          <div className="space-y-3">
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
            <p className="text-[14px] font-semibold text-white/60">Aucun match synchronisé pour cette date.</p>
            <p className="max-w-[260px] text-[12px] leading-relaxed text-white/40">
              La base se remplit via la synchronisation ESPN (onglet Réglages → Réveiller la synchronisation).
            </p>
          </div>
        ) : (
          groups.map((lg) => (
            <section key={lg.code} aria-label={lg.name}>
              <div className="mb-2.5 flex items-center justify-between px-0.5">
                <h2 className="min-w-0 truncate text-[13px] font-normal uppercase tracking-[0.08em] text-white/45">{lg.name}</h2>
                <span className="shrink-0 pl-2 text-[12px] text-white/30">{lg.matches.length}</span>
              </div>
              <div className="space-y-3">
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
