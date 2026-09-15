// ============================================================
// VOLTRIX bet — versionnement du modèle (plan V2→V3, étape 14)
// Une version est IMMUABLE après validation : toute modification
// du moteur (variable ajoutée/retirée, pondération, calibration)
// doit créer une nouvelle version et ne jamais réécrire les
// prédictions existantes (elles restent rattachées à leur version).
// v2.1 : moteur post-audit 21 (calibration dans runEngine, BTTS
//        forme fermée, consensus argmax, value sur brut, météo hors λ).
// Le flag d'ablation context 'full'|'none' (plan étape 11) est un
// instrument de mesure : défaut 'full' = comportement v2.1 inchangé,
// donc pas de bump de version.
// ============================================================
export const MODEL_VERSION = 'v2.1';
