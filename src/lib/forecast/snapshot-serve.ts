// ============================================================
// VOLTRIX bet — Option B : service des cartes d'accueil depuis les
// ForecastSnapshot PUBLIÉS (Neon) — ZÉRO appel ESPN, ZÉRO moteur.
//
// Principe (audit Task 37/38/39, plan « Option B » validé) :
//   l'accueil re-calculait chaque match en live (analyzeBatch →
//   analyzeMatch → 5-9 HTTP ESPN + runEngine v2.1) alors que le
//   job de prévisions fige DÉJÀ le prono complet dans ForecastSnapshot
//   (+ PredictionSnapshot → markets → outcomes pour les lignes O/U).
//   Ce module PUR lit ces snapshots, valide, et reconstruit un
//   QuickPred STRICTEMENT identique en shape à celui produit par la
//   route pour le chemin moteur (src/lib/types.ts).
//
// RED LINE moteur v2.1 : ce module n'importe NI `analyze.ts`, NI
// `prediction.ts`, NI `espn.ts`, NI `market-odds.ts` — uniquement
// `@/lib/db`, le type QuickPred, la version du modèle (lecture) et
// les types Prisma. Toute la logique est une RÉPLIQUE DÉCLARÉE de
// règles moteur existantes (références ligne à ligne en commentaires) :
//   - buildValueBets          → prediction.ts:502-539
//   - confidenceLabels        → prediction.ts:796-797
//   - recommendedBets         → prediction.ts:839-870
//   - extractPicks            → analyze.ts:272-341
//   - snapshot publié         → api/forecasts/week/route.ts:88
// ============================================================

import { db } from '@/lib/db';
import { MODEL_VERSION } from '../model-version';
import type { QuickPred } from '@/lib/types';
import type {
  ForecastSnapshot,
  PredictionSnapshot,
  PredictionMarket,
  PredictionOutcome,
} from '@prisma/client';

/** PredictionSnapshot avec ses marchés et leurs issues (parité /combo). */
export type PredictionSnapshotFull = PredictionSnapshot & {
  markets: (PredictionMarket & { outcomes: PredictionOutcome[] })[];
};

/** Bundle servi pour un match : snapshot figé + snapshot générique (lignes O/U). */
export interface SnapshotBundle {
  snap: ForecastSnapshot;
  pSnap: PredictionSnapshotFull | null;
}

/** Source de la carte (diagnostic Option B — demandé utilisateur). */
export type ServeSource = 'snapshot' | 'fallback' | 'failed';

/** Diagnostic agrégé d'un lot POST /api/predictions (additif, hors QuickPred). */
export interface ServeMeta {
  /** 'snapshot' = 100 % servi depuis Neon ; 'fallback' = 100 % moteur ; 'mixed' ; 'empty'. */
  source: 'snapshot' | 'fallback' | 'mixed' | 'empty';
  counts: { total: number; snapshot: number; fallback: number; failed: number };
  /** Appels sortants vers un domaine ESPN pendant le traitement du lot. */
  espnCalls: number;
  /** Total d'appels fetch sortants (ESPN + météo + tout autre) pendant le lot. */
  outboundCalls: number;
  /** false = la lecture snapshot a levé → TOUT le lot est repassé en chemin moteur. */
  snapshotLookupOk: boolean;
  perMatch: Record<string, ServeSource>;
}

// ============================================================
// Capture des appels réseau (diagnostic espnCalls — 0 attendu quand
// le lot est 100 % couvert). On enveloppe global.fetch SANS toucher
// au moteur : comptage par hôte, ré-installation refcountée (concurente
// sûre — plusieurs lots POST en parallèle se comptent indépendamment),
// restauration systématique (zéro fuite de wrapper).
// ============================================================

export interface FetchCapture {
  espn: number;
  outbound: number;
}

const g = globalThis as unknown as {
  __voltrixFetchCapture?: {
    active: Set<FetchCapture>;
    original: typeof globalThis.fetch | null;
  };
};

const captureState = (g.__voltrixFetchCapture ??= { active: new Set<FetchCapture>(), original: null });

function ensureInstalled(): void {
  if (captureState.active.size > 0 && !captureState.original) {
    captureState.original = globalThis.fetch;
    const wrapped = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : (input as Request).url ?? '';
      const isEspn = /espn\.com/i.test(url);
      for (const c of captureState.active) {
        c.outbound++;
        if (isEspn) c.espn++;
      }
      return captureState.original!.call(globalThis, input as RequestInfo, init);
    }) as typeof fetch;
    globalThis.fetch = wrapped;
  }
}

function maybeRestore(): void {
  if (captureState.active.size === 0 && captureState.original) {
    globalThis.fetch = captureState.original;
    captureState.original = null;
  }
}

/** Démarre la capture des fetch sortants pour CE traitement de lot. */
export function startFetchCapture(): FetchCapture {
  const c: FetchCapture = { espn: 0, outbound: 0 };
  captureState.active.add(c);
  ensureInstalled();
  return c;
}

/** Termine la capture (toujours appelé — finally). */
export function endFetchCapture(c: FetchCapture): void {
  captureState.active.delete(c);
  maybeRestore();
}

// ============================================================
// Lecture des snapshots publiés (2 SELECT Neon, aucun ESPN)
// Règle « snapshot publié » = MIRE EXACTE de /api/forecasts/week
// (route.ts:53-56, 88) : toutes les versions du match ordonnées par
// version asc → la DERNIÈRE version publiée l'emporte.
// ============================================================

/**
 * Validation défensive (plan §3) : publiée (déjà filtré en requête),
 * version moteur identique (sécurité future), champs clés non nuls.
 * Le schéma NOT NULL garantit déjà l'essentiel — on ne sert jamais
 * un snapshot anormal : le match repasse alors en chemin moteur.
 */
function isServeable(s: ForecastSnapshot): boolean {
  return (
    s.published &&
    s.modelVersion === MODEL_VERSION &&
    s.p1x2Home != null &&
    s.p1x2Draw != null &&
    s.p1x2Away != null &&
    !!s.pick1x2 &&
    Number.isFinite(s.confidence) &&
    s.pOver25 != null &&
    s.pUnder25 != null &&
    s.pBttsYes != null &&
    s.pBttsNo != null &&
    Number.isFinite(s.kickoff.getTime())
  );
}

/**
 * Charge les bundles valides pour les matchIds demandés.
 * 1 SELECT ForecastSnapshot + 1 SELECT PredictionSnapshot imbriqué —
 * ZÉRO appel HTTP. Une erreur DB se propage : la route replie alors
 * TOUT le lot sur le chemin moteur actuel (disponibilité > optimisation).
 */
export async function fetchValidSnapshots(matchIds: string[]): Promise<Map<string, SnapshotBundle>> {
  const out = new Map<string, SnapshotBundle>();
  if (matchIds.length === 0) return out;

  const snaps = await db.forecastSnapshot.findMany({
    where: { matchId: { in: matchIds }, published: true },
    orderBy: { version: 'asc' },
  });
  // Mire week.ts:88 : versions asc → le dernier publié (version max) gagne.
  const byMatch = new Map<string, ForecastSnapshot>();
  for (const s of snaps) byMatch.set(s.matchId, s);

  const pSnaps = await db.predictionSnapshot.findMany({
    where: { matchId: { in: matchIds } },
    orderBy: { version: 'asc' },
    include: { markets: { include: { outcomes: true } } },
  });
  const pByMatchVersion = new Map<string, Map<number, PredictionSnapshotFull>>();
  const pLatest = new Map<string, PredictionSnapshotFull>();
  for (const p of pSnaps) {
    let perVersion = pByMatchVersion.get(p.matchId);
    if (!perVersion) {
      perVersion = new Map<number, PredictionSnapshotFull>();
      pByMatchVersion.set(p.matchId, perVersion);
    }
    perVersion.set(p.version, p);
    pLatest.set(p.matchId, p); // version asc → la dernière gagne
  }

  for (const [matchId, snap] of byMatch) {
    if (!isServeable(snap)) continue;
    // Cohérence Task 28 §21/§23 : le snapshot générique de MÊME version est
    // prioritaire ; repli sur la dernière version connue sinon.
    const pSnap = pByMatchVersion.get(matchId)?.get(snap.version) ?? pLatest.get(matchId) ?? null;
    out.set(matchId, { snap, pSnap });
  }
  return out;
}

// ============================================================
// valueBetsCount — fonction pure, mire EXACTE de buildValueBets
// (prediction.ts:502-539) appliquée aux valeurs FIGÉES du snapshot.
//
// Parité vérifiée dans le code moteur :
//   - décision : `!dec || dec <= 1.01 || modelProb <= 0` → jambe ignorée ;
//   - seuil    : edge = modelProb × cote − 1 > 0.02 ;
//   - 1X2      : probs FINALES du moteur × cotes 1X2 (v2.1 : la 1X2 n'est
//                PAS calibrée → final = brut, prediction.ts:832-835) ;
//   - O/U      : probs BRUTES (rawOverOverUnder — prediction.ts:833) à la
//                LIGNE DU MARCHÉ (ouMarketLine), jamais les calibrées ;
//   - BTTS     : JAMAIS dans les value bets (buildValueBets ne l'inclut pas)
//                → l'absence d'oddsBtts* (604/604) est sans effet ;
//   - tri edge desc + plafond 4 (slice(0, 4)).
// Différence DÉLIBÉRÉE (plan §5, documentée) : les edges sont calculés
// contre les cotes FIGÉES avec la prédiction (oddsCapturedAt), pas contre
// des cotes re-téléchargées — cohérent avec la philosophie anti
// look-ahead de /previsions.
// ============================================================

export function computeValueBetsCount(snap: ForecastSnapshot, pSnap: PredictionSnapshotFull | null): number {
  const bets: Array<{ edge: number }> = [];
  const add = (modelProb: number, dec: number | null | undefined): void => {
    if (!dec || dec <= 1.01 || modelProb <= 0) return;
    const edge = modelProb * dec - 1;
    if (edge > 0.02) bets.push({ edge });
  };

  // --- 1X2 (probs finales = brutes en v2.1) × cotes figées ---
  add(snap.p1x2Home, snap.odds1x2Home);
  add(snap.p1x2Draw, snap.odds1x2Draw);
  add(snap.p1x2Away, snap.odds1x2Away);

  // --- O/U à la ligne du marché, probs BRUTES ---
  if (snap.ouMarketLine != null && (snap.oddsOver25 != null || snap.oddsUnder25 != null)) {
    let over: number | null = null;
    let under: number | null = null;
    if (Math.abs(snap.ouMarketLine - 2.5) < 0.01) {
      // Ligne 2.5 : bruts stockés dans ForecastSnapshot (repli calibré si
      // null — miroir défensif d'extractPicks analyze.ts:317).
      over = snap.pOver25Raw ?? snap.pOver25;
      under = snap.pUnder25Raw ?? snap.pUnder25;
    } else if (pSnap) {
      // Autre ligne (1.5/3.5) : issues O/U figées par persistGenericSnapshot
      // (snapshot.ts:298-314) — brut si disponible, calibré sinon.
      const m = pSnap.markets.find(
        (mk) => mk.marketKey === 'OVER_UNDER' && mk.line != null && Math.abs(mk.line - snap.ouMarketLine!) < 0.01
      );
      const o = m?.outcomes.find((x) => x.outcomeKey === 'OVER');
      const u = m?.outcomes.find((x) => x.outcomeKey === 'UNDER');
      over = o ? (o.rawProbability ?? o.probability) : null;
      under = u ? (u.rawProbability ?? u.probability) : null;
    }
    // Plan §5 (cas dégradé documenté) : PredictionSnapshot absent pour un
    // match à ouMarketLine ≠ 2.5 → seules les jambes 1X2 comptent.
    if (over != null && under != null) {
      add(over, snap.oddsOver25);
      add(under, snap.oddsUnder25);
    }
  }

  return bets.sort((a, b) => b.edge - a.edge).slice(0, 4).length;
}

// ============================================================
// Mapping ForecastSnapshot → QuickPred (shape IDENTIQUE au chemin
// moteur — types.ts QuickPred ; `lambda` optionnel, non lu par l'UI :
// carte, combiné, cache session — audit Task 40).
// ============================================================

const r4 = (x: number): number => Math.round(x * 10000) / 10000;

// Mire prediction.ts:796-797.
const CONFIDENCE_LABELS = ['Très faible', 'Faible', 'Moyen', 'Bon', 'Élevé'] as const;

export function confidenceLabelOf(confidence: number): string {
  const clamped = Math.max(1, Math.min(5, Math.round(confidence)));
  return CONFIDENCE_LABELS[clamped - 1] ?? 'Moyen';
}

/** Statut temporel de secours (mire de la convention « +3 h » de week.ts). */
function temporalStatus(kickoffMs: number, nowMs: number): 'pre' | 'in' | 'post' {
  if (nowMs < kickoffMs) return 'pre';
  if (nowMs > kickoffMs + 3 * 60 * 60 * 1000) return 'post';
  return 'in';
}

export function buildQuickPredFromSnapshot(
  matchId: string,
  bundle: SnapshotBundle,
  nowMs: number
): QuickPred {
  const { snap, pSnap } = bundle;
  const confidence = Math.max(1, Math.min(5, Math.round(snap.confidence)));

  // --- overUnder complet : lignes figées du snapshot générique (calibrées,
  //     miroir de p.overUnder moteur) ; repli ligne 2.5 = ForecastSnapshot ---
  const overUnder: QuickPred['overUnder'] = [];
  if (pSnap) {
    for (const mk of pSnap.markets) {
      if (mk.marketKey !== 'OVER_UNDER' || mk.line == null) continue;
      const o = mk.outcomes.find((x) => x.outcomeKey === 'OVER');
      const u = mk.outcomes.find((x) => x.outcomeKey === 'UNDER');
      if (!o || !u) continue;
      overUnder.push({ line: mk.line, over: r4(o.probability), under: r4(u.probability) });
    }
    overUnder.sort((a, b) => a.line - b.line);
  }
  if (!overUnder.some((o) => Math.abs(o.line - 2.5) < 0.01)) {
    overUnder.push({ line: 2.5, over: r4(snap.pOver25), under: r4(snap.pUnder25) });
    overUnder.sort((a, b) => a.line - b.line);
  }
  const ou25 = overUnder.find((o) => o.line === 2.5)!;

  // --- recommendedBets : miroir prediction.ts:839-870 ---
  // 1X2 : pick1x2 du snapshot EST l'argmax (même règle buildSnapshotDraft
  // snapshot.ts:91-105 = extractPicks analyze.ts:285).
  const rec1x2Pick =
    snap.pick1x2 === '1' ? `Victoire ${snap.homeTeam}` : snap.pick1x2 === '2' ? `Victoire ${snap.awayTeam}` : 'Match nul';
  const rec1x2Prob = r4(snap.pick1x2 === '1' ? snap.p1x2Home : snap.pick1x2 === '2' ? snap.p1x2Away : snap.p1x2Draw);
  // O/U 2.5 (mire prediction.ts:847-853 — règle over >= 0.5 sur le calibré) ;
  // note moteur « Buts attendus : λ » non reproductible depuis le snapshot
  // (lambda non figé) → note honnête sans chiffre inventé.
  const recOu = {
    market: 'Total buts 2.5',
    pick: ou25.over >= 0.5 ? 'Plus de 2.5 buts' : 'Moins de 2.5 buts',
    prob: r4(Math.max(ou25.over, ou25.under)),
    note: `Prévision figée avant match (ligne marché : ${snap.ouMarketLine != null ? snap.ouMarketLine : 2.5})`,
  };
  // BTTS (mire prediction.ts:854-859 — règle yes >= 0.5 sur le calibré).
  const recBtts = {
    market: 'BTTS',
    pick: snap.pBttsYes >= 0.5 ? 'Les deux équipes marquent' : 'Pas les deux équipes marquent',
    prob: r4(Math.max(snap.pBttsYes, snap.pBttsNo)),
    note: 'Prévision figée avant match',
  };
  // Double chance (mire prediction.ts:860-870 — dérivée des probs finales).
  const dc = [
    { pick: '1X (Dom ou nul)', prob: snap.p1x2Home + snap.p1x2Draw },
    { pick: '12 (Pas de nul)', prob: snap.p1x2Home + snap.p1x2Away },
    { pick: 'X2 (Nul ou ext)', prob: snap.p1x2Draw + snap.p1x2Away },
  ].sort((a, b) => b.prob - a.prob)[0];

  // ouOdds : cotes figées avec la prédiction (mire du shape route —
  // close ?? open capturés à l'instant de la figéation, snapshot.ts:154-158).
  const hasOuOdds = snap.ouMarketLine != null || snap.oddsOver25 != null || snap.oddsUnder25 != null;

  return {
    matchId,
    leagueCode: snap.league,
    leagueName: snap.leagueName,
    // Statut temporel (le client affiche le statut réel de LightMatch —
    // QuickPred.status n'est consommé par aucune vue).
    status: temporalStatus(snap.kickoff.getTime(), nowMs),
    probs: { home: r4(snap.p1x2Home), draw: r4(snap.p1x2Draw), away: r4(snap.p1x2Away) },
    // lambda volontairement ABSENT : non stocké dans ForecastSnapshot,
    // non lu par l'UI (types.ts le passe en optionnel — Option B).
    confidence,
    confidenceLabel: confidenceLabelOf(confidence),
    recommendedBets: [
      {
        market: '1X2',
        pick: rec1x2Pick,
        prob: rec1x2Prob,
        note: `Meilleur choix du modèle (confiance ${confidence}/5)`,
      },
      recOu,
      recBtts,
      {
        market: 'Double chance',
        pick: dc.pick,
        prob: r4(dc.prob),
        note: 'Option la plus sûre du match',
      },
    ],
    overUnder,
    btts: { yes: r4(snap.pBttsYes), no: r4(snap.pBttsNo) },
    topScores: [], // non lu par l'UI (carte/combiné) — plan §7, documenté
    valueBetsCount: computeValueBetsCount(snap, pSnap),
    ouOdds: hasOuOdds
      ? { line: snap.ouMarketLine, over: snap.oddsOver25, under: snap.oddsUnder25 }
      : null,
  };
}

// ============================================================
// Picks « figés » pour la persistance Prediction (continuité
// /api/performance) — mire EXACTE d'extractPicks (analyze.ts:272-341)
// évaluée sur les valeurs FIGÉES du snapshot. Mêmes règles d'argmax
// (buildSnapshotDraft snapshot.ts:91-103 est la copie déclarée
// d'extractPicks — le pick du snapshot EST le pick du moteur).
// ============================================================

export interface FrozenPick {
  market: string;
  pick: string;
  probability: number;
  odds: number | null;
  pickedTeamId: string | null;
  rawProbability: number;
  inputsDigest: string;
  confidence: number;
}

// Mire analyze.ts:276 — garde-fou anti-NaN identique.
const safeProb = (x: number): number => (Number.isFinite(x) && x > 0 ? Math.round(x * 10000) / 10000 : 0.3333);

export function buildFrozenPicks(snap: ForecastSnapshot): FrozenPick[] {
  const picks: FrozenPick[] = [];
  const digest = snap.inputsDigest ?? '';

  // --- 1X2 (analyze.ts:285-307) : proba de l'argmax, brut = calibré (1X2
  //     non calibré en v2.1), cote du côté piqué, pickedTeamId figé. ---
  const prob1x2 = safeProb(
    snap.pick1x2 === '1' ? snap.p1x2Home : snap.pick1x2 === '2' ? snap.p1x2Away : snap.p1x2Draw
  );
  const label1x2 =
    snap.pick1x2Label ||
    (snap.pick1x2 === '1'
      ? `1 - ${snap.homeTeam}`
      : snap.pick1x2 === '2'
        ? `2 - ${snap.awayTeam}`
        : 'X - Nul');
  picks.push({
    market: '1X2',
    pick: label1x2,
    probability: prob1x2,
    rawProbability: prob1x2,
    odds:
      snap.pick1x2 === '1'
        ? snap.odds1x2Home
        : snap.pick1x2 === '2'
          ? snap.odds1x2Away
          : snap.odds1x2Draw,
    pickedTeamId: snap.pickedTeamId,
    inputsDigest: digest,
    confidence: snap.confidence,
  });

  // --- O/U 2.5 (analyze.ts:309-326) : argmax calibré, brut = pOver25Raw
  //     (repli calibré — miroir analyze.ts:317), cote du côté piqué. ---
  const rawOver = snap.pOver25Raw ?? snap.pOver25;
  const rawUnder = snap.pUnder25Raw ?? snap.pUnder25;
  picks.push({
    market: 'O/U 2.5',
    pick: snap.pickOu25 === 'OVER' ? 'Plus de 2.5' : 'Moins de 2.5',
    probability: safeProb(Math.max(snap.pOver25, snap.pUnder25)),
    rawProbability: safeProb(Math.max(rawOver, rawUnder)),
    odds: snap.pickOu25 === 'OVER' ? snap.oddsOver25 : snap.oddsUnder25,
    pickedTeamId: null,
    inputsDigest: digest,
    confidence: snap.confidence,
  });

  // --- BTTS (analyze.ts:328-338) : odds null (le moteur aussi — ESPN ne
  //     publie pas de BTTS), brut = pBtts*Raw (repli calibré). ---
  picks.push({
    market: 'BTTS',
    pick: snap.pickBtts === 'YES' ? 'Oui' : 'Non',
    probability: safeProb(Math.max(snap.pBttsYes, snap.pBttsNo)),
    rawProbability: safeProb(
      Math.max(snap.pBttsYesRaw ?? snap.pBttsYes, snap.pBttsNoRaw ?? snap.pBttsNo)
    ),
    odds: null,
    pickedTeamId: null,
    inputsDigest: digest,
    confidence: snap.confidence,
  });

  return picks;
}
