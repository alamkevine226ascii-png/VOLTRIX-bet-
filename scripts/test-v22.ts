// ============================================================
// Test de cohérence du moteur v2.2 (post-backtest) — smoke test
// offline : exécute runEngine sur des entrées synthétiques et
// vérifie les invariants (sommes, calibration du nul, discipline
// value-bets, moyennes par ligue).
// ============================================================
import { runEngine, eloToProbs } from "../src/lib/foot/prediction";
import { leagueGoalAverages, FOOT_PARAMS_VERSION, VALUE_BET_MAX_ODDS, VALUE_BET_MIN_EDGE } from "../src/lib/foot/league-params";
import type { EspnScheduleGame, EspnOdds } from "../src/lib/foot/espn";

// ---------- faux calendriers : 2 équipes aux profils marqués ----------
function mkGames(teamId: string, strong: boolean, baseDate: Date): EspnScheduleGame[] {
  const games: EspnScheduleGame[] = [];
  const opponents = ["opp1", "opp2", "opp3", "opp4", "opp5", "opp6", "opp7", "opp8"];
  for (let i = 0; i < 10; i++) {
    const home = i % 2 === 0;
    const d = new Date(baseDate.getTime() - (i * 4 + 2) * 86400000).toISOString();
    const gf = strong ? (home ? 2 + (i % 2) : 1 + (i % 2)) : i % 3 === 0 ? 1 : 0;
    const ga = strong ? (i % 3 === 0 ? 1 : 0) : home ? 1 : 2 + (i % 2);
    games.push({
      eventId: `ev-${teamId}-${i}`,
      date: d,
      homeAway: home ? "home" : "away",
      opponentId: opponents[i % opponents.length],
      opponentName: `Adversaire ${i}`,
      teamScore: gf,   // score de teamId, dans TOUS les cas
      opponentScore: ga,
      completed: true,
    } as EspnScheduleGame);
  }
  return games;
}

const now = new Date("2026-11-11T12:00:00Z");
const homeSchedule = mkGames("teamA", true, now);
const awaySchedule = mkGames("teamB", false, now);

const odds: EspnOdds = {
  hasOdds: true,
  provider: "test",
  moneyline: {
    home: { open: 1.55, close: 1.50 },
    draw: { open: 4.4, close: 4.5 },
    away: { open: 6.0, close: 6.5 },
  },
  overUnderLine: 2.5,
  total: {
    over: { line: 2.5, openOdds: 1.9, closeOdds: 1.85 },
    under: { line: 2.5, openOdds: 1.95, closeOdds: 2.0 },
  },
};

let failures = 0;
const check = (name: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "OK " : "ÉCHEC"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
};

// ---------- 1. moteur, ligue couverte (moyennes Bundesliga) ----------
const res = runEngine({
  homeTeam: { id: "teamA", name: "Équipe A", logo: null, schedule: homeSchedule, standings: null },
  awayTeam: { id: "teamB", name: "Équipe B", logo: null, schedule: awaySchedule, standings: null },
  injuries: [],
  odds,
  isDerby: false,
  weatherImpact: null,
  nowMs: now.getTime(),
  leagueTeamsCount: 18,
  leagueGoalAverages: leagueGoalAverages("ger.1"),
});

const p = res.prediction.probs;
check("1X2 somme à 1", Math.abs(p.home + p.draw + p.away - 1) < 1e-6, `H=${p.home} D=${p.draw} A=${p.away}`);
check("Équipe forte favorite à domicile", p.home > p.away + 0.2, `H=${p.home.toFixed(3)}`);
check("Nul raisonnable même en fort déséquilibre (≥ 15 %)", p.draw >= 0.15, `D=${p.draw.toFixed(3)}`);
check("λ dans les bornes v2.2", res.prediction.lambda.home <= 4.4 && res.prediction.lambda.away <= 4.0,
  `λH=${res.prediction.lambda.home} λA=${res.prediction.lambda.away}`);
check("MC bivarié présent + accord < 1 %", !!res.prediction.mc && res.prediction.mc!.agreement < 0.01,
  `accord=${res.prediction.mc?.agreement}`);
const ou = res.prediction.overUnder.find((o) => o.line === 2.5)!;
check("Over/Under calibré sur le marché (2.5)", Math.abs(ou.over - (1 / 1.85) / (1 / 1.85 + 1 / 2.0)) < 0.03,
  `over=${ou.over}`);

// ---------- 2. discipline value-bets ----------
const vb = res.prediction.valueBets;
check("Value bets respectent seuil 5 %", vb.every((b) => b.edge > VALUE_BET_MIN_EDGE - 1e-9));
check("Value bets respectent cote ≤ 2,5", vb.every((b) => b.odds <= VALUE_BET_MAX_ODDS + 1e-9));
check("Value bets kelly ≤ 10 %", vb.every((b) => b.kelly <= 0.1001));
console.log(`      valueBets: ${vb.map((b) => `${b.pick} @${b.odds} edge ${(b.edge * 100).toFixed(1)}%`).join(" | ") || "(aucun)"}`);

// ---------- 3. cotes exagérées : plus de value bets fantômes ----------
const oddsTrap: EspnOdds = {
  ...odds,
  moneyline: {
    home: { open: 8, close: 8 },   // piège : outsider à grosse cote
    draw: { open: 5, close: 5 },
    away: { open: 1.25, close: 1.25 },
  },
};
const res2 = runEngine({
  homeTeam: { id: "teamA", name: "Équipe A", logo: null, schedule: homeSchedule, standings: null },
  awayTeam: { id: "teamB", name: "Équipe B", logo: null, schedule: awaySchedule, standings: null },
  injuries: [],
  odds: oddsTrap,
  isDerby: false,
  weatherImpact: null,
  nowMs: now.getTime(),
  leagueTeamsCount: 18,
  leagueGoalAverages: leagueGoalAverages("ger.1"),
});
const vb2 = res2.prediction.valueBets;
check("Grosses cotes exclues de la discipline", vb2.every((b) => b.odds <= 2.5),
  `${vb2.length} bets`);
console.log(`      valueBets (piège) : ${vb2.map((b) => `${b.pick} @${b.odds}`).join(" | ") || "(aucun)"}`);

// ---------- 4. ligue non couverte → constantes globales ----------
const l1 = leagueGoalAverages("eng.1");
const lX = leagueGoalAverages("xxx.9");
check("Ligue couverte → moyennes", l1 !== null && Math.abs(l1.home - 1.513) < 1e-9, JSON.stringify(l1));
check("Ligue inconnue → null (repli global)", lX === null);

// ---------- 5. eloToProbs recalibré ----------
const e = eloToProbs(1500, 1500);
check("Elo égal → nul au plafond 0,30", Math.abs(e.draw - 0.30) < 0.01, `draw=${e.draw}`);
const e2 = eloToProbs(1700, 1300);
check("Elo déséquilibré → nul décroissant", e2.draw < 0.30 && e2.draw > 0.08, `draw=${e2.draw}`);

console.log(`\nVersion des constantes : ${FOOT_PARAMS_VERSION}`);
console.log(failures === 0 ? "\n=== TOUS LES TESTS PASSENT ===" : `\n=== ${failures} ÉCHEC(S) ===`);
process.exit(failures === 0 ? 0 : 1);
