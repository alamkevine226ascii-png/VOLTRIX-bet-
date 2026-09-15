// ============================================================
// VOLTRIX bet — Task 28 §7 : HISTORIQUE H2H DEPUIS LA BASE NEON
//
// BUG CORRIGÉ :
//  - l'ancien calcul scannait UNIQUEMENT le calendrier de l'équipe
//    domicile → les confrontations « équipe B à domicile » passaient
//    à la trappe ;
//  - l'orientation du vainqueur était inversée pour les matchs où
//    l'équipe A jouait à l'extérieur.
//
// DÉSORMAIS : la base est la source (§7 « très important »). La
// recherche est SYMÉTRIQUE :
//    Équipe A vs Équipe B   ET   Équipe B vs Équipe A
// Les statistiques sont comptées PAR ID ÉQUIPE (robuste aux renommages),
// jamais par position domicile/extérieur du match historique.
// ============================================================

import { db } from '@/lib/db';

export interface H2HMatch {
  date: string; // ISO — date du match historique
  homeTeam: string; // équipe DOMICILE de ce match historique
  awayTeam: string; // équipe EXTÉRIEURE de ce match historique
  score: string; // "2-1" toujours du point de vue domicile → extérieur
  winner: 'home' | 'away' | 'draw'; // relatif au match historique
}

export interface H2HSummary {
  homeWins: number; // victoires de l'équipe A (domicile du match consulté)
  draws: number;
  awayWins: number; // victoires de l'équipe B
  total: number;
}

export interface H2HResult {
  matches: H2HMatch[];
  summary: H2HSummary;
  source: 'DB' | 'NONE';
}

/**
 * Confrontations A vs B depuis la base — les DEUX ordres, symétriques.
 * Seuls les matchs TERMINÉS (FINAL, scores présents) comptent.
 */
export async function getH2HFromDb(
  homeId: string,
  awayId: string,
  limit = 10
): Promise<H2HResult> {
  if (!homeId || !awayId || homeId === awayId) {
    return { matches: [], summary: { homeWins: 0, draws: 0, awayWins: 0, total: 0 }, source: 'NONE' };
  }

  const rows = await db.match.findMany({
    where: {
      status: 'FINAL',
      homeScore: { not: null },
      awayScore: { not: null },
      OR: [
        { homeTeamId: homeId, awayTeamId: awayId }, // A à domicile
        { homeTeamId: awayId, awayTeamId: homeId }, // §7 : B à domicile — l'ordre inverse doit aussi être retrouvé
      ],
    },
    orderBy: { kickoffAt: 'desc' },
    take: Math.max(1, Math.min(limit, 50)),
  });

  const matches: H2HMatch[] = rows.map((m) => {
    const hs = m.homeScore ?? 0;
    const as = m.awayScore ?? 0;
    return {
      date: m.kickoffAt.toISOString(),
      homeTeam: m.homeTeamName,
      awayTeam: m.awayTeamName,
      score: `${hs}-${as}`,
      winner: hs > as ? 'home' : hs < as ? 'away' : 'draw',
    };
  });

  // Comptage PAR ID ÉQUIPE (pas par nom, pas par terrain) :
  // homeWins = victoires de l'équipe A (celle qui est à domicile dans
  // le match consulté), où qu'elle ait joué.
  let homeWins = 0;
  let draws = 0;
  let awayWins = 0;
  for (const m of rows) {
    const hs = m.homeScore ?? 0;
    const as = m.awayScore ?? 0;
    if (hs === as) {
      draws++;
    } else {
      const winnerId = hs > as ? m.homeTeamId : m.awayTeamId;
      if (winnerId === homeId) homeWins++;
      else if (winnerId === awayId) awayWins++;
    }
  }

  return { matches, summary: { homeWins, draws, awayWins, total: matches.length }, source: 'DB' };
}
