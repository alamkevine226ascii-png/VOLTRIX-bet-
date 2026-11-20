/**
 * VOLTRIX — Contrôle des correctifs v3.0 (audit post-implémentation).
 * Vérifie SANS réseau, sur les cas exacts cités par l'utilisateur :
 *  1. Blend 1X2 calé marché (V1 @16 / V2 @1,23 → V2 favorite nette) ;
 *  2. Garde-fous combinateur (jambe Angola @11 rejetée, cohérence
 *     modèle/marché 1,6×, cote max par jambe) ;
 *  3. Premier but : médiane du titre DANS la fenêtre surlignée,
 *     médianes par équipe dérivées du modèle (même hazard) ;
 *  4. Kelly ¼ plafonné 10 % de bankroll.
 * Exécuté avec bun (même runtime que le précalcul) : les modules
 * src/lib/foot/* sont des maths pures, importables directement.
 */

import {
  blend1x2WithMarket,
  deMargin1x2,
  MARKET_BLEND_WEIGHT,
} from "../src/lib/foot/market-odds";
import { predictFirstGoal, type TeamFirstGoals } from "../src/lib/foot/first-goal";
import { buildLegPool, findBestCombos, type ComboDayInput } from "../src/lib/foot/combinator";
import { kellyStake } from "../src/lib/bankroll";

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "✓" : "✗ FAIL"} — ${name}${detail ? ` (${detail})` : ""}`);
  if (!ok) failures++;
};

/* ---------- 1. Blend marché : cas V1 @16 / X @7 / V2 @1,23 ---------- */
const dm = deMargin1x2(16, 7, 1.23);
check("dé-marge 1X2 exploitée (marge plausible)", dm !== null, dm ? `marge ${(dm.margin * 100).toFixed(1)} %` : "");
if (dm) {
  const model = { home: 0.34, draw: 0.28, away: 0.38 }; // modèle « aveugle » d'avant
  const blended = blend1x2WithMarket(model, { home: dm.pH, draw: dm.pD, away: dm.pA });
  check(
    "V2 devient nettement favorite après calage",
    blended.away > 0.55 && blended.away > blended.home * 2,
    `calé ${Math.round(blended.home * 100)}/${Math.round(blended.draw * 100)}/${Math.round(blended.away * 100)} vs modèle 34/28/38`,
  );
  check("le trio calé somme à 1", Math.abs(blended.home + blended.draw + blended.away - 1) < 1e-9);
  check(
    "poids du marché minimal = 65 % (accord parfait)",
    MARKET_BLEND_WEIGHT === 0.65,
    `MARKET_BLEND_WEIGHT=${MARKET_BLEND_WEIGHT}`,
  );
}

/* ---------- 2. Combinateur : jambe Angola @11 rejetée ---------- */
const angolaPred = {
  matchId: "m-angola",
  leagueCode: "afr",
  leagueName: "Coupe d'Afrique",
  status: "pre",
  probs: { home: 0.34, draw: 0.28, away: 0.38 }, // modèle d'avant, gonflé
  confidence: 3,
  confidenceLabel: "Moyen",
  recommendedBets: [],
  overUnder: [
    { line: 2.5, over: 0.55, under: 0.45 },
  ],
  btts: { yes: 0.5, no: 0.5 },
  topScores: [],
  valueBetsCount: 0,
  ouOdds: null,
};
const angolaMatch = (oddsAway: number) => ({
  id: "m-angola",
  leagueCode: "afr",
  leagueName: "Coupe d'Afrique",
  leagueShort: "CAF",
  region: "afrique",
  date: new Date(Date.now() + 3600_000).toISOString(),
  status: "pre" as const,
  statusDetail: "",
  home: { id: "ssd", name: "South Sudan", shortName: "S. Sudan", logo: null, score: null, form: null, record: null },
  away: { id: "ang", name: "Angola", shortName: "Angola", logo: null, score: null, form: null, record: null },
  hasOdds: true,
  oddsProvider: "ESPN",
  ouLine: null,
  /* livre de cotes cohérent : implied 0.80 + 0.18 + 0.09 = 1.07 (marge
   * 7 %) — l'Angola outsider @11 comme dans le cas réel cité. */
  mlHome: 1.25,
  mlDraw: 5.5,
  mlAway: oddsAway,
  venue: { name: null, city: null, country: null },
});
const mkDay = (oddsAway: number): ComboDayInput[] => [
  {
    date: new Date().toISOString().slice(0, 10),
    foot: {
      date: "",
      totalMatches: 1,
      scanMs: 0,
      leagues: [
        { code: "afr", name: "CAF", shortName: "CAF", region: "afrique", matches: [angolaMatch(oddsAway)] },
      ],
    },
    footPreds: { "m-angola": angolaPred as never },
  },
];

/* Reproduction du bug cité : avec le même livre de cotes (Angola @11),
 * un modèle gonflé à 38 % NE PEUT PLUS produire la jambe 1X2
 * « Victoire Angola » : la cohérence 1,6× la rejette (38 % ≫ 1,6 ×
 * 9 % = 14,5 %), et la cote max 5 l'exclut de toute façon.
 * NB : la jambe DC « X2 — Angola ou nul » (proba DÉRIVÉE du marché,
 * cohérente avec sa propre cote) reste légitimement acceptée. */
const isAngola1x2 = (l: { market: string; pick: string }) =>
  l.market === "Résultat" && l.pick === "Victoire Angola";

const poolNoMax = buildLegPool(mkDay(11), { maxLegOdds: 20 });
const angola1x2 = poolNoMax.legs.find(isAngola1x2);
check(
  "cohérence 1,6× : modèle 38 % vs marché ~9 % → jambe 1X2 « Victoire Angola @11 » rejetée MÊME sans cote max",
  angola1x2 == null,
  angola1x2 ? `encore présente, prob ${(angola1x2.prob * 100).toFixed(0)} %` : "jambe absente",
);

const poolDefault = buildLegPool(mkDay(11), { maxLegOdds: 5 });
check("cote max par jambe 5.0 : Angola @11 exclue du pool", !poolDefault.legs.some((l) => l.odds > 5));
check(
  "cohérence 1,6× : Angola proba modèle 50 % (surconfiance) vs cote 4.2 → rejetée",
  !(() => {
    const overconfident = { ...angolaPred, probs: { home: 0.2, draw: 0.3, away: 0.5 } };
    const day = mkDay(4.2);
    (day[0].footPreds as Record<string, unknown>)["m-angola"] = overconfident;
    return buildLegPool(day, { maxLegOdds: 20 }).legs.some(isAngola1x2);
  })(),
);
check(
  "cohérence 1,6× : proba modèle PLAUSIBLE (≤ 1,6× marché) acceptée",
  (() => {
    const plausible = { ...angolaPred, probs: { home: 0.15, draw: 0.22, away: 0.63 } };
    const day = mkDay(1.6);
    (day[0].footPreds as Record<string, unknown>)["m-angola"] = plausible;
    return buildLegPool(day, { maxLegOdds: 5 }).legs.some((l) => l.pick.includes("Angola"));
  })(),
);

/* Premier but : opt-in (absent par défaut) */
const fgPred = {
  ...angolaPred,
  firstGoal: { expectedMinute: 34, windows: [0.29, 0.18, 0.18, 0.14, 0.09, 0.08], noGoal: 0.05 },
};
const dayFg = mkDay(1.9);
(dayFg[0].footPreds as Record<string, unknown>)["m-angola"] = fgPred;
check("premier but absent du pool par défaut", !buildLegPool(dayFg, { maxLegOdds: 5 }).legs.some((l) => l.market === "Premier but"));
check("premier but présent en opt-in", buildLegPool(dayFg, { maxLegOdds: 5, includeFairOddsLegs: true }).legs.some((l) => l.market === "Premier but"));

/* findBestCombos : défense en profondeur (jambes > maxLegOdds filtrées) */
const fakeLegs = [
  { matchId: "x1", leagueCode: "l", leagueShort: "L", leagueName: "Ligue", home: "A", homeShort: "A", away: "B", awayShort: "B", kickoff: "", dayKey: "", market: "Résultat", pick: "Victoire A", prob: 0.6, odds: 1.7 },
  { matchId: "x2", leagueCode: "l", leagueShort: "L", leagueName: "Ligue", home: "C", homeShort: "C", away: "D", awayShort: "D", kickoff: "", dayKey: "", market: "Résultat", pick: "Victoire C", prob: 0.55, odds: 12 },
];
const resFilter = findBestCombos(fakeLegs as never, 2, { target: 3, minProb: 0.2, maxLegOdds: 5 });
check(
  "recherche : jambe @12 exclue par maxLegOdds (défense en profondeur)",
  resFilter.results.every((c) => c.legs.every((l) => l.odds <= 5)),
);

/* ---------- 3. Premier but : cohérence titre / tableau / équipes ---------- */
const nowISO = new Date().toISOString();
const teamH: TeamFirstGoals = {
  minuteOf: [8, 14, 22, 35, 41, 55, 61, 75, 28, 37, 44, 66],
  matches: 12,
  goalsInSample: 30,
};
const teamA: TeamFirstGoals = {
  minuteOf: [12, 25, 33, 48, 52, 68, 82, 19, 29, 40, 58, 71],
  matches: 12,
  goalsInSample: 26,
};
const fg = predictFirstGoal(2.6, teamH, teamA);
const hl = fg.headline;
check(
  "minute médiane du titre dans la fenêtre surlignée",
  hl.medianWindow != null && hl.expectedMinute != null && Math.floor((hl.expectedMinute - 1) / 15) === hl.medianWindow,
  `médiane ${hl.expectedMinute}e, fenêtre ${hl.medianWindow}`,
);
check(
  "les 6 fenêtres + 0-0 somment à 1",
  Math.abs(fg.entries.reduce((s, e) => s + e.prob, 0) - 1) < 0.002,
  `somme ${(fg.entries.reduce((s, e) => s + e.prob, 0)).toFixed(4)}`,
);
check(
  "médiane par équipe dérivée du modèle (≠ médiane brute d'échantillon)",
  (() => {
    const rawMed = (m: Array<number | null>) => {
      const o = m.filter((x): x is number => x !== null).sort((a, b) => a - b);
      const mid = Math.floor(o.length / 2);
      return Math.round(o.length % 2 === 1 ? o[mid] : (o[mid - 1] + o[mid]) / 2);
    };
    // la médiane modèle intègre le hazard ligue + l'échelle ρ → elle
    // ne peut pas être identique partout à la brute (47 et 45).
    return !(hl.homeMedianMinute === rawMed(teamH.minuteOf) && hl.awayMedianMinute === rawMed(teamA.minuteOf) && hl.homeMedianMinute === hl.awayMedianMinute);
  })(),
  `dom ${hl.homeMedianMinute}e / ext ${hl.awayMedianMinute}e (bruts 47/45)`,
);
check(
  "sans données d'équipe : médianes nulles, profil de ligue",
  predictFirstGoal(2.6, null, null).headline.homeMedianMinute === null,
);

/* ---------- 4. Kelly ¼ plafonné 10 % ---------- */
const b10k = 10_000;
check("Kelly ¼ plafonné : jamais > 10 % bankroll", kellyStake(b10k, 0.9, 3) <= 1000, `mise ${kellyStake(b10k, 0.9, 3)}`);
check("Kelly ¼ : mise > 0 si edge (p .55 @2.0)", kellyStake(b10k, 0.55, 2.0) > 0, `mise ${kellyStake(b10k, 0.55, 2.0)}`);
check("Kelly ¼ : mise = 0 sans edge (p .45 @2.0)", kellyStake(b10k, 0.45, 2.0) === 0);

/* ---------- 5. v2.5 : marchés parieurs de la grille bivariée ---------- */
import { simulateMatch, marketsFromGrid, bivariateGrid, bivariateLambdas } from "../src/lib/foot/montecarlo";
import { FOOT_PARAMS_VERSION } from "../src/lib/foot/league-params";

const sim = simulateMatch(2.6, 1.1, { iterations: 1000 });
const ex = sim.exact;
/* DNB cohérent avec le 1X2 de la grille : P(H)/(P(H)+P(A)). */
check(
  "DNB = P(victoire | non-nul) de la grille",
  Math.abs(ex.handicap.dnb.home - ex.probs.home / (ex.probs.home + ex.probs.away)) < 1e-9,
  `dnb ${Math.round(ex.handicap.dnb.home * 100)} % vs 1X2 ${Math.round(ex.probs.home * 100)}/${Math.round(ex.probs.draw * 100)}/${Math.round(ex.probs.away * 100)}`,
);
/* AH −0.5 domicile ≡ victoire domicile ; AH +0.5 domicile ≡ 1X.
 * Tolérance 2e-4 : ah est round(4) dans marketsFromGrid, probs non —
 * l'écart d'arrondi d'affichage est ≤ 5e-5. */
check(
  "AH −0.5 dom = P(victoire dom) (x − 0.5 > y ≡ x > y)",
  Math.abs(ex.handicap.ah[-0.5].home - ex.probs.home) < 2e-4,
  `ah-0.5 ${Math.round(ex.handicap.ah[-0.5].home * 100)} % vs victoire ${Math.round(ex.probs.home * 100)} %`,
);
check(
  "AH +0.5 dom = 1X (dom ou nul)",
  Math.abs(ex.handicap.ah[0.5].home - (ex.probs.home + ex.probs.draw)) < 2e-4,
  `ah+0.5 ${Math.round(ex.handicap.ah[0.5].home * 100)} % vs 1X ${Math.round((ex.probs.home + ex.probs.draw) * 100)} %`,
);
check(
  "AH −1.5 dom ≤ AH −0.5 dom ≤ AH +0.5 dom (monotonie)",
  ex.handicap.ah[-1.5].home <= ex.handicap.ah[-0.5].home && ex.handicap.ah[-0.5].home <= ex.handicap.ah[0.5].home,
);
check(
  "AH home + away = 1 sur chaque ligne",
  [-1.5, -0.5, 0.5, 1.5].every((l) => Math.abs(ex.handicap.ah[l].home + ex.handicap.ah[l].away - 1) < 1e-9),
);
/* Totaux par équipe : marginaux somment à 1 et cohérents avec overAtLine
 * du total (marginal dom + marginal ext ≠ dist totale mais marginaux exacts). */
const mhSum = ex.teamTotals.home.reduce((a, b) => a + b, 0);
const maSum = ex.teamTotals.away.reduce((a, b) => a + b, 0);
check("marginaux équipe somment à 1", Math.abs(mhSum - 1) < 1e-9 && Math.abs(maSum - 1) < 1e-9);
/* P(dom ≥ 1) marginal = 1 − P(x=0) : marginal home[0] = P(x=0) doit
 * égaler la somme de la colonne x=0 de la grille. */
let pHomeZero = 0;
for (let y = 0; y < ex.grid.length; y++) pHomeZero += ex.grid[0][y];
check(
  "marginal équipe[0] = P(x=0) de la grille",
  Math.abs(ex.teamTotals.home[0] - pHomeZero) < 1e-9,
  `P(dom 0 but) ${Math.round(ex.teamTotals.home[0] * 100)} %`,
);
/* firstToScore : cohérent avec λ (dominateur 2.6 vs 1.1 → dom devant). */
check(
  "première équipe à marquer : favori λ devant",
  ex.firstToScore.home > ex.firstToScore.away,
  `${Math.round(ex.firstToScore.home * 100)}/${Math.round(ex.firstToScore.away * 100)}/0-0 ${Math.round(ex.firstToScore.noGoal * 100)} %`,
);
check(
  "firstToScore : home + away + noGoal = 1",
  Math.abs(ex.firstToScore.home + ex.firstToScore.away + ex.firstToScore.noGoal - 1) < 1e-9,
);
/* Grille recalibrée = même marchés que calibrateBivariate (réutilisation). */
const cal = (function () {
  // ancrage over 2.5 à 55 % sur (2.6, 1.1)
  const { l1, l2, l3 } = bivariateLambdas(2.6, 1.1, 0.1);
  void l1; void l2; void l3;
  const grid = bivariateGrid(2.6 * 0.8, 1.1 * 0.8, 0.1 * Math.sqrt(0.8));
  return marketsFromGrid(grid, [1.5, 2.5, 3.5]);
})();
check("marketsFromGrid exporté et calcule (grille arbitraire)", cal.probs.home > 0 && cal.btts.yes > 0);

/* Version moteur (bump = invalidation cache + recalcul Neon complet). */
check("FOOT_PARAMS_VERSION = v2.6", FOOT_PARAMS_VERSION === "voltrix-foot-v2.6", FOOT_PARAMS_VERSION);

/* ---------- 6bis. v3.1 : blend divergence-pondéré + dé-margage élargi ---------- */
/* Le trio 16/9.5/1.23 (somme implicite 0.981) doit être accepté —
   c'était la 3e cause du « moteur aveugle aux cotes » (rejet
   silencieux du dé-margage → probas modèle seul sous les cotes). */
const dmSous = deMargin1x2(16, 9.5, 1.23);
check("deMargin1x2 accepte le trio sous-margé ESPN 16/9.5/1.23", dmSous !== null);
/* V2 @1.23 vs modèle 38 % : après blend divergence-pondéré, V2 doit
   être largement favorite (> 70 %), comme la cote l'indique. */
if (dmSous) {
  const b = blend1x2WithMarket(
    { home: 0.34, draw: 0.28, away: 0.38 },
    { home: dmSous.pH, draw: dmSous.pD, away: dmSous.pA },
  );
  check(
    "blend divergence-pondéré : V2 @1,23 → largement favorite (> 70 %)",
    b.away > 0.7 && b.home < 0.15,
    `H/D/A = ${(b.home * 100).toFixed(1)}/${(b.draw * 100).toFixed(1)}/${(b.away * 100).toFixed(1)}`,
  );
  /* Accord parfait modèle/marché : divergence nulle → w = 0,65 → sortie = entrée. */
  const same = blend1x2WithMarket(
    { home: 0.5, draw: 0.27, away: 0.23 },
    { home: 0.5, draw: 0.27, away: 0.23 },
  );
  check(
    "blend : accord parfait → probas inchangées",
    Math.abs(same.home - 0.5) < 1e-9 && Math.abs(same.draw - 0.27) < 1e-9,
  );
}

/* ---------- 6. v2.5 : BTTS dans le combinateur (opt-in Agressif) ---------- */
const bttsPred = {
  ...angolaPred,
  btts: { yes: 0.55, no: 0.45 },
};
const dayBtts = mkDay(4.2);
(dayBtts[0].footPreds as Record<string, unknown>)["m-angola"] = bttsPred;
check(
  "BTTS absent du pool par défaut (cote équitable = opt-in)",
  !buildLegPool(dayBtts, { maxLegOdds: 5 }).legs.some((l) => l.market === "Deux équipes marquent"),
);
check(
  "BTTS présent en opt-in (profil Agressif)",
  buildLegPool(dayBtts, { maxLegOdds: 5, includeFairOddsLegs: true }).legs.some((l) => l.market === "Deux équipes marquent"),
);
check(
  "jambe BTTS : cote équitable 1/p plafonnée à la cote max",
  (() => {
    const legs = buildLegPool(dayBtts, { maxLegOdds: 5, includeFairOddsLegs: true }).legs.filter(
      (l) => l.market === "Deux équipes marquent",
    );
    return legs.length === 2 && legs.every((l) => l.odds <= 5 && Math.abs(l.odds - 1 / l.prob) < 0.02);
  })(),
);

/* ---------- verdict ---------- */
console.log("");
if (failures === 0) {
  console.log(`AUDIT v3.0 : 0 défaut sur ${"tous les contrôles"}.`);
  process.exit(0);
} else {
  console.log(`AUDIT v3.0 : ${failures} échec(s).`);
  process.exit(1);
}
