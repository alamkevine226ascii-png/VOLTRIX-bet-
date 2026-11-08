/* ============================================================
   VOLTRIX front — Données de DÉMONSTRATION MMA
   Combattants et événements réalistes, générés de façon
   déterministe (stable entre deux rendus), dans l'esprit du
   module football demo-data.ts. Les palmarès et stats sont
   indicatifs (mode démo) et le badge DÉMO l'indique à l'écran.
   ============================================================ */

import type {
  MmaEventsResponse,
  MmaFight,
  MmaFightDetail,
  MmaFighter,
  MmaQuickPred,
} from "./mma-types";

/* ---------- PRNG déterministe (même principe que football) ---------- */
function seedFrom(s: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return ((h >>> 0) % 10_000) / 10_000;
  };
}

const pick = <T,>(rng: () => number, arr: T[]): T => arr[Math.floor(rng() * arr.length)];
const between = (rng: () => number, lo: number, hi: number): number => lo + rng() * (hi - lo);
const round2 = (x: number): number => Math.round(x * 100) / 100;
const round3 = (x: number): number => Math.round(x * 1000) / 1000;
const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

/* ---------- Combattants (palmarès indicatifs — démo) ---------- */

interface FighterSeed {
  key: string;
  name: string;
  shortName: string;
  nickname: string | null;
  country: string;
  rating: number; // elo interne
  rec: [number, number, number]; // V-D-N
  ranking: number | null; // 1 = champion
  stance: "Orthodoxe" | "Southpaw";
  age: number;
  heightCm: number;
  reachCm: number;
  ko: number; // victoires par KO/TKO
  sub: number; // victoires par soumission
  dec: number; // victoires aux points
  slpm: number; // frappes significatives réussies / min
  strAcc: number;
  sapm: number; // frappes encaissées / min
  td15: number; // takedowns / 15 min
  tdAcc: number;
  tdDef: number;
  sub15: number; // tentatives de soumission / 15 min
  form: string;
}

const F: Record<string, FighterSeed> = {
  /* --- poids lourds --- */
  jones: { key: "jones", name: "Jon Jones", shortName: "Jones", nickname: "Bones", country: "États-Unis", rating: 1952, rec: [28, 1, 0], ranking: 1, stance: "Orthodoxe", age: 38, heightCm: 193, reachCm: 215, ko: 10, sub: 7, dec: 11, slpm: 4.3, strAcc: 0.57, sapm: 2.0, td15: 1.7, tdAcc: 0.47, tdDef: 0.95, sub15: 0.3, form: "WWWWW" },
  aspinall: { key: "aspinall", name: "Tom Aspinall", shortName: "Aspinall", nickname: "Honey Badger", country: "Angleterre", rating: 1893, rec: [15, 3, 0], ranking: 2, stance: "Orthodoxe", age: 32, heightCm: 196, reachCm: 198, ko: 12, sub: 3, dec: 0, slpm: 7.8, strAcc: 0.65, sapm: 2.4, td15: 1.2, tdAcc: 0.55, tdDef: 0.70, sub15: 0.5, form: "WWWWW" },
  gane: { key: "gane", name: "Ciryl Gane", shortName: "Gane", nickname: "Bon Gamin", country: "France", rating: 1821, rec: [12, 3, 0], ranking: 3, stance: "Orthodoxe", age: 35, heightCm: 193, reachCm: 203, ko: 6, sub: 3, dec: 3, slpm: 4.9, strAcc: 0.60, sapm: 2.9, td15: 0.8, tdAcc: 0.42, tdDef: 0.74, sub15: 0.3, form: "WWLWL" },
  /* --- poids mi-lourds --- */
  pereira: { key: "pereira", name: "Alex Pereira", shortName: "Pereira", nickname: "Poatan", country: "Brésil", rating: 1881, rec: [12, 3, 0], ranking: 2, stance: "Southpaw", age: 38, heightCm: 193, reachCm: 200, ko: 10, sub: 0, dec: 2, slpm: 3.7, strAcc: 0.63, sapm: 3.1, td15: 0.4, tdAcc: 0.45, tdDef: 0.70, sub15: 0.0, form: "WWWLW" },
  ankalaev: { key: "ankalaev", name: "Magomed Ankalaev", shortName: "Ankalaev", nickname: null, country: "Russie", rating: 1896, rec: [21, 1, 1], ranking: 1, stance: "Orthodoxe", age: 33, heightCm: 191, reachCm: 191, ko: 11, sub: 3, dec: 7, slpm: 3.9, strAcc: 0.55, sapm: 2.2, td15: 1.1, tdAcc: 0.48, tdDef: 0.80, sub15: 0.2, form: "WWWDW" },
  prochazka: { key: "prochazka", name: "Jiří Procházka", shortName: "Procházka", nickname: "Denisa", country: "Tchéquie", rating: 1820, rec: [30, 5, 1], ranking: 3, stance: "Southpaw", age: 33, heightCm: 193, reachCm: 203, ko: 26, sub: 3, dec: 1, slpm: 5.1, strAcc: 0.54, sapm: 5.2, td15: 0.5, tdAcc: 0.33, tdDef: 0.55, sub15: 0.4, form: "WLWWL" },
  /* --- poids moyens --- */
  duplessis: { key: "duplessis", name: "Dricus Du Plessis", shortName: "Du Plessis", nickname: "Stillknocks", country: "Afrique du Sud", rating: 1851, rec: [22, 2, 0], ranking: 1, stance: "Orthodoxe", age: 31, heightCm: 183, reachCm: 193, ko: 9, sub: 11, dec: 2, slpm: 5.0, strAcc: 0.51, sapm: 4.1, td15: 2.1, tdAcc: 0.43, tdDef: 0.60, sub15: 0.9, form: "WWWWW" },
  chimaev: { key: "chimaev", name: "Khamzat Chimaev", shortName: "Chimaev", nickname: "Borz", country: "Émirats arabes unis", rating: 1872, rec: [14, 0, 0], ranking: 2, stance: "Orthodoxe", age: 31, heightCm: 188, reachCm: 190, ko: 6, sub: 6, dec: 2, slpm: 2.9, strAcc: 0.52, sapm: 1.1, td15: 4.2, tdAcc: 0.58, tdDef: 0.86, sub15: 1.7, form: "WWWWW" },
  strickland: { key: "strickland", name: "Sean Strickland", shortName: "Strickland", nickname: "Tarzan", country: "États-Unis", rating: 1790, rec: [29, 6, 0], ranking: 4, stance: "Orthodoxe", age: 34, heightCm: 185, reachCm: 193, ko: 11, sub: 3, dec: 15, slpm: 4.8, strAcc: 0.44, sapm: 3.8, td15: 0.6, tdAcc: 0.36, tdDef: 0.76, sub15: 0.1, form: "WLWWL" },
  adesanya: { key: "adesanya", name: "Israel Adesanya", shortName: "Adesanya", nickname: "The Last Stylebender", country: "Nigérie", rating: 1802, rec: [24, 5, 0], ranking: 3, stance: "Southpaw", age: 36, heightCm: 193, reachCm: 203, ko: 16, sub: 0, dec: 8, slpm: 4.0, strAcc: 0.49, sapm: 3.3, td15: 0.1, tdAcc: 0.25, tdDef: 0.76, sub15: 0.0, form: "LWWLW" },
  /* --- poids mi-moyens --- */
  dellamaddalena: { key: "dellamaddalena", name: "Jack Della Maddalena", shortName: "Della Maddalena", nickname: null, country: "Australie", rating: 1804, rec: [18, 2, 0], ranking: 1, stance: "Southpaw", age: 29, heightCm: 180, reachCm: 185, ko: 12, sub: 1, dec: 5, slpm: 4.8, strAcc: 0.48, sapm: 4.0, td15: 0.4, tdAcc: 0.40, tdDef: 0.80, sub15: 0.2, form: "WWWWW" },
  rakhmonov: { key: "rakhmonov", name: "Shavkat Rakhmonov", shortName: "Rakhmonov", nickname: "Kazakh", country: "Kazakhstan", rating: 1861, rec: [19, 0, 0], ranking: 2, stance: "Orthodoxe", age: 31, heightCm: 185, reachCm: 196, ko: 8, sub: 11, dec: 0, slpm: 3.3, strAcc: 0.52, sapm: 2.5, td15: 2.3, tdAcc: 0.50, tdDef: 0.65, sub15: 1.3, form: "WWWWW" },
  muhammad: { key: "muhammad", name: "Belal Muhammad", shortName: "Muhammad", nickname: "Remember the Name", country: "États-Unis", rating: 1782, rec: [24, 3, 0], ranking: 3, stance: "Orthodoxe", age: 37, heightCm: 178, reachCm: 183, ko: 5, sub: 1, dec: 18, slpm: 4.2, strAcc: 0.43, sapm: 3.1, td15: 1.6, tdAcc: 0.41, tdDef: 0.82, sub15: 0.2, form: "WLWWW" },
  edwards: { key: "edwards", name: "Leon Edwards", shortName: "Edwards", nickname: "Rocky", country: "Angleterre", rating: 1791, rec: [22, 4, 0], ranking: 4, stance: "Southpaw", age: 34, heightCm: 183, reachCm: 188, ko: 7, sub: 3, dec: 12, slpm: 3.6, strAcc: 0.45, sapm: 2.5, td15: 1.0, tdAcc: 0.37, tdDef: 0.78, sub15: 0.2, form: "WWLWW" },
  /* --- poids légers --- */
  makhachev: { key: "makhachev", name: "Islam Makhachev", shortName: "Makhachev", nickname: null, country: "Russie", rating: 1931, rec: [27, 1, 0], ranking: 1, stance: "Orthodoxe", age: 34, heightCm: 178, reachCm: 178, ko: 5, sub: 13, dec: 9, slpm: 2.3, strAcc: 0.56, sapm: 1.2, td15: 3.4, tdAcc: 0.62, tdDef: 0.80, sub15: 1.1, form: "WWWWW" },
  topuria: { key: "topuria", name: "Ilia Topuria", shortName: "Topuria", nickname: "El Matador", country: "Espagne", rating: 1901, rec: [16, 0, 0], ranking: 2, stance: "Orthodoxe", age: 28, heightCm: 170, reachCm: 175, ko: 6, sub: 8, dec: 2, slpm: 4.4, strAcc: 0.52, sapm: 3.2, td15: 1.4, tdAcc: 0.44, tdDef: 0.75, sub15: 0.8, form: "WWWWW" },
  tsarukyan: { key: "tsarukyan", name: "Arman Tsarukyan", shortName: "Tsarukyan", nickname: "Akhalkalakets", country: "Arménie", rating: 1842, rec: [22, 3, 0], ranking: 3, stance: "Orthodoxe", age: 28, heightCm: 170, reachCm: 183, ko: 9, sub: 5, dec: 8, slpm: 4.1, strAcc: 0.50, sapm: 2.6, td15: 3.1, tdAcc: 0.52, tdDef: 0.79, sub15: 0.7, form: "WWLWW" },
  oliveira: { key: "oliveira", name: "Charles Oliveira", shortName: "Oliveira", nickname: "do Bronx", country: "Brésil", rating: 1780, rec: [35, 10, 0], ranking: 4, stance: "Orthodoxe", age: 36, heightCm: 178, reachCm: 188, ko: 10, sub: 20, dec: 5, slpm: 3.6, strAcc: 0.53, sapm: 3.4, td15: 1.6, tdAcc: 0.40, tdDef: 0.60, sub15: 1.6, form: "WWLWL" },
  gaethje: { key: "gaethje", name: "Justin Gaethje", shortName: "Gaethje", nickname: "The Highlight", country: "États-Unis", rating: 1771, rec: [26, 5, 0], ranking: 5, stance: "Orthodoxe", age: 37, heightCm: 180, reachCm: 178, ko: 20, sub: 1, dec: 5, slpm: 6.6, strAcc: 0.57, sapm: 7.1, td15: 0.3, tdAcc: 0.30, tdDef: 0.80, sub15: 0.1, form: "WWLWW" },
  /* --- poids plumes --- */
  volkanovski: { key: "volkanovski", name: "Alexander Volkanovski", shortName: "Volkanovski", nickname: "The Great", country: "Australie", rating: 1853, rec: [27, 4, 0], ranking: 1, stance: "Orthodoxe", age: 37, heightCm: 168, reachCm: 182, ko: 13, sub: 3, dec: 11, slpm: 5.6, strAcc: 0.57, sapm: 4.2, td15: 1.2, tdAcc: 0.40, tdDef: 0.68, sub15: 0.1, form: "WWWLW" },
  lopes: { key: "lopes", name: "Diego Lopes", shortName: "Lopes", nickname: null, country: "Brésil", rating: 1762, rec: [26, 6, 0], ranking: 2, stance: "Southpaw", age: 30, heightCm: 180, reachCm: 183, ko: 11, sub: 6, dec: 9, slpm: 4.3, strAcc: 0.47, sapm: 4.6, td15: 1.0, tdAcc: 0.38, tdDef: 0.52, sub15: 1.0, form: "WWWLW" },
  holloway: { key: "holloway", name: "Max Holloway", shortName: "Holloway", nickname: "Blessed", country: "États-Unis", rating: 1749, rec: [26, 8, 0], ranking: 3, stance: "Orthodoxe", age: 34, heightCm: 180, reachCm: 175, ko: 12, sub: 2, dec: 12, slpm: 7.2, strAcc: 0.49, sapm: 5.0, td15: 0.3, tdAcc: 0.32, tdDef: 0.80, sub15: 0.1, form: "LWWLW" },
  /* --- poids coqs --- */
  merab: { key: "merab", name: "Merab Dvalishvili", shortName: "Dvalishvili", nickname: "The Machine", country: "Géorgie", rating: 1831, rec: [19, 4, 0], ranking: 1, stance: "Orthodoxe", age: 35, heightCm: 168, reachCm: 173, ko: 3, sub: 1, dec: 15, slpm: 4.7, strAcc: 0.41, sapm: 3.6, td15: 6.1, tdAcc: 0.42, tdDef: 0.80, sub15: 0.1, form: "WWWWW" },
  omalley: { key: "omalley", name: "Sean O'Malley", shortName: "O'Malley", nickname: "Suga", country: "États-Unis", rating: 1772, rec: [18, 2, 0], ranking: 2, stance: "Orthodoxe", age: 30, heightCm: 180, reachCm: 183, ko: 12, sub: 2, dec: 4, slpm: 5.4, strAcc: 0.55, sapm: 3.7, td15: 0.2, tdAcc: 0.30, tdDef: 0.62, sub15: 0.2, form: "WLWWW" },
  nurmagomedov: { key: "nurmagomedov", name: "Umar Nurmagomedov", shortName: "U. Nurmagomedov", nickname: "Young Eagle", country: "Russie", rating: 1801, rec: [18, 1, 0], ranking: 3, stance: "Orthodoxe", age: 29, heightCm: 173, reachCm: 175, ko: 2, sub: 7, dec: 9, slpm: 3.2, strAcc: 0.50, sapm: 2.0, td15: 2.8, tdAcc: 0.47, tdDef: 0.85, sub15: 0.9, form: "WWWLW" },
  yan: { key: "yan", name: "Petr Yan", shortName: "Yan", nickname: "No Mercy", country: "Russie", rating: 1741, rec: [18, 3, 0], ranking: 4, stance: "Orthodoxe", age: 33, heightCm: 170, reachCm: 170, ko: 7, sub: 1, dec: 10, slpm: 4.7, strAcc: 0.48, sapm: 3.7, td15: 1.3, tdAcc: 0.42, tdDef: 0.78, sub15: 0.1, form: "WWLWW" },
  /* --- poids mouches --- */
  pantoja: { key: "pantoja", name: "Alexandre Pantoja", shortName: "Pantoja", nickname: "The Cannibal", country: "Brésil", rating: 1812, rec: [29, 5, 0], ranking: 1, stance: "Orthodoxe", age: 35, heightCm: 165, reachCm: 173, ko: 8, sub: 10, dec: 11, slpm: 3.9, strAcc: 0.48, sapm: 3.3, td15: 2.0, tdAcc: 0.45, tdDef: 0.70, sub15: 1.2, form: "WWWWW" },
  karafin: { key: "karafin", name: "Kai Kara-France", shortName: "Kara-France", nickname: "Don't Blink", country: "Nouvelle-Zélande", rating: 1721, rec: [25, 10, 0], ranking: 2, stance: "Orthodoxe", age: 32, heightCm: 165, reachCm: 173, ko: 12, sub: 3, dec: 10, slpm: 4.1, strAcc: 0.42, sapm: 3.9, td15: 0.6, tdAcc: 0.35, tdDef: 0.66, sub15: 0.2, form: "WWWLW" },
  moreno: { key: "moreno", name: "Brandon Moreno", shortName: "Moreno", nickname: "The Assassin Baby", country: "Mexique", rating: 1758, rec: [23, 8, 2], ranking: 3, stance: "Orthodoxe", age: 32, heightCm: 170, reachCm: 178, ko: 5, sub: 11, dec: 7, slpm: 3.8, strAcc: 0.45, sapm: 3.5, td15: 1.1, tdAcc: 0.40, tdDef: 0.68, sub15: 0.8, form: "WLWWL" },
  /* --- femmes : poids coqs --- */
  harrison: { key: "harrison", name: "Kayla Harrison", shortName: "Harrison", nickname: null, country: "États-Unis", rating: 1802, rec: [19, 1, 0], ranking: 1, stance: "Orthodoxe", age: 35, heightCm: 173, reachCm: 168, ko: 6, sub: 8, dec: 5, slpm: 4.0, strAcc: 0.50, sapm: 1.9, td15: 4.4, tdAcc: 0.55, tdDef: 0.75, sub15: 1.5, form: "WWWWL" },
  pena: { key: "pena", name: "Julianna Peña", shortName: "Peña", nickname: "Venezuelan Vixen", country: "États-Unis", rating: 1651, rec: [12, 6, 0], ranking: 2, stance: "Orthodoxe", age: 36, heightCm: 165, reachCm: 168, ko: 3, sub: 4, dec: 5, slpm: 3.3, strAcc: 0.42, sapm: 3.8, td15: 1.9, tdAcc: 0.40, tdDef: 0.55, sub15: 0.6, form: "WLWWL" },
  vieira: { key: "vieira", name: "Ketlen Vieira", shortName: "Vieira", nickname: "Fenômeno", country: "Brésil", rating: 1682, rec: [15, 3, 0], ranking: 3, stance: "Orthodoxe", age: 34, heightCm: 168, reachCm: 170, ko: 2, sub: 4, dec: 9, slpm: 3.7, strAcc: 0.46, sapm: 2.8, td15: 2.4, tdAcc: 0.44, tdDef: 0.72, sub15: 0.5, form: "WWLWW" },
  /* --- femmes : poids pailles --- */
  zhang: { key: "zhang", name: "Zhang Weili", shortName: "Zhang", nickname: "Magnum", country: "Chine", rating: 1828, rec: [25, 3, 0], ranking: 1, stance: "Orthodoxe", age: 36, heightCm: 163, reachCm: 160, ko: 11, sub: 8, dec: 6, slpm: 5.0, strAcc: 0.52, sapm: 4.1, td15: 1.6, tdAcc: 0.48, tdDef: 0.70, sub15: 0.4, form: "WWWWW" },
  suarez: { key: "suarez", name: "Tatiana Suarez", shortName: "Suarez", nickname: null, country: "États-Unis", rating: 1751, rec: [10, 0, 0], ranking: 2, stance: "Orthodoxe", age: 35, heightCm: 165, reachCm: 165, ko: 3, sub: 4, dec: 3, slpm: 3.1, strAcc: 0.47, sapm: 1.6, td15: 5.2, tdAcc: 0.52, tdDef: 0.78, sub15: 1.1, form: "WWWWW" },
  jandiroba: { key: "jandiroba", name: "Virna Jandiroba", shortName: "Jandiroba", nickname: null, country: "Brésil", rating: 1701, rec: [22, 3, 0], ranking: 3, stance: "Orthodoxe", age: 37, heightCm: 163, reachCm: 163, ko: 2, sub: 14, dec: 6, slpm: 3.0, strAcc: 0.44, sapm: 2.9, td15: 3.6, tdAcc: 0.46, tdDef: 0.62, sub15: 1.8, form: "WWWWL" },
  /* --- PFL --- */
  eblen: { key: "eblen", name: "Johnny Eblen", shortName: "Eblen", nickname: null, country: "États-Unis", rating: 1811, rec: [16, 0, 0], ranking: 1, stance: "Orthodoxe", age: 34, heightCm: 183, reachCm: 188, ko: 6, sub: 1, dec: 9, slpm: 3.4, strAcc: 0.49, sapm: 2.1, td15: 2.2, tdAcc: 0.45, tdDef: 0.84, sub15: 0.3, form: "WWWWW" },
  fedwards: { key: "fedwards", name: "Fabian Edwards", shortName: "F. Edwards", nickname: null, country: "Angleterre", rating: 1702, rec: [14, 4, 0], ranking: 2, stance: "Southpaw", age: 32, heightCm: 183, reachCm: 185, ko: 5, sub: 4, dec: 5, slpm: 3.8, strAcc: 0.46, sapm: 3.5, td15: 0.9, tdAcc: 0.38, tdDef: 0.60, sub15: 0.6, form: "WWLWW" },
  kasanganay: { key: "kasanganay", name: "Impa Kasanganay", shortName: "Kasanganay", nickname: "Tshiluba", country: "États-Unis", rating: 1691, rec: [19, 5, 0], ranking: 1, stance: "Orthodoxe", age: 31, heightCm: 183, reachCm: 188, ko: 6, sub: 4, dec: 9, slpm: 4.5, strAcc: 0.50, sapm: 4.2, td15: 1.4, tdAcc: 0.42, tdDef: 0.64, sub15: 0.5, form: "WLWWW" },
  magomedkerimov: { key: "magomedkerimov", name: "Magomed Magomedkerimov", shortName: "M. Kerimov", nickname: null, country: "Russie", rating: 1722, rec: [35, 3, 0], ranking: 2, stance: "Orthodoxe", age: 36, heightCm: 180, reachCm: 185, ko: 10, sub: 11, dec: 14, slpm: 3.2, strAcc: 0.48, sapm: 2.4, td15: 2.0, tdAcc: 0.44, tdDef: 0.76, sub15: 0.9, form: "WWWLW" },
  /* --- ONE --- */
  johnson: { key: "johnson", name: "Demetrious Johnson", shortName: "Johnson", nickname: "Mighty Mouse", country: "États-Unis", rating: 1781, rec: [25, 5, 1], ranking: 1, stance: "Orthodoxe", age: 39, heightCm: 160, reachCm: 168, ko: 5, sub: 8, dec: 12, slpm: 4.0, strAcc: 0.51, sapm: 2.2, td15: 2.4, tdAcc: 0.46, tdDef: 0.72, sub15: 0.8, form: "WWLWW" },
  moraes: { key: "moraes", name: "Adriano Moraes", shortName: "Moraes", nickname: "Mikinho", country: "Brésil", rating: 1678, rec: [24, 6, 0], ranking: 2, stance: "Orthodoxe", age: 36, heightCm: 170, reachCm: 175, ko: 7, sub: 8, dec: 9, slpm: 3.3, strAcc: 0.47, sapm: 2.9, td15: 1.2, tdAcc: 0.41, tdDef: 0.64, sub15: 1.0, form: "WLWWL" },
  clee: { key: "clee", name: "Christian Lee", shortName: "C. Lee", nickname: "The Warrior", country: "Singapour", rating: 1732, rec: [18, 4, 0], ranking: 1, stance: "Orthodoxe", age: 27, heightCm: 175, reachCm: 178, ko: 6, sub: 7, dec: 5, slpm: 4.2, strAcc: 0.49, sapm: 3.4, td15: 1.8, tdAcc: 0.44, tdDef: 0.62, sub15: 1.0, form: "WWWLW" },
};

/* ---------- Catégories de poids ---------- */

const WEIGHT_CLASSES: Record<string, { label: string; short: string; fighters: string[] }> = {
  hw: { label: "Poids lourds", short: "HW", fighters: ["jones", "aspinall", "gane"] },
  lhw: { label: "Poids mi-lourds", short: "LHW", fighters: ["pereira", "ankalaev", "prochazka"] },
  mw: { label: "Poids moyens", short: "MW", fighters: ["duplessis", "chimaev", "strickland", "adesanya"] },
  ww: { label: "Poids mi-moyens", short: "WW", fighters: ["dellamaddalena", "rakhmonov", "muhammad", "edwards"] },
  lw: { label: "Poids légers", short: "LW", fighters: ["makhachev", "topuria", "tsarukyan", "oliveira", "gaethje"] },
  fw: { label: "Poids plumes", short: "FW", fighters: ["volkanovski", "lopes", "holloway"] },
  bw: { label: "Poids coqs", short: "BW", fighters: ["merab", "omalley", "nurmagomedov", "yan"] },
  flw: { label: "Poids mouches", short: "FLW", fighters: ["pantoja", "karafin", "moreno"] },
  wbw: { label: "Poids coqs femmes", short: "WBW", fighters: ["harrison", "pena", "vieira"] },
  wsw: { label: "Poids pailles femmes", short: "WSW", fighters: ["zhang", "suarez", "jandiroba"] },
};

function classOf(key: string): { label: string; short: string } {
  for (const c of Object.values(WEIGHT_CLASSES)) {
    if (c.fighters.includes(key)) return { label: c.label, short: c.short };
  }
  return { label: "Poids welters", short: "W" };
}

/* ---------- Arènes (image de l'héro du détail combat) ---------- */

const ARENAS: Array<{ keys: string[]; name: string; city: string; country: string; img: string }> = [
  { keys: ["t-mobile", "tmobile"], name: "T-Mobile Arena", city: "Las Vegas", country: "États-Unis", img: "/arenas/tmoArena.jpg" },
  { keys: ["madison", "msg"], name: "Madison Square Garden", city: "New York", country: "États-Unis", img: "/arenas/msg.jpg" },
];

export const FALLBACK_ARENA = "/arenas/octagon.jpg";

export function arenaImageFor(venueName?: string | null): string {
  const n = (venueName ?? "").toLowerCase();
  for (const a of ARENAS) {
    if (a.keys.some((k) => n.includes(k))) return a.img;
  }
  return FALLBACK_ARENA;
}

const UFC_VENUES = [
  { name: "T-Mobile Arena", city: "Las Vegas", country: "États-Unis" },
  { name: "Madison Square Garden", city: "New York", country: "États-Unis" },
  { name: "UFC Apex", city: "Las Vegas", country: "États-Unis" },
  { name: "Accor Arena", city: "Paris", country: "France" },
];

/* ---------- Têtes d'affiche et affiches ---------- */

const UFC_MAINS: Array<[string, string]> = [
  ["aspinall", "jones"],
  ["pereira", "ankalaev"],
  ["duplessis", "chimaev"],
  ["dellamaddalena", "rakhmonov"],
  ["makhachev", "tsarukyan"],
  ["topuria", "volkanovski"],
  ["merab", "omalley"],
  ["pantoja", "karafin"],
  ["harrison", "pena"],
  ["zhang", "suarez"],
];

const UFC_COMAIN: Array<[string, string]> = [
  ["gane", "prochazka"],
  ["adesanya", "strickland"],
  ["edwards", "muhammad"],
  ["oliveira", "gaethje"],
  ["holloway", "lopes"],
  ["nurmagomedov", "yan"],
  ["moreno", "karafin"],
  ["topuria", "oliveira"],
];

const PFL_FIGHTS: Array<[string, string]> = [
  ["eblen", "fedwards"],
  ["kasanganay", "magomedkerimov"],
];

const ONE_FIGHTS: Array<[string, string]> = [
  ["johnson", "moraes"],
  ["clee", "moraes"],
];

/* ---------- Historiques connus (H2H) ---------- */

const H2H: Record<string, Array<{ date: string; event: string; winner: string; method: string }>> = {
  "makhachev|tsarukyan": [
    { date: "2019-04-20", event: "UFC St. Petersburg", winner: "Islam Makhachev", method: "Décision unanime" },
  ],
  "pereira|ankalaev": [
    { date: "2025-03-08", event: "UFC 313", winner: "Magomed Ankalaev", method: "Décision unanime" },
  ],
  "duplessis|strickland": [
    { date: "2024-01-20", event: "UFC 297", winner: "Dricus Du Plessis", method: "Décision partagée" },
    { date: "2025-02-08", event: "UFC 312", winner: "Dricus Du Plessis", method: "Décision unanime" },
  ],
  "merab|omalley": [
    { date: "2024-09-14", event: "UFC 306", winner: "Merab Dvalishvili", method: "Décision unanime" },
  ],
  "pantoja|moreno": [
    { date: "2018-05-19", event: "UFC Fight Night 129", winner: "Alexandre Pantoja", method: "Décision unanime" },
    { date: "2023-07-08", event: "UFC 290", winner: "Brandon Moreno", method: "Décision partagée" },
    { date: "2024-02-24", event: "UFC Fight Night 237", winner: "Brandon Moreno", method: "Décision unanime" },
  ],
  "johnson|moraes": [
    { date: "2021-04-07", event: "ONE on TNT 1", winner: "Adriano Moraes", method: "KO/TKO · R2" },
    { date: "2022-08-27", event: "ONE on Prime Video 1", winner: "Demetrious Johnson", method: "KO/TKO · R4" },
    { date: "2023-05-05", event: "ONE Fight Night 10", winner: "Demetrious Johnson", method: "Décision unanime" },
  ],
  "volkanovski|topuria": [
    { date: "2024-02-17", event: "UFC 298", winner: "Ilia Topuria", method: "KO/TKO · R2" },
  ],
};

function h2hFor(a: string, b: string): Array<{ date: string; event: string; winner: string; method: string }> {
  return H2H[`${a}|${b}`] ?? H2H[`${b}|${a}`] ?? [];
}

/* ---------- Modèle (elo → probabilité) ---------- */

function winProb(ra: number, rb: number): number {
  return 1 / (1 + Math.pow(10, (rb - ra) / 400));
}

/* ---------- Liste des combats du jour ---------- */

function fightTime(date: string, hour: number, minute: number): Date {
  return new Date(`${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`);
}

function statusOf(ms: number): MmaFight["status"] {
  const now = Date.now();
  if (ms > now + 30 * 60_000) return "pre";
  if (ms > now - 3 * 3600_000) return "in";
  return "post";
}

function lightFighter(k: string): MmaFight["fighterA"] {
  const s = F[k];
  return {
    id: s.key,
    name: s.name,
    shortName: s.shortName,
    record: { wins: s.rec[0], losses: s.rec[1], draws: s.rec[2] },
    ranking: s.ranking,
    form: s.form,
  };
}

function makeFight(
  rng: () => number,
  date: string,
  org: MmaFight["org"],
  orgShort: string,
  eventName: string,
  pair: [string, string],
  mainEvent: boolean,
  kickoff: Date,
  venue: { name: string | null; city: string | null; country: string | null },
  idx: number,
): MmaFight {
  const [ak, bk] = pair;
  const a = F[ak];
  const b = F[bk];
  const cls = classOf(ak);
  const status = statusOf(kickoff.getTime());
  const pA = winProb(a.rating, b.rating);

  let winner: "A" | "B" | null = null;
  let method: string | null = null;
  let statusDetail = "";
  if (status === "post") {
    winner = rng() < pA ? "A" : "B";
    const w = winner === "A" ? a : b;
    const r = rng();
    const koShare = w.ko / w.rec[0];
    const subShare = w.sub / w.rec[0];
    const round = 1 + Math.floor(rng() * (mainEvent ? 5 : 3));
    if (r < koShare) method = `KO/TKO · R${round}`;
    else if (r < koShare + subShare) method = `Soumission · R${round}`;
    else method = "Décision unanime";
    statusDetail = "Terminé";
  } else if (status === "in") {
    statusDetail = `R${1 + Math.floor(rng() * (mainEvent ? 5 : 3))} · ${Math.floor(between(rng, 0, 5))}:${pick(rng, ["05", "12", "23", "31", "38", "44", "51"])}`;
  }

  /* cotes démo : inverse de la proba modèle + bruit */
  const noiseA = between(rng, -0.05, 0.05);
  const noiseB = between(rng, -0.05, 0.05);
  const oddsA = round2(Math.max(1.05, 0.93 / clamp(pA + noiseA, 0.06, 0.94)));
  const oddsB = round2(Math.max(1.05, 0.93 / clamp(1 - pA + noiseB, 0.06, 0.94)));

  return {
    id: `mma-${date}-${org.toLowerCase()}-${idx}`,
    org,
    orgShort,
    eventName,
    weightClass: cls.label,
    weightClassShort: cls.short,
    rounds: mainEvent ? 5 : 3,
    titleFight: mainEvent && (a.ranking === 1 || b.ranking === 1),
    date: kickoff.toISOString(),
    status,
    statusDetail,
    fighterA: lightFighter(ak),
    fighterB: lightFighter(bk),
    winner,
    method,
    hasOdds: true,
    oddsA,
    oddsB,
    venue,
  };
}

export function demoMmaEvents(date: string): MmaEventsResponse {
  const rng = seedFrom(`mma-${date}`);
  const events: MmaEventsResponse["events"] = [];
  const used = new Set<string>();
  let total = 0;

  /* --- événement UFC principal --- */
  const mainIdx = Math.floor(rng() * UFC_MAINS.length) % UFC_MAINS.length;
  const mainPair = UFC_MAINS[mainIdx];
  used.add(mainPair[0]);
  used.add(mainPair[1]);

  const a = F[mainPair[0]];
  const b = F[mainPair[1]];
  const eventNo = 321 + Math.floor(rng() * 6);
  const eventName = `UFC ${eventNo} : ${a.shortName} vs ${b.shortName}`;
  const venue = UFC_VENUES[Math.floor(rng() * UFC_VENUES.length)];

  const mainHour = 22 - Math.floor(rng() * 2); // 21h ou 22h (TU)
  const mainK = fightTime(date, mainHour, pick(rng, [0, 15, 30, 45]));
  const fights: MmaFight[] = [];

  /* co-mains : 2 affiches sans conflit de combattant */
  const coPool = UFC_COMAIN.map((p, i) => ({ p, i }))
    .filter(({ p }) => !used.has(p[0]) && !used.has(p[1]) && Math.abs(winProb(F[p[0]].rating, F[p[1]].rating) - 0.5) < 0.35)
    .sort((x, y) => Math.abs(0.5 - winProb(F[x.p[0]].rating, F[x.p[1]].rating)) - Math.abs(0.5 - winProb(F[y.p[0]].rating, F[y.p[1]].rating)));
  const coCount = 1 + Math.floor(rng() * 2); // 1-2
  for (let c = 0; c < coCount && coPool.length > 0; c++) {
    const choice = coPool.splice(Math.floor(rng() * Math.min(4, coPool.length)), 1)[0];
    if (!choice) break;
    used.add(choice.p[0]);
    used.add(choice.p[1]);
    const k = fightTime(date, mainHour - 1 - c, pick(rng, [0, 20, 30, 45]));
    fights.push(makeFight(rng, date, "UFC", `UFC ${eventNo}`, eventName, choice.p, false, k, venue, c));
  }

  /* combat principal (affiché en tête de carte) */
  const mainFight = makeFight(rng, date, "UFC", `UFC ${eventNo}`, eventName, mainPair, true, mainK, venue, 9);
  fights.unshift(mainFight);

  events.push({ org: "UFC", orgShort: `UFC ${eventNo}`, eventName, region: "Mondial", fights });

  /* --- événement secondaire (PFL ou ONE) ~1 fois sur 2 --- */
  if (rng() > 0.45) {
    const isPfl = rng() > 0.4;
    const pool = isPfl ? PFL_FIGHTS : ONE_FIGHTS;
    const pair = pool[Math.floor(rng() * pool.length) % pool.length];
    const org: MmaFight["org"] = isPfl ? "PFL" : "ONE";
    const evName = isPfl ? `PFL 2026 : ${F[pair[0]].shortName} vs ${F[pair[1]].shortName}` : `ONE 2026 : ${F[pair[0]].shortName} vs ${F[pair[1]].shortName}`;
    const v = isPfl
      ? { name: "The Theater at Madison Square Garden", city: "New York", country: "États-Unis" }
      : { name: "Singapore Indoor Stadium", city: "Singapour", country: "Singapour" };
    const k = fightTime(date, 17 + Math.floor(rng() * 2), pick(rng, [0, 30]));
    events.push({
      org,
      orgShort: org,
      eventName: evName,
      region: "Mondial",
      fights: [makeFight(rng, date, org, org, evName, pair, true, k, v, 9)],
    });
    total++;
  }

  /* la carte UFC se lit avec le main event en tête */
  events[0].fights.reverse();

  return { date, totalFights: total, events };
}

/* ---------- Pronos rapides (liste) ---------- */

export function demoMmaPredictions(fights: MmaFight[]): MmaQuickPred[] {
  return fights.map((f) => {
    const rng = seedFrom(`mmapred-${f.id}`);
    const det = methodSplit(f);
    const conf = clamp(2 + Math.round(Math.abs(det.pA - 0.5) * 8), 1, 5);
    return {
      fightId: f.id,
      status: f.status,
      probs: { a: round3(det.pA), b: round3(1 - det.pA) },
      confidence: conf,
      confidenceLabel: ["Faible", "Limitée", "Moyenne", "Bonne", "Élevée"][conf - 1],
      topMethod: det.topLabel,
      topMethodProb: round3(det.topProb),
      valueBetsCount: Math.floor(rng() * 3),
    };
  });
}

/* ---------- Détail combat ---------- */

function fullFighter(k: string): MmaFighter {
  const s = F[k];
  return {
    id: s.key,
    name: s.name,
    shortName: s.shortName,
    nickname: s.nickname,
    country: s.country,
    record: { wins: s.rec[0], losses: s.rec[1], draws: s.rec[2] },
    ranking: s.ranking,
    stance: s.stance,
    age: s.age,
    heightCm: s.heightCm,
    reachCm: s.reachCm,
    koWins: s.ko,
    subWins: s.sub,
    decWins: s.dec,
    strikesLandedPerMin: s.slpm,
    strikingAccuracy: s.strAcc,
    strikesAbsorbedPerMin: s.sapm,
    takedownsPer15: s.td15,
    takedownAccuracy: s.tdAcc,
    takedownDefense: s.tdDef,
    submissionAvgPer15: s.sub15,
    form: s.form,
  };
}

/* découpes pA / pB par méthode de victoire */
function methodSplit(f: MmaFight): {
  pA: number;
  a: { ko: number; sub: number; dec: number };
  b: { ko: number; sub: number; dec: number };
  topLabel: "KO/TKO" | "Soumission" | "Décision";
  topProb: number;
} {
  const ak = f.fighterA.id;
  const bk = f.fighterB.id;
  const a = F[ak];
  const b = F[bk];
  const pA = winProb(a.rating, b.rating);
  const pB = 1 - pA;

  const aKo = (a.ko / a.rec[0]) * pA;
  const aSub = (a.sub / a.rec[0]) * pA;
  const aDec = (a.dec / a.rec[0]) * pA;
  const bKo = (b.ko / b.rec[0]) * pB;
  const bSub = (b.sub / b.rec[0]) * pB;
  const bDec = (b.dec / b.rec[0]) * pB;

  const cands: Array<["KO/TKO" | "Soumission" | "Décision", number]> = [
    ["KO/TKO", aKo + bKo],
    ["Soumission", aSub + bSub],
    ["Décision", aDec + bDec],
  ];
  cands.sort((x, y) => y[1] - x[1]);

  return {
    pA,
    a: { ko: round3(aKo), sub: round3(aSub), dec: round3(aDec) },
    b: { ko: round3(bKo), sub: round3(bSub), dec: round3(bDec) },
    topLabel: cands[0][0],
    topProb: cands[0][1],
  };
}

export function demoMmaFightDetail(fightId: string): MmaFightDetail | null {
  /* id = mma-YYYY-MM-DD-org-N */
  const m = fightId.match(/^mma-(\d{4}-\d{2}-\d{2})-[a-z]+-\d+$/);
  const date = m ? m[1] : new Date().toISOString().slice(0, 10);
  const events = demoMmaEvents(date);
  const fight =
    events.events.flatMap((e) => e.fights).find((f) => f.id === fightId) ??
    events.events.flatMap((e) => e.fights)[0];
  if (!fight) return null;

  const rng = seedFrom(`mmadetail-${fight.id}`);
  const ak = fight.fighterA.id;
  const bk = fight.fighterB.id;
  const a = F[ak];
  const b = F[bk];

  const split = methodSplit(fight);
  const pA = split.pA;
  const pB = 1 - pA;

  /* proba « forme » : elo + écart de dynamique récente */
  const fs = (x: typeof a) =>
    x.form.split("").reduce((acc, c) => acc + (c === "W" ? 1 : c === "D" ? 0.5 : 0), 0) / x.form.length;
  const formA = clamp(pA + (fs(a) - fs(b)) * 0.3, 0.05, 0.95);

  /* distance : finishers → fin précoce */
  const finishRate = (a.rec[0] - a.dec) / a.rec[0];
  const finishRateB = (b.rec[0] - b.dec) / b.rec[0];
  const goesToDecision = clamp(0.78 - 0.42 * (finishRate + finishRateB) / 2, 0.18, 0.55);
  const finishProb = 1 - goesToDecision;

  const nRounds = fight.rounds;
  const weights = nRounds === 5 ? [0.34, 0.25, 0.18, 0.13, 0.10] : [0.44, 0.31, 0.25];
  const roundFinish = weights.slice(0, nRounds).map((w, i) => ({
    round: i + 1,
    prob: round3(finishProb * w),
  }));

  const totalRoundsExpected = round2(
    goesToDecision * nRounds + roundFinish.reduce((acc, r) => acc + r.prob * r.round, 0),
  );

  const conf = clamp(2 + Math.round(Math.abs(pA - 0.5) * 8), 1, 5);
  const confidenceLabel = ["Faible", "Limitée", "Moyenne", "Bonne", "Élevée"][conf - 1];

  /* scénarios recommandés */
  const favKey = pA >= pB ? ak : bk;
  const fav = F[favKey];
  const favP = Math.max(pA, pB);
  const favSplit = pA >= pB ? split.a : split.b;
  const favBest = [
    { label: `par KO/TKO`, p: favSplit.ko },
    { label: `par soumission`, p: favSplit.sub },
    { label: `par décision`, p: favSplit.dec },
  ].sort((x, y) => y.p - x.p)[0];

  const recommendedBets = [
    {
      market: "Vainqueur",
      pick: `${fav.name} gagne`,
      prob: round3(favP),
      note: "Meilleure probabilité du moteur",
    },
    {
      market: "Méthode de victoire",
      pick: `${fav.shortName} ${favBest.label}`,
      prob: round3(favBest.p),
      note: "Croisement palmarès × styles",
    },
    {
      market: "Distance",
      pick: finishProb > goesToDecision ? "Ne passe pas la distance" : "Va jusqu'à la décision",
      prob: round3(Math.max(finishProb, goesToDecision)),
      note: "Taux de finition combiné",
    },
  ];

  /* value bets : cotes vs modèle */
  const valueBets: MmaFightDetail["prediction"]["valueBets"] = [];
  const edgeA = pA * (fight.oddsA ?? 0) - 1;
  const edgeB = pB * (fight.oddsB ?? 0) - 1;
  if (edgeA > 0.04) valueBets.push({ market: "Vainqueur", pick: `${a.name} gagne`, modelProb: round3(pA), odds: fight.oddsA ?? 0, edge: round3(edgeA) });
  if (edgeB > 0.04) valueBets.push({ market: "Vainqueur", pick: `${b.name} gagne`, modelProb: round3(pB), odds: fight.oddsB ?? 0, edge: round3(edgeB) });
  const methodOdds = round2(Math.max(1.2, 0.9 / Math.max(0.12, favBest.p)));
  const edgeM = favBest.p * methodOdds - 1;
  if (edgeM > 0.04 && valueBets.length < 2) {
    valueBets.push({ market: "Méthode", pick: `${fav.shortName} ${favBest.label}`, modelProb: round3(favBest.p), odds: methodOdds, edge: round3(edgeM) });
  }

  return {
    fightId: fight.id,
    fight,
    fighterA: fullFighter(ak),
    fighterB: fullFighter(bk),
    prediction: {
      probs: { a: round3(pA), b: round3(pB) },
      elo: { a: round3(winProb(a.rating, b.rating)), b: round3(winProb(b.rating, a.rating)) },
      form: { a: round3(formA), b: round3(1 - formA) },
      byMethod: { a: split.a, b: split.b },
      roundFinish,
      goesToDecision: round3(goesToDecision),
      totalRoundsExpected,
      confidence: conf,
      confidenceLabel,
      recommendedBets,
      valueBets,
      valueBetsCount: valueBets.length,
    },
    h2h: h2hFor(ak, bk),
  };
}
