// ============================================================
// VOLTRIX bet — Tests du Bankroll Manager (règles de règlement)
// Exécution : bun scripts/test-bankroll.ts
// ============================================================

import {
  applyResolutions,
  computeStats,
  dueTickets,
  freshBankroll,
  placeTicket,
  resolveLegPayload,
  settleTicket,
  type BankrollState,
  type ComboResult,
  type ComboLeg,
  type PlacedTicket,
} from '../src/lib/bankroll';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.error(`  ✗ ÉCHEC : ${name}`);
  }
}
const round2 = (x: number) => Math.round(x * 100) / 100;

// ---------- Fixtures ----------
const combo: ComboResult = {
  legs: [
    { matchId: 'm1', leagueCode: 'eng.1', leagueShort: 'PL', leagueName: 'Premier League', matchDate: '2026-09-05', homeName: 'Arsenal', awayName: 'Chelsea', market: '1X2', pick: 'Victoire Arsenal', prob: 0.6, odds: 1.8, oddsSource: 'real', confidence: 4 },
    { matchId: 'm2', leagueCode: 'eng.1', leagueShort: 'PL', leagueName: 'Premier League', matchDate: '2026-09-05', homeName: 'Liverpool', awayName: 'Everton', market: 'O/U 2.5', pick: 'Plus de 2.5 buts', prob: 0.55, odds: 1.9, oddsSource: 'market', confidence: 3 },
  ],
  comboOdds: 3.42,
  comboProb: 0.33,
  comboEV: 0.1286,
  kelly: 0.0429,
  confidenceAvg: 3.5,
  targetOdds: 3,
  legsLimit: 4,
  profile: 'equilibre',
};

function makeState(): BankrollState {
  return freshBankroll(1000);
}

function placeFixed(state: BankrollState, stake = 20): { state: BankrollState; ticket: PlacedTicket } {
  const next = placeTicket(state, {
    profile: combo.profile,
    sourceSavedAt: 123,
    stake,
    combo,
    matchDate: '2026-09-05',
  });
  if (!next) throw new Error('placement refusé');
  return { state: next, ticket: next.tickets[0] };
}

/** Variante libre : combo arbitraire (jambes/date au choix) pour les tests de résolution. */
function placeRaw(state: BankrollState, legs: ComboLeg[], matchDate: string, stake = 20): { state: BankrollState; ticket: PlacedTicket } {
  const comboRaw: ComboResult = { ...combo, legs };
  const next = placeTicket(state, { profile: 'equilibre', sourceSavedAt: 999, stake, combo: comboRaw, matchDate });
  if (!next) throw new Error('placement refusé');
  return { state: next, ticket: next.tickets[0] };
}

// ---------- 1. Placement ----------
console.log('1. Placement des paris');
{
  const s0 = makeState();
  const placed = placeTicket(s0, { profile: 'prudent', sourceSavedAt: 1, stake: 25, combo, matchDate: '2026-09-05' });
  check('placement déduit la mise du solde', placed !== null && round2(placed.balance) === 975);
  check('ticket en attente', placed!.tickets[0].status === 'pending');
  check('payout null avant résolution', placed!.tickets[0].payout === null);
  check('historique ajouté', placed!.history.length === 2);

  check('mise > solde refusée', placeTicket(s0, { profile: 'prudent', sourceSavedAt: 2, stake: 1500, combo, matchDate: '2026-09-05' }) === null);
  check('mise < 1 € refusée', placeTicket(s0, { profile: 'prudent', sourceSavedAt: 3, stake: 0.5, combo, matchDate: '2026-09-05' }) === null);
  check('mise NaN refusée', placeTicket(s0, { profile: 'prudent', sourceSavedAt: 4, stake: NaN, combo, matchDate: '2026-09-05' }) === null);
}

// ---------- 2. Règlement : toutes gagnantes ----------
console.log('2. Ticket gagnant');
{
  const { state, ticket } = placeFixed(makeState(), 20);
  const results = [
    { matchId: 'm1', market: '1X2', pick: 'Victoire Arsenal', status: 'WIN' as const, score: '2 - 0' },
    { matchId: 'm2', market: 'O/U 2.5', pick: 'Plus de 2.5 buts', status: 'WIN' as const, score: '3 - 1' },
  ];
  const { ticket: settled } = settleTicket(ticket, results);
  check('statut gagné', settled.status === 'won');
  check('payout = mise × cote totale (20 × 3.42)', settled.payout === round2(20 * 3.42));

  const next = applyResolutions(state, [settled]);
  check('solde crédité du gain', next !== null && round2(next.balance) === round2(980 + 20 * 3.42));
  check('événement gagné dans l’historique', next!.history.some((h) => h.label.startsWith('Ticket gagné')));
}

// ---------- 3. Règlement : une jambe perdante ----------
console.log('3. Ticket perdu');
{
  const { state, ticket } = placeFixed(makeState(), 15);
  const results = [
    { matchId: 'm1', market: '1X2', pick: 'Victoire Arsenal', status: 'WIN' as const, score: '2 - 0' },
    { matchId: 'm2', market: 'O/U 2.5', pick: 'Plus de 2.5 buts', status: 'LOSE' as const, score: '1 - 1' },
  ];
  const { ticket: settled } = settleTicket(ticket, results);
  check('statut perdu', settled.status === 'lost');
  check('payout 0', settled.payout === 0);
  const next = applyResolutions(state, [settled]);
  check('solde inchangé (mise déjà déduite)', next !== null && round2(next.balance) === 985);
}

// ---------- 4. Règlement : jambe annulée (VOID) ----------
console.log('4. Jambes annulées (VOID)');
{
  const { state, ticket } = placeFixed(makeState(), 10);
  // m1 annulé, m2 gagné → cote réduite = 1.9
  const r1 = settleTicket(ticket, [
    { matchId: 'm1', market: '1X2', pick: 'Victoire Arsenal', status: 'VOID' as const, score: null },
    { matchId: 'm2', market: 'O/U 2.5', pick: 'Plus de 2.5 buts', status: 'WIN' as const, score: '3 - 1' },
  ]).ticket;
  check('VOID + WIN → gagné avec cote réduite', r1.status === 'won');
  check('payout = mise × 1.9', r1.payout === round2(10 * 1.9));

  // tout annulé → remboursement
  const r2 = settleTicket(ticket, [
    { matchId: 'm1', market: '1X2', pick: 'Victoire Arsenal', status: 'VOID' as const, score: null },
    { matchId: 'm2', market: 'O/U 2.5', pick: 'Plus de 2.5 buts', status: 'VOID' as const, score: null },
  ]).ticket;
  check('tout VOID → remboursé', r2.status === 'void');
  check('remboursement = mise', r2.payout === 10);
  const next = applyResolutions(state, [r2]);
  check('solde recrédité de la mise (retour au capital)', next !== null && round2(next.balance) === 1000);
}

// ---------- 5. Résolution partielle ----------
console.log('5. Résolution partielle (une jambe en attente)');
{
  const { state, ticket } = placeFixed(makeState(), 10);
  const { ticket: partial, state: none } = settleTicket(ticket, [{ matchId: 'm1', market: '1X2', pick: 'Victoire Arsenal', status: 'WIN' as const, score: '2 - 1' }]);
  check('ticket encore en cours', partial.status === 'pending');
  check('solde inchangé par un partiel', none === null || round2(none.balance) === round2(state.balance));
  check('résultat partiel enregistré', partial.legResults?.find((l) => l.matchId === 'm1')?.status === 'WIN');
  check('jambe manquante = PENDING', partial.legResults?.find((l) => l.matchId === 'm2')?.status === 'PENDING');

  // Persistance des verdicts partiels (Task 11-a) : 1er apply → état avec mêmes
  // verdicts (solde intact), 2e apply du MÊME partiel → null (anti-boucle 9-a).
  const s1 = applyResolutions(state, [partial]);
  check('partiel persisté sans toucher au solde', s1 !== null && round2(s1.balance) === round2(state.balance));
  check('statut toujours pending après persistance', s1!.tickets[0].status === 'pending');
  check('verdicts de jambes visibles dans l’état', s1!.tickets[0].legResults?.find((l) => l.matchId === 'm1')?.status === 'WIN');
  const s2 = applyResolutions(s1!, [partial]);
  check('partiel identique → aucun nouvel état (anti-boucle)', s2 === null);
}

// ---------- 6. Idempotence ----------
console.log('6. Idempotence');
{
  const { state, ticket } = placeFixed(makeState(), 10);
  const results = [
    { matchId: 'm1', market: '1X2', pick: 'Victoire Arsenal', status: 'WIN' as const, score: '2 - 0' },
    { matchId: 'm2', market: 'O/U 2.5', pick: 'Plus de 2.5 buts', status: 'WIN' as const, score: '2 - 2' },
  ];
  const { ticket: settled } = settleTicket(ticket, results);
  const once = applyResolutions(state, [settled])!;
  const twice = applyResolutions(once, [settled]);
  check('ticket déjà réglé ignoré au 2e passage', twice === null);
  check('solde inchangé au 2e passage', round2(once.balance) === round2(990 + 10 * 3.42));
}

// ---------- 7. Statistiques ----------
console.log('7. Statistiques du portefeuille');
{
  const s0 = makeState();
  const a = placeFixed(s0, 20); // sera gagné (prudent pour varier)
  const aState: BankrollState = { ...a.state, tickets: [{ ...a.ticket, profile: 'prudent' }] };
  const results = [
    { matchId: 'm1', market: '1X2', pick: 'Victoire Arsenal', status: 'WIN' as const, score: '2 - 0' },
    { matchId: 'm2', market: 'O/U 2.5', pick: 'Plus de 2.5 buts', status: 'WIN' as const, score: '3 - 1' },
  ];
  const aSettled = settleTicket(aState.tickets[0], results).ticket;
  const s1 = applyResolutions(aState, [aSettled])!;

  const b = placeFixed(s1, 30);
  const bSettled = settleTicket(b.ticket, [
    { matchId: 'm1', market: '1X2', pick: 'Victoire Arsenal', status: 'LOSE' as const, score: '0 - 1' },
    { matchId: 'm2', market: 'O/U 2.5', pick: 'Plus de 2.5 buts', status: 'WIN' as const, score: '3 - 1' },
  ]).ticket;
  const s2 = applyResolutions(b.state, [bSettled])!;

  const st = computeStats(s2);
  check('1 gagné / 1 perdu', st.won === 1 && st.lost === 1);
  check('mises résolues = 50', round2(st.stakedResolved) === 50);
  check('net = 68.40 − 20 − 30 = 18.40', round2(st.netResolved) === round2(20 * 3.42 - 50));
  check('ROI = net / misé', round2(st.roi * 100) === round2(((20 * 3.42 - 50) / 50) * 100));
  check('P&L = solde − capital', round2(st.pnl) === round2(s2.balance - 1000));
  check('stats profil prudent : 1G', st.byProfile.prudent.won === 1 && st.byProfile.prudent.total === 1);
  check('stats profil équilibré : 1P', st.byProfile.equilibre.lost === 1 && st.byProfile.equilibre.total === 1);
}

// ---------- 8. Échéance & formats de date (Task 11-a) ----------
console.log('8. Échéance & formats de date');
{
  const today = new Date().toISOString().slice(0, 10);
  const leg1: ComboLeg = { ...combo.legs[0], matchDate: `${today}T19:00Z` }; // date ESPN ISO complète
  const s0 = makeState();

  // Match du JOUR (kickoff à une heure déjà révolue ou pas) : doit être échu —
  // l'ancien filtre brut `t.matchDate <= today` comparait un ISO complet à une
  // date simple → jamais échu le jour même.
  const a = placeRaw(s0, [leg1], today, 10);
  check('match du jour = échu (comparaison par journée)', dueTickets(a.state, today).length === 1);

  // Vieux ticket stocké avec un matchDate ISO complet : toujours échu après normalisation
  const sA: BankrollState = { ...a.state, tickets: [{ ...a.ticket, matchDate: `${today}T19:00Z` }] };
  check('vieux matchDate ISO complet = échu (slice 0,10)', dueTickets(sA, today).length === 1);

  // Journée future : pas échu
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const b = placeRaw(s0, [leg1], tomorrow, 10);
  check('journée future = pas échu', dueTickets(b.state, today).length === 0);

  // Déjà réglé : pas échu
  const c = placeRaw(s0, [leg1], today, 10);
  const cState: BankrollState = { ...c.state, tickets: [{ ...c.ticket, status: 'lost' }] };
  check('ticket déjà réglé = pas échu', dueTickets(cState, today).length === 0);

  // Payload API : date tronquée, toutes les jambes envoyées, leagueCode manquant → ''
  const orphanLeg: ComboLeg = { ...combo.legs[0], matchDate: `${today}T19:00Z` };
  delete (orphanLeg as { leagueCode?: string }).leagueCode; // vieux ticket d'avant la Task 8
  const d = placeRaw(s0, [leg1, orphanLeg], today, 10);
  const payload = resolveLegPayload(dueTickets(d.state, today));
  check('payload : 2 jambes envoyées (aucune écartée)', payload.length === 2);
  check('payload : matchDate tronqué à YYYY-MM-DD', payload.every((l) => /^\d{4}-\d{2}-\d{2}$/.test(l.matchDate)));
  check('payload : leagueCode présent conservé', payload[0].leagueCode === 'eng.1');
  check('payload : leagueCode manquant → chaîne vide', payload[1].leagueCode === '');
}

// ---------- 9. Finalisation d'un ticket partiel (dernière jambe résolue) ----------
console.log('9. Finalisation d’un ticket partiel');
{
  const { state, ticket } = placeFixed(makeState(), 10);

  // Cycle 1 : m1 tranché WIN, m2 encore PENDING → partiel persisté
  const partial = settleTicket(ticket, [{ matchId: 'm1', market: '1X2', pick: 'Victoire Arsenal', status: 'WIN' as const, score: '2 - 1' }]).ticket;
  const s1 = applyResolutions(state, [partial])!;
  check('cycle 1 : ticket en cours avec verdict m1', s1.tickets[0].status === 'pending' && s1.tickets[0].legResults?.[0].status === 'WIN');

  // Cycle 2 (panne ESPN, aucune réponse) : le verdict m1 ne doit PAS régresser
  const flaky = settleTicket(s1.tickets[0], []).ticket;
  check('panne ESPN : verdict partiel conservé', flaky.legResults?.[0].status === 'WIN' && flaky.legResults?.[1].status === 'PENDING');
  check('panne ESPN : aucun état émis (rien de neuf)', applyResolutions(s1, [flaky]) === null);

  // Cycle 3 : la dernière jambe devient résolue → finalisation réelle
  const final = settleTicket(s1.tickets[0], [
    { matchId: 'm2', market: 'O/U 2.5', pick: 'Plus de 2.5 buts', status: 'LOSE' as const, score: '1 - 1' },
  ]).ticket;
  check('cycle 3 : m1 fusionné depuis le partiel + m2 LOSE → perdu', final.status === 'lost');
  check('cycle 3 : les deux verdicts présents', final.legResults?.[0].status === 'WIN' && final.legResults?.[1].status === 'LOSE');
  const s3 = applyResolutions(s1, [final]);
  check('cycle 3 : ticket réglé dans l’état', s3 !== null && s3.tickets[0].status === 'lost');
  check('cycle 3 : solde inchangé (mise déjà déduite)', round2(s3!.balance) === round2(state.balance));
  check('cycle 3 : événement « perdu » historisé', s3!.history.some((h) => h.label.startsWith('Ticket perdu')));

  // Finalisation gagnante depuis un partiel : payout complet
  const pb = placeFixed(makeState(), 10);
  const p2 = settleTicket(pb.ticket, [{ matchId: 'm1', market: '1X2', pick: 'Victoire Arsenal', status: 'WIN' as const, score: '2 - 0' }]).ticket;
  const sB1 = applyResolutions(pb.state, [p2])!;
  const f2 = settleTicket(sB1.tickets[0], [
    { matchId: 'm2', market: 'O/U 2.5', pick: 'Plus de 2.5 buts', status: 'WIN' as const, score: '3 - 1' },
  ]).ticket;
  check('partiel → tout WIN : payout = mise × cote totale', f2.status === 'won' && f2.payout === round2(10 * 3.42));
  const sB2 = applyResolutions(sB1, [f2])!;
  check('crédit du gain une seule fois', round2(sB2.balance) === round2(990 + 10 * 3.42));
  check('re-finalisation → aucun état', applyResolutions(sB2, [f2]) === null);
}

// ---------- 10. Vieux ticket sans leagueCode (comportement documenté) ----------
console.log('10. Vieux ticket sans leagueCode');
{
  const today = new Date().toISOString().slice(0, 10);
  const orphan: ComboLeg = { ...combo.legs[0], matchDate: `${today}T19:00Z` };
  delete (orphan as { leagueCode?: string }).leagueCode;
  const { state, ticket } = placeRaw(makeState(), [orphan], today, 10);

  // Aucun crash : dû, envoyé avec leagueCode '', verdicts PENDING si ESPN ne répond pas
  const due = dueTickets(state, today);
  check('vieux ticket échu', due.length === 1);
  const payload = resolveLegPayload(due);
  check('vieux ticket : jambe envoyée avec leagueCode vide', payload.length === 1 && payload[0].leagueCode === '');
  const partial = settleTicket(ticket, []).ticket;
  check('vieux ticket : partiel PENDING sans crash', partial.status === 'pending' && partial.legResults?.[0].status === 'PENDING');
  const s1 = applyResolutions(state, [partial]);
  check('vieux ticket : partiel persisté, solde intact', s1 !== null && round2(s1.balance) === round2(state.balance));
  check('vieux ticket : 2e passage identique → null', applyResolutions(s1!, [partial]) === null);

  // Une fois la jambe localisée par le fallback API, le verdict finalise bien le ticket
  const resolved = settleTicket(s1!.tickets[0], [
    { matchId: orphan.matchId, market: orphan.market, pick: orphan.pick, status: 'WIN' as const, score: '2 - 0' },
  ]).ticket;
  check('vieux ticket : finalisable dès que la jambe est graduée', resolved.status === 'won');
}

console.log(`\nRésultat : ${pass} passent · ${fail} échouent`);
process.exit(fail > 0 ? 1 : 0);
