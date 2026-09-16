// ============================================================
// VOLTRIX bet — Task 45 §26 : API GET /api/sync/state
//
// État de fraîcheur de la synchronisation pour le frontend :
//   - données fraîches (< 10 min)   → aucun bouton
//   - données > 10 min              → bouton « Actualiser les données »
//   - synchronisation en cours      → bouton désactivé « Mise à jour en cours »
//   - synchronisation terminée      → refresh des données affichées
//
// Lecture LÉGÈRE (SyncJobRun + compteur de matchs LIVE) — aucune boucle
// démarrée (pas d'ensureSyncLoop), aucun appel ESPN, aucune écriture.
// ============================================================

import { NextResponse } from 'next/server';
import { getSyncState } from '@/lib/sync/wake';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const state = await getSyncState();
    return NextResponse.json({ ok: true, ...state });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Erreur base de données' },
      { status: 500 }
    );
  }
}
