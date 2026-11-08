"use client";

/* ============================================================
   VOLTRIX front — Précision (performance du moteur)
   GET /api/performance → win rate, ROI (mise fixe 10 €), stats
   par marché / confiance / ligue, calibration (Brier + buckets),
   historique des pronos résolus.
   ============================================================ */

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { RefreshCw } from "lucide-react";
import { fetchPerformance, getApiBase, moneyFmt, pct, oddsFmt } from "@/lib/voltrix";
import { demoPerformance } from "@/lib/demo-data";
import type { PerformanceDTO } from "@/lib/voltrix-types";
import {
  CalibrationRow,
  DemoBadge,
  ErrorPanel,
  KpiTile,
  LoadingPanel,
  ResultBadge,
  SectionTitle,
  confidenceStars,
} from "./ui-bits";

/* ---------- Barre par catégorie ---------- */
function CategoryBars({ rows, title }: { rows: Array<{ label: string; total: number; wins: number; winRate: number }>; title: string }) {
  if (rows.length === 0) return null;
  const max = Math.max(...rows.map((r) => r.winRate), 0.01);
  return (
    <div>
      <SectionTitle>{title}</SectionTitle>
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.label} className="rounded-xl bg-ink-2 px-3.5 py-2.5">
            <div className="flex items-baseline justify-between">
              <span className="truncate text-[12px] text-white/75">{r.label}</span>
              <span className="ml-2 shrink-0 text-[13px] font-semibold text-white">
                {pct(r.winRate)} <span className="text-[11px] text-white/35">({r.wins}/{r.total})</span>
              </span>
            </div>
            <div className="mt-1.5 h-[5px] overflow-hidden rounded-full bg-white/10">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${(r.winRate / max) * 100}%` }}
                transition={{ duration: 0.6, ease: [0.32, 0.72, 0, 1] }}
                className={`h-full rounded-full ${r.winRate >= 0.5 ? "bg-neon" : "bg-white/45"}`}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- Écran ---------- */
export function PrecisionScreen({ apiEpoch }: { apiEpoch: number }) {
  const [data, setData] = useState<PerformanceDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isLive = getApiBase().length > 0;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = isLive ? await fetchPerformance() : demoPerformance();
      setData(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chargement impossible");
    } finally {
      setLoading(false);
    }
  }, [isLive]);

  useEffect(() => {
    void load();
  }, [apiEpoch, load]);

  return (
    <div className="flex h-full flex-col bg-ink">
      {/* en-tête */}
      <header className="flex items-center justify-between px-5 pt-6">
        <div>
          <p className="flex items-center gap-1.5 text-[13px] text-white/45">
            Performance mesurée {isLive ? null : <DemoBadge />}
          </p>
          <h1 className="mt-0.5 text-[32px] font-bold leading-none tracking-[-0.022em] text-white">Précision</h1>
        </div>
        <button
          onClick={() => void load()}
          className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-white/8 text-white transition-transform duration-150 ease-out active:scale-95"
          aria-label="Rafraîchir"
        >
          <RefreshCw size={15} strokeWidth={2.2} className={loading ? "animate-spin" : ""} />
        </button>
      </header>

      <main className="no-scrollbar mt-4 flex-1 overflow-y-auto px-5 pb-28">
        {loading ? (
          <LoadingPanel label="Résolution des pronos et calcul des stats…" />
        ) : error ? (
          <ErrorPanel message={error} onRetry={() => void load()} isDemo={!isLive} />
        ) : !data ? null : (
          <>
            {/* anneau + ROI */}
            <div className="rounded-[20px] bg-ink-2 p-5">
              <div className="flex items-center gap-5">
                <div className="relative shrink-0">
                  <svg width="112" height="112" className="-rotate-90">
                    <circle cx="56" cy="56" r="48" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="11" />
                    <motion.circle
                      cx="56"
                      cy="56"
                      r="48"
                      fill="none"
                      stroke="#c6f211"
                      strokeWidth="11"
                      strokeLinecap="round"
                      initial={{ strokeDashoffset: 2 * Math.PI * 48 }}
                      animate={{ strokeDashoffset: 2 * Math.PI * 48 * (1 - Math.min(1, data.winRate)) }}
                      transition={{ duration: 0.9, ease: [0.32, 0.72, 0, 1] }}
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-[26px] font-bold leading-none tracking-[-0.02em] text-white">{pct(data.winRate, 1)}</span>
                    <span className="mt-1 text-[10px] font-medium uppercase tracking-[0.06em] text-white/40">réussite</span>
                  </div>
                </div>
                <div className="grid flex-1 grid-cols-2 gap-2">
                  <KpiTile
                    label="ROI"
                    value={`${data.roi >= 0 ? "+" : ""}${(data.roi * 100).toFixed(1)} %`}
                    tone={data.roi >= 0 ? "good" : "bad"}
                  />
                  <KpiTile label="Brier" value={data.calibration.brierScore.toFixed(3)} />
                  <KpiTile label="Misé" value={moneyFmt(data.staked)} />
                  <KpiTile label="Rendu" value={moneyFmt(data.returned)} tone={data.returned >= data.staked ? "good" : "bad"} />
                </div>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2">
                <KpiTile label="Pronos" value={data.totalPredictions.toLocaleString("fr-FR")} />
                <KpiTile label="Résolus" value={data.totalResolved.toLocaleString("fr-FR")} />
                <KpiTile label="En cours" value={String(data.pendingCount)} tone="neon" />
              </div>
              {data.sample ? (
                <p className="mt-3 text-center text-[10px] text-white/30">
                  Économie : {data.economic?.settledWithOdds ?? 0} sélections avec cote réelle (mise fixe 10 €)
                </p>
              ) : null}
            </div>

            {/* calibration */}
            <SectionTitle right={<span className="rounded-md bg-white/8 px-2 py-0.5 text-[10px] text-white/50">Brier {data.calibration.brierScore.toFixed(3)}</span>}>
              Calibration
            </SectionTitle>
            <div className="space-y-2 rounded-2xl bg-ink-2 p-3.5">
              <div className="flex items-center justify-end gap-3 pb-1">
                <span className="flex items-center gap-1 text-[10px] text-white/45">
                  <span className="h-[6px] w-3 rounded-full bg-neon" /> Prédit
                </span>
                <span className="flex items-center gap-1 text-[10px] text-white/45">
                  <span className="h-[6px] w-3 rounded-full bg-white/70" /> Réel
                </span>
              </div>
              {data.calibration.buckets.map((b) => (
                <CalibrationRow key={b.label} label={b.label} predicted={b.avgProb} actual={b.actualRate} count={b.count} />
              ))}
            </div>

            {/* marchés */}
            <CategoryBars
              title="Par marché"
              rows={Object.entries(data.byMarket).map(([label, v]) => ({ label, ...v }))}
            />

            {/* confiance */}
            <CategoryBars
              title="Par confiance"
              rows={Object.entries(data.byConfidence)
                .sort((a, b) => Number(a[0]) - Number(b[0]))
                .map(([label, v]) => ({ label: `${"★".repeat(Number(label)) || label} ${label}/5`, ...v }))}
            />

            {/* ligues */}
            {data.byLeague ? (
              <CategoryBars title="Par compétition" rows={Object.entries(data.byLeague).map(([label, v]) => ({ label, ...v }))} />
            ) : null}

            {/* versions moteur */}
            {data.byVersion && Object.keys(data.byVersion).length > 0 ? (
              <CategoryBars title="Par version du moteur" rows={Object.entries(data.byVersion).map(([label, v]) => ({ label, ...v }))} />
            ) : null}

            {/* historique */}
            <SectionTitle right={<span className="text-[11px] text-white/35">{data.history.length} derniers</span>}>
              Historique
            </SectionTitle>
            <div className="space-y-1.5">
              {data.history.map((h) => (
                <div key={h.id} className="rounded-xl bg-ink-2 px-3.5 py-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-[12px] text-white">
                        {h.homeTeam} – {h.awayTeam}
                      </p>
                      <p className="truncate text-[11px] text-white/40">
                        {h.leagueName} · {new Date(h.matchDate).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" })} · {h.market}
                      </p>
                    </div>
                    <ResultBadge result={h.resolved ? h.result : null} />
                  </div>
                  <div className="mt-1.5 flex items-center justify-between">
                    <span className="truncate text-[11px] font-semibold text-neon">{h.pick}</span>
                    <span className="flex shrink-0 items-center gap-2 text-[11px] text-white/45">
                      <span>{pct(h.probability)}</span>
                      <span className="rounded bg-white/10 px-1.5 py-0.5">{oddsFmt(h.odds)}</span>
                      <span title={`Confiance ${h.confidence}/5`}>{confidenceStars(h.confidence)}</span>
                    </span>
                  </div>
                </div>
              ))}
            </div>

            <p className="mt-5 text-center text-[10px] leading-relaxed text-white/30">
              ROI sur cotes capturées à la prédiction (anti look-ahead) — les sélections sans cote réelle
              comptent en précision mais pas en économique.
            </p>
          </>
        )}
      </main>
    </div>
  );
}
