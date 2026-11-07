/* ============================================================
   VOLTRIX front — Données de DÉMONSTRATION
   Repli lorsque aucune URL d'API n'est configurée (ou injoignable).
   Formes STRICTEMENT identiques aux DTO de l'API VOLTRIX afin que
   chaque écran soit fidèle au rendu réel. Généré de façon
   déterministe (stable entre deux rendus).
   ============================================================ */

import type {
  LightMatch,
  LightTeam,
  MatchDetailDTO,
  MatchesResponse,
  PerformanceDTO,
  QuickPred,
  SyncStatusResponse,
  WeekMatchRow,
  WeekResponse,
  LineupsResponse,
} from "./voltrix-types";

/* ---------- PRNG déterministe ---------- */
function seedFrom(s: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return ((h >>> 0) % 10_000) / 10_000;
  };
}

const pick = <T,>(rng: () => number, arr: T[]): T => arr[Math.floor(rng() * arr.length)];
const between = (rng: () => number, lo: number, hi: number): number => lo + rng() * (hi - lo);
const round2 = (x: number): number => Math.round(x * 100) / 100;
const round3 = (x: number): number => Math.round(x * 1000) / 1000;

/* ---------- Équipes démo ---------- */
interface DemoTeam {
  name: string;
  short: string;
  elo: number;
}
const TEAMS: Record<string, DemoTeam[]> = {
  "eng.1": [
    { name: "Arsenal", short: "ARS", elo: 1796 },
    { name: "Manchester City", short: "MCI", elo: 1938 },
    { name: "Liverpool", short: "LIV", elo: 1892 },
    { name: "Chelsea", short: "CHE", elo: 1760 },
    { name: "Tottenham", short: "TOT", elo: 1721 },
    { name: "Newcastle", short: "NEW", elo: 1704 },
  ],
  "esp.1": [
    { name: "Real Madrid", short: "RMA", elo: 1901 },
    { name: "FC Barcelone", short: "BAR", elo: 1877 },
    { name: "Atlético Madrid", short: "ATM", elo: 1812 },
    { name: "Séville", short: "SEV", elo: 1718 },
    { name: "Betis", short: "BET", elo: 1690 },
    { name: "Villarreal", short: "VIL", elo: 1702 },
  ],
  "ita.1": [
    { name: "Inter", short: "INT", elo: 1844 },
    { name: "Juventus", short: "JUV", elo: 1801 },
    { name: "AC Milan", short: "MIL", elo: 1788 },
    { name: "Naples", short: "NAP", elo: 1822 },
    { name: "AS Roma", short: "ROM", elo: 1755 },
    { name: "Lazio", short: "LAZ", elo: 1739 },
  ],
  "ger.1": [
    { name: "Bayern Munich", short: "BAY", elo: 1912 },
    { name: "Borussia Dortmund", short: "BVB", elo: 1803 },
    { name: "RB Leipzig", short: "RBL", elo: 1795 },
    { name: "Bayer Leverkusen", short: "B04", elo: 1830 },
    { name: "Stuttgart", short: "VFB", elo: 1742 },
    { name: "Francfort", short: "SGE", elo: 1728 },
  ],
  "fra.1": [
    { name: "Paris SG", short: "PSG", elo: 1888 },
    { name: "Marseille", short: "OM", elo: 1748 },
    { name: "Monaco", short: "ASM", elo: 1764 },
    { name: "Lyon", short: "OL", elo: 1731 },
    { name: "Lille", short: "LOSC", elo: 1740 },
    { name: "Nice", short: "OGCN", elo: 1712 },
  ],
  "uefa.champions": [
    { name: "Real Madrid", short: "RMA", elo: 1901 },
    { name: "Bayern Munich", short: "BAY", elo: 1912 },
    { name: "Paris SG", short: "PSG", elo: 1888 },
    { name: "Inter", short: "INT", elo: 1844 },
    { name: "Arsenal", short: "ARS", elo: 1796 },
    { name: "Manchester City", short: "MCI", elo: 1938 },
  ],
};

const LEAGUE_META: Record<string, { name: string; shortName: string; region: string }> = {
  "eng.1": { name: "Premier League", shortName: "PL", region: "europe" },
  "esp.1": { name: "LaLiga", shortName: "LIG", region: "europe" },
  "ita.1": { name: "Serie A", shortName: "SEA", region: "europe" },
  "ger.1": { name: "Bundesliga", shortName: "BUN", region: "europe" },
  "fra.1": { name: "Ligue 1", shortName: "L1", region: "europe" },
  "uefa.champions": { name: "Ligue des Champions", shortName: "UCL", region: "europe" },
};

const DEMO_LEAGUES = ["eng.1", "esp.1", "ita.1", "ger.1", "fra.1", "uefa.champions"];

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function isoAddDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/* ---------- /api/matches (démo) ---------- */

export function demoMatches(date: string): MatchesResponse {
  const rng = seedFrom(`matches-${date}`);
  const leagues: MatchesResponse["leagues"] = [];
  let total = 0;

  for (const code of DEMO_LEAGUES) {
    const meta = LEAGUE_META[code];
    const teams = TEAMS[code];
    const n = 1 + Math.floor(rng() * 2); // 1-2 matchs par ligue
    const matches: LightMatch[] = [];
    for (let i = 0; i < n; i++) {
      const h = teams[(i * 2) % teams.length];
      const a = teams[(i * 2 + 1) % teams.length];
      const hour = 13 + Math.floor(rng() * 9);
      const minute = pick(rng, [0, 15, 30, 45]);
      const kickoff = new Date(`${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`);
      const now = Date.now();
      const ms = kickoff.getTime();
      const status: LightMatch["status"] = ms > now + 30 * 60_000 ? "pre" : ms > now - 2 * 3600_000 ? "in" : "post";
      const hs = status === "pre" ? null : Math.floor(rng() * 4);
      const as = status === "pre" ? null : Math.floor(rng() * 3);
      const mlH = round2(between(rng, 1.35, 3.4));
      const mlD = round2(between(rng, 3.1, 4.2));
      const mlA = round2(between(rng, 1.8, 4.6));
      matches.push({
        id: `demo-${date}-${code}-${i}`,
        leagueCode: code,
        leagueName: meta.name,
        leagueShort: meta.shortName,
        region: meta.region,
        date: kickoff.toISOString(),
        status,
        statusDetail: status === "in" ? `${Math.floor(between(rng, 5, 85))}'` : status === "post" ? "FT" : "",
        home: {
          id: `h-${h.short}`,
          name: h.name,
          shortName: h.short,
          logo: null,
          score: hs,
          form: "WDWWL".slice(0, 3 + Math.floor(rng() * 3)),
          record: null,
        },
        away: {
          id: `a-${a.short}`,
          name: a.name,
          shortName: a.short,
          logo: null,
          score: as,
          form: "WDLWD".slice(0, 3 + Math.floor(rng() * 3)),
          record: null,
        },
        hasOdds: rng() > 0.25,
        oddsProvider: rng() > 0.5 ? "DraftKings" : null,
        ouLine: 2.5,
        mlHome: mlH,
        mlDraw: mlD,
        mlAway: mlA,
        venue: { name: `${h.short} Arena`, city: null, country: null },
      });
      total++;
    }
    leagues.push({ code, name: meta.name, shortName: meta.shortName, region: meta.region, matches });
  }

  return { date, totalMatches: total, leagues, scanMs: 42, catalogueSize: 140 };
}

/* ---------- POST /api/predictions (démo) ---------- */

export function demoPredictions(matches: LightMatch[]): QuickPred[] {
  return matches.map((m) => {
    const rng = seedFrom(`pred-${m.id}`);
    let ph = between(rng, 0.22, 0.62);
    let pd = between(rng, 0.18, 0.3);
    let pa = 1 - ph - pd;
    if (pa < 0.08) {
      pa = 0.12;
      ph = Math.max(0.1, 1 - pd - pa);
    }
    const s = ph + pd + pa;
    ph /= s;
    pd /= s;
    pa /= s;
    const conf = 1 + Math.floor(rng() * 5);
    const over = between(rng, 0.38, 0.68);
    const yes = between(rng, 0.4, 0.7);
    const lambdaH = round2(between(rng, 0.9, 2.1));
    const lambdaA = round2(between(rng, 0.7, 1.8));
    const best = ph > pa ? (ph > pd ? { market: "1X2", pick: `1 - ${m.home.name}`, prob: ph } : { market: "1X2", pick: "Match nul", prob: pd }) : pa > pd ? { market: "1X2", pick: `2 - ${m.away.name}`, prob: pa } : { market: "1X2", pick: "Match nul", prob: pd };
    return {
      matchId: m.id,
      leagueCode: m.leagueCode,
      leagueName: m.leagueName,
      status: m.status,
      probs: { home: round3(ph), draw: round3(pd), away: round3(pa) },
      lambda: { home: lambdaH, away: lambdaA, total: round2(lambdaH + lambdaA) },
      confidence: conf,
      confidenceLabel: ["Faible", "Limitée", "Moyenne", "Bonne", "Élevée"][conf - 1],
      recommendedBets: [
        { market: best.market, pick: best.pick, prob: round3(best.prob), note: "Meilleure probabilité du moteur" },
        { market: "O/U 2.5", pick: over >= 0.5 ? "Plus de 2.5" : "Moins de 2.5", prob: round3(Math.max(over, 1 - over)), note: "Distribution Poisson calibrée" },
        { market: "BTTS", pick: yes >= 0.5 ? "Oui" : "Non", prob: round3(Math.max(yes, 1 - yes)), note: "Les deux équipes marquent" },
      ],
      overUnder: [1.5, 2.5, 3.5].map((line) => {
        const o = line === 1.5 ? Math.min(0.95, over + 0.22) : line === 2.5 ? over : Math.max(0.08, over - 0.26);
        return { line, over: round3(o), under: round3(1 - o) };
      }),
      btts: { yes: round3(yes), no: round3(1 - yes) },
      topScores: [
        { score: "1-1", prob: round3(between(rng, 0.09, 0.14)) },
        { score: "2-1", prob: round3(between(rng, 0.07, 0.12)) },
        { score: "1-0", prob: round3(between(rng, 0.07, 0.11)) },
        { score: "2-0", prob: round3(between(rng, 0.06, 0.1)) },
        { score: "0-1", prob: round3(between(rng, 0.05, 0.09)) },
      ],
      valueBetsCount: Math.floor(rng() * 3),
      ouOdds: m.hasOdds ? { line: 2.5, over: round2(between(rng, 1.7, 2.1)), under: round2(between(rng, 1.7, 2.1)) } : null,
    };
  });
}

/* ---------- GET /api/match/[id] (démo) ---------- */

export function demoMatchDetail(matchId: string): MatchDetailDTO {
  const rng = seedFrom(`detail-${matchId}`);
  const m = findDemoMatch(matchId);
  const FALLBACK_HOME: LightTeam = { id: "h-ARS", name: "Arsenal", shortName: "ARS", logo: null, score: null, form: "WWDLW", record: null };
  const FALLBACK_AWAY: LightTeam = { id: "a-CHE", name: "Chelsea", shortName: "CHE", logo: null, score: null, form: "WDWWL", record: null };
  const h = m?.home ?? FALLBACK_HOME;
  const a = m?.away ?? FALLBACK_AWAY;
  let ph = between(rng, 0.25, 0.6);
  const pd = between(rng, 0.2, 0.29);
  let pa = 1 - ph - pd;
  if (pa < 0.1) {
    pa = 0.14;
    ph = 1 - pd - pa;
  }
  const poisson = { home: round3(ph - 0.03), draw: round3(pd + 0.02), away: round3(pa + 0.01) };
  const elo = { home: round3(ph + 0.04), draw: round3(pd - 0.02), away: round3(pa - 0.02) };
  const form = { home: round3(ph - 0.02), draw: round3(pd), away: round3(pa + 0.02) };
  const probs = { home: round3(ph), draw: round3(pd), away: round3(pa) };
  const over = between(rng, 0.4, 0.66);
  const yes = between(rng, 0.42, 0.68);
  const conf = 2 + Math.floor(rng() * 4);
  const lambdaH = round2(between(rng, 1.0, 2.2));
  const lambdaA = round2(between(rng, 0.8, 1.9));

  const team = (t: typeof h, eloScore: number, rank: number): MatchDetailDTO["home"] => ({
    id: t.id,
    name: t.name,
    logo: null,
    elo: eloScore,
    form: [1, 2, 3, 4, 5].map((i) => ({
      result: pick(rng, ["W", "W", "D", "L"] as const),
      opponent: pick(rng, ["Everton", "Fulham", "Brentford", "Brighton", "West Ham"]),
      score: `${Math.floor(rng() * 4)}-${Math.floor(rng() * 3)}`,
      home: rng() > 0.5,
      date: isoAddDays(todayISO(), -7 * i),
    })),
    formScore: round2(between(rng, 0.4, 0.9)),
    goalsForPerMatch: round2(between(rng, 1.2, 2.4)),
    goalsAgainstPerMatch: round2(between(rng, 0.6, 1.5)),
    goalsForHome: round2(between(rng, 1.4, 2.6)),
    goalsAgainstHome: round2(between(rng, 0.5, 1.3)),
    goalsForAway: round2(between(rng, 1.0, 2.2)),
    goalsAgainstAway: round2(between(rng, 0.7, 1.6)),
    cleanSheetsPct: Math.round(between(rng, 15, 55)),
    failedToScorePct: Math.round(between(rng, 8, 35)),
    fatigueDaysSinceLast: Math.round(between(rng, 2, 8)),
    matchesLast14Days: Math.round(between(rng, 2, 6)),
    injuriesCount: Math.round(between(rng, 0, 5)),
    injuriesKey: Math.round(between(rng, 0, 3)),
    rank,
    points: Math.round(between(rng, 20, 62)),
    gamesPlayed: 20 + Math.floor(rng() * 8),
  });

  const best = probs.home > probs.away ? { market: "1X2", pick: `1 - ${h.name}`, prob: probs.home } : { market: "1X2", pick: `2 - ${a.name}`, prob: probs.away };

  return {
    matchId,
    leagueCode: m?.leagueCode ?? "eng.1",
    leagueName: m?.leagueName ?? "Premier League",
    matchDate: m?.date ?? `${todayISO()}T20:00:00Z`,
    status: m?.status ?? "pre",
    statusDetail: m?.statusDetail ?? "",
    homeScore: m?.home.score ?? null,
    awayScore: m?.away.score ?? null,
    venue: { name: `${h.shortName} Arena`, city: "Londres", country: "Angleterre" },
    odds: m?.hasOdds
      ? {
          provider: "DraftKings",
          hasOdds: true,
          moneyline: {
            home: { open: round2(between(rng, 1.4, 1.9)), close: m.mlHome },
            draw: { open: round2(between(rng, 3.4, 4)), close: m.mlDraw },
            away: { open: round2(between(rng, 2, 2.6)), close: m.mlAway },
          },
          overUnderLine: 2.5,
          total: {
            over: { line: 2.5, openOdds: round2(between(rng, 1.8, 2.05)), closeOdds: round2(between(rng, 1.75, 2.0)) },
            under: { line: 2.5, openOdds: round2(between(rng, 1.75, 2.0)), closeOdds: round2(between(rng, 1.8, 2.05)) },
          },
        }
      : null,
    home: team(h, 1780 + Math.round(between(rng, -60, 90)), 1 + Math.floor(rng() * 8)),
    away: team(a, 1760 + Math.round(between(rng, -60, 90)), 1 + Math.floor(rng() * 8)),
    prediction: {
      probs,
      poisson,
      elo,
      form,
      overUnder: [1.5, 2.5, 3.5].map((line) => {
        const o = line === 1.5 ? Math.min(0.94, over + 0.21) : line === 2.5 ? over : Math.max(0.09, over - 0.25);
        return { line, over: round3(o), under: round3(1 - o) };
      }),
      btts: { yes: round3(yes), no: round3(1 - yes) },
      raw: {
        overUnder: [{ line: 2.5, over: round3(over + 0.04), under: round3(1 - over - 0.04) }],
        btts: { yes: round3(yes + 0.03), no: round3(1 - yes - 0.03) },
      },
      topScores: [
        { score: "1-1", prob: round3(between(rng, 0.1, 0.14)) },
        { score: "2-1", prob: round3(between(rng, 0.08, 0.12)) },
        { score: "1-0", prob: round3(between(rng, 0.08, 0.11)) },
        { score: "2-0", prob: round3(between(rng, 0.06, 0.1)) },
        { score: "0-1", prob: round3(between(rng, 0.05, 0.09)) },
      ],
      firstGoalTiming: [
        { window: "0-15", label: "Avant la 16e", prob: round3(between(rng, 0.2, 0.32)) },
        { window: "16-30", label: "Entre la 16e et 30e", prob: round3(between(rng, 0.18, 0.26)) },
        { window: "31-45", label: "Entre la 31e et 45e", prob: round3(between(rng, 0.15, 0.24)) },
        { window: "46-60", label: "Entre la 46e et 60e", prob: round3(between(rng, 0.12, 0.2)) },
        { window: "61-75", label: "Entre la 61e et 75e", prob: round3(between(rng, 0.1, 0.18)) },
        { window: "76-90", label: "Après la 75e", prob: round3(between(rng, 0.1, 0.2)) },
        { window: "NO_GOAL", label: "Aucun but", prob: round3(between(rng, 0.04, 0.1)) },
      ],
      firstToScore: { home: round3(between(rng, 0.38, 0.55)), away: round3(between(rng, 0.28, 0.44)), noGoal: round3(between(rng, 0.04, 0.1)) },
      lambda: { home: lambdaH, away: lambdaA, total: round2(lambdaH + lambdaA) },
      confidence: conf,
      confidenceLabel: ["Faible", "Limitée", "Moyenne", "Bonne", "Élevée"][conf - 1],
      valueBets: Array.from({ length: 1 + Math.floor(rng() * 2) }, (_, i) => {
        const mp = between(rng, 0.45, 0.72);
        const odds = round2(between(rng, 1.6, 2.6));
        return {
          market: i === 0 ? "1X2" : i === 1 ? "O/U 2.5" : "BTTS",
          pick: i === 0 ? (probs.home > probs.away ? `1 - ${h.name}` : `2 - ${a.name}`) : i === 1 ? "Plus de 2.5" : "Oui",
          modelProb: round3(mp),
          odds,
          edge: round3(odds * mp - 1),
          kelly: round3(Math.max(0, (odds * mp - 1) / (odds - 1))),
        };
      }),
      oddsMovement: rng() > 0.5 ? "Cote domicile en baisse (-0.08) — marché qui se rapproche du modèle" : null,
      recommendedBets: [
        { market: best.market, pick: best.pick, prob: best.prob, note: "Meilleure probabilité du moteur (blend Poisson/Elo/Forme)" },
        { market: "O/U 2.5", pick: over >= 0.5 ? "Plus de 2.5" : "Moins de 2.5", prob: round3(Math.max(over, 1 - over)), note: "λ total " + round2(lambdaH + lambdaA) + " buts attendus" },
        { market: "BTTS", pick: yes >= 0.5 ? "Oui" : "Non", prob: round3(Math.max(yes, 1 - yes)), note: "Les deux équipes marquent" },
      ],
    },
    h2h: [1, 2, 3, 4, 5].map((i) => {
      const hs = Math.floor(rng() * 4);
      const as = Math.floor(rng() * 3);
      return {
        date: isoAddDays(todayISO(), -90 * i),
        homeTeam: i % 2 === 0 ? h.name : a.name,
        awayTeam: i % 2 === 0 ? a.name : h.name,
        score: `${hs}-${as}`,
        winner: hs > as ? "home" : hs < as ? "away" : "draw",
      };
    }),
    h2hSummary: { homeWins: 2, draws: 1, awayWins: 2, total: 5 },
    context: {
      isDerby: rng() > 0.7,
      derbyLabel: rng() > 0.7 ? "Derby local" : null,
      stakesHome: "Lutte pour le top 4 — victoire = +3 pts sur le 5e",
      stakesAway: "Milieu de tableau, jouera l'Europe via la coupe",
      weather: {
        description: pick(rng, ["Partiellement nuageux", "Pluie fine", "Dégagé", "Couvert"]),
        tempC: Math.round(between(rng, 4, 22)),
        windKmh: Math.round(between(rng, 5, 38)),
        precipitationMm: round2(between(rng, 0, 4)),
        impact: pick(rng, ["Neutre", "Légèrement défavorable aux buts", "Vent pénalisant les longs ballons"]),
      },
      fatigueNoteHome: "3 matchs sur 14 jours — fatigue modérée",
      fatigueNoteAway: "5 jours de repos — frais",
      injuriesNoteHome: "2 absents (milieu défensif, latéral gauche)",
      injuriesNoteAway: "Aucune absence notable",
    },
  };
}

/* ---------- GET /api/performance (démo) ---------- */

export function demoPerformance(): PerformanceDTO {
  const rng = seedFrom("perf");
  const mk = (total: number, rate: number) => ({ total, wins: Math.round(total * rate), winRate: round3(rate) });
  return {
    totalPredictions: 4820,
    pendingCount: 214,
    newlyResolved: 12,
    totalResolved: 4606,
    wins: 2431,
    winRate: 0.5276,
    roi: 0.048,
    staked: 31420,
    returned: 32928.4,
    economic: { settledWithOdds: 3104, staked: 31040, returned: 32529.8, roi: 0.0479 },
    sample: { settled: 4606, withOdds: 3104, source: "full-history" },
    byMarket: {
      "1X2": mk(1846, 0.55),
      "O/U 2.5": mk(1512, 0.53),
      BTTS: mk(1248, 0.49),
    },
    byConfidence: {
      "1": mk(312, 0.41),
      "2": mk(688, 0.46),
      "3": mk(1204, 0.5),
      "4": mk(1478, 0.55),
      "5": mk(924, 0.62),
    },
    byLeague: {
      "Premier League": mk(984, 0.54),
      LaLiga: mk(812, 0.52),
      "Serie A": mk(756, 0.53),
      Bundesliga: mk(702, 0.51),
      "Ligue 1": mk(648, 0.5),
    },
    byVersion: {
      "v2.1": mk(3120, 0.53),
      "v2.2": mk(1486, 0.55),
    },
    calibration: {
      brierScore: 0.198,
      sample: 4606,
      buckets: [
        { label: "0–50 %", count: 1840, avgProb: 0.38, actualRate: 0.36 },
        { label: "50–60 %", count: 916, avgProb: 0.55, actualRate: 0.54 },
        { label: "60–70 %", count: 704, avgProb: 0.65, actualRate: 0.66 },
        { label: "70–80 %", count: 512, avgProb: 0.74, actualRate: 0.76 },
        { label: "80–90 %", count: 384, avgProb: 0.84, actualRate: 0.83 },
        { label: "90–100 %", count: 250, avgProb: 0.92, actualRate: 0.9 },
      ],
    },
    history: Array.from({ length: 18 }, (_, i) => {
      const resolved = i > 3;
      const res = resolved ? pick(rng, ["WIN", "WIN", "LOSE", "LOSE", "LOSE", "VOID"] as const) : null;
      const lg = pick(rng, ["Premier League", "LaLiga", "Serie A", "Bundesliga", "Ligue 1"]);
      const ht = pick(rng, ["Arsenal", "Real Madrid", "Inter", "Bayern", "Paris SG", "Liverpool", "Naples", "Barcelone"]);
      let at = pick(rng, ["Chelsea", "Séville", "Juventus", "Dortmund", "Marseille", "Newcastle", "Milan", "Betis"]);
      if (at === ht) at = "Lyon";
      const market = pick(rng, ["1X2", "O/U 2.5", "BTTS"]);
      const pickTxt = market === "1X2" ? `1 - ${ht}` : market === "O/U 2.5" ? "Plus de 2.5" : "Oui";
      return {
        id: `p-${i}`,
        matchDate: isoAddDays(todayISO(), -i - 1) + "T20:00:00Z",
        leagueName: lg,
        homeTeam: ht,
        awayTeam: at,
        market,
        pick: pickTxt,
        probability: round3(between(rng, 0.42, 0.78)),
        odds: round2(between(rng, 1.55, 2.4)),
        confidence: 2 + Math.floor(rng() * 4),
        resolved,
        result: res,
      };
    }),
  };
}

/* ---------- GET /api/forecasts/week (démo) ---------- */

export function demoWeek(start: string): WeekResponse {
  const rng = seedFrom(`week-${start}`);
  const codes = DEMO_LEAGUES.slice(0, 5);
  const rows: WeekMatchRow[] = [];
  let dayN = 0;
  for (const code of codes) {
    const teams = TEAMS[code];
    for (let i = 0; i < 2; i++) {
      const h = teams[(i * 2) % teams.length];
      const a = teams[(i * 2 + 1) % teams.length];
      const d = isoAddDays(start, dayN % 7);
      dayN++;
      const kickoff = new Date(`${d}T${18 + (i * 2)}:00:00Z`);
      const past = kickoff.getTime() < Date.now();
      const ph = between(rng, 0.28, 0.62);
      const pd = between(rng, 0.19, 0.28);
      const pa = Math.max(0.1, 1 - ph - pd);
      const s = ph + pd + pa;
      const hs = past ? Math.floor(rng() * 4) : null;
      const as = past ? Math.floor(rng() * 3) : null;
      const pick1 = ph >= pa && ph >= pd ? "1" : pa >= pd ? "2" : "X";
      const over = between(rng, 0.42, 0.62);
      const yes = between(rng, 0.44, 0.64);
      const correct = rng() > 0.45;
      const grade = (good: boolean) => (past ? (rng() > 0.08 ? (good ? "CORRECT" : "INCORRECT") : "VOID") : null);
      rows.push({
        matchId: `demo-${d}-${code}-${i}`,
        league: code,
        leagueName: LEAGUE_META[code].name,
        kickoff: kickoff.toISOString(),
        homeTeamId: `h-${h.short}`,
        homeTeam: h.name,
        homeLogo: null,
        awayTeamId: `a-${a.short}`,
        awayTeam: a.name,
        awayLogo: null,
        effectiveStatus: past ? "FINAL" : "SCHEDULED",
        statusLabel: past ? "TERMINÉ" : "À VENIR",
        result: past ? { status: "FINAL", homeScore: hs, awayScore: as } : null,
        snapshot: {
          version: 1 + Math.floor(rng() * 2),
          p1x2Home: round3((ph / s)),
          p1x2Draw: round3(pd / s),
          p1x2Away: round3(pa / s),
          pick1x2: pick1,
          pick1x2Label: pick1 === "1" ? `1 - ${h.name}` : pick1 === "2" ? `2 - ${a.name}` : "Match nul",
          confidence: 1 + Math.floor(rng() * 5),
          pOver25: round3(over),
          pUnder25: round3(1 - over),
          pickOu25: over >= 0.5 ? "OVER" : "UNDER",
          pBttsYes: round3(yes),
          pBttsNo: round3(1 - yes),
          pickBtts: yes >= 0.5 ? "YES" : "NO",
          predictionTime: new Date(kickoff.getTime() - 20 * 3600_000).toISOString(),
          modelVersion: "v2.2",
          odds1x2Home: round2(between(rng, 1.5, 2.8)),
          odds1x2Draw: round2(between(rng, 3.2, 4)),
          odds1x2Away: round2(between(rng, 2.2, 4.4)),
        },
        evaluation: past
          ? { grade1x2: grade(correct), gradeOu25: grade(!correct), gradeBtts: grade(correct) }
          : null,
        predictionPending: !past,
        predictionOutOfRange: false,
      });
    }
  }
  const n1 = rows.filter((r) => r.evaluation?.grade1x2 === "CORRECT").length;
  const nT = rows.filter((r) => r.evaluation && r.evaluation.grade1x2 && r.evaluation.grade1x2 !== "VOID").length;
  return {
    week: {
      start,
      end: isoAddDays(start, 6),
      label: `Semaine du ${start}`,
      isCurrent: true,
      isPast: false,
      prev: isoAddDays(start, -7),
      next: isoAddDays(start, 7),
    },
    matches: rows,
    stats: {
      matchesAnalyzed: rows.length,
      matchesFinished: rows.filter((r) => r.result).length,
      matchesPending: rows.filter((r) => !r.result).length,
      matchesVoid: 1,
      globalAccuracy: nT ? round3(n1 / nT) : null,
      globalCorrect: n1,
      globalEvaluable: nT,
      m1x2: { n: nT, correct: n1, incorrect: nT - n1, void: 1, pending: rows.filter((r) => !r.evaluation).length, accuracy: nT ? round3(n1 / nT) : null },
      ou25: { n: nT, correct: Math.round(nT * 0.52), incorrect: nT - Math.round(nT * 0.52), void: 0, pending: 0, accuracy: 0.52 },
      btts: { n: nT, correct: Math.round(nT * 0.48), incorrect: nT - Math.round(nT * 0.48), void: 0, pending: 0, accuracy: 0.48 },
      calibration1x2: [
        { label: "0–50 %", n: 4, predicted: 0.42, actual: 0.4 },
        { label: "50–60 %", n: 3, predicted: 0.55, actual: 0.57 },
        { label: "60–70 %", n: 2, predicted: 0.65, actual: 0.62 },
      ],
    },
  };
}

/* ---------- GET /api/match/[id]/lineups (démo) ---------- */

const POS_ORDER = ["G", "D", "M", "F"] as const;

export function demoLineups(matchId: string): LineupsResponse {
  const rng = seedFrom(`lineups-${matchId}`);
  const m = findDemoMatch(matchId);
  const mkTeam = (side: "home" | "away") => {
    const t = side === "home" ? m?.home : m?.away;
    const names = [
      "Ramsdale", "White", "Saliba", "Gabriel", "Timber",
      "Rice", "Ødegaard", "Havertz", "Saka", "Martinelli", "Jesus",
    ];
    const benchNames = ["Trossard", "Nketiah", "Jorginho", "Kiwior", "Zinchenko"];
    const starters = names.map((n, i) => ({
      athleteId: `demo-${side}-${i}`,
      name: n,
      shortName: n,
      jersey: String([1, 4, 2, 6, 12, 41, 8, 29, 7, 11, 9][i]),
      position: POS_ORDER[i < 1 ? 0 : i < 5 ? 1 : i < 8 ? 2 : 3],
      positionDetail: null,
      starter: true,
      formationPlace: i + 1,
      age: 21 + Math.floor(rng() * 14),
      heightCm: 168 + Math.floor(rng() * 25),
      weightKg: 64 + Math.floor(rng() * 26),
      nationality: pick(rng, ["Angleterre", "Brésil", "France", "Norvège", "Ghana"]),
      espnHeadshot: null,
      tm: rng() > 0.2 ? { valueEur: Math.round(between(rng, 2, 110)) * 1_000_000, contractUntil: "2028", foot: pick(rng, ["Droit", "Gauche"]), photoUrl: null, approx: false } : null,
    }));
    const bench = benchNames.map((n, i) => ({
      athleteId: `demo-${side}-b${i}`,
      name: n,
      shortName: n,
      jersey: String([27, 20, 23, 15, 35][i]),
      position: POS_ORDER[Math.floor(rng() * 4)],
      positionDetail: null,
      starter: false,
      formationPlace: null,
      age: 20 + Math.floor(rng() * 15),
      heightCm: 170 + Math.floor(rng() * 20),
      weightKg: 66 + Math.floor(rng() * 22),
      nationality: pick(rng, ["Angleterre", "Pays-Bas", "Espagne", "Japon"]),
      espnHeadshot: null,
      tm: rng() > 0.5 ? { valueEur: Math.round(between(rng, 5, 60)) * 1_000_000, contractUntil: "2027", foot: "Droit", photoUrl: null, approx: false } : null,
    }));
    return {
      teamId: t?.id ?? `${side}-demo`,
      name: t?.name ?? (side === "home" ? "Arsenal" : "Chelsea"),
      shortName: t?.shortName ?? (side === "home" ? "ARS" : "CHE"),
      logo: null,
      formation: { text: "4-3-3", source: "deduced" as const },
      lineupsPublished: false,
      coach: side === "home" ? "Entraîneur domicile" : "Entraîneur extérieur",
      starters,
      bench,
      squad: [...starters, ...bench],
      squadValueEur: Math.round(between(rng, 400, 1200)) * 1_000_000,
      profile: { rank: side === "home" ? 2 : 6, gamesPlayed: 24, goalsForPerMatch: round2(between(rng, 1.4, 2.4)), goalsAgainstPerMatch: round2(between(rng, 0.7, 1.4)) },
    };
  };
  return {
    matchId,
    leagueCode: m?.leagueCode ?? "eng.1",
    seasonYear: 2026,
    venue: { name: m ? `Stade ${m.home.name}` : "Emirates Stadium", city: null, country: null },
    attendance: 60_278,
    weather: { description: "Dégagé", tempC: 11 },
    home: mkTeam("home"),
    away: mkTeam("away"),
  };
}

/* ---------- GET /api/sync/status (démo) ---------- */

export function demoSyncStatus(): SyncStatusResponse {
  return {
    ok: true,
    db: { connected: true, latencyMs: 38 },
    counts: {
      matches: 4412,
      teams: 1870,
      competitions: 142,
      oddsSnapshots: 89_204,
      predictionSnapshots: 3104,
      predictionMarkets: 21_728,
      predictionOutcomes: 96_512,
      forecastSnapshots: 2540,
      predictions: 4820,
    },
    espnCalls: { total: 1420, client: 96, sync: 1324 },
    lastSync: {
      phase: "done",
      startedAt: new Date(Date.now() - 41 * 60_000).toISOString(),
      finishedAt: new Date(Date.now() - 39 * 60_000).toISOString(),
    },
    lastForecastJob: {
      phase: "done",
      startedAt: new Date(Date.now() - 38 * 60_000).toISOString(),
      finishedAt: new Date(Date.now() - 35 * 60_000).toISOString(),
    },
  };
}

/* ---------- Utilitaires démo ---------- */

const demoCache = new Map<string, MatchesResponse>();

export function demoMatchesFor(date: string): MatchesResponse {
  if (!demoCache.has(date)) demoCache.set(date, demoMatches(date));
  return demoCache.get(date)!;
}

export function findDemoMatch(matchId: string): LightMatch | undefined {
  for (const code of DEMO_LEAGUES) {
    for (let off = -2; off <= 3; off++) {
      const d = isoAddDays(todayISO(), off);
      const res = demoMatchesFor(d);
      for (const lg of res.leagues) {
        const m = lg.matches.find((x) => x.id === matchId);
        if (m) return m;
      }
    }
  }
  return undefined;
}
