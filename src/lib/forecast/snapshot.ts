// ============================================================
// VOLTRIX bet — Prévisions hebdomadaires : construction du SNAPSHOT
// Transforme la sortie PRODUCTION du moteur (analyzeMatch →
// AnalyzeResult, moteur v2.1 NON modifié) en prédiction figée.
//
// §4 : enregistre 1X2 / O/U 2.5 / BTTS (calibrés + BRUTS), confiance,
//      audit complet (predictionTime, modelVersion, inputsDigest, cotes).
// §6 : garde-fou anti-fuite — la prédiction est REFUSÉE si
//      predictionTime >= kickoffTime (aucune publication après coup d'envoi).
// ============================================================

import { MODEL_VERSION } from '../model-version';
import { buildInputsDigest, type AnalyzeResult } from '../analyze';
import { db } from '@/lib/db';

export interface SnapshotDraft {
  league: string;
  leagueName: string;
  kickoff: Date;
  homeTeamId: string | null;
  homeTeam: string;
  homeLogo: string | null;
  awayTeamId: string | null;
  awayTeam: string;
  awayLogo: string | null;
  // 1X2
  p1x2Home: number;
  p1x2Draw: number;
  p1x2Away: number;
  pick1x2: '1' | 'X' | '2';
  pick1x2Label: string;
  pickedTeamId: string | null;
  confidence: number;
  // O/U 2.5
  pOver25: number;
  pUnder25: number;
  pickOu25: 'OVER' | 'UNDER';
  pOver25Raw: number;
  pUnder25Raw: number;
  // BTTS
  pBttsYes: number;
  pBttsNo: number;
  pickBtts: 'YES' | 'NO';
  pBttsYesRaw: number;
  pBttsNoRaw: number;
  // Audit
  predictionTime: Date;
  modelVersion: string;
  inputsDigest: string;
  odds1x2Home: number | null;
  odds1x2Draw: number | null;
  odds1x2Away: number | null;
  oddsOver25: number | null;
  oddsUnder25: number | null;
  oddsBttsYes: number | null;
  oddsBttsNo: number | null;
  oddsCapturedAt: Date;
  ouMarketLine: number | null;
}

const r4 = (x: number): number => Math.round(x * 10000) / 10000;

/** Probabilité finie ≥ 0 sinon repli (garde-fou anti-NaN, convention extractPicks). */
const safe = (x: number, fallback: number): number =>
  Number.isFinite(x) && x >= 0 ? r4(x) : fallback;

/**
 * Construit le brouillon de snapshot depuis une analyse PRODUCTION.
 * Retourne { ok:false, reason } si la prédiction ne peut pas être publiée
 * (§6 : analyse trop tardive, équipe manquante) — JAMAIS de publication invalide.
 */
export function buildSnapshotDraft(
  a: AnalyzeResult,
  nowMs: number
): { ok: true; draft: SnapshotDraft } | { ok: false; reason: string } {
  const kickoffMs = new Date(a.matchDate).getTime();
  if (!Number.isFinite(kickoffMs)) return { ok: false, reason: 'kickoff invalide' };
  // §6 : condition ABSOLUE — vérifiée AVANT toute publication.
  if (!(nowMs < kickoffMs)) {
    return { ok: false, reason: `predictionTime >= kickoffTime (fuite interdite, §6)` };
  }
  if (!a.home?.name || !a.away?.name) return { ok: false, reason: 'équipes manquantes' };

  const p = a.prediction;
  const ou = p.overUnder.find((o) => o.line === 2.5) ?? p.overUnder[0];
  if (!ou) return { ok: false, reason: 'marché O/U 2.5 absent du moteur' };
  const rawOu = p.raw?.overUnder?.find((o) => o.line === ou.line);
  const rawBtts = p.raw?.btts;

  // 1X2 — l'argmax suit EXACTEMENT la règle d'extractPicks (consensus production).
  const best: 'home' | 'draw' | 'away' =
    p.probs.home >= p.probs.away
      ? p.probs.home >= p.probs.draw
        ? 'home'
        : 'draw'
      : p.probs.away >= p.probs.draw
        ? 'away'
        : 'draw';
  // Calibration v2.1 : les totals SEULS sont calibrés → la 1X2 du moteur est déjà brute.
  const pH = safe(p.probs.home, 1 / 3);
  const pD = safe(p.probs.draw, 1 / 3);
  const pA = safe(p.probs.away, 1 / 3);
  const pick1x2 = best === 'home' ? '1' : best === 'away' ? '2' : 'X';
  const pick1x2Label =
    best === 'home' ? `1 - ${a.home.name}` : best === 'away' ? `2 - ${a.away.name}` : 'X - Nul';

  // O/U 2.5 — calibré (final) + brut (pré-calibration).
  const pOver = safe(ou.over, 0.5);
  const pUnder = safe(ou.under, 1 - Math.max(0, Math.min(1, pOver)));
  const rawOver = safe(rawOu ? rawOu.over : ou.over, pOver);
  const rawUnder = safe(rawOu ? rawOu.under : ou.under, pUnder);

  // BTTS — forme fermée v2.1, calibré + brut.
  const pYes = safe(p.btts.yes, 0.5);
  const pNo = safe(p.btts.no, 1 - Math.max(0, Math.min(1, pYes)));
  const rawYes = safe(rawBtts ? rawBtts.yes : p.btts.yes, pYes);
  const rawNo = safe(rawBtts ? rawBtts.no : p.btts.no, pNo);

  const o = a.odds;
  const oddsCapturedAt = new Date(nowMs);

  return {
    ok: true,
    draft: {
      league: a.leagueCode,
      leagueName: a.leagueName,
      kickoff: new Date(kickoffMs),
      homeTeamId: a.home.id ?? null,
      homeTeam: a.home.name,
      homeLogo: a.home.logo ?? null,
      awayTeamId: a.away.id ?? null,
      awayTeam: a.away.name,
      awayLogo: a.away.logo ?? null,
      p1x2Home: pH,
      p1x2Draw: pD,
      p1x2Away: pA,
      pick1x2,
      pick1x2Label,
      pickedTeamId: best === 'home' ? (a.home.id ?? null) : best === 'away' ? (a.away.id ?? null) : null,
      confidence: Math.max(1, Math.min(5, Math.round(p.confidence))),
      pOver25: pOver,
      pUnder25: pUnder,
      pickOu25: ou.over >= ou.under ? 'OVER' : 'UNDER',
      pOver25Raw: rawOver,
      pUnder25Raw: rawUnder,
      pBttsYes: pYes,
      pBttsNo: pNo,
      pickBtts: p.btts.yes >= p.btts.no ? 'YES' : 'NO',
      pBttsYesRaw: rawYes,
      pBttsNoRaw: rawNo,
      predictionTime: new Date(nowMs),
      modelVersion: MODEL_VERSION, // version production — inchangée (§22)
      inputsDigest: buildInputsDigest(a),
      odds1x2Home: o?.moneyline.home.close ?? o?.moneyline.home.open ?? null,
      odds1x2Draw: o?.moneyline.draw.close ?? o?.moneyline.draw.open ?? null,
      odds1x2Away: o?.moneyline.away.close ?? o?.moneyline.away.open ?? null,
      oddsOver25: o?.total.over.closeOdds ?? o?.total.over.openOdds ?? null,
      oddsUnder25: o?.total.under.closeOdds ?? o?.total.under.openOdds ?? null,
      oddsBttsYes: null, // ESPN ne publie pas de BTTS (§4 : « lorsqu'elles existent »)
      oddsBttsNo: null,
      oddsCapturedAt,
      ouMarketLine: o?.overUnderLine ?? null,
    },
  };
}

// ============================================================
// Task 28 §11-§19 : persistance de TOUS les marchés dans
// l'architecture générique Neon (PredictionSnapshot →
// PredictionMarket → PredictionOutcome + PredictionComponent).
//
// - 1X2 + composants Poisson/Elo/Forme/Final (§19 — diagnostic futur)
// - Double chance 1X/12/X2 (dérivation exacte depuis la 1X2 figée)
// - O/U sur CHAQUE ligne produite par le moteur (1.5/2.5/3.5 — §14
//   « sans modifier toute la base »)
// - BTTS (§15), moment du 1er but (§16), 1ère équipe à marquer (§17),
//   scores exacts.
//
// INSERT-ONLY (§20) : jamais d'UPDATE — une ré-analyse crée un nouveau
// snapshot. La cohérence avec ForecastSnapshot est garantie par la
// même `version`. Aucune formule du moteur n'est modifiée : on copie
// fidèlement la sortie production.
// ============================================================

const FG_WINDOW_KEYS: Record<string, string> = {
  '0-15': 'BEFORE_16',
  '16-30': 'MIN_16_30',
  '31-45': 'MIN_31_45',
  '46-60': 'MIN_46_60',
  '61-75': 'MIN_61_75',
  '76-90': 'AFTER_76',
  NO_GOAL: 'NO_GOAL',
};

export async function persistGenericSnapshot(
  a: AnalyzeResult,
  draft: SnapshotDraft,
  matchId: string,
  version: number
): Promise<void> {
  const p = a.prediction;
  const frozenAt = new Date();

  // Cohérence §21/§23 : la base connaît ce match (idempotent — l'état
  // du match lui-même reste géré par la synchronisation ESPN).
  await db.match
    .upsert({
      where: { espnEventId: matchId },
      create: {
        espnEventId: matchId,
        competitionId: null,
        competitionName: draft.leagueName,
        season: null,
        homeTeamId: draft.homeTeamId,
        homeTeamName: draft.homeTeam,
        awayTeamId: draft.awayTeamId,
        awayTeamName: draft.awayTeam,
        kickoffAt: draft.kickoff,
        status: 'SCHEDULED',
        espnState: 'pre',
      },
      update: {
        kickoffAt: draft.kickoff,
        homeTeamId: draft.homeTeamId ?? undefined,
        awayTeamId: draft.awayTeamId ?? undefined,
      },
    })
    .catch(() => {});

  const snap = await db.predictionSnapshot.create({
    data: {
      matchId,
      version,
      competitionId: draft.league,
      competition: draft.leagueName,
      season: null,
      kickoffAt: draft.kickoff,
      homeTeamId: draft.homeTeamId,
      homeTeamName: draft.homeTeam,
      awayTeamId: draft.awayTeamId,
      awayTeamName: draft.awayTeam,
      predictionTime: draft.predictionTime,
      modelVersion: draft.modelVersion,
      inputsDigest: draft.inputsDigest,
      confidence: draft.confidence,
      source: 'VOLTRIX',
      frozenAt,
    },
  });

  const safeP = (x: number, fallback: number): number => (Number.isFinite(x) && x >= 0 ? r4(x) : fallback);

  // ---------- Marché 1X2 (§12) + composants du modèle (§19) ----------
  const m1x2 = await db.predictionMarket.create({
    data: { snapshotId: snap.id, marketKey: '1X2', line: null },
  });
  const pH = safeP(draft.p1x2Home, 1 / 3);
  const pD = safeP(draft.p1x2Draw, 1 / 3);
  const pA = safeP(draft.p1x2Away, 1 / 3);
  await db.predictionOutcome.createMany({
    data: [
      { marketId: m1x2.id, outcomeKey: 'HOME_WIN', label: `1 - ${draft.homeTeam}`, probability: pH, rawProbability: null, pick: draft.pick1x2 === '1' },
      { marketId: m1x2.id, outcomeKey: 'DRAW', label: 'X - Nul', probability: pD, rawProbability: null, pick: draft.pick1x2 === 'X' },
      { marketId: m1x2.id, outcomeKey: 'AWAY_WIN', label: `2 - ${draft.awayTeam}`, probability: pA, rawProbability: null, pick: draft.pick1x2 === '2' },
    ],
  });
  // Composants (§19) : probabilités 1X2 de chaque composant + final
  const comp1x2: Array<{ component: string; probs: { home: number; draw: number; away: number } | undefined }> = [
    { component: 'POISSON', probs: p.poisson },
    { component: 'ELO', probs: p.elo },
    { component: 'FORME', probs: p.form },
    { component: 'VOLTRIX', probs: { home: pH, draw: pD, away: pA } },
  ];
  await db.predictionComponent.createMany({
    data: comp1x2
      .filter((c): c is { component: string; probs: { home: number; draw: number; away: number } } => !!c.probs)
      .map((c) => ({
        marketId: m1x2.id,
        component: c.component,
        probabilities: { HOME_WIN: safeP(c.probs.home, 1 / 3), DRAW: safeP(c.probs.draw, 1 / 3), AWAY_WIN: safeP(c.probs.away, 1 / 3) },
      })),
  });

  // ---------- Double chance (§13) — dérivation exacte depuis la 1X2 ----------
  const mDc = await db.predictionMarket.create({
    data: { snapshotId: snap.id, marketKey: 'DOUBLE_CHANCE', line: null },
  });
  const dcRows = [
    { key: '1X', label: '1X (Domicile ou nul)', prob: pH + pD },
    { key: '12', label: '12 (Pas de nul)', prob: pH + pA },
    { key: 'X2', label: 'X2 (Nul ou extérieur)', prob: pD + pA },
  ];
  const dcBest = dcRows.reduce((b, r) => (r.prob > b.prob ? r : b), dcRows[0]);
  await db.predictionOutcome.createMany({
    data: dcRows.map((r) => ({ marketId: mDc.id, outcomeKey: r.key, label: r.label, probability: r4(r.prob), rawProbability: null, pick: r.key === dcBest.key })),
  });

  // ---------- O/U sur chaque ligne du moteur (§14) ----------
  const rawOuList = p.raw?.overUnder ?? [];
  for (const ou of p.overUnder) {
    if (!ou || !Number.isFinite(ou.line)) continue;
    const mOu = await db.predictionMarket.create({
      data: { snapshotId: snap.id, marketKey: 'OVER_UNDER', line: ou.line },
    });
    const rawOu = rawOuList.find((r) => r.line === ou.line);
    const over = safeP(ou.over, 0.5);
    const under = safeP(ou.under, 1 - Math.max(0, Math.min(1, over)));
    await db.predictionOutcome.createMany({
      data: [
        { marketId: mOu.id, outcomeKey: 'OVER', label: `Plus de ${ou.line}`, probability: over, rawProbability: rawOu ? safeP(rawOu.over, over) : null, pick: over >= under },
        { marketId: mOu.id, outcomeKey: 'UNDER', label: `Moins de ${ou.line}`, probability: under, rawProbability: rawOu ? safeP(rawOu.under, under) : null, pick: under > over },
      ],
    });
  }

  // ---------- BTTS (§15) ----------
  const mBtts = await db.predictionMarket.create({
    data: { snapshotId: snap.id, marketKey: 'BTTS', line: null },
  });
  await db.predictionOutcome.createMany({
    data: [
      { marketId: mBtts.id, outcomeKey: 'BTTS_YES', label: 'Les deux équipes marquent - Oui', probability: draft.pBttsYes, rawProbability: draft.pBttsYesRaw, pick: draft.pickBtts === 'YES' },
      { marketId: mBtts.id, outcomeKey: 'BTTS_NO', label: 'Les deux équipes marquent - Non', probability: draft.pBttsNo, rawProbability: draft.pBttsNoRaw, pick: draft.pickBtts === 'NO' },
    ],
  });

  // ---------- Moment du premier but (§16) ----------
  const fg = p.firstGoalTiming ?? [];
  if (fg.length) {
    const mFg = await db.predictionMarket.create({
      data: { snapshotId: snap.id, marketKey: 'FIRST_GOAL_TIME', line: null },
    });
    const fgBest = fg.reduce((b, r) => (r.prob > b.prob ? r : b), fg[0]);
    await db.predictionOutcome.createMany({
      data: fg.map((r) => ({
        marketId: mFg.id,
        outcomeKey: FG_WINDOW_KEYS[r.window] ?? r.window,
        label: r.label ?? r.window,
        probability: safeP(r.prob, 0),
        rawProbability: null,
        pick: r.window === fgBest.window,
      })),
    });
  }

  // ---------- Première équipe à marquer (§17) ----------
  const fts = p.firstToScore;
  if (fts) {
    const mFts = await db.predictionMarket.create({
      data: { snapshotId: snap.id, marketKey: 'FIRST_TEAM_TO_SCORE', line: null },
    });
    const ftsRows = [
      { key: 'HOME', label: `Domicile (${draft.homeTeam})`, prob: safeP(fts.home, 0) },
      { key: 'AWAY', label: `Extérieur (${draft.awayTeam})`, prob: safeP(fts.away, 0) },
      { key: 'NO_GOAL', label: 'Aucun but', prob: safeP(fts.noGoal, 0) },
    ];
    const ftsBest = ftsRows.reduce((b, r) => (r.prob > b.prob ? r : b), ftsRows[0]);
    await db.predictionOutcome.createMany({
      data: ftsRows.map((r) => ({ marketId: mFts.id, outcomeKey: r.key, label: r.label, probability: r4(r.prob), rawProbability: null, pick: r.key === ftsBest.key })),
    });
  }

  // ---------- Scores exacts ----------
  const top = p.topScores ?? [];
  if (top.length) {
    const mEx = await db.predictionMarket.create({
      data: { snapshotId: snap.id, marketKey: 'EXACT_SCORE', line: null },
    });
    await db.predictionOutcome.createMany({
      data: top.map((r) => ({ marketId: mEx.id, outcomeKey: r.score, label: r.score, probability: safeP(r.prob, 0), rawProbability: null, pick: false })),
    });
  }
}
