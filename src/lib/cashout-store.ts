// ============================================================
// VOLTRIX bet — Store local des coupons transférés (Vente)
// L'utilisateur transfère depuis le Combinator le coupon qu'il a
// réellement joué chez son bookmaker (mise engagée + devise),
// puis évalue les offres de rachat : le système calcule la valeur
// juste du coupon (probas live ESPN) et dit VENDRE ou GARDER.
// Tout vit en localStorage — aucune donnée ne quitte l'appareil.
// ============================================================

import type { ComboResult, RiskProfile } from './combo';

// ---------- Devises ----------

export interface CurrencyDef {
  code: string; // code ISO 4217
  label: string; // nom lisible
  symbol: string;
  defaultStake: number; // mise typique (pré-remplie au transfert)
}

/** Devises proposées à l'utilisateur (Europe, Afrique de l'Ouest/Centrale, Amériques, Asie). */
export const CURRENCIES: CurrencyDef[] = [
  { code: 'EUR', label: 'Euro', symbol: '€', defaultStake: 10 },
  { code: 'USD', label: 'Dollar US', symbol: '$', defaultStake: 10 },
  { code: 'GBP', label: 'Livre sterling', symbol: '£', defaultStake: 10 },
  { code: 'CHF', label: 'Franc suisse', symbol: 'CHF', defaultStake: 10 },
  { code: 'CAD', label: 'Dollar canadien', symbol: 'C$', defaultStake: 15 },
  { code: 'XOF', label: 'Franc CFA (UEMOA)', symbol: 'F', defaultStake: 5000 },
  { code: 'XAF', label: 'Franc CFA (CEMAC)', symbol: 'F', defaultStake: 5000 },
  { code: 'NGN', label: 'Naira', symbol: '₦', defaultStake: 5000 },
  { code: 'GHS', label: 'Cedi', symbol: '₵', defaultStake: 50 },
  { code: 'KES', label: 'Shilling kényan', symbol: 'KSh', defaultStake: 500 },
  { code: 'ZAR', label: 'Rand', symbol: 'R', defaultStake: 100 },
  { code: 'MAD', label: 'Dirham', symbol: 'DH', defaultStake: 100 },
  { code: 'DZD', label: 'Dinar algérien', symbol: 'DA', defaultStake: 1000 },
  { code: 'TND', label: 'Dinar tunisien', symbol: 'DT', defaultStake: 20 },
  { code: 'TRY', label: 'Livre turque', symbol: '₺', defaultStake: 100 },
  { code: 'BRL', label: 'Real', symbol: 'R$', defaultStake: 50 },
];

export function currencyByCode(code: string): CurrencyDef {
  return CURRENCIES.find((c) => c.code === code) ?? CURRENCIES[0];
}

/** Formatage monétaire (Intl) avec repli manuel si la devise n'est pas supportée. */
export function fmtMoney(value: number, code: string): string {
  try {
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: code, maximumFractionDigits: code === 'XOF' || code === 'XAF' ? 0 : 2 }).format(value);
  } catch {
    const c = currencyByCode(code);
    return `${value.toLocaleString('fr-FR')} ${c.symbol}`;
  }
}

/** Devise préférée de l'utilisateur (mémorisée sur l'appareil). */
const CURRENCY_KEY = 'voltrix_currency';

export function loadPreferredCurrency(): string {
  try {
    const c = localStorage.getItem(CURRENCY_KEY);
    return c && CURRENCIES.some((x) => x.code === c) ? c : 'EUR';
  } catch {
    return 'EUR';
  }
}

export function savePreferredCurrency(code: string): void {
  try {
    localStorage.setItem(CURRENCY_KEY, code);
  } catch {
    // mode privé : préférence session uniquement
  }
}

// ---------- Coupons ----------

export type SaleDecision = 'SELL' | 'HOLD' | 'MAYBE' | 'LOST' | 'WON';

export interface CouponEvaluation {
  t: number; // epoch ms de l'évaluation
  offered: number; // prix proposé par le bookmaker (dans la devise du coupon)
  currency: string;
  fairValue: number; // valeur juste calculée (même devise)
  jointProb: number; // proba combinée restante 0..1
  decision: SaleDecision;
}

export interface TransferredCoupon {
  id: string; // identifiant unique du coupon transféré
  transferredAt: number; // epoch ms
  sourceSavedAt: number; // savedAt du ticket Combinator (anti double-transfert)
  matchDate: string; // journée des jambes (YYYY-MM-DD)
  profile: RiskProfile;
  targetOdds: number;
  stake: number; // mise réellement engagée chez le bookmaker
  currency: string; // devise choisie par l'utilisateur
  combo: ComboResult;
  status: 'active' | 'sold';
  soldPrice: number | null; // prix de revente effectif
  soldAt: number | null;
  lastEval: CouponEvaluation | null; // dernière évaluation (aperçu sur la carte)
}

const KEY = 'voltrix_sell_coupons_v1';
const MAX_COUPONS = 40;

/** Relit tous les coupons transférés (plus récents d'abord), ou [] si vide/corrompu. */
export function loadCoupons(): TransferredCoupon[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as TransferredCoupon[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((c) => c && typeof c.id === 'string' && c.combo && Array.isArray(c.combo.legs) && c.combo.legs.length > 0)
      .slice(0, MAX_COUPONS);
  } catch {
    return [];
  }
}

export function saveCoupons(list: TransferredCoupon[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX_COUPONS)));
  } catch {
    // quota dépassé / navigation privée : l'état reste en mémoire pour la session
  }
}

/**
 * Transfère le ticket Combinator courant vers la Vente.
 * - La mise (stake) est la mise RÉELLE engagée chez le bookmaker.
 * - Anti double-transfert : si un coupon ACTIF provient du même ticket
 *   (sourceSavedAt), il est mis à jour (mise/devise) au lieu d'être dupliqué.
 * Retourne la liste mise à jour.
 */
export function transferCoupon(
  list: TransferredCoupon[],
  input: {
    sourceSavedAt: number;
    matchDate: string;
    profile: RiskProfile;
    targetOdds: number;
    stake: number;
    currency: string;
    combo: ComboResult;
  }
): TransferredCoupon[] {
  const stake = Math.round(input.stake * 100) / 100;
  if (!Number.isFinite(stake) || stake <= 0) return list;
  if (!input.combo.legs || input.combo.legs.length === 0) return list;

  const existingIdx = list.findIndex((c) => c.status === 'active' && c.sourceSavedAt === input.sourceSavedAt);
  if (existingIdx >= 0) {
    const next = [...list];
    next[existingIdx] = { ...next[existingIdx], stake, currency: input.currency, combo: input.combo, transferredAt: Date.now() };
    return next;
  }

  const coupon: TransferredCoupon = {
    id: `cp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    transferredAt: Date.now(),
    sourceSavedAt: input.sourceSavedAt,
    matchDate: input.matchDate,
    profile: input.profile,
    targetOdds: input.targetOdds,
    stake,
    currency: input.currency,
    combo: input.combo,
    status: 'active',
    soldPrice: null,
    soldAt: null,
    lastEval: null,
  };
  return [coupon, ...list].slice(0, MAX_COUPONS);
}

/** Marque le coupon comme vendu au prix donné (devise du coupon). */
export function markSold(list: TransferredCoupon[], id: string, price: number): TransferredCoupon[] {
  const p = Math.round(price * 100) / 100;
  if (!Number.isFinite(p) || p < 0) return list;
  return list.map((c) => (c.id === id && c.status === 'active' ? { ...c, status: 'sold', soldPrice: p, soldAt: Date.now() } : c));
}

/** Supprime un coupon (actif ou vendu). */
export function removeCoupon(list: TransferredCoupon[], id: string): TransferredCoupon[] {
  return list.filter((c) => c.id !== id);
}

/** Enregistre la dernière évaluation d'un coupon (aperçu carte + historique léger). */
export function recordEvaluation(list: TransferredCoupon[], id: string, ev: CouponEvaluation): TransferredCoupon[] {
  return list.map((c) => (c.id === id ? { ...c, lastEval: ev } : c));
}
