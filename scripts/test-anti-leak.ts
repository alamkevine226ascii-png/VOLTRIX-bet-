#!/usr/bin/env bun
// ============================================================
// VOLTRIX bet — Task 22-c : TESTS ANTI-FUITE (plan étape 13)
// ============================================================
// Chaque test DOIT échouer si une fuite d'information future existe :
//   1. Filtre as-of : matchs futurs injectés → exclus du calcul.
//   2. Classement synthétisé : résultats futurs → exclus.
//   3. INVARIANCE AU FUTUR (la plus forte) : pipeline complet exécuté 2×
//      sur le même match — la 2e fois avec un historique POISONNÉ par des
//      matchs futurs absurdes (victoires 50-0 après T_pred) — sorties du
//      modèle BIT-IDENTIQUES (tolérance 1e-12).
//   4. Cotes : des close odds falsifiées ne changent AUCUNE sortie
//      raw/mix ; la baseline MARCHÉ-À-T n'utilise jamais la clôture.
//   5. Horizons : T_pred = kickoff − 12h ne voit jamais un match joué
//      entre T_pred et le coup d'envoi.
//
// AUCUN appel réseau : fonctions pures de backtest-lib + moteur (runEngine).
// Validation : `bun scripts/test-anti-leak.ts` → exit 0.
// ============================================================

import {
  evaluateMatchV3,
  filterAsOfGames,
  market1x2Side,
  marketOu25Side,
  pickcenterToOdds,
  pickcenterToOpenOnlyOdds,
  synthStandings,
  type EvalVariants,
  type RawPickcenter,
} from './backtest-lib';
import type { EspnOdds, EspnScheduleGame } from '../src/lib/espn';

// ---------- Infrastructure de test ----------

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(label: string, ok: boolean, detail = ''): void {
  if (ok) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    failures.push(label + (detail ? ` — ${detail}` : ''));
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function deepNumDiff(a: unknown, b: unknown, path = '$'): string[] {
  if (typeof a === 'number' && typeof b === 'number') {
    if (Number.isNaN(a) && Number.isNaN(b)) return [];
    return Math.abs(a - b) <= 1e-12 ? [] : [`${path}: ${a} ≠ ${b} (|Δ|>${1e-12})`];
  }
  if (a === null || b === null || a === undefined || b === undefined) {
    return a === b ? [] : [`${path}: ${String(a)} ≠ ${String(b)}`];
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a as Record<string, unknown>);
    const kb = Object.keys(b as Record<string, unknown>);
    if (ka.length !== kb.length) return [`${path}: clés ${ka.length} ≠ ${kb.length}`];
    const out: string[] = [];
    for (const k of ka) out.push(...deepNumDiff((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`));
    return out;
  }
  return a === b ? [] : [`${path}: ${String(a)} ≠ ${String(b)}`];
}

function snapshot(ev: EvalVariants): Record<string, unknown> {
  return { oneXtwo: ev.oneXtwo, ou25: ev.ou25, btts: ev.btts, lambdas: ev.lambdas };
}

// ---------- Jeu de données synthétique (AUCUN réseau) ----------

const KICKOFF = '2026-08-20T18:00:00Z';
const KICKOFF_MS = Date.parse(KICKOFF);
const H12 = 12;
const T_PRED12 = KICKOFF_MS - H12 * 3_600_000;

function g(eventId: string, dateISO: string, homeAway: 'home' | 'away', oppId: string, ts: number | null, os: number | null, completed = true): EspnScheduleGame {
  return { eventId, date: dateISO, opponentId: oppId, opponentName: `Opp ${oppId}`, homeAway, teamScore: ts, opponentScore: os, completed, leagueCode: 'eng.1' };
}

/** Historique « propre » : 8 matchs terminés AVANT T_pred (12 h). */
function cleanHistory(prefix: string): EspnScheduleGame[] {
  return [
    g(`${prefix}-1`, '2026-07-25T14:00:00Z', 'home', '9001', 2, 1),
    g(`${prefix}-2`, '2026-07-29T14:00:00Z', 'away', '9002', 1, 1),
    g(`${prefix}-3`, '2026-08-02T14:00:00Z', 'home', '9003', 3, 0),
    g(`${prefix}-4`, '2026-08-06T14:00:00Z', 'away', '9004', 0, 2),
    g(`${prefix}-5`, '2026-08-09T14:00:00Z', 'home', '9005', 1, 1),
    g(`${prefix}-6`, '2026-08-12T14:00:00Z', 'away', '9006', 2, 0),
    g(`${prefix}-7`, '2026-08-15T14:00:00Z', 'home', '9007', 1, 0),
    g(`${prefix}-8`, '2026-08-17T19:45:00Z', 'away', '9008', 1, 2),
  ];
}

/** Poison : victoires 50-0 APRÈS T_pred (entre T_pred et kickoff, et après kickoff). */
function poisonFutureGames(prefix: string): EspnScheduleGame[] {
  return [
    g(`${prefix}-P1`, new Date(KICKOFF_MS - 6 * 3_600_000).toISOString(), 'home', '9101', 50, 0), // entre T_pred(12h) et kickoff
    g(`${prefix}-P2`, new Date(KICKOFF_MS - 2 * 3_600_000).toISOString(), 'away', '9102', 50, 0), // entre T_pred(3h) et kickoff
    g(`${prefix}-P3`, new Date(KICKOFF_MS + 48 * 3_600_000).toISOString(), 'home', '9103', 50, 0), // après le match
  ];
}

const MATCH = {
  id: 'evt-anti-leak-1',
  league: 'eng.1',
  kickoff: KICKOFF,
  homeId: 'H1',
  homeName: 'Alpha FC',
  homeLogo: null,
  awayId: 'A1',
  awayName: 'Beta FC',
  awayLogo: null,
};

/** Cotes complètes open + close DISTINCTES (close = référence, jamais input). */
const ODDS_FULL: EspnOdds = {
  provider: 'TestBook',
  overUnderLine: 2.5,
  moneyline: {
    home: { open: 2.1, close: 1.95 },
    draw: { open: 3.4, close: 3.5 },
    away: { open: 3.6, close: 3.9 },
  },
  total: {
    over: { line: 2.5, openOdds: 1.9, closeOdds: 1.85 },
    under: { line: 2.5, openOdds: 1.95, closeOdds: 2.0 },
  },
  hasOdds: true,
};

/** Input modèle : OPEN ONLY (champs close nullés — sémantique cotes-à-T). */
const ODDS_OPEN: EspnOdds = {
  provider: 'TestBook',
  overUnderLine: 2.5,
  moneyline: {
    home: { open: 2.1, close: null },
    draw: { open: 3.4, close: null },
    away: { open: 3.6, close: null },
  },
  total: {
    over: { line: 2.5, openOdds: 1.9, closeOdds: null },
    under: { line: 2.5, openOdds: 1.95, closeOdds: null },
  },
  hasOdds: true,
};

/** Close odds FALSIFIÉES (absurdes, open INCHANGÉ) pour prouver qu'elles n'entrent jamais. */
const ODDS_CLOSE_POISON: EspnOdds = {
  ...ODDS_FULL,
  moneyline: { home: { open: 2.1, close: 1.02 }, draw: { open: 3.4, close: 40 }, away: { open: 3.6, close: 50 } },
  total: { over: { line: 2.5, openOdds: 1.9, closeOdds: 1.02 }, under: { line: 2.5, openOdds: 1.95, closeOdds: 30 } },
};

/** Clôture DÉPLACÉE (ligne 9.5, cotes close absurdes) — open strictement intact. */
const ODDS_CLOSE_LINE_MOVED: EspnOdds = {
  ...ODDS_FULL,
  overUnderLine: 9.5,
  moneyline: { home: { open: 2.1, close: 1.02 }, draw: { open: 3.4, close: 40 }, away: { open: 3.6, close: 50 } },
  total: { over: { line: 9.5, openOdds: 1.9, closeOdds: 1.02 }, under: { line: 9.5, openOdds: 1.95, closeOdds: 30 } },
};

const LEAGUE_PARAMS = { home: 1.55, away: 1.25 };

function runPipeline(homeGames: EspnScheduleGame[], awayGames: EspnScheduleGame[], closeRef: EspnOdds | null, horizonH: number): EvalVariants {
  return evaluateMatchV3(MATCH, ODDS_OPEN, closeRef, homeGames, awayGames, LEAGUE_PARAMS, horizonH);
}

// ═════════ TEST 1 — Filtre as-of (unitaire) ═════════

console.log('\n── TEST 1 · Filtre as-of : les matchs futurs injectés sont exclus ──');
{
  const clean = cleanHistory('h');
  const poisoned = [...clean, ...poisonFutureGames('h')];
  const filtered = filterAsOfGames(poisoned, T_PRED12);
  check('1.1 strict < T_pred : 3 matchs futurs exclus (8 restants)', filtered.length === 8, `n=${filtered.length}`);
  check('1.2 aucun eventId P* dans le filtré', filtered.every((x) => !x.eventId.includes('-P')));
  check('1.3 tri chronologique conservé', filtered.every((x, i) => i === 0 || Date.parse(filtered[i - 1].date) <= Date.parse(x.date)));
  const atTpred = filterAsOfGames([...clean, g('x-at', new Date(T_PRED12).toISOString(), 'home', '9200', 1, 0)], T_PRED12);
  check('1.4 borne STRICTE : match joué EXACTEMENT à T_pred exclu', atTpred.length === 8, `n=${atTpred.length}`);
  check('1.5 matchs incomplets (score null) exclus même passés', filterAsOfGames([...clean, g('x-nc', '2026-08-01T14:00:00Z', 'home', '9300', null, null, false)], T_PRED12).length === 8);
}

// ═════════ TEST 2 — Classement synthétisé (résultats futurs exclus) ═════════

console.log('\n── TEST 2 · Classement synthétisé : insensible aux résultats futurs ──');
{
  const clean = cleanHistory('h');
  const opp = cleanHistory('a');
  const poisoned = [...clean, ...poisonFutureGames('h')];
  // Le pipeline compose TOUJOURS filterAsOfGames → synthStandings (backtest.ts) :
  // le contrat anti-fuite porte sur cette composition.
  const a = synthStandings(MATCH.homeId, filterAsOfGames(clean, T_PRED12), MATCH.awayId, filterAsOfGames(opp, T_PRED12));
  const b = synthStandings(MATCH.homeId, filterAsOfGames(poisoned, T_PRED12), MATCH.awayId, filterAsOfGames(opp, T_PRED12));
  check('2.1 table identique avec historique poisonné puis filtré (entries)', deepNumDiff(a.entries, b.entries).length === 0, deepNumDiff(a.entries, b.entries).slice(0, 3).join(' | '));
  check('2.2 bilan du domicile identique (points/buts)', a.home!.points === b.home!.points && a.home!.pointsFor === b.home!.pointsFor && a.home!.pointsAgainst === b.home!.pointsAgainst);
  check('2.3 teamsCount identique', a.teamsCount === b.teamsCount);
  const futureOnly = synthStandings(MATCH.homeId, filterAsOfGames(poisonFutureGames('z'), T_PRED12), MATCH.awayId, []);
  check('2.4 SEULEMENT des résultats futurs → filtré vide → table vide (0 ligne)', futureOnly.entries.length === 0, `n=${futureOnly.entries.length}`);
}

// ═════════ TEST 3 — INVARIANCE AU FUTUR (pipeline complet, 2 exécutions) ═════════

console.log('\n── TEST 3 · Invariance au futur : historique poisonné → sorties BIT-IDENTIQUES ──');
{
  const cleanHome = cleanHistory('h');
  const cleanAway = cleanHistory('a');
  const snapBefore = JSON.stringify([cleanHome, cleanAway]); // garde anti-mutation
  const evClean = runPipeline(cleanHome, cleanAway, ODDS_FULL, H12);
  check('3.0 le pipeline ne MUTE PAS ses entrées', JSON.stringify([cleanHome, cleanAway]) === snapBefore);

  const evPoisoned = runPipeline([...cleanHome, ...poisonFutureGames('h')], [...cleanAway, ...poisonFutureGames('a')], ODDS_FULL, H12);
  const diff = deepNumDiff(snapshot(evClean), snapshot(evPoisoned));
  check('3.1 toutes les sorties variantes 1X2/O-U/BTTS + λ identiques (≤1e-12)', diff.length === 0, diff.slice(0, 3).join(' | '));
  check('3.2 digest des entrées gelées identique', evClean.digest === evPoisoned.digest, `${evClean.digest} vs ${evPoisoned.digest}`);
  check('3.3 n historique identique (8/8, poison invisible)', evClean.hist.home.n === evPoisoned.hist.home.n && evClean.hist.away.n === evPoisoned.hist.away.n);

  // Deuxième poison : une LIGUE entière de faux résultats futurs pour les deux équipes
  const extra: EspnScheduleGame[] = [];
  for (let i = 0; i < 5; i++) {
    extra.push(g(`h-X${i}`, new Date(KICKOFF_MS + (i + 1) * 86_400_000).toISOString(), i % 2 ? 'away' : 'home', `940${i}`, 50, 0));
    extra.push(g(`a-X${i}`, new Date(KICKOFF_MS + (i + 1) * 86_400_000).toISOString(), i % 2 ? 'home' : 'away', `950${i}`, 0, 50));
  }
  const evPoisoned2 = runPipeline([...cleanHome, ...extra], [...cleanAway, ...extra.map((x) => ({ ...x, eventId: x.eventId + '-b' }))], ODDS_FULL, H12);
  const diff2 = deepNumDiff(snapshot(evClean), snapshot(evPoisoned2));
  check('3.4 poison massif post-kickoff (10 matchs 50-0) → sorties identiques', diff2.length === 0, diff2.slice(0, 3).join(' | '));
}

// ═════════ TEST 4 — Cotes : close falsifiées → AUCUN changement raw/mix ═════════

console.log('\n── TEST 4 · Cotes : la clôture n\'entre JAMAIS dans le modèle ──');
{
  const cleanHome = cleanHistory('h');
  const cleanAway = cleanHistory('a');
  const evClean = runPipeline(cleanHome, cleanAway, ODDS_FULL, H12);
  const evPoisonClose = runPipeline(cleanHome, cleanAway, ODDS_CLOSE_POISON, H12);
  // Seule la référence MARCHÉ-CLÔTURE peut bouger avec des close falsifiées :
  const keep = (ev: EvalVariants): Record<string, unknown> => ({
    oneXtwo: { ...ev.oneXtwo, marketClose: undefined },
    ou25: { ...ev.ou25, marketClose: undefined },
    btts: ev.btts,
    lambdas: ev.lambdas,
  });
  const diff = deepNumDiff(keep(evClean), keep(evPoisonClose));
  check('4.1 close odds absurdes → sorties raw/mix/full/POISSON/ELO bit-identiques', diff.length === 0, diff.slice(0, 3).join(' | '));
  check('4.2 digest identique (les close ne font pas partie des entrées gelées)', evClean.digest === evPoisonClose.digest);
  const mCloseClean = market1x2Side(ODDS_FULL, 'close');
  const mClosePoison = market1x2Side(ODDS_CLOSE_POISON, 'close');
  check('4.3 la référence MARCHÉ-CLÔTURE voit bien les close falsifiées (elle est étiquetée)', !!mCloseClean && !!mClosePoison && Math.abs(mCloseClean.home - mClosePoison.home) > 0.1);
  const mOpenClean = market1x2Side(ODDS_FULL, 'open');
  const mOpenPoison = market1x2Side(ODDS_CLOSE_POISON, 'open');
  check('4.4 MARCHÉ-À-T lit l\'open : insensible aux close falsifiées', !!mOpenClean && !!mOpenPoison && mOpenClean.home === mOpenPoison.home && mOpenClean.away === mOpenPoison.away);
  const ouOpenClean = marketOu25Side(ODDS_FULL, 'open');
  const ouOpenPoison = marketOu25Side(ODDS_CLOSE_POISON, 'open');
  check('4.5 MARCHÉ-À-T O/U 2.5 : insensible aux close falsifiées (cotes ET référence)', ouOpenClean !== null && ouOpenClean === ouOpenPoison);
  const ouCloseMoved = marketOu25Side(ODDS_CLOSE_LINE_MOVED, 'close');
  check('4.6 MARCHÉ-CLÔTURE O/U : ligne close 9.5 ≠ 2.5 → exclu (pas de substitution open)', ouCloseMoved === null);

  // 4.7 (réel builder) : pickcenter avec close DÉPLACÉE (ligne 9.5, cotes absurdes)
  // et open intact → l'open-only construit par le harnais reste strictement intact.
  const pcClean: RawPickcenter = {
    provider: { name: 'TestBook' },
    overUnder: 2.5,
    moneyline: { home: { open: { odds: '+110' }, close: { odds: '-105' } }, draw: { open: { odds: '+240' }, close: { odds: '+250' } }, away: { open: { odds: '+260' }, close: { odds: '+270' } } },
    total: { over: { open: { line: '2.5', odds: '-110' }, close: { line: '2.5', odds: '-115' } }, under: { open: { line: '2.5', odds: '-105' }, close: { line: '2.5', odds: '-102' } } },
  };
  const pcMoved: RawPickcenter = {
    ...pcClean,
    moneyline: { home: { open: { odds: '+110' }, close: { odds: '-5000' } }, draw: { open: { odds: '+240' }, close: { odds: '+3900' } }, away: { open: { odds: '+260' }, close: { odds: '+4900' } } },
    total: { over: { open: { line: '2.5', odds: '-110' }, close: { line: '9.5', odds: '-5000' } }, under: { open: { line: '2.5', odds: '-105' }, close: { line: '9.5', odds: '+2900' } } },
  };
  const openCleanB = pickcenterToOpenOnlyOdds(pcClean);
  const openMovedB = pickcenterToOpenOnlyOdds(pcMoved);
  check('4.7 pickcenter close déplacée → open-only construit bit-identique (ligne 2.5 + cotes open)',
    !!openCleanB && !!openMovedB && JSON.stringify(openCleanB) === JSON.stringify(openMovedB));
  const fullMoved = pickcenterToOdds(pcMoved);
  check('4.8 la vue FULL conserve la close déplacée (référence étiquetée, pas perdue)',
    !!fullMoved && fullMoved.overUnderLine === 2.5 && fullMoved.total.over.closeOdds !== null && fullMoved.total.over.closeOdds! < 1.05);
}

// ═════════ TEST 5 — Horizons : T_pred ne voit pas (T_pred, kickoff] ═════════

console.log('\n── TEST 5 · Horizons : un match joué entre T_pred et kickoff est invisible ──');
{
  const cleanHome = cleanHistory('h');
  const cleanAway = cleanHistory('a');
  // Matchs JOUÉS entre T_pred(12h) et kickoff : kickoff−6h et kickoff−2h (50-0)
  const interHorizon = poisonFutureGames('h');
  const evH12Clean = runPipeline(cleanHome, cleanAway, ODDS_FULL, H12);
  const evH12Leak = runPipeline([...cleanHome, ...interHorizon], cleanAway, ODDS_FULL, H12);
  const diffH12 = deepNumDiff(snapshot(evH12Clean), snapshot(evH12Leak));
  check('5.1 T_pred=kickoff−12h : matchs à kickoff−6h et kickoff−2h invisibles (sorties identiques)', diffH12.length === 0, diffH12.slice(0, 2).join(' | '));

  const evH3Clean = runPipeline(cleanHome, cleanAway, ODDS_FULL, 3);
  // Fenêtre h=3 : le match à kickoff−6h est AVANT T_pred(3h) → légitimement visible ;
  // celui à kickoff−2h est APRÈS T_pred(3h) → doit rester invisible.
  const evH3Leak = runPipeline([...cleanHome, interHorizon[0]], cleanAway, ODDS_FULL, 3);
  const evH3LeakPlus = runPipeline([...cleanHome, interHorizon[0], interHorizon[1]], cleanAway, ODDS_FULL, 3);
  const diffH3 = deepNumDiff(snapshot(evH3Leak), snapshot(evH3LeakPlus));
  check('5.2 T_pred=kickoff−3h : le match à kickoff−2h reste invisible (kickoff−6h inclus)', diffH3.length === 0, diffH3.slice(0, 2).join(' | '));

  // Cohérence sémantique : entre h=12 et h=3 la fenêtre s'élargit (match
  // kickoff−6h) → les probas PEUVENT différer (l'info as-of n'est pas figée).
  const diffH3vsH12 = deepNumDiff(snapshot(evH3Leak), snapshot(evH12Leak));
  const interGame = filterAsOfGames([...cleanHome, ...interHorizon], KICKOFF_MS - 3 * 3_600_000);
  check('5.3 à T_pred(3h) le match kickoff−6h est bien inclus (n=9)', interGame.length === 9, `n=${interGame.length}`);
  check('5.4 horizons différents → fenêtres différentes (les probas intègrent l\'info devenue disponible entre T−12h et T−3h)', diffH3vsH12.length > 0);

  const f12 = filterAsOfGames([...cleanHome, ...interHorizon], T_PRED12);
  check('5.5 filtre h=12 : aucun match de la fenêtre (T_pred, kickoff]', f12.every((x) => Date.parse(x.date) < T_PRED12));
  check('5.6 tPred cohérent (kickoff − 12h exact)', evH12Clean.tPredMs === T_PRED12);
}

// ---------- Verdict ----------

console.log(`\n════════ RÉSULTAT : ${pass}/${pass + fail} checks PASS${fail ? ` — ${fail} ÉCHEC(S)` : ''} ════════`);
if (fail) {
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
process.exit(0);
