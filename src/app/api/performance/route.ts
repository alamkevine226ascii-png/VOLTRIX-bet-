// ============================================================
// VOLTRIX bet — API /api/performance
// Résolution des pronos passés + statistiques de performance
// Task 21-a : ROI sans fallback « cote 2.00 » (les sélections sans
// cote réelle sont hors économique mais comptent en accuracy/Brier),
// statistiques sur TOUTE l'historique (pagination par curseur —
// l'ancien take:2000 tronquait 2 280 lignes), capture de la cote de
// clôture à la résolution (closingOdds — jamais utilisée pour le ROI),
// VOID sur annulation/report (grade.ts), résolution 1X2 par IDs.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { resolvePredictionsForDate, computePerformanceStats } from '@/lib/analyze';
import { rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const STAKE = 10; // mise fixe simulée (€)

export async function GET(req: NextRequest) {
  // Task 21-c : rate limiting anti-abus (30 req/min/IP — usage normal intact)
  const rl = rateLimit(req, 'performance', 30, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: `Trop de requêtes, réessaie dans ${rl.retryAfterSec} s` },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } }
    );
  }

  // 1. Résoudre les pronos non résolus des dates passées (max 10 derniers jours)
  //    Task 18-a : la borne inférieure était ANNONCÉE mais absente de la
  //    requête — tout l'historique pending de la DB était rescanné à chaque
  //    appel (fetchs ESPN par (ligue,date) + accumulation cache + lenteur).
  //    Mécanisme opérationnel conservé tel quel (Task 21-a FIX 3).
  const tenDaysAgo = new Date(Date.now() - 10 * 86400_000);
  const today = new Date();
  const pending = await db.prediction.findMany({
    where: {
      resolved: false,
      matchDate: { gte: tenDaysAgo, lt: new Date(today.getTime() - 3 * 3600 * 1000) },
    },
    take: 300,
  });

  const byDate = new Map<string, typeof pending>();
  for (const p of pending) {
    const d = new Date(p.matchDate);
    // Task 19-a : groupement en jour calendaire UTC (getUTC*) — la feuille
    // scoreboard est demandée par date UTC ; les getters locaux auraient
    // décalé les pronos d'un jour sur un serveur non-UTC (TZ≠UTC).
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    if (!byDate.has(key)) byDate.set(key, []);
    byDate.get(key)!.push(p);
  }

  let newlyResolved = 0;
  for (const [dateParam, preds] of byDate) {
    try {
      newlyResolved += await resolvePredictionsForDate(dateParam, preds, db);
    } catch {
      // ignore les échecs de résolution (ligue indisponible etc.)
    }
  }

  // 2. Statistiques globales — Task 21-a (FIX 3) : TOUTE l'historique réglée,
  //    pas un échantillon de 2 000 lignes. Pagination par curseur (id) en
  //    pages de 1 000, select minimal, accumulation via la fonction pure
  //    computePerformanceStats (testable hors serveur).
  const PAGE_SIZE = 1000;
  const MAX_PAGES = 200; // garde-fou anti-boucle (200k lignes)
  // Task 22-a : `modelVersion` vient d'être ajoutée au schéma (db push additif) — le
  // client Prisma EN MÉMOIRE du serveur long-running peut ne pas encore la connaître
  // (convention replis 21-a : rechargement du client requis) → repli silencieux sans
  // le champ pour que la route réponde toujours. En mode dégradé, toutes les lignes
  // tombent dans la cohorte 'legacy' de byVersion ; après rechargement du client les
  // vraies cohortes par version réapparaissent. (Déclaré AVANT la boucle : fetchPage
  // est hoistée mais ce drapeau `let` ne doit pas être en TDZ au premier appel.)
  let modelVersionSupported = true;
  const rows: Awaited<ReturnType<typeof fetchPage>> = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const batch = await fetchPage(cursor);
    if (batch.length === 0) break;
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    cursor = batch[batch.length - 1].id;
  }

  async function fetchPage(cursorId?: string) {
    if (modelVersionSupported) {
      try {
        return await db.prediction.findMany({
          orderBy: { matchDate: 'desc' },
          take: PAGE_SIZE,
          ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
          select: {
            id: true,
            matchDate: true,
            leagueName: true,
            homeTeam: true,
            awayTeam: true,
            market: true,
            pick: true,
            probability: true,
            odds: true,
            confidence: true,
            resolved: true,
            result: true,
            modelVersion: true, // Task 22-a : groupement byVersion (NULL = pré-versionnement)
          },
        });
      } catch {
        modelVersionSupported = false;
      }
    }
    return db.prediction.findMany({
      orderBy: { matchDate: 'desc' },
      take: PAGE_SIZE,
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
      select: {
        id: true,
        matchDate: true,
        leagueName: true,
        homeTeam: true,
        awayTeam: true,
        market: true,
        pick: true,
        probability: true,
        odds: true,
        confidence: true,
        resolved: true,
        result: true,
      },
    });
  }

  const stats = computePerformanceStats(rows, STAKE);

  // Historique récent (résolus + à venir) — 60 plus récents de l'historique complet
  const history = rows.slice(0, 60).map((p) => ({
    id: p.id,
    matchDate: p.matchDate,
    leagueName: p.leagueName,
    homeTeam: p.homeTeam,
    awayTeam: p.awayTeam,
    market: p.market,
    pick: p.pick,
    probability: p.probability,
    odds: p.odds,
    confidence: p.confidence,
    resolved: p.resolved,
    result: p.result,
  }));

  return NextResponse.json({
    totalPredictions: stats.totalPredictions,
    pendingCount: stats.pendingCount,
    newlyResolved,
    totalResolved: stats.totalResolved,
    wins: stats.wins,
    winRate: stats.winRate,
    // ROI économique : uniquement les sélections avec cote réelle (Task 21-a FIX 1)
    roi: stats.roi,
    staked: stats.staked,
    returned: stats.returned,
    economic: stats.economic,
    sample: stats.sample,
    byMarket: stats.byMarket,
    byConfidence: stats.byConfidence,
    byLeague: stats.byLeague,
    // Task 22-a (plan V2→V3 étape 14) : métriques de base par version du modèle —
    // comparaison des versions SANS mélanger les cohortes ; 'legacy' = NULL.
    byVersion: stats.byVersion,
    calibration: stats.calibration,
    history,
  });
}
