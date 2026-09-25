// ============================================================
// Audit 19-b — bankroll.ts : settleTicket / applyResolutions / dueTickets
// Scénario 3 jambes avec 1 VOID, fusion partielle, anti-boucle 9-a,
// idempotence, dueTickets (normalisation ISO), conflit 2 onglets.
// Importe le code RÉEL de src/lib/bankroll.ts — lecture seule.
// ============================================================
import {
  applyResolutions,
  dueTickets,
  settleTicket,
  type BankrollState,
  type LegResult,
  type PlacedTicket,
} from '../src/lib/bankroll';

let pass = 0, fail = 0;
const ok = (c: boolean, msg: string) => { if (c) { pass++; console.log('  PASS', msg); } else { fail++; console.log('  FAIL', msg); } };

const mkLeg = (i: number, matchId: string, market: string, pick: string, odds: number) => ({
  matchId, market, pick, odds, oddsSource: 'book' as const, prob: 0.5,
  leagueCode: 'arg.1', leagueShort: 'ARG', leagueName: 'Liga', matchDate: '2026-09-07',
  homeName: 'H', awayName: 'A', homeLogo: null, awayLogo: null, confidence: 3,
});

const mkTicket = (legs: ReturnType<typeof mkLeg>[], stake = 100): PlacedTicket => ({
  id: 'bk_test_1', placedAt: Date.now(), matchDate: '2026-09-07', profile: 'equilibre',
  sourceSavedAt: 1, stake, comboOdds: legs.reduce((a, l) => a * l.odds, 1), comboProb: 0.1,
  legs, status: 'pending', payout: null, legResults: null, resolvedAt: null,
});

const fresh = (): BankrollState => ({
  version: 1, start: 1000, balance: 1000,
  history: [{ t: Date.now(), balance: 1000, label: 'init' }],
  tickets: [],
});

const legRes = (l: { matchId: string; market: string; pick: string }, status: LegResult['status'], score: string | null = '1 - 2'): LegResult =>
  ({ matchId: l.matchId, market: l.market, pick: l.pick, status, score });

console.log('== 1) Scénario 3 jambes, 1 VOID (WIN + VOID + WIN), mise 100 ==');
const legs3 = [mkLeg(0, 'm1', '1X2', 'Victoire H', 1.85), mkLeg(1, 'm2', 'O/U 2.5', 'Plus de 2.5', 2.3), mkLeg(2, 'm3', 'BTTS', 'Les deux équipes marquent : Oui', 1.6)];
const t = mkTicket(legs3, 100);
const res = [legRes(legs3[0], 'WIN'), legRes(legs3[1], 'VOID'), legRes(legs3[2], 'WIN')];
const settled1 = settleTicket(t, res).ticket;
console.log(`  statut=${settled1.status} payout=${settled1.payout} (cote réduite attendue 1.85×1.60=2.96 → 296.00)`);
ok(settled1.status === 'won', 'statut won (VOID+WIN → cote réduite)');
ok(settled1.payout === 296, `payout = 296.00 exact (obtenu ${settled1.payout})`);

console.log('== 2) Tout VOID → remboursement ==');
const resAllVoid = [legRes(legs3[0], 'VOID'), legRes(legs3[1], 'VOID'), legRes(legs3[2], 'VOID')];
const settled2 = settleTicket(t, resAllVoid).ticket;
ok(settled2.status === 'void' && settled2.payout === 100, `remboursé 100.00 (obtenu ${settled2.status}/${settled2.payout})`);

console.log('== 3) 1 LOSE → perdu, payout 0 ==');
const resLose = [legRes(legs3[0], 'WIN'), legRes(legs3[1], 'LOSE'), legRes(legs3[2], 'WIN')];
const settled3 = settleTicket(t, resLose).ticket;
ok(settled3.status === 'lost' && settled3.payout === 0, `lost/0 (obtenu ${settled3.status}/${settled3.payout})`);

console.log('== 4) Fusion partielle : cycle 1 [WIN,PENDING,PENDING] → pas de solde, verdicts persistés ==');
const s0 = fresh();
s0.tickets = [t];
const cyc1 = [legRes(legs3[0], 'WIN'), legRes(legs3[1], 'PENDING', null), legRes(legs3[2], 'PENDING', null)];
const part = settleTicket(t, cyc1).ticket;
ok(part.status === 'pending' && part.legResults?.[0].status === 'WIN', 'ticket toujours pending, jambe 1 WIN mémorisée');
const st1 = applyResolutions(s0, [part]);
ok(st1 !== null && st1.balance === 1000 && st1.tickets[0].legResults?.[0].status === 'WIN', 'état émis (verdicts partiels) SANS mouvement de solde (1000)');
ok(st1!.tickets[0].status === 'pending', 'statut inchangé (pending)');

console.log('== 5) Anti-boucle 9-a : partiel IDENTIQUE réappliqué → null ==');
const partSame = settleTicket(st1!.tickets[0], cyc1).ticket;
ok(applyResolutions(st1!, [partSame]) === null, 'second partiel identique → aucun état émis (null)');

console.log('== 6) Cycle 2 : [WIN,VOID,WIN] → finalisation, crédit unique ==');
const st2 = applyResolutions(st1!, [settled1]);
ok(st2 !== null && st2.balance === 1296, `solde 1000+296=1296 (obtenu ${st2?.balance})`);
ok(st2!.tickets[0].status === 'won', 'ticket won');
ok(applyResolutions(st2!, [settled1]) === null, 'idempotence : réapplication du même final → null (pas de double crédit)');

console.log('== 7) Jambe déjà tranchée ne régresse pas (API muette sur 1 jambe) ==');
const partialTicket = st1!.tickets[0]; // jambes [WIN, PENDING, PENDING] persistées
const apiMissing = [legRes(legs3[0], 'WIN'), legRes(legs3[1], 'VOID')]; // jambe 3 absente de la réponse
const merged = settleTicket(partialTicket, apiMissing).ticket;
ok(merged.legResults?.[2].status === 'PENDING' && merged.legResults?.[1].status === 'VOID' && merged.legResults?.[0].status === 'WIN',
  'prior conservé pour les jambes non ré-émises, mise à jour pour les autres');

console.log('== 8) dueTickets : normalisation ISO complet + comparaison stricte ==');
const st3 = fresh();
st3.tickets = [
  { ...mkTicket([legs3[0]]), id: 'a', matchDate: '2026-09-08T00:15Z' }, // ISO complet (vieux format)
  { ...mkTicket([legs3[0]]), id: 'b', matchDate: '2026-09-07' },        // passé
  { ...mkTicket([legs3[0]]), id: 'c', matchDate: '2026-09-09' },        // futur
  { ...mkTicket([legs3[0]]), id: 'd', status: 'won' as const, matchDate: '2026-09-07' }, // déjà résolu
];
const due = dueTickets(st3, '2026-09-08');
ok(due.map((x) => x.id).join(',') === 'a,b', `échus = [a,b] (obtenu [${due.map((x) => x.id)}]) — ISO complet tronqué, futur et résolus exclus`);

console.log('== 9) CONFLIT 2 ONGLETS : double crédit possible (démonstration) ==');
// Onglet A et B partent du même état s0 (ticket pending). Chaque onglet résout
// de son côté puis écrit localStorage (last-write-wins, aucun event 'storage').
const stA = applyResolutions(s0, [settled1]);   // onglet A crédite 296
const stB = applyResolutions(s0, [settled1]);   // onglet B (état périmé s0) crédite 296 aussi
ok(stA!.balance === 1296 && stB!.balance === 1296,
  `chaque onglet crédite indépendamment : A=${stA!.balance} B=${stB!.balance} — dernier écrivain gagne, crédit compté 2× dans l'absolu (1× vu de chaque appareil)`);
console.log('  → prouve l\'absence de synchronisation inter-onglets (aucun addEventListener("storage") dans src/)');

console.log('== 10) settleTicket sur ticket non-pending → intouchable ==');
ok(settleTicket(st2!.tickets[0], res).state === null && settleTicket(st2!.tickets[0], res).ticket === st2!.tickets[0], 'ticket déjà réglé : inchangé');

console.log(`\nRESULT: ${pass} pass / ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
