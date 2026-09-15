// ============================================================
// VOLTRIX bet — Prévisions hebdomadaires : métriques probabilistes
// Fonctions PURES (aucune DB, aucun réseau) — testables indépendamment.
//
// §12 : ne pas se limiter à l'accuracy.
//   1X2 : Brier multiclasse Σ(p−o)², LogLoss −ln(p_issue), RPS, accuracy,
//         calibration (fiabilité de la probabilité du pick).
//   O/U 2.5 et BTTS : Brier binaire, LogLoss binaire, accuracy, calibration.
// Les métriques ne portent QUE sur les prédictions à résultat valide
// (grades CORRECT/INCORRECT) — VOID et en attente exclus (§9, §12).
// ============================================================

export interface SnapshotLite {
  matchId: string;
  version: number;
  league: string;
  leagueName: string;
  kickoff: Date | string;
  homeTeam: string;
  awayTeam: string;
  p1x2Home: number;
  p1x2Draw: number;
  p1x2Away: number;
  pick1x2: string;
  pick1x2Label: string;
  confidence: number;
  pOver25: number;
  pUnder25: number;
  pickOu25: string;
  pBttsYes: number;
  pBttsNo: number;
  pickBtts: string;
}

export interface ResultLite {
  status: string;
  homeScore: number | null;
  awayScore: number | null;
}

export interface EvaluationLite {
  grade1x2: string | null;
  gradeOu25: string | null;
  gradeBtts: string | null;
}

export interface EvalRow {
  snapshot: SnapshotLite;
  result: ResultLite | null;
  evaluation: EvaluationLite | null;
}

// ---------- Métriques élémentaires ----------

const EPS = 1e-12;

/** Brier multiclasse 1X2 : Σ (p_i − o_i)² sur {1, X, 2} (0 parfait → 2 pire). */
export function brier1x2(pH: number, pD: number, pA: number, actual: '1' | 'X' | '2'): number {
  const o = { H: 0, D: 0, A: 0 } as Record<string, number>;
  o[actual === '1' ? 'H' : actual === 'X' ? 'D' : 'A'] = 1;
  return (pH - o.H) ** 2 + (pD - o.D) ** 2 + (pA - o.A) ** 2;
}

/** LogLoss multiclasse : −ln(p de l'issue réelle). */
export function logLoss1x2(pH: number, pD: number, pA: number, actual: '1' | 'X' | '2'): number {
  const p = actual === '1' ? pH : actual === 'X' ? pD : pA;
  return -Math.log(Math.max(EPS, Math.min(1, p)));
}

/** RPS 1X2 (classes ordonnées 1 < X < 2) : (1/2) Σ_{i=1,2} (CDFp−CDFo)². */
export function rps1x2(pH: number, pD: number, pA: number, actual: '1' | 'X' | '2'): number {
  const cdfP = [pH, pH + pD];
  const obs1 = actual === '1' ? 1 : 0;
  const obs2 = actual !== '2' ? 1 : 0;
  const cdfO = [obs1, obs2];
  return ((cdfP[0] - cdfO[0]) ** 2 + (cdfP[1] - cdfO[1]) ** 2) / 2;
}

/** Brier binaire : (p − o)². */
export function brierBinary(p: number, outcome: boolean): number {
  return (p - (outcome ? 1 : 0)) ** 2;
}

/** LogLoss binaire. */
export function logLossBinary(p: number, outcome: boolean): number {
  const q = Math.max(EPS, Math.min(1, p));
  return outcome ? -Math.log(q) : -Math.log(1 - q);
}

// ---------- Agrégats ----------

export interface MarketStats {
  /** prédictions évaluables (résultat valide : CORRECT/INCORRECT) */
  n: number;
  correct: number;
  incorrect: number;
  accuracy: number | null;
  brier: number | null;
  logLoss: number | null;
  /** 1X2 uniquement */
  rps: number | null;
  /** snapshot publié sans résultat définitif (à venir / en direct) */
  pending: number;
  /** match VOID (reporté/annulé/suspendu) — exclu des stats (§9) */
  void: number;
}

export interface CalibrationBucket {
  bucket: string; // « 50–60 % »
  n: number;
  predicted: number | null; // probabilité moyenne annoncée
  observed: number | null; // fréquence observée de réalisation
}

export interface ConfidenceRow {
  level: number;
  n: number;
  correct: number;
  accuracy: number | null;
  brier: number | null;
}

export interface LeagueRow {
  league: string;
  leagueName: string;
  n: number; // matchs évaluables 1X2
  acc1x2: number | null;
  brier1x2: number | null;
  accOu25: number | null;
  accBtts: number | null;
  /** §15 : échantillon suffisant (n >= 30) pour tirer une lecture */
  sufficient: boolean;
}

export interface ErrorRow {
  matchId: string;
  label: string; // « Arsenal vs Chelsea »
  leagueName: string;
  kickoff: Date | string;
  confidence: number;
  reasons: string[]; // motifs de la section « Où VOLTRIX s'est trompé ? »
  failures: Array<{ market: string; pickLabel: string; prob: number; actual: string }>;
}

export interface WeekStats {
  matchesAnalyzed: number; // matchs avec snapshot publié
  matchesFinished: number; // résultat FINAL
  matchesPending: number; // à venir / en direct
  matchesVoid: number; // reportés/annulés/suspendus
  m1x2: MarketStats;
  ou25: MarketStats;
  btts: MarketStats;
  /** taux de réussite global = corrects / évaluables sur les 3 marchés combinés */
  globalAccuracy: number | null;
  globalCorrect: number;
  globalEvaluable: number;
  confidence: ConfidenceRow[]; // niveaux 1..5 (toujours les 5, même à n=0)
  calibration1x2: CalibrationBucket[];
  calibrationOu25: CalibrationBucket[];
  calibrationBtts: CalibrationBucket[];
  leagues: LeagueRow[];
  errors: ErrorRow[];
}

const BUCKET_EDGES: Array<{ lo: number; hi: number; label: string }> = [
  { lo: 0, hi: 50, label: '0–50 %' },
  { lo: 50, hi: 60, label: '50–60 %' },
  { lo: 60, hi: 70, label: '60–70 %' },
  { lo: 70, hi: 80, label: '70–80 %' },
  { lo: 80, hi: 90, label: '80–90 %' },
  { lo: 90, hi: 100.0001, label: '90–100 %' },
];

interface Bin {
  n: number;
  hits: number;
  pSum: number;
}

function bucketize(items: Array<{ p: number; hit: boolean }>): CalibrationBucket[] {
  const bins = new Map<string, Bin>();
  for (const { p, hit } of items) {
    const pctv = p * 100;
    const edge = BUCKET_EDGES.find((b) => pctv >= b.lo && pctv < b.hi) ?? BUCKET_EDGES[BUCKET_EDGES.length - 1];
    const bin = bins.get(edge.label) ?? { n: 0, hits: 0, pSum: 0 };
    bin.n += 1;
    bin.hits += hit ? 1 : 0;
    bin.pSum += pctv;
    bins.set(edge.label, bin);
  }
  return BUCKET_EDGES.filter((b) => bins.has(b.label)).map((b) => {
    const bin = bins.get(b.label)!;
    return {
      bucket: b.label,
      n: bin.n,
      predicted: bin.pSum / bin.n,
      observed: bin.hits / bin.n,
    };
  });
}

function emptyMarket(): MarketStats {
  return { n: 0, correct: 0, incorrect: 0, accuracy: null, brier: null, logLoss: null, rps: null, pending: 0, void: 0 };
}

function finalize(m: MarketStats): MarketStats {
  if (m.n > 0) {
    m.accuracy = m.correct / m.n;
    m.brier = m.brier === null ? null : m.brier / m.n;
    m.logLoss = m.logLoss === null ? null : m.logLoss / m.n;
    m.rps = m.rps === null ? null : m.rps / m.n;
  }
  return m;
}

const gradeIs = (g: string | null | undefined, v: string): boolean => g === v;
/** Grade évaluable = CORRECT ou INCORRECT (VOID/pending exclus des métriques — §12). */
const evaluable = (g: string | null | undefined): boolean => g === 'CORRECT' || g === 'INCORRECT';

/** Probabilité du pick 1X2 (calibrée). */
export function pickedProb1x2(s: SnapshotLite): number {
  if (s.pick1x2 === '1') return s.p1x2Home;
  if (s.pick1x2 === '2') return s.p1x2Away;
  return s.p1x2Draw;
}

/**
 * Agrège les stats de la semaine depuis les lignes évaluées.
 * Entrée : un EvalRow par match (snapshot PUBLIÉ + résultat + évaluation stockée).
 */
export function aggregateWeek(rows: EvalRow[]): WeekStats {
  const m1x2 = emptyMarket();
  const ou25 = emptyMarket();
  const btts = emptyMarket();
  let finished = 0;
  let pendingMatches = 0;
  let voidMatches = 0;

  const cal1x2: Array<{ p: number; hit: boolean }> = [];
  const calOu: Array<{ p: number; hit: boolean }> = [];
  const calBtts: Array<{ p: number; hit: boolean }> = [];
  const conf = new Map<number, { n: number; correct: number; brierSum: number; hasBrier: number }>();
  const leagueMap = new Map<string, LeagueRow & { b1x2Sum: number; b1x2N: number; c1: number; cOu: number; cBtts: number; nOu: number; nBtts: number }>();
  const errors: ErrorRow[] = [];

  for (const row of rows) {
    const { snapshot: s, result, evaluation: ev } = row;
    if (result && (result.status === 'FINAL' || ['POSTPONED', 'CANCELLED', 'SUSPENDED'].includes(result.status))) {
      if (result.status === 'FINAL') finished += 1;
      else voidMatches += 1;
    } else {
      pendingMatches += 1;
    }

    if (!ev) {
      // snapshot publié sans évaluation (résultat pas encore définitif) — §12 : hors métriques
      m1x2.pending += 1;
      ou25.pending += 1;
      btts.pending += 1;
      continue;
    }
    if (ev.grade1x2 === 'VOID') m1x2.void += 1;
    if (ev.gradeOu25 === 'VOID') ou25.void += 1;
    if (ev.gradeBtts === 'VOID') btts.void += 1;

    // ----- 1X2 -----
    if (evaluable(ev.grade1x2)) {
      m1x2.n += 1;
      if (gradeIs(ev.grade1x2, 'CORRECT')) m1x2.correct += 1;
      else m1x2.incorrect += 1;
      const hs = result?.homeScore ?? 0;
      const as = result?.awayScore ?? 0;
      const actual: '1' | 'X' | '2' = hs > as ? '1' : hs === as ? 'X' : '2';
      m1x2.brier = (m1x2.brier ?? 0) + brier1x2(s.p1x2Home, s.p1x2Draw, s.p1x2Away, actual);
      m1x2.logLoss = (m1x2.logLoss ?? 0) + logLoss1x2(s.p1x2Home, s.p1x2Draw, s.p1x2Away, actual);
      m1x2.rps = (m1x2.rps ?? 0) + rps1x2(s.p1x2Home, s.p1x2Draw, s.p1x2Away, actual);
      cal1x2.push({ p: pickedProb1x2(s), hit: ev.grade1x2 === 'CORRECT' });

      const c = conf.get(s.confidence) ?? { n: 0, correct: 0, brierSum: 0, hasBrier: 0 };
      c.n += 1;
      if (ev.grade1x2 === 'CORRECT') c.correct += 1;
      c.brierSum += brier1x2(s.p1x2Home, s.p1x2Draw, s.p1x2Away, actual);
      c.hasBrier += 1;
      conf.set(s.confidence, c);

      const l =
        leagueMap.get(s.league) ??
        {
          league: s.league,
          leagueName: s.leagueName,
          n: 0,
          acc1x2: null,
          brier1x2: null,
          accOu25: null,
          accBtts: null,
          sufficient: false,
          b1x2Sum: 0,
          b1x2N: 0,
          c1: 0,
          cOu: 0,
          cBtts: 0,
          nOu: 0,
          nBtts: 0,
        };
      l.n += 1;
      if (ev.grade1x2 === 'CORRECT') l.c1 += 1;
      l.b1x2Sum += brier1x2(s.p1x2Home, s.p1x2Draw, s.p1x2Away, actual);
      l.b1x2N += 1;
      leagueMap.set(s.league, l);

      // ----- Erreurs §16 -----
      const failures: ErrorRow['failures'] = [];
      const reasons: string[] = [];
      if (ev.grade1x2 === 'INCORRECT') {
        const actualLabel = actual === '1' ? 'Victoire domicile' : actual === 'X' ? 'Match nul' : 'Victoire extérieur';
        failures.push({ market: '1X2', pickLabel: s.pick1x2Label, prob: pickedProb1x2(s), actual: actualLabel });
      }
      if (evaluable(ev.gradeOu25) && ev.gradeOu25 === 'INCORRECT') {
        const total = hs + as;
        failures.push({
          market: 'O/U 2.5',
          pickLabel: s.pickOu25 === 'OVER' ? 'Plus de 2.5' : 'Moins de 2.5',
          prob: s.pickOu25 === 'OVER' ? s.pOver25 : s.pUnder25,
          actual: `${total} buts`,
        });
      }
      if (evaluable(ev.gradeBtts) && ev.gradeBtts === 'INCORRECT') {
        failures.push({
          market: 'BTTS',
          pickLabel: s.pickBtts === 'YES' ? 'Oui' : 'Non',
          prob: s.pickBtts === 'YES' ? s.pBttsYes : s.pBttsNo,
          actual: hs > 0 && as > 0 ? 'Les 2 ont marqué' : "Un seul (ou aucun) buteur",
        });
      }
      if (failures.length > 0) {
        if (s.confidence >= 4) reasons.push(`Confiance ${s.confidence}/5 — ❌`);
        for (const f of failures) {
          if (f.prob >= 0.7) reasons.push(`Probabilité élevée non réalisée (${Math.round(f.prob * 100)} %)`);
        }
        if (reasons.length > 0) {
          errors.push({
            matchId: s.matchId,
            label: `${s.homeTeam} vs ${s.awayTeam}`,
            leagueName: s.leagueName,
            kickoff: s.kickoff,
            confidence: s.confidence,
            reasons,
            failures,
          });
        }
      }
    }

    // ----- O/U 2.5 -----
    if (evaluable(ev.gradeOu25)) {
      ou25.n += 1;
      if (gradeIs(ev.gradeOu25, 'CORRECT')) ou25.correct += 1;
      else ou25.incorrect += 1;
      const hs = result?.homeScore ?? 0;
      const as = result?.awayScore ?? 0;
      const over = hs + as > 2.5;
      ou25.brier = (ou25.brier ?? 0) + brierBinary(s.pOver25, over);
      ou25.logLoss = (ou25.logLoss ?? 0) + logLossBinary(s.pOver25, over);
      calOu.push({ p: s.pickOu25 === 'OVER' ? s.pOver25 : s.pUnder25, hit: ev.gradeOu25 === 'CORRECT' });
      const l = leagueMap.get(s.league);
      if (l) {
        l.nOu += 1;
        if (ev.gradeOu25 === 'CORRECT') l.cOu += 1;
      }
    }

    // ----- BTTS -----
    if (evaluable(ev.gradeBtts)) {
      btts.n += 1;
      if (gradeIs(ev.gradeBtts, 'CORRECT')) btts.correct += 1;
      else btts.incorrect += 1;
      const hs = result?.homeScore ?? 0;
      const as = result?.awayScore ?? 0;
      const yes = hs > 0 && as > 0;
      btts.brier = (btts.brier ?? 0) + brierBinary(s.pBttsYes, yes);
      btts.logLoss = (btts.logLoss ?? 0) + logLossBinary(s.pBttsYes, yes);
      calBtts.push({ p: s.pickBtts === 'YES' ? s.pBttsYes : s.pBttsNo, hit: ev.gradeBtts === 'CORRECT' });
      const l = leagueMap.get(s.league);
      if (l) {
        l.nBtts += 1;
        if (ev.gradeBtts === 'CORRECT') l.cBtts += 1;
      }
    }
  }

  const leagues: LeagueRow[] = [...leagueMap.values()]
    .map((l) => ({
      league: l.league,
      leagueName: l.leagueName,
      n: l.n,
      acc1x2: l.n > 0 ? l.c1 / l.n : null,
      brier1x2: l.b1x2N > 0 ? l.b1x2Sum / l.b1x2N : null,
      accOu25: l.nOu > 0 ? l.cOu / l.nOu : null,
      accBtts: l.nBtts > 0 ? l.cBtts / l.nBtts : null,
      sufficient: l.n >= 30, // §15 : seuil d'échantillon
    }))
    .sort((a, b) => b.n - a.n);

  const confidence: ConfidenceRow[] = [1, 2, 3, 4, 5].map((level) => {
    const c = conf.get(level);
    return {
      level,
      n: c?.n ?? 0,
      correct: c?.correct ?? 0,
      accuracy: c && c.n > 0 ? c.correct / c.n : null,
      brier: c && c.hasBrier > 0 ? c.brierSum / c.hasBrier : null,
    };
  });

  const globalCorrect = m1x2.correct + ou25.correct + btts.correct;
  const globalEvaluable = m1x2.n + ou25.n + btts.n;

  return {
    matchesAnalyzed: rows.length,
    matchesFinished: finished,
    matchesPending: pendingMatches,
    matchesVoid: voidMatches,
    m1x2: finalize(m1x2),
    ou25: finalize(ou25),
    btts: finalize(btts),
    globalAccuracy: globalEvaluable > 0 ? globalCorrect / globalEvaluable : null,
    globalCorrect,
    globalEvaluable,
    confidence,
    calibration1x2: bucketize(cal1x2),
    calibrationOu25: bucketize(calOu),
    calibrationBtts: bucketize(calBtts),
    leagues,
    errors: errors.sort((a, b) => b.confidence - a.confidence || Math.max(...b.failures.map((f) => f.prob)) - Math.max(...a.failures.map((f) => f.prob))).slice(0, 25),
  };
}
