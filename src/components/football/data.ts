/* ============================================================
   Football app data — teams, matches, lineups, stats, table
   ============================================================ */

export interface Team {
  id: string;
  label: string; // card label, e.g. "MANCHESTER UNITED"
  short: string; // compact code, e.g. "MANCH"
  initials: string; // shown on crest
  primary: string; // crest fill
  ring: string; // crest ring
  text: string; // initials color
}

export type FormResult = "W" | "D" | "L";

export interface Player {
  id: string;
  name: string;
  number: number;
  pos: "GK" | "DEF" | "MID" | "FWD";
  /** 0–100 horizontal position on the pitch (50 = center) */
  x: number;
  /** 0–100 vertical position on the pitch (0 = attack / top, 100 = own goal) */
  y: number;
  highlight?: boolean;
  hasBall?: boolean;
}

export interface Match {
  id: string;
  leagueId: string;
  home: Team; // displayed on the left
  away: Team; // displayed on the right
  time: string;
  date: string;
  isLive: boolean;
  score?: [number, number]; // [home, away]
  viewers?: number;
  /** win probability, used for the 1X2 pills */
  odds: { home: number; draw: number; away: number };
  /** decimal odds shown in the bet sheet */
  oddsDecimal: { home: number; draw: number; away: number };
  form: { home: FormResult[]; away: FormResult[] };
  formation: string;
  players: Player[];
}

export interface League {
  id: string;
  label: string;
  tag: string;
}

export const LEAGUES: League[] = [
  { id: "premier", label: "Premier League", tag: "PREMIER" },
  { id: "national", label: "National League", tag: "NATIONAL" },
  { id: "uefa", label: "UEFA Champions", tag: "UEFA" },
];

export const TEAMS: Record<string, Team> = {
  mu: {
    id: "mu",
    label: "MANCHESTER UNITED",
    short: "MANCH",
    initials: "MU",
    primary: "#DA291C",
    ring: "#FBE122",
    text: "#FFFFFF",
  },
  che: {
    id: "che",
    label: "FC CHELSEA",
    short: "CH",
    initials: "CFC",
    primary: "#034694",
    ring: "#4A6FC4",
    text: "#FFFFFF",
  },
  bar: {
    id: "bar",
    label: "FC BARCELONA",
    short: "BAR",
    initials: "FCB",
    primary: "#A50044",
    ring: "#EDBB00",
    text: "#FFFFFF",
  },
  ars: {
    id: "ars",
    label: "FC ARSENAL",
    short: "ARS",
    initials: "AFC",
    primary: "#EF0107",
    ring: "#F2F2F2",
    text: "#FFFFFF",
  },
  wre: {
    id: "wre",
    label: "WREXHAM AFC",
    short: "WREX",
    initials: "WRE",
    primary: "#DF0024",
    ring: "#F2F2F2",
    text: "#FFFFFF",
  },
  not: {
    id: "not",
    label: "NOTTS COUNTY",
    short: "NOTTS",
    initials: "NC",
    primary: "#232323",
    ring: "#F2F2F2",
    text: "#FFFFFF",
  },
  yor: {
    id: "yor",
    label: "YORK CITY",
    short: "YORK",
    initials: "YC",
    primary: "#5A1873",
    ring: "#B58AD1",
    text: "#FFFFFF",
  },
  sol: {
    id: "sol",
    label: "SOLIHULL MOORS",
    short: "SOLI",
    initials: "SM",
    primary: "#8a1a03",
    ring: "#F2A26D",
    text: "#FFFFFF",
  },
  rma: {
    id: "rma",
    label: "REAL MADRID",
    short: "RMA",
    initials: "RM",
    primary: "#F2F2F2",
    ring: "#FEBE10",
    text: "#1A1A1A",
  },
  bay: {
    id: "bay",
    label: "BAYERN MÜNCHEN",
    short: "BAY",
    initials: "FCB",
    primary: "#DC052D",
    ring: "#F2F2F2",
    text: "#FFFFFF",
  },
  psg: {
    id: "psg",
    label: "PARIS SG",
    short: "PSG",
    initials: "PSG",
    primary: "#004170",
    ring: "#DA291C",
    text: "#FFFFFF",
  },
  juv: {
    id: "juv",
    label: "JUVENTUS",
    short: "JUV",
    initials: "JUV",
    primary: "#1A1A1A",
    ring: "#F2F2F2",
    text: "#FFFFFF",
  },
  liv: {
    id: "liv",
    label: "LIVERPOOL FC",
    short: "LIV",
    initials: "LFC",
    primary: "#C8102E",
    ring: "#F2F2F2",
    text: "#FFFFFF",
  },
  tot: {
    id: "tot",
    label: "TOTTENHAM",
    short: "TOT",
    initials: "TOT",
    primary: "#132257",
    ring: "#8B9CD6",
    text: "#FFFFFF",
  },
  sou: {
    id: "sou",
    label: "SOUTHEND UNITED",
    short: "SOU",
    initials: "SOU",
    primary: "#0057B8",
    ring: "#7FA8E0",
    text: "#FFFFFF",
  },
  hal: {
    id: "hal",
    label: "FC HALIFAX",
    short: "HAL",
    initials: "HAL",
    primary: "#F2A900",
    ring: "#2A2A2A",
    text: "#141414",
  },
  int: {
    id: "int",
    label: "INTER",
    short: "INT",
    initials: "INT",
    primary: "#0068A8",
    ring: "#F2F2F2",
    text: "#FFFFFF",
  },
  mil: {
    id: "mil",
    label: "AC MILAN",
    short: "MIL",
    initials: "ACM",
    primary: "#FB090B",
    ring: "#1A1A1A",
    text: "#FFFFFF",
  },
};

/** 4-3-3 shape used for every lineup (x/y in % of the pitch box) */
function lineup(names: [string, number][], highlights: number[] = [], ballAt?: number): Player[] {
  const spots: { pos: Player["pos"]; x: number; y: number }[] = [
    // attack
    { pos: "FWD", x: 20, y: 12 },
    { pos: "FWD", x: 50, y: 9 },
    { pos: "FWD", x: 80, y: 12 },
    // midfield
    { pos: "MID", x: 18, y: 36 },
    { pos: "MID", x: 50, y: 33 },
    { pos: "MID", x: 82, y: 36 },
    // defence
    { pos: "DEF", x: 12, y: 60 },
    { pos: "DEF", x: 38, y: 63 },
    { pos: "DEF", x: 62, y: 63 },
    { pos: "DEF", x: 88, y: 60 },
    // keeper
    { pos: "GK", x: 50, y: 84 },
  ];
  return names.map(([name, number], i) => ({
    id: `p${i}-${number}`,
    name,
    number,
    pos: spots[i].pos,
    x: spots[i].x,
    y: spots[i].y,
    highlight: highlights.includes(i),
    hasBall: ballAt === i,
  }));
}

export const MATCHES: Match[] = [
  {
    id: "mu-che",
    leagueId: "premier",
    home: TEAMS.mu,
    away: TEAMS.che,
    time: "7:30",
    date: "08 September",
    isLive: true,
    score: [1, 2],
    viewers: 14500,
    odds: { home: 31, draw: 22, away: 47 },
    oddsDecimal: { home: 3.1, draw: 4.2, away: 1.95 },
    form: {
      home: ["W", "D", "W", "L", "W"],
      away: ["W", "W", "D", "W", "L"],
    },
    formation: "4-3-3",
    players: lineup(
      [
        ["J. Kelvin", 7],
        ["E. Feyter", 9],
        ["J. Darke", 11],
        ["A. Wanis", 18],
        ["M. Lawson", 8],
        ["D. Mitchell", 14],
        ["D. Harper", 23],
        ["H. Brooksby", 5],
        ["A. Price", 4],
        ["W. Cooper", 2],
        ["D. Degea", 1],
      ],
      [1, 4, 10], // E. Feyter, M. Lawson, D. Degea highlighted
      4, // ball at M. Lawson
    ),
  },
  {
    id: "bar-ars",
    leagueId: "premier",
    home: TEAMS.bar,
    away: TEAMS.ars,
    time: "10:45",
    date: "08 September",
    isLive: false,
    odds: { home: 42, draw: 26, away: 32 },
    oddsDecimal: { home: 2.2, draw: 3.6, away: 2.9 },
    form: {
      home: ["W", "W", "W", "D", "L"],
      away: ["D", "W", "L", "W", "W"],
    },
    formation: "4-3-3",
    players: lineup([
      ["R. Torres", 14],
      ["L. Vargas", 9],
      ["P. Ortega", 10],
      ["S. Moreno", 21],
      ["T. Aguilar", 8],
      ["N. Castillo", 16],
      ["G. Suarez", 22],
      ["F. Mendez", 5],
      ["C. Vidal", 4],
      ["M. Ito", 2],
      ["A. Rocha", 1],
    ]),
  },
  {
    id: "liv-tot",
    leagueId: "premier",
    home: TEAMS.liv,
    away: TEAMS.tot,
    time: "13:00",
    date: "15 September",
    isLive: false,
    odds: { home: 36, draw: 28, away: 36 },
    oddsDecimal: { home: 2.55, draw: 3.3, away: 2.55 },
    form: {
      home: ["W", "W", "L", "W", "D"],
      away: ["D", "L", "W", "W", "W"],
    },
    formation: "4-3-3",
    players: lineup([
      ["L. Diaz", 7],
      ["S. Jota", 9],
      ["M. Salah", 11],
      ["A. Mac", 18],
      ["R. Grav", 8],
      ["D. Szobo", 14],
      ["V. Van", 23],
      ["I. Konate", 5],
      ["A. Robbo", 4],
      ["T. Bradley", 2],
      ["A. Becker", 1],
    ]),
  },
  {
    id: "wre-not",
    leagueId: "national",
    home: TEAMS.wre,
    away: TEAMS.not,
    time: "3:00",
    date: "12 September",
    isLive: false,
    odds: { home: 38, draw: 28, away: 34 },
    oddsDecimal: { home: 2.45, draw: 3.35, away: 2.75 },
    form: {
      home: ["W", "L", "W", "W", "D"],
      away: ["D", "D", "W", "L", "W"],
    },
    formation: "4-3-3",
    players: lineup([
      ["B. Aldridge", 11],
      ["O. Palmer", 9],
      ["S. Hoskins", 7],
      ["J. Young", 17],
      ["E. Evans", 8],
      ["A. Davies", 14],
      ["L. Reddy", 3],
      ["M. Hayden", 6],
      ["D. Jones", 5],
      ["R. Benton", 2],
      ["K. Fisher", 1],
    ]),
  },
  {
    id: "yor-sol",
    leagueId: "national",
    home: TEAMS.yor,
    away: TEAMS.sol,
    time: "5:15",
    date: "12 September",
    isLive: false,
    odds: { home: 45, draw: 25, away: 30 },
    oddsDecimal: { home: 2.05, draw: 3.7, away: 2.95 },
    form: {
      home: ["W", "W", "D", "D", "W"],
      away: ["L", "W", "D", "W", "L"],
    },
    formation: "4-3-3",
    players: lineup([
      ["D. Adu", 7],
      ["M. Kelsey", 9],
      ["T. Gascoigne", 11],
      ["P. Holmes", 18],
      ["C. Batts", 8],
      ["K. Noah", 14],
      ["J. Ingham", 23],
      ["W. Longbottom", 5],
      ["H. Wall", 4],
      ["S. Fallowfield", 2],
      ["B. Streeten", 1],
    ]),
  },
  {
    id: "sou-hal",
    leagueId: "national",
    home: TEAMS.sou,
    away: TEAMS.hal,
    time: "7:45",
    date: "13 September",
    isLive: false,
    odds: { home: 41, draw: 27, away: 32 },
    oddsDecimal: { home: 2.25, draw: 3.4, away: 2.85 },
    form: {
      home: ["W", "D", "W", "W", "L"],
      away: ["L", "D", "W", "D", "W"],
    },
    formation: "4-3-3",
    players: lineup([
      ["J. mars", 7],
      ["C. Kelman", 9],
      ["O. Broad", 11],
      ["H. Bridge", 18],
      ["R. Kinsella", 8],
      ["D. Worrall", 14],
      ["J. Turner", 23],
      ["O. Hutchinson", 5],
      ["S. Husin", 4],
      ["G. Monlouis", 2],
      ["T. Collins", 1],
    ]),
  },
  {
    id: "rma-bay",
    leagueId: "uefa",
    home: TEAMS.rma,
    away: TEAMS.bay,
    time: "21:00",
    date: "18 September",
    isLive: false,
    odds: { home: 40, draw: 25, away: 35 },
    oddsDecimal: { home: 2.3, draw: 3.65, away: 2.65 },
    form: {
      home: ["W", "W", "W", "W", "D"],
      away: ["W", "D", "W", "W", "W"],
    },
    formation: "4-3-3",
    players: lineup([
      ["V. Rodo", 7],
      ["K. Bjorn", 9],
      ["A. Silvo", 11],
      ["F. Korena", 18],
      ["L. Modra", 8],
      ["T. Kroos", 14],
      ["N. Carvo", 23],
      ["A. Rudo", 5],
      ["D. Carvajal", 4],
      ["F. Mendy", 2],
      ["T. Court", 1],
    ]),
  },
  {
    id: "psg-juv",
    leagueId: "uefa",
    home: TEAMS.psg,
    away: TEAMS.juv,
    time: "21:00",
    date: "18 September",
    isLive: false,
    odds: { home: 45, draw: 30, away: 25 },
    oddsDecimal: { home: 2.0, draw: 3.05, away: 3.55 },
    form: {
      home: ["W", "D", "W", "W", "W"],
      away: ["D", "W", "W", "D", "L"],
    },
    formation: "4-3-3",
    players: lineup([
      ["O. Dembe", 10],
      ["G. Ramos", 9],
      ["K. Barcola", 11],
      ["V. Ferrei", 17],
      ["J. Neves", 8],
      ["F. Ruiz", 14],
      ["N. Mendes", 25],
      ["M. Pacho", 5],
      ["W. Pembele", 4],
      ["A. Hakimi", 2],
      ["G. Donna", 1],
    ]),
  },
  {
    id: "int-mil",
    leagueId: "uefa",
    home: TEAMS.int,
    away: TEAMS.mil,
    time: "18:45",
    date: "19 September",
    isLive: false,
    odds: { home: 44, draw: 26, away: 30 },
    oddsDecimal: { home: 2.1, draw: 3.55, away: 2.9 },
    form: {
      home: ["W", "D", "D", "W", "W"],
      away: ["W", "W", "L", "D", "W"],
    },
    formation: "4-3-3",
    players: lineup([
      ["M. Thuram", 9],
      ["L. Martinez", 10],
      ["F. Dimarco", 32],
      ["H. Calha", 20],
      ["N. Barella", 23],
      ["H. Mkhit", 22],
      ["A. Bastoni", 95],
      ["F. Acerbi", 15],
      ["B. Pavard", 28],
      ["Y. Bisseck", 31],
      ["Y. Sommer", 1],
    ]),
  },
];

export interface StandingRow {
  team: Team;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  gd: number;
  points: number;
}

export const TABLE: StandingRow[] = [
  { team: TEAMS.che, played: 5, won: 4, drawn: 1, lost: 0, gd: 9, points: 13 },
  { team: TEAMS.mu, played: 5, won: 3, drawn: 1, lost: 1, gd: 5, points: 10 },
  { team: TEAMS.ars, played: 5, won: 3, drawn: 0, lost: 2, gd: 3, points: 9 },
  { team: TEAMS.bar, played: 5, won: 2, drawn: 1, lost: 2, gd: 1, points: 7 },
  { team: TEAMS.rma, played: 4, won: 2, drawn: 1, lost: 1, gd: 2, points: 7 },
  { team: TEAMS.bay, played: 4, won: 1, drawn: 2, lost: 1, gd: 0, points: 5 },
];

export interface StatRow {
  label: string;
  home: number;
  away: number;
  unit?: string;
}

export const STATS: StatRow[] = [
  { label: "Possession", home: 58, away: 42, unit: "%" },
  { label: "Shots on target", home: 6, away: 8 },
  { label: "Total shots", home: 12, away: 15 },
  { label: "Corners", home: 5, away: 7 },
  { label: "Pass accuracy", home: 87, away: 91, unit: "%" },
  { label: "Saves", home: 3, away: 5 },
  { label: "Offsides", home: 2, away: 1 },
  { label: "Fouls", home: 9, away: 6 },
  { label: "Yellow cards", home: 2, away: 3 },
];

export function formatViewers(v: number): string {
  if (v >= 1000) {
    const k = v / 1000;
    return `${k >= 100 ? Math.round(k) : k.toFixed(1)}k`;
  }
  return `${v}`;
}
