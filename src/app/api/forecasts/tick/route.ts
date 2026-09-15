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
  // Task 35 — NEUTRALISATION SOUS VERCEL (miroir de /api/sync/tick) :
  // le job de prévisions écrit dans Neon (snapshots figés, résultats,
  // évaluations) — rôle exclusif du worker permanent. Sur Vercel,
  // cette route répond 403 sans exécuter le tick (la boucle
  // paresseuse est de toute façon neutralisée par la garde VERCEL
  // de ensureForecastLoop()). Le ping 90 s de l'UI reçoit ce 403 :
  // il est déjà tolérant aux échecs.
  if (process.env.VERCEL === '1') {
    return NextResponse.json(
      {
        ok: false,
        error: 'Route worker désactivée sur Vercel — le job de prévisions est exécuté par le worker permanent.',
      },
      { status: 403 }
    );
  }
  ensureForecastLoop();
  const stats = await runForecastTick({ timeBudgetMs: 90_000 });
  return NextResponse.json({ ok: stats.errors.length === 0, stats });
}

export async function GET() {
  // Variante légère : même logique, utilisée par le ping de l'UI.
  return POST();
}
