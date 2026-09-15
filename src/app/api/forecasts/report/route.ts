// ============================================================
// VOLTRIX bet — API /api/forecasts/report
// §17 : « GÉNÉRER LE RAPPORT DE LA SEMAINE » — PDF professionnel
// construit à partir des données brutes de la semaine (snapshots
// figés + résultats + évaluations). Aucune donnée n'est recomposée :
// le PDF reflète exactement ce que l'export JSON/CSV contient.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { weekStartFromParam, weekEnd, weekLabelFr, isoDate } from '@/lib/forecast/week';
import { aggregateWeek, pickedProb1x2, type EvalRow } from '@/lib/forecast/metrics';
import { buildWeeklyReportPdf, type ReportMatchRow } from '@/lib/forecast/report-pdf';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const pctFR = (x: number): string => `${Math.round(x * 100)}`;

export async function GET(req: NextRequest) {
  const start = weekStartFromParam(req.nextUrl.searchParams.get('start'));
  const end = weekEnd(start);

  const matches = await db.forecastMatch.findMany({
    where: { kickoff: { gte: start, lt: end } },
    orderBy: { kickoff: 'asc' },
  });
  const matchIds = matches.map((m) => m.matchId);
  const results = await db.matchResult.findMany({ where: { matchId: { in: matchIds } } });
  const snaps = await db.forecastSnapshot.findMany({
    where: { matchId: { in: matchIds }, published: true },
  });
  const evals = await db.forecastEvaluation.findMany({ where: { matchId: { in: matchIds } } });

  const resultMap = new Map(results.map((r) => [r.matchId, r]));
  const snapMap = new Map(snaps.map((s) => [s.matchId, s]));
  const evalMap = new Map(evals.map((e) => [e.matchId, e]));

  const evalRows: EvalRow[] = [];
  const rows: ReportMatchRow[] = [];
  let withoutOdds = 0;
  let voidMatches = 0;

  for (const m of matches) {
    const snap = snapMap.get(m.matchId) ?? null;
    const ev = evalMap.get(m.matchId) ?? null;
    const r = resultMap.get(m.matchId) ?? null;
    if (r && ['POSTPONED', 'CANCELLED', 'SUSPENDED'].includes(r.status)) voidMatches += 1;
    if (snap && !snap.odds1x2Home && !snap.oddsOver25) withoutOdds += 1;

    if (snap) {
      evalRows.push({
        snapshot: {
          matchId: m.matchId,
          version: snap.version,
          league: m.league,
          leagueName: m.leagueName,
          kickoff: m.kickoff,
          homeTeam: m.homeTeam,
          awayTeam: m.awayTeam,
          p1x2Home: snap.p1x2Home,
          p1x2Draw: snap.p1x2Draw,
          p1x2Away: snap.p1x2Away,
          pick1x2: snap.pick1x2,
          pick1x2Label: snap.pick1x2Label,
          confidence: snap.confidence,
          pOver25: snap.pOver25,
          pUnder25: snap.pUnder25,
          pickOu25: snap.pickOu25,
          pBttsYes: snap.pBttsYes,
          pBttsNo: snap.pBttsNo,
          pickBtts: snap.pickBtts,
        },
        result: r ? { status: r.status, homeScore: r.homeScore, awayScore: r.awayScore } : null,
        evaluation: ev
          ? { grade1x2: ev.grade1x2, gradeOu25: ev.gradeOu25, gradeBtts: ev.gradeBtts }
          : null,
      });
    }

    const resLabel = r
      ? r.status === 'FINAL' && r.homeScore !== null && r.awayScore !== null
        ? `${r.homeScore}–${r.awayScore}`
        : r.status === 'POSTPONED'
          ? 'Reporté'
          : r.status === 'CANCELLED'
            ? 'Annulé'
            : r.status === 'SUSPENDED'
              ? 'Suspendu'
              : r.status === 'LIVE'
                ? 'En direct'
                : 'À venir'
      : 'À venir';

    const verdictParts: string[] = [];
    if (ev) {
      verdictParts.push(ev.grade1x2 === 'CORRECT' ? '1X2 OK' : ev.grade1x2 === 'INCORRECT' ? '1X2 KO' : '1X2 —');
      verdictParts.push(ev.gradeOu25 === 'CORRECT' ? 'O/U OK' : ev.gradeOu25 === 'INCORRECT' ? 'O/U KO' : 'O/U —');
      verdictParts.push(ev.gradeBtts === 'CORRECT' ? 'BTTS OK' : ev.gradeBtts === 'INCORRECT' ? 'BTTS KO' : 'BTTS —');
    } else {
      verdictParts.push('—');
    }

    rows.push({
      matchId: m.matchId,
      kickoff: m.kickoff,
      leagueName: m.leagueName,
      homeTeam: m.homeTeam,
      awayTeam: m.awayTeam,
      hasSnapshot: !!snap,
      pick1x2Label: snap ? snap.pick1x2Label.split(' - ')[0] : undefined,
      p1x2: snap ? `${pctFR(snap.p1x2Home)}/${pctFR(snap.p1x2Draw)}/${pctFR(snap.p1x2Away)}` : undefined,
      pickOu25Label: snap ? (snap.pickOu25 === 'OVER' ? '+2.5' : '-2.5') : undefined,
      pOu: snap ? pctFR(snap.pickOu25 === 'OVER' ? snap.pOver25 : snap.pUnder25) : undefined,
      pickBttsLabel: snap ? (snap.pickBtts === 'YES' ? 'Oui' : 'Non') : undefined,
      pBtts: snap ? pctFR(snap.pickBtts === 'YES' ? snap.pBttsYes : snap.pBttsNo) : undefined,
      confidence: snap?.confidence,
      resultLabel: resLabel,
      verdict: verdictParts.join(' '),
    });
  }

  const stats = aggregateWeek(evalRows);
  // Compteurs §11 sur toute la semaine (cohérents avec /api/forecasts/week)
  const VOID_SET = ['POSTPONED', 'CANCELLED', 'SUSPENDED'];
  stats.matchesAnalyzed = rows.filter((r) => r.hasSnapshot).length;
  stats.matchesFinished = rows.filter((r) => r.resultLabel.match(/^\d+–\d+$/)).length;
  stats.matchesVoid = voidMatches;
  stats.matchesPending = rows.filter((r) => ['À venir', 'En direct'].includes(r.resultLabel)).length;
  const bytes = await buildWeeklyReportPdf({
    weekLabel: weekLabelFr(start),
    startISO: isoDate(start),
    endISO: isoDate(new Date(end.getTime() - 1)),
    generatedAt: new Date().toISOString(),
    stats,
    matches: rows,
    voidMatches,
    matchesWithoutSnapshot: matches.length - snapMap.size,
    matchesWithoutOdds: withoutOdds,
  });

  return new NextResponse(Buffer.from(bytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="voltrix-rapport-${isoDate(start)}.pdf"`,
    },
  });
}
