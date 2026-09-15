// ============================================================
// VOLTRIX bet — Task 28 §29 : IMPORT SQLite → NEON (one-shot)
//
// Migre TOUTES les données existantes (custom.db) vers Neon :
//   Prediction, ForecastMatch, ForecastSnapshot, MatchResult (+
//   winner dérivé), ForecastEvaluation, ForecastJobRun.
//
// ET convertit les snapshots figés (Task 25) vers l'architecture
// générique §18 : PredictionSnapshot → PredictionMarket (1X2,
// OVER_UNDER 2.5, BTTS) → PredictionOutcome — sans modifier les
// valeurs (copie fidèle, raws comprises).
//
// ET pré-remplit la table Match / Team / Competition (§3/§8/§9) à
// partir de ForecastMatch × MatchResult (id ESPN conservé) → le H2H
// (§7) démarre avec 5 semaines d'historique.
//
// IDEMPOTENT : ré-exécutable sans créer de doublons (clés uniques
// ESPN respectées, skipDuplicates sur PG). Lecture source via
// bun:sqlite (readonly) — la base d'origine n'est jamais modifiée.
// Usage : set -a && source .env && set +a && bun scripts/import-sqlite-to-neon.ts
// ============================================================

import { PrismaClient } from '@prisma/client';
import { Database } from 'bun:sqlite';

const sqlite = new Database('/home/z/my-project/db/custom.db', { readonly: true });
const neon = new PrismaClient({ log: ['warn', 'error'] });

const msToDate = (v: unknown): Date | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return new Date(v);
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return new Date(n);
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
};
const bool = (v: unknown): boolean => v === 1 || v === true;
const optDate = (v: unknown): Date | null => msToDate(v);

interface Row {
  [k: string]: number | string | null | undefined;
}
const q = <T extends Row>(sql: string): T[] => sqlite.query(sql).all() as unknown as T[];

const deriveWinner = (status: string, hs: number | null, as_: number | null): string | null =>
  status === 'FINAL' && hs != null && as_ != null ? (hs > as_ ? 'HOME' : hs < as_ ? 'AWAY' : 'DRAW') : null;

// Statut canonique pour la table Match à partir de MatchResult + espnState
function matchStatusFor(resultStatus: string, espnState: string | null, kickoffMs: number): string {
  if (resultStatus === 'FINAL' || resultStatus === 'LIVE' || resultStatus === 'POSTPONED' || resultStatus === 'CANCELLED' || resultStatus === 'SUSPENDED') {
    return resultStatus;
  }
  if (espnState === 'post') return 'FINAL';
  if (espnState === 'in') return 'LIVE';
  if (resultStatus === 'UNKNOWN') return kickoffMs < Date.now() - 3 * 3_600_000 ? 'FINAL' : 'SCHEDULED';
  return 'SCHEDULED';
}

async function main() {
  console.log('════════ IMPORT SQLite → NEON ════════');

  // ---------- 1. Prediction (pronos, suivi ROI) ----------
  const preds = q<Row>(`SELECT * FROM "Prediction"`);
  let predRows = preds.map((p) => ({
    id: String(p.id),
    matchId: String(p.matchId),
    league: String(p.league),
    leagueName: String(p.leagueName),
    matchDate: msToDate(p.matchDate)!,
    homeTeam: String(p.homeTeam),
    awayTeam: String(p.awayTeam),
    market: String(p.market),
    pick: String(p.pick),
    probability: Number(p.probability),
    odds: p.odds == null ? null : Number(p.odds),
    oddsCapturedAt: optDate(p.oddsCapturedAt),
    closingOdds: p.closingOdds == null ? null : Number(p.closingOdds),
    pickedTeamId: p.pickedTeamId == null ? null : String(p.pickedTeamId),
    predictionTime: optDate(p.predictionTime),
    modelVersion: p.modelVersion == null ? null : String(p.modelVersion),
    rawProbability: p.rawProbability == null ? null : Number(p.rawProbability),
    inputsDigest: p.inputsDigest == null ? null : String(p.inputsDigest),
    confidence: Number(p.confidence),
    resolved: bool(p.resolved),
    result: p.result == null ? null : String(p.result),
    createdAt: optDate(p.createdAt) ?? new Date(),
  }));
  predRows = predRows.filter((r) => r.matchDate && Number.isFinite(r.probability));
  if ((await neon.prediction.count()) >= predRows.length) {
    console.log(`• Prediction : déjà ${await neon.prediction.count()} en base — sauté`);
  } else {
    let n = 0;
    for (let i = 0; i < predRows.length; i += 200) {
      const chunk = predRows.slice(i, i + 200);
      const r = await neon.prediction.createMany({ data: chunk, skipDuplicates: true });
      n += r.count;
    }
    console.log(`✓ Prediction : ${n}/${predRows.length} importées`);
  }

  // ---------- 2. ForecastMatch (registre des matchs) ----------
  const fms = q<Row>(`SELECT * FROM "ForecastMatch"`);
  let fmRows = fms.map((m) => ({
    id: String(m.id),
    matchId: String(m.matchId),
    league: String(m.league),
    leagueName: String(m.leagueName),
    kickoff: msToDate(m.kickoff)!,
    homeTeamId: m.homeTeamId == null ? null : String(m.homeTeamId),
    homeTeam: String(m.homeTeam),
    homeLogo: m.homeLogo == null ? null : String(m.homeLogo),
    awayTeamId: m.awayTeamId == null ? null : String(m.awayTeamId),
    awayTeam: String(m.awayTeam),
    awayLogo: m.awayLogo == null ? null : String(m.awayLogo),
    espnState: m.espnState == null ? null : String(m.espnState),
    statusDetail: m.statusDetail == null ? null : String(m.statusDetail),
    firstSeenAt: optDate(m.firstSeenAt) ?? new Date(),
    updatedAt: optDate(m.updatedAt) ?? new Date(),
  }));
  fmRows = fmRows.filter((r) => r.kickoff);
  if ((await neon.forecastMatch.count()) >= fmRows.length) {
    console.log(`• ForecastMatch : déjà ${await neon.forecastMatch.count()} en base — sauté`);
  } else {
    let n = 0;
    for (let i = 0; i < fmRows.length; i += 200) {
      const r = await neon.forecastMatch.createMany({ data: fmRows.slice(i, i + 200), skipDuplicates: true });
      n += r.count;
    }
    console.log(`✓ ForecastMatch : ${n}/${fmRows.length} importés`);
  }

  // ---------- 3. MatchResult (+ winner dérivé §6) ----------
  const mrs = q<Row>(`SELECT * FROM "MatchResult"`);
  const mrRows = mrs
    .map((r) => {
      const status = String(r.status);
      const hs = r.homeScore == null ? null : Number(r.homeScore);
      const as_ = r.awayScore == null ? null : Number(r.awayScore);
      return {
        id: String(r.id),
        matchId: String(r.matchId),
        status,
        statusDetail: r.statusDetail == null ? null : String(r.statusDetail),
        homeScore: hs,
        awayScore: as_,
        winner: deriveWinner(status, hs, as_), // §6 : gagnant dérivé, jamais réécrit après coup
        retrievedAt: optDate(r.retrievedAt) ?? new Date(),
        source: r.source == null ? 'ESPN' : String(r.source),
        createdAt: optDate(r.createdAt) ?? new Date(),
        updatedAt: optDate(r.updatedAt) ?? new Date(),
      };
    })
    .filter((r) => r.retrievedAt);
  if ((await neon.matchResult.count()) >= mrRows.length) {
    console.log(`• MatchResult : déjà ${await neon.matchResult.count()} en base — sauté (winner présent : ${mrRows.filter((r) => r.winner).length}/${mrRows.length})`);
  } else {
    let n = 0;
    for (let i = 0; i < mrRows.length; i += 200) {
      const r = await neon.matchResult.createMany({ data: mrRows.slice(i, i + 200), skipDuplicates: true });
      n += r.count;
    }
    console.log(`✓ MatchResult : ${n}/${mrRows.length} importés (winner dérivé)`);
  }

  // ---------- 4. ForecastSnapshot (figés, Task 25) ----------
  const fss = q<Row>(`SELECT * FROM "ForecastSnapshot"`);
  const fsRows = fss
    .map((s) => ({
      id: String(s.id),
      matchId: String(s.matchId),
      version: Number(s.version),
      league: String(s.league),
      leagueName: String(s.leagueName),
      kickoff: msToDate(s.kickoff)!,
      homeTeamId: s.homeTeamId == null ? null : String(s.homeTeamId),
      homeTeam: String(s.homeTeam),
      homeLogo: s.homeLogo == null ? null : String(s.homeLogo),
      awayTeamId: s.awayTeamId == null ? null : String(s.awayTeamId),
      awayTeam: String(s.awayTeam),
      awayLogo: s.awayLogo == null ? null : String(s.awayLogo),
      p1x2Home: Number(s.p1x2Home),
      p1x2Draw: Number(s.p1x2Draw),
      p1x2Away: Number(s.p1x2Away),
      pick1x2: String(s.pick1x2),
      pick1x2Label: String(s.pick1x2Label),
      pickedTeamId: s.pickedTeamId == null ? null : String(s.pickedTeamId),
      confidence: Number(s.confidence),
      pOver25: Number(s.pOver25),
      pUnder25: Number(s.pUnder25),
      pickOu25: String(s.pickOu25),
      pOver25Raw: s.pOver25Raw == null ? null : Number(s.pOver25Raw),
      pUnder25Raw: s.pUnder25Raw == null ? null : Number(s.pUnder25Raw),
      pBttsYes: Number(s.pBttsYes),
      pBttsNo: Number(s.pBttsNo),
      pickBtts: String(s.pickBtts),
      pBttsYesRaw: s.pBttsYesRaw == null ? null : Number(s.pBttsYesRaw),
      pBttsNoRaw: s.pBttsNoRaw == null ? null : Number(s.pBttsNoRaw),
      predictionTime: msToDate(s.predictionTime)!,
      modelVersion: String(s.modelVersion),
      inputsDigest: s.inputsDigest == null ? null : String(s.inputsDigest),
      odds1x2Home: s.odds1x2Home == null ? null : Number(s.odds1x2Home),
      odds1x2Draw: s.odds1x2Draw == null ? null : Number(s.odds1x2Draw),
      odds1x2Away: s.odds1x2Away == null ? null : Number(s.odds1x2Away),
      oddsOver25: s.oddsOver25 == null ? null : Number(s.oddsOver25),
      oddsUnder25: s.oddsUnder25 == null ? null : Number(s.oddsUnder25),
      oddsBttsYes: s.oddsBttsYes == null ? null : Number(s.oddsBttsYes),
      oddsBttsNo: s.oddsBttsNo == null ? null : Number(s.oddsBttsNo),
      oddsCapturedAt: optDate(s.oddsCapturedAt),
      ouMarketLine: s.ouMarketLine == null ? null : Number(s.ouMarketLine),
      published: s.published == null ? true : bool(s.published),
      frozenAt: optDate(s.frozenAt) ?? new Date(),
      createdAt: optDate(s.createdAt) ?? new Date(),
    }))
    .filter((r) => r.kickoff && r.predictionTime);
  if ((await neon.forecastSnapshot.count()) >= fsRows.length) {
    console.log(`• ForecastSnapshot : déjà ${await neon.forecastSnapshot.count()} en base — sauté`);
  } else {
    let n = 0;
    for (let i = 0; i < fsRows.length; i += 200) {
      const r = await neon.forecastSnapshot.createMany({ data: fsRows.slice(i, i + 200), skipDuplicates: true });
      n += r.count;
    }
    console.log(`✓ ForecastSnapshot : ${n}/${fsRows.length} importés`);
  }

  // ---------- 5. ForecastEvaluation ----------
  const evs = q<Row>(`SELECT * FROM "ForecastEvaluation"`);
  const evRows = evs.map((e) => ({
    id: String(e.id),
    matchId: String(e.matchId),
    snapshotId: String(e.snapshotId),
    grade1x2: e.grade1x2 == null ? null : String(e.grade1x2),
    gradeOu25: e.gradeOu25 == null ? null : String(e.gradeOu25),
    gradeBtts: e.gradeBtts == null ? null : String(e.gradeBtts),
    resultKey: e.resultKey == null ? null : String(e.resultKey),
    evaluatedAt: optDate(e.evaluatedAt) ?? new Date(),
    updatedAt: optDate(e.updatedAt) ?? new Date(),
  }));
  if ((await neon.forecastEvaluation.count()) >= evRows.length) {
    console.log(`• ForecastEvaluation : déjà ${await neon.forecastEvaluation.count()} en base — sauté`);
  } else {
    let n = 0;
    for (let i = 0; i < evRows.length; i += 200) {
      const r = await neon.forecastEvaluation.createMany({ data: evRows.slice(i, i + 200), skipDuplicates: true });
      n += r.count;
    }
    console.log(`✓ ForecastEvaluation : ${n}/${evRows.length} importées`);
  }

  // ---------- 6. ForecastJobRun (journal — sauté si déjà présent) ----------
  const existingRuns = await neon.forecastJobRun.count();
  if (existingRuns === 0) {
    const runs = q<Row>(`SELECT * FROM "ForecastJobRun"`).map((j) => ({
      id: String(j.id),
      startedAt: optDate(j.startedAt) ?? new Date(),
      finishedAt: optDate(j.finishedAt),
      phase: String(j.phase),
      stats: j.stats == null ? null : String(j.stats),
      error: j.error == null ? null : String(j.error),
    }));
    for (let i = 0; i < runs.length; i += 200) {
      await neon.forecastJobRun.createMany({ data: runs.slice(i, i + 200) });
    }
    console.log(`✓ ForecastJobRun : ${runs.length} importés`);
  } else {
    console.log(`• ForecastJobRun : déjà ${existingRuns} en base — sauté`);
  }

  // ---------- 7. Conversion vers l'architecture générique §18 ----------
  // PredictionSnapshot + PredictionMarket (1X2 / OVER_UNDER 2.5 / BTTS)
  // + PredictionOutcome — copie FIDÈLE des probabilités figées.
  const existingGeneric = await neon.predictionSnapshot.count();
  if (existingGeneric > 0) {
    console.log(`• PredictionSnapshot : déjà ${existingGeneric} en base — conversion sautée`);
  } else {
    // Les parents d'abord (ids explicites), puis marchés, puis issues.
    const snapData = fsRows.map((s, i) => ({
      id: crypto.randomUUID(),
      snapshotUid: crypto.randomUUID(),
      matchId: s.matchId,
      version: s.version,
      competitionId: s.league,
      competition: s.leagueName,
      season: null,
      kickoffAt: s.kickoff,
      homeTeamId: s.homeTeamId,
      homeTeamName: s.homeTeam,
      awayTeamId: s.awayTeamId,
      awayTeamName: s.awayTeam,
      predictionTime: s.predictionTime,
      modelVersion: s.modelVersion,
      inputsDigest: s.inputsDigest,
      confidence: s.confidence,
      source: 'VOLTRIX',
      frozenAt: s.frozenAt,
      createdAt: s.createdAt,
    }));
    // Ré-association : le mapping snapshotId suit le même ordre que fsRows
    // (les ids ont été régénérés, on reconstruit les marchés avec les BONS ids)
    const mkRows: Array<{ id: string; snapshotId: string; marketKey: string; line: number | null; createdAt: Date }> = [];
    const ocRows: Array<{ id: string; marketId: string; outcomeKey: string; label: string | null; probability: number; rawProbability: number | null; pick: boolean; createdAt: Date }> = [];
    for (let i = 0; i < fsRows.length; i++) {
      const s = fsRows[i];
      const snapId = snapData[i].id;
      const now2 = s.frozenAt;
      const m1 = { id: crypto.randomUUID(), snapshotId: snapId, marketKey: '1X2', line: null as number | null, createdAt: now2 };
      const m2 = { id: crypto.randomUUID(), snapshotId: snapId, marketKey: 'OVER_UNDER', line: 2.5 as number | null, createdAt: now2 };
      const m3 = { id: crypto.randomUUID(), snapshotId: snapId, marketKey: 'BTTS', line: null as number | null, createdAt: now2 };
      mkRows.push(m1, m2, m3);
      ocRows.push(
        { id: crypto.randomUUID(), marketId: m1.id, outcomeKey: 'HOME_WIN', label: `1 - ${s.homeTeam}`, probability: s.p1x2Home, rawProbability: null, pick: s.pick1x2 === '1', createdAt: now2 },
        { id: crypto.randomUUID(), marketId: m1.id, outcomeKey: 'DRAW', label: 'X - Nul', probability: s.p1x2Draw, rawProbability: null, pick: s.pick1x2 === 'X', createdAt: now2 },
        { id: crypto.randomUUID(), marketId: m1.id, outcomeKey: 'AWAY_WIN', label: `2 - ${s.awayTeam}`, probability: s.p1x2Away, rawProbability: null, pick: s.pick1x2 === '2', createdAt: now2 },
        { id: crypto.randomUUID(), marketId: m2.id, outcomeKey: 'OVER', label: `Plus de ${s.ouMarketLine ?? 2.5}`, probability: s.pOver25, rawProbability: s.pOver25Raw, pick: s.pickOu25 === 'OVER', createdAt: now2 },
        { id: crypto.randomUUID(), marketId: m2.id, outcomeKey: 'UNDER', label: `Moins de ${s.ouMarketLine ?? 2.5}`, probability: s.pUnder25, rawProbability: s.pUnder25Raw, pick: s.pickOu25 === 'UNDER', createdAt: now2 },
        { id: crypto.randomUUID(), marketId: m3.id, outcomeKey: 'BTTS_YES', label: 'Les deux équipes marquent - Oui', probability: s.pBttsYes, rawProbability: s.pBttsYesRaw, pick: s.pickBtts === 'YES', createdAt: now2 },
        { id: crypto.randomUUID(), marketId: m3.id, outcomeKey: 'BTTS_NO', label: 'Les deux équipes marquent - Non', probability: s.pBttsNo, rawProbability: s.pBttsNoRaw, pick: s.pickBtts === 'NO', createdAt: now2 }
      );
    }
    for (let i = 0; i < snapData.length; i += 200) {
      await neon.predictionSnapshot.createMany({ data: snapData.slice(i, i + 200) });
    }
    for (let i = 0; i < mkRows.length; i += 400) {
      await neon.predictionMarket.createMany({ data: mkRows.slice(i, i + 400) });
    }
    for (let i = 0; i < ocRows.length; i += 800) {
      await neon.predictionOutcome.createMany({ data: ocRows.slice(i, i + 800) });
    }
    console.log(`✓ PredictionSnapshot (générique §18) : ${snapData.length} snapshots, ${mkRows.length} marchés, ${ocRows.length} issues`);
  }

  // ---------- 8. Pré-remplissage Match / Team / Competition (§3/§8/§9) ----------
  // Mode BATCH (latence Neon) : cartes mémoire + createMany, aucun upsert unitaire.
  const existingMatches = await neon.match.count();
  if (existingMatches > 0) {
    console.log(`• Match : déjà ${existingMatches} en base — pré-remplissage sauté`);
  } else {
    const compByCode = new Map<string, string>();
    const leagues = [...new Set(fmRows.map((m) => m.league))];
    const existingComps = await neon.competition.findMany({ select: { id: true, espnLeagueId: true, name: true } });
    for (const c of existingComps) compByCode.set(c.espnLeagueId, c.id);
    const compsToCreate = leagues
      .filter((code) => !compByCode.has(code))
      .map((code) => ({ espnLeagueId: code, name: fmRows.find((m) => m.league === code)?.leagueName ?? code, sport: 'soccer', season: null as number | null }));
    if (compsToCreate.length) {
      await neon.competition.createMany({ data: compsToCreate, skipDuplicates: true });
      const created = await neon.competition.findMany({ where: { espnLeagueId: { in: compsToCreate.map((c) => c.espnLeagueId) } }, select: { id: true, espnLeagueId: true } });
      for (const c of created) compByCode.set(c.espnLeagueId, c.id);
    }

    // Équipes : créer uniquement les manquantes (batch), cartes espnTeamId → id
    const teamIdsWanted = new Map<string, { name: string; logo: string | null; league: string }>();
    for (const m of fmRows) {
      if (m.homeTeamId && !teamIdsWanted.has(m.homeTeamId)) teamIdsWanted.set(m.homeTeamId, { name: m.homeTeam, logo: m.homeLogo, league: m.league });
      if (m.awayTeamId && !teamIdsWanted.has(m.awayTeamId)) teamIdsWanted.set(m.awayTeamId, { name: m.awayTeam, logo: m.awayLogo, league: m.league });
    }
    const teamsMap = new Map<string, string>();
    const existingTeams = await neon.team.findMany({ where: { espnTeamId: { in: [...teamIdsWanted.keys()] } }, select: { id: true, espnTeamId: true } });
    for (const t of existingTeams) teamsMap.set(t.espnTeamId, t.id);
    const teamsToCreate = [...teamIdsWanted.entries()].filter(([id]) => !teamsMap.has(id)).map(([id, t]) => ({ espnTeamId: id, name: t.name, logo: t.logo, competition: t.league }));
    if (teamsToCreate.length) {
      for (let i = 0; i < teamsToCreate.length; i += 200) {
        await neon.team.createMany({ data: teamsToCreate.slice(i, i + 200), skipDuplicates: true });
      }
      const createdTeams = await neon.team.findMany({ where: { espnTeamId: { in: teamsToCreate.map((t) => t.espnTeamId) } }, select: { id: true, espnTeamId: true } });
      for (const t of createdTeams) teamsMap.set(t.espnTeamId, t.id);
    }

    const resultByMatch = new Map(mrRows.map((r) => [r.matchId, r]));
    const matchRows = fmRows.map((m) => {
      const res = resultByMatch.get(m.matchId);
      const status = matchStatusFor(res?.status ?? 'UNKNOWN', m.espnState, m.kickoff.getTime());
      return {
        espnEventId: m.matchId,
        competitionId: compByCode.get(m.league) ?? null,
        competitionName: m.leagueName,
        season: null,
        homeTeamId: m.homeTeamId,
        homeTeamName: m.homeTeam,
        awayTeamId: m.awayTeamId,
        awayTeamName: m.awayTeam,
        kickoffAt: m.kickoff,
        status,
        statusDetail: res?.statusDetail ?? m.statusDetail,
        espnState: m.espnState,
        homeScore: status === 'FINAL' ? (res?.homeScore ?? null) : null,
        awayScore: status === 'FINAL' ? (res?.awayScore ?? null) : null,
        venue: null,
        createdAt: m.firstSeenAt,
        updatedAt: m.updatedAt,
      };
    });
    let n = 0;
    for (let i = 0; i < matchRows.length; i += 200) {
      const r = await neon.match.createMany({ data: matchRows.slice(i, i + 200), skipDuplicates: true });
      n += r.count;
    }
    console.log(`✓ Match : ${n}/${matchRows.length} pré-remplis | Team : ${teamsMap.size} | Competition : ${compByCode.size}`);
  }

  // ---------- Récapitulatif ----------
  const c = {
    predictions: await neon.prediction.count(),
    forecastMatches: await neon.forecastMatch.count(),
    matchResults: await neon.matchResult.count(),
    forecastSnapshots: await neon.forecastSnapshot.count(),
    forecastEvaluations: await neon.forecastEvaluation.count(),
    matches: await neon.match.count(),
    teams: await neon.team.count(),
    competitions: await neon.competition.count(),
    predictionSnapshots: await neon.predictionSnapshot.count(),
    predictionMarkets: await neon.predictionMarket.count(),
    predictionOutcomes: await neon.predictionOutcome.count(),
  };
  console.log('════════ RÉCAP NEON ════════');
  console.table(c);
}

main()
  .then(() => {
    console.log('✓ Import terminé');
    process.exit(0);
  })
  .catch((e) => {
    console.error('✗ Erreur import:', e);
    process.exit(1);
  })
  .finally(() => neon.$disconnect());
