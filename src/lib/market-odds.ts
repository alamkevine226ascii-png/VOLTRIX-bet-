// ============================================================
// VOLTRIX bet — Cotes dérivées du marché (sans API payante)
// ESPN publie : le 1X2 réel + UNE ligne O/U principale.
// On en déduit tout le reste par calcul :
//   - deMargin1x2 / deMarginOverUnder : retrait de la marge
//     du bookmaker → probabilités « marché »
//   - dcFromMarket : 3 Double Chance dérivées du 1X2 dé-margé
//   - calibrateTotals : dichotomie sur un facteur d'échelle des
//     λ Poisson pour ancrer le modèle sur la ligne O/U réelle,
//     puis interpolation des lignes 1.5 / 2.5 / 3.5 + BTTS
//   - oddsWithMargin : proba → cote (marge bookmaker réappliquée)
// ============================================================

// ---------- Poisson pur ----------

function poissonPmf(lambda: number, k: number): number {
  let fact = 1;
  for (let i = 2; i <= k; i++) fact *= i;
  return (Math.exp(-lambda) * Math.pow(lambda, k)) / fact;
}

/** Distribution du nombre total de buts (somme des 2 Poisson), 0..12 normalisée */
export function totalGoalsDist(lambdaTotal: number): number[] {
  const safeLambda = Number.isFinite(lambdaTotal) && lambdaTotal > 0.05 ? lambdaTotal : 0.05;
  const dist: number[] = [];
  let cum = 0;
  for (let k = 0; k <= 12; k++) {
    const p = poissonPmf(safeLambda, k);
    dist.push(p);
    cum += p;
  }
  return dist.map((p) => p / cum); // la queue au-delà de 12 est négligeable
}

/** P(total de buts > line) pour une ligne X.5 (1.5 / 2.5 / 3.5…) */
export function overProb(dist: number[], line: number): number {
  const threshold = Math.floor(line + 0.5); // 1.5 → 2 buts ou plus
  let over = 0;
  for (let k = threshold; k < dist.length; k++) over += dist[k];
  return Math.min(1, Math.max(0, over));
}

/** P(les deux équipes marquent) avec 2 Poisson indépendants */
export function bttsProb(lambdaHome: number, lambdaAway: number): number {
  const lh = Number.isFinite(lambdaHome) && lambdaHome > 0.02 ? lambdaHome : 0.02;
  const la = Number.isFinite(lambdaAway) && lambdaAway > 0.02 ? lambdaAway : 0.02;
  return (1 - Math.exp(-lh)) * (1 - Math.exp(-la));
}

// ---------- Dé-margage ----------

function isValidOdds(o: unknown): o is number {
  return typeof o === 'number' && Number.isFinite(o) && o > 1.01 && o < 200;
}

/**
 * Retire la marge du bookmaker d'un 1X2 réel.
 * Ex. 1.85/3.60/4.20 → probas implicites 54.0/27.8/23.8 % (marge 5.7 %)
 *     → dé-margé 51.2/26.3/22.5 %.
 */
export function deMargin1x2(
  mlHome: number,
  mlDraw: number,
  mlAway: number
): { pH: number; pD: number; pA: number; margin: number } | null {
  if (!isValidOdds(mlHome) || !isValidOdds(mlDraw) || !isValidOdds(mlAway)) return null;
  const iH = 1 / mlHome;
  const iD = 1 / mlDraw;
  const iA = 1 / mlAway;
  const sum = iH + iD + iA;
  if (sum <= 1.001 || sum > 1.4) return null; // marge invraisemblable
  return { pH: iH / sum, pD: iD / sum, pA: iA / sum, margin: sum - 1 };
}

/** Dé-margage d'une ligne Over/Under réelle (over + under = 1 + marge) */
export function deMarginOverUnder(
  overOdds: number,
  underOdds: number
): { pOver: number; pUnder: number; margin: number } | null {
  if (!isValidOdds(overOdds) || !isValidOdds(underOdds)) return null;
  const iO = 1 / overOdds;
  const iU = 1 / underOdds;
  const sum = iO + iU;
  if (sum <= 1.001 || sum > 1.3) return null;
  return { pOver: iO / sum, pUnder: iU / sum, margin: sum - 1 };
}

// ---------- Double Chance dérivée du marché ----------

export interface MarketDC {
  prob1X: number;
  prob12: number;
  probX2: number;
  odds1X: number;
  odds12: number;
  oddsX2: number;
}

/**
 * 3 Double Chance dérivées du 1X2 réel : probas dé-margées,
 * puis marge bornée 3-8 % (celle observée, bornée par prudence)
 * réappliquée pour obtenir des cotes réalistes.
 * Ex. 1.85/3.60/4.20 → DC 1X ≈ 77.5 % @ ≈ 1.22.
 */
export function dcFromMarket(mlHome: number, mlDraw: number, mlAway: number): MarketDC | null {
  const dm = deMargin1x2(mlHome, mlDraw, mlAway);
  if (!dm) return null;
  const margin = Math.min(0.08, Math.max(0.03, dm.margin));
  return {
    prob1X: dm.pH + dm.pD,
    prob12: dm.pH + dm.pA,
    probX2: dm.pD + dm.pA,
    odds1X: oddsWithMargin(dm.pH + dm.pD, margin),
    odds12: oddsWithMargin(dm.pH + dm.pA, margin),
    oddsX2: oddsWithMargin(dm.pD + dm.pA, margin),
  };
}

// ---------- Calibrage Poisson sur la ligne O/U réelle ----------

export interface CalibratedTotals {
  scale: number; // facteur appliqué aux λ (1 = déjà aligné)
  over: Record<number, number>; // P(over) par ligne demandée
  btts: number; // P(les 2 équipes marquent), lambdas calibrés
}

/**
 * Ancore le Poisson sur le marché : cherche par dichotomie le
 * facteur d'échelle s tel que P(Over `anchorLine`) du modèle
 * (lambdas × s, ratio dom/ext préservé) = proba over dé-margée
 * du marché. Puis calcule les probas de toutes les `lines`
 * demandées et BTTS avec les lambdas calibrés.
 */
export function calibrateTotals(
  lambdaHome: number,
  lambdaAway: number,
  anchorLine: number,
  pOverMarket: number,
  lines: number[]
): CalibratedTotals {
  const lh = Number.isFinite(lambdaHome) && lambdaHome > 0.02 ? lambdaHome : 0.02;
  const la = Number.isFinite(lambdaAway) && lambdaAway > 0.02 ? lambdaAway : 0.02;
  const target = Math.min(0.97, Math.max(0.03, pOverMarket));

  const overAtScale = (s: number): number =>
    overProb(totalGoalsDist(s * (lh + la)), anchorLine);

  // Si le modèle est déjà aligné sur le marché → scale 1
  let lo = 0.25;
  let hi = 2.5;
  let scale = 1;
  if (Math.abs(overAtScale(1) - target) < 0.005) {
    scale = 1;
  } else if (overAtScale(1) < target) {
    // le modèle sous-estime les buts → augmenter
    lo = 1;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (overAtScale(mid) < target) lo = mid;
      else hi = mid;
    }
    scale = (lo + hi) / 2;
  } else {
    // le modèle surestime les buts → diminuer
    hi = 1;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (overAtScale(mid) < target) lo = mid;
      else hi = mid;
    }
    scale = (lo + hi) / 2;
  }

  const dist = totalGoalsDist(scale * (lh + la));
  const over: Record<number, number> = {};
  for (const line of lines) over[line] = overProb(dist, line);
  return { scale, over, btts: bttsProb(scale * lh, scale * la) };
}

// ---------- Proba → cote ----------

/**
 * Cote dérivée d'une proba modèle : (1/proba) × (1 − marge).
 * Marge par défaut 7 % (approximation bookmaker).
 */
export function oddsWithMargin(prob: number, margin = 0.07): number {
  if (!Number.isFinite(prob) || prob <= 0.02) return 1.04;
  return Math.max(1.04, Math.round((1 / Math.min(prob, 0.97)) * (1 - margin) * 100) / 100);
}
