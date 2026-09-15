// ============================================================
// VOLTRIX bet — Paramètres de buts par ligue (EMPIRIQUES)
// Généré par scripts/backtest.ts (Task 21-d) — NE PAS ÉDITER À LA MAIN.
// ============================================================
// Méthode : calendriers ESPN par équipe, saison 2025 UNIQUEMENT
// (saison précédente = entièrement antérieure à la fenêtre backtest → zéro
// fuite walk-forward), matchs dédupliqués par eventId, ligues avec
// sample >= 10 matchs. homeAvg = buts marqués par match par l'équipe à
// domicile ; awayAvg = par l'équipe à l'extérieur ; drawRate = taux de nul.
// Statut (décision 21-d) : NON ACTIVÉ — DONNÉE SEULEMENT.
// Chiffres (échantillon backtest, scripts/backtest-results.json) :
//   RPS 1X2  : global 0.20080 → ligue 0.20064 (AMÉLIORÉ, n=250)
//   Brier O/U brut : global 0.22339 → ligue 0.22372 (non amélioré)
//   Brier O/U calibré : global 0.22358 → ligue 0.22362 (DÉGRADÉ)
// Le variant n'améliore PAS conjointement le RPS 1X2 ET le Brier O/U 2.5 → il
// n'est PAS câblé dans analyze.ts (l'audit exige de retirer les variables qui
// n'apportent rien). TODO : ré-évaluer sur une fenêtre plus large avant toute
// réactivation — le champ EngineInput.leagueGoalAverages reste disponible.
// ============================================================

export interface LeagueGoalParams {
  homeAvg: number; // buts/marqués par match par une équipe à domicile
  awayAvg: number; // buts/match par une équipe à l'extérieur
  drawRate: number; // part des matchs nuls
  sample: number; // n matchs utilisés
}

export const LEAGUE_PARAMS: Record<
  string,
  { homeAvg: number; awayAvg: number; drawRate: number; sample: number }
> = {
  'bra.1': { homeAvg: 1.535, awayAvg: 1.005, drawRate: 0.261, sample: 368 },
  'eng.1': { homeAvg: 1.516, awayAvg: 1.222, drawRate: 0.275, sample: 374 },
  'esp.1': { homeAvg: 1.578, awayAvg: 1.123, drawRate: 0.243, sample: 374 },
  'fra.1': { homeAvg: 1.597, awayAvg: 1.244, drawRate: 0.241, sample: 303 },
  'ger.1': { homeAvg: 1.783, awayAvg: 1.457, drawRate: 0.247, sample: 300 },
  'ita.1': { homeAvg: 1.286, awayAvg: 1.168, drawRate: 0.254, sample: 374 },
  'ned.1': { homeAvg: 1.812, awayAvg: 1.383, drawRate: 0.267, sample: 303 },
  'por.1': { homeAvg: 1.5, awayAvg: 1.188, drawRate: 0.266, sample: 304 },
  'usa.1': { homeAvg: 1.657, awayAvg: 1.359, drawRate: 0.25, sample: 540 },
};

// Repli global (constantes historiques du moteur, prediction.ts) si la ligue
// est absente de LEAGUE_PARAMS.
export const LEAGUE_PARAMS_GLOBAL: LeagueGoalParams = {
  homeAvg: 1.581,
  awayAvg: 1.238,
  drawRate: 0.256,
  sample: 3240,
};

/** Paramètres de ligue, ou null si absents (→ repli constantes globales du moteur). */
export function getLeagueGoalParams(leagueCode: string): LeagueGoalParams | null {
  return LEAGUE_PARAMS[leagueCode] ?? null;
}
