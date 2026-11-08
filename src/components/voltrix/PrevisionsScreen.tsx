"use client";

/* ============================================================
   VOLTRIX front — Prévisions (semaine)
   GET /api/forecasts/week?start=… → snapshots FIGÉS (1X2, O/U 2.5,
   BTTS), résultats officiels, évaluations (grades), stats agrégées.
   Liens export : /api/forecasts/report (PDF) et /export?format=csv.
   ============================================================ */

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight, FileDown, FileText, RefreshCw } from "lucide-react";
import { fetchWeek, getApiBase, pct, proxiedUrl, timeLabel } from "@/lib/voltrix";
import { demoWeek } from "@/lib/demo-data";
import type { WeekMatchRow, WeekResponse } from "@/lib/voltrix-types";
import { TeamBadge } from "./TeamBadge";
import {
  ConfidenceChip,
  DemoBadge,
  ErrorPanel,
  KpiTile,
  LoadingPanel,
  RowSkeleton,
  SectionTitle,
} from "./ui-bits";
import { GradeBadge } from "./ui-bits";

/** Lundi de la semaine courante (UTC) — convention VOLTRIX. */
function currentWeekStart(): string {
  const now = new Date();
  const day = now.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + diff, 12));
  return d.toISOString().slice(0, 10);
}

function isoAddDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/* ---------- Ligne match semaine ---------- */
function WeekRow({ m }: { m: WeekMatchRow }) {
  const s = m.snapshot;
  const res = m.result;
  const done = m.effectiveStatus === "FINAL";

  return (
    <article className={`rounded-[22px] bg-ink-2 p-3.5 ring-1 ring-white/5 ${done ? "" : ""}`}>
      {/* en-tête ligne */}
      <div className="flex items-center justify-between gap-2">
        <span className="max-w-[130px] truncate text-[8.5px] font-black uppercase tracking-widest text-white/40">
          {m.leagueName}
        </span>
        <span className="flex items-center gap-1.5 text-[9px] font-bold text-white/50">
          {timeLabel(m.kickoff)}
          <span className={`rounded-full px-2 py-0.5 text-[8px] font-black uppercase tracking-wide ${
            done ? "bg-white/10 text-white/60" : m.effectiveStatus === "LIVE" ? "bg-neon text-black" : "bg-ink-3 text-neon"
          }`}>
            {m.statusLabel}
          </span>
        </span>
      </div>

      {/* équipes + score */}
      <div className="mt-2 flex items-center gap-2.5">
        <TeamBadge name={m.homeTeam} logo={m.homeLogo} size={34} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-right text-[11.5px] font-black text-white">{m.homeTeam}</p>
        </div>
        <span className="shrink-0 rounded-lg bg-black/60 px-2.5 py-1 font-display text-[15px] tracking-wide text-white">
          {res?.homeScore != null ? `${res.homeScore}:${res.awayScore}` : "–:–"}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11.5px] font-black text-white">{m.awayTeam}</p>
        </div>
        <TeamBadge name={m.awayTeam} logo={m.awayLogo} size={34} />
      </div>

      {/* picks figés + grades */}
      {s ? (
        <div className="mt-2.5 grid grid-cols-3 gap-1.5">
          <div className="rounded-xl bg-ink-3 px-2 py-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[7.5px] font-black uppercase tracking-wider text-white/40">1X2</span>
              <GradeBadge grade={m.evaluation?.grade1x2 ?? null} />
            </div>
            <p className="mt-1 truncate text-[10px] font-black text-neon">{s.pick1x2 === "X" ? "Nul" : s.pick1x2Label.replace(/^[12] - /, s.pick1x2 === "1" ? "1 · " : "2 · ")}</p>
            <p className="text-[8.5px] font-bold text-white/45">
              {pct(Math.max(s.p1x2Home, s.p1x2Draw, s.p1x2Away))}
            </p>
          </div>
          <div className="rounded-xl bg-ink-3 px-2 py-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[7.5px] font-black uppercase tracking-wider text-white/40">O/U 2.5</span>
              <GradeBadge grade={m.evaluation?.gradeOu25 ?? null} />
            </div>
            <p className="mt-1 text-[10px] font-black text-neon">{s.pickOu25 === "OVER" ? "+2.5 buts" : "−2.5 buts"}</p>
            <p className="text-[8.5px] font-bold text-white/45">{pct(Math.max(s.pOver25, s.pUnder25))}</p>
          </div>
          <div className="rounded-xl bg-ink-3 px-2 py-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[7.5px] font-black uppercase tracking-wider text-white/40">BTTS</span>
              <GradeBadge grade={m.evaluation?.gradeBtts ?? null} />
            </div>
            <p className="mt-1 text-[10px] font-black text-neon">{s.pickBtts === "YES" ? "Oui" : "Non"}</p>
            <p className="text-[8.5px] font-bold text-white/45">{pct(Math.max(s.pBttsYes, s.pBttsNo))}</p>
          </div>
        </div>
      ) : (
        <p className="mt-2.5 rounded-xl bg-ink-3 px-3 py-2 text-center text-[9.5px] font-bold uppercase tracking-wider text-white/35">
          {m.predictionPending ? "Prédiction en attente du job" : "Hors fenêtre de génération"}
        </p>
      )}

      {s ? (
        <div className="mt-2 flex items-center justify-between">
          <span className="text-[8px] font-semibold uppercase tracking-wider text-white/25">
            figé {new Date(s.predictionTime).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" })} · {s.modelVersion} · v{s.version}
          </span>
          <ConfidenceChip confidence={s.confidence} />
        </div>
      ) : null}
    </article>
  );
}

/* ---------- Écran ---------- */
export function PrevisionsScreen({ apiEpoch }: { apiEpoch: number }) {
  const [start, setStart] = useState(currentWeekStart());
  const [data, setData] = useState<WeekResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isLive = getApiBase().length > 0;

  const load = useCallback(
    async (s: string) => {
      setLoading(true);
      setError(null);
      try {
        const res = isLive ? await fetchWeek(s) : demoWeek(s);
        setData(res);
        if (res.week.start !== s) setStart(res.week.start);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Chargement impossible");
      } finally {
        setLoading(false);
      }
    },
    [isLive],
  );

  useEffect(() => {
    void load(start);
  }, [start, apiEpoch, load]);

  /* regroupement par jour */
  const byDay = useMemo(() => {
    if (!data) return [];
    const map = new Map<string, WeekMatchRow[]>();
    for (const m of data.matches) {
      const d = m.kickoff.slice(0, 10);
      const arr = map.get(d) ?? [];
      arr.push(m);
      map.set(d, arr);
    }
    return [...map.entries()];
  }, [data]);

  const st = data?.stats;
  const reportUrl = proxiedUrl(`/api/forecasts/report?start=${start}`);
  const csvUrl = proxiedUrl(`/api/forecasts/export?start=${start}&format=csv`);

  return (
    <div className="flex h-full flex-col bg-ink">
      {/* en-tête */}
      <header className="px-5 pt-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.22em] text-white/45">
              Semaine figée {isLive ? null : <DemoBadge />}
            </p>
            <h1 className="font-display text-[30px] leading-none tracking-wide text-white">PRÉVISIONS</h1>
          </div>
          <button
            onClick={() => void load(start)}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-ink-3 text-white transition-colors hover:bg-neon hover:text-black"
            aria-label="Rafraîchir"
          >
            <RefreshCw size={15} strokeWidth={2.2} className={loading ? "animate-spin" : ""} />
          </button>
        </div>

        {/* navigation semaine */}
        <div className="mt-4 flex items-center justify-between rounded-full bg-ink-3 p-1.5">
          <button
            onClick={() => setStart(isoAddDays(start, -7))}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-ink-2 text-white transition-colors hover:bg-neon hover:text-black"
            aria-label="Semaine précédente"
          >
            <ChevronLeft size={15} strokeWidth={2.6} />
          </button>
          <span className="text-[10.5px] font-black uppercase tracking-wider text-white">
            {data?.week.label ?? `Semaine du ${start}`}
          </span>
          <button
            onClick={() => setStart(isoAddDays(start, 7))}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-ink-2 text-white transition-colors hover:bg-neon hover:text-black"
            aria-label="Semaine suivante"
          >
            <ChevronRight size={15} strokeWidth={2.6} />
          </button>
        </div>
      </header>

      {/* contenu */}
      <main className="no-scrollbar mt-4 flex-1 overflow-y-auto px-5 pb-28">
        {loading ? (
          <>
            <RowSkeleton n={4} />
            <LoadingPanel label="Lecture des snapshots figés…" />
          </>
        ) : error ? (
          <ErrorPanel message={error} onRetry={() => void load(start)} isDemo={!isLive} />
        ) : !data || data.matches.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-14 text-center">
            <span className="text-[32px]">📅</span>
            <p className="text-[12px] font-semibold text-white/50">Aucune prévision pour cette semaine.</p>
            <p className="max-w-[260px] text-[10.5px] leading-relaxed text-white/35">
              Le job de prévisions génère les snapshots pour la semaine courante et la suivante (cron 05h30).
            </p>
          </div>
        ) : (
          <>
            {/* stats semaine */}
            <div className="grid grid-cols-4 gap-2">
              <KpiTile label="Analysés" value={String(st?.matchesAnalyzed ?? 0)} tone="neon" />
              <KpiTile label="Terminés" value={String(st?.matchesFinished ?? 0)} />
              <KpiTile label="À venir" value={String(st?.matchesPending ?? 0)} />
              <KpiTile
                label="Précision"
                value={st?.globalAccuracy != null ? pct(st.globalAccuracy) : "—"}
                tone={(st?.globalAccuracy ?? 0) >= 0.5 ? "good" : "bad"}
              />
            </div>

            {/* par marché */}
            <SectionTitle>Taux par marché</SectionTitle>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  { k: "1X2", s: st?.m1x2 },
                  { k: "O/U 2.5", s: st?.ou25 },
                  { k: "BTTS", s: st?.btts },
                ] as const
              ).map(({ k, s }) => (
                <div key={k} className="rounded-2xl bg-ink-3 px-3 py-2.5">
                  <p className="text-[8.5px] font-black uppercase tracking-widest text-white/45">{k}</p>
                  <p className="mt-1 text-[17px] font-black leading-none text-white">
                    {s?.accuracy != null ? pct(s.accuracy) : "—"}
                  </p>
                  <p className="mt-0.5 text-[8.5px] font-bold text-white/35">
                    {s?.correct ?? 0}/{s?.n ?? 0} corrects
                  </p>
                </div>
              ))}
            </div>

            {/* exports (API réelle uniquement) */}
            {isLive ? (
              <div className="mt-4 flex gap-2">
                {reportUrl ? (
                  <a
                    href={reportUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-ink-3 px-3 py-2.5 text-[9.5px] font-black uppercase tracking-wider text-white transition-colors hover:bg-neon hover:text-black"
                  >
                    <FileText size={12} strokeWidth={2.6} />
                    Rapport PDF
                  </a>
                ) : null}
                {csvUrl ? (
                  <a
                    href={csvUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-ink-3 px-3 py-2.5 text-[9.5px] font-black uppercase tracking-wider text-white transition-colors hover:bg-neon hover:text-black"
                  >
                    <FileDown size={12} strokeWidth={2.6} />
                    Export CSV
                  </a>
                ) : null}
              </div>
            ) : null}

            {/* matchs par jour */}
            {byDay.map(([day, rows]) => (
              <section key={day}>
                <SectionTitle>
                  {new Date(`${day}T12:00:00Z`).toLocaleDateString("fr-FR", {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                  })}
                </SectionTitle>
                <div className="space-y-2.5">
                  {rows.map((m) => (
                    <motion.div key={m.matchId} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
                      <WeekRow m={m} />
                    </motion.div>
                  ))}
                </div>
              </section>
            ))}

            <p className="mt-5 text-center text-[8.5px] leading-relaxed text-white/25">
              Snapshots immuables (insert-only) — une ré-analyse crée une nouvelle version, jamais de réécriture.
              Évaluation : CORRECT / INCORRECT / VOID sur statut ESPN définitif.
            </p>
          </>
        )}
      </main>
    </div>
  );
}
