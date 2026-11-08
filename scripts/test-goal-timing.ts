/* ============================================================
   VOLTRIX bet — Tests du modèle de minute du 1er but (goal-timing)
   Exécution : cd /home/z/my-project && bun run scripts/test-goal-timing.ts
   - maths pures : firstGoalTimingFromHazard, blendGoalTiming,
     goalTimingBasis, goalWindowFromClock, firstToScoreProbs ;
   - intégration runEngine (basis 'equipes'/'ligue'/'modele', invariants) ;
   - vérification réseau de bout en bout (fetchTeamGoalTiming sur une
     vraie équipe ESPN) — informative, ne fait pas échouer les maths.
   ============================================================ */

import {
  LEAGUE_BASELINE_SHARES,
  blendGoalTiming,
  fetchTeamGoalTiming,
  firstGoalTimingFromHazard,
  goalTimingBasis,
  goalWindowFromClock,
  type TeamGoalTiming,
} from "../src/lib/foot/goal-timing";
import {
  firstGoalTimingProbs,
  firstToScoreProbs,
  runEngine,
  type EngineInput,
} from "../src/lib/foot/prediction";
import { fetchScoreboard } from "../src/lib/foot/espn";
import type { EspnScheduleGame } from "../src/lib/foot/espn";

/* ESPN bloque les clients non-navigateurs sans User-Agent (vérifié : bun
   fetch nu → 403, avec « Mozilla/5.0 » → 200 ; les navigateurs, seules
   cibles de production, envoient toujours leur propre UA). Le patch
   ci-dessous ne sert qu'à l'exécution hors navigateur de CE script —
   le code de production (src/lib) n'est pas modifié. */
const origFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const headers = new Headers(init?.headers);
  if (!headers.has("User-Agent")) headers.set("User-Agent", "Mozilla/5.0");
  return origFetch(input, { ...init, headers });
}) as typeof fetch;

let failures = 0;

function check(name: string, cond: boolean, detail?: string): void {
  if (cond) {
    console.log(`  ok  ${name}`);
  } else {
    failures++;
    console.error(`  ÉCHEC  ${name}${detail !== undefined ? ` — ${detail}` : ""}`);
  }
}

const fmt = (entries: Array<{ window: string; prob: number }>): string =>
  entries.map((e) => `${e.window}:${(e.prob * 100).toFixed(2)}%`).join("  ");

// Distribution EMPIRIQUE du 1er but sur l'échantillon de référence
// (66 matchs, 168 buts, 1er-8 nov. 2026 — voir goal-timing.ts).
const EMPIRICAL_FIRST_GOAL = [0.2879, 0.1818, 0.1818, 0.1364, 0.0909, 0.0758, 0.0455];

function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}

/* ---------- 1. Parsing des horloges ESPN ---------- */

console.log("\n[1] goalWindowFromClock");
check(`"72'" → fenêtre 4 (61-75)`, goalWindowFromClock("72'") === 4);
check(`"16'" → fenêtre 1 (16-30)`, goalWindowFromClock("16'") === 1);
check(`"15'" → fenêtre 0 (0-15)`, goalWindowFromClock("15'") === 0);
check(`"45'+2'" → fenêtre 2 (31-45, arrêt de jeu 1re MT)`, goalWindowFromClock("45'+2'") === 2);
check(`"90'+5'" → fenêtre 5 (76-90, arrêt de jeu 2e MT)`, goalWindowFromClock("90'+5'") === 5);
check(`"105'" → fenêtre 5 (prolongation rabattue)`, goalWindowFromClock("105'") === 5);
check(`"120'" → fenêtre 5 (tirs au but exclus, prolongation)`, goalWindowFromClock("120'") === 5);
check(`"abc" → null`, goalWindowFromClock("abc") === null);
check(`chaîne vide → null`, goalWindowFromClock("") === null);
check(`"0'" → null`, goalWindowFromClock("0'") === null);

/* ---------- 2. Baseline empirique ---------- */

console.log("\n[2] LEAGUE_BASELINE_SHARES");
const base = [...LEAGUE_BASELINE_SHARES];
check("6 fenêtres", base.length === 6);
check(`somme = 1 à 1e-9`, Math.abs(sum(base) - 1) < 1e-9, `somme=${sum(base)}`);
check("toutes dans (0,1)", base.every((s) => s > 0 && s < 1));
check(
  "tendance réaliste : fenêtres tardives ≥ fenêtres précoces",
  base[5] > base[0] && base[4] > base[1] && base[5] > base[2] && base[2] > base[0],
  fmt(base.map((p, i) => ({ window: String(i), prob: p })))
);

/* ---------- 3. firstGoalTimingFromHazard : λ = 2.7 ---------- */

console.log("\n[3] firstGoalTimingFromHazard — λ=2.7, shares baseline");
const h27 = firstGoalTimingFromHazard(2.7, base);
console.log(`  ${fmt(h27)}`);
check("7 entrées (6 fenêtres + NO_GOAL)", h27.length === 7 && h27[6].window === "NO_GOAL");
check(
  `somme des 7 = 1 à 1e-9`,
  Math.abs(sum(h27.map((e) => e.prob)) - 1) < 1e-9,
  `somme=${sum(h27.map((e) => e.prob))}`
);
check("aucune NaN, toutes dans [0,1]", h27.every((e) => Number.isFinite(e.prob) && e.prob >= 0 && e.prob <= 1));
check(
  `NO_GOAL ≈ e^−2.7 = 0.0672`,
  Math.abs(h27[6].prob - Math.exp(-2.7)) < 5e-4,
  `obtenu ${h27[6].prob}`
);
check(
  "fenêtre 0-15 = max des fenêtres (1er but le plus probable tôt, comme dans l'échantillon réel)",
  h27[0].prob === Math.max(...h27.slice(0, 6).map((e) => e.prob))
);
// Comparaison au modèle homogène (l'ancien) et à la distribution empirique :
// le hazard par morceaux doit être PLUS proche de la réalité.
const hom27 = firstGoalTimingProbs(2.7);
const distTo = (probs: number[]): number =>
  probs.slice(0, 6).reduce((acc, p, i) => acc + Math.abs(p - EMPIRICAL_FIRST_GOAL[i]), 0);
const dHazard = distTo(h27.map((e) => e.prob));
const dHomog = distTo(hom27.map((e) => e.prob));
console.log(`  distance L1 aux 6 fenêtres empiriques : hazard=${dHazard.toFixed(4)} vs homogène=${dHomog.toFixed(4)}`);
check("hazard plus proche de l'empirique que l'homogène", dHazard < dHomog);
check(
  "corrige la sous-estimation des fenêtres tardives : P(76-90) hazard > homogène",
  h27[5].prob > hom27[5].prob,
  `${h27[5].prob} vs ${hom27[5].prob}`
);
check(
  "corrige la sur-estimation de la fenêtre 0-15 : P(0-15) hazard < homogène",
  h27[0].prob < hom27[0].prob,
  `${h27[0].prob} vs ${hom27[0].prob}`
);

/* ---------- 4. Cas limites λ = 0.2 et λ = 4 ---------- */

console.log("\n[4] cas limites");
const h02 = firstGoalTimingFromHazard(0.2, base);
console.log(`  λ=0.2 : ${fmt(h02)}`);
check(`λ=0.2 : somme = 1 à 1e-9`, Math.abs(sum(h02.map((e) => e.prob)) - 1) < 1e-9);
check("λ=0.2 : NO_GOAL dominant (≈ e^−0.2 = 0.819)", h02[6].prob > 0.8 && Math.abs(h02[6].prob - Math.exp(-0.2)) < 5e-4);
check("λ=0.2 : aucune NaN", h02.every((e) => Number.isFinite(e.prob)));

const h4 = firstGoalTimingFromHazard(4, base);
console.log(`  λ=4   : ${fmt(h4)}`);
check(`λ=4 : somme = 1 à 1e-9`, Math.abs(sum(h4.map((e) => e.prob)) - 1) < 1e-9);
check("λ=4 : NO_GOAL ≈ e^−4 = 0.018", Math.abs(h4[6].prob - Math.exp(-4)) < 5e-4);
check("λ=4 : P(0-15) ≈ 1−e^−(4×0.125) = 0.393", Math.abs(h4[0].prob - (1 - Math.exp(-0.5))) < 5e-4);
check("λ=4 : aucune NaN", h4.every((e) => Number.isFinite(e.prob)));

// Entrées dégradées : pas de NaN, repli baseline.
const hBad = firstGoalTimingFromHazard(Number.NaN, [0, 0, 0, 0, 0, 0]);
check("λ=NaN + shares nulles : aucune NaN, somme = 1", hBad.every((e) => Number.isFinite(e.prob)) && Math.abs(sum(hBad.map((e) => e.prob)) - 1) < 1e-9);
check(
  "shares invalides → repli baseline (même sortie que la baseline)",
  JSON.stringify(firstGoalTimingFromHazard(2.7, [1, 2, 3])) === JSON.stringify(firstGoalTimingFromHazard(2.7, base))
);

/* ---------- 5. blendGoalTiming asymétrique ---------- */

console.log("\n[5] blendGoalTiming — équipes asymétriques");
const earlyTeam: TeamGoalTiming = { windowGoals: [10, 2, 2, 2, 2, 2], totalGoals: 20, matches: 10 };
const lateTeam: TeamGoalTiming = { windowGoals: [0, 0, 0, 0, 0, 30], totalGoals: 30, matches: 10 };
const blended = blendGoalTiming(earlyTeam, lateTeam);
console.log(`  shares fusionnées : ${blended.shares.map((s) => s.toFixed(4)).join(" ")}`);
check("somme des shares = 1 à 1e-9", Math.abs(sum(blended.shares) - 1) < 1e-9);
check("basis 'equipes', sampleGoals = 50", blended.basis === "equipes" && blended.sampleGoals === 50);
// Équipe « précoce » tire la fenêtre 0-15 vers le haut, équipe « tardive » la 76-90.
check("fenêtre 0-15 > baseline (équipe précoce)", blended.shares[0] > base[0]);
check("fenêtre 76-90 > baseline (équipe tardive)", blended.shares[5] > base[5]);
check("aucune NaN", blended.shares.every((s) => Number.isFinite(s)));

const homeOnly = blendGoalTiming(earlyTeam, null);
check(
  "une seule équipe : sampleGoals = 20, fenêtre 0-15 tirée vers le haut",
  homeOnly.basis === "equipes" && homeOnly.sampleGoals === 20 && homeOnly.shares[0] > base[0]
);
const noData = blendGoalTiming(null, null);
check(
  "aucune équipe → baseline pure, basis 'ligue'",
  noData.basis === "ligue" && noData.sampleGoals === 0 && Math.abs(sum(noData.shares) - 1) < 1e-9
);
const zeroGoals = blendGoalTiming({ windowGoals: [0, 0, 0, 0, 0, 0], totalGoals: 0, matches: 8 }, null);
check("données fournies mais 0 but → baseline pure, basis 'ligue'", zeroGoals.basis === "ligue" && zeroGoals.sampleGoals === 0);

/* ---------- 6. goalTimingBasis ---------- */

console.log("\n[6] goalTimingBasis");
check("(null, null) → 'modele'", goalTimingBasis(null, null).basis === "modele");
check("(équipe avec buts, null) → 'equipes'", goalTimingBasis(earlyTeam, null).basis === "equipes");
check(
  "(0 but, 0 but) → 'ligue'",
  goalTimingBasis({ windowGoals: [0, 0, 0, 0, 0, 0], totalGoals: 0, matches: 5 }, null).basis === "ligue"
);
check("sampleGoals = somme des buts", goalTimingBasis(earlyTeam, lateTeam).sampleGoals === 50);

/* ---------- 7. firstToScoreProbs : somme exacte ---------- */

console.log("\n[7] firstToScoreProbs");
for (const [lh, la] of [
  [1.5, 1.2],
  [0.3, 0.25],
  [3.8, 3.4],
  [0.02, 2.0],
]) {
  const f = firstToScoreProbs(lh, la);
  check(
    `λ=(${lh}, ${la}) : home+away+noGoal = 1 exactement`,
    Math.abs(f.home + f.away + f.noGoal - 1) < 1e-12,
    `somme=${f.home + f.away + f.noGoal}`
  );
}

/* ---------- 8. Intégration runEngine ---------- */

console.log("\n[8] runEngine — intégration goalTiming");

function synthSchedule(teamId: string, oppId: string, n: number): EspnScheduleGame[] {
  const games: EspnScheduleGame[] = [];
  for (let i = 0; i < n; i++) {
    const day = new Date(Date.now() - (i + 2) * 4 * 86400000).toISOString();
    games.push({
      eventId: `synth-${teamId}-${i}`,
      date: day,
      opponentId: `opp-${i % 3}`,
      opponentName: `Adversaire ${i}`,
      homeAway: i % 2 === 0 ? "home" : "away",
      teamScore: (i * 7) % 4,
      opponentScore: (i * 5) % 3,
      completed: true,
      leagueCode: "eng.1",
    });
  }
  void oppId;
  return games;
}

const baseInput: EngineInput = {
  homeTeam: { id: "H1", name: "Home FC", logo: null, schedule: synthSchedule("H1", "A1", 14), standings: null },
  awayTeam: { id: "A1", name: "Away FC", logo: null, schedule: synthSchedule("A1", "H1", 14), standings: null },
  injuries: [],
  odds: null,
  isDerby: false,
  weatherImpact: null,
  nowMs: Date.now(),
  leagueTeamsCount: 20,
};

// a) sans goalTiming → repli homogène étiqueté 'modele'
const runModele = runEngine(baseInput);
const fgModele = runModele.prediction.firstGoalTiming;
check("sans goalTiming : 7 entrées, toutes basis 'modele'", fgModele.length === 7 && fgModele.every((e) => e.basis === "modele" && e.sampleGoals === 0));
check("sans goalTiming : somme = 1", Math.abs(sum(fgModele.map((e) => e.prob)) - 1) < 1e-9);

// b) avec histogrammes d'équipes → hazard étiqueté 'equipes'
const runEquipes = runEngine({
  ...baseInput,
  goalTiming: { home: earlyTeam, away: lateTeam },
});
const fgEquipes = runEquipes.prediction.firstGoalTiming;
check("avec goalTiming : toutes basis 'equipes', sampleGoals = 50", fgEquipes.every((e) => e.basis === "equipes" && e.sampleGoals === 50));
check("avec goalTiming : somme = 1", Math.abs(sum(fgEquipes.map((e) => e.prob)) - 1) < 1e-9);
check(
  "avec goalTiming : distribution DIFFÈRE du repli homogène (les vraies minutes comptent)",
  fgEquipes.some((e, i) => Math.abs(e.prob - fgModele[i].prob) > 1e-4)
);
console.log(`  hazard équipes : ${fmt(fgEquipes)}`);

// c) goalTiming fourni mais sans but → baseline, 'ligue'
const runLigue = runEngine({
  ...baseInput,
  goalTiming: { home: { windowGoals: [0, 0, 0, 0, 0, 0], totalGoals: 0, matches: 8 }, away: null },
});
check("goalTiming 0 but : toutes basis 'ligue'", runLigue.prediction.firstGoalTiming.every((e) => e.basis === "ligue" && e.sampleGoals === 0));

// d) invariants numériques globaux du moteur (récursion anti-NaN)
function hasNaN(x: unknown): boolean {
  if (typeof x === "number") return !Number.isFinite(x);
  if (Array.isArray(x)) return x.some(hasNaN);
  if (x && typeof x === "object") return Object.values(x).some(hasNaN);
  return false;
}
for (const [label, r] of [["'equipes'", runEquipes], ["'modele'", runModele]] as const) {
  check(`run ${label} : aucune NaN dans toute la sortie`, !hasNaN(r.prediction));
  check(
    `run ${label} : 1X2 somme = 1`,
    Math.abs(r.prediction.probs.home + r.prediction.probs.draw + r.prediction.probs.away - 1) < 1e-9
  );
  check(
    `run ${label} : over+under = 1 sur les 3 lignes`,
    r.prediction.overUnder.every((o) => Math.abs(o.over + o.under - 1) < 1e-9)
  );
  check(
    `run ${label} : btts oui+non = 1`,
    Math.abs(r.prediction.btts.yes + r.prediction.btts.no - 1) < 1e-9
  );
}

/* ---------- 9. Vérification réseau de bout en bout (informative) ---------- */

console.log("\n[9] fetchTeamGoalTiming — bout en bout réseau (ESPN)");
(async () => {
  try {
    let teamId: string | null = null;
    let teamName = "";
    for (let d = 1; d <= 4 && !teamId; d++) {
      const day = new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
      const board = await fetchScoreboard("eng.1", day);
      const done = board?.events.find((e) => e.completed && e.home);
      if (done?.home) {
        teamId = done.home.team.id;
        teamName = done.home.team.displayName;
      }
    }
    if (!teamId) {
      console.warn("  (aucun match terminé trouvé sur eng.1 ces 4 derniers jours — section informative ignorée)");
    } else {
      const seasons = [2025, 2026];
      const beforeISO = new Date(Date.now() + 86400000).toISOString();
      const timing = await fetchTeamGoalTiming("eng.1", teamId, seasons, beforeISO);
      if (!timing) {
        console.warn(`  (aucun histogramme pour ${teamName} — section informative ignorée)`);
      } else {
        console.log(`  ${teamName} (eng.1) : ${timing.matches} matchs parsés, ${timing.totalGoals} buts`);
        console.log(`  fenêtres : ${timing.windowGoals.join(" / ")}`);
        const bl = blendGoalTiming(timing, null);
        const basis = goalTimingBasis(timing, null);
        console.log(`  basis=${basis.basis} sampleGoals=${basis.sampleGoals} shares=${bl.shares.map((s) => s.toFixed(3)).join(" ")}`);
        console.log(`  hazard λ=2.7 : ${fmt(firstGoalTimingFromHazard(2.7, bl.shares))}`);
        check(
          "e2e : histogramme cohérent (6 fenêtres, buts = somme, matches > 0)",
          timing.windowGoals.length === 6 && timing.totalGoals === sum(timing.windowGoals) && timing.matches > 0
        );
      }
    }
  } catch (err) {
    console.warn(`  (réseau indisponible : ${(err as Error).message} — les maths restent validées ci-dessus)`);
  }

  /* ---------- Bilan ---------- */
  console.log(`\n${failures === 0 ? "TOUS LES TESTS PASSENT" : `${failures} ÉCHEC(S)`}`);
  process.exit(failures === 0 ? 0 : 1);
})();
