'use client';

// ============================================================
// VOLTRIX bet — Par combiné (page dédiée)
// L'utilisateur choisit une côte cible, l'app analyse les matchs
// du jour et construit le combiné optimal (proba maximale).
// Le ticket généré est cliquable → vue plein écran /combo/ticket.
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowLeft,
  Ban,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Layers,
  Loader2,
  Maximize2,
  RefreshCw,
  Repeat2,
  Share2,
  Shuffle,
  SlidersHorizontal,
  Sparkles,
  Ticket,
  X,
  Zap,
} from 'lucide-react';
import type { LightMatch, MatchesResponse, QuickPred } from '@/lib/types';
import {
  PROFILES,
  buildCombo,
  fairOdds,
  groupByMarket,
  isLegInProfile,
  legKey,
  listAlternatives,
  listSameMatchAlternatives,
  maxAchievableOdds,
  recomputeCombo,
  repairToTarget,
  riskBadge,
  type ComboLeg,
  type ComboResult,
  type OddsSource,
  type RiskProfile,
  type RiskTone,
} from '@/lib/combo';
import {
  DEFAULT_CRITERIA,
  activeCriteriaCount,
  criteriaSummary,
  filterCandidates,
  hasAnyMarket,
  loadCriteria,
  saveCriteria,
  type ComboCriteria,
} from '@/lib/combo-criteria';
import {
  dcFromMarket,
  oddsWithMargin,
} from '@/lib/market-odds';
import { buildComboCard, shareCard } from '@/components/voltrix/share';
import { saveComboTicket } from '@/lib/combo-store';
import { cn } from '@/lib/utils';

const BANKROLL = 1000; // € fictifs pour la mise Kelly conseillée
const TARGET_CHIPS = [2, 3, 5, 10, 20, 50];

// Formatters Intl mis en cache au niveau module (même convention que shared.tsx) :
// `new Intl.DateTimeFormat` est coûteux à construire — un exemplaire partagé au
// lieu d'un nouveau à chaque render/puce/jambe de ticket.
const WEEKDAY_FMT = new Intl.DateTimeFormat('fr-FR', { weekday: 'short' });
const DAY_MONTH_FMT = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short' });
const HOUR_FMT = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });

export default function ComboPage() {
  const [mounted, setMounted] = useState(false);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [data, setData] = useState<MatchesResponse | null>(null);
  const [preds, setPreds] = useState<Record<string, QuickPred>>({});
  const [target, setTarget] = useState<string>('5');
  const [profile, setProfile] = useState<RiskProfile>('equilibre');
  const [legsLimit, setLegsLimit] = useState<number>(5);
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [combo, setCombo] = useState<ComboResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Task 18-b : échec de chargement des matchs (réseau/HTTP/JSON) — ne doit PAS
  // être confondu avec le « Chargement… » ni avec un vivier vide.
  const [loadError, setLoadError] = useState(false);
  const [maxPossible, setMaxPossible] = useState<number | null>(null);
  const [sharing, setSharing] = useState(false);
  // ---------- Critères de triage (v2) ----------
  // L'utilisateur choisit les spécificités du combiné : marchés autorisés,
  // confiance minimale, cotes réelles uniquement (DÉFAUT ON — la cote totale
  // doit être réellement obtenable chez le bookmaker), ligues exclues.
  // Persistés (loadCriteria migre v1 → v2 au montage).
  const [criteria, setCriteria] = useState<ComboCriteria>(DEFAULT_CRITERIA);
  const [showCriteria, setShowCriteria] = useState(false);
  const criteriaCount = activeCriteriaCount(criteria);
  // ---------- Édition du ticket (échange d'un match) ----------
  // Vivier complet des jambes candidates (tous marchés, tous matchs analysés),
  // rempli à chaque génération : sert aux alternatives de remplacement.
  const poolRef = useRef<ComboLeg[]>([]);
  // Pile des tickets précédant chaque échange (bouton « Annuler l'échange »)
  const undoStack = useRef<ComboResult[]>([]);
  const [hasUndo, setHasUndo] = useState(false);
  // Sheet de remplacement : index de la jambe échangée + sélection courante + filtre de risque.
  // Task 19-c : DEUX sections exclusives l'une de l'autre —
  //   · samePick : un autre pari du MÊME match (remplacement 1-pour-1, le match reste dans le ticket) ;
  //   · picks : 1-2 sélections d'AUTRES matchs (comportement historique ⟳).
  // Un seul pari par match dans le ticket : les deux modes ne sont jamais cumulables.
  const [swap, setSwap] = useState<{ index: number; picks: string[]; samePick: string | null; filter: 'all' | RiskTone } | null>(null);
  const abort = useRef(false);
  const seed = useRef(1);

  useEffect(() => setMounted(true), []);

  // Chargement des critères persisted (localStorage) au montage
  useEffect(() => {
    setCriteria(loadCriteria());
  }, []);

  const updateCriteria = useCallback((next: ComboCriteria) => {
    setCriteria(next);
    saveCriteria(next);
  }, []);

  const loadMatches = useCallback(async (d: string) => {
    setData(null);
    setPreds({});
    setCombo(null);
    setError(null);
    setMaxPossible(null);
    setLoadError(false);
    try {
      const res = await fetch(`/api/matches?date=${d}`);
      // HTTP non-OK (5xx, 404…) : erreur, pas « vivier vide » (Task 18-b).
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: MatchesResponse = await res.json();
      if (!json || !Array.isArray(json.leagues)) throw new Error('Réponse invalide');
      setData(json);
    } catch {
      setData(null);
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    if (mounted) loadMatches(date);
  }, [mounted, date, loadMatches]);

  const upcoming = useMemo(
    () =>
      (data?.leagues.flatMap((l) => l.matches) ?? [])
        // Combiné strictement même-jour UTC (sécurité du règlement) :
        // le serveur filtre déjà [JJ 00:00 → JJ+1 00:00) — ce second
        // filtre local est une défense en profondeur (Task 14/17).
        .filter((m) => m.date.slice(0, 10) === date && m.status === 'pre')
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()),
    [data, date]
  );

  // ---------- Analyse de tous les matchs à venir ----------
  const analyzeAll = useCallback(async (list: LightMatch[]) => {
    const ok = new Map<string, QuickPred>();
    for (let i = 0; i < list.length; i += 6) {
      if (abort.current) break;
      const batch = list.slice(i, i + 6);
      try {
        const res = await fetch('/api/predictions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            matches: batch.map((m) => ({ matchId: m.id, leagueCode: m.leagueCode, date: m.date })),
          }),
        });
        const json = await res.json();
        for (const r of json.results ?? []) {
          if (r) {
            ok.set(r.matchId, r);
            setPreds((prev) => ({ ...prev, [r.matchId]: r }));
          }
        }
      } catch {
        // lot ignoré
      }
      setProgress({ done: Math.min(i + 6, list.length), total: list.length });
    }
    return ok;
  }, []);

  // ---------- Construction des candidats (tous marchés, ancrés marché) ----------
  const buildCandidates = useCallback((matches: LightMatch[], map: Map<string, QuickPred>): ComboLeg[] => {
    const legs: ComboLeg[] = [];
    const LINES = [1.5, 2.5, 3.5];
    for (const m of matches) {
      const p = map.get(m.id);
      if (!p) continue;
      const base = {
        matchId: m.id,
        leagueCode: m.leagueCode,
        leagueShort: m.leagueShort,
        leagueName: m.leagueName,
        matchDate: m.date,
        homeName: m.home.name,
        awayName: m.away.name,
        homeLogo: m.home.logo,
        awayLogo: m.away.logo,
        confidence: p.confidence,
      };
      const mlReal = [m.mlHome, m.mlDraw, m.mlAway].every((o) => o != null && o > 1.01);

      // 1X2 (cotes réelles si dispo)
      const sides: Array<{ pick: string; prob: number; odds: number | null }> = [
        { pick: `Victoire ${m.home.name}`, prob: p.probs.home, odds: m.mlHome },
        { pick: 'Match nul', prob: p.probs.draw, odds: m.mlDraw },
        { pick: `Victoire ${m.away.name}`, prob: p.probs.away, odds: m.mlAway },
      ];
      for (const s of sides) {
        legs.push({
          ...base,
          market: '1X2',
          pick: s.pick,
          prob: s.prob,
          odds: s.odds ?? fairOdds(s.prob),
          oddsSource: s.odds != null && s.odds > 1.01 ? 'real' : 'estimate',
        });
      }

      // Double Chance : dérivée du marché réel (dé-margée) si le 1X2 existe, sinon modèle
      if (mlReal) {
        const dc = dcFromMarket(m.mlHome!, m.mlDraw!, m.mlAway!);
        if (dc) {
          const dcs: Array<{ pick: string; prob: number; odds: number }> = [
            { pick: `${m.home.shortName} ou Nul (1X)`, prob: dc.prob1X, odds: dc.odds1X },
            { pick: 'Pas de nul (12)', prob: dc.prob12, odds: dc.odds12 },
            { pick: `${m.away.shortName} ou Nul (X2)`, prob: dc.probX2, odds: dc.oddsX2 },
          ];
          for (const d of dcs) {
            legs.push({
              ...base,
              market: 'Double Chance',
              pick: d.pick,
              prob: d.prob,
              odds: d.odds,
              oddsSource: 'market',
            });
          }
        }
      } else {
        const dcs: Array<{ pick: string; prob: number }> = [
          { pick: `${m.home.shortName} ou Nul (1X)`, prob: p.probs.home + p.probs.draw },
          { pick: 'Pas de nul (12)', prob: p.probs.home + p.probs.away },
          { pick: `${m.away.shortName} ou Nul (X2)`, prob: p.probs.draw + p.probs.away },
        ];
        for (const d of dcs) {
          legs.push({
            ...base,
            market: 'Double Chance',
            pick: d.pick,
            prob: d.prob,
            odds: fairOdds(d.prob),
            oddsSource: 'estimate',
          });
        }
      }

      // Totals + BTTS (audit 21-b FIX 1) : p.overUnder / p.btts sont DÉJÀ
      // calibrés sur la ligne O/U réelle par runEngine (calibration devenue
      // l'étape officielle du pipeline). Le Combinator les consomme
      // DIRECTEMENT — plus aucune re-calibration ici : fiche et combiné
      // produisent EXACTEMENT les mêmes nombres pour un même match.
      // realOu ne sert plus qu'aux cotes : réelles sur la ligne marché,
      // dérivées (oddsWithMargin) sur les lignes interpolées ; oddsSource
      // 'market' = proba ancrée marché + cote dérivée, 'estimate' = brut.
      const realOu =
        p.ouOdds?.line != null && p.ouOdds?.over != null && p.ouOdds?.under != null
          ? { line: p.ouOdds.line, over: p.ouOdds.over, under: p.ouOdds.under }
          : null;
      for (const line of LINES) {
        const modelLine = p.overUnder.find((o) => o.line === line);
        const isRealLine = realOu != null && Math.abs(realOu.line - line) < 0.01;
        const overP = modelLine?.over ?? 0;
        const underP = modelLine?.under ?? 0;
        if (!Number.isFinite(overP) || !Number.isFinite(underP) || overP <= 0.02 || underP <= 0.02) continue;
        const derivedSource: OddsSource = realOu != null ? 'market' : 'estimate';
        legs.push({
          ...base,
          market: `O/U ${line}`,
          pick: `Plus de ${line} buts`,
          prob: overP,
          odds: isRealLine ? realOu!.over! : oddsWithMargin(overP),
          oddsSource: isRealLine ? 'real' : derivedSource,
        });
        legs.push({
          ...base,
          market: `O/U ${line}`,
          pick: `Moins de ${line} buts`,
          prob: underP,
          odds: isRealLine ? realOu!.under! : oddsWithMargin(underP),
          oddsSource: isRealLine ? 'real' : derivedSource,
        });
      }

      // BTTS : p.btts déjà calibré en amont (runEngine) — consommé tel quel.
      // La cote reste estimée (fairOdds) : aucune cote BTTS réelle chez ESPN.
      const bttsYes = p.btts.yes;
      legs.push({
        ...base,
        market: 'BTTS',
        pick: 'Les 2 équipes marquent : Oui',
        prob: bttsYes,
        odds: fairOdds(bttsYes),
        oddsSource: 'estimate',
      });
      legs.push({
        ...base,
        market: 'BTTS',
        pick: 'Les 2 équipes marquent : Non',
        prob: p.btts.no,
        odds: fairOdds(p.btts.no),
        oddsSource: 'estimate',
      });
    }
    return legs;
  }, []);

  // ---------- Génération ----------
  const generate = useCallback(
    async (newSeed?: number) => {
      const targetOdds = parseFloat(target.replace(',', '.'));
      if (!Number.isFinite(targetOdds) || targetOdds < 1.2) {
        setError('Entre une côte cible valide (minimum 1.20).');
        return;
      }
      abort.current = false;
      setGenerating(true);
      setError(null);
      setCombo(null);
      setMaxPossible(null);
      setSwap(null);
      undoStack.current = [];
      setHasUndo(false);
      setProgress({ done: 0, total: upcoming.length });
      try {
        const map = await analyzeAll(upcoming);
        if (abort.current) return;
        const allCandidates = buildCandidates(upcoming, map);
        // Triage : le vivier est filtré par les critères de l'utilisateur
        // (marchés, confiance, cotes réelles, ligues exclues) AVANT le moteur
        // — et le poolRef hérite du même filtre, donc les échanges manuels
        // restent dans les spécificités choisies.
        const candidates = filterCandidates(allCandidates, criteria);
        poolRef.current = candidates; // vivier (filtré) pour les échanges manuels
        if (candidates.length < 2 || !hasAnyMarket(criteria)) {
          setError(
            !hasAnyMarket(criteria)
              ? 'Aucun marché coché dans les critères : coche au moins une famille (1X2, Double Chance, O/U, BTTS).'
              : `Trop peu de sélections passent tes critères (${candidates.length}) : assouplis le triage (confiance, ligues exclues) ou ré-inclus les cotes estimées.`
          );
          return;
        }
        const result = buildCombo(candidates, targetOdds, legsLimit, profile, newSeed ?? seed.current);
        if (result) {
          setCombo(result);
          // Enregistre le ticket pour la page plein écran /combo/ticket
          saveComboTicket({ savedAt: Date.now(), matchDate: date, targetOdds, profile, combo: result });
        } else {
          // Côte max atteignable sous les contraintes du profil (1 par match + caps famille)
          setMaxPossible(maxAchievableOdds(candidates, legsLimit, profile));
        }
      } catch {
        setError("Impossible de générer le combiné pour l'instant. Réessaie dans un instant.");
      } finally {
        setGenerating(false);
      }
    },
    [target, legsLimit, profile, date, upcoming, analyzeAll, buildCandidates, criteria]
  );

  // ---------- Partage ----------
  const onShare = useCallback(async () => {
    if (!combo) return;
    setSharing(true);
    try {
      const card = buildComboCard({
        legs: combo.legs.map((l) => ({
          pick: l.pick,
          matchLabel: `${l.homeName} vs ${l.awayName}`,
          odds: l.odds,
        })),
        comboOdds: combo.comboOdds,
        comboProb: combo.comboProb,
        stakeLabel: `Mise conseillée ${Math.round(combo.kelly * BANKROLL)} €`,
      });
      await shareCard(card);
    } catch {
      // partage annulé ou indisponible
    } finally {
      setSharing(false);
    }
  }, [combo]);

  // ---------- Échange d'une jambe ----------
  const swapAlts = useMemo(() => {
    if (!swap || !combo) return [];
    return listAlternatives(poolRef.current, combo.legs, swap.index, profile);
  }, [swap, combo, profile]);

  // Task 19-c — « Autres paris du même match » : tous les candidats du vivier
  // pour le matchId de la jambe échangée (hors la sélection jouée), regroupés
  // par marché. Le pool est déjà filtré par les critères de triage.
  const sameMatchAlts = useMemo(() => {
    if (!swap || !combo) return [];
    return listSameMatchAlternatives(poolRef.current, combo.legs, swap.index);
  }, [swap, combo]);

  const sameMatchGroups = useMemo(() => groupByMarket(sameMatchAlts), [sameMatchAlts]);

  const filteredSameMatchGroups = useMemo(() => {
    if (!swap || swap.filter === 'all') return sameMatchGroups;
    return sameMatchGroups
      .map((g) => ({ ...g, legs: g.legs.filter((a) => riskBadge(a.prob).tone === swap.filter) }))
      .filter((g) => g.legs.length > 0);
  }, [swap, sameMatchGroups]);

  const filteredAlts = useMemo(() => {
    if (!swap || swap.filter === 'all') return swapAlts;
    return swapAlts.filter((a) => riskBadge(a.prob).tone === swap.filter);
  }, [swap, swapAlts]);

  /** Sélections max cochables : le ticket ne peut pas dépasser legsLimit jambes */
  const maxSwapPicks = useMemo(() => {
    if (!combo) return 1;
    return Math.max(1, combo.legsLimit - (combo.legs.length - 1));
  }, [combo]);

  /** Candidat « même match » sélectionné (remplacement 1-pour-1) */
  const sameCandidate = useMemo(() => {
    if (!swap || !swap.samePick) return null;
    return sameMatchAlts.find((a) => legKey(a) === swap.samePick) ?? null;
  }, [swap, sameMatchAlts]);

  /** Aperçu en direct : cote/proba du ticket si l'on valide la sélection courante */
  const swapPreview = useMemo(() => {
    if (!swap || !combo) return null;
    const chosen: ComboLeg[] = [];
    if (sameCandidate) {
      chosen.push(sameCandidate);
    } else if (swap.picks.length > 0) {
      chosen.push(
        ...swap.picks
          .map((k) => swapAlts.find((a) => legKey(a) === k))
          .filter((a): a is ComboLeg => Boolean(a))
      );
    }
    if (chosen.length === 0) return null;
    const legs = [...combo.legs.filter((_, i) => i !== swap.index), ...chosen];
    const odds = legs.reduce((acc, l) => acc * l.odds, 1);
    const prob = legs.reduce((acc, l) => acc * l.prob, 1);
    return { odds, prob, count: legs.length, before: combo.comboOdds };
  }, [swap, combo, swapAlts, sameCandidate]);

  const toggleSwapPick = useCallback(
    (key: string) => {
      setSwap((s) => {
        if (!s) return s;
        if (s.picks.includes(key)) return { ...s, picks: s.picks.filter((k) => k !== key) };
        if (s.picks.length >= maxSwapPicks) return s;
        // Sections exclusives : choisir un autre match annule le pari du même match
        return { ...s, picks: [...s.picks, key], samePick: null };
      });
    },
    [maxSwapPicks]
  );

  /** Task 19-c : un seul autre pari du même match (jamais 2 jambes du même match) */
  const toggleSamePick = useCallback((key: string) => {
    setSwap((s) => {
      if (!s) return s;
      return { ...s, samePick: s.samePick === key ? null : key, picks: [] };
    });
  }, []);

  const applySwap = useCallback(() => {
    if (!swap || !combo) return;
    const chosen: ComboLeg[] = [];
    if (sameCandidate) {
      // Task 19-c : autre pari du MÊME match (substitution 1-pour-1 en place)
      chosen.push(sameCandidate);
    } else if (swap.picks.length > 0) {
      chosen.push(
        ...swap.picks
          .map((k) => swapAlts.find((a) => legKey(a) === k))
          .filter((a): a is ComboLeg => Boolean(a))
      );
    }
    if (chosen.length === 0) return;
    const nextLegs = [...combo.legs];
    nextLegs.splice(swap.index, 1, ...chosen);
    let next = recomputeCombo(nextLegs, profile, combo.targetOdds, combo.legsLimit);
    if (!next) return;
    // Garde-fou objectif : un échange manuel peut faire retomber la cote
    // totale sous la cible (ex. ×10 → ×8.32) tout en gardant le label
    // « cible ×10 ». On tente de rétablir la cible avec le vivier ; si
    // c'est impossible, le ticket est conservé mais affiché « sous
    // l'objectif » (badge honnête au lieu d'une promesse fausse).
    const repaired = repairToTarget(nextLegs, poolRef.current, combo.targetOdds, profile);
    if (repaired && repaired.length >= 2) {
      const fixed = recomputeCombo(repaired, profile, combo.targetOdds, combo.legsLimit);
      if (fixed) next = fixed;
    }
    undoStack.current.push(combo);
    setHasUndo(true);
    setCombo(next);
    saveComboTicket({ savedAt: Date.now(), matchDate: date, targetOdds: next.targetOdds, profile, combo: next });
    setSwap(null);
  }, [swap, combo, profile, date, swapAlts, sameCandidate]);

  const undoSwap = useCallback(() => {
    const prev = undoStack.current.pop();
    if (!prev) {
      setHasUndo(false);
      return;
    }
    setCombo(prev);
    saveComboTicket({ savedAt: Date.now(), matchDate: date, targetOdds: prev.targetOdds, profile: prev.profile, combo: prev });
    setHasUndo(undoStack.current.length > 0);
  }, [date]);

  const dateChips = useMemo(() => {
    const chips: Array<{ iso: string; label: string; sub: string }> = [];
    for (let off = 0; off <= 3; off++) {
      const d = new Date(new Date().getTime() + off * 86400000);
      const iso = d.toISOString().slice(0, 10);
      chips.push({
        iso,
        label: off === 0 ? "Aujourd'hui" : off === 1 ? 'Demain' : WEEKDAY_FMT.format(d),
        sub: DAY_MONTH_FMT.format(d),
      });
    }
    return chips;
  }, []);

  const stakeEur = combo ? Math.round(combo.kelly * BANKROLL) : 0;

  return (
    <div className='mx-auto flex min-h-[100dvh] max-w-[480px] flex-col bg-background'>
      {/* Header */}
      <header className='pt-safe sticky top-0 z-40 border-b border-white/[0.05] bg-[#0a0a0c]/90 px-5 pb-3 backdrop-blur-sm'>
        <div className='flex items-center gap-3 pt-3'>
          <Link
            href='/'
            className='flex h-9 w-9 items-center justify-center rounded-2xl bg-white/[0.06] text-foreground/70 transition-[color,background-color,transform] active:scale-95'
            aria-label='Retour à l accueil'
          >
            <ArrowLeft size={16} />
          </Link>
          <div className='flex items-center gap-2'>
            <span className='flex h-9 w-9 items-center justify-center rounded-2xl bg-[#e8ff00] volt-glow'>
              <Ticket size={18} className='text-black' />
            </span>
            <div className='leading-none'>
              <div className='font-display text-[16px] font-bold tracking-tight'>Par combiné</div>
              <div className='mt-1 text-[10px] text-muted-foreground'>Ta côte cible, notre combiné optimal</div>
            </div>
          </div>
        </div>

        {/* Sélecteur de date */}
        {mounted && (
          <div className='volt-scroll -mx-5 mt-3 flex gap-1.5 overflow-x-auto px-5 pb-1'>
            {dateChips.map((c) => (
              <button
                key={c.iso}
                onClick={() => setDate(c.iso)}
                className={cn(
                  'flex shrink-0 flex-col items-center rounded-2xl px-3.5 py-2 transition',
                  date === c.iso
                    ? 'bg-[#e8ff00] text-black volt-glow'
                    : 'bg-white/[0.05] text-foreground/70'
                )}
              >
                <span className='text-[11px] font-bold leading-none'>{c.label}</span>
                <span className={cn('mt-1 text-[10px] leading-none', date === c.iso ? 'text-black/60' : 'text-muted-foreground')}>
                  {c.sub}
                </span>
              </button>
            ))}
          </div>
        )}
      </header>

      <main className='flex-1 px-5 pb-32 pt-4'>
        {/* Explication */}
        <div className='rounded-3xl border border-[#e8ff00]/20 bg-[#e8ff00]/[0.05] p-4'>
          <div className='flex items-center gap-2'>
            <Layers size={15} className='text-[#e8ff00]' />
            <span className='text-[14px] font-bold'>Combinator</span>
          </div>
          <p className='mt-1.5 text-[12px] leading-relaxed text-muted-foreground'>
            Indique la côte que tu vises, ton niveau de risque et TES critères. Le moteur analyse tous les matchs
            (Poisson · Elo · Forme, ancrés sur les cotes réelles) et empile les sélections les plus
            sûres — 1X2, Double Chance, Over/Under 1.5/2.5/3.5, BTTS — jusqu&apos;à atteindre ta côte
            avec la probabilité de gain maximale. Une seule sélection par match, jamais de pari à
            30 % de chances.
          </p>
        </div>

        {/* Formulaire */}
        <div className='rounded-3xl bg-[#141418] mt-3 p-4'>
          <label className='text-[12px] font-semibold text-muted-foreground' htmlFor='target-odds'>
            Côte cible du combiné
          </label>
          <input
            id='target-odds'
            inputMode='decimal'
            value={target}
            onChange={(e) => setTarget(e.target.value.replace(/[^0-9.,]/g, ''))}
            placeholder='ex : 5'
            className='mt-1.5 rounded-xl bg-white/[0.06] px-4 py-3 text-[22px] font-bold tabular-nums outline-none focus:ring-1 focus:ring-[#e8ff00]/50'
          />
          <div className='mt-2 flex flex-wrap gap-1.5'>
            {TARGET_CHIPS.map((t) => (
              <button
                key={t}
                onClick={() => setTarget(String(t))}
                className={cn('rounded-full bg-white/[0.06] px-3.5 py-1.5 text-[12px] font-semibold text-foreground/70 transition-[color,background-color,transform] active:scale-95', parseFloat(target.replace(',', '.')) === t && 'bg-[#e8ff00] text-black')}
              >
                ×{t}
              </button>
            ))}
          </div>

          <div className='mt-3.5'>
            <span className='text-[12px] font-semibold text-muted-foreground'>Profil de risque</span>
            <div className='mt-1.5 flex gap-1.5'>
              {(Object.keys(PROFILES) as RiskProfile[]).map((k) => (
                <button
                  key={k}
                  onClick={() => setProfile(k)}
                  className={cn(
                    'flex-1 rounded-xl px-1 py-2.5 text-[12px] font-bold transition-[color,background-color,transform] active:scale-95',
                    profile === k
                      ? 'bg-[#e8ff00] text-black volt-glow'
                      : 'bg-white/[0.06] text-foreground/70'
                  )}
                >
                  <span className='mr-0.5'>{PROFILES[k].emoji}</span> {PROFILES[k].label}
                </button>
              ))}
            </div>
            <p className='mt-1.5 text-[11px] leading-snug text-muted-foreground'>
              {PROFILES[profile].description} — aucune sélection en dessous, même pour atteindre ta côte.
            </p>
          </div>

          <div className='mt-3.5'>
            <span className='text-[12px] font-semibold text-muted-foreground'>
              Nombre max de matchs : {legsLimit}
            </span>
            <div className='mt-1.5 flex gap-1.5'>
              {[2, 3, 4, 5, 6, 7, 8].map((n) => (
                <button
                  key={n}
                  onClick={() => setLegsLimit(n)}
                  className={cn(
                    'h-9 flex-1 rounded-xl text-[13px] font-bold transition-[color,background-color,transform]',
                    legsLimit === n ? 'bg-[#e8ff00] text-black' : 'bg-white/[0.06] text-foreground/70'
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          {/* ---------- Critères de triage (v2) ---------- */}
          <button
            onClick={() => setShowCriteria((v) => !v)}
            aria-expanded={showCriteria}
            className='mt-4 flex w-full items-center justify-between rounded-2xl border border-white/[0.08] bg-white/[0.04] px-4 py-3 transition active:scale-[0.99]'
          >
            <span className='flex items-center gap-2 text-[13px] font-bold'>
              <SlidersHorizontal size={15} className='text-[#e8ff00]' />
              Critères du combiné
              {criteriaCount > 0 && (
                <span className='rounded-full bg-[#e8ff00] px-1.5 py-px text-[10px] font-bold text-black'>
                  {criteriaCount} actif{criteriaCount > 1 ? 's' : ''}
                </span>
              )}
            </span>
            <ChevronDown size={16} className={cn('text-muted-foreground transition-transform', showCriteria && 'rotate-180')} />
          </button>

          {showCriteria && (
            <div className='mt-2 rounded-2xl border border-white/[0.07] bg-black/25 p-3.5'>
              {/* Marchés autorisés */}
              <div className='text-[11px] font-semibold text-muted-foreground mb-1.5'>Marchés utilisés</div>
              <div className='flex flex-wrap gap-1.5'>
                {(
                  [
                    { k: 'result', label: '1X2' },
                    { k: 'doubleChance', label: 'Double Chance' },
                    { k: 'totals', label: 'Over/Under' },
                    { k: 'btts', label: 'BTTS' },
                  ] as Array<{ k: keyof ComboCriteria['markets']; label: string }>
                ).map((m) => (
                  <button
                    key={m.k}
                    onClick={() =>
                      updateCriteria({ ...criteria, markets: { ...criteria.markets, [m.k]: !criteria.markets[m.k] } })
                    }
                    aria-pressed={criteria.markets[m.k]}
                    className={cn('rounded-full bg-white/[0.06] px-3.5 py-1.5 text-[12px] font-semibold text-foreground/70 transition-[color,background-color,transform] active:scale-95', criteria.markets[m.k] && 'bg-[#e8ff00] text-black')}
                  >
                    {m.label}
                  </button>
                ))}
              </div>

              {/* Confiance minimale */}
              <div className='text-[11px] font-semibold text-muted-foreground mt-3.5 mb-1.5'>Confiance minimale du modèle</div>
              <div className='flex gap-1.5'>
                {[1, 2, 3, 4].map((n) => (
                  <button
                    key={n}
                    onClick={() => updateCriteria({ ...criteria, minConfidence: n })}
                    className={cn(
                      'h-8 flex-1 rounded-xl text-[12px] font-bold transition-[color,background-color,transform]',
                      criteria.minConfidence === n ? 'bg-[#e8ff00] text-black' : 'bg-white/[0.06] text-foreground/70'
                    )}
                  >
                    {n === 1 ? 'Toutes' : `${n}★+`}
                  </button>
                ))}
              </div>

              {/* Cotes réelles uniquement (défaut ON : cote totale obtenable) */}
              <button
                onClick={() => updateCriteria({ ...criteria, realOddsOnly: !criteria.realOddsOnly })}
                aria-pressed={criteria.realOddsOnly}
                className='mt-3.5 flex w-full items-center justify-between gap-2 text-left'
              >
                <span className='min-w-0'>
                  <span className='block text-[12.5px] font-semibold'>Cotes réelles uniquement</span>
                  <span className='mt-0.5 block text-[10.5px] leading-snug text-muted-foreground'>
                    {criteria.realOddsOnly
                      ? 'La cote totale du combiné est réellement obtenable chez le bookmaker.'
                      : 'Cotes estimées ré-incluses (BTTS, matchs sans cotes) : la cote totale ne sera pas garantie au guichet.'}
                  </span>
                </span>
                <span
                  className={cn(
                    'relative h-6 w-10 shrink-0 rounded-full transition-colors',
                    criteria.realOddsOnly ? 'bg-[#e8ff00]' : 'bg-white/[0.12]'
                  )}
                >
                  <span
                    className={cn(
                      'absolute top-[3px] h-[18px] w-[18px] rounded-full bg-white shadow transition-transform',
                      criteria.realOddsOnly ? 'translate-x-[21px]' : 'translate-x-[3px]'
                    )}
                  />
                </span>
              </button>

              {/* Ligues exclues */}
              {data && data.leagues.length > 0 && (
                <div className='mt-3.5'>
                  <div className='text-[11px] font-semibold text-muted-foreground mb-1.5 flex items-center gap-1.5'>
                    <Ban size={11} /> Ligues exclues ({criteria.excludedLeagues.length})
                  </div>
                  <div className='volt-scroll -mx-1 max-h-36 overflow-y-auto px-1'>
                    <div className='flex flex-wrap gap-1.5 pb-1'>
                      {data.leagues.map((l) => {
                        const excluded = criteria.excludedLeagues.includes(l.code);
                        return (
                          <button
                            key={l.code}
                            onClick={() =>
                              updateCriteria({
                                ...criteria,
                                excludedLeagues: excluded
                                  ? criteria.excludedLeagues.filter((c) => c !== l.code)
                                  : [...criteria.excludedLeagues, l.code],
                              })
                            }
                            aria-pressed={excluded}
                            className={cn(
                              'shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold transition',
                              excluded
                                ? 'bg-[#ff4d5e]/20 text-[#ff9aa2] line-through decoration-[#ff4d5e]/60'
                                : 'bg-white/[0.06] text-foreground/70'
                            )}
                            title={l.name}
                          >
                            {l.shortName} ({l.matches.length})
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <p className='mt-1.5 text-[10.5px] leading-snug text-muted-foreground'>
                    Touche une ligue pour l&apos;exclure du vivier (le compteur affiche ses matchs du jour).
                  </p>
                </div>
              )}

              {/* Résumé + reset */}
              <div className='mt-3.5 flex items-center justify-between gap-2 border-t border-white/[0.07] pt-3'>
                <p className='min-w-0 flex-1 text-[10.5px] leading-snug text-muted-foreground'>
                  {criteriaCount === 0
                    ? 'Aucun critère actif : le moteur pioche dans tout le vivier analysé.'
                    : criteriaSummary(criteria).join(' · ')}
                </p>
                {criteriaCount > 0 && (
                  <button
                    onClick={() => updateCriteria({ ...DEFAULT_CRITERIA, markets: { ...DEFAULT_CRITERIA.markets }, excludedLeagues: [] })}
                    className='shrink-0 rounded-xl bg-white/[0.07] px-3 py-1.5 text-[11px] font-bold text-foreground/70 transition active:scale-95'
                  >
                    Réinitialiser
                  </button>
                )}
              </div>
            </div>
          )}

          <button
            onClick={() => generate()}
            disabled={generating || upcoming.length < 2}
            className='mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-[#e8ff00] py-3.5 text-[15px] font-bold text-black transition-[color,background-color,opacity,transform] active:scale-[0.98] disabled:opacity-40 volt-glow'
          >
            {generating ? <Loader2 size={17} className='animate-spin' /> : <Sparkles size={17} />}
            {generating ? 'Analyse en cours…' : 'Générer mon combiné'}
          </button>

          {data && upcoming.length < 2 && (
            <p className='mt-2.5 text-center text-[12px] text-muted-foreground'>
              Pas assez de matchs à venir ce jour-là ({upcoming.length} trouvés) pour un combiné.
            </p>
          )}
        </div>

        {/* Progression */}
        {generating && progress.total > 0 && (
          <div className='mt-3 rounded-2xl bg-white/[0.04] px-4 py-3'>
            <div className='flex items-center justify-between text-[12px] text-muted-foreground'>
              <span className='flex items-center gap-2'>
                <Loader2 size={13} className='animate-spin text-[#e8ff00]' />
                Analyse IA des matchs…
              </span>
              <span className='tabular-nums'>
                {Math.min(progress.done, progress.total)}/{progress.total}
              </span>
            </div>
            <div className='mt-2 h-[6px] overflow-hidden rounded-full bg-white/[0.07]'>
              <div
                className='volt-bar h-full rounded-full bg-[#e8ff00]'
                style={{ width: `${Math.max(2, (Math.min(progress.done, progress.total) / progress.total) * 100)}%` }}
              />
            </div>
          </div>
        )}

        {/* Erreurs */}
        {error && (
          <div className='mt-3 rounded-2xl bg-[#ff4d5e]/[0.08] px-4 py-3 text-[13px] text-[#ff9aa2]'>{error}</div>
        )}
        {maxPossible !== null && (
          <div className='mt-3 rounded-2xl bg-white/[0.04] px-4 py-3.5 text-[13px] text-muted-foreground'>
            <span className='font-semibold text-foreground'>
              Côte {target} hors de portée en mode {PROFILES[profile].label}.
            </span>{' '}
            Avec un plancher de {Math.round(PROFILES[profile].minProb * 100)} % de probabilité par jambe et{' '}
            {legsLimit} matchs max, la cote atteignable tourne autour de{' '}
            <span className='font-bold text-[#e8ff00]'>×{maxPossible.toFixed(2)}</span>.{' '}
            {profile !== 'agressif'
              ? 'Passe en mode Agressif ou augmente le nombre de matchs.'
              : 'Augmente le nombre de matchs ou choisis une autre journée.'}
          </div>
        )}

        {/* Ticket résultat — cliquable : ouvre la vue plein écran /combo/ticket */}
        {combo && (
          <div className='mt-4'>
            <Link
              href='/combo/ticket'
              aria-label='Afficher le ticket combiné en plein écran (noms complets)'
              className='block overflow-hidden rounded-3xl border border-[#e8ff00]/25 bg-[#141418]'
            >
              <div className='flex items-center justify-between bg-[#e8ff00] px-4 py-2.5'>
                <span className='flex items-center gap-1.5 text-[13px] font-bold text-black'>
                  <Ticket size={14} /> PARIS COMBINÉ
                </span>
                <span className='flex items-center gap-1.5 text-[11px] font-semibold text-black/70'>
                  {combo.comboOdds < combo.targetOdds - 0.005 && (
                    <span className='rounded-full bg-black/20 px-2 py-0.5'>Sous l&apos;objectif ×{combo.targetOdds}</span>
                  )}
                  {combo.legs.length} sélections
                  <Maximize2 size={12} />
                </span>
              </div>

              <div className='divide-y divide-white/[0.05]'>
                {combo.legs.map((leg, i) => (
                  <div key={legKey(leg)} className='flex items-center gap-2.5 px-4 py-3'>
                    <span className='flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#e8ff00]/12 text-[11px] font-bold text-[#e8ff00]'>
                      {i + 1}
                    </span>
                    <div className='min-w-0 flex-1'>
                      <div className='flex items-center gap-1.5'>
                        <span className='truncate text-[13px] font-semibold leading-tight'>{leg.pick}</span>
                        <RiskChip prob={leg.prob} />
                      </div>
                      <div className='mt-0.5 truncate text-[11px] text-muted-foreground'>
                        {leg.homeName} vs {leg.awayName} · {formatHour(leg.matchDate)} ·{' '}
                        {ODDS_SOURCE_LABEL[leg.oddsSource]}
                      </div>
                    </div>
                    <div className='shrink-0 text-right'>
                      <div className='text-[15px] font-bold tabular-nums text-[#e8ff00]'>{leg.odds.toFixed(2)}</div>
                      <div className='text-[10px] tabular-nums text-muted-foreground'>{Math.round(leg.prob * 100)} %</div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setSwap({ index: i, picks: [], samePick: null, filter: 'all' });
                      }}
                      aria-label={`Remplacer la sélection : ${leg.pick} (${leg.homeName} vs ${leg.awayName})`}
                      className='flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/[0.06] text-muted-foreground transition-[color,background-color,transform] active:scale-90'
                    >
                      <Repeat2 size={14} />
                    </button>
                  </div>
                ))}
              </div>

              {/* Totaux */}
              <div className='border-t border-[#e8ff00]/25 bg-[#e8ff00]/[0.06] px-4 py-4'>
                <div className='flex items-end justify-between'>
                  <div>
                    <div className='text-[11px] uppercase tracking-wider text-muted-foreground'>Côte totale</div>
                    <div className='text-[34px] font-bold leading-none text-[#e8ff00] tabular-nums'>
                      {combo.comboOdds.toFixed(2)}
                    </div>
                  </div>
                  <div className='text-right text-[12px] leading-relaxed'>
                    <div className='text-muted-foreground'>
                      Probabilité : <span className='font-bold text-foreground'>{Math.round(combo.comboProb * 100)} %</span>
                    </div>
                    <div className='text-muted-foreground'>
                      Valeur :{' '}
                      <span className={cn('font-bold', combo.comboEV >= 0 ? 'text-[#a3e635]' : 'text-[#ff4d5e]')}>
                        {combo.comboEV >= 0 ? '+' : ''}
                        {Math.round(combo.comboEV * 100)} %
                      </span>
                    </div>
                    <div className='text-muted-foreground'>
                      Mise Kelly : <span className='font-bold text-foreground'>{stakeEur} €</span>
                      <span className='text-muted-foreground/70'> / {BANKROLL} €</span>
                    </div>
                  </div>
                </div>
              </div>
            </Link>

            <p className='mt-1.5 flex items-center justify-center gap-1 text-[10px] text-muted-foreground/70'>
              <Maximize2 size={10} /> Appuie sur le ticket pour l&apos;afficher en plein écran (noms
              et marchés complets)
            </p>

            {/* Actions */}
            <div className='mt-3 grid grid-cols-2 gap-2.5'>
              <button
                onClick={() => {
                  seed.current += 1;
                  generate(seed.current);
                }}
                disabled={generating}
                className='flex items-center justify-center gap-2 rounded-2xl bg-white/[0.07] py-3.5 text-[14px] font-bold text-foreground transition-[color,background-color,opacity,transform] active:scale-[0.98] disabled:opacity-40'
              >
                <Shuffle size={15} />
                Autre option
              </button>
              <button
                onClick={onShare}
                disabled={sharing}
                className='flex w-full items-center justify-center gap-2 rounded-2xl bg-[#e8ff00] py-3.5 text-[14px] font-bold text-black transition-[color,background-color,opacity,transform] active:scale-[0.98] disabled:opacity-40'
              >
                {sharing ? <Loader2 size={15} className='animate-spin' /> : <Share2 size={15} />}
                Partager
              </button>
            </div>

            {hasUndo && (
              <button
                onClick={undoSwap}
                className='mt-2 flex w-full items-center justify-center gap-1.5 rounded-2xl bg-white/[0.04] py-2.5 text-[12px] font-semibold text-muted-foreground transition-[color,background-color,transform] active:scale-[0.98]'
              >
                <Repeat2 size={12} /> Annuler le dernier échange
              </button>
            )}

            <div className='mt-3 flex items-start gap-2 rounded-2xl bg-white/[0.04] px-4 py-3 text-[11px] leading-relaxed text-muted-foreground'>
              <CheckCircle2 size={13} className='mt-0.5 shrink-0 text-[#e8ff00]' />
              Probabilités multipliées (hypothèse d'indépendance) : des matchs corrélés — même
              championnat, même journée, conditions liées — peuvent s'écarter de ce produit. Par
              défaut, seules les cotes réelles ou dérivées du marché sont utilisées : la cote totale
              est réellement obtenable chez ton bookmaker. Combiné informatif — joue toujours de
              façon responsable, 18+.
            </div>
          </div>
        )}

        {/* État vide */}
        {!combo && !generating && !error && maxPossible === null && data && upcoming.length >= 2 && (
          <div className='mt-4 flex flex-col items-center gap-2 rounded-3xl border border-dashed border-white/10 py-10 text-center'>
            <Zap size={26} className='text-white/15' />
            <p className='max-w-[250px] text-[13px] leading-relaxed text-muted-foreground'>
              Choisis ta côte cible puis lance la génération. L&apos;analyse des {upcoming.length} matchs à
              venir prend quelques secondes.
            </p>
          </div>
        )}
        {!data && !loadError && (
          <div className='mt-4 flex flex-col items-center gap-2 rounded-3xl border border-dashed border-white/10 py-10 text-center'>
            <CalendarDays size={26} className='text-white/15' />
            <p className='text-[13px] text-muted-foreground'>Chargement des matchs…</p>
          </div>
        )}
        {/* Task 18-b : échec de chargement ≠ vivier vide — message honnête + réessai,
            même langage visuel (carte pointillée + bouton volt) que /precision. */}
        {!data && loadError && (
          <div className='mt-4 flex flex-col items-center gap-3 rounded-3xl border border-dashed border-[#ff4d5e]/25 bg-[#ff4d5e]/[0.04] py-10 text-center'>
            <AlertTriangle size={26} className='text-white/15' />
            <div className='text-[14px] font-semibold'>Impossible de charger les matchs</div>
            <p className='max-w-[270px] text-[13px] leading-relaxed text-muted-foreground'>
              Vérifie ta connexion, le serveur est peut-être momentanément indisponible.
            </p>
            <button
              onClick={() => loadMatches(date)}
              className='mt-1 flex items-center gap-2 rounded-2xl bg-[#e8ff00] px-5 py-2.5 text-[13px] font-bold text-black transition-[color,background-color,transform] active:scale-95'
            >
              <RefreshCw size={14} /> Réessayer
            </button>
          </div>
        )}
      </main>

      {/* ---------- Sheet de remplacement d'une jambe ---------- */}
      {swap && combo && (
        <div
          className='fixed inset-0 z-[60] flex flex-col justify-end'
          role='dialog'
          aria-modal='true'
          aria-label='Remplacer une sélection du combiné'
        >
          <div className='absolute inset-0 bg-black/70' onClick={() => setSwap(null)} />
          <div className='relative mx-auto flex max-h-[86dvh] w-full max-w-[480px] flex-col overflow-hidden rounded-t-[28px] border-t border-white/10 bg-gradient-to-b from-[#15151b] to-[#101014] shadow-[0_-24px_70px_rgba(0,0,0,0.65)]'>
            {/* Poignée + en-tête */}
            <div className='relative px-5 pb-3 pt-3'>
              <div className='mx-auto mb-3 h-1 w-10 rounded-full bg-white/15' />
              <button
                onClick={() => setSwap(null)}
                aria-label='Fermer le panneau'
                className='absolute right-4 top-3 flex h-8 w-8 items-center justify-center rounded-xl bg-white/[0.06] text-muted-foreground transition-[color,background-color,transform] active:scale-90'
              >
                <X size={15} />
              </button>
              <div className='text-[15px] font-bold'>Remplacer la sélection</div>
              {(() => {
                const leg = combo.legs[swap.index];
                if (!leg) return null;
                return (
                  <div className='mt-1.5 rounded-2xl bg-[#ff4d5e]/[0.07] px-3.5 py-2.5 text-[12px] leading-snug'>
                    <span className='font-semibold text-[#ff9aa2]'>{leg.pick}</span>
                    <span className='text-muted-foreground'>
                      {' '}
                      · {leg.homeName} vs {leg.awayName} · cote {leg.odds.toFixed(2)}
                    </span>
                  </div>
                );
              })()}
              <p className='mt-2 text-[11px] leading-snug text-muted-foreground'>
                Garde le match en changeant de pari (« Autres paris du même match ») ou remplace-le par{' '}
                {maxSwapPicks > 1 ? '1 ou 2 sélections' : '1 sélection'} d&apos;un autre match — profil{' '}
                {PROFILES[profile].emoji} {PROFILES[profile].label}. Un seul pari par match dans le ticket.
              </p>
            </div>

            {/* Filtre de risque */}
            <div className='flex gap-1.5 px-5 pb-2.5'>
              {(
                [
                  { k: 'all', label: 'Tous' },
                  { k: 'good', label: 'Sûr' },
                  { k: 'mid', label: 'Moyen' },
                  { k: 'risky', label: 'Risqué' },
                ] as Array<{ k: 'all' | RiskTone; label: string }>
              ).map((f) => (
                <button
                  key={f.k}
                  onClick={() => setSwap((s) => (s ? { ...s, filter: f.k } : s))}
                  className={cn(
                    'flex-1 rounded-xl py-1.5 text-[11px] font-bold transition-[color,background-color,transform]',
                    swap.filter === f.k ? 'bg-[#e8ff00] text-black' : 'bg-white/[0.06] text-foreground/70'
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {/* Listes des alternatives — Task 19-c : 2 sections exclusives.
                1) « Autres paris du même match » : garder le match, changer de pari (1-pour-1).
                2) « D'un autre match » : comportement historique ⟳ (1-2 jambes). */}
            <div className='volt-scroll min-h-0 flex-1 overflow-y-auto px-5 pb-3'>
              {/* ----- Section 1 : autres paris du MÊME match ----- */}
              <div className='mb-1.5 text-[11px] font-semibold text-muted-foreground'>Autres paris du même match</div>
              {sameMatchAlts.length === 0 ? (
                <p className='rounded-2xl bg-white/[0.03] px-3.5 py-2.5 text-[11.5px] leading-snug text-muted-foreground'>
                  Aucun autre pari disponible pour ce match dans le vivier. Assouplis les critères
                  (panneau « Critères du combiné ») pour élargir les options.
                </p>
              ) : filteredSameMatchGroups.length === 0 ? (
                <p className='rounded-2xl bg-white/[0.03] px-3.5 py-2.5 text-[11.5px] leading-snug text-muted-foreground'>
                  Aucun pari du même match pour ce filtre de risque.
                </p>
              ) : (
                filteredSameMatchGroups.map((g) => (
                  <div key={g.id} className='mb-2.5'>
                    <div className='mb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70'>
                      {g.label}
                    </div>
                    <div className='flex flex-col gap-1.5'>
                      {g.legs.map((a) => {
                        const key = legKey(a);
                        const checked = swap.samePick === key;
                        const offProfile = !isLegInProfile(a, profile);
                        return (
                          <button
                            key={key}
                            onClick={() => toggleSamePick(key)}
                            aria-pressed={checked}
                            className={cn(
                              'flex items-center gap-3 rounded-2xl border px-3.5 py-2.5 text-left transition-[color,background-color,border-color,opacity,transform] active:scale-[0.99]',
                              checked ? 'border-[#e8ff00]/60 bg-[#e8ff00]/[0.07]' : 'border-white/[0.07] bg-white/[0.03]'
                            )}
                          >
                            <span
                              className={cn(
                                'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border',
                                checked ? 'border-[#e8ff00] bg-[#e8ff00]' : 'border-white/25'
                              )}
                            >
                              {checked && <CheckCircle2 size={12} className='text-black' />}
                            </span>
                            <div className='min-w-0 flex-1'>
                              <div className='flex items-center gap-1.5'>
                                <span className='truncate text-[12.5px] font-semibold leading-tight'>{a.pick}</span>
                                <RiskChip prob={a.prob} />
                              </div>
                              <div className='mt-0.5 flex items-center gap-1.5 text-[10.5px] text-muted-foreground'>
                                <span className='truncate'>
                                  {ODDS_SOURCE_LABEL[a.oddsSource]} · confiance {a.confidence}/5
                                </span>
                                {offProfile && (
                                  <span className='shrink-0 rounded-full bg-white/[0.08] px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-muted-foreground'>
                                    Hors profil
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className='shrink-0 text-right'>
                              <div className='text-[13.5px] font-bold tabular-nums text-[#e8ff00]'>{a.odds.toFixed(2)}</div>
                              <div className='text-[9.5px] tabular-nums text-muted-foreground'>{Math.round(a.prob * 100)} %</div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}

              {/* ----- Section 2 : alternatives d'un autre match (historique ⟳) ----- */}
              <div className='mb-1.5 mt-1 text-[11px] font-semibold text-muted-foreground'>D&apos;un autre match</div>
              {filteredAlts.length === 0 ? (
                <p className='py-6 text-center text-[12px] text-muted-foreground'>
                  Aucune autre sélection valide pour ce profil et ce filtre.
                </p>
              ) : (
                <div className='flex flex-col gap-1.5'>
                  {filteredAlts.map((a) => {
                    const key = legKey(a);
                    const checked = swap.picks.includes(key);
                    const full = !checked && swap.picks.length >= maxSwapPicks;
                    return (
                      <button
                        key={key}
                        onClick={() => toggleSwapPick(key)}
                        disabled={full}
                        aria-pressed={checked}
                        className={cn(
                          'flex items-center gap-3 rounded-2xl border px-3.5 py-2.5 text-left transition-[color,background-color,border-color,opacity,transform] active:scale-[0.99]',
                          checked ? 'border-[#e8ff00]/60 bg-[#e8ff00]/[0.07]' : 'border-white/[0.07] bg-white/[0.03]',
                          full && 'opacity-40'
                        )}
                      >
                        <span
                          className={cn(
                            'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border',
                            checked ? 'border-[#e8ff00] bg-[#e8ff00]' : 'border-white/25'
                          )}
                        >
                          {checked && <CheckCircle2 size={12} className='text-black' />}
                        </span>
                        <div className='min-w-0 flex-1'>
                          <div className='flex items-center gap-1.5'>
                            <span className='truncate text-[12.5px] font-semibold leading-tight'>{a.pick}</span>
                            <RiskChip prob={a.prob} />
                          </div>
                          <div className='mt-0.5 truncate text-[10.5px] text-muted-foreground'>
                            {a.homeName} vs {a.awayName} · {a.leagueShort} · {formatHour(a.matchDate)}
                          </div>
                        </div>
                        <div className='shrink-0 text-right'>
                          <div className='text-[13.5px] font-bold tabular-nums text-[#e8ff00]'>{a.odds.toFixed(2)}</div>
                          <div className='text-[9.5px] tabular-nums text-muted-foreground'>{Math.round(a.prob * 100)} %</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Pied : aperçu en direct + action */}
            <div className='border-t border-white/[0.07] bg-[#0f0f13] px-5 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3'>
              {swapPreview ? (
                <div
                  className={cn(
                    'mb-2.5 text-center text-[11.5px]',
                    swapPreview.odds < combo.targetOdds - 0.005 ? 'text-[#ff9aa2]' : 'text-muted-foreground'
                  )}
                >
                  Cote totale : <span className='font-bold tabular-nums text-foreground'>×{swapPreview.before.toFixed(2)}</span>{' '}
                  →{' '}
                  <span
                    className={cn(
                      'font-bold tabular-nums',
                      swapPreview.odds < combo.targetOdds - 0.005 ? 'text-[#ff4d5e]' : 'text-[#e8ff00]'
                    )}
                  >
                    ×{swapPreview.odds.toFixed(2)}
                  </span>{' '}
                  · probabilité{' '}
                  <span className='font-bold tabular-nums text-foreground'>
                    {Math.round(combo.comboProb * 100)} % → {Math.round(swapPreview.prob * 100)} %
                  </span>{' '}
                  · {swapPreview.count} sélections
                  {swapPreview.odds < combo.targetOdds - 0.005 && (
                    <span className='font-semibold'> — sous l&apos;objectif ×{combo.targetOdds} (réajustement auto à la validation)</span>
                  )}
                </div>
              ) : (
                <div className='mb-2.5 text-center text-[11px] text-muted-foreground/70'>
                  Coche 1 autre pari du même match, ou 1{maxSwapPicks > 1 ? ' ou 2' : ''} sélection
                  {maxSwapPicks > 1 ? 's' : ''} d&apos;un autre match, pour voir l&apos;impact sur le ticket
                </div>
              )}
              <button
                onClick={applySwap}
                disabled={!sameCandidate && swap.picks.length === 0}
                className='flex w-full items-center justify-center gap-2 rounded-2xl bg-[#e8ff00] py-3.5 text-[14px] font-bold text-black transition-[color,background-color,opacity,transform] active:scale-[0.98] disabled:opacity-40 volt-glow'
              >
                <Repeat2 size={15} />
                {sameCandidate
                  ? 'Remplacer par ce pari'
                  : swap.picks.length === 0
                    ? 'Remplacer'
                    : `Remplacer par ${swap.picks.length} sélection${swap.picks.length > 1 ? 's' : ''}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function formatHour(iso: string): string {
  return HOUR_FMT.format(new Date(iso));
}

const ODDS_SOURCE_LABEL: Record<OddsSource, string> = {
  real: 'cote réelle',
  market: 'cote marché',
  estimate: 'cote estimée',
};

function RiskChip({ prob }: { prob: number }) {
  const badge = riskBadge(prob);
  const cls =
    badge.tone === 'good'
      ? 'bg-[#a3e635]/15 text-[#a3e635]'
      : badge.tone === 'mid'
        ? 'bg-[#e8ff00]/15 text-[#e8ff00]'
        : 'bg-[#ff4d5e]/15 text-[#ff9aa2]';
  return (
    <span className={cn('shrink-0 rounded-full px-1.5 py-px text-[9px] font-bold uppercase tracking-wide', cls)}>
      {badge.label}
    </span>
  );
}
