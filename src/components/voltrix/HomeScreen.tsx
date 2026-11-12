"use client";

/* ============================================================
   VOLTRIX app — Accueil : matchs de football ET combats MMA
   sur la même page. Données 100 % réelles (ESPN, appelé
   directement depuis le téléphone) :
   - Football : scan progressif par vague de priorité + pronos
     du moteur Poisson/Elo/Forme en arrière-plan ;
   - MMA : combats du jour (UFC, PFL) + pronos express
     voltrix-mma-v1, têtes des combattants, formes récentes.
   En-tête : logo seul + sélecteur de date + ligues. Au défilement,
   tout se replie et il ne reste que le logo flottant, sans fond.
   ============================================================ */

import { useCallback, useEffect, useMemo, useRef, useState, type UIEvent } from "react";
import { CalendarDays, RefreshCw } from "lucide-react";
import { timeLabel, dayLabel } from "@/lib/voltrix";
import {
  loadFootballDay,
  computeQuickPreds,
  type DayProgress,
} from "@/lib/foot/bridge";
import {
  loadMmaUpcoming,
  hydrateMmaHeadshots,
  hydrateMmaForms,
  localDateKey,
  eventCategoryLabel,
} from "@/lib/mma-bridge";
import { predDbGetAll, predDbPut } from "@/lib/pred-db";
import { fetchDayFixtures } from "@/lib/fixtures-client";
import type { LightMatch, MatchesResponse, QuickPred } from "@/lib/voltrix-types";
import type { MmaEventsResponse, MmaFight, MmaQuickPred } from "@/lib/mma-types";
import { TeamBadge } from "./TeamBadge";
import { FighterHead } from "./FighterHead";
import {
  CardSkeleton,
  ErrorPanel,
  FormDots,
  LoadingPanel,
  confidenceStars,
} from "./ui-bits";

const PRED_MAX = 24; // borne de pronos football calculés en arrière-plan

/* TTL des pronos en base locale (exigence : ≥ 10 min sans recalcul).
 * Un match terminé ne change plus → 6 h ; en direct → 10 min ;
 * à venir → 15 min (les cotes bougent peu, et le pull-to-refresh
 * reste possible à tout moment). */
function predTtlMs(status?: string): number {
  if (status === "post") return 6 * 60 * 60 * 1000;
  if (status === "in") return 10 * 60 * 1000;
  return 15 * 60 * 1000;
}

function isoAddDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function todayISO(): string {
  /* Clé de jour LOCALE (fuseau du navigateur) : l'ISO UTC désigne
     encore la veille entre minuit et 01:00 en France — l'app s'ouvrait
     alors sur le mauvais jour. */
  return localDateKey(new Date().toISOString());
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
            <span
              className={`text-[8px] font-bold uppercase tracking-wider ${
                active ? "text-black/60" : isToday ? "text-neon" : "text-white/50"
              }`}
            >
              {isToday ? "Auj." : dt.toLocaleDateString("fr-FR", { weekday: "short" })}
            </span>
            <span className="text-[15px] font-black leading-tight">{dt.getUTCDate()}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ---------- Triplet de probabilités compact (football 1X2) ---------- */
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
        <span
          className="text-[10px] leading-none tracking-[0.1em] text-black/80"
          title={`Confiance ${pred.confidence}/5`}
        >
          {confidenceStars(pred.confidence)}
        </span>
      </span>
    </div>
  );
}

/* ---------- Duo de probabilités compact (MMA : 2 issues) ---------- */
function MmaProbsStrip({ pred, aShort, bShort }: { pred: MmaQuickPred; aShort: string; bShort: string }) {
  if (!pred.available) {
    return (
      <span className="text-[9px] font-bold uppercase tracking-wider text-black/35">
        Prono indisponible
      </span>
    );
  }
  const items = [
    { k: aShort.slice(0, 3).toUpperCase(), v: pred.probs.a },
    { k: bShort.slice(0, 3).toUpperCase(), v: pred.probs.b },
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
      <span
        className="ml-1 max-w-[72px] text-right text-[8px] font-black uppercase leading-tight tracking-wider text-black/45"
        title={`Base : ${pred.basis}`}
      >
        {pred.level}
      </span>
    </div>
  );
}

/* ---------- Carte match (football) ---------- */
function MatchCard({
  match,
  pred,
  leagueShort,
  onOpen,
}: {
  match: LightMatch;
  pred?: QuickPred;
  leagueShort: string;
  onOpen: () => void;
}) {
  const live = match.status === "in";
  const done = match.status === "post";
  /* ESPN peut renvoyer un score 0 pour un match à venir : un score ne
     s'affiche que si le coup d'envoi est donné. */
  const hasScore = match.status !== "pre" && match.home.score != null && match.away.score != null;

  return (
    <article
      onClick={onOpen}
      className={`cursor-pointer rounded-[24px] bg-panel p-4 pb-3.5 shadow-[0_10px_24px_rgba(0,0,0,0.35)] transition-transform duration-150 ease-out active:scale-[0.97] sm:hover:scale-[1.015] ${done ? "opacity-80" : ""}`}
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
              {match.statusDetail || (done ? "FT" : "")}
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
          <ProbsStrip pred={pred} />
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

/* ---------- Carte combat (MMA) — têtes des combattants ---------- */
function FightCard({
  fight,
  pred,
  onOpen,
}: {
  fight: MmaFight;
  pred?: MmaQuickPred;
  onOpen: () => void;
}) {
  const live = fight.status === "in";
  const done = fight.status === "post";
  const rec = (r: { wins: number | null; losses: number | null; draws: number | null }) =>
    r.wins == null || r.losses == null ? "—" : r.draws ? `${r.wins}-${r.losses}-${r.draws}` : `${r.wins}-${r.losses}`;

  return (
    <article
      onClick={fight.prospect ? undefined : onOpen}
      className={`rounded-[24px] bg-panel p-4 pb-3.5 shadow-[0_10px_24px_rgba(0,0,0,0.35)] transition-transform duration-150 ease-out ${
        fight.prospect ? "" : "cursor-pointer active:scale-[0.97] sm:hover:scale-[1.015]"
      } ${done ? "opacity-80" : ""}`}
    >
      <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-1">
        {/* combattant A */}
        <div className="flex flex-col items-center gap-2 pt-1">
          <FighterHead name={fight.fighterA.name} headshotUrl={fight.fighterA.headshotUrl} size={56} />
          <div className="flex flex-col items-center gap-1">
            <span className="max-w-[96px] text-center text-[9px] font-extrabold leading-[1.25] tracking-wide text-black">
              {fight.fighterA.name.toUpperCase()}
            </span>
            <span className="text-[8px] font-bold text-black/45">{rec(fight.fighterA.record)}</span>
            <FormDots form={fight.fighterA.form} align="left" />
          </div>
        </div>

        {/* centre */}
        <div className="flex w-[104px] flex-col items-center">
          {done && fight.winner ? (
            <span className="flex h-11 min-w-[44px] items-center justify-center rounded-full bg-black px-2 font-display text-[11px] tracking-wide text-neon shadow-[0_6px_14px_rgba(0,0,0,0.4)]">
              {(fight.winner === "A" ? fight.fighterA : fight.fighterB).shortName.toUpperCase()}
            </span>
          ) : (
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-black font-display text-[14px] tracking-wide text-white shadow-[0_6px_14px_rgba(0,0,0,0.4)]">
              VS
            </span>
          )}
          {done ? (
            <span className="mt-1.5 max-w-[104px] text-center text-[9px] font-bold uppercase tracking-wide text-black/45">
              {fight.method ?? "Terminé"}
            </span>
          ) : (
            <span className="mt-2.5 text-[20px] font-black leading-none text-black">{timeLabel(fight.date)}</span>
          )}
          {live ? (
            <span className="mt-1.5 flex items-center gap-1 rounded-full bg-neon px-2 py-[3px] text-[8px] font-black uppercase text-black">
              <span className="live-dot h-1.5 w-1.5 rounded-full bg-black" />
              {fight.statusDetail || "Live"}
            </span>
          ) : null}
        </div>

        {/* combattant B */}
        <div className="flex flex-col items-center gap-2 pt-1">
          <FighterHead name={fight.fighterB.name} headshotUrl={fight.fighterB.headshotUrl} size={56} />
          <div className="flex flex-col items-center gap-1">
            <span className="max-w-[96px] text-center text-[9px] font-extrabold leading-[1.25] tracking-wide text-black">
              {fight.fighterB.name.toUpperCase()}
            </span>
            <span className="text-[8px] font-bold text-black/45">{rec(fight.fighterB.record)}</span>
            <FormDots form={fight.fighterB.form} />
          </div>
        </div>
      </div>

      {/* bandeau bas : catégorie + duo moteur */}
      <div className="mt-3.5 flex items-center justify-between gap-2 rounded-2xl bg-panel-2 px-3 py-2">
        <span className="shrink-0 rounded-full bg-white px-2.5 py-[3px] text-[8px] font-extrabold uppercase tracking-wider text-black shadow-sm">
          {fight.weightClassShort ?? fight.org}
        </span>
        {fight.prospect ? (
          <span className="text-[9px] font-bold uppercase tracking-wider text-black/35">
            Adversaire à confirmer
          </span>
        ) : pred ? (
          <MmaProbsStrip pred={pred} aShort={fight.fighterA.shortName} bShort={fight.fighterB.shortName} />
        ) : (
          <span className="text-[9px] font-bold uppercase tracking-wider text-black/35">Analyse…</span>
        )}
      </div>
    </article>
  );
}

/* ---------- Écran ---------- */
export function HomeScreen({
  onOpenMatch,
  onOpenFight,
}: {
  onOpenMatch: (matchId: string, leagueCode: string, date: string, light?: LightMatch) => void;
  onOpenFight: (fightId: string) => void;
}) {
  const [date, setDate] = useState(todayISO());
  const [footData, setFootData] = useState<MatchesResponse | null>(null);
  const [mmaData, setMmaData] = useState<MmaEventsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [preds, setPreds] = useState<Record<string, QuickPred>>({});
  const [mmaPreds, setMmaPreds] = useState<Record<string, MmaQuickPred>>({});
  const [predsBusy, setPredsBusy] = useState(false);
  /* pronos restaurés depuis la base locale (affichés instantanément
     à la réouverture de l'App — preuve visible du non-recalcul) */
  const [restoredCount, setRestoredCount] = useState(0);
  const [activeFilter, setActiveFilter] = useState("all");
  const abortRef = useRef(0);
  /* miroir ref de l'état preds : l'effet de calcul des pronos manquants
     doit voir les pronos fournis par la base de pré-calcul (sinon il les
     recalculerait inutilement — exactement ce que l'architecture n°6
     supprime). */
  const predsRef = useRef<Record<string, QuickPred>>({});

  /* tirer-pour-rafraîchir (pattern natif mobile) : quand la liste est
     en haut, tirer vers le bas révèle un indicateur puis recharge.
     Les handlers sont définis après `load` (référence en closure). */
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const pullStartY = useRef<number | null>(null);

  /* en-tête repliable : en haut de page → logo + dates + ligues ;
     au défilement → seul le logo flotte, sans aucun fond.
     L'en-tête est en SURIMPENSION (hors flux) : son repli ne
     change jamais la hauteur du contenu → aucun saut de défilement,
     même en fin de page (correction du bug d'oscillation). */
  const [headerCollapsed, setHeaderCollapsed] = useState(false);
  const mainRef = useRef<HTMLDivElement>(null);

  const handleScroll = useCallback((e: UIEvent<HTMLDivElement>) => {
    const y = e.currentTarget.scrollTop;
    if (y < 10) setHeaderCollapsed(false);
    else setHeaderCollapsed(true);
  }, []);

  const scrollToTop = useCallback(() => {
    mainRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    setHeaderCollapsed(false);
  }, []);

  const changeDate = useCallback((d: string) => {
    setDate(d);
    mainRef.current?.scrollTo({ top: 0 });
    setHeaderCollapsed(false);
  }, []);

  /* ---------- chargement : football par date, MMA par événements UFC ---------- */
  const loadMma = useCallback(async (run: number) => {
    try {
      /* restauration immédiate des pronos MMA depuis la base locale :
         les cartes affichent leurs probabilités AVANT même que le
         réseau ne réponde (calcul déjà fait il y a < 15 min). */
      const storedMma = await predDbGetAll<MmaQuickPred>("mma").catch(
        () => ({}) as Record<string, MmaQuickPred>,
      );
      if (run !== abortRef.current) return;
      if (Object.keys(storedMma).length > 0) setMmaPreds(storedMma);

      const res = await loadMmaUpcoming();
      if (run !== abortRef.current) return;
      setMmaData(res);

      const withHeads = await hydrateMmaHeadshots(res).catch(() => res);
      if (run !== abortRef.current) return;
      setMmaData(withHeads);

      const { res: withForms, preds } = await hydrateMmaForms(withHeads).catch(
        () => ({ res: withHeads, preds: {} as Record<string, MmaQuickPred> }),
      );
      if (run !== abortRef.current) return;
      setMmaData(withForms);
      setMmaPreds(preds);
      /* persistance : le calcul une fois fait n'est plus refait au
         retour dans l'App pendant au moins 15 minutes */
      for (const [fightId, p] of Object.entries(preds)) {
        void predDbPut("mma", fightId, p, 15 * 60 * 1000);
      }
    } catch {
      /* réseau indisponible : les sections MMA disparaissent, le foot continue */
      if (run === abortRef.current) setMmaData(null);
    }
  }, []);

  const load = useCallback(async (d: string) => {
    const run = ++abortRef.current;
    setLoading(true);
    setError(null);
    setFootData(null);
    setPreds({});

    /* Chemin local football (scan progressif par vague de priorité) —
       utilisé en repli de la base de pré-calcul, et le jour J pour
       rafraîchir les scores sous l'affichage déjà présent. */
    const localFootballScan = (silent: boolean) => {
      void loadFootballDay(d, silent ? undefined : (p: DayProgress) => {
        if (run !== abortRef.current) return;
        setFootData({
          date: d,
          totalMatches: p.leagues.reduce((n, l) => n + l.matches.length, 0),
          leagues: p.leagues,
          scanMs: 0,
        });
      })
        .then((res) => {
          if (run !== abortRef.current) return;
          setFootData(res);
          setLoading(false);
        })
        .catch(() => {
          if (run !== abortRef.current) return;
          setLoading(false);
          if (!silent) {
            /* Sans ça, seul loading est coupé : l'utilisateur voyait
               l'état vide « Aucun match programmé » alors que le réseau
               avait lâché. */
            setError("Données ESPN indisponibles — vérifie ta connexion puis réessaie.");
          }
        });
    };

    /* 1. BASE DE PRÉ-CALCUL (architecture n°6) : matchs, combats et
       pronostics déjà calculés par le job serveur — affichage
       instantané, aucun scan ESPN, aucun calcul moteur dans le
       navigateur. Silence/échec → repli sur le chemin 100 % local. */
    const api = await fetchDayFixtures(d);
    if (run !== abortRef.current) return;

    if (api) {
      if (api.foot) {
        setFootData(api.foot);
        if (api.footPreds) {
          setPreds(api.footPreds);
          for (const [mid, p] of Object.entries(api.footPreds)) {
            void predDbPut("foot", mid, p, predTtlMs(p.status));
          }
        }
      }
      if (api.mma) {
        setMmaData(api.mma);
        if (api.mmaPreds) {
          setMmaPreds(api.mmaPreds);
          for (const [fid, p] of Object.entries(api.mmaPreds)) {
            void predDbPut("mma", fid, p, 15 * 60 * 1000);
          }
        }
      }
      setLoading(false);

      /* Jour J : le pré-calcul peut dater de quelques heures — on
         rafraîchit les scores/statuts en arrière-plan par un scan ESPN
         silencieux (résultat final seulement, pour éviter tout
         va-et-vient visuel : l'affiché reste celui de la base jusqu'à
         l'arrivée du frais). */
      if (api.foot && d === todayISO()) localFootballScan(true);

      /* Replis partiels : aucune donnée foot pour ce jour dans la base
       * (jour non couvert par le job) → scan local ; aucune donnée MMA
       * dans la fenêtre pré-calculée (J-2..J+5) → le chemin local
       * étend le bandeau jusqu'à J+120. */
      if (!api.foot) localFootballScan(false);
      if (!api.mma) void loadMma(run);
      return;
    }

    /* 2. RETOMBÉE 100 % LOCALE — comportement historique intact. */
    localFootballScan(false);

    /* MMA : événements UFC à venir (indépendants de la date) */
    void loadMma(run);
  }, [loadMma]);

  useEffect(() => {
    void load(date);
  }, [date, load]);

  /* miroir : toute montée de pronos (base de pré-calcul, restauration
     locale ou calcul) devient visible pour l'effet de backfill. */
  useEffect(() => {
    predsRef.current = preds;
  }, [preds]);

  /* handlers tirer-pour-rafraîchir — après `load` (closure saine) */
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (mainRef.current && mainRef.current.scrollTop <= 0) pullStartY.current = e.touches[0].clientY;
    else pullStartY.current = null;
  }, []);
  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (pullStartY.current == null) return;
    const dy = e.touches[0].clientY - pullStartY.current;
    if (dy > 0 && mainRef.current && mainRef.current.scrollTop <= 0) {
      setPull(Math.min(dy * 0.45, 80));
    } else {
      setPull(0);
    }
  }, []);
  const onTouchEnd = useCallback(() => {
    const trigger = pull >= 58;
    pullStartY.current = null;
    if (trigger) {
      setRefreshing(true);
      setPull(48);
      void load(date).finally(() => {
        setRefreshing(false);
        setPull(0);
      });
    } else {
      setPull(0);
    }
  }, [pull, date, load]);

  /* ---------- pronos football : base locale d'abord, calcul ensuite ---------- */
  useEffect(() => {
    if (!footData || footData.totalMatches === 0) return;
    const upcoming = footData.leagues
      .flatMap((l) => l.matches.filter((m) => m.status === "pre" && m.leagueCode && m.date))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    if (upcoming.length === 0) return;
    let cancelled = false;

    void (async () => {
      /* 1. RESTAURATION : les pronos déjà calculés (TTL 15 min) sont
         relus depuis la base locale et affichés INSTANTANÉMENT —
         quitter puis rouvrir l'App ne redéclenche AUCUN calcul. */
      const stored = await predDbGetAll<QuickPred>("foot").catch(
        () => ({}) as Record<string, QuickPred>,
      );
      if (cancelled) return;
      const toRestore = upcoming.filter((m) => stored[m.id]);
      if (toRestore.length > 0) {
        setPreds((p) => {
          const next = { ...p };
          for (const m of toRestore) next[m.id] = stored[m.id];
          return next;
        });
        setRestoredCount((n) => Math.max(n, toRestore.length));
      }

      /* 2. CALCUL : uniquement les pronos MANQUANTS (jamais recalculés
         tant que leur entrée en base est encore valide — les pronos de
         la base de pré-calcul sont déjà dans predsRef). */
      const missing = upcoming
        .filter((m) => !stored[m.id] && !predsRef.current[m.id])
        .slice(0, PRED_MAX);
      if (missing.length === 0) return;
      setPredsBusy(true);
      await computeQuickPreds(
        missing.map((m) => ({ id: m.id, leagueCode: m.leagueCode, date: m.date })),
        (pred) => {
          if (cancelled) return;
          setPreds((p) => ({ ...p, [pred.matchId]: pred }));
          void predDbPut("foot", pred.matchId, pred, predTtlMs(pred.status));
        },
      );
      if (!cancelled) setPredsBusy(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [footData]);

  /* ---------- filtres : ligues foot + organisations MMA ---------- */
  const leagueChips = useMemo(() => {
    if (!footData) return [];
    return footData.leagues.map((l) => ({ code: l.code, label: l.shortName || l.code, name: l.name }));
  }, [footData]);

  /* Combats MMA présents sur la date sélectionnée (heure locale).
   * Correctif bug dates : auparavant tous les événements à venir (J-1 -> J+120)
   * s'affichaient quelle que soit la date choisie — un combat du 14 apparaissait
   * le 8. Chaque groupe ne garde que les combats ayant lieu le jour sélectionné. */
  const mmaEventsOnDate = useMemo(() => {
    if (!mmaData) return [];
    return mmaData.events
      .map((g) => ({
        ...g,
        fights: g.fights.filter((f) => localDateKey(f.date) === date),
      }))
      .filter((g) => g.fights.length > 0);
  }, [mmaData, date]);

  const orgChips = useMemo(() => {
    return mmaEventsOnDate
      .filter((e) => e.eventId !== "prospect")
      .map((e) => ({
        code: `mma:${e.eventId}`,
        label: eventCategoryLabel(e.eventName, e.eventDate),
        name: e.eventName,
      }))
      .concat(
        mmaEventsOnDate.some((e) => e.eventId === "prospect")
          ? [{ code: "mma:prospect", label: "Perspectifs", name: "Combats perspectifs" }]
          : [],
      );
  }, [mmaEventsOnDate]);

  /* Prochain événement MMA à venir (bandeau « aucun combat ce jour-là »). */
  const nextMmaEvent = useMemo(() => {
    if (!mmaData) return null;
    const now = Date.now();
    return (
      mmaData.events
        .filter(
          (e) =>
            e.eventId !== "prospect" &&
            new Date(e.eventDate).getTime() >= now - 12 * 3600000 &&
            e.fights.some((f) => f.status !== "post"),
        )
        .sort((a, b) => new Date(a.eventDate).getTime() - new Date(b.eventDate).getTime())[0] ?? null
    );
  }, [mmaData]);

  const groups = useMemo(() => {
    if (!footData) return [];
    if (activeFilter !== "all" && !activeFilter.startsWith("mma:")) {
      const lg = footData.leagues.find((l) => l.code === activeFilter);
      return lg ? [lg] : [];
    }
    if (activeFilter.startsWith("mma:")) return [];
    return footData.leagues;
  }, [footData, activeFilter]);

  const eventGroups = useMemo(() => {
    if (activeFilter.startsWith("mma:")) {
      const eventId = activeFilter.slice(4);
      return mmaEventsOnDate.filter((e) => e.eventId === eventId);
    }
    if (activeFilter !== "all") return [];
    return mmaEventsOnDate;
  }, [mmaEventsOnDate, activeFilter]);

  const openMatch = (m: LightMatch) => onOpenMatch(m.id, m.leagueCode, m.date, m);
  const dt = new Date(`${date}T12:00:00Z`);
  const totalFoot = footData?.totalMatches ?? 0;
  /* combats MMA réellement affichables à la date sélectionnée */
  const totalMma = mmaEventsOnDate.reduce(
    (n, g) => n + (g.eventId === "prospect" ? 0 : g.fights.length),
    0,
  );

  return (
    <div className="relative h-full bg-ink">
      {/* ============ CONTENU DÉFILANT (pleine hauteur, sous l'en-tête) ============ */}
      <main
        ref={mainRef}
        onScroll={handleScroll}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        className="no-scrollbar absolute inset-0 overflow-y-auto overscroll-contain px-5 pb-28 pt-[176px]"
      >
        {/* indicateur tirer-pour-rafraîchir */}
        <div
          aria-hidden={pull < 8 && !refreshing}
          className={`pointer-events-none absolute inset-x-0 z-10 flex justify-center transition-opacity duration-150 ${
            pull >= 8 || refreshing ? "opacity-100" : "opacity-0"
          }`}
          style={{ top: Math.max(8, pull - 34) }}
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-ink-2/90 ring-1 ring-white/10 backdrop-blur">
            <RefreshCw
              size={15}
              strokeWidth={2.4}
              className={`text-neon ${refreshing ? "animate-spin" : ""}`}
              style={!refreshing ? { transform: `rotate(${Math.min(280, pull * 4)}deg)` } : undefined}
            />
          </span>
        </div>

        <div
          style={{
            transform: pull > 0 ? `translateY(${pull}px)` : undefined,
            transition: pull > 0 ? "none" : "transform 0.25s ease-out",
          }}
        >
        <div className="flex items-center justify-between">
          <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-white/45">
            <CalendarDays size={12} strokeWidth={2.4} />
            {dt.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}
          </p>
          {loading && footData ? (
            <span className="text-[9.5px] font-bold uppercase tracking-widest text-neon">
              Scan des ligues en cours…
            </span>
          ) : predsBusy ? (
            <span className="text-[9.5px] font-bold uppercase tracking-widest text-neon">
              Moteur en analyse…
            </span>
          ) : restoredCount > 0 ? (
            <span
              className="rounded-full bg-white/5 px-2 py-0.5 text-[8.5px] font-bold uppercase tracking-widest text-white/45 ring-1 ring-white/10"
              title={"Pronostics relus depuis la base locale de l\u2019app — aucun recalcul nécessaire."}
            >
              ⚡ {restoredCount} prono{restoredCount > 1 ? "s" : ""} restauré{restoredCount > 1 ? "s" : ""} · base locale
            </span>
          ) : null}
        </div>

        {/* Rendu progressif : les squelettes ne couvrent que le tout
            début — dès la 1re vague reçue (onProgress → footData), les
            matchs s'affichent pendant que le scan continue. */}
        {loading && !footData ? (
          <div className="space-y-5 pt-2">
            <CardSkeleton />
            <CardSkeleton />
            <CardSkeleton />
          </div>
        ) : error ? (
          <ErrorPanel message={error} onRetry={() => void load(date)} />
        ) : (
          <div className="space-y-5 pt-2">
            {/* ---------- sections football ---------- */}
            {groups.map((lg) => (
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
                    />
                  ))}
                </div>
              </section>
            ))}

            {/* ---------- pas de combat MMA à cette date : prochain événement ---------- */}
            {mmaData &&
            eventGroups.length === 0 &&
            nextMmaEvent &&
            (activeFilter === "all" || activeFilter.startsWith("mma:")) ? (
              <button
                onClick={() => setDate(localDateKey(nextMmaEvent.eventDate))}
                className="mb-1 flex w-full items-center gap-3 rounded-2xl bg-panel px-4 py-3 text-left shadow-[0_10px_24px_rgba(0,0,0,0.35)] transition-transform active:scale-[0.98]"
              >
                <span className="text-[20px] leading-none">🥊</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[11px] font-bold text-white/85">
                    Aucun combat MMA le{" "}
                    {dt.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}.
                  </span>
                  <span className="block truncate text-[10px] font-semibold text-white/50">
                    Prochain : {nextMmaEvent.eventName} — {dayLabel(nextMmaEvent.eventDate)}
                  </span>
                </span>
                <span className="shrink-0 rounded-full bg-neon px-2.5 py-1 text-[9px] font-black uppercase tracking-wide text-black">
                  Voir
                </span>
              </button>
            ) : null}

            {/* ---------- sections MMA (catégories d'événements UFC) ---------- */}
            {eventGroups.map((ev) => (
              <section key={ev.eventId} aria-label={ev.eventName}>
                <div className="mb-2.5 flex items-center gap-2">
                  <span className="h-[3px] w-4 rounded-full bg-neon" />
                  <h2 className="min-w-0 flex-1 truncate text-[11px] font-black uppercase tracking-[0.14em] text-white/70">
                    {ev.eventId === "prospect" ? "Arts martiaux mixtes · Combats perspectifs" : ev.eventName}
                  </h2>
                  <span className="shrink-0 text-[9px] font-bold text-white/30">
                    {ev.eventId === "prospect"
                      ? `${ev.fights.length}`
                      : `${new Date(ev.eventDate).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" })} · ${ev.fights.length}`}
                  </span>
                </div>
                <div className="space-y-4">
                  {ev.fights.map((f) => (
                    <FightCard
                      key={`${ev.eventId}-${f.id}`}
                      fight={f}
                      pred={f.prospect ? undefined : mmaPreds[f.id]}
                      onOpen={() => onOpenFight(f.id)}
                    />
                  ))}
                </div>
              </section>
            ))}

            {/* ---------- vide (jamais pendant le scan progressif) ---------- */}
            {!loading && groups.length === 0 && eventGroups.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-14 text-center">
                <span className="text-[32px]">🏟️</span>
                <p className="text-[12px] font-semibold text-white/50">
                  Aucun match ni combat programmé pour cette date.
                </p>
                <p className="max-w-[260px] text-[10.5px] leading-relaxed text-white/35">
                  Les données arrivent directement d&apos;ESPN — change de date avec le sélecteur en haut.
                </p>
              </div>
            ) : null}

            {predsBusy && groups.length > 0 ? (
              <LoadingPanel label="Le moteur VOLTRIX analyse les matchs à venir…" />
            ) : null}

            <p className="pt-2 text-center text-[8.5px] font-bold uppercase tracking-widest text-white/25">
              Données ESPN · calculs 100 % locaux · tirez pour rafraîchir
            </p>
          </div>
        )}
      </div>
      </main>

      {/* ============ EN-TÊTE EN SURIMPENSION ============
          Déplié (haut de page) : logo + sélecteur de date + ligues.
          Replié (défilement) : seul le logo flotte — aucun fond,
          aucune bande. Toucher le logo ramène en haut. */}
      <header className="pointer-events-none absolute inset-x-0 top-0 z-40">
        {/* logo — toujours visible, sans fond */}
        <div className="pointer-events-auto flex items-start justify-between px-5 pt-6">
          <button
            onClick={scrollToTop}
            aria-label="VOLTRIX — revenir en haut"
            className="flex items-center gap-2.5 rounded-full"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo.png"
              alt="VOLTRIX"
              className={`rounded-2xl object-contain drop-shadow-[0_4px_16px_rgba(198,242,17,0.25)] transition-all duration-300 ease-out ${
                headerCollapsed ? "h-11 w-11" : "h-12 w-12"
              }`}
            />
          </button>
          <button
            onClick={() => void load(date)}
            aria-label="Rafraîchir"
            className={`pointer-events-auto mt-0.5 flex h-9 w-9 items-center justify-center rounded-full bg-ink-3/90 text-white backdrop-blur transition-all duration-300 ease-out hover:bg-neon hover:text-black ${
              headerCollapsed ? "pointer-events-none scale-75 opacity-0" : "opacity-100"
            }`}
          >
            <RefreshCw size={15} strokeWidth={2.2} className={loading ? "animate-spin" : ""} />
          </button>
        </div>

        {/* dates + ligues — se replient au défilement (hors flux : aucun saut) */}
        <div
          aria-hidden={headerCollapsed}
          className={`pointer-events-auto grid transition-[grid-template-rows,opacity,transform] duration-300 ease-out ${
            headerCollapsed
              ? "invisible pointer-events-none grid-rows-[0fr] -translate-y-3 opacity-0"
              : "grid-rows-[1fr] translate-y-0 opacity-100"
          } mt-3`}
        >
          <div className="overflow-hidden">
            <DateStrip value={date} onChange={changeDate} />
            {leagueChips.length > 0 || orgChips.length > 0 ? (
              <div className="no-scrollbar mt-2 flex gap-1.5 overflow-x-auto px-5 pb-1">
                <button
                  onClick={() => setActiveFilter("all")}
                  aria-pressed={activeFilter === "all"}
                  className={`whitespace-nowrap rounded-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide transition-colors ${
                    activeFilter === "all" ? "bg-neon text-black" : "bg-ink-3 text-white hover:bg-[#383838]"
                  }`}
                >
                  Tous · {totalFoot + totalMma}
                </button>
                {leagueChips.map((l) => (
                  <button
                    key={l.code}
                    onClick={() => setActiveFilter(l.code)}
                    aria-pressed={activeFilter === l.code}
                    title={l.name}
                    className={`whitespace-nowrap rounded-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide transition-colors ${
                      activeFilter === l.code ? "bg-neon text-black" : "bg-ink-3 text-white hover:bg-[#383838]"
                    }`}
                  >
                    {l.label}
                  </button>
                ))}
                {orgChips.map((o) => (
                  <button
                    key={o.code}
                    onClick={() => setActiveFilter(o.code)}
                    aria-pressed={activeFilter === o.code}
                    title={o.name}
                    className={`whitespace-nowrap rounded-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide transition-colors ${
                      activeFilter === o.code ? "bg-neon text-black" : "bg-ink-3 text-white hover:bg-[#383838]"
                    }`}
                  >
                    🥊 {o.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </header>
    </div>
  );
}
