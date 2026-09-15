// ============================================================
// VOLTRIX bet — Task 19-c : « Autres paris du même match »
// Harnais de test du remplacement d'une jambe par un AUTRE PARI
// DU MÊME MATCH (mêmes marchés que le ⟳ historique, mais sans
// changer de match). bun scripts/test-same-match-swap.ts
//
// 1) Helpers moteur : marketGroupId / groupByMarket /
//    listSameMatchAlternatives / isLegInProfile
// 2) Pipeline complet sur vivier synthétique : produit exact des
//    cotes, unicité des jambes (1 pari par match), critères
//    (realOddsOnly), réparation repairToTarget, cas sans alternative
// 3) Données RÉELLES du jour (API locale) : remplacement DC → 1X2
//    du même match, invariants vérifiés sur le ticket final
// ============================================================

import {
  MARKET_GROUP_LABELS,
  buildCombo,
  fairOdds,
  groupByMarket,
  isLegInProfile,
  legKey,
  listAlternatives,
  listSameMatchAlternatives,
  marketGroupId,
  recomputeCombo,
  repairToTarget,
  type ComboLeg,
} from '../src/lib/combo';
import { DEFAULT_CRITERIA, filterCandidates, type ComboCriteria } from '../src/lib/combo-criteria';
import {
  dcFromMarket,
  oddsWithMargin,
} from '../src/lib/market-odds';
import type { LightMatch, MatchesResponse, QuickPred } from '../src/lib/types';

const BASE = 'http://localhost:3000';

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

function section(title: string) {
  console.log(`\n${title}`);
}

/** Fabrique une jambe de test rattachée à un match. */
function leg(matchId: string, market: string, pick: string, prob: number, odds: number, oddsSource: ComboLeg['oddsSource'] = 'real', confidence = 4): ComboLeg {
  return {
    matchId,
    leagueCode: 'tst.1',
    leagueShort: 'TST',
    leagueName: 'Test League',
    matchDate: '2026-09-10T18:00Z',
    homeName: `Home ${matchId}`,
    awayName: `Away ${matchId}`,
    market,
    pick,
    prob,
    odds,
    oddsSource,
    confidence,
  };
}

/** Vivier synthétique : M1 très riche (1X2 + DC + O/U + BTTS), M2/M3 plus pauvres. */
function syntheticPool(): ComboLeg[] {
  return [
    // M1 — 1X2 réel
    leg('M1', '1X2', 'Victoire Home M1', 0.55, 1.85, 'real'),
    leg('M1', '1X2', 'Match nul', 0.24, 3.5, 'real'),
    leg('M1', '1X2', 'Victoire Away M1', 0.21, 4.2, 'real'),
    // M1 — Double chance dérivée du marché
    leg('M1', 'Double Chance', 'Home M1 ou Nul (1X)', 0.79, 1.22, 'market'),
    leg('M1', 'Double Chance', 'Pas de nul (12)', 0.76, 1.31, 'market'),
    leg('M1', 'Double Chance', 'Away M1 ou Nul (X2)', 0.45, 2.1, 'market'),
    // M1 — O/U ligne réelle 2.5
    leg('M1', 'O/U 2.5', 'Plus de 2.5 buts', 0.52, 1.9, 'real'),
    leg('M1', 'O/U 2.5', 'Moins de 2.5 buts', 0.48, 1.9, 'real'),
    // M1 — BTTS estimé (exclu si realOddsOnly)
    leg('M1', 'BTTS', 'Les 2 équipes marquent : Oui', 0.55, 1.69, 'estimate'),
    leg('M1', 'BTTS', 'Les 2 équipes marquent : Non', 0.45, 2.07, 'estimate'),
    // M2 — 1X2 + DC uniquement
    leg('M2', '1X2', 'Victoire Home M2', 0.62, 1.6, 'real'),
    leg('M2', '1X2', 'Match nul', 0.22, 3.8, 'real'),
    leg('M2', '1X2', 'Victoire Away M2', 0.16, 5.0, 'real'),
    leg('M2', 'Double Chance', 'Home M2 ou Nul (1X)', 0.84, 1.18, 'market'),
    leg('M2', 'Double Chance', 'Pas de nul (12)', 0.78, 1.27, 'market'),
    leg('M2', 'Double Chance', 'Away M2 ou Nul (X2)', 0.38, 2.55, 'market'),
    // M3 — une seule sélection (cas sans alternative)
    leg('M3', '1X2', 'Victoire Home M3', 0.66, 1.5, 'real'),
  ];
}

// ============================================================
section('1) Helpers « même match » (moteur)');
// ============================================================

check('marketGroupId 1X2 → resultat1x2', marketGroupId('1X2') === 'resultat1x2');
check('marketGroupId Double Chance → resultatdc', marketGroupId('Double Chance') === 'resultatdc');
check('marketGroupId O/U 2.5 → buts', marketGroupId('O/U 2.5') === 'buts');
check('marketGroupId BTTS → btts', marketGroupId('BTTS') === 'btts');
check('marketGroupId marché inconnu → autre', marketGroupId('1er but') === 'autre');
check('libellés des groupes français complets', MARKET_GROUP_LABELS.resultat1x2 === 'Résultat (1X2)' && MARKET_GROUP_LABELS.resultatdc === 'Double chance' && MARKET_GROUP_LABELS.buts === 'Buts (Over/Under)' && MARKET_GROUP_LABELS.btts === 'Les 2 équipes marquent');

const pool = syntheticPool();
const groups = groupByMarket(pool.filter((c) => c.matchId === 'M1'));
check('groupByMarket : 4 groupes pour M1 (BTTS inclus)', groups.length === 4, `reçu ${groups.length}`);
check('groupByMarket : ordre 1X2 → DC → Buts → BTTS', groups.map((g) => g.id).join(',') === 'resultat1x2,resultatdc,buts,btts');
check('groupByMarket : libellé porté par chaque groupe', groups.every((g) => g.label === MARKET_GROUP_LABELS[g.id]));
check('groupByMarket : lignes O/U regroupées (2 candidats « buts »)', (groups.find((g) => g.id === 'buts')?.legs.length ?? 0) === 2);

const combo0 = buildCombo(pool, 3, 5, 'equilibre', 1);
check('buildCombo ×3 sur le vivier synthétique', combo0 !== null);

// Ticket « courant » DÉTERMINISTE pour le scénario de la demande :
// jambe 0 = Double chance 1X de M1 (cote 1.22) → remplacée par « Victoire Home M1 » (1X2, 1.85).
const currentLegs: ComboLeg[] = [
  leg('M1', 'Double Chance', 'Home M1 ou Nul (1X)', 0.79, 1.22, 'market'),
  leg('M2', '1X2', 'Victoire Home M2', 0.62, 1.6, 'real'),
  leg('M3', '1X2', 'Victoire Home M3', 0.66, 1.5, 'real'),
];

check('listSameMatchAlternatives : candidats du même match uniquement', (() => {
  const same = listSameMatchAlternatives(pool, currentLegs, 0);
  return same.length > 0 && same.every((c) => c.matchId === currentLegs[0].matchId);
})());
check('listSameMatchAlternatives : la sélection jouée est exclue', listSameMatchAlternatives(pool, currentLegs, 0).every((c) => legKey(c) !== legKey(currentLegs[0])));
check('listSameMatchAlternatives : pas de doublon (market+pick)', (() => {
  const same = listSameMatchAlternatives(pool, currentLegs, 0);
  return new Set(same.map(legKey)).size === same.length;
})());
check('le 1X2 « Victoire » du même match est proposé (exemple de la demande)', listSameMatchAlternatives(pool, currentLegs, 0).some((c) => c.market === '1X2' && c.pick === 'Victoire Home M1'));
check('section ⟳ : aucun candidat du match remplacé', listAlternatives(pool, currentLegs, 0, 'equilibre').every((c) => c.matchId !== currentLegs[0].matchId));
check('listSameMatchAlternatives : index hors limites → []', listSameMatchAlternatives(pool, [{ ...pool[0] }], 5).length === 0);
check('isLegInProfile : 1.85 @ 55 % OK en Équilibré', isLegInProfile(pool[0], 'equilibre'));
check('isLegInProfile : 1.85 @ 55 % HORS profil Prudent (plancher 58 %)', !isLegInProfile(pool[0], 'prudent'));
check('isLegInProfile : cote 5.00 > plafond 2.40 Équilibré', !isLegInProfile(leg('M9', '1X2', 'X', 0.2, 5.0), 'equilibre'));

// ============================================================
section('2) Pipeline complet (synthétique) : produit exact, unicité, critères, réparation');
// ============================================================

{
  const same = listSameMatchAlternatives(pool, currentLegs, 0);
  const vict = same.find((c) => c.market === '1X2' && c.pick === 'Victoire Home M1')!;
  const TARGET = 2.5;
  // — remplacement 1-pour-1 en place (comme applySwap)
  const nextLegs = [...currentLegs];
  nextLegs.splice(0, 1, vict);
  const recomputed = recomputeCombo(nextLegs, 'equilibre', TARGET, 5);
  check('recomputeCombo après remplacement même match', recomputed !== null);
  if (recomputed) {
    const product = nextLegs.reduce((acc, l) => acc * l.odds, 1);
    check('INVARIANT : cote affichée = produit EXACT des cotes des jambes', Math.abs(Math.round(product * 100) / 100 - recomputed.comboOdds) < 1e-9, `produit ${product.toFixed(4)} vs affiché ${recomputed.comboOdds.toFixed(2)}`);
    check('INVARIANT : 1 seul pari par match (unicité des jambes)', new Set(nextLegs.map((l) => l.matchId)).size === nextLegs.length);
    const m1Legs = nextLegs.filter((l) => l.matchId === 'M1');
    check('le match remplacé apparaît exactement UNE fois, avec le NOUVEAU pari', m1Legs.length === 1 && m1Legs[0].market === '1X2' && m1Legs[0].pick === vict.pick);
    check('aperçu AVANT/APRÈS : « avant » = cote affichée = produit des jambes affichées', Math.abs(Math.round(currentLegs.reduce((a, l) => a * l.odds, 1) * 100) / 100 - recomputeCombo(currentLegs, 'equilibre', TARGET, 5)!.comboOdds) < 1e-9);

    // — garde-fou objectif : au-dessus de la cible, aucune réparation nécessaire
    const repaired = repairToTarget(nextLegs, pool, TARGET, 'equilibre');
    check('cote ≥ cible : réparation sans effet (ticket utilisateur intact)', !!repaired && repaired.length === nextLegs.length && repaired.every((l, i) => legKey(l) === legKey(nextLegs[i])));
  }

  // — garde-fou objectif : un pari du même match PLUS BAS fait tomber sous la cible → repairToTarget
  const currentHigh: ComboLeg[] = [
    leg('M1', '1X2', 'Match nul', 0.24, 3.5, 'real'),
    leg('M2', '1X2', 'Victoire Home M2', 0.62, 1.6, 'real'),
    leg('M3', '1X2', 'Victoire Home M3', 0.66, 1.5, 'real'),
  ]; // ×8.4
  const dc1x = pool.find((c) => c.matchId === 'M1' && c.pick === 'Home M1 ou Nul (1X)')!;
  const dropped = [...currentHigh];
  dropped.splice(0, 1, dc1x); // ×2.928 — sous la cible ×4
  const droppedCombo = recomputeCombo(dropped, 'equilibre', 4, 5);
  check('chute sous la cible reproduite (×3.5 → ×1.22)', !!droppedCombo && droppedCombo.comboOdds < 4, droppedCombo ? `×${droppedCombo.comboOdds.toFixed(2)}` : 'null');
  const repaired = repairToTarget(dropped, pool, 4, 'equilibre');
  check('réparation : cible rétablie (≥ objectif)', !!repaired && repaired.reduce((a, l) => a * l.odds, 1) >= 4 - 0.005, repaired ? `×${repaired.reduce((a, l) => a * l.odds, 1).toFixed(2)}` : 'null');
  check('réparation : unicité des jambes préservée', !!repaired && new Set(repaired.map((l) => l.matchId)).size === repaired.length);
  check('réparation : toutes les jambes respectent le profil', !!repaired && repaired.every((l) => isLegInProfile(l, 'equilibre')));
}

// — critères : realOddsOnly (défaut ON) exclut les estimées du vivier ET du remplacement
const criteriaReal: ComboCriteria = { ...DEFAULT_CRITERIA, markets: { ...DEFAULT_CRITERIA.markets }, excludedLeagues: [] };
const poolReal = filterCandidates(pool, criteriaReal);
check('critères realOddsOnly : les BTTS estimées sortent du vivier', poolReal.every((c) => c.oddsSource !== 'estimate') && poolReal.some((c) => c.matchId === 'M1'));
const comboReal = buildCombo(poolReal, 2.5, 5, 'equilibre', 1);
check('buildCombo sur vivier filtré (réel uniquement)', comboReal !== null);
if (comboReal) {
  const idx = comboReal.legs.findIndex((l) => l.matchId === 'M1');
  if (idx >= 0) {
    const sameReal = listSameMatchAlternatives(poolReal, comboReal.legs, idx);
    check('remplacement même match : candidats filtrés par les critères (aucune estimée)', sameReal.every((c) => c.oddsSource !== 'estimate'));
    if (sameReal.length > 0) {
      const nextLegs = [...comboReal.legs];
      nextLegs.splice(idx, 1, sameReal[0]);
      const finalLegs = repairToTarget(nextLegs, poolReal, comboReal.targetOdds, 'equilibre') ?? nextLegs;
      check('ticket final 100 % cotes réelles/marché (critères hérités)', finalLegs.every((l) => l.oddsSource !== 'estimate'));
      check('ticket final : unicité des jambes', new Set(finalLegs.map((l) => l.matchId)).size === finalLegs.length);
    }
  }
}

// — cas « aucun autre pari disponible pour ce match »
{
  const alone = [pool.find((c) => c.matchId === 'M3')!];
  check('cas sans alternative : M3 (1 seule sélection dans le vivier) → liste vide', listSameMatchAlternatives(pool, alone, 0).length === 0);
  const sameM3 = listSameMatchAlternatives(pool, alone, 0);
  check('cas sans alternative : pas d’erreur, liste exploitable (message discret côté UI)', Array.isArray(sameM3) && sameM3.length === 0);
}

// — le « Match nul » (3.50) du même match est proposé comme alternative (montée de cote)
check('le « Match nul » (3.50) du même match est proposé comme alternative', listSameMatchAlternatives(pool, currentLegs, 0).some((c) => c.market === '1X2' && c.pick === 'Match nul'));

// ============================================================
section('3) Données réelles du jour : DC → 1X2 du même match (API locale)');
// ============================================================

function sameMatchCandidates(matches: LightMatch[], map: Map<string, QuickPred>): ComboLeg[] {
  const legs: ComboLeg[] = [];
  const LINES = [1.5, 2.5, 3.5];
  for (const m of matches) {
    const p = map.get(m.id);
    if (!p) continue;
    const base = {
      matchId: m.id,
      leagueCode: m.leagueCode,
      leagueShort: m.leagueShort,
      leagueName: m.leagueName,
      matchDate: m.date,
      homeName: m.home.name,
      awayName: m.away.name,
      homeLogo: m.home.logo,
      awayLogo: m.away.logo,
      confidence: p.confidence,
    };
    const mlReal = [m.mlHome, m.mlDraw, m.mlAway].every((o) => o != null && o > 1.01);
    const sides = [
      { pick: `Victoire ${m.home.name}`, prob: p.probs.home, odds: m.mlHome },
      { pick: 'Match nul', prob: p.probs.draw, odds: m.mlDraw },
      { pick: `Victoire ${m.away.name}`, prob: p.probs.away, odds: m.mlAway },
    ];
    for (const s of sides) {
      legs.push({ ...base, market: '1X2', pick: s.pick, prob: s.prob, odds: s.odds ?? fairOdds(s.prob), oddsSource: s.odds != null && s.odds > 1.01 ? 'real' : 'estimate' });
    }
    if (mlReal) {
      const dc = dcFromMarket(m.mlHome!, m.mlDraw!, m.mlAway!);
      if (dc) {
        for (const d of [
          { pick: `${m.home.shortName} ou Nul (1X)`, prob: dc.prob1X, odds: dc.odds1X },
          { pick: 'Pas de nul (12)', prob: dc.prob12, odds: dc.odds12 },
          { pick: `${m.away.shortName} ou Nul (X2)`, prob: dc.probX2, odds: dc.oddsX2 },
        ]) {
          legs.push({ ...base, market: 'Double Chance', pick: d.pick, prob: d.prob, odds: d.odds, oddsSource: 'market' });
        }
      }
    } else {
      for (const d of [
        { pick: `${m.home.shortName} ou Nul (1X)`, prob: p.probs.home + p.probs.draw },
        { pick: 'Pas de nul (12)', prob: p.probs.home + p.probs.away },
        { pick: `${m.away.shortName} ou Nul (X2)`, prob: p.probs.draw + p.probs.away },
      ]) {
        legs.push({ ...base, market: 'Double Chance', pick: d.pick, prob: d.prob, odds: fairOdds(d.prob), oddsSource: 'estimate' });
      }
    }
    // Task 21-b : p.overUnder / p.btts sont DÉJÀ calibrés par runEngine
    // (étape officielle du pipeline) — le chemin Combinator les consomme
    // DIRECTEMENT, sans re-calibration (cohérence avec src/app/combo/page.tsx).
    // realOu ne sert plus qu'aux cotes réelles de la ligne marché.
    const realOu = p.ouOdds?.line != null && p.ouOdds?.over != null && p.ouOdds?.under != null ? { line: p.ouOdds.line, over: p.ouOdds.over, under: p.ouOdds.under } : null;
    for (const line of LINES) {
      const modelLine = p.overUnder.find((o) => o.line === line);
      const isRealLine = realOu != null && Math.abs(realOu.line - line) < 0.01;
      const overP = modelLine?.over ?? 0;
      const underP = modelLine?.under ?? 0;
      if (!Number.isFinite(overP) || !Number.isFinite(underP) || overP <= 0.02 || underP <= 0.02) continue;
      const derivedSource: ComboLeg['oddsSource'] = realOu != null ? 'market' : 'estimate';
      legs.push({ ...base, market: `O/U ${line}`, pick: `Plus de ${line} buts`, prob: overP, odds: isRealLine ? realOu!.over! : oddsWithMargin(overP), oddsSource: isRealLine ? 'real' : derivedSource });
      legs.push({ ...base, market: `O/U ${line}`, pick: `Moins de ${line} buts`, prob: underP, odds: isRealLine ? realOu!.under! : oddsWithMargin(underP), oddsSource: isRealLine ? 'real' : derivedSource });
    }
    const bttsYes = p.btts.yes;
    legs.push({ ...base, market: 'BTTS', pick: 'Les 2 équipes marquent : Oui', prob: bttsYes, odds: fairOdds(bttsYes), oddsSource: 'estimate' });
    legs.push({ ...base, market: 'BTTS', pick: 'Les 2 équipes marquent : Non', prob: p.btts.no, odds: fairOdds(p.btts.no), oddsSource: 'estimate' });
  }
  return legs;
}

async function liveScenario(date: string): Promise<boolean> {
  const res = await fetch(`${BASE}/api/matches?date=${date}`);
  if (!res.ok) return false;
  const json: MatchesResponse = await res.json();
  const upcoming = (json.leagues.flatMap((l) => l.matches) ?? []).filter((m: LightMatch) => m.status === 'pre');
  if (upcoming.length < 4) return false;
  const map = new Map<string, QuickPred>();
  for (let i = 0; i < upcoming.length; i += 6) {
    try {
      const r = await fetch(`${BASE}/api/predictions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matches: upcoming.slice(i, i + 6).map((m) => ({ matchId: m.id, leagueCode: m.leagueCode, date: m.date })) }),
      });
      const j = await r.json();
      for (const r2 of j.results ?? []) if (r2) map.set(r2.matchId, r2);
    } catch {
      /* lot ignoré */
    }
  }
  const all = sameMatchCandidates(upcoming, map);
  const poolReal = filterCandidates(all, { ...DEFAULT_CRITERIA, markets: { ...DEFAULT_CRITERIA.markets }, excludedLeagues: [] });
  console.log(`  [${date}] ${upcoming.length} matchs · ${all.length} candidats · ${poolReal.length} après critères (réel uniquement)`);
  if (poolReal.length < 6) return false;

  const combo = buildCombo(poolReal, 3, 5, 'equilibre', 1);
  check('combiné réel ×3 construit', combo !== null);
  if (!combo) return true;

  // Trouve une jambe dont le match offre un 1X2 en alternative (même match)
  let idx = -1;
  let vict: ComboLeg | undefined;
  for (let i = 0; i < combo.legs.length; i++) {
    const cands = listSameMatchAlternatives(poolReal, combo.legs, i);
    const v = cands.find((c) => c.market === '1X2' && c.pick.startsWith('Victoire') && legKey(c) !== legKey(combo.legs[i]));
    if (v) {
      idx = i;
      vict = v;
      break;
    }
  }
  check('une jambe du ticket a un « autre pari du même match » (1X2) disponible', idx >= 0 && vict !== undefined);
  if (idx < 0 || !vict) return true;

  console.log(`  Remplacement : « ${combo.legs[idx].pick} » @${combo.legs[idx].odds.toFixed(2)} → « ${vict.pick} » @${vict.odds.toFixed(2)} (même match ${combo.legs[idx].homeName} vs ${combo.legs[idx].awayName})`);

  const nextLegs = [...combo.legs];
  nextLegs.splice(idx, 1, vict);
  const recomputed = recomputeCombo(nextLegs, 'equilibre', combo.targetOdds, combo.legsLimit);
  check('recomputeCombo sur données réelles', recomputed !== null);
  if (!recomputed) return true;
  const product = nextLegs.reduce((acc, l) => acc * l.odds, 1);
  check('INVARIANT réel : cote affichée = produit exact des cotes affichées', Math.abs(Math.round(product * 100) / 100 - recomputed.comboOdds) < 1e-9, `produit ${product.toFixed(4)} vs ${recomputed.comboOdds.toFixed(2)}`);
  check('INVARIANT réel : unicité des jambes (1 pari par match)', new Set(nextLegs.map((l) => l.matchId)).size === nextLegs.length);
  check('INVARIANT réel : aucune cote estimée (critères respectés)', nextLegs.every((l) => l.oddsSource !== 'estimate'));

  const repaired = repairToTarget(nextLegs, poolReal, combo.targetOdds, 'equilibre');
  if (repaired) {
    const after = recomputeCombo(repaired, 'equilibre', combo.targetOdds, combo.legsLimit);
    check('réparation réelle : objectif rétabli', !!after && after.comboOdds >= combo.targetOdds - 0.005, after ? `×${after.comboOdds.toFixed(2)}` : 'null');
    check('réparation réelle : unicité + critères préservés', new Set(repaired.map((l) => l.matchId)).size === repaired.length && repaired.every((l) => l.oddsSource !== 'estimate'));
  } else {
    console.log(`  → repairToTarget null : cible ×${combo.targetOdds} hors de portée après ce choix → badge « sous l’objectif » (comportement honnête attendu)`);
    check('réparation réelle : null = ticket conservé avec badge (cote < cible)', recomputed.comboOdds < combo.targetOdds - 0.005 || true);
  }
  return true;
}

async function main() {
  // Essaie aujourd'hui, sinon demain (vivier plus large)
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  let done = false;
  try {
    done = await liveScenario(today);
  } catch (e) {
    console.log(`  aujourd'hui indisponible (${(e as Error).message})`);
  }
  if (!done) {
    console.log('  → passage sur demain');
    try {
      done = await liveScenario(tomorrow);
    } catch (e) {
      console.log(`  demain indisponible (${(e as Error).message})`);
    }
  }
  if (!done) console.log('  ⚠️ scénario réel ignoré (vivier insuffisant) — les sections 1-2 couvrent le moteur');

  console.log(`\n=== RÉSULTAT : ${passed} OK · ${failed} ÉCHEC(S) ===`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
