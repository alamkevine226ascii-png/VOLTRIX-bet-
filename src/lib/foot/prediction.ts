// ============================================================
// VOLTRIX bet — Moteur de prédiction
// Ensemble : Poisson (45%) + Elo (30%) + Forme (25%)
// Marchés : 1X2, Double Chance, O/U 1.5/2.5/3.5, BTTS,
//           Moment du 1er but, Équipe à marquer en 1er
// ============================================================

import type { EspnScheduleGame, EspnStandingsTeam, EspnOdds, EspnInjury } from './espn';
// market-odds.ts est un module de math pures (aucun import) : aucun cycle.
// bttsProb = forme fermée BTTS partagée (cohérence inter-écrans, audit 21-b FIX 2) ;
// deMarginOverUnder + calibrateTotals = calibration marché (audit 21-b FIX 1).
import { bttsProb, calibrateTotals, deMarginOverUnder } from './market-odds';

// ---------- Types publics ----------

export interface TeamAnalysis {
  id: string;
  name: string;
  logo: string | null;
  elo: number;
  form: Array<{ result: 'W' | 'D' | 'L'; opponent: string; score: string; home: boolean; date: string }>;
  formScore: number; // 0..1 pondéré exponentiel
  goalsForPerMatch: number;
  goalsAgainstPerMatch: number;
  goalsForHome: number; // par match à domicile
  goalsAgainstHome: number;
  goalsForAway: number; // par match à l'extérieur
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
  // Échantillons réels par contexte (fiabilité des ratios attaque/défense)
  gamesHome: number;
  gamesAway: number;
}

export interface MatchPrediction {
  // 1X2 final (ensemble)
  probs: { home: number; draw: number; away: number };
  // décomposition des modèles
  poisson: { home: number; draw: number; away: number };
  elo: { home: number; draw: number; away: number };
  form: { home: number; draw: number; away: number };
  // marchés de buts (issus du Poisson final, CALIBRÉS sur la ligne O/U réelle
  // quand les cotes marché existent — étape officielle du pipeline, audit 21-b FIX 1)
  overUnder: Array<{ line: number; over: number; under: number }>;
  btts: { yes: number; no: number };
  // Version BRUTE (non calibrée marché) des mêmes marchés — audit 21-b FIX 4 :
  //   brut = value  → value bets / edge / Kelly / comparaisons vs cotes
  //                   (indépendant du marché, sinon edge circulaire) ;
  //   calibré = affichage → overUnder / btts ci-dessus (fiche, Combinator,
  //                   Brier), ancrés sur le marché pour une vérité unique.
  raw: {
    overUnder: Array<{ line: number; over: number; under: number }>;
    btts: { yes: number; no: number };
  };
  // scores exacts les plus probables
  topScores: Array<{ score: string; prob: number }>;
  // moment du premier but
  firstGoalTiming: Array<{ window: string; label: string; prob: number }>;
  // première équipe à marquer
  firstToScore: { home: number; away: number; noGoal: number };
  // buts attendus
  lambda: { home: number; away: number; total: number };
  // confiance
  confidence: number; // 1..5
  confidenceLabel: string;
  // value bets (si cotes dispo)
  valueBets: Array<{ market: string; pick: string; modelProb: number; odds: number; edge: number; kelly: number }>;
  oddsMovement: string | null;
  recommendedBets: Array<{ market: string; pick: string; prob: number; note: string }>;
}

export interface MatchAnalysis {
  // Mode de contexte réellement appliqué aux λ ('full' = v2.1 complet,
  // 'mix' = modificateurs de contexte neutralisés — instrument d'ablation,
  // plan V2→V3 étape 11). Toujours renseigné en sortie pour la traçabilité
  // (backtests, digest d'entrées) ; défaut 'full' = v2.1 inchangé.
  contextMode: 'full' | 'mix';
  home: TeamAnalysis;
  away: TeamAnalysis;
  prediction: MatchPrediction;
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

// ---------- Derby / rivalités connues ----------

const DERBY_PAIRS: Array<{ a: string; b: string; label: string }> = [
  { a: 'Paris Saint-Germain', b: 'Olympique de Marseille', label: 'Le Classique' },
  { a: 'Paris Saint-Germain', b: 'Olympique Lyonnais', label: 'Choc Olympique' },
  { a: 'AS Monaco', b: 'OGC Nice', label: 'Derby de la Côte' },
  { a: 'Arsenal', b: 'Chelsea', label: 'Derby de Londres' },
  { a: 'Arsenal', b: 'Tottenham Hotspur', label: 'Derby du Nord de Londres' },
  { a: 'Chelsea', b: 'Tottenham Hotspur', label: 'Derby de Londres' },
  { a: 'West Ham United', b: 'Tottenham Hotspur', label: 'Derby de Londres' },
  { a: 'Manchester United', b: 'Liverpool', label: 'North West Derby' },
  { a: 'Manchester United', b: 'Manchester City', label: 'Derby de Manchester' },
  { a: 'Liverpool', b: 'Everton', label: 'Derby de la Mersey' },
  { a: 'Real Madrid', b: 'FC Barcelona', label: 'El Clásico' },
  { a: 'Real Madrid', b: 'Atlético de Madrid', label: 'Derby de Madrid' },
  { a: 'FC Barcelona', b: 'RCD Espanyol de Barcelona', label: 'Derby Catalunya' },
  { a: 'Sevilla FC', b: 'Real Betis', label: 'Derby de Séville' },
  { a: 'AC Milan', b: 'Inter Milan', label: 'Derby della Madonnina' },
  { a: 'AS Roma', b: 'SS Lazio', label: 'Derby della Capitale' },
  { a: 'Juventus', b: 'Torino', label: 'Derby della Mole' },
  { a: 'FC Bayern München', b: 'Borussia Dortmund', label: 'Der Klassiker' },
  { a: 'Schalke 04', b: 'Borussia Dortmund', label: 'Revierderby' },
  { a: 'Feyenoord', b: 'AFC Ajax', label: 'De Klassieker' },
  { a: 'PSV', b: 'AFC Ajax', label: 'Topper néerlandais' },
  { a: 'Celtic', b: 'Rangers', label: 'Old Firm' },
  { a: 'FC Porto', b: 'SL Benfica', label: 'O Clássico' },
  { a: 'Sporting CP', b: 'SL Benfica', label: 'Derby de Lisbonne' },
  { a: 'Galatasaray', b: 'Fenerbahçe', label: 'Intercontinental Derby' },
  { a: 'Boca Juniors', b: 'River Plate', label: 'Superclásico' },
  { a: 'Flamengo', b: 'Fluminense', label: 'Fla-Flu' },
  { a: 'Corinthians', b: 'Palmeiras', label: 'Derby Paulista' },
  { a: 'Club América', b: 'Chivas Guadalajara', label: 'El Súper Clásico' },
  { a: 'Al Hilal', b: 'Al Nassr', label: 'Derby de Riyad' },
  { a: 'Olympiacos', b: 'Panathinaikos', label: 'Derby d\'Athènes' },
  { a: 'Beşiktaş', b: 'Galatasaray', label: 'Derby d\'Istanbul' },
];

function detectDerby(homeName: string, awayName: string): { isDerby: boolean; label: string | null } {
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
  const h = normalize(homeName);
  const w = normalize(awayName);
  for (const d of DERBY_PAIRS) {
    const a = normalize(d.a);
    const b = normalize(d.b);
    const match =
      (h.includes(a) || a.includes(h) || h.includes(b) || b.includes(h)) &&
      (w.includes(a) || a.includes(w) || w.includes(b) || b.includes(w)) &&
      h !== w;
    if (match) return { isDerby: true, label: d.label };
  }
  return { isDerby: false, label: null };
}

// ---------- Outils mathématiques ----------

function poissonPmf(lambda: number, k: number): number {
  let fact = 1;
  for (let i = 2; i <= k; i++) fact *= i;
  return (Math.exp(-lambda) * Math.pow(lambda, k)) / fact;
}

function clamp(x: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, x));
}

function round(x: number, digits = 4): number {
  const f = Math.pow(10, digits);
  return Math.round(x * f) / f;
}

// ---------- Elo ----------

const K_FACTOR = 22;
const HOME_ADV_ELO = 65;

export interface EloState {
  ratings: Map<string, number>;
  games: Map<string, number>;
}

export function computeElo(teamIdA: string, teamIdB: string, schedules: Map<string, EspnScheduleGame[]>): EloState {
  const ratings = new Map<string, number>();
  const games = new Map<string, number>();

  // Fusionner TOUS les matchs connus des deux équipes + adversaires, triés par date
  const allMatches: Array<{ date: number; teamA: string; teamB: string; scoreA: number | null; scoreB: number | null }> = [];
  for (const [, list] of schedules) {
    for (const g of list) {
      if (!g.completed || g.teamScore === null || g.opponentScore === null) continue;
      allMatches.push({
        date: new Date(g.date).getTime(),
        teamA: g.homeAway === 'home' ? (schedules.has(g.eventId + ':homeId') ? g.opponentId : '') : '',
        teamB: '',
        scoreA: g.teamScore,
        scoreB: g.opponentScore,
      });
    }
  }

  // Reconstruction plus simple : parcourir chaque équipe et ses matchs
  const events = new Map<
    string,
    { date: number; homeId: string; awayId: string; hs: number; as: number }
  >();
  for (const [teamId, list] of schedules) {
    for (const g of list) {
      if (!g.completed || g.teamScore === null || g.opponentScore === null) continue;
      const homeId = g.homeAway === 'home' ? teamId : g.opponentId;
      const awayId = g.homeAway === 'home' ? g.opponentId : teamId;
      const hs = g.homeAway === 'home' ? g.teamScore : g.opponentScore;
      const as = g.homeAway === 'home' ? g.opponentScore : g.teamScore;
      events.set(g.eventId + ':' + league_key(homeId, awayId), {
        date: new Date(g.date).getTime(),
        homeId,
        awayId,
        hs,
        as,
      });
    }
  }

  const sorted = [...events.values()].sort((a, b) => a.date - b.date);
  for (const m of sorted) {
    const rh = ratings.get(m.homeId) ?? 1500;
    const ra = ratings.get(m.awayId) ?? 1500;
    // Même convention que eloToProbs : le bonus domicile RÉDUIT l'écart
    // attendu (finding ① Task 19-a) — sinon les ratings rejoués sont biaisés.
    const expectedHome = 1 / (1 + Math.pow(10, (ra - HOME_ADV_ELO - rh) / 400));
    const actual = m.hs > m.as ? 1 : m.hs === m.as ? 0.5 : 0;
    const deltaH = K_FACTOR * (actual - expectedHome);
    ratings.set(m.homeId, rh + deltaH);
    ratings.set(m.awayId, ra - deltaH);
    games.set(m.homeId, (games.get(m.homeId) ?? 0) + 1);
    games.set(m.awayId, (games.get(m.awayId) ?? 0) + 1);
  }
  void teamIdA;
  void teamIdB;
  void allMatches;
  return { ratings, games };
}

function league_key(a: string, b: string): string {
  return a < b ? a + '_' + b : b + '_' + a;
}

// Elo -> probabilités W/D/L
// ⚠️ Sens de l'avantage du terrain (Task 19-a, finding ①) : le bonus +65
// appartient à l'équipe DOMICILE → il doit RÉDUIRE l'écart (ra − adv − rh)
// dans le dénominateur. L'ancienne forme (ra + adv − rh) l'ajoutait au
// cote de l'extérieur : à Elo égal, le modèle donnait 28 % domicile /
// 47 % extérieur — avantage inversé.
export function eloToProbs(eloHome: number, eloAway: number): { home: number; draw: number; away: number } {
  const eHome = 1 / (1 + Math.pow(10, (eloAway - HOME_ADV_ELO - eloHome) / 400));
  // part de nul décroissante avec l'écart
  const draw = clamp(0.30 - 1.4 * Math.pow(eHome - 0.5, 2) * 4, 0.11, 0.30);
  const home = clamp(eHome - draw * 0.5, 0.02, 0.95);
  const away = clamp(1 - eHome - draw * 0.5, 0.02, 0.95);
  const sum = home + draw + away;
  return { home: home / sum, draw: draw / sum, away: away / sum };
}

// ---------- Forme ----------

function formScoreOf(games: EspnScheduleGame[], teamId: string, maxGames = 6): number {
  const played = games
    .filter((g) => g.completed && g.teamScore !== null && g.opponentScore !== null)
    .slice(-maxGames);
  if (played.length === 0) return 0.4;
  let weighted = 0;
  let totalWeight = 0;
  played.forEach((g, i) => {
    const recency = Math.exp(-0.25 * (played.length - 1 - i)); // demi-vie ~3 matchs
    const result = g.teamScore! > g.opponentScore! ? 1 : g.teamScore === g.opponentScore ? 0.5 : 0;
    weighted += result * recency;
    totalWeight += recency;
  });
  return weighted / totalWeight;
}

function formToProbs(formHome: number, formAway: number): { home: number; draw: number; away: number } {
  // Différence de forme -> rating équivalent (1 point de forme = ~85 pts Elo)
  const diff = (formHome - formAway) * 170;
  const eHome = 1 / (1 + Math.pow(10, -diff / 400));
  const draw = clamp(0.28 - 1.2 * Math.pow(eHome - 0.5, 2) * 4, 0.12, 0.28);
  const home = clamp(eHome - draw * 0.5, 0.03, 0.94);
  const away = clamp(1 - eHome - draw * 0.5, 0.03, 0.94);
  const sum = home + draw + away;
  return { home: home / sum, draw: draw / sum, away: away / sum };
}

// ---------- Analyse équipe ----------

export function analyzeTeam(
  teamId: string,
  teamName: string,
  logo: string | null,
  schedule: EspnScheduleGame[],
  standingsEntry: EspnStandingsTeam | null,
  injuries: EspnInjury[],
  nowMs: number,
  isHome: boolean
): TeamAnalysis {
  const played = schedule.filter((g) => g.completed && g.teamScore !== null && g.opponentScore !== null);

  // Forme récente (6 derniers)
  const recent = played.slice(-6).reverse();
  const form = recent.map((g) => ({
    result: (g.teamScore! > g.opponentScore! ? 'W' : g.teamScore === g.opponentScore! ? 'D' : 'L') as 'W' | 'D' | 'L',
    opponent: g.opponentName,
    score: `${g.homeAway === 'home' ? g.teamScore : g.opponentScore}-${g.homeAway === 'home' ? g.opponentScore : g.teamScore}`,
    home: g.homeAway === 'home',
    date: g.date,
  }));

  const formScore = formScoreOf(schedule, teamId);

  // Moyennes globales (saisons chargées)
  const totalGames = played.length || 1;
  const goalsFor = played.reduce((s, g) => s + (g.teamScore ?? 0), 0) / totalGames;
  const goalsAgainst = played.reduce((s, g) => s + (g.opponentScore ?? 0), 0) / totalGames;

  // Domicile / extérieur
  const homeGames = played.filter((g) => g.homeAway === 'home');
  const awayGames = played.filter((g) => g.homeAway === 'away');
  const gfHome = homeGames.length ? homeGames.reduce((s, g) => s + (g.teamScore ?? 0), 0) / homeGames.length : goalsFor;
  const gaHome = homeGames.length ? homeGames.reduce((s, g) => s + (g.opponentScore ?? 0), 0) / homeGames.length : goalsAgainst;
  const gfAway = awayGames.length ? awayGames.reduce((s, g) => s + (g.teamScore ?? 0), 0) / awayGames.length : goalsFor;
  const gaAway = awayGames.length ? awayGames.reduce((s, g) => s + (g.opponentScore ?? 0), 0) / awayGames.length : goalsAgainst;

  // Clean sheets / sans marquer
  const cleanSheets = played.filter((g) => (g.opponentScore ?? 1) === 0).length;
  const failedToScore = played.filter((g) => (g.teamScore ?? 0) === 0).length;

  // Fatigue
  const lastGame = played[played.length - 1];
  const daysSince = lastGame ? Math.round((nowMs - new Date(lastGame.date).getTime()) / 86400000) : null;
  const last14 = played.filter((g) => nowMs - new Date(g.date).getTime() < 14 * 86400000 && nowMs - new Date(g.date).getTime() >= 0).length;

  // Blessures
  const teamInjuries = injuries.filter((i) => i.teamId === teamId);
  const active = teamInjuries.filter((i) => /out|doubtful|questionable/i.test(i.status ?? ''));

  return {
    id: teamId,
    name: teamName,
    logo,
    elo: 0, // rempli par le moteur
    form,
    formScore,
    goalsForPerMatch: round(goalsFor, 2),
    goalsAgainstPerMatch: round(goalsAgainst, 2),
    goalsForHome: round(isHome ? gfHome : gfAway, 2),
    goalsAgainstHome: round(isHome ? gaHome : gaAway, 2),
    goalsForAway: round(isHome ? gfAway : gfHome, 2),
    goalsAgainstAway: round(isHome ? gaAway : gaHome, 2),
    cleanSheetsPct: round((cleanSheets / totalGames) * 100, 0),
    failedToScorePct: round((failedToScore / totalGames) * 100, 0),
    fatigueDaysSinceLast: daysSince,
    matchesLast14Days: last14,
    injuriesCount: active.length,
    injuriesKey: active.length,
    rank: standingsEntry?.rank ?? null,
    points: standingsEntry?.points ?? 0,
    gamesPlayed: standingsEntry?.gamesPlayed ?? played.length,
    gamesHome: homeGames.length,
    gamesAway: awayGames.length,
  };
}

// ---------- Contexte (enjeux, fatigue, météo...) ----------

function stakesLabel(rank: number | null, gamesPlayed: number, totalTeams: number): string {
  if (rank === null || gamesPlayed < 2) return 'Début de saison';
  if (rank <= 2) return 'Course au titre';
  if (rank <= 4) return 'Places européennes';
  if (rank > totalTeams - 3 && gamesPlayed >= 8) return 'Lutte pour le maintien';
  if (rank <= Math.round(totalTeams / 2)) return 'Milieu de tableau';
  return 'Enjeux modérés';
}

// ---------- Marché : moment du premier but ----------
// Processus de Poisson : P(aucun but avant t) = e^(-r*t), r = buts/min

export function firstGoalTimingProbs(lambdaTotal: number): Array<{ window: string; label: string; prob: number }> {
  const r = lambdaTotal / 90;
  const windows: Array<{ window: string; label: string; from: number; to: number }> = [
    { window: '0-15', label: 'Avant la 16e', from: 0, to: 15 },
    { window: '16-30', label: 'Entre la 16e et 30e', from: 15, to: 30 },
    { window: '31-45', label: 'Entre la 31e et 45e', from: 30, to: 45 },
    { window: '46-60', label: 'Entre la 46e et 60e', from: 45, to: 60 },
    { window: '61-75', label: 'Entre la 61e et 75e', from: 60, to: 75 },
    { window: '76-90', label: 'Après la 76e', from: 75, to: 90 },
  ];
  const out = windows.map((w) => ({
    window: w.window,
    label: w.label,
    prob: Math.exp(-r * w.from) - Math.exp(-r * w.to),
  }));
  out.push({ window: 'NO_GOAL', label: 'Aucun but (0-0)', prob: Math.exp(-lambdaTotal) });
  const sum = out.reduce((s, o) => s + o.prob, 0);
  return out.map((o) => ({ ...o, prob: round(o.prob / sum, 4) }));
}

// ---------- Poisson complet ----------

interface PoissonResult {
  probs: { home: number; draw: number; away: number };
  overUnder: Array<{ line: number; over: number; under: number }>;
  btts: { yes: number; no: number };
  topScores: Array<{ score: string; prob: number }>;
  lambdaHome: number;
  lambdaAway: number;
}

// ---------- Marché : première équipe à marquer ----------
// Probabilités INCONDITIONNELLES (home + away + noGoal = 1 exactement) :
// « 1ère équipe à marquer » = qui ouvre le score × P(qu'un but soit marqué).
// L'ancienne version inline sommait home + away + noGoal à 1 + e^-λ (> 1).
export function firstToScoreProbs(lambdaHome: number, lambdaAway: number): { home: number; away: number; noGoal: number } {
  const lh = lambdaHome;
  const la = lambdaAway;
  const noGoal = Math.exp(-(lh + la));
  const goalShare = 1 - noGoal;
  const total = lh + la;
  return {
    home: round(total > 0 ? (lh / total) * goalShare : 0, 4),
    away: round(total > 0 ? (la / total) * goalShare : 0, 4),
    noGoal: round(noGoal, 4),
  };
}

export function poissonModel(lambdaHome: number, lambdaAway: number): PoissonResult {
  // Grille 0..12 (audit 21-b FIX 2) : l'ancienne grille 0..8 tronquait la queue
  // de la distribution (pour λ ≈ 3.8/3.4, jusqu'à ~1 % de masse perdue) et
  // biaisait tous les marchés dérivés (1X2, O/U).
  const MAX = 12;
  const matrix: number[][] = [];
  for (let i = 0; i <= MAX; i++) {
    matrix[i] = [];
    for (let j = 0; j <= MAX; j++) {
      matrix[i][j] = poissonPmf(lambdaHome, i) * poissonPmf(lambdaAway, j);
    }
  }
  // Renormalisation (audit 21-b FIX 2) : la grille somme EXACTEMENT 1 avant
  // tout calcul de marché — 1X2 et O/U n'héritent plus de la troncature.
  let gridSum = 0;
  for (let i = 0; i <= MAX; i++) {
    for (let j = 0; j <= MAX; j++) gridSum += matrix[i][j];
  }
  for (let i = 0; i <= MAX; i++) {
    for (let j = 0; j <= MAX; j++) matrix[i][j] /= gridSum;
  }

  let pHome = 0, pDraw = 0, pAway = 0;
  const scores: Array<{ score: string; prob: number }> = [];
  for (let i = 0; i <= MAX; i++) {
    for (let j = 0; j <= MAX; j++) {
      const p = matrix[i][j];
      if (i > j) pHome += p;
      else if (i === j) pDraw += p;
      else pAway += p;
      if (i <= 6 && j <= 6) scores.push({ score: `${i}-${j}`, prob: p });
    }
  }
  const sum = pHome + pDraw + pAway; // = 1 après renormalisation (re-division défensive)
  const probs = { home: pHome / sum, draw: pDraw / sum, away: pAway / sum };

  const overUnder = [1.5, 2.5, 3.5].map((line) => {
    let over = 0;
    for (let i = 0; i <= MAX; i++) {
      for (let j = 0; j <= MAX; j++) {
        if (i + j > line) over += matrix[i][j];
      }
    }
    const o = round(over, 4); // grille renormalisée : plus de re-division nécessaire
    return { line, over: o, under: round(1 - o, 4) }; // over + under ≡ 1 exactement
  });

  // BTTS en forme fermée (audit 21-b FIX 2) — MÊME formule que market-odds.ts
  // (bttsProb) : P(yes) = (1 − e^−λhome) × (1 − e^−λaway), exacte et non
  // tronquée. L'ancienne somme sur la grille 0..8 puis no = 1 − yes biaisait
  // P(yes) vers le bas. Volontairement NON arrondi : fiche, Combinator et
  // calibration doivent produire la même valeur à 1e-6 près.
  const bttsYes = bttsProb(lambdaHome, lambdaAway);

  scores.sort((a, b) => b.prob - a.prob);
  return {
    probs,
    overUnder,
    btts: { yes: bttsYes, no: 1 - bttsYes },
    topScores: scores.slice(0, 3).map((s) => ({ score: s.score, prob: round(s.prob, 4) })),
    lambdaHome,
    lambdaAway,
  };
}

// ---------- Value bets ----------

function buildValueBets(
  prediction: {
    probs: { home: number; draw: number; away: number };
    overUnder: Array<{ line: number; over: number; under: number }>;
    btts: { yes: number; no: number };
  },
  odds: EspnOdds | null
): MatchPrediction['valueBets'] {
  if (!odds?.hasOdds) return [];
  const bets: MatchPrediction['valueBets'] = [];
  const add = (market: string, pick: string, modelProb: number, dec: number | null) => {
    if (!dec || dec <= 1.01 || modelProb <= 0) return;
    const edge = modelProb * dec - 1;
    if (edge > 0.02) {
      bets.push({
        market,
        pick,
        modelProb: round(modelProb, 4),
        odds: dec,
        edge: round(edge, 4),
        kelly: round(clamp(edge / (dec - 1), 0, 0.10), 4),
      });
    }
  };

  const ml = odds.moneyline;
  add('1X2', 'Victoire domicile', prediction.probs.home, ml.home.close);
  add('1X2', 'Nul', prediction.probs.draw, ml.draw.close);
  add('1X2', 'Victoire extérieur', prediction.probs.away, ml.away.close);

  const ouLine = odds.overUnderLine;
  const ou = prediction.overUnder.find((o) => o.line === ouLine) ?? prediction.overUnder[1];
  if (ou && ouLine !== null) {
    add(`Over/Under ${ouLine}`, `Plus de ${ouLine}`, ou.over, odds.total.over.closeOdds);
    add(`Over/Under ${ouLine}`, `Moins de ${ouLine}`, ou.under, odds.total.under.closeOdds);
  }
  return bets.sort((a, b) => b.edge - a.edge).slice(0, 4);
}

function oddsMovementNote(odds: EspnOdds | null): string | null {
  if (!odds?.hasOdds) return null;
  const notes: string[] = [];
  const ml = odds.moneyline;
  const pctMove = (open: number | null, close: number | null) => {
    if (!open || !close) return null;
    return (close - open) / open;
  };
  const hm = pctMove(ml.home.open, ml.home.close);
  const aw = pctMove(ml.away.open, ml.away.close);
  if (hm !== null && hm <= -0.08) notes.push('Cotes en forte baisse sur l\'équipe à domicile (argent massif sur elle)');
  if (aw !== null && aw <= -0.08) notes.push('Cotes en forte baisse sur l\'équipe à l\'extérieur (argent massif sur elle)');
  if (hm !== null && hm >= 0.08) notes.push('Cotes domicile en hausse (doute du marché)');
  if (aw !== null && aw >= 0.08) notes.push('Cotes extérieur en hausse (doute du marché)');
  const lineMove = odds.total.over.line !== null && odds.overUnderLine !== null && odds.total.over.line !== odds.overUnderLine
    ? `Ligne de buts déplacée de ${odds.overUnderLine} vers ${odds.total.over.line}`
    : null;
  if (lineMove) notes.push(lineMove);
  return notes.length ? notes.join(' · ') : null;
}

// ---------- Moteur principal ----------

export interface EngineInput {
  homeTeam: {
    id: string; name: string; logo: string | null; schedule: EspnScheduleGame[];
    standings: EspnStandingsTeam | null;
  };
  awayTeam: {
    id: string; name: string; logo: string | null; schedule: EspnScheduleGame[];
    standings: EspnStandingsTeam | null;
  };
  injuries: EspnInjury[];
  // Cotes ESPN du match — DÉJÀ présentes dans l'input (alimentées par
  // analyze.ts : odds: event.odds). Elles servent à la calibration officielle
  // O/U + BTTS (audit 21-b FIX 1) et aux value bets (cotes brutes).
  odds: EspnOdds | null;
  // Task 21-d : moyennes de buts EMPIRIQUES de la ligue (saison précédente,
  // calculées par scripts/backtest.ts → src/lib/league-params.ts). OPTIONNEL :
  // absent (production actuelle) → constantes globales 1.52/1.22, comportement
  // IDENTIQUE au byte près (testé par scripts/test-consistency.ts).
  leagueGoalAverages?: { home: number; away: number } | null;
  isDerby: boolean;
  weatherImpact: { goalsFactor: number } | null;
  nowMs: number;
  leagueTeamsCount: number;
  // Instrument d'ablation (plan V2→V3 étape 11), défaut 'full' = v2.1 inchangé :
  // 'full' → tous les modificateurs de contexte appliqués aux λ (fatigue,
  //           blessures, derby — la météo est déjà hors λ depuis 21-b, les
  //           « enjeux » via standings ne touchent JAMAIS les λ, affichage seul) ;
  // 'mix'  → mêmes λ de base (forces att/déf + forme injectée + redistribution
  //           Elo) mais SANS les modificateurs de contexte post-λ-de-base
  //           (fatigue ×0.94, blessures ×[0.92..1], derby ×0.92 neutralisés).
  //           Blend des 3 modèles, calibration, marchés : inchangés.
  contextMode?: 'full' | 'mix';
}

export function runEngine(input: EngineInput): MatchAnalysis {
  const { homeTeam, awayTeam, injuries, odds, nowMs } = input;
  // Instrument d'ablation (plan V2→V3 étape 11), défaut 'full' = v2.1 inchangé :
  // 'mix' neutralise UNIQUEMENT les modificateurs de contexte appliqués aux λ
  // après le λ de base (fatigue, blessures, derby) — le reste du pipeline
  // (forces att/déf, forme injectée, redistribution Elo, calibration, marchés)
  // tourne à l'identique.
  const ablateContext = (input.contextMode ?? 'full') === 'mix';
  const contextMode: 'full' | 'mix' = ablateContext ? 'mix' : 'full';

  const schedules = new Map<string, EspnScheduleGame[]>([
    [homeTeam.id, homeTeam.schedule],
    [awayTeam.id, awayTeam.schedule],
  ]);

  const elo = computeElo(homeTeam.id, awayTeam.id, schedules);
  const eloHome = elo.ratings.get(homeTeam.id) ?? 1500;
  const eloAway = elo.ratings.get(awayTeam.id) ?? 1500;

  const home = analyzeTeam(homeTeam.id, homeTeam.name, homeTeam.logo, homeTeam.schedule, homeTeam.standings, injuries, nowMs, true);
  const away = analyzeTeam(awayTeam.id, awayTeam.name, awayTeam.logo, awayTeam.schedule, awayTeam.standings, injuries, nowMs, false);
  home.elo = Math.round(eloHome);
  away.elo = Math.round(eloAway);

  // --- Références de ligue (football professionnel) ---
  // Task 21-d : moyennes EMPIRIQUES par ligue si fournies (leagueGoalAverages,
  // saison précédente — zéro fuite), sinon constantes globales historiques.
  const LEAGUE_AVG_HOME = input.leagueGoalAverages?.home ?? 1.52; // buts marqués par une équipe à domicile
  const LEAGUE_AVG_AWAY = input.leagueGoalAverages?.away ?? 1.22; // buts marqués par une équipe à l'extérieur
  const LEAGUE_AVG_TEAM = (LEAGUE_AVG_HOME + LEAGUE_AVG_AWAY) / 2; // 1.37 par équipe

  // Retrait vers la moyenne (empirical Bayes) : un ratio mesuré sur n matchs
  // n'est fiable qu'à hauteur n/(n+K). SANS CELA, une coupe (1-2 matchs de
  // données disponibles dans la compétition) produit des ratios extrêmes et
  // des λ aberrants (0.4 ou 7+ buts attendus) — cause du « Moins 2.5 »
  // affiché à 85-98 % sur des matchs que le marché cote ~50/50.
  const SHRINK_K = 10;
  type Ratio = number | null;
  const ratioOf = (avg: number, baseline: number, n: number): Ratio => {
    if (!Number.isFinite(avg) || !(baseline > 0) || !(n > 0)) return null; // pas de donnée → neutre
    const raw = avg / baseline;
    const w = n / (n + SHRINK_K);
    return 1 + (raw - 1) * w;
  };
  const combine = (venue: Ratio, overall: Ratio, wVenue: number): number => {
    if (venue !== null && overall !== null) return wVenue * venue + (1 - wVenue) * overall;
    return venue ?? overall ?? 1;
  };

  // Pondération contexte spécifique (domicile/extérieur) vs global
  const gpHome = home.gamesPlayed;
  const gpAway = away.gamesPlayed;
  const wHome = clamp(gpHome / (gpHome + 6), 0.15, 0.85);
  const wAway = clamp(gpAway / (gpAway + 6), 0.15, 0.85);

  // Ratios attaque/défense : chaque composante normalisée par SA propre
  // référence — GF à domicile vs 1.52, GA à domicile vs 1.22 (ce que marquent
  // les visiteurs), GF/GA globaux vs 1.37 — sinon les dénominateurs inversés
  // gonflent λ domicile de ~25 % et écrasent λ extérieur de ~20 %.
  // ⚠️ Convention des champs : pour N'IMPORQUELLE équipe, `goalsForHome`
  // / `goalsAgainstHome` = statistiques dans le CONTEXTE DE CE MATCH
  // (à domicile pour l'équipe locale, À L'EXTÉRIEUR pour le visiteur) ;
  // `goalsForAway` / `goalsAgainstAway` = l'autre contexte. L'ancien code
  // utilisait goalsForAway pour le visiteur — son scoring À DOMICILE —
  // donc le mauvais contexte, en plus du mauvais dénominateur.
  const homeAttack = combine(
    ratioOf(home.goalsForHome, LEAGUE_AVG_HOME, home.gamesHome),
    ratioOf(home.goalsForPerMatch, LEAGUE_AVG_TEAM, gpHome),
    wHome
  );
  const awayDefense = combine(
    ratioOf(away.goalsAgainstHome, LEAGUE_AVG_HOME, away.gamesAway),
    ratioOf(away.goalsAgainstPerMatch, LEAGUE_AVG_TEAM, gpAway),
    wAway
  );
  const awayAttack = combine(
    ratioOf(away.goalsForHome, LEAGUE_AVG_AWAY, away.gamesAway),
    ratioOf(away.goalsForPerMatch, LEAGUE_AVG_TEAM, gpAway),
    wAway
  );
  const homeDefense = combine(
    ratioOf(home.goalsAgainstHome, LEAGUE_AVG_AWAY, home.gamesHome),
    ratioOf(home.goalsAgainstPerMatch, LEAGUE_AVG_TEAM, gpHome),
    wHome
  );

  // --- Lambda de base (Poisson) : moyenne de ligue × attaque × défense ---
  let lambdaHome = LEAGUE_AVG_HOME * homeAttack * awayDefense;
  let lambdaAway = LEAGUE_AVG_AWAY * awayAttack * homeDefense;

  // --- Modificateurs de contexte ---
  // Fatigue : moins de 4 jours de repos OU 3+ matchs sur 14 jours
  const fatigueHome = (home.fatigueDaysSinceLast !== null && home.fatigueDaysSinceLast <= 3) || home.matchesLast14Days >= 3;
  const fatigueAway = (away.fatigueDaysSinceLast !== null && away.fatigueDaysSinceLast <= 3) || away.matchesLast14Days >= 3;
  // Instrument d'ablation (plan V2→V3 étape 11), défaut 'full' = v2.1 inchangé :
  // en 'mix' les modificateurs de contexte (fatigue, blessures, derby) ne
  // touchent plus les λ — seuls les λ de base + forme + Elo restent actifs.
  if (!ablateContext && fatigueHome) lambdaHome *= 0.94;
  if (!ablateContext && fatigueAway) lambdaAway *= 0.94;

  // Blessures : impact au-delà des 2 premiers absents (les listes ESPN
  // comptent toujours 2-3 joueurs « de rotation » — pénaliser dès le 1er
  // déprimait λ de ~10 % systématiquement, même sans absent réellement clé)
  const injHome = clamp(1 - Math.max(0, home.injuriesCount - 2) * 0.02, 0.92, 1);
  const injAway = clamp(1 - Math.max(0, away.injuriesCount - 2) * 0.02, 0.92, 1);
  if (!ablateContext) {
    lambdaHome *= injHome;
    lambdaAway *= injAway;
  }

  // Derby : match fermé, léger retrait offensif des deux côtés
  // (neutralisé en 'mix' — instrument d'ablation, plan V2→V3 étape 11)
  if (!ablateContext && input.isDerby) {
    lambdaHome *= 0.92;
    lambdaAway *= 0.92;
  }

  // Météo (audit 21-b FIX 5) : influence RETIRÉE des λ en attendant une
  // validation hors-échantillon — la donnée Open-Meteo est « current » (et non
  // les conditions au coup d'envoi) et les règles fixes −5 %/−3 % n'étaient
  // pas démontrées statistiquement. input.weatherImpact reste transmis et
  // l'affichage descriptif de la fiche Analyse est conservé : seule la
  // multiplication des λ est supprimée.

  // Bonus forme récente injectée dans les lambdas
  const formFactorHome = 0.9 + home.formScore * 0.2; // 0.9..1.1
  const formFactorAway = 0.9 + away.formScore * 0.2;
  lambdaHome *= formFactorHome;
  lambdaAway *= formFactorAway;

  // Force Elo relative : redistribue les buts attendus entre les équipes en
  // PRÉSERVANT le total. L'ancienne formule réutilisait λ domicile déjà
  // mis à jour (asymétrie r^1.5 : λ total gonflé de +28 % quand l'extérieur
  // est favori, déprimé sinon) et comptait l'avantage du terrain en double
  // (déjà présent dans les références 1.52/1.22).
  const eloDiff = clamp(eloHome - eloAway, -250, 250);
  const eloFactor = Math.pow(10, eloDiff / 800);
  const totalPreElo = lambdaHome + lambdaAway;
  const adjHome = lambdaHome * eloFactor;
  const adjAway = lambdaAway / eloFactor;
  const adjSum = adjHome + adjAway;
  if (Number.isFinite(totalPreElo) && totalPreElo > 0 && adjSum > 0) {
    lambdaHome = totalPreElo * (adjHome / adjSum);
    lambdaAway = totalPreElo * (adjAway / adjSum);
  }

  // Garde-fous : jamais de NaN / valeur non positive, puis bornes réalistes
  // (aucun match réel n'attend 4.5+ buts d'une seule équipe)
  if (!Number.isFinite(lambdaHome) || lambdaHome <= 0.05) lambdaHome = 1.35;
  if (!Number.isFinite(lambdaAway) || lambdaAway <= 0.05) lambdaAway = 1.15;
  lambdaHome = clamp(lambdaHome, 0.3, 3.8);
  lambdaAway = clamp(lambdaAway, 0.25, 3.4);

  lambdaHome = round(lambdaHome, 2);
  lambdaAway = round(lambdaAway, 2);

  // --- Modèles individuels ---
  const poissonRes = poissonModel(lambdaHome, lambdaAway);
  const eloProbs = eloToProbs(eloHome, eloAway);
  const formProbs = formToProbs(home.formScore, away.formScore);

  // --- Ensemble final ---
  const W = { poisson: 0.45, elo: 0.30, form: 0.25 };
  const finalProbs = {
    home: W.poisson * poissonRes.probs.home + W.elo * eloProbs.home + W.form * formProbs.home,
    draw: W.poisson * poissonRes.probs.draw + W.elo * eloProbs.draw + W.form * formProbs.draw,
    away: W.poisson * poissonRes.probs.away + W.elo * eloProbs.away + W.form * formProbs.away,
  };
  const pSum = finalProbs.home + finalProbs.draw + finalProbs.away;
  if (!Number.isFinite(pSum) || pSum <= 0) {
    finalProbs.home = 0.38;
    finalProbs.draw = 0.27;
    finalProbs.away = 0.35;
  } else {
    finalProbs.home /= pSum;
    finalProbs.draw /= pSum;
    finalProbs.away /= pSum;
  }

  // --- Confiance ---
  const ranked = [
    { k: 'home', v: finalProbs.home },
    { k: 'draw', v: finalProbs.draw },
    { k: 'away', v: finalProbs.away },
  ].sort((a, b) => b.v - a.v);
  const gap = ranked[0].v - ranked[1].v;
  const models = [poissonRes.probs, eloProbs, formProbs];
  // Vrai consensus d'argmax (audit 21-b FIX 3) : les 3 modèles (Poisson, Elo,
  // Forme) doivent avoir la MÊME issue la plus probable (domicile/nul/extérieur).
  // L'ancien critère (m.home >= m.away pour tous, ou l'inverse) validait un
  // « accord » même quand un modèle prédisait le nul en tête (ex. D 35 / N 40 /
  // E 25 satisfaisait away >= home). La confiance 1-5 baisse parfois — voulu.
  const argmaxOutcome = (p: { home: number; draw: number; away: number }): 'home' | 'draw' | 'away' =>
    p.home >= p.draw && p.home >= p.away ? 'home' : p.away >= p.home && p.away >= p.draw ? 'away' : 'draw';
  const consensus = models.every((m) => argmaxOutcome(m) === argmaxOutcome(models[0]));
  const dataBonus = (home.gamesPlayed >= 5 ? 0.5 : 0) + (away.gamesPlayed >= 5 ? 0.5 : 0);
  let conf = 1 + clamp(gap * 10, 0, 2) + (consensus ? 1 : 0) + dataBonus;
  conf = Math.round(clamp(conf, 1, 5));
  const confidenceLabels = ['Très faible', 'Faible', 'Moyen', 'Bon', 'Élevé'];
  const confidenceLabel = confidenceLabels[conf - 1];

  // --- Calibration marché (ÉTAPE OFFICIELLE du pipeline — audit 21-b FIX 1) ---
  // Poisson brut → si cotes marché disponibles (EngineInput.odds, alimenté par
  // analyze.ts) : deMarginOverUnder + calibrateTotals → p.overUnder / p.btts
  // ancrés sur la ligne O/U réelle (mêmes nombres que l'ancien chemin du
  // Combinator, désormais unique) ; si cotes absentes : le brut est conservé.
  // ⚠️ brut = value, calibré = affichage (audit 21-b FIX 4) : les probabilités
  // BRUTES restent indépendantes du marché et alimentent les value bets
  // (sinon edge circulaire : modèle recalé SUR le marché puis comparé AU
  // MÊME marché) ; les CALIBRÉES sont la référence d'affichage (fiche,
  // Combinator, Brier).
  const rawOverUnder = poissonRes.overUnder;
  const rawBtts = poissonRes.btts;
  let finalOverUnder = rawOverUnder;
  let finalBtts = rawBtts;
  const anchorLine = odds?.hasOdds ? odds.overUnderLine : null;
  const marketOverOdds = odds?.total.over.closeOdds ?? odds?.total.over.openOdds ?? null;
  const marketUnderOdds = odds?.total.under.closeOdds ?? odds?.total.under.openOdds ?? null;
  if (anchorLine !== null && marketOverOdds !== null && marketUnderOdds !== null) {
    const dm = deMarginOverUnder(marketOverOdds, marketUnderOdds);
    if (dm) {
      const cal = calibrateTotals(lambdaHome, lambdaAway, anchorLine, dm.pOver, [1.5, 2.5, 3.5]);
      finalOverUnder = [1.5, 2.5, 3.5].map((line) => {
        const o = round(cal.over[line], 4);
        return { line, over: o, under: round(1 - o, 4) }; // over + under ≡ 1 exactement
      });
      finalBtts = { yes: cal.btts, no: 1 - cal.btts }; // bttsProb = forme fermée (FIX 2)
    }
  }

  // --- Value bets & mouvement de cotes ---
  // valueBets = probabilités BRUTES (rawOverUnder / finalProbs 1X2, jamais
  // calibrées) vs cotes réelles du bookmaker — les calibrées donneraient une
  // edge ≈ −marge systématique (value fictive, audit 21-b FIX 4).
  const valueBets = buildValueBets(
    { probs: finalProbs, overUnder: rawOverUnder, btts: rawBtts },
    odds
  );
  const oddsMovement = oddsMovementNote(odds);

  // --- Pronos recommandés (le meilleur de chaque marché) ---
  const recommendedBets: MatchPrediction['recommendedBets'] = [];
  const pick1x2 = ranked[0].k;
  recommendedBets.push({
    market: '1X2',
    pick: pick1x2 === 'home' ? 'Victoire ' + home.name : pick1x2 === 'away' ? 'Victoire ' + away.name : 'Match nul',
    prob: round(ranked[0].v, 4),
    note: `Meilleur choix du modèle (confiance ${conf}/5)`,
  });
  const ou25 = finalOverUnder.find((o) => o.line === 2.5)!;
  recommendedBets.push({
    market: 'Total buts 2.5',
    pick: ou25.over >= 0.5 ? 'Plus de 2.5 buts' : 'Moins de 2.5 buts',
    prob: round(Math.max(ou25.over, ou25.under), 4),
    note: `Buts attendus : ${(lambdaHome + lambdaAway).toFixed(2)}`,
  });
  recommendedBets.push({
    market: 'BTTS',
    pick: finalBtts.yes >= 0.5 ? 'Les deux équipes marquent' : 'Pas les deux équipes marquent',
    prob: round(Math.max(finalBtts.yes, finalBtts.no), 4),
    note: `xG ${home.name.slice(0, 12)} : ${lambdaHome.toFixed(2)} · ${away.name.slice(0, 12)} : ${lambdaAway.toFixed(2)}`,
  });
  const dc = [
    { pick: '1X (Dom ou nul)', prob: finalProbs.home + finalProbs.draw },
    { pick: '12 (Pas de nul)', prob: finalProbs.home + finalProbs.away },
    { pick: 'X2 (Nul ou ext)', prob: finalProbs.draw + finalProbs.away },
  ].sort((a, b) => b.prob - a.prob)[0];
  recommendedBets.push({
    market: 'Double chance',
    pick: dc.pick,
    prob: round(dc.prob, 4),
    note: 'Option la plus sûre du match',
  });

  // --- H2H ---
  // Task 28 §7 (BUG CORRIGÉ) : le scan ne portait que sur le calendrier
  // de l'équipe domicile — les confrontations « B reçoit A » étaient
  // manquées. On parcourt DÉSORMAIS l'union des deux calendriers
  // (dédupliquée par eventId) et `winner` est orienté par rapport aux
  // équipes du match HISTORIQUE (score domicile/extérieur de CE match),
  // jamais par rapport à l'équipe scannée. Le récapitulatif compte par
  // ID ÉQUIPE (robuste aux renommages), pas par position terrain.
  const h2hMap = new Map<string, { date: string; homeTeam: string; awayTeam: string; score: string; winner: 'home' | 'away' | 'draw' }>();
  const h2hWinnerId = new Map<string, string | null>();
  const scanH2HSide = (schedule: EspnScheduleGame[], ownId: string, ownName: string, oppId: string, oppName: string) => {
    for (const g of schedule) {
      if (g.opponentId !== oppId) continue;
      if (h2hMap.has(g.eventId)) continue; // déjà vu via l'autre calendrier
      if (!g.completed || g.teamScore === null || g.opponentScore === null) continue;
      const homeIsOurTeam = g.homeAway === 'home';
      const homeScore = homeIsOurTeam ? g.teamScore : g.opponentScore;
      const awayScore = homeIsOurTeam ? g.opponentScore : g.teamScore;
      const historicalHomeId = homeIsOurTeam ? ownId : oppId;
      const historicalAwayId = homeIsOurTeam ? oppId : ownId;
      h2hMap.set(g.eventId, {
        date: g.date,
        homeTeam: homeIsOurTeam ? ownName : oppName,
        awayTeam: homeIsOurTeam ? oppName : ownName,
        score: `${homeScore}-${awayScore}`,
        winner: homeScore > awayScore ? 'home' : homeScore < awayScore ? 'away' : 'draw',
      });
      h2hWinnerId.set(
        g.eventId,
        homeScore > awayScore ? historicalHomeId : homeScore < awayScore ? historicalAwayId : null
      );
    }
  };
  scanH2HSide(homeTeam.schedule, homeTeam.id, homeTeam.name, awayTeam.id, awayTeam.name);
  scanH2HSide(awayTeam.schedule, awayTeam.id, awayTeam.name, homeTeam.id, homeTeam.name);
  const top6 = [...h2hMap.entries()].sort((a, b) => new Date(b[1].date).getTime() - new Date(a[1].date).getTime()).slice(0, 6);
  const h2h = top6.map(([, m]) => m);
  // "home/away" dans h2h = équipe domicile du match historique ;
  // le récapitulatif = victoires de l'équipe A (domicile du match
  // consulté) / nuls / victoires de l'équipe B — par ID.
  let h2hHomeWins = 0, h2hDraws = 0, h2hAwayWins = 0;
  for (const [eventId] of top6) {
    const winnerId = h2hWinnerId.get(eventId);
    if (!winnerId) h2hDraws++;
    else if (winnerId === homeTeam.id) h2hHomeWins++;
    else if (winnerId === awayTeam.id) h2hAwayWins++;
  }

  // --- Contexte ---
  const totalTeams = input.leagueTeamsCount || 20;
  const derby = detectDerby(homeTeam.name, awayTeam.name);
  const isDerby = input.isDerby || derby.isDerby;
  const derbyLabel = derby.label;

  const fatigueNoteHome = fatigueHome
    ? `${home.name} : repos de ${home.fatigueDaysSinceLast ?? '?'} jours et ${home.matchesLast14Days} matchs sur 14 jours — fatigue possible`
    : null;
  const fatigueNoteAway = fatigueAway
    ? `${away.name} : repos de ${away.fatigueDaysSinceLast ?? '?'} jours et ${away.matchesLast14Days} matchs sur 14 jours — fatigue possible`
    : null;
  const injuriesNoteHome = home.injuriesCount > 0 ? `${home.injuriesCount} joueur(s) clé(s) absent(s) ou incertain(s)` : null;
  const injuriesNoteAway = away.injuriesCount > 0 ? `${away.injuriesCount} joueur(s) clé(s) absent(s) ou incertain(s)` : null;

  // Affichage 1X2 : arrondi tel que home + draw + away ≡ 1 exactement (4 déc.)
  const rH = round(finalProbs.home, 4);
  const rD = round(finalProbs.draw, 4);
  const rA = round(1 - rH - rD, 4);

  return {
    // Traçabilité ablation (plan V2→V3 étape 11) : mode réellement appliqué
    // aux λ — 'full' quand le champ est absent (défaut, v2.1 inchangé).
    contextMode,
    home,
    away,
    prediction: {
      probs: { home: rH, draw: rD, away: rA },
      poisson: poissonRes.probs,
      elo: eloProbs,
      form: formProbs,
      overUnder: finalOverUnder,
      btts: finalBtts,
      raw: { overUnder: rawOverUnder, btts: rawBtts },
      topScores: poissonRes.topScores,
      firstGoalTiming: firstGoalTimingProbs(lambdaHome + lambdaAway),
      firstToScore: firstToScoreProbs(lambdaHome, lambdaAway),
      lambda: { home: lambdaHome, away: lambdaAway, total: round(lambdaHome + lambdaAway, 2) },
      confidence: conf,
      confidenceLabel: confidenceLabel,
      valueBets,
      oddsMovement,
      recommendedBets,
    },
    h2h,
    h2hSummary: { homeWins: h2hHomeWins, draws: h2hDraws, awayWins: h2hAwayWins, total: h2h.length },
    context: {
      isDerby,
      derbyLabel,
      stakesHome: stakesLabel(home.rank, home.gamesPlayed, totalTeams),
      stakesAway: stakesLabel(away.rank, away.gamesPlayed, totalTeams),
      weather: null,
      fatigueNoteHome,
      fatigueNoteAway,
      injuriesNoteHome,
      injuriesNoteAway,
    },
  };
}
