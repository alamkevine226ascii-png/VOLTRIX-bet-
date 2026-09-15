// ============================================================
// VOLTRIX bet — Tests du moteur combiné + cotes dérivées
// bun scripts/test-combo.ts
// ============================================================

import {
  PROFILES,
  buildCombo,
  fairOdds,
  legKey,
  listAlternatives,
  maxAchievableOdds,
  recomputeCombo,
  riskBadge,
  legFamily,
  type ComboLeg,
} from '../src/lib/combo';
import {
  bttsProb,
  calibrateTotals,
  dcFromMarket,
  deMargin1x2,
  deMarginOverUnder,
  oddsWithMargin,
  overProb,
  totalGoalsDist,
} from '../src/lib/market-odds';

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function leg(partial: Partial<ComboLeg> & { matchId: string; prob: number; odds: number }): ComboLeg {
  return {
    leagueShort: 'TST',
    leagueName: 'Test League',
    matchDate: '2026-09-04T18:00Z',
    homeName: `Home ${partial.matchId}`,
    awayName: `Away ${partial.matchId}`,
    market: '1X2',
    pick: 'Sélection test',
    oddsSource: 'estimate',
    confidence: 3,
    ...partial,
  };
}

// ============================================================
console.log('\n1) Dé-margage et cotes dérivées du marché');
// ============================================================

const dm = deMargin1x2(1.85, 3.6, 4.2);
check('deMargin1x2 accepte un 1X2 valide', dm !== null);
if (dm) {
  check('marge ≈ 5.7 %', Math.abs(dm.margin - 0.0564) < 0.003, dm.margin.toFixed(4));
  check('somme dé-margée = 1', Math.abs(dm.pH + dm.pD + dm.pA - 1) < 1e-9);
  check('proba home ≈ 51.2 %', Math.abs(dm.pH - 0.5116) < 0.002, dm.pH.toFixed(4));
}

const dc = dcFromMarket(1.85, 3.6, 4.2);
check('dcFromMarket produit 3 issues', dc !== null);
if (dc) {
  check('DC 1X ≈ 77.5 %', Math.abs(dc.prob1X - 0.775) < 0.003, dc.prob1X.toFixed(4));
  check('DC 1X cote ≈ 1.22', Math.abs(dc.odds1X - 1.22) < 0.02, dc.odds1X.toFixed(3));
  check('DC 12 ≈ somme dé-margée', Math.abs(dc.prob12 - (dm!.pH + dm!.pA)) < 1e-9);
  check('cotes DC ordonnées 12 < 1X < X2 (favori home)', dc.odds12 > dc.odds1X && dc.odds1X < dc.oddsX2);
}

const dmOu = deMarginOverUnder(1.95, 1.9);
check('deMarginOverUnder valide', dmOu !== null);
if (dmOu) {
  check('pOver + pUnder = 1', Math.abs(dmOu.pOver + dmOu.pUnder - 1) < 1e-9);
  check('marge O/U ≈ 3.9 %', Math.abs(dmOu.margin - 0.0391) < 0.003, dmOu.margin.toFixed(4));
}
check('deMarginOverUnder rejette des cotes invalides', deMarginOverUnder(1.0, 1.9) === null);
check('dcFromMarket rejette des cotes invalides', dcFromMarket(0, 3.6, 4.2) === null);

// ============================================================
console.log('\n2) Poisson et calibrage totals');
// ============================================================

const dist27 = totalGoalsDist(2.7);
check('P(over 2.5 | λ=2.7) ≈ 0.506', Math.abs(overProb(dist27, 2.5) - 0.506) < 0.01, overProb(dist27, 2.5).toFixed(3));
check('distribution normalisée', Math.abs(dist27.reduce((a, b) => a + b, 0) - 1) < 1e-6);
check('over 1.5 > over 2.5 > over 3.5', overProb(dist27, 1.5) > overProb(dist27, 2.5) && overProb(dist27, 2.5) > overProb(dist27, 3.5));
check('bttsProb croît avec les λ', bttsProb(1.8, 1.2) > bttsProb(0.6, 0.4));

const cal = calibrateTotals(1.5, 1.3, 2.5, 0.6, [1.5, 2.5, 3.5]);
check('calibrage ancre over 2.5 → 60 % marché', Math.abs(cal.over[2.5] - 0.6) < 0.01, cal.over[2.5].toFixed(3));
check('calibrage : over 1.5 > cible', cal.over[1.5] > 0.75, cal.over[1.5].toFixed(3));
check('calibrage : over 3.5 < cible', cal.over[3.5] < 0.4, cal.over[3.5].toFixed(3));

const cal45 = calibrateTotals(1.5, 1.3, 2.5, 0.45, [2.5]);
check('calibrage 45 % : scale < 1', cal45.scale < 1, cal45.scale.toFixed(3));
check('calibrage 45 % : ancre respectée', Math.abs(cal45.over[2.5] - 0.45) < 0.01);

const calAligned = calibrateTotals(1.35, 1.35, 2.5, overProb(totalGoalsDist(2.7), 2.5), [2.5]);
check('scale 1 si déjà aligné', Math.abs(calAligned.scale - 1) < 0.02, calAligned.scale.toFixed(4));
check('BTTS calibré cohérent (0 < btts < 1)', cal.btts > 0 && cal.btts < 1);

check('oddsWithMargin(0.5) ≈ 1.86', Math.abs(oddsWithMargin(0.5) - 1.86) < 0.01, oddsWithMargin(0.5).toFixed(3));

// ============================================================
console.log('\n3) Familles, badges, helpers');
// ============================================================

check('famille O/U → buts', legFamily('O/U 2.5') === 'buts');
check('famille BTTS → btts', legFamily('BTTS') === 'btts');
check('famille 1X2/DC → resultat', legFamily('1X2') === 'resultat' && legFamily('Double Chance') === 'resultat');
check('badge Sûr ≥ 66 %', riskBadge(0.7).label === 'Sûr' && riskBadge(0.7).tone === 'good');
check('badge Moyen 55-66 %', riskBadge(0.6).label === 'Moyen' && riskBadge(0.6).tone === 'mid');
check('badge Risqué < 55 %', riskBadge(0.45).label === 'Risqué' && riskBadge(0.45).tone === 'risky');
check('fairOdds(0.5) ≈ 1.86', Math.abs(fairOdds(0.5) - 1.86) < 0.01, fairOdds(0.5).toFixed(3));
check('fairOdds borne bas 1.04', fairOdds(0.01) === 1.04);
check('planchers des profils 58/50/40', PROFILES.prudent.minProb === 0.58 && PROFILES.equilibre.minProb === 0.5 && PROFILES.agressif.minProb === 0.4);

// ============================================================
console.log('\n4) Moteur combiné — anti-risque');
// ============================================================

// Piège historique : une « perle » à 30 % @ 4.0 doit être rejetée même si rentable
const trapPool: ComboLeg[] = [
  leg({ matchId: 'trap', prob: 0.3, odds: 4.0 }), // EV +20 % mais bien trop risqué
  leg({ matchId: 'a', prob: 0.7, odds: 1.45 }),
  leg({ matchId: 'b', prob: 0.65, odds: 1.55 }),
  leg({ matchId: 'c', prob: 0.6, odds: 1.7 }),
  leg({ matchId: 'd', prob: 0.55, odds: 1.85 }),
  leg({ matchId: 'e', prob: 0.52, odds: 2.1 }),
];
const trapResult = buildCombo(trapPool, 2.6, 5, 'equilibre');
check('le piège 30 % @ 4.0 est rejeté', trapResult !== null && !trapResult.legs.some((l) => l.matchId === 'trap'));
if (trapResult) {
  check('toutes les jambes respectent le plancher 50 %', trapResult.legs.every((l) => l.prob >= 0.5));
  check('toutes les jambes respectent la cote max 2.40', trapResult.legs.every((l) => l.odds <= 2.4));
  check('cote cible atteinte', trapResult.comboOdds >= 2.6, trapResult.comboOdds.toFixed(2));
  check('1 jambe max par match', new Set(trapResult.legs.map((l) => l.matchId)).size === trapResult.legs.length);
}

// Planchers par profil : une jambe à 45 % est refusée en prudent/équilibré, admise en agressif
const midPool: ComboLeg[] = [
  leg({ matchId: 'm1', prob: 0.45, odds: 2.1 }),
  leg({ matchId: 'm2', prob: 0.62, odds: 1.6 }),
  leg({ matchId: 'm3', prob: 0.58, odds: 1.7 }),
  leg({ matchId: 'm4', prob: 0.7, odds: 1.42 }),
];
check('45 % refusé en prudent', buildCombo(midPool, 1.5, 5, 'prudent') === null || !buildCombo(midPool, 1.5, 5, 'prudent')!.legs.some((l) => l.prob === 0.45));
check('45 % refusé en équilibré', buildCombo(midPool, 1.5, 5, 'equilibre') === null || !buildCombo(midPool, 1.5, 5, 'equilibre')!.legs.some((l) => l.prob === 0.45));
const agressifResult = buildCombo(midPool, 1.5, 5, 'agressif');
check('45 % accepté en agressif (si utile)', agressifResult !== null);

// Diversité : max ⌈limit/2⌉ jambes par famille même avec un vivier mono-famille énorme
const bigFamilyPool: ComboLeg[] = Array.from({ length: 12 }, (_, i) =>
  leg({ matchId: `f${i}`, prob: 0.6 + (i % 5) * 0.05, odds: 1.4 + (i % 4) * 0.1, market: '1X2', pick: `Victoire ${i}` })
);
const famResult = buildCombo(bigFamilyPool, 2.0, 4, 'equilibre');
if (famResult) {
  const famCount = famResult.legs.filter((l) => legFamily(l.market) === 'resultat').length;
  check('cap famille resultat (⌈4/2⌉ = 2)', famCount <= 2, `count=${famCount}`);
} else {
  check('cap famille resultat (⌈4/2⌉ = 2)', false, 'aucun résultat — la cible devrait être atteignable');
}

// Vivier multi-familles : caps respectées par famille
const multiPool: ComboLeg[] = [
  ...Array.from({ length: 6 }, (_, i) => leg({ matchId: `r${i}`, prob: 0.6, odds: 1.5 + i * 0.05, market: '1X2' })),
  ...Array.from({ length: 6 }, (_, i) => leg({ matchId: `u${i}`, prob: 0.6, odds: 1.5 + i * 0.05, market: 'O/U 2.5', pick: 'Plus de 2.5 buts' })),
  ...Array.from({ length: 4 }, (_, i) => leg({ matchId: `t${i}`, prob: 0.55, odds: 1.9 + i * 0.05, market: 'BTTS', pick: 'BTTS Oui' })),
];
const multiResult = buildCombo(multiPool, 3.0, 6, 'agressif');
if (multiResult) {
  const counts: Record<string, number> = {};
  for (const l of multiResult.legs) {
    const f = legFamily(l.market);
    counts[f] = (counts[f] ?? 0) + 1;
  }
  check('caps familles multi-marchés (cap 3)', Object.values(counts).every((c) => c <= 3), JSON.stringify(counts));
  check('multiResult atteint la cible', multiResult.comboOdds >= 3.0, multiResult.comboOdds.toFixed(2));
} else {
  check('caps familles multi-marchés (cap 3)', false, 'null inattendu');
}

// Prudent génère aussi, et équilibré atteint au moins la cible comme prudent
const safePool: ComboLeg[] = [
  leg({ matchId: 's1', prob: 0.72, odds: 1.4 }),
  leg({ matchId: 's2', prob: 0.68, odds: 1.48 }),
  leg({ matchId: 's3', prob: 0.66, odds: 1.52 }),
  leg({ matchId: 's4', prob: 0.62, odds: 1.6 }),
];
const prudentResult = buildCombo(safePool, 2.0, 5, 'prudent');
check('prudent génère un ticket à cible 2.0', prudentResult !== null && prudentResult.comboOdds >= 2.0);
if (prudentResult) {
  check('prudent : toutes jambes ≥ 58 %', prudentResult.legs.every((l) => l.prob >= 0.58));
}
const equiResult = buildCombo(safePool, 2.0, 5, 'equilibre');
check('équilibré atteint aussi la cible 2.0', equiResult !== null && equiResult.comboOdds >= 2.0);

// EV et Kelly cohérents (calculés sur les cotes EXACTES des jambes,
// le comboOdds exposé étant arrondi à 2 décimales pour l'affichage)
if (trapResult) {
  const exactOdds = trapResult.legs.reduce((a, l) => a * l.odds, 1);
  check('cote totale = produit des jambes', Math.abs(trapResult.comboOdds - exactOdds) < 0.01);
  const evExpected = trapResult.comboProb * exactOdds - 1;
  check('EV = prob × cote − 1', Math.abs(trapResult.comboEV - evExpected) < 1e-9);
  const kellyExpected = Math.max(0, Math.min(0.1, evExpected / (exactOdds - 1)));
  check('Kelly plafonnée cohérente', Math.abs(trapResult.kelly - kellyExpected) < 1e-9);
  check('confiance moyenne = moyenne des jambes', Math.abs(trapResult.confidenceAvg - trapResult.legs.reduce((a, l) => a + l.confidence, 0) / trapResult.legs.length) < 1e-9);
}

// maxAchievableOdds : borne supérieure sous contraintes
const maxOdds = maxAchievableOdds(trapPool, 5, 'equilibre');
check('maxAchievableOdds exclut la perle (30 % @ 4.0)', maxOdds < 20, maxOdds.toFixed(2));
check('maxAchievableOdds > cible du piège', maxOdds >= 2.6);

// ============================================================
console.log('\n5) Cas limites');
// ============================================================

check('cible < 1.2 → null', buildCombo(trapPool, 1.1, 5, 'equilibre') === null);
check('vivier vide → null', buildCombo([], 3, 5, 'equilibre') === null);
check('vivier sous le plancher → null', buildCombo([leg({ matchId: 'x', prob: 0.3, odds: 3.5 })], 3, 5, 'equilibre') === null);
const twoLegs = buildCombo(
  [leg({ matchId: 't1', prob: 0.7, odds: 1.6 }), leg({ matchId: 't2', prob: 0.65, odds: 1.7 })],
  2.7,
  5,
  'equilibre'
);
check('2 jambes suffisent (1.6 × 1.7 = 2.72 ≥ 2.7)', twoLegs !== null && twoLegs.legs.length === 2);
check('cible ×5000 irréaliste → null', buildCombo(trapPool, 5000, 8, 'agressif') === null);
check('maxAchievableOdds vivier vide → 1', maxAchievableOdds([], 5, 'equilibre') === 1);

// ============================================================
console.log('\n12) Édition manuelle : échange d\'une jambe (swap)');
// ============================================================

const swapPool: ComboLeg[] = [
  leg({ matchId: 'a1', prob: 0.72, odds: 1.42, market: 'Double Chance', pick: '1X', confidence: 4 }),
  leg({ matchId: 'a2', prob: 0.68, odds: 1.55, market: 'O/U 2.5', pick: 'Moins de 2.5', confidence: 4 }),
  leg({ matchId: 'a3', prob: 0.62, odds: 1.78, market: '1X2', pick: 'Victoire A3', confidence: 3 }),
  leg({ matchId: 'a4', prob: 0.55, odds: 2.1, market: 'BTTS', pick: 'Oui', confidence: 3 }),
  leg({ matchId: 'a5', prob: 0.75, odds: 1.38, market: 'Double Chance', pick: 'X2', confidence: 5 }),
  leg({ matchId: 'a6', prob: 0.45, odds: 3.1, market: '1X2', pick: 'Victoire A6', confidence: 2 }), // hors profil équilibré (< 50 %), valide en agressif (≥ 40 %)
];

const ticket = buildCombo(swapPool, 2.5, 5, 'equilibre', 7);
check('ticket de référence généré', ticket !== null && ticket.legs.length >= 2);
if (ticket) {
  const alts = listAlternatives(swapPool, ticket.legs, 0, 'equilibre');
  const ticketMatchIds = new Set(ticket.legs.map((l) => l.matchId));
  check('aucune alternative ne réutilise un match du ticket', alts.every((a) => !ticketMatchIds.has(a.matchId)));
  check('le match remplacé n\'est jamais re-proposé', alts.every((a) => a.matchId !== ticket.legs[0].matchId));
  check('alternatives valides pour le profil (prob ≥ 50 %, cote ≤ 2.40)', alts.every((a) => a.prob >= PROFILES.equilibre.minProb && a.odds <= PROFILES.equilibre.maxLegOdds));
  const eff = (l: ComboLeg) => Math.log(l.odds) / -Math.log(l.prob);
  check('tri par efficacité décroissante', alts.every((a, i) => i === 0 || eff(alts[i - 1]) >= eff(a) - 1e-9));
  // a6 (prob 0.35) est exclu du profil équilibré mais visible en agressif
  const altsAgressif = listAlternatives(swapPool, ticket.legs, 0, 'agressif');
  check('profil agressif élargit le vivier (a6 devient éligible)', altsAgressif.some((a) => a.matchId === 'a6'));

  // Swap 1 → 1 : mêmes métriques que le moteur sur les mêmes jambes
  const replacement = alts[0];
  const swapped = [...ticket.legs];
  swapped.splice(0, 1, replacement);
  const recomputed = recomputeCombo(swapped, 'equilibre', ticket.targetOdds, ticket.legsLimit);
  check('recomputeCombo non null après swap 1→1', recomputed !== null);
  if (recomputed) {
    const expectedOdds = swapped.reduce((a, l) => a * l.odds, 1);
    check('cote totale = produit des cotes des jambes échangées', Math.abs(recomputed.comboOdds - expectedOdds) < 0.005, `attendu ${expectedOdds.toFixed(3)}, obtenu ${recomputed.comboOdds}`);
    const expectedProb = swapped.reduce((a, l) => a * l.prob, 1);
    check('probabilité = produit des probas', Math.abs(recomputed.comboProb - expectedProb) < 1e-9);
    check('Kelly borné [0, 10 %]', recomputed.kelly >= 0 && recomputed.kelly <= 0.1);
    check('profile/legsLimit conservés', recomputed.profile === 'equilibre' && recomputed.legsLimit === ticket.legsLimit);
  }

  // Swap 1 → 2 : une jambe remplacée par deux
  const twoAlts = alts.slice(0, 2);
  const swapped2 = [...ticket.legs];
  swapped2.splice(0, 1, ...twoAlts);
  const recomputed2 = recomputeCombo(swapped2, 'equilibre', ticket.targetOdds, ticket.legsLimit);
  check('swap 1→2 : le ticket grandit d\'une jambe', recomputed2 !== null && recomputed2.legs.length === ticket.legs.length + 1);
  if (recomputed2) {
    const expectedOdds2 = swapped2.reduce((a, l) => a * l.odds, 1);
    check('cote recalculée après 1→2', Math.abs(recomputed2.comboOdds - expectedOdds2) < 0.005);
  }

  // Bornes
  check('recomputeCombo avec 1 seule jambe → null', recomputeCombo([ticket.legs[0]], 'equilibre', ticket.targetOdds, 5) === null);
  check('legKey unique par match/marché/pick', legKey(swapPool[0]) !== legKey(swapPool[1]));
}

// ============================================================

console.log(`\n${failed === 0 ? '🎉 TOUS LES TESTS PASSENT' : `💥 ${failed} ÉCHEC(S)`} — ${passed} réussis, ${failed} échoués`);
process.exit(failed === 0 ? 0 : 1);
