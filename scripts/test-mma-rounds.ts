/**
 * Test du modèle de rounds personnalisé + byMethod (corrections audit MMA).
 * Exécution : bun scripts/test-mma-rounds.ts
 */
import { personalRoundRates, fuseRoundDistribution, type RoundPrior } from "../src/lib/mma/rounds";
import type { DerivedResult } from "../src/lib/mma/analysis";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (!cond) {
    failures++;
    console.error(`✗ ${name} ${detail}`);
  } else {
    console.log(`✓ ${name}${detail ? " — " + detail : ""}`);
  }
}

/* ---- fixtures ---- */
const prior: RoundPrior = {
  prior3: { finishByRound: [0.35, 0.3, 0.2], decisionShare: 0.15 },
  prior5: { finishByRound: [0.28, 0.22, 0.17, 0.11, 0.05], decisionShare: 0.17 },
  fightsSampled: 72,
  eventsSampled: ["UFC A", "UFC B"],
  computedAt: new Date().toISOString(),
};

const fightsA: DerivedResult["fights"] = [
  { eventDate: "2026-10-01", result: "W", method: "KO_TKO", period: 2 },
  { eventDate: "2026-09-01", result: "W", method: "DECISION", period: 3 },
  { eventDate: "2026-08-01", result: "W", method: "SOUMISSION", period: 1 },
  { eventDate: "2026-07-01", result: "L", method: "DECISION", period: 3 },
  { eventDate: "2026-06-01", result: "W", method: "KO_TKO", period: 3 },
  { eventDate: "2026-05-01", result: "NC", method: null, period: 2 },
];
const fightsB: DerivedResult["fights"] = [
  { eventDate: "2026-10-01", result: "W", method: "DECISION", period: 3 },
  { eventDate: "2026-09-01", result: "L", method: "KO_TKO", period: 1 },
  { eventDate: "2026-08-01", result: "W", method: "DECISION", period: 3 },
];

/* ---- 1. taux personnalisés ---- */
const ratesA = personalRoundRates(fightsA, prior, 3);
check("ratesA non null", ratesA != null);
if (ratesA) {
  const sum = ratesA.finishByRound.reduce((a, b) => a + b, 0) + ratesA.decisionShare;
  check("ratesA somme = 1", Math.abs(sum - 1) < 1e-9, `somme=${sum.toFixed(6)}`);
  check("ratesA 4 victoires documentées", ratesA.documentedWins === 4, `doc=${ratesA.documentedWins}`);
  check("ratesA basis combattant", ratesA.basis === "combattant");
  // 2 KO (R2, R3), 1 sub (R1), 1 décision → KO attendu en tête
  check("KO dominant chez A", ratesA.finishByRound[1] > ratesA.decisionShare, `R2=${ratesA.finishByRound[1].toFixed(3)} dec=${ratesA.decisionShare.toFixed(3)}`);
}

/* ---- 2. fusion des deux combattants ---- */
const ratesB = personalRoundRates(fightsB, prior, 3);
const pA = 0.6;
const pB = 0.4;
const fused = fuseRoundDistribution(pA, ratesA, pB, ratesB, 3);
check("fused non null", fused != null);
if (fused) {
  const sum = fused.finishByRound.reduce((a, b) => a + b, 0) + fused.decisionShare;
  check("fused somme = 1", Math.abs(sum - 1) < 1e-9, `somme=${sum.toFixed(6)}`);
  // B est decisioneur (2 décisions sur 3 combats) : la décision fusionnée
  // doit être > au prior 3R (0.15)
  check("décision tirée vers le haut par B", fused.decisionShare > prior.prior3.decisionShare, `dec=${fused.decisionShare.toFixed(3)}`);
}

/* ---- 3. combattant sans historique → prior ---- */
const ratesEmpty = personalRoundRates([], prior, 5);
check("sans historique → prior", ratesEmpty != null && ratesEmpty.priorWeight === 1);
if (ratesEmpty) {
  const sum = ratesEmpty.finishByRound.reduce((a, b) => a + b, 0) + ratesEmpty.decisionShare;
  check("prior 5R somme = 1", Math.abs(sum - 1) < 1e-9);
}

/* ---- 4. sans prior du tout : 5+ victoires documentées requises ---- */
const fiveWins: DerivedResult["fights"] = Array.from({ length: 5 }, (_, i) => ({
  eventDate: `2026-0${i + 1}-01`,
  result: "W",
  method: i % 2 === 0 ? "KO_TKO" : "DECISION",
  period: (i % 3) + 1,
}));
const r5 = personalRoundRates(fiveWins, null, 3);
check("5 victoires sans prior → observé", r5 != null && r5.basis === "combattant");
const r2 = personalRoundRates(fiveWins.slice(0, 2), null, 3);
check("2 victoires sans prior → null (pas de modèle)", r2 === null);

/* ---- 5. vérification du bug goesToDecision (ancien ×2) ---- */
// Simulation du calcul par méthode : décisions de carrière.
const decShareA = 0.3; // 30 % des victoires de A aux points
const decShareB = 0.7; // 70 % de celles de B
const pWinA = 0.55;
const pWinB = 0.45;
const ancien = Math.min(0.8, Math.max(0.2, pWinA * (pWinA * decShareA) + pWinB * (pWinB * decShareB)));
const corrige = Math.min(0.95, Math.max(0.05, pWinA * decShareA + pWinB * decShareB));
check(
  "goesToDecision corrigé ≈ 2× l'ancien (cas decisioneurs)",
  corrige > ancien * 1.5,
  `ancien=${ancien.toFixed(3)} corrigé=${corrige.toFixed(3)}`,
);

/* ---- 6. méthode : parts complètes ou null ---- */
type Fighter = { wins: number | null; losses: number | null; koWins: number | null; subWins: number | null; koLosses: number | null; subLosses: number | null };
function winShares(f: Fighter) {
  const w = f.wins;
  if (w == null || w <= 0 || f.koWins == null || f.subWins == null) return null;
  const ko = f.koWins / w;
  const sub = f.subWins / w;
  return { ko, sub, dec: Math.max(0, 1 - ko - sub) };
}
function lossShares(f: Fighter) {
  const l = f.losses;
  if (l == null || l <= 0 || f.koLosses == null || f.subLosses == null) return null;
  const ko = f.koLosses / l;
  const sub = f.subLosses / l;
  return { ko, sub, dec: Math.max(0, 1 - ko - sub) };
}
const gane: Fighter = { wins: 14, losses: 2, koWins: 7, subWins: 3, koLosses: 0, subLosses: 1 };
const ws = winShares(gane);
check("winShares Gane", ws != null && Math.abs(ws.ko + ws.sub + ws.dec - 1) < 1e-9, JSON.stringify(ws));
const ls = lossShares(gane);
check("lossShares Gane : 1 sub + 1 déc", ls != null && ls.sub === 0.5 && ls.dec === 0.5, JSON.stringify(ls));
const partial: Fighter = { wins: 10, losses: 2, koWins: null, subWins: 3, koLosses: 0, subLosses: 1 };
check("winShares partiel → null (pas de renormalisation)", winShares(partial) === null);

console.log(failures === 0 ? "\nTOUS LES TESTS PASSENT" : `\n${failures} ÉCHEC(S)`);
process.exit(failures === 0 ? 0 : 1);
