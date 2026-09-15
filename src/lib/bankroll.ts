// ============================================================
// VOLTRIX bet — Bankroll Manager (store local de l'appareil)
// Gère une banque virtuelle : placer des tickets générés par le
// Combinator, suivre leur résolution (ESPN) et mesurer la
// performance (P&L, ROI, courbe, stats par profil de risque).
// Tout vit en localStorage — aucune donnée ne quitte l'appareil.
// ============================================================

import type { ComboLeg, ComboResult, RiskProfile } from './combo';

// ---------- Types ----------

export type LegStatus = 'WIN' | 'LOSE' | 'VOID' | 'PENDING';

export interface LegResult {
  matchId: string;
  market: string;
  pick: string;
  status: LegStatus;
  score: string | null; // "2 - 1"
}

export type TicketStatus = 'pending' | 'won' | 'lost' | 'void';

export interface PlacedTicket {
  id: string;
  placedAt: number; // epoch ms
  matchDate: string; // journée des jambes (YYYY-MM-DD)
  profile: RiskProfile;
  sourceSavedAt: number; // savedAt du ticket Combinator d'origine (anti double-jeu)
  stake: number; // mise (€)
  comboOdds: number; // cote totale du combiné
  comboProb: number; // probabilité modèle du combiné
  legs: ComboLeg[];
  status: TicketStatus;
  payout: number | null; // gain crédité (stake × cote réduite) — null si en cours
  legResults: LegResult[] | null; // null tant que non résolu
  resolvedAt: number | null;
}

export interface BankrollEvent {
  t: number; // epoch ms
  balance: number; // solde après l'événement
  label: string; // libellé lisible (courbe + journal)
}

export interface BankrollState {
  version: 1;
  start: number; // capital de départ (€)
  balance: number; // solde actuel (€)
  history: BankrollEvent[]; // points de progression (courbe)
  tickets: PlacedTicket[]; // tickets placés (plus récent en premier)
}

export const DEFAULT_BANKROLL = 1000;
const KEY = 'voltrix_bankroll_v1';
const MAX_HISTORY = 120;
const MAX_TICKETS = 60;

// ---------- Lecture / écriture ----------

export function loadBankroll(): BankrollState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return freshBankroll(DEFAULT_BANKROLL);
    const parsed = JSON.parse(raw) as BankrollState;
    if (
      !parsed ||
      typeof parsed.balance !== 'number' ||
      !Number.isFinite(parsed.balance) ||
      !Array.isArray(parsed.tickets)
    ) {
      return freshBankroll(DEFAULT_BANKROLL);
    }
    return {
      version: 1,
      start: typeof parsed.start === 'number' && parsed.start > 0 ? parsed.start : DEFAULT_BANKROLL,
      balance: parsed.balance,
      history: Array.isArray(parsed.history) ? parsed.history.slice(-MAX_HISTORY) : [],
      tickets: parsed.tickets.slice(0, MAX_TICKETS),
    };
  } catch {
    return freshBankroll(DEFAULT_BANKROLL);
  }
}

export function saveBankroll(state: BankrollState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // quota dépassé / navigation privée : l'état reste en mémoire pour la session
  }
}

export function freshBankroll(start: number): BankrollState {
  return {
    version: 1,
    start,
    balance: start,
    history: [{ t: Date.now(), balance: start, label: 'Banque créée' }],
    tickets: [],
  };
}

/** Capital de départ modifiable (seulement si la banque est vierge de tickets en cours). */
export function resetBankroll(start: number): BankrollState {
  return freshBankroll(start > 0 ? Math.round(start * 100) / 100 : DEFAULT_BANKROLL);
}

// ---------- Placement d'un ticket ----------

export interface PlaceTicketInput {
  profile: RiskProfile;
  sourceSavedAt: number;
  stake: number;
  combo: ComboResult;
  matchDate: string;
}

/** Place un pari : déduit la mise du solde et ajoute le ticket. Retourne null si la mise est invalide. */
export function placeTicket(state: BankrollState, input: PlaceTicketInput): BankrollState | null {
  const stake = Math.round(input.stake * 100) / 100;
  if (!Number.isFinite(stake) || stake < 1 || stake > state.balance + 1e-9) return null;
  if (!input.combo.legs || input.combo.legs.length === 0) return null;

  const ticket: PlacedTicket = {
    id: `bk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    placedAt: Date.now(),
    matchDate: input.matchDate,
    profile: input.profile,
    sourceSavedAt: input.sourceSavedAt,
    stake,
    comboOdds: input.combo.comboOdds,
    comboProb: input.combo.comboProb,
    legs: input.combo.legs,
    status: 'pending',
    payout: null,
    legResults: null,
    resolvedAt: null,
  };

  const balance = Math.round((state.balance - stake) * 100) / 100;
  const next: BankrollState = {
    ...state,
    balance,
    history: [
      ...state.history,
      { t: Date.now(), balance, label: `Pari placé · −${stake.toFixed(2)} €` },
    ].slice(-MAX_HISTORY),
    tickets: [ticket, ...state.tickets].slice(0, MAX_TICKETS),
  };
  return next;
}

// ---------- Résolution d'un ticket ----------

/** Clé unique d'une jambe (même convention que l'API de résolution). */
function legKey(m: string, p: string, matchId: string): string {
  return `${matchId}|${m}|${p}`;
}

/** Tickets échus : en cours et dont la journée de match est passée (ou aujourd'hui).
 *  matchDate est normalisé (10 premiers caractères) pour tolérer d'éventuels
 *  vieux tickets stockés avec une date ISO complète « 2026-09-04T19:00Z » —
 *  comparée brute à « 2026-09-04 », un tel match du jour n'aurait JAMAIS été échu
 *  (« 2026-09-04T19:00Z » > « 2026-09-04 » lexicographiquement). */
export function dueTickets(state: BankrollState, today: string): PlacedTicket[] {
  return state.tickets.filter((t) => t.status === 'pending' && String(t.matchDate ?? '').slice(0, 10) <= today);
}

/** Payload d'une jambe pour POST /api/bankroll/resolve.
 *  TOUTES les jambes sont envoyées : une jambe sans leagueCode (vieux tickets
 *  d'avant la Task 8) part avec '' et est localisée par l'API via un scan borné
 *  de ligues probables — la jeter ici la condamnait à rester PENDING à vie.
 *  matchDate est tronqué à YYYY-MM-DD (l'API interroge le scoreboard par jour). */
export interface ResolveLegPayload {
  matchId: string;
  leagueCode: string;
  matchDate: string;
  market: string;
  pick: string;
}

export function resolveLegPayload(tickets: PlacedTicket[]): ResolveLegPayload[] {
  return tickets.flatMap((t) => t.legs).map((l) => ({
    matchId: l.matchId,
    leagueCode: l.leagueCode ?? '',
    matchDate: String(l.matchDate ?? '').slice(0, 10),
    market: l.market,
    pick: l.pick,
  }));
}

/** Comparaison exacte des verdicts de jambes (évite d'émettre un nouvel état
 *  identique : c'est ce qui provoquait la boucle état → effet → requête). */
function legResultsEqual(a: LegResult[] | null, b: LegResult[] | null): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every(
    (x, i) =>
      x.matchId === b[i].matchId && x.market === b[i].market && x.pick === b[i].pick && x.status === b[i].status && x.score === b[i].score
  );
}

/**
 * Applique les résultats des jambes à un ticket en cours.
 * Règles combiné : une jambe LOSE → perdu · toutes WIN → gagné ·
 * jambe VOID (match annulé) → cote 1 pour cette jambe ·
 * tout VOID → remboursé.
 */
export function settleTicket(ticket: PlacedTicket, results: LegResult[]): { ticket: PlacedTicket; state: BankrollState | null } {
  if (ticket.status !== 'pending') return { ticket, state: null };

  const byLeg = new Map(results.map((r) => [legKey(r.market, r.pick, r.matchId), r]));
  const legResults: LegResult[] = ticket.legs.map((leg, i) => {
    const r = byLeg.get(legKey(leg.market, leg.pick, leg.matchId));
    // Verdict partiel déjà connu (cycle précédent) : conservé si l'API n'a pas
    // re-répondu pour cette jambe (panne ESPN, jambe non ré-envoyée) — sinon un
    // ticket jamais finalisable régresserait à PENDING à chaque cycle.
    const prior = ticket.legResults?.[i];
    const priorValid =
      prior && prior.matchId === leg.matchId && prior.market === leg.market && prior.pick === leg.pick ? prior : undefined;
    const source = r ?? priorValid;
    return {
      matchId: leg.matchId,
      market: leg.market,
      pick: leg.pick,
      status: source?.status ?? 'PENDING',
      score: source?.score ?? null,
    };
  });

  // Tant qu'une jambe attend son résultat, le ticket reste en cours
  if (legResults.some((l) => l.status === 'PENDING')) {
    const partial: PlacedTicket = { ...ticket, legResults };
    return { ticket: partial, state: null };
  }

  const hasLose = legResults.some((l) => l.status === 'LOSE');
  const voidCount = legResults.filter((l) => l.status === 'VOID').length;
  const winCount = legResults.filter((l) => l.status === 'WIN').length;

  let status: TicketStatus;
  let payout: number;
  if (hasLose) {
    status = 'lost';
    payout = 0;
  } else if (winCount === 0 && voidCount > 0) {
    status = 'void'; // toutes les jambes annulées → remboursement
    payout = ticket.stake;
  } else {
    status = 'won';
    // cote réduite : les jambes VOID comptent pour 1
    const reducedOdds = ticket.legs.reduce((acc, leg, i) => {
      const st = legResults[i]?.status;
      return st === 'VOID' ? acc : acc * leg.odds;
    }, 1);
    payout = Math.round(ticket.stake * reducedOdds * 100) / 100;
  }

  const resolved: PlacedTicket = {
    ...ticket,
    status,
    payout,
    legResults,
    resolvedAt: Date.now(),
  };

  // Le solde/historique est mis à jour de façon centralisée par applyResolutions
  return { ticket: resolved, state: null };
}

/**
 * Résout plusieurs tickets d'un coup et met à jour le solde/historique.
 * Retourne le nouvel état (ou null si rien n'a changé).
 * - Un passage RÉEL pending → won/lost/void crédite/débite le solde.
 * - Un ticket toujours partiel ne bouge PAS le solde, mais ses verdicts de
 *   jambes déjà tranchés (WIN/LOSE/VOID + score) sont persistés pour l'affichage
 *   et pour survivre à un cycle où l'API ne répondrait pas — à condition qu'ils
 *   aient réellement changé : un partiel identique ne produit aucun nouvel état
 *   (anti-boucle Task 9-a conservée).
 */
export function applyResolutions(state: BankrollState, resolvedTickets: PlacedTicket[]): BankrollState | null {
  if (resolvedTickets.length === 0) return null;
  const map = new Map(resolvedTickets.map((t) => [t.id, t]));

  let balance = state.balance;
  let changed = false;
  const events: BankrollEvent[] = [];
  const tickets = state.tickets.map((t) => {
    const r = map.get(t.id);
    if (!r || t.status !== 'pending') return t;
    if (r.status === 'pending') {
      // Ticket toujours partiel : persistance des verdicts partiels SANS
      // mouvement de solde ni changement de statut. Identique → aucun état.
      if (legResultsEqual(t.legResults, r.legResults)) return t;
      changed = true;
      return { ...t, legResults: r.legResults };
    }
    changed = true;
    // Finalisation réelle (pending → won/lost/void) : seul chemin qui touche au solde.
    if (r.status === 'won' && r.payout != null) {
      balance = Math.round((balance + r.payout) * 100) / 100;
      events.push({ t: r.resolvedAt ?? Date.now(), balance, label: `Ticket gagné · +${r.payout.toFixed(2)} €` });
    } else if (r.status === 'void' && r.payout != null) {
      balance = Math.round((balance + r.payout) * 100) / 100;
      events.push({ t: r.resolvedAt ?? Date.now(), balance, label: `Ticket remboursé · +${r.payout.toFixed(2)} €` });
    } else if (r.status === 'lost') {
      events.push({ t: r.resolvedAt ?? Date.now(), balance, label: `Ticket perdu · −${r.stake.toFixed(2)} €` });
    }
    return r;
  });

  if (!changed) return null;

  return {
    ...state,
    balance,
    history: [...state.history, ...events].slice(-MAX_HISTORY),
    tickets,
  };
}

// ---------- Statistiques dérivées ----------

export interface WalletStats {
  inPlay: number; // mises en jeu (tickets en cours)
  pnl: number; // solde − capital
  stakedResolved: number; // total misé sur tickets résolus
  netResolved: number; // net sur tickets résolus (payout − mise)
  roi: number; // netResolved / stakedResolved
  won: number;
  lost: number;
  voided: number;
  pending: number;
  byProfile: Record<RiskProfile, { total: number; won: number; lost: number; net: number; staked: number }>;
}

export function computeStats(state: BankrollState): WalletStats {
  const byProfile: WalletStats['byProfile'] = {
    prudent: { total: 0, won: 0, lost: 0, net: 0, staked: 0 },
    equilibre: { total: 0, won: 0, lost: 0, net: 0, staked: 0 },
    agressif: { total: 0, won: 0, lost: 0, net: 0, staked: 0 },
  };
  let inPlay = 0;
  let stakedResolved = 0;
  let netResolved = 0;
  let won = 0;
  let lost = 0;
  let voided = 0;
  let pending = 0;

  for (const t of state.tickets) {
    const p = byProfile[t.profile] ?? byProfile.equilibre;
    p.total++;
    if (t.status === 'pending') {
      pending++;
      inPlay += t.stake;
      continue;
    }
    stakedResolved += t.stake;
    p.staked += t.stake;
    const net = (t.payout ?? 0) - t.stake;
    netResolved += net;
    p.net += net;
    if (t.status === 'won') {
      won++;
      p.won++;
    } else if (t.status === 'lost') {
      lost++;
      p.lost++;
    } else {
      voided++;
    }
  }

  return {
    inPlay: Math.round(inPlay * 100) / 100,
    pnl: Math.round((state.balance - state.start) * 100) / 100,
    stakedResolved: Math.round(stakedResolved * 100) / 100,
    netResolved: Math.round(netResolved * 100) / 100,
    roi: stakedResolved > 0 ? netResolved / stakedResolved : 0,
    won,
    lost,
    voided,
    pending,
    byProfile,
  };
}

// ---------- Formatage ----------

const eur = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 });

export function fmtEur(x: number): string {
  return eur.format(x);
}

export const TICKET_STATUS_LABEL: Record<TicketStatus, string> = {
  pending: 'EN COURS',
  won: 'GAGNÉ',
  lost: 'PERDU',
  void: 'REMBOURSÉ',
};

export const PROFILE_ORDER: RiskProfile[] = ['prudent', 'equilibre', 'agressif'];
