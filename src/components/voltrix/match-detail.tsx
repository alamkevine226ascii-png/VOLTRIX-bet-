'use client';

// ============================================================
// VOLTRIX bet — Détail match : Pronos / Analyse / H2H / Cotes
// ============================================================

import { memo, useEffect, useState } from 'react';
import { CloudRain, Droplets, Flame, HeartHandshake, Loader2, MapPin, Share2, Thermometer, TrendingDown, TrendingUp, Wind } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { MatchDetailDTO } from '@/lib/types';
import { buildMatchCard, shareCard } from './share';
import { ConfidenceStars, FormDots, ProbBar, StatusBadge, TeamLogo, ValueBadge, formatTime } from './shared';

// Mémoïsé : la page accueil re-rend à chaque lot d'analyse — inutile de re-rendre le
// Sheet (Radix) tant que open/matchId/leagueCode/date ne changent pas.
// Rien de lourd ne se monte ici : le portail Radix n'existe que quand open=true.
export const MatchDetail = memo(function MatchDetail({
  matchId,
  leagueCode,
  date,
  open,
  onOpenChange,
}: {
  matchId: string | null;
  leagueCode: string | null;
  date: string | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side='bottom'
        aria-describedby={undefined}
        className='volt-scroll h-[93dvh] overflow-y-auto rounded-t-[28px] border-white/10 bg-[#0f0f13] p-0 sm:max-w-[480px] sm:rounded-l-[28px]'
      >
        <SheetTitle className='sr-only'>Analyse du match — VOLTRIX bet</SheetTitle>
        {open && matchId && leagueCode ? (
          <DetailLoader key={matchId} matchId={matchId} leagueCode={leagueCode} date={date} />
        ) : null}
      </SheetContent>
    </Sheet>
  );
});

function DetailLoader({
  matchId,
  leagueCode,
  date,
}: {
  matchId: string;
  leagueCode: string;
  date: string | null;
}) {
  const [state, setState] = useState<{ loading: boolean; detail: MatchDetailDTO | null; error: string | null }>({
    loading: true,
    detail: null,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/match/${matchId}?league=${leagueCode}&date=${encodeURIComponent(date ?? '')}`)
      .then(async (res) => {
        if (!res.ok) throw new Error('Erreur de chargement');
        return res.json();
      })
      .then((data: MatchDetailDTO) => {
        if (!cancelled) setState({ loading: false, detail: data, error: null });
      })
      .catch(() => {
        if (!cancelled) setState({ loading: false, detail: null, error: "Impossible de charger l'analyse de ce match." });
      });
    return () => {
      cancelled = true;
    };
  }, [matchId, leagueCode, date]);

  if (state.loading) return <DetailSkeleton />;
  if (state.error) {
    return <div className='flex h-full items-center justify-center p-8 text-center text-muted-foreground'>{state.error}</div>;
  }
  if (!state.detail) return null;
  return <DetailBody detail={state.detail} />;
}

// ============================================================

function DetailSkeleton() {
  return (
    <div className='space-y-4 p-5 pt-10'>
      <div className='volt-skeleton h-24 rounded-3xl' />
      <div className='volt-skeleton h-12 rounded-2xl' />
      <div className='volt-skeleton h-40 rounded-3xl' />
      <div className='volt-skeleton h-40 rounded-3xl' />
    </div>
  );
}

function DetailBody({ detail }: { detail: MatchDetailDTO }) {
  const p = detail.prediction;
  const isLive = detail.status === 'in';
  const isFinished = detail.status === 'post';
  const [sharing, setSharing] = useState(false);

  // Partage du prono en image (Web Share API, repli téléchargement PNG)
  const onShare = async () => {
    setSharing(true);
    try {
      const rec = p.recommendedBets[0];
      const card = buildMatchCard({
        leagueName: detail.leagueName,
        homeName: detail.home.name,
        awayName: detail.away.name,
        pick: rec ? `${rec.market} · ${rec.pick}` : `Confiance ${p.confidence}/5`,
        prob: rec?.prob ?? Math.max(p.probs.home, p.probs.draw, p.probs.away),
        confidence: p.confidence,
        edge: p.valueBets[0]?.edge ?? null,
        timeLabel: formatTime(detail.matchDate),
      });
      await shareCard(card);
    } catch {
      // partage annulé ou indisponible
    } finally {
      setSharing(false);
    }
  };

  return (
    <div className='pb-8'>
      {/* En-tête match */}
        <SheetHeader className='px-5 pt-6'>
          <div className='flex items-center justify-between gap-2'>
            <span className='rounded-lg bg-[#e8ff00]/10 px-2.5 py-1 text-[11px] font-bold text-[#e8ff00]'>
              {detail.leagueName}
            </span>
            <StatusBadge status={detail.status} statusDetail={detail.statusDetail} timeLabel={formatTime(detail.matchDate)} />
          </div>

        <div className='mt-4 grid grid-cols-[1fr_auto_1fr] items-start gap-2'>
          <div className='flex flex-col items-center gap-2 text-center'>
            <TeamLogo src={detail.home.logo} alt={detail.home.name} size={44} />
            <span className='text-[13px] font-semibold leading-tight'>{detail.home.name}</span>
            {detail.home.rank && <span className='text-[11px] text-muted-foreground'>#{detail.home.rank} · {detail.context.stakesHome}</span>}
          </div>
          <div className='flex flex-col items-center gap-1 pt-1'>
            {/* Garde status !== 'pre' (Task 17) : ESPN renvoie score:0 en pré-match —
                sans elle, la fiche affichait un faux « 0 - 0 » à la place de l'heure. */}
            {detail.homeScore !== null && detail.status !== 'pre' ? (
              <span className='text-[32px] font-bold tabular-nums leading-none'>
                {detail.homeScore} - {detail.awayScore}
              </span>
            ) : (
              <>
                <span className='text-[20px] font-bold text-[#e8ff00] leading-none'>{formatTime(detail.matchDate)}</span>
                <span className='text-[11px] text-muted-foreground'>{p.lambda.total.toFixed(2)} buts attendus</span>
              </>
            )}
            {detail.context.isDerby && (
              <span className='mt-1 inline-flex items-center gap-1 rounded-full bg-[#ff4d5e]/15 px-2 py-[3px] text-[10px] font-bold text-[#ff4d5e]'>
                <Flame size={10} /> {detail.context.derbyLabel ?? 'DERBY'}
              </span>
            )}
          </div>
          <div className='flex flex-col items-center gap-2 text-center'>
            <TeamLogo src={detail.away.logo} alt={detail.away.name} size={44} />
            <span className='text-[13px] font-semibold leading-tight'>{detail.away.name}</span>
            {detail.away.rank && <span className='text-[11px] text-muted-foreground'>#{detail.away.rank} · {detail.context.stakesAway}</span>}
          </div>
        </div>

        {(detail.venue.city || detail.context.weather) && (
          <div className='mt-3 flex flex-wrap items-center justify-center gap-2 text-[11px] text-muted-foreground'>
            {detail.venue.name && (
              <span className='inline-flex items-center gap-1'>
                <MapPin size={11} /> {detail.venue.name}
              </span>
            )}
            {detail.context.weather && (
              <span className='inline-flex items-center gap-1'>
                <Thermometer size={11} /> {detail.context.weather.tempC}°C · {detail.context.weather.description}
              </span>
            )}
          </div>
        )}
      </SheetHeader>

      {/* Bannière confiance + partage */}
      <div className='mx-5 mt-4 flex items-center justify-between rounded-2xl border border-[#e8ff00]/20 bg-[#e8ff00]/[0.06] p-4 volt-glow'>
        <div>
          <div className='text-[11px] uppercase tracking-wider text-muted-foreground'>Confiance du modèle</div>
          <div className='mt-0.5 text-[17px] font-bold text-[#e8ff00]'>
            {detail.prediction.confidence}/5 — {detail.prediction.confidenceLabel}
          </div>
        </div>
        <div className='flex items-center gap-3'>
          <ConfidenceStars level={detail.prediction.confidence} size={18} />
          <button
            onClick={onShare}
            disabled={sharing}
            aria-label='Partager ce pronostic en image'
            className='flex h-10 w-10 items-center justify-center rounded-2xl bg-[#e8ff00] text-black transition-[color,background-color,opacity,transform] active:scale-95 disabled:opacity-50'
          >
            {sharing ? <Loader2 size={16} className='animate-spin' /> : <Share2 size={16} />}
          </button>
        </div>
      </div>

      {/* Pronos recommandés */}
      <div className='mx-5 mt-3 rounded-3xl bg-[#141418] p-4'>
        <div className='mb-3 flex items-center gap-2'>
          <HeartHandshake size={15} className='text-[#e8ff00]' />
          <h3 className='text-[14px] font-bold'>Pronos recommandés</h3>
        </div>
        <div className='space-y-2'>
          {p.recommendedBets.map((rec, i) => (
            <div key={i} className='flex items-center justify-between gap-3 rounded-2xl bg-black/30 px-3 py-2.5'>
              <div className='min-w-0'>
                <div className='text-[10px] uppercase tracking-wide text-muted-foreground'>{rec.market}</div>
                <div className='truncate text-[13px] font-bold text-foreground'>{rec.pick}</div>
              </div>
              <span className='shrink-0 rounded-xl bg-[#e8ff00] px-2.5 py-1 text-[13px] font-bold text-black tabular-nums'>
                {Math.round(rec.prob * 100)}%
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Onglets */}
      <div className='mx-5 mt-4'>
        <Tabs defaultValue='pronos'>
          <TabsList className='grid w-full grid-cols-4 rounded-2xl bg-white/[0.05]'>
            <TabsTrigger value='pronos' className='rounded-xl text-[12px] data-[state=active]:bg-[#e8ff00] data-[state=active]:text-black'>Pronos</TabsTrigger>
            <TabsTrigger value='analyse' className='rounded-xl text-[12px] data-[state=active]:bg-[#e8ff00] data-[state=active]:text-black'>Analyse</TabsTrigger>
            <TabsTrigger value='h2h' className='rounded-xl text-[12px] data-[state=active]:bg-[#e8ff00] data-[state=active]:text-black'>H2H</TabsTrigger>
            <TabsTrigger value='cotes' className='rounded-xl text-[12px] data-[state=active]:bg-[#e8ff00] data-[state=active]:text-black'>Cotes</TabsTrigger>
          </TabsList>

          {/* ---------- TAB PRONOS ---------- */}
          <TabsContent value='pronos' className='mt-3 space-y-3'>
            <SectionCard title='1X2 — Résultat du match'>
              <div className='space-y-3'>
                <ProbBar label={detail.home.name} value={p.probs.home} highlight={p.probs.home >= p.probs.away && p.probs.home >= p.probs.draw} />
                <ProbBar label='Match nul' value={p.probs.draw} highlight={p.probs.draw >= p.probs.home && p.probs.draw >= p.probs.away} color='gray' />
                <ProbBar label={detail.away.name} value={p.probs.away} highlight={p.probs.away >= p.probs.home && p.probs.away >= p.probs.draw} />
              </div>
              <div className='mt-3 grid grid-cols-3 gap-2 text-center text-[11px] text-muted-foreground'>
                <div className='rounded-xl bg-white/[0.04] p-2'>
                  <div className='font-bold text-foreground'>{Math.round(p.poisson.home * 100)}%</div>Poisson
                </div>
                <div className='rounded-xl bg-white/[0.04] p-2'>
                  <div className='font-bold text-foreground'>{Math.round(p.elo.home * 100)}%</div>Elo
                </div>
                <div className='rounded-xl bg-white/[0.04] p-2'>
                  <div className='font-bold text-foreground'>{Math.round(p.form.home * 100)}%</div>Forme
                </div>
              </div>
            </SectionCard>

            <SectionCard title='Double chance'>
              <div className='space-y-3'>
                <ProbBar label={`1X — ${detail.home.name} ou nul`} value={p.probs.home + p.probs.draw} highlight={p.probs.home + p.probs.draw >= p.probs.home + p.probs.away && p.probs.home + p.probs.draw >= p.probs.draw + p.probs.away} />
                <ProbBar label='12 — Pas de match nul' value={p.probs.home + p.probs.away} highlight={p.probs.home + p.probs.away > p.probs.home + p.probs.draw && p.probs.home + p.probs.away > p.probs.draw + p.probs.away} />
                <ProbBar label={`X2 — Nul ou ${detail.away.name}`} value={p.probs.draw + p.probs.away} highlight={p.probs.draw + p.probs.away > p.probs.home + p.probs.draw && p.probs.draw + p.probs.away > p.probs.home + p.probs.away} />
              </div>
            </SectionCard>

            <SectionCard title='Total de buts (Over / Under)'>
              <div className='space-y-4'>
                {p.overUnder.map((ou) => (
                  <div key={ou.line} className='space-y-2'>
                    <div className='text-[12px] font-semibold text-foreground/80'>Ligne {ou.line.toFixed(1)} but{ou.line > 1 ? 's' : ''}</div>
                    <ProbBar label={`Plus de ${ou.line.toFixed(1)}`} value={ou.over} highlight={ou.over >= ou.under} color='green' />
                    <ProbBar label={`Moins de ${ou.line.toFixed(1)}`} value={ou.under} highlight={ou.under > ou.over} />
                  </div>
                ))}
              </div>
              <div className='mt-3 rounded-xl bg-white/[0.04] p-3 text-[12px] text-muted-foreground'>
                Buts attendus (xG modèle) : <span className='font-bold text-[#e8ff00]'>{detail.home.name.slice(0, 14)} {p.lambda.home.toFixed(2)}</span> · <span className='font-bold text-[#e8ff00]'>{detail.away.name.slice(0, 14)} {p.lambda.away.toFixed(2)}</span>
              </div>
            </SectionCard>

            <SectionCard title='Les deux équipes marquent (BTTS)'>
              <div className='space-y-3'>
                <ProbBar label='Oui — les deux équipes marquent' value={p.btts.yes} highlight={p.btts.yes >= p.btts.no} color='green' />
                <ProbBar label='Non' value={p.btts.no} highlight={p.btts.no > p.btts.yes} />
              </div>
            </SectionCard>

            <SectionCard title='Moment du premier but'>
              <div className='space-y-2.5'>
                {p.firstGoalTiming.map((f) => (
                  <ProbBar
                    key={f.window}
                    label={f.label}
                    value={f.prob}
                    highlight={f.prob === Math.max(...p.firstGoalTiming.map((x) => x.prob))}
                    color={f.window === 'NO_GOAL' ? 'gray' : 'volt'}
                  />
                ))}
              </div>
              <div className='mt-3 rounded-xl bg-white/[0.04] p-3 text-[12px] text-muted-foreground'>
                Modèle basé sur le rythme offensif attendu ({p.lambda.total.toFixed(2)} buts) via la loi exponentielle du premier but.
              </div>
            </SectionCard>

            <SectionCard title='Première équipe à marquer'>
              <div className='space-y-3'>
                <ProbBar label={detail.home.name} value={p.firstToScore.home} highlight={p.firstToScore.home >= p.firstToScore.away} />
                <ProbBar label={detail.away.name} value={p.firstToScore.away} highlight={p.firstToScore.away > p.firstToScore.home} />
                <ProbBar label='Aucun but' value={p.firstToScore.noGoal} color='gray' />
              </div>
            </SectionCard>

            <SectionCard title='Scores exacts les plus probables'>
              <div className='flex flex-wrap gap-2'>
                {p.topScores.map((s) => (
                  <span key={s.score} className='rounded-2xl bg-[#e8ff00]/10 px-4 py-2 text-[14px] font-bold text-[#e8ff00]'>
                    {s.score} <span className='text-[11px] font-medium text-foreground/60'>{Math.round(s.prob * 100)}%</span>
                  </span>
                ))}
              </div>
            </SectionCard>
          </TabsContent>

          {/* ---------- TAB ANALYSE ---------- */}
          <TabsContent value='analyse' className='mt-3 space-y-3'>
            <SectionCard title='Forme récente (5 derniers matchs)'>
              <TeamFormBlock team={detail.home} />
              <div className='my-3 h-px bg-white/[0.06]' />
              <TeamFormBlock team={detail.away} />
            </SectionCard>

            <SectionCard title='Puissance des équipes'>
              <div className='grid grid-cols-2 gap-3'>
                <StatCompare label='Rating Elo' a={String(detail.home.elo)} b={String(detail.away.elo)} aName={detail.home.name} bName={detail.away.name} />
                <StatCompare label='Buts/match' a={detail.home.goalsForPerMatch.toFixed(2)} b={detail.away.goalsForPerMatch.toFixed(2)} aName={detail.home.name} bName={detail.away.name} />
                <StatCompare label='Encaissés/match' a={detail.home.goalsAgainstPerMatch.toFixed(2)} b={detail.away.goalsAgainstPerMatch.toFixed(2)} aName={detail.home.name} bName={detail.away.name} lowerBetter />
                <StatCompare label='Clean sheets' a={`${detail.home.cleanSheetsPct}%`} b={`${detail.away.cleanSheetsPct}%`} aName={detail.home.name} bName={detail.away.name} />
                <StatCompare label='Sans marquer' a={`${detail.home.failedToScorePct}%`} b={`${detail.away.failedToScorePct}%`} aName={detail.home.name} bName={detail.away.name} lowerBetter />
                <StatCompare label='Matchs / 14 j' a={String(detail.home.matchesLast14Days)} b={String(detail.away.matchesLast14Days)} aName={detail.home.name} bName={detail.away.name} />
              </div>
            </SectionCard>

            {/* Contexte */}
            <SectionCard title='Contexte du match'>
              <div className='space-y-2.5 text-[13px]'>
                {detail.context.isDerby && (
                  <ContextRow icon={<Flame size={14} className='text-[#ff4d5e]' />} text={`Rivalité : ${detail.context.derbyLabel ?? 'derby'} — intensité et cartons en hausse, jeu plus fermé.`} />
                )}
                <ContextRow icon={<Flame size={14} className='text-[#e8ff00]' />} text={`${detail.home.name} : ${detail.context.stakesHome} (#${detail.home.rank ?? '?'} avec ${detail.home.points} pts)`} />
                <ContextRow icon={<Flame size={14} className='text-[#e8ff00]' />} text={`${detail.away.name} : ${detail.context.stakesAway} (#${detail.away.rank ?? '?'} avec ${detail.away.points} pts)`} />
                {detail.context.fatigueNoteHome && (
                  <ContextRow icon={<TrendingDown size={14} className='text-[#ff9f43]' />} text={detail.context.fatigueNoteHome} />
                )}
                {detail.context.fatigueNoteAway && (
                  <ContextRow icon={<TrendingDown size={14} className='text-[#ff9f43]' />} text={detail.context.fatigueNoteAway} />
                )}
                {detail.context.injuriesNoteHome && (
                  <ContextRow icon={<HeartHandshake size={14} className='text-[#ff4d5e]' />} text={`${detail.home.name} : ${detail.context.injuriesNoteHome}`} />
                )}
                {detail.context.injuriesNoteAway && (
                  <ContextRow icon={<HeartHandshake size={14} className='text-[#ff4d5e]' />} text={`${detail.away.name} : ${detail.context.injuriesNoteAway}`} />
                )}
              </div>
            </SectionCard>

            {/* Météo */}
            {detail.context.weather && (
              <SectionCard title='Météo au stade'>
                <div className='grid grid-cols-3 gap-2 text-center'>
                  <div className='rounded-2xl bg-white/[0.04] p-3'>
                    <Thermometer size={16} className='mx-auto text-[#e8ff00]' />
                    <div className='mt-1 text-[15px] font-bold'>{detail.context.weather.tempC}°C</div>
                    <div className='text-[10px] text-muted-foreground'>Température</div>
                  </div>
                  <div className='rounded-2xl bg-white/[0.04] p-3'>
                    <Wind size={16} className='mx-auto text-[#e8ff00]' />
                    <div className='mt-1 text-[15px] font-bold'>{detail.context.weather.windKmh} km/h</div>
                    <div className='text-[10px] text-muted-foreground'>Vent</div>
                  </div>
                  <div className='rounded-2xl bg-white/[0.04] p-3'>
                    <Droplets size={16} className='mx-auto text-[#e8ff00]' />
                    <div className='mt-1 text-[15px] font-bold'>{detail.context.weather.precipitationMm} mm</div>
                    <div className='text-[10px] text-muted-foreground'>Précipitations</div>
                  </div>
                </div>
                <div className='mt-3 flex items-start gap-2 rounded-xl bg-white/[0.04] p-3 text-[12px] text-muted-foreground'>
                  <CloudRain size={14} className='mt-[1px] shrink-0 text-[#e8ff00]' />
                  <span>
                    {detail.context.weather.description}. {detail.context.weather.impact}
                  </span>
                </div>
              </SectionCard>
            )}
          </TabsContent>

          {/* ---------- TAB H2H ---------- */}
          <TabsContent value='h2h' className='mt-3 space-y-3'>
            <SectionCard title='Historique des confrontations'>
              {detail.h2h.length === 0 ? (
                <div className='py-4 text-center text-[13px] text-muted-foreground'>
                  Aucune confrontation récente trouvée entre ces deux équipes.
                </div>
              ) : (
                <>
                  <div className='grid grid-cols-3 gap-2 text-center'>
                    <div className='rounded-2xl bg-white/[0.04] p-3'>
                      <div className='text-[22px] font-bold text-[#e8ff00]'>{detail.h2hSummary.homeWins}</div>
                      <div className='truncate text-[10px] text-muted-foreground'>{detail.home.name}</div>
                    </div>
                    <div className='rounded-2xl bg-white/[0.04] p-3'>
                      <div className='text-[22px] font-bold text-foreground/60'>{detail.h2hSummary.draws}</div>
                      <div className='text-[10px] text-muted-foreground'>Nuls</div>
                    </div>
                    <div className='rounded-2xl bg-white/[0.04] p-3'>
                      <div className='text-[22px] font-bold text-[#e8ff00]'>{detail.h2hSummary.awayWins}</div>
                      <div className='truncate text-[10px] text-muted-foreground'>{detail.away.name}</div>
                    </div>
                  </div>
                  <div className='mt-3 space-y-2'>
                    {detail.h2h.map((m, i) => (
                      <div key={i} className='flex items-center justify-between rounded-2xl bg-black/30 px-3 py-2.5'>
                        <span className='min-w-0 flex-1 truncate text-right text-[12px] text-muted-foreground'>{m.homeTeam}</span>
                        <span className='mx-3 shrink-0 rounded-lg bg-[#e8ff00]/10 px-2.5 py-1 text-[13px] font-bold text-[#e8ff00] tabular-nums'>
                          {m.score}
                        </span>
                        <span className='min-w-0 flex-1 truncate text-left text-[12px] text-muted-foreground'>{m.awayTeam}</span>
                      </div>
                    ))}
                  </div>
                  <div className='mt-3 rounded-xl bg-white/[0.04] p-3 text-[12px] text-muted-foreground'>
                    L'historique des duels directs pèse dans le modèle (facteur psychologique), avec une pondération réduite face aux stats récentes.
                  </div>
                </>
              )}
            </SectionCard>
          </TabsContent>

          {/* ---------- TAB COTES ---------- */}
          <TabsContent value='cotes' className='mt-3 space-y-3'>
            {!detail.odds?.hasOdds ? (
              <SectionCard title='Cotes du marché'>
                <div className='py-4 text-center text-[13px] text-muted-foreground'>
                  Aucune cote disponible pour ce match pour le moment. Les value bets seront calculés dès que le marché ouvrira.
                </div>
              </SectionCard>
            ) : (
              <>
                {/* Mouvement de cotes */}
                {detail.prediction.oddsMovement && (
                  <div className='flex items-start gap-2 rounded-2xl border border-[#e8ff00]/25 bg-[#e8ff00]/[0.07] p-3.5 text-[12px] text-foreground'>
                    {detail.prediction.oddsMovement.includes('hausse') ? (
                      <TrendingUp size={15} className='mt-[1px] shrink-0 text-[#e8ff00]' />
                    ) : (
                      <TrendingDown size={15} className='mt-[1px] shrink-0 text-[#e8ff00]' />
                    )}
                    <span>{detail.prediction.oddsMovement}</span>
                  </div>
                )}

                <SectionCard title={`Cotes 1X2 — ${detail.odds.provider}`}>
                  <div className='grid grid-cols-3 gap-2'>
                    <OddsBox label='1' value={detail.odds.moneyline.home.close} modelProb={p.probs.home} />
                    <OddsBox label='X' value={detail.odds.moneyline.draw.close} modelProb={p.probs.draw} />
                    <OddsBox label='2' value={detail.odds.moneyline.away.close} modelProb={p.probs.away} />
                  </div>
                  <div className='mt-2 text-center text-[10px] text-muted-foreground'>
                    Probabilité implicite du marché vs probabilité du modèle VOLTRIX
                  </div>
                </SectionCard>

                {detail.odds.overUnderLine !== null && (
                  <SectionCard title={`Total de buts — ligne ${detail.odds.overUnderLine.toFixed(1)}`}>
                    <div className='grid grid-cols-2 gap-2'>
                      <OddsBox label={`Plus de ${detail.odds.overUnderLine.toFixed(1)}`} value={detail.odds.total.over.closeOdds} modelProb={(p.raw?.overUnder ?? p.overUnder).find((o) => o.line === detail.odds!.overUnderLine)?.over ?? null} />
                      <OddsBox label={`Moins de ${detail.odds.overUnderLine.toFixed(1)}`} value={detail.odds.total.under.closeOdds} modelProb={(p.raw?.overUnder ?? p.overUnder).find((o) => o.line === detail.odds!.overUnderLine)?.under ?? null} />
                    </div>
                  </SectionCard>
                )}

                <SectionCard title='Value bets détectés'>
                  {detail.prediction.valueBets.length === 0 ? (
                    <div className='py-4 text-center text-[13px] text-muted-foreground'>
                      Aucun value bet pour le moment : le marché est aligné avec nos probabilités. Un value bet apparaît quand notre probabilité dépasse la probabilité implicite de la cote.
                    </div>
                  ) : (
                    <div className='space-y-2.5'>
                      {detail.prediction.valueBets.map((vb, i) => (
                        <div key={i} className='rounded-2xl border border-[#e8ff00]/25 bg-[#e8ff00]/[0.06] p-3.5'>
                          <div className='flex items-center justify-between gap-2'>
                            <div className='min-w-0'>
                              <div className='text-[10px] uppercase tracking-wide text-muted-foreground'>{vb.market}</div>
                              <div className='truncate text-[14px] font-bold text-[#e8ff00]'>{vb.pick}</div>
                            </div>
                            <ValueBadge edge={vb.edge} />
                          </div>
                          <div className='mt-2 grid grid-cols-3 gap-2 text-center text-[11px]'>
                            <div className='rounded-xl bg-black/30 p-2'>
                              <div className='font-bold text-foreground'>{Math.round(vb.modelProb * 100)}%</div>
                              <div className='text-[10px] text-muted-foreground'>Modèle</div>
                            </div>
                            <div className='rounded-xl bg-black/30 p-2'>
                              <div className='font-bold text-foreground'>{vb.odds.toFixed(2)}</div>
                              <div className='text-[10px] text-muted-foreground'>Cote</div>
                            </div>
                            <div className='rounded-xl bg-black/30 p-2'>
                              <div className='font-bold text-foreground'>{(vb.kelly * 100).toFixed(1)}%</div>
                              <div className='text-[10px] text-muted-foreground'>Mise Kelly</div>
                            </div>
                          </div>
                        </div>
                      ))}
                      <div className='rounded-xl bg-white/[0.04] p-3 text-[11px] text-muted-foreground'>
                        Le critère de Kelly indique la part de bankroll théoriquement optimale à miser selon l'avantage détecté. Mise conseillée plafonnée à 10%.
                      </div>
                    </div>
                  )}
                </SectionCard>
              </>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* Disclaimer */}
      <div className='mx-5 mt-4 rounded-2xl bg-white/[0.03] p-3.5 text-center text-[11px] leading-relaxed text-muted-foreground'>
        Pronostics générés statistiquement à titre informatif. Aucun résultat n'est garanti. Les paris sportifs comportent des risques : jouez de manière responsable. 18+
      </div>
    </div>
  );
}

// ============================================================

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className='rounded-3xl bg-[#141418] p-4'>
      <h3 className='mb-3 text-[14px] font-bold'>{title}</h3>
      {children}
    </div>
  );
}

function TeamFormBlock({ team }: { team: MatchDetailDTO['home'] }) {
  return (
    <div>
      <div className='mb-2 flex items-center gap-2'>
        <TeamLogo src={team.logo} alt={team.name} size={18} />
        <span className='text-[13px] font-semibold'>{team.name}</span>
        <span className='ml-auto rounded-lg bg-white/[0.06] px-2 py-[2px] text-[11px] text-muted-foreground'>
          Elo {team.elo}
        </span>
      </div>
      <div className='space-y-1.5'>
        {team.form.length === 0 && (
          <div className='text-[12px] text-muted-foreground'>Pas d'historique disponible cette saison.</div>
        )}
        {team.form.map((f, i) => (
          <div key={i} className='flex items-center gap-2 text-[12px]'>
            <span
              className='inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[10px] font-bold'
              style={{
                background: f.result === 'W' ? '#a3e63520' : f.result === 'D' ? '#8a8a8220' : '#ff4d5e20',
                color: f.result === 'W' ? '#a3e635' : f.result === 'D' ? '#b8b8b0' : '#ff4d5e',
              }}
            >
              {f.result === 'W' ? 'V' : f.result === 'D' ? 'N' : 'D'}
            </span>
            <span className='min-w-0 flex-1 truncate text-muted-foreground'>
              {f.home ? 'vs' : '@'} {f.opponent}
            </span>
            <span className='tabular-nums text-foreground/70'>{f.score}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatCompare({
  label,
  a,
  b,
  aName,
  bName,
  lowerBetter = false,
}: {
  label: string;
  a: string;
  b: string;
  aName: string;
  bName: string;
  /** Statistiques où la valeur la PLUS BASSE est la meilleure (ex : encaissés/match,
      sans marquer) — sans elle, la mauvaise équipe était mise en valeur volt. */
  lowerBetter?: boolean;
}) {
  const aNum = parseFloat(a);
  const bNum = parseFloat(b);
  const comparable = !isNaN(aNum) && !isNaN(bNum);
  // Égalité : domicile gardé en volt (comportement historique >=).
  const aBetter = comparable ? (lowerBetter ? aNum <= bNum : aNum >= bNum) : false;
  return (
    <div className='rounded-2xl bg-white/[0.04] p-3'>
      <div className='text-[10px] uppercase tracking-wide text-muted-foreground'>{label}</div>
      <div className='mt-1 flex items-baseline justify-between gap-2'>
        <span className={`text-[15px] font-bold ${aBetter ? 'text-[#e8ff00]' : 'text-foreground/60'}`}>{a}</span>
        <span className={`text-[15px] font-bold ${!aBetter ? 'text-[#e8ff00]' : 'text-foreground/60'}`}>{b}</span>
      </div>
      <div className='mt-0.5 flex justify-between text-[9px] text-muted-foreground'>
        <span className='max-w-[45%] truncate'>{aName}</span>
        <span className='max-w-[45%] truncate'>{bName}</span>
      </div>
    </div>
  );
}

function ContextRow({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className='flex items-start gap-2.5'>
      <span className='mt-[1px] shrink-0'>{icon}</span>
      <span className='text-muted-foreground'>{text}</span>
    </div>
  );
}

function OddsBox({ label, value, modelProb }: { label: string; value: number | null; modelProb: number | null }) {
  const implied = value && value > 1 ? 1 / value : 0;
  // modelProb null = le modèle ne calcule pas cette ligne (ex : ligne O/U du
  // marché à 4.5 alors que le modèle couvre 1.5/2.5/3.5) — on affiche « — »
  // au lieu d'un faux « Modèle 0 % ».
  const edge = implied > 0 && modelProb != null ? modelProb - implied : 0;
  return (
    <div className='rounded-2xl bg-white/[0.04] p-3 text-center'>
      <div className='truncate text-[11px] text-muted-foreground'>{label}</div>
      <div className='mt-1 text-[18px] font-bold tabular-nums'>{value ? value.toFixed(2) : '—'}</div>
      <div className='mt-1 text-[10px] text-muted-foreground'>
        Marché {implied ? `${Math.round(implied * 100)}%` : '—'} · Modèle{' '}
        <span className='text-[#e8ff00]'>{modelProb != null ? `${Math.round(modelProb * 100)}%` : '—'}</span>
      </div>
      {edge > 0.02 && (
        <div className='mt-1 text-[10px] font-bold text-[#e8ff00]'>+{Math.round(edge * 100)}% d'écart</div>
      )}
    </div>
  );
}
