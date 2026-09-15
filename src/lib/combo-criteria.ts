// ============================================================
// VOLTRIX bet — Critères de sélection du Combinator (triage)
// L'utilisateur choisit LES SPÉCIFICITÉS que le moteur doit
// respecter pour construire un coupon :
//   - marchés autorisés (1X2, Double Chance, O/U, BTTS)
//   - confiance minimale (étoiles du modèle)
//   - cotes réelles uniquement (PAS les cotes estimées) — défaut ON
//   - ligues à exclure (par code ESPN)
// Ces critères filtrent le vivier de jambes AVANT le moteur
// (et donc aussi les échanges manuels, qui piochent dans le
// même vivier filtré). Persistés en localStorage.
// ------------------------------------------------------------
// Task 17 — v2 : « cotes réelles uniquement » passe à TRUE par défaut.
// POURQUOI : les jambes à cote « estimée » (fairOdds = 0.93/proba du
// modèle, utilisées pour BTTS, O/U sans ligne réelle et matchs sans
// cotes 1X2) ne correspondent à AUCUNE cote obtenable chez le
// bookmaker. Un combiné « ×10 » construit en partie sur ces estimées
// ne vaut en réalité que ×5-7 au guichet — c'est le bug signalé par
// l'utilisateur. En n'autorisant que les cotes réelles (1X2, ligne
// O/U ESPN) ou dérivées du marché (DC, O/U calibrées), la cote totale
// affichée est réellement obtenable. L'utilisateur averti peut
// ré-inclure les estimées via le panneau de triage (badge explicite).
// Migration : les critères stockés en v1 (realOddsOnly false = ancien
// défaut) sont forcés à true UNE fois ; en v2 le choix de
// l'utilisateur est respecté.
// ============================================================

import type { ComboLeg } from './combo';

export interface ComboCriteria {
  version: 2;
  /** Familles de marchés autorisées. Tout coché par défaut. */
  markets: {
    result: boolean; // 1X2
    doubleChance: boolean; // Double Chance
    totals: boolean; // O/U 1.5 / 2.5 / 3.5
    btts: boolean; // Les 2 équipes marquent
  };
  /** Confiance minimale du modèle pour une jambe (1..5, 1 = aucune contrainte). */
  minConfidence: number;
  /** N'accepter que les cotes réelles ou dérivées du marché (pas les
   *  estimations) — DÉFAUT : true (cote totale réellement obtenable). */
  realOddsOnly: boolean;
  /** Codes ESPN des ligues exclues par l'utilisateur. */
  excludedLeagues: string[];
}

export const DEFAULT_CRITERIA: ComboCriteria = {
  version: 2,
  markets: { result: true, doubleChance: true, totals: true, btts: true },
  minConfidence: 1,
  realOddsOnly: true,
  excludedLeagues: [],
};

const KEY = 'voltrix_combo_criteria_v1';

/** Relit les critères, fusionnés avec les défauts (migration v1 → v2). */
export function loadCriteria(): ComboCriteria {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_CRITERIA, markets: { ...DEFAULT_CRITERIA.markets }, excludedLeagues: [] };
    const p = JSON.parse(raw) as Partial<ComboCriteria>;
    // Migration v1 → v2 : en v1, realOddsOnly false était le DÉFAUT (pas un
    // choix) — on force true une fois pour que l'appareil bénéficie du
    // correctif « cote totale obtenable ». En v2, le choix est respecté.
    const isV2 = (p as { version?: number }).version === 2;
    return {
      version: 2,
      markets: {
        result: p.markets?.result ?? true,
        doubleChance: p.markets?.doubleChance ?? true,
        totals: p.markets?.totals ?? true,
        btts: p.markets?.btts ?? true,
      },
      minConfidence: Math.min(5, Math.max(1, Math.round(p.minConfidence ?? 1))),
      realOddsOnly: isV2 ? (p.realOddsOnly ?? true) : true,
      excludedLeagues: Array.isArray(p.excludedLeagues) ? p.excludedLeagues.filter((x) => typeof x === 'string') : [],
    };
  } catch {
    return { ...DEFAULT_CRITERIA, markets: { ...DEFAULT_CRITERIA.markets }, excludedLeagues: [] };
  }
}

export function saveCriteria(c: ComboCriteria): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(c));
  } catch {
    // mode privé : critères de session uniquement
  }
}

/** Au moins une famille autorisée (sinon aucun vivier possible). */
export function hasAnyMarket(c: ComboCriteria): boolean {
  return c.markets.result || c.markets.doubleChance || c.markets.totals || c.markets.btts;
}

/**
 * Filtre le vivier de jambes selon les critères.
 * Le DÉFAUT (realOddsOnly true) exclut les cotes estimées : la cote
 * totale du combiné est réellement obtenable chez le bookmaker.
 */
export function filterCandidates(candidates: ComboLeg[], criteria: ComboCriteria): ComboLeg[] {
  return filterCandidatesImpl(candidates, criteria);
}

function filterCandidatesImpl(candidates: ComboLeg[], criteria: ComboCriteria): ComboLeg[] {
  const excluded = new Set(criteria.excludedLeagues);
  return candidates.filter((l) => {
    // Ligue exclue ?
    if (l.leagueCode && excluded.has(l.leagueCode)) return false;
    // Confiance minimale ?
    if (l.confidence < criteria.minConfidence) return false;
    // Cotes réelles uniquement ?
    if (criteria.realOddsOnly && l.oddsSource === 'estimate') return false;
    // Famille de marché autorisée ?
    if (l.market === '1X2') return criteria.markets.result;
    if (l.market === 'Double Chance') return criteria.markets.doubleChance;
    if (l.market.startsWith('O/U')) return criteria.markets.totals;
    if (l.market === 'BTTS') return criteria.markets.btts;
    // Marché inconnu : laissé au moteur (comportement historique)
    return true;
  });
}

/** Nombre de critères ACTIFS (badge du panneau de triage).
 *  Les critères à leur DÉFAUT sûr ne comptent pas : seul un écart
 *  par rapport au défaut est signalé (ex. estimées ré-incluses). */
export function activeCriteriaCount(c: ComboCriteria): number {
  let n = 0;
  if (!c.markets.result || !c.markets.doubleChance || !c.markets.totals || !c.markets.btts) n++;
  if (c.minConfidence > 1) n++;
  if (!c.realOddsOnly) n++; // écart au défaut : cotes estimées ré-incluses
  if (c.excludedLeagues.length > 0) n++;
  return n;
}

/** Résumé lisible des critères actifs (affiché sous le bouton Générer). */
export function criteriaSummary(c: ComboCriteria): string[] {
  const out: string[] = [];
  const markets: string[] = [];
  if (c.markets.result) markets.push('1X2');
  if (c.markets.doubleChance) markets.push('Double Chance');
  if (c.markets.totals) markets.push('O/U');
  if (c.markets.btts) markets.push('BTTS');
  if (markets.length > 0 && markets.length < 4) out.push(`Marchés : ${markets.join(' · ')}`);
  if (c.minConfidence > 1) out.push(`Confiance ${c.minConfidence}★ min`);
  if (!c.realOddsOnly) out.push('Cotes estimées incluses (cote totale non garantie chez le bookmaker)');
  if (c.excludedLeagues.length > 0) out.push(`${c.excludedLeagues.length} ligue${c.excludedLeagues.length > 1 ? 's' : ''} exclue${c.excludedLeagues.length > 1 ? 's' : ''}`);
  return out;
}
