// ============================================================
// VOLTRIX bet — Générateur de pari combiné (v2, anti-risque)
// Philosophie : atteindre la cote cible en MAXIMISANT la
// probabilité de gain du ticket, pas la rentabilité espérée.
//   - Plancher de probabilité par jambe (profil de risque)
//   - Cote max par jambe (pas de perle à 4.0 pour 30 %)
//   - Tri par « efficacité » : gains de cote par unité de risque
//   - Empilement sûr : préférer plusieurs jambes à cotes basses
//   - 1 jambe max par match, diversité de marchés imposée
//   - Simplification : moins de jambes = meilleure proba
// ============================================================

// ---------- Types ----------

export type RiskProfile = 'prudent' | 'equilibre' | 'agressif';

export interface ProfileConfig {
  label: string;
  emoji: string;
  minProb: number; // plancher de probabilité par jambe
  maxLegOdds: number; // cote max par jambe
  description: string;
}

export const PROFILES: Record<RiskProfile, ProfileConfig> = {
  prudent: {
    label: 'Prudent',
    emoji: '🛡️',
    minProb: 0.58,
    maxLegOdds: 2.0,
    description: 'Jambes à 58 % mini · cotes jusqu\u2019à 2.00',
  },
  equilibre: {
    label: 'Équilibré',
    emoji: '⚖️',
    minProb: 0.5,
    maxLegOdds: 2.4,
    description: 'Jambes à 50 % mini · cotes jusqu\u2019à 2.40',
  },
  agressif: {
    label: 'Agressif',
    emoji: '🔥',
    minProb: 0.4,
    maxLegOdds: 3.2,
    description: 'Jambes à 40 % mini · cotes jusqu\u2019à 3.20',
  },
};

export type OddsSource = 'real' | 'market' | 'estimate';

export interface ComboLeg {
  matchId: string;
  leagueCode?: string; // code ESPN (ex: eng.1) — requis pour résoudre le pari dans le Portefeuille
  leagueShort: string;
  leagueName: string;
  matchDate: string;
  homeName: string;
  awayName: string;
  homeLogo?: string | null; // écusson (affichage plein écran du ticket)
  awayLogo?: string | null;
  market: string; // '1X2' | 'Double Chance' | 'O/U 2.5' | 'BTTS' ...
  pick: string; // libellé lisible
  prob: number; // 0..1 (modèle / marché calibré)
  odds: number; // cote utilisée (réelle, dérivée marché, ou estimée)
  oddsSource: OddsSource;
  confidence: number; // 1..5
}

export interface ComboResult {
  legs: ComboLeg[];
  comboOdds: number;
  comboProb: number;
  comboEV: number; // prob × odds − 1
  kelly: number; // fraction de bankroll conseillée (plafonnée 10 %)
  confidenceAvg: number;
  targetOdds: number;
  legsLimit: number;
  profile: RiskProfile;
}

export type RiskTone = 'good' | 'mid' | 'risky';

/** Badge de risque d'une jambe, selon sa probabilité modèle */
export function riskBadge(prob: number): { label: string; tone: RiskTone } {
  if (prob >= 0.66) return { label: 'Sûr', tone: 'good' };
  if (prob >= 0.55) return { label: 'Moyen', tone: 'mid' };
  return { label: 'Risqué', tone: 'risky' };
}

// ---------- Familles de marchés (diversité) ----------

/** Résultat = 1X2/DC · Buts = O/U · BTTS */
export function legFamily(market: string): 'resultat' | 'buts' | 'btts' {
  if (market.startsWith('O/U')) return 'buts';
  if (market.startsWith('BTTS')) return 'btts';
  return 'resultat';
}

function maxPerFamily(legsLimit: number): number {
  return Math.max(2, Math.ceil(legsLimit / 2));
}

// ---------- RNG déterministe (pour "Autre combinaison") ----------

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- Helpers ----------

const MIN_ODDS = 1.04;

function comboOddsOf(legs: ComboLeg[]): number {
  return legs.reduce((acc, l) => acc * l.odds, 1);
}

function comboProbOf(legs: ComboLeg[]): number {
  return legs.reduce((acc, l) => acc * l.prob, 1);
}

function legValid(l: ComboLeg, profile: ProfileConfig): boolean {
  return (
    Number.isFinite(l.prob) &&
    Number.isFinite(l.odds) &&
    l.prob >= profile.minProb &&
    l.prob < 0.97 &&
    l.odds >= MIN_ODDS &&
    l.odds <= profile.maxLegOdds
  );
}

/** Efficacité = gains de cote (ln) par unité de risque (−ln proba).
 *  Une jambe sûre à 1.45 (70 %) ~1.04 ; un 2.4 à 50 % ~1.0 : le tri
 *  favorise naturellement les jambes solides. */
function efficiency(l: ComboLeg): number {
  const risk = -Math.log(Math.max(1e-6, l.prob));
  const gain = Math.log(Math.max(1.0001, l.odds));
  const confBonus = 1 + (l.confidence - 3) * 0.015; // confiance 1..5 : ±3 %
  return (gain / risk) * confBonus;
}

// ---------- Sélection gloutonne (respecte 1 match + caps famille) ----------

function greedyPick(
  sorted: ComboLeg[],
  count: number,
  familyCap: number
): ComboLeg[] | null {
  const usedMatches = new Set<string>();
  const familyCount: Record<string, number> = {};
  const picked: ComboLeg[] = [];
  for (const c of sorted) {
    if (picked.length >= count) break;
    if (usedMatches.has(c.matchId)) continue;
    const fam = legFamily(c.market);
    if ((familyCount[fam] ?? 0) >= familyCap) continue;
    picked.push(c);
    usedMatches.add(c.matchId);
    familyCount[fam] = (familyCount[fam] ?? 0) + 1;
  }
  return picked.length === count ? picked : null;
}

// ---------- Escalade locale : maximiser la proba (cote ≥ cible) ----------

function escalate(legs: ComboLeg[], pool: ComboLeg[], targetOdds: number, familyCap: number): void {
  for (let pass = 0; pass < 2; pass++) {
    let improved = false;
    const order = legs.map((_, i) => i).sort((x, y) => legs[x].prob - legs[y].prob);
    for (const i of order) {
      const rest = legs.filter((_, j) => j !== i);
      const oddsWithout = comboOddsOf(rest);
      const probWithout = comboProbOf(rest);
      const minOddsNeeded = targetOdds / oddsWithout;
      const famWithout = legFamily(legs[i].market);
      let bestSwap: { cand: ComboLeg; prob: number } | null = null;
      const famCount: Record<string, number> = {};
      const restIds = new Set(rest.map((r) => r.matchId)); // évite un .some O(jambes) par candidat du vivier
      for (const r of rest) famCount[legFamily(r.market)] = (famCount[legFamily(r.market)] ?? 0) + 1;
      for (const cand of pool) {
        if (restIds.has(cand.matchId)) continue;
        if (cand.odds < minOddsNeeded) continue;
        const fam = legFamily(cand.market);
        const famTotal = (famCount[fam] ?? 0) + (fam === famWithout ? 0 : 1);
        if (famTotal > familyCap) continue;
        const newProb = probWithout * cand.prob;
        if (bestSwap && newProb <= bestSwap.prob) continue;
        bestSwap = { cand, prob: newProb };
      }
      const currentProb = probWithout * legs[i].prob;
      if (bestSwap && bestSwap.prob > currentProb * 1.0001) {
        legs[i] = bestSwap.cand;
        improved = true;
      }
    }
    if (!improved) break;
  }
}

// ---------- Simplification : moins de jambes = plus de proba ----------

function shrink(legs: ComboLeg[], targetOdds: number): void {
  let changed = true;
  while (changed && legs.length > 2) {
    changed = false;
    // retirer d'abord la plus petite cote (impact minimal sur le produit)
    const byOdds = [...legs].sort((a, b) => a.odds - b.odds);
    for (const leg of byOdds) {
      if (legs.length <= 2) break;
      const rest = legs.filter((l) => l !== leg);
      if (comboOddsOf(rest) >= targetOdds) {
        legs.splice(legs.indexOf(leg), 1); // mutation en place
        changed = true;
        break;
      }
    }
  }
}

// ---------- Rattrapage : forcer l'atteinte de la cible par échanges ----------

/**
 * Quand la sélection gloutonne est en-dessous de la cible (souvent à
 * cause des caps de famille), remplace des jambes par des jambes à
 * plus forte cote jusqu'à atteindre la cible. Retourne true si succès.
 * Mutation en place de `legs`.
 */
function topUp(legs: ComboLeg[], pool: ComboLeg[], targetOdds: number, familyCap: number): boolean {
  let guard = 0;
  while (comboOddsOf(legs) < targetOdds && guard++ < 24) {
    // 1) échange direct qui atteint la cible, avec la meilleure probabilité
    let bestSwap: { i: number; cand: ComboLeg; prob: number } | null = null;
    for (let i = 0; i < legs.length; i++) {
      const rest = legs.filter((_, j) => j !== i);
      const oddsWithout = comboOddsOf(rest);
      const probWithout = comboProbOf(rest);
      const minOdds = targetOdds / oddsWithout;
      const famCount: Record<string, number> = {};
      const restIds = new Set(rest.map((r) => r.matchId)); // évite un .some O(jambes) par candidat du vivier
      for (const r of rest) {
        const f = legFamily(r.market);
        famCount[f] = (famCount[f] ?? 0) + 1;
      }
      const famI = legFamily(legs[i].market);
      for (const cand of pool) {
        if (restIds.has(cand.matchId)) continue;
        if (cand.odds < minOdds) continue;
        const f = legFamily(cand.market);
        if ((famCount[f] ?? 0) + (f === famI ? 0 : 1) > familyCap) continue;
        const prob = probWithout * cand.prob;
        if (!bestSwap || prob > bestSwap.prob) bestSwap = { i, cand, prob };
      }
    }
    if (bestSwap) {
      legs[bestSwap.i] = bestSwap.cand;
      continue;
    }
    // 2) sinon : remplacer la plus petite cote par la plus grande disponible
    let small = 0;
    for (let i = 1; i < legs.length; i++) if (legs[i].odds < legs[small].odds) small = i;
    const famCount: Record<string, number> = {};
    for (let j = 0; j < legs.length; j++) {
      if (j === small) continue;
      const f = legFamily(legs[j].market);
      famCount[f] = (famCount[f] ?? 0) + 1;
    }
    const famS = legFamily(legs[small].market);
    // matchIds déjà utilisés hors jambe `small` (évite un .some O(jambes) par candidat)
    const otherIds = new Set(legs.filter((_, j) => j !== small).map((l) => l.matchId));
    let bigCand: ComboLeg | null = null;
    for (const cand of pool) {
      if (otherIds.has(cand.matchId)) continue;
      if (cand.odds <= legs[small].odds) continue;
      const f = legFamily(cand.market);
      if ((famCount[f] ?? 0) + (f === famS ? 0 : 1) > familyCap) continue;
      if (!bigCand || cand.odds > bigCand.odds) bigCand = cand;
    }
    if (!bigCand) return false;
    legs[small] = bigCand;
  }
  return comboOddsOf(legs) >= targetOdds;
}

// ---------- Génération ----------

/**
 * Construit un combiné atteignant `targetOdds` avec la probabilité
 * de gain maximale, sous les contraintes du profil de risque :
 *   - chaque jambe : prob ≥ minProb et cote ≤ maxLegOdds
 *   - une seule jambe par match
 *   - max ⌈limit/2⌉ jambes par famille (Résultat / Buts / BTTS)
 * Stratégie : pour chaque taille de ticket 2..limit, sélection
 * gloutonne par efficacité, escalade locale puis simplification.
 * Le meilleur ticket (proba max) gagne.
 */
export function buildCombo(
  candidates: ComboLeg[],
  targetOdds: number,
  legsLimit = 5,
  profile: RiskProfile = 'equilibre',
  seed = 1
): ComboResult | null {
  if (!Number.isFinite(targetOdds) || targetOdds < 1.2) return null;
  const conf = PROFILES[profile] ?? PROFILES.equilibre;
  const limit = Math.max(2, Math.min(8, Math.round(legsLimit)));
  const familyCap = maxPerFamily(limit);

  const pool = candidates.filter((c) => legValid(c, conf));
  if (pool.length < 2) return null;

  const rng = mulberry32(seed);
  // Trois ordres de remplissage : l'efficacité (le plus sûr) est tenté
  // en premier, mais les ordres par cote/proba peuvent débloquer des
  // cibles que les caps de famille rendent inatteignables en efficacité.
  const sortedEff = [...pool].sort((a, b) => {
    const ea = efficiency(a) * (1 + (rng() - 0.5) * 0.2); // bruit ±10 % ("Autre option")
    const eb = efficiency(b) * (1 + (rng() - 0.5) * 0.2);
    return eb - ea;
  });
  const sortedOdds = [...pool].sort((a, b) => b.odds - a.odds);
  const sortedProb = [...pool].sort((a, b) => b.prob - a.prob);

  const attempt = (sorted: ComboLeg[], n: number): ComboLeg[] | null => {
    const legs = greedyPick(sorted, n, familyCap);
    if (!legs) return null;
    if (comboOddsOf(legs) < targetOdds && !topUp(legs, pool, targetOdds, familyCap)) return null;
    escalate(legs, pool, targetOdds, familyCap);
    shrink(legs, targetOdds);
    return legs;
  };

  let best: ComboLeg[] | null = null;
  let bestProb = 0; // produit des probas du meilleur ticket (évite de le recomputer à chaque comparaison)
  const consider = (legs: ComboLeg[] | null) => {
    if (!legs) return;
    const p = comboProbOf(legs);
    if (!best || p > bestProb * 1.000001 || (Math.abs(p - bestProb) < 1e-9 && legs.length < best.length)) {
      best = legs;
      bestProb = p;
    }
  };
  for (const sorted of [sortedEff, sortedOdds, sortedProb]) {
    for (let n = 2; n <= limit; n++) consider(attempt(sorted, n));
  }
  if (!best) return null;

  // Annotation explicite : TS ne suit pas l'affectation de `best`
  // faite dans la closure `consider` et la réduit à `never`.
  const chosen: ComboLeg[] = best;

  const comboOdds = comboOddsOf(chosen);
  const comboProb = comboProbOf(chosen);
  const ev = comboProb * comboOdds - 1;
  const kelly = Math.max(0, Math.min(0.1, ev / (comboOdds - 1)));

  return {
    legs: chosen,
    comboOdds: Math.round(comboOdds * 100) / 100,
    comboProb,
    comboEV: ev,
    kelly,
    confidenceAvg: chosen.reduce((a, l) => a + l.confidence, 0) / chosen.length,
    targetOdds,
    legsLimit: limit,
    profile,
  };
}

/**
 * Cote max atteignable sous les contraintes du profil
 * (pour le message « cote hors de portée »).
 */
export function maxAchievableOdds(
  candidates: ComboLeg[],
  legsLimit = 5,
  profile: RiskProfile = 'equilibre'
): number {
  const conf = PROFILES[profile] ?? PROFILES.equilibre;
  const limit = Math.max(2, Math.min(8, Math.round(legsLimit)));
  const familyCap = maxPerFamily(limit);
  const pool = candidates.filter((c) => legValid(c, conf));
  const sorted = [...pool].sort((a, b) => b.odds - a.odds);
  const usedMatches = new Set<string>();
  const familyCount: Record<string, number> = {};
  let odds = 1;
  let n = 0;
  for (const c of sorted) {
    if (n >= limit) break;
    if (usedMatches.has(c.matchId)) continue;
    const fam = legFamily(c.market);
    if ((familyCount[fam] ?? 0) >= familyCap) continue;
    odds *= c.odds;
    usedMatches.add(c.matchId);
    familyCount[fam] = (familyCount[fam] ?? 0) + 1;
    n++;
  }
  return Math.round(odds * 100) / 100;
}

/** Cote estimée à partir d'une proba modèle (marge bookmaker ~7 % appliquée) */
export function fairOdds(prob: number): number {
  if (!Number.isFinite(prob) || prob <= 0.02) return MIN_ODDS;
  return Math.max(MIN_ODDS, Math.round((1 / prob) * 0.93 * 100) / 100);
}

// ---------- Édition manuelle : échange d'une jambe ----------

/** Clé unique d'une jambe (keys React, Sets d'exclusion, undo) */
export function legKey(l: ComboLeg): string {
  return `${l.matchId}|${l.market}|${l.pick}`;
}

/**
 * Recalcule les métriques d'un ticket après édition manuelle
 * (même convention que buildCombo : EV/Kelly sur cotes non arrondies,
 * cote totale arrondie à l'affichage).
 */
export function recomputeCombo(
  legs: ComboLeg[],
  profile: RiskProfile,
  targetOdds: number,
  legsLimit: number
): ComboResult | null {
  if (legs.length < 2) return null;
  const comboOdds = comboOddsOf(legs);
  const comboProb = comboProbOf(legs);
  const ev = comboProb * comboOdds - 1;
  const kelly = Math.max(0, Math.min(0.1, ev / (comboOdds - 1)));
  return {
    legs,
    comboOdds: Math.round(comboOdds * 100) / 100,
    comboProb,
    comboEV: ev,
    kelly,
    confidenceAvg: legs.reduce((a, l) => a + l.confidence, 0) / legs.length,
    targetOdds,
    legsLimit: Math.max(2, Math.min(8, Math.round(legsLimit))),
    profile,
  };
}

/**
 * Rétablit la cote cible d'un ticket modifié manuellement (échange) :
 * remplace une à une les jambes par les meilleures alternatives valides
 * du vivier (mêmes règles que le moteur : prob ≥ plancher, cote ≤ plafond,
 * 1 jambe par match, caps de famille) jusqu'à retrouver `targetOdds`.
 * Retourne les jambes réparées, ou null si la cible est hors de portée
 * avec ce vivier — l'appelant garde alors le ticket de l'utilisateur
 * (avec le badge « sous l'objectif »).
 */
export function repairToTarget(
  legs: ComboLeg[],
  pool: ComboLeg[],
  targetOdds: number,
  profile: RiskProfile
): ComboLeg[] | null {
  if (!Number.isFinite(targetOdds) || targetOdds < 1.2) return null;
  const conf = PROFILES[profile] ?? PROFILES.equilibre;
  const familyCap = maxPerFamily(Math.max(2, Math.min(8, legs.length)));
  const work = [...legs];
  let guard = 0;
  while (comboOddsOf(work) < targetOdds && guard++ < 24) {
    // Meilleur échange 1-pour-1 : parmi ceux qui atteignent la cible,
    // celui avec la probabilité de gain la plus élevée.
    let bestSwap: { i: number; cand: ComboLeg; prob: number } | null = null;
    for (let i = 0; i < work.length; i++) {
      const rest = work.filter((_, j) => j !== i);
      const oddsWithout = comboOddsOf(rest);
      const probWithout = comboProbOf(rest);
      const minOdds = targetOdds / oddsWithout;
      const famCount: Record<string, number> = {};
      for (const r of rest) {
        const f = legFamily(r.market);
        famCount[f] = (famCount[f] ?? 0) + 1;
      }
      const restIds = new Set(rest.map((r) => r.matchId));
      const famI = legFamily(work[i].market);
      for (const cand of pool) {
        if (restIds.has(cand.matchId)) continue;
        if (cand.odds < minOdds) continue;
        if (!legValid(cand, conf)) continue;
        const f = legFamily(cand.market);
        if ((famCount[f] ?? 0) + (f === famI ? 0 : 1) > familyCap) continue;
        const prob = probWithout * cand.prob;
        if (!bestSwap || prob > bestSwap.prob) bestSwap = { i, cand, prob };
      }
    }
    if (!bestSwap) return null;
    work[bestSwap.i] = bestSwap.cand;
  }
  return comboOddsOf(work) >= targetOdds ? work : null;
}

/**
 * Alternatives de remplacement pour la jambe d'indice `replaceIndex` :
 * mêmes règles anti-risque que le moteur (prob ≥ plancher du profil,
 * cote ≤ plafond), hors tous les matchs déjà présents dans le ticket —
 * y compris celui qu'on remplace : si l'utilisateur n'a pas confiance
 * en un match, on ne lui repropose pas ce match. Tri par efficacité
 * décroissante (les sélections les plus solides d'abord).
 * (Task 19-c : pour GARDER le match avec un autre pari, voir
 * listSameMatchAlternatives — les deux sections de la feuille d'échange
 * sont complémentaires, jamais cumulables.)
 */
export function listAlternatives(
  pool: ComboLeg[],
  currentLegs: ComboLeg[],
  replaceIndex: number,
  profile: RiskProfile
): ComboLeg[] {
  const conf = PROFILES[profile] ?? PROFILES.equilibre;
  // Tous les matchs du ticket sont bloqués, y compris celui qu'on
  // remplace : l'utilisateur n'a pas confiance en lui.
  const blocked = new Set(currentLegs.map((l) => l.matchId));
  return pool
    .filter((c) => !blocked.has(c.matchId) && legValid(c, conf))
    .sort((a, b) => efficiency(b) - efficiency(a));
}

// ---------- Édition manuelle : autres paris du même match (Task 19-c) ----------

/** Groupes de marché pour la section « Autres paris du même match ».
 *  1X2 et Double Chance sont regroupés à part (deux façons de parier
 *  sur le résultat), les lignes O/U ensemble, BTTS à part. */
export type MarketGroupId = 'resultat1x2' | 'resultatdc' | 'buts' | 'btts' | 'autre';

export const MARKET_GROUP_LABELS: Record<MarketGroupId, string> = {
  resultat1x2: 'Résultat (1X2)',
  resultatdc: 'Double chance',
  buts: 'Buts (Over/Under)',
  btts: 'Les 2 équipes marquent',
  autre: 'Autres marchés',
};

const MARKET_GROUP_ORDER: MarketGroupId[] = ['resultat1x2', 'resultatdc', 'buts', 'btts', 'autre'];

export function marketGroupId(market: string): MarketGroupId {
  if (market === '1X2') return 'resultat1x2';
  if (market === 'Double Chance') return 'resultatdc';
  if (market.startsWith('O/U')) return 'buts';
  if (market === 'BTTS') return 'btts';
  return 'autre';
}

/**
 * Regroupe des candidats par marché dans l'ordre d'affichage canonique
 * (Résultat 1X2 → Double chance → Buts → BTTS → autres). L'ordre à
 * l'intérieur de chaque groupe est celui du vivier (1 · N · 2, 1X · 12 ·
 * X2, lignes croissantes avec Over avant Under, BTTS Oui · Non).
 */
export function groupByMarket<T extends ComboLeg>(cands: T[]): Array<{ id: MarketGroupId; label: string; legs: T[] }> {
  const buckets = new Map<MarketGroupId, T[]>();
  for (const c of cands) {
    const id = marketGroupId(c.market);
    const arr = buckets.get(id);
    if (arr) arr.push(c);
    else buckets.set(id, [c]);
  }
  return MARKET_GROUP_ORDER.filter((id) => buckets.has(id)).map((id) => ({
    id,
    label: MARKET_GROUP_LABELS[id],
    legs: buckets.get(id)!,
  }));
}

/**
 * Task 19-c — « Autres paris du même match » : tous les candidats du
 * vivier partageant le matchId de la jambe à remplacer, SAUF la
 * sélection actuellement jouée (même market+pick = sans effet).
 * Le remplacement est strictement 1-pour-1 (on substitue la jambe en
 * place) : le match reste présent exactement une fois dans le ticket,
 * l'invariant « 1 jambe par match » du moteur est préservé par
 * construction. Aucun filtre de profil ici : l'utilisateur voit TOUT
 * le vivier du match (les critères de triage ont déjà filtré le pool
 * en amont, comme pour les échanges ⟳) ; l'UI marque les candidats
 * hors des limites du profil via isLegInProfile.
 */
export function listSameMatchAlternatives(
  pool: ComboLeg[],
  currentLegs: ComboLeg[],
  replaceIndex: number
): ComboLeg[] {
  const leg = currentLegs[replaceIndex];
  if (!leg) return [];
  const seen = new Set<string>([legKey(leg)]);
  const out: ComboLeg[] = [];
  for (const c of pool) {
    if (c.matchId !== leg.matchId) continue;
    const k = legKey(c);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out;
}

/**
 * La jambe respecte-t-elle les planchers/plafonds du profil de risque
 * (prob ≥ minProb, cote ≤ maxLegOdds) ? Utilisé pour marquer « hors
 * profil » les candidats du même match qui sortent des limites —
 * l'utilisateur garde le choix, mais il est informé.
 */
export function isLegInProfile(l: ComboLeg, profile: RiskProfile): boolean {
  return legValid(l, PROFILES[profile] ?? PROFILES.equilibre);
}
