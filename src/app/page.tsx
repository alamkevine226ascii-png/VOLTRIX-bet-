'use client';

// ============================================================
// VOLTRIX bet — Application principale (PWA mobile-first)
// Navigation : VoltrixTabBar « Liquid Glass » partagée (style iOS 27) —
// Accueil · Ligues · Portefeuille (page) · Précision (page) · Profil
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import {
  AlertTriangle,
  Brain,
  CalendarDays,
  Flame,
  Info,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Target,
  Ticket,
  Trophy,
  Zap,
} from 'lucide-react';
import type { LightMatch, MatchesResponse, QuickPred } from '@/lib/types';
import { MatchCard, MatchCardSkeleton } from '@/components/voltrix/match-card';
import { VoltrixTabBar, type TabKey } from '@/components/voltrix/tab-bar';
import { VOLTRIX_SYNC_DONE_EVENT } from '@/components/voltrix/sync-wake-button';
import { PwaInstallButton } from '@/components/voltrix/pwa-install-button';
import { loadCachedPreds, saveCachedPreds } from '@/lib/preds-cache';
import { cn } from '@/lib/utils';

// Détail match en chunk séparé (chargé seulement côté client) : il ne sert
// qu'à l'ouverture d'une carte — allège le First Load JS de l'accueil.
const MatchDetail = dynamic(() => import('@/components/voltrix/match-detail').then((m) => m.MatchDetail), {
  ssr: false,
});

type Tab = 'home' | 'leagues' | 'profile';

export default function Home() {
  const [mounted, setMounted] = useState(false);
  const [tab, setTab] = useState<Tab>('home');
  const [date, setDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [data, setData] = useState<MatchesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // État d'erreur réseau/serveur (Task 18-b) : fetch rejeté, HTTP non-OK ou JSON
  // invalide. JAMAIS confondu avec « aucun match » — le message vide ne concerne
  // qu'un HTTP 200 réellement sans match.
  const [error, setError] = useState(false);
  // Auto-retry silencieux en cours (stale-while-error) : si des données sont déjà
  // affichées, on les garde avec un bandeau « Reconnexion… » au lieu de vider l'écran.
  const [retrying, setRetrying] = useState(false);
  const [preds, setPreds] = useState<Record<string, QuickPred>>({});
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const [leagueFilter, setLeagueFilter] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ matchId: string; leagueCode: string; date: string } | null>(null);
  // Jeton de génération : toute nouvelle passe de chargement invalide les anciennes
  // (anti-race : une ancienne boucle d'analyse en attente ne doit plus écrire d'état
  // ni continuer à requêter après un changement de date — remplace l'ancien batchAbort
  // qui était remis à false par la NOUVELLE passe, réveillant les anciennes boucles).
  const runIdRef = useRef(0);
  // Miroir synchrone de `preds` : permet de calculer le diff « à analyser » et
  // d'hydrater le cache sans attendre un re-render (les setters React sont async).
  const predsRef = useRef<Record<string, QuickPred>>({});
  // Date courante pour les callbacks stables (retryMatch) — évite les closures
  // périmées si une réponse arrive après un changement de date.
  const dateRef = useRef(date);
  // Miroir synchrone de `data` : le retry silencieux doit savoir si des données
  // sont déjà affichées (stale-while-error) sans attendre un re-render.
  const dataRef = useRef<MatchesResponse | null>(null);
  // Compteur d'auto-retries de la passe courante (2 max, backoff 1,5 s puis 3 s)
  // + minuteur annulable (un changement de date ou un démontage l'invalide).
  const autoRetryRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Nettoyage du minuteur d'auto-retry au démontage
  useEffect(
    () => () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    },
    []
  );

  useEffect(() => {
    setMounted(true);
    // Onglet interne demandé via l'URL (?tab=leagues / ?tab=profile) —
    // posé par la barre d'onglets depuis les autres pages.
    const t = new URLSearchParams(window.location.search).get('tab');
    if (t === 'leagues' || t === 'profile') setTab(t);
  }, []);

  // Onglets internes pilotés par la barre (Portefeuille/Précision = vraies pages)
  const onTabChange = useCallback((k: TabKey) => {
    if (k === 'home' || k === 'leagues' || k === 'profile') setTab(k);
  }, []);

  // ---------- Chargement des matchs ----------
  // Appel commun : analyser une liste de matchs, remplir preds, retourner les ID réussis.
  // runId : jeton de génération — si une nouvelle passe a démarré, on stoppe net
  // (plus aucune requête, plus aucun setState). Les résultats d'un lot sont appliqués
  // en UN SEUL setState (au lieu d'un par match) pour limiter les re-renders.
  const analyzeList = useCallback(
    async (list: LightMatch[], runId: number, d: string): Promise<Set<string>> => {
      const ok = new Set<string>();
      for (let i = 0; i < list.length; i += 6) {
        if (runIdRef.current !== runId) break;
        const batch = list.slice(i, i + 6);
        try {
          const res2 = await fetch('/api/predictions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              matches: batch.map((m) => ({ matchId: m.id, leagueCode: m.leagueCode, date: m.date })),
            }),
          });
          const json2 = await res2.json();
          if (runIdRef.current !== runId) break; // passe supplantée : ne rien écrire
          const updates: Record<string, QuickPred> = {};
          for (const r of json2.results ?? []) {
            if (r) {
              ok.add(r.matchId);
              updates[r.matchId] = r;
            }
          }
          if (Object.keys(updates).length > 0) {
            // Un seul setState par lot (perf 10-a) + miroir synchrone du ref
            predsRef.current = { ...predsRef.current, ...updates };
            setPreds(predsRef.current);
            // Cache session (survit aux navigations) : fusion throttlée,
            // écrite pour LA DATE DE LA PASSE (d) — jamais celle d'une passe
            // plus récente (garde runId ci-dessus).
            saveCachedPreds(d, updates);
          }
        } catch {
          // batch ignoré, sera repris par la passe de rattrapage
        }
      }
      return ok;
    },
    []
  );

  const loadMatches = useCallback(
    async (d: string, isRefresh = false, isAutoRetry = false) => {
      if (isRefresh) {
        setRefreshing(true);
      } else if (isAutoRetry && dataRef.current) {
        // Retry silencieux avec données déjà affichées : stale-while-error —
        // on garde les cartes à l'écran, un bandeau « Reconnexion… » apparaît.
        setRetrying(true);
      } else {
        setLoading(true);
      }
      // Passe déclenchée par l'utilisateur (montage, date, refresh, bouton
      // Réessayer) : on repart d'un état propre et on annule tout retry en attente.
      if (!isAutoRetry) {
        if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
        autoRetryRef.current = 0;
        setRetrying(false);
        setError(false);
        // Changement de date (ou premier chargement) : ne pas laisser les matchs
        // d'une autre journée affichés sous la nouvelle date sélectionnée.
        if (!isRefresh) {
          setData(null);
          dataRef.current = null;
        }
      }
      const runId = ++runIdRef.current; // invalide immédiatement les passes antérieures
      dateRef.current = d;
      // Hydratation instantanée depuis le cache session (survit aux navigations) :
      // les cartes déjà analysées s'affichent sans skeleton ni POST au retour.
      // Lecture SYNCHRONE → aucun hydratation « en vol » à annuler : si la date
      // change pendant le fetch, la passe suivante ré-écrase preds avec le cache
      // de SA date et tout le reste (setData/setPreds/analyses) est derrière la
      // garde runId ci-dessous.
      predsRef.current = { ...loadCachedPreds(d) };
      setPreds(predsRef.current);
      // willRetry : un auto-retry est programmé → le finally ne doit PAS couper
      // les états de chargement (sinon écran vide pendant le backoff).
      let willRetry = false;
      try {
        const res = await fetch(`/api/matches?date=${d}`);
        // Un 5xx / 404 n'est PAS « aucun match » : on jette pour tomber dans le
        // circuit d'erreur (auto-retry puis état « Impossible de charger »).
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json: MatchesResponse = await res.json();
        // JSON inattendu (corps tronqué, page d'erreur HTML… parseable) : même
        // traitement qu'une panne serveur.
        if (!json || !Array.isArray(json.leagues)) throw new Error('Réponse invalide');
        if (runIdRef.current !== runId) return; // une passe plus récente a pris le relais
        setData(json);
        dataRef.current = json;
        setError(false);
        setRetrying(false);
        autoRetryRef.current = 0;
        setLeagueFilter(null);
        setFailed(new Set());
        // Pronos progressifs par lots de 6, dans l'ordre chronologique
        const allMatches = json.leagues
          .flatMap((l) => l.matches)
          .filter((m) => m.status !== 'post')
          .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        // Diff par matchId : ne POSTER que les matchs SANS analyse (cache inclus).
        // Refresh manuel : re-analyse complète forcée — les nouveaux résultats
        // écrasent les anciens dans le state ET le cache (merge par matchId).
        const todo = isRefresh ? allMatches : allMatches.filter((m) => !predsRef.current[m.id]);
        const analyzed = await analyzeList(todo, runId, d);
        // Passe de rattrapage : les matchs sans analyse sont relancés (jusqu'à 2 fois)
        let missing = todo.filter((m) => !analyzed.has(m.id));
        for (let pass = 0; pass < 2 && missing.length > 0; pass++) {
          if (runIdRef.current !== runId) return;
          await new Promise((r) => setTimeout(r, 1500)); // laisser retomber les TTL d'échec côté serveur
          const ok2 = await analyzeList(missing, runId, d);
          missing = missing.filter((m) => !ok2.has(m.id));
        }
        if (runIdRef.current === runId) setFailed(new Set(missing.map((m) => m.id)));
      } catch {
        // Task 18-b : une panne (fetch rejeté / HTTP non-OK / JSON invalide) ne
        // doit JAMAIS afficher « Aucun match trouvé » — ni vider les données.
        if (runIdRef.current === runId) {
          const attempt = autoRetryRef.current;
          if (attempt < 2) {
            // Auto-retry silencieux (backoff ~1,5 s puis ~3 s). Les données
            // précédentes restent affichées (stale-while-error) ; sans données,
            // les squelettes continuent de tourner.
            willRetry = true;
            autoRetryRef.current = attempt + 1;
            retryTimerRef.current = setTimeout(() => {
              retryTimerRef.current = null;
              // Une passe plus récente (date, refresh, Réessayer) a pris le relais
              if (runIdRef.current === runId) void loadMatches(d, false, true);
            }, attempt === 0 ? 1500 : 3000);
          } else {
            // Échec persistant : on affiche l'erreur honnête (données conservées
            // si elles existent, avec bandeau « Serveur indisponible »).
            setRetrying(false);
            setError(true);
          }
        }
      } finally {
        // Seule la passe courante touche les états de chargement (une passe supplantée
        // ne doit pas masquer le spinner de la passe récente). Si un auto-retry est
        // programmé, on garde l'état actuel (squelettes ou données) jusqu'au verdict.
        if (runIdRef.current === runId && !willRetry) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [analyzeList]
  );

  useEffect(() => {
    if (mounted) loadMatches(date);
  }, [mounted, date, loadMatches]);

  // Task 45 §26 — Wake on Demand : une synchronisation ESPN → Neon vient de
  // se terminer (déclenchée par le bouton « Actualiser les données », ici ou
  // chez un autre utilisateur) → recharger avec isRefresh=true : les cartes
  // restent à l'écran et l'analyse repart sur les données fraîches (merge).
  useEffect(() => {
    const onSyncDone = () => {
      if (dateRef.current) loadMatches(dateRef.current, true);
    };
    window.addEventListener(VOLTRIX_SYNC_DONE_EVENT, onSyncDone);
    return () => window.removeEventListener(VOLTRIX_SYNC_DONE_EVENT, onSyncDone);
  }, [loadMatches]);

  // Relance manuelle de l'analyse d'un match en échec
  const retryMatch = useCallback(
    async (m: LightMatch) => {
      setFailed((prev) => {
        const n = new Set(prev);
        n.delete(m.id);
        return n;
      });
      const ok = await analyzeList([m], runIdRef.current, m.date.slice(0, 10));
      if (!ok.has(m.id)) setFailed((prev) => new Set(prev).add(m.id));
    },
    [analyzeList]
  );

  // Ouverture du détail : callback stable (référence invariante) → React.memo des cartes efficace
  const openMatch = useCallback((m: LightMatch) => {
    setDetail({ matchId: m.id, leagueCode: m.leagueCode, date: m.date });
  }, []);

  const closeDetail = useCallback((o: boolean) => {
    if (!o) setDetail(null);
  }, []);

  // ---------- Dérivés ----------
  const flatMatches = useMemo(
    () => (data ? data.leagues.flatMap((l) => l.matches) : []),
    [data]
  );
  // Liste plate triée par heure de début (le match le plus tôt en haut)
  const sortedMatches = useMemo(() => {
    const list = leagueFilter
      ? flatMatches.filter((m) => m.leagueCode === leagueFilter || m.leagueName === leagueFilter)
      : flatMatches;
    return [...list].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [flatMatches, leagueFilter]);

  const dateChips = useMemo(() => {
    const today = new Date();
    const chips: Array<{ iso: string; label: string; sub: string; isToday: boolean }> = [];
    for (let off = -2; off <= 4; off++) {
      const d = new Date(today.getTime() + off * 86400000);
      const iso = d.toISOString().slice(0, 10);
      const label =
        off === 0 ? "Aujourd'hui" : off === 1 ? 'Demain' : off === -1 ? 'Hier' : null;
      chips.push({
        iso,
        label: label ?? new Intl.DateTimeFormat('fr-FR', { weekday: 'short' }).format(d),
        sub: new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short' }).format(d),
        isToday: off === 0,
      });
    }
    return chips;
  }, []);

  const predCount = Object.keys(preds).length;
  // Nombre de matchs à analyser — mémoïsé (était recalculé 2× par render via filter inline)
  const pendingCount = useMemo(
    () => flatMatches.filter((m) => m.status !== 'post').length,
    [flatMatches]
  );

  // ============================================================
  return (
    <div className='mx-auto flex min-h-[100dvh] max-w-[480px] flex-col bg-background'>
      {/* ---------- Header ---------- */}
      <header className='pt-safe sticky top-0 z-40 border-b border-white/[0.05] bg-[#0a0a0c]/90 px-5 pb-3 backdrop-blur-sm'>
        <div className='flex items-center justify-between pt-3'>
          <div className='flex items-center gap-2'>
            <span className='flex h-9 w-9 items-center justify-center rounded-2xl bg-[#e8ff00] volt-glow'>
              <Zap size={19} className='fill-black text-black' />
            </span>
            <div className='leading-none'>
              <div className='font-display text-[17px] font-bold tracking-tight'>
                VOLTRIX<span className='ml-1 rounded-md bg-[#e8ff00] px-1.5 py-[1px] text-[13px] font-bold text-black'>bet</span>
              </div>
              <div className='mt-1 text-[10px] text-muted-foreground'>Poisson · Elo · Forme · Value bets</div>
            </div>
          </div>
          <div className='flex items-center gap-2'>
            {/* Badge « serveur indisponible » : pastille grise/volt tant que
                l'erreur réseau persiste (Task 18-b, facultatif du cahier). */}
            {mounted && error && (
              <span
                className='flex items-center gap-1.5 rounded-full bg-white/[0.06] px-2.5 py-1.5 text-[10px] font-semibold text-muted-foreground'
                title='Le serveur ne répond pas — nouvelles tentatives automatiques'
              >
                <span className='h-1.5 w-1.5 animate-pulse rounded-full bg-[#e8ff00]' />
                Serveur indisponible
              </span>
            )}
            <Link
              href='/combo'
              className='flex h-9 w-9 items-center justify-center rounded-2xl bg-[#e8ff00] volt-glow transition active:scale-95'
              aria-label='Générer un pari combiné (Combinator)'
              title='Combinator — pari combiné'
            >
              <Ticket size={17} className='text-black' />
            </Link>
          </div>
        </div>

        {/* Sélecteur de dates */}
        {mounted && (
          <div className='volt-scroll -mx-5 mt-3 flex gap-1.5 overflow-x-auto px-5 pb-1'>
            {dateChips.map((c) => (
              <button
                key={c.iso}
                onClick={() => setDate(c.iso)}
                className={cn(
                  'flex shrink-0 flex-col items-center rounded-2xl px-3.5 py-2 transition',
                  date === c.iso
                    ? 'bg-[#e8ff00] text-black volt-glow'
                    : 'bg-white/[0.05] text-foreground/70'
                )}
              >
                <span className='text-[11px] font-bold leading-none'>{c.label}</span>
                <span className={cn('mt-1 text-[10px] leading-none', date === c.iso ? 'text-black/60' : 'text-muted-foreground')}>
                  {c.sub}
                </span>
              </button>
            ))}
            <button
              onClick={() => loadMatches(date, true)}
              className='flex shrink-0 items-center justify-center rounded-2xl bg-white/[0.05] px-3.5 text-foreground/60 transition active:scale-95'
              aria-label='Rafraîchir les matchs'
            >
              <RefreshCw size={14} className={cn(refreshing && 'animate-spin')} />
            </button>
          </div>
        )}
      </header>

      {/* ---------- Contenu ---------- */}
      <main className='flex-1 px-5 pb-32 pt-4'>
        {tab === 'home' && (
          <>
            {/* Filtre ligues */}
            {data && data.leagues.length > 0 && (
              <div className='volt-scroll -mx-5 mb-4 flex gap-1.5 overflow-x-auto px-5'>
                <FilterChip active={leagueFilter === null} onClick={() => setLeagueFilter(null)}>
                  Tous ({flatMatches.length})
                </FilterChip>
                {data.leagues.map((l) => (
                  <FilterChip
                    key={l.code}
                    active={leagueFilter === l.code}
                    onClick={() => setLeagueFilter(leagueFilter === l.code ? null : l.code)}
                  >
                    {l.shortName} ({l.matches.length})
                  </FilterChip>
                ))}
              </div>
            )}

            {/* Statut de l'analyse */}
            {data && flatMatches.length > 0 && predCount > 0 && predCount < pendingCount && (
              <div className='mb-3 flex items-center gap-2 rounded-2xl bg-white/[0.04] px-3.5 py-2 text-[12px] text-muted-foreground'>
                <Loader2 size={13} className='animate-spin text-[#e8ff00]' />
                Analyse IA en cours… {predCount}/{pendingCount} matchs analysés
              </div>
            )}

            {loading ? (
              <div className='space-y-3'>
                {[1, 2, 3, 4].map((i) => (
                  <MatchCardSkeleton key={i} />
                ))}
              </div>
            ) : error && !data ? (
              // Task 18-b : erreur réseau/serveur ≠ journée sans match.
              <LoadErrorState onRetry={() => loadMatches(date)} />
            ) : !data || flatMatches.length === 0 ? (
              <EmptyState />
            ) : (
              <>
                {/* Bandeaux stale-while-error (Task 18-b) : pendant un auto-retry
                    avec données conservées (« Reconnexion… »), puis si l'erreur
                    persiste (« Serveur indisponible » + Réessayer manuel). */}
                {(retrying || error) && (
                  <div className='mb-3 flex items-center justify-between gap-3 rounded-2xl bg-white/[0.04] px-3.5 py-2 text-[12px] text-muted-foreground'>
                    <span className='flex min-w-0 items-center gap-2'>
                      {retrying ? (
                        <Loader2 size={13} className='shrink-0 animate-spin text-[#e8ff00]' />
                      ) : (
                        <AlertTriangle size={13} className='shrink-0 text-[#e8ff00]' />
                      )}
                      {retrying
                        ? 'Reconnexion…'
                        : 'Serveur indisponible — affichage des dernières données.'}
                    </span>
                    {!retrying && (
                      <button
                        onClick={() => loadMatches(date, true)}
                        className='shrink-0 rounded-full bg-white/[0.08] px-3 py-1 text-[11px] font-bold text-[#e8ff00] transition active:scale-95'
                      >
                        Réessayer
                      </button>
                    )}
                  </div>
                )}
                <div className='space-y-2.5'>
                  {sortedMatches.map((m) => (
                    <MatchCard
                      key={m.id}
                      match={m}
                      pred={preds[m.id]}
                      failed={!preds[m.id] && failed.has(m.id)}
                      onRetry={retryMatch}
                      onOpen={openMatch}
                    />
                  ))}
                </div>
              </>
            )}
          </>
        )}

        {tab === 'leagues' && (
          <LeaguesTab
            data={data}
            error={error}
            onRetry={() => loadMatches(date)}
            onPick={(code) => {
              setLeagueFilter(code);
              setTab('home');
            }}
          />
        )}

        {tab === 'profile' && <ProfileTab catalogueSize={data?.catalogueSize} />}
      </main>

      {/* ---------- Barre d'onglets Liquid Glass (iOS 27) ---------- */}
      <VoltrixTabBar active={tab} onTabChange={onTabChange} />

      {/* Détail match */}
      <MatchDetail
        open={detail !== null}
        onOpenChange={closeDetail}
        matchId={detail?.matchId ?? null}
        leagueCode={detail?.leagueCode ?? null}
        date={detail?.date ?? null}
      />
    </div>
  );
}

// ============================================================

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'shrink-0 whitespace-nowrap rounded-full px-3.5 py-1.5 text-[12px] font-semibold transition',
        active ? 'bg-[#e8ff00] text-black' : 'bg-white/[0.06] text-foreground/70'
      )}
    >
      {children}
    </button>
  );
}

function EmptyState() {
  return (
    <div className='flex flex-col items-center gap-3 rounded-3xl border border-dashed border-white/10 py-16 text-center'>
      <CalendarDays size={36} className='text-white/15' />
      <div className='text-[15px] font-semibold'>Aucun match trouvé</div>
      <p className='max-w-[260px] text-[13px] leading-relaxed text-muted-foreground'>
        Aucun match de football recensé sur ESPN pour cette date. Essaie une autre journée ou reviens plus tard.
      </p>
    </div>
  );
}

// État d'erreur réseau/serveur (Task 18-b) : affiché UNIQUEMENT quand le fetch a
// échoué (rejet, HTTP non-OK, JSON invalide) APRÈS épuisement des auto-retries.
// Design : même langage que EmptyState (carte arrondie en pointillés) + bouton
// volt identique à celui de /precision. « Aucun match trouvé » ne doit JAMAIS
// apparaître dans ce cas.
function LoadErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className='flex flex-col items-center gap-3 rounded-3xl border border-dashed border-[#ff4d5e]/25 bg-[#ff4d5e]/[0.04] py-14 text-center'>
      <AlertTriangle size={34} className='text-white/15' />
      <div className='text-[15px] font-semibold'>Impossible de charger les matchs</div>
      <p className='max-w-[270px] text-[13px] leading-relaxed text-muted-foreground'>
        Vérifie ta connexion, le serveur est peut-être momentanément indisponible.
      </p>
      <button
        onClick={onRetry}
        className='mt-1 flex items-center gap-2 rounded-2xl bg-[#e8ff00] px-5 py-2.5 text-[13px] font-bold text-black transition-[color,background-color,transform] active:scale-95'
      >
        <RefreshCw size={14} /> Réessayer
      </button>
    </div>
  );
}

// ---------- Onglet Ligues ----------

function LeaguesTab({
  data,
  error,
  onRetry,
  onPick,
}: {
  data: MatchesResponse | null;
  error: boolean;
  onRetry: () => void;
  onPick: (code: string) => void;
}) {
  const regions: Array<{ key: string; label: string }> = [
    { key: 'europe', label: 'Europe' },
    { key: 'americas', label: 'Amériques' },
    { key: 'asia', label: 'Asie / Océanie' },
    { key: 'africa', label: 'Afrique' },
    { key: 'international', label: 'International' },
  ];

  return (
    <div className='space-y-5'>
      <div className='rounded-3xl border border-[#e8ff00]/20 bg-[#e8ff00]/[0.05] p-4'>
        <div className='flex items-center gap-2'>
          <Trophy size={16} className='text-[#e8ff00]' />
          <span className='text-[15px] font-bold'>Centre des ligues</span>
        </div>
        <p className='mt-1 text-[12px] leading-relaxed text-muted-foreground'>
          VOLTRIX scanne {data ? data.leagues.length : 0} compétitions actives aujourd'hui parmi les {data?.catalogueSize ?? 99} suivies (toutes les ligues d'ESPN). Touche une ligue pour voir ses matchs.
        </p>
      </div>

      {!data ? (
        error ? (
          // Task 18-b : même honnêteté que l'accueil — pas de squelettes éternels
          // quand le serveur ne répond pas.
          <LoadErrorState onRetry={onRetry} />
        ) : (
          <div className='space-y-2'>
            {[1, 2, 3].map((i) => (
              <div key={i} className='volt-skeleton h-16 rounded-3xl' />
            ))}
          </div>
        )
      ) : (
        regions.map((r) => {
          const leagues = data.leagues.filter((l) => l.region === r.key);
          if (leagues.length === 0) return null;
          return (
            <section key={r.key}>
              <h2 className='mb-2 px-1 text-[13px] font-bold text-muted-foreground'>{r.label}</h2>
              <div className='space-y-2'>
                {leagues.map((l) => (
                  <button
                    key={l.code}
                    onClick={() => onPick(l.code)}
                    className='flex w-full items-center justify-between rounded-3xl border border-white/[0.06] bg-[#141418] p-4 text-left transition active:scale-[0.985]'
                  >
                    <div className='min-w-0'>
                      <div className='truncate text-[14px] font-semibold'>{l.name}</div>
                      <div className='text-[11px] text-muted-foreground'>{l.matches.length} match(s) aujourd'hui</div>
                    </div>
                    <span className='shrink-0 rounded-xl bg-[#e8ff00]/10 px-2.5 py-1 text-[12px] font-bold text-[#e8ff00]'>
                      {l.shortName}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}

// ---------- Onglet Profil ----------

function ProfileTab({ catalogueSize }: { catalogueSize?: number }) {
  return (
    <div className='space-y-4'>
      {/* Accès Précision VOLTRIX */}
      <Link
        href='/precision'
        className='flex items-center justify-between rounded-3xl border border-[#e8ff00]/20 bg-[#e8ff00]/[0.05] p-4 transition active:scale-[0.985]'
      >
        <div className='flex items-center gap-2.5'>
          <Target size={17} className='text-[#e8ff00]' />
          <div>
            <div className='text-[14px] font-bold'>Précision VOLTRIX</div>
            <div className='text-[11px] text-muted-foreground'>Taux de réussite, calibrage, historique — la transparence totale</div>
          </div>
        </div>
        <span className='text-[#e8ff00]'>→</span>
      </Link>

      {/* Installation mobile (PWA) — même app, même URL, mode standalone */}
      <PwaInstallButton />

      <div className='rounded-3xl border border-[#e8ff00]/20 bg-[#e8ff00]/[0.05] p-5 volt-glow'>
        <div className='flex items-center gap-2'>
          <Brain size={18} className='text-[#e8ff00]' />
          <span className='text-[16px] font-bold'>Comment fonctionne le moteur ?</span>
        </div>
        <p className='mt-2 text-[13px] leading-relaxed text-muted-foreground'>
          VOLTRIX croise 4 familles de données pour chaque match, puis combine 3 modèles statistiques complémentaires en un prono final pondéré.
        </p>
        <div className='mt-3 space-y-2.5 text-[13px]'>
          <div className='rounded-2xl bg-black/30 p-3'>
            <div className='font-semibold text-[#e8ff00]'>1 · Poisson (45%)</div>
            <div className='mt-0.5 text-muted-foreground'>Force offensive vs faiblesse défensive → buts attendus (xG) → probabilité de chaque score exact.</div>
          </div>
          <div className='rounded-2xl bg-black/30 p-3'>
            <div className='font-semibold text-[#e8ff00]'>2 · Rating Elo (30%)</div>
            <div className='mt-0.5 text-muted-foreground'>Puissance relative des équipes, mise à jour après chaque match, avantage du terrain intégré.</div>
          </div>
          <div className='rounded-2xl bg-black/30 p-3'>
            <div className='font-semibold text-[#e8ff00]'>3 · Forme récente (25%)</div>
            <div className='mt-0.5 text-muted-foreground'>5-6 derniers matchs pondérés (le match d'hier compte plus), domicile/extérieur séparés.</div>
          </div>
          <div className='rounded-2xl bg-black/30 p-3'>
            <div className='font-semibold text-[#e8ff00]'>+ Contexte</div>
            <div className='mt-0.5 text-muted-foreground'>Fatigue (délai entre matchs), blessures, enjeu (classement), derbys, météo, mouvements de cotes.</div>
          </div>
        </div>
      </div>

      <div className='rounded-3xl bg-[#141418] p-5'>
        <div className='flex items-center gap-2'>
          <ShieldCheck size={16} className='text-[#e8ff00]' />
          <span className='text-[15px] font-bold'>Value bets & Kelly</span>
        </div>
        <p className='mt-2 text-[13px] leading-relaxed text-muted-foreground'>
          Quand nos probabilités dépassent celles implicites dans les cotes du bookmaker, un « value bet » est détecté. Le critère de Kelly indique alors la mise théoriquement optimale (plafonnée à 10% de la bankroll). C'est la seule stratégie mathématiquement rentable à long terme.
        </p>
      </div>

      <div className='rounded-3xl bg-[#141418] p-5'>
        <div className='flex items-center gap-2'>
          <Info size={16} className='text-[#e8ff00]' />
          <span className='text-[15px] font-bold'>À propos</span>
        </div>
        <div className='mt-3 space-y-1.5 text-[13px] text-muted-foreground'>
          <div>Version : 2.5.0 — build 15/09/2026 (Base de données Neon PostgreSQL)</div>
          <div>Données : ESPN · Cotes : bookmakers partenaires ESPN</div>
          <div>Météo : Open-Meteo</div>
          <div>Compétitions suivies : {catalogueSize ?? '…'} ligues & coupes (ESPN)</div>
        </div>
      </div>

      <div className='rounded-3xl border border-[#ff4d5e]/25 bg-[#ff4d5e]/[0.06] p-5'>
        <div className='flex items-center gap-2'>
          <AlertTriangle size={16} className='text-[#ff4d5e]' />
          <span className='text-[15px] font-bold text-[#ff4d5e]'>Jeu responsable</span>
        </div>
        <p className='mt-2 text-[13px] leading-relaxed text-foreground/80'>
          VOLTRIX bet est un outil statistique informatif : il ne garantit aucun gain et n'incite pas au jeu. Les paris sportifs comportent des risques d'addiction et de perte d'argent. Ne mise que ce que tu peux te permettre de perdre.
        </p>
        <div className='mt-3 flex items-center gap-2'>
          <span className='rounded-full bg-white/10 px-3 py-1 text-[11px] font-bold'>18+</span>
          <Flame size={14} className='text-[#ff4d5e]' />
          <span className='text-[11px] text-muted-foreground'>Jouer comporte des risques</span>
        </div>
      </div>
    </div>
  );
}
