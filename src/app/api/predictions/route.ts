// ============================================================
// VOLTRIX bet — API /api/predictions (POST)
// Analyse en lot : Poisson + Elo + forme + contexte
// et persistance des pronos pour le suivi de performance.
//
// OPTION B (audit Task 37/38/39, plan validé) : couche snapshot en
// pré-étape — chaque match disposant d'un ForecastSnapshot PUBLIÉ
// (même règle que /api/forecasts/week) et VALIDE est servi directement
// depuis Neon par le module pur src/lib/forecast/snapshot-serve.ts :
//   - ZÉRO appel ESPN, ZÉRO appel moteur (analyzeBatch n'est appelé
//     qu'avec le sous-ensemble sans snapshot — 0 HTTP si liste vide) ;
//   - persistance Prediction conservée (continuité /api/performance),
//     en valeurs FIGÉES du snapshot (upsert create + update:{} —
//     idempotent, jamais de réécriture : anti look-ahead renforcé) ;
//   - fallback = chemin moteur ACTUEL, à l'identique, uniquement pour
//     les matchs sans snapshot valide (ou si la lecture snapshot a
//     échoué — tout le lot repasse alors en chemin actuel) ;
//   - réponse : résultats DANS L'ORDRE de la demande, shape QuickPred
//     strictement identique + objet `meta` ADDITIF (diagnostic :
//     source par match + compteur d'appels ESPN sortants).
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { analyzeBatch, extractPicks, type AnalyzeResult } from '@/lib/analyze';
import { db } from '@/lib/db';
import { rateLimit } from '@/lib/rate-limit';
import { MODEL_VERSION } from '@/lib/model-version';
import {
  buildFrozenPicks,
  buildQuickPredFromSnapshot,
  endFetchCapture,
  fetchValidSnapshots,
  startFetchCapture,
  type FetchCapture,
  type ServeMeta,
  type ServeSource,
  type SnapshotBundle,
} from '@/lib/forecast/snapshot-serve';
import type { QuickPred } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

interface BatchRequest {
  matches: Array<{ matchId: string; leagueCode: string; date: string }>;
}

/** Diagnostic vide (lot vide). */
function emptyMeta(): ServeMeta {
  return {
    source: 'empty',
    counts: { total: 0, snapshot: 0, fallback: 0, failed: 0 },
    espnCalls: 0,
    outboundCalls: 0,
    snapshotLookupOk: true,
    perMatch: {},
  };
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
    return NextResponse.json({ results: [], meta: emptyMeta() });
  }

  // Capture des appels réseau sortants (diagnostic Option B : espnCalls=0
  // attendu pour un lot 100 % couvert par les snapshots — test anti-ESPN).
  const capture: FetchCapture = startFetchCapture();
  try {
    // ---------- Option B — étape 1 : lecture des snapshots (2 SELECT Neon, 0 ESPN) ----------
    let bundles: Map<string, SnapshotBundle> | null = null;
    let snapshotLookupOk = true;
    try {
      bundles = await fetchValidSnapshots(matches.map((m) => m.matchId));
    } catch {
      // Plan §3 : erreur DB sur la lecture snapshot → TOUT le lot repasse
      // en chemin actuel (disponibilité > optimisation).
      snapshotLookupOk = false;
      bundles = null;
    }

    type Slot =
      | { kind: 'snapshot'; pred: QuickPred; bundle: SnapshotBundle }
      | { kind: 'fallback'; analysis: AnalyzeResult }
      | { kind: 'failed' };
    const slots: Slot[] = new Array(matches.length);

    // ---------- Option B — étape 2 : branchage par match ----------
    const nowMs = Date.now();
    const fallbackReqs: Array<{ index: number; req: { matchId: string; leagueCode: string; date: string } }> = [];
    matches.forEach((m, i) => {
      // bundles === null si la lecture snapshot a échoué → tous les matchs
      // basculent dans fallbackReqs (chemin moteur actuel, plan §3).
      const bundle = bundles?.get(m.matchId);
      if (bundle) {
        // Carte servie depuis le snapshot : ~0 ms, 0 ESPN, 0 moteur.
        slots[i] = { kind: 'snapshot', pred: buildQuickPredFromSnapshot(m.matchId, bundle, nowMs), bundle };
      } else {
        fallbackReqs.push({ index: i, req: { matchId: m.matchId, leagueCode: m.leagueCode, date: m.date } });
      }
    });

    // ---------- Option B — étape 3 : fallback moteur (chemin ACTUEL inchangé) ----------
    // analyzeBatch n'est appelé qu'avec le sous-ensemble SANS snapshot —
    // appel court-circuité si liste vide → 0 HTTP sortant (test anti-ESPN).
    const fallbackResults = fallbackReqs.length
      ? await analyzeBatch(
          fallbackReqs.map((f) => f.req),
          6
        )
      : [];
    fallbackReqs.forEach((f, j) => {
      const r = fallbackResults[j];
      slots[f.index] = r ? { kind: 'fallback', analysis: r } : { kind: 'failed' };
    });

    // ---------- Option B — étape 4 : persistance FIGÉE des matchs snapshot ----------
    // Plan §4 : mêmes 3 picks par match que extractPicks, valeurs figées du
    // snapshot ; uniquement si kickoff > now (équivalent du filtre status
    // === 'pre') ; upsert create + update:{} → idempotent, un re-POST ne
    // réécrit RIEN (anti look-ahead renforcé).
    for (let i = 0; i < matches.length; i++) {
      const s = slots[i];
      if (!s || s.kind !== 'snapshot') continue;
      if (!(s.bundle.snap.kickoff.getTime() > nowMs)) continue;
      for (const pick of buildFrozenPicks(s.bundle.snap)) {
        try {
          await db.prediction.upsert({
            where: { matchId_market: { matchId: matches[i].matchId, market: pick.market } },
            create: {
              matchId: matches[i].matchId,
              league: s.bundle.snap.league,
              leagueName: s.bundle.snap.leagueName,
              matchDate: s.bundle.snap.kickoff,
              homeTeam: s.bundle.snap.homeTeam,
              awayTeam: s.bundle.snap.awayTeam,
              market: pick.market,
              pick: pick.pick,
              probability: pick.probability,
              odds: pick.odds,
              pickedTeamId: pick.pickedTeamId,
              // Figé : temps de GÉNÉRATION réel du prono (snapshot) et
              // capture de cote d'origine — PAS « maintenant » (le prono
              // existed avant cette requête : ne jamais s'attribuer une
              // fraîcheur fictive).
              predictionTime: s.bundle.snap.predictionTime,
              modelVersion: s.bundle.snap.modelVersion,
              rawProbability: pick.rawProbability,
              inputsDigest: pick.inputsDigest,
              oddsCapturedAt: s.bundle.snap.oddsCapturedAt,
              confidence: pick.confidence,
            },
            update: {}, // idempotent — les valeurs figées restent figées
          });
        } catch {
          // Repli « shape historique » (même pattern que le chemin moteur) :
          // client Prisma sans les colonnes Task 21-a/22-a.
          try {
            await db.prediction.upsert({
              where: { matchId_market: { matchId: matches[i].matchId, market: pick.market } },
              create: {
                matchId: matches[i].matchId,
                league: s.bundle.snap.league,
                leagueName: s.bundle.snap.leagueName,
                matchDate: s.bundle.snap.kickoff,
                homeTeam: s.bundle.snap.homeTeam,
                awayTeam: s.bundle.snap.awayTeam,
                market: pick.market,
                pick: pick.pick,
                probability: pick.probability,
                odds: pick.odds,
                confidence: pick.confidence,
              },
              update: {},
            });
          } catch {
            // la persistance ne doit jamais bloquer l'affichage des pronos
          }
        }
      }
    }

    // ---------- Persistance des pronos moteur (suivi de performance) ----------
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
    // Option B : cette boucle historique ne voit que le sous-ensemble FALLBACK —
    // le chemin snapshot est persisté ci-dessus en valeurs figées.
    let newColumnsSupported = true;
    const fallbackAnalyses = slots
      .filter((s): s is Extract<Slot, { kind: 'fallback' }> => s.kind === 'fallback')
      .map((s) => s.analysis);
    for (const r of fallbackAnalyses) {
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

    // ---------- Option B — étape 5 : diagnostic (meta additif) ----------
    const counts = { total: matches.length, snapshot: 0, fallback: 0, failed: 0 };
    const perMatch: Record<string, ServeSource> = {};
    slots.forEach((s, i) => {
      const id = matches[i].matchId;
      if (s.kind === 'snapshot') {
        counts.snapshot++;
        perMatch[id] = 'snapshot';
      } else if (s.kind === 'fallback') {
        counts.fallback++;
        perMatch[id] = 'fallback';
      } else {
        counts.failed++;
        perMatch[id] = 'failed';
      }
    });
    const meta: ServeMeta = {
      source:
        counts.snapshot === 0
          ? 'fallback'
          : counts.fallback === 0 && counts.failed === 0
            ? 'snapshot'
            : 'mixed',
      counts,
      espnCalls: capture.espn,
      outboundCalls: capture.outbound,
      snapshotLookupOk,
      perMatch,
    };

    // ---------- Réponse : ordre de la demande préservé, shape identique ----------
    return NextResponse.json({
      results: slots.map((s) => {
        if (s.kind === 'failed') return null;
        if (s.kind === 'snapshot') return s.pred;
        const r = s.analysis;
        return {
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
        };
      }),
      meta,
    });
  } finally {
    endFetchCapture(capture);
  }
}
