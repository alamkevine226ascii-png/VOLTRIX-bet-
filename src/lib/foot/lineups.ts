"use client";

/* ============================================================
   VOLTRIX app — Compositions football (100 % navigateur)
   Règle d'honnêteté (demande explicite) :
   1. Compositions RÉELLES du match si ESPN les a publiées
      (~20-40 min avant le coup d'envoi).
   2. Sinon : compositions du MATCH PRÉCÉDENT de chaque équipe,
      clairement étiquetées comme telles, en attente que ESPN
      publie les vraies.
   3. Jamais de formation ou de joueur inventé : sans donnée
      publiée ni match précédent exploitable, l'écran le dit.
   ============================================================ */

import { espnFetch } from "../mma/espn";
import { isValidLeagueCode } from "./leagues";
import { fetchTeamSchedule, SITE, type EspnScheduleGame } from "./espn";

/* ============================================================
   MOTEUR DÉDIÉ : compositions des équipes (football).
   Unique objectif : obtenir les VRAIES compos de chaque équipe.
   Séparé du moteur de prédiction (prediction.ts) et du moteur
   1er but (first-goal.ts).
   Chaîne d'honnêteté (aucune compo inventée) :
   1. compos PUBLIÉES par ESPN pour CE match — y compris en
      publication PARTIELLE (ESPN sort parfois une équipe avant
      l'autre : côté manquant → complété par le match précédent) ;
   2. sinon compos du MATCH PRÉCÉDENT de chaque équipe, étiquetées ;
   3. après le coup d'envoi, re-lecture des officielles (polling
      côté UI) ;
   4. rien d'exploitable → l'écran le dit, jamais de joueur forgé.
   ============================================================ */

const TTL_SUMMARY = 60 * 1000; // 60 s : les compos tombent avant le match
const TTL_PAST_SUMMARY = 6 * 60 * 60 * 1000; // 6 h : un match fini ne bouge plus

// ---------- Types publics ----------

export interface LineupPlayer {
  athleteId: string;
  name: string;
  shortName: string | null;
  jersey: string | null;
  position: string | null; // groupe G / D / M / F (pour le terrain)
  positionDetail: string | null; // abréviation granulaire ESPN (CD-L, AM-R…)
  formationPlace: number | null;
  starter: boolean;
}

export type LineupSource = "published" | "previous" | "none";

export interface TeamLineup {
  teamId: string;
  name: string;
  logo: string | null;
  formation: string | null;
  source: LineupSource;
  /* pour source === 'previous' : le match dont les compos sont montrées */
  previousLabel: string | null;
  starters: LineupPlayer[];
  bench: LineupPlayer[];
}

export interface MatchLineups {
  matchId: string;
  leagueCode: string;
  venue: { name: string | null; city: string | null; country: string | null };
  published: boolean;
  home: TeamLineup | null;
  away: TeamLineup | null;
}

// ---------- Types bruts ESPN ----------

interface RawSummary {
  header?: {
    competitions?: Array<{
      competitors?: Array<{
        homeAway?: string;
        team?: { id?: string; displayName?: string; logo?: string; logos?: Array<{ href?: string; rel?: string[] }> };
      }>;
    }>;
  };
  rosters?: RawRoster[];
  gameInfo?: {
    venue?: { fullName?: string; address?: { city?: string; country?: string } };
    attendance?: number;
  };
}

interface RawRoster {
  homeAway?: string;
  team?: { id?: string; displayName?: string };
  /* ESPN renvoie tantôt une chaîne ("4-2-3-1"), tantôt un objet {text} */
  formation?: string | { text?: string };
  roster?: Array<{
    starter?: boolean;
    jersey?: string | number;
    formationPlace?: string | number;
    position?: { abbreviation?: string; displayName?: string };
    athlete?: { id?: string; fullName?: string; displayName?: string; shortName?: string };
  }>;
}

function formationText(f: RawRoster["formation"]): string | null {
  if (typeof f === "string") return f;
  return f?.text ?? null;
}

/** Poste granulaire ESPN (CD-L, AM-R, LB…) → groupe G/D/M/F.
    Règle du dépôt VOLTRIX : un milieu défensif (DM) est un MILIEU. */
function posGroup(abbr: string | null | undefined): string {
  if (!abbr) return "M";
  const a = abbr.toUpperCase();
  if (a === "G" || a === "GK") return "G";
  if (a.startsWith("CD") || a === "LB" || a === "RB" || a === "D" || a.startsWith("DF")) return "D";
  if (
    a.startsWith("AM") ||
    a.startsWith("DM") ||
    a.startsWith("CM") ||
    a === "LM" ||
    a === "RM" ||
    a === "M" ||
    a.startsWith("MF")
  )
    return "M";
  if (a.startsWith("F") || a === "ST" || a.startsWith("W")) return "F";
  return "M";
}

function teamLogoOf(team: { logo?: string; logos?: Array<{ href?: string; rel?: string[] }> } | undefined): string | null {
  if (!team) return null;
  if (team.logo) return team.logo;
  const arr = team.logos ?? [];
  return arr.find((l) => l.rel?.includes("default"))?.href ?? arr[0]?.href ?? null;
}

function mapRosterTeam(
  r: RawRoster | undefined,
  fallbackName: string,
  fallbackLogo: string | null,
  source: LineupSource,
  previousLabel: string | null,
): TeamLineup | null {
  if (!r) return null;
  const entries = r.roster ?? [];
  if (entries.length === 0) return null;
  const players: LineupPlayer[] = entries.map((p) => ({
    athleteId: p.athlete?.id ?? "",
    name: p.athlete?.fullName ?? p.athlete?.displayName ?? "Joueur",
    shortName: p.athlete?.shortName ?? null,
    jersey: p.jersey != null ? String(p.jersey) : null,
    position: posGroup(p.position?.abbreviation),
    positionDetail: p.position?.abbreviation ?? null,
    formationPlace:
      p.formationPlace != null && !Number.isNaN(Number(p.formationPlace))
        ? Number(p.formationPlace)
        : null,
    starter: p.starter === true,
  }));
  const byPlace = (a: LineupPlayer, b: LineupPlayer) =>
    (a.formationPlace ?? 99) - (b.formationPlace ?? 99) || (a.jersey ?? "99").localeCompare(b.jersey ?? "99");
  const byJersey = (a: LineupPlayer, b: LineupPlayer) =>
    (a.jersey ?? "99").localeCompare(b.jersey ?? "99", "fr", { numeric: true });
  return {
    teamId: r.team?.id ?? "",
    name: r.team?.displayName ?? fallbackName,
    logo: fallbackLogo,
    formation: formationText(r.formation),
    source,
    previousLabel,
    starters: players.filter((p) => p.starter).sort(byPlace),
    bench: players.filter((p) => !p.starter).sort(byJersey),
  };
}

/** Résumé brut d'un événement (cache court avant match, long après). */
async function fetchSummary(matchId: string, leagueCode: string, matchDate?: string): Promise<RawSummary | null> {
  if (!isValidLeagueCode(leagueCode) || !/^\d{1,64}$/.test(matchId)) return null;
  const isPast = matchDate ? new Date(matchDate).getTime() < Date.now() - 3 * 60 * 60 * 1000 : false;
  return espnFetch<RawSummary>(`${SITE}/${leagueCode}/summary?event=${matchId}`, {
    cacheKey: `foot:summary:${leagueCode}:${matchId}`,
    ttlMs: isPast ? TTL_PAST_SUMMARY : TTL_SUMMARY,
  }).catch(() => null);
}

/** Compositions publiées par ESPN pour ce match. Gère la publication
 *  PARTIELLE : ESPN sort parfois le roster d'une équipe avant l'autre —
 *  chaque côté est résolu séparément (roster introuvable → côté null,
 *  complété par le match précédent par l'appelant). Le rapprochement
 *  se fait par ID d'équipe du header (le plus fiable), puis par
 *  homeAway, jamais par simple position de liste. */
async function fetchPublishedLineups(
  matchId: string,
  leagueCode: string,
  matchDate?: string,
): Promise<MatchLineups | null> {
  const raw = await fetchSummary(matchId, leagueCode, matchDate);
  if (!raw?.header?.competitions?.length) return null;
  const comp = raw.header.competitions[0];
  const compTeams = comp.competitors ?? [];
  const homeComp = compTeams.find((c) => c.homeAway === "home") ?? compTeams[0];
  const awayComp = compTeams.find((c) => c.homeAway === "away") ?? compTeams[1];
  const homeId = homeComp?.team?.id ?? null;
  const awayId = awayComp?.team?.id ?? null;
  const rosters = raw.rosters ?? [];

  /* rapprochement roster ↔ équipe : 1) par id d'équipe, 2) par homeAway */
  const rosterFor = (teamId: string | null, side: "home" | "away"): RawRoster | undefined =>
    (teamId ? rosters.find((r) => r.team?.id === teamId) : undefined) ??
    rosters.find((r) => r.homeAway === side) ??
    (side === "home" ? rosters[0] : rosters[1]);

  const homeRoster = rosterFor(homeId, "home");
  const awayRoster = rosterFor(awayId, "away");
  if (!homeRoster && !awayRoster) return null;

  const venue = raw.gameInfo?.venue;
  const home = mapRosterTeam(
    homeRoster,
    homeComp?.team?.displayName ?? "Domicile",
    teamLogoOf(homeComp?.team),
    "published",
    null,
  );
  const away = mapRosterTeam(
    awayRoster,
    awayComp?.team?.displayName ?? "Extérieur",
    teamLogoOf(awayComp?.team),
    "published",
    null,
  );
  const published = !!((home?.starters.length ?? 0) > 0 || (away?.starters.length ?? 0) > 0);
  if (!published) return null;

  return {
    matchId,
    leagueCode,
    venue: {
      name: venue?.fullName ?? null,
      city: venue?.address?.city ?? null,
      country: venue?.address?.country ?? null,
    },
    published: true,
    home,
    away,
  };
}

/** Dernier match TERMINÉ d'une équipe avant une date (depuis son calendrier ESPN). */
function lastCompletedBefore(schedule: EspnScheduleGame[], beforeMs: number): EspnScheduleGame | null {
  const done = schedule
    .filter((g) => g.completed && g.teamScore != null && g.opponentScore != null)
    .filter((g) => new Date(g.date).getTime() < beforeMs)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  return done[0] ?? null;
}

function labelOfGame(g: EspnScheduleGame): string {
  const d = new Date(g.date);
  const adv = g.opponentName ?? "";
  return `${d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" })} · ${g.homeAway === "home" ? "vs" : "@"} ${adv} (${g.teamScore}-${g.opponentScore})`;
}

/**
 * Compositions d'un match, avec repli honnête :
 * publiées si disponibles (publication partielle acceptée : les côtés
 * manquants sont complétés par le match précédent de L'ÉQUIPE concernée),
 * sinon celles du match précédent de chaque équipe.
 */
export async function loadMatchLineups(
  matchId: string,
  leagueCode: string,
  ctx: {
    matchDate: string;
    homeTeamId: string;
    awayTeamId: string;
    homeName: string;
    awayName: string;
    homeLogo: string | null;
    awayLogo: string | null;
  },
): Promise<MatchLineups | null> {
  /* 1. compos réelles si publiées (même partiellement) */
  const published = await fetchPublishedLineups(matchId, leagueCode, ctx.matchDate);

  /* 2. côtés manquants → compos du match précédent de CHAQUE équipe */
  const beforeMs = new Date(ctx.matchDate).getTime();
  const seasons = uniqueSeasons(ctx.matchDate, leagueCode);
  const sides = await Promise.all(
    (["home", "away"] as const).map(async (side) => {
      const publishedSide = published?.[side] ?? null;
      if (publishedSide && publishedSide.starters.length > 0) return publishedSide;

      const teamId = side === "home" ? ctx.homeTeamId : ctx.awayTeamId;
      const name = side === "home" ? ctx.homeName : ctx.awayName;
      const logo = side === "home" ? ctx.homeLogo : ctx.awayLogo;
      const schedule = await fetchTeamSchedule(leagueCode, teamId, seasons).catch(
        () => [] as EspnScheduleGame[],
      );
      const prev = lastCompletedBefore(schedule, beforeMs);
      if (!prev) return publishedSide; // rien de mieux → garder tel quel
      const raw = await fetchSummary(prev.eventId, leagueCode, prev.date);
      if (!raw) return publishedSide;
      /* rapprochement par id d'équipe d'abord, homeAway ensuite */
      const roster = (raw.rosters ?? []).find((r) => r.team?.id === teamId) ??
        (raw.rosters ?? []).find((r) => r.homeAway === (prev.homeAway === "home" ? "home" : "away"));
      return mapRosterTeam(roster, name, logo, "previous", labelOfGame(prev)) ?? publishedSide;
    }),
  );

  const [home, away] = sides;
  if (!home && !away) return null;
  const anyPublished = (home?.source ?? away?.source) === "published";
  return {
    matchId,
    leagueCode,
    venue: published?.venue ?? { name: null, city: null, country: null },
    published: anyPublished,
    home,
    away,
  };
}

/* ---------- saisons à interroger (courante + précédente) ---------- */

const CALENDAR_YEAR_LEAGUES: ReadonlySet<string> = new Set([
  "usa.1",
  "usa.nwsl",
  "bra.1",
  "bra.2",
  "arg.1",
  "jpn.1",
  "nor.1",
  "swe.1",
  "fin.1",
  "irl.1",
]);

function uniqueSeasons(matchDate: string, leagueCode: string): number[] {
  const d = new Date(matchDate);
  const year = d.getUTCFullYear();
  const season = CALENDAR_YEAR_LEAGUES.has(leagueCode)
    ? year
    : d.getUTCMonth() + 1 >= 7
      ? year
      : year - 1;
  return [season - 1, season].filter((s) => s > 0);
}
