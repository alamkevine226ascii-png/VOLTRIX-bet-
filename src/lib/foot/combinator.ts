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

import { dcFromMarket } from "./market-odds";
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
}

/** Un combiné trouvé par le moteur. */
export interface ComboResult {
  legs: ComboLeg[]; // triées par coup d'envoi
  odds: number; // côte totale (produit)
  prob: number; // probabilité de réussite (produit)
  /** false : seuil demandé non atteint (meilleur possible). */
  meetsThreshold: boolean;
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
 */
export function buildLegPool(days: ComboDayInput[]): { legs: ComboLeg[]; matches: number } {
  const legs: ComboLeg[] = [];
  const seenMatches = new Set<string>();
  const now = Date.now();
  let matches = 0;

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

        /* --- Résultat 1X2 (cotes réelles du bookmaker) --- */
        if (validOdds(m.mlHome) && validProb(pred.probs.home)) {
          legs.push({
            ...base,
            market: "Résultat",
            pick: `Victoire ${base.home}`,
            prob: pred.probs.home,
            odds: m.mlHome,
          });
        }
        if (validOdds(m.mlDraw) && validProb(pred.probs.draw)) {
          legs.push({
            ...base,
            market: "Résultat",
            pick: "Match nul",
            prob: pred.probs.draw,
            odds: m.mlDraw,
          });
        }
        if (validOdds(m.mlAway) && validProb(pred.probs.away)) {
          legs.push({
            ...base,
            market: "Résultat",
            pick: `Victoire ${base.away}`,
            prob: pred.probs.away,
            odds: m.mlAway,
          });
        }

        /* --- Double chance (dérivée du 1X2 réel, marge bornée) --- */
        const dc =
          validOdds(m.mlHome) && validOdds(m.mlDraw) && validOdds(m.mlAway)
            ? dcFromMarket(m.mlHome, m.mlDraw, m.mlAway)
            : null;
        if (dc) {
          if (validProb(dc.prob1X)) {
            legs.push({
              ...base,
              market: "Double chance",
              pick: `1X — ${base.homeShort} ou nul`,
              prob: dc.prob1X,
              odds: dc.odds1X,
            });
          }
          if (validProb(dc.prob12)) {
            legs.push({
              ...base,
              market: "Double chance",
              pick: "12 — pas de match nul",
              prob: dc.prob12,
              odds: dc.odds12,
            });
          }
          if (validProb(dc.probX2)) {
            legs.push({
              ...base,
              market: "Double chance",
              pick: `X2 — ${base.awayShort} ou nul`,
              prob: dc.probX2,
              odds: dc.oddsX2,
            });
          }
        }

        /* --- Total buts (ligne et cotes du bookmaker) --- */
        const ou = pred.ouOdds;
        if (ou && validOdds(ou.over) && validOdds(ou.under) && ou.line != null) {
          const entry = pred.overUnder?.find((e) => Math.abs(e.line - ou.line!) < 0.01);
          if (entry) {
            if (validProb(entry.over)) {
              legs.push({
                ...base,
                market: `Total buts ${entry.line}`,
                pick: `Plus de ${entry.line} buts`,
                prob: entry.over,
                odds: ou.over,
              });
            }
            if (validProb(entry.under)) {
              legs.push({
                ...base,
                market: `Total buts ${entry.line}`,
                pick: `Moins de ${entry.line} buts`,
                prob: entry.under,
                odds: ou.under,
              });
            }
          }
        }

        /* --- Premier but (probabilités moteur, cote dérivée = cote
         *     équitable 1/p — ESPN ne publie pas ce marché). Les
         *     fenêtres 15 min donnent « avant la Xe » / « après la
         *     Xe » aux bornes clés 15/30/45/60/75. --- */
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
              const odds = Math.min(ODDS_MAX, Math.max(ODDS_MIN, 1 / p));
              legs.push({
                ...base,
                market: "Premier but",
                pick,
                prob: p,
                odds: Math.round(odds * 100) / 100,
              });
            };
            fgLeg(`1er but avant la ${b + 1}e minute`, cumBefore);
            fgLeg(`1er but après la ${b}e minute`, after);
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
}

function scoreOf(c: Candidate, target: number): number {
  /* On maximise la probabilité ; léger malus pour les combinés qui
     dépassent beaucoup la cible demandée (à proba égale, le combiné
     le plus proche de la cible est le plus utile). */
  return c.prob - 0.015 * (c.odds - target);
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
  const maxOdds = target * (1 + (params.tolerance ?? 0.25));
  const poolCap = params.poolCap ?? 170;
  const nodeBudget = params.nodeBudget ?? 400_000;

  /* Pré-filtrage :
   *  - une jambe dont la probabilité est déjà sous le seuil ne peut
   *    jamais figurer dans un combiné ≥ seuil (produit décroissant) ;
   *  - une jambe sans valeur minimale (prob × cote) traîne tous les
   *    combinés vers le bas. */
  const eligible = pool.filter(
    (l) => l.odds <= maxOdds && l.prob >= minProb && l.prob * l.odds >= 0.8,
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

    const dfs = (startIdx: number, odds: number, prob: number) => {
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
        if (cur.length >= 2 && o >= target) {
          cands.push({ legs: [...cur], odds: o, prob: p });
          if (cands.length >= 4000) {
            cands.sort((a, b) => scoreOf(b, target) - scoreOf(a, target));
            cands.length = 40;
          }
        }
        if (cur.length < maxLegs) dfs(i + 1, o, p);
        cur.pop();
        used.delete(l.matchId);
      }
    };

    dfs(0, 1, 1);
    return { cands, aborted };
  };

  /** Graine gloutonne : ajoute des jambes distinctes selon un ordre
   *  donné en coupant celles qui rendent la cible inatteignable. */
  const greedySeed = (order: "prob" | "odds"): Candidate | null => {
    const sorted = [...perMatchCapped].sort((a, b) =>
      order === "prob" ? b.prob - a.prob : b.odds - a.odds,
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
      if (o >= target && chosen.length >= 2) break;
    }
    if (o >= target && chosen.length >= 2) return { legs: chosen, odds: o, prob: p };
    return null;
  };

  /* Phase 1 : stricte — seules les branches ≥ seuil sont explorées.
   * Pool trié par probabilité décroissante : les 170 meilleures
   * jambes de tout le périmètre (semaine comprise), pas seulement
   * celles des premiers jours. */
  const pool1 = [...perMatchCapped].sort((a, b) => b.prob - a.prob).slice(0, poolCap);
  const strict = run(pool1, true, nodeBudget);

  let cands = strict.cands;
  let aborted = strict.aborted;

  /* Phase 2 : graines gloutonnes + seuil relâché. Le pool de repli
   * mêle les meilleures probabilités et les plus grosses cotes —
   * un pool « probabilité seule » ne peut pas toujours atteindre
   * la cible. */
  if (cands.length === 0) {
    for (const order of ["prob", "odds"] as const) {
      const seed = greedySeed(order);
      if (seed) cands.push(seed);
    }
    const byProb = [...perMatchCapped].sort((a, b) => b.prob - a.prob);
    const byOdds = [...perMatchCapped].sort((a, b) => b.odds - a.odds);
    const seen = new Set<string>();
    const pool2: ComboLeg[] = [];
    for (const l of [...byProb.slice(0, 40), ...byOdds.slice(0, 20)]) {
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
  }));

  return {
    results,
    poolSize: perMatchCapped.length,
    matches,
    relaxed: results.length > 0 && results.every((r) => r.prob < minProb),
    aborted,
  };
}
