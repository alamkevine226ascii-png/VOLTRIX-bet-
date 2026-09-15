// ============================================================
// VOLTRIX bet — API /api/forecasts/tick
// POST : exécute UN cycle du job automatique (scan → prédictions
// figées → résultats → évaluations) et renvoie ses statistiques.
// Appelé par l'UI (bouton + ping automatique) et par le test E2E.
// ============================================================

import { NextResponse } from 'next/server';
import { runForecastTick, ensureForecastLoop } from '@/lib/forecast/job';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST() {
  ensureForecastLoop();
  const stats = await runForecastTick({ timeBudgetMs: 90_000 });
  return NextResponse.json({ ok: stats.errors.length === 0, stats });
}

export async function GET() {
  // Variante légère : même logique, utilisée par le ping de l'UI.
  return POST();
}
