"use client";

/* ============================================================
   VOLTRIX — Bankroll du parieur (localStorage, 100 % local)
   v3.0 : montant + unité de mise. Chaque value bet et chaque
   combiné affiche la mise conseillée = Kelly fractionné (¼),
   plafonnée à 10 % de bankroll — la pratique courante des
   parieurs sérieux (Kelly complet trop volatil sur petits
   échantillons). Aucune donnée ne quitte l'appareil.
   ============================================================ */

const BANKROLL_KEY = "voltrix-bankroll-v1";

export interface BankrollSettings {
  /** Montant total de la bankroll (devise de l'utilisateur). */
  amount: number;
  /** Unité de mise (ex. FCFA) — affichage seul, aucune conversion. */
  currency: string;
}

export const DEFAULT_BANKROLL: BankrollSettings = { amount: 10000, currency: "FCFA" };

/** Fraction de Kelly appliquée (¼ Kelly : variance réduite). */
export const KELLY_FRACTION = 0.25;
/** Plafond de mise : 10 % de la bankroll, garde-fou anti-ruine. */
export const STAKE_CAP_RATIO = 0.1;

export function loadBankroll(): BankrollSettings {
  if (typeof window === "undefined") return DEFAULT_BANKROLL;
  try {
    const raw = window.localStorage.getItem(BANKROLL_KEY);
    if (!raw) return DEFAULT_BANKROLL;
    const parsed = JSON.parse(raw) as Partial<BankrollSettings>;
    const amount = Number(parsed.amount);
    return {
      amount: Number.isFinite(amount) && amount > 0 ? amount : DEFAULT_BANKROLL.amount,
      currency: typeof parsed.currency === "string" && parsed.currency ? parsed.currency : DEFAULT_BANKROLL.currency,
    };
  } catch {
    return DEFAULT_BANKROLL;
  }
}

export function saveBankroll(b: BankrollSettings): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(BANKROLL_KEY, JSON.stringify(b));
  } catch {
    /* quota localStorage : silencieux, la bankroll reste en mémoire */
  }
}

/**
 * Mise conseillée (Kelly ¼ plafonné) pour un pari de proba `prob`
 * et cote décimale `odds` — 0 si aucune edge (prob×cote ≤ 1) ou
 * paramètres invalides. Formule : f = (b·p − q)/b avec b = cote − 1.
 */
export function kellyStake(bankroll: number, prob: number, odds: number): number {
  const b = odds - 1;
  if (!(b > 0) || !Number.isFinite(prob) || prob <= 0 || prob >= 1) return 0;
  const q = 1 - prob;
  const fFull = (b * prob - q) / b;
  if (fFull <= 0) return 0;
  const f = Math.min(KELLY_FRACTION * fFull, STAKE_CAP_RATIO);
  return Math.round(bankroll * f);
}

/** Mise conseillée pour un COMBINÉ : proba = produit des jambes,
 *  cote = produit des cotes — même Kelly ¼ plafonné 10 %. */
export function kellyStakeCombo(bankroll: number, prob: number, odds: number): number {
  return kellyStake(bankroll, prob, odds);
}
