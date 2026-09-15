// ============================================================
// VOLTRIX bet — Grading des jambes (partagé)
// Note une sélection face à un événement ESPN : 1X2, Double
// Chance, O/U, BTTS → WIN / LOSE / VOID / PENDING.
// Source unique partagée par /api/bankroll/resolve (règlement)
// et /api/cashout (conseil de vente) — une seule vérité.
// ============================================================

import type { EspnEvent } from './espn';

export type LegStatus = 'WIN' | 'LOSE' | 'VOID' | 'PENDING';

// Task 21-a (FIX 4) : annulation/report/suspension → VOID.
// ESPN encode ces statuts via status.type.name (STATUS_POSTPONED, STATUS_CANCELED,
// STATUS_SUSPENDED, STATUS_DELAYED, STATUS_FORFEITED, STATUS_ABANDONED) dont le
// libellé arrive dans statusDetail (= status.type.detail ?? description côté
// espn.ts, qui n'expose pas `name`). Vocabulaire RÉEL vérifié sur scoreboard :
// "FT", "42'", "HT", "Sat, September 12th at 8:30 PM EDT" → aucun faux positif.
const VOID_STATUS_RE = /postpon|cancel|cancell|suspend|delay|abandon|forfeit/i;

/** Vrai si le libellé de statut ESPN indique un match annulé/reporté/suspendu/retardé/forfait. */
export function isVoidStatusDetail(statusDetail: string | null | undefined): boolean {
  return typeof statusDetail === 'string' && VOID_STATUS_RE.test(statusDetail);
}

export interface GradeLegInput {
  matchId: string;
  market: string;
  pick: string;
  /** Task 21-a (FIX 5) : ID équipe ESPN du côté piqué (1X2) — prioritaire sur la comparaison de noms.
   *  Absent/null pour les lignes anciennes → repli sur le nom (rétrocompatibilité). */
  pickedTeamId?: string | null;
}

/** Note une jambe hors 1X2 à partir du score final. null si marché/pick non reconnu. */
function gradeLeg(market: string, pick: string, hs: number, as: number): 'WIN' | 'LOSE' | 'VOID' | null {
  const actual = hs > as ? '1' : hs === as ? 'X' : '2';
  const totalGoals = hs + as;
  const btts = hs > 0 && as > 0;

  if (market === 'Double Chance') {
    if (pick.includes('(1X)')) return actual === '1' || actual === 'X' ? 'WIN' : 'LOSE';
    if (pick.includes('(12)')) return actual === '1' || actual === '2' ? 'WIN' : 'LOSE';
    if (pick.includes('(X2)')) return actual === 'X' || actual === '2' ? 'WIN' : 'LOSE';
    return null;
  }

  if (market.startsWith('O/U')) {
    const line = parseFloat(market.slice(3));
    if (!Number.isFinite(line)) return null;
    const isOver = pick.startsWith('Plus de');
    const isUnder = pick.startsWith('Moins de');
    if (!isOver && !isUnder) return null;
    const outcome = isOver ? totalGoals > line : totalGoals < line;
    return outcome ? 'WIN' : 'LOSE';
  }

  if (market === 'BTTS') {
    if (pick.endsWith(': Oui')) return btts ? 'WIN' : 'LOSE';
    if (pick.endsWith(': Non')) return !btts ? 'WIN' : 'LOSE';
    return null;
  }

  return null;
}

export interface LegVerdict {
  matchId: string;
  market: string;
  pick: string;
  status: LegStatus;
  score: string | null;
}

/** Verdict complet d'une jambe face à un événement ESPN trouvé sur le scoreboard. */
export function gradeEvent(leg: GradeLegInput, ev: EspnEvent): LegVerdict {
  const base = { matchId: leg.matchId, market: leg.market, pick: leg.pick };
  // Task 21-a (FIX 4) : match annulé/reporté/suspendu → VOID (jambe remboursée),
  // AVANT le test completed/score — ces événements ne seront jamais "completed".
  if (isVoidStatusDetail(ev.statusDetail)) {
    return { ...base, status: 'VOID', score: null };
  }
  const hs = ev.home?.score;
  const as = ev.away?.score;
  if (!ev.completed || hs == null || as == null) {
    // non terminé (statuts finaux FT / AET / PEN mettent tous completed=true)
    return { ...base, status: 'PENDING', score: null };
  }

  let status: LegVerdict['status'];
  if (leg.market === '1X2') {
    // "Victoire {homeName}" → 1 · "Victoire {awayName}" → 2 · "Match nul" → X
    // Le côté est identifié par comparaison des noms (le pick est construit depuis ESPN)
    if (leg.pick === 'Match nul') {
      status = hs === as ? 'WIN' : 'LOSE';
    } else if (leg.pick.startsWith('Victoire ')) {
      const pickedName = leg.pick.slice('Victoire '.length);
      const evHomeName = ev.home?.team?.displayName ?? '';
      const evAwayName = ev.away?.team?.displayName ?? '';
      const homeId = ev.home?.team?.id ?? '';
      const awayId = ev.away?.team?.id ?? '';
      let isHome: boolean;
      let isAway: boolean;
      if (leg.pickedTeamId && homeId && awayId && (leg.pickedTeamId === homeId || leg.pickedTeamId === awayId)) {
        // Task 21-a (FIX 5) : résolution par ID ESPN — fiable même si les libellés
        // ESPN changent (raisons éditoriales) ou se ressemblent (includes() fragile).
        isHome = leg.pickedTeamId === homeId;
        isAway = !isHome;
      } else {
        // Repli (lignes existantes sans pickedTeamId) : comparaison de noms.
        isHome = pickedName === evHomeName || evHomeName.includes(pickedName) || pickedName.includes(evHomeName);
        isAway = !isHome && (pickedName === evAwayName || evAwayName.includes(pickedName) || pickedName.includes(evAwayName));
      }
      const actual = hs > as ? '1' : hs === as ? 'X' : '2';
      if (!isHome && !isAway) {
        status = 'PENDING'; // nom non reconnu : on ne devine pas
      } else {
        status = (isHome && actual === '1') || (isAway && actual === '2') ? 'WIN' : 'LOSE';
      }
    } else {
      status = 'PENDING';
    }
  } else {
    status = gradeLeg(leg.market, leg.pick, hs, as) ?? 'PENDING';
  }

  return { ...base, status, score: `${hs} - ${as}` };
}
