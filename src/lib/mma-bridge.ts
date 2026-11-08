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
import type { FightAnalysis, FighterView } from "./mma/analysis";
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
   Journée MMA : événements du jour (UFC, PFL) + détails
   ============================================================ */

function localDateKey(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function isoShift(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Charge les combats du jour : scoreboard + détails par combat (catégorie, rounds). */
export async function loadMmaDay(dateISO: string): Promise<MmaEventsResponse> {
  const from = new Date(`${isoShift(dateISO, -1)}T00:00:00Z`);
  const to = new Date(`${isoShift(dateISO, +1)}T23:59:59Z`);

  const boards = await mapLimited(ACTIVE_ORGS, 2, (org) =>
    getScoreboard(org, from, to).catch(() => [] as ScoreboardEventDTO[]),
  );
  const events = boards
    .flat()
    .filter((e) => localDateKey(e.date) === dateISO)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const groups: MmaEventGroup[] = [];
  const quickPreds: MmaQuickPred[] = [];

  for (const ev of events) {
    const org = (LEAGUE_TO_ORG[ev.league] ?? ev.organization).toUpperCase();
    /* détails par combat : catégorie + rounds + résultat (core API, cache 1 h) */
    const { loadEventDetail } = await import("./mma/loaders");
    const detail = await loadEventDetail(ev).catch(() => null);

    const fights: MmaFight[] = [];
    ev.fights.forEach((f, idx) => {
      const fd = detail?.fights[idx] ?? null;
      const dStatus = fd?.status ?? f.status;
      const a = f.fighters[0];
      const b = f.fighters[1];
      if (!a || !b) return;

      const toListItem = (
        x: typeof a,
      ): MmaListItemFighter => ({
        id: x.externalId,
        espnAthleteId: x.espnAthleteId,
        name: x.fullName,
        shortName: shortNameOf(x.fullName),
        headshotUrl: null,
        flagUrl: null,
        record: {
          wins: parseRecord(x.recordAtFight)?.wins ?? null,
          losses: parseRecord(x.recordAtFight)?.losses ?? null,
          draws: parseRecord(x.recordAtFight)?.draws ?? null,
        },
        form: null,
        isWinner: x.isWinner,
      });

      const winner = f.fighters.find((x) => x.isWinner === true);
      const method =
        fd?.resultDetail ??
        (fd?.resultMethod === "KO_TKO"
          ? "KO/TKO"
          : fd?.resultMethod === "SOUMISSION"
            ? "Soumission"
            : fd?.resultMethod === "DECISION"
              ? "Décision"
              : null);

      fights.push({
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
        fighterA: toListItem(a),
        fighterB: toListItem(b),
        winner:
          winner == null
            ? null
            : winner.externalId === a.externalId
              ? "A"
              : "B",
        method,
        venue: {
          name: ev.venueName,
          city: ev.city,
          country: ev.country,
        },
      });

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
      });
    }
  }

  return {
    date: dateISO,
    totalFights: groups.reduce((n, g) => n + g.fights.length, 0),
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
    totalFights: view.totalFights,
    strikesLandedPerMin: view.stats?.sigStrikesLandedPerMin ?? null,
    strikingAccuracy: view.stats?.strikingAccuracy ?? null,
    strikesAbsorbedPerMin: d?.sigStrikesAbsorbedPerMin ?? null,
    takedownsPer15: view.stats?.takedownsPer15Min ?? null,
    takedownAccuracy: view.stats?.takedownAccuracy ?? null,
    takedownDefense: d?.takedownDefense ?? null,
    submissionAvgPer15: view.stats?.submissionsPer15Min ?? null,
    derivedWindow: d?.windowSize ?? null,
    form: view.lastResults.length > 0 ? view.lastResults.join("") : null,
    lastResults: view.lastResults,
  };
}

/* ---------- Modèle de rounds (prior public, étiqueté) ---------- */

/** Répartition des fins de combat par round — base UFC (part des fins par round). */
const ROUND_PRIOR_3: number[] = [0.4, 0.33, 0.27];
const ROUND_PRIOR_5: number[] = [0.33, 0.28, 0.21, 0.12, 0.06];

const ROUND_MODEL_NOTE =
  "Répartition par round estimée : ESPN ne publie pas le round de fin des combats passés. " +
  "Le moteur répartit la probabilité d'arrêt selon les taux de base observés en UFC " +
  "(40/33/27 % pour 3 rounds ; 33/28/21/12/6 % pour 5 rounds).";

/* ---------- Méthodes de victoire (dérivées des carrières observées) ---------- */

function methodRates(f: MmaFighter): { ko: number | null; sub: number | null; dec: number | null; basis: string[] } {
  const basis: string[] = [];
  const rates: { ko: number | null; sub: number | null; dec: number | null } = { ko: null, sub: null, dec: null };
  const wins = f.record.wins;

  if (wins != null && wins > 0) {
    const ko = f.koWins != null ? f.koWins / wins : null;
    const sub = f.subWins != null ? f.subWins / wins : null;
    const dec = f.decWins != null ? f.decWins / wins : null;
    if (ko != null || sub != null || dec != null) {
      rates.ko = ko;
      rates.sub = sub;
      rates.dec = dec;
      basis.push("palmarès ESPN");
    }
  }
  return { ...rates, basis };
}

function blendRates(a: MmaFighter, pWin: number, finishTotal: number): MmaMethodMix {
  const r = methodRates(a);
  if (r.ko == null && r.sub == null && r.dec == null) return { ko: null, sub: null, dec: null };
  let ko = r.ko ?? 0;
  let sub = r.sub ?? 0;
  let dec = r.dec ?? 0;
  const sum = ko + sub + dec;
  if (sum <= 0) return { ko: null, sub: null, dec: null };
  ko /= sum;
  sub /= sum;
  dec /= sum;
  void finishTotal;
  return {
    ko: pWin * ko,
    sub: pWin * sub,
    dec: pWin * dec,
  };
}

/* ---------- Mapping prédiction moteur → UI ---------- */

function mapPrediction(
  pred: PredictionView,
  a: MmaFighter,
  b: MmaFighter,
  scheduledRounds: number | null,
) {
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
      goesToDecision: 0,
      totalRoundsExpected: null,
      roundModelNote: ROUND_MODEL_NOTE,
      recommendedBets: [],
      keyFactors: [],
      watchOuts: [],
      modelVersion: pred.model.version,
      notes: pred.model.notes,
    };
  }

  const pA = pred.probabilityA / 100;
  const pB = pred.probabilityB / 100;

  /* méthodes de victoire : répartition des victoires observées */
  const byMethod = {
    a: blendRates(a, pA, 1 - 0),
    b: blendRates(b, pB, 1 - 0),
  };

  /* décision : part des victoires obtenues aux points, côté de chaque combattant */
  const decA = byMethod.a.dec;
  const decB = byMethod.b.dec;
  let goesToDecision = 0.5;
  if (decA != null && decB != null) {
    goesToDecision = Math.min(0.8, Math.max(0.2, pA * decA + pB * decB));
  } else if (decA != null) {
    goesToDecision = Math.min(0.8, Math.max(0.2, decA));
  } else if (decB != null) {
    goesToDecision = Math.min(0.8, Math.max(0.2, decB));
  }
  const finishProb = 1 - goesToDecision;

  /* rounds : prior public appliqué à la probabilité d'arrêt */
  const rounds = scheduledRounds === 5 ? 5 : 3;
  const prior = rounds === 5 ? ROUND_PRIOR_5 : ROUND_PRIOR_3;
  const roundFinish = prior.slice(0, rounds).map((p, i) => ({
    round: i + 1,
    prob: finishProb * p,
  }));
  const totalRoundsExpected =
    roundFinish.reduce((acc, r) => acc + r.round * r.prob, 0) + rounds * goesToDecision;

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
  if (pred.method && pred.method.share != null) {
    recommended.push({
      market: "Méthode",
      pick: pred.method.label,
      prob: pred.method.share,
      note: pred.method.detail,
    });
  }
  recommended.push({
    market: "Distance",
    pick: goesToDecision >= 0.5 ? "Va jusqu'à la décision" : "Ne passe pas la distance",
    prob: goesToDecision >= 0.5 ? goesToDecision : 1 - goesToDecision,
    note: "Dérivé de la répartition des victoires observées des deux combattants",
  });

  const conf = pred.confidence;
  const stars = conf ? (conf.score >= 60 ? 4 : conf.score >= 35 ? 3 : 2) : 2;

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
    roundModelNote: ROUND_MODEL_NOTE,
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
    prediction: mapPrediction(analysis.prediction, fighterA, fighterB, scheduledRounds),
    h2h,
    dimensions: analysis.dimensions,
    sources: analysis.sources,
    limitations: analysis.limitations,
    derivedPending: analysis.derivedPending,
  };
}

export type MmaFightDetailLoaded = Awaited<ReturnType<typeof loadMmaFightDetail>>;
