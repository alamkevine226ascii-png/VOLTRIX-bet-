// ============================================================
// VOLTRIX bet — API /api/cashout (conseil de vente de coupon)
// Reçoit un coupon (jambes + mise + cote totale) et le prix
// proposé par le bookmaker pour le racheter. Interroge le
// scoreboard ESPN pour CHAQUE jambe (à venir / en cours /
// terminé + score + horloge), recalcule la probabilité de chaque
// jambe à l'instant T (lib/live-prob), en déduit la VALEUR JUSTE
// du coupon et recommande : VENDRE / GARDER / ZONE GRISE /
// PERDU / GAGNÉ. Idempotent : ne modifie rien côté serveur.
// ============================================================

import { NextResponse } from 'next/server';
import { mapWithConcurrency } from '@/lib/cache';
import { rateLimit } from '@/lib/rate-limit';
import { fetchScoreboard, type EspnEvent } from '@/lib/espn';
import { gradeEvent, type LegStatus } from '@/lib/grade';
import { legLiveProb, remainingFraction, type LiveLegState } from '@/lib/live-prob';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface CashoutLeg {
  matchId: string;
  leagueCode: string;
  matchDate: string; // ISO ou YYYY-MM-DD
  market: string;
  pick: string;
  prob: number; // proba modèle initiale (stockée dans la jambe du coupon)
  homeName?: string; // lève le côté du pick 1X2 sans dépendre du scoreboard
  awayName?: string;
}

type Decision = 'SELL' | 'HOLD' | 'MAYBE' | 'LOST' | 'WON';

interface LegReport {
  matchId: string;
  market: string;
  pick: string;
  phase: 'pre' | 'in' | 'post' | 'unknown';
  statusDetail: string;
  score: string | null;
  verdict: LegStatus; // WIN/LOSE une fois terminé, PENDING sinon
  pInit: number; // proba modèle pré-match
  pNow: number; // proba à l'instant T (1/0 si terminé)
  note: string; // explication lisible
}

interface CashoutResponse {
  legs: LegReport[];
  jointProb: number; // produit des pNow (jambes gagnées comptent pour 1)
  fairValue: number; // valeur juste = mise × cote × jointProb
  offered: number;
  edge: number; // (offre / valeur juste) − 1
  decision: Decision;
  message: string; // recommandation lisible
  asOf: number; // epoch ms de l'analyse
}

function normalizeDateKey(raw: unknown): string | null {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/** Côté d'un pick 1X2 ('home' | 'away' | 'draw') via les noms stockés dans la jambe. */
function sideFor1x2(pick: string, homeName?: string, awayName?: string): 'home' | 'away' | 'draw' {
  if (pick === 'Match nul') return 'draw';
  if (pick.startsWith('Victoire ')) {
    const picked = pick.slice('Victoire '.length).trim();
    if (homeName && (picked === homeName || homeName.includes(picked) || picked.includes(homeName))) return 'home';
    if (awayName && (picked === awayName || awayName.includes(picked) || picked.includes(awayName))) return 'away';
    return 'draw'; // repli prudent : sens non déterminé
  }
  return 'draw';
}

/** État ESPN minimal extrait d'un événement du scoreboard. */
interface EventState {
  status: 'pre' | 'in' | 'post';
  statusDetail: string;
  completed: boolean;
  homeScore: number | null;
  awayScore: number | null;
  homeName: string;
  awayName: string;
  date: string;
  event: EspnEvent; // référence complète pour le grading
}

function noteFor(r: LegReport, minutesLeft: number | null): string {
  if (r.phase === 'post') {
    if (r.verdict === 'WIN') return 'Match terminé — sélection gagnée';
    if (r.verdict === 'LOSE') return 'Match terminé — sélection perdue';
    return 'Match terminé (résultat non exploitable)';
  }
  if (r.phase === 'in') {
    if (minutesLeft != null) return `En cours · ${r.statusDetail || 'live'} · ≈${minutesLeft} min restantes`;
    return `En cours · ${r.statusDetail || 'live'} — probabilité recalculée en direct`;
  }
  if (r.phase === 'pre') return 'Pas encore commencé — probabilité initiale';
  return 'Statut indisponible — probabilité initiale conservée';
}

export async function POST(req: Request) {
  // Task 21-c : anti-abus — 15 req/min/IP (une évaluation déclenche un
  // fan-out ESPN borné : on borne aussi la FRÉQUENCE). Généreux : 1 éval
  // manuelle par coupon, 15/min laisse une large marge.
  const rl = rateLimit(req, 'cashout', 15, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: `Trop de requêtes, réessaie dans ${rl.retryAfterSec} s` },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } }
    );
  }

  let body: { legs?: CashoutLeg[]; stake?: number; offered?: number; totalOdds?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'JSON invalide' }, { status: 400 });
  }

  const offered = Number(body.offered);
  if (!Number.isFinite(offered) || offered < 0) {
    return NextResponse.json({ error: 'Prix de rachat invalide.' }, { status: 400 });
  }
  const stake = Number(body.stake);
  if (!Number.isFinite(stake) || stake <= 0) {
    return NextResponse.json({ error: 'Mise invalide.' }, { status: 400 });
  }
  const totalOdds = Number(body.totalOdds);
  if (!Number.isFinite(totalOdds) || totalOdds <= 1) {
    return NextResponse.json({ error: 'Cote totale du coupon manquante.' }, { status: 400 });
  }

  // Normalisation des jambes (prob requise : c'est l'ancrage du recalcul live)
  const legs: CashoutLeg[] = [];
  for (const l of body.legs ?? []) {
    if (!l || typeof l.matchId !== 'string' || l.matchId === '') continue;
    const matchDate = normalizeDateKey(l.matchDate);
    if (!matchDate) continue;
    if (!Number.isFinite(Number(l.prob)) || Number(l.prob) <= 0) continue;
    legs.push({
      matchId: l.matchId,
      leagueCode: typeof l.leagueCode === 'string' ? l.leagueCode.trim() : '',
      matchDate,
      market: typeof l.market === 'string' ? l.market : '',
      pick: typeof l.pick === 'string' ? l.pick : '',
      prob: Math.min(1, Math.max(0.001, Number(l.prob))),
      homeName: typeof l.homeName === 'string' ? l.homeName : undefined,
      awayName: typeof l.awayName === 'string' ? l.awayName : undefined,
    });
  }
  if (legs.length === 0) {
    return NextResponse.json({ error: 'Aucune jambe exploitable dans ce coupon.' }, { status: 400 });
  }
  // Task 19-a : borne anti-débordement — le fan-out ESPN = 1 scoreboard par
  // (ligue,date) ×2 feuilles (J puis J−1). Sans plafond, un corps malveillant
  // (ou corrompu) de milliers de jambes déclencherait un fetch-storm. Un vrai
  // combiné n'a jamais approché 20 jambes : 50 laisse une marge confortable.
  if (legs.length > 50) {
    return NextResponse.json({ error: 'Coupon trop grand (50 jambes maximum).' }, { status: 400 });
  }

  // ---- États ESPN (scoreboard groupés par ligue+date, cache serveur 1 min) ----
  const groups = new Map<string, CashoutLeg[]>();
  for (const leg of legs) {
    if (!leg.leagueCode) continue;
    const key = `${leg.leagueCode}|${leg.matchDate}`;
    const g = groups.get(key);
    if (g) g.push(leg);
    else groups.set(key, [leg]);
  }

  const boards = new Map<string, Map<string, EventState>>();
  const loadBoard = async (leagueCode: string, dateISO: string, target: Map<string, EventState>): Promise<void> => {
    try {
      const board = await fetchScoreboard(leagueCode, dateISO);
      if (!board) return;
      for (const ev of board.events) {
        if (target.has(ev.id)) continue;
        target.set(ev.id, {
          status: ev.status,
          statusDetail: ev.statusDetail,
          completed: ev.completed,
          homeScore: ev.home?.score ?? null,
          awayScore: ev.away?.score ?? null,
          homeName: ev.home?.team?.displayName ?? '',
          awayName: ev.away?.team?.displayName ?? '',
          date: ev.date,
          event: ev,
        });
      }
    } catch {
      // ligue ignorée (réseau/timeout) → phase unknown pour ces jambes
    }
  };
  // Task 21-c : charge réseau ESPN bornée — le plafond 50 jambes ne limite
  // PAS la concurrence : un coupon réparti sur beaucoup de couples
  // (ligue,date) lançait autant d'appels scoreboard SIMULTANÉS (Promise.all).
  // mapWithConcurrency (Task 18-a) borne le fan-out à 4 groupes en vol,
  // chaque groupe restant un 1-2 fetchs (feuille J + repli J−1) — ordre et
  // résultat identiques (chaque worker écrit dans son propre byId).
  await mapWithConcurrency(
    Array.from(groups.entries()),
    4,
    async ([key, groupLegs]) => {
      const [leagueCode, dateISO] = key.split('|');
      const byId = new Map<string, EventState>();
      await loadBoard(leagueCode, dateISO, byId);
      // Task 19-a (finding ②) : un match à 00h-04h UTC est classé par ESPN
      // sur la feuille scoreboard de la veille (regroupement heure US Eastern)
      // → sans ce 2e passage, le recalc live et le verdict restent « unknown »
      // exactement pour les matchs nocturnes. Fetch en cache 10 min : coût borné.
      if (groupLegs.some((leg) => !byId.has(leg.matchId))) {
        const prevDate = new Date(Date.parse(`${dateISO}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
        await loadBoard(leagueCode, prevDate, byId);
      }
      boards.set(key, byId);
    }
  );

  // ---- Rapport par jambe ----
  const reports: LegReport[] = legs.map((leg) => {
    const key = leg.leagueCode ? `${leg.leagueCode}|${leg.matchDate}` : '';
    const ev = key ? boards.get(key)?.get(leg.matchId) : undefined;

    const report: LegReport = {
      matchId: leg.matchId,
      market: leg.market,
      pick: leg.pick,
      phase: ev ? ev.status : 'unknown',
      statusDetail: ev?.statusDetail ?? '',
      score: ev && ev.homeScore != null && ev.awayScore != null ? `${ev.homeScore} - ${ev.awayScore}` : null,
      verdict: 'PENDING',
      pInit: leg.prob,
      pNow: leg.prob,
      note: '',
    };

    if (ev) {
      if (ev.status === 'post' || ev.completed) {
        // Terminé : verdict via le grading partagé (même vérité que le règlement)
        const verdict = gradeEvent(leg, ev.event);
        report.verdict = verdict.status;
        report.pNow = verdict.status === 'WIN' ? 1 : verdict.status === 'LOSE' ? 0 : leg.prob;
      } else if (ev.status === 'in' && ev.homeScore != null && ev.awayScore != null) {
        // En cours : proba live (score courant + horloge / temps restant)
        const state: LiveLegState = {
          phase: 'in',
          homeScore: ev.homeScore,
          awayScore: ev.awayScore,
          clock: ev.statusDetail,
          kickoffIso: ev.date,
        };
        // Task 19-a : « Match nul » doit passer 'draw' tel quel à legLiveProb,
        // sinon l'ancien mapping (draw → undefined) figeait la proba initiale —
        // une jambe nulle n'était JAMAIS recalculée en direct. Le repli
        // « nom non reconnu » de sideFor1x2 reste undefined (pas de recalcul
        // hasardeux sur un côté indéterminé).
        const pickIsDraw = leg.pick === 'Match nul';
        const side = pickIsDraw ? 'draw' : sideFor1x2(leg.pick, leg.homeName ?? ev.homeName, leg.awayName ?? ev.awayName);
        const sideArg = pickIsDraw ? ('draw' as const) : side === 'draw' ? undefined : side;
        report.pNow = legLiveProb({ market: leg.market, pick: leg.pick, prob: leg.prob }, state, sideArg);
      }
    }

    const rem = ev && ev.status === 'in' ? remainingFraction(ev.statusDetail, 'in', ev.date) : null;
    report.note = noteFor(report, rem != null ? Math.round(rem * 105) : null);
    return report;
  });

  // ---- Agrégation ----
  const anyLost = reports.some((r) => r.verdict === 'LOSE');
  const allWon = reports.every((r) => r.verdict === 'WIN');
  const jointProb = anyLost ? 0 : reports.reduce((acc, r) => acc * (r.verdict === 'WIN' ? 1 : r.pNow), 1);
  const fairValue = Math.round(stake * totalOdds * jointProb * 100) / 100;
  const edge = fairValue > 0 ? offered / fairValue - 1 : 0;

  let decision: Decision;
  let message: string;
  if (anyLost) {
    decision = 'LOST';
    message = 'Coupon déjà perdu : au moins une sélection est tombée. Aucun rachat n’a de sens — garde-le en historique.';
  } else if (allWon) {
    decision = 'WON';
    message = 'Toutes les sélections sont passées : encaisse ton gain chez le bookmaker, ne vend surtout pas.';
  } else if (offered >= fairValue) {
    decision = 'SELL';
    message = `Vends. Le bookmaker offre ${Math.round(edge * 100)} % de plus que la valeur estimée du coupon : c’est un bon prix.`;
  } else if (offered >= fairValue * 0.85) {
    decision = 'MAYBE';
    message = `Zone grise. L’offre est ${Math.round(Math.abs(edge) * 100)} % sous la valeur estimée — dans la marge d’incertitude du modèle. Vends seulement si tu préfères sécuriser.`;
  } else {
    decision = 'HOLD';
    message = `Garde ton coupon. L’offre est ${Math.round(Math.abs(edge) * 100)} % sous sa valeur estimée : le bookmaker te le rachète trop bon marché.`;
  }

  const response: CashoutResponse = {
    legs: reports,
    jointProb,
    fairValue,
    offered,
    edge,
    decision,
    message,
    asOf: Date.now(),
  };
  return NextResponse.json(response);
}
