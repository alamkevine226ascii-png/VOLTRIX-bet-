/* Sanity check du moteur 1er but : maths pures, sans réseau. */
import { predictFirstGoal, type TeamFirstGoals, GOAL_WINDOWS } from "../src/lib/foot/first-goal";

function fmt(p: number) {
  return (p * 100).toFixed(1).padStart(5) + "%";
}

function show(title: string, lambda: number, home: TeamFirstGoals | null, away: TeamFirstGoals | null) {
  const r = predictFirstGoal(lambda, home, away);
  const sum = r.entries.reduce((s, e) => s + e.prob, 0);
  console.log(`\n=== ${title} (λ=${lambda}) ===`);
  console.log(`  somme des 7 entrées = ${sum.toFixed(4)} (doit être 1.0000)`);
  for (const e of r.entries) {
    console.log(`  ${e.window === "NO_GOAL" ? "0-0    " : e.window.padEnd(6)} ${fmt(e.prob)}  ${e.label}`);
  }
  const h = r.headline;
  console.log(`  → minute médiane: ${h.expectedMinute ?? "aucune (P(0-0)≥50%)"}`);
  console.log(`  → fenêtre max: ${GOAL_WINDOWS[h.bestWindow]?.window} (${fmt(h.bestWindowProb)})`);
  console.log(`  → base: ${h.basis}, matchs: ${h.sampleMatches}, ρ: ${h.lambdaScale}`);
  if (Math.abs(sum - 1) > 0.0001) {
    console.log("  !!! ERREUR : somme != 1");
    process.exitCode = 1;
  }
}

/* 1. Repli pur ligue */
show("Repli ligue seule", 2.545, null, null);

/* 2. Deux équipes à ouverture RAPIDE (1ers buts 4, 8, 12, 6, 10, 15, 9, 3, 11, 7, 13, 5) */
const fast: TeamFirstGoals = {
  minuteOf: [4, 8, 12, 6, 10, 15, 9, 3, 11, 7, 13, 5],
  matches: 12,
  goalsInSample: 40,
};
show("Deux équipes rapides (λ élevé 3.5)", 3.5, fast, fast);

/* 3. Deux équipes à ouverture TARDIVE (60, 72, 55, 80, 65, 90, 58, 75, 62, 85, 70, 68) */
const slow: TeamFirstGoals = {
  minuteOf: [60, 72, 55, 80, 65, 90, 58, 75, 62, 85, 70, 68],
  matches: 12,
  goalsInSample: 16,
};
show("Deux équipes lentes (λ bas 1.8)", 1.8, slow, slow);

/* 4. Mixte */
show("Mixte rapide/lente (λ 2.5)", 2.5, fast, slow);

/* 5. Petits échantillons (2 matchs) */
const tiny: TeamFirstGoals = { minuteOf: [2, 88], matches: 2, goalsInSample: 6 };
show("Petits échantillons", 2.5, tiny, tiny);

/* 6. Beaucoup de 0-0 */
const noGoalHeavy: TeamFirstGoals = {
  minuteOf: [null, null, null, 80, null, 75, null, 88, null, null, 90, null],
  matches: 12,
  goalsInSample: 4,
};
show("Échantillon chargé en 0-0 (λ 1.0)", 1.0, noGoalHeavy, noGoalHeavy);

/* 7. λ absurde → bornes ρ */
show("λ=0.1 (borné)", 0.1, fast, fast);
show("λ=12 (borné)", 12, slow, slow);

console.log("\nOK si toutes les sommes = 1.0000 et aucun crash.");
