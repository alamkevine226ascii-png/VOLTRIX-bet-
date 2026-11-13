"use client";

/* ============================================================
   VOLTRIX app — Combinateur (fonctionnalité v1 restaurée,
   étendue à la semaine).
   On choisit une côte cible et un seuil de réussite (40 / 50 /
   60 %) ; le moteur analyse tous les matchs à venir — de la
   journée sélectionnée ou des 7 prochains jours — et construit
   le meilleur combiné atteignant cette côte : une seule jambe
   par match, cotes réelles du bookmaker (1X2, double chance,
   total buts), probabilité produit des probabilités moteur.
   ============================================================ */

import { useCallback, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { ChevronLeft, Layers, Loader2, RefreshCw, Target, TrendingUp } from "lucide-react";
import { fetchDayFixtures } from "@/lib/fixtures-client";
import {
  buildLegPool,
  findBestCombos,
  type ComboResult,
  type ComboDayInput,
} from "@/lib/foot/combinator";
import { timeLabel, dayLabel } from "@/lib/voltrix";
import type { LightMatch } from "@/lib/voltrix-types";

/* ---------- Paramètres ---------- */

const PROB_OPTIONS = [
  { value: 0.4, label: "40 %" },
  { value: 0.5, label: "50 %" },
  { value: 0.6, label: "60 %" },
] as const;

const TARGET_MIN = 1.5;
const TARGET_MAX = 10;
const TARGET_STEP = 0.25;

function isoAddDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function todayISO(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

/* ---------- Petits blocs UI ---------- */

function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="flex gap-1 rounded-2xl bg-black/40 p-1 ring-1 ring-white/10"
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={String(o.value)}
            onClick={() => onChange(o.value)}
            aria-pressed={active}
            className={`flex-1 rounded-xl px-2 py-2 text-[11px] font-black uppercase tracking-wide transition-colors ${
              active ? "bg-neon text-black" : "text-white/55 hover:text-white/85"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function LegRow({
  leg,
  onOpen,
}: {
  leg: ComboResult["legs"][number];
  onOpen?: (matchId: string, leagueCode: string, date: string, light?: LightMatch) => void;
}) {
  return (
    <button
      onClick={onOpen ? () => onOpen(leg.matchId, leg.leagueCode, leg.dayKey) : undefined}
      className={`flex w-full items-center gap-3 rounded-2xl bg-black/35 px-3 py-2.5 text-left ring-1 ring-white/5 ${
        onOpen ? "transition-transform active:scale-[0.98]" : "cursor-default"
      }`}
    >
      <span className="flex w-[52px] shrink-0 flex-col items-start gap-0.5">
        <span className="text-[9px] font-bold uppercase tracking-wide text-white/40">
          {timeLabel(leg.kickoff)}
        </span>
        <span className="text-[8px] font-semibold uppercase tracking-wide text-white/25">
          {new Date(leg.kickoff).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" })}
        </span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[11px] font-extrabold text-white/90">
          {leg.pick}
        </span>
        <span className="block truncate text-[9.5px] font-semibold text-white/40">
          {leg.homeShort} – {leg.awayShort} · {leg.leagueShort}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-0.5">
        <span className="font-display text-[15px] font-black leading-none text-neon">
          {leg.odds.toFixed(2)}
        </span>
        <span className="text-[9px] font-bold text-white/40">
          {Math.round(leg.prob * 100)}%
        </span>
      </span>
    </button>
  );
}

function ComboCard({
  combo,
  minProb,
  rank,
  onOpenMatch,
}: {
  combo: ComboResult;
  minProb: number;
  rank: number; // 0 = combiné principal
  onOpenMatch?: (matchId: string, leagueCode: string, date: string, light?: LightMatch) => void;
}) {
  const pct = Math.round(combo.prob * 100);
  const pass = combo.meetsThreshold;
  return (
    <motion.section
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: rank * 0.07 }}
      className={`overflow-hidden rounded-[24px] shadow-[0_14px_34px_rgba(0,0,0,0.45)] ring-1 ${
        rank === 0 ? "bg-panel" : "bg-panel-2"
      } ${pass ? "ring-neon/60" : "ring-amber-400/50"}`}
      aria-label={rank === 0 ? "Combiné proposé" : `Variante ${rank}`}
    >
      {/* bandeau résultat */}
      <div className="flex items-center gap-3 bg-black px-4 py-3.5">
        <div className="min-w-0 flex-1">
          <p className="text-[8.5px] font-black uppercase tracking-[0.16em] text-white/40">
            {rank === 0 ? "Combiné proposé" : `Variante ${rank}`}
          </p>
          <p className="truncate text-[10px] font-semibold text-white/50">
            {combo.legs.length} sélection{combo.legs.length > 1 ? "s" : ""} ·{" "}
            {dayLabel(combo.legs[0].kickoff)}
            {combo.legs.length > 1
              ? ` → ${dayLabel(combo.legs[combo.legs.length - 1].kickoff)}`
              : ""}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex flex-col items-end">
            <span className="text-[8px] font-black uppercase tracking-widest text-white/35">
              Côte
            </span>
            <span className="font-display text-[24px] font-black leading-none text-neon">
              {combo.odds.toFixed(2)}
            </span>
          </div>
          <div className="h-8 w-px bg-white/10" aria-hidden="true" />
          <div className="flex flex-col items-end">
            <span className="text-[8px] font-black uppercase tracking-widest text-white/35">
              Réussite
            </span>
            <span
              className={`font-display text-[24px] font-black leading-none ${
                pass ? "text-white" : "text-amber-300"
              }`}
            >
              {pct}%
            </span>
          </div>
        </div>
      </div>

      {/* jauge de probabilité vs seuil */}
      <div className="px-4 pt-3">
        <div className="relative h-2 overflow-hidden rounded-full bg-black/25">
          <div
            className={`h-full rounded-full ${pass ? "bg-neon" : "bg-amber-400"}`}
            style={{ width: `${Math.min(100, pct)}%` }}
          />
          <div
            className="absolute top-0 h-full w-[2px] bg-black/60"
            style={{ left: `${Math.round(minProb * 100)}%` }}
            aria-hidden="true"
          />
        </div>
        <p className="mt-1.5 text-[9px] font-bold uppercase tracking-wide text-black/45">
          {pass
            ? `Seuil de ${Math.round(minProb * 100)} % atteint`
            : `Sous le seuil de ${Math.round(minProb * 100)} % — meilleur combiné possible`}
        </p>
      </div>

      {/* jambes */}
      <div className="flex flex-col gap-1.5 p-3">
        {combo.legs.map((l, i) => (
          <LegRow key={`${l.matchId}-${l.market}-${i}`} leg={l} onOpen={onOpenMatch} />
        ))}
      </div>
    </motion.section>
  );
}

/* ---------- Écran ---------- */

export function CombinatorScreen({
  date,
  onBack,
  onOpenMatch,
}: {
  date: string;
  onBack: () => void;
  onOpenMatch?: (matchId: string, leagueCode: string, date: string, light?: LightMatch) => void;
}) {
  const [target, setTarget] = useState(3);
  const [minProb, setMinProb] = useState<number>(0.5);
  const [scope, setScope] = useState<"day" | "week">("day");

  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<{
    results: ComboResult[];
    matches: number;
    poolSize: number;
    relaxed: boolean;
    target: number;
    minProb: number;
    scope: "day" | "week";
    at: number;
  } | null>(null);

  const scopeDays = useMemo(
    () => (scope === "day" ? [date] : [0, 1, 2, 3, 4, 5, 6].map((i) => isoAddDays(todayISO(), i))),
    [scope, date],
  );

  const analyze = useCallback(async () => {
    if (analyzing) return;
    setAnalyzing(true);
    setError(null);
    try {
      /* Récupération des journées pré-calculées (base Neon via
         /api/fixtures) — en parallèle, les échecs de journée sont
         simplement ignorés (jour non couvert). */
      const settled = await Promise.allSettled(
        scopeDays.map((d) => fetchDayFixtures(d, 9000)),
      );
      const days: ComboDayInput[] = [];
      for (let i = 0; i < settled.length; i++) {
        const r = settled[i];
        if (r.status === "fulfilled" && r.value) {
          days.push({ date: scopeDays[i], foot: r.value.foot, footPreds: r.value.footPreds });
        }
      }
      if (days.length === 0) {
        throw new Error(
          "Base de pré-calcul injoignable — vérifie ta connexion puis relance l'analyse.",
        );
      }

      const { legs, matches } = buildLegPool(days);
      if (matches === 0) {
        setOutcome({
          results: [],
          matches: 0,
          poolSize: 0,
          relaxed: false,
          target,
          minProb,
          scope,
          at: Date.now(),
        });
        setAnalyzing(false);
        return;
      }

      const res = findBestCombos(legs, matches, { target, minProb });
      setOutcome({
        results: res.results,
        matches: res.matches,
        poolSize: res.poolSize,
        relaxed: res.relaxed,
        target,
        minProb,
        scope,
        at: Date.now(),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analyse indisponible.");
    } finally {
      setAnalyzing(false);
    }
  }, [analyzing, scopeDays, target, minProb, scope]);

  const scopeLabel =
    scope === "day"
      ? new Date(`${date}T12:00:00Z`).toLocaleDateString("fr-FR", {
          weekday: "long",
          day: "numeric",
          month: "long",
        })
      : "7 prochains jours";

  return (
    <div className="relative h-full bg-ink text-white">
      {/* contenu défilant */}
      <main className="no-scrollbar absolute inset-0 overflow-y-auto overscroll-contain px-5 pb-10 pt-[86px]">
        {/* ---------- paramètres ---------- */}
        <section
          aria-label="Paramètres du combiné"
          className="rounded-[24px] bg-panel p-4 text-black shadow-[0_14px_34px_rgba(0,0,0,0.45)]"
        >
          {/* côte cible */}
          <div className="flex items-end justify-between">
            <p className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-black/50">
              <Target size={13} strokeWidth={2.6} /> Côte cible
            </p>
            <p className="flex items-baseline gap-1">
              <span className="font-display text-[34px] font-black leading-none text-black">
                {target.toFixed(2)}
              </span>
              <span className="text-[10px] font-bold text-black/40">min.</span>
            </p>
          </div>
          <input
            type="range"
            min={TARGET_MIN}
            max={TARGET_MAX}
            step={TARGET_STEP}
            value={target}
            onChange={(e) => setTarget(Number(e.target.value))}
            aria-label="Côte cible du combiné"
            className="mt-2 w-full accent-[#c6f211]"
          />
          <div className="flex justify-between text-[8.5px] font-bold uppercase tracking-wide text-black/35">
            <span>{TARGET_MIN.toFixed(2)}</span>
            <span>{TARGET_MAX.toFixed(2)}</span>
          </div>

          {/* seuil de réussite */}
          <p className="mt-4 text-[10px] font-black uppercase tracking-[0.14em] text-black/50">
            Chance de réussite minimum
          </p>
          <div className="mt-1.5">
            <Segmented
              ariaLabel="Seuil de chance de réussite"
              value={minProb}
              options={PROB_OPTIONS.map((o) => ({ ...o }))}
              onChange={setMinProb}
            />
          </div>

          {/* périmètre */}
          <p className="mt-4 text-[10px] font-black uppercase tracking-[0.14em] text-black/50">
            Matchs analysés
          </p>
          <div className="mt-1.5">
            <Segmented
              ariaLabel="Périmètre d'analyse"
              value={scope}
              options={[
                { value: "day" as const, label: "Journée" },
                { value: "week" as const, label: "Semaine" },
              ]}
              onChange={setScope}
            />
          </div>
          <p className="mt-1.5 text-[9.5px] font-semibold text-black/45">
            {scope === "day" ? scopeLabel : "Du jour à J+6 — matchs à venir uniquement."}
          </p>

          {/* bouton analyser */}
          <button
            onClick={() => void analyze()}
            disabled={analyzing}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-black py-3.5 text-[13px] font-black uppercase tracking-wide text-neon shadow-[0_10px_24px_rgba(0,0,0,0.35)] transition-transform active:scale-[0.98] disabled:opacity-60"
          >
            {analyzing ? (
              <>
                <Loader2 size={16} className="animate-spin" strokeWidth={2.6} />
                Analyse en cours…
              </>
            ) : (
              <>
                <TrendingUp size={16} strokeWidth={2.6} />
                Analyser {scope === "day" ? "la journée" : "la semaine"}
              </>
            )}
          </button>
        </section>

        {/* ---------- stats du dernier passage ---------- */}
        {outcome ? (
          <p className="mt-3 px-1 text-[9px] font-bold uppercase tracking-widest text-white/35">
            {outcome.matches} match{outcome.matches > 1 ? "s" : ""} analysé
            {outcome.matches > 1 ? "s" : ""} · {outcome.poolSize} sélection
            {outcome.poolSize > 1 ? "s" : ""} jouable{outcome.poolSize > 1 ? "s" : ""} ·{" "}
            {outcome.scope === "day" ? "journée" : "semaine"}
          </p>
        ) : null}

        {/* ---------- erreur ---------- */}
        {error ? (
          <div className="mt-4 rounded-[24px] bg-panel p-5 text-center">
            <p className="text-[12px] font-bold text-black/70">{error}</p>
            <button
              onClick={() => void analyze()}
              className="mt-3 rounded-full bg-black px-5 py-2 text-[11px] font-black uppercase tracking-wide text-neon"
            >
              Réessayer
            </button>
          </div>
        ) : null}

        {/* ---------- résultats ---------- */}
        {outcome && outcome.matches === 0 ? (
          <div className="mt-4 flex flex-col items-center gap-2 rounded-[24px] bg-panel px-5 py-8 text-center">
            <span className="text-[30px]">🗓️</span>
            <p className="text-[12px] font-bold text-black/70">
              Aucun match à venir avec prono sur ce périmètre.
            </p>
            <p className="max-w-[260px] text-[10px] leading-relaxed text-black/45">
              {outcome.scope === "day"
                ? "Choisis un autre jour via le sélecteur de l'accueil, ou passe l'analyse sur la semaine."
                : "Aucun match à venir dans les 7 jours — réessaie plus tard."}
            </p>
          </div>
        ) : null}

        {outcome && outcome.matches > 0 && outcome.results.length === 0 ? (
          <div className="mt-4 flex flex-col items-center gap-2 rounded-[24px] bg-panel px-5 py-8 text-center">
            <span className="text-[30px]">🎯</span>
            <p className="text-[12px] font-bold text-black/70">
              Aucun combiné possible à la côte {outcome.target.toFixed(2)}.
            </p>
            <p className="max-w-[270px] text-[10px] leading-relaxed text-black/45">
              Baisse la côte cible, ou choisis un seuil de réussite plus faible — puis relance
              l'analyse.
            </p>
          </div>
        ) : null}

        {outcome && outcome.relaxed && outcome.results.length > 0 ? (
          <p className="mt-3 rounded-2xl bg-amber-400/10 px-3 py-2 text-[9.5px] font-bold leading-relaxed text-amber-300 ring-1 ring-amber-400/25">
            Seuil de {Math.round(outcome.minProb * 100)} % non atteignable à cette côte — voici le
            meilleur combiné possible en dessous du seuil.
          </p>
        ) : null}

        <div className="mt-4 space-y-4">
          {outcome?.results.map((c, i) => (
            <ComboCard
              key={`${c.odds}-${i}-${outcome.at}`}
              combo={c}
              minProb={outcome.minProb}
              rank={i}
              onOpenMatch={onOpenMatch}
            />
          ))}
        </div>

        {/* ---------- état initial ---------- */}
        {!outcome && !error && !analyzing ? (
          <div className="mt-4 flex flex-col items-center gap-2 rounded-[24px] bg-panel px-5 py-8 text-center">
            <Layers size={26} className="text-black/30" strokeWidth={2.2} />
            <p className="text-[12px] font-bold text-black/70">
              Choisis ta côte cible et lance l'analyse.
            </p>
            <p className="max-w-[270px] text-[10px] leading-relaxed text-black/45">
              Le moteur parcourt {scope === "day" ? "les matchs de la journée" : "les 7 prochains jours"},
              retient les sélections avec cote réelle (résultat, double chance, total buts) et
              construit le combiné le plus solide atteignant ta côte.
            </p>
          </div>
        ) : null}

        <p className="mt-6 text-center text-[8.5px] font-bold uppercase tracking-widest text-white/25">
          Probabilités moteur VOLTRIX · jouer comporte des risques
        </p>
      </main>

      {/* ---------- en-tête ---------- */}
      <header className="absolute inset-x-0 top-0 z-40 flex items-center gap-3 bg-gradient-to-b from-ink via-ink/95 to-transparent px-5 pb-6 pt-6">
        <button
          onClick={onBack}
          aria-label="Retour à l'accueil"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink-3/90 text-white backdrop-blur transition-colors hover:bg-neon hover:text-black"
        >
          <ChevronLeft size={18} strokeWidth={2.4} />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="text-[17px] font-black leading-tight tracking-tight text-white">
            Combinateur
          </h1>
          <p className="truncate text-[9.5px] font-bold uppercase tracking-widest text-white/40">
            Combiné à côte cible · {scopeLabel}
          </p>
        </div>
        {outcome || analyzing ? (
          <button
            onClick={() => void analyze()}
            disabled={analyzing}
            aria-label="Relancer l'analyse"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink-3/90 text-white backdrop-blur transition-colors hover:bg-neon hover:text-black disabled:opacity-50"
          >
            <RefreshCw size={15} strokeWidth={2.2} className={analyzing ? "animate-spin" : ""} />
          </button>
        ) : null}
      </header>
    </div>
  );
}
