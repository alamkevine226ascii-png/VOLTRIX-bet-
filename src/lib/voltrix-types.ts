/* ============================================================
   VOLTRIX front — Types partagés (miroir des DTO de l'API VOLTRIX)
   Source : dépôt github.com/alamkevine226ascii-png/VOLTRIX-bet-
   (src/lib/types.ts + routes API)
   ============================================================ */

// ---------- /api/matches ----------

export interface LightMatch {
  id: string;
  leagueCode: string;
  leagueName: string;
  leagueShort: string;
  region: string;
  date: string;
  status: 'pre' | 'in' | 'post';
  statusDetail: string;
  home: LightTeam;
  away: LightTeam;
  hasOdds: boolean;
  oddsProvider: string | null;
  ouLine: number | null;
  mlHome: number | null;
  mlDraw: number | null;
  mlAway: number | null;
  venue: { name: string | null; city: string | null; country: string | null };
}

export interface LightTeam {
  id: string;
  name: string;
  shortName: string;
  logo: string | null;
  score: number | null;
  form: string | null; // "WDLWW" — 5 derniers, du plus ancien au plus récent
  record: string | null;
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
  catalogueSize?: number;
}

// ---------- POST /api/predictions (QuickPred) ----------

export interface QuickPred {
  matchId: string;
  leagueCode: string;
  leagueName: string;
  status: string;
  probs: { home: number; draw: number; away: number };
  lambda?: { home: number; away: number; total: number };
  confidence: number; // 1..5
  confidenceLabel: string;
  recommendedBets: RecommendedBet[];
  overUnder: Array<{ line: number; over: number; under: number }>;
  btts: { yes: number; no: number };
  topScores: Array<{ score: string; prob: number }>;
  valueBetsCount: number;
  ouOdds?: { line: number | null; over: number | null; under: number | null } | null;
}

export interface RecommendedBet {
  market: string;
  pick: string;
  prob: number;
  note: string;
}

export interface PredictionsResponse {
  results: Array<QuickPred | null>;
  meta?: {
    source: 'snapshot' | 'fallback' | 'mixed' | 'empty';
    counts: { total: number; snapshot: number; fallback: number; failed: number };
    espnCalls: number;
  };
}

// ---------- GET /api/match/[id] (MatchDetailDTO) ----------

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
    raw?: {
      overUnder: Array<{ line: number; over: number; under: number }>;
      btts: { yes: number; no: number };
    };
    topScores: Array<{ score: string; prob: number }>;
    firstGoalTiming: Array<{
      window: string;
      label: string;
      prob: number;
      /** Source du calcul : minutes RÉELLES des 1ers buts des matchs des
       * deux équipes (summaries ESPN) ou profil de ligue empirique. */
      basis?: "equipes" | "ligue";
      sampleMatches?: number;
    }>;
    /** Titre « 1er but attendu vers la Xe minute » (moteur dédié
     * first-goal.ts) : minute médiane, fenêtre la plus probable,
     * tempo médian de chaque équipe, traçabilité du calcul. */
    firstGoalHeadline?: {
      expectedMinute: number | null;
      bestWindow: number;
      bestWindowProb: number;
      noGoalProb: number;
      homeMedianMinute: number | null;
      awayMedianMinute: number | null;
      basis: "equipes" | "ligue";
      sampleMatches: number;
      lambdaScale: number;
    };
    firstToScore: { home: number; away: number; noGoal: number };
    lambda: { home: number; away: number; total: number };
    confidence: number; // 1..5
    confidenceLabel: string;
    valueBets: Array<ValueBet>;
    oddsMovement: string | null;
    recommendedBets: RecommendedBet[];
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

export interface ValueBet {
  market: string;
  pick: string;
  modelProb: number;
  odds: number;
  edge: number;
  kelly: number;
}

// ---------- GET /api/performance ----------

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
  economic?: { settledWithOdds: number; staked: number; returned: number; roi: number };
  sample?: { settled: number; withOdds: number; source: string };
  byMarket: Record<string, { total: number; wins: number; winRate: number }>;
  byConfidence: Record<string, { total: number; wins: number; winRate: number }>;
  byLeague?: Record<string, { total: number; wins: number; winRate: number }>;
  byVersion?: Record<string, { total: number; wins: number; winRate: number }>;
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

// ---------- GET /api/forecasts/week ----------

export interface WeekMatchRow {
  matchId: string;
  league: string;
  leagueName: string;
  kickoff: string;
  homeTeamId: string | null;
  homeTeam: string;
  homeLogo: string | null;
  awayTeamId: string | null;
  awayTeam: string;
  awayLogo: string | null;
  effectiveStatus: string;
  statusLabel: string;
  result: { status: string; homeScore: number | null; awayScore: number | null } | null;
  snapshot: {
    version: number;
    p1x2Home: number;
    p1x2Draw: number;
    p1x2Away: number;
    pick1x2: string;
    pick1x2Label: string;
    confidence: number;
    pOver25: number;
    pUnder25: number;
    pickOu25: string;
    pBttsYes: number;
    pBttsNo: number;
    pickBtts: string;
    predictionTime: string;
    modelVersion: string;
    odds1x2Home: number | null;
    odds1x2Draw: number | null;
    odds1x2Away: number | null;
  } | null;
  evaluation: { grade1x2: string | null; gradeOu25: string | null; gradeBtts: string | null } | null;
  predictionPending: boolean;
  predictionOutOfRange: boolean;
}

export interface WeekResponse {
  week: {
    start: string;
    end: string;
    label: string;
    isCurrent: boolean;
    isPast: boolean;
    prev: string;
    next: string;
  };
  matches: WeekMatchRow[];
  stats: {
    matchesAnalyzed?: number;
    matchesFinished?: number;
    matchesPending?: number;
    matchesVoid?: number;
    globalAccuracy?: number | null;
    globalCorrect?: number;
    globalEvaluable?: number;
    m1x2?: MarketStats;
    ou25?: MarketStats;
    btts?: MarketStats;
    calibration1x2?: CalibrationBucket[];
    [k: string]: unknown;
  };
}

export interface MarketStats {
  n?: number;
  correct?: number;
  incorrect?: number;
  void?: number;
  pending?: number;
  accuracy?: number | null;
}

export interface CalibrationBucket {
  label: string;
  n: number;
  predicted?: number;
  actual?: number;
}

// ---------- POST /api/cashout ----------

export interface CashoutResponse {
  legs: Array<{
    matchId: string;
    market: string;
    pick: string;
    phase: 'pre' | 'in' | 'post' | 'unknown';
    statusDetail: string;
    score: string | null;
    verdict: string;
    pInit: number;
    pNow: number;
    note: string;
  }>;
  jointProb: number;
  fairValue: number;
  offered: number;
  edge: number;
  decision: 'SELL' | 'HOLD' | 'MAYBE' | 'LOST' | 'WON';
  message: string;
  asOf: number;
}

// ---------- POST /api/bankroll/resolve ----------

export interface BankrollResolveResponse {
  legs: Array<{
    matchId: string;
    market: string;
    pick: string;
    verdict: 'WIN' | 'LOSE' | 'VOID' | 'PENDING';
    score: string | null;
    note?: string;
  }>;
}

// ---------- GET /api/sync/status ----------

export interface SyncStatusResponse {
  ok: boolean;
  db?: { connected: boolean; latencyMs: number };
  counts?: Record<string, number>;
  espnCalls?: { total: number; client: number; sync: number };
  lastSync?: { phase: string; startedAt: string; finishedAt: string | null } | null;
  lastForecastJob?: { phase: string; startedAt: string; finishedAt: string | null } | null;
}

// ---------- GET /api (identité) ----------

export interface IdentityResponse {
  service: string;
  status: string;
  endpoints: string[];
}

// ---------- Ticket local (Portefeuille) ----------

export interface TicketLeg {
  matchId: string;
  leagueCode: string;
  matchDate: string;
  market: string; // "1X2" | "O/U 2.5" | "BTTS"
  pick: string;
  prob: number; // proba modèle au moment de la sélection
  odds: number | null; // cote décimale si dispo
  homeName: string;
  awayName: string;
}

export interface Ticket {
  id: string;
  createdAt: number;
  legs: TicketLeg[];
  stake: number;
  totalOdds: number | null;
  status: 'pending' | 'won' | 'lost' | 'void' | 'cashed-out';
  payout?: number;
  cashoutValue?: number;
}
