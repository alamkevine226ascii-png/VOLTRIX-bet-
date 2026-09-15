// ============================================================
// VOLTRIX bet — API /api/forecasts/week
// §2/§7/§11 : matchs de la semaine + snapshots figés + résultats
// + évaluations + statistiques agrégées (métriques probabilistes).
//
// Task 28 — AUDIT UTILISATEUR (§7) : la liste des matchs vient
// DÉSORMAIS de la table Neon `matches` (source centrale synchronisée
// ESPN → Neon, idempotent par espn_event_id). Plus AUCUN appel ESPN
// à la consultation : la boucle de synchronisation (sync-job) est la
// seule voie d'entrée des données. Le registre ForecastMatch et les
// snapshots figés restent rejoints par l'identifiant ESPN (matchId
// historique === espn_event_id).
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ensureForecastLoop, lastJobInfo } from '@/lib/forecast/job';
// Task 28 §24 : boucle de synchronisation ESPN → Neon (idempotent,
// démarrage paresseux au premier accès — même mécanisme que le job Task 25)
import { ensureSyncLoop } from '@/lib/sync/sync-job';
import {
  weekStartFromParam,
  weekEnd,
  weekLabelFr,
  prevWeekStart,
  nextWeekStart,
  isoDate,
  currentWeekStart,
} from '@/lib/forecast/week';
import { aggregateWeek, type EvalRow } from '@/lib/forecast/metrics';
// Task 28 §4/§22 : statut ESPN = source de vérité (l'heure ne sert que
// de secours) — corrige le bug « À VENIR » sur les matchs terminés.
import { effectiveStatus, statusLabelFr } from '@/lib/sync/status';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  ensureForecastLoop(); // démarrage paresseux de la boucle (idempotent)
  ensureSyncLoop(); // Task 28 : boucle de synchronisation Neon (idempotent)
  const start = weekStartFromParam(req.nextUrl.searchParams.get('start'));
  const end = weekEnd(start);

  // ---------- SOURCE CENTRALE : table `matches` (Neon) ----------
  const matches = await db.match.findMany({
    where: { kickoffAt: { gte: start, lt: end } },
    orderBy: { kickoffAt: 'asc' },
  });
  const eventIds = matches.map((m) => m.espnEventId);

  // Tables satellites, rejointes par l'identifiant ESPN (couplage faible)
  const results = await db.matchResult.findMany({ where: { matchId: { in: eventIds } } });
  const allSnaps = await db.forecastSnapshot.findMany({
    where: { matchId: { in: eventIds } },
    orderBy: { version: 'asc' },
  });
  const evals = await db.forecastEvaluation.findMany({ where: { matchId: { in: eventIds } } });

  // Logos + codes de compétition depuis les tables de référence Neon
  const teamIds = [...new Set(matches.flatMap((m) => [m.homeTeamId, m.awayTeamId]).filter((x): x is string => !!x))];
  const teams = teamIds.length
    ? await db.team.findMany({ where: { espnTeamId: { in: teamIds } }, select: { espnTeamId: true, logo: true } })
    : [];
  const compIds = [...new Set(matches.map((m) => m.competitionId).filter((x): x is string => !!x))];
  const competitions = compIds.length
    ? await db.competition.findMany({ where: { id: { in: compIds } }, select: { id: true, espnLeagueId: true, name: true } })
    : [];
  const logoById = new Map(teams.map((t) => [t.espnTeamId, t.logo]));
  const compById = new Map(competitions.map((c) => [c.id, c]));

  const resultMap = new Map(results.map((r) => [r.matchId, r]));
  const evalMap = new Map(evals.map((e) => [e.matchId, e]));
  const snapsByMatch = new Map<string, typeof allSnaps>();
  for (const s of allSnaps) {
    const arr = snapsByMatch.get(s.matchId) ?? [];
    arr.push(s);
    snapsByMatch.set(s.matchId, arr);
  }

  // Snapshot PUBLIÉ = dernière version publiée (les versions remplacées restent consultables)
  const now = Date.now();
  const windowEnd = nextWeekStart(currentWeekStart());
  const windowEndExclusive = weekEnd(windowEnd); // fin de la semaine suivante

  const matchRows = matches.map((m) => {
    const comp = m.competitionId ? compById.get(m.competitionId) : null;
    const versions = snapsByMatch.get(m.espnEventId) ?? [];
    const snap = [...versions].reverse().find((s) => s.published) ?? null;
    const ev = evalMap.get(m.espnEventId) ?? null;
    const res = resultMap.get(m.espnEventId) ?? null;
    const kickoffMs = m.kickoffAt.getTime();
    // Statut EFFECTIF : résultat officiel (MatchResult) sinon statut
    // canonique synchronisé (Match.status) sinon état ESPN brut
    // (espnState 'post' → TERMINÉ) sinon secours temporel (+3 h).
    const eff = effectiveStatus({
      resultStatus: res?.status ?? m.status,
      espnState: m.espnState,
      statusDetail: m.statusDetail,
      kickoffMs,
      nowMs: now,
    });
    return {
      matchId: m.espnEventId,
      espnEventId: m.espnEventId,
      league: comp?.espnLeagueId ?? '',
      leagueName: comp?.name ?? m.competitionName ?? '',
      competitionId: m.competitionId,
      kickoff: m.kickoffAt.toISOString(),
      homeTeamId: m.homeTeamId,
      homeTeam: m.homeTeamName,
      homeLogo: m.homeTeamId ? logoById.get(m.homeTeamId) ?? null : null,
      awayTeamId: m.awayTeamId,
      awayTeam: m.awayTeamName,
      awayLogo: m.awayTeamId ? logoById.get(m.awayTeamId) ?? null : null,
      status: m.status,
      espnState: m.espnState,
      statusDetail: m.statusDetail,
      effectiveStatus: eff,
      statusLabel: statusLabelFr(eff),
      result: res
        ? {
            status: res.status,
            statusDetail: res.statusDetail,
            homeScore: res.homeScore,
            awayScore: res.awayScore,
            retrievedAt: res.retrievedAt,
          }
        : null,
      snapshot: snap
        ? {
            version: snap.version,
            versionCount: versions.length,
            p1x2Home: snap.p1x2Home,
            p1x2Draw: snap.p1x2Draw,
            p1x2Away: snap.p1x2Away,
            pick1x2: snap.pick1x2,
            pick1x2Label: snap.pick1x2Label,
            pickedTeamId: snap.pickedTeamId,
            confidence: snap.confidence,
            pOver25: snap.pOver25,
            pUnder25: snap.pUnder25,
            pickOu25: snap.pickOu25,
            pOver25Raw: snap.pOver25Raw,
            pUnder25Raw: snap.pUnder25Raw,
            pBttsYes: snap.pBttsYes,
            pBttsNo: snap.pBttsNo,
            pickBtts: snap.pickBtts,
            pBttsYesRaw: snap.pBttsYesRaw,
            pBttsNoRaw: snap.pBttsNoRaw,
            predictionTime: snap.predictionTime,
            modelVersion: snap.modelVersion,
            inputsDigest: snap.inputsDigest,
            odds1x2Home: snap.odds1x2Home,
            odds1x2Draw: snap.odds1x2Draw,
            odds1x2Away: snap.odds1x2Away,
            oddsOver25: snap.oddsOver25,
            oddsUnder25: snap.oddsUnder25,
            oddsBttsYes: snap.oddsBttsYes,
            oddsBttsNo: snap.oddsBttsNo,
            oddsCapturedAt: snap.oddsCapturedAt,
            ouMarketLine: snap.ouMarketLine,
            frozenAt: snap.frozenAt,
          }
        : null,
      evaluation: ev
        ? { grade1x2: ev.grade1x2, gradeOu25: ev.gradeOu25, gradeBtts: ev.gradeBtts, evaluatedAt: ev.evaluatedAt }
        : null,
      // match futur sans snapshot, dans la fenêtre de génération du job (courant+suivant)
      predictionPending:
        !snap && kickoffMs > now && m.kickoffAt < windowEndExclusive && m.espnState !== 'post',
      predictionOutOfRange:
        !snap && kickoffMs > now && !(m.kickoffAt < windowEndExclusive), // au-delà de la fenêtre du job
    };
  });

  // Lignes évaluables pour l'agrégation (snapshot publié + évaluation stockée)
  const evalRows: EvalRow[] = [];
  for (const m of matchRows) {
    if (!m.snapshot || !m.evaluation) continue;
    const r = resultMap.get(m.matchId) ?? null;
    evalRows.push({
      snapshot: {
        matchId: m.matchId,
        version: m.snapshot.version,
        league: m.league,
        leagueName: m.leagueName,
        kickoff: m.kickoff,
        homeTeam: m.homeTeam,
        awayTeam: m.awayTeam,
        p1x2Home: m.snapshot.p1x2Home,
        p1x2Draw: m.snapshot.p1x2Draw,
        p1x2Away: m.snapshot.p1x2Away,
        pick1x2: m.snapshot.pick1x2,
        pick1x2Label: m.snapshot.pick1x2Label,
        confidence: m.snapshot.confidence,
        pOver25: m.snapshot.pOver25,
        pUnder25: m.snapshot.pUnder25,
        pickOu25: m.snapshot.pickOu25,
        pBttsYes: m.snapshot.pBttsYes,
        pBttsNo: m.snapshot.pBttsNo,
        pickBtts: m.snapshot.pickBtts,
      },
      result: r
        ? { status: r.status, homeScore: r.homeScore, awayScore: r.awayScore }
        : null,
      evaluation: { grade1x2: m.evaluation.grade1x2, gradeOu25: m.evaluation.gradeOu25, gradeBtts: m.evaluation.gradeBtts },
    });
  }

  const stats = aggregateWeek(evalRows);
  // Compteurs de semaine (§11) portant sur TOUTE la semaine (pas seulement
  // les matchs évaluables) — les métriques par marché restent, elles,
  // limitées aux prédictions avec résultat valide.
  // Task 28 §22 : compteurs basés sur le STATUT EFFECTIF (ESPN), pas
  // seulement sur la présence d'une ligne MatchResult — un match terminé
  // sans ligne de résultat ne compte plus comme « À VENIR ».
  const VOID_SET = ['POSTPONED', 'CANCELLED', 'SUSPENDED'];
  stats.matchesAnalyzed = matchRows.filter((m) => m.snapshot).length;
  stats.matchesFinished = matchRows.filter((m) => m.effectiveStatus === 'FINAL').length;
  stats.matchesVoid = matchRows.filter((m) => VOID_SET.includes(m.effectiveStatus)).length;
  stats.matchesPending = matchRows.filter((m) => !['FINAL', ...VOID_SET].includes(m.effectiveStatus)).length;
  const job = await lastJobInfo();
  const cur = currentWeekStart();

  return NextResponse.json({
    week: {
      start: isoDate(start),
      end: isoDate(new Date(end.getTime() - 1)),
      label: weekLabelFr(start),
      isCurrent: start.getTime() === cur.getTime(),
      isPast: end.getTime() <= cur.getTime() + 1,
      prev: isoDate(prevWeekStart(start)),
      next: isoDate(nextWeekStart(start)),
    },
    scanTriggered: false, // Task 28 §7 : plus aucun scan ESPN à la consultation
    job,
    matches: matchRows,
    stats,
  });
}
