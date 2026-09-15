// ============================================================
// VOLTRIX bet — Task 28 §4/§22 : STATUTS DES MATCHS
//
// Le statut ESPN est la source de vérité ; l'heure ne sert que de
// mécanisme de secours. Correction du bug « À VENIR » : un match
// terminé selon ESPN doit apparaître TERMINÉ même si la ligne
// MatchResult n'existe pas encore (secours sur espnState 'post'),
// et l'heure seule ne suffit jamais (report / suspension / retard).
//
// Module PUR (aucune IO) — partagé par l'API, l'UI et les tests.
// ============================================================

import { isVoidStatusDetail } from '../grade';

export type CanonicalStatus =
  | 'SCHEDULED'
  | 'LIVE'
  | 'HALFTIME'
  | 'FINAL'
  | 'POSTPONED'
  | 'CANCELLED'
  | 'SUSPENDED'
  | 'DELAYED'
  | 'UNKNOWN';

/** Statuts considérés comme définitifs (le résultat ne bougera plus). */
export function isDefinitiveStatus(status: string): boolean {
  return status === 'FINAL' || status === 'POSTPONED' || status === 'CANCELLED' || status === 'SUSPENDED';
}

/**
 * Statut effectif d'affichage — priorité (§4) :
 *  1. statut officiel synchronisé (MatchResult) si définitif ou live ;
 *  2. état ESPN brut (espnState 'post' → TERMINÉ, 'in' → EN DIRECT) ;
 *  3. secours temporel : kickoff dépassé de +3 h sans aucun signal →
 *     TERMINÉ (score en attente). JAMAIS si un libellé de
 *     report/annulation/suspension est présent (l'heure seule ment).
 */
export function effectiveStatus(input: {
  resultStatus?: string | null;
  espnState?: string | null; // 'pre' | 'in' | 'post'
  statusDetail?: string | null;
  kickoffMs?: number | null;
  nowMs: number;
}): CanonicalStatus {
  const voidish = isVoidStatusDetail(input.statusDetail);
  const rs = (input.resultStatus || '').toUpperCase();
  if (
    rs === 'FINAL' ||
    rs === 'LIVE' ||
    rs === 'HALFTIME' ||
    rs === 'POSTPONED' ||
    rs === 'CANCELLED' ||
    rs === 'CANCELED' ||
    rs === 'SUSPENDED'
  ) {
    return rs === 'CANCELED' ? 'CANCELLED' : rs;
  }

  // Ligne de résultat absente (ou SCHEDULED/UNKNOWN) → interroger l'état ESPN brut.
  if (input.espnState === 'in') return 'LIVE';
  if (input.espnState === 'post') {
    // ESPN classe 'post' les matchs terminés MAIS AUSSI les reportés/
    // annulés/suspendus (completed=false) — le libellé départage (§4 :
    // « l'heure seule ne suffit pas »).
    const d = input.statusDetail ?? '';
    if (/postpon/i.test(d)) return 'POSTPONED';
    if (/cancel/i.test(d)) return 'CANCELLED';
    if (/suspend|abandon|forfeit/i.test(d)) return 'SUSPENDED';
    return voidish ? 'POSTPONED' : 'FINAL';
  }

  // Secours temporel — uniquement sans signal ESPN de report/annulation.
  if (!voidish && input.kickoffMs && Number.isFinite(input.kickoffMs) && input.kickoffMs < input.nowMs - 3 * 3_600_000) {
    return 'FINAL';
  }
  return 'SCHEDULED';
}

/** Libellé français d'affichage pour un statut canonique. */
export function statusLabelFr(status: string): string {
  switch (status) {
    case 'FINAL':
      return 'TERMINÉ';
    case 'LIVE':
      return 'EN DIRECT';
    case 'HALFTIME':
      return 'MI-TEMPS';
    case 'POSTPONED':
      return 'REPORTÉ';
    case 'CANCELLED':
      return 'ANNULÉ';
    case 'SUSPENDED':
      return 'SUSPENDU';
    case 'DELAYED':
      return 'RETARDÉ';
    default:
      return 'À VENIR';
  }
}

/**
 * Statut canonique d'INGESTION (synchronisation ESPN → Match.status).
 * Plus fin que normalizeStatus (forecast/evaluate.ts, conservé tel quel)
 * : distingue HALFTIME et DELAYED. Les valeurs alimentent la colonne
 * Match.status (§4 : SCHEDULED/PRE/LIVE/HALFTIME/POST/FINAL/CANCELED/
 * POSTPONED/SUSPENDED/VOID adaptés aux statuts réellement renvoyés).
 */
export function ingestStatus(
  statusName: string,
  state: string | null | undefined,
  completed: boolean,
  statusDetail: string | null
): CanonicalStatus {
  const n = (statusName || '').toUpperCase();
  const d = statusDetail ?? '';
  if (n.includes('POSTPONED') || /postpon/i.test(d)) return 'POSTPONED';
  if (n.includes('CANCELED') || n.includes('CANCELLED') || /cancel/i.test(d)) return 'CANCELLED';
  if (n.includes('SUSPENDED') || /suspend/i.test(d)) return 'SUSPENDED';
  if (n.includes('DELAYED') || /delay/i.test(d)) return 'DELAYED';
  if (n.includes('ABANDONED') || n.includes('FORFEIT') || /abandon|forfeit/i.test(d)) return 'CANCELLED';
  if (n.includes('HALFTIME') || /\bHT\b/.test(d)) return 'HALFTIME';
  if (completed || n.includes('FINAL') || n.includes('FULL_TIME') || n.includes('FULL TIME')) return 'FINAL';
  if (state === 'in') return 'LIVE';
  if (state === 'post' && !isVoidStatusDetail(d)) return 'FINAL';
  if (state === 'pre') return 'SCHEDULED';
  return 'UNKNOWN';
}
