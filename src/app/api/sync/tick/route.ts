// ============================================================
// VOLTRIX bet — Task 28 : API /api/sync/tick
// Exécute un cycle de synchronisation ESPN → Neon à la demande
// (également utilisé par les tests E2E et le seed).
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { ensureSyncLoop, runSyncTick } from '@/lib/sync/sync-job';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

async function handle(req: NextRequest) {
  // Task 35 — NEUTRALISATION SOUS VERCEL : un cycle de synchronisation
  // écrit dans Neon (rôle EXCLUSIF du worker permanent, architecture
  // hybride Task 31). Sous Vercel, cette route ne doit JAMAIS
  // s'exécuter — double écriture potentielle avec le worker + temps
  // serverless facturé pour rien. La boucle paresseuse est de toute
  // façon déjà neutralisée par la garde VERCEL de ensureSyncLoop().
  if (process.env.VERCEL === '1') {
    return NextResponse.json(
      {
        ok: false,
        error: 'Route worker désactivée sur Vercel — la synchronisation ESPN → Neon est assurée par le worker permanent.',
      },
      { status: 403 }
    );
  }
  ensureSyncLoop(); // boucle périodique paresseuse (idempotent)
  const daysBack = parseInt(req.nextUrl.searchParams.get('daysBack') ?? '', 10);
  const daysAhead = parseInt(req.nextUrl.searchParams.get('daysAhead') ?? '', 10);
  const phase = req.nextUrl.searchParams.get('phase') ?? undefined;
  const stats = await runSyncTick({
    daysBack: Number.isFinite(daysBack) && daysBack >= 0 && daysBack <= 30 ? daysBack : undefined,
    daysAhead: Number.isFinite(daysAhead) && daysAhead >= 1 && daysAhead <= 14 ? daysAhead : undefined,
    phase: phase && /^[a-z-]{1,24}$/.test(phase) ? phase : 'cycle',
  });
  return NextResponse.json({ ok: true, stats });
}

export async function POST(req: NextRequest) {
  return handle(req);
}

export async function GET(req: NextRequest) {
  return handle(req);
}
