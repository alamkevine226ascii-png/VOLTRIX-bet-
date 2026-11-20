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
 *
 * v3.1 — plage de marge élargie [−10 % ; +40 %] (correctif « moteur
 * aveugle aux cotes », 3e cause) : l'ancien garde `sum > 1.001` rejetait
 * SILENCIEUSEMENT les trios sous-margés (somme implicite < 1), or c'est
 * courant sur ESPN — cotes arrondies au centime côté bookmaker, trio
 * incomplet (une jambe d'un autre provider), ouverture très liquide.
 * Ex. réel vu en test : 16/9.5/1.23 → somme 0.981 → rejet → la fiche
 * affichait ces cotes MAIS le moteur restait « modèle seul » (34/28/38).
 * La normalisation par la somme traite correctement la sous-marge
 * (elle dilue légèrement les probas, sans inversions) ; la borne haute
 * 1.4 reste le garde contre les trios aberrants (cotes de secours).
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
  if (sum <= 0.9 || sum > 1.4) return null; // marge invraisemblable
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
  // Bornes élargies [0.05, 12] (audit « moteur de pronostics ») : les anciennes
  // bornes [0.25, 2.5] pouvaient ne pas encadrer la cible sur les cas extrêmes
  // (ex. λ total 1.0 et marché à P(over 1.5) = 0.95 → échelle requise ≈ 4.8) ;
  // la dichotomie convergeait alors SILENCIEUSEMENT vers la borne 2.5 et la
  // calibration affichait P(over) ≈ 0.71 contre 0.95 côté marché. Avec λt
  // borné par le moteur (≤ 7.2), l'échelle 12 couvre toute cible atteignable
  // pour les lignes 0.5..12.5 ; overAtScale reste monotone en s.
  let lo = 0.05;
  let hi = 12;
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

// ---------- Calibration marché (Task 61) ----------

/**
 * Poids du marché dans le blend modèle↔marché, calibré sur les buckets
 * empiriques de /api/performance (4 110 pronos résolus) : le modèle brut
 * annonçait 80-90 % pour 62,3 % de réussite réelle (surestimation sévère
 * des fortes probas, Brier 0,2496). p_eff = 65 % marché dé-margé +
 * 35 % modèle ramène les buckets annoncés proches de la réalité.
 */
export const MARKET_BLEND_WEIGHT = 0.65;

/**
 * Recalibrage d'une proba du moteur (Task 61 — « faille grave » corrigée) :
 *  - avec cote marché : p_eff = 0,65 × marché dé-margé + 0,35 × modèle ;
 *  - sans cote marché : retrait de 65 % de l'excès de confiance au-dessus
 *    du niveau « pile ou face » 50 % (p=0,80 → 0,605, cohérent avec le
 *    bucket empirique 80-90 % → 62,3 % réel).
 * Les planchers des profils de risque (60/50/40) s'appliquent désormais
 * à cette proba HONNÊTE, plus à la proba brute surconfiante.
 */
export function blendWithMarket(pModel: number, pMarket: number | null): number {
  const p = Number.isFinite(pModel) ? Math.min(0.97, Math.max(0.02, pModel)) : 0.5;
  if (pMarket !== null && Number.isFinite(pMarket)) {
    const m = Math.min(0.97, Math.max(0.02, pMarket));
    return MARKET_BLEND_WEIGHT * m + (1 - MARKET_BLEND_WEIGHT) * p;
  }
  if (p > 0.5) return p - MARKET_BLEND_WEIGHT * (p - 0.5);
  return p;
}

// ---------- Blend modèle ↔ marché (Task 61 bis — 1X2 entier) ----------

/**
 * Blend VECTORIEL du trio 1X2, pondéré par la DIVERGENCE modèle/marché
 * (v3.1 — correctif « V2 @1,23 affichée 38 % »).
 *
 * Principe : le poids du marché w monte avec la divergence entre le trio
 * modèle et le trio marché. Deux justifications, l'une statistique et
 * l'autre opérationnelle :
 *  - statistique — quand le modèle et le marché sont d'accord (divergence
 *    faible), le blend 65/35 fixe historique (calibré sur 4 110 pronos
 *    résolus, buckets 80-90 % → 62,3 % réels) suffit ; quand ils
 *    DIVERGENT fortement, l'historique empirique dit clairement que c'est
 *    le MODÈLE qui se trompe (Brier 0,2496 brut, surestimation sévère
 *    des fortes probas). Plus l'écart est grand, plus le marché est la
 *    référence : w → 90 %.
 *  - opérationnelle — un parieur qui lit « V2 38 % » sur une fiche où
 *    s'affiche @1,23/@16 ne comprend pas la cote affichée sous ses yeux.
 *    La proba affichée doit refléter le marché au premier ordre ; le
 *    modèle ne garde une influence que là où il ne contredit pas le
 *    marché de manière flagrante.
 *
 * w = 0,65 + 0,25 × (divergence / 0,35), bornée à [0,65 ; 0,90], où la
 * divergence = Σ|modèle − marché|/2 (distance totale de variation sur le
 * trio). Ex. modèle 34/28/38 vs marché 6/6/88 → divergence 0,47 →
 * w ≈ 0,90 → V2 ≈ 0,9×88 + 0,1×38 ≈ 82 % : largement favorite, comme
 * le parieur l'attend sous une cote @1,23 (proba implicite ~81 %).
 * Accord parfait (divergence 0) → w = 0,65, comportement inchangé.
 */
export function blend1x2WithMarket(
  pModel: { home: number; draw: number; away: number },
  pMarket: { home: number; draw: number; away: number } | null,
): { home: number; draw: number; away: number } {
  if (!pMarket) return pModel;
  const clamp01 = (x: number): number => Math.min(0.97, Math.max(0.02, x));
  const mh = clamp01(pMarket.home);
  const md = clamp01(pMarket.draw);
  const ma = clamp01(pMarket.away);
  /* Divergence totale de variation entre les deux trios (0..~0,7). */
  const divergence =
    (Math.abs(pModel.home - mh) + Math.abs(pModel.draw - md) + Math.abs(pModel.away - ma)) / 2;
  const w = Math.min(0.9, MARKET_BLEND_WEIGHT + 0.25 * (divergence / 0.35));
  const blend = (m: number, x: number): number => w * m + (1 - w) * x;
  let h = blend(mh, pModel.home);
  let d = blend(md, pModel.draw);
  let a = blend(ma, pModel.away);
  const s = h + d + a;
  if (!Number.isFinite(s) || s <= 0) return pModel;
  h /= s; d /= s; a /= s;
  return { home: h, draw: d, away: a };
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
