'use client';

// ============================================================
// VOLTRIX bet — Composants UI partagés
// ============================================================

import { memo, useState } from 'react';
import { Star, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';

// ---------- Barre de probabilité ----------

export function ProbBar({
  label,
  value,
  highlight = false,
  sublabel,
  color = 'volt',
}: {
  label: string;
  value: number; // 0..1
  highlight?: boolean;
  sublabel?: string;
  color?: 'volt' | 'gray' | 'green' | 'red';
}) {
  const pct = Math.round(value * 100);
  const fill =
    color === 'volt'
      ? 'bg-[#e8ff00]'
      : color === 'green'
        ? 'bg-[#a3e635]'
        : color === 'red'
          ? 'bg-[#ff4d5e]'
          : 'bg-white/25';
  return (
    <div className='w-full'>
      <div className='mb-1 flex items-baseline justify-between gap-2'>
        <span className={cn('text-[13px] leading-tight', highlight ? 'font-semibold text-foreground' : 'text-muted-foreground')}>
          {label}
        </span>
        <span className={cn('text-[13px] font-semibold tabular-nums', highlight ? 'text-[#e8ff00]' : 'text-foreground/70')}>
          {pct}%
        </span>
      </div>
      <div className='h-[7px] w-full overflow-hidden rounded-full bg-white/[0.07]'>
        <div
          className={cn('volt-bar h-full rounded-full', fill, !highlight && 'opacity-60')}
          style={{ width: `${Math.max(pct, 2)}%` }}
        />
      </div>
      {sublabel ? <div className='mt-1 text-[11px] text-muted-foreground'>{sublabel}</div> : null}
    </div>
  );
}

// ---------- Étoiles de confiance ----------

export function ConfidenceStars({ level, size = 13 }: { level: number; size?: number }) {
  return (
    <span className='inline-flex items-center gap-[2px]' aria-label={`Confiance ${level}/5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          size={size}
          className={cn(i <= level ? 'fill-[#e8ff00] text-[#e8ff00]' : 'fill-white/10 text-white/10')}
        />
      ))}
    </span>
  );
}

// ---------- Points de forme (W/D/L) ----------

export function FormDots({ form, size = 7 }: { form: string | null; size?: number }) {
  if (!form) return null;
  const chars = form.split('').slice(-5);
  return (
    <span className='inline-flex items-center gap-[3px]'>
      {chars.map((c, i) => (
        <span
          key={i}
          className='inline-block rounded-full'
          style={{
            width: size,
            height: size,
            background: c === 'W' ? '#a3e635' : c === 'D' ? '#8a8a82' : '#ff4d5e',
          }}
          title={c === 'W' ? 'Victoire' : c === 'D' ? 'Nul' : 'Défaite'}
        />
      ))}
    </span>
  );
}

// ---------- Badge statut match ----------

export function StatusBadge({
  status,
  statusDetail,
  timeLabel,
}: {
  status: 'pre' | 'in' | 'post';
  statusDetail: string;
  timeLabel: string;
}) {
  if (status === 'in') {
    return (
      <span className='inline-flex items-center gap-1.5 rounded-full bg-[#ff4d5e]/15 px-2.5 py-1 text-[11px] font-bold text-[#ff4d5e]'>
        <span className='volt-live-dot inline-block h-[6px] w-[6px] rounded-full bg-[#ff4d5e]' />
        LIVE
      </span>
    );
  }
  if (status === 'post') {
    return (
      <span className='rounded-full bg-white/[0.07] px-2.5 py-1 text-[11px] font-semibold text-muted-foreground'>
        TERMINÉ
      </span>
    );
  }
  return (
    <span className='rounded-full bg-[#e8ff00]/10 px-2.5 py-1 text-[11px] font-bold text-[#e8ff00]'>{timeLabel}</span>
  );
}

// ---------- Badge VALUE BET ----------

// Deux usages :
//  - `edge` (fiche match) : edge RÉEL du value bet calculé par le moteur.
//  - `count` (carte d'accueil) : le QuickPred ne transporte pas les edges —
//    on affiche le NOMBRE de value bets (jamais un pourcentage inventé :
//    l'ancien « 0.05 + 0.02 × n » affichait un faux edge incohérent avec la
//    fiche détaillée). Le pourcentage réel reste visible en ouvrant le match.
export function ValueBadge({ edge, count }: { edge?: number; count?: number }) {
  const label =
    typeof count === 'number'
      ? count > 1
        ? `VALUE ×${count}`
        : 'VALUE'
      : `VALUE +${Math.round((edge ?? 0) * 100)}%`;
  return (
    <span className='inline-flex items-center gap-1 rounded-full border border-[#e8ff00]/40 bg-[#e8ff00]/10 px-2 py-[3px] text-[10px] font-bold tracking-wide text-[#e8ff00]'>
      <Zap size={10} className='fill-[#e8ff00]' />
      {label}
    </span>
  );
}

// ---------- Logo équipe (écusson avec repli initiales) ----------

// Mémoïsé : ~2×150 instances rendues à chaque passe d'analyse, props 100 % primitives
export const TeamLogo = memo(function TeamLogo({ src, alt, size = 26 }: { src: string | null; alt: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const showFallback = !src || failed;
  if (showFallback) {
    return (
      <span
        className='inline-flex shrink-0 items-center justify-center rounded-full bg-white/10 text-[10px] font-bold text-foreground/60'
        style={{ width: size, height: size, fontSize: Math.max(8, size * 0.36) }}
      >
        {alt.slice(0, 3).toUpperCase()}
      </span>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      width={size}
      height={size}
      className='shrink-0 object-contain'
      style={{ width: size, height: size }}
      loading='lazy'
      decoding='async'
      onError={() => setFailed(true)}
    />
  );
});

// ---------- Badge marché ----------

export function MarketChip({ label, value }: { label: string; value: string }) {
  return (
    <div className='flex flex-col items-center rounded-2xl bg-white/[0.05] px-3 py-2'>
      <span className='text-[10px] font-medium uppercase tracking-wide text-muted-foreground'>{label}</span>
      <span className='mt-0.5 text-[13px] font-bold text-foreground'>{value}</span>
    </div>
  );
}

// ---------- Format helpers ----------

// Formatters Intl mis en cache au niveau module : `new Intl.DateTimeFormat` est coûteux à
// construire et l'était pour CHAQUE carte à CHAQUE render (~150 cartes × chaque lot d'analyse).
const TIME_FMT = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });
const DATE_LONG_FMT = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});

export function formatTime(iso: string): string {
  return TIME_FMT.format(new Date(iso));
}

export function formatDateLong(iso: string): string {
  return DATE_LONG_FMT.format(new Date(iso));
}

export function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}
