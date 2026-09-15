// Test du module live-prob — exécuter : bun scripts/test-live-prob.ts
import {
  legLiveProb,
  parseClockMinutes,
  remainingFraction,
  DEFAULT_TOTAL_LAMBDA,
} from '../src/lib/live-prob';

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

console.log('— Poisson / inversion λ —');

// 1. Proba initiale retrouvée quand le match n'a pas commencé
{
  const p = legLiveProb({ market: 'O/U 2.5', pick: 'Moins de 2.5 buts', prob: 0.55 }, { phase: 'pre', homeScore: null, awayScore: null, clock: null });
  check('pre → proba inchangée (O/U under 0.55)', Math.abs(p - 0.55) < 1e-9, `got ${p}`);
}

// 2. Live, 0-0, début de match (5') → proche de la proba initiale
{
  const p0 = legLiveProb({ market: 'O/U 2.5', pick: 'Moins de 2.5 buts', prob: 0.55 }, { phase: 'in', homeScore: 0, awayScore: 0, clock: "5'" });
  check('live 0-0 à la 5e ≈ proba initiale (under 2.5)', Math.abs(p0 - 0.55) < 0.06, `got ${p0}`);
}

// 3. Live, 0-0, 85e → under 2.5 quasi certain
{
  const p = legLiveProb({ market: 'O/U 2.5', pick: 'Moins de 2.5 buts', prob: 0.55 }, { phase: 'in', homeScore: 0, awayScore: 0, clock: "85'" });
  check('live 0-0 à la 85e → under 2.5 > 0.95', p > 0.95, `got ${p}`);
}

// 4. Live, 3 buts déjà à la 60e → under 2.5 impossible
{
  const p = legLiveProb({ market: 'O/U 2.5', pick: 'Moins de 2.5 buts', prob: 0.55 }, { phase: 'in', homeScore: 2, awayScore: 1, clock: "60'" });
  check('live 2-1 à la 60e → under 2.5 = 0', p === 0, `got ${p}`);
}

// 5. Over 2.5 symétrique : 2-1 à la 60e → over déjà gagnant
{
  const p = legLiveProb({ market: 'O/U 2.5', pick: 'Plus de 2.5 buts', prob: 0.45 }, { phase: 'in', homeScore: 2, awayScore: 1, clock: "60'" });
  check('live 2-1 à la 60e → over 2.5 = 1', p === 1, `got ${p}`);
}

// 6. 1X2 home : 2-0 à la 80e → victoire home quasi certaine
{
  const p = legLiveProb({ market: '1X2', pick: 'Victoire Paris', prob: 0.55 }, { phase: 'in', homeScore: 2, awayScore: 0, clock: "80'" }, 'home');
  check('live 2-0 à la 80e → P(home win) > 0.98', p > 0.98, `got ${p}`);
}

// 7. 1X2 away : 2-0 à la 80e → victoire away quasi impossible
{
  const p = legLiveProb({ market: '1X2', pick: 'Victoire Marseille', prob: 0.2 }, { phase: 'in', homeScore: 2, awayScore: 0, clock: "80'" }, 'away');
  check('live 2-0 à la 80e → P(away win) < 0.02', p < 0.02, `got ${p}`);
}

// 8. 1X2 nul : 1-1 à la 80e → nul plus probable que pré-match (λ restants faibles)
{
  const pLive = legLiveProb({ market: '1X2', pick: 'Match nul', prob: 0.25 }, { phase: 'in', homeScore: 1, awayScore: 1, clock: "80'" }, 'draw');
  check('live 1-1 à la 80e → P(nul) > 0.35', pLive > 0.35, `got ${pLive}`);
}

// 9. DC 1X : 0-1 à la 85e → 1X en danger (home doit égaliser)
{
  const p = legLiveProb({ market: 'Double Chance', pick: 'Paris ou Nul (1X)', prob: 0.7 }, { phase: 'in', homeScore: 0, awayScore: 1, clock: "85'" });
  check('live 0-1 à la 85e → P(1X) < 0.25', p < 0.25, `got ${p}`);
}

// 10. BTTS Oui : 1-0 à la 70e → l\u2019équipe à domicile a déjà marqué, l\u2019autre doit marquer
{
  const p = legLiveProb({ market: 'BTTS', pick: 'Les 2 équipes marquent : Oui', prob: 0.5 }, { phase: 'in', homeScore: 1, awayScore: 0, clock: "70'" });
  check('live 1-0 à la 70e → P(BTTS oui) entre 0.05 et 0.5', p > 0.05 && p < 0.5, `got ${p}`);
}

// 11. BTTS Oui : 1-1 à la 70e → déjà réalisé = 1
{
  const p = legLiveProb({ market: 'BTTS', pick: 'Les 2 équipes marquent : Oui', prob: 0.5 }, { phase: 'in', homeScore: 1, awayScore: 1, clock: "70'" });
  check('live 1-1 → P(BTTS oui) = 1', p === 1, `got ${p}`);
}

// 12. BTTS Non : 1-1 → 0
{
  const p = legLiveProb({ market: 'BTTS', pick: 'Les 2 équipes marquent : Non', prob: 0.5 }, { phase: 'in', homeScore: 1, awayScore: 1, clock: "70'" });
  check('live 1-1 → P(BTTS non) = 0', p === 0, `got ${p}`);
}

// 13. Cohérence par somme 1X2 (pre-phase, via Poisson pur) :
//     P(home)+P(draw)+P(away) reconstruits depuis legLiveProb ≈ 1
{
  const h = legLiveProb({ market: '1X2', pick: 'Victoire A', prob: 0.45 }, { phase: 'pre', homeScore: null, awayScore: null, clock: null }, 'home');
  const d = legLiveProb({ market: '1X2', pick: 'Match nul', prob: 0.27 }, { phase: 'pre', homeScore: null, awayScore: null, clock: null }, 'draw');
  const a = legLiveProb({ market: '1X2', pick: 'Victoire B', prob: 0.28 }, { phase: 'pre', homeScore: null, awayScore: null, clock: null }, 'away');
  check('probas 1X2 transmises inchangées en pre (somme 1)', Math.abs(h - 0.45) < 1e-9 && Math.abs(d - 0.27) < 1e-9 && Math.abs(a - 0.28) < 1e-9);
}

// 14. Score null en live → repli proba initiale
{
  const p = legLiveProb({ market: '1X2', pick: 'Victoire A', prob: 0.6 }, { phase: 'in', homeScore: null, awayScore: null, clock: "30'" }, 'home');
  check('live sans score → proba initiale', Math.abs(p - 0.6) < 1e-9, `got ${p}`);
}

// 15. phase post → renvoie leg.prob (l'appelant binaire fait le reste)
{
  const p = legLiveProb({ market: '1X2', pick: 'Victoire A', prob: 0.6 }, { phase: 'post', homeScore: 2, awayScore: 1, clock: "FT" }, 'home');
  check('post → proba transmise telle quelle', Math.abs(p - 0.6) < 1e-9);
}

console.log('— Horloge —');
check("parseClockMinutes(\"63'\") = 63", parseClockMinutes("63'") === 63);
check("parseClockMinutes(\"45'+2'\") = 45", parseClockMinutes("45'+2'") === 45);
check("parseClockMinutes('HT') = 45", parseClockMinutes('HT') === 45);
check("parseClockMinutes('Fin du match') = null", parseClockMinutes('Fin du match') === null);
check('remainingFraction 85 min ≈ 0.19', Math.abs(remainingFraction("85'", 'in') - (1 - 85 / 105)) < 1e-9);
check('remainingFraction pre = 1', remainingFraction(null, 'pre') === 1);
check('remainingFraction post = 0', remainingFraction(null, 'post') === 0);

console.log('— Monotonie du temps (le modèle se comporte comme un vrai match) —');
// Un favori qui mène 1-0 : sa proba doit MONTER avec le temps qui passe
{
  const probs = ["5'", "30'", "60'", "80'"].map((c) =>
    legLiveProb({ market: '1X2', pick: 'Victoire A', prob: 0.55 }, { phase: 'in', homeScore: 1, awayScore: 0, clock: c }, 'home')
  );
  const monotone = probs[0] < probs[1] && probs[1] < probs[2] && probs[2] < probs[3];
  check('1-0 en faveur du pick : proba croissante avec le temps', monotone, `${probs.map((x) => x.toFixed(3)).join(' < ')}`);
}
// Un outsider mené 0-1 : sa proba doit BAISSER avec le temps qui passe
{
  const probs = ["5'", "30'", "60'", "80'"].map((c) =>
    legLiveProb({ market: '1X2', pick: 'Victoire B', prob: 0.3 }, { phase: 'in', homeScore: 1, awayScore: 0, clock: c }, 'away')
  );
  const decreasing = probs[0] > probs[1] && probs[1] > probs[2] && probs[2] > probs[3];
  check('0-1 contre le pick : proba décroissante avec le temps', decreasing, `${probs.map((x) => x.toFixed(3)).join(' > ')}`);
}

// Λ par défaut documenté
check('DEFAULT_TOTAL_LAMBDA = 2.6', DEFAULT_TOTAL_LAMBDA === 2.6);

console.log(`\nRésultat : ${pass} OK, ${fail} échec(s)`);
process.exit(fail > 0 ? 1 : 0);
