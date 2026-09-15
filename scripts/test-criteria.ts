// Test des critères Combinator — bun scripts/test-criteria.ts
import {
  DEFAULT_CRITERIA,
  activeCriteriaCount,
  criteriaSummary,
  filterCandidates,
  hasAnyMarket,
} from '../src/lib/combo-criteria';
import type { ComboLeg } from '../src/lib/combo';

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

function leg(partial: Partial<ComboLeg>): ComboLeg {
  return {
    matchId: 'm1',
    leagueCode: 'eng.1',
    leagueShort: 'Prem',
    leagueName: 'Premier League',
    matchDate: '2026-09-10',
    homeName: 'A',
    awayName: 'B',
    market: '1X2',
    pick: 'Victoire A',
    prob: 0.6,
    odds: 1.8,
    oddsSource: 'real',
    confidence: 3,
    ...partial,
  };
}

const pool: ComboLeg[] = [
  leg({ matchId: 'm1', market: '1X2', pick: 'Victoire A', oddsSource: 'real', confidence: 4 }),
  leg({ matchId: 'm1', market: 'O/U 2.5', pick: 'Plus de 2.5 buts', oddsSource: 'estimate', confidence: 2 }),
  leg({ matchId: 'm2', market: 'BTTS', pick: 'Les 2 équipes marquent : Oui', oddsSource: 'estimate', confidence: 3 }),
  leg({ matchId: 'm3', market: 'Double Chance', pick: 'A ou Nul (1X)', oddsSource: 'market', confidence: 2, leagueCode: 'fra.1' }),
  leg({ matchId: 'm4', market: '1X2', pick: 'Victoire C', oddsSource: 'real', confidence: 5, leagueCode: 'fra.1' }),
];

console.log('— Défauts v2 (cotes réelles uniquement ON) —');
check('version 2', DEFAULT_CRITERIA.version === 2);
check('défauts : realOddsOnly = true', DEFAULT_CRITERIA.realOddsOnly === true);
check('défauts : estimées exclues (3 jambes)', filterCandidates(pool, DEFAULT_CRITERIA).length === 3 && filterCandidates(pool, DEFAULT_CRITERIA).every((l) => l.oddsSource !== 'estimate'), `got ${filterCandidates(pool, DEFAULT_CRITERIA).length}`);
check('défauts : 0 critère actif (défaut sûr non compté)', activeCriteriaCount(DEFAULT_CRITERIA) === 0);
check('défauts : résumé vide', criteriaSummary(DEFAULT_CRITERIA).length === 0);
check('hasAnyMarket(défauts) = true', hasAnyMarket(DEFAULT_CRITERIA));

console.log('— Ré-inclusion des estimées (écart au défaut) —');
{
  const c = { ...DEFAULT_CRITERIA, realOddsOnly: false };
  check('estimées ré-incluses → 5 jambes', filterCandidates(pool, c).length === 5, `got ${filterCandidates(pool, c).length}`);
  check('1 critère actif (estimées incluses)', activeCriteriaCount(c) === 1);
  check('résumé avertit cote non garantie', criteriaSummary(c).some((s) => s.includes('non garantie')));
}

console.log('— Filtres marchés —');
{
  const c = { ...DEFAULT_CRITERIA, markets: { result: true, doubleChance: false, totals: false, btts: false } };
  const out = filterCandidates(pool, c);
  check('1X2 seul → 2 jambes', out.length === 2 && out.every((l) => l.market === '1X2'), `got ${out.length}`);
}
{
  const c = { ...DEFAULT_CRITERIA, markets: { result: false, doubleChance: false, totals: false, btts: false } };
  check('aucun marché → vivier vide', filterCandidates(pool, c).length === 0);
  check('aucun marché → hasAnyMarket false', !hasAnyMarket(c));
}

console.log('— Confiance —');
{
  const c = { ...DEFAULT_CRITERIA, minConfidence: 4 };
  const out = filterCandidates(pool, c);
  check('confiance 4★+ → 2 jambes (m1 conf4 + m4 conf5, réelles toutes deux)', out.length === 2, `got ${out.length}`);
}

console.log('— Cotes réelles uniquement (opt-out) —');
{
  const c = { ...DEFAULT_CRITERIA, realOddsOnly: false };
  const out = filterCandidates(pool, c);
  check('opt-out estimées → 5 jambes', out.length === 5, `got ${out.length}`);
}

console.log('— Ligues exclues —');
{
  const c = { ...DEFAULT_CRITERIA, excludedLeagues: ['fra.1'] };
  const out = filterCandidates(pool, c);
  check('fra.1 exclue (défauts) → 1 jambe (m1 1X2 ; les estimées restent exclues)', out.length === 1 && out[0].matchId === 'm1', `got ${out.length}`);
  check('1 critère actif', activeCriteriaCount(c) === 1);
  check('résumé mentionne 1 ligue exclue', criteriaSummary(c).some((s) => s.includes('1 ligue exclue')));
}

console.log('— Cumul —');
{
  const c = { ...DEFAULT_CRITERIA, realOddsOnly: false, minConfidence: 3, excludedLeagues: ['fra.1'] };
  const out = filterCandidates(pool, c);
  check('cumul (estimées ré-incluses + conf 3★ + fra.1 exclue) → 2 jambes', out.length === 2, `got ${out.length}`);
  check('cumul : jambes eng.1 uniquement', out.every((l) => l.leagueCode !== 'fra.1' && l.confidence >= 3));
  check('3 critères actifs', activeCriteriaCount(c) === 3);
}

console.log('— Migration localStorage v1 → v2 —');
{
  // localStorage absent dans bun : simulation directe de la logique de
  // migration via un stub globalThis.localStorage.
  const store = new Map<string, string>();
  (globalThis as { localStorage?: Storage }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    get length() {
      return store.size;
    },
  } as unknown as Storage;
  const mod = await import('../src/lib/combo-criteria');
  // v1 stockée (ancien défaut realOddsOnly false) → forcée à true
  store.set('voltrix_combo_criteria_v1', JSON.stringify({ version: 1, minConfidence: 2, realOddsOnly: false, excludedLeagues: ['fra.1'] }));
  const m1 = mod.loadCriteria();
  check('v1 → migration force realOddsOnly true', m1.realOddsOnly === true, `got ${m1.realOddsOnly}`);
  check('v1 → autres champs conservés', m1.minConfidence === 2 && m1.excludedLeagues.length === 1);
  check('v1 → version migrée 2', m1.version === 2);
  // v2 stockée (choix explicite) → respectée
  store.set('voltrix_combo_criteria_v1', JSON.stringify({ version: 2, minConfidence: 1, realOddsOnly: false, excludedLeagues: [] }));
  const m2 = mod.loadCriteria();
  check('v2 → choix explicite respecté', m2.realOddsOnly === false, `got ${m2.realOddsOnly}`);
  // corrompu → défauts sûrs
  store.set('voltrix_combo_criteria_v1', '{oops');
  const m3 = mod.loadCriteria();
  check('corrompu → défauts sûrs (realOddsOnly true)', m3.realOddsOnly === true);
}

console.log(`\nRésultat : ${pass} OK, ${fail} échec(s)`);
process.exit(fail > 0 ? 1 : 0);
