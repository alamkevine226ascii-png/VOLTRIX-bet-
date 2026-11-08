"use client";

/* ============================================================
   VOLTRIX front — Détail combat MMA (lecture simplifiée)
   Héro illustré par la photo de l'arène où se déroule l'événement.
   Au défilement, le héros s'évacue et une barre compacte —
   avatars + heure — prend le relais (même mécanique que le foot).
   Prono moteur en une carte claire : pick, probabilité,
   confiance, barre de victoire segmentée (2 issues). Puis
   onglets : Synthèse / Méthode / Rounds / Combattants / H2H.
   ============================================================ */

import { useCallback, useEffect, useMemo, useState, type UIEvent } from "react";
import { motion } from "framer-motion";
import {
  ChevronLeft,
  Crown,
  Loader2,
  MapPin,
  RefreshCw,
  Swords,
  TrendingUp,
} from "lucide-react";
import { oddsFmt, pct, timeLabel } from "@/lib/voltrix";
import { arenaImageFor, demoMmaFightDetail } from "@/lib/mma-data";
import type { MmaFightDetail, MmaFighter } from "@/lib/mma-types";
import { TeamBadge } from "./TeamBadge";
import {
  DemoBadge,
  EdgeChip,
  FormDots,
  KpiTile,
  LoadingPanel,
  ProbBar,
  SectionTitle,
  confidenceStars,
} from "./ui-bits";

type TabId = "synthese" | "methode" | "rounds" | "combattants" | "h2h";

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "synthese", label: "Synthèse" },
  { id: "methode", label: "Méthode" },
  { id: "rounds", label: "Rounds" },
  { id: "combattants", label: "Combattants" },
  { id: "h2h", label: "H2H" },
];

const COMPACT_THRESHOLD = 170;
const COMPACT_H = 52;

/* ---------- petit util : format palmarès ---------- */
function recOf(f: { record: { wins: number; losses: number; draws: number } }): string {
  const { wins, losses, draws } = f.record;
  return draws > 0 ? `${wins}-${losses}-${draws}` : `${wins}-${losses}`;
}

/* ---------- carte combattant (onglet Combattants) ---------- */
function FighterCard({ f, fav }: { f: MmaFighter; fav: boolean }) {
  const finishShare = f.record.wins > 0 ? 1 - f.decWins / f.record.wins : 0;
  return (
    <div className="rounded-2xl bg-ink-3 p-3.5">
      <div className="flex items-center gap-2.5">
        <TeamBadge name={f.name} logo={null} size={38} />
        <div className="min-w-0">
          <p className="truncate text-[12px] font-black uppercase tracking-wide text-white">{f.name}</p>
          <p className="text-[9.5px] font-bold text-white/40">
            {recOf(f)} {f.ranking === 1 ? "· Champion" : f.ranking ? `· ${f.ranking}e` : ""}
            {fav ? " · Favori" : ""}
          </p>
        </div>
      </div>
      <div className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[9.5px]">
        {[
          ["Surnom", f.nickname ?? "—"],
          ["Âge", f.age != null ? `${f.age} ans` : "—"],
          ["Taille", f.heightCm != null ? `${f.heightCm} cm` : "—"],
          ["Allonge", f.reachCm != null ? `${f.reachCm} cm` : "—"],
          ["Garde", f.stance || "—"],
          ["Pays", f.country],
          ["KO / Soum. / Déc.", `${f.koWins} / ${f.subWins} / ${f.decWins}`],
          ["Finition", `${Math.round(finishShare * 100)} %`],
        ].map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-1 border-b border-white/5 pb-1">
            <span className="text-white/40">{k}</span>
            <span className="truncate font-bold text-white/85">{v}</span>
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between">
        <span className="text-[8.5px] font-bold uppercase tracking-widest text-white/35">Forme</span>
        <FormDots form={f.form} />
      </div>
    </div>
  );
}

/* ---------- Écran ---------- */
export function MmaFightScreen({
  fightId,
  onBack,
}: {
  fightId: string;
  onBack: () => void;
}) {
  const [detail, setDetail] = useState<MmaFightDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>("synthese");

  /* héros parti → barre compacte visible */
  const [compact, setCompact] = useState(false);
  const handleScroll = useCallback((e: UIEvent<HTMLDivElement>) => {
    setCompact(e.currentTarget.scrollTop > COMPACT_THRESHOLD);
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    try {
      const res = demoMmaFightDetail(fightId);
      if (!res) throw new Error("Combat introuvable");
      setDetail(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analyse indisponible");
    } finally {
      setLoading(false);
    }
  }, [fightId]);

  useEffect(() => {
    load();
  }, [load]);

  const pred = detail?.prediction;
  const fight = detail?.fight;
  const bestPick = useMemo(() => pred?.recommendedBets[0] ?? null, [pred]);

  const aName = fight?.fighterA.name ?? detail?.fighterA.name ?? "?";
  const bName = fight?.fighterB.name ?? detail?.fighterB.name ?? "?";
  const aShort = (fight?.fighterA.shortName ?? "A").slice(0, 10);
  const bShort = (fight?.fighterB.shortName ?? "B").slice(0, 10);

  const live = fight?.status === "in";
  const done = fight?.status === "post";

  /* image de l'arène de l'événement */
  const arenaImg = useMemo(() => arenaImageFor(fight?.venue.name), [fight?.venue.name]);

  /* heure / résultat affiché au centre */
  const centerMain = done
    ? fight!.winner === "A"
      ? aShort
      : bShort
    : fight
      ? timeLabel(fight.date)
      : "--:--";
  const centerSub = done
    ? fight!.method ?? "Terminé"
    : live
      ? fight!.statusDetail
      : "Heure locale";

  /* segments victoire (2 issues) pour la barre unique */
  const segments = useMemo(() => {
    if (!pred) return [];
    return [
      {
        id: "a" as const,
        value: pred.probs.a,
        label: aShort,
        odds: fight?.oddsA ?? null,
      },
      {
        id: "b" as const,
        value: pred.probs.b,
        label: bShort,
        odds: fight?.oddsB ?? null,
      },
    ];
  }, [pred, fight, aShort, bShort]);

  /* scénarios les plus probables (combattant × méthode) */
  const scenarios = useMemo(() => {
    if (!pred || !detail) return [];
    const rows = [
      { label: `${detail.fighterA.shortName} par KO/TKO`, p: pred.byMethod.a.ko },
      { label: `${detail.fighterA.shortName} par soumission`, p: pred.byMethod.a.sub },
      { label: `${detail.fighterA.shortName} par décision`, p: pred.byMethod.a.dec },
      { label: `${detail.fighterB.shortName} par KO/TKO`, p: pred.byMethod.b.ko },
      { label: `${detail.fighterB.shortName} par soumission`, p: pred.byMethod.b.sub },
      { label: `${detail.fighterB.shortName} par décision`, p: pred.byMethod.b.dec },
    ];
    return rows.sort((x, y) => y.p - x.p).slice(0, 5);
  }, [pred, detail]);

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
      onClick={() => load()}
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
          <TeamBadge name={aName} logo={null} size={30} />
          <div className="min-w-0 flex-1 text-center">
            <p className="font-display text-[17px] leading-none tracking-wide text-white">{centerMain}</p>
            <p className="mt-0.5 truncate text-[8px] font-bold uppercase tracking-widest text-white/40">
              {fight?.orgShort ?? "MMA"}
              {live ? " · Live" : ""}
            </p>
          </div>
          <TeamBadge name={bName} logo={null} size={30} />
          {refreshBtn}
        </div>
      </div>

      {/* ============ ZONE DÉFILANTE UNIQUE : héros puis contenu ============ */}
      <div onScroll={handleScroll} className="no-scrollbar flex-1 overflow-y-auto">
        {/* ---------- HÉROS : photo de l'arène de l'événement ---------- */}
        <div className="relative shrink-0">
          <div className="absolute inset-0 overflow-hidden" aria-hidden="true">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={arenaImg}
              alt=""
              className="h-full w-full object-cover object-center"
            />
            <div className="absolute inset-0 bg-gradient-to-b from-ink/75 via-ink/40 to-ink" />
          </div>

          {/* barre supérieure */}
          <header className="relative flex items-center justify-between px-5 pt-6">
            {backBtn}
            <div className="flex min-w-0 items-center gap-2">
              <span className="max-w-[130px] truncate text-[10px] font-black uppercase tracking-widest text-white/80">
                {fight?.orgShort ?? "MMA"}
              </span>
              {fight?.titleFight ? (
                <span className="flex items-center gap-1 rounded-full bg-neon px-2.5 py-1 text-[9px] font-black uppercase text-black">
                  <Crown size={10} strokeWidth={2.6} />
                  Titre
                </span>
              ) : null}
              {live ? (
                <span className="flex items-center gap-1 rounded-full bg-neon px-2.5 py-1 text-[9px] font-black uppercase text-black">
                  <span className="live-dot h-1.5 w-1.5 rounded-full bg-black" />
                  Live
                </span>
              ) : (
                <span className="rounded-full bg-ink-3/90 px-2.5 py-1 text-[9px] font-black uppercase tracking-wide text-white/70 backdrop-blur">
                  {done ? "Terminé" : "À venir"}
                </span>
              )}
            </div>
            {refreshBtn}
          </header>

          {/* combattants + heure/résultat */}
          <div className="relative mt-2 grid grid-cols-[1fr_auto_1fr] items-center px-6 pb-4 pt-1">
            <div className="flex flex-col items-center gap-1.5">
              <TeamBadge name={aName} logo={null} size={56} />
              <span className="max-w-[104px] text-center text-[8.5px] font-extrabold leading-[1.3] tracking-wide text-white">
                {aName.toUpperCase()}
              </span>
              <span className="text-[8px] font-bold text-white/50">
                {fight ? recOf(fight.fighterA) : "—"}
              </span>
            </div>
            <div className="mx-3 min-w-[92px] px-1 text-center">
              <span className="font-display text-[26px] leading-none tracking-wide text-white">{centerMain}</span>
              <span className="mt-1 block text-[8.5px] font-semibold uppercase tracking-widest text-white/50">
                {centerSub}
              </span>
            </div>
            <div className="flex flex-col items-center gap-1.5">
              <TeamBadge name={bName} logo={null} size={56} />
              <span className="max-w-[104px] text-center text-[8.5px] font-extrabold leading-[1.3] tracking-wide text-white">
                {bName.toUpperCase()}
              </span>
              <span className="text-[8px] font-bold text-white/50">
                {fight ? recOf(fight.fighterB) : "—"}
              </span>
            </div>
          </div>

          {/* catégorie + lieu */}
          <div className="relative flex flex-col items-center gap-1.5 pb-3">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-ink-3/80 px-3 py-1 text-[9px] font-bold uppercase tracking-wide text-white/70 backdrop-blur">
              <Swords size={10} strokeWidth={2.4} className="shrink-0 text-neon" />
              {fight?.weightClass ?? "—"}
              {fight ? ` · ${fight.rounds} rounds` : ""}
            </span>
            <span className="inline-flex max-w-[85%] items-center gap-1.5 rounded-full bg-ink-3/80 px-3 py-1 text-[9px] font-bold uppercase tracking-wide text-white/70 backdrop-blur">
              <MapPin size={10} strokeWidth={2.4} className="shrink-0 text-neon" />
              <span className="truncate">
                {fight?.venue.name ?? "Arène"}
                {fight?.venue.city ? ` · ${fight.venue.city}` : ""}
              </span>
            </span>
          </div>
        </div>

        {/* ---------- CONTENU ---------- */}
        {loading ? (
          <LoadingPanel label="Le moteur VOLTRIX analyse le combat…" />
        ) : error || !detail || !pred || !fight ? (
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-ink-3">
              <Loader2 size={20} className="text-white/50" />
            </span>
            <p className="max-w-[280px] text-[11.5px] font-semibold leading-relaxed text-white/60">
              {error ?? "Analyse indisponible"}
            </p>
          </div>
        ) : (
          <main className="px-5 pb-14">
            {/* ---------- PRONO DU MOTEUR ---------- */}
            <section className="rounded-[26px] bg-neon px-5 pb-4 pt-4 text-black">
              <div className="flex items-center justify-between gap-2">
                <p className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-[0.2em] text-black/50">
                  Prono du moteur
                  <DemoBadge className="!bg-black/15 !text-black/60 !ring-black/20" />
                </p>
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

              {/* barre victoire segmentée : largeur = probabilité */}
              <div
                className="mt-3.5 flex h-[46px] overflow-hidden rounded-2xl bg-black/15"
                role="img"
                aria-label={`Probabilités : ${aShort} ${Math.round(pred.probs.a * 100)} %, ${bShort} ${Math.round(pred.probs.b * 100)} %`}
              >
                {segments.map((s, i) => {
                  const best = s.value >= Math.max(...segments.map((x) => x.value));
                  return (
                    <div
                      key={s.id}
                      className={`flex min-w-0 flex-col items-center justify-center gap-[3px] border-black/10 px-1 ${
                        i > 0 ? "border-l" : ""
                      } ${best ? "bg-black text-neon" : "text-black/75"}`}
                      style={{ flexGrow: Math.max(0.14, s.value) }}
                    >
                      <span className="w-full truncate text-center text-[8px] font-bold uppercase tracking-wider opacity-70">
                        {s.odds != null ? `${s.label} ${oddsFmt(s.odds)}` : s.label}
                      </span>
                      <span className="text-[14px] font-black leading-none">{Math.round(s.value * 100)}%</span>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* ---------- onglets ---------- */}
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
                      value={`${(pred.probs.a >= pred.probs.b ? aShort : bShort).slice(0, 5)} ${Math.round(Math.max(pred.probs.a, pred.probs.b) * 100)}%`}
                    />
                    <KpiTile
                      label="Méthode clé"
                      value={pred.recommendedBets[1]?.pick.split(" ").slice(-1)[0] ?? "—"}
                      tone="neon"
                    />
                    <KpiTile label="Rounds attendus" value={pred.totalRoundsExpected.toFixed(1)} />
                  </div>

                  <SectionTitle>Scénarios les plus probables</SectionTitle>
                  <div className="space-y-1.5">
                    {scenarios.map((s) => (
                      <div key={s.label} className="flex items-center gap-2.5 rounded-2xl bg-ink-3 px-3.5 py-2">
                        <span className="w-[128px] shrink-0 truncate text-[9px] font-bold text-white/70" title={s.label}>{s.label.replace(" par ", " · ")}</span>
                        <div className="h-[6px] flex-1 overflow-hidden rounded-full bg-black/50">
                          <div className="h-full rounded-full bg-neon" style={{ width: `${Math.min(100, s.p * 400)}%` }} />
                        </div>
                        <span className="w-11 text-right text-[11px] font-black text-white/80">{pct(s.p, 1)}</span>
                      </div>
                    ))}
                  </div>

                  <SectionTitle>Fin du combat</SectionTitle>
                  <div className="space-y-1.5">
                    {pred.roundFinish.map((r) => (
                      <div key={r.round} className="flex items-center gap-3 rounded-2xl bg-ink-3 px-3.5 py-2">
                        <span className="w-[110px] text-[9.5px] font-bold text-white/60">
                          {r.round === 1 ? "Round 1" : `Round ${r.round}`}
                        </span>
                        <div className="h-[6px] flex-1 overflow-hidden rounded-full bg-black/50">
                          <div className="h-full rounded-full bg-white/70" style={{ width: `${Math.min(100, r.prob * 260)}%` }} />
                        </div>
                        <span className="w-11 text-right text-[11px] font-black text-white/80">{pct(r.prob, 1)}</span>
                      </div>
                    ))}
                    <div className="flex items-center gap-3 rounded-2xl bg-ink-3 px-3.5 py-2">
                      <span className="w-[110px] text-[9.5px] font-bold text-neon">Décision</span>
                      <div className="h-[6px] flex-1 overflow-hidden rounded-full bg-black/50">
                        <div className="h-full rounded-full bg-neon" style={{ width: `${Math.min(100, pred.goesToDecision * 260)}%` }} />
                      </div>
                      <span className="w-11 text-right text-[11px] font-black text-white/80">{pct(pred.goesToDecision, 1)}</span>
                    </div>
                  </div>
                </div>
              ) : null}

              {/* ---------------- MÉTHODE ---------------- */}
              {tab === "methode" ? (
                <div>
                  <SectionTitle>{aShort} — méthodes de victoire</SectionTitle>
                  <div className="grid grid-cols-3 gap-1.5">
                    <ProbBar label="KO/TKO" value={pred.byMethod.a.ko} compact />
                    <ProbBar label="Soum." value={pred.byMethod.a.sub} compact />
                    <ProbBar label="Décis." value={pred.byMethod.a.dec} compact />
                  </div>

                  <SectionTitle>{bShort} — méthodes de victoire</SectionTitle>
                  <div className="grid grid-cols-3 gap-1.5">
                    <ProbBar label="KO/TKO" value={pred.byMethod.b.ko} compact />
                    <ProbBar label="Soum." value={pred.byMethod.b.sub} compact />
                    <ProbBar label="Décis." value={pred.byMethod.b.dec} compact />
                  </div>

                  <SectionTitle>Distance</SectionTitle>
                  <div className="space-y-1.5">
                    <ProbBar label="Ne passe pas la distance" value={1 - pred.goesToDecision} />
                    <ProbBar label="Va jusqu'à la décision" value={pred.goesToDecision} />
                  </div>

                  <SectionTitle>Pronos recommandés</SectionTitle>
                  <div className="space-y-2">
                    {pred.recommendedBets.map((b, i) => (
                      <div key={i} className="flex items-center justify-between gap-3 rounded-2xl bg-ink-3 px-3.5 py-3">
                        <div className="min-w-0">
                          <p className="truncate text-[12px] font-black text-white">{b.pick}</p>
                          <p className="text-[9px] font-bold uppercase tracking-wider text-white/40">{b.market} · {b.note}</p>
                        </div>
                        <span className="shrink-0 text-[15px] font-black text-neon">{pct(b.prob)}</span>
                      </div>
                    ))}
                  </div>

                  {pred.valueBets.length > 0 ? (
                    <SectionTitle>
                      <span className="flex items-center gap-1.5">
                        <TrendingUp size={12} strokeWidth={2.4} className="text-neon" />
                        Value bets
                      </span>
                    </SectionTitle>
                  ) : null}
                  <div className="space-y-2">
                    {pred.valueBets.map((v, i) => (
                      <div key={i} className="flex items-center justify-between gap-3 rounded-2xl bg-ink-3 px-3.5 py-3">
                        <div className="min-w-0">
                          <p className="truncate text-[12px] font-black text-white">{v.pick}</p>
                          <p className="text-[9px] font-bold uppercase tracking-wider text-white/40">
                            {v.market} · modèle {pct(v.modelProb)} · cote {oddsFmt(v.odds)}
                          </p>
                        </div>
                        <EdgeChip edge={v.edge} />
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {/* ---------------- ROUNDS ---------------- */}
              {tab === "rounds" ? (
                <div>
                  <SectionTitle>Le combat s'arrête au…</SectionTitle>
                  <div className="space-y-1.5">
                    {pred.roundFinish.map((r) => (
                      <ProbBar key={r.round} label={`Round ${r.round}`} value={r.prob} />
                    ))}
                    <ProbBar label="Décision (distance)" value={pred.goesToDecision} />
                  </div>

                  <SectionTitle>Lecture du moteur</SectionTitle>
                  <div className="grid grid-cols-3 gap-2">
                    <KpiTile label="Rounds attendus" value={pred.totalRoundsExpected.toFixed(1)} tone="neon" />
                    <KpiTile label="Format" value={`${fight.rounds} rounds`} />
                    <KpiTile
                      label="Fin attendue"
                      value={1 - pred.goesToDecision > 0.5 ? "Avant la limite" : "Aux points"}
                    />
                  </div>
                  <p className="mt-3 rounded-2xl bg-ink-3 px-4 py-3 text-[10.5px] leading-relaxed text-white/55">
                    {1 - pred.goesToDecision > 0.5
                      ? `Les deux combattants finissent la majorité de leurs victoires avant la limite : le moteur anticipe un arrêt, avec le round ${pred.roundFinish.reduce((a, b) => (b.prob > a.prob ? b : a)).round} comme fenêtre la plus probable.`
                      : `Les deux combattants vont régulièrement chercher la décision : le moteur donne ${pct(pred.goesToDecision, 0)} de chances que les juges aient le dernier mot.`}
                  </p>
                </div>
              ) : null}

              {/* ---------------- COMBATTANTS ---------------- */}
              {tab === "combattants" ? (
                <div>
                  <SectionTitle>{aShort}</SectionTitle>
                  <FighterCard f={detail.fighterA} fav={pred.probs.a >= pred.probs.b} />

                  <SectionTitle>{bShort}</SectionTitle>
                  <FighterCard f={detail.fighterB} fav={pred.probs.b > pred.probs.a} />

                  <SectionTitle>Stats moyennes / 15 min</SectionTitle>
                  <div className="space-y-1.5">
                    {[
                      {
                        label: "Frappes réussies / min",
                        a: detail.fighterA.strikesLandedPerMin,
                        b: detail.fighterB.strikesLandedPerMin,
                        fmt: (x: number) => x.toFixed(1),
                        max: 8,
                      },
                      {
                        label: "Précision frappes",
                        a: detail.fighterA.strikingAccuracy,
                        b: detail.fighterB.strikingAccuracy,
                        fmt: (x: number) => pct(x),
                        max: 0.7,
                      },
                      {
                        label: "Takedowns / 15 min",
                        a: detail.fighterA.takedownsPer15,
                        b: detail.fighterB.takedownsPer15,
                        fmt: (x: number) => x.toFixed(1),
                        max: 6,
                      },
                      {
                        label: "Défense takedown",
                        a: detail.fighterA.takedownDefense,
                        b: detail.fighterB.takedownDefense,
                        fmt: (x: number) => pct(x),
                        max: 1,
                      },
                    ].map((row) => {
                      const aW = Math.min(100, (row.a / row.max) * 100);
                      const bW = Math.min(100, (row.b / row.max) * 100);
                      const aBest = row.a >= row.b;
                      return (
                        <div key={row.label} className="rounded-2xl bg-ink-3 px-3.5 py-2.5">
                          <div className="flex items-baseline justify-between text-[10px] font-black">
                            <span className={aBest ? "text-neon" : "text-white/60"}>{row.fmt(row.a)}</span>
                            <span className="text-[9px] font-bold uppercase tracking-wider text-white/45">{row.label}</span>
                            <span className={!aBest ? "text-neon" : "text-white/60"}>{row.fmt(row.b)}</span>
                          </div>
                          <div className="mt-1.5 flex h-[5px] justify-end overflow-hidden rounded-full bg-black/50">
                            <div className="h-full rounded-full bg-neon" style={{ width: `${aW}%` }} />
                          </div>
                          <div className="mt-1 flex h-[5px] overflow-hidden rounded-full bg-black/50">
                            <div className="h-full rounded-full bg-neon" style={{ width: `${bW}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <p className="mt-2 text-center text-[8.5px] font-bold uppercase tracking-widest text-white/30">
                    {aShort} à gauche · {bShort} à droite
                  </p>
                </div>
              ) : null}

              {/* ---------------- H2H ---------------- */}
              {tab === "h2h" ? (
                <div>
                  <SectionTitle>Historique des confrontations</SectionTitle>
                  {detail.h2h.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 py-10 text-center">
                      <Swords size={26} className="text-white/30" />
                      <p className="text-[11.5px] font-semibold text-white/50">Première rencontre entre les deux combattants.</p>
                      <p className="max-w-[240px] text-[10px] leading-relaxed text-white/35">
                        Le moteur s'appuie uniquement sur les palmarès, les styles et la dynamique récente.
                      </p>
                    </div>
                  ) : (
                    <>
                      <div className="space-y-2">
                        {detail.h2h.map((h) => (
                          <div key={`${h.date}-${h.event}`} className="rounded-2xl bg-ink-3 px-4 py-3">
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="text-[11px] font-black text-white">{h.winner}</span>
                              <span className="shrink-0 text-[9px] font-bold uppercase tracking-wider text-white/40">
                                {new Date(h.date).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" })}
                              </span>
                            </div>
                            <p className="mt-0.5 text-[9.5px] font-semibold text-white/45">
                              {h.event} · {h.method}
                            </p>
                          </div>
                        ))}
                      </div>
                      <p className="mt-3 text-center text-[10px] font-semibold text-white/45">
                        {detail.h2h.length} combat{detail.h2h.length > 1 ? "s" : ""} —{" "}
                        {detail.h2h.filter((h) => h.winner === aName).length} {aShort} ·{" "}
                        {detail.h2h.filter((h) => h.winner === bName).length} {bShort}
                      </p>
                    </>
                  )}
                </div>
              ) : null}
            </motion.div>
          </main>
        )}
      </div>
    </div>
  );
}
