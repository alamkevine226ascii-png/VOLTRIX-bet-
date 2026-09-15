// ============================================================
// VOLTRIX bet — Types partagés client
// ============================================================

export interface LightMatch {
  id: string;
  leagueCode: string;
  leagueName: string;
  leagueShort: string;
  region: string;
  date: string;
  status: 'pre' | 'in' | 'post';
  statusDetail: string;
  home: {
    id: string;
    name: string;
    shortName: string;
    logo: string | null;
    score: number | null;
    form: string | null;
    record: string | null;
  };
  away: {
    id: string;
    name: string;
    shortName: string;
    logo: string | null;
    score: number | null;
    form: string | null;
    record: string | null;
  };
  hasOdds: boolean;
  oddsProvider: string | null;
  ouLine: number | null;
  mlHome: number | null;
  mlDraw: number | null;
  mlAway: number | null;
  venue: { name: string | null; city: string | null; country: string | null };
}

export interface QuickPred {
  matchId: string;
  leagueCode: string;
  leagueName: string;
  status: string;
  probs: { home: number; draw: number; away: number };
  lambda: { home: number; away: number; total: number };
  confidence: number;
  confidenceLabel: string;
  recommendedBets: Array<{ market: string; pick: string; prob: number; note: string }>;
  overUnder: Array<{ line: number; over: number; under: number }>;
  btts: { yes: number; no: number };
  topScores: Array<{ score: string; prob: number }>;
  valueBetsCount: number;
  ouOdds?: { line: number | null; over: number | null; under: number | null } | null;
}

export interface MatchesResponse {
  date: string;
  totalMatches: number;
  leagues: Array<{
    code: string;
    name: string;
    shortName: string;
    region: string;
    matches: LightMatch[];
  }>;
  scanMs: number;
  /** Nombre total de compétitions suivies dans le catalogue (additif Task 13, optionnel pour compat SW). */
  catalogueSize?: number;
}

// ---------- Détail match (réponse /api/match/[id]) ----------

export interface TeamAnalysisDTO {
  id: string;
  name: string;
  logo: string | null;
  elo: number;
  form: Array<{ result: 'W' | 'D' | 'L'; opponent: string; score: string; home: boolean; date: string }>;
  formScore: number;
  goalsForPerMatch: number;
  goalsAgainstPerMatch: number;
  goalsForHome: number;
  goalsAgainstHome: number;
  goalsForAway: number;
  goalsAgainstAway: number;
  cleanSheetsPct: number;
  failedToScorePct: number;
  fatigueDaysSinceLast: number | null;
  matchesLast14Days: number;
  injuriesCount: number;
  injuriesKey: number;
  rank: number | null;
  points: number;
  gamesPlayed: number;
}

export interface MatchDetailDTO {
  matchId: string;
  leagueCode: string;
  leagueName: string;
  matchDate: string;
  status: 'pre' | 'in' | 'post';
  statusDetail: string;
  homeScore: number | null;
  awayScore: number | null;
  venue: { name: string | null; city: string | null; country: string | null };
  odds: {
    provider: string;
    hasOdds: boolean;
    moneyline: {
      home: { open: number | null; close: number | null };
      draw: { open: number | null; close: number | null };
      away: { open: number | null; close: number | null };
    };
    overUnderLine: number | null;
    total: {
      over: { line: number | null; openOdds: number | null; closeOdds: number | null };
      under: { line: number | null; openOdds: number | null; closeOdds: number | null };
    };
  } | null;
  home: TeamAnalysisDTO;
  away: TeamAnalysisDTO;
  prediction: {
    probs: { home: number; draw: number; away: number };
    poisson: { home: number; draw: number; away: number };
    elo: { home: number; draw: number; away: number };
    form: { home: number; draw: number; away: number };
    overUnder: Array<{ line: number; over: number; under: number }>;
    btts: { yes: number; no: number };
    // Task 21-b (FIX 4) : probabilités Poisson BRUTES (avant calibration marché) —
    // seules honnêtes pour comparer au marché (value/edge). Le calibré reste l'affichage officiel.
    raw?: { overUnder: Array<{ line: number; over: number; under: number }>; btts: { yes: number; no: number } };
    topScores: Array<{ score: string; prob: number }>;
    firstGoalTiming: Array<{ window: string; label: string; prob: number }>;
    firstToScore: { home: number; away: number; noGoal: number };
    lambda: { home: number; away: number; total: number };
    confidence: number;
    confidenceLabel: string;
    valueBets: Array<{ market: string; pick: string; modelProb: number; odds: number; edge: number; kelly: number }>;
    oddsMovement: string | null;
    recommendedBets: Array<{ market: string; pick: string; prob: number; note: string }>;
  };
  h2h: Array<{ date: string; homeTeam: string; awayTeam: string; score: string; winner: 'home' | 'away' | 'draw' }>;
  h2hSummary: { homeWins: number; draws: number; awayWins: number; total: number };
  context: {
    isDerby: boolean;
    derbyLabel: string | null;
    stakesHome: string;
    stakesAway: string;
    weather: { description: string; tempC: number; windKmh: number; precipitationMm: number; impact: string } | null;
    fatigueNoteHome: string | null;
    fatigueNoteAway: string | null;
    injuriesNoteHome: string | null;
    injuriesNoteAway: string | null;
  };
}

// ---------- Performance ----------

export interface PerformanceDTO {
  totalPredictions: number;
  pendingCount: number;
  newlyResolved: number;
  totalResolved: number;
  wins: number;
  winRate: number;
  roi: number;
  staked: number;
  returned: number;
  /** Task 21-a (FIX 1) : compteurs économiques DISTINCTS — seules les sélections
   *  réglées avec une cote réelle (odds > 1) alimentent staked/returned/roi ;
   *  settledWithOdds = taille de ce sous-ensemble (accuracy reste sur tous). */
  economic?: { settledWithOdds: number; staked: number; returned: number; roi: number };
  /** Task 21-a (FIX 3) : échantillon réellement couvert — "full-history" = toute la base. */
  sample?: { settled: number; withOdds: number; source: string };
  byMarket: Record<string, { total: number; wins: number; winRate: number }>;
  byConfidence: Record<string, { total: number; wins: number; winRate: number }>;
  byLeague?: Record<string, { total: number; wins: number; winRate: number }>;
  calibration: {
    brierScore: number;
    sample: number;
    buckets: Array<{ label: string; count: number; avgProb: number; actualRate: number }>;
  };
  history: Array<{
    id: string;
    matchDate: string;
    leagueName: string;
    homeTeam: string;
    awayTeam: string;
    market: string;
    pick: string;
    probability: number;
    odds: number | null;
    confidence: number;
    resolved: boolean;
    result: string | null;
  }>;
}
