/* ============================================================
   VOLTRIX front — Types MMA
   Combats, combattants et pronostics de victoire MMA.
   Conçus en miroir des types football (LightMatch, QuickPred,
   MatchDetailDTO) pour un rendu cohérent entre les deux sports.
   ============================================================ */

// ---------- Combattant ----------

export interface MmaFighter {
  id: string;
  name: string; // "Islam Makhachev"
  shortName: string; // "Makhachev"
  nickname: string | null; // "The Dagestani"
  country: string; // "Dagestan, Russie"
  record: { wins: number; losses: number; draws: number }; // 26-1-0
  ranking: number | null; // classement dans la catégorie (1 = champion)
  stance: "Orthodoxe" | "Southpaw" | "";
  age: number | null;
  heightCm: number | null;
  reachCm: number | null;
  /* palmarès par méthode (répartition des victoires) */
  koWins: number;
  subWins: number;
  decWins: number;
  /* stats moyennes par 15 min de combat */
  strikesLandedPerMin: number;
  strikingAccuracy: number; // 0..1
  strikesAbsorbedPerMin: number;
  takedownsPer15: number;
  takedownAccuracy: number; // 0..1
  takedownDefense: number; // 0..1
  submissionAvgPer15: number;
  form: string; // "WWWWW" — 5 derniers combats
}

// ---------- Combat (liste) ----------

export interface MmaFight {
  id: string;
  org: "UFC" | "PFL" | "Bellator" | "ONE";
  orgShort: string; // "UFC 321"
  eventName: string; // "UFC 321: Makhachev vs Tsarukyan 2"
  weightClass: string; // "Poids légers"
  weightClassShort: string; // "LW"
  rounds: 3 | 5;
  titleFight: boolean;
  date: string; // ISO
  status: "pre" | "in" | "post";
  statusDetail: string;
  fighterA: Pick<MmaFighter, "id" | "name" | "shortName" | "record" | "ranking" | "form">;
  fighterB: Pick<MmaFighter, "id" | "name" | "shortName" | "record" | "ranking" | "form">;
  /* vainqueur si terminé : "A" | "B" | null */
  winner: "A" | "B" | null;
  method: string | null; // "KO/TKO R2" si terminé
  hasOdds: boolean;
  oddsA: number | null; // cote décimale victoire A
  oddsB: number | null;
  venue: { name: string | null; city: string | null; country: string | null };
}

export interface MmaEventsResponse {
  date: string;
  totalFights: number;
  events: Array<{
    org: MmaFight["org"];
    orgShort: string;
    eventName: string;
    region: string;
    fights: MmaFight[];
  }>;
}

// ---------- Prédiction rapide (liste) ----------

export interface MmaQuickPred {
  fightId: string;
  status: string;
  probs: { a: number; b: number };
  confidence: number; // 1..5
  confidenceLabel: string;
  topMethod: "KO/TKO" | "Soumission" | "Décision";
  topMethodProb: number;
  valueBetsCount: number;
}

// ---------- Détail combat ----------

export interface MmaFightDetail {
  fightId: string;
  fight: MmaFight;
  fighterA: MmaFighter;
  fighterB: MmaFighter;
  prediction: {
    probs: { a: number; b: number };
    elo: { a: number; b: number };
    form: { a: number; b: number };
    /* probabilité de victoire par méthode, pour chaque combattant */
    byMethod: {
      a: { ko: number; sub: number; dec: number };
      b: { ko: number; sub: number; dec: number };
    };
    /* probabilité que le combat se termine au round N (somme ≤ 1) */
    roundFinish: Array<{ round: number; prob: number }>;
    goesToDecision: number;
    totalRoundsExpected: number; // ex. 3.4
    confidence: number;
    confidenceLabel: string;
    recommendedBets: Array<{ market: string; pick: string; prob: number; note: string }>;
    valueBets: Array<{
      market: string;
      pick: string;
      modelProb: number;
      odds: number;
      edge: number;
    }>;
    valueBetsCount: number;
  };
  h2h: Array<{
    date: string;
    event: string;
    winner: string;
    method: string;
  }>;
}
