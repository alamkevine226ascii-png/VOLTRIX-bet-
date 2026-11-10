// ============================================================
// VOLTRIX bet — Moteur de prédiction
// Ensemble : Poisson bivarié (40%) + Elo (35%) + Forme (25%)
// Marchés : 1X2, Double Chance, O/U 1.5/2.5/3.5, BTTS,
//           Moment du 1er but (hazard par morceaux calé sur les
//           minutes de buts réelles d'ESPN — goal-timing.ts —,
//           repli Poisson homogène si aucune donnée),
//           Équipe à marquer en 1er
// Nov. 2026 — implémentation n°1 : les marchés de buts sortent
// désormais de la GRILLE CONJOINTE EXACTE du Poisson bivarié
// (montecarlo.ts, composante partagée λ3 = ρ·√(λH·λA)), validée
// par 10 000 simulations Monte Carlo déterministes. L'ancien
// poissonModel() (indépendance) reste exporté comme référence
// de comparaison pour les backtests.
// Nov. 2026 (v2.2) — CONSTANTES RECALIBRÉES par le backtest
// football-data.co.uk (37 715 matchs 2010-26, split temporel,
// test 2024-26 : log-loss 1,0166 → 1,0110, nul prédit 23,1 →
// 25,2 %) : parts de nul Elo/forme, blend 40/35/25, Elo K=10
// ADV=110 (Elo local comprimé), redistribution /1000, forme
// ×0.1, bornes λ élargies, fatigue neutralisée (aucun gain
// mesuré), derby 0.88. Référence : league-params.ts + rapport
// download/backtest-foot/.
// ============================================================

import type { EspnScheduleGame, EspnStandingsTeam, EspnOdds, EspnInjury } from './espn';
// market-odds.ts est un module de math pures (aucun import) : aucun cycle.
// deMarginOverUnder = dé-margage des cotes O/U (calibration, audit 21-b FIX 1) ;
// bttsProb = forme fermée BTTS indépendante (référence/legacy poissonModel).
// Les probas de buts du moteur passent désormais par la grille bivariée
// (montecarlo.ts, nov. 2026).
import { bttsProb, deMarginOverUnder } from './market-odds';
import {
  BIVARIATE_RHO,
  MC_ITERATIONS,
  calibrateBivariate,
  overAtLine,
  simulateMatch,
  type JointGrid,
  type McMatchResult,
} from './montecarlo';
// Discipline de value betting calibrée par backtest (implémentation n°5) :
// seuil d'edge 5 % (était 2 %) + cote plafonnée à 2,5 (était illimitée).
// Simulation test 2024-26, mise plate : ROI −12,8 % (ancienne règle) →
// −3,7 % (discipline) — détail dans league-params.ts.
import { VALUE_BET_MAX_ODDS, VALUE_BET_MIN_EDGE, VALUE_BET_KELLY_CAP } from './league-params';
// goal-timing.ts est remplacé par first-goal.ts : MOTEUR DÉDIÉ à la
// minute du premier but (demande explicite 2026-11-09). Il prédit
// directement la quantité demandée à partir des minutes RÉELLES des
// 1ers buts des matchs des deux équipes (12 derniers matchs chacun,
// summaries ESPN) : fusion par hazards cumulés + mise à l'échelle λ.
// Aucun cycle d'imports : first-goal.ts importe ./espn et ../mma/espn,
// jamais prediction.ts.
import {
  predictFirstGoal,
  type FirstGoalHeadline,
  type TeamFirstGoals,
} from './first-goal';

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
  // décomposition des modèles — « poisson » = composante BIVARIÉE
  // (nov. 2026) : grille conjointe exacte avec corrélation λ3, plus
  // 10 000 simulations Monte Carlo de contrôle (voir `mc`).
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
  // moment du premier but — MOTEUR DÉDIÉ first-goal.ts :
  // 6 fenêtres + 0-0 (somme exactement 1) ; basis = 'equipes' si les
  // minutes réelles des 1ers buts d'au moins une équipe ont pu être
  // lues chez ESPN, sinon profil de ligue empirique ('ligue').
  firstGoalTiming: Array<{
    window: string;
    label: string;
    prob: number;
    basis: 'equipes' | 'ligue';
    sampleMatches: number;
  }>;
  // titre « 1er but attendu vers la Xe minute » + tempo des équipes
  firstGoalHeadline: FirstGoalHeadline;
  // première équipe à marquer
  firstToScore: { home: number; away: number; noGoal: number };
  // buts attendus
  lambda: { home: number; away: number; total: number };
  // confiance
  confidence: number; // 1..5
  confidenceLabel: string;
  // value bets (si cotes dispo) — code machine pour le registre ROI
  // (bets-ledger.ts, implémentation n°5) : 1X2:H/D/A ou OU:O/U:ligne
  valueBets: Array<{ market: string; pick: string; code: string; modelProb: number; odds: number; edge: number; kelly: number }>;
  oddsMovement: string | null;
  recommendedBets: Array<{ market: string; pick: string; prob: number; note: string }>;
  // Diagnostics Poisson bivarié + Monte Carlo (implémentation n°1,
  // nov. 2026). OPTIONNEL : les analyses issues du cache antérieur à
  // la mise à jour ne l'ont pas — l'UI doit tester sa présence.
  mc?: {
    model: 'bivariate-poisson';
    rho: number;
    lambda3: number;
    iterations: number;
    seed: number;
    /** Écart max |grille exacte − Monte Carlo| sur les probas clés. */
    agreement: number;
    medianGoals: number;
    /** P(total = t) pour t = 0..9, dernière barre = P(total ≥ 10). Somme 1. */
    totalGoalsHist: number[];
    winToNil: { home: number; away: number };
  };
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
// v2.2 (backtest 2026-11) : K = 10 et avantage terrain +110 —
// l'Elo LOCAL de l'app (union des 2 calendriers, adversaires à
// 1500) comprime les ratings vers 1500 ; un K faible laisse le
// signal s'accumuler sans bruit et l'avantage terrain porte
// davantage du signal. L'Elo GLOBAL (toute la ligue) vaudrait
// −0,006 log-loss de plus (piste v3 — non implémenté : l'API
// scoreboard ESPN ne supporte pas les plages de dates).
const K_FACTOR = 10;
const HOME_ADV_ELO = 110;

export interface EloState {
  ratings: Map<string, number>;
  games: Map<string, number>;
}

export function computeElo(teamIdA: string, teamIdB: string, schedules: Map<string, EspnScheduleGame[]>): EloState {
  const ratings = new Map<string, number>();
  const games = new Map<string, number>();

  // Reconstruction : parcourir chaque équipe et ses matchs, reconstituer le
  // domicile/l'extérieur de chaque rencontre, dédupliquer par
  // eventId + paire d'équipes (le même match est vu depuis les 2 calendriers).
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
  // v2.2 (backtest) : base 0,36 / pente 0,7 — l'ancienne forme
  // (0,30/1,4) sous-estimait les nuls (23,1 % prédit vs 25,7 %
  // réel) ; le plafond 0,30 borne la base 0,36, la pente réduite
  // laisse le nul décroître moins vite vers les déséquilibres.
  const draw = clamp(0.36 - 0.7 * Math.pow(eHome - 0.5, 2) * 4, 0.11, 0.30);
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
  // v2.2 (backtest) : base 0,32 / pente 0,6 (était 0,28/1,2) —
  // même recalibration du nul que eloToProbs.
  const draw = clamp(0.32 - 0.6 * Math.pow(eHome - 0.5, 2) * 4, 0.12, 0.28);
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
// L'ANCIEN modèle homogène (Poisson à intensité constante, même forme
// pour tous les matchs) a été RETIRÉ : c'est lui que l'utilisateur
// percevait comme « le 1er but toujours à la 16e ». Tout passe
// désormais par le moteur dédié first-goal.ts (predictFirstGoal),
// qui prédit la minute du 1er but à partir des VRAIS 1ers buts des
// matchs des deux équipes — repli profil de ligue empirique inclus.

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
export function firstToScoreProbs(lambdaHome: number, lambdaAway: number, pNoGoal?: number): { home: number; away: number; noGoal: number } {
  // Garde-fous anti-NaN (λ invalides → quasi-aucun but attendu)
  const lh = Number.isFinite(lambdaHome) && lambdaHome > 0 ? lambdaHome : 0.02;
  const la = Number.isFinite(lambdaAway) && lambdaAway > 0 ? lambdaAway : 0.02;
  // P(0-0) : valeur EXACTE de la grille bivariée si fournie (supérieure
  // au cas indépendant dès que λ3 > 0), sinon forme fermée indépendante.
  const noGoal = pNoGoal != null && Number.isFinite(pNoGoal) && pNoGoal >= 0 ? pNoGoal : Math.exp(-(lh + la));
  const goalShare = 1 - noGoal;
  const total = lh + la;
  const home = round((lh / total) * goalShare, 4);
  const away = round((la / total) * goalShare, 4);
  // noGoal absorbe l'arrondi → home + away + noGoal = 1 EXACTEMENT
  return { home, away, noGoal: round(1 - home - away, 4) };
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
  odds: EspnOdds | null,
  // Nov. 2026 : grille conjointe BIVARIÉE du match — sert au calcul
  // exact des P(over) des lignes exotiques (remplace lambdaTotal
  // et son approximation 1D indépendante).
  grid: JointGrid
): MatchPrediction['valueBets'] {
  if (!odds?.hasOdds) return [];
  const bets: MatchPrediction['valueBets'] = [];
  const add = (market: string, pick: string, code: string, modelProb: number, dec: number | null) => {
    // v2.2 (backtest, implémentation n°5) : cote plafonnée — les sélections
    // à grosse cote concentrent le biais favori/outsider (gains à 3,13 pour
    // une cote moyenne de 4,36) ; seuil d'edge 2 % → 5 %.
    if (!dec || dec <= 1.01 || dec > VALUE_BET_MAX_ODDS || modelProb <= 0) return;
    const edge = modelProb * dec - 1;
    if (edge > VALUE_BET_MIN_EDGE) {
      bets.push({
        market,
        pick,
        code,
        modelProb: round(modelProb, 4),
        odds: dec,
        edge: round(edge, 4),
        kelly: round(clamp(edge / (dec - 1), 0, VALUE_BET_KELLY_CAP), 4),
      });
    }
  };
  // Certaines ligues n'exposent que les cotes d'OUVERTURE (jamais de close) :
  // repli sur open, comme le fait déjà la calibration O/U du pipeline.
  const dec = (close: number | null, open: number | null): number | null => close ?? open;

  const ml = odds.moneyline;
  add('1X2', 'Victoire domicile', '1X2:H', prediction.probs.home, dec(ml.home.close, ml.home.open));
  add('1X2', 'Nul', '1X2:D', prediction.probs.draw, dec(ml.draw.close, ml.draw.open));
  add('1X2', 'Victoire extérieur', '1X2:A', prediction.probs.away, dec(ml.away.close, ml.away.open));

  const ouLine = odds.overUnderLine;
  if (ouLine !== null) {
    // Proba BRUTE du modèle à LA ligne du marché : ligne standard → grille
    // du Poisson ; ligne exotique (ex. 4.5, absente de rawOverUnder) →
    // distribution 1D du total (somme de Poisson indépendantes = Poisson(λt)).
    // L'ancien code retombait silencieusement sur la ligne 2.5 et comparait
    // P(over 2.5) aux cotes d'une ligne 4.5 — edge faux.
    const exact = prediction.overUnder.find((o) => o.line === ouLine);
    // Nov. 2026 : ligne exotique → P(over) sur la GRILLE BIVARIÉE exacte
    // (l'ancienne approximation 1D totalGoalsDist supposait l'indépendance).
    const overModel = exact ? exact.over : overAtLine(grid, ouLine);
    const underModel = exact ? exact.under : 1 - overModel;
    add(`Over/Under ${ouLine}`, `Plus de ${ouLine}`, `OU:O:${ouLine}`, overModel, dec(odds.total.over.closeOdds, odds.total.over.openOdds));
    add(`Over/Under ${ouLine}`, `Moins de ${ouLine}`, `OU:U:${ouLine}`, underModel, dec(odds.total.under.closeOdds, odds.total.under.openOdds));
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
  // Minute du 1er but — OPTIONNEL et rétrocompatible : absent/null → profil
  // de ligue empirique, étiqueté 'ligue'.
  firstGoals?: { home: TeamFirstGoals | null; away: TeamFirstGoals | null } | null;
  // Altitude du stade (mètres, nov. 2026 — modificateur environnemental
  // inspiré du moteur WC2026 d'AmirMotefaker) : au-dessus de 1 500 m,
  // l'effet physiologique documenté accélère le tempo (buts). Dormant
  // pour les ligues européennes couvertes (aucun stade > 1 500 m).
  venueAltitudeM?: number | null;
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

  // Déduplication défensive par eventId : un calendrier peut contenir le même
  // match deux fois si l'appelant fournit deux fois la même saison (chaque
  // fetch de fetchTeamSchedule repousse ses events — ex. analyze.ts avec
  // PREV_SEASON === saison courante). Sans déduplication : forme affichée en
  // double, gamesHome/gamesAway et matchesLast14Days gonflés (le SHRINK et la
  // fatigue sur-réagiraient). Le moteur doit rester correct quel que soit
  // l'appelant. NB : le même match vu depuis les DEUX calendriers (les deux
  // équipes se sont rencontrées) est légitime et conservé — la déduplication
  // est faite PAR calendrier.
  const dedupeByEvent = (list: EspnScheduleGame[]): EspnScheduleGame[] => {
    const seen = new Set<string>();
    const out: EspnScheduleGame[] = [];
    for (const g of list) {
      if (!g || !g.eventId || seen.has(g.eventId)) continue;
      seen.add(g.eventId);
      out.push(g);
    }
    return out;
  };
  const homeSchedule = dedupeByEvent(homeTeam.schedule);
  const awaySchedule = dedupeByEvent(awayTeam.schedule);

  const schedules = new Map<string, EspnScheduleGame[]>([
    [homeTeam.id, homeSchedule],
    [awayTeam.id, awaySchedule],
  ]);

  const elo = computeElo(homeTeam.id, awayTeam.id, schedules);
  const eloHome = elo.ratings.get(homeTeam.id) ?? 1500;
  const eloAway = elo.ratings.get(awayTeam.id) ?? 1500;

  const home = analyzeTeam(homeTeam.id, homeTeam.name, homeTeam.logo, homeSchedule, homeTeam.standings, injuries, nowMs, true);
  const away = analyzeTeam(awayTeam.id, awayTeam.name, awayTeam.logo, awaySchedule, awayTeam.standings, injuries, nowMs, false);
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
  // Fatigue : moins de 4 jours de repos OU 3+ matchs sur 14 jours.
  // v2.2 (backtest 2026-11) : NEUTRALISÉE (facteur 1,0) — la
  // descente coordonnée sur la validation 2022-24 n'a trouvé
  // AUCUN gain au multiplicateur ×0,94 ; l'effet réel est couvert
  // par la forme (déjà dans les λ). L'affichage des notes de
  // fatigue est conservé (information utilisateur).
  const FATIGUE_FACTOR = 1.0;
  const fatigueHome = (home.fatigueDaysSinceLast !== null && home.fatigueDaysSinceLast <= 3) || home.matchesLast14Days >= 3;
  const fatigueAway = (away.fatigueDaysSinceLast !== null && away.fatigueDaysSinceLast <= 3) || away.matchesLast14Days >= 3;
  // Instrument d'ablation (plan V2→V3 étape 11), défaut 'full' = v2.1 inchangé :
  // en 'mix' les modificateurs de contexte (fatigue, blessures, derby) ne
  // touchent plus les λ — seuls les λ de base + forme + Elo restent actifs.
  if (!ablateContext && fatigueHome) lambdaHome *= FATIGUE_FACTOR;
  if (!ablateContext && fatigueAway) lambdaAway *= FATIGUE_FACTOR;

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
  // (neutralisé en 'mix' — instrument d'ablation, plan V2→V3 étape 11).
  // v2.2 (backtest) : 0,92 → 0,88 (gain marginal −0,0003 log-loss,
  // direction confirmée en test).
  if (!ablateContext && input.isDerby) {
    lambdaHome *= 0.88;
    lambdaAway *= 0.88;
  }

  // Altitude (nov. 2026, implémentation n°1) : au-dessus de 1 500 m,
  // l'effet physiologique documenté (aérobie réduite, ballon plus vif)
  // accélère le tempo — modificateur borné à +8 %, appliqué au TOTAL
  // (ratio dom/ext préservé). Dormant pour les ligues européennes
  // couvertes ; calibration fine prévue au backtest n°2.
  if (input.venueAltitudeM != null && input.venueAltitudeM > 1500) {
    const altFactor = 1 + Math.min(2, (input.venueAltitudeM - 1500) / 1000) * 0.04;
    lambdaHome *= altFactor;
    lambdaAway *= altFactor;
  }

  // Météo (audit 21-b FIX 5) : influence RETIRÉE des λ en attendant une
  // validation hors-échantillon — la donnée Open-Meteo est « current » (et non
  // les conditions au coup d'envoi) et les règles fixes −5 %/−3 % n'étaient
  // pas démontrées statistiquement. input.weatherImpact reste transmis et
  // l'affichage descriptif de la fiche Analyse est conservé : seule la
  // multiplication des λ est supprimée.

  // Bonus forme récente injectée dans les lambdas
  // v2.2 (backtest) : amplitude 0,2 → 0,1 — le signal de forme
  // isolé est le plus faible des trois modèles (44,6 % en test) ;
  // atténuer son influence directe sur les λ améliore le log-loss.
  const formFactorHome = 0.9 + home.formScore * 0.1; // 0.9..1.0
  const formFactorAway = 0.9 + away.formScore * 0.1;
  lambdaHome *= formFactorHome;
  lambdaAway *= formFactorAway;

  // Force Elo relative : redistribue les buts attendus entre les équipes en
  // PRÉSERVANT le total. L'ancienne formule réutilisait λ domicile déjà
  // mis à jour (asymétrie r^1.5 : λ total gonflé de +28 % quand l'extérieur
  // est favori, déprimé sinon) et comptait l'avantage du terrain en double
  // (déjà présent dans les références 1.52/1.22).
  const eloDiff = clamp(eloHome - eloAway, -250, 250);
  // v2.2 (backtest) : /800 → /1000 — redistribution un peu moins
  // sensible à l'Elo (l'Elo local est comprimé, /800 sur-réagissait).
  const eloFactor = Math.pow(10, eloDiff / 1000);
  const totalPreElo = lambdaHome + lambdaAway;
  const adjHome = lambdaHome * eloFactor;
  const adjAway = lambdaAway / eloFactor;
  const adjSum = adjHome + adjAway;
  if (Number.isFinite(totalPreElo) && totalPreElo > 0 && adjSum > 0) {
    lambdaHome = totalPreElo * (adjHome / adjSum);
    lambdaAway = totalPreElo * (adjAway / adjSum);
  }

  // Garde-fous : jamais de NaN / valeur non positive, puis bornes réalistes
  // v2.2 (backtest) : bornes élargies [0,25 ; 4,4] / [0,20 ; 4,0] —
  // les anciennes bornes tronquaient les favoris extrêmes
  // (Bayern → λ ≈ 4 chez lui) et désaturaient l'Over des gros chocs.
  if (!Number.isFinite(lambdaHome) || lambdaHome <= 0.05) lambdaHome = 1.35;
  if (!Number.isFinite(lambdaAway) || lambdaAway <= 0.05) lambdaAway = 1.15;
  lambdaHome = clamp(lambdaHome, 0.25, 4.4);
  lambdaAway = clamp(lambdaAway, 0.2, 4.0);

  lambdaHome = round(lambdaHome, 2);
  lambdaAway = round(lambdaAway, 2);

  // --- Modèles individuels ---
  // Implémentation n°1 (nov. 2026) : la composante « Poisson » du blend
  // sort désormais du modèle BIVARIÉ — grille conjointe exacte avec
  // composante partagée λ3 (corrélation des buts) + 10 000 simulations
  // Monte Carlo déterministes de contrôle. poissonModel() (indépendance)
  // reste l'étalon de comparaison pour les backtests.
  const mcSim: McMatchResult = simulateMatch(lambdaHome, lambdaAway, {
    rho: BIVARIATE_RHO,
    iterations: MC_ITERATIONS,
  });
  const poissonRes: PoissonResult = {
    probs: mcSim.exact.probs,
    overUnder: mcSim.exact.overUnder,
    btts: mcSim.exact.btts,
    topScores: mcSim.exact.topScores,
    lambdaHome,
    lambdaAway,
  };
  const eloProbs = eloToProbs(eloHome, eloAway);
  const formProbs = formToProbs(home.formScore, away.formScore);

  // --- Ensemble final ---
  // v2.2 (backtest) : 45/30/25 → 40/35/25 au profit de l'Elo.
  const W = { poisson: 0.40, elo: 0.35, form: 0.25 };
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
  // Ligne d'ancrage = celle des cotes O/U réellement utilisées. Si le champ
  // brut overUnderLine et la ligne close divergent (rare), ce sont les cotes
  // close qui portent l'information : ancrer sur LEUR ligne, sinon la
  // dichotomie cale P(over L1) sur la proba marché d'une autre ligne L2.
  const anchorLine = odds?.hasOdds ? (odds.total.over.line ?? odds.overUnderLine) : null;
  const marketOverOdds = odds?.total.over.closeOdds ?? odds?.total.over.openOdds ?? null;
  const marketUnderOdds = odds?.total.under.closeOdds ?? odds?.total.under.openOdds ?? null;
  if (anchorLine !== null && marketOverOdds !== null && marketUnderOdds !== null) {
    const dm = deMarginOverUnder(marketOverOdds, marketUnderOdds);
    if (dm) {
      // Nov. 2026 : la calibration passe par la grille BIVARIÉE — la
      // corrélation λ3 est recalculée à chaque pas de dichotomie, le
      // modèle reste cohérent avec lui-même après ancrage marché.
      const cal = calibrateBivariate(lambdaHome, lambdaAway, BIVARIATE_RHO, anchorLine, dm.pOver, [1.5, 2.5, 3.5]);
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
    odds,
    mcSim.exact.grid
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

  // Minute du 1er but — MOTEUR DÉDIÉ (mission « moteur à part »,
  // 2026-11-09) : fetchTeamFirstGoals (first-goal.ts) lit les minutes
  // RÉELLES des 1ers buts des 12 derniers matchs de chaque équipe,
  // predictFirstGoal fusionne les deux profils par hazards cumulés,
  // met à l'échelle par le λ du match et ressort la minute attendue.
  // Aucune donnée → profil de ligue empirique, étiqueté 'ligue'.
  const firstGoals = predictFirstGoal(
    lambdaHome + lambdaAway,
    input.firstGoals?.home ?? null,
    input.firstGoals?.away ?? null,
  );
  const firstGoalTiming = firstGoals.entries;
  const firstGoalHeadline = firstGoals.headline;

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
  scanH2HSide(homeSchedule, homeTeam.id, homeTeam.name, awayTeam.id, awayTeam.name);
  scanH2HSide(awaySchedule, awayTeam.id, awayTeam.name, homeTeam.id, homeTeam.name);
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
      firstGoalTiming,
      firstGoalHeadline,
      firstToScore: firstToScoreProbs(lambdaHome, lambdaAway, mcSim.exact.noGoal),
      lambda: { home: lambdaHome, away: lambdaAway, total: round(lambdaHome + lambdaAway, 2) },
      confidence: conf,
      confidenceLabel: confidenceLabel,
      valueBets,
      oddsMovement,
      recommendedBets,
      mc: {
        model: 'bivariate-poisson',
        rho: mcSim.rho,
        lambda3: mcSim.lambda3,
        iterations: mcSim.iterations,
        seed: mcSim.seed,
        agreement: round(mcSim.agreement, 4),
        medianGoals: mcSim.mc.medianGoals,
        // Barres 0..9 + dernière barre « 10+ » (absorbe l'arrondi → somme 1)
        totalGoalsHist: (() => {
          const full = mcSim.exact.totalGoalsHist;
          const head = full.slice(0, 10).map((p) => round(p, 4));
          const tail = round(1 - head.reduce((s, v) => s + v, 0), 4);
          return [...head, tail];
        })(),
        winToNil: {
          home: round(mcSim.exact.winToNil.home, 4),
          away: round(mcSim.exact.winToNil.away, 4),
        },
      },
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
