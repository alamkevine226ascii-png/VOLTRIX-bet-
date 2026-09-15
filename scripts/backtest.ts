#!/usr/bin/env bun
// ============================================================
// VOLTRIX bet — Task 22-c : BACKTEST V3
// Horizons T−Xh · cotes-à-T (open) · folds multi-périodes ·
// intervalles bootstrap · entrées gelées · anti-fuite.
// ============================================================
// Verdict V2 point 4 : « modéliser explicitement information disponible
// à T → prédiction à T → résultat ultérieur » ; les closing odds restent
// séparées des informations disponibles à T.
//
// SÉMANTIQUE COTES-À-T (limitation ESPN documentée : aucun timestamp de
// cote dans le pickcenter) :
//   - input modèle + baseline MARCHÉ-À-T = OPEN odds dé-margées
//     UNIQUEMENT (proxy « disponible à T_pred ») ;
//   - les CLOSE odds sont INTERDITES en input (plan étape 3) — elles ne
//     servent QUE de référence séparée « MARCHÉ-CLÔTURE » (étiquetée) ;
//   - open odds absentes → variantes marché exclues pour le match
//     (tailles explicites dans results.json).
//
// Baselines sur EXACTEMENT les mêmes matchs (étape 6) : MARCHÉ-À-T,
// MARCHÉ-CLÔTURE, POISSON-SIMPLE, ELO-SIMPLE, MIX (Poisson+Elo+forme,
// recette 22-b), VOLTRIX-FULL-CAL (ancré open) / FULL-RAW, VOLTRIX-LEAGUE,
// VOLTRIX-MIX-CAL. Chaque comparaison porte `independence` (étape 8).
//
// FOLDS (étape 9) : --folds "2026-05,2026-06,…" = mois calendaires ;
// résultats PAR FOLD + POOLÉS ; un process unique = un run (calendriers
// (équipe,saison) collectés UNE seule fois, partagés entre folds).
// League-params estimés sur la saison PRÉCÉDENTE chaque fold (zéro fuite),
// décision poolée stricte (étape 10).
//
// ENTRÉES GELÉES (étape 5) : download/backtest-runs/<UTC-ts>/ — meta.json,
// matches.jsonl (1 ligne/match×horizon : cotes utilisées, λ, probs de
// CHAQUE variante, digest, n historique), results.json (copié dans
// download/backtest-v3-results.json). REJEU sans réseau :
//   bun scripts/backtest.ts --replay download/backtest-runs/<UTC-ts>
//
// Discipline as-of (détails backtest-lib.ts) : historiques STRICT <
// T_pred = kickoff − Xh, classement synthétisé < T_pred, blessures [],
// météo null, nowMs = T_pred. Tests anti-fuite : scripts/test-anti-leak.ts.
//
// Usage orchestrateur (folds complets) :
//   bun scripts/backtest.ts --folds "2026-05,2026-06,2026-07,2026-08" \
//     --leagues eng.1,fra.1,esp.1,ita.1,ger.1,bra.1 \
//     --max-per-fold 250 --horizons "12,6,3,1"
// Smoke (budget ≤ ~200 requêtes) :
//   bun scripts/backtest.ts --folds "2026-08" --leagues eng.1,bra.1 \
//     --max-per-fold 30 --horizons "12,3"
// ⚠️ Codes ESPN RÉELS du catalogue src/lib/leagues.ts : fra.1/esp.1/ita.1/
// ger.1 (fr.1/es.1/it.1/de.1 ne renvoient RIEN chez ESPN — constat 21-d).
// ============================================================

import { currentSeasonYear } from '../src/lib/analyze';
import { MODEL_VERSION } from '../src/lib/model-version';
import type { EspnOdds } from '../src/lib/espn';
import {
  BOOTSTRAP_B,
  addBinary,
  addTriple,
  allGamesOf,
  collectMatches,
  estimateLeagueParams,
  evaluateMatchV3,
  fetchHistoricalOddsV3,
  fetchTeamSchedules,
  finalizeAcc,
  independenceOf,
  newAcc,
  outcomeOf,
  pairedDeltaTest,
  type CollectedMatch,
  type FinalMetrics,
  type HistoricalOdds,
  type Key1x2,
  type KeyBin,
  type MetricAcc,
  type RequestStats,
} from './backtest-lib';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const SCRIPT_DIR = dirname(resolve(process.argv[1] ?? '.'));
const PROJECT_DIR = resolve(SCRIPT_DIR, '..');

// ---------- CLI ----------

interface CliArgs {
  folds: string[];
  leagues: string[];
  maxPerFold: number;
  horizons: number[];
  replay: string | null;
}

function parseCli(): CliArgs {
  const argv = process.argv.slice(2);
  const get = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const DEFAULT_LEAGUES = 'eng.1,fra.1,esp.1,ita.1,ger.1,bra.1'; // codes ESPN réels (21-d)
  const folds = (get('folds') ?? '2026-08').split(',').map((s) => s.trim()).filter(Boolean);
  const leagues = (get('leagues') ?? DEFAULT_LEAGUES).split(',').map((s) => s.trim()).filter(Boolean);
  const maxPerFold = Math.max(1, parseInt(get('max-per-fold') ?? get('max') ?? '250', 10) || 250);
  const horizons = (get('horizons') ?? '12,6,3,1')
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => b - a);
  const replay = get('replay') ?? null;
  return { folds, leagues, maxPerFold, horizons, replay };
}

/** Fenêtre [premier jour, dernier jour] UTC d'un fold YYYY-MM. */
function foldWindow(fold: string): { from: string; to: string } {
  const [y, m] = fold.split('-').map((x) => parseInt(x, 10));
  const from = `${fold}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate(); // jour 0 du mois suivant
  const to = `${fold}-${String(lastDay).padStart(2, '0')}`;
  return { from, to };
}

// ---------- Enregistrements d'évaluation (partagés live/rejeu) ----------

export interface AggRecord {
  matchId: string;
  league: string;
  fold: string;
  kickoff: string;
  tPred: string;
  horizonH: number;
  homeName: string;
  awayName: string;
  hs: number;
  as: number;
  probs: {
    oneXtwo: Partial<Record<Key1x2, { home: number; draw: number; away: number }>>;
    ou25: Partial<Record<KeyBin, number>>;
    btts: Partial<Record<KeyBin, number>>;
  };
  lambdas?: {
    poisson?: { h: number; a: number };
    mix?: { h: number; a: number };
    full?: { h: number; a: number };
    league?: { h: number; a: number };
  };
  digest?: string;
  histN?: { home: number; away: number };
  oddsUsed?: { engine: 'open-only' | 'none'; hasOpen: boolean; hasClose: boolean };
}

// ---------- Grille de métriques : scope × horizon × marché × variante ----------

type MarketName = '1X2' | 'OU25' | 'BTTS';
const SEPARATOR = '::'; // les scopes contiennent '|' (f:…|L:…)

class MetricGrid {
  accs = new Map<string, MetricAcc>();

  acc(scope: string, h: string, market: MarketName, key: string): MetricAcc {
    const k = `${scope}${SEPARATOR}${h}${SEPARATOR}${market}${SEPARATOR}${key}`;
    let a = this.accs.get(k);
    if (!a) {
      a = newAcc();
      this.accs.set(k, a);
    }
    return a;
  }

  get(scope: string, h: string, market: MarketName, key: string): MetricAcc | undefined {
    return this.accs.get(`${scope}${SEPARATOR}${h}${SEPARATOR}${market}${SEPARATOR}${key}`);
  }
}

function aggregate(records: AggRecord[]): { grid: MetricGrid; lambdaAcc: Map<string, { h: number; a: number; n: number }> } {
  const grid = new MetricGrid();
  const lambdaAcc = new Map<string, { h: number; a: number; n: number }>();
  const bumpLambda = (scope: string, variant: string, l: { h: number; a: number } | undefined) => {
    if (!l || !Number.isFinite(l.h)) return;
    const k = `${scope}${SEPARATOR}${variant}`;
    const e = lambdaAcc.get(k) ?? { h: 0, a: 0, n: 0 };
    e.h += l.h;
    e.a += l.a;
    e.n++;
    lambdaAcc.set(k, e);
  };
  for (const r of records) {
    const outcome = outcomeOf(r.hs, r.as);
    const over25 = r.hs + r.as > 2.5;
    const bttsYes = r.hs > 0 && r.as > 0;
    const hLabel = `h${r.horizonH}h`;
    const scopes = ['POOL', `f:${r.fold}`, `L:${r.league}`, `f:${r.fold}|L:${r.league}`];
    const hs = [hLabel, 'ALL'];
    const pmKey = `${r.matchId}@${r.horizonH}h`;
    for (const sc of scopes) {
      for (const h of hs) {
        for (const [k, p] of Object.entries(r.probs.oneXtwo)) if (p) addTriple(grid.acc(sc, h, '1X2', k), p, outcome, pmKey);
        for (const [k, p] of Object.entries(r.probs.ou25)) if (p !== undefined && p !== null) addBinary(grid.acc(sc, h, 'OU25', k), p, over25, pmKey);
        for (const [k, p] of Object.entries(r.probs.btts)) if (p !== undefined && p !== null) addBinary(grid.acc(sc, h, 'BTTS', k), p, bttsYes, pmKey);
      }
      for (const v of ['poisson', 'mix', 'full', 'league'] as const) bumpLambda(sc, v, r.lambdas?.[v]);
    }
  }
  return { grid, lambdaAcc };
}

// ---------- Sérialisation ----------

function r6(x: number | undefined | null): number | null {
  if (x === undefined || x === null || !Number.isFinite(x)) return null;
  return Math.round(x * 1e6) / 1e6;
}

function metricsJson(f: FinalMetrics, withRps: boolean): Record<string, unknown> {
  if (!f.n) return { n: 0 };
  return {
    n: f.n,
    brier: r6(f.brier),
    brierCi95: f.brierCi ? [r6(f.brierCi.lo), r6(f.brierCi.hi)] : null,
    logLoss: r6(f.logLoss),
    rps: withRps ? r6(f.rps) : null,
    rpsCi95: withRps && f.rpsCi ? [r6(f.rpsCi.lo), r6(f.rpsCi.hi)] : null,
    accuracy: r6(f.accuracy),
    calibration: f.calibration.map((b) => ({ label: b.label, count: b.count, avgProb: r6(b.avgProb), actualRate: r6(b.actualRate) })),
  };
}

function buildByScope(grid: MetricGrid): Record<string, Record<string, Record<string, Record<string, unknown>>>> {
  const byScope: Record<string, Record<string, Record<string, Record<string, unknown>>>> = {};
  for (const [k, acc] of grid.accs) {
    const parts = k.split(SEPARATOR);
    const scope = parts[0];
    const h = parts[1];
    const market = parts[2] as MarketName;
    const key = parts.slice(3).join(SEPARATOR);
    const f = finalizeAcc(acc, market === '1X2');
    byScope[scope] ??= {};
    byScope[scope][h] ??= {};
    byScope[scope][h][market] ??= {};
    byScope[scope][h][market][key] = metricsJson(f, market === '1X2');
  }
  return byScope;
}

// ---------- Tests appariés (plan étapes 7-8) ----------

const PAIRED_PAIRS: Array<[MarketName, string, string]> = [
  ['OU25', 'voltrixFullRaw', 'marketClose'], // ← LIVRABLE CLÉ du plan
  ['OU25', 'voltrixFullRaw', 'poisson'],
  ['OU25', 'voltrixFullCal', 'marketAtT'], // non-indépendant (ancré open)
  ['OU25', 'voltrixFullRaw', 'mix'],
  ['OU25', 'mix', 'poisson'],
  ['1X2', 'voltrixFull', 'marketClose'],
  ['1X2', 'voltrixFull', 'poisson'],
  ['1X2', 'mix', 'poisson'],
  ['BTTS', 'poisson', 'voltrixFullRaw'], // ablation BTTS (étape 11)
  ['BTTS', 'mix', 'voltrixFullRaw'],
  ['BTTS', 'poisson', 'mix'],
];

const KEY_FOLD_PAIRS: Array<[MarketName, string, string]> = [
  ['OU25', 'voltrixFullRaw', 'marketClose'],
  ['1X2', 'voltrixFull', 'marketClose'],
  ['BTTS', 'poisson', 'voltrixFullRaw'],
];

interface PairedEntry {
  scope: string;
  horizon: string;
  market: MarketName;
  a: string;
  b: string;
  n: number;
  deltaBrier: number | null; // Δ = a − b (négatif ⇒ a meilleur)
  ci95: [number, number] | null;
  pApprox: number | null;
  independence: 'independant' | 'non-indépendant';
  lecture: string | null;
}

function pairedTest(grid: MetricGrid, scope: string, h: string, market: MarketName, a: string, b: string): PairedEntry | null {
  const aa = grid.get(scope, h, market, a);
  const bb = grid.get(scope, h, market, b);
  if (!aa || !bb) return null;
  const res = pairedDeltaTest(aa.perMatch, bb.perMatch);
  if (!res) return null;
  return {
    scope,
    horizon: h,
    market,
    a,
    b,
    n: res.n,
    deltaBrier: r6(res.meanDelta),
    ci95: [r6(res.ciLo), r6(res.ciHi)] as [number, number],
    pApprox: r6(res.pApprox),
    independence: independenceOf(a, b),
    lecture: res.meanDelta < 0 ? `${a} meilleur (Δ<0)` : `${b} meilleur (Δ>0)`,
  };
}

function pairedTestsFor(records: AggRecord[], grid: MetricGrid): PairedEntry[] {
  const out: PairedEntry[] = [];
  const folds = [...new Set(records.map((r) => r.fold))].sort();
  const horizons = [...new Set(records.map((r) => r.horizonH))].sort((a, b) => b - a);
  for (const [market, a, b] of PAIRED_PAIRS) {
    const e = pairedTest(grid, 'POOL', 'ALL', market, a, b);
    if (e) out.push(e);
    for (const h of horizons) {
      const eh = pairedTest(grid, 'POOL', `h${h}h`, market, a, b);
      if (eh) out.push(eh);
    }
  }
  for (const fold of folds) {
    for (const [market, a, b] of KEY_FOLD_PAIRS) {
      const e = pairedTest(grid, `f:${fold}`, 'ALL', market, a, b);
      if (e) out.push(e);
    }
  }
  return out;
}

// ---------- O/U par ligue (plan étape 12) ----------

const OU_LEAGUE_VARIANTS: KeyBin[] = ['marketClose', 'marketAtT', 'poisson', 'mix', 'voltrixFullRaw', 'voltrixFullCal'];

function ouPerLeague(records: AggRecord[], grid: MetricGrid): Record<string, unknown> {
  const leagues = [...new Set(records.map((r) => r.league))].sort();
  const out: Record<string, unknown> = {};
  for (const lg of leagues) {
    const cell: Record<string, unknown> = {};
    const pooled: Record<string, unknown> = {};
    for (const v of OU_LEAGUE_VARIANTS) {
      const acc = grid.get(`L:${lg}`, 'ALL', 'OU25', v);
      if (acc && acc.n > 0) pooled[v] = metricsJson(finalizeAcc(acc, false), false);
    }
    cell.pooledAllFolds = pooled;
    const byFold: Record<string, unknown> = {};
    for (const fold of [...new Set(records.map((r) => r.fold))].sort()) {
      const perVariant: Record<string, unknown> = {};
      for (const v of OU_LEAGUE_VARIANTS) {
        const acc = grid.get(`f:${fold}|L:${lg}`, 'ALL', 'OU25', v);
        if (acc && acc.n > 0) perVariant[v] = metricsJson(finalizeAcc(acc, false), false);
      }
      if (Object.keys(perVariant).length) byFold[fold] = perVariant;
    }
    cell.byFold = byFold;
    out[lg] = cell;
  }
  return out;
}

// ---------- Ablation BTTS (plan étape 11) ----------

function bttsAblation(records: AggRecord[], grid: MetricGrid, lambdaAcc: Map<string, { h: number; a: number; n: number }>): Record<string, unknown> {
  const cell = (scope: string): Record<string, unknown> => {
    const variants: Record<string, unknown> = {};
    for (const v of ['poisson', 'mix', 'voltrixFullRaw'] as const) {
      const acc = grid.get(scope, 'ALL', 'BTTS', v);
      if (!acc || acc.n === 0) continue;
      const f = finalizeAcc(acc, false);
      const lam = lambdaAcc.get(`${scope}${SEPARATOR}${v === 'voltrixFullRaw' ? 'full' : v}`);
      variants[v] = {
        ...metricsJson(f, false),
        lambdaMoyen: lam && lam.n ? { home: r6(lam.h / lam.n), away: r6(lam.a / lam.n), n: lam.n } : null,
      };
    }
    return { variants };
  };
  const byFold: Record<string, unknown> = {};
  for (const fold of [...new Set(records.map((r) => r.fold))].sort()) byFold[fold] = cell(`f:${fold}`);
  return { pooled: cell('POOL'), byFold, note: 'Diagnostic uniquement (plan étape 11) — AUCUNE modification du moteur.' };
}

// ---------- Décision league-params (plan étape 10) ----------

function better(a: FinalMetrics | undefined, b: FinalMetrics | undefined, metric: 'rps' | 'brier'): boolean | null {
  if (!a || !b || !a.n || !b.n) return null;
  const va = metric === 'rps' ? a.rps : a.brier;
  const vb = metric === 'rps' ? b.rps : b.brier;
  if (!Number.isFinite(va) || !Number.isFinite(vb)) return null;
  return va < vb - 1e-9;
}

function leagueDecision(records: AggRecord[], grid: MetricGrid, paramsPerFold: Record<string, unknown>): Record<string, unknown> {
  const folds = [...new Set(records.map((r) => r.fold))].sort();
  const foldLines: string[] = [];
  let foldsWhereLeagueBetter = 0;
  for (const fold of folds) {
    const sc = `f:${fold}`;
    const metrics = (market: MarketName, key: string): FinalMetrics | undefined => {
      const acc = grid.get(sc, 'ALL', market, key);
      return acc && acc.n ? finalizeAcc(acc, market === '1X2') : undefined;
    };
    const checks = [
      ['RPS 1X2', better(metrics('1X2', 'voltrixLeague'), metrics('1X2', 'voltrixFull'), 'rps')],
      ['Brier O/U brut', better(metrics('OU25', 'voltrixLeagueRaw'), metrics('OU25', 'voltrixFullRaw'), 'brier')],
      ['Brier BTTS calibré', better(metrics('BTTS', 'voltrixLeagueCal'), metrics('BTTS', 'voltrixFullCal'), 'brier')],
    ] as Array<[string, boolean | null]>;
    const wins = checks.filter(([, w]) => w === true).length;
    if (wins >= 2) foldsWhereLeagueBetter++;
    foldLines.push(`${fold} : ${checks.map(([l, w]) => `${l}=${w === null ? 'n/d' : w ? '✓' : '✗'}`).join(' · ')} → ${wins}/2+ métriques`);
  }
  const pooled = (market: MarketName, key: string): FinalMetrics | undefined => {
    const acc = grid.get('POOL', 'ALL', market, key);
    return acc && acc.n ? finalizeAcc(acc, market === '1X2') : undefined;
  };
  const pooledChecks = [
    ['RPS 1X2', better(pooled('1X2', 'voltrixLeague'), pooled('1X2', 'voltrixFull'), 'rps')],
    ['Brier O/U brut', better(pooled('OU25', 'voltrixLeagueRaw'), pooled('OU25', 'voltrixFullRaw'), 'brier')],
    ['Brier O/U calibré', better(pooled('OU25', 'voltrixLeagueCal'), pooled('OU25', 'voltrixFullCal'), 'brier')],
    ['Brier BTTS calibré', better(pooled('BTTS', 'voltrixLeagueCal'), pooled('BTTS', 'voltrixFullCal'), 'brier')],
    ['LogLoss 1X2', better(pooled('1X2', 'voltrixLeague'), pooled('1X2', 'voltrixFull'), 'rps')],
  ] as Array<[string, boolean | null]>;
  const pooledWins = pooledChecks.filter(([, w]) => w === true).length;
  const activated = folds.length >= 2 && foldsWhereLeagueBetter >= 2 && pooledWins >= 2;
  return {
    criteria: 'ACTIVER seulement si ≥2 folds avec ≥2 métriques améliorées ET ≥2 métriques poolées (strict)',
    perFold: foldLines,
    pooled: pooledChecks.map(([l, w]) => `${l}=${w === null ? 'n/d' : w ? '✓' : '✗'}`),
    pooledWins,
    foldsWhereLeagueBetter,
    decision: activated ? 'ACTIVER (à re-tester avant tout câblage production)' : 'NE PAS ACTIVER — modèle global conservé (leagueGoalAverages reste un champ optionnel)',
    paramsPerFold,
    note: 'src/lib gelé (22-c) : la décision est un RAPPORT, aucun fichier src/lib n\'est régénéré.',
  };
}

// ---------- Impression console ----------

function fmt(x: number | undefined | null, digits = 4): string {
  if (x === undefined || x === null || Number.isNaN(x)) return '—';
  return x.toFixed(digits);
}

function ciStr(m: Record<string, unknown>, field: 'brierCi95' | 'rpsCi95'): string {
  const ci = m[field] as [number, number] | null;
  return ci ? `[${ci[0].toFixed(4)};${ci[1].toFixed(4)}]` : '—';
}

function printMainTable(title: string, cell: Record<string, unknown> | undefined, labels: Record<string, string>, withRps: boolean): void {
  console.log(`\n════════ ${title} ════════`);
  if (!cell) return;
  const entries = Object.entries(cell).filter(([, m]) => (m as Record<string, unknown>).n);
  console.log(
    'Variante'.padEnd(34) + 'n'.padStart(5) + 'Brier'.padStart(9) + 'IC95'.padStart(18) + (withRps ? 'RPS'.padStart(9) + 'IC95'.padStart(18) : '') + 'LogLoss'.padStart(9) + 'Acc%'.padStart(7)
  );
  for (const [k, mRaw] of entries) {
    const m = mRaw as Record<string, unknown>;
    const n = m.n as number;
    console.log(
      (labels[k] ?? k).padEnd(34) +
        String(n).padStart(5) +
        fmt(m.brier as number).padStart(9) +
        ciStr(m, 'brierCi95').padStart(18) +
        (withRps ? fmt(m.rps as number).padStart(9) + ciStr(m, 'rpsCi95').padStart(18) : '') +
        fmt(m.logLoss as number).padStart(9) +
        (n ? ((m.accuracy as number) * 100).toFixed(1) : '—').padStart(7)
    );
  }
}

/** Colonnes = SCOPES (horizon figé ALL) : tables PAR FOLD / PAR LIGUE. */
function printByScope(
  title: string,
  scopes: Array<[string, string]>,
  grid: MetricGrid,
  market: MarketName,
  keys: string[],
  labels: Record<string, string>,
  withRps = false
): void {
  console.log(`\n════════ ${title} ════════`);
  console.log('Variante'.padEnd(30) + scopes.map(([, lbl]) => lbl.padStart(16)).join(''));
  for (const k of keys) {
    const cells = scopes.map(([sc]) => {
      const acc = grid.get(sc, 'ALL', market, k);
      if (!acc || acc.n === 0) return '—'.padStart(16);
      const f = finalizeAcc(acc, withRps);
      return `${withRps ? fmt(f.rps) : fmt(f.brier)} n=${f.n}`.padStart(16);
    });
    console.log((labels[k] ?? k).padEnd(30) + cells.join(''));
  }
}

/** Colonnes = HORIZONS (scope figé POOL) : stabilité selon T_pred (plan étape 4). */
function printByHorizon(
  title: string,
  horizons: Array<[string, string]>,
  grid: MetricGrid,
  market: MarketName,
  keys: string[],
  labels: Record<string, string>,
  withRps = false
): void {
  console.log(`\n════════ ${title} ════════`);
  console.log('Variante'.padEnd(30) + horizons.map(([, lbl]) => lbl.padStart(16)).join(''));
  for (const k of keys) {
    const cells = horizons.map(([h]) => {
      const acc = grid.get('POOL', h, market, k);
      if (!acc || acc.n === 0) return '—'.padStart(16);
      const f = finalizeAcc(acc, withRps);
      return `${withRps ? fmt(f.rps) : fmt(f.brier)} n=${f.n}`.padStart(16);
    });
    console.log((labels[k] ?? k).padEnd(30) + cells.join(''));
  }
}

// ---------- Rejouage (reconstructibilité, plan étape 5) ----------

function loadReplayRecords(runDir: string): { records: AggRecord[]; meta: Record<string, unknown> | null } {
  const lines = readFileSync(join(runDir, 'matches.jsonl'), 'utf8')
    .split('\n')
    .filter((l) => l.trim().length > 0);
  const records: AggRecord[] = [];
  for (const l of lines) {
    const j = JSON.parse(l) as Record<string, unknown>;
    records.push({
      matchId: j.matchId as string,
      league: j.league as string,
      fold: (j.kickoff as string).slice(0, 7),
      kickoff: j.kickoff as string,
      tPred: j.tPred as string,
      horizonH: j.horizonH as number,
      homeName: j.homeName as string,
      awayName: j.awayName as string,
      hs: (j.outcome as Record<string, number>).homeScore,
      as: (j.outcome as Record<string, number>).awayScore,
      probs: (j.probs as AggRecord['probs']) ?? { oneXtwo: {}, ou25: {}, btts: {} },
      lambdas: (j.probs as Record<string, unknown>)?.lambdas as AggRecord['lambdas'],
      digest: j.digest as string,
      histN: j.histN as AggRecord['histN'],
      oddsUsed: j.oddsUsed as AggRecord['oddsUsed'],
    });
  }
  let meta: Record<string, unknown> | null = null;
  try {
    meta = JSON.parse(readFileSync(join(runDir, 'meta.json'), 'utf8')) as Record<string, unknown>;
  } catch {
    meta = null;
  }
  return { records, meta };
}

// ---------- Main ----------

async function main(): Promise<void> {
  const args = parseCli();
  const log = (s: string) => console.log(s);

  console.log('════════ VOLTRIX bet — BACKTEST V3 (Task 22-c) ════════');

  // ---- Mode REJEU : réévaluation depuis matches.jsonl SANS réseau ----
  if (args.replay) {
    const runDir = resolve(PROJECT_DIR, args.replay);
    const { records, meta } = loadReplayRecords(runDir);
    log(`Rejeu depuis ${runDir} — ${records.length} lignes matches.jsonl (réseau : AUCUN appel).`);
    const { grid, lambdaAcc } = aggregate(records);
    const byScope = buildByScope(grid);
    const paired = pairedTestsFor(records, grid);
    const replayed = {
      meta: { ...(meta ?? {}), replayed: true, replayedAt: new Date().toISOString(), replaySource: runDir },
      results: {
        byScope,
        pairedTests: paired,
        ouPerLeague: ouPerLeague(records, grid),
        bttsAblation: bttsAblation(records, grid, lambdaAcc),
      },
    };
    const outPath = resolve(PROJECT_DIR, 'download', 'backtest-v3-replay-results.json');
    writeFileSync(outPath, JSON.stringify(replayed, null, 2));
    const pooledOu = (byScope.POOL?.ALL?.OU25 ?? {}) as Record<string, Record<string, unknown>>;
    const key = paired.find((p) => p.market === 'OU25' && p.scope === 'POOL' && p.horizon === 'ALL' && p.a === 'voltrixFullRaw' && p.b === 'marketClose');
    log(`Livrable clé (rejeu) : VOLTRIX-RAW vs MARCHÉ-CLÔTURE O/U 2.5 poolé → ΔBrier=${key ? key.deltaBrier : 'n/d'} p≈${key ? key.pApprox : 'n/d'} (n=${key ? key.n : 0})`);
    log(`Brier O/U 2.5 VOLTRIX-RAW poolé : ${fmt(pooledOu.voltrixFullRaw?.brier as number)} (n=${pooledOu.voltrixFullRaw?.n ?? 0})`);
    log(`JSON rejeu écrit : ${outPath}`);
    return;
  }

  // ---- Mode LIVE ----
  const stats: RequestStats = { scoreboard: 0, schedule: 0, summary: 0, excluded: { voidOrCancelled: 0, notFinalOrNoScore: 0, noTeams: 0, outsideWindow: 0 } };
  log(`Folds : ${args.folds.join(', ')} · ligues : ${args.leagues.join(', ')} · max/fold ${args.maxPerFold} · horizons T−${args.horizons.join('h, T−')}h`);

  // 1. Collecte PAR FOLD (scoreboards historiques)
  const matchesByFold = new Map<string, CollectedMatch[]>();
  for (const fold of args.folds) {
    const { from, to } = foldWindow(fold);
    const before = stats.scoreboard;
    const matches = await collectMatches({ from, to, leagues: args.leagues, max: args.maxPerFold, stats, onProgress: log });
    matchesByFold.set(fold, matches);
    log(`\n[fold ${fold}] ${from} → ${to} : ${matches.length} matchs éligibles (scoreboards : ${stats.scoreboard - before})`);
  }
  const allMatches = [...matchesByFold.values()].flat();
  if (allMatches.length === 0) {
    log('Aucun match éligible — abandon.');
    return;
  }
  const perLeagueCounts: Record<string, number> = {};
  for (const m of allMatches) perLeagueCounts[m.league] = (perLeagueCounts[m.league] ?? 0) + 1;
  log(`Total matchs : ${allMatches.length} — par ligue : ${Object.entries(perLeagueCounts).map(([l, n]) => `${l}=${n}`).join(' ')}`);

  // 2. Calendriers équipes : UNE collecte partagée entre folds (clé (équipe,saison))
  const teamsByLeague = new Map<string, Set<string>>();
  const seasonSet = new Set<number>();
  for (const m of allMatches) {
    if (!teamsByLeague.has(m.league)) teamsByLeague.set(m.league, new Set());
    teamsByLeague.get(m.league)!.add(m.homeId);
    teamsByLeague.get(m.league)!.add(m.awayId);
    seasonSet.add(currentSeasonYear(m.kickoff, m.league));
  }
  const seasons = new Set<number>();
  for (const s of seasonSet) {
    seasons.add(s);
    seasons.add(s - 1); // saison précédente (params ligue + historiques)
  }
  const seasonList = [...seasons].sort();
  const totalTeams = [...teamsByLeague.values()].reduce((s, t) => s + t.size, 0);
  log(`\nÉquipes uniques : ${totalTeams} · saisons historiques : ${seasonList.join(', ')} — collecte calendriers (1× par (équipe,saison), concurrence 5)…`);
  const schedules = await fetchTeamSchedules(teamsByLeague, seasonList, stats, log);

  // 3. League-params PAR FOLD : saison PRÉCÉDENTE (zéro fuite, plan étape 10)
  const paramsCache = new Map<number, ReturnType<typeof estimateLeagueParams>>();
  const paramsPerFold: Record<string, Record<string, unknown>> = {};
  const leagueParamsFor = (fold: string, league: string, matches: CollectedMatch[]): { home: number; away: number } | null => {
    const first = matches.find((m) => m.league === league);
    if (!first) return null;
    const paramsSeason = currentSeasonYear(first.kickoff, league) - 1;
    if (!paramsCache.has(paramsSeason)) paramsCache.set(paramsSeason, estimateLeagueParams(schedules, paramsSeason));
    const p = paramsCache.get(paramsSeason)!.byLeague[league];
    return p && p.sample >= 10 ? { home: p.homeAvg, away: p.awayAvg } : null;
  };
  for (const [fold, matches] of matchesByFold) {
    paramsPerFold[fold] = {};
    for (const league of new Set(matches.map((m) => m.league))) {
      const first = matches.find((m) => m.league === league)!;
      const paramsSeason = currentSeasonYear(first.kickoff, league) - 1;
      if (!paramsCache.has(paramsSeason)) paramsCache.set(paramsSeason, estimateLeagueParams(schedules, paramsSeason));
      const pp = paramsCache.get(paramsSeason)!.byLeague[league];
      paramsPerFold[fold][league] = { paramsSeason, params: pp ?? null, applied: !!(pp && pp.sample >= 10) };
    }
  }

  // 4. Cotes historiques : full (open+close) + openOnly (input modèle à T)
  log(`\nCotes historiques (summary ESPN — open = input modèle, close = référence seulement)…`);
  const oddsMap = await fetchHistoricalOddsV3(allMatches, stats, log);
  const withOpen = allMatches.filter((m) => oddsMap.get(m.id)?.openOnly?.hasOdds).length;
  const withClose = allMatches.filter((m) => oddsMap.get(m.id)?.full?.hasOdds).length;
  log(`Open odds disponibles (input modèle) : ${withOpen}/${allMatches.length} · close (référence) : ${withClose}/${allMatches.length}`);

  // 5. Évaluation : chaque (match × horizon) — fonction pure evaluateMatchV3
  const runTs = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = resolve(PROJECT_DIR, 'download', 'backtest-runs', runTs);
  mkdirSync(runDir, { recursive: true });
  const jsonlLines: string[] = [];
  const records: AggRecord[] = [];
  let engineCalls = 0;
  let done = 0;
  for (const [fold, matches] of matchesByFold) {
    for (const m of matches) {
      const odds = oddsMap.get(m.id) ?? { full: null, openOnly: null };
      const oddsOpen = odds.openOnly?.hasOdds ? odds.openOnly : null; // input modèle = open ONLY
      const oddsCloseRef = odds.full; // référence Marché-clôture UNIQUEMENT (jamais dans runEngine)
      const homeGamesAll = allGamesOf(schedules, m.league, m.homeId);
      const awayGamesAll = allGamesOf(schedules, m.league, m.awayId);
      const leagueParams = leagueParamsFor(fold, m.league, matches);
      for (const h of args.horizons) {
        const ev = evaluateMatchV3(m, oddsOpen, oddsCloseRef, homeGamesAll, awayGamesAll, leagueParams, h);
        engineCalls += oddsOpen ? 4 : 3; // mix, full, league (+ mixCal si open)
        const hs = m.homeScore;
        const as = m.awayScore;
        const line = {
          matchId: m.id,
          league: m.league,
          fold,
          kickoff: m.kickoff,
          tPred: new Date(ev.tPredMs).toISOString(),
          horizonH: h,
          homeName: m.homeName,
          awayName: m.awayName,
          outcome: { homeScore: hs, awayScore: as, result: hs > as ? 'H' : hs === as ? 'D' : 'A', ou25: hs + as > 2.5, btts: hs > 0 && as > 0 },
          histN: { home: ev.hist.home.n, away: ev.hist.away.n },
          hist: ev.hist,
          oddsUsed: { engine: (oddsOpen ? 'open-only' : 'none') as 'open-only' | 'none', hasOpen: !!oddsOpen, hasClose: !!oddsCloseRef?.hasOdds },
          odds: {
            engineInput: 'open-only (close INTERDITE en input — plan étape 3)',
            open: oddsOpen,
            closeReference: oddsCloseRef,
          },
          leagueParamsApplied: leagueParams,
          digest: ev.digest,
          lambdas: ev.lambdas,
          probs: { oneXtwo: ev.oneXtwo, ou25: ev.ou25, btts: ev.btts },
        };
        jsonlLines.push(JSON.stringify(line));
        records.push({
          matchId: m.id,
          league: m.league,
          fold,
          kickoff: m.kickoff,
          tPred: line.tPred,
          horizonH: h,
          homeName: m.homeName,
          awayName: m.awayName,
          hs,
          as,
          probs: { oneXtwo: ev.oneXtwo, ou25: ev.ou25, btts: ev.btts },
          lambdas: ev.lambdas,
          digest: ev.digest,
          histN: line.histN,
          oddsUsed: line.oddsUsed,
        });
      }
      done++;
      if (done % 25 === 0) log(`  [évaluation] ${done}/${allMatches.length} matchs × ${args.horizons.length} horizons`);
    }
  }

  // 6. Agrégation + incertitude + tests appariés
  const { grid, lambdaAcc } = aggregate(records);
  const byScope = buildByScope(grid);
  const paired = pairedTestsFor(records, grid);
  const ouLeague = ouPerLeague(records, grid);
  const ablation = bttsAblation(records, grid, lambdaAcc);
  const decision = leagueDecision(records, grid, paramsPerFold);

  // 7. ENTRÉES GELÉES (plan étape 5) : meta.json + matches.jsonl + results.json
  const meta = {
    task: '22-c — Backtest V3 : horizons T−Xh, cotes-à-T, folds multi-périodes, intervalles de confiance, entrées gelées',
    generatedAt: new Date().toISOString(),
    modelVersion: MODEL_VERSION,
    engineNote: 'moteur gelé 21-b/22-b/22-d : runEngine(contextMode full|mix) + leagueGoalAverages + p.raw + MODEL_VERSION',
    folds: args.folds.map((f) => ({ fold: f, ...foldWindow(f) })),
    leagues: args.leagues,
    maxPerFold: args.maxPerFold,
    horizonsH: args.horizons,
    tPredSemantics: 'T_pred = kickoff − Xh ; historiques STRICT < T_pred ; classement synthétisé < T_pred ; injuries [] ; weather null ; nowMs = T_pred',
    oddsSemantics: {
      proxy: 'OPEN odds pickcenter summary = input modèle + baseline MARCHÉ-À-T (aucun timestamp de cote chez ESPN — limitation documentée)',
      closeOdds: 'INTERDITES en input (plan étape 3) — conservées comme référence séparée MARCHÉ-CLÔTURE (étiquetée)',
      missingOpen: 'variantes marché exclues pour le match (tailles explicites dans results.json)',
    },
    independencePolicy: 'toute comparaison « calibré vs marché qui l\'a ancré » = non-indépendant (plan étape 8) — champ independence sur chaque test apparié',
    bootstrap: { B: BOOTSTRAP_B, method: 'percentile 2.5-97.5, seed mulberry32 fixe', paired: 'ΔBrier par match, p approx bilatérale add-one' },
    requestBudget: { scoreboard: stats.scoreboard, schedule: stats.schedule, summary: stats.summary, total: stats.scoreboard + stats.schedule + stats.summary, concurrencyMax: 5, engineCalls },
    counts: {
      matches: allMatches.length,
      records: records.length,
      withOpenOdds: withOpen,
      withCloseOdds: withClose,
      uniqueTeams: totalTeams,
      seasons: seasonList,
      excluded: stats.excluded,
    },
    asOfDiscipline: {
      historiques: 'fetchTeamSchedule saison courante + précédente, filtre STRICT date < T_pred (walk-forward)',
      classement: 'endpoint standings ESPN INTERDIT (état actuel = fuite) — synthétisé depuis les matchs < T_pred',
      blessures: '[] — endpoint ESPN = blessures ACTUELLES uniquement (= fuite) ; choix documenté',
      meteo: 'null (influence retirée des λ en 21-b)',
      cotes: 'summary ESPN pickcenter (DraftKings) — open = input modèle, close = référence Marché-clôture uniquement',
      isDerby: 'détection rivalités codée du moteur (runEngine), input false',
      nowMs: 'T_pred = kickoff − Xh (fatigue/14 jours as-of)',
    },
    reconstructibility: `bun scripts/backtest.ts --replay download/backtest-runs/${runTs}  (réévaluation sans réseau depuis matches.jsonl)`,
  };
  writeFileSync(join(runDir, 'meta.json'), JSON.stringify(meta, null, 2));
  writeFileSync(join(runDir, 'matches.jsonl'), jsonlLines.join('\n') + '\n');

  const resultsJson = {
    meta,
    results: {
      byScope,
      pairedTests: paired,
      ouPerLeague: ouLeague,
      bttsAblation: ablation,
      leagueParamsDecision: decision,
    },
  };
  writeFileSync(join(runDir, 'results.json'), JSON.stringify(resultsJson, null, 2));
  writeFileSync(resolve(PROJECT_DIR, 'download', 'backtest-v3-results.json'), JSON.stringify(resultsJson, null, 2));

  // 8. Affichage console
  const poolAll = byScope.POOL?.ALL;
  printMainTable('POOLÉ (tous folds × tous horizons) — 1X2 (Brier multiclass, RPS H-D-A)', poolAll?.['1X2'], {
    marketAtT: 'MARCHÉ-À-T (open dé-margé)',
    marketClose: 'MARCHÉ-CLÔTURE (référence)',
    poisson: 'POISSON-SIMPLE',
    elo: 'ELO-SIMPLE',
    mix: 'MIX (Poisson+Elo+forme)',
    voltrixFull: 'VOLTRIX-FULL',
    voltrixLeague: 'VOLTRIX-LEAGUE',
  }, true);
  printMainTable('POOLÉ — O/U 2.5 (Brier binaire sur P(plus de 2.5))', poolAll?.OU25, {
    marketAtT: 'MARCHÉ-À-T (open dé-margé)',
    marketClose: 'MARCHÉ-CLÔTURE (référence)',
    poisson: 'POISSON-SIMPLE',
    mix: 'MIX',
    mixCal: 'VOLTRIX-MIX-CAL',
    voltrixFullRaw: 'VOLTRIX-FULL-RAW',
    voltrixFullCal: 'VOLTRIX-FULL-CAL (ancré open)',
    voltrixLeagueRaw: 'VOLTRIX-LEAGUE-RAW',
    voltrixLeagueCal: 'VOLTRIX-LEAGUE-CAL',
  }, false);
  printMainTable('POOLÉ — BTTS (MARCHÉ : ESPN ne publie pas de cote BTTS)', poolAll?.BTTS, {
    poisson: 'POISSON-SIMPLE',
    mix: 'MIX',
    mixCal: 'VOLTRIX-MIX-CAL',
    voltrixFullRaw: 'VOLTRIX-FULL-RAW',
    voltrixFullCal: 'VOLTRIX-FULL-CAL (ancré open)',
    voltrixLeagueRaw: 'VOLTRIX-LEAGUE-RAW',
    voltrixLeagueCal: 'VOLTRIX-LEAGUE-CAL',
  }, false);

  const keyTest = paired.find((p) => p.market === 'OU25' && p.scope === 'POOL' && p.horizon === 'ALL' && p.a === 'voltrixFullRaw' && p.b === 'marketClose');
  if (keyTest) {
    console.log(`\n➜ LIVRABLE CLÉ — VOLTRIX-RAW vs MARCHÉ-CLÔTURE (O/U 2.5, poolé) : ΔBrier=${keyTest.deltaBrier?.toFixed(5)} IC95=[${keyTest.ci95?.[0].toFixed(5)};${keyTest.ci95?.[1].toFixed(5)}] p≈${keyTest.pApprox} (n=${keyTest.n}) — ${keyTest.lecture}`);
  }

  // POOLÉ par horizon (plan étape 4 : stabilité des probabilités selon T_pred)
  const hLabels: Array<[string, string]> = args.horizons.map((h) => [`h${h}h`, `T−${h}h`]);
  printByHorizon('POOLÉ PAR HORIZON — 1X2 (RPS)', hLabels, grid, '1X2', ['marketClose', 'poisson', 'elo', 'mix', 'voltrixFull'], { marketClose: 'MARCHÉ-CLÔTURE', poisson: 'POISSON', elo: 'ELO', mix: 'MIX', voltrixFull: 'VOLTRIX-FULL' }, true);
  printByHorizon('POOLÉ PAR HORIZON — O/U 2.5 (Brier)', hLabels, grid, 'OU25', ['marketClose', 'marketAtT', 'poisson', 'mix', 'voltrixFullRaw', 'voltrixFullCal'], { marketClose: 'MARCHÉ-CLÔTURE', marketAtT: 'MARCHÉ-À-T', poisson: 'POISSON', mix: 'MIX', voltrixFullRaw: 'VOLTRIX-RAW', voltrixFullCal: 'VOLTRIX-CAL' });
  printByHorizon('POOLÉ PAR HORIZON — BTTS (Brier)', hLabels, grid, 'BTTS', ['poisson', 'mix', 'voltrixFullRaw', 'voltrixFullCal'], { poisson: 'POISSON', mix: 'MIX', voltrixFullRaw: 'VOLTRIX-RAW', voltrixFullCal: 'VOLTRIX-CAL' });

  // Par fold
  const foldScopes: Array<[string, string]> = args.folds.map((f) => [`f:${f}`, f]);
  printByScope('PAR FOLD (tous horizons) — 1X2 (RPS)', foldScopes, grid, '1X2', ['marketClose', 'poisson', 'elo', 'mix', 'voltrixFull'], { marketClose: 'MARCHÉ-CLÔTURE', poisson: 'POISSON', elo: 'ELO', mix: 'MIX', voltrixFull: 'VOLTRIX-FULL' }, true);
  printByScope('PAR FOLD (tous horizons) — O/U 2.5 (Brier)', foldScopes, grid, 'OU25', ['marketClose', 'poisson', 'mix', 'voltrixFullRaw', 'voltrixFullCal'], { marketClose: 'MARCHÉ-CLÔTURE', poisson: 'POISSON', mix: 'MIX', voltrixFullRaw: 'VOLTRIX-RAW', voltrixFullCal: 'VOLTRIX-CAL' });
  printByScope('PAR FOLD (tous horizons) — BTTS (Brier)', foldScopes, grid, 'BTTS', ['poisson', 'mix', 'voltrixFullRaw'], { poisson: 'POISSON', mix: 'MIX', voltrixFullRaw: 'VOLTRIX-RAW' });

  // O/U par ligue (aperçu console : poolé ; détail par fold dans results.json)
  const lgScopes: Array<[string, string]> = Object.keys(byScope).filter((s) => s.startsWith('L:')).sort().map((s) => [s, s.replace('L:', '')]);
  printByScope('O/U 2.5 PAR LIGUE (poolé folds×horizons — Brier)', lgScopes, grid, 'OU25', ['marketClose', 'poisson', 'mix', 'voltrixFullRaw', 'voltrixFullCal'], { marketClose: 'MARCHÉ-CLÔTURE', poisson: 'POISSON', mix: 'MIX', voltrixFullRaw: 'VOLTRIX-RAW', voltrixFullCal: 'VOLTRIX-CAL' });

  console.log('\n════════ ABLATION BTTS (diagnostic — plan étape 11) ════════');
  for (const [v, m] of Object.entries((ablation.pooled as Record<string, Record<string, unknown>>).variants ?? {})) {
    const mm = m as Record<string, unknown>;
    const lam = mm.lambdaMoyen as { home: number; away: number } | null;
    console.log(`  ${(v === 'voltrixFullRaw' ? 'VOLTRIX-FULL-RAW' : v.toUpperCase()).padEnd(18)} n=${String(mm.n).padStart(4)} Brier=${fmt(mm.brier as number)} λmoy dom/ext=${lam ? `${lam.home.toFixed(2)}/${lam.away.toFixed(2)}` : '—'}`);
  }

  console.log('\n════════ DÉCISION LEAGUE-PARAMS (plan étape 10, strict) ════════');
  for (const l of decision.perFold as string[]) console.log('  ' + l);
  console.log('  Poolé : ' + (decision.pooled as string[]).join(' · '));
  console.log(`\n➜ DÉCISION : ${decision.decision}`);

  console.log(`\nRequêtes ESPN : ${meta.requestBudget.total} (scoreboard ${stats.scoreboard} · calendriers ${stats.schedule} · summary ${stats.summary}) · appels moteur : ${engineCalls}`);
  log(`Run dir (entrées gelées) : ${runDir}`);
  log(`  meta.json · matches.jsonl (${jsonlLines.length} lignes) · results.json`);
  log(`JSON copié : download/backtest-v3-results.json`);
  log(`Rejeu sans réseau : bun scripts/backtest.ts --replay download/backtest-runs/${runTs}`);
}

// Garde bun : le rejeu/test importe ce fichier sans déclencher main().
if (import.meta.main) {
  main().catch((e) => {
    console.error('ERREUR backtest :', e);
    process.exit(1);
  });
}
