'use client';

// ============================================================
// VOLTRIX bet — Carte de match (avec prono progressif)
// ============================================================

import { memo } from 'react';
import { AlertTriangle, ChevronRight, RefreshCw, Sparkles } from 'lucide-react';
import type { LightMatch, QuickPred } from '@/lib/types';
import { ConfidenceStars, FormDots, StatusBadge, TeamLogo, ValueBadge, formatTime } from './shared';

// onOpen/onRetry reçoivent le match en argument (au lieu d'une closure par carte côté parent)
// → les callbacks restent référentiellement stables et React.memo devient efficace :
// quand un lot de 6 analyses arrive, seules ces 6 cartes re-rendent (et non les ~150).
interface MatchCardProps {
  match: LightMatch;
  pred?: QuickPred;
  failed?: boolean;
  onOpen: (m: LightMatch) => void;
  onRetry?: (m: LightMatch) => void;
}

export const MatchCard = memo(function MatchCard({
  match,
  pred,
  failed = false,
  onRetry,
  onOpen,
}: MatchCardProps) {
  const isFinished = match.status === 'post';
  const isLive = match.status === 'in';

  const topRec = pred?.recommendedBets?.[0];
  const ou25 = pred?.overUnder?.find((o) => o.line === 2.5);
  const btts = pred?.btts;

  return (
    <div
      role='button'
      tabIndex={0}
      onClick={() => onOpen(match)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen(match);
        }
      }}
      // cv-auto-card (Task 11-c) : 162 cartes de ~221-303 px — les
      // cartes hors écran ne sont ni mises en page ni peintes
      // (content-visibility: auto). Le longtask d'hydratation du
      // rendu des 162 cartes chute d'autant, et le scroll peint
      // uniquement les cartes entrantes. Mesuré : estimation de
      // hauteur 304px (médiane) retenue dans globals.css.
      className='cv-auto-card w-full cursor-pointer rounded-3xl border border-white/[0.06] bg-[#141418] p-4 text-left transition-[border-color,background-color,transform] active:scale-[0.985] hover:border-[#e8ff00]/25 hover:bg-[#17171d]'
      aria-label={`Détails ${match.home.name} contre ${match.away.name}`}
    >
      {/* Ligne ligue + heure */}
      <div className='mb-3 flex items-center justify-between gap-2'>
        <div className='flex min-w-0 items-center gap-2'>
          <span className='rounded-lg bg-[#e8ff00]/10 px-2 py-[3px] text-[10px] font-bold tracking-wide text-[#e8ff00]'>
            {match.leagueShort}
          </span>
          <span className='truncate text-[12px] text-muted-foreground'>{match.leagueName}</span>
        </div>
        <StatusBadge status={match.status} statusDetail={match.statusDetail} timeLabel={formatTime(match.date)} />
      </div>

      {/* Équipes */}
      <div className='flex items-center justify-between gap-2'>
        <div className='flex min-w-0 flex-1 flex-col gap-2'>
          <div className='flex items-center gap-2.5'>
            <TeamLogo src={match.home.logo} alt={match.home.name} />
            <span className='min-w-0 flex-1 truncate text-[14px] font-semibold leading-tight'>{match.home.name}</span>
            {match.home.score !== null && match.status !== 'pre' && (
              <span className={`text-[16px] font-bold tabular-nums ${isLive ? 'text-[#e8ff00]' : ''}`}>{match.home.score}</span>
            )}
          </div>
          <div className='flex items-center gap-2.5'>
            <TeamLogo src={match.away.logo} alt={match.away.name} />
            <span className='min-w-0 flex-1 truncate text-[14px] font-semibold leading-tight'>{match.away.name}</span>
            {match.away.score !== null && match.status !== 'pre' && (
              <span className={`text-[16px] font-bold tabular-nums ${isLive ? 'text-[#e8ff00]' : ''}`}>{match.away.score}</span>
            )}
          </div>
        </div>
        <ChevronRight size={18} className='shrink-0 text-white/25' />
      </div>

      {/* Formes (si dispo depuis ESPN) */}
      {(match.home.form || match.away.form) && (
        <div className='mt-2.5 flex items-center gap-4'>
          <div className='flex items-center gap-1.5'>
            <span className='w-6 text-[10px] uppercase text-muted-foreground'>Forme</span>
            <FormDots form={match.home.form} />
          </div>
          <FormDots form={match.away.form} />
        </div>
      )}

      {/* Zone prono */}
      {!pred ? (
        isFinished ? (
          <div className='mt-3 rounded-2xl bg-black/30 px-3 py-2.5 text-center text-[12px] text-muted-foreground'>
            Match terminé — ouvre le détail pour comparer le modèle au résultat réel
          </div>
        ) : failed ? (
          <div className='mt-3 flex items-center justify-between gap-2 rounded-2xl bg-[#ff4d5e]/[0.08] px-3 py-2.5'>
            <span className='flex min-w-0 items-center gap-2 text-[12px] text-[#ff9aa2]'>
              <AlertTriangle size={13} className='shrink-0 text-[#ff4d5e]' />
              Analyse indisponible (ESPN surchargé)
            </span>
            {onRetry && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onRetry(match);
                }}
                className='flex shrink-0 items-center gap-1.5 rounded-xl bg-white/[0.08] px-3 py-1.5 text-[12px] font-bold text-foreground transition-[color,background-color,transform] active:scale-95'
              >
                <RefreshCw size={12} />
                Réessayer
              </button>
            )}
          </div>
        ) : (
          <div className='mt-3 space-y-2'>
            <div className='volt-skeleton h-4 w-3/4 rounded-lg' />
            <div className='volt-skeleton h-4 w-1/2 rounded-lg' />
          </div>
        )
      ) : (
        <div className='mt-3 rounded-2xl bg-black/30 p-3'>
          {topRec && (
            <div className='flex items-center justify-between gap-2'>
              <div className='flex min-w-0 items-center gap-2'>
                <Sparkles size={13} className='shrink-0 text-[#e8ff00]' />
                <span className='min-w-0 truncate text-[13px]'>
                  <span className='text-muted-foreground'>Prono : </span>
                  <span className='font-bold text-foreground'>{topRec.pick}</span>
                  <span className='text-[#e8ff00]'> · {Math.round(topRec.prob * 100)}%</span>
                </span>
              </div>
              <ConfidenceStars level={pred.confidence} size={11} />
            </div>
          )}

          <div className='mt-2.5 flex flex-wrap items-center gap-1.5'>
            {ou25 && (
              <span className='rounded-full bg-white/[0.06] px-2.5 py-1 text-[11px] text-foreground/80'>
                {ou25.over >= ou25.under ? 'Plus' : 'Moins'} de 2.5 :{' '}
                <span className='font-bold text-[#e8ff00]'>{Math.round(Math.max(ou25.over, ou25.under) * 100)}%</span>
              </span>
            )}
            {btts && (
              <span className='rounded-full bg-white/[0.06] px-2.5 py-1 text-[11px] text-foreground/80'>
                BTTS {btts.yes >= btts.no ? 'Oui' : 'Non'} :{' '}
                <span className='font-bold text-[#e8ff00]'>{Math.round(Math.max(btts.yes, btts.no) * 100)}%</span>
              </span>
            )}
            {/* Badge honnête : NOMBRE de value bets (les edges réels, absents du
                QuickPred, restent dans la fiche détaillée) — plus de faux « +N % »
                fabriqué qui contredisait l'onglet Cotes du détail. */}
            {pred.valueBetsCount > 0 && <ValueBadge count={pred.valueBetsCount} />}
          </div>
        </div>
      )}

      {/* Cotes bookmaker (petites, en bas) */}
      {match.hasOdds && match.mlHome !== null && !isFinished && (
        <div className='mt-2.5 flex items-center gap-1.5 text-[11px] text-muted-foreground'>
          <span className='uppercase tracking-wide'>{match.oddsProvider}</span>
          <span className='ml-auto flex gap-1.5 font-semibold tabular-nums text-foreground/70'>
            <span className='rounded-md bg-white/[0.06] px-1.5 py-[1px]'>{match.mlHome.toFixed(2)}</span>
            {match.mlDraw !== null && <span className='rounded-md bg-white/[0.06] px-1.5 py-[1px]'>{match.mlDraw.toFixed(2)}</span>}
            <span className='rounded-md bg-white/[0.06] px-1.5 py-[1px]'>{match.mlAway?.toFixed(2)}</span>
          </span>
        </div>
      )}
    </div>
  );
});

export function MatchCardSkeleton() {
  return (
    <div className='rounded-3xl border border-white/[0.06] bg-[#141418] p-4'>
      <div className='mb-3 flex justify-between'>
        <div className='volt-skeleton h-4 w-24 rounded-lg' />
        <div className='volt-skeleton h-4 w-12 rounded-lg' />
      </div>
      <div className='space-y-2.5'>
        <div className='volt-skeleton h-5 w-2/3 rounded-lg' />
        <div className='volt-skeleton h-5 w-1/2 rounded-lg' />
      </div>
      <div className='volt-skeleton mt-3 h-16 rounded-2xl' />
    </div>
  );
}
