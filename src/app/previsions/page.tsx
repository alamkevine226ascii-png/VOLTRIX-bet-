'use client';

// ============================================================
// VOLTRIX bet — Page « PRÉVISIONS » (suivi & audit hebdomadaire)
// Cahier des charges « Prévisions hebdomadaires » :
//   §2  navigation par semaine calendaire (précédente/actuelle/suivante)
//   §7  carte par match : probabilités 1X2 / O/U 2.5 / BTTS + pronostics
//   §9  statuts (à venir, en direct, terminé, reporté, annulé, VOID)
//   §10 historique complet (semaines précédentes jamais supprimées)
//   §11 tableau de performance hebdomadaire
//   §13/§14/§15/§16 confiance, calibration, compétitions, erreurs
//   §17 bouton « GÉNÉRER LE RAPPORT DE LA SEMAINE » (PDF)
//   §18 export des données brutes JSON / CSV
// Cette page est un instrument d'audit — pas un affichage de pronostics.
//
// Disposition : gabarit visuel de la page /precision (header sticky,
// hero volt-glow, grille KPI 2 colonnes, cartes rounded-3xl bg-
// #141418 avec barres de progression, badges pill, disclaimer rouge).
// Toutes les données et métriques restent identiques.
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  FileText,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Target,
  XCircle,
} from 'lucide-react';
import { VoltrixTabBar } from '@/components/voltrix/tab-bar';
import { TeamLogo, ConfidenceStars } from '@/components/voltrix/shared';
import { VOLTRIX_SYNC_DONE_EVENT } from '@/components/voltrix/sync-wake-button';
import { dayHeaderFr } from '@/lib/forecast/week';
import { cn } from '@/lib/utils';

// ---------- Types (miroir de l'API /api/forecasts/week) ----------

interface WeekResult {
  status: string;
  statusDetail: string | null;
  homeScore: number | null;
  awayScore: number | null;
  retrievedAt: string;
}

interface WeekSnapshot {
  version: number;
  versionCount: number;
  p1x2Home: number;
  p1x2Draw: number;
  p1x2Away: number;
  pick1x2: string;
  pick1x2Label: string;
  pickedTeamId: string | null;
  confidence: number;
  pOver25: number;
  pUnder25: number;
  pickOu25: string;
  pOver25Raw: number | null;
  pBttsYes: number;
  pBttsNo: number;
  pickBtts: string;
  pBttsYesRaw: number | null;
  predictionTime: string;
  modelVersion: string;
  inputsDigest: string | null;
  odds1x2Home: number | null;
  odds1x2Draw: number | null;
  odds1x2Away: number | null;
  oddsOver25: number | null;
  oddsUnder25: number | null;
  oddsCapturedAt: string | null;
  ouMarketLine: number | null;
  frozenAt: string;
}

interface WeekMatch {
  matchId: string;
  league: string;
  leagueName: string;
  kickoff: string;
  homeTeam: string;
  homeLogo: string | null;
  awayTeam: string;
  awayLogo: string | null;
  espnState: string | null;
  statusDetail: string | null;
  // Task 28 §22 : statut EFFECTIF calculé côté serveur (résultat officiel
  // sinon état ESPN brut sinon secours temporel) — corrige le bug « À VENIR »
  effectiveStatus: string;
  statusLabel?: string;
  result: WeekResult | null;
  snapshot: WeekSnapshot | null;
  evaluation: { grade1x2: string | null; gradeOu25: string | null; gradeBtts: string | null; evaluatedAt: string } | null;
  predictionPending: boolean;
  predictionOutOfRange: boolean;
}

interface MarketStats {
  n: number;
  correct: number;
  incorrect: number;
  accuracy: number | null;
  brier: number | null;
  logLoss: number | null;
  rps: number | null;
  pending: number;
  void: number;
}

interface Bucket {
  bucket: string;
  n: number;
  predicted: number | null;
  observed: number | null;
}

interface WeekStats {
  matchesAnalyzed: number;
  matchesFinished: number;
  matchesPending: number;
  matchesVoid: number;
  m1x2: MarketStats;
  ou25: MarketStats;
  btts: MarketStats;
  globalAccuracy: number | null;
  globalCorrect: number;
  globalEvaluable: number;
  confidence: Array<{ level: number; n: number; correct: number; accuracy: number | null; brier: number | null }>;
  calibration1x2: Bucket[];
  calibrationOu25: Bucket[];
  calibrationBtts: Bucket[];
  leagues: Array<{ league: string; leagueName: string; n: number; acc1x2: number | null; brier1x2: number | null; accOu25: number | null; accBtts: number | null; sufficient: boolean }>;
  errors: Array<{ matchId: string; label: string; leagueName: string; kickoff: string; confidence: number; reasons: string[]; failures: Array<{ market: string; pickLabel: string; prob: number; actual: string }> }>;
}

interface WeekData {
  week: { start: string; end: string; label: string; isCurrent: boolean; isPast: boolean; prev: string; next: string };
  scanTriggered: boolean;
  job: { startedAt: string; finishedAt: string | null; phase: string; error: string | null; stats: Record<string, number | string[]> | null } | null;
  matches: WeekMatch[];
  stats: WeekStats;
}

// ---------- Helpers ----------

const pc = (x: number | null | undefined, digits = 0): string =>
  x === null || x === undefined ? '—' : `${(x * 100).toFixed(digits).replace('.', ',')} %`;

const br = (x: number | null | undefined): string =>
  x === null || x === undefined ? '—' : x.toFixed(3).replace('.', ',');

const timeFmt = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
const dateTimeFmt = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'UTC',
});

function mondayISO(d: Date): string {
  const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const dow = new Date(t).getUTCDay();
  return new Date(t - ((dow + 6) % 7) * 86_400_000).toISOString().slice(0, 10);
}

type StatusFilter = 'all' | 'upcoming' | 'finished' | 'void';

// ---------- Page ----------

export default function PrevisionsPage() {
  const [weekStart, setWeekStart] = useState<string>(() => mondayISO(new Date()));
  const [state, setState] = useState<{ loading: boolean; data: WeekData | null; error: boolean }>({
    loading: true,
    data: null,
    error: false,
  });
  const [syncing, setSyncing] = useState(false);
  const [filter, setFilter] = useState<StatusFilter>('all');

  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const load = useCallback((ws: string) => {
    fetch(`/api/forecasts/week?start=${ws}`)
      .then((r) => {
        if (!r.ok) throw new Error('HTTP KO');
        return r.json();
      })
      .then((data: WeekData) => {
        if (!aliveRef.current) return;
        setState({ loading: false, data, error: false });
      })
      .catch(() => {
        if (!aliveRef.current) return;
        setState((s) => ({ loading: false, data: s.data, error: true }));
      });
  }, []);

  // Chargement à chaque changement de semaine
  useEffect(() => {
    let alive = true;
    (async () => {
      await Promise.resolve();
      if (!alive) return;
      setState((s) => ({ ...s, loading: true, error: false }));
      load(weekStart);
    })();
    return () => {
      alive = false;
    };
  }, [weekStart, load]);

  const sync = useCallback(async () => {
    setSyncing(true);
    try {
      await fetch('/api/forecasts/tick', { method: 'POST' });
      if (aliveRef.current) load(weekStartRef.current);
    } finally {
      if (aliveRef.current) setSyncing(false);
    }
  }, [load]);

  const weekStartRef = useRef(weekStart);
  useEffect(() => {
    weekStartRef.current = weekStart;
  }, [weekStart]);

  // Task 45 §26 — synchronisation ESPN → Neon terminée (bouton « Actualiser
  // les données », ici ou chez un autre utilisateur) → recharger la semaine
  // affichée avec les données fraîches (nouveaux matchs, statuts, résultats).
  useEffect(() => {
    const onSyncDone = () => {
      if (aliveRef.current) load(weekStartRef.current);
    };
    window.addEventListener(VOLTRIX_SYNC_DONE_EVENT, onSyncDone);
    return () => window.removeEventListener(VOLTRIX_SYNC_DONE_EVENT, onSyncDone);
  }, [load]);

  // Ping automatique du job (90 s) tant que la page est ouverte —
  // garantit la génération des prédictions et la récupération des résultats.
  useEffect(() => {
    const id = setInterval(() => {
      fetch('/api/forecasts/tick', { method: 'POST' })
        .then(() => {
          if (aliveRef.current) load(weekStartRef.current);
        })
        .catch(() => {});
    }, 90_000);
    return () => clearInterval(id);
  }, [load]);

  const data = state.data;
  const stats = data?.stats ?? null;

  // Regroupement par jour calendaire UTC
  const days = useMemo(() => {
    if (!data) return [];
    const map = new Map<string, WeekMatch[]>();
    for (const m of data.matches) {
      const key = m.kickoff.slice(0, 10);
      const arr = map.get(key) ?? [];
      arr.push(m);
      map.set(key, arr);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [data]);

  const filtered = useMemo(() => {
    const keep = (m: WeekMatch): boolean => {
      // Task 28 §22 : statut effectif ESPN (le repli local SCHEDULED
      // masquait les matchs terminés sans ligne de résultat).
      const st = m.effectiveStatus ?? m.result?.status ?? 'SCHEDULED';
      if (filter === 'upcoming') return st === 'SCHEDULED' || st === 'LIVE' || st === 'HALFTIME' || st === 'UNKNOWN';
      if (filter === 'finished') return st === 'FINAL';
      if (filter === 'void') return ['POSTPONED', 'CANCELLED', 'SUSPENDED'].includes(st);
      return true;
    };
    return days.map(([day, list]) => [day, list.filter(keep)] as [string, WeekMatch[]]).filter(([, l]) => l.length > 0);
  }, [days, filter]);

  return (
    <div className='mx-auto flex min-h-[100dvh] max-w-[480px] flex-col bg-background'>
      {/* ---------- Header (gabarit Précision) ---------- */}
      <header className='pt-safe sticky top-0 z-40 border-b border-white/[0.05] bg-[#0a0a0c]/90 px-5 pb-3 backdrop-blur-sm'>
        <div className='flex items-center gap-3 pt-3'>
          <div className='min-w-0'>
            <div className='flex items-center gap-2'>
              <Target size={16} className='shrink-0 text-[#e8ff00]' />
              <span className='truncate font-display text-[17px] font-bold tracking-tight'>Prévisions</span>
            </div>
            <div className='mt-0.5 text-[10px] text-muted-foreground'>Audit du moteur · chaque prédiction est figée avant le coup d&apos;envoi</div>
          </div>
          <button
            onClick={sync}
            disabled={syncing}
            className='ml-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-white/[0.07] text-foreground/60 transition-[color,background-color,transform] active:scale-95 disabled:opacity-50'
            aria-label='Synchroniser les prévisions de la semaine'
          >
            <RefreshCw size={14} className={cn(syncing && 'animate-spin')} />
          </button>
        </div>
      </header>

      {/* ---------- Contenu ---------- */}
      <main className='flex-1 px-5 pb-32 pt-4'>
        {state.loading && !data ? (
          <div className='space-y-3'>
            <div className='volt-skeleton h-44 rounded-3xl' />
            <div className='volt-skeleton h-36 rounded-3xl' />
            <div className='volt-skeleton h-48 rounded-3xl' />
          </div>
        ) : state.error && !data ? (
          <div className='flex flex-col items-center gap-3 rounded-3xl border border-dashed border-white/10 py-14 text-center'>
            <AlertTriangle size={34} className='text-white/15' />
            <div className='text-[15px] font-semibold'>Prévisions indisponibles</div>
            <p className='max-w-[270px] text-[13px] text-muted-foreground'>Impossible de charger les prévisions pour le moment.</p>
            <button
              onClick={sync}
              className='mt-1 flex items-center gap-2 rounded-2xl bg-[#e8ff00] px-5 py-2.5 text-[13px] font-bold text-black transition-[color,background-color,transform] active:scale-95'
            >
              <RefreshCw size={14} /> Réessayer
            </button>
          </div>
        ) : data ? (
          <div className='space-y-4'>
            {/* ---------- Navigation semaines (§2) ---------- */}
            <div className='space-y-1.5'>
              <div className='flex items-center gap-1.5'>
                <button
                  type='button'
                  onClick={() => setWeekStart(data.week.prev)}
                  className='flex h-9 flex-1 items-center justify-center gap-1 rounded-2xl bg-white/[0.07] text-[10.5px] font-semibold text-foreground/70 transition-[color,background-color,transform] active:scale-95'
                >
                  <ChevronLeft size={14} /> Semaine précédente
                </button>
                <button
                  type='button'
                  onClick={() => setWeekStart(mondayISO(new Date()))}
                  className={cn(
                    'flex h-9 items-center justify-center rounded-2xl px-3 text-[10.5px] font-semibold transition-[color,background-color,transform] active:scale-95',
                    data.week.isCurrent ? 'bg-[#e8ff00]/[0.14] text-[#e8ff00]' : 'bg-white/[0.07] text-foreground/70'
                  )}
                >
                  Semaine actuelle
                </button>
                <button
                  type='button'
                  onClick={() => setWeekStart(data.week.next)}
                  className='flex h-9 flex-1 items-center justify-center gap-1 rounded-2xl bg-white/[0.07] text-[10.5px] font-semibold text-foreground/70 transition-[color,background-color,transform] active:scale-95'
                >
                  Semaine suivante <ChevronRight size={14} />
                </button>
              </div>
              <div className='text-[9.5px] text-muted-foreground/70'>
                {data.job
                  ? `Dernier job : ${data.job.phase} · ${dateTimeFmt.format(new Date(data.job.startedAt))} UTC`
                  : 'Job automatique : en attente du premier cycle'}
              </div>
            </div>

            {/* ---------- Hero : performance de la semaine (§11) ---------- */}
            <div className='rounded-3xl border border-[#e8ff00]/20 bg-[#e8ff00]/[0.06] p-5 volt-glow'>
              <div className='flex items-center justify-between'>
                <div className='flex items-center gap-1.5 text-[11px] text-muted-foreground'>
                  <BarChart3 size={13} className='text-[#e8ff00]' /> Performance de la semaine
                </div>
                {stats?.m1x2.brier != null && (
                  <span className='rounded-full bg-[#e8ff00]/15 px-2.5 py-1 text-[10px] font-bold text-[#e8ff00]'>
                    Brier 1X2 {br(stats.m1x2.brier)}
                  </span>
                )}
              </div>
              <div className='mt-1 text-[44px] font-bold leading-none text-[#e8ff00] tabular-nums'>
                {stats?.globalAccuracy != null ? pc(stats.globalAccuracy, 1) : '—'}
              </div>
              <div className='mt-1.5 text-[12px] text-muted-foreground'>
                {stats?.globalCorrect ?? 0} pronos corrects sur {stats?.globalEvaluable ?? 0} évalués · semaine du {data.week.start} au {data.week.end}
              </div>
              <p className='mt-3 border-t border-white/[0.07] pt-3 text-[11px] leading-relaxed text-muted-foreground'>
                Chaque match génère une prédiction figée avant le coup d&apos;envoi (1X2, O/U 2.5, BTTS), comparée au résultat officiel
                après le match, sans retouche possible. Le taux global combine les 3 marchés — Brier 0 = parfait, 0,25 = hasard
                (marchés binaires). Une semaine sert à observer, plusieurs semaines servent à évaluer.
              </p>
            </div>

            {/* ---------- KPIs (§11) ---------- */}
            <div className='grid grid-cols-2 gap-2.5'>
              <div className='rounded-3xl bg-[#141418] p-4'>
                <div className='text-[11px] text-muted-foreground'>Matchs de la semaine</div>
                <div className='mt-1 text-[24px] font-bold tabular-nums'>{data.matches.length}</div>
                <div className='text-[11px] text-muted-foreground'>toutes compétitions ESPN</div>
              </div>
              <div className='rounded-3xl bg-[#141418] p-4'>
                <div className='text-[11px] text-muted-foreground'>Avec prédiction</div>
                <div className='mt-1 text-[24px] font-bold tabular-nums'>{stats?.matchesAnalyzed ?? 0}</div>
                <div className='text-[11px] text-muted-foreground'>figées avant coup d&apos;envoi</div>
              </div>
              <div className='rounded-3xl bg-[#141418] p-4'>
                <div className='text-[11px] text-muted-foreground'>Terminés</div>
                <div className='mt-1 text-[24px] font-bold tabular-nums'>{stats?.matchesFinished ?? 0}</div>
                <div className='text-[11px] text-muted-foreground'>dont {stats?.matchesVoid ?? 0} VOID (reportés/annulés)</div>
              </div>
              <div className='rounded-3xl bg-[#141418] p-4'>
                <div className='text-[11px] text-muted-foreground'>En attente</div>
                <div className='mt-1 text-[24px] font-bold tabular-nums'>{stats?.matchesPending ?? 0}</div>
                <div className='text-[11px] text-muted-foreground'>résolus après les matchs</div>
              </div>
            </div>

            {/* ---------- Réussite par marché (§11) ---------- */}
            <div className='rounded-3xl bg-[#141418] p-4'>
              <div className='mb-3 flex items-center gap-2'>
                <BarChart3 size={15} className='text-[#e8ff00]' />
                <h3 className='text-[14px] font-bold'>Réussite par marché</h3>
              </div>
              {!stats || (stats.m1x2.n === 0 && stats.ou25.n === 0 && stats.btts.n === 0) ? (
                <p className='text-[12px] text-muted-foreground'>Les statistiques apparaîtront dès que les premiers matchs seront joués et évalués.</p>
              ) : (
                <div className='space-y-3'>
                  {([
                    ['1X2', stats.m1x2, true],
                    ['O/U 2.5', stats.ou25, false],
                    ['BTTS', stats.btts, false],
                  ] as Array<[string, MarketStats, boolean]>).map(([title, m, withRps]) => (
                    <div key={title}>
                      <div className='mb-1 flex justify-between text-[12px]'>
                        <span className='text-muted-foreground'>{title}</span>
                        <span className='font-semibold'>
                          {pc(m.accuracy, 0)} <span className='text-muted-foreground'>({m.correct}/{m.n})</span>
                        </span>
                      </div>
                      <div className='h-[7px] overflow-hidden rounded-full bg-white/[0.07]'>
                        <div className='volt-bar h-full rounded-full bg-[#e8ff00]' style={{ width: `${Math.max((m.accuracy ?? 0) * 100, 2)}%` }} />
                      </div>
                      <div className='mt-0.5 flex justify-between gap-3 text-[9.5px] text-muted-foreground'>
                        <span>
                          Corrects {m.correct} · Incorrects {m.incorrect}
                          {m.pending > 0 ? ` · En attente ${m.pending}` : ''}
                          {m.void > 0 ? ` · VOID ${m.void}` : ''}
                        </span>
                        <span className='shrink-0'>
                          Brier {br(m.brier)}
                          {withRps ? ` · RPS ${br(m.rps)}` : ''}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* ---------- Par niveau de confiance (§13) ---------- */}
            {(stats?.confidence.length ?? 0) > 0 && (
              <div className='rounded-3xl bg-[#141418] p-4'>
                <div className='mb-3 flex items-center gap-2'>
                  <Target size={15} className='text-[#e8ff00]' />
                  <h3 className='text-[14px] font-bold'>Performance par niveau de confiance</h3>
                </div>
                <p className='mb-3 text-[11px] leading-snug text-muted-foreground'>
                  Les étoiles annoncées avant le match prédisent-elles les chances réelles ? C&apos;est le test — sur une semaine, reste indicatif.
                </p>
                <div className='space-y-3'>
                  {stats!.confidence.map((c) => (
                    <div key={c.level}>
                      <div className='mb-1 flex items-center justify-between text-[12px]'>
                        <ConfidenceStars level={c.level} size={11} />
                        <span className='font-semibold'>
                          {pc(c.accuracy, 0)} <span className='text-muted-foreground'>({c.correct}/{c.n})</span>
                        </span>
                      </div>
                      <div className='h-[7px] overflow-hidden rounded-full bg-white/[0.07]'>
                        <div className='volt-bar h-full rounded-full bg-[#a3e635]' style={{ width: `${Math.max((c.accuracy ?? 0) * 100, 2)}%` }} />
                      </div>
                      <div className='mt-0.5 text-[9.5px] text-muted-foreground'>Brier {br(c.brier)}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ---------- Calibration des probabilités (§14) ---------- */}
            <div className='rounded-3xl bg-[#141418] p-4'>
              <h3 className='mb-1 text-[14px] font-bold'>Calibration des probabilités</h3>
              <p className='mb-3 text-[11px] leading-snug text-muted-foreground'>
                Quand VOLTRIX annonce 70 %, l&apos;événement se produit-il vraiment ≈ 70 % du temps ? Barre jaune = probabilité annoncée,
                barre verte = taux réel observé. Des barres proches = modèle honnête.
              </p>
              <div className='space-y-4'>
                <CalibBlock title='1X2 (probabilité du pick)' buckets={stats?.calibration1x2 ?? []} />
                <CalibBlock title='O/U 2.5' buckets={stats?.calibrationOu25 ?? []} />
                <CalibBlock title='BTTS' buckets={stats?.calibrationBtts ?? []} />
              </div>
            </div>

            {/* ---------- Par compétition (§15) ---------- */}
            {(stats?.leagues.length ?? 0) > 0 && (
              <div className='rounded-3xl bg-[#141418] p-4'>
                <h3 className='mb-1 text-[14px] font-bold'>Performance par compétition</h3>
                <p className='mb-3 text-[11px] leading-snug text-muted-foreground'>
                  Réussite 1X2 par compétition (barre), avec les marchés O/U 2.5 et BTTS en détail.
                </p>
                <div className='max-h-80 space-y-3 overflow-y-auto pr-1'>
                  {stats!.leagues.map((l) => (
                    <div key={l.league}>
                      <div className='mb-1 flex justify-between gap-3 text-[12px]'>
                        <span className='min-w-0 truncate text-muted-foreground'>{l.leagueName}</span>
                        <span className='shrink-0 font-semibold'>
                          {pc(l.acc1x2, 0)} <span className='text-muted-foreground'>(n {l.n})</span>
                        </span>
                      </div>
                      <div className='h-[7px] overflow-hidden rounded-full bg-white/[0.07]'>
                        <div className='volt-bar h-full rounded-full bg-[#e8ff00]' style={{ width: `${Math.max((l.acc1x2 ?? 0) * 100, 2)}%` }} />
                      </div>
                      <div className='mt-0.5 text-[9.5px] text-muted-foreground'>
                        O/U 2.5 {pc(l.accOu25, 0)} · BTTS {pc(l.accBtts, 0)}
                        {!l.sufficient ? ' · échantillon insuffisant (n < 30)' : ''}
                      </div>
                    </div>
                  ))}
                </div>
                <p className='mt-3 border-t border-white/[0.07] pt-2.5 text-[10px] leading-snug text-muted-foreground'>
                  Échantillon insuffisant — n &lt; 30 : les chiffres des compétitions sous ce seuil ne doivent pas être interprétés comme significatifs.
                </p>
              </div>
            )}

            {/* ---------- Où VOLTRIX s'est trompé ? (§16) ---------- */}
            <div className='rounded-3xl bg-[#141418] p-4'>
              <div className='mb-3 flex items-center gap-2'>
                <ShieldAlert size={15} className='text-[#e8ff00]' />
                <h3 className='text-[14px] font-bold'>Où VOLTRIX s&apos;est trompé ?</h3>
              </div>
              {(stats?.errors.length ?? 0) === 0 ? (
                <p className='text-[12px] text-muted-foreground'>Aucune erreur à forte confiance / forte probabilité cette semaine.</p>
              ) : (
                <div className='max-h-96 space-y-2 overflow-y-auto pr-1'>
                  {stats!.errors.map((e) => (
                    <div key={e.matchId} className='rounded-2xl bg-black/30 p-3'>
                      <div className='flex items-center justify-between gap-2'>
                        <span className='truncate text-[12px] font-semibold'>{e.label}</span>
                        <span className='shrink-0 rounded-full bg-[#e8ff00]/15 px-2 py-0.5 text-[10px] font-bold text-[#e8ff00]'>{e.confidence}/5</span>
                      </div>
                      <div className='mt-0.5 truncate text-[10px] text-muted-foreground'>{e.leagueName} · {dateTimeFmt.format(new Date(e.kickoff))} UTC</div>
                      <ul className='mt-1 space-y-0.5'>
                        {e.failures.map((f, i) => (
                          <li key={i} className='text-[10px] text-red-300/85'>
                            {f.market} : {f.pickLabel} ({pc(f.prob)}) → {f.actual}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
              <p className='mt-3 border-t border-white/[0.07] pt-2.5 text-[10px] leading-snug text-muted-foreground'>
                Sélection : forte confiance + erreur, ou probabilité ≥ 70 % non réalisée. Diagnostic descriptif, pas sanction.
              </p>
            </div>

            {/* ---------- Rapport + exports (§17/§18) ---------- */}
            <a
              href={`/api/forecasts/report?start=${weekStart}`}
              className='flex h-11 items-center justify-center gap-2 rounded-2xl bg-[#e8ff00] text-[13px] font-bold text-black transition-[color,background-color,transform] active:scale-[0.98]'
            >
              <FileText size={15} /> GÉNÉRER LE RAPPORT DE LA SEMAINE
            </a>
            <div className='grid grid-cols-2 gap-2.5'>
              <a
                href={`/api/forecasts/export?start=${weekStart}&format=json`}
                className='flex h-9 items-center justify-center gap-1.5 rounded-2xl bg-white/[0.07] text-[11px] font-semibold text-foreground/70 transition-[color,background-color,transform] active:scale-95'
              >
                <Download size={12} /> Exporter JSON
              </a>
              <a
                href={`/api/forecasts/export?start=${weekStart}&format=csv`}
                className='flex h-9 items-center justify-center gap-1.5 rounded-2xl bg-white/[0.07] text-[11px] font-semibold text-foreground/70 transition-[color,background-color,transform] active:scale-95'
              >
                <Download size={12} /> Exporter CSV
              </a>
            </div>

            {/* ---------- Liste des matchs (§7) ---------- */}
            <div className='flex items-center gap-1.5 overflow-x-auto pb-1'>
              {([
                ['all', 'Tous'],
                ['upcoming', 'À venir'],
                ['finished', 'Terminés'],
                ['void', 'VOID'],
              ] as Array<[StatusFilter, string]>).map(([k, label]) => (
                <button
                  key={k}
                  type='button'
                  onClick={() => setFilter(k)}
                  className={cn(
                    'h-7 shrink-0 rounded-full px-3 text-[10px] font-semibold transition-[color,background-color,transform] active:scale-95',
                    filter === k ? 'bg-[#e8ff00] text-black' : 'bg-white/[0.07] text-foreground/55'
                  )}
                >
                  {label}
                </button>
              ))}
              <span className='ml-auto shrink-0 text-[9.5px] text-muted-foreground'>{filtered.reduce((a, [, l]) => a + l.length, 0)} matchs</span>
            </div>

            {filtered.length === 0 ? (
              <div className='py-12 text-center text-[12px] text-muted-foreground'>
                Aucun match pour ce filtre.
                <br />
                <span className='text-[10px] text-muted-foreground/70'>Le scan ESPN de cette semaine est peut-être en cours — reconsulter dans quelques instants.</span>
              </div>
            ) : (
              <div className='space-y-4'>
                {filtered.map(([day, list]) => (
                  <div key={day}>
                    <div className='sticky top-16 z-10 -mx-1 bg-background/90 px-1 py-1.5 backdrop-blur-sm'>
                      <h3 className='text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground'>
                        {dayHeaderFr(new Date(`${day}T12:00:00Z`))} <span className='font-medium normal-case text-muted-foreground/60'>· {list.length} match{list.length > 1 ? 's' : ''}</span>
                      </h3>
                    </div>
                    <div className='space-y-2.5'>
                      {list.map((m) => (
                        <MatchCard key={m.matchId} m={m} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* ---------- Note d'audit + disclaimer ---------- */}
            <p className='text-[10px] leading-relaxed text-muted-foreground/80'>
              Système de suivi et d&apos;audit des performances du moteur de prévision. Les probabilités affichées sont celles, FIGÉES,
              générées avant le coup d&apos;envoi (predictionTime &lt; kickoff vérifié). Les résultats officiels sont stockés séparément
              et ne modifient jamais les prédictions. Une semaine sert à observer, plusieurs semaines servent à évaluer.
            </p>
            <div className='rounded-3xl border border-[#ff4d5e]/25 bg-[#ff4d5e]/[0.06] p-4'>
              <div className='flex items-center gap-2'>
                <AlertTriangle size={14} className='text-[#ff4d5e]' />
                <span className='text-[13px] font-bold text-[#ff4d5e]'>Jeu responsable</span>
              </div>
              <p className='mt-1.5 text-[11px] leading-relaxed text-foreground/75'>
                VOLTRIX bet est un outil statistique informatif : il ne garantit aucun gain. Les probabilités affichées sont des
                estimations figées avant match et ne préjugent pas des résultats futurs. 18+.
              </p>
            </div>
          </div>
        ) : null}

        {state.loading && data && (
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

// ---------- Sous-composants ----------

function CalibBlock({ title, buckets }: { title: string; buckets: Bucket[] }) {
  return (
    <div>
      <div className='mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground'>{title}</div>
      {buckets.length === 0 ? (
        <div className='text-[11px] text-muted-foreground/70'>Pas encore assez de prédictions résolues par tranche.</div>
      ) : (
        <div className='space-y-2.5'>
          {buckets.map((b) => (
            <div key={b.bucket}>
              <div className='mb-1 flex justify-between text-[11px]'>
                <span className='text-muted-foreground'>{b.bucket}</span>
                <span className='tabular-nums'>
                  <span className='font-semibold text-foreground'>{pc(b.observed, 0)}</span>{' '}
                  <span className='text-muted-foreground'>réel · {pc(b.predicted, 0)} prévu ({b.n})</span>
                </span>
              </div>
              <div className='space-y-1'>
                <div className='h-[6px] overflow-hidden rounded-full bg-white/[0.07]'>
                  <div className='volt-bar h-full rounded-full bg-[#e8ff00]' style={{ width: `${Math.max((b.predicted ?? 0) * 100, 2)}%` }} />
                </div>
                <div className='h-[6px] overflow-hidden rounded-full bg-white/[0.07]'>
                  <div className='volt-bar h-full rounded-full bg-[#a3e635]' style={{ width: `${Math.max((b.observed ?? 0) * 100, 2)}%` }} />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function gradeIcon(g: string | null | undefined) {
  if (g === 'CORRECT') return <CheckCircle2 size={13} className='text-emerald-400' />;
  if (g === 'INCORRECT') return <XCircle size={13} className='text-red-400' />;
  return <span className='text-[9px] text-white/30'>—</span>;
}

function MatchCard({ m }: { m: WeekMatch }) {
  const s = m.snapshot;
  const r = m.result;
  // Task 28 §22 : statut effectif ESPN prioritaire — un match terminé
  // apparaît TERMINÉ même si la ligne de résultat n'existe pas encore
  // (espnState 'post' ou secours temporel côté serveur).
  const st = m.effectiveStatus ?? m.result?.status ?? 'SCHEDULED';
  const isVoid = st === 'POSTPONED' || st === 'CANCELLED' || st === 'SUSPENDED';
  const isLive = st === 'LIVE' || st === 'HALFTIME';
  const isFinal = st === 'FINAL';
  const hasScore = r?.homeScore != null && r?.awayScore != null;

  const statusBadge = isVoid ? (
    <span className='rounded-full border border-amber-400/30 bg-amber-400/[0.1] px-2 py-0.5 text-[8.5px] font-bold text-amber-300'>
      {st === 'POSTPONED' ? 'REPORTÉ · VOID' : st === 'CANCELLED' ? 'ANNULÉ · VOID' : 'SUSPENDU · VOID'}
    </span>
  ) : isLive ? (
    <span className='flex items-center gap-1 rounded-full border border-red-400/30 bg-red-400/[0.1] px-2 py-0.5 text-[8.5px] font-bold text-red-300'>
      <span className='h-1.5 w-1.5 animate-pulse rounded-full bg-red-400' /> EN DIRECT
    </span>
  ) : isFinal ? (
    <span className='rounded-full border border-emerald-400/25 bg-emerald-400/[0.08] px-2 py-0.5 text-[8.5px] font-bold text-emerald-300'>TERMINÉ</span>
  ) : (
    <span className='flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.05] px-2 py-0.5 text-[8.5px] font-bold text-foreground/55'>
      <Clock size={9} /> À VENIR
    </span>
  );

  return (
    <article className='rounded-3xl bg-[#141418] p-4'>
      {/* Équipes */}
      <div className='flex items-center gap-2.5'>
        <TeamLogo src={m.homeLogo} alt={m.homeTeam} size={30} />
        <div className='min-w-0 flex-1'>
          <div className='truncate text-[12.5px] font-bold leading-tight'>{m.homeTeam}</div>
          <div className='truncate text-[12.5px] font-bold leading-tight text-foreground/75'>{m.awayTeam}</div>
        </div>
        {isFinal ? (
          <div className='shrink-0 text-right'>
            <div className='text-[19px] font-bold leading-none tracking-tight text-[#e8ff00]'>
              {hasScore ? (
                <>
                  {r!.homeScore}–{r!.awayScore}
                </>
              ) : (
                <span className='text-[13px] text-[#e8ff00]/70'>···</span>
              )}
            </div>
            <div className='mt-0.5 text-[7.5px] uppercase tracking-wide text-muted-foreground'>{hasScore ? 'Résultat final' : 'Score en attente'}</div>
          </div>
        ) : (
          <div className='shrink-0 text-right'>
            <div className='text-[14px] font-bold leading-none text-foreground/85'>{timeFmt.format(new Date(m.kickoff))}</div>
            <div className='mt-0.5 text-[7.5px] uppercase tracking-wide text-muted-foreground'>UTC</div>
          </div>
        )}
      </div>

      <div className='mt-2 flex items-center gap-2'>
        <span className='truncate text-[9px] text-muted-foreground'>
          {m.leagueName} · {dateTimeFmt.format(new Date(m.kickoff))} UTC
        </span>
        <span className='ml-auto shrink-0'>{statusBadge}</span>
      </div>

      {/* Prédiction figée */}
      {s ? (
        <div className='mt-3 rounded-2xl border border-[#e8ff00]/20 bg-[#e8ff00]/[0.05] p-3'>
          <div className='flex items-center justify-between'>
            <span className='text-[8px] font-bold uppercase tracking-widest text-[#e8ff00]/80'>VOLTRIX · figée avant match</span>
            {s.versionCount > 1 && <span className='text-[8px] text-muted-foreground'>v{s.version} sur {s.versionCount}</span>}
          </div>
          {/* 1X2 */}
          <div className='mt-2'>
            <div className='flex items-baseline justify-between text-[10px]'>
              <span className='font-semibold text-foreground/60'>1X2</span>
              <span className='font-bold text-foreground'>
                {s.pick1x2Label} <span className='text-[#e8ff00]'>{pc(s.pick1x2 === '1' ? s.p1x2Home : s.pick1x2 === '2' ? s.p1x2Away : s.p1x2Draw)}</span>
              </span>
            </div>
            <div className='mt-1 flex h-1.5 overflow-hidden rounded-full bg-white/[0.06]'>
              <div className='bg-[#e8ff00]' style={{ width: `${s.p1x2Home * 100}%` }} />
              <div className='bg-white/30' style={{ width: `${s.p1x2Draw * 100}%` }} />
              <div className='bg-white/15' style={{ width: `${s.p1x2Away * 100}%` }} />
            </div>
            <div className='mt-1 flex justify-between text-[8.5px] text-muted-foreground'>
              <span>Dom. {pc(s.p1x2Home)}</span>
              <span>Nul {pc(s.p1x2Draw)}</span>
              <span>Ext. {pc(s.p1x2Away)}</span>
            </div>
            <div className='mt-1 flex items-center justify-between'>
              <span className='text-[8.5px] text-muted-foreground'>Confiance</span>
              <ConfidenceStars level={s.confidence} size={10} />
            </div>
          </div>
          {/* O/U + BTTS */}
          <div className='mt-2 grid grid-cols-2 gap-2 border-t border-white/[0.06] pt-2'>
            <div>
              <div className='text-[8.5px] font-semibold text-muted-foreground'>O/U 2.5</div>
              <div className='text-[10px] font-bold text-foreground'>
                {s.pickOu25 === 'OVER' ? 'Plus de 2.5' : 'Moins de 2.5'} <span className='text-[#e8ff00]'>{pc(s.pickOu25 === 'OVER' ? s.pOver25 : s.pUnder25)}</span>
              </div>
              <div className='text-[8px] text-muted-foreground'>
                Over {pc(s.pOver25)} · Under {pc(s.pUnder25)}
              </div>
            </div>
            <div>
              <div className='text-[8.5px] font-semibold text-muted-foreground'>BTTS</div>
              <div className='text-[10px] font-bold text-foreground'>
                {s.pickBtts === 'YES' ? 'Oui' : 'Non'} <span className='text-[#e8ff00]'>{pc(s.pickBtts === 'YES' ? s.pBttsYes : s.pBttsNo)}</span>
              </div>
              <div className='text-[8px] text-muted-foreground'>
                Oui {pc(s.pBttsYes)} · Non {pc(s.pBttsNo)}
              </div>
            </div>
          </div>
          {/* Verdicts */}
          {(isFinal || isVoid) && m.evaluation && (
            <div className='mt-2 flex items-center justify-between border-t border-white/[0.06] pt-2'>
              <span className='text-[8.5px] font-semibold text-muted-foreground'>Verdicts</span>
              <div className='flex items-center gap-2.5'>
                <span className='flex items-center gap-1 text-[9px] text-foreground/60'>1X2 {gradeIcon(m.evaluation.grade1x2)}</span>
                <span className='flex items-center gap-1 text-[9px] text-foreground/60'>O/U {gradeIcon(m.evaluation.gradeOu25)}</span>
                <span className='flex items-center gap-1 text-[9px] text-foreground/60'>BTTS {gradeIcon(m.evaluation.gradeBtts)}</span>
              </div>
            </div>
          )}
          {/* Audit (petit) */}
          <div className='mt-2 border-t border-white/[0.05] pt-1.5 text-[7.5px] leading-relaxed text-muted-foreground/60'>
            Figée le {dateTimeFmt.format(new Date(s.predictionTime))} UTC · moteur {s.modelVersion}
            {s.inputsDigest ? ` · digest ${s.inputsDigest}` : ''}
            {s.odds1x2Home ? ` · cotes 1X2 ${s.odds1x2Home.toFixed(2)}/${s.odds1x2Draw?.toFixed(2) ?? '—'}/${s.odds1x2Away?.toFixed(2) ?? '—'}` : ' · sans cotes'}
          </div>
        </div>
      ) : m.predictionPending ? (
        <div className='mt-3 rounded-2xl bg-black/30 px-3 py-2.5 text-[9.5px] text-muted-foreground'>
          <span className='flex items-center gap-1.5'>
            <Clock size={11} /> Prédiction en attente — générée et figée automatiquement avant le coup d&apos;envoi.
          </span>
        </div>
      ) : m.predictionOutOfRange ? (
        <div className='mt-3 rounded-2xl bg-black/30 px-3 py-2.5 text-[9.5px] text-muted-foreground'>
          Prédiction à venir — cette semaine entre dans la fenêtre de génération automatique (2 semaines avant le coup d&apos;envoi).
        </div>
      ) : (
        <div className='mt-3 rounded-2xl bg-black/30 px-3 py-2.5 text-[9.5px] text-muted-foreground'>
          {isVoid ? 'Match non joué — prédictions VOID, exclues des statistiques.' : 'Aucune prédiction figée pour ce match (analysé après le coup d\u2019envoi : publication refusée par la règle anti-fuite).'}
        </div>
      )}
    </article>
  );
}
