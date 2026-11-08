"use client";

/* ============================================================
   VOLTRIX front — Résolution des écussons d'équipes
   1. Logo fourni par l'API (URL ESPN distante, mode live)
   2. Sinon : logo local téléchargé depuis le CDN ESPN
      (public/logos/, mapping auto-généré + alias FR)
   3. Sinon : médaillon à initiales (TeamBadge)
   ============================================================ */

import { TEAM_LOGOS } from "./team-logos.generated";

/** Alias (FR, noms courts) → nom exact ESPN. */
const ALIASES: Record<string, string> = {
  Tottenham: "Tottenham Hotspur",
  "Spurs": "Tottenham Hotspur",
  Newcastle: "Newcastle United",
  "FC Barcelone": "Barcelona",
  Barcelone: "Barcelona",
  Séville: "Sevilla",
  Betis: "Real Betis",
  Inter: "Internazionale",
  "Inter Milan": "Internazionale",
  Naples: "Napoli",
  Roma: "AS Roma",
  Bayern: "Bayern Munich",
  Stuttgart: "VfB Stuttgart",
  Francfort: "Eintracht Frankfurt",
  "Paris SG": "Paris Saint-Germain",
  PSG: "Paris Saint-Germain",
  "Man City": "Manchester City",
  "Man United": "Manchester United",
  "MU": "Manchester United",
  Monaco: "AS Monaco",
  "BvB": "Borussia Dortmund",
  "BVB": "Borussia Dortmund",
  "Leverkusen": "Bayer Leverkusen",
  "Leicester": "Leicester City",
  "Wolves": "Wolverhampton Wanderers",
  "Brighton": "Brighton & Hove Albion",
  "West Ham": "West Ham United",
  "Leeds": "Leeds United",
  "Sheffield United": "Sheffield United",
  "Celta": "Celta Vigo",
  "Atalanta": "Atalanta",
  "Bologne": "Bologna",
  "Bologne FC": "Bologna",
  "Francfort ": "Eintracht Frankfurt",
};

const LOWER = new Map<string, string>();
for (const [k, v] of Object.entries(TEAM_LOGOS)) LOWER.set(k.toLowerCase(), v);
for (const [alias, target] of Object.entries(ALIASES)) {
  const t = TEAM_LOGOS[target];
  if (t) LOWER.set(alias.toLowerCase(), t);
}

/** Nom d'équipe (FR ou EN) → chemin de logo local, ou null. */
export function resolveTeamLogo(name: string | null | undefined): string | null {
  if (!name) return null;
  return LOWER.get(name.trim().toLowerCase()) ?? null;
}
