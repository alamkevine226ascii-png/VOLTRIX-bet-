// ============================================================
// VOLTRIX bet — Probabilités « live » pour le conseil de vente
// ============================================================
// Le conseiller de vente (cash-out) doit savoir ce que vaut un
// coupon À L'INSTANT T. Chaque jambe du combiné porte la proba
// modèle calculée AVANT le match (leg.prob) : ce module la met à
// jour selon l'état réel du match récupéré sur ESPN :
//   - match à venir            → proba initiale (inchangée)
//   - match en cours           → proba recalculée (score courant
//     + temps restant, Poisson sur la portion restante)
//   - match terminé            → 1 si la jambe est gagnée, 0 sinon
//     (le verdict WIN/LOSE est calculé par lib/grade.ts)
//
// Méthode (2 étapes, 100 % déterministe, testable) :
//   1. INVERSION : retrouver les buts attendus (λ) cohérents avec
//      la proba initiale de la jambe — le marché de la jambe
//      contraint λ (O/U → λ total ; 1X2/DC/BTTS → répartition
//      home/away autour d'un total moyen).
//   2. MISE À JOUR : score courant + λ restants (λ × fraction de
//      temps restante) → proba finale de la jambe via Poisson.
//
// Hypothèses assumées (documentées pour l'honnêteté du modèle) :
//   - buts restants indépendants entre équipes (Poisson classique) ;
//   - hors O/U, λ total inconnu → moyenne football 2.6 buts ;
//   - horloge ESPN prioritaire, sinon temps mural (105 min pleines).
// ============================================================

// ---------- Poisson ----------

const POISSON_MAX_GOALS = 15; // λ realistic ≤ 5 : la queue au-delà est négligeable

function poissonPmf(lambda: number, k: number): number {
  if (lambda < 0 || k < 0) return 0;
  let logP = -lambda + k * Math.log(lambda);
  for (let i = 2; i <= k; i++) logP -= Math.log(i);
  return Math.exp(logP);
}

/** P(équipe marque exactement k buts) pour chaque k ∈ [0, max] */
function poissonVector(lambda: number): number[] {
  const v: number[] = new Array(POISSON_MAX_GOALS + 1);
  for (let k = 0; k <= POISSON_MAX_GOALS; k++) v[k] = poissonPmf(lambda, k);
  return v;
}

/** P(h > a) pour deux Poisson indépendants */
function homeWinProb(le: number[], ra: number[]): number {
  let acc = 0;
  for (let h = 1; h <= POISSON_MAX_GOALS; h++) {
    if (le[h] === 0) continue;
    for (let a = 0; a < h; a++) acc += le[h] * ra[a];
  }
  return acc;
}

/** P(h = a) pour deux Poisson indépendants */
function drawProb(le: number[], ra: number[]): number {
  let acc = 0;
  for (let k = 0; k <= POISSON_MAX_GOALS; k++) acc += le[k] * ra[k];
  return acc;
}

// ---------- Solveurs (bisection, bornés, déterministes) ----------

function bisect(f: (x: number) => number, lo: number, hi: number, target: number, iterations = 60): number {
  let a = lo;
  let b = hi;
  // Détection de direction : P(under) est DÉCROISSANTE en λ, P(1X) est
  // croissante en s… le solveur gère les deux sens de manière transparente.
  const increasing = f(lo) <= f(hi);
  for (let i = 0; i < iterations; i++) {
    const mid = (a + b) / 2;
    const v = f(mid);
    if (Math.abs(v - target) < 1e-7) return mid;
    const below = v < target;
    if (increasing ? below : !below) a = mid;
    else b = mid;
  }
  return (a + b) / 2;
}

/** CDF Poisson simple : P(X ≤ n), X ~ Poisson(λ) (total des 2 équipes) */
function underCdf(lambda: number, line: number): number {
  const v: number[] = new Array(POISSON_MAX_GOALS + 1);
  let acc = 0;
  const limit = Math.ceil(line - 1e-9) - 1; // ligne 2.5 → P(total ≤ 2)
  for (let k = 0; k <= POISSON_MAX_GOALS; k++) {
    acc += poissonPmf(lambda, k);
    v[k] = acc;
  }
  return v[Math.max(0, Math.min(POISSON_MAX_GOALS, limit))];
}

/** Moyenne football (buts attendus totaux) utilisée quand le marché ne contraint pas λ. */
export const DEFAULT_TOTAL_LAMBDA = 2.6;
/** Part de buts à domicile par défaut (avantage du terrain). */
export const DEFAULT_HOME_SHARE = 0.55;

function splitLambda(total: number, homeShare: number): { home: number; away: number } {
  const s = clamp(homeShare, 0.12, 0.88);
  return { home: Math.max(0.05, total * s), away: Math.max(0.05, total * (1 - s)) };
}

// ---------- Proba d'une jambe à l'instant T ----------

export interface LiveLegInput {
  market: string; // '1X2' | 'Double Chance' | 'O/U 2.5' | 'BTTS'
  pick: string; // libellé complet (« Victoire PSG », « Moins de 2.5 buts », …)
  prob: number; // proba modèle initiale (pré-match)
}

export interface LiveLegState {
  /** 'pre' : pas commencé · 'in' : en cours · 'post' : terminé · 'unknown' : données absentes */
  phase: 'pre' | 'in' | 'post' | 'unknown';
  homeScore: number | null;
  awayScore: number | null;
  clock: string | null; // horloge ESPN brute (« 63' », « HT », « 45'+2' »)
  kickoffIso?: string | null; // repli si l'horloge est absente (temps mural)
}

/**
 * Proba actuelle que la jambe soit gagnée.
 * - terminé + score → binaire (le verdict WIN/LOSE est déjà calculé par l'appelant)
 * - en cours + score → Poisson sur le temps restant
 * - sinon → proba initiale inchangée.
 * `sideFor1x2` : côté du pick 1X2 ('home' | 'away' | 'draw') — utilisé quand le
 * marché est 1X2 (l'inversion par bisection porte sur la part home).
 */
export function legLiveProb(
  leg: LiveLegInput,
  state: LiveLegState,
  sideFor1x2?: 'home' | 'away' | 'draw'
): number {
  if (state.phase === 'post') {
    // Le verdict est connu : l'appelant ne devrait même pas appeler ici.
    return leg.prob;
  }
  if (state.phase !== 'in' || state.homeScore == null || state.awayScore == null) {
    return clamp01(leg.prob);
  }

  const fraction = remainingFraction(state.clock, state.phase, state.kickoffIso);
  const hNow = state.homeScore;
  const aNow = state.awayScore;

  // ---- λ depuis la proba initiale ----
  let lambdas: { home: number; away: number } | null = null;

  if (leg.market.startsWith('O/U')) {
    const line = parseFloat(leg.market.slice(3));
    const isOver = leg.pick.startsWith('Plus de');
    const isUnder = leg.pick.startsWith('Moins de');
    if (Number.isFinite(line) && (isOver || isUnder)) {
      const underProb = isUnder ? leg.prob : 1 - leg.prob;
      const lambda = bisect((l) => underCdf(l, line), 0.05, 14, clamp(underProb, 0.002, 0.998));
      lambdas = splitLambda(lambda, DEFAULT_HOME_SHARE);
    }
  } else if (leg.market === 'BTTS') {
    const yes = leg.pick.endsWith(': Oui') ? leg.prob : 1 - leg.prob;
    const y = clamp(yes, 0.002, 0.998);
    const lambda = Math.max(0.2, -2 * Math.log(1 - Math.sqrt(y)));
    lambdas = splitLambda(lambda, DEFAULT_HOME_SHARE);
  } else {
    // 1X2 / Double Chance : bisection sur la part home s
    const target = clamp01(leg.prob);
    const evalAt = (s: number): number => {
      const le = poissonVector(DEFAULT_TOTAL_LAMBDA * s);
      const ra = poissonVector(DEFAULT_TOTAL_LAMBDA * (1 - s));
      const pWinH = homeWinProb(le, ra);
      const pDraw = drawProb(le, ra);
      if (leg.market === '1X2') {
        if (sideFor1x2 === 'home') return pWinH;
        if (sideFor1x2 === 'draw') return pDraw;
        return Math.max(0.001, 1 - pWinH - pDraw);
      }
      // Double Chance
      if (leg.pick.includes('(1X)')) return pWinH + pDraw;
      if (leg.pick.includes('(X2)')) return 1 - pWinH;
      if (leg.pick.includes('(12)')) return 1 - pDraw;
      return NaN;
    };
    const increasing = leg.market === '1X2' ? sideFor1x2 !== 'away' : leg.pick.includes('(1X)');
    // pour les cas décroissants on bisectionne sur 1 - f (f décroît quand s croît)
    const s = bisect(
      (x) => (increasing ? evalAt(x) : 1 - evalAt(x)),
      0.12,
      0.88,
      increasing ? clamp(target, 0.01, 0.99) : clamp(1 - target, 0.01, 0.99)
    );
    // Pour les décroissants la bisection a résolu 1-f = target → s est correct.
    lambdas = splitLambda(DEFAULT_TOTAL_LAMBDA, s);
  }

  if (!lambdas) return clamp01(leg.prob);

  // ---- Poisson restant ----
  const leRem = poissonVector(lambdas.home * fraction);
  const raRem = poissonVector(lambdas.away * fraction);

  // P(h_final = hNow + H, a_final = aNow + A)
  return computeLegProbGivenRemaining(leg, sideFor1x2 ?? null, hNow, aNow, leRem, raRem);
}

/** P(jambe gagnée) sachant le score courant et les buts restants (vecteurs Poisson). */
function computeLegProbGivenRemaining(
  leg: LiveLegInput,
  sideFor1x2: 'home' | 'away' | 'draw' | null,
  hNow: number,
  aNow: number,
  le: number[],
  ra: number[]
): number {
  // ----- Résultat -----
  if (leg.market === '1X2') {
    if (sideFor1x2 === 'home') return probHomeWinFrom(hNow, aNow, le, ra);
    if (sideFor1x2 === 'draw') return probDrawFrom(hNow, aNow, le, ra);
    if (sideFor1x2 === 'away') return probAwayWinFrom(hNow, aNow, le, ra);
    return clamp01(leg.prob);
  }

  // ----- Double Chance -----
  if (leg.market === 'Double Chance') {
    if (leg.pick.includes('(1X)')) return probHomeWinFrom(hNow, aNow, le, ra) + probDrawFrom(hNow, aNow, le, ra);
    if (leg.pick.includes('(X2)')) return probAwayWinFrom(hNow, aNow, le, ra) + probDrawFrom(hNow, aNow, le, ra);
    if (leg.pick.includes('(12)')) return probHomeWinFrom(hNow, aNow, le, ra) + probAwayWinFrom(hNow, aNow, le, ra);
    return clamp01(leg.prob);
  }

  // ----- Over / Under -----
  if (leg.market.startsWith('O/U')) {
    const line = parseFloat(leg.market.slice(3));
    if (!Number.isFinite(line)) return clamp01(leg.prob);
    const isOver = leg.pick.startsWith('Plus de');
    const isUnder = leg.pick.startsWith('Moins de');
    if (!isOver && !isUnder) return clamp01(leg.prob);
    // P(total_final > line) = 1 - P(total_final ≤ floor(line))
    const capped = Math.ceil(line - 1e-9) - 1; // ligne 2.5 → ≤ 2
    const diff = capped - (hNow + aNow); // buts encore « autorisés » pour l'under
    // P(buts restants ≤ diff) — borne stricte : h ≤ diff, sinon le terme est nul
    // (PAS de clamp à 0 : h > diff ne doit RIEN ajouter, même pas ra[0]).
    const pRemainingUnder = (d: number): number => {
      if (d < 0) return 0;
      let acc = 0;
      const hMax = Math.min(POISSON_MAX_GOALS, d);
      for (let h = 0; h <= hMax; h++) {
        const maxA = d - h; // 0 ≤ a ≤ diff - h
        for (let a = 0; a <= maxA; a++) acc += le[h] * ra[a];
      }
      return Math.min(1, acc);
    };
    if (isUnder) return pRemainingUnder(diff);
    // Over : 1 - P(total final ≤ capped)
    return Math.max(0, 1 - pRemainingUnder(diff));
  }

  // ----- BTTS -----
  if (leg.market === 'BTTS') {
    const yes = leg.pick.endsWith(': Oui');
    const homeScored = hNow > 0;
    const awayScored = aNow > 0;
    if (yes) {
      if (homeScored && awayScored) return 1;
      if (!homeScored && !awayScored) {
        let acc = 0;
        for (let h = 1; h <= POISSON_MAX_GOALS; h++)
          for (let a = 1; a <= POISSON_MAX_GOALS; a++) acc += le[h] * ra[a];
        return acc;
      }
      // une seule a marqué : l'autre doit marquer au moins 1
      const need = homeScored ? ra : le;
      let acc = 0;
      for (let k = 1; k <= POISSON_MAX_GOALS; k++) acc += need[k];
      return acc;
    }
    // BTTS Non : au moins une des deux reste muette
    // P(home finit à 0) = le[0] (si home a déjà marqué → 0), idem away
    const pHome0 = homeScored ? 0 : le[0];
    const pAway0 = awayScored ? 0 : ra[0];
    return clamp01(pHome0 + pAway0 - pHome0 * pAway0);
  }

  return clamp01(leg.prob);
}

function probHomeWinFrom(hNow: number, aNow: number, le: number[], ra: number[]): number {
  let acc = 0;
  for (let h = 0; h <= POISSON_MAX_GOALS; h++) {
    if (le[h] === 0) continue;
    // home final = hNow + h doit battre aNow + a → a < hNow + h - aNow + 1
    const maxA = hNow + h - aNow - 1; // a ≤ maxA
    if (maxA < 0) continue;
    const bound = Math.min(POISSON_MAX_GOALS, maxA);
    for (let a = 0; a <= bound; a++) acc += le[h] * ra[a];
  }
  return acc;
}

function probDrawFrom(hNow: number, aNow: number, le: number[], ra: number[]): number {
  // P(h_final = a_final) = Σ_t P(h_final = t) × P(a_final = t)
  // avec P(h_final = t) = le[t - hNow] (buts restants indépendants).
  let acc = 0;
  for (let t = 0; t <= 2 * POISSON_MAX_GOALS; t++) {
    const hi = t - hNow;
    const ai = t - aNow;
    if (hi >= 0 && hi <= POISSON_MAX_GOALS && ai >= 0 && ai <= POISSON_MAX_GOALS) {
      acc += le[hi] * ra[ai];
    }
  }
  return acc;
}

function probAwayWinFrom(hNow: number, aNow: number, le: number[], ra: number[]): number {
  let acc = 0;
  for (let h = 0; h <= POISSON_MAX_GOALS; h++) {
    if (le[h] === 0) continue;
    // away final = aNow + a doit battre hNow + h → a ≥ hNow + h - aNow + 1
    const minA = hNow + h - aNow + 1;
    if (minA > POISSON_MAX_GOALS) continue;
    for (let a = Math.max(0, minA); a <= POISSON_MAX_GOALS; a++) acc += le[h] * ra[a];
  }
  return acc;
}

// ---------- Horloge / temps restant ----------

/** Durée de référence d'un match (90 min + mi-temps + arrêts de jeu). */
const FULL_MATCH_MIN = 105;

/**
 * Fraction du temps RESTANT (0 = match fini, 1 = coup d'envoi).
 * Priorité à l'horloge ESPN (« 63' », « 45'+2' », « HT ») — sinon
 * temps mural depuis le coup d'envoi (kickoffIso) plafonné à 97 %.
 */
export function remainingFraction(clock: string | null | undefined, phase: 'pre' | 'in' | 'post' | 'unknown', kickoffIso?: string | null): number {
  if (phase === 'post') return 0;
  if (phase === 'pre') return 1;

  const minutes = parseClockMinutes(clock);
  if (minutes != null) {
    return clamp(1 - minutes / FULL_MATCH_MIN, 0.03, 0.95);
  }
  if (kickoffIso) {
    const elapsed = (Date.now() - Date.parse(kickoffIso)) / 60000;
    if (Number.isFinite(elapsed) && elapsed > 0) {
      return clamp(1 - elapsed / FULL_MATCH_MIN, 0.03, 0.95);
    }
  }
  return 0.5; // sans information : milieu de match (hypothèse neutre assumée)
}

/** Extrait les minutes jouées d'une horloge ESPN. « HT » → 45. */
export function parseClockMinutes(detail: string | null | undefined): number | null {
  if (!detail) return null;
  const d = detail.trim();
  if (/^(HT|Mi-temps|Half Time)$/i.test(d)) return 45;
  // « 63' », « 45'+2' », « 90'+3' », « 76 minutes »…
  const m = d.match(/(\d{1,3})\s*(?:'\+?\d*'?|min)/);
  if (m) {
    const n = parseInt(m[1], 10);
    if (Number.isFinite(n) && n >= 0 && n <= 130) return n;
  }
  return null;
}

// ---------- Utilitaires ----------

export function clamp01(x: number): number {
  return Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0;
}

function clamp(x: number, lo: number, hi: number): number {
  return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : lo;
}
