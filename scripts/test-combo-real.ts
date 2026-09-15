// Reproduction du bug combo avec VRAIES données du serveur dev (port 3000).
// Reproduit EXACTEMENT le pipeline de /combo/page.tsx :
//   /api/matches → /api/predictions (lots de 6) → buildCandidates → buildCombo
// et vérifie l'invariant comboOdds >= targetOdds.
import {
  buildCombo,
  maxAchievableOdds,
  fairOdds,
  type ComboLeg,
  type RiskProfile,
} from '../src/lib/combo';
import {
  calibrateTotals,
  dcFromMarket,
  deMarginOverUnder,
  oddsWithMargin,
  type CalibratedTotals,
} from '../src/lib/market-odds';
import type { LightMatch, MatchesResponse, QuickPred } from '../src/lib/types';

const BASE = 'http://localhost:3000';
const LINES = [1.5, 2.5, 3.5];

function buildCandidates(matches: LightMatch[], map: Map<string, QuickPred>): ComboLeg[] {
  const legs: ComboLeg[] = [];
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

    const sides: Array<{ pick: string; prob: number; odds: number | null }> = [
      { pick: `Victoire ${m.home.name}`, prob: p.probs.home, odds: m.mlHome },
      { pick: 'Match nul', prob: p.probs.draw, odds: m.mlDraw },
      { pick: `Victoire ${m.away.name}`, prob: p.probs.away, odds: m.mlAway },
    ];
    for (const s of sides) {
      legs.push({
        ...base,
        market: '1X2',
        pick: s.pick,
        prob: s.prob,
        odds: s.odds ?? fairOdds(s.prob),
        oddsSource: s.odds != null && s.odds > 1.01 ? 'real' : 'estimate',
      });
    }

    if (mlReal) {
      const dc = dcFromMarket(m.mlHome!, m.mlDraw!, m.mlAway!);
      if (dc) {
        const dcs = [
          { pick: `${m.home.shortName} ou Nul (1X)`, prob: dc.prob1X, odds: dc.odds1X },
          { pick: 'Pas de nul (12)', prob: dc.prob12, odds: dc.odds12 },
          { pick: `${m.away.shortName} ou Nul (X2)`, prob: dc.probX2, odds: dc.oddsX2 },
        ];
        for (const d of dcs) {
          legs.push({ ...base, market: 'Double Chance', pick: d.pick, prob: d.prob, odds: d.odds, oddsSource: 'market' });
        }
      }
    } else {
      const dcs = [
        { pick: `${m.home.shortName} ou Nul (1X)`, prob: p.probs.home + p.probs.draw },
        { pick: 'Pas de nul (12)', prob: p.probs.home + p.probs.away },
        { pick: `${m.away.shortName} ou Nul (X2)`, prob: p.probs.draw + p.probs.away },
      ];
      for (const d of dcs) {
        legs.push({ ...base, market: 'Double Chance', pick: d.pick, prob: d.prob, odds: fairOdds(d.prob), oddsSource: 'estimate' });
      }
    }

    const realOu =
      p.ouOdds?.line != null && p.ouOdds?.over != null && p.ouOdds?.under != null
        ? { line: p.ouOdds.line, over: p.ouOdds.over, under: p.ouOdds.under }
        : null;
    let calibrated: CalibratedTotals | null = null;
    if (realOu && p.lambda) {
      const dm = deMarginOverUnder(realOu.over!, realOu.under!);
      if (dm) calibrated = calibrateTotals(p.lambda.home, p.lambda.away, realOu.line!, dm.pOver, LINES);
    }
    for (const line of LINES) {
      const modelLine = p.overUnder.find((o) => o.line === line);
      const isRealLine = realOu != null && Math.abs(realOu.line - line) < 0.01;
      const overP = calibrated ? calibrated.over[line] : (modelLine?.over ?? 0);
      const underP = calibrated ? 1 - overP : (modelLine?.under ?? 0);
      if (!Number.isFinite(overP) || !Number.isFinite(underP) || overP <= 0.02 || underP <= 0.02) continue;
      legs.push({
        ...base,
        market: `O/U ${line}`,
        pick: `Plus de ${line} buts`,
        prob: overP,
        odds: isRealLine ? realOu!.over! : oddsWithMargin(overP),
        oddsSource: isRealLine ? 'real' : calibrated ? 'market' : 'estimate',
      });
      legs.push({
        ...base,
        market: `O/U ${line}`,
        pick: `Moins de ${line} buts`,
        prob: underP,
        odds: isRealLine ? realOu!.under! : oddsWithMargin(underP),
        oddsSource: isRealLine ? 'real' : calibrated ? 'market' : 'estimate',
      });
    }

    const bttsYes = calibrated ? calibrated.btts : p.btts.yes;
    legs.push({ ...base, market: 'BTTS', pick: 'Les 2 équipes marquent : Oui', prob: bttsYes, odds: fairOdds(bttsYes), oddsSource: 'estimate' });
    legs.push({ ...base, market: 'BTTS', pick: 'Les 2 équipes marquent : Non', prob: 1 - bttsYes, odds: fairOdds(1 - bttsYes), oddsSource: 'estimate' });
  }
  return legs;
}

async function main() {
  const date = process.argv[2] ?? new Date().toISOString().slice(0, 10);
  console.log(`=== Reproduction combo — date ${date} ===`);

  const res = await fetch(`${BASE}/api/matches?date=${date}`);
  const json: MatchesResponse = await res.json();
  const upcoming = (json.leagues.flatMap((l) => l.matches) ?? [])
    .filter((m: LightMatch) => m.status === "pre")
    .sort((a: LightMatch, b: LightMatch) => new Date(a.date).getTime() - new Date(b.date).getTime());
  console.log(`Matchs à venir : ${upcoming.length} / total ${json.totalMatches}`);

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
    } catch (e) {
      console.log(`  lot ${i} échoué: ${e}`);
    }
  }
  console.log(`Prédictions reçues : ${map.size}`);

  const candidates = buildCandidates(upcoming, map);
  console.log(`Candidats : ${candidates.length}`);

  // Statistiques prob vs cote (découplage modèle/marché)
  const profiles: RiskProfile[] = ['prudent', 'equilibre', 'agressif'];
  for (const profile of profiles) {
    console.log(`\n--- Profil ${profile} ---`);
    for (const target of [3, 5, 10, 20]) {
      const maxO = maxAchievableOdds(candidates, 5, profile);
      const res = buildCombo(candidates, target, 5, profile, 1);
      if (!res) {
        console.log(`cible ×${target} : AUCUN combiné (max atteignable ${maxO.toFixed(2)})`);
        continue;
      }
      const ok = res.comboOdds >= target - 0.005;
      console.log(
        `cible ×${target} : cote ${res.comboOdds.toFixed(2)} ${ok ? 'OK' : '*** INVARIANT VIOLÉ ***'} | proba ${(res.comboProb * 100).toFixed(1)}% | ${res.legs.length} jambes`
      );
      if (!ok) {
        for (const l of res.legs) {
          console.log(`    ${l.market} | ${l.pick} | cote ${l.odds} | p=${(l.prob * 100).toFixed(0)}% | ${l.homeName} vs ${l.awayName}`);
        }
      }
    }
  }
}

main().catch((e) => {
  console.error('ERREUR:', e);
  process.exit(1);
});
