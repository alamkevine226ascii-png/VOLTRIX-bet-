'use client';

// ============================================================
// VOLTRIX bet — Barre de navigation « Liquid Glass » (iOS 27)
// ============================================================
// Design inspiré d'iOS 27 : pilule flottante translucide
// détachée des bords (verre dépoli — fond sombre translucide,
// backdrop-blur, reflet interne, ombre douce profonde), bouton
// circulaire Profil détaché à droite, hors pilule.
// L'onglet actif est mis en valeur par une capsule plus claire
// qui GLISSE d'un onglet à l'autre (effet « liquid »), teintée
// du jaune-vert volt #e8ff00.
//
// Performance chargement (Task 11-c) : la capsule n'utilise plus
// framer-motion (layoutId) — la lib entière (framer-motion +
// motion-dom + motion-utils ≈ 814 Ko de JS dev, 74 % du plus gros
// chunk node_modules) était téléchargée puis exécutée sur CHAQUE
// page pour cette seule animation. Remplacée par UN <span>
// positionné en transform/width + transition CSS (courbe à léger
// overshoot ≈ spring 520/42) : rendu identique, 0 Ko de JS.
//
// Performance (fluidité scroll) : le backdrop-filter d'un
// élément fixed est ré-échantillonné par le navigateur à
// CHAQUE frame de scroll — le verre utilise donc un blur
// modéré (lg = 16px) compensé par un fond plus opaque, et les
// surfaces de verre sont promues en couches GPU (.gpu-layer).
// Les transitions sont restreintes aux propriétés bon marché
// (couleurs + transform) et la capsule ne s'anime pas si
// l'utilisateur demande reduced-motion (media query CSS).
// Deux modes :
//  - contrôlé (onTabChange fourni, page accueil) : Accueil,
//    Ligues et Profil deviennent des <button> (onglets
//    internes), Portefeuille reste un <Link> ;
//  - autonome (pages /vente, /precision et /previsions) :
//    tout est <Link>, l'onglet actif est déduit de usePathname().
// ============================================================

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { Banknote, CalendarDays, Trophy, User, Zap, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export type TabKey = 'home' | 'leagues' | 'forecasts' | 'sell' | 'precision' | 'profile';

type TabDef = {
  key: TabKey;
  href: string;
  label: string;
  Icon: LucideIcon;
};

// useLayoutEffect n'existe pas côté serveur (rendu SSR de ce
// composant client) : variante isomorphe sans warning.
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

// ---------- Données des onglets ----------

// Onglets de la pilule principale (ordre fixe)
// NB : « Précision » retiré de la pilule (surcharge) — la page
// /precision reste accessible via le lien dans l'onglet Profil.
const PILL_TABS: TabDef[] = [
  { key: 'home', href: '/', label: 'Accueil', Icon: Zap },
  { key: 'leagues', href: '/?tab=leagues', label: 'Ligues', Icon: Trophy },
  { key: 'forecasts', href: '/previsions', label: 'Prévisions', Icon: CalendarDays },
  { key: 'sell', href: '/vente', label: 'Vente', Icon: Banknote },
];

// Bouton Profil détaché à droite (hors pilule)
const PROFILE_TAB: TabDef = { key: 'profile', href: '/?tab=profile', label: 'Profil', Icon: User };

// ---------- Verre dépoli commun (pilule + bouton détaché) ----------

// Opt. perf : backdrop-blur-lg (16px, noyau ~6× moins cher que
// 2xl = 40px) compensé par un fond quasi opaque #0a0a0a/75 — la
// lisibilité et le rendu « glass » tiennent désormais au fond,
// pas au flou. gpu-layer = promotion de couche (compositing),
// posée sur les surfaces de verre elles-mêmes (JAMAIS sur un
// ancêtre d'un backdrop-filter : risque de casser le flou).
const GLASS =
  'gpu-layer border border-white/[0.08] bg-[#0a0a0a]/75 backdrop-blur-lg shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_14px_44px_rgba(0,0,0,0.6)]';

// Capsule de l'onglet actif (identique animée / réduite-motion).
// UN seul élément pour toute la pilule (au lieu d'un par item
// via layoutId) : positionné en JS (offsetLeft/offsetWidth de
// l'item actif), glisse via .volt-capsule (CSS, transform/width).
const CAPSULE =
  'volt-capsule absolute inset-y-0 left-0 rounded-[20px] bg-white/[0.12] shadow-[inset_0_1px_0_rgba(255,255,255,0.07),0_0_20px_rgba(232,255,0,0.08)] will-change-transform';

// ============================================================
// VoltrixTabBar
// ============================================================

export function VoltrixTabBar({
  active,
  onTabChange,
}: {
  active?: TabKey;
  onTabChange?: (k: TabKey) => void;
}) {
  const pathname = usePathname();
  const controlled = typeof onTabChange === 'function';

  // Onglet actif : prop (mode contrôlé) ou déduit du chemin (mode autonome)
  const activeKey: TabKey =
    active ??
    (pathname === '/vente'
      ? 'sell'
      : pathname === '/precision'
        ? 'precision'
        : pathname === '/previsions'
          ? 'forecasts'
          : 'home');

  // ---------- Capsule glissante (CSS transform, 0 JS d'animation) ----------

  const pillRef = useRef<HTMLDivElement>(null);
  const capsuleRef = useRef<HTMLSpanElement>(null);
  const itemRefs = useRef<Array<HTMLElement | null>>([]);
  const firstPositionRef = useRef(true);

  // Positionne la capsule sur l'item actif. Appelé AVANT peinture
  // (layout effect) : jamais de flash en mauvaise position.
  const positionCapsule = useCallback(() => {
    const capsule = capsuleRef.current;
    if (!capsule) return;
    const idx = PILL_TABS.findIndex((t) => t.key === activeKey);
    const item = idx >= 0 ? itemRefs.current[idx] : null;
    if (!item) {
      capsule.style.opacity = '0';
      return;
    }
    capsule.style.width = `${item.offsetWidth}px`;
    // translate3d = compositing (pas de layout) ; offsetLeft est
    // relatif au padding edge de l'ancêtre positionné — même
    // origine qu'un enfant absolute left:0.
    capsule.style.transform = `translate3d(${item.offsetLeft}px, 0, 0)`;
    capsule.style.opacity = '1';
  }, [activeKey]);

  useIsoLayoutEffect(() => {
    const capsule = capsuleRef.current;
    if (!capsule) return;
    if (firstPositionRef.current) {
      // Premier positionnement : SANS transition (apparaît à sa
      // place, comme le layoutId au montage), transition
      // réarmée pour les glissements suivants.
      capsule.style.transition = 'none';
      positionCapsule();
      void capsule.offsetWidth; // force le reflow pour appliquer sans animer
      capsule.style.transition = '';
      firstPositionRef.current = false;
    } else {
      positionCapsule();
    }
  }, [activeKey, positionCapsule]);

  // Repositionne sans glitch si la pilule change de taille
  // (rotation, resize) ou après chargement des fontes (les
  // largeurs d'items dépendent du texte en Space Grotesk).
  useEffect(() => {
    const pill = pillRef.current;
    if (!pill) return;
    const reposition = () => positionCapsule();
    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(reposition);
      ro.observe(pill);
    }
    document.fonts?.ready.then(reposition).catch(() => {});
    return () => ro?.disconnect();
  }, [positionCapsule]);

  // ---------- Item de la pilule ----------

  const renderPillItem = (tab: TabDef, index: number) => {
    const { Icon } = tab;
    const isActive = tab.key === activeKey;
    // Mode contrôlé : Accueil et Ligues sont des onglets internes (boutons),
    // Portefeuille reste une vraie navigation (lien).
    const asButton = controlled && (tab.key === 'home' || tab.key === 'leagues');
    // Transition ciblée (couleurs + transform) : jamais de
    // transition sur box-shadow / backdrop-filter / filter
    // (repaint très coûteux à chaque frame animée).
    const classes = cn(
      'relative flex flex-col items-center gap-[3px] whitespace-nowrap rounded-[20px] px-2.5 py-1.5 transition-[color,transform] active:scale-95',
      isActive ? 'text-[#e8ff00]' : 'text-white/55',
    );
    const setRef = (el: HTMLElement | null) => {
      itemRefs.current[index] = el;
    };
    const content = (
      <>
        <Icon size={19} className='relative z-10' />
        <span className='relative z-10 text-[9.5px] font-semibold leading-none'>{tab.label}</span>
      </>
    );
    if (asButton) {
      return (
        <button
          key={tab.key}
          ref={setRef}
          type='button'
          onClick={() => onTabChange?.(tab.key)}
          className={classes}
          aria-label={tab.label}
          aria-current={isActive ? 'page' : undefined}
        >
          {content}
        </button>
      );
    }
    return (
      <Link
        key={tab.key}
        ref={setRef}
        href={tab.href}
        className={classes}
        aria-label={tab.label}
        aria-current={isActive ? 'page' : undefined}
      >
        {content}
      </Link>
    );
  };

  // ---------- Bouton Profil détaché ----------

  const renderProfile = () => {
    const { Icon } = PROFILE_TAB;
    const isActive = PROFILE_TAB.key === activeKey;
    const classes = cn(
      GLASS,
      'flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full transition-[color,background-color,border-color,transform] active:scale-95',
      isActive ? 'border-[#e8ff00]/30 bg-[#e8ff00]/[0.14] text-[#e8ff00]' : 'text-white/55',
    );
    if (controlled) {
      return (
        <button
          type='button'
          onClick={() => onTabChange?.('profile')}
          className={classes}
          aria-label={PROFILE_TAB.label}
          aria-current={isActive ? 'page' : undefined}
        >
          <Icon size={20} />
        </button>
      );
    }
    return (
      <Link
        href={PROFILE_TAB.href}
        className={classes}
        aria-label={PROFILE_TAB.label}
        aria-current={isActive ? 'page' : undefined}
      >
        <Icon size={20} />
      </Link>
    );
  };

  // ---------- Structure ----------

  return (
    <nav className='pb-safe fixed inset-x-0 bottom-0 z-50' aria-label='Navigation principale'>
      <div className='mx-auto flex max-w-[472px] items-center gap-2.5 px-4'>
        {/* Pilule principale — 4 onglets (Précision retirée, voir PILL_TABS) */}
        <div
          ref={pillRef}
          className={cn(
            GLASS,
            'relative flex flex-1 items-center justify-between gap-0.5 rounded-[26px] p-1.5',
          )}
        >
          {/* Capsule de l'onglet actif — un seul élément pour toute la
              pilule, glisse en transform/width (CSS .volt-capsule).
              opacity-0 initial : positionnée avant la 1re peinture par
              le layout effect (aucun flash, aucun saut). */}
          <span ref={capsuleRef} className={CAPSULE} style={{ opacity: 0 }} aria-hidden='true' />
          {PILL_TABS.map(renderPillItem)}
        </div>
        {/* Bouton Profil détaché */}
        {renderProfile()}
      </div>
    </nav>
  );
}
