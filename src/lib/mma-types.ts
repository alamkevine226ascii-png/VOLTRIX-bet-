/* ============================================================
   VOLTRIX app — Types MMA (données réelles ESPN)
   Adossés au moteur voltrix-mma-v1 (src/lib/mma/) : chaque champ
   est soit observé chez ESPN, soit calculé et étiqueté comme tel.
   Aucune valeur inventée : tout ce qui est inconnu est null.
   ============================================================ */

// ---------- Combattant (détail) ----------

export interface MmaFighter {
  id: string; // espn:athlete:{id}
  espnAthleteId: string;
  name: string;
  shortName: string;
  nickname: string | null;
  country: string | null;
  headshotUrl: string | null;
  flagUrl: string | null;
  record: { wins: number | null; losses: number | null; draws: number | null };
  ranking: number | null;
  stance: string; // garde (EN ESPN traduite) ou ""
  age: number | null;
  heightCm: number | null;
  reachCm: number | null;
  weightClass: string | null;
  fightingStyle: string | null;
  /* palmarès par méthode (répartition des victoires) */
  koWins: number | null;
  subWins: number | null;
  decWins: number | null;
  totalFights: number | null;
  /* stats moyennes de carrière ESPN */
  strikesLandedPerMin: number | null;
  strikingAccuracy: number | null;
  strikesAbsorbedPerMin: number | null; // calculé (fenêtre 8 combats) ou null
  takedownsPer15: number | null;
  takedownAccuracy: number | null;
  takedownDefense: number | null; // calculé ou null
  submissionAvgPer15: number | null;
  derivedWindow: number | null; // taille de la fenêtre des indicateurs calculés
  form: string | null; // "WWLWW" — 5 derniers combats, plus récent à droite
  lastResults: string[];
}

// ---------- Combat (liste) ----------

export interface MmaListItemFighter {
  id: string;
  espnAthleteId: string;
  name: string;
  shortName: string;
  headshotUrl: string | null;
  flagUrl: string | null;
  record: { wins: number | null; losses: number | null; draws: number | null };
  form: string | null;
  isWinner: boolean | null;
}

export interface MmaFight {
  id: string; // espn:competition:{cid}
  org: string; // "UFC" | "PFL" | "Bellator"
  orgShort: string; // nom court de l'événement
  eventName: string;
  weightClass: string | null;
  weightClassShort: string | null;
  rounds: number | null; // rounds prévus
  cardSegment: string | null;
  date: string; // ISO
  status: "pre" | "in" | "post";
  statusDetail: string;
  fighterA: MmaListItemFighter;
  fighterB: MmaListItemFighter;
  winner: "A" | "B" | null;
  method: string | null; // "KO/TKO — R2" si terminé
  venue: { name: string | null; city: string | null; country: string | null };
}

export interface MmaEventGroup {
  org: string;
  orgShort: string;
  eventName: string;
  region: string;
  fights: MmaFight[];
}

export interface MmaEventsResponse {
  date: string;
  totalFights: number;
  events: MmaEventGroup[];
}

// ---------- Prédiction express (cartes de la liste) ----------

export interface MmaQuickPred {
  fightId: string;
  available: boolean;
  favorite: "A" | "B" | null;
  probs: { a: number; b: number };
  level: "avantage net" | "avantage léger" | "indécis";
  basis: string;
  confidence: number; // 1..5
  confidenceLabel: string;
}

// ---------- Détail combat ----------

export interface MmaMethodMix {
  ko: number | null;
  sub: number | null;
  dec: number | null;
}

export interface MmaFightDetail {
  fightId: string;
  fight: MmaFight;
  fighterA: MmaFighter;
  fighterB: MmaFighter;
  prediction: {
    available: boolean;
    unavailabilityReason: string | null;
    probs: { a: number; b: number };
    favorite: "A" | "B" | null;
    marginLabel: string | null;
    confidence: number; // 1..5
    confidenceLabel: string; // "Bonne" | "Moyenne" | "Limitée"
    dimensionsUsed: number;
    dimensionsTotal: number;
    missingDimensions: string[];
    /* méthode de victoire la plus probable du favori (palmarès ESPN) */
    method: { label: "KO/TKO" | "Soumission" | "Décision"; share: number | null; detail: string } | null;
    /* répartition victoire × méthode, dérivée des carrières observées */
    byMethod: { a: MmaMethodMix; b: MmaMethodMix };
    /* probabilité d'un arrêt au round N — modèle à prior public (voir note) */
    roundFinish: Array<{ round: number; prob: number }>;
    goesToDecision: number;
    totalRoundsExpected: number | null;
    roundModelNote: string;
    recommendedBets: Array<{ market: string; pick: string; prob: number; note: string }>;
    keyFactors: Array<{ title: string; text: string }>;
    watchOuts: Array<{ title: string; text: string }>;
    modelVersion: string;
    notes: string[];
  };
  h2h: Array<{
    date: string;
    event: string;
    winner: string;
    method: string | null;
  }>;
  dimensions: Array<{
    key: string;
    label: string;
    scoreA: number | null;
    scoreB: number | null;
    advantage: "A" | "B" | "=" | null;
    detail: string;
    basis: string;
    available: boolean;
  }>;
  sources: Array<{ name: string; url: string | null; detail: string; syncedAt: string }>;
  limitations: string[];
  derivedPending: boolean;
}
