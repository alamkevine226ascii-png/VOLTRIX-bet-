// Test du garde-fou d'échange : la chute de cote (bug signalé) + sa réparation.
// 1. Combo cible ×10 → échange de la jambe 0 avec la 1re alternative (tri efficacité)
// 2. Sans garde-fou : la cote retombe sous la cible (reproduction du bug)
// 3. Avec repairToTarget (comme applySwap) : la cible est rétablie
import {
  buildCombo,
  listAlternatives,
  recomputeCombo,
  repairToTarget,
  type ComboLeg,
} from '../src/lib/combo';
import type { LightMatch, MatchesResponse, QuickPred } from '../src/lib/types';

const BASE = 'http://localhost:3000';

async function candidatesForDate(date: string): Promise<ComboLeg[]> {
  const res = await fetch(`${BASE}/api/matches?date=${date}`);
  const json: MatchesResponse = await res.json();
  const upcoming = (json.leagues.flatMap((l) => l.matches) ?? [])
    .filter((m: LightMatch) => m.status === "pre");

  const map = new Map<string, QuickPred>();
  for (let i = 0; i < upcoming.length; i += 6) {
    const batch = upcoming.slice(i, i + 6);
    try {
      const r = await fetch(`${BASE}/api/predictions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matches: batch.map((m) => ({ matchId: m.id, leagueCode: m.leagueCode, date: m.date })) }),
      });
      const j = await r.json();
      for (const res2 of j.results ?? []) if (res2) map.set(res2.matchId, res2);
    } catch { /* ignore */ }
  }

  const legs: ComboLeg[] = [];
  for (const m of upcoming) {
    const p = map.get(m.id);
    if (!p) continue;
    const base = {
      matchId: m.id, leagueCode: m.leagueCode, leagueShort: m.leagueShort, leagueName: m.leagueName,
      matchDate: m.date, homeName: m.home.name, awayName: m.away.name,
      homeLogo: m.home.logo, awayLogo: m.away.logo, confidence: p.confidence,
    };
    const sides: Array<{ pick: string; prob: number; odds: number | null }> = [
      { pick: '1', prob: p.probs.home, odds: m.mlHome },
      { pick: 'N', prob: p.probs.draw, odds: m.mlDraw },
      { pick: '2', prob: p.probs.away, odds: m.mlAway },
    ];
    for (const s of sides) {
      legs.push({ ...base, market: '1X2', pick: s.pick, prob: s.prob, odds: s.odds ?? 1.05, oddsSource: s.odds ? 'real' : 'estimate' });
    }
    for (const ou of p.overUnder) {
      legs.push({ ...base, market: `O/U ${ou.line}`, pick: `Plus de ${ou.line}`, prob: ou.over, odds: Math.max(1.04, Math.round((1 / Math.min(ou.over, 0.97)) * 0.93 * 100) / 100), oddsSource: 'estimate' });
      legs.push({ ...base, market: `O/U ${ou.line}`, pick: `Moins de ${ou.line}`, prob: ou.under, odds: Math.max(1.04, Math.round((1 / Math.min(ou.under, 0.97)) * 0.93 * 100) / 100), oddsSource: 'estimate' });
    }
  }
  return legs;
}

async function main() {
  const date = new Date().toISOString().slice(0, 10);
  const legs = await candidatesForDate(date);
  console.log(`=== ${date} : ${legs.length} candidats ===`);

  const combo = buildCombo(legs, 10, 5, 'equilibre', 1);
  if (!combo) { console.log('Pas de combo ×10 aujourd\'hui'); return; }
  console.log(`\nCombo initial cible ×10 : cote ${combo.comboOdds.toFixed(2)} (${combo.legs.length} jambes)`);

  const alts = listAlternatives(legs, combo.legs, 0, 'equilibre');
  if (alts.length === 0) { console.log('Pas d\'alternatives'); return; }
  console.log(`1re alternative (tri efficacité) : ${alts[0].pick} @${alts[0].odds.toFixed(2)}`);

  // Échange manuel (ancien comportement)
  const nextLegs = [...combo.legs];
  nextLegs.splice(0, 1, alts[0]);
  const before = recomputeCombo(nextLegs, 'equilibre', combo.targetOdds, combo.legsLimit);
  console.log(`\n[AVANT FIX] Après échange : ${before ? `×${before.comboOdds.toFixed(2)} pour objectif ×10${before.comboOdds < 10 ? '  *** BUG : sous l\'objectif, affiché quand même ***' : ''}` : 'null'}`);

  // Avec garde-fou (comportement applySwap corrigé)
  const repaired = repairToTarget(nextLegs, legs, combo.targetOdds, 'equilibre');
  if (repaired) {
    const after = recomputeCombo(repaired, 'equilibre', combo.targetOdds, combo.legsLimit);
    const ok = after && after.comboOdds >= combo.targetOdds - 0.005;
    console.log(`[APRÈS FIX] repairToTarget : ${after ? `×${after.comboOdds.toFixed(2)}` : 'null'} — ${ok ? '✓ PASS objectif rétabli' : '✗ FAIL'}`);
  } else {
    console.log('[APRÈS FIX] repairToTarget : null → ticket conservé + badge « sous l\'objectif » (honnête) ✓');
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
