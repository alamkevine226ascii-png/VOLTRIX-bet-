// ============================================================
// VOLTRIX bet — Poisson bivarié + Monte Carlo (nov. 2026)
// Implémentation n°1 du plan d'amélioration, d'après les idées
// du moteur World Cup 2026 d'AmirMotefaker (MIT) : construction
// mathématique réécrite de zéro, AUCUNE ligne de code copiée.
//
// 1. POISSON BIVARIÉ (Karlis & Ntzoufras, 2003)
//    Buts domicile X = X1 + X3, extérieur Y = X2 + X3 avec
//    X1~Pois(λ1), X2~Pois(λ2), X3~Pois(λ3) indépendants.
//    λ3 = composante PARTAGÉE : le « tempo » du match (rencontre
//    ouverte → les deux attaques s'expriment ; fermée → les deux
//    bridées). Cov(X,Y) = λ3 ≥ 0.
//    L'ancien moteur supposait λ3 = 0 (buts indépendants) : il
//    sous-estimait P(0-0), P(nul) et BTTS.
//    Décomposition depuis les λ du moteur :
//      λ3 = ρ·√(λH·λA), borné à 0,9·min(λH,λA) ; λ1 = λH−λ3, λ2 = λA−λ3.
//    ρ par défaut 0,10 (corrélation faible, ordre de grandeur des
//    études empiriques) — à calibrer au backtest n°2.
//
// 2. GRILLE CONJOINTE EXACTE 0..12
//    P(x,y) = Σ_k pmf1[x−k]·pmf2[y−k]·pmf3[k], renormalisée à 1.
//    Tous les marchés (1X2, O/U, BTTS, scores exacts, double
//    chance, victoire sans encaisser, histogramme du total) s'en
//    déduisent SANS bruit d'échantillonnage.
//
// 3. MONTE CARLO — 10 000 simulations
//    Échantillonnage direct (X1,X2,X3), RNG déterministe mulberry32
//    seedé sur (λH, λA, ρ, itérations) : deux rendus du même match
//    produisent les MÊMES nombres (éthique d'auditabilité VOLTRIX).
//    Sert de (a) vérification croisée empirique de la grille exacte
//    — l'écart max est publié, (b) statistiques d'ordre (médiane).
// ============================================================

/** Corrélation buts domicile/extérieur visée par la composante partagée. */
export const BIVARIATE_RHO = 0.1;

/** Nombre de simulations Monte Carlo par match. */
export const MC_ITERATIONS = 10_000;

/** Taille de la grille conjointe (0..MAX buts par équipe). */
const MAX = 12;

// ---------------------------------------------------------------------------
// Outils
// ---------------------------------------------------------------------------

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

function round(x: number, digits = 4): number {
  const f = Math.pow(10, digits);
  return Math.round(x * f) / f;
}

/** RNG déterministe (mulberry32) — 32 bits, rapide, reproductible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Seed déterministe fonction des paramètres du match (FNV-1a-like). */
function seedOf(lambdaHome: number, lambdaAway: number, rho: number, iterations: number): number {
  let h = 2166136261 >>> 0;
  const mix = (n: number) => {
    h = Math.imul(h ^ n, 16777619) >>> 0;
  };
  mix(Math.round(lambdaHome * 100) | 0);
  mix(Math.round(lambdaAway * 100) | 0);
  mix(Math.round(rho * 1000) | 0);
  mix(iterations | 0);
  return h >>> 0;
}

/** PMF de Poisson 0..max, calcul incrémental p[k] = p[k−1]·λ/k (stable). */
function poissonRow(lambda: number, max: number): number[] {
  const row: number[] = new Array(max + 1);
  row[0] = Math.exp(-lambda);
  for (let k = 1; k <= max; k++) row[k] = row[k - 1] * (lambda / k);
  return row;
}

/** Échantillonnage de Poisson (Knuth) — λ modérés du moteur (< 10). */
function samplePoisson(lambda: number, rand: () => number): number {
  if (lambda <= 0) return 0;
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rand();
  } while (p > L);
  return k - 1;
}

// ---------------------------------------------------------------------------
// Décomposition bivariée
// ---------------------------------------------------------------------------

export interface BivariateLambdas {
  /** Intensité propre domicile. */
  l1: number;
  /** Intensité propre extérieur. */
  l2: number;
  /** Composante partagée (tempo du match) — Cov(X,Y) = λ3. */
  l3: number;
}

/**
 * Décompose (λH, λA) en (λ1, λ2, λ3) tel que λ1+λ3 = λH, λ2+λ3 = λA et
 * Corr(X,Y) = λ3/√(λH·λA) ≈ ρ. Le bornage λ3 ≤ 0,9·min(λH,λA) garantit
 * λ1, λ2 ≥ 0,1·min(λH,λA) > 0 (aucune intensité négative).
 */
export function bivariateLambdas(lambdaHome: number, lambdaAway: number, rho: number): BivariateLambdas {
  const lh = clamp(Number.isFinite(lambdaHome) ? lambdaHome : 1.35, 0.02, 12);
  const la = clamp(Number.isFinite(lambdaAway) ? lambdaAway : 1.15, 0.02, 12);
  const r = clamp(rho, 0, 0.5);
  const l3 = Math.max(0, Math.min(r * Math.sqrt(lh * la), 0.9 * Math.min(lh, la)));
  return { l1: lh - l3, l2: la - l3, l3 };
}

// ---------------------------------------------------------------------------
// Grille conjointe exacte
// ---------------------------------------------------------------------------

export type JointGrid = number[][];

/** Grille conjointe P(x,y) renormalisée (somme exactement 1). */
export function bivariateGrid(l1: number, l2: number, l3: number, max = MAX): JointGrid {
  const p1 = poissonRow(Math.max(0, l1), max);
  const p2 = poissonRow(Math.max(0, l2), max);
  const p3 = poissonRow(Math.max(0, l3), max);
  const g: number[][] = [];
  let sum = 0;
  for (let x = 0; x <= max; x++) {
    g[x] = [];
    for (let y = 0; y <= max; y++) {
      let p = 0;
      const kMax = Math.min(x, y);
      for (let k = 0; k <= kMax; k++) p += p1[x - k] * p2[y - k] * p3[k];
      g[x][y] = p;
      sum += p;
    }
  }
  if (sum > 0) {
    for (let x = 0; x <= max; x++) for (let y = 0; y <= max; y++) g[x][y] /= sum;
  }
  return g;
}

/** P(total de buts > ligne X.5) sur la grille conjointe. */
export function overAtLine(grid: JointGrid, line: number): number {
  const threshold = Math.floor(line + 0.5); // 2.5 → 3 buts ou plus
  let over = 0;
  for (let x = 0; x < grid.length; x++) {
    for (let y = 0; y < grid[x].length; y++) {
      if (x + y >= threshold) over += grid[x][y];
    }
  }
  return clamp(over, 0, 1);
}

// ---------------------------------------------------------------------------
// Marchés exacts dérivés de la grille
// ---------------------------------------------------------------------------

export interface ExactMarkets {
  probs: { home: number; draw: number; away: number };
  overUnder: Array<{ line: number; over: number; under: number }>;
  btts: { yes: number; no: number };
  /** P(0-0) exact — supérieur au cas indépendant quand λ3 > 0. */
  noGoal: number;
  topScores: Array<{ score: string; prob: number }>;
  doubleChance: { p1x: number; p12: number; px2: number };
  winToNil: { home: number; away: number };
  /** P(total = t) pour t = 0..2·max (somme 1 — grille complète). */
  totalGoalsHist: number[];
}

function marketsFromGrid(grid: JointGrid, lines: number[]): ExactMarkets {
  let pHome = 0,
    pDraw = 0,
    pAway = 0,
    btts = 0,
    noGoal = 0,
    wtnHome = 0,
    wtnAway = 0;
  const hist: number[] = new Array(2 * MAX + 1).fill(0);
  const scores: Array<{ score: string; prob: number }> = [];
  for (let x = 0; x < grid.length; x++) {
    for (let y = 0; y < grid[x].length; y++) {
      const p = grid[x][y];
      if (x > y) {
        pHome += p;
        if (y === 0) wtnHome += p;
      } else if (x === y) pDraw += p;
      else {
        pAway += p;
        if (x === 0) wtnAway += p;
      }
      if (x >= 1 && y >= 1) btts += p;
      if (x === 0 && y === 0) noGoal = p;
      hist[x + y] += p;
      if (x <= 6 && y <= 6) scores.push({ score: `${x}-${y}`, prob: p });
    }
  }
  scores.sort((a, b) => b.prob - a.prob);
  return {
    probs: { home: pHome, draw: pDraw, away: pAway },
    overUnder: lines.map((line) => {
      const o = overAtLine(grid, line);
      return { line, over: round(o, 4), under: round(1 - o, 4) };
    }),
    btts: { yes: btts, no: 1 - btts },
    noGoal,
    topScores: scores.slice(0, 6).map((s) => ({ score: s.score, prob: round(s.prob, 4) })),
    doubleChance: { p1x: pHome + pDraw, p12: pHome + pAway, px2: pDraw + pAway },
    winToNil: { home: wtnHome, away: wtnAway },
    totalGoalsHist: hist,
  };
}

// ---------------------------------------------------------------------------
// Monte Carlo
// ---------------------------------------------------------------------------

export interface McSample {
  probs: { home: number; draw: number; away: number };
  over25: number;
  bttsYes: number;
  medianGoals: number;
}

function monteCarlo(l1: number, l2: number, l3: number, iterations: number, seed: number): McSample {
  const rand = mulberry32(seed);
  let h = 0,
    d = 0,
    a = 0,
    over25 = 0,
    btts = 0;
  const totals: number[] = new Array(iterations);
  for (let i = 0; i < iterations; i++) {
    // X3 est tiré UNE SEULE fois puis ajouté aux deux scores : c'est la
    // composante PARTAGÉE (corrélation). La tirer deux fois indépendamment
    // ferait retomber le MC sur le modèle indépendant (bug corrigé).
    const x3 = samplePoisson(l3, rand);
    const x = samplePoisson(l1, rand) + x3;
    const y = samplePoisson(l2, rand) + x3;
    if (x > y) h++;
    else if (x === y) d++;
    else a++;
    const t = x + y;
    if (t >= 3) over25++;
    if (x >= 1 && y >= 1) btts++;
    totals[i] = t;
  }
  totals.sort((p, q) => p - q);
  const median = totals[Math.floor(iterations / 2)];
  return {
    probs: { home: h / iterations, draw: d / iterations, away: a / iterations },
    over25: over25 / iterations,
    bttsYes: btts / iterations,
    medianGoals: median,
  };
}

// ---------------------------------------------------------------------------
// Point d'entrée : simulation complète d'un match
// ---------------------------------------------------------------------------

export interface McMatchResult {
  model: 'bivariate-poisson';
  rho: number;
  lambda3: number;
  iterations: number;
  seed: number;
  /** Marchés exacts (grille conjointe, zéro bruit). */
  exact: ExactMarkets & { grid: JointGrid };
  /** Estimation Monte Carlo (vérification croisée + médiane). */
  mc: McSample;
  /** Écart max |exact − MC| sur les probabilités clés. */
  agreement: number;
}

export function simulateMatch(
  lambdaHome: number,
  lambdaAway: number,
  opts: { rho?: number; iterations?: number } = {}
): McMatchResult {
  const rho = opts.rho ?? BIVARIATE_RHO;
  const iterations = opts.iterations ?? MC_ITERATIONS;
  const { l1, l2, l3 } = bivariateLambdas(lambdaHome, lambdaAway, rho);
  const seed = seedOf(lambdaHome, lambdaAway, rho, iterations);

  const grid = bivariateGrid(l1, l2, l3);
  const exact = { ...marketsFromGrid(grid, [1.5, 2.5, 3.5]), grid };
  const mc = monteCarlo(l1, l2, l3, iterations, seed);

  const agreement = Math.max(
    Math.abs(exact.probs.home - mc.probs.home),
    Math.abs(exact.probs.draw - mc.probs.draw),
    Math.abs(exact.probs.away - mc.probs.away),
    Math.abs(exact.overUnder.find((o) => o.line === 2.5)!.over - mc.over25),
    Math.abs(exact.btts.yes - mc.bttsYes)
  );

  return { model: 'bivariate-poisson', rho, lambda3: round(l3, 3), iterations, seed, exact, mc, agreement };
}

// ---------------------------------------------------------------------------
// Calibration marché sur la grille bivariée
// ---------------------------------------------------------------------------

export interface CalibratedBivariate {
  /** Facteur appliqué aux λ (1 = déjà aligné). */
  scale: number;
  /** P(over) par ligne demandée, λ calibrés. */
  over: Record<number, number>;
  /** P(BTTS) avec λ calibrés. */
  btts: number;
}

/**
 * Ancrage du Poisson BIVARIÉ sur le marché : dichotomie sur le facteur
 * d'échelle s (ratio dom/ext préservé, λ3 recalculé à chaque pas) tel que
 * P(Over `anchorLine`) = proba over dé-margée du marché. Remplace
 * calibrateTotals (hypothèse d'indépendance) : la corrélation est
 * désormais conservée pendant la calibration.
 */
export function calibrateBivariate(
  lambdaHome: number,
  lambdaAway: number,
  rho: number,
  anchorLine: number,
  pOverMarket: number,
  lines: number[]
): CalibratedBivariate {
  const lh = Number.isFinite(lambdaHome) && lambdaHome > 0.02 ? lambdaHome : 0.02;
  const la = Number.isFinite(lambdaAway) && lambdaAway > 0.02 ? lambdaAway : 0.02;
  const target = clamp(pOverMarket, 0.03, 0.97);

  const overAtScale = (s: number): number => {
    const { l1, l2, l3 } = bivariateLambdas(s * lh, s * la, rho);
    return overAtLine(bivariateGrid(l1, l2, l3), anchorLine);
  };

  let lo = 0.05;
  let hi = 12;
  let scale = 1;
  if (Math.abs(overAtScale(1) - target) >= 0.005) {
    if (overAtScale(1) < target) {
      lo = 1;
    } else {
      hi = 1;
    }
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (overAtScale(mid) < target) lo = mid;
      else hi = mid;
    }
    scale = (lo + hi) / 2;
  }

  const { l1, l2, l3 } = bivariateLambdas(scale * lh, scale * la, rho);
  const grid = bivariateGrid(l1, l2, l3);
  const over: Record<number, number> = {};
  for (const line of lines) over[line] = overAtLine(grid, line);
  let btts = 0;
  for (let x = 1; x < grid.length; x++) for (let y = 1; y < grid[x].length; y++) btts += grid[x][y];
  return { scale, over, btts };
}
