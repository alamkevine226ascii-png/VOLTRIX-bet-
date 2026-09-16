'use client';

// ============================================================
// VOLTRIX bet — Task 45 §26 : BOUTON « ACTUALISER LES DONNÉES »
// (synchronisation Wake on Demand)
//
// Cycle de vie (cahier des charges §26 n°8) :
//   - données fraîches (< 10 min)      → AUCUN bouton (rendu null)
//   - données > 10 min (ou LIVE périmé)→ bouton « Actualiser les données »
//   - synchronisation en cours         → bouton désactivé « Mise à jour en cours »
//                                        (auto-déclenchée ici OU par un autre
//                                        utilisateur — l'état vient de Neon)
//   - synchronisation terminée         → événement window 'voltrix:sync-done'
//                                        + router.refresh() → les pages
//                                        rechargent leurs données fraîches.
//
// Reprise transparente : si une invocation revient partiellement
// (budget temps serverless), le bouton re-POST automatiquement —
// chaque invocation reprend le curseur conservé dans Neon.
//
// Montage GLOBAL (layout.tsx) : toute page de VOLTRIX bénéficie de la
// vérification. Polling léger : 60 s au repos, 4 s pendant une sync,
// + vérification immédiate au retour d'onglet (visibilitychange).
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Événement diffusé quand une synchronisation vient de réussir. */
export const VOLTRIX_SYNC_DONE_EVENT = 'voltrix:sync-done';

interface SyncStateResponse {
  ok: boolean;
  running: { id: string; startedAt: string; triggerSource: string | null } | null;
  suggestedAction: 'none' | 'wake';
}

type Mode = 'loading' | 'fresh' | 'ready' | 'running';

const IDLE_POLL_MS = 60_000;
const READY_POLL_MS = 30_000;
const RUNNING_POLL_MS = 4_000;
/** Plafond de reprises automatiques (budgets successifs). */
const MAX_RESUMES = 8;

export function SyncWakeButton() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('loading');
  const [busy, setBusy] = useState(false); // POST /wake en cours dans CE navigateur
  const mountedRef = useRef(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const modeRef = useRef<Mode>('loading');
  const wakeLoopsRef = useRef(0);
  const wasRunningRef = useRef(false);
  const refreshRef = useRef<() => Promise<void>>(async () => {});

  const scheduleNext = useCallback((ms: number) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      refreshRef.current();
    }, ms);
  }, []);

  const refreshState = useCallback(async () => {
    if (!mountedRef.current) return;
    try {
      const res = await fetch('/api/sync/state', { cache: 'no-store' });
      const json: SyncStateResponse = await res.json();
      if (!mountedRef.current || !json?.ok) return;
      if (json.running) {
        wasRunningRef.current = true;
        setMode('running');
      } else if (wasRunningRef.current) {
        // La synchronisation (peut-être déclenchée par un autre utilisateur)
        // vient de se terminer → rafraîchir les données affichées partout.
        wasRunningRef.current = false;
        window.dispatchEvent(new CustomEvent(VOLTRIX_SYNC_DONE_EVENT));
        router.refresh();
        setMode(json.suggestedAction === 'wake' ? 'ready' : 'fresh');
      } else {
        setMode(json.suggestedAction === 'wake' ? 'ready' : 'fresh');
      }
    } catch {
      // Réseau indisponible : rester dans l'état courant, retenter plus tard.
    } finally {
      if (mountedRef.current) {
        const next =
          modeRef.current === 'running' ? RUNNING_POLL_MS : modeRef.current === 'ready' ? READY_POLL_MS : IDLE_POLL_MS;
        scheduleNext(next);
      }
    }
  }, [router, scheduleNext]);

  refreshRef.current = refreshState;
  modeRef.current = mode;

  useEffect(() => {
    mountedRef.current = true;
    refreshRef.current();
    const onVisible = () => {
      if (document.visibilityState === 'visible') refreshRef.current();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  const handleWake = useCallback(async () => {
    if (busy || mode === 'running') return;
    setBusy(true);
    wakeLoopsRef.current = 0;
    try {
      // Boucle de reprise : chaque POST reprend le curseur conservé dans
      // Neon jusqu'à completion (ou échec / plafond de sécurité).
      for (;;) {
        wakeLoopsRef.current += 1;
        const res = await fetch('/api/sync/wake', { method: 'POST', cache: 'no-store' });
        const json = await res.json();
        if (!json?.ok) throw new Error(json?.error || 'HTTP KO');
        if (json.started === false) {
          // déjà lancé ailleurs (ou données redevenues fraîches) → suivre l'état
          wasRunningRef.current = json.reason === 'already_running';
          break;
        }
        if (json.status === 'partial') {
          if (wakeLoopsRef.current >= MAX_RESUMES) break; // plafond → l'état repartira au prochain poll/clic
          continue; // reprise immédiate là où l'invocation s'est arrêtée
        }
        if (json.status === 'failed') break; // échec enregistré → bouton réactivé au poll
        // success
        wasRunningRef.current = false;
        window.dispatchEvent(new CustomEvent(VOLTRIX_SYNC_DONE_EVENT));
        router.refresh();
        break;
      }
    } catch {
      // erreur réseau : le poll d'état réajustera le bouton
    } finally {
      if (mountedRef.current) {
        setBusy(false);
        refreshRef.current();
      }
    }
  }, [busy, mode, router]);

  if (mode === 'loading' || mode === 'fresh') return null;

  const running = mode === 'running' || busy;
  return (
    <div className={cn('fixed bottom-20 right-3 z-40', running && 'pointer-events-none')} role="status" aria-live="polite">
      <button
        type="button"
        onClick={handleWake}
        disabled={running}
        className={cn(
          'flex items-center gap-2 rounded-full border border-white/10 bg-zinc-900/90 px-4 py-2.5 text-xs font-medium text-zinc-100 shadow-lg backdrop-blur transition-all',
          'hover:border-white/20 hover:bg-zinc-800/90 active:scale-95',
          running && 'cursor-not-allowed opacity-80'
        )}
      >
        {running ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <RefreshCw size={14} aria-hidden />}
        {running ? 'Mise à jour en cours…' : 'Actualiser les données'}
      </button>
    </div>
  );
}
