/* ============================================================
   VOLTRIX — Correspondance match → photo de stade
   Le stade d'un match = le stade de l'équipe DOMICILE.
   Mots-clés cherchés (sans accents, minuscules) dans le nom du
   stade ET le nom/abrégé de l'équipe domicile. Repli : photo de
   stade nocturne générique.
   ============================================================ */

/** normalise : minuscules, sans accents, espaces simples */
function norm(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

interface StadiumRule {
  img: string;
  /** mots-clés spécifiques d'abord ; codes courts encadrés d'espaces */
  keywords: string[];
}

/* Ordre important : les mots-clés les plus spécifiques passent
   avant (ex. « allianz arena » Bayern vs « allianz stadium »
   Juventus vs « allianz riviera » Nice). */
const RULES: StadiumRule[] = [
  { img: "/stadiums/arsenal.jpg", keywords: ["emirates", "arsenal", " ars "] },
  { img: "/stadiums/liverpool.jpg", keywords: ["anfield", "liverpool", " liv "] },
  { img: "/stadiums/mancity.jpg", keywords: ["etihad", "manchester city", "man city", " mci "] },
  { img: "/stadiums/chelsea.jpg", keywords: ["stamford", "chelsea", " che "] },
  { img: "/stadiums/tottenham.jpg", keywords: ["tottenham", "hotspur", " tot "] },
  { img: "/stadiums/newcastle.jpg", keywords: ["st james", "newcastle", " new "] },
  { img: "/stadiums/realmadrid.jpg", keywords: ["bernabeu", "real madrid", " rma "] },
  { img: "/stadiums/barcelona.jpg", keywords: ["camp nou", "barcelona", "barca", " bar ", "spotify"] },
  { img: "/stadiums/atletico.jpg", keywords: ["metropolitano", "atletico madrid", "atletico", " atm "] },
  { img: "/stadiums/sevilla.jpg", keywords: ["pizjuan", "sevilla", " sev "] },
  { img: "/stadiums/inter.jpg", keywords: ["san siro", "meazza", "inter", "internazionale", " int ", "ac milan", "milan"] },
  { img: "/stadiums/juventus.jpg", keywords: ["allianz stadium", "juventus", " juv "] },
  { img: "/stadiums/napoli.jpg", keywords: ["maradona", "napoli", "naples", " nap "] },
  { img: "/stadiums/roma.jpg", keywords: ["olimpico", "olympic", "as roma", "lazio", " rom ", " laz "] },
  { img: "/stadiums/bayern.jpg", keywords: ["allianz arena", "bayern", " bay "] },
  { img: "/stadiums/dortmund.jpg", keywords: ["signal iduna", "westfalen", "dortmund", " bvb ", "borussia dortmund"] },
  { img: "/stadiums/leipzig.jpg", keywords: ["red bull arena", "leipzig", " rbl "] },
  { img: "/stadiums/leverkusen.jpg", keywords: ["bayarena", "leverkusen", " b04 "] },
  { img: "/stadiums/psg.jpg", keywords: ["parc des princes", "paris sg", "paris saint", " psg "] },
  { img: "/stadiums/marseille.jpg", keywords: ["velodrome", "marseille", " om "] },
  { img: "/stadiums/monaco.jpg", keywords: ["louis ii", "monaco", " asm "] },
  { img: "/stadiums/lyon.jpg", keywords: ["groupama", "lyon", " ol "] },
  { img: "/stadiums/lille.jpg", keywords: ["pierre mauroy", "lille", " losc "] },
  { img: "/stadiums/nice.jpg", keywords: ["allianz riviera", "nice", " ogcn "] },
];

/** photo de stade générique quand l'équipe domicile est inconnue */
export const FALLBACK_STADIUM = "/stadium-night.jpg";

/**
 * Retourne l'image du stade où se joue le match.
 * @param venueName  nom du stade (si connu — ex. « Parc des Princes »)
 * @param homeName   nom de l'équipe domicile (ex. « Paris SG »)
 * @param homeShort  abrégé domicile (ex. « PSG »)
 */
export function stadiumImageFor(
  venueName?: string | null,
  homeName?: string | null,
  homeShort?: string | null,
): string {
  const hay = ` ${norm(venueName)} ${norm(homeName)} ${norm(homeShort)} `;
  for (const rule of RULES) {
    for (const kw of rule.keywords) {
      if (hay.includes(kw)) return rule.img;
    }
  }
  return FALLBACK_STADIUM;
}

/* ============================================================
   Noms de stades réels (repli local) : le lieu affiché est le
   vrai stade de l'équipe domicile, avec sa ville.
   ============================================================ */

export interface VenueInfo {
  name: string;
  city: string | null;
  country: string | null;
}

const VENUES: Record<string, VenueInfo> = {
  ARS: { name: "Emirates Stadium", city: "Londres", country: "Angleterre" },
  MCI: { name: "Etihad Stadium", city: "Manchester", country: "Angleterre" },
  LIV: { name: "Anfield", city: "Liverpool", country: "Angleterre" },
  CHE: { name: "Stamford Bridge", city: "Londres", country: "Angleterre" },
  TOT: { name: "Tottenham Hotspur Stadium", city: "Londres", country: "Angleterre" },
  NEW: { name: "St James' Park", city: "Newcastle", country: "Angleterre" },
  RMA: { name: "Santiago Bernabéu", city: "Madrid", country: "Espagne" },
  BAR: { name: "Camp Nou", city: "Barcelone", country: "Espagne" },
  ATM: { name: "Cívitas Metropolitano", city: "Madrid", country: "Espagne" },
  SEV: { name: "Ramón Sánchez-Pizjuán", city: "Séville", country: "Espagne" },
  INT: { name: "San Siro", city: "Milan", country: "Italie" },
  MIL: { name: "San Siro", city: "Milan", country: "Italie" },
  JUV: { name: "Allianz Stadium", city: "Turin", country: "Italie" },
  NAP: { name: "Stadio Diego Armando Maradona", city: "Naples", country: "Italie" },
  ROM: { name: "Stadio Olimpico", city: "Rome", country: "Italie" },
  LAZ: { name: "Stadio Olimpico", city: "Rome", country: "Italie" },
  BAY: { name: "Allianz Arena", city: "Munich", country: "Allemagne" },
  BVB: { name: "Signal Iduna Park", city: "Dortmund", country: "Allemagne" },
  RBL: { name: "Red Bull Arena", city: "Leipzig", country: "Allemagne" },
  B04: { name: "BayArena", city: "Leverkusen", country: "Allemagne" },
  PSG: { name: "Parc des Princes", city: "Paris", country: "France" },
  OM: { name: "Orange Vélodrome", city: "Marseille", country: "France" },
  ASM: { name: "Stade Louis II", city: "Monaco", country: "Monaco" },
  OL: { name: "Groupama Stadium", city: "Lyon", country: "France" },
  LOSC: { name: "Stade Pierre-Mauroy", city: "Lille", country: "France" },
  OGCN: { name: "Allianz Riviera", city: "Nice", country: "France" },
};

/** Vrai stade de l'équipe domicile (repli local). Sinon : « XXX Arena ». */
export function demoVenueFor(
  homeShort?: string | null,
  homeName?: string | null,
): VenueInfo {
  const code = (homeShort ?? "").trim().toUpperCase();
  if (code && VENUES[code]) return VENUES[code];
  if (homeName) {
    const n = norm(homeName);
    for (const rule of RULES) {
      for (const kw of rule.keywords) {
        if (` ${n} `.includes(kw)) {
          /* retrouve le code depuis l'image (ex. /stadiums/psg.jpg → PSG) */
          const code2 = rule.img.split("/").pop()?.replace(".jpg", "").toUpperCase();
          if (code2 && VENUES[code2]) return VENUES[code2];
        }
      }
    }
  }
  return { name: `${homeShort ?? homeName ?? "Stade"} Arena`, city: null, country: null };
}
