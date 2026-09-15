// ============================================================
// VOLTRIX bet — API /api/match/[id]
// Analyse complète détaillée d'un match (page détail)
//
// Task 28 §7 : l'historique H2H affiché vient de la BASE Neon
// (les DEUX ordres domicile/extérieur, comptage par ID équipe).
// L'historique des deux équipes est synchronisé en arrière-plan
// (fire-and-forget, idempotent, 1×/6 h par équipe) ; si la base
// connaît au moins une confrontation, elle remplace le H2H moteur
// ESPN (dont le bug d'orientation est corrigé) — repli silencieux
// sinon. Ici c'est acceptable d'attendre Neon (~1 requête) : la
// passe d'analyse en lot de l'accueil n'utilise PAS cette route.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { analyzeMatch, currentSeasonYear, PREV_SEASON } from '@/lib/analyze';
import { getH2HFromDb } from '@/lib/sync/h2h';
import { syncTeamHistory } from '@/lib/sync/espn-sync';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const leagueCode = searchParams.get('league');
  const date = searchParams.get('date') || new Date().toISOString();

  if (!leagueCode) {
    return NextResponse.json({ error: 'Paramètre league manquant' }, { status: 400 });
  }

  const analysis = await analyzeMatch({ matchId: id, leagueCode, date });
  if (!analysis) {
    return NextResponse.json({ error: 'Match introuvable' }, { status: 404 });
  }

  // Task 28 §7 : H2H depuis la base (les deux ordres) — historique des
  // équipes alimenté en arrière-plan, lecture DB immédiate. Convention
  // saisons identique à analyze.ts ([PREV_SEASON, saison courante]).
  try {
    const homeId = analysis.home?.id;
    const awayId = analysis.away?.id;
    if (homeId && awayId) {
      const seasons = [PREV_SEASON, currentSeasonYear(date, leagueCode)].filter((s) => s > 0);
      void Promise.all([
        syncTeamHistory(leagueCode, homeId, analysis.home.name, seasons).catch(() => 0),
        syncTeamHistory(leagueCode, awayId, analysis.away.name, seasons).catch(() => 0),
      ]).catch(() => 0);
      const dbH2H = await getH2HFromDb(homeId, awayId, 6);
      if (dbH2H.matches.length > 0) {
        analysis.h2h = dbH2H.matches;
        analysis.h2hSummary = { ...dbH2H.summary };
      }
    }
  } catch {
    // repli silencieux : H2H moteur (ESPN) conservé
  }

  return NextResponse.json(analysis);
}
