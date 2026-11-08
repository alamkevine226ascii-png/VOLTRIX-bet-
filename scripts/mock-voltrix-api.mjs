/* Mock local de l'API VOLTRIX — sert quelques endpoints minimaux
   sur http://localhost:3999 pour valider le mode LIVE du frontend
   (proxy même-origine, en-tête x-voltrix-base, bascule démo→live). */

import { createServer } from "node:http";

const PORT = 3999;
const today = new Date().toISOString().slice(0, 10);

const matches = {
  date: today,
  totalMatches: 2,
  leagues: [
    {
      code: "mock.1",
      name: "Ligue Mock (API réelle)",
      shortName: "MOCK",
      region: "europe",
      matches: [
        {
          id: "mock-1",
          leagueCode: "mock.1",
          leagueName: "Ligue Mock (API réelle)",
          leagueShort: "MOCK",
          region: "europe",
          date: `${today}T20:00:00.000Z`,
          status: "pre",
          statusDetail: "",
          home: { id: "mh1", name: "Mock United", shortName: "MUN", logo: null, score: null, form: "WWDWL", record: null },
          away: { id: "ma1", name: "Test City", shortName: "TC", logo: null, score: null, form: "DLWWD", record: null },
          hasOdds: true,
          oddsProvider: "DraftKings",
          ouLine: 2.5,
          mlHome: 1.9,
          mlDraw: 3.5,
          mlAway: 3.8,
          venue: { name: "Mock Arena", city: "Mockville", country: null },
        },
        {
          id: "mock-2",
          leagueCode: "mock.1",
          leagueName: "Ligue Mock (API réelle)",
          leagueShort: "MOCK",
          region: "europe",
          date: `${today}T22:30:00.000Z`,
          status: "pre",
          statusDetail: "",
          home: { id: "mh2", name: "Proxy FC", shortName: "PXY", logo: null, score: null, form: "WWWWW", record: null },
          away: { id: "ma2", name: "Neon Rovers", shortName: "NEO", logo: null, score: null, form: "LLLWD", record: null },
          hasOdds: false,
          oddsProvider: null,
          ouLine: null,
          mlHome: null,
          mlDraw: null,
          mlAway: null,
          venue: { name: "Stade Proxy", city: null, country: null },
        },
      ],
    },
  ],
  scanMs: 5,
};

function quickPred(id) {
  return {
    matchId: id,
    leagueCode: "mock.1",
    leagueName: "Ligue Mock (API réelle)",
    status: "pre",
    probs: { home: 0.51, draw: 0.26, away: 0.23 },
    lambda: { home: 1.7, away: 1.1, total: 2.8 },
    confidence: 4,
    confidenceLabel: "Bonne",
    recommendedBets: [
      { market: "1X2", pick: "1 - Mock United", prob: 0.51, note: "via API réelle" },
      { market: "O/U 2.5", pick: "Plus de 2.5", prob: 0.58, note: "λ 2.8" },
      { market: "BTTS", pick: "Oui", prob: 0.55, note: "" },
    ],
    overUnder: [
      { line: 1.5, over: 0.8, under: 0.2 },
      { line: 2.5, over: 0.58, under: 0.42 },
      { line: 3.5, over: 0.33, under: 0.67 },
    ],
    btts: { yes: 0.55, no: 0.45 },
    topScores: [
      { score: "2-1", prob: 0.12 },
      { score: "1-1", prob: 0.11 },
      { score: "1-0", prob: 0.1 },
    ],
    valueBetsCount: 1,
    ouOdds: { line: 2.5, over: 1.95, under: 1.85 },
  };
}

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const json = (obj, status = 200) => {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(obj));
  };

  if (url.pathname === "/api" && req.method === "GET") {
    return json({
      service: "VOLTRIX API (mock)",
      status: "ok",
      endpoints: ["/api/matches", "/api/predictions", "/api/match/{id}", "/api/performance", "/api/forecasts/week", "/api/sync/status"],
    });
  }
  if (url.pathname === "/api/matches") return json(matches);
  if (url.pathname === "/api/predictions" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        const parsed = JSON.parse(body);
        const results = (parsed.matches ?? []).map((m) => quickPred(m.matchId));
        return json({ results, meta: { source: "snapshot", counts: { total: results.length, snapshot: results.length, fallback: 0, failed: 0 }, espnCalls: 0 } });
      } catch {
        return json({ error: "JSON invalide" }, 400);
      }
    });
    return;
  }
  if (url.pathname.startsWith("/api/match/")) {
    const id = url.pathname.split("/")[3] ?? "mock-1";
    const detail = {
      matchId: id,
      leagueCode: "mock.1",
      leagueName: "Ligue Mock (API réelle)",
      matchDate: `${today}T20:00:00.000Z`,
      status: "pre",
      statusDetail: "",
      homeScore: null,
      awayScore: null,
      venue: { name: "Mock Arena", city: "Mockville", country: "Testland" },
      odds: {
        provider: "DraftKings",
        hasOdds: true,
        moneyline: {
          home: { open: 1.95, close: 1.9 },
          draw: { open: 3.6, close: 3.5 },
          away: { open: 3.7, close: 3.8 },
        },
        overUnderLine: 2.5,
        total: {
          over: { line: 2.5, openOdds: 1.92, closeOdds: 1.95 },
          under: { line: 2.5, openOdds: 1.88, closeOdds: 1.85 },
        },
      },
      home: {
        id: "mh1", name: "Mock United", logo: null, elo: 1750,
        form: [
          { result: "W", opponent: "Alpha FC", score: "2-0", home: true, date: `${today}` },
          { result: "D", opponent: "Beta FC", score: "1-1", home: false, date: `${today}` },
        ],
        formScore: 0.72, goalsForPerMatch: 1.8, goalsAgainstPerMatch: 0.9,
        goalsForHome: 2.1, goalsAgainstHome: 0.7, goalsForAway: 1.5, goalsAgainstAway: 1.1,
        cleanSheetsPct: 42, failedToScorePct: 12, fatigueDaysSinceLast: 5,
        matchesLast14Days: 3, injuriesCount: 2, injuriesKey: 1, rank: 3, points: 41, gamesPlayed: 22,
      },
      away: {
        id: "ma1", name: "Test City", logo: null, elo: 1688,
        form: [
          { result: "L", opponent: "Gamma FC", score: "0-2", home: true, date: `${today}` },
          { result: "W", opponent: "Delta FC", score: "3-1", home: false, date: `${today}` },
        ],
        formScore: 0.51, goalsForPerMatch: 1.3, goalsAgainstPerMatch: 1.4,
        goalsForHome: 1.6, goalsAgainstHome: 1.2, goalsForAway: 1.0, goalsAgainstAway: 1.6,
        cleanSheetsPct: 28, failedToScorePct: 22, fatigueDaysSinceLast: 3,
        matchesLast14Days: 4, injuriesCount: 0, injuriesKey: 0, rank: 9, points: 30, gamesPlayed: 22,
      },
      prediction: {
        probs: { home: 0.51, draw: 0.26, away: 0.23 },
        poisson: { home: 0.49, draw: 0.27, away: 0.24 },
        elo: { home: 0.55, draw: 0.25, away: 0.2 },
        form: { home: 0.52, draw: 0.26, away: 0.22 },
        overUnder: [
          { line: 1.5, over: 0.8, under: 0.2 },
          { line: 2.5, over: 0.58, under: 0.42 },
          { line: 3.5, over: 0.33, under: 0.67 },
        ],
        btts: { yes: 0.55, no: 0.45 },
        raw: { overUnder: [{ line: 2.5, over: 0.61, under: 0.39 }], btts: { yes: 0.58, no: 0.42 } },
        topScores: [
          { score: "2-1", prob: 0.12 },
          { score: "1-1", prob: 0.11 },
          { score: "1-0", prob: 0.1 },
          { score: "2-0", prob: 0.09 },
          { score: "0-1", prob: 0.07 },
        ],
        firstGoalTiming: [
          { window: "0-15", label: "Avant la 16e", prob: 0.26 },
          { window: "16-30", label: "Entre la 16e et 30e", prob: 0.22 },
          { window: "31-45", label: "Entre la 31e et 45e", prob: 0.19 },
          { window: "46-60", label: "Entre la 46e et 60e", prob: 0.14 },
          { window: "61-75", label: "Entre la 61e et 75e", prob: 0.1 },
          { window: "76-90", label: "Après la 75e", prob: 0.09 },
          { window: "NO_GOAL", label: "Aucun but", prob: 0.06 },
        ],
        firstToScore: { home: 0.52, away: 0.4, noGoal: 0.08 },
        lambda: { home: 1.7, away: 1.1, total: 2.8 },
        confidence: 4,
        confidenceLabel: "Bonne",
        valueBets: [
          { market: "1X2", pick: "1 - Mock United", modelProb: 0.51, odds: 1.9, edge: -0.031, kelly: 0 },
          { market: "O/U 2.5", pick: "Plus de 2.5", modelProb: 0.58, odds: 1.95, edge: 0.131, kelly: 0.141 },
        ],
        oddsMovement: "Cote over en baisse — marché converge vers le modèle",
        recommendedBets: [
          { market: "1X2", pick: "1 - Mock United", prob: 0.51, note: "blend final" },
          { market: "O/U 2.5", pick: "Plus de 2.5", prob: 0.58, note: "λ 2.8 buts" },
          { market: "BTTS", pick: "Oui", prob: 0.55, note: "" },
        ],
      },
      h2h: [
        { date: `${today}`, homeTeam: "Mock United", awayTeam: "Test City", score: "2-1", winner: "home" },
        { date: `${today}`, homeTeam: "Test City", awayTeam: "Mock United", score: "1-1", winner: "draw" },
      ],
      h2hSummary: { homeWins: 1, draws: 1, awayWins: 0, total: 2 },
      context: {
        isDerby: false,
        derbyLabel: null,
        stakesHome: "Top 4 à 2 points",
        stakesAway: "Maintien à 4 points",
        weather: { description: "Couvert", tempC: 9, windKmh: 14, precipitationMm: 0, impact: "Neutre" },
        fatigueNoteHome: "5 jours de repos",
        fatigueNoteAway: "Match en milieu de semaine",
        injuriesNoteHome: "1 latéral absent",
        injuriesNoteAway: "Aucune",
      },
    };
    return json(detail);
  }
  if (url.pathname === "/api/performance") {
    return json({
      totalPredictions: 120, pendingCount: 14, newlyResolved: 2, totalResolved: 106,
      wins: 58, winRate: 0.547, roi: 0.062, staked: 1060, returned: 1125.7,
      byMarket: { "1X2": { total: 50, wins: 27, winRate: 0.54 } },
      byConfidence: { "4": { total: 40, wins: 23, winRate: 0.575 } },
      calibration: { brierScore: 0.201, sample: 106, buckets: [{ label: "50–60 %", count: 30, avgProb: 0.55, actualRate: 0.57 }] },
      history: [
        { id: "h1", matchDate: `${today}`, leagueName: "Ligue Mock", homeTeam: "Mock United", awayTeam: "Test City", market: "1X2", pick: "1 - Mock United", probability: 0.51, odds: 1.9, confidence: 4, resolved: true, result: "WIN" },
      ],
    });
  }
  if (url.pathname === "/api/forecasts/week") {
    return json({
      week: { start: today, end: today, label: `Semaine mock ${today}`, isCurrent: true, isPast: false, prev: today, next: today },
      matches: [],
      stats: { matchesAnalyzed: 0, matchesFinished: 0, matchesPending: 0, matchesVoid: 0, globalAccuracy: null },
    });
  }
  if (url.pathname === "/api/sync/status") {
    return json({
      ok: true,
      db: { connected: true, latencyMs: 7 },
      counts: { matches: 120, teams: 40, competitions: 1, oddsSnapshots: 300, forecastSnapshots: 60, predictions: 120 },
      espnCalls: { total: 42, client: 3, sync: 39 },
      lastSync: { phase: "done", startedAt: new Date(Date.now() - 600_000).toISOString(), finishedAt: new Date(Date.now() - 540_000).toISOString() },
    });
  }
  if (url.pathname === "/api/cashout" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const parsed = JSON.parse(body);
      const jointProb = (parsed.legs ?? []).reduce((acc, l) => acc * (l.prob ?? 0.5), 1);
      const fairValue = (parsed.stake ?? 10) * (parsed.totalOdds ?? 2) * jointProb;
      const offered = parsed.offered ?? 0;
      const edge = fairValue > 0 ? offered / fairValue - 1 : 0;
      const decision = edge > 0.06 ? "SELL" : edge < -0.12 ? "HOLD" : "MAYBE";
      return json({
        legs: (parsed.legs ?? []).map((l) => ({
          matchId: l.matchId, market: l.market, pick: l.pick,
          phase: "pre", statusDetail: "", score: null, verdict: "PENDING",
          pInit: l.prob ?? 0.5, pNow: l.prob ?? 0.5,
          note: "Pas encore commencé — probabilité initiale",
        })),
        jointProb,
        fairValue: Math.round(fairValue * 100) / 100,
        offered,
        edge: Math.round(edge * 1000) / 1000,
        decision,
        message: decision === "SELL" ? "L'offre dépasse la valeur juste — vendre." : decision === "HOLD" ? "Offre sous la valeur juste — garder." : "Zone grise — proche de la valeur juste.",
        asOf: Date.now(),
      });
    });
    return;
  }
  if (url.pathname === "/api/bankroll/resolve" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const parsed = JSON.parse(body);
      return json({
        legs: (parsed.legs ?? []).map((l, i) => ({
          matchId: l.matchId, market: l.market, pick: l.pick,
          verdict: i === 0 ? "WIN" : "PENDING",
          score: "2-1",
          note: "Résolution mock",
        })),
      });
    });
    return;
  }
  json({ error: "Route inconnue (mock)" }, 404);
});

server.listen(PORT, () => console.log(`Mock VOLTRIX API sur http://localhost:${PORT}`));
