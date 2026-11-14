// ============================================================
// VOLTRIX bet — Constantes calibrées du moteur football
// Version voltrix-foot-v2.2 — calibrée par le backtest du
// 11 novembre 2026 (football-data.co.uk, 6 ligues, 37 715
// matchs 2010-26, split temporel train 2010-22 / validation
// 2022-24 / test 2024-26 — rapport : download/backtest-foot/).
//
// CONTENU
//   1. LEAGUE_GOAL_AVERAGES : moyennes de buts EMPIRIQUES par
//      championnat (saison 2025-26 complète, football-data.co.uk).
//      Effet mesuré (validation+test) : +0,3 pt de précision sur
//      l'Over/Under 2,5 (54,25 → 54,54 %), log-loss O/U −0,0013,
//      neutre sur le 1X2. L'écart entre ligues est massif
//      (Bundesliga 3,13 buts/match vs Championship 2,45) : une
//      échelle globale ne peut pas être juste partout.
//   2. VALUE_BET_* : discipline de value betting calibrée par
//      simulation (implémentation n°5) — voir prediction.ts.
//
// Les constantes du moteur elles-mêmes (parts de nul, blend,
// Elo) vivent dans prediction.ts, au plus près des formules.
// ============================================================

/** Version du jeu de constantes (traçabilité des recalibrations).
 *  v2.3 : predQuick intègre le bloc premier but (6 fenêtres + 0-0,
 *  minute médiane) pour alimenter le combinateur. */
export const FOOT_PARAMS_VERSION = 'voltrix-foot-v2.3';

/** Source et date de calibration. */
export const FOOT_PARAMS_SOURCE =
  'backtest football-data.co.uk 2026-11-11 — 6 ligues, 37 715 matchs 2010-26, test 2024-26';

/** Référence de repli quand la ligue n'est pas couverte (moyenne 6 ligues 2025-26). */
export const GLOBAL_GOAL_AVERAGES = { home: 1.52, away: 1.22 };

/**
 * Moyennes de buts par match et par championnat — saison 2025-26
 * complète (seule saison précédant la calibration disponible en
 * entier : zéro fuite). Clés = codes football-data.co.uk.
 */
export const LEAGUE_GOAL_AVERAGES: Record<string, { home: number; away: number }> = {
  // Angleterre
  E0: { home: 1.513, away: 1.421 }, // Premier League
  E1: { home: 1.435, away: 1.016 }, // Championship
  E2: { home: 1.404, away: 1.181 }, // League One
  E3: { home: 1.371, away: 1.123 }, // League Two
  EC: { home: 1.496, away: 1.199 }, // National League
  // Écosse
  SC0: { home: 1.693, away: 1.268 }, // Premiership
  SC1: { home: 1.428, away: 1.083 }, // Championship (Écosse)
  // Espagne / Italie / Allemagne / France
  SP1: { home: 1.453, away: 1.166 }, // LaLiga
  SP2: { home: 1.45, away: 1.08 },   // LaLiga 2
  I1: { home: 1.339, away: 1.221 },  // Serie A
  I2: { home: 1.355, away: 1.108 },  // Serie B
  D1: { home: 1.631, away: 1.503 },  // Bundesliga
  D2: { home: 1.637, away: 1.386 },  // 2. Bundesliga
  F1: { home: 1.608, away: 1.369 },  // Ligue 1
  F2: { home: 1.507, away: 1.072 },  // Ligue 2
  // Autres championnats couverts
  N1: { home: 1.696, away: 1.291 },  // Eredivisie
  B1: { home: 1.593, away: 1.163 },  // Pro League (Belgique)
  P1: { home: 1.402, away: 1.167 },  // Primeira Liga
  T1: { home: 1.667, away: 1.269 },  // Süper Lig
  G1: { home: 1.283, away: 1.159 },  // Super League (Grèce)
};

/** Correspondance code ligue ESPN → code football-data.co.uk. */
const ESPN_TO_FD: Record<string, string> = {
  'eng.1': 'E0', 'eng.2': 'E1', 'eng.3': 'E2', 'eng.4': 'E3', 'eng.5': 'EC',
  'sco.1': 'SC0', 'sco.2': 'SC1',
  'esp.1': 'SP1', 'esp.2': 'SP2',
  'ita.1': 'I1', 'ita.2': 'I2',
  'ger.1': 'D1', 'ger.2': 'D2',
  'fra.1': 'F1', 'fra.2': 'F2',
  'ned.1': 'N1', 'bel.1': 'B1', 'por.1': 'P1', 'tur.1': 'T1', 'gre.1': 'G1',
};

/**
 * Moyennes de buts d'une ligue pour EngineInput.leagueGoalAverages.
 * Retourne null si la ligue n'est pas couverte → le moteur garde ses
 * constantes globales (comportement v2.1, inchangé à l'octet près).
 */
export function leagueGoalAverages(leagueCode: string): { home: number; away: number } | null {
  const fd = ESPN_TO_FD[leagueCode];
  if (!fd) return null;
  const avgs = LEAGUE_GOAL_AVERAGES[fd];
  if (!avgs || !(avgs.home > 0.5) || !(avgs.away > 0.5)) return null;
  return { home: avgs.home, away: avgs.away };
}

// ============================================================
// Discipline de value betting (implémentation n°5)
// Simulation backtest 1X2, test 2024-26, mise plate 1u :
//   seuil 2 % (ancienne règle)   → ROI −12,8 % (3 913 paris)
//   seuil 5 %                    → ROI −11,9 % (3 108)
//   seuil 5 % + cote ≤ 2,5       → ROI  −3,7 % (766)  ← retenu
// Diagnostic : les sélections se concentrent sur les outsiders
// (cote moyenne 4,36, gains à 3,13) — biais favori/outsider que
// le modèle amplifie. Seul le plafond de cote corrige la sélection.
// ============================================================

/** Seuil d'edge minimal pour proposer un value bet (était 2 %). */
export const VALUE_BET_MIN_EDGE = 0.05;

/** Cote maximale éligible (plafond anti-outsider, était ∞). */
export const VALUE_BET_MAX_ODDS = 2.5;

/** Part de Kelly appliquée (inchangée — plafonnée à 10 %). */
export const VALUE_BET_KELLY_CAP = 0.1;
