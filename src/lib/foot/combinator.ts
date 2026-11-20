/**
 * VOLTRIX — Combinateur : construit un combiné à côte cible.
 *
 * Principe (fonctionnalité v1, restaurée et étendue à la semaine) :
 * l'utilisateur choisit une côte cible et un seuil de réussite
 * (20 / 30 / 40 %). Le moteur collecte toutes les sélections
 * « jouables » des matchs à venir (victoire V1/V2, match nul,
 * double chance, total buts, premier but — uniquement celles qui
 * ont une COTE : réelle du bookmaker pour 1X2/DC/totaux, cote
 * équitable 1/p dérivée du moteur pour le premier but), puis
 * cherche le meilleur combiné dont :
 *   - la côte totale (produit des cotes) atteint la cible ;
 *   - la probabilité de réussite (produit des probabilités moteur)
 *     dépasse le seuil demandé.
 * Une seule jambe par match : on ne cumule jamais deux paris sur
 * le même événement.
 *
 * Recherche : DFS avec élagage (cotes triées croissantes → coupure
 * dès que la côte max est dépassée ; les probabilités ne font que
 * décroître → toute branche sous le seuil est coupée). Budget de
 * nœuds borné pour garantir la réactivité sur téléphone. Si aucun
 * combiné n'atteint le seuil, un second passage « relâché » rend
 * le meilleur combiné possible avec un avertissement.
 */

import { dcFromMarket, deMargin1x2, deMarginOverUnder } from "./market-odds";
import type { LightMatch, MatchesResponse, QuickPred } from "../voltrix-types";

/* ---------- Types ---------- */

/** Une sélection jouable (une jambe de combiné). */
export interface ComboLeg {
  matchId: string;
  leagueCode: string;
  leagueShort: string;
  leagueName: string;
  home: string;
  homeShort: string;
  away: string;
  awayShort: string;
  kickoff: string; // ISO
  dayKey: string; // YYYY-MM-DD (pour rouvrir la fiche du match)
  market: string; // "Résultat", "Double chance", "Total buts 2.5"
  pick: string; // libellé lisible
  prob: number; // probabilité moteur
  odds: number; // cote décimale réelle
  /** v3.2 (boost parlay) : proba implicite DÉ-MARGÉE du marché
   *  pour cette jambe — 1/cote corrigée de la marge bookmaker
   *  (normalisation par famille, cf. betting-recommender). Null si
   *  la famille n'est pas dé-margable (cote équitable 1/p). */
  probMarket?: number | null;
}

/** Un combiné trouvé par le moteur. */
export interface ComboResult {
  legs: ComboLeg[]; // triées par coup d'envoi
  odds: number; // côte totale (produit)
  prob: number; // probabilité de réussite (produit)
  /** false : seuil demandé non atteint (meilleur possible). */
  meetsThreshold: boolean;
  /** v3.2 (boost parlay) : edge du combiné = prob × cote − 1
   *  (EV par unité misée). > 0 : le combiné bat le marché. */
  edge: number;
  /** v3.2 : indice de confiance = edge × prob (parlay-optimizer
   *  « confidence score ») — pondère l'edge par la probabilité
   *  réelle de toucher le combiné, élimine les monstres à 0,1 %
   *  de réussite même à forte EV théorique. */
  confidence: number;
  /** v3.2 : proba implicite du MARCHÉ pour le même combiné
   *  (produit des probas dé-margées). prob > probMarket = le
   *  moteur voit mieux le combiné que les books. */
  probMarket: number | null;
  /** v3.2 : seuil de rentabilité = 1/cote : taux de réussite
   *  minimum pour un EV nul (parlay-optimizer « break-even »). */
  breakEven: number;
  /** v3.2 : pénalité de concentration (0 = diversifié). */
  leaguePenalty: number;
}

/** Journée pré-calculée en entrée du pool. */
export interface ComboDayInput {
  date: string;
  foot: MatchesResponse | null;
  footPreds: Record<string, QuickPred> | null;
}

export interface ComboSearchParams {
  target: number; // côte cible (minimum à atteindre)
  minProb: number; // seuil de réussite (0.4 | 0.5 | 0.6)
  maxLegs?: number; // défaut 6
  tolerance?: number; // marge au-dessus de la cible (défaut 0.25 → 25 %)
  poolCap?: number; // taille max du pool (défaut 170)
  nodeBudget?: number; // sécurité performance (défaut 400 000 nœuds)
  /** Cote max PAR JAMBE (v3.0, défaut 5.0) — plus de jambe Angola @11. */
  maxLegOdds?: number;
  /** Inclure les marchés sans cote bookmaker (premier but, cote
   *  équitable 1/p) — v3.0 : opt-in, car leur prob×cote ≡ 1 traverse
   *  toujours le filtre de value sans rien garantir. */
  includeFairOddsLegs?: boolean;
}

export interface ComboSearchOutcome {
  results: ComboResult[]; // ≤ 3, meilleure en premier
  poolSize: number;
  matches: number; // matchs analysés (à venir, avec prono)
  relaxed: boolean; // true : résultats sous le seuil demandé
  aborted: boolean; // true : budget de recherche épuisé (résultats partiels)
}

/* ---------- Construction du pool de jambes ---------- */

const ODDS_MIN = 1.05;
const ODDS_MAX = 20;
const KICKOFF_MARGIN_MS = 10 * 60 * 1000; // le match doit commencer dans > 10 min

/** Cote max PAR JAMBE par défaut (v3.0) : 5,0 — les jambes à grosse
 *  cote (Angola @11) concentrent le biais favori/outsider du modèle
 *  et faisaient passer les filtres avec des probas gonflées. */
const LEG_ODDS_MAX_DEFAULT = 5.0;
/** Test de cohérence modèle/marché (v3.0) : une jambe est rejetée si
 *  la proba moteur dépasse 1,6 × la proba implicite dé-margée du
 *  bookmaker — modèle « trop beau » = surconfiance, pas de la value.
 *  Ne s'applique qu'aux jambes avec cote réelle. */
const MODEL_VS_MARKET_RATIO_MAX = 1.6;

/* ---------- v3.2 (boost parlay) : probas marché dé-margées ---------- */

/** Proba implicite dé-margée pour une jambe 1X2 (normalisation
 *  par la somme des inverses, cf. betting-recommender
 *  utilities.odds_to_probabilities : p_i = (1/o_i) / Σ(1/o_j)). */
function marketProb1x2(
  o: number,
  mH: number | null | undefined,
  mD: number | null | undefined,
  mA: number | null | undefined,
): number | null {
  const dm = deMargin1x2(mH ?? 0, mD ?? 0, mA ?? 0);
  if (!dm) return null;
  const idx = o === mH ? 0 : o === mD ? 1 : o === mA ? 2 : -1;
  if (idx < 0) return null;
  return idx === 0 ? dm.pH : idx === 1 ? dm.pD : dm.pA;
}

function validOdds(o: number | null | undefined): o is number {
  return typeof o === "number" && Number.isFinite(o) && o >= ODDS_MIN && o <= ODDS_MAX;
}

function validProb(p: number | null | undefined): p is number {
  return typeof p === "number" && Number.isFinite(p) && p > 0.05 && p < 0.985;
}

/**
 * Extrait les sélections jouables des journées fournies :
 * 1X2 (cotes moneyline), double chance (dérivée du 1X2 réel) et
 * total buts (ligne + cotes du bookmaker). Un match déjà commencé
 * ou terminé est ignoré, ainsi qu'un match sans prono moteur.
 *
 * v3.0 (garde-fous « combinateur trop risqué ») :
 *  - les probas 1X2 viennent du moteur CALÉ marché (probs de QuickPred,
 *    désormais 65 % marché + 35 % modèle) ;
 *  - cote max PAR JAMBE (défaut 5,0, réglable) ;
 *  - test de cohérence : proba modèle vs proba implicite dé-margée —
 *    rejet si le modèle dépasse 1,6× le marché (jambe « trop belle ») ;
 *  - premier but : OPT-IN (cote équitable 1/p, pas de cote réelle).
 */
export function buildLegPool(
  days: ComboDayInput[],
  opts: { maxLegOdds?: number; includeFairOddsLegs?: boolean } = {},
): { legs: ComboLeg[]; matches: number } {
  const legs: ComboLeg[] = [];
  const seenMatches = new Set<string>();
  const now = Date.now();
  let matches = 0;
  const legOddsMax = Math.min(ODDS_MAX, Math.max(1.5, opts.maxLegOdds ?? LEG_ODDS_MAX_DEFAULT));
  const includeFair = opts.includeFairOddsLegs === true;

  /* Test de cohérence modèle/marché pour une jambe à cote réelle :
   * proba moteur ≤ 1,6 × proba implicite dé-margée. Sans dé-marge
   * exploitable (cote unique), la jambe est gardée (le filtre
   * prob×cote ≥ 0,8 reste actif). */
  const modelNotCoherent = (prob: number, odds: number): boolean => {
    const implied = 1 / odds; // marge bookmaker ≈ 5-7 % → implicite minore le marché
    return prob > MODEL_VS_MARKET_RATIO_MAX * implied;
  };

  for (const day of days) {
    if (!day.foot) continue;
    for (const lg of day.foot.leagues) {
      for (const m of lg.matches) {
        if (seenMatches.has(m.id)) continue;
        const pred = day.footPreds?.[m.id];
        if (!pred) continue;
        if (m.status !== "pre") continue;
        if (new Date(m.date).getTime() < now + KICKOFF_MARGIN_MS) continue;
        seenMatches.add(m.id);
        matches++;

        const base = {
          matchId: m.id,
          leagueCode: m.leagueCode,
          leagueShort: lg.shortName || m.leagueShort,
          leagueName: m.leagueName,
          home: m.home.name,
          homeShort: m.home.shortName || m.home.name,
          away: m.away.name,
          awayShort: m.away.shortName || m.away.name,
          kickoff: m.date,
          dayKey: day.date,
        };

        /* --- Résultat 1X2 (cotes réelles du bookmaker, probas moteur
         *     calées marché depuis v3.0) — v3.2 : proba marché
         *     dé-margée par famille (1X2) attachée à la jambe. --- */
        const okLeg = (o: number | null | undefined, p: number | null | undefined): o is number =>
          validOdds(o) && o <= legOddsMax && validProb(p) && !modelNotCoherent(p, o);
        const mkt1 = (o: number | null | undefined) =>
          o == null ? null : marketProb1x2(o, m.mlHome, m.mlDraw, m.mlAway);
        if (okLeg(m.mlHome, pred.probs.home)) {
          legs.push({
            ...base,
            market: "Résultat",
            pick: `Victoire ${base.home}`,
            prob: pred.probs.home,
            odds: m.mlHome,
            probMarket: mkt1(m.mlHome),
          });
        }
        if (okLeg(m.mlDraw, pred.probs.draw)) {
          legs.push({
            ...base,
            market: "Résultat",
            pick: "Match nul",
            prob: pred.probs.draw,
            odds: m.mlDraw,
            probMarket: mkt1(m.mlDraw),
          });
        }
        if (okLeg(m.mlAway, pred.probs.away)) {
          legs.push({
            ...base,
            market: "Résultat",
            pick: `Victoire ${base.away}`,
            prob: pred.probs.away,
            odds: m.mlAway,
            probMarket: mkt1(m.mlAway),
          });
        }

        /* --- Double chance (dérivée du 1X2 réel, marge bornée) ---
         * v3.0 : garde-fous identiques (cote max jambe, cohérence
         * modèle vs marché : la proba DC affichée vient du marché
         * dé-margé — même test 1,6× contre sa propre cote). */
        const dc =
          validOdds(m.mlHome) && validOdds(m.mlDraw) && validOdds(m.mlAway)
            ? dcFromMarket(m.mlHome, m.mlDraw, m.mlAway)
            : null;
        if (dc) {
          const dcLeg = (pick: string, p: number, o: number) => {
            if (!(o <= legOddsMax) || !validProb(p) || modelNotCoherent(p, o)) return;
            legs.push({ ...base, market: "Double chance", pick, prob: p, odds: o, probMarket: null });
          };
          dcLeg(`1X — ${base.homeShort} ou nul`, dc.prob1X, dc.odds1X);
          dcLeg("12 — pas de match nul", dc.prob12, dc.odds12);
          dcLeg(`X2 — ${base.awayShort} ou nul`, dc.probX2, dc.oddsX2);
        }

        /* --- Total buts (ligne et cotes du bookmaker) — v3.2 : proba
         *     marché dé-margée par la famille over/under de la ligne. --- */
        const ou = pred.ouOdds;
        if (ou && validOdds(ou.over) && validOdds(ou.under) && ou.line != null) {
          const entry = pred.overUnder?.find((e) => Math.abs(e.line - ou.line!) < 0.01);
          if (entry) {
            const dmOU = deMarginOverUnder(ou.over, ou.under);
            const mktO = dmOU?.pOver ?? null;
            const mktU = dmOU?.pUnder ?? null;
            if (validProb(entry.over) && ou.over <= legOddsMax && !modelNotCoherent(entry.over, ou.over)) {
              legs.push({
                ...base,
                market: `Total buts ${entry.line}`,
                pick: `Plus de ${entry.line} buts`,
                prob: entry.over,
                odds: ou.over,
                probMarket: mktO,
              });
            }
            if (validProb(entry.under) && ou.under <= legOddsMax && !modelNotCoherent(entry.under, ou.under)) {
              legs.push({
                ...base,
                market: `Total buts ${entry.line}`,
                pick: `Moins de ${entry.line} buts`,
                prob: entry.under,
                odds: ou.under,
                probMarket: mktU,
              });
            }
          }
        }

        /* --- Premier but — OPT-IN (v3.0) : probabilités moteur, cote
         *     dérivée = cote équitable 1/p (ESPN ne publie pas ce
         *     marché). Leur prob×cote ≡ 1 passe TOUJOURS le filtre de
         *     value sans rien garantir : ils ne figurent plus dans le
         *     pool par défaut, uniquement si l'utilisateur les active.
         *     Cote équitable soumise à la même cote max par jambe. --- */
        if (includeFair) {
          const fg = pred.firstGoal;
          if (fg && fg.windows.length >= 6) {
            const bounds = [15, 30, 45, 60, 75];
            let cumBefore = 0;
            for (let i = 0; i < bounds.length; i++) {
              cumBefore += fg.windows[i];
              const after = 1 - cumBefore - fg.noGoal;
              const b = bounds[i];
              const fgLeg = (pick: string, p: number) => {
                if (!validProb(p)) return;
                const odds = Math.min(legOddsMax, Math.max(ODDS_MIN, 1 / p));
                legs.push({
                  ...base,
                  market: "Premier but",
                  pick,
                  prob: p,
                  odds: Math.round(odds * 100) / 100,
                  probMarket: null, // cote équitable : pas de marché de référence
                });
              };
              fgLeg(`1er but avant la ${b + 1}e minute`, cumBefore);
              fgLeg(`1er but après la ${b}e minute`, after);
            }
          }

          /* --- v2.5 : BTTS « les deux équipes marquent » Oui/Non —
           *     OPT-IN (même raison que le premier but : ESPN ne publie
           *     pas ce marché, la cote est équitable 1/p − marge). C'est
           *     LE marché parieur le plus demandé après 1X2/DC/O/U —
           *     il entre dans le pool uniquement en profil Agressif. */
          const bt = pred.btts;
          if (bt && (validProb(bt.yes) || validProb(bt.no))) {
            const bttsLeg = (pick: string, p: number) => {
              if (!validProb(p)) return;
              const odds = Math.min(legOddsMax, Math.max(ODDS_MIN, 1 / p));
              legs.push({
                ...base,
                market: "Deux équipes marquent",
                pick,
                prob: p,
                odds: Math.round(odds * 100) / 100,
                probMarket: null, // cote équitable : pas de marché de référence
              });
            };
            bttsLeg("Deux équipes marquent — Oui", bt.yes);
            bttsLeg("Deux équipes marquent — Non", bt.no);
          }
        }
      }
    }
  }

  return { legs, matches };
}

/* ---------- Recherche du meilleur combiné ---------- */

interface Candidate {
  legs: ComboLeg[];
  odds: number;
  prob: number;
  /** v3.2 : produit des probas marché dé-margées (null si une jambe
   *  au moins est à cote équitable — comparaison impossible). */
  probMarket: number | null;
}

/* ---------- v3.2 (boost parlay) : métriques du combiné ---------- */

/** Edge du combiné = P×C − 1 : gain espéré par unité misée
 *  (parlay-optimizer calculate_parlay_ev : EV = P·C − 1). */
function edgeOf(prob: number, odds: number): number {
  return prob * odds - 1;
}

/** Indice de confiance = edge × prob (parlay-optimizer
 *  « confidence_score ») : une EV théorique de +40 % sur un combiné
 *  à 3 % de réussite vaut moins qu'une EV de +5 % à 60 %. */
function confidenceOf(prob: number, odds: number): number {
  return edgeOf(prob, odds) * prob;
}

/** Pénalité de concentration : les jambes d'une même ligue ou d'un
 *  même créneau horaire (même jour ± 2 h) partagent des facteurs
 *  latents (météo, arbitrage, état du terrain, sur-réaction du
 *  marché sur la même soirée) que le produit des probas suppose
 *  indépendants. > 2 jambes concentrées → pénalité croissante
 *  (le score est comparé à des probas de l'ordre de 0,2-0,6 :
 *  0,01 par jambe concentrée au-delà de la 2e). */
function leaguePenaltyOf(legs: ComboLeg[]): number {
  const byLeague = new Map<string, number>();
  const bySlot = new Map<string, number>();
  const slotOf = (k: string) => {
    const t = new Date(k).getTime();
    return `${Math.floor(t / (2 * 3600_000))}`;
  };
  for (const l of legs) {
    byLeague.set(l.leagueCode, (byLeague.get(l.leagueCode) ?? 0) + 1);
    bySlot.set(slotOf(l.kickoff), (bySlot.get(slotOf(l.kickoff)) ?? 0) + 1);
  }
  let pen = 0;
  for (const n of byLeague.values()) if (n > 2) pen += 0.01 * (n - 2);
  for (const n of bySlot.values()) if (n > 2) pen += 0.005 * (n - 2);
  return Math.round(pen * 10000) / 10000;
}

function scoreOf(c: Candidate, target: number): number {
  /* v3.2 : on maximise l'INDICE DE CONFIANCE (edge × proba), pas la
   * proba seule — un combiné très probable mais à cote sous-évaluée
   * (prob×cote < 1) n'a aucune valeur pour le parieur. Léger malus
   * pour les combinés qui dépassent beaucoup la cible demandée. */
  return confidenceOf(c.prob, c.odds) - 0.015 * (c.odds - target) - leaguePenaltyOf(c.legs);
}

function matchDiff(a: Candidate, b: Candidate): number {
  const sa = new Set(a.legs.map((l) => l.matchId));
  const sb = new Set(b.legs.map((l) => l.matchId));
  let diff = 0;
  for (const id of sa) if (!sb.has(id)) diff++;
  for (const id of sb) if (!sa.has(id)) diff++;
  return diff;
}

/**
 * Cherche les meilleurs combinés : côte totale ≥ target (tolérance
 * incluse), probabilité ≥ minProb, une jambe par match, 2 à maxLegs
 * jambes. Renvoie jusqu'à 3 combinés (variantes distinctes d'au
 * moins 2 matchs).
 *
 * Robustesse : le DFS explore par cotes croissantes, donc sans garde
 * il passe la quasi-totalité de son budget dans les combinés de
 * petites cotes qui n'atteignent jamais la cible (comportement vu
 * sur le périmètre semaine : 537 jambes éligibles, budget épuisé,
 * « aucun combiné » alors que des solutions existaient). Deux
 * mécanismes corrigent cela :
 *   1. élagage d'atteignabilité — depuis la position courante, si
 *      multiplier par les k meilleures cotes restantes ne peut pas
 *      atteindre la cible, la branche est coupée (les cotes étant
 *      ≥ 1, le produit des k plus grandes du suffixe majore tout
 *      ce qui est constructible) ;
 *   2. graines gloutonnes — deux combinés constructibles rapidement
 *      (probabilité d'abord, cote d'abord) garantissent qu'au moins
 *      une réponse existe même si le budget DFS rend l'âme.
 */
export function findBestCombos(
  pool: ComboLeg[],
  matches: number,
  params: ComboSearchParams,
): ComboSearchOutcome {
  const target = Math.max(1.2, params.target);
  const minProb = params.minProb;
  const maxLegs = Math.min(6, Math.max(2, params.maxLegs ?? 6));
  const maxOdds = Math.min(target * (1 + (params.tolerance ?? 0.25)), 60);
  const poolCap = params.poolCap ?? 170;
  const nodeBudget = params.nodeBudget ?? 400_000;
  /* v3.0 : la cote max par jambe s'applique aussi au pré-filtrage du
   * pool de recherche (la borne buildLegPool filtre la CONSTRUCTION,
   * celle-ci filtre le pool fourni — défense en profondeur). */
  const legOddsMax = Math.min(ODDS_MAX, Math.max(1.5, params.maxLegOdds ?? LEG_ODDS_MAX_DEFAULT));

  /* Pré-filtrage :
   *  - une jambe dont la probabilité est déjà sous le seuil ne peut
   *    jamais figurer dans un combiné ≥ seuil (produit décroissant) ;
   *  - une jambe sans valeur minimale (prob × cote) traîne tous les
   *    combinés vers le bas. */
  const eligible = pool.filter(
    (l) => l.odds <= Math.min(maxOdds, legOddsMax) && l.prob >= minProb && l.prob * l.odds >= 0.8,
  );

  /* Au plus 6 jambes par match, dont au plus 3 par marché : un
   * match n'occupe qu'un slot de combiné et la diversité des
   * marchés (1X2, double chance, total buts, premier but) doit
   * survivre au plafonnement. */
  const byMatch = new Map<string, ComboLeg[]>();
  for (const l of eligible) {
    const arr = byMatch.get(l.matchId);
    if (arr) arr.push(l);
    else byMatch.set(l.matchId, [l]);
  }
  const perMatchCapped: ComboLeg[] = [];
  for (const arr of byMatch.values()) {
    arr.sort((a, b) => b.prob - a.prob);
    const perMarket = new Map<string, number>();
    const kept: ComboLeg[] = [];
    for (const l of arr) {
      if (kept.length >= 6) break;
      const c = perMarket.get(l.market) ?? 0;
      if (c >= 3) continue;
      perMarket.set(l.market, c + 1);
      kept.push(l);
    }
    perMatchCapped.push(...kept);
  }

  /**
   * Produit des k plus grandes cotes d'un suffixe de jambes triées
   * par cote croissante : sufTop[i][k] majore le facteur multiplicatif
   * constructible avec au plus k jambes prises après l'index i.
   */
  function suffixTopOdds(legs: ComboLeg[]): number[][] {
    const n = legs.length;
    const suf: number[][] = new Array(n + 1);
    suf[n] = [1];
    let top: number[] = []; // k plus grandes cotes du suffixe, triées desc
    for (let i = n - 1; i >= 0; i--) {
      const o = legs[i].odds;
      let j = 0;
      while (j < top.length && top[j] > o) j++;
      top.splice(j, 0, o);
      if (top.length > maxLegs) top.length = maxLegs;
      const prods = [1];
      let p = 1;
      for (let k = 0; k < top.length; k++) {
        p *= top[k];
        prods.push(p);
      }
      suf[i] = prods;
    }
    return suf;
  }

  const run = (legArr: ComboLeg[], probPrune: boolean, budget: number) => {
    const legs = legArr;
    const cands: Candidate[] = [];
    let nodes = 0;
    let aborted = false;
    const used = new Set<string>();
    const cur: ComboLeg[] = [];
    legs.sort((a, b) => a.odds - b.odds);
    const sufTop = suffixTopOdds(legs);

    /* v3.2 : proba marché en miroir du DFS — produit des dé-margées,
     * null dès qu'une jambe sans référence entre dans le combiné. */
    const dfs = (startIdx: number, odds: number, prob: number, probMkt: number | null) => {
      if (aborted) return;
      if (++nodes > budget) {
        aborted = true;
        return;
      }
      for (let i = startIdx; i < legs.length; i++) {
        const l = legs[i];
        const o = odds * l.odds;
        if (o > maxOdds) break; // jambes triées par cote croissante
        if (used.has(l.matchId)) continue;
        const p = prob * l.prob;
        if (probPrune && p < minProb) continue;
        /* atteignabilité : même en prenant les meilleures cotes
         * restantes, la cible est hors de portée → coupe. */
        const slotsLeft = maxLegs - cur.length - 1;
        const reach = sufTop[i + 1];
        if (o < target && o * reach[Math.min(slotsLeft, reach.length - 1)] < target) continue;
        used.add(l.matchId);
        cur.push(l);
        const pMkt = probMkt == null || l.probMarket == null ? null : probMkt * l.probMarket;
        if (cur.length >= 2 && o >= target) {
          cands.push({ legs: [...cur], odds: o, prob: p, probMarket: pMkt });
          if (cands.length >= 4000) {
            cands.sort((a, b) => scoreOf(b, target) - scoreOf(a, target));
            cands.length = 40;
          }
        }
        if (cur.length < maxLegs) dfs(i + 1, o, p, pMkt);
        cur.pop();
        used.delete(l.matchId);
      }
    };

    dfs(0, 1, 1, 1);
    return { cands, aborted };
  };

  /** Graine gloutonne : ajoute des jambes distinctes selon un ordre
   *  donné en coupant celles qui rendent la cible inatteignable.
   *  v3.2 : l'ordre « prob » devient l'ordre du score de Kelly-
   *  numérateur (p·cote − 1)/p (betting-recommender BetPicker) —
   *  positif ssi value, monotone dans l'edge : la value passe devant
   *  la proba brute, les cotes équitables (prob×cote ≡ 1) coulent. */
  const greedySeed = (order: "value" | "odds"): Candidate | null => {
    const kellyScore = (l: ComboLeg) => (l.prob * l.odds - 1) / l.prob;
    const sorted = [...perMatchCapped].sort((a, b) =>
      order === "value" ? kellyScore(b) - kellyScore(a) : b.odds - a.odds,
    );
    const allOdds = sorted.map((l) => l.odds).sort((a, b) => b - a);
    const topProd = (k: number) => {
      let p = 1;
      for (let i = 0; i < Math.min(k, allOdds.length); i++) p *= allOdds[i];
      return p;
    };
    const chosen: ComboLeg[] = [];
    const used = new Set<string>();
    let o = 1;
    let p = 1;
    let pMkt: number | null = 1;
    for (const l of sorted) {
      if (chosen.length >= maxLegs) break;
      if (used.has(l.matchId)) continue;
      const o2 = o * l.odds;
      if (o2 > maxOdds) continue;
      const slotsLeft = maxLegs - chosen.length - 1;
      if (o2 < target && o2 * topProd(slotsLeft) < target) continue;
      used.add(l.matchId);
      chosen.push(l);
      o = o2;
      p *= l.prob;
      pMkt = pMkt == null || l.probMarket == null ? null : pMkt * l.probMarket;
      if (o >= target && chosen.length >= 2) break;
    }
    if (o >= target && chosen.length >= 2) return { legs: chosen, odds: o, prob: p, probMarket: pMkt };
    return null;
  };

  /* Phase 1 : stricte — seules les branches ≥ seuil sont explorées.
   * Pool trié par v3.2 : score de Kelly-numérateur (value d'abord,
   * cf. greedySeed), proba en départage — les 170 meilleures jambes
   * de tout le périmètre (semaine comprise), pas seulement celles
   * des premiers jours. */
  const kellyScore = (l: ComboLeg) => (l.prob * l.odds - 1) / l.prob;
  const pool1 = [...perMatchCapped]
    .sort((a, b) => kellyScore(b) - kellyScore(a) || b.prob - a.prob)
    .slice(0, poolCap);
  const strict = run(pool1, true, nodeBudget);

  let cands = strict.cands;
  let aborted = strict.aborted;

  /* Phase 2 : graines gloutonnes + seuil relâché. Le pool de repli
   * mêle les meilleures probabilités et les plus grosses cotes —
   * un pool « probabilité seule » ne peut pas toujours atteindre
   * la cible. */
  if (cands.length === 0) {
    for (const order of ["value", "odds"] as const) {
      const seed = greedySeed(order);
      if (seed) cands.push(seed);
    }
    const byProb = [...perMatchCapped].sort((a, b) => b.prob - a.prob);
    const byOdds = [...perMatchCapped].sort((a, b) => b.odds - a.odds);
    const byValue = [...perMatchCapped].sort((a, b) => kellyScore(b) - kellyScore(a));
    const seen = new Set<string>();
    const pool2: ComboLeg[] = [];
    for (const l of [...byValue.slice(0, 40), ...byProb.slice(0, 25), ...byOdds.slice(0, 20)]) {
      const key = `${l.matchId}|${l.market}|${l.pick}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pool2.push(l);
    }
    const loose = run(pool2, false, 200_000);
    cands.push(...loose.cands);
    aborted = aborted || loose.aborted;
  }

  /* Sélection : meilleure candidate d'abord, puis variantes
   * différant d'au moins 2 matchs des déjà choisies. */
  cands.sort((a, b) => scoreOf(b, target) - scoreOf(a, target));
  const picked: Candidate[] = [];
  for (const c of cands) {
    if (picked.length >= 3) break;
    if (picked.every((p) => matchDiff(p, c) >= 2)) picked.push(c);
  }
  for (const c of cands) {
    if (picked.length >= 3) break;
    if (!picked.includes(c)) picked.push(c);
  }

  const results: ComboResult[] = picked.map((c) => ({
    legs: [...c.legs].sort((a, b) => (a.kickoff < b.kickoff ? -1 : 1)),
    odds: Math.round(c.odds * 100) / 100,
    prob: c.prob,
    meetsThreshold: c.prob >= minProb,
    edge: Math.round(edgeOf(c.prob, c.odds) * 10000) / 10000,
    confidence: Math.round(confidenceOf(c.prob, c.odds) * 10000) / 10000,
    probMarket: c.probMarket != null ? Math.round(c.probMarket * 10000) / 10000 : null,
    breakEven: Math.round((1 / c.odds) * 10000) / 10000,
    leaguePenalty: leaguePenaltyOf(c.legs),
  }));

  return {
    results,
    poolSize: perMatchCapped.length,
    matches,
    relaxed: results.length > 0 && results.every((r) => r.prob < minProb),
    aborted,
  };
}
