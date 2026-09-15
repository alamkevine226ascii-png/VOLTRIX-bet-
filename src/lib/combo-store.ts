// ============================================================
// VOLTRIX bet — Stockage local du ticket combiné
// Permet à la page plein écran /combo/ticket d'afficher le
// dernier combiné généré (noms d'équipes et marchés complets)
// via localStorage, sans rien passer dans l'URL.
// ============================================================

import type { ComboResult, RiskProfile } from './combo';

export interface StoredComboTicket {
  savedAt: number; // epoch ms de la génération
  matchDate: string; // journée sélectionnée (YYYY-MM-DD)
  targetOdds: number; // côte cible demandée
  profile: RiskProfile; // profil de risque utilisé
  combo: ComboResult; // le ticket complet
}

const KEY = 'voltrix_combo_ticket';

/** Enregistre (ou remplace) le dernier ticket généré sur l'appareil. */
export function saveComboTicket(ticket: StoredComboTicket): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(ticket));
  } catch {
    // quota dépassé / navigation privée : la page plein écran montrera l'état vide
  }
}

/** Relit le dernier ticket généré, ou null s'il n'existe pas / est corrompu. */
export function loadComboTicket(): StoredComboTicket | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredComboTicket;
    if (!parsed || !Array.isArray(parsed.combo?.legs) || parsed.combo.legs.length === 0) return null;
    return parsed;
  } catch {
    return null;
  }
}
