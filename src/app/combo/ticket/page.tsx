'use client';

// ============================================================
// VOLTRIX bet — Ticket combiné (page plein écran)
// Page 100 % dédiée à l'affichage du dernier combiné généré :
// noms d'équipes et libellés de marchés JAMAIS tronqués, assez
// d'espace pour tout lire. Le ticket est passé via localStorage
// (voltrix_combo_ticket) au moment de la génération sur /combo.
// ============================================================

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Banknote,
  CalendarDays,
  CheckCircle2,
  Loader2,
  Share2,
  Sparkles,
  Ticket,
} from 'lucide-react';
import { PROFILES, riskBadge, type OddsSource, type RiskProfile } from '@/lib/combo';
import { loadComboTicket, type StoredComboTicket } from '@/lib/combo-store';
import {
  CURRENCIES,
  currencyByCode,
  fmtMoney,
  loadPreferredCurrency,
  savePreferredCurrency,
  transferCoupon,
  loadCoupons,
  saveCoupons,
} from '@/lib/cashout-store';
import { buildComboCard, shareCard } from '@/components/voltrix/share';
import { ConfidenceStars, ProbBar, TeamLogo } from '@/components/voltrix/shared';
import { cn } from '@/lib/utils';

const BANKROLL = 1000; // € fictifs pour la mise Kelly conseillée

// Formatters Intl mis en cache au niveau module (même convention que shared.tsx) :
// `new Intl.DateTimeFormat` est coûteux à construire — un exemplaire partagé au
// lieu d'un nouveau à chaque jambe/render du ticket.
const HOUR_FMT = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });
const DAY_FMT = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const DATETIME_FMT = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

export default function ComboTicketPage() {
  const [loading, setLoading] = useState(true);
  const [stored, setStored] = useState<StoredComboTicket | null>(null);
  const [sharing, setSharing] = useState(false);
  // ---------- Transfert vers la Vente (mise réelle + devise) ----------
  const [transferOpen, setTransferOpen] = useState(false);
  const [stake, setStake] = useState<string>('');
  const [currency, setCurrency] = useState<string>('EUR');
  const [transferError, setTransferError] = useState<string | null>(null);
  const [transferred, setTransferred] = useState(false);

  useEffect(() => {
    setStored(loadComboTicket());
    setCurrency(loadPreferredCurrency());
    setLoading(false);
  }, []);

  const openTransfer = () => {
    if (!stored) return;
    // déjà transféré ? (anti double-jeu : même ticket source actif dans la Vente)
    const already = loadCoupons().some((c) => c.status === 'active' && c.sourceSavedAt === stored.savedAt);
    setTransferred(already);
    setStake(String(currencyByCode(currency).defaultStake));
    setTransferError(null);
    setTransferOpen(true);
  };

  const onTransfer = () => {
    if (!stored) return;
    const s = parseFloat(stake.replace(',', '.'));
    if (!Number.isFinite(s) || s <= 0) {
      setTransferError('Indique la mise que tu as réellement jouée chez le bookmaker.');
      return;
    }
    const next = transferCoupon(loadCoupons(), {
      sourceSavedAt: stored.savedAt,
      matchDate: stored.matchDate,
      profile: stored.profile,
      targetOdds: stored.targetOdds,
      stake: s,
      currency,
      combo: stored.combo,
    });
    saveCoupons(next);
    savePreferredCurrency(currency);
    setTransferred(true);
    setTransferError(null);
  };

  const onShare = async () => {
    if (!stored) return;
    setSharing(true);
    try {
      const card = buildComboCard({
        legs: stored.combo.legs.map((l) => ({
          pick: l.pick,
          matchLabel: `${l.homeName} vs ${l.awayName}`,
          odds: l.odds,
        })),
        comboOdds: stored.combo.comboOdds,
        comboProb: stored.combo.comboProb,
        stakeLabel: `Mise conseillée ${Math.round(stored.combo.kelly * BANKROLL)} €`,
      });
      await shareCard(card);
    } catch {
      // partage annulé ou indisponible
    } finally {
      setSharing(false);
    }
  };

  const combo = stored?.combo ?? null;
  const stakeEur = combo ? Math.round(combo.kelly * BANKROLL) : 0;
  const profileCfg = stored ? (PROFILES[stored.profile as RiskProfile] ?? PROFILES.equilibre) : null;

  return (
    <div className='mx-auto flex min-h-[100dvh] max-w-[480px] flex-col bg-background'>
      {/* Header minimal — rien d'autre que le ticket sur cette page */}
      <header className='pt-safe sticky top-0 z-40 border-b border-white/[0.05] bg-[#0a0a0c]/90 px-5 pb-3 backdrop-blur-sm'>
        <div className='flex items-center gap-3 pt-3'>
          <Link
            href='/combo'
            className='flex h-9 w-9 items-center justify-center rounded-2xl bg-white/[0.06] text-foreground/70 transition-[color,background-color,transform] active:scale-95'
            aria-label='Retour au Combinator'
          >
            <ArrowLeft size={16} />
          </Link>
          <div className='flex items-center gap-2'>
            <span className='flex h-9 w-9 items-center justify-center rounded-2xl bg-[#e8ff00] volt-glow'>
              <Ticket size={18} className='text-black' />
            </span>
            <div className='leading-none'>
              <div className='font-display text-[16px] font-bold tracking-tight'>Ticket combiné</div>
              <div className='mt-1 text-[10px] text-muted-foreground'>Vue plein écran · noms complets</div>
            </div>
          </div>
        </div>
      </header>

      <main className='flex-1 px-5 pb-32 pt-4'>
        {loading && (
          <div className='flex flex-col items-center gap-2 rounded-3xl border border-dashed border-white/10 py-12'>
            <Loader2 size={22} className='animate-spin text-[#e8ff00]' />
            <p className='text-[13px] text-muted-foreground'>Chargement du ticket…</p>
          </div>
        )}

        {/* Aucun ticket enregistré sur cet appareil */}
        {!loading && !combo && (
          <div className='flex flex-col items-center gap-3 rounded-3xl border border-dashed border-white/10 py-12 text-center'>
            <CalendarDays size={26} className='text-white/15' />
            <p className='max-w-[260px] text-[13px] leading-relaxed text-muted-foreground'>
              Aucun ticket enregistré sur cet appareil. Génère un combiné pour l&apos;afficher ici
              en grand format, avec les noms complets.
            </p>
            <Link
              href='/combo'
              className='rounded-2xl bg-[#e8ff00] px-5 py-3 text-[14px] font-bold text-black volt-glow'
            >
              Créer un combiné
            </Link>
          </div>
        )}

        {!loading && combo && stored && (
          <>
            <div className='overflow-hidden rounded-3xl border border-[#e8ff00]/25 bg-[#141418]'>
              {/* Bandeau */}
              <div className='flex items-center justify-between bg-[#e8ff00] px-4 py-3'>
                <span className='flex items-center gap-1.5 text-[14px] font-bold text-black'>
                  <Ticket size={15} /> PARIS COMBINÉ
                </span>
                <span className='text-[12px] font-semibold text-black/70'>
                  {combo.legs.length} sélections
                </span>
              </div>

              {/* Métadonnées de génération */}
              <div className='border-b border-white/[0.05] px-4 py-2.5 text-[11px] leading-relaxed text-muted-foreground'>
                Généré le {formatDateTime(stored.savedAt)} · cible ×{stored.targetOdds} · profil{' '}
                {profileCfg?.emoji} {profileCfg?.label} · journée du {formatDay(stored.matchDate)}
                {combo.comboOdds < stored.targetOdds - 0.005 && (
                  <span className='font-semibold text-[#ffb3bc]'>
                    {' '}
                    · <span className='text-[#ff4d5e]'>sous l&apos;objectif</span> (échange manuel — régenère un combiné
                    pour retrouver ×{stored.targetOdds})
                  </span>
                )}
              </div>

              {/* Jambes — noms complets, retour à la ligne autorisé, aucune troncature */}
              <div className='divide-y divide-white/[0.05]'>
                {combo.legs.map((leg, i) => {
                  const badge = riskBadge(leg.prob);
                  return (
                    <div key={`${leg.matchId}-${leg.market}-${i}`} className='px-4 py-4'>
                      <div className='flex items-center gap-2'>
                        <span className='flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#e8ff00]/12 text-[11px] font-bold text-[#e8ff00]'>
                          {i + 1}
                        </span>
                        <span className='min-w-0 flex-1 break-words text-[10px] font-medium uppercase tracking-wide text-muted-foreground'>
                          {leg.leagueName}
                        </span>
                        <span className='shrink-0 text-[11px] tabular-nums text-muted-foreground'>
                          {formatHour(leg.matchDate)}
                        </span>
                      </div>

                      {/* Équipes : écusson + nom complet */}
                      <div className='mt-2.5 space-y-1.5'>
                        <div className='flex items-center gap-2'>
                          <TeamLogo src={leg.homeLogo ?? null} alt={leg.homeName} size={24} />
                          <span className='break-words text-[15px] font-bold leading-snug'>{leg.homeName}</span>
                        </div>
                        <div className='flex items-center gap-2'>
                          <TeamLogo src={leg.awayLogo ?? null} alt={leg.awayName} size={24} />
                          <span className='break-words text-[15px] font-bold leading-snug'>{leg.awayName}</span>
                        </div>
                      </div>

                      {/* Sélection complète */}
                      <div className='mt-3 rounded-2xl bg-white/[0.04] p-3'>
                        <div className='flex flex-wrap items-center gap-1.5'>
                          <span className='rounded-full bg-white/[0.07] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-foreground/70'>
                            {leg.market}
                          </span>
                          <RiskChip prob={leg.prob} />
                          <span className='ml-auto text-[10px] text-muted-foreground'>
                            {ODDS_SOURCE_LABEL[leg.oddsSource]}
                          </span>
                        </div>
                        <p className='mt-1.5 break-words text-[15px] font-semibold leading-snug'>{leg.pick}</p>
                        <div className='mt-2.5'>
                          <ProbBar
                            label={`Probabilité · risque ${badge.label.toLowerCase()}`}
                            value={leg.prob}
                            highlight
                          />
                        </div>
                      </div>

                      <div className='mt-2.5 flex items-center justify-between'>
                        <span className='text-[11px] text-muted-foreground'>Cote de la sélection</span>
                        <span className='text-[20px] font-bold tabular-nums text-[#e8ff00]'>
                          {leg.odds.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Totaux */}
              <div className='border-t border-[#e8ff00]/25 bg-[#e8ff00]/[0.06] px-4 py-5'>
                <div className='text-[11px] uppercase tracking-wider text-muted-foreground'>Côte totale</div>
                <div className='mt-1 text-[44px] font-bold leading-none tabular-nums text-[#e8ff00]'>
                  {combo.comboOdds.toFixed(2)}
                </div>
                <div className='mt-3.5'>
                  <ProbBar label='Probabilité de gain du ticket' value={combo.comboProb} highlight />
                </div>
                <div className='mt-3 grid grid-cols-3 gap-2 text-center'>
                  <div className='rounded-2xl bg-black/30 px-2 py-2.5'>
                    <div className='text-[10px] text-muted-foreground'>Valeur (EV)</div>
                    <div
                      className={cn(
                        'mt-0.5 text-[14px] font-bold tabular-nums',
                        combo.comboEV >= 0 ? 'text-[#a3e635]' : 'text-[#ff4d5e]'
                      )}
                    >
                      {combo.comboEV >= 0 ? '+' : ''}
                      {Math.round(combo.comboEV * 100)} %
                    </div>
                  </div>
                  <div className='rounded-2xl bg-black/30 px-2 py-2.5'>
                    <div className='text-[10px] text-muted-foreground'>Mise Kelly</div>
                    <div className='mt-0.5 text-[14px] font-bold tabular-nums'>{stakeEur} €</div>
                  </div>
                  <div className='rounded-2xl bg-black/30 px-2 py-2.5'>
                    <div className='text-[10px] text-muted-foreground'>Confiance</div>
                    <div className='mt-1.5 flex justify-center'>
                      <ConfidenceStars level={Math.round(combo.confidenceAvg)} size={11} />
                    </div>
                  </div>
                </div>
                <div className='mt-2.5 text-center text-[10px] text-muted-foreground'>
                  Mise conseillée (Kelly plafonnée à 10 %) · transfère le coupon dans la Vente pour suivre son prix de rachat
                </div>
              </div>
            </div>

            {/* Actions — v2 : le ticket se transfère vers la Vente (conseiller cash-out) */}
            <button onClick={openTransfer} className='mt-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-[#e8ff00] py-3.5 text-[14px] font-bold text-black transition-[color,background-color,opacity,transform] active:scale-[0.98] disabled:opacity-40 volt-glow'>
              <Banknote size={15} /> Transférer vers la Vente
            </button>
            {transferred && (
              <Link
                href='/vente'
                className='mt-2 flex w-full items-center justify-center gap-1.5 rounded-2xl border border-[#a3e635]/30 bg-[#a3e635]/[0.08] py-2.5 text-[12px] font-bold text-[#a3e635] transition active:scale-[0.98]'
              >
                <CheckCircle2 size={13} /> Coupon transféré — ouvrir la Vente
              </Link>
            )}
            <div className='mt-2.5 grid grid-cols-2 gap-2.5'>
              <Link
                href='/combo'
                className='flex items-center justify-center gap-2 rounded-2xl bg-white/[0.07] py-3.5 text-[14px] font-bold text-foreground transition-[color,background-color,opacity,transform] active:scale-[0.98]'
              >
                <Sparkles size={15} />
                Nouveau combiné
              </Link>
              <button
                onClick={onShare}
                disabled={sharing}
                className='flex items-center justify-center gap-2 rounded-2xl bg-white/[0.07] py-3.5 text-[14px] font-bold text-foreground transition-[color,background-color,opacity,transform] active:scale-[0.98] disabled:opacity-40'
              >
                {sharing ? <Loader2 size={15} className='animate-spin' /> : <Share2 size={15} />}
                Partager
              </button>
            </div>

            <div className='mt-3 flex items-start gap-2 rounded-2xl bg-white/[0.04] px-4 py-3 text-[11px] leading-relaxed text-muted-foreground'>
              <CheckCircle2 size={13} className='mt-0.5 shrink-0 text-[#e8ff00]' />
              Probabilités multipliées (matchs indépendants). Par défaut, seules les cotes réelles ou
              dérivées du marché sont utilisées : la cote totale est réellement obtenable chez ton
              bookmaker. Combiné informatif — joue toujours de façon responsable, 18+.
            </div>
          </>
        )}
      </main>

      {/* ---------- Feuille de transfert vers la Vente ---------- */}
      {transferOpen && stored && (
        <div
          className='fixed inset-0 z-[60] flex flex-col justify-end'
          role='dialog'
          aria-modal='true'
          aria-label='Transférer le ticket vers la Vente'
        >
          <div className='absolute inset-0 bg-black/72 backdrop-blur-[2px]' onClick={() => setTransferOpen(false)} />
          <div className='relative mx-auto flex max-h-[86dvh] w-full max-w-[480px] flex-col overflow-hidden rounded-t-[28px] border-t border-white/10 bg-[#141418]'>
            <div className='relative px-5 pb-3 pt-3'>
              <div className='mx-auto mb-3 h-1 w-10 rounded-full bg-white/15' />
              <button
                onClick={() => setTransferOpen(false)}
                aria-label='Fermer le panneau'
                className='absolute right-4 top-3 flex h-8 w-8 items-center justify-center rounded-xl bg-white/[0.06] text-muted-foreground transition active:scale-90'
              >
                ✕
              </button>
              <div className='text-[15px] font-bold'>Transférer vers la Vente</div>
              <p className='mt-1 text-[11.5px] leading-snug text-muted-foreground'>
                Tu as joué ce coupon chez ton bookmaker ? Indique la mise RÉELLEMENT engagée et ta devise :
                la valeur juste du coupon en dépendra.
              </p>
            </div>
            <div className='volt-scroll min-h-0 flex-1 overflow-y-auto px-5 pb-4'>
              <label htmlFor='stake-real' className='text-[11px] font-semibold text-muted-foreground'>
                Mise engagée
              </label>
              <input
                id='stake-real'
                inputMode='decimal'
                value={stake}
                onChange={(e) => setStake(e.target.value.replace(/[^0-9.,]/g, ''))}
                placeholder='ex : 100'
                className='mt-1.5 rounded-xl bg-white/[0.06] px-4 py-3 text-[22px] font-bold tabular-nums outline-none focus:ring-1 focus:ring-[#e8ff00]/50'
              />
              <div className='mt-3'>
                <div className='mb-1.5 text-[11px] font-semibold text-muted-foreground'>Ta devise</div>
                <div className='volt-scroll -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1'>
                  {CURRENCIES.map((c) => (
                    <button
                      key={c.code}
                      onClick={() => setCurrency(c.code)}
                      className={cn('shrink-0 whitespace-nowrap rounded-full bg-white/[0.06] px-3.5 py-1.5 text-[12px] font-semibold text-foreground/70 transition-[color,background-color,transform] active:scale-95', currency === c.code && 'bg-[#e8ff00] text-black')}
                      aria-pressed={currency === c.code}
                    >
                      {c.code} · {c.symbol}
                    </button>
                  ))}
                </div>
              </div>
              {transferred && (
                <div className='mt-3 flex items-center gap-2 rounded-2xl border border-[#a3e635]/30 bg-[#a3e635]/[0.08] px-4 py-3 text-[12.5px] font-semibold text-[#a3e635]'>
                  <CheckCircle2 size={15} className='shrink-0' /> Coupon transféré — retrouve-le dans la Vente.
                </div>
              )}
              {transferError && (
                <div className='mt-3 rounded-2xl bg-[#ff4d5e]/[0.08] px-4 py-3 text-[13px] text-[#ff9aa2]'>{transferError}</div>
              )}
              {transferred ? (
                <Link href='/vente' className='mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-[#e8ff00] py-3.5 text-[15px] font-bold text-black transition-[color,background-color,opacity,transform] active:scale-[0.98] disabled:opacity-40 volt-glow'>
                  <Banknote size={16} /> Ouvrir la Vente
                </Link>
              ) : (
                <button onClick={onTransfer} className='mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-[#e8ff00] py-3.5 text-[15px] font-bold text-black transition-[color,background-color,opacity,transform] active:scale-[0.98] disabled:opacity-40 volt-glow'>
                  <Banknote size={16} /> Transférer ce coupon
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- Helpers de formatage ----------

function formatHour(iso: string): string {
  return HOUR_FMT.format(new Date(iso));
}

function formatDay(iso: string): string {
  return DAY_FMT.format(new Date(iso));
}

function formatDateTime(ts: number): string {
  return DATETIME_FMT.format(new Date(ts));
}

const ODDS_SOURCE_LABEL: Record<OddsSource, string> = {
  real: 'cote réelle',
  market: 'cote marché',
  estimate: 'cote estimée',
};

function RiskChip({ prob }: { prob: number }) {
  const badge = riskBadge(prob);
  const cls =
    badge.tone === 'good'
      ? 'bg-[#a3e635]/15 text-[#a3e635]'
      : badge.tone === 'mid'
        ? 'bg-[#e8ff00]/15 text-[#e8ff00]'
        : 'bg-[#ff4d5e]/15 text-[#ff9aa2]';
  return (
    <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide', cls)}>
      {badge.label}
    </span>
  );
}
