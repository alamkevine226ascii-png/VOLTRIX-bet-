// ============================================================
// Audit 20-d — Script 3 : Persistence bankroll & combo-store
// Repros chiffrés avec les modules RÉELS de src/lib :
//   A. loadBankroll : validation superficielle → NaN / Infinity / soldes négatifs
//   B. settleTicket + applyResolutions : jambe odds:undefined → payout NaN → solde NaN
//   C. MAX_TICKETS=60 : le 61e pari efface SILENCIEUSEMENT le plus ancien (même PENDING)
//   D. loadComboTicket : ticket corrompu accepté → crash client (toFixed sur undefined)
//   E. sync multi-onglets : aucun listener 'storage' → double crédit / création d'argent (simulation)
// ============================================================

import {
  applyResolutions,
  computeStats,
  freshBankroll,
  loadBankroll,
  placeTicket,
  saveBankroll,
  settleTicket,
  type BankrollState,
  type LegResult,
  type PlacedTicket,
} from '../src/lib/bankroll';
import { fmtEur } from '../src/lib/bankroll';
import { loadComboTicket, saveComboTicket } from '../src/lib/combo-store';
import type { ComboLeg, ComboResult } from '../src/lib/combo';

// ---------- shim localStorage (le store tourne côté Node/Bun) ----------
const backing = new Map<string, string>();
const listeners: Array<() => void> = [];
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => backing.get(k) ?? null,
  setItem: (k: string, v: string) => backing.set(k, String(v)),
  removeItem: (k: string) => backing.delete(k),
  clear: () => backing.clear(),
  key: () => null,
  get length() {
    return backing.size;
  },
} as Storage;

let step = 0;
function log(...args: unknown[]) {
  step++;
  console.log(`\n[${step}]`, ...args);
}

function leg(partial: Partial<ComboLeg> = {}): ComboLeg {
  return {
    matchId: partial.matchId ?? `m${Math.random().toString(36).slice(2, 7)}`,
    leagueCode: 'eng.1',
    leagueShort: 'ENG',
    leagueName: 'Premier League',
    matchDate: '2026-09-07',
    homeName: partial.homeName ?? 'Home FC',
    awayName: partial.awayName ?? 'Away FC',
    market: partial.market ?? '1X2',
    pick: partial.pick ?? 'Match nul',
    prob: partial.prob ?? 0.4,
    odds: partial.odds ?? 2.0,
    oddsSource: 'real',
    confidence: 3,
  };
}

function comboOf(legs: ComboLeg[], odds = legs.reduce((a, l) => a * l.odds, 1), prob = 0.2): ComboResult {
  return {
    legs,
    comboOdds: Math.round(odds * 100) / 100,
    comboProb: prob,
    comboEV: prob * odds - 1,
    kelly: 0.05,
    confidenceAvg: 3,
    targetOdds: 5,
    legsLimit: 8,
    profile: 'equilibre',
  };
}

function winAll(state: BankrollState, score = '0 - 0'): LegResult[] {
  // verdicts WIN pour toutes les jambes des tickets échus
  return state.tickets.flatMap((t) => t.legs.map((l) => ({ matchId: l.matchId, market: l.market, pick: l.pick, status: 'WIN' as const, score })));
}

// ============================================================
// A. loadBankroll sans validation profonde
// ============================================================
log('A. loadBankroll — validation superficielle');
backing.clear();
backing.set('voltrix_bankroll_v1', JSON.stringify({ version: 1, start: 1000, balance: -425.5, history: [], tickets: [] }));
let s = loadBankroll();
console.log(`  balance=-425.5  →  ACCEPTÉ tel quel : balance=${s.balance}, fmtEur=${fmtEur(s.balance)}`);

backing.set('voltrix_bankroll_v1', '{"version":1,"start":1e999,"balance":500,"history":[],"tickets":[]}'); // 1e999 brut → JSON.parse → Infinity
s = loadBankroll();
console.log(`  start=1e999 (JSON → Infinity) → ACCEPTÉ : start=${s.start}, pnl=${computeStats(s).pnl}, fmtEur(pnl)=${fmtEur(computeStats(s).pnl)}`);

backing.set('voltrix_bankroll_v1', JSON.stringify({ version: 1, start: 1000, balance: 900, history: [{ t: Date.now(), balance: 'abc', label: 'x' }], tickets: [{ id: 't1', stake: '25', status: 'pending', legs: [{ odds: '2.5' }] }] }));
s = loadBankroll();
console.log(`  ticket stake='25' (string) → ACCEPTÉ : computeStats.inPlay=${computeStats(s).inPlay} (NaN propagé silencieusement)`);

// ============================================================
// B. odds:undefined → payout NaN → solde NaN (chaîne complète)
// ============================================================
log('B. settleTicket : une jambe sans odds (localStorage corrompu ou schéma ancien) → payout NaN');
backing.clear();
let st = freshBankroll(1000);
const legsB = [leg({ odds: 2 }), { ...leg({ matchId: 'mX' }), odds: undefined as unknown as number }]; // odds:undefined brut (contourne le ?? du helper)
const placedB = placeTicket(st, { profile: 'equilibre', sourceSavedAt: 1, stake: 50, combo: comboOf(legsB, 4, 0.25), matchDate: '2026-09-07' })!;
st = placedB;
console.log(`  après placement : balance=${st.balance}`);
const dueB = st.tickets.filter((t) => t.status === 'pending');
const settledB = dueB.map((t) => settleTicket(t, winAll(st)).ticket);
console.log(`  settleTicket → status=${settledB[0].status}, payout=${settledB[0].payout}  ← NaN, pas bloqué`);
const nextB = applyResolutions(st, settledB);
console.log(`  applyResolutions → balance=${nextB!.balance}  ← LE SOLDE DEVIENT NaN`);
console.log(`  fmtEur(NaN) = ${fmtEur(nextB!.balance)} (affiché tel quel dans l'UI)`);
console.log(`  → tout pari suivant : placeTicket stake<=NaN → false → PORTFEUILLE BRICKÉ jusqu'à réinitialisation`);

// ============================================================
// C. 61e ticket → le plus ancien (PENDING) est écrasé en silence
// ============================================================
log('C. MAX_TICKETS=60 : perte silencieuse du plus ancien ticket, même EN COURS');
backing.clear();
let stC = freshBankroll(100000);
for (let i = 1; i <= 61; i++) {
  stC = placeTicket(stC, { profile: 'equilibre', sourceSavedAt: i, stake: 10, combo: comboOf([leg({ odds: 2 })], 2, 0.5), matchDate: '2026-09-07' })!;
}
console.log(`  61 paris de 10 € placés (61e en cours, les 60 premiers en cours aussi)`);
console.log(`  tickets conservés=${stC.tickets.length}, sourceSavedAt du plus ancien conservé = ${stC.tickets[stC.tickets.length - 1].sourceSavedAt} (le n°2 — le n°1 a DISPARU)`);
console.log(`  mise du ticket n°1 (10 €) débitée mais ticket perdu → remboursé JAMAIS, gagné JAMAIS`);
console.log(`  → perte sèche silencieuse : 10 € × chaque ticket qui sort de la fenêtre en étant EN COURS`);

// ============================================================
// D. combo-store : ticket corrompu accepté → crash de rendu client
// ============================================================
log('D. loadComboTicket : validation trop faible (legs[] non vide suffit)');
backing.clear();
// cas 1 : odds manquante
backing.set('voltrix_combo_ticket', JSON.stringify({ savedAt: 1, matchDate: '2026-09-08', targetOdds: 5, profile: 'equilibre', combo: { legs: [{ matchId: 'x', market: '1X2', pick: 'Match nul', prob: 0.3, confidence: 3 }], comboOdds: 2, comboProb: 0.3, comboEV: -0.4, kelly: 0, confidenceAvg: 3, targetOdds: 5, legsLimit: 5, profile: 'equilibre' } }));
const t1 = loadComboTicket();
console.log(`  leg SANS odds → ACCEPTÉ (non null) : loadComboTicket()=${t1 ? 'objet retourné' : 'null'}`);
try {
  (t1!.combo.legs[0].odds as number).toFixed(2); // ce que fait /portefeuille L418 et /combo/ticket L201
} catch (e) {
  console.log(`  → leg.odds.toFixed(2) lève : ${e} ← /portefeuille et /combo/ticket : PAGE BLANCHE`);
}
// cas 2 : odds négative
backing.set('voltrix_combo_ticket', JSON.stringify({ savedAt: 1, matchDate: '2026-09-08', targetOdds: 5, profile: 'equilibre', combo: { legs: [leg({ odds: -3 })], comboOdds: -3, comboProb: 0.3, comboEV: NaN, kelly: NaN, confidenceAvg: 3, targetOdds: 5, legsLimit: 5, profile: 'equilibre' } }));
const t2 = loadComboTicket();
console.log(`  odds=-3, kelly=NaN → ACCEPTÉ : affichage cote=${t2!.combo.legs[0].odds.toFixed(2)}, Math.round(kelly*1000)=${Math.round(t2!.combo.kelly * 1000)} € (mise conseillée NaN €)`);
// cas 3 : prob hors bornes
backing.set('voltrix_combo_ticket', JSON.stringify({ savedAt: 1, matchDate: '2026-09-08', targetOdds: 5, profile: 'equilibre', combo: { legs: [leg({ prob: 1.45, odds: 1.05 })], comboOdds: 1.05, comboProb: 1.45, comboEV: 0.52, kelly: 0.5, confidenceAvg: 3, targetOdds: 5, legsLimit: 5, profile: 'equilibre' } }));
const t3 = loadComboTicket();
console.log(`  prob=1.45 → ACCEPTÉ : ProbBar afficherait ${Math.round(t3!.combo.comboProb * 100)} % (> 100 %) et mise Kelly ${Math.round(t3!.combo.kelly * 1000)} €`);

// ============================================================
// E. sync multi-onglets : simulation last-write-wins (aucun listener 'storage')
// ============================================================
log('E. Deux onglets → écrasement de mutations (pas de listener storage, relecture inexistante)');
backing.clear();
// onglet A charge l'état initial
backing.set('voltrix_bankroll_v1', JSON.stringify(freshBankroll(1000)));
const stateA = loadBankroll();
const stateB = loadBankroll(); // onglet B charge LE MÊME état
// A place un pari (débit 100) → écrit
const afterA = placeTicket(stateA, { profile: 'equilibre', sourceSavedAt: 10, stake: 100, combo: comboOf([leg({ odds: 2 })], 2, 0.5), matchDate: '2026-09-07' })!;
saveBankroll(afterA);
console.log(`  onglet A place 100 € → balance écrite=${afterA.balance}`);
// B (état périmé en mémoire, balance 1000) place AUSSI un pari
const afterB = placeTicket(stateB, { profile: 'equilibre', sourceSavedAt: 11, stake: 100, combo: comboOf([leg({ odds: 3 })], 3, 0.33), matchDate: '2026-09-07' })!;
saveBankroll(afterB); // écrase TOUT (tickets de A inclus)
console.log(`  onglet B place 100 € depuis son état périmé → balance écrite=${afterB.balance}`);
const finalState = loadBankroll();
console.log(`  état final sur disque : balance=${finalState.balance}, tickets=${finalState.tickets.map((t) => t.sourceSavedAt).join(',')} → le pari de A a disparu de la liste, débit de A annulé`);
console.log(`  total réellement débité = 200 € mais solde final = ${finalState.balance} → 100 € créés de nulle part (ou pari fantôme selon l'ordre)`);
// double crédit du même ticket gagné via 2 lignées
log('E2. Double crédit du MÊME ticket gagné (2 onglets, lignées indépendantes)');
backing.clear();
const base = placeTicket(freshBankroll(1000), { profile: 'equilibre', sourceSavedAt: 99, stake: 50, combo: comboOf([leg({ odds: 2 })], 2, 0.5), matchDate: '2026-09-07' })!;
saveBankroll(base); // les deux onglets partent du même état disque (ticket EN COURS)
const staleB = loadBankroll(); // copie PENDING chargée par l'onglet B AVANT la résolution de A
// A résout : gagné → crédite 100
const resultsW: LegResult[] = base.tickets[0].legs.map((l) => ({ matchId: l.matchId, market: l.market, pick: l.pick, status: 'WIN', score: '0 - 0' }));
const settledA = settleTicket(base.tickets[0], resultsW).ticket;
const stateAfterA = applyResolutions(base, [settledA])!;
saveBankroll(stateAfterA); // onglet A écrit
// B possède encore la copie PENDING (chargée avant l'écriture de A) et résout aussi depuis SON état périmé
// (staleB déjà capturé avant l'écriture de A)
const settledB2 = settleTicket(staleB.tickets[0], resultsW).ticket;
const stateAfterB = applyResolutions(staleB, [settledB2])!;
saveBankroll(stateAfterB); // onglet B écrit en dernier
console.log(`  lignée A : won, payout=100, balance écrite=${stateAfterA.balance}`);
console.log(`  lignée B (état périmé ${staleB.balance}) : won, payout=100, balance écrite=${stateAfterB.balance}`);
const final = loadBankroll();
console.log(`  disque final : balance=${final.balance}, ticket=${final.tickets[0].status}`);
console.log(`  → chaque onglet crédite le MÊME payout depuis sa propre copie : la valeur finale est cohérente ICI (un seul crédit)`);
console.log(`    MAIS si B possède un 2e ticket que A ignore, son écriture restaure un pari déjà remboursé chez A → création d'argent (démo section E)`);
console.log('\n✅ Script 3 terminé (aucune écriture dans src/).');
