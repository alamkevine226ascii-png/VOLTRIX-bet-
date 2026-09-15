// ============================================================
// Task 19-a — Harnais de re-vérification des 5 findings d'audit
// Exécuter : bun scripts/test-audit-19a.ts
// Couvre :
//   ① avantage domicile Elo (sens du bonus terrain)
//   ② settlement des matchs 00h-04h UTC (feuille scoreboard J−1)
//   ③ UA/headers ESPN (403 Bun sans UA curl)
//   ⑤ sommation firstToScore (home + away + noGoal = 1)
// (finding ④ = biais λ marché : scripts/test-lambda-bias.ts +
//  scripts/test-lambda-bias-standalone.ts)
// ============================================================

import { eloToProbs, firstToScoreProbs, firstGoalTimingProbs, runEngine } from '../src/lib/prediction';
import { fetchScoreboard } from '../src/lib/espn';
import { legLiveProb } from '../src/lib/live-prob';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name} ${detail}`);
  }
}

console.log('— Finding ① : sens de l\u2019avantage domicile (Elo) —');
{
  const eq = eloToProbs(1500, 1500);
  check('Elo égal → P(domicile) > P(extérieur)', eq.home > eq.away, `got ${JSON.stringify(eq)}`);
  check('Elo égal → P(domicile) ≈ 46 % (référence foot)', eq.home > 0.4 && eq.home < 0.52, `home=${eq.home}`);
  // L\u2019avantage doit compenser une petite infériorité de rating (65 pts ≈ l\u2019avantage)
  const comp = eloToProbs(1500, 1565);
  check('Dom 1500 vs Ext 1565 (écart = avantage) → quasi 50/50', Math.abs(comp.home - comp.away) < 0.06, `got ${JSON.stringify(comp)}`);
  // Monotonie : un extérieur plus fort réduit la proba domicile
  const s1 = eloToProbs(1500, 1500);
  const s2 = eloToProbs(1500, 1600);
  check('Monotonie : P(dom) décroît quand l\u2019extérieur monte', s2.home < s1.home, `${s1.home} → ${s2.home}`);
  // Somme = 1
  const sum = eq.home + eq.draw + eq.away;
  check('eloToProbs somme à 1', Math.abs(sum - 1) < 1e-9, `sum=${sum}`);
}

console.log('— Finding ⑤ : sommation firstToScore + firstGoalTiming —');
{
  // Grille de λ couvrant les bornes réalistes du moteur (0.3..3.8 / 0.25..3.4)
  let worst = 0;
  for (let lh = 0.1; lh <= 4.0; lh += 0.3) {
    for (let la = 0.1; la <= 4.0; la += 0.3) {
      const f = firstToScoreProbs(lh, la);
      worst = Math.max(worst, Math.abs(f.home + f.away + f.noGoal - 1));
    }
  }
  check('firstToScore: |home+away+noGoal − 1| < 0.001 sur la grille λ', worst < 0.001, `worst=${worst}`);
  // Cas extrêmes
  const zero = firstToScoreProbs(0, 0);
  check('λ nuls → noGoal=1, somme=1', zero.noGoal === 1 && Math.abs(zero.home + zero.away + zero.noGoal - 1) < 1e-9, JSON.stringify(zero));
  const skew = firstToScoreProbs(3.8, 0.25);
  check('λ asymétriques → home ≫ away et somme=1', skew.home > 4 * skew.away && Math.abs(skew.home + skew.away + skew.noGoal - 1) < 0.001, JSON.stringify(skew));

  // firstGoalTiming somme aussi à 1 (normalisation)
  let worstT = 0;
  for (let lt = 0.5; lt <= 7; lt += 0.5) {
    const s = firstGoalTimingProbs(lt).reduce((acc, o) => acc + o.prob, 0);
    worstT = Math.max(worstT, Math.abs(s - 1));
  }
  check('firstGoalTiming: somme = 1 sur la grille λ', worstT < 0.001, `worst=${worstT}`);
}

console.log('— Finding ⑤ bis : invariant via runEngine (input synthétique) —');
{
  const mkInput = (lambdaHint: number) => ({
    homeTeam: { id: 'H1', name: 'Dom FC', logo: null, schedule: [], standings: null },
    awayTeam: { id: 'A1', name: 'Ext FC', logo: null, schedule: [], standings: null },
    injuries: [],
    odds: null,
    isDerby: false,
    weatherImpact: null,
    nowMs: Date.now(),
    leagueTeamsCount: 20,
    void: lambdaHint, // (pas d\u2019effet : équipes sans historique → λ de référence ligue)
  });
  const analysis = runEngine(mkInput(0));
  const f = analysis.prediction.firstToScore;
  check('runEngine: firstToScore somme à 1 (±0.001)', Math.abs(f.home + f.away + f.noGoal - 1) < 0.001, JSON.stringify(f));
  const l = analysis.prediction.lambda;
  check('runEngine: λ réalistes sans données (total 2.3-3.2)', l.total >= 2.3 && l.total <= 3.2, JSON.stringify(l));
}

console.log('— Finding ③ : UA ESPN — vérification runtime —');
{
  // Le runtime courant est Bun : sans UA explicite, ESPN répond 403.
  // On vérifie le PAIRE de comportements sur une URL scoreboard.
  const url = 'https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard?dates=20260911';
  const noUa = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store' });
  await noUa.text();
  const withUa = await fetch(url, { headers: { 'User-Agent': 'curl/8.5.0', Accept: 'application/json' }, cache: 'no-store' });
  await withUa.text();
  const isBun = typeof Bun !== 'undefined';
  if (isBun) {
    check('Bun sans UA curl → 403 (reproduit le bug prod)', noUa.status === 403, `got ${noUa.status}`);
    check('Bun avec UA curl/8.5.0 → 200', withUa.status === 200, `got ${withUa.status}`);
  } else {
    check('Runtime non-Bun : UA curl accepté par ESPN', withUa.status === 200, `got ${withUa.status}`);
  }
}

console.log('— Finding ② : matchs 00h-04h UTC sur la feuille J−1 —');
{
  // Preuve ESPN : le match MLS 761796 (2026-09-10T02:30Z) est sur la feuille
  // dates=20260909 (EDT) et ABSENT de la feuille dates=20260910 (UTC).
  const sheetUtcDay = await fetchScoreboard('usa.1', '2026-09-10');
  const sheetPrev = await fetchScoreboard('usa.1', '2026-09-09');
  const onUtcSheet = sheetUtcDay?.events.some((e) => e.id === '761796') ?? false;
  const onPrevSheet = sheetPrev?.events.some((e) => e.id === '761796') ?? false;
  check('Preuve ESPN : 02:30Z absent de la feuille de sa date UTC', !onUtcSheet, onUtcSheet ? 'présent !' : '');
  check('Preuve ESPN : 02:30Z présent sur la feuille J−1', onPrevSheet, 'absent !');

  // Comportement APRÈS correctif : la logique resolve (feuille J puis J−1)
  // retrouve l\u2019événement — on rejoue la séquence exacte de la route.
  const dateISO = '2026-09-10';
  let board = await fetchScoreboard('usa.1', dateISO);
  let byId = new Map((board?.events ?? []).map((e) => [e.id, e]));
  if (!byId.has('761796')) {
    const prevDate = new Date(Date.parse(`${dateISO}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    const prevBoard = await fetchScoreboard('usa.1', prevDate);
    for (const ev of prevBoard?.events ?? []) if (!byId.has(ev.id)) byId.set(ev.id, ev);
  }
  const found = byId.get('761796');
  check('Lookup resolve (J puis J−1) retrouve le match nocturne', !!found, 'introuvable');
  if (found) {
    check('L\u2019événement retrouvé porte la bonne date ESPN', found.date === '2026-09-10T02:30Z', got2(found.date));
    // gradeEvent sur cet événement : structure complète → pas de crash, verdict cohérent
    const leg = { matchId: '761796', market: 'O/U 2.5', pick: 'Plus de 2.5' };
    const { gradeEvent } = await import('../src/lib/grade');
    const v = gradeEvent(leg, found);
    check('gradeEvent retourne un statut valide sur le match nocturne', ['WIN', 'LOSE', 'PENDING', 'VOID'].includes(v.status), v.status);
  }
}
function got2(d: string | undefined) {
  return `got ${d}`;
}

console.log('— Bonus cashout : jambe « Match nul » recalculée en direct —');
{
  const leg = { market: '1X2', pick: 'Match nul', prob: 0.27 };
  const state = { phase: 'in' as const, homeScore: 1, awayScore: 1, clock: "80'", kickoffIso: null };
  const oldBehavior = legLiveProb(leg, state, undefined); // ancien mapping draw→undefined
  const newBehavior = legLiveProb(leg, state, 'draw'); // mapping corrigé
  check('ANCIEN mapping (undefined) : proba figée = initiale', Math.abs(oldBehavior - 0.27) < 1e-9, `got ${oldBehavior}`);
  check('NOUVEAU mapping (draw) : proba live > initiale à 1-1 80\u2019', newBehavior > 0.35, `got ${newBehavior}`);
}

console.log(`\n=== ${pass} OK / ${fail} KO ===`);
if (fail > 0) process.exit(1);
