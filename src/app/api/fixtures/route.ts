/**
 * VOLTRIX — API fixtures (lecture seule, côté serveur).
 *
 * GET /api/fixtures?date=YYYY-MM-DD
 *   → { foot, footPreds, mma, mmaPreds, computedAt }
 *
 * Retourne, pour la journée demandée :
 *   - foot      : MatchesResponse (mêmes groupes/sorties que le scan
 *                 local — réponse immédiate, aucun calcul moteur) ;
 *   - footPreds : Record<matchId, QuickPred> ;
 *   - mma       : MmaEventsResponse (fenêtre J-2..J+5 autour de la
 *                 date, combats hydratés : têtes + formes) ;
 *   - mmaPreds  : Record<fightId, MmaQuickPred>.
 *
 * La base est écrite uniquement par le job de pré-calcul (GitHub
 * Actions → scripts/precompute/run.ts) : cette route n'expose AUCUNE
 * écriture. Clé de connexion : variables d'environnement serveur —
 * rien n'est exposé au navigateur.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getLeague } from "@/lib/foot/leagues";
import type { MatchesResponse, QuickPred, LightMatch } from "@/lib/voltrix-types";
import type {
  MmaEventsResponse,
  MmaEventGroup,
  MmaFight,
  MmaQuickPred,
} from "@/lib/mma-types";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function sortLeagueGroup(
  a: MatchesResponse["leagues"][number],
  b: MatchesResponse["leagues"][number],
): number {
  const pa = getLeague(a.code)?.priority ?? 9;
  const pb = getLeague(b.code)?.priority ?? 9;
  if (pa !== pb) return pa - pb;
  return a.name.localeCompare(b.name, "fr");
}

export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get("date") ?? "";
  if (!DATE_RE.test(date)) {
    return NextResponse.json(
      { error: "Paramètre date invalide (YYYY-MM-DD attendu)." },
      { status: 400 },
    );
  }

  try {
    /* MMA : fenêtre autour de la date demandée — le bandeau de l'accueil
       navigue de J-2 à J+4, on couvre J-2..J+5 avec une marge. */
    const mmaFrom = new Date(`${date}T00:00:00Z`);
    mmaFrom.setUTCDate(mmaFrom.getUTCDate() - 2);
    const mmaTo = new Date(`${date}T00:00:00Z`);
    mmaTo.setUTCDate(mmaTo.getUTCDate() + 6);

    const [footRows, mmaRows] = await Promise.all([
      prisma.fixture.findMany({
        where: { sport: "foot", dayKeys: { has: date } },
        select: {
          data: true,
          predQuick: true,
          status: true,
          kickoff: true,
          computedAt: true,
        },
      }),
      prisma.fixture.findMany({
        where: {
          sport: "mma",
          kickoff: { gte: mmaFrom.toISOString(), lt: mmaTo.toISOString() },
        },
        select: { data: true, predQuick: true, eventMeta: true, computedAt: true },
      }),
    ]);

    /* ----- Football : reconstruction de MatchesResponse ----- */
    const groups = new Map<string, MatchesResponse["leagues"][number]>();
    const footPreds: Record<string, QuickPred> = {};
    let newestFoot = 0;

    for (const row of footRows) {
      const match = row.data as unknown as LightMatch;
      let g = groups.get(match.leagueCode);
      if (!g) {
        const def = getLeague(match.leagueCode);
        g = {
          code: match.leagueCode,
          name: def?.name ?? match.leagueName,
          shortName: def?.shortName ?? match.leagueCode.toUpperCase(),
          region: def?.region ?? "europe",
          matches: [],
        };
        groups.set(match.leagueCode, g);
      }
      g.matches.push(match);
      if (row.predQuick) footPreds[match.id] = row.predQuick as unknown as QuickPred;
      const at = row.computedAt instanceof Date ? row.computedAt.getTime() : 0;
      if (at > newestFoot) newestFoot = at;
    }

    const leagues = [...groups.values()].sort(sortLeagueGroup);
    for (const g of leagues) {
      g.matches.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    }

    const foot: MatchesResponse | null =
      leagues.length > 0
        ? {
            date,
            totalMatches: leagues.reduce((n, l) => n + l.matches.length, 0),
            leagues,
            scanMs: 0,
          }
        : null;

    /* ----- MMA : reconstruction de MmaEventsResponse ----- */
    const eventGroups = new Map<string, MmaEventGroup>();
    const mmaPreds: Record<string, MmaQuickPred> = {};
    let newestMma = 0;

    for (const row of mmaRows) {
      const fight = row.data as unknown as MmaFight;
      const meta = row.eventMeta as unknown as
        | (Omit<MmaEventGroup, "fights"> & { fights?: MmaFight[] })
        | null;
      const key = meta?.eventId ?? fight.eventName;
      let g = eventGroups.get(key);
      if (!g && meta) {
        g = {
          org: meta.org,
          orgShort: meta.orgShort,
          eventName: meta.eventName,
          region: meta.region,
          eventId: meta.eventId,
          eventDate: meta.eventDate,
          hasProspects: meta.hasProspects,
          fights: [],
        };
        eventGroups.set(key, g);
      }
      if (g) g.fights.push(fight);
      if (row.predQuick) mmaPreds[fight.id] = row.predQuick as unknown as MmaQuickPred;
      const at = row.computedAt instanceof Date ? row.computedAt.getTime() : 0;
      if (at > newestMma) newestMma = at;
    }

    for (const g of eventGroups.values()) {
      g.fights.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    }

    const mma: MmaEventsResponse | null =
      eventGroups.size > 0
        ? {
            date: new Date().toISOString(),
            totalFights: [...eventGroups.values()].reduce((n, g) => n + g.fights.length, 0),
            events: [...eventGroups.values()],
          }
        : null;

    return NextResponse.json(
      {
        foot,
        footPreds: Object.keys(footPreds).length > 0 ? footPreds : null,
        mma,
        mmaPreds: Object.keys(mmaPreds).length > 0 ? mmaPreds : null,
        computedAt: new Date(Math.max(newestFoot, newestMma) || Date.now()).toISOString(),
      },
      { headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=240" } },
    );
  } catch (e) {
    console.error("[api/fixtures]", e);
    return NextResponse.json(
      { error: "Base de pré-calcul indisponible." },
      { status: 503 },
    );
  }
}
