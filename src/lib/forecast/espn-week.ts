// ============================================================
// VOLTRIX bet — Prévisions hebdomadaires : scan ESPN d'une semaine
// Utilise le scoreboard ESPN par PLAGE de dates
//   /scoreboard?dates=YYYYMMDD-YYYYMMDD
// (1 appel par ligue pour toute la semaine au lieu de 7).
// Module indépendant : aucun fichier existant n'est modifié.
// ============================================================

import { LEAGUES } from '../leagues';
import { mapWithConcurrency } from '../cache';

const SITE = 'https://site.api.espn.com/apis/site/v2/sports/soccer';

export interface WeekEvent {
  matchId: string;
  league: string;
  leagueName: string;
  kickoff: string; // ISO
  espnState: 'pre' | 'in' | 'post';
  completed: boolean;
  statusName: string; // STATUS_SCHEDULED / STATUS_FINAL / STATUS_POSTPONED…
  statusDetail: string;
  homeTeamId: string | null;
  homeTeam: string;
  homeLogo: string | null;
  awayTeamId: string | null;
  awayTeam: string;
  awayLogo: string | null;
  homeScore: number | null;
  awayScore: number | null;
}

interface RawRangeEvent {
  id: string;
  date?: string;
  competitions?: Array<{
    date?: string;
    status?: { type?: { state?: string; name?: string; completed?: boolean; detail?: string; description?: string } };
    competitors?: Array<{
      homeAway?: string;
      score?: { value?: number } | string | number;
      team?: { id: string; displayName?: string; name?: string; logo?: string; logos?: Array<{ href: string; rel?: string[] }> };
    }>;
  }>;
  status?: { type?: { state?: string; name?: string; completed?: boolean; detail?: string; description?: string } };
}

interface RawRangeBoard {
  leagues?: Array<{ name?: string }>;
  events?: RawRangeEvent[];
}

function parseScore(v: unknown): number | null {
  if (typeof v === 'object' && v !== null && 'value' in (v as Record<string, unknown>)) {
    const n = (v as { value?: number }).value;
    return typeof n === 'number' && Number.isFinite(n) ? n : null;
  }
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(parseInt(v, 10))) return parseInt(v, 10);
  return null;
}

function logoOf(t: NonNullable<NonNullable<RawRangeEvent['competitions']>[0]['competitors']>[0]['team']): string | null {
  if (!t) return null;
  const arr = t.logos ?? [];
  return t.logo ?? arr.find((l) => l.rel?.includes('default'))?.href ?? arr[0]?.href ?? null;
}

/** Un fetch réseau avec 1 réessai (espacé) — échec → null (toléré). */
async function fetchRangeBoard(league: string, from: string, to: string): Promise<RawRangeBoard | null> {
  const url = `${SITE}/${league}/scoreboard?dates=${from}-${to}&limit=400`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
      if (res.ok) return (await res.json()) as RawRangeBoard;
    } catch {
      // réessai
    }
    if (attempt === 0) await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

/**
 * Récupère TOUS les événements ESPN des ligues fournies sur la plage
 * [from, to) — une seule requête par ligue (plage de dates ESPN).
 * Les échecs réseau par ligue sont tolérés (absents du résultat).
 */
export async function fetchWeekEvents(
  leagueCodes: string[],
  fromISO: string,
  toExclusiveISO: string
): Promise<WeekEvent[]> {
  const from = fromISO.replace(/-/g, '');
  const toExc = toExclusiveISO.replace(/-/g, ''); // ESPN inclut la borne : on passe dimanche+1 minimisé côté appelant
  const boards = await mapWithConcurrency(leagueCodes, 6, async (league) => {
    const b = await fetchRangeBoard(league, from, toExc);
    return { league, b };
  });

  const events: WeekEvent[] = [];
  for (const { league, b } of boards) {
    if (!b?.events) continue;
    const leagueName = b.leagues?.[0]?.name ?? league;
    for (const ev of b.events) {
      const comp = ev.competitions?.[0];
      const st = comp?.status?.type ?? ev.status?.type;
      const comps = comp?.competitors ?? [];
      const home = comps.find((c) => c.homeAway === 'home') ?? comps[0];
      const away = comps.find((c) => c.homeAway === 'away') ?? comps[1];
      if (!ev.id || !home?.team || !away?.team) continue;
      events.push({
        matchId: ev.id,
        league,
        leagueName,
        kickoff: comp?.date ?? ev.date ?? '',
        espnState: (st?.state as 'pre' | 'in' | 'post') ?? 'pre',
        completed: st?.completed ?? false,
        statusName: st?.name ?? '',
        statusDetail: st?.detail ?? st?.description ?? '',
        homeTeamId: home.team.id ?? null,
        homeTeam: home.team.displayName ?? home.team.name ?? '',
        homeLogo: logoOf(home.team),
        awayTeamId: away.team.id ?? null,
        awayTeam: away.team.displayName ?? away.team.name ?? '',
        awayLogo: logoOf(away.team),
        homeScore: parseScore(home.score),
        awayScore: parseScore(away.score),
      });
    }
  }
  return events;
}

/** Toutes les ligues du catalogue (aucune limite arbitraire — §2). */
export function allLeagueCodes(): string[] {
  return LEAGUES.map((l) => l.code);
}
