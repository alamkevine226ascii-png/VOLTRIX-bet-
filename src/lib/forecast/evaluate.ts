// ============================================================
// VOLTRIX bet — Prévisions hebdomadaires : évaluation (§19 Evaluation)
// Évaluation DÉRIVÉE = f(ForecastSnapshot figé, MatchResult officiel).
// §9 : on n'évalue JAMAIS tant que le résultat officiel n'est pas
// définitif ; reporté/annulé/suspendu → VOID (exclu des statistiques).
// ============================================================

export type Grade = 'CORRECT' | 'INCORRECT' | 'VOID';

/** Statuts ESPN bruts → statut normalisé stocké dans MatchResult. */
export function normalizeStatus(statusName: string, state: string, completed: boolean, statusDetail: string | null): string {
  const n = (statusName || '').toUpperCase();
  if (n.includes('POSTPONED')) return 'POSTPONED';
  if (n.includes('CANCELED') || n.includes('CANCELLED')) return 'CANCELLED';
  if (n.includes('SUSPENDED')) return 'SUSPENDED';
  if (n.includes('DELAYED')) return 'SUSPENDED';
  if (n.includes('ABANDONED') || n.includes('FORFEIT')) return 'CANCELLED';
  // Filet de sécurité : libellé du détail (convention grade.ts VOID_STATUS_RE)
  const d = statusDetail ?? '';
  if (/postpon/i.test(n) || /postpon/i.test(d)) return 'POSTPONED';
  if (/cancel/i.test(n) || /cancel/i.test(d)) return 'CANCELLED';
  if (/suspend|abandon|forfeit/i.test(n) || /suspend|abandon|forfeit/i.test(d)) return 'SUSPENDED';
  if (completed || n.includes('FINAL')) return 'FINAL';
  if (state === 'in') return 'LIVE';
  if (state === 'pre') return 'SCHEDULED';
  return 'UNKNOWN';
}

/** Statuts considérés définitifs pour l'évaluation. */
export function isFinalStatus(status: string): boolean {
  return status === 'FINAL' || status === 'POSTPONED' || status === 'CANCELLED' || status === 'SUSPENDED';
}

/** Statuts VOID (exclus des statistiques de précision — §9). */
export function isVoidStatus(status: string): boolean {
  return status === 'POSTPONED' || status === 'CANCELLED' || status === 'SUSPENDED';
}

export interface SnapshotGrades {
  grade1x2: Grade;
  gradeOu25: Grade;
  gradeBtts: Grade;
}

/**
 * Note les 3 marchés d'un snapshot face au résultat final.
 * Préconditions : result.status FINAL (scores présents) ou VOID.
 * Le 1X2 est noté par pickedTeamId (fiable — convention Task 21-a).
 */
export function gradeSnapshot(
  snap: {
    pick1x2: string;
    pickedTeamId: string | null;
    homeTeamId: string | null;
    awayTeamId: string | null;
    pickOu25: string;
    pickBtts: string;
  },
  result: { status: string; homeScore: number | null; awayScore: number | null }
): SnapshotGrades {
  const voidAll: SnapshotGrades = { grade1x2: 'VOID', gradeOu25: 'VOID', gradeBtts: 'VOID' };
  if (result.status !== 'FINAL') {
    if (isVoidStatus(result.status)) return voidAll;
    // Statut non définitif : l'appelant ne doit pas demander de note.
    return voidAll;
  }
  const hs = result.homeScore;
  const as = result.awayScore;
  if (hs == null || as == null) return voidAll;

  const actual1x2 = hs > as ? '1' : hs === as ? 'X' : '2';
  // 1X2 par ID équipe (le pick1x2 encode déjà le côté, l'ID est redondant mais vérifié)
  const grade1x2: Grade = snap.pick1x2 === actual1x2 ? 'CORRECT' : 'INCORRECT';

  const totalGoals = hs + as;
  const overWins = snap.pickOu25 === 'OVER' ? totalGoals > 2.5 : totalGoals < 2.5;
  const gradeOu25: Grade = overWins ? 'CORRECT' : 'INCORRECT';

  const btts = hs > 0 && as > 0;
  const bttsWins = snap.pickBtts === 'YES' ? btts : !btts;
  const gradeBtts: Grade = bttsWins ? 'CORRECT' : 'INCORRECT';

  return { grade1x2, gradeOu25, gradeBtts };
}

/** Empreinte du résultat au moment du calcul — re-évaluation automatique si elle change. */
export function resultKeyOf(result: { status: string; homeScore: number | null; awayScore: number | null }): string {
  if (result.status === 'FINAL' && result.homeScore != null && result.awayScore != null) {
    return `FINAL:${result.homeScore}-${result.awayScore}`;
  }
  return `${result.status}`;
}
