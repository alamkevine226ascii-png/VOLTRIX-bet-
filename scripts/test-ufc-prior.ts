/**
 * Test e2e du prior UFC (fetchUfcRoundPrior) — scan réel ESPN.
 * Exécution : bun scripts/test-ufc-prior.ts
 */
import { fetchUfcRoundPrior } from "../src/lib/mma/rounds";

async function main() {
  const t0 = Date.now();
  console.log("Scan des 6 derniers événements UFC terminés…");
  const prior = await fetchUfcRoundPrior();
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  if (!prior) {
    console.error(`✗ prior null après ${dt}s (échantillon insuffisant ou réseau)`);
    process.exit(1);
  }
  const s3 = prior.prior3.finishByRound.reduce((a, b) => a + b, 0) + prior.prior3.decisionShare;
  const s5 = prior.prior5.finishByRound.reduce((a, b) => a + b, 0) + prior.prior5.decisionShare;
  console.log(`✓ prior calculé en ${dt}s`);
  console.log(`  échantillon : ${prior.fightsSampled} combats`);
  console.log(`  événements  : ${prior.eventsSampled.join(" | ")}`);
  console.log(`  3R fins par round : ${prior.prior3.finishByRound.map((x) => (x * 100).toFixed(1) + "%").join(" ")} · décision ${(prior.prior3.decisionShare * 100).toFixed(1)}% (somme ${(s3 * 100).toFixed(2)}%)`);
  console.log(`  5R fins par round : ${prior.prior5.finishByRound.map((x) => (x * 100).toFixed(1) + "%").join(" ")} · décision ${(prior.prior5.decisionShare * 100).toFixed(1)}% (somme ${(s5 * 100).toFixed(2)}%)`);
  if (Math.abs(s3 - 1) > 1e-6 || Math.abs(s5 - 1) > 1e-6) {
    console.error("✗ sommes != 1");
    process.exit(1);
  }
  // le prior 3R doit être réaliste : majorité de fins avant la décision ~
  const fin3 = 1 - prior.prior3.decisionShare;
  if (fin3 < 0.2 || fin3 > 0.8) {
    console.error(`✗ part des fins 3R aberrante : ${fin3}`);
    process.exit(1);
  }
  console.log("\nTEST PRIOR UFC : OK");
}
main().catch((e) => {
  console.error("Échec :", e);
  process.exit(1);
});
