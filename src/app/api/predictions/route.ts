// ============================================================
// VOLTRIX bet — API /api/predictions (POST)
// Analyse complète en lot : Poisson + Elo + forme + contexte
// et persistance des pronos pour le suivi de performance
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { analyzeBatch, extractPicks } from '@/lib/analyze';
import { db } from '@/lib/db';
import { rateLimit } from '@/lib/rate-limit';
import { MODEL_VERSION } from '@/lib/model-version';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

interface BatchRequest {
  matches: Array<{ matchId: string; leagueCode: string; date: string }>;
}

export async function POST(req: NextRequest) {
  // Task 21-c : rate limiting anti-abus (20 req/min/IP — l'app analyse par lots de 6, usage normal intact)
  const rl = rateLimit(req, 'predictions-post', 20, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: `Trop de requêtes, réessaie dans ${rl.retryAfterSec} s` },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } }
    );
  }

  let body: BatchRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Requête invalide' }, { status: 400 });
  }

  const matches = (body.matches ?? []).slice(0, 12);
  if (matches.length === 0) {
    return NextResponse.json({ results: [] });
  }

  const results = await analyzeBatch(
    matches.map((m) => ({ matchId: m.matchId, leagueCode: m.leagueCode, date: m.date })),
    6
  );

  // Persister les pronos pour les matchs à venir (suivi de performance)
  // Séquentiel : SQLite n'accepte qu'un seul écrivain, les rafales parallèles
  // provoquent des erreurs BUSY/readonly.
  // Task 21-a (FIX 2/5) : le prono persiste aussi pickedTeamId (ID équipe ESPN
  // du côté 1X2 piqué) et oddsCapturedAt (moment de capture de `odds` —
  // anti look-ahead). Si le client Prisma en mémoire du serveur long-running
  // ne connaît pas encore ces colonnes (db push additif), repli silencieux sur
  // l'écriture historique : la persistance ne doit jamais bloquer l'affichage.
  // Task 22-a (plan V2→V3 étapes 1/2/14) : à la CRÉATION d'une ligne on fige
  // predictionTime (génération — DISTINCT du kickoff matchDate), modelVersion
  // (MODEL_VERSION) et on stocke rawProbability/inputsDigest. Ces deux premiers
  // champs sont IMMUABLES : aucun upsert/update ci-dessous ne les réécrit —
  // un rafraîchissement de probability/odds fait bouger oddsCapturedAt, jamais
  // predictionTime (lignes modelVersion NULL = pré-versionnement, jamais réétiquetées).
  let newColumnsSupported = true;
  for (const r of results) {
    if (!r) continue;
    if (r.status !== 'pre') continue;
    const picks = extractPicks(r);
    for (const pick of picks) {
      try {
        // Task 19-a : upsert création + lecture, écriture CONDITIONNELLE —
        // l'ancien upsert réécrivait probability/odds/pick même sur un prono
        // déjà résolu (contrepied du commentaire) → la proba historique
        // changeait a posteriori et faussait le calibrage /api/performance.
        let row: { id: string; resolved: boolean };
        try {
          row = await db.prediction.upsert({
            where: { matchId_market: { matchId: r.matchId, market: pick.market } },
            create: {
              matchId: r.matchId,
              league: r.leagueCode,
              leagueName: r.leagueName,
              matchDate: new Date(r.matchDate),
              homeTeam: r.home.name,
              awayTeam: r.away.name,
              market: pick.market,
              pick: pick.pick,
              probability: pick.probability,
              odds: pick.odds,
              pickedTeamId: pick.pickedTeamId,
              oddsCapturedAt: new Date(),
              // Task 22-a : figés à la création — predictionTime ≠ matchDate (kickoff),
              // modelVersion = version déclarée du moteur ; JAMAIS réécrits ensuite.
              predictionTime: new Date(),
              modelVersion: MODEL_VERSION,
              rawProbability: pick.rawProbability,
              inputsDigest: pick.inputsDigest,
              confidence: pick.confidence,
            },
            update: {},
          });
        } catch {
          // Repli : client Prisma sans les colonnes Task 21-a (rechargement serveur
          // requis) — recrée avec le shape historique, ou propage l'erreur d'origine
          // (contrainte unique, etc.) qui sera avalée par le catch englobant.
          newColumnsSupported = false;
          row = await db.prediction.upsert({
            where: { matchId_market: { matchId: r.matchId, market: pick.market } },
            create: {
              matchId: r.matchId,
              league: r.leagueCode,
              leagueName: r.leagueName,
              matchDate: new Date(r.matchDate),
              homeTeam: r.home.name,
              awayTeam: r.away.name,
              market: pick.market,
              pick: pick.pick,
              probability: pick.probability,
              odds: pick.odds,
              confidence: pick.confidence,
            },
            update: {},
          });
        }
        if (!row.resolved) {
          try {
            await db.prediction.update({
              where: { id: row.id },
              data: {
                probability: pick.probability,
                odds: pick.odds,
                confidence: pick.confidence,
                pick: pick.pick,
                pickedTeamId: pick.pickedTeamId,
                // `odds` est réécrit ici : l'horodatage suit la valeur réellement stockée
                oddsCapturedAt: new Date(),
                // Task 22-a : le digest/raw suivent la probabilité rafraîchie (même lot
                // d'entrées) — en revanche predictionTime et modelVersion ne figurent
                // PAS ici : immuables depuis la création (plan étapes 1 et 14).
                rawProbability: pick.rawProbability,
                inputsDigest: pick.inputsDigest,
              },
            });
          } catch {
            if (!newColumnsSupported) throw new Error('rethrow-original');
            newColumnsSupported = false;
            await db.prediction.update({
              where: { id: row.id },
              data: {
                probability: pick.probability,
                odds: pick.odds,
                confidence: pick.confidence,
                pick: pick.pick,
              },
            });
          }
        }
      } catch {
        // la persistance ne doit jamais bloquer l'affichage des pronos
      }
    }
  }

  return NextResponse.json({
    results: results.map((r) =>
      r
        ? {
            matchId: r.matchId,
            leagueCode: r.leagueCode,
            leagueName: r.leagueName,
            status: r.status,
            probs: r.prediction.probs,
            lambda: r.prediction.lambda,
            confidence: r.prediction.confidence,
            confidenceLabel: r.prediction.confidenceLabel,
            recommendedBets: r.prediction.recommendedBets,
            overUnder: r.prediction.overUnder,
            btts: r.prediction.btts,
            topScores: r.prediction.topScores,
            valueBetsCount: r.prediction.valueBets.length,
            // Ligne O/U principale réelle (pour calibrer les marchés buts du combiné)
            ouOdds:
              r.odds && r.odds.hasOdds
                ? {
                    line: r.odds.overUnderLine,
                    over: r.odds.total.over.closeOdds ?? r.odds.total.over.openOdds,
                    under: r.odds.total.under.closeOdds ?? r.odds.total.under.openOdds,
                  }
                : null,
          }
        : null
    ),
  });
}
