"use client";

/* ============================================================
   VOLTRIX app — Détail match football (données réelles ESPN)
   Héro illustré par la photo du stade réel où se joue le match.
   Au défilement, le héros s'évacue et une barre compacte —
   logos + heure — prend le relais.
   Analyse 100 % locale : moteur Poisson/Elo/Forme du dépôt
   VOLTRIX-bet, alimenté en direct par ESPN (aucune base).
   Compos : réelles si publiées, sinon celles du match précédent
   de chaque équipe — jamais inventées.
   ============================================================ */

import { useCallback, useEffect, useMemo, useRef, useState, type UIEvent } from "react";
import { motion } from "framer-motion";
import {
  ChevronDown,
  ChevronLeft,
  Loader2,
  MapPin,
  RefreshCw,
  TrendingUp,
  Umbrella,
} from "lucide-react";
import { oddsFmt, pct, timeLabel } from "@/lib/voltrix";
import { analyzeFootballMatch, type FootballDetail } from "@/lib/foot/bridge";
import {
  loadMatchLineups,
  type MatchLineups,
  type TeamLineup,
} from "@/lib/foot/lineups";
import { stadiumImageFor } from "@/lib/stadiums";
import type { LightMatch } from "@/lib/voltrix-types";
import { TeamBadge } from "./TeamBadge";
import {
  EdgeChip,
  ErrorPanel,
  FormDots,
  KpiTile,
  LoadingPanel,
  ProbBar,
  SectionTitle,
  confidenceStars,
} from "./ui-bits";

type TabId = "synthese" | "marches" | "h2h" | "contexte" | "compos";

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "synthese", label: "Synthèse" },
  { id: "marches", label: "Marchés" },
  { id: "h2h", label: "H2H" },
  { id: "contexte", label: "Contexte" },
  { id: "compos", label: "Compos" },
];

/* Seuil de défilement (px) au-delà duquel le héros est considéré
   comme parti et la barre compacte apparaît. */
const COMPACT_THRESHOLD = 170;
/** hauteur de la barre compacte (décalage des onglets collants) */
const COMPACT_H = 52;

/* ---------- Bloc composante moteur ---------- */
function ComponentRow({ name, probs, note }: { name: string; probs: { home: number; draw: number; away: number }; note?: string }) {
  return (
    <div className="rounded-2xl bg-black/30 px-3.5 py-3">
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
function Pitch({ team }: { team: TeamLineup }) {
  const rows: Record<string, TeamLineup["starters"][number][]> = { G: [], D: [], M: [], F: [] };
  team.starters.forEach((p) => {
    const k = p.position ?? "M";
    if (!rows[k]) rows[k] = [];
    rows[k].push(p);
  });
  const order = ["F", "M", "D", "G"];
  return (
    <div className="rounded-3xl bg-pitch p-3 ring-1 ring-white/10">
      <div className="relative flex aspect-[3/4] w-full flex-col justify-between rounded-2xl border-2 border-pitch-line bg-[linear-gradient(rgba(255,255,255,0.045)_1px,transparent_1px)] bg-[length:100%_12.5%]">
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
}: {
  matchId: string;
  leagueCode: string;
  date: string;
  light?: LightMatch;
  onBack: () => void;
}) {
  const [detail, setDetail] = useState<FootballDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>("synthese");
  const [lineups, setLineups] = useState<MatchLineups | null>(null);
  const [lineupsLoading, setLineupsLoading] = useState(false);

  /* héros parti → barre compacte visible */
  const [compact, setCompact] = useState(false);
  const handleScroll = useCallback((e: UIEvent<HTMLDivElement>) => {
    setCompact(e.currentTarget.scrollTop > COMPACT_THRESHOLD);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await analyzeFootballMatch(matchId, leagueCode, date);
      if (!res) throw new Error("Match introuvable dans les données ESPN.");
      setDetail(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analyse indisponible");
    } finally {
      setLoading(false);
    }
  }, [matchId, leagueCode, date]);

  useEffect(() => {
    void load();
  }, [load]);

  /* compos : réelles si publiées, sinon celles du match précédent.
     Règle produit (2026-11-09) : après le coup d'envoi, on RECHERCHE
     les compositions officielles — l'état « match précédent » est
     invalidé dès que le match passe en direct/terminé, et l'onglet
     re-consulté relance la lecture (polling 60 s pendant le direct). */
  const lineupsStartedRef = useRef<string | null>(null);
  useEffect(() => {
    if (tab !== "compos" || !detail) return;
    /* clé d'invalidation : match + phase (pré-match vs après coup d'envoi) */
    const phase = detail.status === "pre" ? "pre" : "live";
    const key = `${matchId}:${phase}`;
    if (lineupsStartedRef.current === key) return;
    lineupsStartedRef.current = key;
    setLineupsLoading(true);
    const ctx = {
      matchDate: detail.matchDate,
      homeTeamId: detail.home.id,
      awayTeamId: detail.away.id,
      homeName: detail.home.name,
      awayName: detail.away.name,
      homeLogo: detail.home.logo,
      awayLogo: detail.away.logo,
    };
    loadMatchLineups(matchId, leagueCode, ctx)
      .then((r) => setLineups(r))
      .catch(() => setLineups(null))
      .finally(() => setLineupsLoading(false));
  }, [tab, detail, matchId, leagueCode]);

  /* pendant un match EN DIRECT avec compos non publiées : re-vérification
     toutes les 60 s tant que l'onglet Compos est ouvert (les onze
     officiels tombent généralement 20-40 min avant le coup d'envoi, mais
     ESPN peut publier en retard) */
  useEffect(() => {
    if (tab !== "compos" || detail?.status !== "in" || lineups?.published || !detail) return;
    const t = setInterval(() => {
      const ctx = {
        matchDate: detail.matchDate,
        homeTeamId: detail.home.id,
        awayTeamId: detail.away.id,
        homeName: detail.home.name,
        awayName: detail.away.name,
        homeLogo: detail.home.logo,
        awayLogo: detail.away.logo,
      };
      loadMatchLineups(matchId, leagueCode, ctx)
        .then((r) => {
          if (r?.published) setLineups(r); // seul l'OFFICIEL remplace l'affichage
        })
        .catch(() => null);
    }, 60000);
    return () => clearInterval(t);
  }, [tab, detail, matchId, leagueCode, lineups?.published]);

  /* Onglet Compos : équipe affichée */
  const [composSide, setComposSide] = useState<"home" | "away">("home");

  const pred = detail?.prediction;
  const bestPick = useMemo(() => pred?.recommendedBets[0] ?? null, [pred]);

  const live = detail?.status === "in" || light?.status === "in";
  const hasScore = detail && detail.homeScore != null && detail.awayScore != null;

  const homeName = detail?.home.name ?? light?.home.name ?? "?";
  const awayName = detail?.away.name ?? light?.away.name ?? "?";
  const homeShort = (light?.home.shortName ?? detail?.home.name ?? "Domicile").slice(0, 10);
  const awayShort = (light?.away.shortName ?? detail?.away.name ?? "Extérieur").slice(0, 10);

  /* Photo du stade où se joue le match : stade de l'équipe domicile */
  const stadiumImg = useMemo(
    () =>
      stadiumImageFor(
        detail?.venue.name ?? light?.venue.name,
        homeName,
        light?.home.shortName,
      ),
    [detail?.venue.name, light?.venue.name, homeName, light?.home.shortName],
  );

  /* heure/score affiché dans la barre compacte */
  const compactCenter = hasScore
    ? `${detail!.homeScore} : ${detail!.awayScore}`
    : detail
      ? timeLabel(detail.matchDate)
      : light
        ? timeLabel(light.date)
        : "--:--";

  /* Segments 1X2 pour la barre unique */
  const segments = useMemo(() => {
    if (!pred) return [];
    return [
      {
        id: "home" as const,
        value: pred.probs.home,
        label: homeShort,
        odds: light?.mlHome ?? detail?.odds?.moneyline.home.close ?? null,
      },
      {
        id: "draw" as const,
        value: pred.probs.draw,
        label: "Nul",
        odds: light?.mlDraw ?? detail?.odds?.moneyline.draw.close ?? null,
      },
      {
        id: "away" as const,
        value: pred.probs.away,
        label: awayShort,
        odds: light?.mlAway ?? detail?.odds?.moneyline.away.close ?? null,
      },
    ];
  }, [pred, light, detail, homeShort, awayShort]);

  const teamBlock = (t: NonNullable<FootballDetail["home"]>) => (
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
    </div>
  );

  const backBtn = (
    <button
      onClick={onBack}
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink-3/90 text-white backdrop-blur transition-colors hover:bg-neon hover:text-black"
      aria-label="Retour"
    >
      <ChevronLeft size={18} strokeWidth={2.4} />
    </button>
  );

  const refreshBtn = (
    <button
      onClick={() => void load()}
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink-3/90 text-white backdrop-blur transition-colors hover:bg-neon hover:text-black"
      aria-label="Réanalyser"
    >
      <RefreshCw size={15} strokeWidth={2.2} className={loading ? "animate-spin" : ""} />
    </button>
  );

  return (
    <div className="relative flex h-full flex-col bg-ink">
      {/* ============ BARRE COMPACTE — apparaît quand le héros a défilé ============ */}
      <div
        aria-hidden={!compact}
        className={`absolute inset-x-0 top-0 z-40 transition-transform duration-300 ease-out ${
          compact ? "translate-y-0" : "-translate-y-full"
        }`}
      >
        <div
          className="flex items-center gap-2.5 border-b border-white/10 bg-ink/95 px-4 pb-2 backdrop-blur"
          style={{ paddingTop: "max(env(safe-area-inset-top), 8px)" }}
        >
          {backBtn}
          <TeamBadge name={homeName} logo={light?.home.logo ?? detail?.home.logo ?? null} size={30} />
          <div className="min-w-0 flex-1 text-center">
            <p className="font-display text-[17px] leading-none tracking-wide text-white">{compactCenter}</p>
            <p className="mt-0.5 truncate text-[8px] font-bold uppercase tracking-widest text-white/40">
              {detail?.leagueName ?? light?.leagueName ?? leagueCode}
              {live ? " · Live" : ""}
            </p>
          </div>
          <TeamBadge name={awayName} logo={light?.away.logo ?? detail?.away.logo ?? null} size={30} />
          {refreshBtn}
        </div>
      </div>

      {/* ============ ZONE DÉFILANTE UNIQUE : héros puis contenu ============ */}
      <div onScroll={handleScroll} className="no-scrollbar flex-1 overflow-y-auto">
        {/* ---------- HÉROS : photo du stade du match + voile sombre ---------- */}
        <div className="relative shrink-0">
          <div className="absolute inset-0 overflow-hidden" aria-hidden="true">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={stadiumImg}
              alt=""
              className="h-full w-full object-cover object-center"
            />
            <div className="absolute inset-0 bg-gradient-to-b from-ink/75 via-ink/40 to-ink" />
          </div>

          {/* barre supérieure */}
          <header className="relative flex items-center justify-between px-5 pt-6">
            {backBtn}
            <div className="flex min-w-0 items-center gap-2">
              <span className="max-w-[150px] truncate text-[10px] font-black uppercase tracking-widest text-white/80">
                {detail?.leagueName ?? light?.leagueName ?? leagueCode}
              </span>
              {live ? (
                <span className="flex items-center gap-1 rounded-full bg-neon px-2.5 py-1 text-[9px] font-black uppercase text-black">
                  <span className="live-dot h-1.5 w-1.5 rounded-full bg-black" />
                  Live
                </span>
              ) : (
                <span className="rounded-full bg-ink-3/90 px-2.5 py-1 text-[9px] font-black uppercase tracking-wide text-white/70 backdrop-blur">
                  {detail?.status === "post" ? "Terminé" : "À venir"}
                </span>
              )}
            </div>
            {refreshBtn}
          </header>

          {/* équipes + score */}
          <div className="relative mt-2 grid grid-cols-[1fr_auto_1fr] items-center px-6 pb-4 pt-1">
            <div className="flex flex-col items-center gap-1.5">
              <TeamBadge name={homeName} logo={light?.home.logo ?? detail?.home.logo ?? null} size={56} />
              <span className="max-w-[104px] text-center text-[8.5px] font-extrabold leading-[1.3] tracking-wide text-white">
                {homeName.toUpperCase()}
              </span>
            </div>
            <div className="mx-3 min-w-[88px] px-1 text-center">
              {hasScore ? (
                <>
                  <span className="font-display text-[36px] leading-none tracking-wide text-white">
                    {detail!.homeScore}:{detail!.awayScore}
                  </span>
                  <span className="mt-1 block text-[8.5px] font-semibold uppercase tracking-widest text-white/50">
                    {detail?.statusDetail || "FT"}
                  </span>
                </>
              ) : (
                <>
                  <span className="font-display text-[28px] leading-none tracking-wide text-white">
                    {detail ? timeLabel(detail.matchDate) : light ? timeLabel(light.date) : "--:--"}
                  </span>
                  <span className="mt-1 block text-[8.5px] font-semibold uppercase tracking-widest text-white/50">
                    Coup d&apos;envoi
                  </span>
                </>
              )}
            </div>
            <div className="flex flex-col items-center gap-1.5">
              <TeamBadge name={awayName} logo={light?.away.logo ?? detail?.away.logo ?? null} size={56} />
              <span className="max-w-[104px] text-center text-[8.5px] font-extrabold leading-[1.3] tracking-wide text-white">
                {awayName.toUpperCase()}
              </span>
            </div>
          </div>

          {/* lieu */}
          <div className="relative flex justify-center pb-3">
            <span className="inline-flex max-w-[85%] items-center gap-1.5 rounded-full bg-ink-3/80 px-3 py-1 text-[9px] font-bold uppercase tracking-wide text-white/70 backdrop-blur">
              <MapPin size={10} strokeWidth={2.4} className="shrink-0 text-neon" />
              <span className="truncate">
                {detail?.venue.name ?? light?.venue.name ?? "Stade"}
                {detail?.venue.city ? ` · ${detail.venue.city}` : ""}
              </span>
            </span>
          </div>
        </div>

        {/* ---------- CONTENU ---------- */}
        {loading ? (
          <LoadingPanel label="Le moteur VOLTRIX analyse le match…" />
        ) : error || !detail || !pred ? (
          <ErrorPanel message={error ?? "Analyse indisponible"} onRetry={() => void load()} />
        ) : (
          <main className="px-5 pb-14">
            {/* ---------- PRONO DU MOTEUR : une carte, une hiérarchie ---------- */}
            <section className="rounded-[26px] bg-neon px-5 pb-4 pt-4 text-black">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[9px] font-black uppercase tracking-[0.2em] text-black/50">Prono du moteur</p>
                <span className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-wider text-black/70">
                  <span title={`Confiance ${pred.confidence}/5`}>{confidenceStars(pred.confidence)}</span>
                  {pred.confidenceLabel}
                </span>
              </div>

              <p className="mt-1 font-display text-[25px] leading-tight tracking-wide text-black">
                {bestPick ? bestPick.pick.toUpperCase() : "—"}
              </p>
              <p className="mt-0.5 text-[10.5px] font-bold text-black/60">
                {bestPick ? `${bestPick.market} · probabilité ${pct(bestPick.prob)}` : ""}
              </p>

              {/* barre 1X2 segmentée : largeur = probabilité */}
              <div
                className="mt-3.5 flex h-[46px] overflow-hidden rounded-2xl bg-black/15"
                role="img"
                aria-label={`Probabilités : ${homeShort} ${Math.round(pred.probs.home * 100)} %, nul ${Math.round(pred.probs.draw * 100)} %, ${awayShort} ${Math.round(pred.probs.away * 100)} %`}
              >
                {segments.map((s, i) => {
                  const best = s.value >= Math.max(...segments.map((x) => x.value));
                  return (
                    <div
                      key={s.id}
                      className={`flex min-w-0 flex-col items-center justify-center gap-[3px] border-black/10 px-1 ${
                        i > 0 ? "border-l" : ""
                      } ${best ? "bg-black text-neon" : "text-black/75"}`}
                      style={{ flexGrow: Math.max(0.09, s.value) }}
                    >
                      <span className="w-full truncate text-center text-[8px] font-bold uppercase tracking-wider opacity-70">
                        {s.odds != null ? `${s.label} ${s.odds.toFixed(2)}` : s.label}
                      </span>
                      <span className="text-[14px] font-black leading-none">{Math.round(s.value * 100)}%</span>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* ---------- onglets (décalés sous la barre compacte quand visible) ---------- */}
            <div
              className={`no-scrollbar sticky z-20 -mx-5 mt-4 flex gap-1.5 overflow-x-auto bg-ink/95 px-5 py-2 backdrop-blur transition-[top] duration-300 ease-out ${
                compact ? "" : "top-0"
              }`}
              style={compact ? { top: `${COMPACT_H}px` } : undefined}
            >
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
              {/* ---------------- SYNTHÈSE ---------------- */}
              {tab === "synthese" ? (
                <div>
                  <SectionTitle>En bref</SectionTitle>
                  <div className="grid grid-cols-3 gap-2">
                    <KpiTile
                      label="Favori"
                      value={`${(pred.probs.home >= pred.probs.away ? homeShort : awayShort).slice(0, 6)} ${pct(Math.max(pred.probs.home, pred.probs.away))}`}
                    />
                    <KpiTile label="Buts attendus" value={pred.lambda.total.toFixed(1)} tone="neon" />
                    <KpiTile
                      label="Score clé"
                      value={pred.topScores[0]?.score ?? "—"}
                    />
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
                  {/* ---- carte titre : minute attendue (moteur dédié) ---- */}
                  {pred.firstGoalHeadline ? (
                    <div className="mb-3 rounded-2xl bg-ink-3 px-3.5 py-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[9px] font-black uppercase tracking-widest text-white/40">
                          1er but attendu
                        </p>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[8px] font-black uppercase tracking-wide ${
                            pred.firstGoalHeadline.basis === "equipes"
                              ? "bg-neon/15 text-neon"
                              : "bg-white/10 text-white/50"
                          }`}
                        >
                          {pred.firstGoalHeadline.basis === "equipes"
                            ? `${pred.firstGoalHeadline.sampleMatches} matchs réels`
                            : "profil de ligue"}
                        </span>
                      </div>
                      {pred.firstGoalHeadline.expectedMinute != null ? (
                        <>
                          <p className="mt-1 font-display text-[30px] leading-none tracking-wide text-white">
                            <span className="text-neon">{pred.firstGoalHeadline.expectedMinute}</span>
                            <span className="ml-1 text-[14px] font-bold text-white/60">
                              e minute
                            </span>
                          </p>
                          <p className="mt-1 text-[9.5px] font-semibold text-white/50">
                            Fenêtre la plus probable : {pred.firstGoalTiming[pred.firstGoalHeadline.bestWindow]?.label} (
                            {pct(pred.firstGoalHeadline.bestWindowProb, 1)})
                          </p>
                        </>
                      ) : (
                        <p className="mt-1 text-[12px] font-bold leading-snug text-white/80">
                          Match très fermé : {pct(pred.firstGoalHeadline.noGoalProb)} de risque de 0-0 —
                          le 1er but n&apos;est pas garanti.
                        </p>
                      )}
                      {pred.firstGoalHeadline.basis === "equipes" &&
                      (pred.firstGoalHeadline.homeMedianMinute != null || pred.firstGoalHeadline.awayMedianMinute != null) ? (
                        <div className="mt-2.5 grid grid-cols-2 gap-2">
                          {[
                            { name: detail.home.name, med: pred.firstGoalHeadline.homeMedianMinute },
                            { name: detail.away.name, med: pred.firstGoalHeadline.awayMedianMinute },
                          ].map((t) => (
                            <div key={t.name} className="rounded-xl bg-black/40 px-2.5 py-2">
                              <p className="truncate text-[8px] font-bold uppercase tracking-wider text-white/35">
                                {t.name}
                              </p>
                              <p className="mt-0.5 text-[10.5px] font-black text-white/85">
                                {t.med != null ? (
                                  <>
                                    1er but médian <span className="text-neon">{t.med}e</span>
                                  </>
                                ) : (
                                  "—"
                                )}
                              </p>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="space-y-1.5">
                    {pred.firstGoalTiming.map((w, i) => (
                      <div
                        key={w.window}
                        className={`flex items-center gap-3 rounded-2xl px-3.5 py-2 ${
                          pred.firstGoalHeadline && i === pred.firstGoalHeadline.bestWindow
                            ? "bg-ink-3 ring-1 ring-neon/40"
                            : "bg-ink-3"
                        }`}
                      >
                        <span className="w-[110px] text-[9.5px] font-bold text-white/60">{w.label}</span>
                        <div className="h-[6px] flex-1 overflow-hidden rounded-full bg-black/50">
                          <div
                            className={`h-full rounded-full ${pred.firstGoalHeadline && i === pred.firstGoalHeadline.bestWindow ? "bg-neon" : "bg-white/70"}`}
                            style={{ width: `${Math.min(100, w.prob * 300)}%` }}
                          />
                        </div>
                        <span className="w-11 text-right text-[11px] font-black text-white/80">{pct(w.prob, 1)}</span>
                      </div>
                    ))}
                    <p className="text-[8.5px] leading-relaxed text-white/35">
                      {pred.firstGoalTiming[0]?.basis === "equipes"
                        ? `Moteur dédié : minutes réelles des 1ers buts des ${pred.firstGoalTiming[0]?.sampleMatches ?? 0} derniers matchs de ${detail.home.name} et ${detail.away.name} (summaries ESPN), fusionnées puis mises à l'échelle sur les buts attendus du match (λ ×${pred.firstGoalHeadline?.lambdaScale ?? 1}).`
                        : "Minutes des 1ers buts indisponibles chez ESPN pour ces équipes : calcul sur le profil empirique de ligue (échantillon documenté dans le moteur)."}
                    </p>
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

                  {/* détail du calcul : replié par défaut */}
                  <details className="group mt-6 rounded-2xl bg-ink-3">
                    <summary className="flex cursor-pointer select-none list-none items-center justify-between px-4 py-3 [&::-webkit-details-marker]:hidden">
                      <span className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.14em] text-white/70">
                        <span className="h-[3px] w-3.5 rounded-full bg-neon" aria-hidden="true" />
                        Détail du calcul
                      </span>
                      <ChevronDown size={15} strokeWidth={2.6} className="shrink-0 text-white/50 transition-transform duration-200 group-open:rotate-180" />
                    </summary>
                    <div className="space-y-2.5 px-3 pb-3">
                      <ComponentRow name="VOLTRIX (final)" probs={pred.probs} note="calibré" />
                      <ComponentRow name="Poisson" probs={pred.poisson} note="buts attendus" />
                      <ComponentRow name="Elo" probs={pred.elo} note="force relative" />
                      <ComponentRow name="Forme" probs={pred.form} note="5 derniers" />
                      <div className="grid grid-cols-3 gap-2">
                        {[
                          { k: detail.home.name, v: pred.lambda.home },
                          { k: "Total", v: pred.lambda.total },
                          { k: detail.away.name, v: pred.lambda.away },
                        ].map((x) => (
                          <div key={x.k} className="rounded-2xl bg-black/30 px-2 py-2.5 text-center">
                            <p className="truncate text-[8.5px] font-bold uppercase tracking-wider text-white/40">{x.k}</p>
                            <p className="mt-1 text-[17px] font-black text-neon">λ {x.v.toFixed(2)}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </details>
                </div>
              ) : null}

              {/* ---------------- MARCHÉS (value bets d'abord) ---------------- */}
              {tab === "marches" ? (
                <div>
                  <SectionTitle
                    right={
                      pred.valueBets.length ? (
                        <span className="rounded-full bg-neon px-2 py-0.5 text-[8.5px] font-black uppercase text-black">
                          {pred.valueBets.length} value
                        </span>
                      ) : undefined
                    }
                  >
                    Value bets (edge / Kelly)
                  </SectionTitle>
                  {pred.valueBets.length === 0 ? (
                    <p className="rounded-2xl bg-ink-3 px-4 py-3 text-[10.5px] font-semibold text-white/45">
                      {detail.odds?.hasOdds
                        ? "Aucune value bet détectée — le marché est aligné avec le modèle."
                        : "Pas de cotes publiées par ESPN pour ce match : les value bets nécessitent une cote de référence."}
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {pred.valueBets.map((vb, i) => (
                        <div key={i} className="rounded-2xl bg-ink-3 px-3.5 py-3">
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
                        </div>
                      ))}
                    </div>
                  )}

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
                              <span className="rounded-full bg-neon px-2.5 py-1 text-[8.5px] font-black uppercase tracking-wider text-black">
                                {ou.over >= 0.5 ? "Plus de 2.5" : "Moins de 2.5"} · {pct(Math.max(ou.over, ou.under))}
                              </span>
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
                    <ProbBar label="BTTS Oui" value={pred.btts.yes} />
                    <ProbBar label="BTTS Non" value={pred.btts.no} />
                  </div>
                  {pred.raw ? (
                    <p className="mt-2 text-[9px] leading-relaxed text-white/35">
                      Probabilités brutes (pré-calibrage marché) : Over {pct(pred.raw.overUnder[0]?.over, 1)} · BTTS Oui {pct(pred.raw.btts.yes, 1)}. La calibration marché s&apos;applique aux totals.
                    </p>
                  ) : null}

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
                  <SectionTitle>Confrontations</SectionTitle>
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
                  {detail.h2h.length === 0 ? (
                    <p className="rounded-2xl bg-ink-3 px-4 py-3 text-[10.5px] font-semibold text-white/45">
                      Aucune confrontation sur les deux dernières saisons (calendriers ESPN).
                    </p>
                  ) : (
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
                  )}
                  <p className="mt-3 text-[9px] leading-relaxed text-white/30">
                    Historique lu dans les calendriers ESPN des deux équipes (2 saisons) — comptage par identifiant d&apos;équipe, les deux ordres domicile/extérieur.
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
                      <SectionTitle>Météo</SectionTitle>
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
                    {teamBlock(detail.home)}
                    {teamBlock(detail.away)}
                  </div>

                  {/* carte stade illustrée — même photo que le héros */}
                  <SectionTitle>Stade</SectionTitle>
                  <div className="overflow-hidden rounded-2xl bg-ink-3">
                    <div className="relative h-24">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={stadiumImg}
                        alt={detail.venue.name ?? "Stade du match"}
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-ink-3 via-ink-3/30 to-transparent" />
                    </div>
                    <div className="px-3.5 pb-3 pt-1">
                      <p className="text-[11.5px] font-black text-white">
                        {detail.venue.name ?? "Stade inconnu"}
                      </p>
                      <p className="mt-0.5 text-[9.5px] font-semibold text-white/45">
                        {[detail.venue.city, detail.venue.country].filter(Boolean).join(", ") || "Lieu non communiqué"}
                      </p>
                    </div>
                  </div>
                </div>
              ) : null}

              {/* ---------------- COMPOS (réelles ou match précédent) ---------------- */}
              {tab === "compos" ? (
                <div>
                  {lineupsLoading ? (
                    <LoadingPanel label="Lecture des compositions sur ESPN…" />
                  ) : !lineups || (!lineups.home && !lineups.away) ? (
                    <ErrorPanel message="Compositions indisponibles : ni publiées pour ce match, ni trouvées dans le dernier match de chaque équipe." />
                  ) : (
                    <div>
                      {/* bannière d'honnêteté */}
                      {lineups.published ? (
                        <p className="mt-2 rounded-2xl bg-neon/10 px-3.5 py-2.5 text-[9.5px] font-semibold leading-relaxed text-neon ring-1 ring-neon/30">
                          Compositions officielles publiées par ESPN pour ce match.
                        </p>
                      ) : (
                        <p className="mt-2 rounded-2xl bg-black/50 px-3.5 py-2.5 text-[9.5px] font-semibold leading-relaxed text-white/55 ring-1 ring-white/10">
                          Compositions du match non encore publiées par ESPN (environ 20 à 40 minutes avant le coup
                          d&apos;envoi). En attente, VOLTRIX affiche celles du <span className="text-white">match
                          précédent</span> de chaque équipe — aucune n&apos;est inventée.
                        </p>
                      )}

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
                              {t?.name ?? s}
                            </button>
                          );
                        })}
                      </div>

                      {(() => {
                        const t = composSide === "home" ? lineups.home : lineups.away;
                        if (!t) return null;
                        return (
                          <div className="mt-3">
                            <div className="mb-2.5 flex items-center justify-between gap-2">
                              <span className="text-[10px] font-black uppercase tracking-widest text-white/60">
                                {t.formation ? `Formation ${t.formation}` : "Formation non publiée"}
                              </span>
                              {t.source === "previous" && t.previousLabel ? (
                                <span className="max-w-[190px] truncate rounded-full bg-ink-3 px-2.5 py-1 text-[8.5px] font-black uppercase tracking-wide text-white/50" title={t.previousLabel}>
                                  Match préc. · {t.previousLabel}
                                </span>
                              ) : null}
                            </div>
                            {t.starters.length > 0 ? (
                              <Pitch team={t} />
                            ) : (
                              <p className="rounded-2xl bg-ink-3 px-4 py-3 text-[10.5px] font-semibold text-white/45">
                                Onze de départ introuvable pour cette équipe.
                              </p>
                            )}

                            {t.bench.length > 0 ? (
                              <>
                                <SectionTitle>Banc ({t.bench.length})</SectionTitle>
                                <div className="grid grid-cols-2 gap-1.5">
                                  {t.bench.map((p) => (
                                    <div key={p.athleteId} className="flex items-center gap-2 rounded-xl bg-ink-3 px-2.5 py-2">
                                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/10 text-[9.5px] font-black text-white/70">
                                        {p.jersey ?? "?"}
                                      </span>
                                      <span className="min-w-0 flex-1 truncate text-[10px] font-bold text-white/80">{p.shortName ?? p.name}</span>
                                    </div>
                                  ))}
                                </div>
                              </>
                            ) : null}

                            <p className="mt-3 text-center text-[8.5px] font-bold uppercase tracking-widest text-white/25">
                              Source : ESPN · {t.source === "published" ? "compos du match" : "compos du match précédent"}
                            </p>
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
      </div>

      {loading ? (
        <div className="absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-black/70 px-3.5 py-2 ring-1 ring-white/10">
          <Loader2 size={12} className="animate-spin text-neon" />
          <span className="text-[9.5px] font-bold uppercase tracking-widest text-white/60">Analyse…</span>
        </div>
      ) : null}
    </div>
  );
}
