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
