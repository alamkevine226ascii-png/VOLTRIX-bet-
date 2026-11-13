/**
 * VOLTRIX — Combinateur : construit un combiné à côte cible.
 *
 * Principe (fonctionnalité v1, restaurée et étendue à la semaine) :
 * l'utilisateur choisit une côte cible et un seuil de réussite
 * (40 / 50 / 60 %). Le moteur collecte toutes les sélections
 * « jouables » des matchs à venir (résultat 1X2, double chance,
 * total buts — uniquement celles qui ont une COTE RÉELLE capturée
 * par ESPN), puis cherche le meilleur combiné dont :
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

  /* Au plus 5 jambes par match (les mieux placées) : un match
   * n'occupe qu'un slot de combiné, garder plus n'apporte rien. */
  const byMatch = new Map<string, ComboLeg[]>();
  for (const l of eligible) {
    const arr = byMatch.get(l.matchId);
    if (arr) arr.push(l);
    else byMatch.set(l.matchId, [l]);
  }
  const perMatchCapped: ComboLeg[] = [];
  for (const arr of byMatch.values()) {
    arr.sort((a, b) => b.prob - a.prob);
    perMatchCapped.push(...arr.slice(0, 5));
  }

  const run = (legArr: ComboLeg[], probPrune: boolean, budget: number) => {
    const legs = legArr;
    const cands: Candidate[] = [];
    let nodes = 0;
    let aborted = false;
    const used = new Set<string>();
    const cur: ComboLeg[] = [];

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
        if (probPrune && prob * l.prob < minProb) continue;
        if (used.has(l.matchId)) continue;
        const p = prob * l.prob;
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

    legs.sort((a, b) => a.odds - b.odds);
    dfs(0, 1, 1);
    return { cands, aborted };
  };

  /* Phase 1 : stricte — seules les branches ≥ seuil sont explorées. */
  const pool1 = perMatchCapped.slice(0, poolCap);
  const strict = run(pool1, true, nodeBudget);

  let cands = strict.cands;
  let relaxed = false;
  let aborted = strict.aborted;

  /* Phase 2 : seuil non atteignable — meilleur combiné ≥ cible sans
   * prune de probabilité, sur un pool réduit et un budget plus bas. */
  if (cands.length === 0) {
    const pool2 = [...perMatchCapped]
      .sort((a, b) => b.prob - a.prob)
      .slice(0, 60)
      .sort((a, b) => a.odds - b.odds);
    const loose = run(pool2, false, 200_000);
    cands = loose.cands;
    relaxed = cands.length > 0;
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
    relaxed,
    aborted,
  };
}
