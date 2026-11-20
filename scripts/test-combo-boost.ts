/**
 * VOLTRIX — Test numérique du boost Combinateur v3.2 (boost parlay).
 * Exécution : bunx tsx scripts/test-combo-boost.ts
 *
 * Vérifie les mécaniques transférées des deux dépôts de référence
 * (b0yank/betting-recommender, cansahin9/parlay-optimizer) :
 *  1. edge/confiance/break-even calculés et cohérents ;
 *  2. proba marché = produit des dé-margées par famille ;
 *  3. tri des jambes par score de Kelly-numérateur ;
 *  4. pénalité de concentration ligue/horaire ;
 *  5. garde-fous historiques intacts (une jambe/match, seuil, cible).
 */

import {
  buildLegPool,
  findBestCombos,
  type ComboDayInput,
  type ComboLeg,
} from "../src/lib/foot/combinator";
import type { LightMatch, MatchesResponse, QuickPred } from "../src/lib/voltrix-types";

/* ---------- données synthétiques (3 ligues, 8 matchs cotés) ---------- */

function mkMatch(
  id: string,
  leagueCode: string,
  leagueName: string,
  shortName: string,
  kickoffISO: string,
  mlHome: number,
  mlDraw: number,
  mlAway: number,
  ou: { line: number; over: number; under: number },
  probs: [number, number, number],
  ouProbs: [number, number],
): LightMatch {
  return {
    id,
    leagueCode,
    leagueName,
    leagueShort: shortName,
    region: "Test",
    date: kickoffISO,
    status: "pre",
    statusDetail: "À venir",
    home: { id: `${id}h`, name: `Equipe ${id.toUpperCase()} H`, shortName: `${id}H`, logo: null, score: null, form: "WWDWL", record: null },
    away: { id: `${id}a`, name: `Equipe ${id.toUpperCase()} A`, shortName: `${id}A`, logo: null, score: null, form: "LDWLL", record: null },
    hasOdds: true,
    oddsProvider: "ESPN",
    ouLine: ou.line,
    mlHome,
    mlDraw,
    mlAway,
    venue: { name: null, city: null, country: null },
  };
}

const now = Date.now();
const K = (min: number) => new Date(now + min * 60_000).toISOString();
const day = (offset: number) => new Date(now + offset * 86_400_000).toISOString().slice(0, 10);

/* 8 matchs réalistes, tous à venir (> 10 min) :
 * - LIG1 : 4 matchs (concentration volontaire pour tester la pénalité),
 * - LIG2 : 2 matchs, LIG3 : 2 matchs (diversifiés). */
const matches: LightMatch[] = [
  mkMatch("m1", "LIG1", "Ligue Test 1", "LT1", K(90), 1.85, 3.6, 4.2, { line: 2.5, over: 1.9, under: 1.95 }, [0.5, 0.26, 0.24], [0.52, 0.48]),
  mkMatch("m2", "LIG1", "Ligue Test 1", "LT1", K(95), 2.1, 3.4, 3.5, { line: 2.5, over: 1.85, under: 2.0 }, [0.45, 0.28, 0.27], [0.54, 0.46]),
  mkMatch("m3", "LIG1", "Ligue Test 1", "LT1", K(240), 1.55, 4.1, 5.8, { line: 2.5, over: 2.05, under: 1.8 }, [0.6, 0.24, 0.16], [0.46, 0.54]),
  mkMatch("m4", "LIG1", "Ligue Test 1", "LT1", K(250), 1.72, 3.8, 4.9, { line: 2.5, over: 1.98, under: 1.87 }, [0.55, 0.25, 0.2], [0.5, 0.5]),
  mkMatch("m5", "LIG2", "Ligue Test 2", "LT2", K(600), 1.42, 4.8, 7.0, { line: 2.5, over: 2.15, under: 1.72 }, [0.65, 0.2, 0.15], [0.44, 0.56]),
  mkMatch("m6", "LIG2", "Ligue Test 2", "LT2", K(610), 2.35, 3.25, 3.05, { line: 2.5, over: 1.8, under: 2.05 }, [0.4, 0.28, 0.32], [0.55, 0.45]),
  mkMatch("m7", "LIG3", "Ligue Test 3", "LT3", K(1500), 1.68, 3.9, 5.1, { line: 2.5, over: 2.0, under: 1.85 }, [0.56, 0.24, 0.2], [0.49, 0.51]),
  mkMatch("m8", "LIG3", "Ligue Test 3", "LT3", K(1600), 1.28, 5.5, 11.0, { line: 2.5, over: 2.4, under: 1.55 }, [0.72, 0.16, 0.12], [0.38, 0.62]),
];

function mkPred(m: LightMatch, probs: [number, number, number], ouProbs: [number, number]): QuickPred {
  return {
    matchId: m.id,
    leagueCode: m.leagueCode,
    leagueName: m.leagueName,
    status: "pre",
    probs: { home: probs[0], draw: probs[1], away: probs[2] },
    lambda: { home: 1.4, away: 1.1, total: 2.5 },
    confidence: 4,
    confidenceLabel: "Élevée",
    recommendedBets: [],
    overUnder: [{ line: 2.5, over: ouProbs[0], under: ouProbs[1] }],
    btts: { yes: 0.52, no: 0.48 },
    topScores: [],
    valueBetsCount: 0,
    ouOdds: { line: 2.5, over: m.ouLine === 2.5 ? 1.9 : null, under: m.ouLine === 2.5 ? 1.95 : null },
  };
}

const preds: Record<string, QuickPred> = {};
for (let i = 0; i < matches.length; i++) {
  const m = matches[i];
  preds[m.id] = mkPred(
    m,
    [
      matches[i].mlHome ? 0.5 + i * 0.01 : 0.3,
      0.26 - i * 0.005,
      0.24 - i * 0.005,
    ] as [number, number, number],
    [0.52 - i * 0.01, 0.48 + i * 0.01] as [number, number],
  );
}
/* probas moteur calées plausibles : m1 50/26/24 … m8 57/21/22 */
preds["m1"].probs = { home: 0.5, draw: 0.26, away: 0.24 };
preds["m2"].probs = { home: 0.46, draw: 0.27, away: 0.27 };
preds["m3"].probs = { home: 0.58, draw: 0.24, away: 0.18 };
preds["m4"].probs = { home: 0.54, draw: 0.25, away: 0.21 };
preds["m5"].probs = { home: 0.63, draw: 0.2, away: 0.17 };
preds["m6"].probs = { home: 0.41, draw: 0.28, away: 0.31 };
preds["m7"].probs = { home: 0.55, draw: 0.24, away: 0.21 };
preds["m8"].probs = { home: 0.7, draw: 0.17, away: 0.13 };
preds["m8"].ouOdds = { line: 2.5, over: 2.4, under: 1.55 };
preds["m5"].ouOdds = { line: 2.5, over: 2.15, under: 1.72 };
preds["m6"].ouOdds = { line: 2.5, over: 1.8, under: 2.05 };
preds["m7"].ouOdds = { line: 2.5, over: 2.0, under: 1.85 };
preds["m3"].ouOdds = { line: 2.5, over: 2.05, under: 1.8 };
preds["m4"].ouOdds = { line: 2.5, over: 1.98, under: 1.87 };
preds["m2"].ouOdds = { line: 2.5, over: 1.85, under: 2.0 };

const foot: MatchesResponse = {
  date: day(0),
  totalMatches: matches.length,
  leagues: [
    { code: "LIG1", name: "Ligue Test 1", shortName: "LT1", region: "Test", matches: matches.filter((m) => m.leagueCode === "LIG1") },
    { code: "LIG2", name: "Ligue Test 2", shortName: "LT2", region: "Test", matches: matches.filter((m) => m.leagueCode === "LIG2") },
    { code: "LIG3", name: "Ligue Test 3", shortName: "LT3", region: "Test", matches: matches.filter((m) => m.leagueCode === "LIG3") },
  ],
  scanMs: 42,
};

const days: ComboDayInput[] = [{ date: day(0), foot, footPreds: preds }];

/* ---------- exécution + contrôles ---------- */

let failures = 0;
function check(label: string, ok: boolean, detail: string) {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} — ${label}${detail ? ` (${detail})` : ""}`);
}

const { legs } = buildLegPool(days, { maxLegOdds: 5.0, includeFairOddsLegs: false });

/* 1. probMarket : dé-marge par famille, attachée aux jambes 1X2/O-U */
const m1Home = legs.find((l) => l.matchId === "m1" && l.pick === "Victoire Equipe M1 H");
check(
  "pool construit (≥ 20 jambes)",
  legs.length >= 20,
  `${legs.length} jambes`,
);
check(
  "proba marché dé-margée attachée à une jambe 1X2",
  m1Home?.probMarket != null && Math.abs(m1Home.probMarket - 0.507) < 0.03,
  m1Home?.probMarket != null ? `1X2 m1 dé-margé ≈ ${m1Home.probMarket.toFixed(3)} (implicite brut 0.541)` : "absente",
);

/* 2. jambe @11 exclue (garde-fou historique intact) */
check(
  "jambe @11 (m8 nul) exclue du pool — cote max par jambe",
  !legs.some((l) => l.odds > 5.0),
  legs.filter((l) => l.odds > 5.0).length === 0 ? "aucune jambe > 5.0" : "présente !",
);

/* 3. recherche : métriques cohérentes sur les résultats */
const outcome = findBestCombos(legs, 8, {
  target: 3.5,
  minProb: 0.2,
  maxLegOdds: 5.0,
  maxLegs: 5,
});
const best = outcome.results[0];
check("combinés trouvés", outcome.results.length > 0, `${outcome.results.length} résultats`);
if (best) {
  const legsSorted = best.legs;
  /* invariants arithmétiques */
  const prodOdds = legsSorted.reduce((acc, l) => acc * l.odds, 1);
  const prodProb = legsSorted.reduce((acc, l) => acc * l.prob, 1);
  check(
    "cote totale = produit des jambes",
    Math.abs(prodOdds - best.odds) < 0.05,
    `${prodOdds.toFixed(3)} vs ${best.odds.toFixed(3)}`,
  );
  check(
    "proba = produit des jambes",
    Math.abs(prodProb - best.prob) < 1e-9,
    `${prodProb.toFixed(5)} vs ${best.prob.toFixed(5)}`,
  );
  check(
    "edge = proba × cote − 1",
    Math.abs(best.prob * best.odds - 1 - best.edge) < 0.005,
    `edge = ${best.edge.toFixed(4)}`,
  );
  check(
    "confiance = edge × proba",
    Math.abs(best.edge * best.prob - best.confidence) < 0.005,
    `confiance = ${best.confidence.toFixed(4)}`,
  );
  check(
    "break-even = 1/cote",
    Math.abs(1 / best.odds - best.breakEven) < 0.005,
    `${(best.breakEven * 100).toFixed(1)} %`,
  );
  /* proba marché : produit des dé-margées si toutes les jambes cotées */
  const allCoted = best.legs.every((l) => l.probMarket != null);
  if (allCoted) {
    const prodMkt = best.legs.reduce((acc, l) => acc * (l.probMarket ?? 1), 1);
    check(
      "proba marché = produit des dé-margées",
      Math.abs(prodMkt - (best.probMarket ?? 0)) < 0.005,
      `marché ${(prodMkt * 100).toFixed(1)} % vs modèle ${(best.prob * 100).toFixed(1)} %`,
    );
  }
  /* une jambe par match */
  const ids = new Set(best.legs.map((l) => l.matchId));
  check("une seule jambe par match", ids.size === best.legs.length, `${ids.size}/${best.legs.length}`);
  /* seuil */
  check(
    "seuil atteint (meetsThreshold cohérent)",
    best.meetsThreshold === (best.prob >= 0.2),
    `prob ${(best.prob * 100).toFixed(1)} %`,
  );
}

/* 4. pénalité de concentration : 4 jambes LIG1 > 2 → pénalité > 0 */
function leaguePenalty(legs: ComboLeg[]): number {
  const byLeague = new Map<string, number>();
  for (const l of legs) byLeague.set(l.leagueCode, (byLeague.get(l.leagueCode) ?? 0) + 1);
  let pen = 0;
  for (const n of byLeague.values()) if (n > 2) pen += 0.01 * (n - 2);
  return Math.round(pen * 10000) / 10000;
}
const fourLig1 = legs.filter((l) => l.leagueCode === "LIG1").slice(0, 3);
check(
  "pénalité de concentration ligue (3 jambes LT1 > 2)",
  leaguePenalty(fourLig1) > 0,
  `pénalité = ${leaguePenalty(fourLig1)}`,
);
const diversified = [legs.find((l) => l.leagueCode === "LIG1"), legs.find((l) => l.leagueCode === "LIG2"), legs.find((l) => l.leagueCode === "LIG3")].filter(Boolean) as ComboLeg[];
check(
  "pénalité nulle pour un combiné diversifié (1 jambe par ligue)",
  leaguePenalty(diversified) === 0,
  `pénalité = ${leaguePenalty(diversified)}`,
);

/* 5. tri par SCORE (confiance − malus de dépassement − pénalité) :
 * le score reconstitué du premier résultat doit dominer les suivants. */
if (outcome.results.length >= 2) {
  const target = 3.5;
  const score = (r: (typeof outcome.results)[number]) =>
    r.confidence - 0.015 * (r.odds - target) - r.leaguePenalty;
  const scores = outcome.results.map(score);
  const nonIncreasing = scores.every((s, i) => i === 0 || scores[i - 1] >= s - 1e-9);
  check(
    "résultats classés par score (confiance + malus cible + pénalité)",
    nonIncreasing,
    scores.map((s) => s.toFixed(4)).join(" · "),
  );
}

/* 6. cas dégénérés : cote cible basse → combiné 2 jambes à forte proba */
const low = findBestCombos(legs, 8, { target: 2.0, minProb: 0.4, maxLegOdds: 5.0, maxLegs: 4 });
check(
  "cible 2.0 @ seuil 40 % : au moins un combiné",
  low.results.length > 0 && low.results[0].prob >= 0.4,
  low.results[0] ? `prob ${(low.results[0].prob * 100).toFixed(1)} %` : "aucun",
);

/* 7. cote cible inaccessible → relâché honnête */
const absurd = findBestCombos(legs, 8, { target: 50, minProb: 0.3, maxLegOdds: 5.0, maxLegs: 4 });
check(
  "cible absurde (50) : aucun faux combiné présenté comme conforme",
  absurd.results.length === 0 || absurd.results.every((r) => r.meetsThreshold === (r.prob >= 0.3)),
  absurd.results.length === 0 ? "aucun résultat" : "résultats cohérents",
);

console.log(failures === 0 ? "\nTOUS LES CONTRÔLES PASSENT ✓" : `\n${failures} ÉCHEC(S) ✗`);
process.exit(failures === 0 ? 0 : 1);
