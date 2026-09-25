'use client';

// ============================================================
// VOLTRIX bet — Portefeuille (Bankroll Manager)
// Banque virtuelle : place les tickets générés par le
// Combinator, suis leur résolution (scores ESPN) et mesure ta
// performance : solde, courbe, P&L, ROI, stats par profil.
// 100 % simulé — aucun argent réel, tout reste sur l'appareil.
// ============================================================

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
  Target,
  Ticket,
  TrendingUp,
  Wallet,
  XCircle,
} from 'lucide-react';
import { PROFILES, type RiskProfile } from '@/lib/combo';
import {
  DEFAULT_BANKROLL,
  applyResolutions,
  computeStats,
  dueTickets,
  fmtEur,
  freshBankroll,
  loadBankroll,
  placeTicket,
  resetBankroll,
  resolveLegPayload,
  saveBankroll,
  settleTicket,
  TICKET_STATUS_LABEL,
  PROFILE_ORDER,
  type BankrollState,
  type LegResult,
  type PlacedTicket,
} from '@/lib/bankroll';
import { loadComboTicket } from '@/lib/combo-store';
import { TeamLogo } from '@/components/voltrix/shared';
import { VoltrixTabBar } from '@/components/voltrix/tab-bar';
import { cn } from '@/lib/utils';

type StoredTicket = NonNullable<ReturnType<typeof loadComboTicket>>;

export default function PortefeuillePage() {
  const [mounted, setMounted] = useState(false);
  const [state, setState] = useState<BankrollState>(() => freshBankroll(DEFAULT_BANKROLL));
  const [ticket, setTicket] = useState<StoredTicket | null>(null);
  const [stake, setStake] = useState<string>('');
  const [stakeError, setStakeError] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [editCapital, setEditCapital] = useState(false);
  const [capitalInput, setCapitalInput] = useState<string>('');
  const [confirmReset, setConfirmReset] = useState(false);
  const resolveGuard = useRef(false);
  const lastAutoResolve = useRef(0);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Re-tentative BORNÉE : au plus UNE par montage (retryArmed), programmée
  // quand une résolution silencieuse laisse des tickets échus en cours.
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryArmed = useRef(false);
  // Dernier état connu, lisible par référence : la résolution est asynchrone et
  // l'état peut changer (pari placé) pendant le await — on ne doit jamais
  // appliquer les verdicts sur une fermeture obsolète.
  const stateRef = useRef(state);
  stateRef.current = state;

  // ---------- Chargement local (montage) ----------
  useEffect(() => {
    let alive = true;
    (async () => {
      await Promise.resolve();
      if (!alive) return;
      setMounted(true);
      const bs = loadBankroll();
      setState(bs);
      setCapitalInput(String(bs.start));
      setTicket(loadComboTicket());
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Nettoyage des timers (double confirmation « Réinitialiser » + re-tentative
  // de résolution) au démontage.
  useEffect(() => {
    return () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
      if (retryTimer.current) clearTimeout(retryTimer.current);
    };
  }, []);

  const mutate = useCallback((next: BankrollState | null) => {
    if (!next) return;
    setState(next);
    saveBankroll(next);
  }, []);

  // ---------- Résolution automatique des tickets échus ----------
  const resolvePending = useCallback(
    async (silent: boolean) => {
      if (resolveGuard.current) return;
      // Anti-tempête : en automatique (silencieux), 1 vérification max par minute.
      if (silent && Date.now() - lastAutoResolve.current < 60_000) return;
      const today = new Date().toISOString().slice(0, 10);
      // Tickets échus : matchDate normalisé (10 premiers caractères) — un vieux
      // ticket stocké en ISO complet « 2026-09-04T19:00Z » n'était JAMAIS échu
      // le jour même (comparaison lexicographique contre « 2026-09-04 »).
      const due = dueTickets(stateRef.current, today);
      if (due.length === 0) return;
      lastAutoResolve.current = Date.now();
      resolveGuard.current = true;
      if (!silent) setResolving(true);
      try {
        // TOUTES les jambes partent (leagueCode '' pour les vieux tickets →
        // fallback côté API) ; matchDate tronqué à YYYY-MM-DD pour le scoreboard.
        const legs = resolveLegPayload(due);
        let results: LegResult[] = [];
        if (legs.length > 0) {
          const res = await fetch('/api/bankroll/resolve', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ legs }),
          });
          const json = await res.json();
          results = (json.results ?? []).map(
            (r: { matchId: string; market: string; pick: string; status: LegResult['status']; score: string | null }) => ({
              matchId: r.matchId,
              market: r.market,
              pick: r.pick,
              status: r.status,
              score: r.score,
            })
          );
        }
        const settled: PlacedTicket[] = due.map((t) => settleTicket(t, results).ticket);
        // On repart du dernier état (stateRef), pas de la fermeture : un pari
        // placé pendant la requête n'est jamais écrasé par la résolution.
        mutate(applyResolutions(stateRef.current, settled));
        // Re-tentative unique et bornée : si des tickets échus restent en cours
        // (ESPN n'a pas encore jugé les matchs), on réessaie UNE fois dans 75 s
        // (au-delà du cooldown de 60 s). Pas de cascade : retryArmed interdit
        // toute re-programmation ; le ↻ manuel et le re-montage prennent le relais.
        if (silent && !retryArmed.current && settled.some((t) => t.status === 'pending')) {
          retryArmed.current = true;
          retryTimer.current = setTimeout(() => {
            retryTimer.current = null;
            void resolveRef.current(true);
          }, 75_000);
        }
      } catch {
        // réseau indisponible : on retentera au prochain montage / clic
      } finally {
        resolveGuard.current = false;
        if (!silent) setResolving(false); // en silencieux, resolving n'a jamais été passé à true
      }
    },
    [mutate]
  );

  // Dernière version du callback, lisible par référence : permet de lancer la
  // résolution auto sans mettre resolvePending dans les deps de l'effet.
  const resolveRef = useRef(resolvePending);
  resolveRef.current = resolvePending;

  // Résolution automatique UNE SEULE fois au montage. Ne surtout pas remettre
  // resolvePending en dépendance : nouvel état → nouveau callback → effet →
  // requête → nouvel état… = tempête de requêtes qui figeait l'app.
  useEffect(() => {
    if (!mounted) return;
    void resolveRef.current(true);
  }, [mounted]);

  // ---------- Dérivés ----------
  // Mémoïsé : recomputé uniquement quand l'état bankroll change, plus à chaque
  // frappe clavier dans le champ de mise / capital.
  const stats = useMemo(() => computeStats(state), [state]);
  const pnlPositive = stats.pnl >= 0;

  // Ticket Combinator déjà présent dans le portefeuille ?
  const alreadyPlaced = ticket ? state.tickets.find((t) => t.sourceSavedAt === ticket.savedAt) : undefined;

  const stakeNum = parseFloat(stake.replace(',', '.'));
  const stakeValid = Number.isFinite(stakeNum) && stakeNum >= 1 && stakeNum <= state.balance + 1e-9;
  const kellyStake = ticket ? Math.max(1, Math.round(state.balance * ticket.combo.kelly * 100) / 100) : 0;
  const potentialGain = stakeValid && ticket ? stakeNum * ticket.combo.comboOdds : 0;

  const setStakePct = (pct: number) => {
    setStake((Math.round(state.balance * pct * 100) / 100).toFixed(2));
    setStakeError(null);
  };

  const onPlace = () => {
    if (!ticket) return;
    if (!stakeValid) {
      setStakeError(state.balance < 1 ? 'Solde insuffisant pour jouer (1 € minimum).' : 'Mise invalide : entre 1 € et ton solde disponible.');
      return;
    }
    const next = placeTicket(state, {
      profile: ticket.profile,
      sourceSavedAt: ticket.savedAt,
      stake: stakeNum,
      combo: ticket.combo,
      matchDate: ticket.matchDate,
    });
    if (!next) {
      setStakeError('Placement impossible : vérifie la mise et ton solde.');
      return;
    }
    setStakeError(null);
    setStake('');
    mutate(next);
  };

  const onSaveCapital = () => {
    const v = parseFloat(capitalInput.replace(',', '.'));
    if (!Number.isFinite(v) || v < 10) {
      setCapitalInput(String(state.start));
      setEditCapital(false);
      return;
    }
    // changer le capital ne modifie pas le solde courant : on ajuste uniquement la référence
    const delta = v - state.start;
    const next: BankrollState = { ...state, start: Math.round(v * 100) / 100 };
    // si aucun ticket existant, on réaligne le solde sur le nouveau capital
    if (state.tickets.length === 0) {
      mutate(resetBankroll(v));
    } else {
      void delta;
      mutate(next);
    }
    setEditCapital(false);
  };

  const onReset = () => {
    if (!confirmReset) {
      setConfirmReset(true);
      if (resetTimer.current) clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => setConfirmReset(false), 4000);
      return;
    }
    if (resetTimer.current) clearTimeout(resetTimer.current);
    mutate(resetBankroll(state.start));
    setConfirmReset(false);
    setEditCapital(false);
  };

  // ============================================================
  return (
    <div className='mx-auto flex min-h-[100dvh] max-w-[480px] flex-col bg-background'>
      {/* ---------- Header ---------- */}
      <header className='pt-safe sticky top-0 z-40 border-b border-white/[0.05] bg-[#0a0a0c]/90 px-5 pb-3 backdrop-blur-sm'>
        <div className='flex items-center gap-3 pt-3'>
          <div className='min-w-0'>
            <div className='flex items-center gap-2'>
              <Wallet size={16} className='shrink-0 text-[#e8ff00]' />
              <span className='truncate font-display text-[17px] font-bold tracking-tight'>Portefeuille</span>
            </div>
            <div className='mt-0.5 text-[10px] text-muted-foreground'>Bankroll Manager · 100 % simulé, aucun argent réel</div>
          </div>
          <button
            onClick={() => resolvePending(false)}
            disabled={resolving}
            className='ml-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-white/[0.07] text-foreground/60 transition active:scale-95 disabled:opacity-40'
            aria-label='Vérifier les résultats des tickets'
          >
            <RotateCcw size={14} className={cn(resolving && 'animate-spin')} />
          </button>
        </div>
      </header>

      {/* ---------- Contenu ---------- */}
      <main className='flex-1 px-5 pb-32 pt-4'>
        {/* Solde */}
        <div className='rounded-3xl border border-[#e8ff00]/20 bg-[#e8ff00]/[0.06] p-5 volt-glow'>
          <div className='flex items-start justify-between'>
            <div>
              <div className='text-[11px] text-muted-foreground'>Solde disponible</div>
              <div className='mt-1 font-display text-[38px] font-bold leading-none text-[#e8ff00] tabular-nums'>{fmtEur(state.balance)}</div>
            </div>
            <span
              className={cn(
                'mt-1 rounded-full px-2.5 py-1 text-[11px] font-bold tabular-nums',
                pnlPositive ? 'bg-[#a3e635]/15 text-[#a3e635]' : 'bg-[#ff4d5e]/15 text-[#ff4d5e]'
              )}
            >
              {pnlPositive ? '+' : ''}
              {fmtEur(stats.pnl)}
            </span>
          </div>
          <div className='mt-3 grid grid-cols-3 gap-2 border-t border-white/[0.07] pt-3 text-center'>
            <div>
              <div className='text-[10px] text-muted-foreground'>En jeu</div>
              <div className='mt-0.5 text-[14px] font-bold tabular-nums'>{fmtEur(stats.inPlay)}</div>
            </div>
            <div>
              <div className='text-[10px] text-muted-foreground'>ROI tickets</div>
              <div className={cn('mt-0.5 text-[14px] font-bold tabular-nums', stats.roi >= 0 ? 'text-[#a3e635]' : 'text-[#ff4d5e]')}>
                {stats.stakedResolved > 0 ? `${(stats.roi * 100).toFixed(1)}%` : '—'}
              </div>
            </div>
            <div>
              <div className='text-[10px] text-muted-foreground'>Capital</div>
              <button
                onClick={() => setEditCapital((v) => !v)}
                className='mt-0.5 flex w-full items-center justify-center gap-1 text-[14px] font-bold tabular-nums'
                aria-label='Modifier le capital de départ'
              >
                {fmtEur(state.start)} <Pencil size={10} className='text-muted-foreground' />
              </button>
            </div>
          </div>

          {editCapital && (
            <div className='mt-3 rounded-2xl bg-black/30 p-3'>
              <div className='text-[11px] text-muted-foreground'>Capital de départ (référence du P&L)</div>
              <div className='mt-2 flex gap-2'>
                <input
                  value={capitalInput}
                  onChange={(e) => setCapitalInput(e.target.value)}
                  inputMode='decimal'
                  className='min-w-0 flex-1 rounded-xl bg-white/[0.06] px-3 py-2 text-[14px] tabular-nums outline-none focus:ring-1 focus:ring-[#e8ff00]/50'
                  aria-label='Capital de départ en euros'
                />
                <button
                  onClick={onSaveCapital}
                  className='rounded-xl bg-[#e8ff00] px-4 py-2 text-[13px] font-bold text-black transition active:scale-95'
                >
                  OK
                </button>
              </div>
              <p className='mt-2 text-[10px] leading-snug text-muted-foreground/70'>
                {state.tickets.length === 0
                  ? 'Aucun ticket : le solde est réaligné sur le nouveau capital.'
                  : 'Des tickets existent : seul le P&L de référence change, le solde reste intact.'}
              </p>
            </div>
          )}
        </div>

        {/* Courbe de bankroll */}
        {state.history.length >= 2 && <BankrollCurve points={state.history} />}

        {/* ---------- Jouer un ticket ---------- */}
        {!mounted ? (
          <div className='volt-skeleton mt-4 h-40 rounded-3xl' />
        ) : !ticket ? (
          <div className='mt-4 flex flex-col items-center gap-3 rounded-3xl border border-dashed border-white/10 py-10 text-center'>
            <Ticket size={34} className='text-white/15' />
            <div className='text-[15px] font-semibold'>Aucun ticket à jouer</div>
            <p className='max-w-[270px] text-[13px] leading-relaxed text-muted-foreground'>
              Génère un combiné avec le Combinator, puis reviens ici pour le jouer avec ta banque virtuelle.
            </p>
            <Link
              href='/combo'
              className='mt-1 flex items-center gap-2 rounded-2xl bg-[#e8ff00] px-5 py-2.5 text-[13px] font-bold text-black transition active:scale-95'
            >
              <Plus size={15} /> Créer un combiné
            </Link>
          </div>
        ) : alreadyPlaced ? (
          <div className='mt-4 rounded-3xl bg-[#141418] p-4'>
            <div className='flex items-center gap-2'>
              <CheckCircle2 size={16} className='text-[#e8ff00]' />
              <span className='text-[14px] font-bold'>Ticket déjà dans ton portefeuille</span>
            </div>
            <p className='mt-1 text-[12px] text-muted-foreground'>Retrouve son statut dans la liste ci-dessous.</p>
            <Link
              href='/combo'
              className='mt-3 flex items-center justify-center gap-2 rounded-2xl bg-white/[0.07] py-3 text-[13px] font-bold transition active:scale-[0.98]'
            >
              <Plus size={14} /> Générer un nouveau combiné
            </Link>
          </div>
        ) : (
          <div className='mt-4 rounded-3xl bg-[#141418] p-4'>
            <div className='flex items-center justify-between'>
              <div className='flex items-center gap-2'>
                <Ticket size={16} className='text-[#e8ff00]' />
                <span className='text-[14px] font-bold'>Jouer ce ticket</span>
              </div>
              <Link href='/combo/ticket' className='text-[11px] font-semibold text-[#e8ff00]'>
                Voir le détail →
              </Link>
            </div>

            {/* Aperçu compact du ticket */}
            <div className='mt-3 rounded-2xl bg-black/30 p-3'>
              <div className='flex items-center justify-between text-[12px]'>
                <span className='font-semibold'>
                  {PROFILES[ticket.profile].emoji} {PROFILES[ticket.profile].label}
                </span>
                <span className='text-muted-foreground'>{ticket.combo.legs.length} jambes · {ticket.matchDate}</span>
              </div>
              <div className='mt-2 space-y-1.5'>
                {ticket.combo.legs.map((leg) => (
                  <div key={leg.matchId} className='flex items-center gap-2'>
                    <TeamLogo src={leg.homeLogo ?? null} alt={leg.homeName} size={16} />
                    <span className='text-[10px] text-muted-foreground'>vs</span>
                    <TeamLogo src={leg.awayLogo ?? null} alt={leg.awayName} size={16} />
                    <span className='min-w-0 flex-1 truncate text-[11px]'>
                      {leg.homeName} <span className='text-muted-foreground'>·</span> {leg.pick}
                    </span>
                    <span className='shrink-0 text-[11px] font-bold tabular-nums'>{leg.odds.toFixed(2)}</span>
                  </div>
                ))}
              </div>
              <div className='mt-2.5 flex items-center justify-between border-t border-white/[0.06] pt-2.5 text-[12px]'>
                <span className='text-muted-foreground'>Cote totale</span>
                <span className='font-display text-[16px] font-bold text-[#e8ff00] tabular-nums'>{ticket.combo.comboOdds.toFixed(2)}</span>
              </div>
              <div className='flex items-center justify-between text-[11px] text-muted-foreground'>
                <span>Proba modèle</span>
                <span className='tabular-nums'>{Math.round(ticket.combo.comboProb * 100)}%</span>
              </div>
            </div>

            {/* Mise */}
            <div className='mt-3'>
              <div className='text-[12px] font-semibold'>Ta mise</div>
              <div className='mt-2 flex gap-1.5'>
                {[
                  { label: '1 %', v: 0.01 },
                  { label: '2 %', v: 0.02 },
                  { label: '5 %', v: 0.05 },
                ].map((c) => (
                  <button
                    key={c.label}
                    onClick={() => setStakePct(c.v)}
                    className='flex-1 rounded-xl bg-white/[0.06] py-2 text-[12px] font-bold transition active:scale-95'
                  >
                    {c.label}
                  </button>
                ))}
                <button
                  onClick={() => setStake(kellyStake.toFixed(2))}
                  className='flex-1 rounded-xl bg-[#e8ff00]/15 py-2 text-[12px] font-bold text-[#e8ff00] transition active:scale-95'
                  title={`Kelly conseillée : ${Math.round(ticket.combo.kelly * 100)}% de la banque`}
                >
                  Kelly {Math.round(ticket.combo.kelly * 100)}%
                </button>
              </div>
              <div className='mt-2 flex items-center gap-2'>
                <input
                  value={stake}
                  onChange={(e) => {
                    setStake(e.target.value);
                    setStakeError(null);
                  }}
                  inputMode='decimal'
                  placeholder='Mise en €'
                  className='min-w-0 flex-1 rounded-xl bg-white/[0.06] px-3 py-2.5 text-[15px] tabular-nums outline-none placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-[#e8ff00]/50'
                  aria-label='Mise en euros'
                />
                <div className='shrink-0 text-right'>
                  <div className='text-[10px] text-muted-foreground'>Gain potentiel</div>
                  <div className='text-[14px] font-bold text-[#a3e635] tabular-nums'>{stakeValid ? fmtEur(potentialGain) : '—'}</div>
                </div>
              </div>
              {stakeError && <p className='mt-2 text-[11px] text-[#ff4d5e]'>{stakeError}</p>}
              {stakeValid && stakeNum > state.balance * 0.2 && (
                <p className='mt-2 flex items-center gap-1.5 text-[11px] text-[#e8ff00]'>
                  <AlertTriangle size={11} /> Mise élevée (&gt; 20 % de la banque) — les pros plafonnent à 1-5 %.
                </p>
              )}
              <button
                onClick={onPlace}
                disabled={!stakeValid}
                className='mt-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-[#e8ff00] py-3.5 text-[14px] font-bold text-black transition active:scale-[0.98] disabled:opacity-40'
              >
                <Wallet size={15} /> Placer le pari · {stakeValid ? fmtEur(stakeNum) : '—'}
              </button>
            </div>
          </div>
        )}

        {/* ---------- Tickets placés ---------- */}
        {state.tickets.length > 0 && (
          <div className='mt-4 rounded-3xl bg-[#141418] p-4'>
            <div className='mb-3 flex items-center justify-between'>
              <h3 className='text-[14px] font-bold'>Mes tickets ({state.tickets.length})</h3>
              {resolving && (
                <span className='flex items-center gap-1.5 text-[11px] text-muted-foreground'>
                  <Loader2 size={11} className='animate-spin text-[#e8ff00]' /> Résolution…
                </span>
              )}
            </div>
            <div className='space-y-3'>
              {state.tickets.map((t) => (
                <PlacedTicketCard key={t.id} ticket={t} />
              ))}
            </div>
          </div>
        )}

        {/* ---------- Stats par profil ---------- */}
        {stats.won + stats.lost + stats.voided > 0 && (
          <div className='mt-4 rounded-3xl bg-[#141418] p-4'>
            <div className='mb-1 flex items-center gap-2'>
              <Target size={15} className='text-[#e8ff00]' />
              <h3 className='text-[14px] font-bold'>Performance par profil de risque</h3>
            </div>
            <p className='mb-3 text-[11px] text-muted-foreground'>Quel profil fait gagner ta banque sur la durée ?</p>
            <div className='space-y-2'>
              {PROFILE_ORDER.map((p) => {
                const s = stats.byProfile[p];
                const roiP = s.staked > 0 ? s.net / s.staked : null;
                return (
                  <div key={p} className='flex items-center justify-between gap-3 rounded-2xl bg-black/30 px-3 py-2.5'>
                    <div className='min-w-0'>
                      <div className='text-[12px] font-semibold'>
                        {PROFILES[p].emoji} {PROFILES[p].label}
                      </div>
                      <div className='text-[10px] text-muted-foreground'>
                        {s.total} ticket(s) · {s.won}G {s.lost}P
                      </div>
                    </div>
                    <div className='shrink-0 text-right'>
                      <div className={cn('text-[13px] font-bold tabular-nums', s.net >= 0 ? 'text-[#a3e635]' : 'text-[#ff4d5e]')}>
                        {s.net >= 0 ? '+' : ''}
                        {fmtEur(s.net)}
                      </div>
                      <div className='text-[10px] text-muted-foreground tabular-nums'>
                        {roiP != null ? `ROI ${(roiP * 100).toFixed(0)}%` : '—'}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ---------- Réglages ---------- */}
        <div className='mt-4 rounded-3xl bg-[#141418] p-4'>
          <h3 className='text-[14px] font-bold'>Réinitialiser la banque</h3>
          <p className='mt-1 text-[11px] leading-relaxed text-muted-foreground'>
            Remets le solde à {fmtEur(state.start)} et efface tous les tickets de l'appareil. Action définitive.
          </p>
          <button
            onClick={onReset}
            className={cn(
              'mt-3 w-full rounded-2xl py-3 text-[13px] font-bold transition active:scale-[0.98]',
              confirmReset ? 'bg-[#ff4d5e] text-white' : 'bg-[#ff4d5e]/10 text-[#ff4d5e]'
            )}
          >
            {confirmReset ? 'Confirmer la réinitialisation ?' : 'Réinitialiser le portefeuille'}
          </button>
        </div>

        {/* Lien précision */}
        <Link
          href='/precision'
          className='mt-4 flex items-center justify-between rounded-3xl border border-[#e8ff00]/20 bg-[#e8ff00]/[0.05] p-4 transition active:scale-[0.985]'
        >
          <div className='flex items-center gap-2.5'>
            <Target size={17} className='text-[#e8ff00]' />
            <div>
              <div className='text-[14px] font-bold'>Précision VOLTRIX</div>
              <div className='text-[11px] text-muted-foreground'>Le score réel du moteur, marchés et ligues détaillés</div>
            </div>
          </div>
          <span className='text-[#e8ff00]'>→</span>
        </Link>

        {/* Disclaimer */}
        <div className='mt-4 rounded-3xl border border-[#ff4d5e]/25 bg-[#ff4d5e]/[0.06] p-4'>
          <div className='flex items-center gap-2'>
            <AlertTriangle size={14} className='text-[#ff4d5e]' />
            <span className='text-[13px] font-bold text-[#ff4d5e]'>Simulation 18+</span>
          </div>
          <p className='mt-1.5 text-[11px] leading-relaxed text-foreground/75'>
            Le Portefeuille est un simulateur : la banque est virtuelle, aucun argent réel n'est en jeu. Les tickets sont
            résolus avec les scores ESPN, comme chez un bookmaker (jambes annulées = cote 1). Les données restent sur ton
            appareil.
          </p>
        </div>
      </main>

      {/* ---------- Barre d'onglets Liquid Glass ---------- */}
      <VoltrixTabBar />
    </div>
  );
}

// ============================================================

/** Courbe de progression de la banque (SVG léger, sans lib).
 *  Mémoïsée : ne re-rend que si la liste de points change réellement —
 *  taper une mise ne recalcule plus les chemins du path. */
const BankrollCurve = memo(function BankrollCurve({ points }: { points: Array<{ t: number; balance: number }> }) {
  const W = 320;
  const H = 92;
  const PAD = 6;
  const { line, area, min, max, lastX, lastY, rising } = useMemo(() => {
    const values = points.map((p) => p.balance);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const x = (i: number) => PAD + (i / (points.length - 1)) * (W - 2 * PAD);
    const y = (v: number) => H - PAD - ((v - min) / range) * (H - 2 * PAD);
    const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.balance).toFixed(1)}`).join(' ');
    const area = `${line} L${x(points.length - 1).toFixed(1)},${H - PAD} L${x(0).toFixed(1)},${H - PAD} Z`;
    const last = points[points.length - 1];
    return {
      line,
      area,
      min,
      max,
      lastX: x(points.length - 1),
      lastY: y(last.balance),
      rising: last.balance >= points[0].balance,
    };
  }, [points]);

  return (
    <div className='mt-4 rounded-3xl bg-[#141418] p-4'>
      <div className='mb-2 flex items-center justify-between'>
        <div className='flex items-center gap-1.5 text-[12px] text-muted-foreground'>
          <TrendingUp size={13} className={rising ? 'text-[#a3e635]' : 'text-[#ff4d5e]'} /> Progression de la banque
        </div>
        <div className='text-[10px] text-muted-foreground tabular-nums'>
          min {fmtEur(min)} · max {fmtEur(max)}
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className='h-[92px] w-full' preserveAspectRatio='none' role='img' aria-label='Courbe de la banque'>
        <defs>
          <linearGradient id='bk-grad' x1='0' y1='0' x2='0' y2='1'>
            <stop offset='0%' stopColor={rising ? '#a3e635' : '#ff4d5e'} stopOpacity='0.22' />
            <stop offset='100%' stopColor={rising ? '#a3e635' : '#ff4d5e'} stopOpacity='0' />
          </linearGradient>
        </defs>
        <path d={area} fill='url(#bk-grad)' />
        <path d={line} fill='none' stroke={rising ? '#a3e635' : '#ff4d5e'} strokeWidth='2' strokeLinejoin='round' strokeLinecap='round' />
        <circle cx={lastX} cy={lastY} r='3' fill='#e8ff00' />
      </svg>
    </div>
  );
});

/** Carte d'un ticket placé (en cours ou résolu, avec résultats par jambe).
 *  Mémoïsée : taper une mise ne re-rend plus toute la liste des tickets. */
const PlacedTicketCard = memo(function PlacedTicketCard({ ticket }: { ticket: PlacedTicket }) {
  const [open, setOpen] = useState(ticket.status === 'pending');
  const st = ticket.status;
  const badgeCls =
    st === 'won'
      ? 'bg-[#a3e635]/15 text-[#a3e635]'
      : st === 'lost'
        ? 'bg-[#ff4d5e]/15 text-[#ff4d5e]'
        : st === 'void'
          ? 'bg-white/10 text-muted-foreground'
          : 'bg-[#e8ff00]/15 text-[#e8ff00]';
  const byMatch = new Map((ticket.legResults ?? []).map((r) => [r.matchId, r]));

  return (
    <div className='rounded-2xl bg-black/30'>
      <button onClick={() => setOpen((v) => !v)} className='flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left'>
        <div className='min-w-0'>
          <div className='flex items-center gap-2'>
            <span
              className={cn(
                'shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold',
                badgeCls
              )}
            >
              {TICKET_STATUS_LABEL[st]}
            </span>
            <span className='truncate text-[11px] text-muted-foreground'>
              {PROFILES[ticket.profile].emoji} {ticket.matchDate} · {ticket.legs.length} jambes
            </span>
          </div>
          <div className='mt-1 flex items-baseline gap-2 text-[12px]'>
            <span className='font-semibold tabular-nums'>{fmtEur(ticket.stake)}</span>
            <span className='text-muted-foreground'>@</span>
            <span className='font-bold text-[#e8ff00] tabular-nums'>{ticket.comboOdds.toFixed(2)}</span>
            {st === 'pending' && (
              <span className='text-[10px] text-muted-foreground tabular-nums'>→ {fmtEur(ticket.stake * ticket.comboOdds)}</span>
            )}
            {st === 'won' && ticket.payout != null && (
              <span className='text-[11px] font-bold text-[#a3e635] tabular-nums'>+{fmtEur(ticket.payout)}</span>
            )}
            {st === 'lost' && <span className='text-[11px] font-bold text-[#ff4d5e] tabular-nums'>−{fmtEur(ticket.stake)}</span>}
          </div>
        </div>
        <span className={cn('shrink-0 text-muted-foreground transition', open && 'rotate-180')}>▾</span>
      </button>

      {open && (
        <div className='space-y-1.5 border-t border-white/[0.06] px-3 py-2.5'>
          {ticket.legs.map((leg) => {
            const r = byMatch.get(leg.matchId);
            return (
              <div key={leg.matchId} className='flex items-center gap-2'>
                <LegStatusDot status={r?.status ?? 'PENDING'} />
                <TeamLogo src={leg.homeLogo ?? null} alt={leg.homeName} size={16} />
                <TeamLogo src={leg.awayLogo ?? null} alt={leg.awayName} size={16} />
                <div className='min-w-0 flex-1'>
                  <div className='truncate text-[11px]'>
                    {leg.homeName} <span className='text-muted-foreground'>vs</span> {leg.awayName}
                  </div>
                  <div className='truncate text-[10px] text-muted-foreground'>
                    {leg.pick} · {leg.market}
                  </div>
                </div>
                {r?.score && <span className='shrink-0 text-[10px] font-bold text-muted-foreground tabular-nums'>{r.score}</span>}
                <span className='shrink-0 text-[11px] font-bold tabular-nums'>{leg.odds.toFixed(2)}</span>
              </div>
            );
          })}
          {st === 'pending' && (
            <div className='flex items-center gap-1.5 pt-1 text-[10px] text-muted-foreground'>
              <Clock size={10} /> Résolution automatique après les matchs (bouton ↻ en haut pour forcer).
            </div>
          )}
        </div>
      )}
    </div>
  );
});

function LegStatusDot({ status }: { status: LegResult['status'] }) {
  if (status === 'WIN') return <CheckCircle2 size={13} className='shrink-0 text-[#a3e635]' />;
  if (status === 'LOSE') return <XCircle size={13} className='shrink-0 text-[#ff4d5e]' />;
  if (status === 'VOID') return <span className='w-[13px] shrink-0 text-center text-[11px] font-bold text-muted-foreground'>=</span>;
  return <Loader2 size={11} className='shrink-0 animate-spin text-muted-foreground' />;
}
