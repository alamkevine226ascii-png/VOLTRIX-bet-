// Test de stress : l'invariant comboOdds >= targetOdds est-il respecté ?
// Simule des viviers de candidats réalistes (contraintes profils) et
// toutes les cibles du sélecteur TARGET_CHIPS.
import {
  buildCombo,
  maxAchievableOdds,
  PROFILES,
  type ComboLeg,
  type RiskProfile,
} from '../src/lib/combo';

// RNG déterministe
let s = 42;
function rnd(): number {
  s = (s * 1103515245 + 12345) % 2147483648;
  return s / 2147483648;
}

function makePool(nMatches: number, profile: RiskProfile): ComboLeg[] {
  const conf = PROFILES[profile];
  const legs: ComboLeg[] = [];
  const markets = ['1X2', 'Double Chance', 'O/U 2.5', 'O/U 1.5', 'BTTS'] as const;
  for (let m = 0; m < nMatches; m++) {
    const nMarkets = 2 + Math.floor(rnd() * 4); // 2..5 marchés par match
    for (let k = 0; k < nMarkets; k++) {
      const prob = conf.minProb + rnd() * (0.96 - conf.minProb);
      // cote cohérente avec la proba : entre 1/prob*0.85 et 1/prob*1.05
      const fair = 1 / prob;
      const odds = Math.min(conf.maxLegOdds, Math.max(1.04, fair * (0.85 + rnd() * 0.25)));
      if (odds > conf.maxLegOdds || odds < 1.04) continue;
      legs.push({
        matchId: `match-${m}`,
        leagueCode: 'eng.1',
        leagueShort: 'ENG',
        leagueName: 'Premier League',
        matchDate: new Date().toISOString(),
        homeName: `Home ${m}`,
        awayName: `Away ${m}`,
        market: markets[k % markets.length],
        pick: `Pick ${m}-${k}`,
        prob,
        odds,
        oddsSource: 'estimate',
        confidence: 1 + Math.floor(rnd() * 5),
      });
    }
  }
  return legs;
}

let failures = 0;
let total = 0;
const profiles: RiskProfile[] = ['prudent', 'equilibre', 'agressif'];
const targets = [2, 3, 5, 10, 20, 50];

for (const profile of profiles) {
  for (const nMatches of [4, 6, 8, 10, 12, 16, 20]) {
    for (const legsLimit of [2, 3, 4, 5, 6, 8]) {
      const pool = makePool(nMatches, profile);
      const maxOdds = maxAchievableOdds(pool, legsLimit, profile);
      for (const target of targets) {
        total++;
        const res = buildCombo(pool, target, legsLimit, profile, 1);
        if (res === null) continue; // hors de portée : acceptable si affiché comme tel
        const gap = target - res.comboOdds;
        if (gap > 0.005) {
          failures++;
          if (failures <= 12) {
            console.log(
              `ECHEC profil=${profile} matchs=${nMatches} limit=${legsLimit} cible=${target} ` +
                `cote=${res.comboOdds.toFixed(2)} (écart -${gap.toFixed(2)}) maxAtteignable=${maxOdds.toFixed(2)}`
            );
            console.log(
              '  jambes: ' +
                res.legs.map((l) => `${l.pick}@${l.odds.toFixed(2)}(p=${l.prob.toFixed(2)})`).join(' × ')
            );
          }
        }
      }
    }
  }
}

console.log(`\n=== Bilan : ${failures} échecs / ${total} tests ===`);
