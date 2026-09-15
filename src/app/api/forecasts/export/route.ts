// ============================================================
// VOLTRIX bet — API /api/forecasts/export
// §18 : export des DONNÉES BRUTES de la semaine (JSON / CSV).
// Le JSON contient TOUTES les versions de snapshot (audit complet),
// le résultat et l'évaluation — suffisant pour recalculer chaque
// métrique indépendamment, sans le moteur VOLTRIX.
// CSV : format large (1 ligne par match, 3 marchés côte à côte).
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { weekStartFromParam, weekEnd, isoDate } from '@/lib/forecast/week';

export const dynamic = 'force-dynamic';

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(req: NextRequest) {
  const start = weekStartFromParam(req.nextUrl.searchParams.get('start'));
  const end = weekEnd(start);
  const format = (req.nextUrl.searchParams.get('format') ?? 'json').toLowerCase();

  const matches = await db.forecastMatch.findMany({
    where: { kickoff: { gte: start, lt: end } },
    orderBy: { kickoff: 'asc' },
  });
  const matchIds = matches.map((m) => m.matchId);
  const results = await db.matchResult.findMany({ where: { matchId: { in: matchIds } } });
  const snapshots = await db.forecastSnapshot.findMany({
    where: { matchId: { in: matchIds } },
    orderBy: { version: 'asc' },
  });
  const evals = await db.forecastEvaluation.findMany({ where: { matchId: { in: matchIds } } });

  const resultMap = new Map(results.map((r) => [r.matchId, r]));
  const evalMap = new Map(evals.map((e) => [e.matchId, e]));
  const versionsByMatch = new Map<string, typeof snapshots>();
  for (const s of snapshots) {
    const arr = versionsByMatch.get(s.matchId) ?? [];
    arr.push(s);
    versionsByMatch.set(s.matchId, arr);
  }

  const stamp = isoDate(new Date());

  if (format === 'csv') {
    const header = [
      'matchId', 'league', 'leagueName', 'kickoff', 'homeTeamId', 'homeTeam', 'awayTeamId', 'awayTeam',
      'snapshotVersion', 'snapshotPublished', 'frozenAt',
      'p1x2Home', 'p1x2Draw', 'p1x2Away', 'pick1x2', 'pick1x2Label', 'pickedTeamId', 'confidence',
      'pOver25', 'pUnder25', 'pOver25Raw', 'pUnder25Raw', 'pickOu25',
      'pBttsYes', 'pBttsNo', 'pBttsYesRaw', 'pBttsNoRaw', 'pickBtts',
      'predictionTime', 'modelVersion', 'inputsDigest', 'ouMarketLine',
      'odds1x2Home', 'odds1x2Draw', 'odds1x2Away', 'oddsOver25', 'oddsUnder25', 'oddsBttsYes', 'oddsBttsNo', 'oddsCapturedAt',
      'resultStatus', 'resultStatusDetail', 'homeScore', 'awayScore', 'resultRetrievedAt', 'resultSource',
      'grade1x2', 'gradeOu25', 'gradeBtts', 'evaluatedAt',
    ];
    const lines = [header.join(',')];
    for (const m of matches) {
      const r = resultMap.get(m.matchId) ?? null;
      const ev = evalMap.get(m.matchId) ?? null;
      const versions = versionsByMatch.get(m.matchId) ?? [];
      const rows = versions.length > 0 ? versions : [null];
      for (const s of rows) {
        lines.push(
          [
            m.matchId, m.league, m.leagueName, m.kickoff.toISOString(), m.homeTeamId, m.homeTeam, m.awayTeamId, m.awayTeam,
            s?.version ?? '', s?.published ?? '', s ? s.frozenAt.toISOString() : '',
            s?.p1x2Home ?? '', s?.p1x2Draw ?? '', s?.p1x2Away ?? '', s?.pick1x2 ?? '', s?.pick1x2Label ?? '', s?.pickedTeamId ?? '', s?.confidence ?? '',
            s?.pOver25 ?? '', s?.pUnder25 ?? '', s?.pOver25Raw ?? '', s?.pUnder25Raw ?? '', s?.pickOu25 ?? '',
            s?.pBttsYes ?? '', s?.pBttsNo ?? '', s?.pBttsYesRaw ?? '', s?.pBttsNoRaw ?? '', s?.pickBtts ?? '',
            s ? s.predictionTime.toISOString() : '', s?.modelVersion ?? '', s?.inputsDigest ?? '', s?.ouMarketLine ?? '',
            s?.odds1x2Home ?? '', s?.odds1x2Draw ?? '', s?.odds1x2Away ?? '', s?.oddsOver25 ?? '', s?.oddsUnder25 ?? '', s?.oddsBttsYes ?? '', s?.oddsBttsNo ?? '', s ? s.oddsCapturedAt?.toISOString() ?? '' : '',
            r?.status ?? '', r?.statusDetail ?? '', r?.homeScore ?? '', r?.awayScore ?? '', r ? r.retrievedAt.toISOString() : '', r?.source ?? '',
            ev?.grade1x2 ?? '', ev?.gradeOu25 ?? '', ev?.gradeBtts ?? '', ev ? ev.evaluatedAt.toISOString() : '',
          ]
            .map(csvEscape)
            .join(',')
        );
      }
    }
    const body = '\uFEFF' + lines.join('\n'); // BOM UTF-8 (Excel FR)
    return new NextResponse(body, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="voltrix-previsions-${stamp}.csv"`,
      },
    });
  }

  // JSON — audit scientifique complet
  const payload = {
    generatedAt: new Date().toISOString(),
    week: { start: isoDate(start), endExclusive: isoDate(end) },
    source: 'ESPN (source officielle VOLTRIX)',
    engineNote: 'Probabilités produites par le moteur VOLTRIX en production au moment de predictionTime (modelVersion ci-joint). Aucune probabilité n a été modifiée après gel.',
    matches: matches.map((m) => ({
      matchId: m.matchId,
      league: m.league,
      leagueName: m.leagueName,
      kickoff: m.kickoff.toISOString(),
      homeTeamId: m.homeTeamId,
      homeTeam: m.homeTeam,
      awayTeamId: m.awayTeamId,
      awayTeam: m.awayTeam,
      espnState: m.espnState,
      statusDetail: m.statusDetail,
      // §19 : les trois concepts restent séparés dans l'export
      snapshots: (versionsByMatch.get(m.matchId) ?? []).map((s) => ({ ...s })), // prédiction(s) figée(s) — toutes les versions
      result: resultMap.get(m.matchId)
        ? {
            status: resultMap.get(m.matchId)!.status,
            statusDetail: resultMap.get(m.matchId)!.statusDetail,
            homeScore: resultMap.get(m.matchId)!.homeScore,
            awayScore: resultMap.get(m.matchId)!.awayScore,
            retrievedAt: resultMap.get(m.matchId)!.retrievedAt.toISOString(),
            source: resultMap.get(m.matchId)!.source,
          }
        : null,
      evaluation: evalMap.get(m.matchId)
        ? {
            snapshotId: evalMap.get(m.matchId)!.snapshotId,
            grade1x2: evalMap.get(m.matchId)!.grade1x2,
            gradeOu25: evalMap.get(m.matchId)!.gradeOu25,
            gradeBtts: evalMap.get(m.matchId)!.gradeBtts,
            resultKey: evalMap.get(m.matchId)!.resultKey,
            evaluatedAt: evalMap.get(m.matchId)!.evaluatedAt.toISOString(),
          }
        : null,
    })),
  };

  return new NextResponse(JSON.stringify(payload, null, 1), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="voltrix-previsions-${stamp}.json"`,
    },
  });
}
