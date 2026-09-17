'use client';

// ============================================================
// VOLTRIX bet — Task 48 : bouton « Installer VOLTRIX » (PWA)
//
// Rend l'application installable comme une vraie app mobile,
// SANS deuxième frontend : l'app installée est le même VOLTRIX
// (même URL, même build Vercel) ouvert en mode standalone
// (sans la barre du navigateur) grâce au manifest + service
// worker déjà en place.
//
// Comportement par plateforme :
//   - Android/Chromium : mécanisme natif PWA (événement
//     'beforeinstallprompt' capturé → prompt() d'installation) ;
//   - iOS/iPadOS Safari : pas d'installation automatique →
//     instructions adaptées « Ajouter à l'écran d'accueil » ;
//   - Navigateur sans support : instructions manuelles adaptées ;
//   - Déjà installée (display-mode: standalone ou navigator.standalone) :
//     état « Application installée » — le bouton ne propose plus rien.
//
// Aucune dépendance externe : API navigateur natives uniquement.
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Download, Share, Smartphone, X } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

type Platform = 'ios' | 'android' | 'desktop';

function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'desktop';
  const ua = navigator.userAgent;
  const isIOSLike =
    /iPhone|iPad|iPod/i.test(ua) ||
    (/Macintosh|MacIntel/i.test(ua) && (navigator.maxTouchPoints ?? 0) > 1); // iPadOS 13+
  if (isIOSLike) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return 'desktop';
}

export function PwaInstallButton() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);
  const [platform, setPlatform] = useState<Platform>('desktop');

  useEffect(() => {
    // Déjà installée ? (ouverte en standalone = sans UI navigateur)
    const standaloneMq = window.matchMedia('(display-mode: standalone)');
    const iOSStandalone = (navigator as unknown as { standalone?: boolean }).standalone === true;
    if (standaloneMq.matches || iOSStandalone) setInstalled(true);
    const onDisplayChange = (e: MediaQueryListEvent) => {
      if (e.matches) setInstalled(true);
    };
    standaloneMq.addEventListener?.('change', onDisplayChange);

    setPlatform(detectPlatform());

    const onBip = (e: Event) => {
      e.preventDefault(); // empêche le mini-infobar natif — on pilotage notre bouton
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
      setShowInstructions(false);
    };
    window.addEventListener('beforeinstallprompt', onBip);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      standaloneMq.removeEventListener?.('change', onDisplayChange);
      window.removeEventListener('beforeinstallprompt', onBip);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const onInstallClick = useCallback(async () => {
    if (deferred) {
      try {
        await deferred.prompt();
        const { outcome } = await deferred.userChoice;
        if (outcome === 'accepted') setInstalled(true);
      } catch {
        // prompt indisponible/échu → repli instructions
        setShowInstructions(true);
      }
      setDeferred(null);
      return;
    }
    setShowInstructions((v) => !v);
  }, [deferred]);

  // ---------- État « déjà installée » ----------
  if (installed) {
    return (
      <div
        className='flex items-center gap-2.5 rounded-3xl border border-[#3ddc84]/25 bg-[#3ddc84]/[0.06] p-4'
        data-testid='pwa-installed'
      >
        <CheckCircle2 size={17} className='shrink-0 text-[#3ddc84]' />
        <div>
          <div className='text-[14px] font-bold'>Application installée</div>
          <div className='text-[11px] text-muted-foreground'>
            VOLTRIX tourne déjà comme une application sur cet appareil — icône sur l'écran d'accueil, plein écran, sans navigateur.
          </div>
        </div>
      </div>
    );
  }

  const label =
    platform === 'ios' ? "Télécharger l'application" : deferred ? 'Installer VOLTRIX' : 'Ajouter à l\u2019écran d\u2019accueil';

  return (
    <div className='rounded-3xl border border-[#e8ff00]/20 bg-[#e8ff00]/[0.05] p-4' data-testid='pwa-install'>
      <button
        type='button'
        onClick={onInstallClick}
        className='flex w-full items-center justify-between text-left transition active:scale-[0.985]'
      >
        <div className='flex items-center gap-2.5'>
          <Smartphone size={17} className='shrink-0 text-[#e8ff00]' />
          <div>
            <div className='text-[14px] font-bold'>{label}</div>
            <div className='text-[11px] text-muted-foreground'>
              Installez VOLTRIX sur votre téléphone : icône sur l'écran d'accueil, ouverture plein écran, comme une vraie app.
            </div>
          </div>
        </div>
        <Download size={16} className='shrink-0 text-[#e8ff00]' />
      </button>

      {showInstructions && (
        <div className='mt-3 space-y-2 rounded-2xl bg-black/30 p-3 text-[12px] leading-relaxed text-muted-foreground'>
          <div className='flex items-center justify-between'>
            <span className='text-[11px] font-bold uppercase tracking-wide text-[#e8ff00]'>
              {platform === 'ios'
                ? 'Sur iPhone / iPad (Safari)'
                : platform === 'android'
                  ? 'Sur Android'
                  : 'Sur ordinateur'}
            </span>
            <button type='button' onClick={() => setShowInstructions(false)} aria-label='Fermer les instructions'>
              <X size={14} />
            </button>
          </div>
          {platform === 'ios' ? (
            <ol className='list-inside list-decimal space-y-1'>
              <li>
                Ouvrez <span className='font-semibold text-foreground'>voltrixbet.vercel.app</span> dans Safari.
              </li>
              <li>
                Touchez le bouton <span className='font-semibold text-foreground'>Partager</span>{' '}
                <Share size={11} className='inline -translate-y-px' /> (le carré avec la flèche vers le haut).
              </li>
              <li>
                Faites défiler puis choisissez{' '}
                <span className='font-semibold text-foreground'>« Sur l'écran d'accueil »</span>.
              </li>
              <li>
                Touchez <span className='font-semibold text-foreground'>« Ajouter »</span> — l'icône VOLTRIX apparaît sur
                votre écran d'accueil, l'app s'ouvre en plein écran.
              </li>
            </ol>
          ) : platform === 'android' ? (
            <ol className='list-inside list-decimal space-y-1'>
              <li>
                Ouvrez <span className='font-semibold text-foreground'>voltrixbet.vercel.app</span> dans Chrome.
              </li>
              <li>
                Touchez le menu <span className='font-semibold text-foreground'>⋮</span> en haut à droite.
              </li>
              <li>
                Choisissez{' '}
                <span className='font-semibold text-foreground'>« Installer l'application »</span> ou{' '}
                <span className='font-semibold text-foreground'>« Ajouter à l'écran d'accueil »</span>.
              </li>
              <li>Confirmez — VOLTRIX s'installe comme une app native.</li>
            </ol>
          ) : (
            <ol className='list-inside list-decimal space-y-1'>
              <li>
                Ouvrez <span className='font-semibold text-foreground'>voltrixbet.vercel.app</span> dans Chrome ou Edge.
              </li>
              <li>
                Cliquez sur l'icône <span className='font-semibold text-foreground'>d'installation</span> (⊕) à droite de
                la barre d'adresse.
              </li>
              <li>Confirmez — VOLTRIX s'ouvre dans sa propre fenêtre, sans le navigateur.</li>
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
