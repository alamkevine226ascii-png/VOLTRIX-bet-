// ============================================================
// VOLTRIX bet — API /api/bankroll/resolve
// Résolution des jambes d'un ticket du Portefeuille.
// Reçoit des jambes (matchId + ligue + date + marché + pick),
// interroge le scoreboard ESPN et retourne le statut de chaque
// jambe : WIN / LOSE / VOID / PENDING (+ score final).
// Idempotent : ne modifie rien côté serveur (tout vit en local).
// ============================================================

import { NextResponse } from 'next/server';
import { fetchScoreboard, type EspnEvent } from '@/lib/espn';
import { gradeEvent, type LegVerdict } from '@/lib/grade';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface ResolveLeg {
  matchId: string;
  leagueCode: string;
  matchDate: string; // YYYY-MM-DD (normalisé)
  market: string;
  pick: string;
}

// Liste BORNÉE de ligues « probables » pour localiser les jambes des vieux
// tickets placés avant l'ajout de leagueCode (Task 8) — au-delà de cette liste,
// la jambe reste PENDING (comportement documenté, aucun crash).
const FALLBACK_LEAGUES = [
  'eng.1',
  'esp.1',
  'ita.1',
  'ger.1',
  'fra.1',
  'uefa.champions',
  'uefa.europa',
  'ned.1',
  'por.1',
  'tur.1',
] as const;

// LegVerdict et gradeEvent : importés de src/lib/grade.ts (source unique,
// partagée avec /api/cashout pour que vente et règlement disent la même chose).

/** Clé unique d'une jambe : un même match peut porter plusieurs marchés. */
function legKey(l: { matchId: string; market: string; pick: string }): string {
  return `${l.matchId}|${l.market}|${l.pick}`;
}

/**
 * Normalise la date d'une jambe en YYYY-MM-DD.
 * Les jambes stockent la date ESPN COMPLÈTE (« 2026-09-04T19:00Z ») : passée
 * telle quelle à fetchScoreboard, le paramètre `dates=` devenait
 * « 20260904T19:00Z » → scoreboard VIDE → toutes les jambes PENDING à vie
 * (cause racine du ticket jamais réglé). Accepte aussi une date déjà simple.
 */
function normalizeDateKey(raw: unknown): string | null {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

// gradeEvent / LegVerdict : importés de src/lib/grade.ts (source unique,
// partagée avec /api/cashout pour que vente et règlement disent la même chose).

export async function POST(req: Request) {
  let body: { legs?: ResolveLeg[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'JSON invalide' }, { status: 400 });
  }

  // Normalise + valide : date tronquée à YYYY-MM-DD, leagueCode vide accepté
  // (vieux tickets) → fallback borné ci-dessous. Jambe illisible → ignorée.
  const legs: ResolveLeg[] = [];
  for (const l of body.legs ?? []) {
    if (!l || typeof l.matchId !== 'string' || l.matchId === '') continue;
    const matchDate = normalizeDateKey(l.matchDate);
    if (!matchDate) continue;
    legs.push({
      matchId: l.matchId,
      leagueCode: typeof l.leagueCode === 'string' ? l.leagueCode.trim() : '',
      matchDate,
      market: typeof l.market === 'string' ? l.market : '',
      pick: typeof l.pick === 'string' ? l.pick : '',
    });
  }
  if (legs.length === 0) {
    return NextResponse.json({ results: [] satisfies LegVerdict[] });
  }
  // Task 19-a : borne anti-débordement (idem /api/cashout) — le fan-out ESPN
  // = 1 scoreboard par (ligue,date) ×2 feuilles (J puis J−1). Aucun ticket
  // réel n'approche 20 jambes ; 50 plafonne le coût réseau au pire cas.
  if (legs.length > 50) {
    return NextResponse.json({ error: 'Ticket trop grand (50 jambes maximum).' }, { status: 400 });
  }

  const verdicts = new Map<string, LegVerdict>();
  const pending = (leg: ResolveLeg): LegVerdict => ({
    matchId: leg.matchId,
    market: leg.market,
    pick: leg.pick,
    status: 'PENDING',
    score: null,
  });

  // 1) Jambes localisables : regroupées par (ligue, date) → 1 scoreboard par groupe
  const groups = new Map<string, ResolveLeg[]>();
  const orphans = new Map<string, ResolveLeg[]>(); // sans leagueCode → fallback
  for (const leg of legs) {
    if (leg.leagueCode) {
      const key = `${leg.leagueCode}|${leg.matchDate}`;
      const g = groups.get(key);
      if (g) g.push(leg);
      else groups.set(key, [leg]);
    } else {
      const g = orphans.get(leg.matchDate);
      if (g) g.push(leg);
      else orphans.set(leg.matchDate, [leg]);
    }
  }

  for (const [key, groupLegs] of groups) {
    const [leagueCode, dateISO] = key.split('|');
    let board: Awaited<ReturnType<typeof fetchScoreboard>> = null;
    try {
      board = await fetchScoreboard(leagueCode, dateISO);
    } catch {
      board = null;
    }
    const events = board?.events ?? [];
    const byId = new Map(events.map((ev) => [ev.id, ev]));

    // Task 19-a (finding ②) : ESPN regroupe ses journées en heure US Eastern
    // (EDT = UTC−4) — un match à 00h-04h UTC du jour J est publié sur la
    // feuille scoreboard de J−1. Chercher par la date UTC du kick-off ne
    // le trouvait JAMAIS → jambe PENDING à vie (ticket jamais réglé).
    // Retente sur la feuille précédente pour les jambes introuvables
    // (scoreboards en cache 10 min : surcoût borné à 1 fetch par groupe).
    if (groupLegs.some((leg) => !byId.has(leg.matchId))) {
      const prevDate = new Date(Date.parse(`${dateISO}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
      let prevBoard: Awaited<ReturnType<typeof fetchScoreboard>> = null;
      try {
        prevBoard = await fetchScoreboard(leagueCode, prevDate);
      } catch {
        prevBoard = null;
      }
      for (const ev of prevBoard?.events ?? []) {
        if (!byId.has(ev.id)) byId.set(ev.id, ev);
      }
    }

    for (const leg of groupLegs) {
      const ev = byId.get(leg.matchId);
      // match introuvable / non terminé / score absent → encore en cours
      verdicts.set(legKey(leg), ev ? gradeEvent(leg, ev) : pending(leg));
    }
  }

  // 2) Fallback jambes SANS leagueCode : scan borné de ligues probables,
  //    une seule passe par date (les scoreboard sont en cache 10 min côté serveur).
  //    Task 19-a (finding ②) : la feuille J−1 est ajoutée pour les jambes
  //    toujours introuvables (matchs 00h-04h UTC classés la veille par ESPN).
  for (const [dateISO, groupLegs] of orphans) {
    const byId = new Map<string, EspnEvent>();
    const scanLeagues = async (d: string): Promise<void> => {
      await Promise.all(
        FALLBACK_LEAGUES.map(async (leagueCode) => {
          try {
            const board = await fetchScoreboard(leagueCode, d);
            for (const ev of board?.events ?? []) {
              if (!byId.has(ev.id)) byId.set(ev.id, ev);
            }
          } catch {
            // ligue ignorée (réseau/timeout)
          }
        })
      );
    };
    await scanLeagues(dateISO);
    if (groupLegs.some((leg) => !byId.has(leg.matchId))) {
      const prevDate = new Date(Date.parse(`${dateISO}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
      await scanLeagues(prevDate);
    }
    for (const leg of groupLegs) {
      const ev = byId.get(leg.matchId);
      verdicts.set(legKey(leg), ev ? gradeEvent(leg, ev) : pending(leg));
    }
  }

  return NextResponse.json({ results: Array.from(verdicts.values()) });
}
