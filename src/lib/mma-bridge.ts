"use client";

/* ============================================================
   VOLTRIX app — Bridge MMA : données réelles ESPN → types UI
   S'appuie sur le moteur porté du dépôt Mma-VOLTRIX
   (src/lib/mma/ : espn, analysis, prediction, loaders).
   Tout est calculé dans le navigateur ; chaque champ est soit
   observé chez ESPN, soit dérivé et étiqueté comme tel.
   ============================================================ */

import {
  ACTIVE_ORGS,
  getAthlete,
  getAthleteHistory,
  getScoreboard,
  mapLimited,
  type ScoreboardEventDTO,
} from "./mma/espn";
import {
  isPlaceholderFighter,
  normalizeName,
  parseRecord,
  weightClassFr,
  LEAGUE_TO_ORG,
} from "./mma/types";
import { computeExpressPrediction } from "./mma/prediction";
import { loadFightAnalysis } from "./mma/loaders";
import {
  fetchUfcRoundPrior,
  fuseRoundDistribution,
  peekRoundPrior,
  personalRoundRates,
} from "./mma/rounds";
import type { DerivedResult, FightAnalysis, FighterView } from "./mma/analysis";
import type { PredictionView } from "./mma/prediction";
import type {
  MmaEventGroup,
  MmaEventsResponse,
  MmaFight,
  MmaFighter,
  MmaListItemFighter,
  MmaMethodMix,
  MmaQuickPred,
} from "./mma-types";

/* ============================================================
   Arènes (image du héros du détail combat)
   ============================================================ */

const ARENAS: Array<{ keys: string[]; img: string }> = [
  { keys: ["t-mobile", "tmobile"], img: "/arenas/tmoArena.jpg" },
  { keys: ["madison", "msg"], img: "/arenas/msg.jpg" },
  { keys: ["apex"], img: "/arenas/octagon.jpg" },
];

export const FALLBACK_ARENA = "/arenas/octagon.jpg";

export function arenaImageFor(venueName?: string | null): string {
  const n = (venueName ?? "").toLowerCase();
  for (const a of ARENAS) {
    if (a.keys.some((k) => n.includes(k))) return a.img;
  }
  return FALLBACK_ARENA;
}

/* ============================================================
   Registre des combats vus (contexte pour la page détail)
   ============================================================ */

interface FightRef {
  league: string;
  espnEventId: string;
  espnCompetitionId: string;
  org: string;
  eventName: string;
  eventDate: string;
  venue: { name: string | null; city: string | null; country: string | null };
  status: "pre" | "in" | "post";
  statusDetail: string;
  fighters: Array<{
    espnAthleteId: string;
    fullName: string;
    recordAtFight: string | null;
    isWinner: boolean | null;
    order: number | null;
  }>;
}

const fightRefs = new Map<string, FightRef>();

/* ============================================================
   Helpers de mapping
   ============================================================ */

function shortNameOf(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  return parts[parts.length - 1];
}

const WC_SHORT: Array<{ keys: string[]; short: string }> = [
  { keys: ["heavyweight"], short: "HW" },
  { keys: ["light heavyweight"], short: "LHW" },
  { keys: ["middleweight"], short: "MW" },
  { keys: ["welterweight"], short: "WW" },
  { keys: ["lightweight"], short: "LW" },
  { keys: ["featherweight"], short: "FW" },
  { keys: ["bantamweight"], short: "BW" },
  { keys: ["flyweight"], short: "FLW" },
  { keys: ["strawweight"], short: "SW" },
];

function weightClassShortOf(weightClass: string | null): string | null {
  if (!weightClass) return null;
  const n = weightClass.toLowerCase();
  const women = n.includes("women's");
  const hit = WC_SHORT.find((w) => n.includes(w.keys[0]));
  if (!hit) return null;
  return women ? `W${hit.short}` : hit.short;
}

function statusToApp(s: string): "pre" | "in" | "post" {
  if (s === "EN_COURS") return "in";
  if (s === "TERMINE" || s === "ANNULE" || s === "REPORTE") return "post";
  return "pre";
}

function statusDetailFr(status: string, rawStatus: string | null): string {
  switch (status) {
    case "EN_COURS":
      return "En cours";
    case "TERMINE":
      return "Terminé";
    case "ANNULE":
      return "Annulé";
    case "REPORTE":
      return "Reporté";
    case "CONFIRME":
      return "Confirmé";
    default:
      return rawStatus === "in" ? "En cours" : "Programmé";
  }
}

function recText(r: { wins: number | null; losses: number | null; draws: number | null }): string {
  if (r.wins == null || r.losses == null) return "—";
  return r.draws ? `${r.wins}-${r.losses}-${r.draws}` : `${r.wins}-${r.losses}`;
}
export { recText };

/* ============================================================
   Événements UFC à venir — catégories de l'accueil
   (directive produit 2026-11-09 : UFC uniquement, un événement
   = une catégorie : UFC 334, UFC FN 21.11, ... + « Combats
   perspectifs » = adversaires non annoncés, données ESPN réelles)
   ============================================================ */

/** Clé de jour local (YYYY-MM-DD, fuseau du navigateur). */
export function localDateKey(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Libellé de catégorie : « UFC 334 » / « UFC FN 21.11 » / « DWCS ». */
export function eventCategoryLabel(eventName: string, eventDate: string): string {
  const d = new Date(eventDate);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const n = eventName;
  const numbered = n.match(/^UFC\s+(\d{3,4})/);
  if (numbered) return `UFC ${numbered[1]}`;
  if (/fight night/i.test(n)) return `UFC FN ${dd}.${mm}`;
  if (/contender/i.test(n)) return "DWCS";
  if (/road to ufc/i.test(n)) return "Road to UFC";
  return n.split(":")[0].trim().slice(0, 18);
}

/**
 * Charge les événements UFC à venir (fenêtre : avant-veille -> +120 jours,
 * pour couvrir tout le bandeau de dates de l'accueil qui va de J-2 à J+4).
 * Les combats sont ensuite filtrés côté écran selon la date sélectionnée :
 * ce qui est affiché sous un jour J a bien lieu le jour J (heure locale).
 * Chaque événement forme une catégorie ; les combats à adversaire non
 * annoncé (TBD ESPN) alimentent en outre la catégorie « Combats
 * perspectifs ». Les événements d'hier terminés restent visibles
 * (résultats), puis disparaissent au fil des jours.
 */
export async function loadMmaUpcoming(): Promise<MmaEventsResponse> {
  const now = new Date();
  /* avant-veille : le bandeau de dates de l'accueil permet de remonter
     à J-2, on marge à J-3 pour couvrir tous les fuseaux horaires. */
  const from = new Date(now.getTime() - 3 * 86400000);
  const to = new Date(now.getTime() + 120 * 86400000);

  const boards = await mapLimited(ACTIVE_ORGS, 2, (org) =>
    getScoreboard(org, from, to).catch(() => [] as ScoreboardEventDTO[]),
  );
  const events = boards
    .flat()
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  if (events.length === 0 && ACTIVE_ORGS.length > 0) {
    // Aucun événement UFC dans la fenêtre : réseau bloqué ? On remonte
    // l'erreur pour le bouton Réessayer plutôt que d'afficher « vide ».
    throw new Error(
      "Impossible de joindre les serveurs ESPN depuis votre navigateur (réseau indisponible ou temporairement bloqué). Réessayez dans un instant.",
    );
  }

  const groups: MmaEventGroup[] = [];
  const prospectFights: MmaFight[] = [];

  for (const ev of events) {
    const org = (LEAGUE_TO_ORG[ev.league] ?? ev.organization).toUpperCase();
    /* détails par combat : catégorie + rounds + résultat (core API, cache 1 h) */
    const { loadEventDetail } = await import("./mma/loaders");
    const detail = await loadEventDetail(ev).catch(() => null);

    const fights: MmaFight[] = [];
    let hasProspects = false;
    ev.fights.forEach((f, idx) => {
      const fd = detail?.fights[idx] ?? null;
      const dStatus = fd?.status ?? f.status;
      const a = f.fighters[0];
      const b = f.fighters[1];
      if (!a || !b) return;

      const placeholderA = isPlaceholderFighter(a.fullName);
      const placeholderB = isPlaceholderFighter(b.fullName);
      const prospect = placeholderA || placeholderB;
      if (prospect) hasProspects = true;

      const toListItem = (
        x: typeof a,
        placeholder: boolean,
      ): MmaListItemFighter => ({
        id: x.externalId,
        espnAthleteId: x.espnAthleteId,
        name: placeholder ? "Adversaire à confirmer" : x.fullName,
        shortName: placeholder ? "TBD" : shortNameOf(x.fullName),
        headshotUrl: null,
        flagUrl: null,
        record: placeholder
          ? { wins: null, losses: null, draws: null }
          : {
              wins: parseRecord(x.recordAtFight)?.wins ?? null,
              losses: parseRecord(x.recordAtFight)?.losses ?? null,
              draws: parseRecord(x.recordAtFight)?.draws ?? null,
            },
        form: null,
        isWinner: placeholder ? null : x.isWinner,
      });

      const winner = prospect ? null : f.fighters.find((x) => x.isWinner === true);
      const method =
        fd?.resultDetail ??
        (fd?.resultMethod === "KO_TKO"
          ? "KO/TKO"
          : fd?.resultMethod === "SOUMISSION"
            ? "Soumission"
            : fd?.resultMethod === "DECISION"
              ? "Décision"
              : null);

      const fight: MmaFight = {
        id: f.externalId,
        org,
        orgShort: ev.shortName ?? ev.name,
        eventName: ev.name,
        weightClass: fd?.weightClassFr ?? fd?.weightClass ?? null,
        weightClassShort: weightClassShortOf(fd?.weightClass ?? null),
        rounds: fd?.scheduledRounds ?? null,
        cardSegment: fd?.cardSegment ?? null,
        date: f.date,
        status: statusToApp(dStatus),
        statusDetail: statusDetailFr(dStatus, f.rawStatus),
        fighterA: toListItem(a, placeholderA),
        fighterB: toListItem(b, placeholderB),
        winner:
          winner == null
            ? null
            : winner.externalId === a.externalId
              ? "A"
              : "B",
        method: prospect ? null : method,
        venue: {
          name: ev.venueName,
          city: ev.city,
          country: ev.country,
        },
        prospect,
      };
      fights.push(fight);
      if (prospect) prospectFights.push(fight);

      /* registre pour la navigation vers le détail */
      fightRefs.set(f.externalId, {
        league: ev.league,
        espnEventId: ev.espnEventId,
        espnCompetitionId: f.espnCompetitionId,
        org,
        eventName: ev.name,
        eventDate: ev.date,
        venue: { name: ev.venueName, city: ev.city, country: ev.country },
        status: statusToApp(dStatus),
        statusDetail: statusDetailFr(dStatus, f.rawStatus),
        fighters: f.fighters.map((x) => ({
          espnAthleteId: x.espnAthleteId,
          fullName: x.fullName,
          recordAtFight: x.recordAtFight,
          isWinner: x.isWinner,
          order: x.corner,
        })),
      });
    });

    if (fights.length > 0) {
      groups.push({
        org,
        orgShort: ev.shortName ?? org,
        eventName: ev.name,
        region: ev.country ?? "",
        fights,
        eventId: ev.espnEventId,
        eventDate: ev.date,
        hasProspects,
      });
    }
  }

  /* catégorie « Combats perspectifs » : adversaires non annoncés */
  if (prospectFights.length > 0) {
    groups.push({
      org: "UFC",
      orgShort: "Perspectifs",
      eventName: "Combats perspectifs",
      region: "",
      fights: prospectFights,
      eventId: "prospect",
      eventDate: prospectFights[0]?.date ?? new Date().toISOString(),
      hasProspects: true,
    });
  }

  return {
    date: localDateKey(now.toISOString()),
    totalFights: groups.reduce(
      (n, g) => n + (g.eventId === "prospect" ? 0 : g.fights.length),
      0,
    ),
    events: groups,
  };
}

/** Enrichit les combats avec les têtes des combattants (profils ESPN, cache 24 h). */
export async function hydrateMmaHeadshots(res: MmaEventsResponse): Promise<MmaEventsResponse> {
  const ids = new Set<string>();
  for (const g of res.events)
    for (const f of g.fights) {
      ids.add(f.fighterA.espnAthleteId);
      ids.add(f.fighterB.espnAthleteId);
    }
  const profiles = await mapLimited([...ids], 4, (id) =>
    getAthlete(id)
      .then((p) => [id, p] as const)
      .catch(() => [id, null] as const),
  );
  const byId = new Map(profiles);
  const events = res.events.map((g) => ({
    ...g,
    fights: g.fights.map((f) => ({
      ...f,
      fighterA: {
        ...f.fighterA,
        headshotUrl: byId.get(f.fighterA.espnAthleteId)?.imageUrl ?? null,
        flagUrl: byId.get(f.fighterA.espnAthleteId)?.flagUrl ?? null,
      },
      fighterB: {
        ...f.fighterB,
        headshotUrl: byId.get(f.fighterB.espnAthleteId)?.imageUrl ?? null,
        flagUrl: byId.get(f.fighterB.espnAthleteId)?.flagUrl ?? null,
      },
    })),
  }));
  return { ...res, events };
}

/** Enrichit les combats avec les formes récentes + pronos express (historique par combattant, cache 24 h). */
export async function hydrateMmaForms(
  res: MmaEventsResponse,
): Promise<{ res: MmaEventsResponse; preds: Record<string, MmaQuickPred> }> {
  const ids = new Set<string>();
  for (const g of res.events)
    for (const f of g.fights) {
      ids.add(f.fighterA.espnAthleteId);
      ids.add(f.fighterB.espnAthleteId);
    }

  /* formes : 5 derniers résultats, plus récent d'abord ("W,W,L,W,W") */
  const histories = await mapLimited([...ids], 3, async (id) => {
    try {
      const h = await getAthleteHistory(id);
      const sorted = [...h].sort(
        (a, b) => new Date(b.eventDate).getTime() - new Date(a.eventDate).getTime(),
      );
      const last = sorted
        .filter((x) => ["W", "L", "D", "NC"].includes(x.result))
        .slice(0, 5)
        .map((x) => x.result)
        .join(",");
      return [id, last || null] as const;
    } catch {
      return [id, null] as const;
    }
  });
  const formById = new Map(histories);
  const toDisplayForm = (s: string | null) =>
    s ? s.split(",").filter(Boolean).reverse().join("") : null;

  const preds: Record<string, MmaQuickPred> = {};
  const events = res.events.map((g) => ({
    ...g,
    fights: g.fights.map((f) => {
      const formA = toDisplayForm(formById.get(f.fighterA.espnAthleteId) ?? null);
      const formB = toDisplayForm(formById.get(f.fighterB.espnAthleteId) ?? null);
      const nf = {
        ...f,
        fighterA: { ...f.fighterA, form: formA },
        fighterB: { ...f.fighterB, form: formB },
      };

      /* prono express (palmarès + forme) — uniquement pour les combats à venir */
      if (nf.status === "pre") {
        const lastA = formById.get(nf.fighterA.espnAthleteId) ?? null;
        const lastB = formById.get(nf.fighterB.espnAthleteId) ?? null;
        const ex = computeExpressPrediction(
          {
            fullName: nf.fighterA.name,
            wins: nf.fighterA.record.wins,
            losses: nf.fighterA.record.losses,
            draws: nf.fighterA.record.draws,
            lastResults: lastA,
            recordAtFight: null,
          },
          {
            fullName: nf.fighterB.name,
            wins: nf.fighterB.record.wins,
            losses: nf.fighterB.record.losses,
            draws: nf.fighterB.record.draws,
            lastResults: lastB,
            recordAtFight: null,
          },
        );
        if (ex.available) {
          const pA = ex.favoriteName === nf.fighterA.name ? (ex.probability ?? 50) / 100 : 1 - (ex.probability ?? 50) / 100;
          const conf =
            ex.level === "avantage net" ? 4 : ex.level === "avantage léger" ? 3 : 2;
          preds[nf.id] = {
            fightId: nf.id,
            available: true,
            favorite: pA >= 0.5 ? "A" : "B",
            probs: { a: pA, b: 1 - pA },
            level: ex.level,
            basis: ex.basis,
            confidence: conf,
            confidenceLabel: ex.level,
          };
        } else {
          preds[nf.id] = {
            fightId: nf.id,
            available: false,
            favorite: null,
            probs: { a: 0.5, b: 0.5 },
            level: "indécis",
            basis: "données insuffisantes",
            confidence: 1,
            confidenceLabel: "Limitée",
          };
        }
      }
      return nf;
    }),
  }));

  return { res: { ...res, events }, preds };
}

/* ============================================================
   Détail d'un combat : analyse complète (moteur voltrix-mma-v1)
   ============================================================ */

/** Retrouve le contexte d'un combat : registre en mémoire, sinon re-scan du scoreboard (± 60 jours). */
async function resolveFightRef(fightId: string): Promise<FightRef | null> {
  const hit = fightRefs.get(fightId);
  if (hit) return hit;

  const cid = fightId.split(":").pop() ?? "";
  const now = new Date();
  const from = new Date(now.getTime() - 60 * 86400000);
  const to = new Date(now.getTime() + 30 * 86400000);
  for (const org of ACTIVE_ORGS) {
    try {
      const events = await getScoreboard(org, from, to);
      for (const ev of events) {
        for (const f of ev.fights) {
          if (f.espnCompetitionId !== cid) continue;
          const ref: FightRef = {
            league: ev.league,
            espnEventId: ev.espnEventId,
            espnCompetitionId: f.espnCompetitionId,
            org: (LEAGUE_TO_ORG[ev.league] ?? ev.organization).toUpperCase(),
            eventName: ev.name,
            eventDate: ev.date,
            venue: { name: ev.venueName, city: ev.city, country: ev.country },
            status: statusToApp(f.status),
            statusDetail: statusDetailFr(f.status, f.rawStatus),
            fighters: f.fighters.map((x) => ({
              espnAthleteId: x.espnAthleteId,
              fullName: x.fullName,
              recordAtFight: x.recordAtFight,
              isWinner: x.isWinner,
              order: x.corner,
            })),
          };
          fightRefs.set(f.externalId, ref);
          return ref;
        }
      }
    } catch {
      /* organisation indisponible : on tente la suivante */
    }
  }
  return null;
}

function stanceFr(s: string | null): string {
  if (!s) return "";
  const n = s.toLowerCase();
  if (n.includes("southpaw")) return "Southpaw";
  if (n.includes("orthodox")) return "Orthodoxe";
  if (n.includes("switch")) return "Switch";
  return s;
}

function countryFr(view: FighterView): string | null {
  return view.nationality;
}

function toMmaFighter(view: FighterView): MmaFighter {
  const wins = view.record.wins;
  const ko = view.record.winsByKo;
  const sub = view.record.winsBySub;
  const dec =
    wins != null && ko != null && sub != null ? Math.max(0, wins - ko - sub) : null;
  const d = view.derived;
  return {
    id: view.externalId,
    espnAthleteId: view.externalId.split(":").pop() ?? "",
    name: view.fullName,
    shortName: shortNameOf(view.fullName),
    nickname: view.nickname,
    country: countryFr(view),
    headshotUrl: view.imageUrl,
    flagUrl: view.flagUrl,
    record: {
      wins: view.record.wins,
      losses: view.record.losses,
      draws: view.record.draws,
    },
    ranking: null, // ESPN ne publie pas le classement sur ces endpoints
    stance: stanceFr(view.stance),
    age: view.age,
    heightCm: view.heightCm,
    reachCm: view.reachCm,
    weightClass: view.weightClass ? (weightClassFr(view.weightClass) ?? view.weightClass) : null,
    fightingStyle: view.fightingStyle,
    koWins: ko,
    subWins: sub,
    decWins: dec,
    koLosses: view.record.tkoLosses,
    subLosses: view.record.submissionLosses,
    decLosses:
      view.record.losses != null &&
      view.record.tkoLosses != null &&
      view.record.submissionLosses != null
        ? Math.max(0, view.record.losses - view.record.tkoLosses - view.record.submissionLosses)
        : null,
    totalFights: view.totalFights,
    strikesLandedPerMin: view.stats?.sigStrikesLandedPerMin ?? null,
    strikingAccuracy: view.stats?.strikingAccuracy ?? null,
    strikesAbsorbedPerMin: d?.sigStrikesAbsorbedPerMin ?? null,
    takedownsPer15: view.stats?.takedownsPer15Min ?? null,
    takedownAccuracy: view.stats?.takedownAccuracy ?? null,
    takedownDefense: d?.takedownDefense ?? null,
    submissionAvgPer15: view.stats?.submissionsPer15Min ?? null,
    derivedWindow: d?.windowSize ?? null,
    /* forme : plus récent à DROITE (convention UI, cf. hydrateMmaForms) —
       lastResults est stocké plus récent d'abord, d'où l'inversion */
    form: view.lastResults.length > 0 ? view.lastResults.slice().reverse().join("") : null,
    lastResults: view.lastResults,
  };
}

/* ============================================================
   Méthodes de victoire & modèle de rounds — corrections audit
   2026-11-09 (agent B, points A2/A3/B1) :
   - byMethod : victoires du combattant FONDUES avec les méthodes de
     défaite de l'adversaire (records/0 ESPN). Triple complet ou rien :
     JAMAIS de renormalisation de taux partiels (une donnée manquante
     ne devient pas une certitude).
   - goesToDecision : decA + decB directement (l'ancien code
     multipliait DEUX FOIS par la probabilité de victoire et
     divisait ~par 2 la probabilité de décision).
   - rounds : rounds de fin RÉELS d'ESPN (status.period), collectés
     par la fenêtre dérivée de chaque combattant, fondus avec un
     prior UFC CALCULÉ (6 derniers événements terminés, cache 7 j).
     Les constantes 40/33/27 et 33/28/21/12/6 sont retirées.
   ============================================================ */

type MethodShares = { ko: number; sub: number; dec: number };

/** Répartition des VICTOIRES de f par méthode (triple complet ou null). */
function winShares(f: MmaFighter): MethodShares | null {
  const w = f.record.wins;
  if (w == null || w <= 0 || f.koWins == null || f.subWins == null) return null;
  const ko = f.koWins / w;
  const sub = f.subWins / w;
  return { ko, sub, dec: Math.max(0, 1 - ko - sub) };
}

/** Répartition des DÉFAITES de f par méthode (triple complet ou null). */
function lossShares(f: MmaFighter): MethodShares | null {
  const l = f.record.losses;
  if (l == null || l <= 0 || f.koLosses == null || f.subLosses == null) return null;
  const ko = f.koLosses / l;
  const sub = f.subLosses / l;
  return { ko, sub, dec: Math.max(0, 1 - ko - sub) };
}

/**
 * Parts de méthode pour « X bat Y » : comment X gagne (victoires)
 * croisé avec comment Y perd (défaites). Les deux signaux sont
 * moyennés quand ils existent tous les deux ; sinon le seul
 * disponible ; sinon null (aucune invention).
 */
function methodSharesFor(winner: MmaFighter, loser: MmaFighter): MethodShares | null {
  const w = winShares(winner);
  const l = lossShares(loser);
  if (w && l) {
    return { ko: (w.ko + l.ko) / 2, sub: (w.sub + l.sub) / 2, dec: (w.dec + l.dec) / 2 };
  }
  return w ?? l ?? null;
}

/* ---------- Mapping prédiction moteur → UI ---------- */

function roundModelNoteOf(priorSample: number | null): string {
  return priorSample != null
    ? `Rounds de fin réels collectés sur les derniers combats de chaque combattant (ESPN · status.period), ` +
        `fondus par rétrécissement bayésien avec un prior UFC calculé sur ${priorSample} combats terminés ` +
        `(6 derniers événements, cache local 7 jours).`
    : `Rounds de fin réels collectés sur les derniers combats de chaque combattant (ESPN · status.period). ` +
        `Le prior UFC de référence se construit en arrière-plan au premier affichage — réouvrez le combat dans un instant pour la version complète.`;
}

async function mapPrediction(
  pred: PredictionView,
  a: MmaFighter,
  b: MmaFighter,
  scheduledRounds: number | null,
  fightsA: DerivedResult["fights"] | null,
  fightsB: DerivedResult["fights"] | null,
) {
  const prior = peekRoundPrior();
  const note = roundModelNoteOf(prior?.fightsSampled ?? null);

  if (!pred.available || pred.probabilityA == null || pred.probabilityB == null) {
    return {
      available: false as const,
      unavailabilityReason: pred.unavailabilityReason,
      probs: { a: 0.5, b: 0.5 },
      favorite: null,
      marginLabel: null,
      confidence: 1,
      confidenceLabel: "Limitée",
      dimensionsUsed: 0,
      dimensionsTotal: pred.confidence?.dimensionsTotal ?? 0,
      missingDimensions: pred.confidence?.missing ?? [],
      method: null,
      byMethod: { a: { ko: null, sub: null, dec: null }, b: { ko: null, sub: null, dec: null } },
      roundFinish: [],
      goesToDecision: null,
      totalRoundsExpected: null,
      roundModelNote: note,
      roundBasis: null,
      recommendedBets: [],
      keyFactors: [],
      watchOuts: [],
      modelVersion: pred.model.version,
      notes: pred.model.notes,
    };
  }

  const pA = pred.probabilityA / 100;
  const pB = pred.probabilityB / 100;

  /* méthodes de victoire : victoires de l'un × défaites de l'autre */
  const sharesA = methodSharesFor(a, b);
  const sharesB = methodSharesFor(b, a);
  const byMethod = {
    a: sharesA ? { ko: pA * sharesA.ko, sub: pA * sharesA.sub, dec: pA * sharesA.dec } : { ko: null, sub: null, dec: null },
    b: sharesB ? { ko: pB * sharesB.ko, sub: pB * sharesB.sub, dec: pB * sharesB.dec } : { ko: null, sub: null, dec: null },
  };

  /* rounds personnalisés : taux réels par combattant, fusionnés */
  const rounds: 3 | 5 = scheduledRounds === 5 ? 5 : 3;
  const ratesA = personalRoundRates(fightsA, prior, rounds);
  const ratesB = personalRoundRates(fightsB, prior, rounds);
  const fused = fuseRoundDistribution(pA, ratesA, pB, ratesB, rounds);

  /* décision : priorité au modèle de rounds (fenêtre réelle + prior),
     repli sur la lecture carrière (byMethod), sinon indisponible. */
  let goesToDecision: number | null = null;
  if (fused) {
    goesToDecision = Math.min(0.95, Math.max(0.05, fused.decisionShare));
  } else if (byMethod.a.dec != null && byMethod.b.dec != null) {
    goesToDecision = Math.min(0.95, Math.max(0.05, byMethod.a.dec + byMethod.b.dec));
  }

  const roundFinish = fused
    ? fused.finishByRound.map((p, i) => ({ round: i + 1, prob: p }))
    : [];
  const totalRoundsExpected =
    fused && goesToDecision != null
      ? roundFinish.reduce((acc, r) => acc + r.round * r.prob, 0) + rounds * goesToDecision
      : null;

  /* lectures recommandées (informatives — aucune cote éditée) */
  const favName = pred.favoriteName ?? "";
  const recommended: Array<{ market: string; pick: string; prob: number; note: string }> = [];
  if (favName) {
    recommended.push({
      market: "Victoire",
      pick: favName,
      prob: Math.max(pA, pB),
      note: `${pred.marginLabel} — base : ${pred.model.factors.length} dimensions observées`,
    });
  }
  const scenarii: Array<{ label: string; p: number }> = [
    { label: `${a.shortName} par KO/TKO`, p: byMethod.a.ko ?? -1 },
    { label: `${a.shortName} par soumission`, p: byMethod.a.sub ?? -1 },
    { label: `${a.shortName} par décision`, p: byMethod.a.dec ?? -1 },
    { label: `${b.shortName} par KO/TKO`, p: byMethod.b.ko ?? -1 },
    { label: `${b.shortName} par soumission`, p: byMethod.b.sub ?? -1 },
    { label: `${b.shortName} par décision`, p: byMethod.b.dec ?? -1 },
  ].filter((s) => s.p >= 0);
  if (scenarii.length > 0) {
    const top = scenarii.sort((x, y) => y.p - x.p)[0];
    recommended.push({
      market: "Méthode",
      pick: top.label,
      prob: top.p,
      note: "Victoires du combattant fondues avec les méthodes de défaite de l'adversaire (palmarès ESPN)",
    });
  }
  if (goesToDecision != null) {
    recommended.push({
      market: "Distance",
      pick: goesToDecision >= 0.5 ? "Va jusqu'à la décision" : "Ne passe pas la distance",
      prob: goesToDecision >= 0.5 ? goesToDecision : 1 - goesToDecision,
      note: fused
        ? "Dérivé des rounds de fin réels des deux combattants (fenêtre 8 combats + prior UFC)"
        : "Dérivé de la répartition des victoires et défaites observées (carrière)",
    });
  }

  const conf = pred.confidence;
  const stars = conf ? (conf.score >= 70 ? 5 : conf.score >= 50 ? 4 : conf.score >= 35 ? 3 : 2) : 2;

  return {
    available: true as const,
    unavailabilityReason: null,
    probs: { a: pA, b: pB },
    favorite: pred.favorite,
    marginLabel: pred.marginLabel,
    confidence: stars,
    confidenceLabel: conf?.label ?? "Moyenne",
    dimensionsUsed: conf?.dimensionsUsed ?? 0,
    dimensionsTotal: conf?.dimensionsTotal ?? 0,
    missingDimensions: conf?.missing ?? [],
    method: pred.method,
    byMethod,
    roundFinish,
    goesToDecision,
    totalRoundsExpected,
    roundModelNote: note,
    roundBasis: {
      priorSample: prior?.fightsSampled ?? null,
      documentedWinsA: ratesA?.documentedWins ?? null,
      documentedWinsB: ratesB?.documentedWins ?? null,
      priorWeightA: ratesA?.priorWeight ?? null,
      priorWeightB: ratesB?.priorWeight ?? null,
    },
    recommendedBets: recommended,
    keyFactors: pred.keyFactors,
    watchOuts: pred.watchOuts,
    modelVersion: pred.model.version,
    notes: pred.model.notes,
  };
}

/* ---------- H2H : confrontations directes tirées des historiques ---------- */

async function computeH2h(aId: string, bId: string, aName: string, bName: string) {
  const [ha, hb] = await Promise.all([
    getAthleteHistory(aId).catch(() => []),
    getAthleteHistory(bId).catch(() => []),
  ]);
  const target = (n: string) => normalizeName(n);
  const out: Array<{ date: string; event: string; winner: string; method: string | null }> = [];
  for (const h of ha) {
    if (target(h.opponentName) !== target(bName)) continue;
    out.push({
      date: h.eventDate,
      event: h.eventName ?? "Événement",
      winner:
        h.result === "W" ? aName : h.result === "L" ? bName : h.result === "D" ? "Match nul" : "Sans décision",
      method: null,
    });
  }
  for (const h of hb) {
    if (target(h.opponentName) !== target(aName)) continue;
    /* doublon si déjà comptée côté A (même date) */
    if (out.some((o) => Math.abs(new Date(o.date).getTime() - new Date(h.eventDate).getTime()) < 86400000)) continue;
    out.push({
      date: h.eventDate,
      event: h.eventName ?? "Événement",
      winner:
        h.result === "W" ? bName : h.result === "L" ? aName : h.result === "D" ? "Match nul" : "Sans décision",
      method: null,
    });
  }
  return out.sort((x, y) => new Date(y.date).getTime() - new Date(x.date).getTime());
}

/* ---------- API principale du détail ---------- */

export async function loadMmaFightDetail(fightId: string) {
  const ref = await resolveFightRef(fightId);
  if (!ref) throw new Error("Combat introuvable dans les données ESPN.");

  const fa = ref.fighters[0];
  const fb = ref.fighters[1];
  if (!fa || !fb || isPlaceholderFighter(fa.fullName) || isPlaceholderFighter(fb.fullName)) {
    throw new Error("Combat incomplet : combattants à annoncer.");
  }

  const analysis: FightAnalysis = await loadFightAnalysis({
    espnEventId: ref.espnEventId,
    espnCompetitionId: ref.espnCompetitionId,
    league: ref.league,
    event: {
      id: `espn:${ref.league}:event:${ref.espnEventId}`,
      name: ref.eventName,
      organization: ref.org,
      date: ref.eventDate,
      venue: ref.venue.name,
      city: ref.venue.city,
      country: ref.venue.country,
    },
    fighters: ref.fighters.map((x) => ({
      espnAthleteId: x.espnAthleteId,
      fullName: x.fullName,
      recordAtFight: x.recordAtFight,
      isWinner: x.isWinner,
    })),
  });

  const fighterA = toMmaFighter(analysis.fighters[0]);
  const fighterB = toMmaFighter(analysis.fighters[1]);
  const scheduledRounds = analysis.fight.scheduledRounds;

  /* Fenêtres dérivées (rounds de fin réels) ; amorçage du prior UFC en
   * arrière-plan au premier affichage (scan une fois par semaine, caché). */
  const fightsA: DerivedResult["fights"] | null = analysis.fighters[0].derived?.fights ?? null;
  const fightsB: DerivedResult["fights"] | null = analysis.fighters[1].derived?.fights ?? null;
  if (!peekRoundPrior()) {
    void fetchUfcRoundPrior().catch(() => null);
  }

  const winnerExt = analysis.fight.winner;
  const winner: "A" | "B" | null =
    winnerExt == null
      ? null
      : winnerExt === fighterA.id
        ? "A"
        : winnerExt === fighterB.id
          ? "B"
          : null;

  const fight: MmaFight = {
    id: fightId,
    org: ref.org,
    orgShort: ref.org,
    eventName: ref.eventName,
    weightClass: analysis.fight.weightClass
      ? (weightClassFr(analysis.fight.weightClass) ?? analysis.fight.weightClass)
      : null,
    weightClassShort: weightClassShortOf(analysis.fight.weightClass),
    rounds: scheduledRounds,
    cardSegment: analysis.fight.cardSegment,
    date: ref.eventDate,
    status: statusToApp(analysis.fight.status),
    statusDetail: statusDetailFr(analysis.fight.status, null),
    fighterA: {
      id: fighterA.id,
      espnAthleteId: fighterA.espnAthleteId,
      name: fighterA.name,
      shortName: fighterA.shortName,
      headshotUrl: fighterA.headshotUrl,
      flagUrl: fighterA.flagUrl,
      record: fighterA.record,
      form: fighterA.form,
      isWinner: winner === "A" ? true : winner === "B" ? false : null,
    },
    fighterB: {
      id: fighterB.id,
      espnAthleteId: fighterB.espnAthleteId,
      name: fighterB.name,
      shortName: fighterB.shortName,
      headshotUrl: fighterB.headshotUrl,
      flagUrl: fighterB.flagUrl,
      record: fighterB.record,
      form: fighterB.form,
      isWinner: winner === "B" ? true : winner === "A" ? false : null,
    },
    winner,
    method: analysis.fight.resultDetail,
    venue: ref.venue,
    prospect: false,
  };

  const h2h = await computeH2h(
    fighterA.espnAthleteId,
    fighterB.espnAthleteId,
    fighterA.name,
    fighterB.name,
  );

  return {
    fightId,
    fight,
    fighterA,
    fighterB,
    prediction: await mapPrediction(
      analysis.prediction,
      fighterA,
      fighterB,
      scheduledRounds,
      fightsA,
      fightsB,
    ),
    h2h,
    dimensions: analysis.dimensions,
    sources: analysis.sources,
    limitations: analysis.limitations,
    derivedPending: analysis.derivedPending,
  };
}

export type MmaFightDetailLoaded = Awaited<ReturnType<typeof loadMmaFightDetail>>;
