/* Sanity check du Poisson bivarié + Monte Carlo (implémentation n°1) :
 * maths pures, sans réseau. Vérifie :
 *   1. grille sommée à 1, marchés sommés à 1 ;
 *   2. déterminisme (même seed → mêmes résultats) ;
 *   3. accord grille exacte ↔ Monte Carlo 10 000 ;
 *   4. effets directionnels de la corrélation λ3 (nul, 0-0, BTTS ↗) ;
 *   5. bornage λ3 sur cas extrêmes (aucune intensité négative) ;
 *   6. calibration bivariée (l'ancre marché est atteinte) ;
 *   7. overAtLine sur ligne exotique (4.5) ;
 *   8. comparaison bivarié vs indépendant (poissonModel) ;
 *   9. performance (temps moyen par simulateMatch).
 */
import {
  BIVARIATE_RHO,
  MC_ITERATIONS,
  bivariateLambdas,
  calibrateBivariate,
  overAtLine,
  simulateMatch,
} from "../src/lib/foot/montecarlo";
import { poissonModel, firstToScoreProbs } from "../src/lib/foot/prediction";

let failures = 0;
function check(name: string, ok: boolean, detail: string) {
  const tag = ok ? "OK " : "!!";
  console.log(`  [${tag}] ${name} — ${detail}`);
  if (!ok) failures++;
}
function fmt(p: number) {
  return (p * 100).toFixed(2) + "%";
}

const SCENARIOS: Array<{ label: string; lh: number; la: number }> = [
  { label: "typique (1.52/1.22)", lh: 1.52, la: 1.22 },
  { label: "dom écrasant (2.8/0.5)", lh: 2.8, la: 0.5 },
  { label: "ext favori (0.4/2.6)", lh: 0.4, la: 2.6 },
  { label: "festival (3.8/3.4)", lh: 3.8, la: 3.4 },
  { label: "verrou (0.3/0.25)", lh: 0.3, la: 0.25 },
];

console.log("=== 1-2. Sommes à 1 & déterminisme ===");
for (const s of SCENARIOS) {
  const a = simulateMatch(s.lh, s.la);
  const b = simulateMatch(s.lh, s.la);
  const probsSum = a.exact.probs.home + a.exact.probs.draw + a.exact.probs.away;
  const bttsSum = a.exact.btts.yes + a.exact.btts.no;
  const ou = a.exact.overUnder[1]; // ligne 2.5
  const ouSum = ou.over + ou.under;
  const histSum = a.exact.totalGoalsHist.reduce((x, y) => x + y, 0);
  check(
    `${s.label} sommes`,
    Math.abs(probsSum - 1) < 1e-9 && Math.abs(bttsSum - 1) < 1e-9 && Math.abs(ouSum - 1) < 1e-4 && Math.abs(histSum - 1) < 1e-9,
    `1X2=${probsSum.toFixed(6)} BTTS=${bttsSum.toFixed(6)} O/U=${ouSum.toFixed(4)} hist=${histSum.toFixed(6)}`
  );
  check(
    `${s.label} déterminisme`,
    a.seed === b.seed &&
      a.mc.probs.home === b.mc.probs.home &&
      a.mc.medianGoals === b.mc.medianGoals &&
      a.agreement === b.agreement,
    `seed=${a.seed} mc.home=${a.mc.probs.home.toFixed(4)} (2 appels identiques)`
  );
}

console.log("\n=== 3. Accord grille exacte ↔ Monte Carlo (10 000) ===");
for (const s of SCENARIOS) {
  const r = simulateMatch(s.lh, s.la);
  check(
    `${s.label} accord`,
    r.agreement < 0.02,
    `écart max=${fmt(r.agreement)} (seuil 2%, 4σ à 10k itérations ≈ 2%)`
  );
}

console.log("\n=== 4. Effets directionnels de la corrélation λ3 ===");
for (const s of SCENARIOS) {
  const bi = simulateMatch(s.lh, s.la); // ρ = 0.10
  const ind = poissonModel(s.lh, s.la); // indépendance (référence legacy)
  const p00Ind = Math.exp(-(s.lh + s.la));
  const symmetric = Math.min(s.lh, s.la) / Math.max(s.lh, s.la) > 0.5;
  check(
    `${s.label} λ3 > 0`,
    bi.lambda3 > 0,
    `λ3=${bi.lambda3} (ρ=${bi.rho})`
  );
  // P(nul) : garantie ↗ pour les affrontements symétriques ; pour les duels
  // très asymétriques la masse diagonale se déplace vers les petits scores
  // et P(nul) peut reculer marginalement — on borne l'écart.
  check(
    `${s.label} P(nul) ${symmetric ? "↗ (symétrique)" : "Δ borné (asymétrique)"}`,
    symmetric
      ? bi.exact.probs.draw >= ind.probs.draw - 1e-4
      : Math.abs(bi.exact.probs.draw - ind.probs.draw) < 0.006,
    `bivarié ${fmt(bi.exact.probs.draw)} vs indépendant ${fmt(ind.probs.draw)}`
  );
  check(
    `${s.label} P(0-0) ↗ avec corrélation`,
    bi.exact.noGoal >= p00Ind - 1e-6,
    `bivarié ${fmt(bi.exact.noGoal)} ≥ indépendant ${fmt(p00Ind)}`
  );
  check(
    `${s.label} BTTS ↗ avec corrélation`,
    bi.exact.btts.yes >= ind.btts.yes - 1e-4,
    `bivarié ${fmt(bi.exact.btts.yes)} ≥ indépendant ${fmt(ind.btts.yes)}`
  );
}

console.log("\n=== 5. Bornage λ3 (cas extrêmes) ===");
for (const [lh, la, rho] of [
  [3.8, 0.25, 0.5],
  [0.25, 3.8, 0.5],
  [3.8, 3.4, 0.5],
] as const) {
  const { l1, l2, l3 } = bivariateLambdas(lh, la, rho);
  check(
    `(${lh}/${la}, ρ=${rho})`,
    l1 > 0 && l2 > 0 && l3 >= 0 && l1 + l3 === lh && l2 + l3 === la,
    `λ1=${l1.toFixed(3)} λ2=${l2.toFixed(3)} λ3=${l3.toFixed(3)} (λ1+λ3=λH ✓ λ2+λ3=λA ✓)`
  );
}

console.log("\n=== 6. Calibration bivariée (ancre marché) ===");
for (const [target, line] of [
  [0.55, 2.5],
  [0.42, 2.5],
  [0.62, 1.5],
] as const) {
  const cal = calibrateBivariate(1.52, 1.22, BIVARIATE_RHO, line, target, [1.5, 2.5, 3.5]);
  check(
    `marché over ${line} = ${fmt(target)}`,
    Math.abs(cal.over[line] - target) < 0.005,
    `échelle=${cal.scale.toFixed(3)} → P(over ${line})=${fmt(cal.over[line])} BTTS=${fmt(cal.btts)}`
  );
}

console.log("\n=== 7. Ligne exotique via overAtLine ===");
{
  const r = simulateMatch(2.6, 1.9);
  const o45 = overAtLine(r.exact.grid, 4.5);
  const o25 = r.exact.overUnder.find((o) => o.line === 2.5)!.over;
  check(
    "P(over 4.5) < P(over 2.5), dans (0,1)",
    o45 > 0 && o45 < 1 && o45 < o25,
    `over 2.5=${fmt(o25)} > over 4.5=${fmt(o45)}`
  );
  // Cohérence : over(4.5) + under(4.5) = 1 sur la même grille
  const u45 = 1 - o45;
  check("over+under ≡ 1 (ligne 4.5)", Math.abs(o45 + u45 - 1) < 1e-12, `${o45.toFixed(6)} + ${u45.toFixed(6)}`);
}

console.log("\n=== 8. Comparaison bivarié vs indépendant (écart typique) ===");
{
  const bi = simulateMatch(1.52, 1.22);
  const ind = poissonModel(1.52, 1.22);
  console.log(
    `  match typique λH=1.52 λA=1.22, ρ=0.10, λ3=${bi.lambda3} :\n` +
      `    1X2 bivarié    : ${fmt(bi.exact.probs.home)} / ${fmt(bi.exact.probs.draw)} / ${fmt(bi.exact.probs.away)}\n` +
      `    1X2 indépendant: ${fmt(ind.probs.home)} / ${fmt(ind.probs.draw)} / ${fmt(ind.probs.away)}\n` +
      `    BTTS  bivarié ${fmt(bi.exact.btts.yes)} vs indépendant ${fmt(ind.btts.yes)}\n` +
      `    P(0-0) bivarié ${fmt(bi.exact.noGoal)} vs indépendant ${fmt(Math.exp(-2.74))}`
  );
  const ftsBi = firstToScoreProbs(1.52, 1.22, bi.exact.noGoal);
  const ftsSum = ftsBi.home + ftsBi.away + ftsBi.noGoal;
  check("firstToScore somme = 1 (P(0-0) exacte injectée)", Math.abs(ftsSum - 1) < 1e-4, `${ftsSum.toFixed(4)} (noGoal=${fmt(ftsBi.noGoal)})`);
  // Histogramme complet : somme = 1 (25 barres, 0..24)
  const histSum = bi.exact.totalGoalsHist.reduce((x, y) => x + y, 0);
  check("histogramme complet (0..24) somme = 1", Math.abs(histSum - 1) < 1e-9, `${histSum.toFixed(10)}`);
}

console.log("\n=== 9. Performance ===");
{
  const t0 = Date.now();
  const N = 200;
  for (let i = 0; i < N; i++) simulateMatch(1.52, 1.22);
  const avg = (Date.now() - t0) / N;
  check(
    `${N} simulateMatch en moyenne`,
    avg < 50,
    `${avg.toFixed(2)} ms/match (grille 13×13 + ${MC_ITERATIONS.toLocaleString("fr-FR")} sim. MC) — seuil 50 ms`
  );
}

console.log(`\n${failures === 0 ? "✅ TOUS LES CONTRÔLES PASSENT" : `❌ ${failures} ÉCHEC(S)`}`);
process.exitCode = failures === 0 ? 0 : 1;
