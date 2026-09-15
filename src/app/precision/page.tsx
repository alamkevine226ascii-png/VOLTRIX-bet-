'use client';

// ============================================================
// VOLTRIX bet — Page Précision VOLTRIX (la transparence)
// Chaque prono généré par le moteur est suivi et résolu
// automatiquement après le match. Cette page expose tout :
// réussite globale, par marché, par confiance, par ligue,
// calibrage des probabilités (Brier) et historique complet.
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  BadgeCheck,
  Banknote,
  BarChart3,
  Loader2,
  RefreshCw,
  ShieldQuestion,
  Target,
  TrendingUp,
} from 'lucide-react';
import type { PerformanceDTO } from '@/lib/types';
import { VoltrixTabBar } from '@/components/voltrix/tab-bar';
import { cn } from '@/lib/utils';

// Formatter de dates du niveau module : `new Intl.DateTimeFormat` est coûteux à
// construire — un seul exemplaire partagé au lieu d'un par ligne d'historique et
// par render (même convention que composants/voltrix/shared.tsx).
const HISTORY_DATE_FMT = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short' });

export default function PrecisionPage() {
  const [state, setState] = useState<{ loading: boolean; perf: PerformanceDTO | null; error: boolean }>({
    loading: true,
    perf: null,
    error: false,
  });

  // Référence de vie du composant : aucun setState après le démontage
  // (la réponse du fetch peut arriver après une navigation).
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const load = useCallback(() => {
    setState((s) => ({ ...s, loading: true, error: false }));
    fetch('/api/performance')
      .then((r) => {
        if (!r.ok) throw new Error('HTTP KO');
        return r.json();
      })
      .then((perf: PerformanceDTO) => {
        if (!aliveRef.current) return;
        setState({ loading: false, perf, error: false });
      })
      .catch(() => {
        if (!aliveRef.current) return;
        setState({ loading: false, perf: null, error: true });
      });
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      await Promise.resolve();
      if (!alive) return;
      load();
    })();
    return () => {
      alive = false;
    };
  }, [load]);

  const perf = state.perf;
  const winRate = perf ? perf.winRate * 100 : 0;
  const brier = perf?.calibration?.brierScore ?? null;
  const brierGrade = brier == null ? null : brier < 0.2 ? 'Excellent' : brier < 0.23 ? 'Très bon' : brier < 0.25 ? 'Correct' : 'À surveiller';

  // Ligues : au moins 5 pronos résolus, triées par volume, top 8
  // (mémoïsé : recalculé uniquement quand les stats changent, plus à chaque render)
  const leagues = useMemo(
    () =>
      Object.entries(perf?.byLeague ?? {})
        .filter(([, s]) => s.total >= 5)
        .sort((a, b) => b[1].total - a[1].total)
        .slice(0, 8),
    [perf]
  );

  return (
    <div className='mx-auto flex min-h-[100dvh] max-w-[480px] flex-col bg-background'>
      {/* ---------- Header ---------- */}
      <header className='pt-safe sticky top-0 z-40 border-b border-white/[0.05] bg-[#0a0a0c]/90 px-5 pb-3 backdrop-blur-sm'>
        <div className='flex items-center gap-3 pt-3'>
          <div className='min-w-0'>
            <div className='flex items-center gap-2'>
              <Target size={16} className='shrink-0 text-[#e8ff00]' />
              <span className='truncate font-display text-[17px] font-bold tracking-tight'>Précision VOLTRIX</span>
            </div>
            <div className='mt-0.5 text-[10px] text-muted-foreground'>La transparence · pronos suivis & résolus automatiquement</div>
          </div>
          <button
            onClick={load}
            className='ml-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-white/[0.07] text-foreground/60 transition-[color,background-color,transform] active:scale-95'
            aria-label='Actualiser les statistiques'
          >
            <RefreshCw size={14} className={cn(state.loading && 'animate-spin')} />
          </button>
        </div>
      </header>

      {/* ---------- Contenu ---------- */}
      <main className='flex-1 px-5 pb-32 pt-4'>
        {state.loading && !perf ? (
          <div className='space-y-3'>
            <div className='volt-skeleton h-44 rounded-3xl' />
            <div className='volt-skeleton h-36 rounded-3xl' />
            <div className='volt-skeleton h-48 rounded-3xl' />
          </div>
        ) : state.error && !perf ? (
          <div className='flex flex-col items-center gap-3 rounded-3xl border border-dashed border-white/10 py-14 text-center'>
            <AlertTriangle size={34} className='text-white/15' />
            <div className='text-[15px] font-semibold'>Statistiques indisponibles</div>
            <p className='max-w-[270px] text-[13px] text-muted-foreground'>Impossible de charger les statistiques pour le moment.</p>
            <button
              onClick={load}
              className='mt-1 flex items-center gap-2 rounded-2xl bg-[#e8ff00] px-5 py-2.5 text-[13px] font-bold text-black transition-[color,background-color,transform] active:scale-95'
            >
              <RefreshCw size={14} /> Réessayer
            </button>
          </div>
        ) : perf ? (
          <div className='space-y-4'>
            {/* Hero : taux de réussite */}
            <div className='rounded-3xl border border-[#e8ff00]/20 bg-[#e8ff00]/[0.06] p-5 volt-glow'>
              <div className='flex items-center justify-between'>
                <div className='flex items-center gap-1.5 text-[11px] text-muted-foreground'>
                  <BadgeCheck size={13} className='text-[#e8ff00]' /> Taux de réussite global
                </div>
                {brier != null && brierGrade && (
                  <span
                    className={cn(
                      'rounded-full px-2.5 py-1 text-[10px] font-bold',
                      brier < 0.23 ? 'bg-[#a3e635]/15 text-[#a3e635]' : brier < 0.25 ? 'bg-[#e8ff00]/15 text-[#e8ff00]' : 'bg-[#ff4d5e]/15 text-[#ff9aa2]'
                    )}
                  >
                    Brier {brier.toFixed(3)} · {brierGrade}
                  </span>
                )}
              </div>
              <div className='mt-1 text-[44px] font-bold leading-none text-[#e8ff00] tabular-nums'>{winRate.toFixed(0)}%</div>
              <div className='mt-1.5 text-[12px] text-muted-foreground'>
                {perf.wins} pronos gagnants sur {perf.totalResolved} résolus · {perf.pendingCount} en attente
              </div>
              <p className='mt-3 border-t border-white/[0.07] pt-3 text-[11px] leading-relaxed text-muted-foreground'>
                Chaque match analysé enregistre automatiquement 3 pronos suivis (1X2, O/U 2.5, BTTS). Après le match, ESPN
                tranche : le résultat est comparé au prono, sans filtre ni tri préalable. Ce que tu vois ici, c'est le score
                réel du moteur.
              </p>
            </div>

            {/* KPIs */}
            <div className='grid grid-cols-2 gap-2.5'>
              <div className='rounded-3xl bg-[#141418] p-4'>
                <div className='flex items-center gap-1.5 text-[11px] text-muted-foreground'>
                  <TrendingUp size={12} /> ROI simulé
                </div>
                <div className={cn('mt-1 text-[24px] font-bold tabular-nums', perf.roi >= 0 ? 'text-[#a3e635]' : 'text-[#ff4d5e]')}>
                  {(perf.roi * 100).toFixed(1)}%
                </div>
                <div className='text-[11px] text-muted-foreground'>Mise fixe 10 € / prono</div>
              </div>
              <div className='rounded-3xl bg-[#141418] p-4'>
                <div className='text-[11px] text-muted-foreground'>Pronos résolus</div>
                <div className='mt-1 text-[24px] font-bold tabular-nums'>{perf.totalResolved}</div>
                <div className='text-[11px] text-muted-foreground'>sur {perf.totalPredictions} suivis</div>
              </div>
              <div className='rounded-3xl bg-[#141418] p-4'>
                <div className='text-[11px] text-muted-foreground'>En attente</div>
                <div className='mt-1 text-[24px] font-bold tabular-nums'>{perf.pendingCount}</div>
                <div className='text-[11px] text-muted-foreground'>résolus après les matchs</div>
              </div>
              <div className='rounded-3xl bg-[#141418] p-4'>
                <div className='text-[11px] text-muted-foreground'>Score de Brier</div>
                <div className='mt-1 text-[24px] font-bold tabular-nums'>{brier != null ? brier.toFixed(3) : '—'}</div>
                <div className='text-[11px] text-muted-foreground'>0 = parfait · 0,25 = hasard</div>
              </div>
            </div>

            {/* Par marché */}
            <div className='rounded-3xl bg-[#141418] p-4'>
              <div className='mb-3 flex items-center gap-2'>
                <BarChart3 size={15} className='text-[#e8ff00]' />
                <h3 className='text-[14px] font-bold'>Réussite par marché</h3>
              </div>
              {Object.keys(perf.byMarket ?? {}).length === 0 ? (
                <p className='text-[12px] text-muted-foreground'>Les statistiques apparaîtront dès que les premiers matchs seront joués.</p>
              ) : (
                <div className='space-y-3'>
                  {Object.entries(perf.byMarket)
                    .sort((a, b) => b[1].total - a[1].total)
                    .map(([market, s]) => (
                      <div key={market}>
                        <div className='mb-1 flex justify-between text-[12px]'>
                          <span className='text-muted-foreground'>{market}</span>
                          <span className='font-semibold'>
                            {Math.round(s.winRate * 100)}% <span className='text-muted-foreground'>({s.wins}/{s.total})</span>
                          </span>
                        </div>
                        <div className='h-[7px] overflow-hidden rounded-full bg-white/[0.07]'>
                          <div className='volt-bar h-full rounded-full bg-[#e8ff00]' style={{ width: `${Math.max(s.winRate * 100, 2)}%` }} />
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </div>

            {/* Par confiance */}
            {Object.keys(perf.byConfidence ?? {}).length > 0 && (
              <div className='rounded-3xl bg-[#141418] p-4'>
                <div className='mb-3 flex items-center gap-2'>
                  <ShieldQuestion size={15} className='text-[#e8ff00]' />
                  <h3 className='text-[14px] font-bold'>Réussite par niveau de confiance</h3>
                </div>
                <p className='mb-3 text-[11px] leading-snug text-muted-foreground'>
                  Les étoiles annoncées avant le match prédisent-elles les chances réelles ? C'est le test.
                </p>
                <div className='space-y-3'>
                  {Object.entries(perf.byConfidence)
                    .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
                    .map(([conf, s]) => (
                      <div key={conf}>
                        <div className='mb-1 flex justify-between text-[12px]'>
                          <span className='text-muted-foreground'>Confiance {conf}/5</span>
                          <span className='font-semibold'>
                            {Math.round(s.winRate * 100)}% <span className='text-muted-foreground'>({s.wins}/{s.total})</span>
                          </span>
                        </div>
                        <div className='h-[7px] overflow-hidden rounded-full bg-white/[0.07]'>
                          <div className='volt-bar h-full rounded-full bg-[#a3e635]' style={{ width: `${Math.max(s.winRate * 100, 2)}%` }} />
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            )}

            {/* Calibrage */}
            {perf.calibration && perf.calibration.sample >= 20 && (
              <div className='rounded-3xl bg-[#141418] p-4'>
                <h3 className='mb-1 text-[14px] font-bold'>Calibrage des probabilités</h3>
                <p className='mb-3 text-[11px] leading-snug text-muted-foreground'>
                  Quand le moteur annonce 60 %, le prono gagne-t-il vraiment ~60 % du temps ? Barre jaune = probabilité
                  annoncée, barre verte = taux réel observé. Des barres proches = modèle honnête.
                </p>
                <div className='space-y-3'>
                  {perf.calibration.buckets.map((b) => (
                    <div key={b.label}>
                      <div className='mb-1 flex justify-between text-[11px]'>
                        <span className='text-muted-foreground'>{b.label}</span>
                        <span className='tabular-nums'>
                          <span className='font-semibold text-foreground'>{Math.round(b.actualRate * 100)}%</span>{' '}
                          <span className='text-muted-foreground'>réel · {Math.round(b.avgProb * 100)}% prévu ({b.count})</span>
                        </span>
                      </div>
                      <div className='space-y-1'>
                        <div className='h-[6px] overflow-hidden rounded-full bg-white/[0.07]'>
                          <div className='volt-bar h-full rounded-full bg-[#e8ff00]' style={{ width: `${Math.max(b.avgProb * 100, 2)}%` }} />
                        </div>
                        <div className='h-[6px] overflow-hidden rounded-full bg-white/[0.07]'>
                          <div className='volt-bar h-full rounded-full bg-[#a3e635]' style={{ width: `${Math.max(b.actualRate * 100, 2)}%` }} />
                        </div>
                      </div>
                    </div>
                  ))}
                  {perf.calibration.buckets.length === 0 && (
                    <p className='text-[12px] text-muted-foreground'>Pas encore assez de pronos résolus par tranche pour tracer la courbe.</p>
                  )}
                </div>
              </div>
            )}

            {/* Par ligue */}
            {leagues.length > 0 && (
              <div className='rounded-3xl bg-[#141418] p-4'>
                <h3 className='mb-1 text-[14px] font-bold'>Réussite par compétition</h3>
                <p className='mb-3 text-[11px] leading-snug text-muted-foreground'>
                  Où le moteur est le plus fiable (minimum 5 pronos résolus par compétition).
                </p>
                <div className='space-y-3'>
                  {leagues.map(([league, s]) => (
                    <div key={league}>
                      <div className='mb-1 flex justify-between gap-3 text-[12px]'>
                        <span className='min-w-0 truncate text-muted-foreground'>{league}</span>
                        <span className='shrink-0 font-semibold'>
                          {Math.round(s.winRate * 100)}% <span className='text-muted-foreground'>({s.wins}/{s.total})</span>
                        </span>
                      </div>
                      <div className='h-[7px] overflow-hidden rounded-full bg-white/[0.07]'>
                        <div className='volt-bar h-full rounded-full bg-[#e8ff00]' style={{ width: `${Math.max(s.winRate * 100, 2)}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Historique */}
            <div className='rounded-3xl bg-[#141418] p-4'>
              <h3 className='mb-3 text-[14px] font-bold'>Derniers pronos suivis</h3>
              {(perf.history?.length ?? 0) === 0 ? (
                <p className='text-[12px] text-muted-foreground'>
                  Aucun prono enregistré pour l'instant. Analyse un match depuis l'accueil pour lancer le suivi.
                </p>
              ) : (
                <div className='space-y-2'>
                  {perf.history.map((h) => (
                    <div key={h.id} className='rounded-2xl bg-black/30 px-3 py-2.5'>
                      <div className='flex items-center justify-between gap-3'>
                        <div className='min-w-0'>
                          <div className='truncate text-[12px] font-semibold'>
                            {h.homeTeam} <span className='text-muted-foreground'>vs</span> {h.awayTeam}
                          </div>
                          <div className='truncate text-[11px] text-muted-foreground'>
                            {h.leagueName} · {h.market} · {h.pick}
                          </div>
                          <div className='mt-0.5 truncate text-[10px] text-muted-foreground/70'>
                            Proba {Math.round(h.probability * 100)}%{h.odds ? ` · cote ${h.odds.toFixed(2)}` : ''} ·{' '}
                            {HISTORY_DATE_FMT.format(new Date(h.matchDate))}
                          </div>
                        </div>
                        {h.resolved ? (
                          <span
                            className={cn(
                              'shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold',
                              h.result === 'WIN'
                                ? 'bg-[#a3e635]/15 text-[#a3e635]'
                                : h.result === 'LOSE'
                                  ? 'bg-[#ff4d5e]/15 text-[#ff4d5e]'
                                  : 'bg-white/10 text-muted-foreground'
                            )}
                          >
                            {h.result === 'WIN' ? 'GAGNÉ' : h.result === 'LOSE' ? 'PERDU' : h.result}
                          </span>
                        ) : (
                          <span className='shrink-0 rounded-full bg-white/[0.07] px-2.5 py-1 text-[10px] text-muted-foreground'>À venir</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Lien Vente (conseiller de revente de coupon) */}
            <Link
              href='/vente'
              className='flex items-center justify-between rounded-3xl border border-[#e8ff00]/20 bg-[#e8ff00]/[0.05] p-4 transition-[color,background-color,border-color,transform] active:scale-[0.985]'
            >
              <div className='flex items-center gap-2.5'>
                <Banknote size={17} className='text-[#e8ff00]' />
                <div>
                  <div className='text-[14px] font-bold'>Tu as joué un coupon ?</div>
                  <div className='text-[11px] text-muted-foreground'>Transfère-le dans la Vente : faut-il le revendre au bookmaker ?</div>
                </div>
              </div>
              <span className='text-[#e8ff00]'>→</span>
            </Link>

            {/* Disclaimer */}
            <div className='rounded-3xl border border-[#ff4d5e]/25 bg-[#ff4d5e]/[0.06] p-4'>
              <div className='flex items-center gap-2'>
                <AlertTriangle size={14} className='text-[#ff4d5e]' />
                <span className='text-[13px] font-bold text-[#ff4d5e]'>Jeu responsable</span>
              </div>
              <p className='mt-1.5 text-[11px] leading-relaxed text-foreground/75'>
                VOLTRIX bet est un outil statistique informatif : il ne garantit aucun gain. Les statistiques passées ne
                préjugent pas des résultats futurs. 18+.
              </p>
            </div>
          </div>
        ) : null}

        {state.loading && perf && (
          <div className='mt-3 flex items-center justify-center gap-2 text-[12px] text-muted-foreground'>
            <Loader2 size={13} className='animate-spin text-[#e8ff00]' /> Actualisation…
          </div>
        )}
      </main>

      {/* ---------- Barre d'onglets Liquid Glass ---------- */}
      <VoltrixTabBar />
    </div>
  );
}
