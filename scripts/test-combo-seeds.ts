// Test multi-seeds ("Autre option") + multi-dates : l'invariant tient-il ?
import { buildCombo, type ComboLeg, type RiskProfile } from '../src/lib/combo';
import type { LightMatch, MatchesResponse, QuickPred } from '../src/lib/types';

const BASE = 'http://localhost:3000';

// Reconstruction des candidats à partir des données API déjà normalisées
// (on réutilise le même pipeline que la page, via les QuickPreds de l'API
// /api/predictions + les cotes des LightMatch — version compacte).
async function candidatesForDate(date: string): Promise<ComboLeg[]> {
  const res = await fetch(`${BASE}/api/matches?date=${date}`);
  const json: MatchesResponse = await res.json();
  const upcoming = (json.leagues.flatMap((l) => l.matches) ?? [])
    .filter((m: LightMatch) => m.status === "pre")
    .sort((a: LightMatch, b: LightMatch) => new Date(a.date).getTime() - new Date(b.date).getTime());

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
    } catch {
      /* lot ignoré */
    }
  }
  // Candidats simplifiés mais FIDÈLES aux contraintes du moteur :
  // 1X2 réel/estimé + O/U modèle + BTTS (le DC dérivé n'ajoute rien à l'invariant).
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
    legs.push({ ...base, market: 'BTTS', pick: 'BTTS Oui', prob: p.btts.yes, odds: Math.max(1.04, Math.round((1 / Math.min(p.btts.yes, 0.97)) * 0.93 * 100) / 100), oddsSource: 'estimate' });
    legs.push({ ...base, market: 'BTTS', pick: 'BTTS Non', prob: p.btts.no, odds: Math.max(1.04, Math.round((1 / Math.min(p.btts.no, 0.97)) * 0.93 * 100) / 100), oddsSource: 'estimate' });
  }
  return legs;
}

async function main() {
  for (const date of [new Date().toISOString().slice(0, 10)]) {
    const candidates = await candidatesForDate(date);
    console.log(`\n=== ${date} : ${candidates.length} candidats ===`);
    for (const profile of ['equilibre', 'agressif'] as RiskProfile[]) {
      let violations = 0;
      let nulls = 0;
      let minGap = 0;
      const dist: number[] = [];
      for (let seed = 1; seed <= 25; seed++) {
        const res = buildCombo(candidates, 10, 5, profile, seed);
        if (!res) { nulls++; continue; }
        dist.push(res.comboOdds);
        if (res.comboOdds < 10 - 0.005) {
          violations++;
          minGap = Math.min(minGap, res.comboOdds - 10);
          if (violations <= 5) {
            console.log(`  VIOLATION seed=${seed} profil=${profile}: cote ${res.comboOdds.toFixed(2)}`);
            console.log('    ' + res.legs.map((l) => `${l.pick}@${l.odds}(p=${(l.prob*100).toFixed(0)}%)`).join(' × '));
          }
        }
      }
      dist.sort((a, b) => a - b);
      console.log(
        `profil=${profile} : ${violations} violations / 25 seeds, ${nulls} null | cote min=${dist[0]?.toFixed(2)} médiane=${dist[Math.floor(dist.length/2)]?.toFixed(2)} max=${dist[dist.length-1]?.toFixed(2)}`
      );
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
