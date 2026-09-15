'use client';

// ============================================================
// VOLTRIX bet — VENTE DE COUPON (conseiller cash-out)
// Remplace l'ancien Portefeuille : après avoir joué un coupon
// chez son bookmaker, l'utilisateur le transfère depuis le
// Combinator (/combo/ticket) avec sa mise réelle et sa devise.
// À tout moment il saisit le prix de rachat proposé → le
// système récupère l'état réel des matchs (ESPN), recalcule les
// probabilités en direct (Poisson live) et recommande VENDRE ou
// GARDER en comparant l'offre à la valeur juste du coupon.
// 100 % local : aucun argent réel, aucune donnée transmise.
// ============================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowDownRight,
  ArrowLeft,
  ArrowUpRight,
  BadgePercent,
  Banknote,
  CheckCircle2,
  ChevronRight,
  Clock,
  Loader2,
  MinusCircle,
  Scale,
  ShieldCheck,
  Sparkles,
  Tag,
  Trash2,
  XCircle,
  Zap,
} from 'lucide-react';
import { PROFILES, type ComboLeg } from '@/lib/combo';
import {
  CURRENCIES,
  currencyByCode,
  fmtMoney,
  loadCoupons,
  loadPreferredCurrency,
  markSold,
  recordEvaluation,
  removeCoupon,
  saveCoupons,
  savePreferredCurrency,
  transferCoupon,
  type CouponEvaluation,
  type SaleDecision,
  type TransferredCoupon,
} from '@/lib/cashout-store';
import { loadComboTicket, type StoredComboTicket } from '@/lib/combo-store';
import { TeamLogo } from '@/components/voltrix/shared';
import { VoltrixTabBar } from '@/components/voltrix/tab-bar';
import { cn } from '@/lib/utils';

// ---------- Décision → habillage ----------

const DECISION_UI: Record<SaleDecision, { label: string; cls: string; Icon: typeof Zap }> = {
  SELL: { label: 'VENDRE', cls: 'bg-[#a3e635]/15 text-[#a3e635] border-[#a3e635]/30', Icon: ArrowUpRight },
  HOLD: { label: 'GARDER', cls: 'bg-[#e8ff00]/12 text-[#e8ff00] border-[#e8ff00]/30', Icon: ShieldCheck },
  MAYBE: { label: 'ZONE GRISE', cls: 'bg-white/[0.08] text-foreground/80 border-white/15', Icon: Scale },
  LOST: { label: 'PERDU', cls: 'bg-[#ff4d5e]/12 text-[#ff9aa2] border-[#ff4d5e]/30', Icon: XCircle },
  WON: { label: 'GAGNÉ', cls: 'bg-[#a3e635]/15 text-[#a3e635] border-[#a3e635]/30', Icon: CheckCircle2 },
};

const PHASE_LABEL: Record<string, string> = {
  pre: 'À venir',
  in: 'EN COURS',
  post: 'Terminé',
  unknown: 'Statut ?',
};

// Formatters Intl en cache (coûteux à construire)
const HOUR_FMT = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });
const DATETIME_FMT = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const DAY_FMT = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

// Formattage de dates stockées en localStorage (schéma v1, possiblement
// ancien/corrompu) : `Intl.DateTimeFormat.format(Invalid Date)` lève un
// RangeError qui faisait planter TOUTE la page au boot (écran blanc
// « Application error »). Repli sûr : chaîne vide.
function fmtCouponDay(matchDate: string | null | undefined): string {
  const d = new Date(`${matchDate ?? ''}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? '' : DAY_FMT.format(d);
}

function fmtSoldAt(soldAt: number | null | undefined): string {
  if (typeof soldAt !== 'number' || !Number.isFinite(soldAt)) return '';
  const d = new Date(soldAt);
  return Number.isNaN(d.getTime()) ? '' : DATETIME_FMT.format(d);
}

export default function VentePage() {
  const [mounted, setMounted] = useState(false);
  const [coupons, setCoupons] = useState<TransferredCoupon[]>([]);
  // Dernier ticket Combinator sur l'appareil (import possible ici aussi)
  const [storedTicket, setStoredTicket] = useState<StoredComboTicket | null>(null);
  // Feuille d'évaluation : coupon courant + saisie du prix proposé
  const [evalCoupon, setEvalCoupon] = useState<TransferredCoupon | null>(null);
  const [offered, setOffered] = useState<string>('');
  const [currency, setCurrency] = useState<string>('EUR');
  const [analyzing, setAnalyzing] = useState(false);
  const [evalError, setEvalError] = useState<string | null>(null);
  const [result, setResult] = useState<(CouponEvaluation & { legs: LegReportLite[]; message: string }) | null>(null);
  // Feuille de transfert (mise + devise du dernier ticket Combinator)
  const [transferOpen, setTransferOpen] = useState(false);
  const [stake, setStake] = useState<string>('');
  const [transferError, setTransferError] = useState<string | null>(null);
  // Confirmation de suppression (id en attente)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      await Promise.resolve();
      setMounted(true);
      setCoupons(loadCoupons());
      const cur = loadPreferredCurrency();
      setCurrency(cur);
      const t = loadComboTicket();
      setStoredTicket(t);
      setStake(String(currencyByCode(cur).defaultStake));
    })();
  }, []);

  const persist = useCallback((next: TransferredCoupon[]) => {
    setCoupons(next);
    saveCoupons(next);
  }, []);

  // ---------- Évaluation d'une offre ----------

  const openEval = useCallback((c: TransferredCoupon) => {
    setEvalCoupon(c);
    setResult(null);
    setEvalError(null);
    setOffered(c.lastEval ? String(c.lastEval.offered) : '');
    setCurrency(c.currency);
  }, []);

  const onAnalyze = useCallback(async () => {
    if (!evalCoupon) return;
    const price = parseFloat(offered.replace(',', '.'));
    if (!Number.isFinite(price) || price < 0) {
      setEvalError('Entre le prix proposé par le bookmaker (0 ou plus).');
      return;
    }
    setAnalyzing(true);
    setEvalError(null);
    try {
      const res = await fetch('/api/cashout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stake: evalCoupon.stake,
          totalOdds: evalCoupon.combo.comboOdds,
          offered: price,
          legs: evalCoupon.combo.legs.map((l) => ({
            matchId: l.matchId,
            leagueCode: l.leagueCode ?? '',
            matchDate: l.matchDate,
            market: l.market,
            pick: l.pick,
            prob: l.prob,
            homeName: l.homeName,
            awayName: l.awayName,
          })),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setEvalError(json.error ?? 'Analyse impossible pour le moment.');
        return;
      }
      const ev: CouponEvaluation = {
        t: json.asOf ?? Date.now(),
        offered: price,
        currency: evalCoupon.currency,
        fairValue: json.fairValue,
        jointProb: json.jointProb,
        decision: json.decision,
      };
      setResult({ ...ev, legs: json.legs ?? [], message: json.message ?? '' });
      persist(recordEvaluation(coupons, evalCoupon.id, ev));
    } catch {
      setEvalError('Réseau indisponible — réessaie dans un instant.');
    } finally {
      setAnalyzing(false);
    }
  }, [evalCoupon, offered, coupons, persist]);

  // ---------- Transfert (depuis /combo/ticket ou cette page) ----------

  const onTransfer = useCallback(() => {
    const t = storedTicket;
    if (!t) return;
    const s = parseFloat(stake.replace(',', '.'));
    if (!Number.isFinite(s) || s <= 0) {
      setTransferError('Indique la mise que tu as réellement jouée.');
      return;
    }
    const next = transferCoupon(coupons, {
      sourceSavedAt: t.savedAt,
      matchDate: t.matchDate,
      profile: t.profile,
      targetOdds: t.targetOdds,
      stake: s,
      currency,
      combo: t.combo,
    });
    if (next === coupons) {
      setTransferError('Ticket invalide.');
      return;
    }
    savePreferredCurrency(currency);
    persist(next);
    setTransferOpen(false);
    setStake('');
    setTransferError(null);
  }, [storedTicket, stake, currency, coupons, persist]);

  const onChangeEvalCurrency = useCallback(
    (code: string) => {
      setCurrency(code);
      savePreferredCurrency(code);
      if (evalCoupon) {
        // la devise du coupon suit la préférence (montants inchangés)
        persist(coupons.map((c) => (c.id === evalCoupon.id ? { ...c, currency: code } : c)));
      }
    },
    [evalCoupon, coupons, persist]
  );

  // ---------- Dérivés ----------

  const active = useMemo(() => coupons.filter((c) => c.status === 'active'), [coupons]);
  const sold = useMemo(() => coupons.filter((c) => c.status === 'sold'), [coupons]);
  /** Dernier ticket Combinator pas encore transféré → carte d'import. */
  const importable = useMemo(
    () => (storedTicket && !coupons.some((c) => c.sourceSavedAt === storedTicket.savedAt && c.status === 'active') ? storedTicket : null),
    [storedTicket, coupons]
  );

  const offeredNum = evalCoupon ? parseFloat(offered.replace(',', '.')) : NaN;
  const offeredValid = Number.isFinite(offeredNum) && offeredNum >= 0;

  // ============================================================
  return (
    <div className='mx-auto flex min-h-[100dvh] max-w-[480px] flex-col bg-background'>
      {/* ---------- Header ---------- */}
      <header className='pt-safe sticky top-0 z-40 border-b border-white/[0.05] bg-[#0a0a0c]/90 px-5 pb-3 backdrop-blur-sm'>
        <div className='flex items-center gap-3 pt-3'>
          <span className='flex h-9 w-9 items-center justify-center rounded-2xl bg-[#e8ff00] volt-glow'>
            <Banknote size={18} className='text-black' />
          </span>
          <div className='min-w-0 leading-none'>
            <div className='font-display text-[17px] font-bold tracking-tight'>Vente de coupon</div>
            <div className='mt-1 text-[10px] text-muted-foreground'>Vendre ou garder ? Les maths décident</div>
          </div>
        </div>
      </header>

      <main className='flex-1 px-5 pb-32 pt-4'>
        {/* Explication */}
        <div className='rounded-3xl border border-[#e8ff00]/20 bg-[#e8ff00]/[0.05] p-4'>
          <div className='flex items-center gap-2'>
            <Tag size={15} className='text-[#e8ff00]' />
            <span className='text-[14px] font-bold'>Ton coupon vaut quoi, maintenant ?</span>
          </div>
          <p className='mt-1.5 text-[12px] leading-relaxed text-muted-foreground'>
            Les bookmakers te rachètent ton coupon avant la fin (tu joues 100 et il te propose 25 pour le racheter).
            Transfère ici le coupon joué, saisis l&apos;offre : VOLTRIX analyse les matchs en direct et te dit si
            l&apos;offre est <span className='font-semibold text-[#a3e635]'>bonne (vends)</span> ou{' '}
            <span className='font-semibold text-[#e8ff00]'>trop basse (garde)</span>.
          </p>
        </div>

        {/* Coupons en cours */}
        {mounted && importable && (
          <section className='mt-4'>
            <button
              onClick={() => {
                setStake(String(currencyByCode(currency).defaultStake));
                setTransferOpen(true);
              }}
              className='rounded-3xl border border-[#e8ff00]/20 bg-[#e8ff00]/[0.05] flex w-full items-center gap-3 p-4 text-left transition-[color,background-color,border-color,transform] active:scale-[0.985]'
            >
              <span className='flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[#e8ff00] shadow-[0_0_20px_rgba(232,255,0,0.25)]'>
                <Banknote size={18} className='text-black' />
              </span>
              <span className='min-w-0 flex-1'>
                <span className='block text-[14px] font-bold'>Transférer le dernier ticket</span>
                <span className='mt-0.5 block truncate text-[11.5px] text-muted-foreground'>
                  Combinator · ×{importable.combo.comboOdds.toFixed(2)} · {importable.combo.legs.length} sélections — indique ta mise réelle
                </span>
              </span>
              <ChevronRight size={17} className='shrink-0 text-[#e8ff00]' />
            </button>
          </section>
        )}

        {mounted && active.length > 0 && (
          <section className='mt-5'>
            <div className='text-[11px] font-semibold text-muted-foreground mb-2'>En cours · {active.length}</div>
            <div className='space-y-3'>
              {active.map((c) => (
                <CouponCard
                  key={c.id}
                  coupon={c}
                  onEvaluate={() => openEval(c)}
                  onDelete={() => {
                    if (confirmDelete === c.id) {
                      persist(removeCoupon(coupons, c.id));
                      setConfirmDelete(null);
                    } else {
                      setConfirmDelete(c.id);
                      setTimeout(() => setConfirmDelete((cur) => (cur === c.id ? null : cur)), 3500);
                    }
                  }}
                  deleteArmed={confirmDelete === c.id}
                />
              ))}
            </div>
          </section>
        )}

        {/* Vendus */}
        {mounted && sold.length > 0 && (
          <section className='mt-6'>
            <div className='text-[11px] font-semibold text-muted-foreground mb-2'>Vendus · {sold.length}</div>
            <div className='space-y-2.5'>
              {sold.map((c) => (
                <SoldCard key={c.id} coupon={c} />
              ))}
            </div>
          </section>
        )}

        {/* État vide */}
        {mounted && coupons.length === 0 && (
          <div className='mt-6 flex flex-col items-center gap-3 rounded-3xl border border-dashed border-white/10 py-12 text-center'>
            <Banknote size={30} className='text-white/15' />
            <p className='max-w-[280px] text-[13px] leading-relaxed text-muted-foreground'>
              Aucun coupon transféré. Génère un combiné dans le Combinator puis appuie sur{' '}
              <span className='font-semibold text-foreground'>« Transférer vers la Vente »</span> sur le ticket.
            </p>
            <Link
              href='/combo'
              className='mt-1 flex items-center justify-center gap-2 rounded-2xl bg-[#e8ff00] px-5 py-3 text-[14px] font-bold text-black transition-[color,background-color,opacity,transform] active:scale-[0.98] volt-glow'
            >
              <Sparkles size={15} /> Créer un combiné
            </Link>
          </div>
        )}

        {/* Bandeau 18+ */}
        <div className='mt-6 flex items-start gap-2 rounded-2xl bg-white/[0.04] px-4 py-3 text-[11px] leading-relaxed text-muted-foreground'>
          <ShieldCheck size={13} className='mt-0.5 shrink-0 text-[#e8ff00]' />
          Outil d&apos;aide à la décision, informatif : la valeur juste est une estimation probabiliste, pas une
          certitude. Aucun argent réel n&apos;est géré ici. Joue responsable, 18+.
        </div>
      </main>

      {/* ---------- Feuille d'évaluation ---------- */}
      {evalCoupon && (
        <div className='fixed inset-0 z-[60] flex flex-col justify-end' role='dialog' aria-modal='true' aria-label='Évaluer une offre de rachat'>
          <div className='absolute inset-0 bg-black/72 backdrop-blur-[2px]' onClick={() => setEvalCoupon(null)} />
          <div className='relative mx-auto flex max-h-[86dvh] w-full max-w-[480px] flex-col overflow-hidden rounded-t-[28px] border-t border-white/10 bg-[#141418]'>
            {/* Poignée + en-tête */}
            <div className='relative px-5 pb-3 pt-3'>
              <div className='mx-auto mb-3 h-1 w-10 rounded-full bg-white/15' />
              <button
                onClick={() => setEvalCoupon(null)}
                aria-label='Fermer le panneau'
                className='absolute right-4 top-3 flex h-8 w-8 items-center justify-center rounded-xl bg-white/[0.06] text-muted-foreground transition active:scale-90'
              >
                ✕
              </button>
              <div className='text-[15px] font-bold'>Prix de rachat proposé</div>
              <p className='mt-1 text-[11.5px] leading-snug text-muted-foreground'>
                {evalCoupon.combo.legs.length} sélections · cote ×{evalCoupon.combo.comboOdds.toFixed(2)} · mise{' '}
                {fmtMoney(evalCoupon.stake, evalCoupon.currency)}
              </p>
            </div>

            <div className='volt-scroll min-h-0 flex-1 overflow-y-auto px-5 pb-4'>
              {/* Saisie du prix + devise */}
              <div className='flex items-end gap-2.5'>
                <div className='flex-1'>
                  <label htmlFor='offered-price' className='text-[11px] font-semibold text-muted-foreground'>
                    Offre du bookmaker
                  </label>
                  <input
                    id='offered-price'
                    inputMode='decimal'
                    value={offered}
                    onChange={(e) => setOffered(e.target.value.replace(/[^0-9.,]/g, ''))}
                    placeholder='ex : 25'
                    className='mt-1.5 rounded-xl bg-white/[0.06] px-4 py-3 text-[22px] font-bold tabular-nums outline-none focus:ring-1 focus:ring-[#e8ff00]/50'
                  />
                </div>
              </div>

              {/* Sélecteur de devise */}
              <div className='mt-3'>
                <div className='text-[11px] font-semibold text-muted-foreground mb-1.5'>Ta devise</div>
                <div className='volt-scroll -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1'>
                  {CURRENCIES.map((c) => (
                    <button
                      key={c.code}
                      onClick={() => onChangeEvalCurrency(c.code)}
                      className={cn('shrink-0 whitespace-nowrap rounded-full bg-white/[0.06] px-3.5 py-1.5 text-[12px] font-semibold text-foreground/70 transition-[color,background-color,transform] active:scale-95', currency === c.code && 'bg-[#e8ff00] text-black')}
                      aria-pressed={currency === c.code}
                    >
                      {c.code} · {c.symbol}
                    </button>
                  ))}
                </div>
              </div>

              <button
                onClick={onAnalyze}
                disabled={analyzing || !offeredValid}
                className='mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-[#e8ff00] py-3.5 text-[15px] font-bold text-black transition-[color,background-color,opacity,transform] active:scale-[0.98] disabled:opacity-40 volt-glow'
              >
                {analyzing ? <Loader2 size={17} className='animate-spin' /> : <Zap size={16} />}
                {analyzing ? 'Analyse des matchs en direct…' : 'Faut-il vendre ? Analyser'}
              </button>

              {evalError && (
                <div className='mt-3 rounded-2xl bg-[#ff4d5e]/[0.08] px-4 py-3 text-[13px] text-[#ff9aa2]'>{evalError}</div>
              )}

              {/* Résultat */}
              {result && (
                <div className='mt-4'>
                  {/* Verdict */}
                  <div
                    className={cn(
                      'flex items-center justify-between rounded-3xl border px-4 py-4',
                      DECISION_UI[result.decision].cls
                    )}
                  >
                    <div className='flex items-center gap-2.5'>
                      {(() => {
                        const Icon = DECISION_UI[result.decision].Icon;
                        return <Icon size={22} />;
                      })()}
                      <span className='font-display text-[22px] font-bold tracking-tight'>{DECISION_UI[result.decision].label}</span>
                    </div>
                    <div className='text-right'>
                      <div className='text-[10px] uppercase tracking-wider opacity-70'>Valeur juste</div>
                      <div className='tabular-nums text-[17px] font-bold'>{fmtMoney(result.fairValue, currency)}</div>
                    </div>
                  </div>

                  <p className='mt-2.5 text-[12.5px] leading-relaxed text-foreground/85'>{result.message}</p>

                  {/* Task 21-c : transparence du modèle d'estimation */}
                  <p className='mt-1.5 text-[11px] leading-snug text-muted-foreground'>
                    Estimation expérimentale — modèle live simplifié, ne constitue pas une valorisation de marché.
                  </p>

                  {/* Comparaison offre vs valeur */}
                  {result.fairValue > 0 && result.decision !== 'LOST' && (
                    <div className='mt-3.5 rounded-3xl bg-[#141418] p-3.5'>
                      <OfferCompare offered={result.offered} fairValue={result.fairValue} currency={currency} />
                    </div>
                  )}

                  {/* Proba combinée restante */}
                  <div className='mt-2.5 flex items-center justify-between rounded-2xl bg-white/[0.04] px-4 py-2.5 text-[12px]'>
                    <span className='flex items-center gap-1.5 text-muted-foreground'>
                      <BadgePercent size={13} className='text-[#e8ff00]' /> Probabilité restante de tout gagner
                    </span>
                    <span className='font-bold tabular-nums text-[13px]'>{Math.round(result.jointProb * 100)} %</span>
                  </div>

                  {/* Détail par jambe */}
                  <div className='text-[11px] font-semibold text-muted-foreground mt-4 mb-2'>Les matchs, un par un</div>
                  <div className='space-y-2'>
                    {result.legs.map((leg, i) => (
                      <LegStateRow key={`${leg.matchId}-${i}`} leg={leg} />
                    ))}
                  </div>

                  {/* Vendre maintenant (prix saisi) */}
                  {evalCoupon.status === 'active' && result.decision !== 'LOST' && (
                    <button
                      onClick={() => {
                        persist(markSold(coupons, evalCoupon.id, result.offered));
                        setEvalCoupon(null);
                        setResult(null);
                      }}
                      className='mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border border-[#a3e635]/30 bg-[#a3e635]/[0.08] py-3 text-[13px] font-bold text-[#a3e635] transition-[color,background-color,opacity,transform] active:scale-[0.98]'
                    >
                      <Tag size={14} /> J&apos;ai vendu pour {fmtMoney(result.offered, currency)} — l&apos;enregistrer
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ---------- Feuille de transfert direct ---------- */}
      {transferOpen && storedTicket && (
        <div className='fixed inset-0 z-[60] flex flex-col justify-end' role='dialog' aria-modal='true' aria-label='Transférer le ticket vers la Vente'>
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
                Indique la mise que tu as REELLEMENT jouée chez ton bookmaker : la valeur juste du coupon en dépend.
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
                <div className='text-[11px] font-semibold text-muted-foreground mb-1.5'>Ta devise</div>
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
              {transferError && (
                <div className='mt-3 rounded-2xl bg-[#ff4d5e]/[0.08] px-4 py-3 text-[13px] text-[#ff9aa2]'>{transferError}</div>
              )}
              <button onClick={onTransfer} className='mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-[#e8ff00] py-3.5 text-[15px] font-bold text-black transition-[color,background-color,opacity,transform] active:scale-[0.98] disabled:opacity-40 volt-glow'>
                <Banknote size={16} /> Transférer ce coupon
              </button>
            </div>
          </div>
        </div>
      )}

      <VoltrixTabBar />
    </div>
  );
}

// ============================================================
// Carte d'un coupon en cours
// ============================================================

function CouponCard({
  coupon,
  onEvaluate,
  onDelete,
  deleteArmed,
}: {
  coupon: TransferredCoupon;
  onEvaluate: () => void;
  onDelete: () => void;
  deleteArmed: boolean;
}) {
  const potentialGain = coupon.stake * coupon.combo.comboOdds;
  const cfg = PROFILES[coupon.profile] ?? PROFILES.equilibre;
  return (
    <div className='overflow-hidden rounded-3xl bg-[#141418]'>
      {/* En-tête */}
      <div className='flex items-center justify-between px-4 pt-3.5'>
        <div className='flex items-center gap-2 text-[11px] text-muted-foreground'>
          <span className='rounded-lg bg-[#e8ff00]/10 px-2 py-[3px] text-[10px] font-bold text-[#e8ff00]'>
            ×{coupon.combo.comboOdds.toFixed(2)}
          </span>
          <span className='truncate'>
            {coupon.combo.legs.length} sélections · {cfg.emoji} {cfg.label}
            {fmtCouponDay(coupon.matchDate) ? ` · ${fmtCouponDay(coupon.matchDate)}` : ''}
          </span>
        </div>
        <button
          onClick={onDelete}
          aria-label={deleteArmed ? 'Confirmer la suppression' : 'Supprimer ce coupon'}
          className={cn(
            'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition active:scale-90',
            deleteArmed ? 'bg-[#ff4d5e] text-white' : 'bg-white/[0.05] text-muted-foreground'
          )}
        >
          <Trash2 size={13} />
        </button>
      </div>

      {/* Jambes compactes */}
      <div className='mt-2.5 space-y-1.5 px-4'>
        {coupon.combo.legs.map((leg, i) => (
          <div key={`${leg.matchId}-${i}`} className='flex items-center gap-2'>
            <TeamLogo src={leg.homeLogo ?? null} alt={leg.homeName} size={16} />
            <span className='min-w-0 flex-1 truncate text-[12px] text-foreground/85'>
              {leg.pick}
              <span className='text-muted-foreground'>
                {' '}
                · {leg.homeName.slice(0, 12)}–{leg.awayName.slice(0, 12)}
              </span>
            </span>
            <span className='shrink-0 text-[11.5px] font-bold tabular-nums text-foreground/70'>{leg.odds.toFixed(2)}</span>
          </div>
        ))}
      </div>

      {/* Totaux + action */}
      <div className='mt-3 flex items-center justify-between gap-3 border-t border-white/[0.06] bg-black/25 px-4 py-3'>
        <div className='min-w-0'>
          <div className='text-[11px] font-semibold text-muted-foreground'>Mise {fmtMoney(coupon.stake, coupon.currency)}</div>
          <div className='mt-0.5 truncate text-[11.5px] text-muted-foreground'>
            Gain si tout passe : <span className='font-bold text-[#e8ff00]'>{fmtMoney(potentialGain, coupon.currency)}</span>
            {coupon.lastEval && (
              <> · dernière analyse : <span className='font-semibold text-foreground/80'>{DECISION_UI[coupon.lastEval.decision].label}</span></>
            )}
          </div>
        </div>
        <button onClick={onEvaluate} className='shrink-0 rounded-2xl bg-[#e8ff00] px-4 py-2.5 text-[13px] font-bold text-black transition-[color,background-color,opacity,transform] active:scale-[0.98] volt-glow'>
          <Scale size={14} /> Évaluer une offre
        </button>
      </div>
    </div>
  );
}

// ============================================================
// Carte d'un coupon vendu
// ============================================================

function SoldCard({ coupon }: { coupon: TransferredCoupon }) {
  const potential = coupon.stake * coupon.combo.comboOdds;
  const soldPrice = coupon.soldPrice ?? 0;
  const pnl = soldPrice - coupon.stake;
  const keptPct = potential > 0 ? soldPrice / potential : 0;
  return (
    <div className='rounded-3xl bg-[#141418] flex items-center gap-3 p-3.5 opacity-90'>
      <span
        className={cn(
          'flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl',
          pnl > 0 ? 'bg-[#a3e635]/12 text-[#a3e635]' : pnl === 0 ? 'bg-white/[0.07] text-muted-foreground' : 'bg-[#ff4d5e]/12 text-[#ff9aa2]'
        )}
      >
        {pnl > 0 ? <ArrowUpRight size={18} /> : pnl === 0 ? <MinusCircle size={18} /> : <ArrowDownRight size={18} />}
      </span>
      <div className='min-w-0 flex-1'>
        <div className='text-[13px] font-bold'>
          Vendu {fmtMoney(soldPrice, coupon.currency)}
          <span className='ml-1.5 font-normal text-muted-foreground'>
            ({Math.round(keptPct * 100)} % du gain max)
          </span>
        </div>
        <div className='truncate text-[11px] text-muted-foreground'>
          {coupon.combo.legs.length} sélections · ×{coupon.combo.comboOdds.toFixed(2)}{' '}
          {fmtSoldAt(coupon.soldAt) ? `· ${fmtSoldAt(coupon.soldAt)}` : ''}
        </div>
      </div>
      <div className='shrink-0 text-right'>
        <div className='text-[10px] uppercase tracking-wider text-muted-foreground'>Bilan</div>
        <div className={cn('tabular-nums text-[13px] font-bold', pnl >= 0 ? 'text-[#a3e635]' : 'text-[#ff9aa2]')}>
          {pnl >= 0 ? '+' : ''}
          {fmtMoney(pnl, coupon.currency)}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Comparaison offre vs valeur juste (barre)
// ============================================================

function OfferCompare({ offered, fairValue, currency }: { offered: number; fairValue: number; currency: string }) {
  const max = Math.max(offered, fairValue, 0.01);
  const offPct = (offered / max) * 100;
  const fairPct = (fairValue / max) * 100;
  return (
    <div>
      <div className='flex items-baseline justify-between'>
        <span className='text-[11px] font-semibold text-muted-foreground'>Offre vs valeur juste</span>
        <span className='text-[11px] font-semibold text-muted-foreground'>
          écart{' '}
          <span className={cn('font-bold', offered >= fairValue ? 'text-[#a3e635]' : 'text-[#ff9aa2]')}>
            {offered >= fairValue ? '+' : ''}
            {Math.round((offered / fairValue - 1) * 100)} %
          </span>
        </span>
      </div>
      <div className='mt-2.5 space-y-2'>
        <div>
          <div className='mb-1 flex justify-between text-[11px]'>
            <span className='text-muted-foreground'>Offre bookmaker</span>
            <span className='font-bold tabular-nums'>{fmtMoney(offered, currency)}</span>
          </div>
          <div className='h-2 overflow-hidden rounded-full bg-white/[0.06]'>
            <div className='volt-bar h-full rounded-full bg-white/45' style={{ width: `${Math.max(offPct, 2)}%` }} />
          </div>
        </div>
        <div>
          <div className='mb-1 flex justify-between text-[11px]'>
            <span className='text-muted-foreground'>Valeur juste VOLTRIX</span>
            <span className='font-bold tabular-nums text-[#e8ff00]'>{fmtMoney(fairValue, currency)}</span>
          </div>
          <div className='h-2 overflow-hidden rounded-full bg-white/[0.06]'>
            <div className='volt-bar h-full rounded-full bg-[#e8ff00]' style={{ width: `${Math.max(fairPct, 2)}%` }} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Ligne d'état d'une jambe (résultat d'évaluation)
// ============================================================

interface LegReportLite {
  matchId: string;
  market: string;
  pick: string;
  phase: 'pre' | 'in' | 'post' | 'unknown';
  statusDetail: string;
  score: string | null;
  verdict: 'WIN' | 'LOSE' | 'VOID' | 'PENDING';
  pInit: number;
  pNow: number;
  note: string;
}

function LegStateRow({ leg }: { leg: LegReportLite }) {
  const delta = leg.pNow - leg.pInit;
  const live = leg.phase === 'in';
  return (
    <div className='rounded-3xl bg-[#141418] p-3'>
      <div className='flex items-center gap-2'>
        <span
          className={cn(
            'shrink-0 rounded-lg px-2 py-[3px] text-[9.5px] font-bold uppercase tracking-wide',
            live ? 'bg-[#ff4d5e]/15 text-[#ff4d5e]' : leg.phase === 'post' ? 'bg-white/[0.08] text-muted-foreground' : 'bg-[#e8ff00]/10 text-[#e8ff00]'
          )}
        >
          {PHASE_LABEL[leg.phase] ?? leg.phase}
        </span>
        <span className='min-w-0 flex-1 truncate text-[12.5px] font-semibold'>{leg.pick}</span>
        {leg.verdict === 'WIN' && <CheckCircle2 size={15} className='shrink-0 text-[#a3e635]' />}
        {leg.verdict === 'LOSE' && <XCircle size={15} className='shrink-0 text-[#ff4d5e]' />}
      </div>
      <div className='mt-1.5 flex items-center justify-between gap-2'>
        <span className='min-w-0 truncate text-[10.5px] text-muted-foreground'>
          {leg.score ? `Score ${leg.score} · ` : ''}
          {leg.note}
        </span>
        <span className='shrink-0 text-[12px] font-bold tabular-nums'>
          {Math.round(leg.pNow * 100)} %
          {Math.abs(delta) >= 0.01 && (
            <span className={cn('ml-1 text-[10px] font-semibold', delta > 0 ? 'text-[#a3e635]' : 'text-[#ff9aa2]')}>
              {delta > 0 ? '+' : ''}
              {Math.round(delta * 100)}
            </span>
          )}
        </span>
      </div>
    </div>
  );
}
