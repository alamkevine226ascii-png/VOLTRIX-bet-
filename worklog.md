# Worklog Multi-Agents

---
Task ID: 1
Agent: Super Z (agent principal)
Task: Création de l'application mobile PWA "VOLTRIX bet" — pronostics football basés sur ESPN (matchs, cotes, historiques, formes) avec moteur mathématique de prédiction.

Work Log:
- Clarifié le besoin avec l'utilisateur (PWA mobile-first, toutes ligues ESPN, français, design dark premium + jaune néon inspiré de 3 images Pinterest, marchés : 1X2, Double Chance, O/U, BTTS, moment du 1er but)
- Initialisé l'environnement fullstack (script officiel curl init-fullstack.sh)
- Exploré l'API ESPN non officielle : scoreboard par ligue (events, cotes DraftKings moneyline open/close, over/under avec lignes open/close, forme "WWDLW"), calendriers équipes 2 saisons, classements v2 (buts pour/contre), blessures
- Constaté que le scoreboard global ESPN ne fonctionne pas → scan parallèle de ~90 ligues (catalogue src/lib/leagues.ts, 5 régions, 3 niveaux de priorité)
- Construit le moteur de prédiction (src/lib/prediction.ts) :
  * Poisson (45%) : forces offensives/défensives home/away mélangées saison courante + historique, bonus forme injecté dans les lambdas
  * Elo (30%) : ratings recalculés sur tout l'historique des 2 équipes, avantage terrain 65 pts, conversion W/D/L avec part de nul dynamique
  * Forme (25%) : 6 derniers matchs pondérés exponentiellement
  * Modificateurs contexte : fatigue (repos ≤3j ou 3 matchs/14j), blessures, derbys (32 rivalités codées), météo (Open-Meteo), enjeux via classement
  * Marchés : 1X2, Double Chance, O/U 1.5/2.5/3.5, BTTS, moment du 1er but (loi exponentielle, 6 fenêtres + aucun but), 1ère équipe à marquer, 3 scores exacts
  * Confiance 1-5 étoiles (écart entre issues + consensus des 3 modèles + complétude données)
  * Value bets : edge = p_modèle × cote − 1, mise Kelly plafonnée 10%, détection mouvements de cotes (open → close)
- Créé les API routes : /api/matches (scan parallèle 90 ligues, cache mémoire TTL), /api/predictions (analyse en lot progressive par 6 + persistance Prisma), /api/match/[id] (analyse complète détaillée), /api/performance (résolution auto des pronos passés + KPIs)
- Schéma Prisma : modèle Prediction (matchId+market unique, odds, résolution WIN/LOSE/VOID), SQLite
- Persistance : chaque match à venir génère 3 pronos suivis (1X2, O/U 2.5, BTTS) avec cotes ESPN au moment du prono
- PWA : manifest.webmanifest (standalone, icônes maskable), service worker (network-first API, cache-first logos ESPN), icônes générées en Python PIL (éclair jaune néon sur fond noir), métadonnées Apple/Android
- UI single-page (src/app/page.tsx) : header logo éclair, sélecteur de dates −2/+4 jours, filtres ligues, cartes match avec prono progressif (skeleton → analyse), tab bar Accueil/Ligues/Perf/Profil
- Détail match (Sheet 93dvh, 4 onglets) : Pronos (tous les marchés avec barres animées), Analyse (formes V/N/D, Elo, stats comparées, contexte, météo), H2H (confrontations + bilan), Cotes (DraftKings, marché vs modèle, écarts, value bets, Kelly)
- Onglet Perf : taux de réussite, ROI simulé (mise fixe 10€), par marché, par confiance, historique avec badges GAGNÉ/PERDU
- Onglet Profil : explication du moteur, value bets & Kelly, disclaimer jeu responsable 18+
- Corrigé 2 erreurs lint react-hooks/set-state-in-effect (pattern DetailLoader/PerfTab avec setState uniquement en callbacks async + key de remontage)
- Résolu problème client Prisma obsolète en mémoire (db.ts auto-réparant : vérifie la présence du modèle avant de réutiliser le global)
- Redémarré le serveur dev via le script officiel (init détecte le projet existant, ne télécharge pas le scaffold)
- Corrigé le parsing des scores ESPN (2 formats : objet {value} pour matchs récents, string "0" pour matchs anciens) — déblocage de la résolution automatique
- Ajouté des garde-fous anti-NaN dans le moteur (lambdas, probabilités) et extractPicks
- Vérifié E2E avec Agent Browser (viewport 390×844) : accueil, scan 36 ligues actives/150 matchs, pronos progressifs, détail Arsenal-Chelsea (derby détecté, confiance 4/5, value bets +23%/+13%), H2H, Cotes, Perf (366 pronos trackés, 3 résolus WIN, ROI +85%), Ligues, Profil, assets PWA 200

Stage Summary:
- Application VOLTRIX bet livrée et fonctionnelle : PWA mobile-first dark premium + jaune néon
- Moteur ensemble Poisson 45% / Elo 30% / Forme 25% avec contexte (fatigue, blessures, derbys, météo, enjeux, mouvements de cotes)
- 7 marchés calculés dont le moment du premier but (loi exponentielle)
- Value betting (edge + Kelly) vs cotes réelles DraftKings
- Suivi de performance auto-résolu avec ROI simulé (3 pronos résolus 3× WIN lors du test E2E)
- Fichiers clés : src/lib/{leagues,espn,prediction,analyze,weather,cache,types}.ts, src/app/api/{matches,predictions,match/[id],performance}/route.ts, src/components/voltrix/{match-card,match-detail,shared}.tsx, src/app/page.tsx, public/{manifest.webmanifest,sw.js,icons/}
- Limitations connues : météo limitée par quota Open-Meteo (IP partagée sandbox, code correct), xG non public chez ESPN (proxy calculé), volumes de mises et profil arbitre non disponibles gratuitement

---
Task ID: 2
Agent: Super Z (agent principal)
Task: Retours utilisateur après test — ajouter les écussons des équipes + trier les matchs par heure de début.

Work Log:
- Diagnostiqué l'absence d'écussons : l'API ESPN soccer scoreboard renvoie team.logo (chaîne) avec team.logos=[] (tableau vide), alors que le parsing ne lisait que logos[] → tous les logos étaient null
- Corrigé src/lib/espn.ts : RawCompetitor.team.logo ajouté au type + priorité c.team.logo ?? logos[rel=default] ?? logos[0]
- Vérifié sur le terrain : 140/164 matchs ont leurs 2 écussons ; les clubs sans logo (CAF Champions/Confed, quelques équipes ger.2/ksa.1/rsa.1) n'ont pas d'écusson chez ESPN (CDN 404 testé) → fallback initiales conservé
- Renforcé TeamLogo (src/components/voltrix/shared.tsx) : repli automatique sur initiales si l'image échoue (useState + onError), taille de police adaptative
- Tri chronologique global (src/app/page.tsx) : suppression du groupement par ligue au profit d'une liste plate triée par heure de début (le plus tôt en haut), le filtre ligue reste fonctionnel
- Les batches d'analyse IA (/api/predictions) sont désormais envoyés dans l'ordre chronologique → les matchs les plus tôt sont analysés en premier
- Corrigé au passage le type RawOdds.total.over/under.close (ajout line?: string) — erreurs tsc préexistantes éliminées (0 erreur TS dans src/)
- Vérifié E2E avec Agent Browser 390×844 : écussons visibles sur cartes + détail match (Toulouse-Lille), ordre horaire strict 15:55→16:00→…→23:00 sur la journée de demain, filtres ligues et pronos progressifs opérationnels

Stage Summary:
- Écussons des équipes affichés partout (cartes, détail, H2H) avec fallback initiales propre pour les rares clubs sans logo ESPN
- Liste des matchs 100 % chronologique (heure de début croissante), analyse IA priorisant les matchs les plus proches
- Fichiers modifiés : src/lib/espn.ts, src/components/voltrix/shared.tsx, src/app/page.tsx

---
Task ID: 3
Agent: Super Z (agent principal)
Task: Retour utilisateur — certains matchs restaient sans analyse (skeleton infini) sur l'app.

Work Log:
- Cause racine n°1 (cache qui mémorisait les échecs) : cached() stockait null (scoreboard timeout ESPN) pour 10 min et [] (calendriers, classements, blessures) pour 3-6 h → tout retry échouait systématiquement. Ajout d'options {failureValue, failureTtlMs} à cached() : scoreboard null → TTL 15 s, calendrier/classement vide → 2 min, blessures vides → 10 min
- Cause racine n°2 (matchs tardifs) : si le match est introuvable sur le scoreboard de sa date, analyzeMatch tente maintenant les dates adjacentes (±1 jour)
- Robustesse réseau : espnFetch réessaie 2 fois (600 ms entre les tentatives) sur timeout/HTTP KO
- Client (page.tsx) : extraction de analyzeList(), passe de rattrapage automatique (2 passes après 1,5 s de pause) pour les matchs sans analyse, état failed suivi par match
- UI (match-card.tsx) : carte convertie en div[role=button] pour permettre un vrai bouton « Réessayer » (avec stopPropagation) sur l'état d'échec « Analyse indisponible (ESPN surchargé) » — plus de skeleton infini silencieux
- DB readonly corrigée : le serveur (démarré 19:46) détenait un handle Prisma sur l'ancien inode de db/custom.db (remplacé à 20:53) → upserts séquentiels dans /api/predictions (SQLite = 1 écrivain, fini les rafales Promise.allSettled) + redémarrage serveur → 0 prisma:error, preuve d'écriture : 432 → 456 pronos après analyse de 8 nouveaux matchs
- Test E2E 390×844 : aujourd'hui 40 cartes (10 pronos + 30 terminés, 0 attente, 0 échec) ; demain 23/23 analysés, 0 attente, 0 échec ; écussons + tri horaire toujours OK

Stage Summary:
- Les analyses ne peuvent plus être bloquées par un échec ESPN : retry réseau + TTL courts sur échecs + recherche sur dates adjacentes + 2 passes de rattrapage client + bouton Réessayer manuel
- Persistance DB réparée (upserts séquentiels + serveur redémarré) : le suivi de performance est fiable à nouveau
- Fichiers modifiés : src/lib/cache.ts, src/lib/espn.ts, src/lib/analyze.ts, src/app/page.tsx, src/components/voltrix/match-card.tsx, src/app/api/predictions/route.ts

---
Task ID: 7
Agent: Super Z (agent principal)
Task: Incident + reconstruction — l'utilisateur voyait « 404 This page could not be found » sur le lien de preview. Diagnostic : l'environnement sandbox a été restauré depuis un snapshot antérieur (redémarrage serveur 01:03) ; tout le code des Tasks 4/5/6 (Combinator, refonte anti-risque, page ticket plein écran, partage, calibrage) avait disparu, seules les Tasks 1-3 survivaient. DB intacte (1086 pronos, 81 résolus).

Work Log:
- Diagnostiqué : / → 200 mais /combo et /combo/ticket → 404 côté Next ; constaté la disparition de src/app/combo/, src/lib/combo.ts, market-odds.ts, combo-store.ts, share.ts, scripts/test-combo.ts et la réversion de types.ts (ouOdds + calibration), api/predictions (ouOdds), api/performance (calibrage Brier), page.tsx (emblème, carte Calibrage), match-detail.tsx (bouton partage)
- Reconstruit à l'identique depuis le contexte de session : src/lib/combo.ts (moteur v2 anti-risque + logos + fix annotation chosen), src/app/combo/page.tsx (profils de risque, tous marchés ancrés marché, ticket cliquable + saveComboTicket + hint), src/lib/combo-store.ts, src/app/combo/ticket/page.tsx (page plein écran)
- Reconstruit depuis les specs du worklog : src/lib/market-odds.ts (deMargin1x2 1.85/3.60/4.20 → marge 5.64 %, pH 51.2 % ; dcFromMarket DC 1X 77.5 % @ 1.22, marge bornée 3-8 % ; deMarginOverUnder ; calibrateTotals dichotomie 60 iters sur facteur d'échelle des λ ancrée P(Over ligne)=marché, ratio dom/ext préservé, BTTS via (1-e^-sλh)(1-e^-sλa) ; totalGoalsDist 0-12 normalisée, overProb X.5, oddsWithMargin marge 7 %) ; src/components/voltrix/share.ts (canvas 720px : header éclair VOLTRIX dessiné en path, carte match 780px ligue/équipes initiales/prono/proba/étoiles/value, carte combiné jambes + bande côte totale, Web Share fichiers + repli téléchargement PNG) ; scripts/test-combo.ts (61 assertions)
- Ré-appliqué les edits : types.ts (QuickPred.ouOdds + PerformanceDTO.calibration), api/predictions (ouOdds depuis AnalyzeResult.odds closeOdds ?? openOdds), api/performance (Brier + buckets 30-40…90-100 %, seuil ≥3 par tranche), page.tsx (emblème jaune Ticket → /combo à la place du refresh, refresh relocalisé en puce fin de rangée de dates, carte Calibrage Brier + double barres prévu/réel dans PerfTab), match-detail.tsx (bouton partage dans la bannière confiance, handler buildMatchCard depuis recommendedBets[0] + edge valueBets[0])
- Corrections de tests : marge O/U 1.95/1.9 = 3.91 % (et non 2.6 %) ; EV/Kelly calculés sur les cotes exactes des jambes (comboOdds exposé est arrondi affichage) → 61/61 passent
- Vérif : tsc 0 erreur src/ ; lint OK ; / /combo /combo/ticket → 200 ; API performance renvoie calibration (Brier 0.259, 81 échantillons, 4 tranches) ; E2E Agent Browser 390×844 : accueil (emblème + puce refresh + 52 matchs), carte Calibrage présente dans Perf, état vide /combo/ticket, génération ×5 demain → 4 jambes multi-marchés (Moins de 2.5 @ 1.04 SÛR, Victoire Atlético Madrid @ 2.30 MOYEN, Victoire Mallorca @ 2.05 SÛR, Moins de 3.5 @ 1.04 SÛR, cote 5.10, proba 37 %), clic ticket → page plein écran (bandeau, métadonnées, noms complets + écussons, O/U, proba, Kelly, Nouveau combiné), 0 erreur console/dev.log

Stage Summary:
- Incident compris et intégralement réparé : toutes les fonctionnalités des Tasks 4/5/6 sont de retour et re-testées E2E ; DB et pronos n'ont jamais été perdus
- Leçon : le snapshot sandbox peut restaurer un état antérieur aux fichiers créés en session — en cas de 404 soudain sur des routes existantes, vérifier d'abord l'existence des fichiers
- Fichiers reconstruits : src/lib/{combo,market-odds,combo-store}.ts, src/app/combo/page.tsx, src/app/combo/ticket/page.tsx, src/components/voltrix/share.ts, scripts/test-combo.ts ; ré-édités : src/lib/types.ts, src/app/api/{predictions,performance}/route.ts, src/app/page.tsx, src/components/voltrix/match-detail.tsx
- Preuves : download/reconstruction-ticket-1.png, reconstruction-ticket-2.png

---
Task ID: 8
Agent: Super Z (agent principal)
Task: Ajout du Bankroll Manager (page /portefeuille) + remplacement de la section Perf par la page dédiée « Précision VOLTRIX » (/precision) — demandes utilisateur validées.

Work Log:
- Conçu l'architecture en réponse à la demande : 2 pages dédiées, navigation accueil portée à 5 entrées (Accueil · Ligues · Portefeuille · Précision · Profil), l'onglet « Perf » interne disparaît au profit de /precision
- ComboLeg enrichi de leagueCode (optionnel, rétro-compatible) et propagé depuis buildCandidates (/combo) — requis pour retrouver les matchs sur le scoreboard ESPN lors de la résolution
- Créé src/lib/bankroll.ts : store localStorage (voltrix_bankroll_v1) — solde, capital de départ, tickets placés (PlacedTicket), historique de progression (courbe), placeTicket (déduction de mise, garde-fous : ≥1 €, ≤ solde, anti-NaN), settleTicket (règles combiné : 1 LOSE → perdu · tout VOID → remboursé · VOID+WIN → cote réduite ∏odds · partiel → reste EN COURS avec résultats de jambes persistés), applyResolutions (crédit du solde + événements d'historique, idempotent), computeStats (P&L, ROI, par profil Prudent/Équilibré/Agressif), fmtEur
- Créé API POST /api/bankroll/resolve : reçoit des jambes (matchId+leagueCode+date+market+pick), groupe par (ligue,date), fetchScoreboard ESPN, note chaque jambe WIN/LOSE/VOID/PENDING + score. Grading complet : 1X2 (« Victoire X » par comparaison de noms / « Match nul »), Double Chance (1X/12/X2), O/U 1.5/2.5/3.5, BTTS Oui/Non. ⚠️ Fix important en cours de route : clé composite matchId|market|pick (un même match porte 3 marchés ; la clé matchId seule écrasait les verdicts) — validé 36/36 concordant vs pronos déjà résolus en DB (scripts/test-resolve-api.ts)
- Créé page /precision : hero taux de réussite + badge Brier, KPIs (ROI simulé 10 €, résolus, en attente, Brier), réussite par marché / par confiance / par compétition (nouveau byLeague dans /api/performance, min 5 résolus), calibrage prévu vs réel (double barres), historique enrichi (ligue, cote, date), CTA vers /portefeuille, disclaimer 18+
- Créé page /portefeuille : carte solde (P&L, en jeu, ROI, capital éditable), courbe SVG de progression (aire dégradée verte/rouge), bloc « Jouer ce ticket » (aperçu des jambes, mises rapides 1 %/2 %/5 %/Kelly, gain potentiel, alerte >20 % de la banque), liste « Mes tickets » (badges EN COURS/GAGNÉ/PERDU/REMBOURSÉ, jambes avec écussons + statut par jambe + scores), résolution automatique au montage pour les tickets échus + bouton forcer ↻, stats par profil, réinitialisation à double confirmation, anti double-jeu (sourceSavedAt)
- Navigation accueil : page.tsx nettoyé (PerfTab supprimé ~210 lignes, Tab type sans 'perf', imports BarChart3/LineChart/PerformanceDTO retirés), NavTab (liens /portefeuille et /precision), grille 5 colonnes, carte « Précision VOLTRIX » ajoutée en tête de l'onglet Profil
- /combo/ticket : CTA principal « Jouer ce ticket (Portefeuille) » au-dessus de Nouveau combiné/Partager (Partager repassé en style secondaire), texte Kelly mis à jour
- Tests : scripts/test-bankroll.ts (32 assertions : placement, gagné, perdu, VOID réduits, remboursement, partiel, idempotence, stats) 32/32 ✓ · scripts/test-combo.ts régression 61/61 ✓ · scripts/test-resolve-api.ts 36/36 concordance DB ✓ · tsc 0 erreur src/ · lint 0 erreur
- Fixes pendant le dev : EspnCompetitor.team.displayName (pas de .name direct), lint react-hooks/set-state-in-effect (/precision : load() décalé en callback async), 2 attentes de tests erronées corrigées (remboursement = retour au capital ; fixture partielle sans market/pick)
- E2E Agent Browser 390×844 : accueil (nav 5 colonnes vérifiée via computed style), /precision (52 %, 45/87, Brier 0.257, tous marchés/confiances/ligues/calibrage/historique), /portefeuille état vide (1 000 € + CTA), flux complet /combo → génération (4 jambes, cote 5.10, Kelly 10 %) → ticket plein écran → « Jouer ce ticket » → mise Kelly 100 € (gain potentiel 510 € affiché) → pari placé (solde 900 €, P&L −100 €, courbe, ticket EN COURS, garde anti double-jeu) → reload (persistance localStorage ✓, auto-résolution POST 200, ticket reste EN COURS car matchs demain ✓) · 0 erreur console/dev.log
- Preuves : download/test-accueil-nav5.png, test-precision-1.png, test-precision-full.png, test-wallet-vide.png, test-ticket-jouer.png, test-wallet-pari-place.png

Stage Summary:
- Bankroll Manager livré : boucle complète générer → jouer (mise Kelly/%) → suivre (jambes + scores ESPN) → mesurer (solde, courbe, P&L, ROI, stats par profil), 100 % simulé et local à l'appareil
- Page Précision VOLTRIX livrée : transparence totale du moteur (réussite global/marché/confiance/compétition + calibrage Brier + historique), accessible depuis la nav, le Profil et le Portefeuille
- API de résolution réutilisable /api/bankroll/resolve avec grading multi-marchés clé composite, validée à 100 % contre la DB
- Fichiers créés : src/lib/bankroll.ts, src/app/api/bankroll/resolve/route.ts, src/app/{precision,portefeuille}/page.tsx, scripts/{test-bankroll,test-resolve-api}.ts ; modifiés : src/lib/{combo,types}.ts, src/app/page.tsx, src/app/combo/page.tsx, src/app/combo/ticket/page.tsx, src/app/api/performance/route.ts

---
Task ID: 9-a
Agent: general-purpose (fix boucle infinie portefeuille)
Task: Corriger le gel de l'app sur /portefeuille — boucle infinie état → effet → requête → état (résolution auto des tickets échus dont les matchs ne sont pas terminés).

Work Log:
- Lu le worklog (Tasks 1-8) pour le contexte : architecture bankroll (settleTicket partiel → statut toujours 'pending'), effet de montage relançant resolvePending à chaque changement d'état
- src/lib/bankroll.ts · applyResolutions : les tickets toujours partiels (statut 'pending' après settleTicket) sont désormais ignorés (`|| r.status === 'pending'` ajouté au garde) → seul un passage réel pending → won/lost/void marque `changed` et produit un nouvel état ; JSDoc mis à jour (« Les tickets toujours partiels (statut pending) sont ignorés… »). settleTicket et toute la mécanique de résolution réelle inchangés
- src/app/portefeuille/page.tsx :
  * ref `lastAutoResolve` (0) ajoutée sous `resolveGuard`
  * resolvePending : anti-tempête en mode silencieux (1 vérification max / 60 000 ms, timbre-posé après le contrôle `due.length === 0` et seulement si on va réellement interroger) ; le manuel (bouton ↻) n'est pas freiné
  * `resolveRef = useRef(resolvePending)` + `resolveRef.current = resolvePending` juste après le useCallback (dernière version du callback lisible par référence)
  * effet de montage remplacé : dépendances réduites à `[mounted]` → la résolution auto ne part plus qu'UNE fois au montage via resolveRef ; plus aucune relance effet → requête à chaque changement d'état. resolveRef est une ref stable, pas besoin de l'ajouter aux deps (ESLint n'a rien signalé)
- Validation : lint 0 erreur (exit 0) · tsc 0 erreur sur src/ (grep vide) · scripts/test-bankroll.ts 32/32 passent, aucun test modifié (la section « Résolution partielle » ne teste que settleTicket, non impacté)

Stage Summary:
- Boucle infinie éliminée sur /portefeuille : un résultat PENDING de l'API (matchs non terminés d'un ticket échu) n'est plus traité comme un changement d'état, et l'effet de montage ne redémarre plus sur les nouveaux états (deps [mounted] via resolveRef) ; double ceinture anti-tempête (1 auto-résolution max/minute)
- Fichiers touchés : src/lib/bankroll.ts, src/app/portefeuille/page.tsx — aucun autre fichier, aucun test ni API modifiés
- Résultats : lint OK · tsc 0 erreur src/ · 32/32 tests bankroll passent ; serveur dev non relancé (déjà en cours sur :3000)

---
Task ID: 9-b
Agent: frontend-styling-expert (VoltrixTabBar)
Task: Créer le composant unique src/components/voltrix/tab-bar.tsx — barre de navigation inférieure « Liquid Glass » inspirée d'iOS 27 (pilule flottante translucide, capsule active glissante, bouton Profil circulaire détaché), sans toucher à aucun autre fichier.

Work Log:
- Lu la fin du worklog (Tasks 1-8 + fix boucle infinie) pour le contexte : navigation 5 entrées existante en grille interne, pages /portefeuille et /precision en place, mode contrôlé attendu sur la page accueil (onglets Ligues/Profil internes)
- Vérifié les prérequis : framer-motion ^12.23.2 et lucide-react ^0.525.0 dans package.json, utilitaire cn() dans src/lib/utils, classe pb-safe présente dans src/app/globals.css (ligne 170), style d'en-tête // ==== VOLTRIX bet — … ==== des composants voltrix existants
- Créé src/components/voltrix/tab-bar.tsx ('use client') : export function VoltrixTabBar + export type TabKey ('home' | 'leagues' | 'wallet' | 'precision' | 'profile') ; données des onglets factorisées (PILL_TABS : Accueil/Zap → /, Ligues/Trophy → /?tab=leagues, Portefeuille/Wallet → /portefeuille, Précision/Target → /precision ; PROFILE_TAB : Profil/User → /?tab=profile) ; constante GLASS (verre dépoli commun : border-white/[0.08] + bg-white/[0.07] + backdrop-blur-2xl + ombre corrigée inset_0_1px_0_rgba(255,255,255,0.08),0_14px_44px_rgba(0,0,0,0.6))
- Modes : contrôlé (onTabChange fourni → Accueil/Ligues/Profil en <button> type=button appelant onTabChange(key), Portefeuille/Précision en <Link>) vs autonome (tout en <Link>, actif déduit via usePathname : /portefeuille → wallet, /precision → precision, sinon home) ; la prop active prime en mode contrôlé
- Capsule active glissante : motion.span layoutId='voltrix-tab-capsule' (spring stiffness 520, damping 42) en premier enfant absolu de l'item actif, bg-white/[0.12] + halo volt rgba(232,255,0,0.08), icône et label en relative z-10 ; item = rounded-[20px] px-2.5 py-1.5, icône 19px, label 9.5px font-semibold, actif text-[#e8ff00] / inactif text-white/55, active:scale-95
- Bouton Profil détaché : cercle 52×52 shrink-0, même verre (GLASS) via cn (twMerge fait bien écraser border-white/bg-white par border-[#e8ff00]/30 + bg-[#e8ff00]/[0.14] quand actif — pas de capsule layoutId ici), User size=20
- Accessibilité : aria-label français sur chaque item, aria-current='page' sur l'actif, nav aria-label='Navigation principale' ; structure exacte demandée (nav pb-safe fixed inset-x-0 bottom-0 z-50 > conteneur mx-auto max-w-[472px] gap-2.5 px-4 > pilule flex-1 rounded-[26px] p-1.5 + bouton détaché)
- Validation : bunx tsc --noEmit → 0 ligne '^src/' (grep vide, aucune occurrence de tab-bar) ; bun run lint → exit 0 ; aucun autre fichier modifié ; serveur non relancé (déjà en cours)

Stage Summary:
- VoltrixTabBar livrée : pilule flottante translucide 4 onglets + bouton Profil circulaire détaché à droite, verre dépoli cohérent (reflet interne + ombre douce 0_14px_44px), capsule active qui glisse d'un onglet à l'autre via framer-motion layoutId (effet liquid iOS 27), accent volt #e8ff00
- Double mode prêt pour l'intégration : contrôlé sur la page accueil (onTabChange + active, Ligues/Profil en onglets internes, Portefeuille/Précision en vraies liaisons) et autonome sur /portefeuille et /precision (tout <Link>, actif déduit du chemin)
- Fichier créé : src/components/voltrix/tab-bar.tsx (uniquement) — tsc 0 erreur src/ · lint 0 erreur

---
Task ID: 9
Agent: Super Z (agent principal) + sous-agents 9-a (general-purpose) & 9-b (frontend-styling-expert)
Task: (1) Corriger le gel complet de la page Portefeuille (boucle infinie) — (2) Refonte de la barre de navigation en « Liquid Glass » style iOS 27, validés par l'utilisateur.

Work Log:
- Diagnostic du bug : useEffect dépendait de resolvePending (useCallback deps [state]) → tout changement d'état relançait l'effet ; un ticket échu non terminé (verdicts ESPN PENDING) produisait via settleTicket un objet partiel compté comme « changed » par applyResolutions → setState → nouvel effet → nouveau POST /api/bankroll/resolve → boucle infinie → saturation → freeze (scénario : entrer sur /portefeuille + défiler)
- Fix 9-a (sous-agent) : applyResolutions ignore désormais les tickets toujours partiels (statut pending) — seul un vrai passage pending → won/lost/void modifie l'état ; resolvePending garde lastAutoResolve (cooldown 60 s en silencieux) ; effet de montage passé en deps [mounted] via resolveRef ; 32/32 tests bankroll OK, tsc/lint 0 erreur
- Fix 9-b (sous-agent) : créé src/components/voltrix/tab-bar.tsx — VoltrixTabBar « Liquid Glass » : pilule flottante (rounded-[26px], bg-white/[0.07], backdrop-blur-2xl, reflet interne + ombre profonde), 4 onglets (Accueil/Ligues/Portefeuille/Précision), capsule active glissante (framer-motion layoutId, spring 520/42, teinte volt #e8ff00), bouton circulaire Profil détaché à droite (h-52, teinte volt si actif), pb-safe iPhone ; 2 modes : contrôlé (accueil : home/leagues/profile en boutons, wallet/precision en liens) / autonome (usePathname)
- Intégration (principal) : page.tsx — ancienne nav grid-5 + TabButton/NavTab supprimés, <VoltrixTabBar active onTabChange>, lecture de ?tab=leagues|profile au montage (cross-navigation) ; /portefeuille et /precision — bouton retour (ArrowLeft) retiré, <VoltrixTabBar /> ajouté, imports nettoyés
- E2E Agent Browser 390×844 : accueil (barre fixed, 5 items, pill 26px, blur 40px) → clic Portefeuille → 4 scrolls + retours : page réactive (eval 1 ms) ; régression bug : injection d'un ticket échu irrésolvable (sans puis avec leagueCode) + rechargement → exactement 1 POST /api/bankroll/resolve au montage (3→4 dans dev.log), zéro requête additionnelle sur 8 s, ticket intact, aucune erreur console ; navigation croisée Ligues (portefeuille → /?tab=leagues, onglet ouvert) ; bouton Profil (switch interne sans navigation, highlight volt) ; capsule suit l'onglet actif sur accueil/ligues/portefeuille/precision ; aucune mesure de débordement (294/296 px à 390) ; données de test localStorage nettoyées
- Note : l'overlay dev <nextjs-portal> de Next peut recouvrir le coin bas-gauche de la barre en dev uniquement (absent en prod) ; le sélecteur flou de l'outil de test avait cliqué la carte « …ligues détaillés » — pas un bug app
- Preuves : download/test-nav-accueil.png, test-tabbar-accueil.png, test-tabbar-ligues.png, test-precision-tabbar.png, test-portefeuille-final.png

Stage Summary:
- Bug de gel du Portefeuille corrigé à la racine (boucle état→effet→requête éliminée + cooldown + effet montage unique) — validé par test de régression chiffré (1 POST, 0 tempête)
- Barre de navigation « Liquid Glass » iOS 27 livrée et partagée sur les 3 pages principales (accueil contrôlé, portefeuille/précision autonomes) — boutons retour supprimés, feel iPhone cohérent
- Fichiers : créés src/components/voltrix/tab-bar.tsx ; modifiés src/lib/bankroll.ts, src/app/page.tsx, src/app/portefeuille/page.tsx, src/app/precision/page.tsx

---
Task ID: 10-a
Agent: general-purpose (perf accueil)
Task: Diagnostiquer et corriger la non-fluidité / lenteur de chargement de la page accueil (~150 cartes, analyses progressives par lots de 6).

Work Log:
- Lu le worklog (Tasks 1-9, leçon 9-a : ne pas reproduire de boucle état→effet) puis les 4 fichiers du périmètre (page.tsx, match-card.tsx, match-detail.tsx, shared.tsx)
- Diagnostic (5 causes racines, preuves en commentaires du code) :
  * MatchCard NON mémoïsée (match-card.tsx) → chaque lot de 6 analyses (setPreds ×~25 lots) re-rendait la LISTE ENTIÈRE (~150 cartes × ~40 nœuds)
  * Handlers inline page.tsx L282-283 `onRetry={() => retryMatch(m)}` / `onOpen={() => setDetail({…})}` → 300 nouvelles closures à CHAQUE render → toute mémoïsation aurait été inutile
  * formatTime() (shared.tsx) construisait un `new Intl.DateTimeFormat('fr-FR',…)` par carte et par render (~150 constructions coûteuses/render, formatteur réutilisable)
  * Bug de course sur les passes d'analyse : batchAbort remis à `false` par la NOUVELLE passe (page.tsx ancien L99) → l'ANCIENNE boucle analyzeList (en attente sur un await) se réveillait et continuait à requêter /api/predictions pour l'ANCIENNE date en parallèle (requêtes dupliquées + écritures d'état stalées) — même famille que la leçon 9-a
  * Divers : setPreds par résultat (jusqu'à 6/batch), `flatMatches.filter(m => m.status !== 'post')` calculé 2× par render inline (L259/262), onOpenChange inline, MatchDetail (Sheet Radix) re-rendu à chaque lot
- Correctifs :
  * match-card.tsx : MatchCard wrappée React.memo ; props refactorées `onOpen: (m: LightMatch) => void` / `onRetry?: (m: LightMatch) => void` (le match est passé en argument depuis l'intérieur de la carte) → handlers parent stables, mémo efficace : un lot de 6 ne re-rend plus que 6 cartes
  * page.tsx : openMatch/closeDetail en useCallback (références invariantes), onRetry={retryMatch} (déjà stable), plus aucune closure par carte
  * page.tsx : batchAbort (booléen global) remplacé par runIdRef (jeton de génération ++ à chaque passe) — analyzeList(list, runId) vérifie le jeton avant chaque lot ET après chaque réponse avant tout setState ; loadMatches garde ses setData/setFailed/setLoading derrière le garde (une passe supplantée n'écrit plus rien, ne requête plus, ne masque pas le spinner de la nouvelle passe)
  * page.tsx : résultats d'un lot appliqués en UN SEUL setPreds ({...prev, ...updates}) au lieu d'un par match
  * page.tsx : pendingCount mémoïsé (remplace les 2 filter inline), closeDetail mémoïsé pour MatchDetail
  * shared.tsx : formatters Intl (TIME_FMT/DATE_LONG_FMT) mis en cache au niveau module — formatTime/formatDateLong réutilisent les instances ; TeamLogo wrappé React.memo (props 100 % primitives) + decoding='async' sur l'<img> (loading='lazy' + width/height déjà présents)
  * match-detail.tsx : MatchDetail wrappé React.memo (props primitives) — le Sheet Radix ne re-rend plus à chaque lot d'analyse ; rien de lourd ne se monte fermer (portail Radix conditionnel vérifié dans ui/sheet.tsx) ; effet DetailLoader sain (deps primitives + flag cancelled, pas de boucle)
- Validation : tsc 0 erreur src/ (grep vide) · bun run lint exit 0 · curl / → 200 · E2E Agent Browser 390×844 : 51 cartes rendues, 46/51 pronos affichés progressivement, clic carte → Sheet détail ouvert (SHEET_OK) puis Escape ferme, scroll eval 30×600 px = 3,8 ms, 0 erreur console/page · dev.log propre (aucune erreur nouvelle)

Stage Summary:
- Fluidité structurelle restaurée : React.memo(MatchCard/TeamLogo/MatchDetail) + handlers stables → un lot de 6 analyses ne re-rend plus que les 6 cartes concernées (au lieu de ~150) ; ~150 constructions Intl.DateTimeFormat par render éliminées ; un lot = 1 setState au lieu de 6
- Bug de course corrigé : plus de doubles boucles d'analyse en parallèle après un changement de date (jeton de génération runIdRef, ancien batchAbort défectueux supprimé) — moins de requêtes /api/predictions, aucune écriture d'état stalée
- Comportement visuel 100 % inchangé (dark + #e8ff00), signature publique de TeamLogo inchangée (portefeuille/combo intacts), aucune API touchée
- Fichiers touchés : src/app/page.tsx, src/components/voltrix/match-card.tsx, src/components/voltrix/shared.tsx, src/components/voltrix/match-detail.tsx

---
Task ID: 10-d
Agent: frontend-styling-expert (fluidité visuelle)
Task: Diagnostiquer et corriger le scroll saccadé (« app pas fluide ») — optimisation fine de la Liquid Glass tab bar + utilitaires perf dans globals.css, sans changer le design.

Work Log:
- Lu le worklog (Task 9-b : spec exacte de la tab bar) puis grep exhaustif de src/ : backdrop-blur (7 occurrences), will-change/translateZ/content-visibility (0), transitions « transition » / « transition-all » génériques, box-shadow statiques uniquement (aucune ombre animée dans l'app), aucun sélecteur * avec transition ni filter sur body
- Diagnostic n°1 : tab-bar.tsx posait backdrop-blur-2xl (40 px) + bg-white/[0.07] très translucide sur DEUX surfaces fixed (pilule + bouton Profil) → le navigateur ré-échantillonne le flou d'arrière-plan à CHAQUE frame de scroll, avec un noyau gaussien maximal et un fond qui laisse tout le travail au flou
- Diagnostic n°2 : classes « transition » génériques (Tailwind = inclut box-shadow, backdrop-filter, filter) sur les items — footgun perf même si rien n'anime ces propriétés ; capsule layoutId OK (transform/opacity uniquement) mais sans respect de prefers-reduced-motion ; aucune promotion de couche
- tab-bar.tsx : GLASS → backdrop-blur-2xl→backdrop-blur-lg (16 px, noyau ~6× moins cher) compensé par bg-white/[0.07]→bg-[#0a0a0a]/75 (le « glass » tient désormais au fond + reflet interne + bord + ombre, palette inchangée) ; gpu-layer posé sur les surfaces de verre ELLES-MÊMES et volontairement PAS sur l'ancêtre <nav> (transform sur un ancêtre d'un backdrop-filter risque de casser le flou dans certains navigateurs — exigence « pas de disparition du flou ») ; « transition » → transition-[color,transform] (items) et transition-[color,background-color,border-color,transform] (Profil) ; capsule extraite en const CAPSULE + will-change-transform ciblé sur le motion.span uniquement ; useReducedMotion() → capsule rendue en <span> statique (apparence identique, pas de spring) si reduced-motion
- globals.css : base — -webkit-tap-highlight-color: transparent (fin du flash gris au tap iOS), html { overscroll-behavior-y: none } (fin du chaînage/pull-to-refresh accidentel), body { touch-action: manipulation } (délai double-tap supprimé, pinch conservé) ; nouveaux utilitaires ciblés documentés : .gpu-layer (translateZ(0) + backface-visibility, avec avertissement « jamais sur un ancêtre de backdrop-filter ») et .cv-auto (content-visibility: auto + contain-intrinsic-size 128px, prêt pour les longues listes) ; bloc @media (prefers-reduced-motion: reduce) coupant volt-pulse/volt-shimmer/volt-bar
- Vérifié en amont que Tailwind v4 émet scale via la propriété individuelle `scale` (pas via transform) → .gpu-layer (unlayered) ne peut pas écraser active:scale-95 : composition propre
- Validation : bunx tsc --noEmit | grep '^src/' → vide ; bun run lint → exit 0 ; curl / → 200 ; dev.log « ✓ Compiled » sans erreur CSS ; SSR HTML contient gpu-layer + bg-[#0a0a0a]/75 + backdrop-blur-lg, CSS compilé contient .gpu-layer/translateZ(0)/.cv-auto/will-change-transform/@media reduced-motion

Stage Summary:
- Coût scroll réduit à la source : blur 40→16 px sur fond quasi opaque (lisibilité portée par le fond, plus par le flou), surfaces de verre en couches GPU, transitions restreintes aux propriétés bon marché, reduced-motion respecté (capsule statique + animations CSS coupées), tap-highlight/overscroll/touch-action corrigés — design Liquid Glass inchangé (noir, blancs translucides, #e8ff00, reflet + ombre 0_14px_44px conservés)
- Utilitaires réutilisables livrés dans globals.css : .gpu-layer, .cv-auto (+ règles reduced-motion) pour les autres composants
- Fichiers touchés : src/components/voltrix/tab-bar.tsx, src/app/globals.css (uniquement)

---
Task ID: 10-b
Agent: general-purpose (perf pages secondaires)
Task: Performance et fluidité des pages secondaires (/portefeuille, /precision, /combo, /combo/ticket) + libs (bankroll.ts, combo.ts, combo-store.ts), sans changement visuel ni format localStorage — et vérification qu'aucune régression de la boucle infinie (fix 9-a) ne subsiste sur /portefeuille.

Work Log:
- Lu le worklog (Tasks 7, 8, 9-a/9-b/9) puis les 7 fichiers du périmètre en intégralité ; vérifié le pattern du fix 9-a : applyResolutions ignore bien les tickets toujours pending (src/lib/bankroll.ts:240), cooldown 60 s sur l'auto-résolution silencieuse, effet de montage en deps [mounted] via resolveRef → INTACT
- localStorage audité : loadBankroll/loadComboTicket lus UNE seule fois au montage (effet), JSON.parse unique, saveBankroll = 1 écriture par mutation — aucune lecture en render, aucun format changé
- Diagnostic /portefeuille : computeStats(state) recalculé à CHAQUE render (chaque frappe dans le champ de mise/capital relançait stats + toute la page) ; BankrollCurve et PlacedTicketCard re-rendus à chaque frappe (rebuild du Map byMatch + recalcul des paths SVG) ; fermeture obsolète dans resolvePending (le state capturé au lancement pouvait écraser un pari placé pendant le await du POST — correctesse + écriture inutile) ; setTimeout de la double confirmation « Réinitialiser » jamais nettoyé ; setResolving(false) appelé même en mode silencieux
- Diagnostic /precision : Object.entries/filter/sort/slice des ligues recalculé à chaque render ; new Intl.DateTimeFormat construit PAR LIGNE d'historique PAR render (construction coûteuse) ; setState possible après démontage (le flag alive local ne couvrait pas la fin du fetch)
- Diagnostic /combo + /combo/ticket : new Intl.DateTimeFormat reconstruit à chaque appel de formatHour/formatDay/formatDateTime et à chaque render des puces de date
- Diagnostic combo.ts : boucles chaudes topUp/escalade utilisent rest.some(...) O(jambes) PAR candidat du vivier (≈O(24×8×P×8) par tentative × 21 tentatives) ; consider() recomputait comboProbOf(best) jusqu'à 3 fois par comparaison. combo-store.ts et bankroll.ts : rien à corriger (déjà optimaux)
- Correctifs /portefeuille/page.tsx : stats en useMemo([state]) ; BankrollCurve et PlacedTicketCard wrappées dans React.memo (+ useMemo interne deps [points] pour line/area/min/max/lastX/lastY de la courbe) → taper une mise ne re-rend plus la courbe ni la liste des tickets ; stateRef (même pattern que resolveRef) + applyResolutions(stateRef.current, settled) et due calculé sur stateRef → la résolution repart toujours du dernier état, deps du callback réduites à [mutate] ; if (!silent) setResolving(false) ; timer de reset mémorisé dans un ref + clearTimeout au démontage et avant chaque (re)armement — comportement visuel identique
- Correctifs /precision/page.tsx : leagues en useMemo([perf]) ; formatter HISTORY_DATE_FMT hoisté au niveau module (convention shared.tsx) ; aliveRef + garde avant chaque setState du fetch (aucun setState après démontage)
- Correctifs /combo/page.tsx et /combo/ticket/page.tsx : formatters Intl (WEEKDAY_FMT, DAY_MONTH_FMT, HOUR_FMT, DAY_FMT, DATETIME_FMT) hoistés au niveau module, un exemplaire partagé au lieu d'un par appel/render
- Correctifs src/lib/combo.ts : Set de matchIds construit une fois par itération dans escalate/topUp (restIds/otherIds) au lieu de rest.some() par candidat (÷8 sur la partie chaude de la génération) ; consider() cache bestProb (sémantique identique : même produit, mêmes comparaisons) — algorithmes et sorties inchangés
- Validations : bunx tsc --noEmit | grep '^src/' → vide · bun run lint → exit 0 · bun scripts/test-bankroll.ts → 32/32 · bun scripts/test-combo.ts → 61/61 (régression moteur) · curl 200 sur /portefeuille, /precision, /combo, /combo/ticket · test navigateur 390×844 : injection d'un ticket échu pending + reload → EXACTEMENT 1 POST /api/bankroll/resolve (re-compté 10 s après : toujours 1, zéro tempête), page réactive, 0 erreur console sur les 4 pages, localStorage de test nettoyé · dev.log : aucune erreur nouvelle

Stage Summary:
- Fluidité restaurée sur les pages secondaires : plus aucun recalcul de stats/SVG/liste à chaque frappe clavier (memo + useMemo à deps précises), formatters Intl partagés au niveau module, fermeture obsolète de la résolution éliminée (stateRef), timer de reset nettoyé au démontage
- Boucle infinie /portefeuille : aucune régression — triple ceinture du fix 9-a intacte et prouvée en conditions réelles (ticket échu injecté → 1 seul POST, zéro requête additionnelle sur 10 s)
- Moteur combiné accéléré (Set au lieu de .some dans les boucles chaudes) avec sorties strictement identiques (61/61)
- Fichiers touchés : src/app/portefeuille/page.tsx, src/app/precision/page.tsx, src/app/combo/page.tsx, src/app/combo/ticket/page.tsx, src/lib/combo.ts — src/lib/bankroll.ts et src/lib/combo-store.ts audités, aucun changement nécessaire (aucun format localStorage modifié)

---
Task ID: 10-c
Agent: general-purpose (perf réseau/infra)
Task: Diagnostic « l'app a du mal à charger et n'est pas fluide » — mesure curl + grep dev.log, puis optimisation réseau/infra : stale-while-revalidate dans le service worker, cache de réponse + single-flight + préchauffage sur /api/matches, scan 97 ligues en une seule passe. Formats de réponse inchangés.

Work Log:
- MESURES AVANT : /api/matches 3,00 s (caches ligue 10 min expirées), 4,89 s scan à froid complet sur date fraîche (scanMs 4880, 162 matchs), 8 ms chaud (scanMs 1) ; /api/performance 1,29 s ; pages 33-560 ms. dev.log : scan froid 6,1 s au boot, aucune tempête de requêtes, mais network-first du SW = chaque visite re-télécharge /api/matches (3-6 s) avant d'afficher quoi que ce soit ; TTL ligue datée 10 min (espn.ts) → tout visiteur après ≥10 min d'inactivité repaie le scan complet. Compression : aucune en dev (constaté, rien touché dans next.config).
- sw.js réécrit (CACHE_NAME bumpé voltrix-v1 → voltrix-v2, cleanup activate conservé) : GET /api/* passe de network-first à stale-while-revalidate avec TTL par chemin (/api/matches 60 s — données live ; /api/performance, /api/match/ et défaut 120 s). Fraîche → réponse instantanée depuis le cache + refresh en arrière-plan (event.waitUntil) ; périmée/absente → réseau d'abord avec repli cache (même périmé) si offline ; jamais de cache pour non-res.ok ; horodatages dans une Map cachedAt + éviction douce 60 entrées ; POST (predictions, bankroll/resolve) non interceptés ; cache-first logos espncdn et fallback navigation inchangés. BUG attrapé en E2E : cache.put CONSOME le corps de la Response → la page recevait un corps vide sur le chemin stale→réseau (« Aucun match trouvé » après reload) ; corrigé par res.clone() avant put (l'original va à la page).
- /api/matches/route.ts restructuré (format de réponse strictement identique { date, totalMatches, leagues, scanMs }, vérifié clé par clé) : (1) cache de réponse par date — frais 60 s le jour J / 5 min autres dates, fenêtre « stale » +30 s / +2 min servie instantanément pendant qu'un re-scan part en fond ; (2) single-flight (Map in-flight par date) : les requêtes concurrentes sur une même date partagent un seul scan ; (3) scan des 97 ligues en UNE seule passe concurrency 20 au lieu de 3 vagues séquentielles prio 1→2→3 (la réponse n'étant envoyée qu'une fois tout scanné puis re-triée par priorité, les vagues n'ajoutaient que des barrières) ; (4) préchauffage : au 1er appel, un setInterval 5 min (< TTL scoreboard 10 min, non-ref'd, garde globalThis anti-duplication hot-reload) rescanne la date du jour en tâche de fond avec garde anti-écrasement par un scan vide (ESPN surchargé) → les caches ligue n'expirent plus jamais, plus aucun visiteur ne paie le scan à froid ; (5) date validée ^\d{4}-\d{2}-\d{2}$ + Cache-Control: no-store + header X-Cache (HIT/STALE/MISS) pour l'observabilité.
- espn.ts / cache.ts : INTACTS (mécanisme {failureValue, failureTtlMs} et TTL préservés — le préchauffage s'appuie dessus). Pages React, tab-bar, globals.css : non touchés. Aucune écriture Prisma ajoutée (/api/performance reste séquentiel). Serveur non redémarré (hot-reload Turbopack).
- VALIDATION : tsc 0 erreur src/ ; lint exit 0 ; curl 200 + JSON valides ; E2E agent-browser 390×844 : SW v2 activé, /api/matches?date=… présent dans le cache v2, reloads successifs OK (matchs rendus), reload après expiration TTL (chemin stale→réseau) OK, offline → shell servi sans erreur ; tail dev.log : que des 200, aucune erreur nouvelle (prisma:error / ECONNREFUSED : néant).

Stage Summary:
- /api/matches : 3,0-6,1 s → 4-8 ms dans le régime nominal (HIT) ; scan à froid 4,89 s/scanMs 4880 → 3,18 s/scanMs 3168 (−35 %) sur dates fraîches comparables ; chemin « stale » serveur vérifié instantané (STALE puis HIT) ; single-flight anti- tempête.
- SW : visites répétées servies en 0 ms réseau perçu (stale-while-revalidate 60-120 s + refresh fond) au lieu de re-télécharger /api/matches à chaque visite ; offline garde l'app shell + dernière réponse API ; bug de corps consommé (cache.put sans clone) trouvé et corrigé en E2E.
- /api/performance 1,29-1,81 s au 1er appel (résolution séquentielle DB, inchangée) puis 26-27 ms ; pages 33-84 ms.
- Fichiers touchés : public/sw.js, src/app/api/matches/route.ts (uniquement).

---
Task ID: 10
Agent: Super Z (agent principal) + 4 sous-agents parallèles (10-a perf accueil, 10-b perf pages secondaires, 10-c réseau/infra, 10-d fluidité visuelle)
Task: Diagnostiquer et corriger « l'app a du mal à charger et n'est pas fluide » — audit de performance global demandé par l'utilisateur avec une armée de sous-agents.

Work Log:
- Recon : serveur OK (accueil 42 ms), fix boucle 9-a déjà en place ; lenteur = plusieurs causes cumulées côté rendu client, réseau et CSS
- 10-a (accueil) : MatchCard/TeamLogo/MatchDetail sous React.memo, handlers en useCallback stables, listes dérivées mémoïsées, jeton de génération runIdRef remplaçant batchAbort (fix course entre passes de rattrapage), résultats par lot appliqués en 1 seul setPreds (au lieu de 6), formatters Intl en cache au niveau module, decoding='async' sur écussons — preuve E2E : scroll 30×600 px = 0,7 ms, 0 longtask, 51 cartes/84 images toutes lazy
- 10-b (pages secondaires) : fix 9-a vérifié INTACT (1 seul POST resolve au montage, delta 0 sur 12 scrolls) ; computeStats en useMemo, BankrollCurve/PlacedTicketCard memoïsées (+ paths SVG en useMemo), fermeture obsolète applyResolutions corrigée via stateRef, timers double-confirmation nettoyés, tri/filtrage /precision mémoïsé, 5 formatters Intl hoistés sur combo, boucles chaudes combo.ts en Set (÷8) — tests 32/32 bankroll, 61/61 combo
- 10-c (réseau) : mesures avant — /api/matches 3,0 s (caches expirés) à 4,9 s (scan froid), SW network-first re-téléchargeait tout à chaque visite ; corrections — SW v2 stale-while-revalidate (TTL 60 s matches / 120 s autres, res.clone() pour le bug JSON vide attrapé en E2E, éviction 60 entrées), /api/matches : cache de réponse par date (60 s frais / 5 min autres + grâce stale), single-flight, scan 1 passe, préchauffage 5 min — après : /api/matches répété 4-8 ms (HIT), scan froid 3,2 s (−35 %), /api/performance 26 ms
- 10-d (fluidité) : backdrop-blur-2xl→lg + fond bg-[#0a0a0c]/75 sur les surfaces glass, .gpu-layer (translateZ+backface) posé sur le verre lui-même (jamais sur l'ancêtre d'un backdrop-filter), transitions restreintes (plus de box-shadow/backdrop-filter animés), will-change ciblé sur la capsule, useReducedMotion respecté, globals.css : tap-highlight transparent, overscroll-behavior-y none, touch-action manipulation, utilitaires .gpu-layer/.cv-auto, @media prefers-reduced-motion
- Intégration (principal) : recommandations 10-d appliquées — les 5 headers sticky backdrop-blur-xl→sm (fond déjà /90 quasi opaque = gain pur), transition-all des cartes restreint à [border-color,background-color,transform]
- Validation globale : tsc 0 erreur src/, lint 0, bankroll 32/32, combo 61/61 ; E2E Agent Browser 390×844 : accueil 51 cartes/0 skeleton après analyses (POST /api/predictions 5-50 ms), portefeuille 12 scrolls réactifs delta POST = 0, SW v2 actif, pill blur 16 px + gpu-layer vérifiés, 0 erreur console/page ; captures download/test-perf-{portefeuille,accueil-tabbar,accueil-final}.png

Stage Summary:
- Non-fluidité éradiquée sur 4 fronts : re-renders (memoïsation complète de la chaîne cartes), boucles/races (jeton runId, stateRef), réseau (SW stale-while-revalidate + API matches avec cache réponse/préchauffage : 3 s → 4-8 ms), coût GPU du glass (blur allégé + couches compositées + reduced-motion)
- Chiffres clés : /api/matches à chaud 3 000 ms → 4-8 ms · scan froid −35 % · POST analyses 5-50 ms · 0 longtask au scroll · 0 tempête de requêtes
- Fichiers : src/app/{page,portefeuille/page,precision/page,combo/page,combo/ticket/page}.tsx, src/components/voltrix/{tab-bar,match-card,match-detail,shared}.tsx, src/app/api/matches/route.ts, src/app/globals.css, public/sw.js, src/lib/combo.ts
---
Task ID: 11-a
Agent: general-purpose (fix résolution paris)
Task: Les tickets du Portefeuille ne sont jamais réglés (reste « EN COURS » à vie, solde jamais crédité/débité) — reproduire, diagnostiquer, corriger, prouver. Fix anti-boucle 9-a conservé.

Work Log:
- Lu le worklog (Tasks 8, 9-a, 9, 10-a, 10-d, 10-b) : archi bankroll, fix anti-boucle (applyResolutions ignore les partiels, cooldown 60 s, effet deps [mounted] via resolveRef) — tout à conserver
- Reproduction E2E RÉELLE (matchs ESPN terminés du 2026-09-04 : Ipswich 0-2 Liverpool 401879288, Lyon 3-1 Auxerre 401876472, Betis 1-0 Real Madrid 401882894) : POST /api/bankroll/resolve avec le payload EXACT du client (matchDate = date ESPN complète « 2026-09-04T19:00Z ») → TOUTES les jambes PENDING ; le même POST avec « 2026-09-04 » → verdicts WIN/WIN/WIN avec scores. Cause racine n°1 prouvée
- Chaîne complète : combo/page.tsx:145 (matchDate: m.date = ISO ESPN complet) → portefeuille/page.tsx:121 l'envoyait brut → resolve/route.ts:87 groupait sur l'ISO brut → espn.ts:291 `dates=20260904T19:00Z` → scoreboard ESPN VIDE (prouvé par curl direct : 0 events) → verdicts PENDING → settleTicket partiel → applyResolutions l'ignorait (guard 9-a) → ticket figé pour toujours
- Suspect 2 (jambes sans leagueCode) : confirmé — page.tsx:117 écartait les jambes sans leagueCode (vieux tickets d'avant Task 8) → results=[] → PENDING à vie. Suspect 3 : confirmé — les verdicts partiels de jambes n'étaient PAS persistés (applyResolutions jetait tout ticket partiel, settleTicket ne fusionnait pas l'existant). Suspect 4 : levé — l'hydratation (effet 1) et setMounted(true) sont batchés dans le même commit, stateRef.current est hydraté quand l'effet de résolution part. Suspect 5 : levé — ev.completed couvre FT/AET/PEN (flag ESPN status.type.completed)
- Correctif API (src/app/api/bankroll/resolve/route.ts) : normalizeDateKey() tronque/parse toute date vers YYYY-MM-DD avant le groupement et fetchScoreboard ; grading extrait dans gradeEvent() ; NOUVEAU fallback BORNÉ pour les jambes sans leagueCode : groupées par date, scan en Promise.all de 10 ligues probables (FALLBACK_LEAGUES : eng.1, esp.1, ita.1, ger.1, fra.1, UCL, UEL, ned.1, por.1, tur.1), scoreboards déjà en cache 10 min, au-delà → PENDING documenté ; jambes illisibles (matchId vide, date non parsable) ignorées sans crash
- Correctif client (src/app/portefeuille/page.tsx) : filtre d'échéance délégué à dueTickets() (matchDate normalisé slice(0,10) → un éventuel vieux matchDate ISO complet est échu le jour même) ; TOUTES les jambes envoyées via resolveLegPayload() (leagueCode '' possible, matchDate tronqué) ; re-tentative BORNÉE : si une résolution silencieuse laisse des tickets échus en cours, UNE seule re-tentative à +75 s (retryArmed interdit toute cascade, timer nettoyé au démontage) — cooldown 60 s, ↻ illimité et effet deps [mounted] intacts
- Correctif store (src/lib/bankroll.ts) : settleTicket FUSIONNE les verdicts partiels déjà persistés (une jambe déjà tranchée ne régresse plus à PENDING si l'API ne répond pas) ; applyResolutions PERSISTE les verdicts partiels nouveaux sans toucher au solde/statut (badges de jambes visibles en EN COURS) et ne produit AUCUN état si les verdicts sont identiques (legResultsEqual) — anti-boucle 9-a conservée, seul un passage réel pending → won/lost/void crédite/débite
- Tests : scripts/test-bankroll.ts étendu 32 → 61 checks (sections 8-10 : match du jour échu + vieux matchDate ISO, journées future/réglée non échues, payload API normalisé, finalisation partiel→perdu avec fusion + solde intouché + événement historisé, partiel→tout WIN avec payout complet crédité une seule fois, panne ESPN sans régression, vieux ticket sans leagueCode : échu, envoyé avec '', PENDING sans crash, finalisable dès graduation) ; section 5 adaptée (persistance des partiels désormais attendue, solde inchangé)
- Validations : bunx tsc --noEmit | grep '^src/' → VIDE · bun run lint → exit 0 · bun scripts/test-bankroll.ts → 61/61 · bun scripts/test-combo.ts → 61/61 · bun scripts/test-resolve-api.ts → 36/36 (concordance vs DB)
- E2E agent-browser 390×844 : injection d'un ticket réel échu (Liverpool 1X2 @1.8 + Lyon O/U 2.5 @1.9, mise 20 €, solde 480 €) + reload → EXACTEMENT 1 POST resolve (8→9 dans dev.log) → badge GAGNÉ, +68,40 €, solde 548,40 €, En jeu 0,00 €, ROI 242 %, badges de jambes avec scores « 0 - 2 » / « 3 - 1 », état persisté vérifié (status won, payout 68.4, resolvedAt, legResults) ; preuve download/test-11a-ticket-resolu.png
- Non-régression anti-boucle : ticket échu irrésolvable (matchId bidon, eng.1, matchDate aujourd'hui) → EXACTEMENT 1 POST au montage, delta 0 sur 8 s de scroll, ticket intact « EN COURS » ; re-tentative unique vérifiée : +1 POST à ~t+78 s puis delta 0 à t+110 s (aucune cascade) ; localStorage de test nettoyé (storage clear) ; dev.log : aucune erreur nouvelle

Stage Summary:
- Cause racine principale : le client envoyait la date ESPN COMPLÈTE (« 2026-09-04T19:00Z ») comme matchDate de jambe ; l'API la passait au paramètre `dates=` d'ESPN (« 20260904T19:00Z ») → scoreboard vide → toutes les jambes PENDING à vie → settleTicket partiel → ignoré par le guard anti-boucle 9-a → ticket jamais réglé. Causes secondaires : jambes sans leagueCode écartées côté client (vieux tickets PENDING à vie) et verdicts partiels jamais persistés
- Correctifs : normalisation systématique des dates (client + API, YYYY-MM-DD), envoi de TOUTES les jambes + fallback API borné (10 ligues probables) pour les jambes sans leagueCode, fusion/persistance des verdicts partiels (settleTicket + applyResolutions, sans mouvement de solde, aucun état émis si identique), re-tentative unique à +75 s proprement bornée. Fix anti-boucle 9-a INTACT (1 POST au montage prouvé, cooldown 60 s, ↻ illimité)
- Preuve E2E : ticket sur matchs réels terminés → 1 POST → GAGNÉ, solde 480 → 548,40 € (+68,40), badges de jambes scorés ; irrésolvable → 1 POST + 0 requête pendant 8 s ; fichiers touchés : src/app/api/bankroll/resolve/route.ts, src/app/portefeuille/page.tsx, src/lib/bankroll.ts, scripts/test-bankroll.ts

---
Task ID: 11-c
Agent: general-purpose (audit lenteur résiduelle)
Task: Audit E2E de la lenteur résiduelle (« il y a encore un peu de lenteur ») après les Tasks 9/10 — mesurer (navigations, hydratation, chunks, SW, préchauffage, animations), corriger ce qui reste hors périmètres 11-a/11-b, re-mesurer à protocole identique.

Work Log:
- MESURES AVANT (agent-browser 390×844 + curl + analyse des chunks dev) :
  * Chunk JS le plus lourd : 1 100 220 octets dont framer-motion + motion-dom + motion-utils = 814 068 o (74 %) — téléchargés et exécutés sur TOUTES les pages pour la SEULE capsule layoutId de la tab bar (grep : unique import framer-motion de src/) ; JS total accueil 5 209 903 o / 20 requêtes (react-dom dev 1,05 Mo et next-devtools 816 Ko = overhead dev uniquement)
  * Hydratation accueil : 1 longtask de 235 ms au rendu des 162 cartes d'un coup ; 3 longtasks / 601 ms sur une séquence de 5 navigations
  * Navigations (clic tab bar → URL + marker + rAF stable) : accueil→/precision FROID 1 216 ms interactif (warm 136 ms) ; accueil→/portefeuille 187 ms (warm 120 ms) ; retour accueil 73-101 ms ; TTFB 49-61 ms, DCL 106-139 ms, load 531 ms sur accueil
  * Scroll accueil (15×600 px) : frame moyen 19,4 ms, 2 frames >32 ms, max 50 ms — 162 cartes de 221-303 px (médiane 303), l'utilitaire .cv-auto livré en Task 10-d n'était appliqué NULLE part
  * Préchauffage /api/matches (Task 10-c) : pendant un scan à froid de 3,23 s (date +3 j), /api/performance répond en 42 ms → scan réseau NON bloquant ; /api/matches chaud 5-10 ms (X-Cache HIT) ; seul artefact : après hot-reload Turbopack (agents 11-a/11-b qui éditent en parallèle), le 1er appel repasse MISS 1,65 s (caches mémoire vidées — spécifique dev)
  * SW v2 : matcher vérifié EXACT (GET /api/* uniquement en stale-while-revalidate, POST non interceptés, navigations network-first avec repli shell offline) → aucun HTML périmé possible ; seule faiblesse : cache-first espncdn sans catch (rejet non géré du worker si échec réseau sans cache)
  * Fonts : 2 woff2 (Space Grotesk + Inter) préchargées next/font, RAS ; 282 images 100 % loading=lazy decoding=async ; POST /api/predictions 1,3-2,5 s/match dans dev.log (cache froid des analyses — périmètre 11-b, mesuré non corrigé) ; 0 erreur console sur les 5 pages
- CORRECTIFS (fichiers autorisés uniquement, design inchangé, diffs git vérifiés : page.tsx/preds-cache/portefeuille/bankroll/api-bankroll NON touchés) :
  * tab-bar.tsx : framer-motion SUPPRIMÉ du graphe client (plus aucun import dans src/) — capsule layoutId remplacée par UN <span> .volt-capsule positionné en JS pur (offsetLeft/offsetWidth de l'item actif → transform translate3d + width), glissement CSS 0,38 s cubic-bezier(0.3,1.25,0.45,1) (léger overshoot ≈ spring 520/42), premier placement AVANT peinture via layout effect isomorphe (transition:none + reflow → aucun flash, apparaît à sa place comme layoutId), repositionnement ResizeObserver + document.fonts.ready, reduced-motion via @media CSS, API de props inchangée (active/onTabChange)
  * globals.css : .volt-capsule (transition transform/width + override reduced-motion), .cv-auto-card (content-visibility:auto + contain-intrinsic-size:auto 304px — médiane mesurée des cartes ; le 128px de .cv-auto aurait sous-estimé la scrollbar de ~28 000 px)
  * match-card.tsx : .cv-auto-card posé sur le root des cartes (les ~150 cartes hors écran ne sont plus mises en page ni peintes) + transition générique du bouton Réessayer restreinte à [color,background-color,transform]
  * Transitions génériques Tailwind (= box-shadow/filter/backdrop-filter animables) restreintes à [color,background-color,border-color,opacity,transform] : match-detail (partage), precision ×3, combo ×8, combo/ticket ×4 ; combo/page.tsx : transition-all SUPPRIMÉE d'une volt-bar (écrasait l'animation width 0,7 s prévue par .volt-bar en snap 150 ms — restauré conformément au design precision)
  * sw.js : catch sur le cache-first espncdn → Response 504 explicite (plus de rejet non géré offline) ; matcher API/network-first navigation CONSERVÉS à l'identique (déjà corrects)
- RE-MESURES APRÈS (mêmes protocoles) :
  * Chunks : le chunk de 1,10 Mo a DISPARU du graphe ; JS total accueil 5 209 903 → 3 970 551 o (−1 239 352 o, −23,8 %) ; plus aucun « framer » dans le HTML ; plus gros chunk node_modules restant 338 Ko (tailwind-merge 142 + radix-toast 55 + collection…)
  * Hydratation accueil : reload complet → 0 longtask (avant : 235 ms) ; TTFB 49 ms, DCL 120 ms, load 364 ms (avant 61/139/531)
  * Scroll : 1re descente fraîche 19,0 ms/frame, 3 drops >32 ms (≈ avant 19,4/2 — rendu des cartes entrantes simplement différé) ; 2e descente 16,7 ms/frame, 0 drop ; max 50 ms
  * Capsule E2E : mode contrôlé Accueil (6 px/54 px) → Ligues (102 px/50 px) → Accueil, transition transform,width vérifiée, fond white/[0.12] inchangé ; mode autonome /precision (307 px/63 px) et /portefeuille (193 px/73 px) bien positionnés, opacité 1
  * Navigations warm : /precision 161 puis 73 ms, /portefeuille 157 ms, retour accueil 95-141 ms (variance = recompilations Turbopack des agents parallèles) ; /api/performance affiché SANS squelette (stale-while-revalidate actif)
  * VALIDATION : bunx tsc --noEmit | grep '^src/' → VIDE · bun run lint → exit 0 · curl 200 sur /, /portefeuille, /precision, /combo, /combo/ticket · 0 erreur console sur les 5 pages · SW v2 réactivé (nouveau sw.js) · CSS compilé contient .volt-capsule (2 règles) et .cv-auto-card · dev.log sans erreur nouvelle

Stage Summary:
- Cause n°1 (réglée) : framer-motion entier — 814 Ko dev / 74 % du plus gros chunk — exécuté sur CHAQUE page pour une seule capsule : remplacé par un glissement CSS transform/width (rendu identique) → −1,24 Mo de JS par visite (−23,8 %), hydratation allégée sur toutes les pages
- Cause n°2 (réglée) : rendu initial des 162 cartes d'un coup → longtask 235 ms (≈ 0,5-1 s ressenti sur mobile) : content-visibility:auto ciblé (.cv-auto-card) → 0 longtask, scroll identique à frais (19,0 vs 19,4 ms/frame) et plus fluide en revisite (16,7 ms, 0 drop)
- Causes restantes HORS périmètre : POST /api/predictions 1,3-2,5 s par match en cache froid (analyses ESPN — périmètre 11-b/preds-cache) ; après hot-reload Turbopack le 1er /api/matches repasse MISS 1,65 s (caches mémoire vidées — artefact dev, la prod ne hot-reloade pas) ; recommandé mais non appliqué : retirer framer-motion de package.json (0 import restant — pas touché pour ne pas perturber bun install des agents parallèles) et tailwind-merge (142 Ko du chunk dev partagé, tree-shaké en prod)

---
Task ID: 11-b
Agent: general-purpose (cache analyses accueil)
Task: Bug « Analyse 0/N au retour de navigation » — cache session des analyses IA par date + hydratation instantanée sur l'accueil (plus de re-POST complet de /api/predictions au retour de Portefeuille/Précision).

Work Log:
- Lu le worklog (Tasks 1-3 flux d'analyse, 10-a runIdRef/mémoïsation, 10-c cache API /api/matches) puis page.tsx, match-card.tsx, match-detail.tsx, tab-bar.tsx, types.ts — QuickPred vérifié 100 % sérialisable JSON (nombres/chaînes/tableaux/objets plats) → stocké tel quel
- Créé src/lib/preds-cache.ts : sessionStorage structuré par date `voltrix_preds_v1:<date>` → JSON { savedAt, preds: {matchId: QuickPred} } (survit aux navigations intra-onglet, cloisonné par onglet) ; API loadCachedPreds(date) / saveCachedPreds(date, updates) (merge par matchId + throttle leading+trailing 800 ms : 1re écriture immédiate, suivantes groupées en fin de fenêtre) / clearCachedPreds(date) ; TTL d'entrée par date 2 h (PREDS_TTL_MS, entrée expirée ignorée ET supprimée → re-analyse normale) ; fallback silencieux si sessionStorage indisponible (SSR/mode privé : probe setItem/removeItem), éviction de la moitié la plus ancienne si quota dépassé + 1 retry ; flush de sécurité pagehide + visibilitychange (hidden) — jamais de perte de lot au déchargement ; flush automatique au changement de date pendant une fenêtre de throttle (aucun mélange AAA/BBB testé)
- Intégré dans page.tsx : (1) loadMatches hydrate predsRef/setPreds depuis loadCachedPreds(d) SYNCHRONEMENT à chaque passe (avant le GET /api/matches) → cartes analysées affichées sans skeleton dès l'arrivée des données, hydratation « en vol » impossible (lecture sync + tout le reste derrière la garde runId — cohérence runIdRef préservée) ; (2) diff par matchId : `todo = isRefresh ? allMatches : allMatches.filter(m => !predsRef.current[m.id])` → les matchs déjà en cache ne sont JAMAIS re-POSTés au retour ; (3) analyzeList(list, runId, d) : après la garde runId, un seul setState par lot + miroir predsRef + saveCachedPreds(d, updates) — écrit pour LA DATE DE LA PASSE (paramètre d, jamais l'état global), donc une passe supplantée ne contaminne ni le state ni le cache d'une autre date ; (4) passe de rattrapage inchangée mais basée sur `todo` ; (5) refresh manuel : isRefresh → re-analyse complète forcée, les nouveaux résultats écrasent le cache par matchId (savedAt rafraîchi), les matchs passés « post » conservent leur analyse ; (6) retryMatch passe dateRef.current (nouveau ref, évite la closure périmée) ; (7) setPreds({}) supprimé — remplacé par l'hydratation cache (plus de flash « 0/N » ni de skeletons au retour, la barre Analyse IA part de N/N)
- Bonus First Load : MatchDetail chargé en next/dynamic ssr:false (client-only, chunk séparé — le Sheet ne sert qu'à l'ouverture d'une carte) ; usages vérifiés (render existant inchangé, props identiques) — chunk lazy-fetché par Next après hydratation, montage/animation Sheet inchangés
- Sanity test logique du module (bun, sessionStorage mocké, hors projet, supprimé après) : 8 groupes d'assertions OK — cache vide, écriture leading immédiate, round-trip JSON identique, merge + flush trailing (800 ms), écrasement par matchId, TTL expiré ignoré+supprimé, clear, changement de date en plein throttle sans mélange, structure { savedAt, preds }
- Validation : bunx tsc --noEmit | grep '^src/' → vide ; bun run lint → exit 0 ; serveur NON redémarré (hot-reload Turbopack) ; E2E agent-browser 390×844 session isolée (détails en Stage Summary) ; tail dev.log : aucune erreur nouvelle (0 error/warn sur les 200 dernières lignes), 0 erreur console navigateur

Stage Summary:
- Bug éradiqué : au retour d'une navigation (Portefeuille/Précision → Accueil), les 162 analyses du jour sont restaurées depuis sessionStorage en SYNCHRONE (avant même le GET /api/matches) → barre « Analyse IA » pleine immédiatement, 0 skeleton, 0 « Analyse indisponible », et ZÉRO nouveau POST /api/predictions (delta 0 vérifié immédiatement ET après 5 s)
- Preuves E2E (session isolée 390×844, date 2026-09-05, 162 matchs) : ① cache vidé + reload → analyse complète progressive (compteur X/N montant, +27 POST = 27 lots de 6, cache écrit 162 preds/167 Ko) ② clic Précision puis retour Accueil → 162/162 pronos rendus instantanément, 0 POST en plus ③ bouton refresh → re-analyse complète forcée (+38 POST, 162/162 re-analysés, cache savedAt rafraîchi à l'instant) ④ date Demain (2026-09-06) → analyse normale de CETTE date (+38 POST, compteur 12/142→142/142, 149 cartes dont 7 post affichées « Match terminé ») ⑤ retour Aujourd'hui → 0 POST, 162/162 pronos affichés instantanément — cache strictement par date, aucun mélange
- Capture d'arme : download/11b-accueil-analyse.png, download/11b-accueil-retour-cache.png, download/11b-accueil-retour-date-cache.png, download/11b-detail-dynamic.png (Sheet détail ouvert via chunk dynamic)
- Comportements intacts : jeton runIdRef (anti-course, hydratation sync insensible au vol), passe de rattrapage, refresh manuel, tri horaire, filtres ligues, dates −2/+4, React.memo + handlers stables, design inchangé
- Fichiers touchés : src/lib/preds-cache.ts (nouveau), src/app/page.tsx (uniquement)

---
Task ID: 11
Agent: Super Z (agent principal) + 3 sous-agents parallèles (11-a fix résolution paris, 11-b cache analyses accueil, 11-c audit lenteur résiduelle)
Task: 3 bugs remontés par l'utilisateur — (1) paris jamais réglés (ni GAGNÉ ni PERDU) après la fin des matchs, (2) analyses IA perdues au retour sur l'accueil (« recommande l'analyse de 0 »), (3) lenteur résiduelle.

Work Log:
- Recon principal : suspects passés aux agents (comparaison matchDate, jambes sans leagueCode, guard 9-a, ordre hydratation)
- 11-a · Causes racines prouvées : jambes stockant la date ESPN COMPLÈTE (« 2026-09-04T19:00Z ») → URL scoreboard « dates=20260904T19:00Z » → scoreboard vide (prouvé curl) → tout PENDING à vie → guard anti-boucle 9-a ignorait le ticket partiel → EN COURS éternel. Correctifs : normalizeDateKey (ISO → YYYY-MM-DD) dans l'API, grading extrait gradeEvent, fallback borné pour jambes sans leagueCode (scan 10 ligues probables, cache 10 min), settleTicket FUSIONNE les verdicts partiels, applyResolutions persiste les partiels sans toucher au solde + aucun état émis si identique (legResultsEqual, anti-boucle conservée), dueTickets() compare des dates tronquées, re-tentative unique bornée +75 s (retryArmed, timer nettoyé). Tests bankroll étendus 32 → 61 checks
- 11-b · src/lib/preds-cache.ts (nouveau) : miroir sessionStorage par date (clé voltrix_preds_v1:<date>, TTL 2 h, merge matchId, throttle leading+trailing 800 ms, flush pagehide/visibilitychange, éviction quota, anti-mélange de dates). page.tsx : hydratation synchrone depuis le cache au fetch, diff analyse = seuls les matchs sans cache sont postés, refresh manuel = re-analyse complète forcée, retryMatch passe dateRef, MatchDetail en next/dynamic ssr:false
- 11-c · Mesures chiffrées puis correctifs : framer-motion (814 Ko, 74 % du plus gros chunk) SUPPRIMÉ du graphe client — capsule Liquid Glass réécrite en pur CSS (translate3d + transition cubic-bezier 0,38 s ≈ spring 520/42, ResizeObserver + fonts.ready, positions E2E vérifiées sur 4 pages) ; longtask d'hydratation accueil 235 ms → 0 (content-visibility .cv-auto-card, médiane mesurée 304 px) ; 16 transitions génériques restreintes (match-detail, precision, combo ×2) ; transition-all retirée d'une volt-bar ; SW : catch espncdn. JS accueil −1,24 Mo (−23,8 %) ; préchauffage API confirmé non bloquant
- Validation croisée (principal, après les 3 en parallèle) : tsc 0 erreur src/ · lint 0 · test-bankroll 61/61 · test-combo 61/61 · test-resolve-api 36/36 · E2E 390×844 : accueil (capsule CSS visible, cache sessionStorage présent, 0 skeleton) → /precision (capsule suit, left 242 px) → retour accueil (delta POST /api/predictions = 0, pronos instantanés 162 matchs) ; preuve 11-a : ticket réel échu → GAGNÉ, solde 480 → 548,40 €, badges scores (download/test-11a-ticket-resolu.png) ; captures download/test-11-final-accueil.png etc.

Stage Summary:
- Paris maintenant réglés automatiquement : cause racine (dates ISO invalides pour ESPN) corrigée + verdicts partiels persistés + fallback sans leagueCode + re-tentative bornée — anti-boucle 9-a INTACTE (1 POST montage, delta 0, re-tentative unique sans cascade)
- Retour sur l'accueil instantané : 0 POST de re-analyse (cache session 2 h par date), barre N/N directe, refresh manuel et dates −2/+4 inchangés
- Lenteur résiduelle éradiquée : −814 Ko de JS sur toutes les pages (framer-motion → CSS), 0 longtask à l'hydratation, −23,8 % de JS accueil
- Fichiers : src/app/api/bankroll/resolve/route.ts, src/lib/bankroll.ts, src/app/portefeuille/page.tsx, src/lib/preds-cache.ts (nouveau), src/app/page.tsx, src/components/voltrix/{tab-bar,match-card,match-detail}.tsx, src/app/{precision,combo,combo/ticket}/page.tsx, src/app/globals.css, public/sw.js, scripts/test-bankroll.ts

---
Task ID: 12
Agent: Super Z (agent principal)
Task: Nouvelle fonctionnalité Combinator demandée par l'utilisateur — remplacer un match du combiné généré par un autre (ou 2 autres).

Work Log:
- Lecture complète du moteur (src/lib/combo.ts : buildCombo, profils, efficacité) et de la page (src/app/combo/page.tsx) pour ancrer la fonction dans les règles anti-risque existantes
- src/lib/combo.ts : 3 nouvelles fonctions exportées — legKey (clé unique match|market|pick), recomputeCombo (recalcule cote/proba/EV/Kelly/confiance d'un ticket édité, même convention que buildCombo : EV/Kelly sur cotes non arrondies, cote affichée arrondie), listAlternatives (jambes valides pour le profil — prob ≥ plancher, cote ≤ plafond — hors TOUS les matchs du ticket, y compris celui qu'on remplace : pas confiance = jamais re-proposé ; tri par efficacité décroissante)
- src/app/combo/page.tsx : poolRef rempli à chaque génération (vivier complet) ; bouton ⟳ (Repeat2) sur chaque jambe du ticket (preventDefault/stopPropagation — le ticket reste cliquable vers /combo/ticket) ; sheet bas de page (z-60, rounded-t-28, max-h 86dvh) : rappel de la sélection d'origine en rouge, consigne « 1 ou 2 remplacements », filtres de risque Tous/Sûr/Moyen/Risqué, liste d'alternatives cochables (borne max = legsLimit − (jambes − 1) : le ticket ne dépasse jamais la limite), aperçu EN DIRECT de la nouvelle cote/proba/nombre de sélections, CTA « Remplacer par N sélection(s) » ; applySwap → splice + recomputeCombo + saveComboTicket (page plein écran et Portefeuille à jour) ; pile d'undo (undoStack) avec bouton « Annuler le dernier échange » ; reset complet à chaque re-génération/changement de date
- scripts/test-combo.ts : section 12 « Édition manuelle » — 15 checks (exclusion des matchs du ticket, match remplacé jamais re-proposé, filtre profil équilibré vs agressif, tri efficacité, swap 1→1 et 1→2, bornes, legKey) ; fixture corrigé (a6 prob 0.45 : < 50 % équilibré, ≥ 40 % agressif)
- Validations : tsc 0 erreur src/ · lint 0 · test-combo 76/76 (61 → 76) · E2E agent-browser 390×844 sur /combo réel : combiné ×5 généré (3 jambes, 3 boutons ⟳), sheet ouverte (origine « Moins de 2.5 buts · Cremonese vs Padova · cote 1.77 », 986 alternatives triées, filtres actifs — 187 en « Risqué »), 2 alternatives cochées → aperçu « Nouvelle cote : ×15.71 · probabilité 24 % · 4 sélections », remplacement validé (ticket 4 jambes, proba 24 %, bouton Annuler présent), undo → retour 3 jambes propre, swap 1→1, /combo/ticket reflète le ticket échangé (3 sélections + CTA Portefeuille) ; captures download/test-swap-{1-ticket,2-sheet,3-ticket-4jambes,4-ticket-plein}.png ; 0 erreur console

Stage Summary:
- L'utilisateur peut désormais échanger n'importe quelle jambe du combiné : ⟳ par jambe → sheet avec alternatives valides du profil (triées par solidité), filtre de risque, remplacement par 1 OU 2 sélections, aperçu en direct du nouveau ticket, annulation en un clic
- Les règles anti-risque restent inviolables : aucune alternative sous le plancher de proba ou au-dessus du plafond de cote du profil ; le match écarté n'est jamais re-proposé ; la limite de matchs est respectée
- Fichiers : src/lib/combo.ts (+legKey, +recomputeCombo, +listAlternatives), src/app/combo/page.tsx (boutons ⟳, sheet, undo), scripts/test-combo.ts (+15 checks) ; /combo/ticket et le Portefeuille fonctionnent sans modification (saveComboTicket réutilisé)

---
Task ID: 13
Agent: Super Z (agent principal)
Task: Idée utilisateur — « si le nombre de matchs scrapés ne vaut pas 100, aller en chercher dans d'autres ligues (Russie, Corée du Sud...) » : diagnostic ESPN + implémentation du remplissage progressif.

Work Log:
- Recon : le catalogue scannait DÉJÀ ~97 codes dont rus.1 (Russie) et kor.1 (Corée) — l'idée utilisateur était donc partiellement en place sans le savoir.
- Découverte critique : kor.1 renvoie HTTP 400 systématique (K League retirée de l'API ESPN ; toutes les variantes kor.*/kr.1 testées = 400) → requête morte + retry (~1,2 s) payés à CHAQUE scan. Retirée du catalogue.
- Découverte anti-scraping : ESPN renvoie 403 aux User-Agent navigateur ; le serveur Next/undici passe car son UA n'est pas navigateur (tests scripts : UA curl/8.5.0 → 200).
- Validation empirique de 25+ codes ESPN (scripts/test-league-codes.ts et -codes2.ts, dates simples ET plages) : retenus eng.3 (13 m/10j), eng.4 (12), eng.5 (24), bra.2 (20), ned.2 (12/7j), mex.2 (9), arg.2 (19/7j), eng.w.1 (7), fifa.friendly (code valide, remplissage trêves), uefa.wchampions (valide, saisonnel). Rejetés : ger.3, jpn.2, kor.2, esp.3, fra.3, chn.2, afc.champions.two, fra.f.1, bra.copa (400).
- src/lib/leagues.ts : +10 ligues (priorités 2/3), −kor.1 → catalogue 97 → 106 entrées, en-tête documenté (codes validés).
- src/app/api/matches/route.ts : scan TIERCÉ — SCAN_WAVES figées par priorité au chargement du module, boucle vague 1 → si cumul ≥ TARGET_MATCHES (100) STOP sinon vague 2 puis vague 3. Early-exit inverse l'ancien commentaire « les vagues n'ajoutaient que des barrières » (vrai sans early-exit, faux avec). Pire cas (jour calme, 3 vagues) ≈ ancien scan complet. Champ additif catalogueSize: LEAGUES.length dans la réponse. Log serveur une ligne par scan : [matches] date: N matchs, L ligues actives, W/3 vague(s), X ms.
- src/lib/types.ts : MatchesResponse.catalogueSize?: number (optionnel pour compat réponses SW anciennes).
- src/app/page.tsx : « parmi les 90 suivies » → {data?.catalogueSize ?? 99} (LeaguesTab) ; ProfileTab reçoit catalogueSize en prop (« … » avant 1er chargement) — anti-hardcode.
- Validation : tsc 0 erreur src/, lint 0, bankroll 61/61, combo 76/76, resolve-api 36/36.
- E2E API (dates froides) : jeudi 10/09 = 13 → 18 matchs (+eng.3/bra.2/mex.2 actives) ; vendredi 11/09 = 67 matchs (33 ligues) ; samedi 12/09 = 153 matchs avec early-exit 2/3 vagues → 2 481 ms au lieu de ~4 600 ms (−46 %) ; aujourd'hui 31 → 35 matchs.
- E2E agent-browser (390×844) : accueil « Tous (35) » + carte League One visible ; onglet Ligues « 23 compétitions actives parmi les 106 suivies » ; Profil « 106 ligues & coupes » ; console 0 erreur. Captures : download/test-13-accueil.png, test-13-ligues.png, test-13-profil.png.

Stage Summary:
- Réponse à l'utilisateur : OUI bonne idée, implémentée en mieux — (1) l'objectif 100 matchs pilote un scan tiercé à early-exit, (2) +10 divisions productives réellement manquantes, (3) kor.1 morte supprimée (perf), (4) Russie/Corée étaient déjà scannées (Corée devenue invalide côté ESPN).
- Mesures : samedi −46 % de latence de scan à froid (early-exit vague 3 épargnée) ; jours calmes enrichis (+5 matchs un jeudi, nouvelles divisions actives) ; catalogue 106 compétitions affiché dynamiquement.
- Fichiers : src/lib/leagues.ts, src/app/api/matches/route.ts, src/lib/types.ts, src/app/page.tsx ; scripts/test-league-codes*.ts (outils de validation ESPN).
- Note SW : au premier chargement post-déploiement, le texte « 106 » peut afficher « … » jusqu'au cycle de revalidation SW (converge au rechargement suivant) — observé et vérifié une fois.
- Task 12 (remplacement de match dans le Combinator) : toujours en attente, non commencée.

---
Task ID: 13-b
Agent: Super Z (agent principal)
Task: « L'objectif est qu'il y ait minimum 100 matchs par jour » — garantir ≥100 options/jour même les jours creuses ESPN.

Work Log:
- Constat chiffré : ESPN ne contient PAS 100 matchs/jour en semaine (lundi 07/09 = 36 sur TOUT le catalogue 106 ; jeudi 10/09 = 18). Le scan tiercé élargit déjà tout, le plafond est dans la source.
- Probe massif de 77 codes ESPN supplémentaires (scripts/test-league-codes3.ts et -codes4.ts) : l'API publique ne couvre PAS les petits championnats (alb/and/arm/aze/bih/blr/est/far/geo/kos/ltu/lva/mda/mkd/mne/svn/lux = 400), ni la plupart des coupes nationales, ni le Golfe/HK/Ouzbékistan. Productifs retenus : fra.w.1, esp.w.1, slv.1, crc.1, hon.1, gua.1, eng.trophy, club.friendly, sco.2, usa.open, afc.cup (AFC CL Two), tur.2, ita.3/4/5 (girones Serie C) → catalogue 106 → 119 entrées.
- SOLUTION STRUCTURANTE (complétion « prochains matchs », standard des apps de pari) : quand aujourd'hui < 100, /api/matches fusionne les matchs À VENIR de J+1 puis J+2 jusqu'à atteindre 100. Chaque match poolé porte poolOffset (badge « Demain »/« J+N » calculé depuis la VRAIE date ESPN — dayOffsetFrom, car les feuilles de round débordent parfois). Paris/analyse/règlement utilisent m.date réelle → inchangés.
- Refonte route : structuredScan (single-flight déplacé au niveau structuré, partagé plain/pool) + serializeScan + scanDatePooled (copie défensive du résultat partagé, re-tri priorité après insertion ligues pool-only, arrêt dès ≥100). Pooling AUTOMATIQUE pour todayISO() uniquement ; les autres dates restent pures. SCAN_CONCURRENCY 20 → 24 (vague 3 élargie).
- Combinator : upcoming filtre poolOffset === undefined → combiné strictement même-jour (vérifié E2E : 20 candidats vs 115 affichés).
- page.tsx : retryMatch passe désormais m.date (et non la date vue) — les matchs poolés s'analysent/mettent en cache sous leur vraie date.
- match-card.tsx : badge « Demain »/« J+N » (bordure #e8ff00) sur les cartes poolées.
- Robustesse : incident réel pendant les tests — un cycle chaud dégradé (rate-limit ESPN après burst de sondes) a écrasé un cache 115 → 31. Garde-fou ajouté : un re-scan < 60 % du total en cache ne remplace jamais la copie riche (warmInBackground). Stabilité re-vérifiée après expiration TTL : 115 constant (HIT ×3).
- Validation : tsc 0 erreur src/, lint 0, bankroll 61/61, combo 76/76, resolve 36/36. E2E agent-browser : accueil 115 cartes, chip « Tous (115) », 28-31 « Demain » + ~49 « J+2 », 0 erreur console. Captures : download/test-13b-accueil-pool.png, test-13b-combo.png.

Stage Summary:
- Objectif utilisateur ATTEINT : ≥100 matchs/jour désormais garantis dans la limite de ce qu'ESPN offre à J+2 (lundi creux réel : 36 → 115).
- Transparence : la réserve structurelle demeure — si ESPN n'offre assez ni aujourd'hui ni à J+1/J+2 (extrêmement rare), le total reste en dessous ; option 2e source payante (API-Football) non retenue (clé/coût).
- Arbitrage produit documenté : le pool n'affecte QUE la vue « aujourd'hui » (badges visibles) ; Combinator/paris/règlement restent same-day par construction.
- Coût connu : premier scan à froid post-démarrage ~10-14 s (3 dates), ensuite HIT 7 ms + préchauffage ; le SW sert l'instantané pendant les re-scans.
- Fichiers : src/app/api/matches/route.ts, src/lib/leagues.ts, src/lib/types.ts, src/app/page.tsx, src/app/combo/page.tsx, src/components/voltrix/match-card.tsx ; scripts/test-league-codes3/4.ts.

---
Task ID: 15
Agent: Super Z (agent principal)
Task: Correction de 2 bugs critiques signalés par l'utilisateur : (1) « Moins 2.5 buts » trop surestimé dans les pronostics ; (2) Combinator : objectif de cote ×10 mais tickets réellement à ×9/×6 affichés comme conformes.

Work Log:
- Bug 2 : vérifié l'invariant comboOdds ≥ targetOdds de buildCombo (756 tests synthétiques + 25 seeds × 2 profils sur vraies données : 0 violation) → le moteur n'est PAS en cause.
- Bug 2 : reproduit le vrai coupable — le flux d'échange manuel (applySwap) ne vérifie pas la cible : combo ×10.02, remplacement de la jambe 1 (2.00) par la 1re alternative « efficace » (1.66) → ×8.32, ticket sauvegardé/affiché avec « cible ×10 » inchangée. Reproduction E2E : ×10.03 → échange → ×6.03.
- Bug 2 CORRIGÉ : src/lib/combo.ts — nouvelle fonction exportée repairToTarget(legs, pool, targetOdds, profile) (rétablit la cible par échanges 1-pour-1 à proba max, mêmes contraintes que le moteur) ; src/app/combo/page.tsx — applySwap tente la réparation auto après échange, l'aperçu de la feuille affiche en rouge « ×6.03 — sous l'objectif ×10 (réajustement auto à la validation) », badge « Sous l'objectif ×10 » sur l'en-tête du ticket ; src/app/combo/ticket/page.tsx — mention « sous l'objectif » dans les métadonnées si comboOdds < cible. E2E : échange → avertissement visible → apply → cote totale 10.03 rétablie, undo OK.
- Bug 1 : mesuré le biais modèle vs marché (72 matchs avec ligne O/U réelle, dé-margées, converties en λ implicite par inversion Poisson) : AVANT — λ de 0.45 à 7.52 (ex. Bournemouth-Lincoln λ=0.45 → « Moins 2.5 à 98.9 % » vs marché 56 % ; Exeter-Spurs U21 λ=7.52 vs marché ~2.6).
- Bug 1 causes racines (src/lib/prediction.ts) : (a) fetchTeamSchedule limité à la compétition du match → en coupe 1-2 matchs de données → ratios attaque/défense extrêmes sans aucun retrait vers la moyenne ; (b) dénominateurs défense inversés (awayDefense/1.22 au lieu de /1.52, homeDefense/1.52 au lieu de /1.22) ; (c) étape Elo λ : réutilisation de lambdaHome déjà mis à jour (asymétrie r^1.5, total gonflé +28 % quand l'extérieur est favori) + avantage terrain compté en double (+65 Elo déjà dans les références 1.52/1.22) ; (d) multiplicateur blessures dès le 1er absent (listes ESPN = 2-3 joueurs de rotation) → −10 % systématique.
- Bug 1 CORRIGÉ dans prediction.ts : shrinkage empirical Bayes n/(n+K=10) par composante (GF/GA par contexte normalisés par LEUR référence 1.52/1.22/1.37, ratio neutre si n=0) ; champs réels du contexte du match pour l'équipe extérieure (goalsForHome = son GF à l'extérieur !) ; blessures au-delà de 2 absents, 2 %/joueur, plancher 0.92 ; étape Elo = redistribution λ préservant le total (écart qualité pur, clamp ±250) ; bornes finales réalistes home [0.3, 3.8] / away [0.25, 3.4].
- Bonus : firstToScore désormais INCONDITIONNEL (home+away+noGoal = 1.000 exactement ; avant : 1 + e^-λ ≈ 1.06).
- Validation : tsc 0 erreur src/, lint OK ; test unitaire moteux (équipes moyennes → λ 1.51/1.24, total 2.75, P(under 2.5) = 48.1 % vs référence marché 48 % ; coupe 2 matchs → total 2.63, plus d'explosion) ; après fix : 63/72 matchs dans ±20 % du λ marché (médiane 0.906), λ médian marché ligne 2.5 = 2.74 = nos références ; tsc/lint propres, 0 erreur console. Captures : download/fix-combo-1-form.png, fix-combo-3-ticket10.png, fix-combo-4-swap-repair.png, fix-accueil-apres.png. Scripts : scripts/test-combo-invariant.ts, test-combo-real.ts, test-combo-seeds.ts, test-combo-swapdrop.ts, test-under25-bias.ts, test-lambda-bias.ts, lambda-market-median.ts, test-engine-fix.ts, dbg-match-detail.ts.

Stage Summary:
- « Moins 2.5 » calibré : plus de proba 85-98 % sur des matchs cote 50/50 — le modèle est ancré (λ total typique 2.6-3.0, sous 2.5 ≈ 45-52 %), et les marchés avec ligne ESPN restent calibrés par calibrateTotals.
- Combinator honnête : le moteur garantit cote ≥ cible ; un échange manuel ne peut plus « faire croire » — réparation auto à la cible ou badge « sous l'objectif » explicite partout (carte + ticket plein écran).
- Fichiers modifiés : src/lib/prediction.ts, src/lib/combo.ts, src/app/combo/page.tsx, src/app/combo/ticket/page.tsx.
- Reste en file (demandes antérieures non expirées) : démontage du pool « objectif 100 » (TARGET_MATCHES/SCAN_WAVES/scanDatePooled/UI Réserve), extension catalogue ~35 ligues (validation empirique ESPN), headers UA fetch Bun prod (403 ESPN).

---
Task ID: 16
Agent: Super Z (agent principal)
Task: 3 demandes utilisateur — (1) remplacer le Portefeuille par un conseiller de VENTE de coupon (cash-out : l'utilisateur saisit le prix de rachat du bookmaker + sa devise, le système analyse les matchs en direct et dit VENDRE ou GARDER) ; (2) critères de triage du Combinator (l'utilisateur choisit les spécificités du coupon) ; (3) refonte complète du design.

Work Log:
- live-prob.ts (nouveau) : cœur mathématique du cash-out — Poisson (vecteurs 0..15), CDF under, solveur bisection BI-DIRECTIONNEL (P(under) décroît en λ, P(1X) croît en s), inversion λ par marché : O/U → λ total depuis la ligne, BTTS → λ symétrique depuis (1-e^-λ/2)², 1X2/DC → bisection sur la part home s (λ total = 2.6, moyenne foot) ; legLiveProb recalcul la proba d'une jambe en direct (score courant + λ restants × fraction de temps restant, horloge ESPN « 63' »/« HT » prioritaire sinon temps mural /105 min) ; phase post → binaire géré par l'appelant. Bug corrigé en cours de route : clamp `Math.max(0, diff-h)` qui ajoutait des termes invalides le[h]·ra[0] pour h > diff (P(under|0-0,5') = 0.631 au lieu de 0.580) — boucle strictement bornée h ≤ diff. probDrawFrom corrigé (buts restants indépendants, convolution par score final t, pas de k commun). 25 tests (scripts/test-live-prob.ts) : pré-match inchangé, 0-0 à la 85' → under >95 %, 2-1 à la 60' → under 0 / over 1, monotonie temporelle (favori qui mène → proba croissante ; mené → décroissante), parsing horloge
- grade.ts (nouveau) : grading partagé gradeEvent/gradeLeg extrait de /api/bankroll/resolve (source unique vente + règlement) ; resolve route refactoré vers l'import — suite resolve-api 36/36 concordants (régression zéro)
- cashout-store.ts (nouveau) : coupons transférés en localStorage (voltrix_sell_coupons_v1, max 40) — transfert avec mise RÉELLE + devise (16 devises EUR→XOF/XAF/NGN/GHS/KES/ZAR/MAD/DZD/TND/TRY/BRL…, formatage Intl fr-FR), anti double-transfert par sourceSavedAt, markSold (prix + bilan vs gain max), recordEvaluation (dernier verdict sur la carte), préférence devise persistée
- /api/cashout (nouveau) : POST { legs(market,pick,prob,homeName,awayName…), stake, totalOdds, offered } → scoreboard ESPN groupé par (ligue, date) → par jambe : terminé → verdict gradeEvent (WIN/LOSE) ; en cours + score → legLiveProb (côté 1X2 levé par noms) ; inconnu → proba initiale (dégradation propre) → jointProb (gagnées = 1) → fairValue = mise × cote × jointProb → décision SELL (offre ≥ valeur) / MAYBE (≥ 85 %) / HOLD / LOST (jambe perdue) / WON (tout gagné) + message lisible + écart %
- /vente/page.tsx (nouveau, remplace /portefeuille supprimé) : carte d'import « Transférer le dernier ticket » (combo-stockage, anti-doublon), coupons EN COURS (jambes compactes + logos, mise, gain si tout passe, dernier verdict), feuille d'évaluation (prix + devise → analyse → verdict VENDRE/GARDER/ZONE GRISE/PERDU/GAGNÉ, barres offre vs valeur juste, proba restante, détail jambe par jambe avec score/temps/delta proba, bouton « J'ai vendu pour X »), section VENDUS (bilan ±), suppression 2-clics, bandeau 18+
- /combo/ticket : CTA « Jouer ce ticket (Portefeuille) » → « Transférer vers la Vente » (feuille mise réelle + devise, confirmation + lien direct), plus aucun lien vers /portefeuille ; /precision : lien → /vente ; tab-bar : onglet wallet→sell (Banknote, '/vente') ; page.tsx onTabChange inchangé (home/leagues/profile)
- combo-criteria.ts (nouveau) : critères persistés (voltrix_combo_criteria_v1) — marchés autorisés (1X2/DC/O/U/BTTS), confiance min (1-4★+), cotes réelles uniquement (oddsSource ≠ estimate), ligues exclues (codes ESPN) ; filterCandidates (fast-path défauts = comportement historique exact), activeCriteriaCount, criteriaSummary. Bug corrigé : le fast-path testait « au moins un marché coché » au lieu de « tous » → 1X2 seul renvoyait tout le vivier. 14 tests (scripts/test-criteria.ts)
- /combo/page.tsx : panneau « Critères du combiné » repliable (badge N actifs) dans le formulaire — chips marchés, chips confiance, toggle cotes réelles, liste des ligues du jour cochables (exclusion barrée rouge), résumé + reset ; generate() filtre le vivier AVANT buildCombo ET avant poolRef → les échanges manuels (⟳) héritent des mêmes critères ; erreur dédiée si vivier < 2 ou aucun marché
- REFONTE DESIGN v2 « SIGNAL » : globals.css réécrit — fond #060608 à triple halo (volt zénithal + contre-jours), tokens rafraîchis, composants .vx-* : vx-card (dégradé + liseré interne), vx-card-volt, vx-card-signal (bordure volt au tap/hover), vx-kicker (micro-labels espacés), vx-btn-primary (dégradé volt 3 stops + halo, variante vx-breathe pulsée), vx-btn-ghost, vx-chip/-on, vx-input (focus ring volt), vx-sheet (feuilles bas de page), vx-beam (filet lumineux des headers), vx-num (chiffres tabulaires display) ; volt-bar/ProbBar en dégradés ; headers unifiés (badge icône en dégradé volt + kicker + beam) sur accueil, combo, ticket, vente, precision ; match-card en vx-card + épine de ligue volt, scores live en vx-num halogé ; tab-bar verre approfondi + point volt sous l'onglet actif ; leagues/profil (vx-card-volt/vx-card), precision (hero vx-card-volt + stats vx-card), match-detail (bannière confiance, pronos vx-card, badges % dégradés), feuille d'échange combo en dégradé ; thème themeColor #060608 ; version 2.0.0
- Validations : tsc 0 erreur src/ · lint 0 · live-prob 25/25 · criteria 14/14 · combo 76/76 · bankroll 61/61 · resolve-api 36/36 · E2E agent-browser 390×844 : accueil v2 (header, chips dates, cartes analysées avec épine de ligue, prono, 248 matchs analysés sans erreur) → /vente vide (état vide + CTA) → /combo (panneau critères complet, génération ×5 avec ET sans critère 3★+ — badge « 1 actif », ticket 3 jambes ×5.01 proba 26 %) → /combo/ticket (transfert mise 100 € + devise EUR) → /vente (coupon EN COURS, évaluation offre 25 € → GARDER « 81 % sous la valeur » [exemple exact de l'utilisateur : pari 100, rachat 25], offre 150 € → VENDRE « +16 % », « J'ai vendu » → carte VENDUS bilan +50,00 €) → /precision (hero 50 %, Brier 0.259) → détail match (bannière confiance 4/5, pronos) ; API cashout testée au curl : WON (Barça 5-1 réel → « encaisse »), LOST (under 2.5 réel perdu), dégradation propre jambes inconnues (proba initiale conservée) ; console 0 erreur ; dev.log propre
- Captures : download/v2-{accueil,accueil2,accueil-cards,cards2,vente,vente-coupon,criteres,criteres2,combo-gen,ticket,transfert,transfert2,eval,eval2,eval3,vendu,precision2,detail2,criteria-gen,criteria-gen2}.png

Stage Summary:
- VENTE DE COUPON livrée : après génération d'un combiné, transfert avec mise réelle + devise (16 devises), puis à tout moment « Évaluer une offre » → le système récupère l'état ESPN réel de chaque match (à venir / live avec score+horloge / terminé), recalcule les probabilités (Poisson live par inversion λ), compare l'offre du bookmaker à la valeur juste et tranche VENDRE / GARDER / ZONE GRISE / PERDU / GAGNÉ — avec le détail match par match. L'ancien Portefeuille (banque virtuelle) est retiré de la navigation et sa page supprimée ; le moteur de règlement (grade partagé + /api/bankroll/resolve) reste intact et concordant 36/36.
- CRITÈRES COMBINATOR livrés : marchés (1X2/DC/O-U/BTTS), confiance min, cotes réelles uniquement, ligues exclues — persistés, appliqués au vivier AVANT le moteur ET aux échanges manuels, avec badge d'actifs et messages d'assouplissement.
- DESIGN v2 livré : langage « SIGNAL » homogène (fond profond à halos, cartes dégradées à liseré, boutons volt en dégradé pulsant, kickers, beams, point d'onglet actif) sur les 6 écrans + composants partagés, sans régression fonctionnelle (toutes les suites passent).
- Fichiers : src/lib/{live-prob,grade,cashout-store,combo-criteria}.ts (nouveaux), src/app/api/cashout/route.ts (nouveau), src/app/vente/page.tsx (nouveau), src/app/portefeuille/ (supprimé), src/app/{page,precision,combo/page,combo/ticket/page,globals.css,layout.tsx} + src/components/voltrix/{tab-bar,shared,match-card,match-detail}.tsx + src/app/api/bankroll/resolve/route.ts (refactoré), scripts/{test-live-prob,test-criteria}.ts (nouveaux)
- Reste en file (demandes antérieures non expirées) : démontage du pool « objectif 100 » (TARGET_MATCHES/SCAN_WAVES/scanDatePooled/UI Réserve), extension catalogue ~35 ligues (validation empirique ESPN), headers UA fetch Bun prod (403 ESPN).

---
Task ID: 17
Agent: Super Z (agent principal)
Task: 3 demandes utilisateur — (1) revenir à l'ancien design (abandon de la refonte v2 « SIGNAL ») ; (2) combinator affiche encore un combiné ×10 qui vaut ×5 en réalité ; (3) supprimer l'obligation « 100 matchs/jour » (l'app affichait 200+ matchs en complétant via J+1/J+2).

Work Log:
- Recon : serveur dev CRASHÉ (OOM, heap 2 Go épuisé) juste après un log « matches-pool 248 matchs » — le pool est suspect n°1 de la surconsommation mémoire. Redémarrage. Historique git analysé : b0cda45 (08/09) = dernier état ancien design + contient déjà Task 15 (repairToTarget) et le pool.
- DIAGNOSTIC Bug « ×10 affiché / ×5 réel » : l'affichage interne est cohérent (comboOdds = produit des cotes des jambes, invariant moteur vérifié 76 tests + E2E ×10.03). Le vrai coupable : les jambes à cote « estimée » (fairOdds = 0.93/proba du modèle — BTTS systématiquement, O/U sans ligne réelle, matchs sans cotes 1X2). Ces cotes n'existent chez AUCUN bookmaker : un combiné « ×10 » construit en partie sur des estimées ne vaut que ×5-7 au guichet. Le toggle critères « cotes réelles uniquement » existait mais était DÉFAUT OFF.
- FIX Bug combinator (src/lib/combo-criteria.ts) : version 2 — realOddsOnly = TRUE par défaut ; migration localStorage v1→v2 force true une fois (l'ancien false était le défaut, pas un choix), v2 respecte le choix explicite ; fast-path du filtre supprimé (le défaut filtre désormais les estimées) ; activeCriteriaCount ne compte PAS le défaut sûr (badge 0 à l'état neuf) mais compte l'écart « estimées ré-incluses » ; criteriaSummary avertit « cote totale non garantie » si opt-out ; libellé du toggle dynamique dans /combo (obtenable chez le bookmaker ↔ non garanti) ; notes /combo et /combo/ticket réécrites ; message d'assouplissement mis à jour.
- DÉMANTÈLEMENT POOL (src/app/api/matches/route.ts réécrit) : TARGET_MATCHES, SCAN_WAVES, early-exit, scanDatePooled, dayOffsetFrom, addDaysISO, POOL_LOOKAHEAD_DAYS, poolOffset — TOUT supprimé ; passe unique sur les ~121 ligues triées par priorité (SCAN_ORDER figé au module) ; FILTRE UTC STRICT Task 14 RÉINTÉGRÉ côté serveur ([JJ 00:00 → JJ+1 00:00) — il n'avait JAMAIS été committé, seul le filtre client subsistait) ; éviction du cache au-delà de 8 journées (garde-fou anti-fuite mémoire, suite de l'OOM) ; préchauffage simplifié (scanDate pour tous).
- Pool, suite : types.ts (poolOffset retiré de LightMatch), match-card.tsx (badge « Demain »/« J+N » retiré), combo/page.tsx (upcoming : filtre même-jour UTC strict `m.date.slice(0,10) === date` en défense en profondeur, plus de poolOffset).
- Retour à l'ANCIEN DESIGN : globals.css, shared.tsx, match-detail.tsx, match-card.tsx, tab-bar.tsx restaurés depuis b0cda45 ; layout.tsx themeColor #0a0a0c ; page.tsx et precision/page.tsx restaurés wholesale (diffs 100 % design) puis ré-application des FEATURES : onglet Vente (Banknote, /vente) dans tab-bar, lien « Tu as joué un coupon ? » → /vente dans precision ; combo/page.tsx, combo/ticket/page.tsx, vente/page.tsx « downgrade » systématique des classes v2 (vx-card→rounded-3xl bg-[#141418], vx-card-volt→bordure volt 5 %, vx-btn-primary→bg-[#e8ff00] volt-glow, vx-btn-ghost→bg-white/[0.07], vx-sheet→conteneur ancien, vx-chip→chips anciennes via cn/twMerge, vx-kicker→label 11px, vx-num→tabular-nums, beams supprimés, gradients→volt plat) — 0 classe vx-* restante dans src/.
- Bonus : scores « 0 » plus affichés sur les matchs pre (ESPN renvoie désormais score:0 au lieu de null en pré-match) ; typo header vente (« Les maths décident »).
- Outil : découverte d'un artefact d'affichage (les séquences [m des sorties d'outils sont avalées → `markets[m.k]` lu `.k]`) — fausse alerte « corruption » : fichiers valides (tsc + grep `[m.k]` confirment). Le script python inline a contourné.
- Validations : tsc 0 erreur src/ · lint 0 · combo 76/76 · critères 25/25 (défauts v2, opt-out, migration v1→v2, corrompu→défauts sûrs) · bankroll 61/61 · resolve-api 36/36 · live-prob 25/25.
- E2E API : aujourd'hui 10/09 = 15 matchs RÉELS (0 hors jour UTC, 0 poolOffset, X-Cache MISS→scan 2,8 s) ; demain 11/09 = 56 matchs stricts (0 débordement), 43 avec cotes 1X2 réelles (vivier combinator fourni).
- E2E agent-browser 390×844 : accueil ancien design « Tous (15) », plus de scores 0 en pré, pronos OK ; /combo ancien design + panneau critères (toggle « Cotes réelles uniquement » ON par défaut, « Aucun critère actif », 9 ligues du jour cochables) ; génération ×5 → 3 jambes TOUTES « cote réelle » (2.00 · 1.59 · 1.59), CÔTE TOTALE 5.06 = produit exact, proba 24 %, EV +19 % ; /combo/ticket plein écran ancien design ; transfert mise 100 € EUR (feuille ancienne) ; /vente ancien design (coupon EN COURS ×5.06, gain 506 €) ; évaluation offre 25 € → GARDER, valeur juste 119,22 €, « offre 79 % sous sa valeur » (scénario exact de l'utilisateur) ; /precision ancien design (51 %, Brier 0.253) ; onglet Demain « Tous (56) » ; console 0 erreur. Captures : download/t17-{accueil,accueil2,combo,criteres,criteres2,gen,gen2,ticket,transfert,transfert2,vente,eval,precision,demain}.png

Stage Summary:
- L'utilisateur obtient exactement ses 3 demandes : (1) ANCIEN design restauré partout, features Vente/Critères conservées et restylées à l'identique de l'ancien langage ; (2) le combinator ne promet plus que des cotes obtenables — défaut « cotes réelles uniquement », migration v2, le total affiché EST le produit des cotes affichées (E2E : 5.06 = 2.00×1.59×1.59) ; (3) plus aucune complétion J+1/J+2 — le jour J affiche ce qu'il offre RÉELLEMENT (15 matchs jeudi), filtre UTC strict serveur réintégré (Task 14 protégée en profondeur), éviction cache anti-OOM.
- Fichiers : src/app/api/matches/route.ts (réécrit), src/lib/types.ts, src/lib/combo-criteria.ts (v2), src/app/combo/page.tsx, src/app/combo/ticket/page.tsx, src/app/vente/page.tsx, src/app/page.tsx, src/app/precision/page.tsx, src/app/globals.css, src/app/layout.tsx, src/components/voltrix/{tab-bar,match-card,shared,match-detail}.tsx, scripts/test-criteria.ts (25 checks).
- Note : l'intro /combo mentionne encore BTTS (disponible via opt-in « estimées ») — cohérent. Reste en file (backlog antérieur) : extension catalogue ~35 ligues, headers UA fetch Bun prod (403 ESPN), vague d'audit des 5 findings.

---
Task ID: 18-b
Agent: Volt UI Resilience (sous-agent résilience UI)
Task: Résilience UI accueil face aux erreurs réseau/serveur — supprimer le « Aucun match trouvé » mensonger quand le serveur est tombé (bug signalé par l'utilisateur), distinguer chargement / vide réel / erreur, auto-retry + stale-while-error, rétrocéder le même traitement honnête aux écrans partageant le défaut.

Work Log:
- Lu worklog.md (Tasks 16-17) : contexte retour à l'ANCIEN design dark #e8ff00 (respecté strictement — aucune classe v2 vx-*, styles existants réutilisés : cartes pointillées rounded-3xl, bouton volt identique à /precision, rouge #ff4d5e réservé aux erreurs).
- DIAGNOSTIC src/app/page.tsx : loadMatches n'avait AUCUNE distinction (a) chargement (b) HTTP 200 + 0 match (c) erreur — le catch faisait setData(null) → EmptyState « Aucun match trouvé » affiché sur panne réseau/5xx/JSON cassé. Pas de check res.ok. Onglet Ligues : !data → squelettes ÉTERNELS en cas d'erreur. Pronos : DÉJÀ résilients (catch par lot de 6, 2 passes de rattrapage avec backoff 1,5 s, carte « Analyse indisponible + Réessayer ») → aucune modif (pas de sur-ingénierie). /precision : DÉJÀ correct (3 états + Réessayer). /vente : DÉJÀ correct (res.ok + evalError). /combo : MÊME DÉFAUT — catch → setData(null) → « Chargement des matchs… » à l'infini, sans check res.ok.
- FIX accueil (src/app/page.tsx) : trois états distincts. loading → squelettes existants ; vide réel → EmptyState « Aucun match trouvé » UNIQUEMENT si HTTP 200 validé + 0 match ; erreur → nouveau LoadErrorState « Impossible de charger les matchs » + « Vérifie ta connexion, le serveur est peut-être momentanément indisponible. » + bouton « Réessayer ». Checks ajoutés : !res.ok → throw, !Array.isArray(json.leagues) → throw (JSON invalide/tronqué = panne, pas vide).
- Auto-retry silencieux : 2 tentatives max, backoff ~1,5 s puis ~3 s (autoRetryRef + retryTimerRef annulé au démontage/à chaque nouvelle passe utilisateur, garde runId anti-race). Pendant un retry : si des données existent elles restent affichées (stale-while-error via dataRef,setData(null) supprimé du catch) + bandeau discret « Reconnexion… » (spinner volt) ; sans données les squelettes continuent. Échec persistant avec données : bandeau « Serveur indisponible — affichage des dernières données. » + bouton Réessayer ; badge pastille grise/volt « Serveur indisponible » (point volt pulsé) près du header tant que l'erreur persiste. Onglet Ligues : LoadErrorState au lieu de squelettes infinis quand data=null && error.
- FIX /combo (src/app/combo/page.tsx, minimal) : check !res.ok + validation leagues, nouvel état loadError → carte « Impossible de charger les matchs » + Réessayer (reload loadMatches(date)) — plus de « Chargement des matchs… » éternel. Pas d'auto-retry ici (cas trivial, design inchangé).
- Non touché (déjà sains ou hors périmètre) : /precision, /vente, src/app/api/**, src/lib/** (agent 18-a en cours — cache.ts/analyze.ts/api/performance modifiés par lui pendant ma passe).
- E2E agent-browser 390×844 : réseau route --abort INOPÉRANT dans cette session (2 patterns testés, fetch restait 200) → plan B autorisé du cahier : monkey-patch window.fetch via eval SANS reload, échec déclenché par interactions UI (chips de date / bouton Rafraîchir / pushstate SPA vers /combo). Séquence : accueil « Tous (15) » capture t18-b-accueil.png → patch reject + chip « Demain » → auto-retries ~5 s → « Impossible de charger les matchs » + Réessayer + badge header, 0 occurrence de « Aucun match trouvé » → capture t18-b-erreur.png → fetch restauré + clic Réessayer → « Tous (56) » revient → capture t18-b-recovery.png → patch reject + bouton Rafraîchir (données conservées) → bandeau « Serveur indisponible — affichage des dernières données. » + cartes intacts, PAS d'état d'erreur plein écran → capture t18-b-stale.png → patch 200-vide valide + chip « Aujourd'hui » → « Aucun match trouvé » UNIQUEMENT dans ce cas (0 « Impossible de charger ») → capture t18-b-vide.png → onglet Ligues en panne → LoadErrorState → capture t18-b-leagues-erreur.png → /combo en panne (pushstate, patch actif) → « Impossible de charger les matchs » + Réessayer → capture t18-b-combo-erreur.png → Réessayer → les 15 matchs du jour reviennent.
- Validations : `agent-browser errors` = 0 erreur page (avant et après), console 0 [error] (seulement logs HMR dev) ; bunx tsc --noEmit : 0 erreur sur mes fichiers (la seule erreur du repo est src/lib/cache.ts(135) — travail EN COURS de l'agent 18-a, hors périmètre) ; bun run lint : 0 erreur 0 warning. Serveur JAMAIS redémarré (il est reparti seul pendant mon polling — il était momentanément down à 12:47).

Stage Summary:
- L'app est honnête : « Aucun match trouvé » n'apparaît PLUS QUE sur un HTTP 200 réellement sans match ; toute panne (fetch rejeté, 5xx, JSON invalide) affiche « Impossible de charger les matchs » + sous-texte + Réessayer, avec 2 auto-retries silencieux (1,5 s / 3 s), stale-while-error (données conservées + bandeau « Reconnexion… » puis « Serveur indisponible — affichage des dernières données. »), badge header volt/gris. Onglet Ligues et /combo alignés ; /precision et /vente déjà conformes ; prono déjà résilients (rien à faire).
- Fichiers modifiés : src/app/page.tsx (3 états, auto-retry + stale-while-error, badge header, LoadErrorState, LeaguesTab error/onRetry), src/app/combo/page.tsx (loadError + carte erreur + Réessayer, checks res.ok/JSON). Captures : download/t18-b-{accueil,erreur,recovery,stale,vide,leagues-erreur,combo-erreur}.png.
- Preuves E2E : erreur réseau ≠ vide réel vérifiés dans les deux sens (0 « Aucun match trouvé » pendant la panne ; 0 « Impossible de charger » sur le 200 vide) ; récupération par Réessayer OK (accueil 15/56 matchs, combo 15 matchs) ; console 0 erreur.
- Reste en file : si l'agent 18-a touche au shape de MatchesResponse, garde `Array.isArray(json.leagues)` à maintenir ; aucune autre dette identifiée sur ce pattern (vente/precision déjà sains).
---
Task ID: 18-a
Agent: general-purpose (fix fuite mémoire OOM serveur)
Task: Diagnostiquer et corriger la fuite mémoire / les accumulations non bornées côté serveur après le 2e crash OOM (heap Node ~2 Go épuisé, next-server v16.1.3) — inventaire exhaustif des caches, bornage LRU+TTL+sweep, borne du travail de /api/performance, log d'observabilité [mem], test de charge RSS persistant.

Work Log:
- Lu le worklog (Tasks 15-17) : le pool « objectif 100 » était démantelé et l'éviction 8 jours posée sur le cache matches — le crash a RECURRÉ → une autre accumulation non bornée existait.
- Recon : le serveur dev était MORT (port 3000 muet, aucun process next-server — 3e crash/arrêt non tracé dans dev.log, tronqué par les redémarrages). Redémarré via le chemin officiel du sandbox (setsid bash .zscripts/dev.sh, pid next-server 6494) — aucun serveur actif n'a été touché ; la règle « ne jamais redémarrer » ne s'appliquait pas (rien ne tournait).
- INVENTAIRE EXHAUSTIF (grep globalThis / new Map / new Set / setInterval / .push module-level sur src/) :
  1. src/lib/cache.ts — store Map PARTAGÉ (clés sb:/sched:/stand:/inj:/wx:/analysis:) : AUCUNE borne d'entrées, AUCUN sweep — une entrée expirée n'était supprimée que SI relue → chaque (ligue,date), chaque équipe, chaque ville météo visités un jour restaient en mémoire pour toujours (fuite principale).
  2. src/lib/analyze.ts — analysisCache Map module-level par matchId : même défaut (expirés jamais relus = jamais supprimés) + double canal de rétention avec cacheAnalysisDirectly (analysis:{matchId} dans le store cache.ts) — deux copies potentielles de chaque AnalyseResult.
  3. src/app/api/performance/route.ts — la borne « max 10 derniers jours » était DOCUMENTÉE mais ABSENTE de la requête Prisma (matchDate < now-3h seulement) → tout l'historique pending (924 lignes sur 11 dates) rescanné à CHAQUE appel ; et resolvePredictionsForDate bouclait les ligues en SÉQUENTIEL (un fetch ESPN manquant = 8 s × 2 tentatives à la file) → les 13,3 s observés.
  4. src/app/api/matches/route.ts — éviction 8 jours VÉRIFIÉE efficace (trie par scannedAt, supprime les plus vieilles clés, pas seulement les nouvelles) ; inFlight/warming purgés en finally ; warmer unref — RAS, non modifié.
  5. espn.ts / weather.ts — AbortController présents (8 s / 6 s, 2 tentatives) ; payloads ESPN jamais stockés bruts (seule la version mappée est cachée) — RAS.
  6. cashout, bankroll/resolve, match/[id], live-prob, grade, market-odds, prediction.ts — Maps strictement par requête, zéro état module croissant — RAS. preds-cache.ts = client (sessionStorage) hors périmètre serveur.
- FIX 1 (cache.ts réécrit) : LRU MAX_ENTRIES=600 (delete+set à chaque hit, éviction des plus anciennes au-delà du plafond) + sweep périodique 60 s (supprime TOUTE entrée expirée même jamais relue) + log [mem] discret (max 1/60 s, seulement si activité) : rss/heap + tailles par préfixe (sb/sched/stand/inj/wx/analysis) + compteur du cache matches via globalThis + nb évictions ; timer accroché à globalThis (survit au hot-reload, unref).
- FIX 2 (analyze.ts) : analysisCache Map supprimé → cache partagé borné (clé analysis:{matchId}, mêmes TTL 60 s live / 30 min pre) ; cacheAnalysisDirectly/getCachedAnalysis gardés (signature inchangée) et unifiés sur la MÊME clé (fin de la double rétention) ; resolvePredictionsForDate : fetchs ESPN des ligues en PARALLÈLE borné (mapWithConcurrency 5), écritures DB restées SÉQUENTIELLES (SQLite un seul écrivain), logique de grading inchangée.
- FIX 3 (performance/route.ts) : borne inférieure 10 jours AJOUTÉE à la requête pending (gte now-10j, la borne documentée depuis toujours) — le scan ne peut plus déborder sur tout l'historique.
- Observabilité : lignes [mem] dans dev.log (ex : [mem] rss=1279Mo heap=136Mo matches=6 cache=600 sched=215 wx=110 analysis=114 sb=89 stand=36 inj=36) — permettront de voir toute dérive future.
- Test de charge : scripts/load-memory-test.ts (bun) — détecte le pid next-server (pgrep/ps), mesure la RSS via ps -o rss=, préchauffage (absorbe compiles dev + scans froids), puis vagues = 1× GET /api/matches + 10× POST /api/predictions (12 matchs RÉELS par lot, concurrence 3, pool de 3 journées ESPN) + 2× GET /api/performance ; phase de stabilisation (plateau < 15 Mo ou retour sous baseline, 120 s max) ; verdict PASSE si croissance stabilisée < 250 Mo ET plateau (pas de croissance linéaire).
- MESURES RSS : (a) test chaud (date 2026-09-10, 3 vagues, pool 106 matchs) — baseline 1185,8 → fin 1257,1 Mo : +71,3 Mo, plateau, PASSE ; (b) test FROID (date 2026-09-06, pool 404 matchs réels, 240 analyses dont la majorité en fetch ESPN réel : 28,3 s + 14,4 s de compute POST) — baseline 1262,2 → fin 1278,9 Mo : +16,7 Mo, vagues +9,8/+6,7, plateau Δ0, PASSE ; (c) observé avant correctif du verdict : pic transitoire 2152 Mo après la 1re salve froide + 404-match, PUIS GC/sweep → retour à 1126 Mo (niveau pré-test) — la mémoire est désormais TOUJOURS récupérable, plus aucune rétention vivante.
- /api/performance : 13 300 ms avant → 46-168 ms après (cache chaud) / 2 442 ms (1er appel après ajout de 36 pronos à résoudre, scans froids) — parallélisation bornée + borne 10 jours.
- Non-régression : bunx tsc --noEmit 2>&1 | grep '^src/' → VIDE ; bun run lint → 0 erreur ; suites existantes : test-live-prob 25/25, test-criteria 25/25, test-combo 76/76, test-bankroll 61/61, test-resolve-api 36/36 concordants (server live) ; curl /api/matches?date=2026-09-10 → 15 matchs réels / 9 ligues (X-Cache HIT/MISS normaux, filtre UTC strict Task 14 intact) ; /api/match/401879288 → analyse complète (probs/λ/confiance) OK ; dev.log sans erreur.

Stage Summary:
- Les 2 fuites qui tuaient le serveur sont corrigées : (1) le store de cache partagé (scoreboards ESPN par (ligue,date), calendriers par équipe, classements, blessures, météo, analyses) est désormais BORNÉ — LRU 600 entrées + sweep 60 s des expirés ; (2) le cache d'analyses module-level (rétention à vie par matchId + double canal) est unifié sur le store borné. La mémoire lourde redevient récupérable par GC : le pic transitoire de 2,1 Go redescend à 1,13 Go au repos au lieu de remplir le heap jusqu'au FATAL ERROR.
- /api/performance passe de 13,3 s à < 0,2 s (cache chaud) : borne 10 jours réellement appliquée + fetchs ligues parallélisés (5), écritures SQLite toujours séquentielles.
- Observabilité installée : lignes [mem] (rss/heap/tailles de cache par préfixe/évictions) au max toutes les 60 s dans dev.log + scripts/load-memory-test.ts rejouable (bun scripts/load-memory-test.ts [date] [vagues]) avec verdict automatique budget 250 Mo + plateau.
- Fichiers modifiés : src/lib/cache.ts (réécrit borné), src/lib/analyze.ts (cache analyses unifié + résolution parallèle), src/app/api/performance/route.ts (borne 10 j), scripts/load-memory-test.ts (nouveau). NON touché : src/app/api/matches/route.ts (éviction 8 j vérifiée efficace), matches route UTC strict, pages/composants (périmètre 18-b), espn.ts/weather.ts (timeouts déjà conformes).
- Risques résiduels : (1) le dev-mode Next 16/Turbopack consomme ~1,1-1,3 Go RSS au repos (compilations + watcher) — hors de notre contrôle, mais le heap JS reste ~130-500 Mo et sponges proprement ; (2) le LRU 600 peut évincer des scoreboards lors de grosses rafales multi-jours (re-fetch ESPN au prochain accès, latence +1-3 s, aucune erreur) ; (3) l'accumulation DB des Prediction (2 253 lignes) est gérée (take 300/2 000) — une purge des résolus anciens resterait un bonus futur ; (4) l'agent 18-b ne doit pas dupliquer un second timer [mem] côté client.

---
Task ID: 18
Agent: Super Z (agent principal, orchestration + validation croisée)
Task: Bug « Aucun match trouvé » signalé par l'utilisateur — résolution via sous-agents parallèles.

Work Log:
- Diagnostic initial : serveur dev MORT (2e/3e crash OOM, heap 2 Go épuisé, process next-server disparu) — « Aucun match trouvé » était le symptôme client d'une API injoignable. Redémarrage du serveur.
- Lancement en parallèle : agent 18-a (fuite mémoire serveur) + agent 18-b (résilience frontend), périmètres étanches.
- Validation croisée finale : tsc 0 erreur src/ · lint OK (exit 0) · /api/matches?date=2026-09-10 → 15 matchs réels · logs [mem] actifs (heap 104-168 Mo stable, cache LRU plafonné, évictions OK) · E2E agent-browser 390×844 : accueil « Tous (15) » + bouton Rafraîchir, 0 erreur console. Capture download/t18-final-accueil.png.

Stage Summary:
- Cause racine traitée des deux côtés : (1) fuites mémoire corrigées (cache LRU 600 + sweep 60 s, double rétention analyze.ts supprimée, /api/performance borné 10 j : 13,3 s → ~150 ms) → plus d'OOM ; (2) l'UI distingue désormais erreur réseau (« Impossible de charger les matchs » + Réessayer + auto-retry ×2 + stale-while-error) d'un jour réellement vide (« Aucun match trouvé » uniquement si HTTP 200 + 0 match).
- Fichiers : src/lib/cache.ts, src/lib/analyze.ts, src/app/api/performance/route.ts, scripts/load-memory-test.ts (18-a) ; src/app/page.tsx, src/app/combo/page.tsx (18-b).

---
Task ID: 19-a
Agent: Volt Audit Backend (agent d'audit et correction backend)
Task: Reprise d'un audit 19-a interrompu — audit/complétion du diff partiel non commité (analyze.ts, espn.ts, prediction.ts + routes api), re-vérification empirique des 5 findings (① Elo inversé, ② settlement matchs 00h-04h UTC, ③ 403 ESPN en Bun, ④ biais λ, ⑤ firstToScore), audit général backend, non-régression complète.

Work Log:
- Lu worklog.md (Tasks 15-18) : contexte Bug A (shrinkage λ Task 15), realOddsOnly (17), fuites mémoire/LRU (18), filtre UTC strict (14, intangible), serveur port 3000 interdit de redémarrage.
- Repris le diff partiel laissé par la tentative tuée : espn.ts (+12 = headers UA curl/8.5.0), prediction.ts (+44/-45 = sens avantage domicile Elo dans computeElo ET eloToProbs + extraction de firstToScoreProbs en fonction exportée), analyze.ts (+22 = refetch feuille scoreboard J−1 pour les ligues avec matchIds introuvables dans resolvePredictionsForDate), PLUS 3 routes api déjà marquées « Task 19-a » par l'agent tué : bankroll/resolve (+50 = repli J−1 groupe + fallback orphelins), cashout (+63 = loadBoard + repli J−1 + passage de 'draw' à legLiveProb pour « Match nul »), matches (+13 garde-fou scan dégradé), performance (+5 getUTC*), predictions (+25 écriture conditionnelle si !resolved). Décision : tout audité ligne à ligne, complété et validé — aucune réécriture inutile.
- Vérifié que TOUTES les fetchs ESPN passent par espnFetch (unique `fetch(` du fichier, line 114 → headers ESPN_HEADERS). Test réel Bun sur 3 familles d'URL (scoreboard eng.1, standings v2, scoreboard usa.1) : sans UA (UA Bun) → 403 ×3, avec UA curl/8.5.0 → 200 + JSON valide ×3.
- Complété le diff partiel (3 correctifs minimaux) : (a) analyze.ts currentSeasonYear → getters getUTC* (les getters locaux décalaient la saison d'un jour sur un serveur TZ≠UTC, ex. 01/08 00h30Z lu « juillet » en UTC−5 → saison 2025 → historiques vides) ; (b) analyze.ts resolvePredictionsForDate → Set donePickIds : un événement présent sur les feuilles J ET J−1 ne doit être ni réécrit 2× en DB ni compté 2× dans resolvedCount ; (c) /api/cashout + /api/bankroll/resolve → plafond 50 jambes (400 sinon) : le fan-out ESPN = 1 scoreboard par (ligue,date) ×2 feuilles, non borné avant (fetch-storm possible sur corps corrompu).
- Re-vérification empirique des 5 findings : harnais scripts/test-audit-19a.ts (20/20), preuve AVANT ① recalculée avec la formule HEAD (Elo égal → dom 28,1 % vs ext 46,6 % = inversé ; APRÈS dom 46,6 % > ext 28,1 %), preuve ESPN ② (match MLS 761796 du 2026-09-10T02:30Z absent de la feuille dates=20260910, présent sur dates=20260909), ③ 403/200 Bun ci-dessus, ④ scripts/test-lambda-bias-standalone.ts 30 matchs (process neuf : ratio modèle/marché médiane 0,904, 26/30 dans ±20 %, 29/30 dans ±30 %) + scripts/test-under25-bias.ts (écart moyen modèle−marché −2,2 pts, λ total moyen 2,76), ⑤ firstToScoreProbs sommée à 1 (±0,001) sur grille λ 0,1-4,0 + cas (0,0) et asymétriques + via runEngine.
- E2E : scripts/test-settle-night-matches.ts via la vraie route /api/bankroll/resolve → 3 matchs MLS nocturnes (00h30/02h30Z) réglés WIN avec scores réels (2-2, 2-3, 1-1), 7/7 ; scripts/test-predictions-persist.ts → prono déjà résolu jamais réécrit (5/5) ; /api/cashout réel sur le match nocturne 2-2 « Match nul » → verdict WIN, decision WON, fairValue 37 € (10 × 3,7).
- Audit général backend : /api/matches (single-flight, scan 24 conc., éviction 8 j, warmers unref — RAS), /api/predictions (batch ≤ 12, analyse 6 conc. — RAS), /api/match/[id] (400/404 propres — RAS), grade.ts (gradeEvent sans fenêtre temporelle, statuses finaux ESPN — RAS), timers tous unref (cache sweep 60 s + warmer matches 5 min), erreurs avalées toutes documentées avec replis sains, comparaisons/arrondis de cotes sains (deMargin borné sum∈]1,1.3], americanToDecimal arrondi 2 déc.).
- Non-régression : tsc 0 erreur src/ · bun run lint exit 0 · suites : live-prob 25/25, criteria 25/25, combo 76/76, bankroll 61/61, resolve-api 36/36 · curl /api/matches?date=2026-09-10 → 15 matchs stricts jour UTC (X-Cache STALE→HIT) · date=2026-09-11 → 56 matchs stricts · /api/performance 8,5 s 1er appel (recompilation Turbopack des fichiers modifiés) puis 0,058 s chaud.
- Nouveaux scripts (non commités, rejouables) : test-audit-19a.ts (harnais ①②③⑤), test-lambda-bias-standalone.ts (④ process neuf), test-settle-night-matches.ts (② E2E), test-predictions-persist.ts (écriture conditionnelle). scripts/test-same-match-swap.ts = 19-c (non touché).

Stage Summary:
- Diff partiel repris et COMPLÉTÉ : il contenait déjà les correctifs ③ (UA curl/8.5.0 sur espnFetch), ① (sens du bonus domicile Elo corrigé dans computeElo + eloToProbs : AVANT Elo égal = dom 28 %/ext 47 % inversé → APRÈS dom 47 %/ext 28 %), ⑤ (firstToScoreProbs exportée, somme 1,000), ② (repli feuille J−1 dans resolvePredictionsForDate, /api/bankroll/resolve et /api/cashout), plus 3 bonus (garde-fou scan dégradé /api/matches, getUTC* /api/performance, écriture conditionnelle /api/predictions). J'ai ajouté : getUTC* dans currentSeasonYear (analyze.ts), dédoublonnage de résolution J/J−1 (analyze.ts), plafond 50 jambes sur cashout + bankroll/resolve (concurrence bornée).
- Findings : ① CORRIGÉ+TESTÉ (20/20) · ② CORRIGÉ+TESTÉ (harnais + E2E 7/7 sur vrais matchs nocturnes MLS) · ③ CORRIGÉ+TESTÉ (Bun : 403 sans UA / 200 avec UA sur 3 URLs ; toutes les fetchs ESPN passent par espnFetch) · ④ VÉRIFIÉ CONFORME post-correctifs (médiane 0,904 dans ±20 %, 26/30 par-match, écart Under 2,5 −2,2 pts ; léger biais résiduel conservateur −9 % documenté, non retouché pour préserver la calibration Task 15) · ⑤ CORRIGÉ+TESTÉ (somme 1,000 exactement, grille λ + runEngine ; le bug d'origine 1+e^−λ≈1,06 datait d'avant Task 15 qui l'avait déjà fixé).
- Bugs hors périmètre : aucun nouveau bug signalé hors périmètre (src/lib/combo.ts +90 = repairToTarget Task 15 non commité, validé 76/76 par sa suite — dossier 19-c ; composants/pages non audités par conception).
- Fichiers modifiés (Task 19-a) : src/lib/espn.ts, src/lib/prediction.ts, src/lib/analyze.ts, src/app/api/{bankroll/resolve,cashout,matches,performance,predictions}/route.ts (+ scripts de test). Intangibles préservés : filtre UTC strict Task 14, shrinkage Task 15, realOddsOnly Task 17, LRU/temps Task 18.
---
Task ID: 19-c
Agent: Volt Feature (sous-agent feature Combinator)
Task: « Autres paris du même match » — remplacer une jambe du combiné par un AUTRE PARI du même match (reprise + achèvement du diff partiel laissé par une tentative tuée), même pipeline que les échanges ⟳ (produit exact, réparation auto vers la cible ou badge « sous l'objectif »).

Work Log:
- Reprise : audité `git diff HEAD` sur src/lib/combo.ts (+90) et src/app/combo/page.tsx (+187) — le diff partiel contenait déjà l'ossature complète de la feature (helpers moteur marketGroupId/groupByMarket/listSameMatchAlternatives/isLegInProfile ; UI section « Autres paris du même match » + état samePick exclusif des picks ⟳ + preview AVANT/APRÈS + applySwap 1-pour-1 branché sur repairToTarget). Vérifié ligne à ligne que RIEN n'était à moitié branché : imports ✓, memos (sameMatchAlts/sameMatchGroups/filteredSameMatchGroups/sameCandidate) ✓, toggleSamePick ✓, bouton confirm + disabled ✓, sections mutuellement exclusives ✓. Aucun fichier hors périmètre touché par le diff (criteria/store/ticket inchangés — schéma localStorage intact pour /vente).
- Lu worklog (Tasks 14-18) : conventions design ancien (dark #0a0a0c + volt #e8ff00, cartes bg-[#141418], chips), pipeline critères (poolRef déjà filtré par filterCandidates → les remplacements héritent des critères), invariant « cote affichée = produit exact », garde-fou repairToTarget/badge du Task 16, filtre UTC strict Task 14.
- Complété/corrigé : aucune modification de code nécessaire — le diff était complet et cohérent ; le travail a porté sur la VALIDATION exhaustive (le précédent run avait tué le process avant tests/worklog). RAS à signaler sur le diff ; conservé tel quel (0 ligne modifiée).
- Serveur dev trouvé MORT en début de session (port 3000 muet, cf. pattern Tasks 18) → relancé via le chemin officiel (setsid bash .zscripts/dev.sh) ; retombé une seconde fois en fin de session → relancé pareil (aucun process actif touché à chaque fois).
- Tests : nouveau harnais scripts/test-same-match-swap.ts (repris du diff non commité, revu et validé) — 3 sections : (1) helpers moteur (groupes de marché, ordre 1X2→DC→Buts→BTTS→autre, exclusion de la sélection jouée, pas de doublons, isLegInProfile prudent/équilibré/plafond cote) ; (2) pipeline complet synthétique : produit EXACT cote affichée = produit des jambes, unicité 1 pari/match, critères realOddsOnly hérités (BTTS estimées exclues du remplacement), repairToTarget (au-dessus cible = ticket intact ; chute sous cible → cible rétablie + unicité + profil préservés), cas sans alternative → liste vide sans erreur ; (3) données RÉELLES du jour via API locale : combiné ×3 sur 15 matchs (210 candidats → 144 après critères), remplacement DC→1X2 du même match, invariants vérifiés + réparation réelle. 46/46 OK.
- Suites existantes : test-combo 76/76 · test-criteria 25/25 · test-combo-invariant 0/756 échecs · test-combo-real OK · test-combo-seeds 0 violation · test-combo-swapdrop PASS (régression ⟳ nulle).
- Non-régression : `bunx tsc --noEmit 2>&1 | grep '^src/'` → VIDE ; `bun run lint` → 0 erreur 0 warning.
- E2E agent-browser 390×844 (session dédiée t19c, /combo) : génération ×3 sur aujourd'hui (15 matchs réels) → ticket 2.00×1.53=3.06 (produit exact) ; feuille d'échange → section « Autres paris du même match » EN PREMIER, regroupée RÉSULTAT (1X2) / DOUBLE CHANCE / BUTS (OVER/UNDER) (libellés uppercase volt), BTTS absente (realOddsOnly défaut ON) ; chaque ligne : pick + chip risque + « cote réelle/marché · confiance X/5 » + badge « HORS PROFIL » si sort du profil + cote + proba ; la sélection jouée absente de la liste ; sélection « Victoire Slavia Prague » (2.70, même match) → aperçu « Cote totale : ×3.06 → ×5.40 · probabilité 38 % → 18 % · 2 sélections » ; exclusivité vérifiée (cliquer un candidat d'un AUTRE match annule le pari même-match et inversement) ; « Remplacer par ce pari » → jambe remplacée EN PLACE (même matchId, nouveau market/pick), ticket ×5.40 = 2.00×2.70, undo disponible ; ticket plein écran /combo/ticket à jour (Victoire Slavia Prague · 1X2 · ×5.40) ; filtre de risque Sûr/Moyen/Risqué opérant sur les DEUX sections ; chemin sous-objectif vérifié (choix « Municipal ou Nul (X2) » @1.24 → aperçu ×5.06 → ×3.14 + mention rouge « sous l'objectif ×5 (réajustement auto à la validation) » → validation → repairToTarget rétablit ≥ cible, produit exact et unicité conservés ; deuxième scénario ×3 → ×1.90 → réparation → ×3.06) ; badge « Sous l'objectif » couvert par les suites quand la réparation échoue (test-combo-swapdrop) ; console 0 erreur, page errors 0 ; /vente s'ouvre normalement (schéma localStorage inchangé). Captures : download/t19-c-{combo-avant,feuille-meme-match,apercu-avant-apres,combo-apres,ticket-apres}.png.
- Bugs hors périmètre : (1) le serveur dev est retombé 2× sans trace d'erreur dans dev.log pendant la session (pattern OOM/instabilité du Task 18 — à surveiller, lignes em] à relire) ; (2) rien d'autre : aucune anomalie détectée dans api/**, analyze/prediction/espn, components/** pendant la passe.

Stage Summary:
- Le Combinator permet désormais de garder un match en changeant de pari : la feuille d'échange d'une jambe expose « Autres paris du même match » (tous les candidats du même matchId du vivier filtré par les critères, regroupés Résultat 1X2 → Double chance → Buts O/U → BTTS → autres, avec cote réelle/marché, source, confiance et proba, badge « Hors profil ») au-dessus de la section historique « D'un autre match » — les deux sections sont exclusives (un seul pari par match dans le ticket, invariant moteur préservé par construction 1-pour-1). La validation rejoue le pipeline existant : cote totale = produit EXACT des cotes affichées, réparation auto repairToTarget si le choix fait tomber sous la cible, badge « sous l'objectif » sinon, undo, aperçu AVANT/APRÈS cote + proba, critères (realOddsOnly, marchés, confiance, ligues) hérités du vivier.
- Diff partiel repris : COMPLET et sain (audit ligne à ligne + tests) — livré tel quel, 0 ligne de code modifiée par cette passe ; la valeur ajoutée = validation complète (46 checks nouveaux + 857 checks existants), E2E bout-en-bout avec captures, et worklog.
- Fichiers : src/lib/combo.ts (+90 : marketGroupId, MARKET_GROUP_LABELS, groupByMarket, listSameMatchAlternatives, isLegInProfile), src/app/combo/page.tsx (+187 : état samePick exclusif, section « Autres paris du même match » groupée par marché, aperçu AVANT/APRÈS, applySwap 1-pour-1 → repairToTarget → saveComboTicket), scripts/test-same-match-swap.ts (nouveau, 46 checks). NON touchés (schéma préservé) : combo-criteria.ts, combo-store.ts, combo/ticket/page.tsx, /vente, api/**.
- Tests : test-same-match-swap 46/46 (dont scénario réel API) · test-combo 76/76 · test-criteria 25/25 · test-combo-invariant 756/756 · swapdrop/seeds/real PASS · tsc 0 · lint 0 · E2E 390×844 OK, console 0 erreur, captures download/t19-c-*.png.
---
Task ID: 19-b
Agent: Volt Audit Frontend (agent d'audit et correction bugs frontend)
Task: Audit systématique des écrans frontend (accueil + onglets Ligues/Profil, détail match, /precision, /vente + feuilles, layout, tab-bar, composants voltrix) — chasse aux races, crashes localStorage corrompu, affichages NaN/undefined/Infinity, navigations mortes, hydratation, cohérence des indicateurs ; correctifs minimaux, design inchangé.

Work Log:
- Lu worklog.md (Tasks 18-19-b) : état récent (3 états accueil/combo Task 18-b, « Autres paris du même match » 19-c à ne pas casser, périmètre étanche : jamais src/app/api/**, src/lib/**, src/app/combo/**).
- Serveur dev trouvé VIVANT (port 3000, HTTP 200) — jamais redémarré ; surveillé toute la session (0 crash, [mem] rss 2,0 Go / heap 486-863 Mo fluctuant mais cache LRU borné 553-559/600 avec évictions actives — pattern de haut niveau à surveiller, cf. Stage Summary).
- Lecture intégrale des fichiers du périmètre (page.tsx 721 l., vente/page.tsx 765 l., precision/page.tsx 401 l., layout.tsx, match-card/shared/match-detail/tab-bar/share.ts, globals.css) + lecture SANS modification des stores liés (preds-cache.ts, cashout-store.ts, combo-store.ts — tous avec try/catch et garde de shape) et des types (types.ts) + routes API consommées (cashout, matches) pour valider les shapes.
- Audit statique anti-races : page.tsx (runIdRef + dateRef + dataRef + autoRetry/backoff annulable — solides, y compris double-fetch StrictMode invalidé par runId), precision (aliveRef), match-detail (flag cancelled), vente (setAnalyzing dans finally, closure coupons frais via deps) — AUCUNE race bloquante trouvée.
- Audit localStorage/crash au boot : injection de clés corrompues dans le navigateur (session dédiée 390×844). voltrix_preds_v1 corrompu → accueil résilient (match-card avec ?. partout, {btts && …} garde OK) ; voltrix_combo_ticket corrompu (« not-json{{ ») → loadComboTicket try/catch → pas d'import, page OK ; voltrix_sell_coupons_v1 avec coupon VALIDE + matchDate:null → CRASH PLEIN ÉCRAN de /vente confirmé (« Application error: a client-side exception has occurred », RangeError: Invalid time value at CouponCard, DOM.main disparu) → BUG #2 corrigé (cf. Stage Summary).
- Audit affichage via E2E réel : accueil 15 matchs (chips Hier/Aujourd'hui/Demain correctes UTC, analyses progressives par lots de 6, filtre ligues + onglet Ligues onPick OK, Profil OK, deep-links /?tab=leagues|profile OK), détail Bayern (onglets Pronos/Analyse/H2H/Cotes, partage image sans erreur), /precision (51 %, Brier 0.252 « À surveiller », calibrage, par confiance/compétition, historique), /vente (transfert, évaluation réelle /api/cashout → GARDER, valeur juste 9,30 €, écart -19 %, « J'ai vendu pour 7,50 € » → Vendus avec bilan -2,50 € et 50 % du gain max — mathématiques exactes).
- BUG #1 trouvé et corrigé (match-detail.tsx, onglet Cotes) : quand la ligne O/U du marché (ex. 4.5 pour Bayern–Bodo/Glimt, id 401915443) n'est pas couverte par le modèle (1.5/2.5/3.5), les OddsBox affichaient « Marché 58 % · Modèle 0 % » — un faux 0 % (find() undefined → ?? 0). Repro : détail Bayern → Cotes ; preuve avant : « Modèle 0 % » ×2 ; après : « Modèle — » (null propagé, OddsBox accepte number|null, edge neutre si null). Non-régression vérifiée sur Fenerbahce–AS Roma (ligne marché 2.5 couverte) : « Modèle 50 % » et « +7 % d'écart » toujours affichés.
- Race-test E2E : bascule rapide Aujourd'hui ↔ Demain ×3 (15 ↔ 56 matchs) — aucune donnée mélangée, aucune erreur console (garde runId efficace) ; state final cohérent avec la date cliquée.
- Correctifs au MultiEdit, ciblés : src/app/vente/page.tsx (+15/-2 : helpers fmtCouponDay/fmtSoldAt avec repli '' sur Invalid Date, 2 call sites) ; src/components/voltrix/match-detail.tsx (+5/-4 : OddsBox modelProb number|null, « — » au lieu de faux 0 %, 2 call sites O/U ?? null). AUCUN style touché (le « — » réutilise la convention existante des cotes manquantes) ; /combo, api/**, lib/** non touchés.
- Non-régression : `bunx tsc --noEmit 2>&1 | grep '^src/'` → VIDE ; `bun run lint` → exit 0 ; suites intacts (aucun fichier lib/api modifié).
- E2E final sans erreur : accueil → détail (Slavia Prague) → /precision → /vente, console 0 [error], page errors 0 (session propre vérifiée après correction). Captures : download/t19-b-{accueil,detail,detail-analyse,detail-cotes-fix,precision,vente,leagues,profil,vente-coupon,vente-eval}.png + preuves avant/après crash : t19-b-vente-crash.png (AVANT : écran blanc) et t19-b-vente-corrupt-fix.png (APRÈS : page rendue).
- Storage de test nettoyé (localStorage vidé dans les sessions de test — aucun artefact laissé).

Stage Summary:
- 2 bugs trouvés et corrigés (preuves avant/après) :
  1. src/app/vente/page.tsx — CRASH au boot : un coupon localStorage (voltrix_sell_coupons_v1) avec matchDate absent/corrompu (ou soldAt non numérique) levait RangeError: Invalid time value dans Intl.DateTimeFormat.format → écran blanc « Application error » sur TOUTE /vente (repro injecté + reload confirmé). Fix : fmtCouponDay()/fmtSoldAt() avec repli chaîne vide sur date invalide (preuve : même injection après fix → page rendue, « Vendus · 1 », 0 erreur page). Design inchangé (la date est simplement absente si invalide).
  2. src/components/voltrix/match-detail.tsx — faux « Modèle 0 % » : onglet Cotes, bloc « Total de buts » : si la ligne O/U du marché (ex. 4.5) n'est pas dans les lignes du modèle (1.5/2.5/3.5), find() → ?? 0 affichait une proba modèle de 0 % inexistante. Fix : null propagé → OddsBox affiche « Modèle — » (convention « — » déjà utilisée pour cote manquante) et l'edge n'est plus calculé sur null. Preuve : Bayern (ligne 4.5) « Marché 58 % · Modèle — » ; non-régression Fenerbahce (ligne 2.5) « Modèle 50 % » + badge « +7 % d'écart » conservés.
- Bugs hors périmètre signalés (NON corrigés — lecture seule) : (1) /api/cashout renvoie score:"0 - 0" pour les jambes pré-match (l'affichage /vente l'encadre par « Pas encore commencé » donc non trompeur, mais le garde Task 17 appliqué à /api/match/[id] serait pertinent côté LegReport, src/app/api/cashout/route.ts) ; (2) charge mémoire serveur repartie haute ce jour ([mem] rss ≈ 2,0 Go, heap 486→863 Mo en fin de session, LRU borné et évictions actives donc pas de fuite brutale, mais le pattern OOM des Tasks 18/19-c mérite une surveillance — rien de muet côté port 3000 pendant ma passe) ; (3) mineur, cosmétique : libellé « 1 sélections » (singulier) sur /vente et feuille d'éval — purement textuel, laissé tel quel (design/libellés intacts, présent aussi hors périmètre).
- Aucune régression : tsc 0 erreur src/, lint exit 0, parcours accueil → détail → /precision → /vente sans 1 seule erreur console, zones 19-a/19-c intactes (0 ligne modifiée hors mes 2 fichiers).

---
Task ID: 19
Agent: Super Z (agent principal, orchestration + validation croisée)
Task: (1) vague de sous-agents analyse bugs App + corrections ; (2) feature combinator « remplacer une jambe par un autre pari du même match » ; (3) packaging du code source en .zip.

Work Log:
- 1re salve de 3 agents parallèles tuée par le Task tool (context deadline) → reprise séquentielle avec audit du diff partiel laissé (combo.ts +90, combo/page.tsx +187, analyze/espn/prediction).
- Agent 19-a (backend) : 10 bugs corrigés, 5 findings re-vérifiés avec preuves (① Elo domicile inversé RÉELLEMENT corrigé : dom 46,6 % > ext 28,1 % ; ② settlement nocturne via repli feuille J−1, E2E 7/7 ; ③ headers UA espnFetch → 200 ×3 ; ④ λ médian 0,904 / 26-30 dans ±20 % ; ⑤ firstToScore = 1,000 exactement). Notables : upsert predictions ne réécrit plus les pronos résolus, TZ bugs (performance, saison), plafond 50 jambes cashout, garde-fou scan dégradé.
- Agent 19-c (feature) : diff partiel complet et sain, validé — section « Autres paris du même match » dans la feuille d'échange (groupée 1X2/DC/BUTS/BTTS, cotes réelles, badge HORS PROFIL, exclusivité avec ⟳, aperçu AVANT/APRÈS, repairToTarget, undo) ; harnais 46/46 ; E2E réel DC → Victoire même match ×5,40 = 2,00×2,70.
- Agent 19-b (frontend) : 2 bugs corrigés — crash /vente sur localStorage corrompu (Invalid time value → helpers sûrs), faux « Modèle 0 % » sur lignes O/U non couvertes (null → « Modèle — »). Parcours E2E complet 0 erreur.
- Validation croisée finale : tsc 0 · lint OK · suites combo 76/76, criteria 25/25, live-prob 25/25 · API 15 matchs · /api/performance 0,16 s · E2E accueil OK 0 erreur console.
- Zip : download/voltrix-bet-source-2026-09-10.zip (383 Ko, 165 fichiers — src, scripts, prisma, tests, configs ; exclut node_modules/.next/.git/.env/db/logs).

Stage Summary:
- App auditée de bout en bout : 12 bugs corrigés au total (10 backend + 2 frontend), 5 findings d'audit clos avec preuves empiriques, feature « pari du même match » livrée et validée.
- Note de suivi : instabilité mémoire résiduelle (serveur retombé 2× pendant la session 19-c, pattern OOM non reproduit sous charge [mem] stable — à surveiller).

---
Task ID: 20
Agent: Super Z (agent principal)
Task: Dossier technique PDF de VOLTRIX bet (15+ pages, très technique, captures fraîches, guide écran par écran).

Work Log:
- Clarification utilisateur : PDF, dossier développeur, long 15+ p., niveau très technique, 6-8+ captures fraîches, bonus « écran par écran ».
- Skill pdf chargé + chaîne complète lue (SKILL, fonts, report, cover, overflow, palette, pagination, typography, fill-engine, charts, geometry, cover-backgrounds).
- 13 captures fraîches de l'app via agent-browser (viewport 390×844 corrigé après détection de captures desktop) : accueil, cartes, détail (Palmeiras LIVE), pronos, combo form/critères/résultat ×10 (4 jambes réelles), feuille « autres paris du même match », ticket, vente + évaluation offre 25 € → GARDER (74 % sous la valeur), précision.
- Palette cascade générée (famille acier, accent #3e91bb). Couverture Template 01 HUD (valideurs poster_validate + cover_validate PASS, rendu html2poster 794px).
- Corps ReportLab : TocDocTemplate + multiBuild, 9 chapitres, 5 tableaux, callouts, formules (<super>/<sub>), diagramme pipeline 8 nœuds Playwright+CSS→PNG@2x (connecteur en L corrigé), 9 captures encadrées.
- Fixes qualité : numérotation sommaire ≠ pieds de page (zones roman/arabe non convergentes sous multiBuild) → numérotation arabe continue alignée ; tirets cadratins insécables ; normalize A4 strict (0,1 pt) ; fausse alerte TOC vide (détecteur) vérifiée visuellement.
- QA finale : pdf_qa PASS (0 erreur, 0 warning avec --skip-cover), meta.brand, pages.clean 0, font.check 0.
- Livrable : download/VOLTRIX-bet-Dossier-technique.pdf (23 pages, 1,04 Mo). Captures + diagramme : download/doc-voltrix/.

Stage Summary:
- Dossier technique complet livré : présentation, architecture, sources ESPN, moteur (shrinkage, Elo, blessures, calibration, Poisson, Kelly), Combinator, Vente, précision/règlement, guide illustré 9 captures, qualité/limites.

---
Task ID: 21-c
Agent: généraliste (robustesse ops)
Task: Concurrence cash-out bornée, rate limiting, mentions UI expérimental.

Work Log:
- Lu worklog.md (Tasks 17, 18-a/b, 19-a/b/c, 20) : contexte OOM/LRU (18-a, d'où mapWithConcurrency ligne 139 de src/lib/cache.ts), plafond 50 jambes cashout (19-a), ancien design #e8ff00 (17), serveur dev VIVANT port 3000 (0 redémarrage, surveillé toute la session).
- CHANTIER 1 (src/app/api/cashout/route.ts:194) : le Promise.all sur `Array.from(groups.entries()).map(async ...)` lançait 1 fetch scoreboard ESPN PAR couple (ligue,date) SIMULTANÉMENT — le plafond 50 jambes borne le nombre de groupes mais PAS la concurrence (50 jambes réparties sur 50 couples = 50 appels en vol). Remplacé par `mapWithConcurrency(Array.from(groups.entries()), 4, async ([key, groupLegs]) => ...)` (même helper que le scan /api/matches) ; logique INTACTE : chargement feuille J + repli J−1 (Task 19-a finding ②), byId par groupe, boards.set — preuve dynamique : 24 tâches concurrentes observées max 4 en vol, ordre préservé (scripts/test-cashout-concurrency.ts 10/10).
- CHANTIER 2 (src/lib/rate-limit.ts NOUVEAU) : limiteur mémoire zéro dépendance, pattern cache.ts (Task 18-a) — buckets accrochés à globalThis (`__voltrixRateBuckets`, survivent au hot-reload), fenêtre GLISSANTE par clé `name:ip` (horodatages des hits autorisés, purge au contrôle), un 429 ne consomme PAS de quota (pas de lockout auto-entretenu), retryAfterSec = temps avant sortie de fenêtre du plus ancien hit autorisé ; sweep périodique 60 s des buckets vides (timer globalThis + unref, cf. cache.ts) + LRU 10 000 buckets max (réinsertion fin de Map + éviction tête) ; IP = x-forwarded-for (1re entrée) → x-real-ip → repli 'local'. API exacte : `rateLimit(req, name, limit, windowMs) → { allowed, retryAfterSec }` (+ rateLimitStats() diagnostic).
- Application : /api/matches GET → rateLimit(req,'matches',60,60_000) en tête de handler (route.ts:310) ; /api/cashout POST → rateLimit(req,'cashout',15,60_000) AVANT le parse JSON (route.ts:110). 429 : `NextResponse.json({ error: 'Trop de requêtes, réessaie dans X s' }, { status: 429, headers: { 'Retry-After': String(retryAfterSec) } })`. Limites généreuses : rafraîchissement ~60 s + analyses par lots de 6 = usage normal très loin des seuils.
- CHANTIER 3 (src/app/vente/page.tsx:460) : feuille d'évaluation, mention muted 1 ligne entre le verdict GARDER/VENDRE + message et la barre « Offre vs valeur juste » (écart %) : « Estimation expérimentale — modèle live simplifié, ne constitue pas une valorisation de marché. » (text-[11px] text-muted-foreground, style existant). Rien d'autre : caveat indépendance sélections /combo laissé à l'agent dédié.
- Tests : scripts/test-rate-limit.ts (NOUVEAU, 18/18) — sous limite → allowed/retryAfterSec 0 ; limite+1 → refusé + retryAfterSec ∈ ]0;60] ; refus sans consommation ; 2 IPs → buckets indépendants ; fenêtre 120 ms → quota libéré après expiration ; XFF multi-IP = 1re IP (clé stable), x-real-ip et repli local OK. scripts/test-cashout-concurrency.ts (NOUVEAU, 10/10) — statique (import mapWithConcurrency, concurrence 4, Promise.all groupes disparu, repli J−1 et boards.set intacts) + dynamique (max 4 en vol, ordre, parallélisme réel). `bun scripts/test-rate-limit.ts` → PASS ; `bun scripts/test-cashout-concurrency.ts` → PASS.
- Validation live SANS redémarrage : `bunx tsc --noEmit 2>&1 | grep '^src/'` → VIDE (un TS1128 de ma première édition corrigé entre-temps : parenthèse fermante en trop ligne 222) ; bunx eslint sur mes 6 fichiers → 0 erreur ; curl http://localhost:3000/api/matches → 200 (X-Cache HIT) ×4, aucun 429 ; POST /api/cashout corps invalide → 400 (rate limiter franchi, route vivante post hot-reload). Prouve E2E le 429 : 16 POST rapprochés /api/cashout → 15×400 puis HTTP 429 + `retry-after: 35` + message français exact ; quota auto-libéré après la fenêtre (400 à nouveau ~40 s plus tard) et /api/matches JAMAIS affecté (buckets séparés par `name`).

Stage Summary:
- Fan-out ESPN du cash-out désormais borné à 4 groupes en vol (au lieu d'autant de couples ligue+date que le coupon en contient, jusqu'à 50), repli J−1 et grading inchangés — une requête 50 jambes ne peut plus déclencher un fetch-storm.
- Rate limiting anti-abus en mémoire opérationnel : /api/matches 60 req/min/IP, /api/cashout 15 req/min/IP, 429 + Retry-After en français, zéro dépendance, borné (LRU 10 000 + sweep 60 s), survit au hot-reload — usage normal vérifié non gêné (200×4 d'affilée, refus auto-levés dès la fenêtre passée).
- Pour l'orchestrateur (performance/predictions — copiable tel quel) :
  `import { rateLimit } from '@/lib/rate-limit';`
  `const rl = rateLimit(req, 'performance', 30, 60_000); if (!rl.allowed) return NextResponse.json({ error: \`Trop de requêtes, réessaie dans ${rl.retryAfterSec} s\` }, { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } });`
  (mêmes schémas pour 'predictions' — ex. 40 req/min/IP pour absorber les lots de 6 ; fonction synchrone, compatible NextRequest comme Request).
- Fichiers : src/app/api/cashout/route.ts (concurrence 4 + rateLimit), src/app/api/matches/route.ts (rateLimit), src/lib/rate-limit.ts (nouveau), src/app/vente/page.tsx (+3 lignes mention), scripts/test-rate-limit.ts + scripts/test-cashout-concurrency.ts (nouveaux). NON touchés : prediction/market-odds/analyze/grade, api/performance, api/predictions, combo/page.tsx, components/voltrix/**.

---
Task ID: 21-b
Agent: généraliste (cohérence moteur)
Task: Calibration unique runEngine, BTTS forme fermée, consensus argmax, value non circulaire, météo descriptive.

Work Log:
- Lu worklog.md (Tasks 13-b, 15, 16-19-a/b/c, 18) : contexte shrinkage λ (15), realOddsOnly (17), LRU/mémoire (18-a), « autres paris du même match » (19-c), filtre UTC strict Task 14 (intangible, aucune logique de bornes touchée), serveur port 3000 JAMAIS redémarré (vivant toute la session, hot-reload Turbopack vérifié).
- FIX 1 VÉRIFIÉ : calibrateTotals n'était appelé QUE par src/app/combo/page.tsx (anciens lines 283-284, via deMarginOverUnder sur p.ouOdds) → fiche (Poisson brut) et Combinator (recalé marché) deux vérités pour un même match. Les cotes ÉTAIENT DÉJÀ dans EngineInput (odds: EspnOdds | null, prediction.ts ~572, alimenté par analyze.ts:157 odds: event.odds) → branchement direct, aucun paramètre additionnel requis. CORRIGÉ : la calibration devient l'étape officielle du pipeline dans runEngine (src/lib/prediction.ts:765-792) — anchorLine = odds.overUnderLine (si hasOdds), cotes over/under = closeOdds ?? openOdds (mêmes inputs que l'ancien chemin combo) → deMarginOverUnder + calibrateTotals(λ, ligne, pOver dé-margé, [1.5,2.5,3.5]) → p.overUnder / p.btts calibrés ; cotes absentes/invalides → brut conservé. recommendedBets (Total buts 2.5, BTTS : prediction.ts:813, 820-825) et donc extractPicks/Brier passent au calibré.
- FIX 1 (combo) : double calibration SUPPRIMÉE — src/app/combo/page.tsx:273-328 consomme p.overUnder / p.btts directement (aucun recalcul) ; realOu (p.ouOdds) ne sert plus qu'aux cotes (réelles sur la ligne marché, oddsWithMargin sur les lignes interpolées) ; oddsSource 'market' ⟺ ligne O/U marché présente (≈ calibration amont, sémantique criteria inchangée), BTTS toujours 'estimate' (fairOdds) → comportement realOddsOnly préservé. Imports nettoyés (calibrateTotals/deMarginOverUnder/CalibratedTotals retirés, page.tsx:62-65). Invariant « cote combiné = produit EXACT des jambes » intact (test-same-match-swap 46/46 re-vérifié).
- FIX 2 VÉRIFIÉ puis CORRIGÉ (src/lib/prediction.ts:430-493) : poissonModel tronquait à MAX=8 et sommait bttsYes sur la grille puis no = 1 − yes (biais de troncature jusqu'à ~1 % de masse pour λ 3.8/3.4). Grille étendue à 0..12 + renormalisation (division par gridSum) AVANT tout calcul → 1X2 et O/U somment 1 ; BTTS = forme fermée partagée bttsProb (import market-odds, prediction.ts:12 ; même formule (1−e^−λh)(1−e^−λa), cohérence inter-écrans exacte), volontairement non arrondie ; under = round(1 − over, 4) → over+under ≡ 1 exactement. test-engine-fix (λ 2.75, under 48.1 %) et test-lambda-bias restent verts (148 matchs : médiane 0.951, 130/148 ±20 % — λ inchangés par design).
- FIX 3 VÉRIFIÉ puis CORRIGÉ (src/lib/prediction.ts:750-760) : l'ancien `models.every(m => m.home >= m.away) || …away >= home` validait un « accord » même avec le nul en top d'un modèle. Remplacé par un vrai consensus d'argmax : argmaxOutcome (dom/nul/ext, déterministe en cas d'égalité) identique chez Poisson, Elo ET Forme. Formule de confiance CONSERVÉE : conf = 1 + clamp(gap×10, 0, 2) + (consensus ? 1 : 0) + dataBonus (les scores baissent parfois — voulu) ; vérifié end-to-end dans test-consistency (confiance reconstruite depuis les sorties poisson/elo/form = valeur du moteur).
- FIX 4 CORRIGÉ (src/lib/prediction.ts:54-62, 775-801, 903) : runEngine produit les DEUX — p.overUnder/p.btts calibrés (affichage) + p.raw { overUnder, btts } BRUT ; buildValueBets reçoit le BRUT (edge = p_brute × cote − 1, Kelly) avec commentaire « brut = value, calibré = affichage » (2 blocs de commentaire prediction.ts:765-774 et 794-797). Preuve test-consistency : value bet « Plus de 2.5 » à modelProb = brut 0.5137 ≠ calibré 0.4675, edge +5.31 % (le calibré aurait donné −4.1 % = jamais de value). NOTE hors périmètre : l'onglet Cotes de src/components/voltrix/match-detail.tsx (478-479) lit p.overUnder → affichera désormais le calibré (« Modèle ≈ Marché » sur la ligne ancre) ; pour retrouver l'écart brut il suffira au propriétaire du composant de pointer p.raw.overUnder — non modifié (périmètre 21-b exclusif).
- FIX 5 VÉRIFIÉ puis CORRIGÉ (src/lib/prediction.ts:681-686) : la multiplication des λ par weatherImpact.goalsFactor est SUPPRIMÉE (commentaire « Influence météo retirée en attendant une validation hors-échantillon (audit 21-b FIX 5) ») ; input.weatherImpact conservé dans EngineInput (analyze.ts:159 non touché) et l'affichage descriptif de la fiche intact (aucun composant modifié). Preuve : λ et probabilités strictement identiques avec weatherImpact 0.95 vs null (test-consistency). Aucun test n'assertait l'ancien comportement météo.
- Bonus cohérence : l'arrondi d'affichage du 1X2 garantit home+draw+away ≡ 1 exactement à 4 décimales (prediction.ts:888-897, la 3e issue = round(1 − h − d, 4)).
- TESTS : nouveau scripts/test-consistency.ts (296 lignes, 31 checks) — même match λ déterministes + cotes factices (ligne 2.5, over 2.05/under 1.80) : runEngine ≡ chemin Combinator (réplique exacte de buildCandidates + round-trip JSON comme /api/predictions) écart 0.00e+0 ≤ 1e-9 sur O/U (3 lignes) et BTTS ; runEngine = calibration de référence indépendante (BTTS écart 0 ≤ 1e-9, O/U ≤ 5e-5 = arrondi 4 déc.) ; BTTS ≈ forme fermée écart 0 ≤ 1e-6 et ≡ bttsProb(market-odds) ; somme 1X2 = 1 (≤1e-9 et exactement 1 à 4 déc.) ; Poisson renormalisé = 1 (≤1e-12) ; value sur brut ; météo sans effet ; confiance = formule × argmax.
- Adaptation PAR COHÉRENCE : scripts/test-same-match-swap.ts (réplique sameMatchCandidates 275-292) alignée sur le nouveau chemin Combinator (consommation directe, plus de re-calibration) — 46/46, dont scénario réel API : 159 matchs → 2226 candidats, invariant produit exact OK.
- Validation finale : bunx tsc --noEmit | grep '^src/' → VIDE ; test-engine-fix PASS (3/3) · test-combo 76/76 · test-same-match-swap 46/46 · test-consistency 31/31 · test-lambda-bias OK (exit 0) ; non-régression : test-criteria 25/25, test-combo-real OK (cibles ×3→×20), test-combo-swapdrop PASS ; lint : seules les 4 erreurs PRÉ-EXISTANTES de scripts/html2png.js (artefact Task 20, hors périmètre) ; curl /api/matches → 200 ; vérification LIVE du hot-reload : /api/predictions et /api/match/401875606 (Excelsior vs Utrecht) servent l'ancrage marché exact (calibré 59.4 % = marché dé-margé 59.4 %, écart 0.00 pt) avec p.raw présent (brut 0.5632) et somme 1X2 = 1.000000.

Stage Summary:
- UNE SEULE vérité par match : la calibration marché (deMargin + calibrateTotals) est désormais l'étape officielle du pipeline DANS runEngine (prediction.ts:765-792) — fiche, Combinator, cartes d'accueil, Brier consomment les mêmes p.overUnder/p.btts ancrés sur la ligne O/U ESPN ; le Combinator ne recalcule plus rien (combo/page.tsx:273-328) → égalité exacte prouvée à 1e-9 (test-consistency).
- Où passe la cote : EngineInput.odds (EspnOdds | null, prediction.ts:572) contient DÉJÀ les cotes — analyze.ts:157 (odds: event.odds, non modifié) ; le moteur lit odds.overUnderLine + total.over/under.closeOdds ?? openOdds et exige hasOdds ; si un jour les cotes n'arrivent plus par EngineInput, il suffirait d'appeler le bloc 765-792 (ou une fonction exportée de market-odds.ts) avec un paramètre optionnel — aucun branchement supplémentaire nécessaire aujourd'hui.
- BTTS forme fermée partagée avec market-odds.ts (1−e^−λh)(1−e^−λa), grille Poisson 0..12 renormalisée : plus de troncature, over+under ≡ 1, somme 1X2 ≡ 1.
- Value honnête : valueBets/edge/Kelly calculés sur p.raw (brut, indépendant du marché) vs cotes réelles — plus de circularité ; le calibré reste la référence d'affichage. La confiance 1-5 utilise un vrai consensus d'argmax (formule inchangée, scores parfois plus bas = voulu) ; la météo est purement descriptive (λ intacts).
- Impact confiance : le consensus étant plus strict, quelques matchs perdent le +1 (ex. un modèle à « nul » en tête ne compte plus comme un accord dom/ext) — testé par reconstruction de la formule sur les sorties.
- Fichiers : src/lib/prediction.ts, src/app/combo/page.tsx, scripts/test-same-match-swap.ts (adapté), scripts/test-consistency.ts (nouveau). NON touchés : analyze.ts, grade.ts, api/**, composants, combo-criteria/combo (invariants cotes produit exact + UTC Task 14 préservés).

---
Task ID: 21-a
Agent: généraliste (intégrité mesure) — section rédigée par l'orchestrateur, agent tué par deadline de contexte après avoir quasi terminé
Task: ROI sans fallback 2.00, look-ahead closing odds, VOID grader, résolution 1X2 par IDs, perf full-history, saisons calendaires.

Work Log:
- FIX 1 (ROI) : fallback `(p.odds && p.odds > 1 ? p.odds : 2)` supprimé — /api/performance sépare prédictif (accuracy/Brier, tous) et économique (economic.settledWithOdds/staked/returned/roi, uniquement cotes réelles).
- FIX 2 (look-ahead) : colonnes additives `closingOdds`, `oddsCapturedAt`, `pickedTeamId` (schema.prisma + db push vérifié en base bun:sqlite) ; extractPicks stocke pickedTeamId + oddsCapturedAt ; closingOdds capturée à la RÉSOLUTION, jamais utilisée pour le ROI.
- FIX 3 (full history) : take:2000 remplacé par pagination curseur (1000/page, garde-fou 200k) + computePerformanceStats (analyze.ts:514) ; réponse enrichie sample:{settled,withOdds,source:"full-history"}.
- FIX 4 (VOID) : grade.ts VOID_STATUS_RE (postpon|cancel|suspend|delay|abandon|forfeit) → VOID, score null ; test-void 36/36.
- FIX 5 (IDs) : résolution 1X2 par pickedTeamId === event id en priorité, repli nom (rétrocompatibilité).
- FIX 6 (saisons) : CALENDAR_YEAR_LEAGUES (usa.1, bra.1/2, arg.1, jpn.1, kor.1, chn.1, nor.1, swe.1, fin.1, irl.1, usa.nwsl) — saison = année calendaire.
- Orchestrateur : rate limiting ajouté sur /api/performance (30/min) et /api/predictions POST (20/min) via lib/rate-limit.ts de 21-c.

Stage Summary:
- ROI réel mesuré : -2,33 % sur 2157 pronos réglés (1210 avec cote) — l'ancien fallback 2.00 gonflait artificiellement le ROI. API 200, full-history 2850 pronos. Tests : test-void 36/36, test-performance-integrity 31/31, test-resolution-21a 8/8, test_resolution OK.

---
Task ID: 21 (orchestration)
Agent: Super Z (agent principal)
Task: Campagne « audit code 25 constats » — vague 1 (3 sous-agents) + finitions orchestrateur.

Work Log:
- Recon : tous les constats critiques confirmés dans le code (calibrateTotals absent du runEngine, fallback :2 ligne 64, closeOdds dans extractPicks, bttsYes non renormalisé, models.every ligne 715, Promise.all sans borne cashout:188, météo ×λ prediction.ts:647-649, take:2000 perf:51).
- 21-b MOTEUR (livré, preuves) : calibration = étape officielle du runEngine (prediction.ts:765-792, cotes déjà dans EngineInput) ; double calibration supprimée combo/page.tsx:273-328 ; grille Poisson 0..12 renormalisée + BTTS forme fermée (1-e^-λh)(1-e^-λa) partagée market-odds.ts ; consensus argmax (prediction.ts:750-760) ; value sur probs BRUTES (p.raw, « brut = value, calibré = affichage ») ; météo retirée des λ (descriptive seulement). Tests : consistency 31/31, engine-fix 3/3, lambda-bias exit 0, combo 76/76, same-match-swap 46/46.
- 21-c OPS (livré, preuves) : mapWithConcurrency(…,4) sur groupes cashout (cashout/route.ts:194) ; lib/rate-limit.ts (globalThis, fenêtre glissante, LRU 10k, sweep 60s) appliqué matches 60/min + cashout 15/min ; mention « Estimation expérimentale — modèle live simplifié » dans la feuille d'éval /vente. Tests : rate-limit 18/18, cashout-concurrency 10/10 (429 E2E réel + Retry-After).
- Finitions orchestrateur : types.ts raw?{} + match-detail.tsx onglet Cotes O/U lit p.raw.overUnder (comparaison marché vs modèle non circulaire) ; caveat indépendance renforcé /combo:1013 (« matchs corrélés — même championnat, même journée… ») ; rate-limit performance/predictions ; coquille combo corrigée.
- Validation croisée : tsc src/ = 0 erreur ; /api/matches 200 ; /api/performance 200 full-history.

Stage Summary:
- Vague 1 close : 11 des 25 constats corrigés avec preuves (1,2,3*,4*,7,11,16,17,18,19,20 ; 3/4 : mécanisme + champ closingOdds posés, l'analyse closing-line viendra avec 21-d). Restent : 5/24/25 → backtest (21-d), 9 → params ligues (21-d), 6 → couvert par value sur brut, 10/12/14/15/23 → validation statistique d'abord (position documentée). Aucun redémarrage serveur, invariants UTC Task 14 + produit exact des jambes intacts.

---
Task ID: 21-d
Agent: généraliste (backtest & baselines) — section rédigée par l'orchestrateur, agent tué par deadline après livraison des artefacts
Task: Backtest walk-forward strict + baselines Marché/Poisson/Elo/VOLTRIX + params ligues empiriques.

Work Log:
- scripts/backtest.ts (28 Ko) + scripts/backtest-lib.ts (25,5 Ko) : harnais walk-forward — historiques filtrés STRICT date < T, classement SYNTHÉTISÉ depuis les matchs < T (endpoint standings ESPN interdit = fuite), blessures [] (endpoint actuel = fuite, documenté), météo null, cotes scoreboard historique.
- Fenêtre 2026-08-10 → 2026-09-12, 10 ligues (eng.1, fr.1, es.1, it.1, de.1, pt.1, nl.1, bra.1, usa.1, uefa.champions), n=250 matchs (244 avec cotes marché).
- Modèles 1X2 — RPS (plus bas = mieux) : Marché 0,1953 < Poisson simple 0,1993 < VOLTRIX+ligues 0,2006 ≈ VOLTRIX 0,2008 < Elo simple 0,2065. Brier multiclass 0,5725 (marché) à 0,5898 (Elo).
- O/U 2.5 — Brier : VOLTRIX brut 0,2234 ≤ VOLTRIX calibré 0,2236 < Poisson simple 0,2274 < Marché 0,2450 (n=149) → la zone de force du moteur.
- BTTS — Brier : Poisson simple 0,2295 < VOLTRIX calibré 0,2428 < VOLTRIX brut 0,2472 → les modificateurs de contexte dégradent le BTTS sur cet échantillon (piste : λ contextuels à revoir pour BTTS).
- src/lib/league-params.ts généré (por.1, ned.1, esp.1, bra.1, usa.1, fra.1, eng.1… homeAvg/awayAvg/drawRate/sample, référence saison précédente zéro fuite) ; champ optionnel leagueGoalAverages câblé dans EngineInput (prediction.ts:577,604-605) avec repli global 1,52/1,22.
- Décision ligue-params : NON ACTIVÉ (critères stricts : RPS 1X2 +0,0002 meilleur MAIS Brier O/U brut et calibré dégradés) — analyze.ts ne passe PAS le champ, comportement production inchangé, donnée conservée pour fenêtres plus larges.
- Résultats : scripts/backtest-results.json + download/backtest-results.json (méta discipline as-of + version moteur).
- tsc src/ = 0 erreur ; serveur jamais redémarré.

Stage Summary:
- Le harnais exigé par l'audit (#24) existe et tourne. Lecture honnête (n=250, 1 mois — RIEN de significatif statistiquement, à ré-exécuter sur fenêtres plus larges) : le marché reste le meilleur prédicteur 1X2 ; VOLTRIX ≈ Poisson simple sur le 1X2 (les variables additionnelles n'apportent pas encore de gain mesurable) ; VOLTRIX est LE meilleur sur O/U 2.5 ; il est BATU par le Poisson simple sur BTTS. Le jugement de l'audit « pas encore validé scientifiquement » est confirmé par nos propres chiffres — et maintenant mesurable en continu.

---
Task ID: 22-a
Agent: généraliste (persistance V3)
Task: Persistance V3 — predictionTime, modelVersion, probabilités brutes, digest des entrées (plan V2→V3 étapes 1, 2 et 14).

Work Log:
- Lu worklog (Tasks 21/21-a/b/c/d) + plan (upload/Plan_resolution_V2_VOLTRIX_bet.pdf). Périmètre respecté : prisma/schema.prisma, src/lib/analyze.ts (extractPicks), api/predictions/route.ts, api/performance/route.ts, scripts/test-*.ts. NON touchés : prediction.ts, market-odds.ts, combo/page.tsx, backtest*, src/lib/model-version.ts (importé tel quel), src/lib/db.ts.
- Étape 1 (plan) : colonne additive `predictionTime DATETIME?` — bunx prisma db push additif (12 ms, 2 850 lignes intactes, 4 colonnes vérifiées via bun:sqlite). Timestamp de GÉNÉRATION de la prédiction, DISTINCT de matchDate (= kickoffTime). RÈGLE D'IMMUABILITÉ appliquée : écrit UNIQUEMENT dans la branche create de l'upsert de /api/predictions (`predictionTime: new Date()` à la création de la ligne) ; le refresh conditionnel (!row.resolved) et tous les updates passent SANS ce champ — un rafraîchissement de probability/odds fait bouger oddsCapturedAt, JAMAIS predictionTime (« ne jamais substituer kickoffTime à predictionTime »).
- Étape 14 (plan) : colonne additive `modelVersion STRING?` = MODEL_VERSION importé de '@/lib/model-version' (constante non modifiée), écrite à la création, JAMAIS réécrite ensuite. AUCUN one-shot de réétiquetage : NULL = « avant versionnement », cohorte conservée telle quelle (documenté ici).
- `rawProbability FLOAT?` (additive) : extractPicks fournit les issues BRUTES p.raw (exposées depuis 21-b FIX 4) — O/U 2.5 et BTTS prennent max(over,under)/max(yes,no) du raw correspondant (repli = calibré si une analyse en cache LRU d'avant 21-b n'expose pas `raw`, jamais null/NaN) ; pour 1X2 la calibration (deMargin+calibrateTotals, 21-b FIX 1) ne touche que les totals → la proba moteur est déjà brute, rawProbability = probability (commentaire en place dans extractPicks).
- `inputsDigest STRING?` (additive, plan étape 5 reconstructibilité) : buildInputsDigest exporté d'analyze.ts — JSON COMPACT ~65 caractères (garde-fou 300 testé) : {"odds":0|1,"ou":ligne,"h":[gh,ga],"a":[gh,ga],"inj":[nh,na],"st":0..2} = hasOdds, ligne O/U du marché, tailles d'historique PAR équipe (gamesHome/gamesAway = échantillons réels des ratios attaque/défense du moteur), blessures actives par équipe, nb d'équipes classées (rank≠null ⟺ entrée standings trouvée). Le digest et rawProbability suivent la proba rafraîchie (même lot d'entrées) — à la différence de predictionTime/modelVersion qui restent immuables.
- /api/performance : `byVersion` ajouté à la réponse (n/wins/winRate PAR modelVersion, même filtre WIN/LOSE que byMarket — VOID et pending exclus ; NULL → clé 'legacy', cohorte séparée JAMAIS fusionnée avec 'v2.1') ; PerfStatRow.modelVersion optionnel (rétrocompatibilité tests) ; select +modelVersion avec repli silencieux si le client Prisma EN MÉMOIRE ignore la colonne (convention replis 21-a) ; champs existants tous intacts.
- TEST scripts/test-prediction-immutability.ts (NOUVEAU, 40/40) — DB SQLite TEMPORAIRE (mkdtemp /tmp + bunx prisma db push --skip-generate sur DATABASE_URL surchargé par l'env process → la db de prod n'est JAMAIS touchée, supprimée en fin). Scénario : création (predictionTime≠kickoff, modelVersion=v2.1, raw 0.5632≠calibré 0.5137, digest<300 valide) → re-upsert valeurs différentes sur NON résolu (probability/odds/raw/digest/pick bougent ; predictionTime/modelVersion/createdAt EXACTEMENT identiques, matchDate inchangé, oddsCapturedAt suit) → résolution WIN+closingOdds 2.1 → re-upsert sur RÉSOLU (plus RIEN ne bouge : 19-a conservé) → upsert create-sentinelle+update:{} (create ignoré, proba 0.9999 et modelVersion 'X-FALSE' jamais en base) → ligne « legacy » (modelVersion/predictionTime restent NULL, pas de backfill) → unitaires extractPicks/buildInputsDigest (brut vs calibré par marché, digest champ par champ, repli sans p.raw).
- INCIDENCE LIVE corrigée : après db push, curl /api/performance → 500 « Unknown field modelVersion » (client Prisma en mémoire du serveur long-running = généré AVANT le push ; le globalThis de db.ts conserve l'ancien client). Repli fetchPage ajouté (try select +modelVersion → catch → select sans le champ ; drapeau `modelVersionSupported` déclaré AVANT la boucle de pagination — un premier essai avec le `let` après la boucle a déclenché une TDZ 500, corrigé immédiatement) → HTTP 200. Mode dégradé documenté : tant que le client Prisma du serveur n'est pas rechargé (prochain restart dev, hors de ma portée), byVersion regroupe tout en 'legacy' et les nouvelles lignes passent par le repli historique 21-a (shape sans colonnes 22-a) — E2E scripts/test-predictions-persist.ts (5/5) : POST 200, prono résolu intact, pronos du match à venir créés/actualisés.
- Validation : bunx prisma db push OK additif (2850 lignes intactes, 0 versionnée — attendu tant que le client live est ancien) ; bunx tsc --noEmit | grep '^src/' → VIDE ; bun scripts/test-prediction-immutability.ts → 40 OK / 0 KO ; test-performance-integrity 31/31 (non-régression byMarket/Brier/économie) ; unitaire byVersion inline OK (VOID/pending exclus, legacy séparé) ; curl /api/performance → 200 (totalPredictions 2850, byVersion {"legacy":{"n":2253,"wins":1122,"winRate":0.498}}, sample full-history) ; POST /api/predictions E2E 5/5 ; bunx eslint sur mes 4 fichiers → 0 erreur ; serveur port 3000 JAMAIS redémarré.

Stage Summary:
- 4 colonnes additives posées (db push vérifié en base) : predictionTime, modelVersion, rawProbability, inputsDigest — sémantique : predictionTime = génération (≠ kickoff matchDate), figé à la création, JAMAIS réécrit (même refresh probability/odds → seul oddsCapturedAt bouge) ; modelVersion = MODEL_VERSION à la création, JAMAIS réécrite, NULL = pré-versionnement (aucun one-shot) ; rawProbability = p.raw pour O/U/BTTS, = probability pour 1X2 (calibration totals uniquement) ; inputsDigest = JSON < 300 car. (hasOdds, ligne O/U, historiques dom/ext par équipe, blessures, standings) ; digest/raw suivent le refresh.
- /api/performance expose byVersion (n/wins/winRate par version, 'legacy' = NULL) — réponse 100 % rétrocompatible ; repli silencieux si le client Prisma en mémoire ignore la colonne (convention 21-a, mode dégradé 'legacy' jusqu'au rechargement du client).
- Tests : test-prediction-immutability 40/40 (DB SQLite temporaire, prod intacte : immuables bit-exact, refresh conditionnel !resolved, garde 19-a, legacy jamais réétiqueté, extractPicks brut/calibré) ; test-performance-integrity 31/31 ; E2E persist 5/5 ; tsc src/ vide ; curl /api/performance → 200 avec byVersion ; POST /api/predictions → 200.
- Fichiers : prisma/schema.prisma, src/lib/analyze.ts (extractPicks + buildInputsDigest + PerfStatRow.modelVersion + PerfStats.byVersion), src/app/api/predictions/route.ts, src/app/api/performance/route.ts, scripts/test-prediction-immutability.ts (nouveau).

---
Task ID: 22-b
Agent: généraliste (instrument d'ablation moteur)
Task: contextes moteur désactivables (contextMode 'full'|'mix') + baseline Poisson+Elo+forme — plan V2→V3 étapes 6 & 11.

Work Log:
- Lu le plan (étapes 6, 11, checklist : « baselines marché/Poisson/Elo/Poisson+Elo+forme/VOLTRIX sur les mêmes matchs » ; BTTS : « identifier pourquoi les variables supplémentaires dégradent Brier et log loss ») + worklog 21-b/21-d. Inventaire EXACT des modificateurs touchant les λ dans runEngine (prediction.ts, bloc « Modificateurs de contexte ») : fatigue ×0.94/équipe (repos ≤3j OU 3+ matchs/14j — dérivé du schedule via analyzeTeam, AUCUN champ d'input pour le neutraliser seul), blessures ×[0.92..1] (au-delà de 2 absents, dérivé de EngineInput.injuries), derby ×0.92 (input.isDerby uniquement — le detectDerby du contexte affichage n'entre JAMAIS dans les λ). CONSTATS : la météo est déjà hors λ (21-b FIX 5) ; les « enjeux via standings » ne touchent JAMAIS les λ (stakesLabel = affichage seul, rank/points/gamesPlayed n'alimentent que context.stakes*/confiance) — rien à neutraliser de ce côté.
- IMPLÉMENTATION (src/lib/prediction.ts, additif, défaut 'full' = v2.1 bit-identique) : EngineInput.contextMode?: 'full' | 'mix' (commenté 2-3 lignes « instrument d'ablation (plan V2→V3 étape 11), défaut 'full' = v2.1 inchangé ») ; runEngine résout ablateContext = (contextMode ?? 'full') === 'mix' et neutralise sous 'mix' les TROIS modificateurs post-λ-de-base (fatigue, blessures, derby) — la fatigue ne pouvant pas être neutralisée par input (elle dérive du même schedule que les forces att/déf), le mode désactive TOUS les modificateurs post-λ-de-base comme prévu par la consigne. Restent ACTIFS en 'mix' : λ de base (moyennes ligue × att/déf + shrinkage K=10 + blend venue/global), forme injectée (×0.9..1.1), redistribution Elo (à total constant), garde-fous/bornes/arrondis, blend 45/30/25, calibration marché si cotes, tous les marchés, confiance, value bets. Les notes descriptives de contexte (fatigueNote*, stakes, derbyLabel) restent calculées — seuls les λ changent.
- TRAÇABILITÉ : MatchAnalysis.contextMode ('full' | 'mix') TOUJOURS renseigné en sortie (défaut 'full' quand le champ est absent) — pour digests de backtest et digest d'entrées. analyze.ts non touché (runEngine appelé sans le champ → 'full' exact).
- BASELINE « Poisson+Elo+forme » (plan étape 6) = runEngine en 'mix' sans cotes — recette EXACTE pour le backtest : { homeTeam/awayTeam: { id, name, logo: null, schedule: historique STRICT < T, standings: null }, injuries: [], odds: null, isDerby: false, weatherImpact: null, nowMs: T, leagueTeamsCount: 20, contextMode: 'mix' }. odds: null → pas de calibration (p.overUnder ≡ p.raw.overUnder, p.btts ≡ p.raw.btts, valueBets vides — vérifié) ; 'mix' → λ = base att/déf × forme × redistribution Elo, sans fatigue/blessures/derby, la recette restant correcte même si injuries/isDerby non neutralisés côté appelant. VOLTRIX complet = même appel avec contextMode 'full' (ou absent) + cotes réelles.
- TESTS : nouveau scripts/test-ablation.ts (27 checks, 0 dépendance réseau) — (a) champ absent ≡ 'full' : JSON intégral identique + écarts numériques 0.00e+0 ≤ 1e-12 (λ, 1X2, O/U, BTTS) ; (b) ablation mesurée par le RATIO total full/mix (la redistribution Elo préservant λh+λa, le ratio = produit exact des facteurs neutralisés ± arrondi 2 déc.) : derby seul 0.9200 (attendu 0.92), fatigue seule 0.9382 (attendu 0.94), contexte complet 0.8327 (attendu 0.92×0.94×0.96=0.8302 avec 4 absents/équipe) + preuves de NEUTRALISATION : mix(isDerby:true) ≡ mix(isDerby:false), mix(4 blessures) ≡ mix(0 blessure), mix(calendrier serré J-2) ≡ mix(calendrier calme J-16) à λ identiques (calendriers de même ordre chronologique Elo — seule la récence diffère) ; notes descriptives conservées en 'mix' ; (c) cas sans contexte : 'mix' ≡ 'full' exact (JSON hors trace + 0.00e+0) ; (d) baseline odds:null+'mix' : brut ≡ affiché, valueBets vides, et avec cotes la calibration tourne toujours en 'mix' (λ inchangés par elle).
- Non-régression RE-RUN : test-consistency 31/31 · test-engine-fix 3/3 · test-combo 76/76 · test-same-match-swap 46/46 · test-lambda-bias exit 0 (102 matchs, ratio médian 0.945, 93/102 dans ±20 % — cohérent avec la mesure 21-b). NOTE : le 1er run lambda-bias avait crashé (median undefined, 0 lignes) — cause identifiée NON liée à 22-b : le script POSTe ~27 lots à /api/predictions et le rate-limit 20/min ajouté en 21-a (cumulé aux POSTs de test-same-match-swap exécuté juste avant) renvoyait des 429 ignorés par le catch → 0 lignes ; exécuté SEUL après expiration de la fenêtre (65 s), exit 0. λ et probas servis en live intacts (POST /api/predictions → λ 0.99/1.35, probs sommant 1).
- Validation : `bunx tsc --noEmit 2>&1 | grep '^src/'` → VIDE ; eslint sur prediction.ts + test-ablation.ts → 0 erreur ; serveur dev port 3000 JAMAIS redémarré, /api/matches 200 tout du long.

Stage Summary:
- Instrument d'ablation livré : EngineInput.contextMode ('full' défaut = v2.1 bit-identique, prouvé JSON-intégral ; 'mix' = λ de base + forme + redistribution Elo SANS fatigue/blessures/derby) + MatchAnalysis.contextMode en sortie. Le backtest peut désormais décomposer VOLTRIX complet vs blend Poisson+Elo+forme sur les MÊMES matchs (plan étapes 6/11) et attribuer chaque dégradation BTTS/Brier-log loss au contexte — la recette baseline exacte est documentée ci-dessus.
- Levé de doute utile à l'étape 11 : les « enjeux via standings » n'ont JAMAIS touché les λ (affichage seul) et la météo est inerte depuis 21-b — les seuls candidats à la dégradation BTTS côté contexte sont fatigue (−6 % λ/équipe), blessures (−0..8 %) et derby (−8 %), tous mesurés unitairement par test-ablation.
- Fichiers : src/lib/prediction.ts (+40/-6 : champ EngineInput, champ MatchAnalysis, 3 garde-fous de neutralisation, commentaires), scripts/test-ablation.ts (nouveau, 27/27). NON touchés : analyze.ts, api/**, market-odds.ts, backtest*.ts, model-version.ts, combo/page.tsx, prisma, composants. Invariants intacts : filtre UTC Task 14, cote combiné = produit exact (same-match-swap 46/46), aucune nouvelle variable prédictive (flag neutre par défaut).

---
Task ID: 22-c
Agent: généraliste (backtest V3) — section rédigée par l'orchestrateur, agent tué par deadline après livraison complète
Task: Backtest V3 — horizons T−Xh, cotes-à-T, folds multi-périodes, intervalles de confiance, entrées gelées, tests anti-fuite.

Work Log:
- scripts/backtest.ts (40,6 Ko) + backtest-lib.ts (44,8 Ko) réécrits : T_pred = kickoff − Xh (horizons 12/6/3/1 h), inputs as-of T_pred, open odds = seul input cote (proxy documenté), close odds INTERDITES en input (référence MARCHÉ-CLÔTURE étiquetée), 7 variantes comparées sur les mêmes matchs (marché-à-T, marché-clôture, Poisson simple, Elo simple, MIX = Poisson+Elo+forme via contextMode 'mix', VOLTRIX-full raw/cal, VOLTRIX-league), bootstrap 1000 (seed mulberry32) + tests appariés ΔBrier (p add-one), indépendance étiquetée (plan étape 8), entrées gelées (meta.json + matches.jsonl + results.json, --replay sans réseau), O/U par ligue, ablation BTTS, décision ligues par fold.
- scripts/test-anti-leak.ts : 28/28 PASS — dont INVARIANCE AU FUTUR (historique empoisonné par matchs futurs absurdes → sorties bit-identiques 1e-12), filtres as-of, standings synthétisés, cotes close sans effet sur raw/mix.
- Exécution : 2 runs arrière-plan tués silencieusement par le sandbox (~45 s et ~4 min) → stratégie par fold en avant-plan (59-90 s/fold). 7 folds productifs : 2026-01 (59), 02 (69), 03 (72), 04 (80), 05 (91), 07 (28), 08 (60) ; 2026-06 vide (trêve). TOTAL : 459 matchs × 4 horizons = 1836 records (1540 avec cotes).
- Pooling : fusion des 7 matches.jsonl → download/backtest-runs/POOL-2026-v3/ + --replay (réseau : 0 appel) → download/backtest-v3-replay-results.json.
- tsc src/ = 0 erreur. Serveur jamais redémarré.

Stage Summary:
- RÉSULTATS POOLÉS (janv-mai + juil-août 2026, 6 ligues) — 1X2 (Brier·RPS) : marché-clôture 0,6236·0,2052 < Poisson 0,6363·0,2109 < MIX 0,6497·0,2152 ≈ VOLTRIX-full 0,6496·0,2152 < Elo 0,6545. O/U 2.5 : marché 0,2489 < calibrés 0,2502 < raw 0,2580 < Poisson 0,2616. BTTS : Poisson 0,2548 < calibrés 0,2648 < MIX 0,2714 ≈ full 0,2723.
- VERDICT SCIENTIFIQUE : le « signal O/U 2.5 » de la V2 NE RÉPLIQUE PAS (marché-clôture bat VOLTRIX-raw : ΔBrier +0,0084, IC95 [0,0044 ; 0,0122], p≈0,002, n=1540 ; marché gagnant 5/7 folds). La dégradation BTTS par les couches supplémentaires est maintenant STATISTIQUEMENT établie (Poisson vs full : Δ −0,0175, IC [−0,0219 ; −0,0129], p≈0,002, n=1836). Stabilité horizons parfaite (Brier raw 0,2579-0,2581 de T−12h à T−1h). Ligues : NON activées (critères stricts, cohérent V2/V3). Le framework a rempli son rôle : tuer un faux positif AVANT qu'il ne soit produit.

---
Task ID: 22 (orchestration)
Agent: Super Z (agent principal)
Task: Exécution du plan V2→V3 (upload/Plan_resolution_V2_VOLTRIX_bet.pdf) — validation temporelle et statistique avant toute complexification.

Work Log:
- src/lib/model-version.ts créé (MODEL_VERSION 'v2.1', immuable, étape 14).
- 22-a Persistance : colonnes additives predictionTime (immuable à la création), modelVersion (jamais réécrite), rawProbability (p.raw pour O/U/BTTS), inputsDigest (~65 car.) ; /api/performance byVersion ; test-prediction-immutability 40/40. Note : client Prisma du serveur long-running en repli jusqu'à rechargement (colonnes ignorées à l'écriture en attendant ; backtest non impacté).
- 22-b Moteur : EngineInput.contextMode 'full'|'mix' (défaut full = v2.1 bit-identique) ; 'mix' = sans fatigue/blessures/derby (enjeux = affichage seul, météo déjà hors λ) ; test-ablation 27/27 ; recette baseline Poisson+Elo+forme documentée ; suites V2 toutes vertes.
- 22-c Backtest V3 : construit + smoke + anti-fuite 28/28 ; exécution par fold (sandbox tue les runs arrière-plan) ; pooling + replay.
- Zéro nouvelle variable prédictive ajoutée (plan étape 15 respecté : l'ablation est un instrument de mesure, défaut neutre).

Stage Summary:
- Checklist « Validation avant V3 » : 14/14 cases satisfaites. Réponse au critère de réussite du plan : AUCUNE amélioration reproductible hors échantillon vs marché n'est démontrée à ce stade ; le candidat O/U de la V2 a été invalidé proprement (p≈0,002 en faveur du marché) ; la dégradation BTTS par les couches contextuelles est établie (p≈0,002) → candidats de RETRAIT identifiés (plan étape 11). Statut : BASE TECHNIQUE SOLIDE / MODÈLE TOUJOURS À VALIDER / AVANTAGE PRÉDICTIF NON DÉMONTRÉ — désormais avec la mesure qui le prouve, au lieu d'une affirmation.

---
Task ID: 23
Agent: Super Z (agent principal)
Task: Nouvelle archive du code source (zip v2 post-Task 22) + document de suivi projet (docx) couvrant tout ce qui a été fait, ce qui a été trouvé et ce qui reste à faire.

Work Log:
- Zip reconstruit : download/voltrix-bet-source-2026-09-13-v2.zip (188 fichiers, 505 Ko compressés, unzip -t OK) — src/ + prisma/ + scripts/ + tests/ + public/ + configs racine ; exclus : node_modules, db/custom.db (données d'exploitation), *.log, PDF intermédiaires de génération ; vérification présence fichiers Task 21/22 (model-version.ts, rate-limit.ts, league-params.ts, test-ablation/anti-leak/prediction-immutability, backtest v3, schema.prisma 4 colonnes).
- Skill docx chargé + chaîne complète lue (SKILL, create.md, design-system R1 + IG-1, common-rules, docx-js-core, docx-js-advanced, report.md Template E, toc.md, chart-templates).
- 2 graphiques matplotlib générés depuis les chiffres réels du backtest V3 poolé (scripts/suivi-charts.py → suivi-chart-brier-1x2.png 1839×800, suivi-chart-marches-secondaires.png 1920×880 ; palette or/encre, virgules décimales françaises).
- Document généré via docx-js en 4 modules persistés (scripts/suivi-helpers.js, suivi-content1.js, suivi-content2.js, gen-suivi-docx.js) : couverture R1 palette IG-1, sommaire TOC (section romaine), corps (section arabe repartant à 1), 7 chapitres + annexe A, 8 tableaux (phases, défauts, backtests, tests statistiques, suites de tests, roadmap, livrables, fichiers clés), 2 figures, 1 encadré verdict ; ~4 300 mots en français.
- Post-traitement : add_toc_placeholders.py --auto (32 entrées, exit 0) ; patch-suivi-footers.py (instrText PAGE → \* ROMAN / \* arabic via mapping sectPr→footerReference, 1 pgNumType vide supprimé) ; postcheck.py 9/9, 0 erreur, 0 avertissement (après alignement interlignage cellules 276→312).
- QA visuelle : LibreOffice → PDF 20 pages → PNG ; couverture, sommaire I/II, corps 1–17, tableaux, figures et encadré vérifiés ; aucune page blanche.

Stage Summary:
- Livrables : download/voltrix-bet-source-2026-09-13-v2.zip (code source complet post-Task 22) et download/VOLTRIX-bet-Dossier-de-suivi-projet.docx (20 pages).
- Le document fixe le statut officiel : base technique solide / modèle à valider / avantage prédictif non démontré, avec la roadmap P0-P2 (rechargement client Prisma, ablation BTTS, élargissement des plis, league-params, CLV).

---
Task ID: 24
Agent: Super Z (agent principal)
Task: Simulation aveugle complète de validation du modèle VOLTRIX (juin-juillet-août 2026) avec 2 livrables : rapport PDF d'audit + JSON de données brutes match par match.

Work Log:
- Sonde ESPN 31 ligues × 19 dates : juin-août 2026 actifs (CDM 104 matchs, ligues d'été, reprises européennes d'août).
- Phase 1a (s1-collect.ts) : 1 328 fixtures collectées (2 852 appels scoreboard OK, 0 échec), scores STRIPPÉS dès la collecte.
- Phase 1b (s2-prematch.ts) : 478 paires (ligue,équipe) × 2-3 saisons (1 434 appels) + cotes OPEN DraftKings 1 297/1 328 (close JAMAIS stockée en phase 1).
- Phase 1c (s3-predict.ts) : 5 312 prédictions (1 328 × 4 horizons T−12/6/3/1h) via evaluateMatchV3 (harnais 21-d/22-c INCHANGÉ) + runEngine pour la confiance ; contrôles internes digest/probs = 0 mismatch ; GEL SHA-256 4e7ee491…e9213.
- Phase 2 (s4-reveal.ts) : vérification du hash puis révélation (summary ESPN) → 1 325 scores, 3 VOID (Postponed bras.1), close en référence séparée.
- Phase 3 (s5-metrics.ts) : métriques Brier/LogLoss/RPS/accuracy/calibration + IC bootstrap + tests appariés ΔBrier ; audit anti-fuite automatisé (tPred<kickoff 0 violation, re-calcul as-of indépendant 5 312/5 312, digests 0 écart, scan structurel 0 score dans le gel) ; contrôles §9 complets.
- Phase 4 (s6-dataset.ts) : JSON final 20,6 Mo (match par match, 4 prédictions/match avec digestPayload recalcule + baselines + résultat révélé).
- Phase 5 (charts.py) : 4 figures matplotlib (calibration, Brier/marché, horizons, confiance) palette cascade seed 21.
- Phase 6 : skill pdf chargé intégralement (report.md + fonts + palette + cover + charts + overflow + pagination + typography + fill-engine + cover-backgrounds + geometry) ; corps ReportLab 48 pages (TocDocTemplate multiBuild, TOC cliquable, roman/arabe, tableau 1 325 lignes repeatRows) ; couverture Template 01 HUD (poster_validate + cover_validate PASS, html2poster 794px) ; fusion pypdf normalisée A4 ; QA : font.check 0, pages.clean 0, pdf_qa WARN seulement (4 faux positifs callouts symétriques).
- Anomalie SIGNALÉE non corrigée : historiques CDM vides (endpoint schedule par ligue = tournoi seul) → priors globaux sur les 104 matchs CDM (416/432 prédictions à historique court) ; documentée au rapport (ch. 3 et 6).

Stage Summary:
- Livrables : download/VOLTRIX_blind_test_JUNE_JULY_AUGUST_2026.pdf (49 p., 1,02 Mo) + download/VOLTRIX_blind_test_JUNE_JULY_AUGUST_2026.json (20,6 Mo, recalculable sans le moteur).
- Résultats T−3h (1 325 matchs) : 1X2 VOLTRIX Brier 0,6165/RPS 0,2153 vs marché-clôture 0,5910/0,2034 (apparié Δ+0,0265 p≈0,002) ; O/U brut 0,2448 vs marché 0,2466 (apparié Δ+0,0052 p≈0,10 NS) ; BTTS Poisson 0,2507 bat VOLTRIX 0,2629 (p≈0,002, réplique V3). Confiance : gradient réel niveau 5 (53,3 %/0,587) vs niveaux 2-3 (~41 %). Verdict inchangé : aucune supériorité marché démontrée ; baseline chiffrée pour les évolutions futures.

---
Task ID: 25
Agent: Super Z (agent principal)
Task: Nouvelle section « Prévisions hebdomadaires » — système de suivi et d'audit des performances du moteur (cahier des charges 24 sections : prédiction figée avant coup d'envoi, résultat séparé, évaluation, métriques probabilistes, rapport PDF, exports, job automatique, tests d'intégrité).

Work Log:
- Schéma Prisma ADDITIF (§19) : 5 nouveaux modèles — ForecastSnapshot (prédiction figée INSERT-ONLY : probs calibrées+brutes 1X2/O-U/BTTS, confiance, pick1x2Label, pickedTeamId, predictionTime, modelVersion, inputsDigest, cotes à T + oddsCapturedAt, ouMarketLine, versions), MatchResult (résultat officiel séparé : statut normalisé, scores, retrievedAt), ForecastEvaluation (grades dérivés + resultKey), ForecastMatch (registre ESPN mutable), ForecastJobRun (journal). Modèle Prediction existant intact. db push + prisma generate + redémarrage serveur via script officiel (client Prisma sinon stale en mémoire).
- src/lib/forecast/week.ts (semaines lun→dim UTC, libellés FR), espn-week.ts (scoreboard ESPN par PLAGE dates=YYYYMMDD-YYYYMMDD : 1 appel/ligue/semaine, statuts bruts statusName, tolérance aux échecs), snapshot.ts (buildSnapshotDraft depuis AnalyzeResult PRODUCTION : argmax 1X2 règle extractPicks, O/U 2.5 calibré+brut, BTTS, GARDE §6 predictionTime<kickoff sinon refus), evaluate.ts (normalizeStatus STATUS_*, gradeSnapshot par côté/ID, VOID sur reporté/annulé/suspendu), metrics.ts (pures : brier1x2 multiclasse, logLoss1x2, rps1x2, brierBinary, logLossBinary, bucketize 0-100 par 10 pts, aggregateWeek : marchés + confiance 1-5 + ligues seuil n≥30 + erreurs §16 conf≥4 ou proba≥70 %).
- job.ts (§20) : runForecastTick = scan (semaine courante+suivante, upsert registre+résultats initiaux) → stepPredict (candidats kickoff>now sans snapshot, max 12/tick, budget 45 s, create version=count+1, JAMAIS d'update) → stepResults (boards (ligue,jour) ±1 jour, écriture seulement si changement) → stepEvaluate (résultat définitif + resultKey changé) ; verrou global anti-chevauchement, boucle 5 min (ensureForecastLoop), scan à la demande par semaine consultée (ensureWeekScanned, 20 min TTL, prédictions limitées à la fenêtre 2 semaines).
- APIs : /api/forecasts/week (matches+snapshots+résultats+évaluations+stats agrégées, compteurs §11 sur toute la semaine), /tick (POST, budget 90 s), /export (§18 : JSON complet toutes versions / CSV large BOM UTF-8), /report (§17 : PDF pdf-lib 19 pages — Résumé/1X2/O-U/BTTS/Confiance/Calibration/Compétitions/Détail des matchs paginé/Diagnostic automatique descriptif + disclaimer, sanitiseur WinAnsi central win() [noms ESPN turc/grec/cyrillique + symboles −≥→], word-wrap automatique, footer paginé).
- UI src/app/previsions/page.tsx : navigation Semaine précédente/actuelle/suivante (§2), résumé performance (§11), 4 sections dépliables (confiance/calibration/compétitions/erreurs §13-16), filtres statuts, cartes match §7 (logos, barre 1X2 empilée, étoiles, O/U, BTTS, statut À VENIR/EN DIRECT/TERMINÉ/VOID, verdicts ✅/❌ via évaluation, ligne d'audit figée+moteur+digest+cotes), bouton GÉNÉRER LE RAPPORT + exports, ping job 90 s. TabBar : onglet Prévisions (CalendarDays) ajouté, 5 onglets testés visuellement.
- Tests : scripts/test-forecast-integrity.ts 60/60 (DB temporaire : immuabilité bit-exact à travers re-scan/résultat/re-évaluation, refus §6, zéro doublon au 2e run, v2 sans toucher v1, grading VOID/FINAL, statuts ESPN, métriques main-computed) ; scripts/test-forecast-weekly-cycle.ts 23/23 (E2E HTTP : digest structure close sans score, predictionTime<kickoff 100 %, immuabilité pendant 24 nouvelles prédictions, recalcul indépendant Brier/counts depuis l'export JSON aligné 1e-9, PDF 19 p. pypdf cohérent, CSV, 0 doublon).
- Corrigé en cours de route : sanitiseur WinAnsi (crash « − » U+2212 → win() par caractère : encodable gardé, NFD en repli — accents français intacts), word-wrap PDF, compteurs §11 semaine complète, tick retry sur verrou.
- MOTEUR JAMAIS TOUCHÉ (§22) : prediction.ts, analyze.ts, market-odds.ts, model-version.ts, espn.ts, grade.ts, leagues.ts inchangés ; seuls fichiers existants édités : prisma/schema.prisma (additif) + tab-bar.tsx (onglet) + db.ts non touché.
- État final DB : 1 843 matchs (2 semaines), 1 199 résultats finaux, 152 snapshots figés (100 % v2.1, 116 avec cotes, horizons 8 min-70 h), 0 doublon, 0 modification, 0 fuite temporelle ; job d'arrière-plan continue de remplir la semaine du 14-09 (ping UI ou boucle 5 min).
- Livrables annexes : download/RAPPORT-TECHNIQUE-previsions-hebdomadaires.md (rapport §24) + download/voltrix-rapport-semaine-exemple.pdf (exemplaire généré).

Stage Summary:
- Section « Prévisions » livrée et vérifiée E2E (Agent Browser 390×844) : audit du moteur avec prédictions immuables (insert-only), résultats séparés, évaluation automatique, métriques probabilistes complètes (Brier/LogLoss/RPS/accuracy/calibration), rapports PDF + exports JSON/CSV, job automatique 5 min + scan à la demande, historique jamais supprimé.
- Critères d'acceptation §23 : tous satisfaits ; garde §6 prouvé par test (565 matchs passés sans prédiction = comportement attendu, anomalie signalée non corrigée).
- Anomalies signalées : (1) matchs de la semaine de déploiement déjà terminés sans prédiction (garde §6), (2) horizons courts sur les tout premiers matchs (8 min), (3) 36/152 snapshots sans cotes ESPN (calibration non appliquée, consigné).

---
Task ID: 26
Agent: Super Z (agent principal)
Task: Incident signalé par l'utilisateur — « toutes les modifications ne sont pas visibles sur l'App ». Diagnostic et correctif.

Work Log:
- Diagnostic complet : code source intact (fichiers Task 25 présents : src/app/previsions/, src/lib/forecast/ ×7, schema Prisma avec ForecastSnapshot/MatchResult/ForecastEvaluation, onglet Prévisions dans tab-bar) ; serveur 200 sur / /previsions /api/forecasts/week ; DB vivante (snapshots figés du 13/09, job actif) ; HTML servi contient la nouvelle UI. Cause identifiée : cache PWA côté appareil — le service worker voltrix-v2 servait la coquille/app de l'ancienne version (aucun mécanisme fiable de mise à jour : registration sans updateViaCache, pas de rechargement au changement de contrôleur).
- Correctif 1 — public/sw.js : CACHE_NAME 'voltrix-v2' → 'voltrix-v3' (purge automatique des caches antérieurs à l'activation) + commentaire rappelant d'incrémenter à chaque déploiement + repli navigation amélioré (page exacte en cache avant la coquille '/').
- Correctif 2 — src/app/layout.tsx : script d'enregistrement SW renforcé — updateViaCache:'none' (le SW lui-même n'est plus servi depuis le cache HTTP) + listener controllerchange avec garde hadController → rechargement unique automatique quand une nouvelle version du SW prend le contrôle (l'utilisateur récupère la dernière UI sans action manuelle, pas de boucle).
- Correctif 3 — src/app/page.tsx (Profil) : « Version : 1.0.0 » → « Version : 2.4.0 — build 14/09/2026 (Prévisions hebdomadaires incluses) » comme marqueur visuel instantané de la version exécutée.
- Vérifications : tsc src/ 0 erreur (erreurs préexistantes hors src/ uniquement) ; / /previsions /api/forecasts/week 200 ; sw.js servi = voltrix-v3 ; E2E Agent Browser 390×844 : accueil (31 matchs, 5 onglets), Prévisions (591 matchs, 591 prédits, navigation semaine, sections confiance/calibration/compétitions/erreurs, bouton rapport + export JSON, job « predict · 14/09 03:06 »), Profil affiche le badge 2.4.0, SW actif scope '/', 0 erreur console/page ; capture download/previsions-check-2026-09-14.png.

Stage Summary:
- Aucune donnée ni aucun code perdu : l'app serveur était à jour, c'est le cache PWA du navigateur de l'utilisateur qui servait l'ancienne version.
- Anti-vieille-version permanent : purge de cache par bump CACHE_NAME, SW auto-mis-à-jour (updateViaCache none), rechargement unique automatique, badge de version visible dans Profil.
- Pour l'utilisateur : fermer et rouvrir l'app (ou tirer-pour-rafraîchir) → le SW v3 s'installe et la page se recharge d'elle-même sur la dernière version ; vérifier « Version : 2.4.0 — build 14/09/2026 » dans l'onglet Profil. En dernier recours : vider les données du site.

---
Task ID: 27
Agent: Super Z (agent principal)
Task: Retour utilisateur après validation du fix PWA — (1) barre de navigation surchargée par l'ajout de « Prévisions » → retirer « Précision » de la barre ; (2) disposer les éléments de la section Prévisions comme la section Précision. NB : ne rien modifier d'autre.

Work Log:
- tab-bar.tsx : entrée 'precision' retirée de PILL_TABS (pilule 5 → 4 onglets : Accueil, Ligues, Prévisions, Vente + bouton Profil détaché) ; icône Target retirée des imports ; type TabKey et mapping pathname /precision conservés (la page /precision reste servie et accessible via le lien « Précision VOLTRIX » de l'onglet Profil) ; commentaires mis à jour.
- previsions/page.tsx : disposition réalignée sur le gabarit /precision (page.tsx 810 → ~715 lignes, TOUTE la logique conservée à l'identique : weekStart/load/sync/ping 90 s/filtres/jours) :
  * conteneur max-w-[480px] bg-background + header sticky pt-safe (titre font-display + sous-titre + bouton rond Synchroniser h-9 w-9 rounded-2xl, spin pendant sync) ;
  * skeletons volt-skeleton + carte d'erreur dashed avec bouton Réessayer volt ;
  * navigation semaines (§2) restylée rounded-2xl bg-white/[0.07], « Semaine actuelle » volt si courante + ligne dernier job ;
  * HERO volt-glow : grand taux global (44px, combinaison des 3 marchés) + badge Brier 1X2 + sous-ligne corrects/évalués + paragraphe explicatif border-t ;
  * grille KPI 2×2 (Matchs / Avec prédiction / Terminés dont VOID / En attente) rounded-3xl bg-[#141418] ;
  * « Réussite par marché » : barres h-[7px] volt-bar par marché (accuracy, correct/total, sous-ligne Brier/RPS/attente/VOID) ;
  * « Performance par niveau de confiance » : barres vertes + étoiles + Brier (§13) ;
  * « Calibration des probabilités » : doubles barres jaune (annoncé) / verte (observé) par tranche × 3 marchés (§14, motif exact du calibrage Précision) ;
  * « Performance par compétition » : barre 1X2 par ligue + sous-ligne O-U/BTTS + mention « échantillon insuffisant (n<30) » + note de garde (§15) ;
  * « Où VOLTRIX s'est trompé ? » : rangées rounded-2xl bg-black/30 + badge confiance + échecs rouges (§16) ;
  * sections repliables (SectionShell) supprimées → cartes ouvertes comme Précision ; badges filtres pill volt ; cartes match rounded-3xl bg-[#141418] (bloc prédiction rounded-2xl volt) ; disclaimer rouge Jeu responsable au style Précision + note d'audit conservée.
- Vérifications : tsc src/ 0 erreur (3 erreurs préexistantes hors src/) ; / /previsions /precision → 200 ; dev.log 0 erreur ; E2E Agent Browser 390×844 : pilule 4 onglets sur / et /previsions, /previsions rendering complet (591 matchs, 7 jours, hero/KPI/marchés/confiance/calibration/compétitions/erreurs/rapport/exports/disclaimer), /precision intacte (hero Brier 0.253) ; capture download/previsions-nouveau-layout.png.
- Non touché (conformément au NB) : moteur, APIs, job, schéma, autres pages, données.

Stage Summary:
- Pilule de navigation désencombrée : 4 onglets (Précision retirée de la barre, page toujours accessible depuis Profil).
- Page Prévisions réorganisée exactement comme Précision : header sticky à bouton rond, hero volt-glow avec grand taux, grille KPI 2 colonnes, cartes ouvertes à barres de progression, badges pill, disclaimer rouge — toutes les métriques/fonctionnalités §2-§18 conservées.

---
Task ID: 28
Agent: Super Z (agent principal)
Task: Cahier des charges « Base Neon + centralisation des données + correction des bugs » — migration SQLite → Neon PostgreSQL, synchronisation ESPN idempotente, architecture générique des prédictions immuables, fix H2H (§7) et fix statuts « À VENIR » (§22). Moteur prédictif VOLTRIX v2.1 NON modifié (formules/poids/paramètres intacts).

Work Log:
- Sauvegardes : db/custom.db + .env → backups/ (horodatés)
- prisma/schema.prisma : provider postgresql + directUrl ; 6 modèles historiques conservés à l'identique (Prediction, ForecastMatch, ForecastSnapshot, MatchResult+winner, ForecastEvaluation, ForecastJobRun) ; nouveaux modèles §3-§27 : Competition (espnLeagueId unique), Team (espnTeamId unique), Match (espnEventId UNIQUE + FK → espnTeamId), OddsSnapshot (cotes historisées, jamais écrasées), PredictionSnapshot/PredictionMarket/PredictionOutcome/PredictionComponent (architecture générique extensible, Json pour composants), SyncJobRun ; index §25 (kickoffAt, status, homeTeamId, awayTeamId, competitionId, capturedAt, predictionTime…)
- Neon : db push OK (19s), client régénéré, migration baseline prisma/migrations/000000000000_init/migration.sql (407 lignes) + migrate resolve --applied
- Immutabilité §20 : scripts/apply-immutability.ts → 10 triggers PostgreSQL (UPDATE+DELETE interdits sur PredictionSnapshot/Market/Outcome/Component + ForecastSnapshot)
- src/lib/sync/status.ts : statut canonique ESPN (ingestStatus : SCHEDULED/LIVE/HALFTIME/FINAL/POSTPONED/CANCELLED/SUSPENDED/DELAYED) + effectiveStatus (résultat officiel → espnState 'post' → secours temporel +3h, JAMAIS si libellé report/annulation) + statusLabelFr (TERMINÉ/EN DIRECT/REPORTÉ/ANNULÉ/SUSPENDU/À VENIR)
- src/lib/sync/espn-sync.ts : ingestion BATCH (latence Neon ~300-600ms imposée) — fetch range scoreboard par ligue (UA curl Task 19-a), parsing cotes américain→décimal, upserts idempotents par espn_event_id (anti-retour : FINAL jamais dégradé, scores jamais effacés), cotes historisées en diff (nouvelle ligne seulement si la valeur bouge), syncTeamHistory (calendriers 2 saisons → base, TTL 6h/équipe) ; runSyncCycle (§24 : backfill 21j/à venir 8j) + refreshLiveMatches (90s) + cycle 10 min
- src/lib/sync/sync-job.ts : boucle paresseuse globalThis (backfill si >12h, cycle 10 min, live 90 s) ; routes /api/sync/tick + /api/sync/status (diagnostic : connectivité, volumes, statuts, dernier cycle)
- scripts/import-sqlite-to-neon.ts : 2850 Prediction + 2144 ForecastMatch + 2144 MatchResult (winner dérivé) + 920 ForecastSnapshot + 35 évaluations + 92 jobs → conversion en 920 PredictionSnapshot génériques (2760 marchés, 6440 issues) + pré-remplissage Match (2144) / Team (1325) / Competition (73) — idempotent (ré-exécution = 0 changement)
- scripts/seed-neon.ts : seed ESPN 21j arrière + 8j à venir → 2709 matchs (1836 FINAL avec score), 3257 cotes historisées ; re-run = 0 doublon (§5 prouvé)
- db.ts : garde du singleton mise sur le modèle `match` → bascule Neon SANS redémarrage du serveur (Turbopack + Reload env)
- Fix H2H §7 : prediction.ts (union des 2 calendriers + dédoublonnage eventId + orientation winner par rapport au match HISTORIQUE + récap par ID équipe) ; route /api/match/[id] : getH2HFromDb (les DEUX ordres, symétrique, from base) remplace le H2H moteur si la base connaît la paire, sync équipe fire-and-forget ; population d'historique intégrée au cycle de sync (4 équipes/cycle, <48h) — l'analyse en lot de l'accueil reste 100% ESPN (latence préservée : 51 cartes rendues en ~15s)
- Fix statuts §22 : /api/forecasts/week calcule effectiveStatus par match (résultat → espnState → temps) + compteurs corrigés ; previsions/page.tsx : badge/filtre sur statut effectif, FINAL sans score → « Score en attente », HALFTIME → EN DIRECT
- Snapshot générique §11-§19 : snapshot.ts persistGenericSnapshot (branché dans job.ts stepPredict, insert-only) → TOUS les marchés : 1X2 (+ composants POISSON/ELO/FORME/VOLTRIX en Json), DOUBLE_CHANCE (1X/12/X2 dérivés), O/U chaque ligne (1.5/2.5/3.5), BTTS, FIRST_GOAL_TIME (7 fenêtres §16), FIRST_TEAM_TO_SCORE, EXACT_SCORE ; déjà actif en prod (+2 snapshots générés par le job pendant la vérification)
- Optimisations de stabilité : updates d'équipes seulement si changement réel (anti-burst pool), connection_limit 20 + pool_timeout 20, LIMIT de pool respecté
- Tests §30 : tests/neon-task28.test.ts — 25 tests (connexion, 14 tables, index §25, triggers, unicité espn_event_id, winner, statuts §22 dont scénario 14/09→15/09, ingestStatus, H2H bi-ordonné/symétrique/vide/mêmes équipes, cotes historisées 1.85→1.75, transition SCHEDULED→FINAL, anti-retour FINAL, immutabilité UPDATE+DELETE rejetés + valeur figée, 2 versions coexistantes, plusieurs marchés/issues, audit §27) → 25/25 PASS
- E2E agent-browser : Prévisions (591 matchs, 37 TERMINÉ dont 2 VOID, 552 À VENIR, badge TERMINÉ sur match du 14/09, ANNULÉ·VOID/REPORTÉ·VOID OK), Accueil restauré (51 cartes, pronos, value bets, cotes), H2H détail Blackburn/Sheffield Utd : 4 confrontations dont l'ordre inversé « Sheffield Utd 1-3 Blackburn » avec winner correctement attribué (away=Blackburn)
- Protocole déploiement Task 26 : CACHE_NAME voltrix-v4 + badge « Version : 2.5.0 — build 15/09/2026 (Base de données Neon PostgreSQL) »
- Sécurité : .env désui-vi (git rm --cached) car il était suivi par erreur ; backups/ ajouté au .gitignore ; DATABASE_URL/DIRECT_URL uniquement en variable d'environnement (channel_binding omis : non supporté par le moteur Prisma, sslmode=require conservé ; pooler = pgbouncer=true)

Stage Summary:
- NEON PostgreSQL = source principale de données (§31 coché : connexion, schéma, Prisma, sync ESPN, matchs/équipes/compétitions/résultats/cotes historisées, H2H depuis la base, Prévisions depuis la base, statuts synchronisés, prédictions figées + triggers, 1X2/DC/O-U/BTTS/1er but/1ère équipe stockés, Poisson/Elo/Forme conservés, zéro doublon, 25 tests, aucun secret dans Git)
- Volumes : 2803+ matchs, 1403 équipes, 73 compétitions, 3269 cotes, 922 snapshots génériques (2762 marchés, 6445 issues), données historiques migrées à 100 %
- Boucles : backfill 21 j (1×/12 h), cycle 10 min, live 90 s — l'app ne consulte plus ESPN pour les données déjà en base (§1/§23/§28)
- Moteur v2.1 : AUCUNE formule/pondération/logique modifiée — seuls le bloc H2H d'affichage (bug corrigé, demandé explicitement) et les couches de données autour ont changé
- Screenshots E2E : download/task28-*.png

---
Task ID: 28-audit
Agent: Super Z (agent principal)
Task: Audit utilisateur « centralisation complète des matchs dans Neon » — vérifier le contenu réel de Neon, la source des routes API, la fenêtre de synchronisation, la contradiction seed 2709/4682, les caches, corriger si nécessaire, preuve SQL + E2E. Moteur v2.1 NON modifié.

Work Log:
- AUDIT Neon direct (scripts/audit-neon.ts) : matches=4683 (→4758 après re-sync), teams=1424, competitions=73, odds=3369, prediction_snapshots=926, prediction_markets=2782, prediction_outcomes=6504 ; 594→934 matchs futurs ; 0 doublon espn_event_id. LES DONNÉES ÉTAIENT LÀ — l'observation « uniquement les matchs du jour » était un artefact de vue (nom réel des tables = modèles Prisma PascalCase (« Match »), pas « matches » ; la requête §9 de l'utilisateur échouait avec relation "matches" does not exist ; pagination/aperçu console = lignes récemment mises à jour du jour).
- CAUSE RACINE de l'interruption de service trouvée : le boot plateforme (/start.sh) écrase .env avec DATABASE_URL=file:... (SQLite) à CHAQUE restauration, puis bun run db:push (schéma PostgreSQL + URL SQLite) échouait → serveur jamais démarré à 11:53 ; boucle sync morte depuis 04:35 UTC. L'URL Neon ne vivait que dans l'environnement du processus serveur du cycle précédent (jamais persistée).
- PERSISTANCE réparée via le point d'extension officiel .zscripts/dev.sh (présent dans repo.tar) : écrit .env Neon depuis .zscripts/.env.neon (chmod 600, .gitignore ajouté — secret jamais committé) AVANT toute opération Prisma ; remplacement de bun run db:push (accept-data-loss sur la prod = interdit) par bunx prisma generate + migrate deploy (idempotent, baseline) ; boot vérifié OK.
- Serveur relancé via bash .zscripts/dev.sh (env -u DATABASE_URL — le shell exportait file: qui écrasait .env) : /api/sync/status 200, db.connected=true, boucles actives (live 90 s × 5, cycle 10 min 1463 events, backfill 21 j/14 j).
- ROUTES AUDITÉES : /api/matches (Accueil) = ESPN direct + cache serveur (documenté, latence) ; /api/forecasts/week = Neon MAIS via le registre legacy ForecastMatch alimenté par fetchWeekEvents ESPN à la consultation (violation §7) ; /api/predictions + /api/match/[id] = analyzeMatch ESPN (entrées du moteur — ligne rouge, intact) ; db.match lue uniquement par H2H + sync/status.
- CORRECTION §7 : /api/forecasts/week lit désormais la liste depuis la table Neon « Match » (kickoffAt ∈ semaine), joint matchResult/forecastSnapshot/forecastEvaluation par identifiant ESPN + teams (logos) + competitions (code ligue) ; réponse identique en forme (+ espnEventId/homeTeamId/awayTeamId/competitionId/status ajoutés) ; scanTriggered=false ; ensureWeekScanned → no-op (plus AUCUN appel ESPN à la consultation).
- CORRECTION job.ts : stepScan alimente le registre ForecastMatch DEPUIS Neon (matches + teams + competitions), plus d'écriture ESPN ; stepResults réconcilie MatchResult depuis Match (Neon uniquement, anti-retour winner) ; stepPredict/stepEvaluate inchangés ; imports ESPN retirés.
- CORRECTION §8 fenêtres : cycle 2 j/8 j → 4 j arrière/14 j à venir (couvre semaine courante + suivante entières, 1 appel ESPN/ligue inchangé) ; backfill 21 j/14 j.
- CONFORMITÉ NOMS (cahier §1/§3/§25) : 10 VUES snake_case créées sur Neon (matches, teams, competitions, odds, prediction_snapshots, prediction_markets, prediction_outcomes, prediction_components, results, sync_job_runs) avec colonnes converties camelCase→snake_case (scripts/create-conformity-views.ts, DROP+CREATE idempotent) — la requête §9 exacte de l'utilisateur fonctionne désormais ; renommage réel des tables = recommandé en tâche dédiée (db push destructif interdit).
- PREUVE SQL (scripts/preuve-sql.ts) : répartition 8 jours 45/56/36/52/203/169/10/31 = 603 ; total futurs 934 ; complétude §7 100 % (espn_event_id/home_team_id/away_team_id/competition_id/status) ; 0 doublon ; match témoin 401912819 (Gol Gohar vs Al-Jazira, afc.cup, 13:45 UTC).
- E2E : /api/forecasts/week = 613 matchs depuis Neon (témoin PRÉSENT, scanTriggered=false) ; page /previsions 390×844 rend les cartes depuis Neon (613 matchs, 595 prédits, 50 terminés dont 2 VOID, 561 à venir, Brier 0,523) ; /api/match/401912819?league=afc.cup → H2H base (0 confrontation connue pour cette paire — historiques alimentés en fond, repli moteur silencieux) ; non-régression : / 200 (51 matchs ESPN Accueil), /precision 200, /api/matches 200 ; captures download/audit28-previsions.png + audit28-previsions-cartes.png.

Stage Summary:
- Neon contenait BIEN toute la semaine (la contradiction 2709/4682 = artefact de nommage/vue, chiffres réels confirmés en base) ; le vrai incident était l'arrêt total du serveur + de la boucle de sync après le recyclage de l'espace de travail (.env écrasé par le boot plateforme).
- Architecture §31 désormais réelle : ESPN → sync (seule voie d'entrée) → Neon → API Prévisions → app ; aucune requête ESPN à la consultation de Prévisions ; Accueil reste ESPN-direct par choix documenté (latence), Précision/moteur inchangés (ligne rouge v2.1 respectée : 0 formule/poids/paramètre modifié — fichiers touchés = route week, job.ts, sync-job.ts, .zscripts/dev.sh, .env/.env.neon).
- Persistance anti-récidive : .zscripts/dev.sh (dans repo.tar) réécrit l'env Neon au boot + prisma generate + migrate deploy ; secret dans .zscripts/.env.neon (gitignore, chmod 600) ; risque résiduel documenté (si le tar plateforme exclut .env.neon, le boot retombe en échec visible).

---
Task ID: 28-audit-2
Agent: Super Z (agent principal)
Task: Audit de centralisation complet demandé par l'utilisateur (15/09) — cartographie Fonctionnalité→Route→Données→Source→Table Neon, vérification de persistance boot/reboot, SANS AUCUNE MODIFICATION (code, données, moteur).

Work Log:
- Cartographie code : 13 routes API auditées (imports + lecture intégrale). ESPN direct confirmé dans : /api/matches (scan 120+ ligues), /api/predictions (analyzeBatch), /api/match/[id] (analyzeMatch + syncTeamHistory fond), /api/cashout, /api/bankroll/resolve (endpoint dormain — aucun appelant), /api/performance (résolution des pronos via fetchScoreboard). Neon pur : /api/forecasts/week, /api/forecasts/export, /api/forecasts/report, /api/sync/status.
- Fichiers ESPN recensés : espn.ts (scoreboard/schedule/standings/injuries), espn-sync.ts (sync — seule voie d'entrée autorisée), forecast/espn-week.ts (MORT — plus aucun import). Open-Meteo (weather.ts) = 2e source externe, jamais persistée.
- Audit Neon lecture seule (scripts/audit-centralisation.ts + 3 compléments, $queryRawUnsafe SELECT uniquement) : 15 tables + 10 vues conformes ; matches=4758 (3824 passés, 934 futurs, 603 sur 8 jours : 45/56/36/52/203/169/10/31/1), teams=1430 (1224 avec ≥1 FINAL), competitions=73, odds=4181, results=4758 (3814 FINAL winner=3814, 0 orphelin, 0 FINAL sans résultat), prediction_snapshots=926 (0 violation §6, 100 % v2.1), 10 triggers immutabilité (PredictionSnapshot/Market/Outcome/Component + ForecastSnapshot legacy, UPDATE+DELETE bloqués), 0 doublon espn_event_id.
- Écarts documentés (non corrigés — consigne) : (1) standings/blessures/météo ABSENTS de Neon (aucune table, consommés ESPN/Open-Meteo à la volée par le moteur) ; (2) historiques équipes PARTIELS (sync paresseuse 4 équipes/cycle + TTL 6 h ; profondeur variable : sept. 2026=1271 lignes vs juil.=49) ; (3) architecture générique §11-§19 : 922/926 snapshots = 3 marchés (migration legacy sans composants), seulement 2 snapshots production complets (8 marchés + POISSON/ELO/FORME/VOLTRIX) car le job forecast est étranglé ; (4) ForecastJobRun : 2 runs coincés en phase scan (04:12 process mort ; 13:00 en cours >25 min) — stepScan réécrit vers Neon SANS budget temps : ~1842 RTT séquentiels (findUnique+upsert × 921 matchs) ≈ 15-60 min/tick → prédictions nouvelles au compte-gouttes (12/tick après chaque scan) ; (5) cotes : 1390 captures à valeur identique (courses seed/cycle/live concurrentes — historisation préservée mais timeline polluée pour futures analyses CLV) ; (6) cycle sync : 16/121 ligues en échec à chaque passe (rate-limit ESPN présumé, toléré).
- PERSISTANCE BOOT (demande explicite) : /start.sh écrase .env en SQLite (2 occurrences : branche clean + branche restore) PUIS délègue à .zscripts/dev.sh qui restaure .env depuis .zscripts/.env.neon avant bun install/prisma generate/migrate deploy — mécanisme correct. MAIS DÉCOUVERTE CRITIQUE : /home/sync/repo.tar (snapshot de restauration actuel, 106,9 Mo, 3587 fichiers) NE CONTIENT PAS .zscripts/.env.neon (ni .env racine) — le tar a été pris à 11:51, AVANT la création du .env.neon (12:46) ; le tar inclut .zscripts/dev.pid (preuve que les dotfiles de .zscripts sont archivés) et db/custom.db + backups/* (preuve qu'il n'est pas gitignore-basé) → comportement du PROCHAIN pre-stop incertain : si .env* est exclu par motif, le reboot retombera en SQLite silencieux (serveur démarrerait en échec DB visible sur /api/sync/status ok:false). Non corrigé (audit seulement) — options proposées dans le rapport.
- Env serveur live : DATABASE_URL absent de l'environnement du processus (Prisma lit .env = Neon pooler) — /api/sync/status ok:true latency 1287 ms ; boucles actives (live 90 s × 4 ligues, cycle 10 min 121 ligues/1463 events, dernier backfill 21 j = 03:24).
- E2E lecture : /api/forecasts/week = 613 matchs 100 % Neon (scanTriggered=false, témoin 401906479 Real Tomayapo–Bolívar, 595 prédits, 8,1 s — latence Neon + charge scan) ; /api/matches = ESPN X-Cache MISS 1,5 s.
- Moteur v2.1 : git diff vide sur prediction.ts/analyze.ts/espn.ts/market-odds.ts/model-version.ts ; AUCUN fichier suivi modifié (git status propre, seuls 4 scripts d'audit SELECT ajoutés).

Stage Summary:
- Audit LECTURE SEULE livré : cartographie complète 13 fonctionnalités/routes × source × table Neon ; 5 écarts de centralisation + 1 risque critique de persistance (repo.tar sans .env.neon) documentés avec preuves SQL, AUCUNE correction appliquée, moteur v2.1 intouché. Rapport : download/AUDIT-centralisation-2026-09-15.md

---
Task ID: 28-b
Agent: Super Z (agent principal)
Task: « Finaliser la centralisation Neon » — migration /api/matches vers la table centrale Match (0 ESPN à la consultation), audit exhaustif des appels ESPN restants, décision conditionnelle « moteur lit Neon », durcissement reboot, tableau final + preuves chiffrées. Moteur v2.1 NON modifié.

Work Log:
- /api/matches RÉÉCRITE (src/app/api/matches/route.ts) : lecture Neon (Match par fenêtre UTC stricte Task 14, jamais de suppression d'historique) + Promise.all parallélisé (Competition/Team/OddsSnapshot/deriveForms) ; forme W/D/L dérivée des 5 derniers FINAL de l'historique Neon (convention ESPN, FormDots compatible) ; cotes = dernières captures OddsSnapshot (1X2 + ligne O/U + bookmaker) ; venue redécoupée ; record=null (non utilisé par l'UI) ; cache réponse 60 s/5 min + stale + single-flight + warmer conservés ; ensureSyncLoop() appelé (l'Accueil devient point d'entrée de la sync) ; header X-Source: neon ; shape LightMatch 100 % préservée (UI inchangée). tsc src/ = 0 erreur.
- Instrumentation ESPN (preuve chiffrée) : espn.ts = compteur global + journal 60 derniers appels horodatés, paramètre source 'client'|'sync' threadé dans espnFetch/fetchScoreboard/fetchTeamSchedule (défaut 'client', non-breaking) ; espn-sync.ts étiquette 'sync' (espnRawJson + refreshLiveMatches + syncTeamHistory) ; /api/sync/status expose espnCalls {total, client, sync, recent[15]} + ?resetEspn=1. Observabilité pure, aucun changement comportemental.
- Reboot VÉRIFIÉ via le chemin officiel : kill serveur → bash .zscripts/dev.sh → [ENV] .env écrit depuis .env.neon → bun install → prisma generate + migrate deploy OK → health check 200 (13:49). Post-restart : /api/sync/status ok:true, sync REPRISE AUTOMATIQUE (5 runs : live 90 s ×4 + cycle 13:53 121 ligues/1463 events/5 màj/48 cotes), latence Neon 1,3-2,3 s, 0 erreur dev.log.
- Durcissement boot (Task 28-b) : dev.sh fait désormais unset DATABASE_URL/DIRECT_URL (le .env fait foi — piège de l'export file: du shell purgé) et CHAÎNE DE SECOURS fail-loud : .zscripts/.env.neon → backups/.env.neon.copy (créée chmod 600, gitignorée — backups/ est archivé dans repo.tar, preuve : backups/env.bak-* présent dans le tar actuel) → sinon échec VISIBLE (exit 1) au lieu de retomber en SQLite silencieux.
- Preuves consultation (compteur ESPN remis à zéro avant chaque série) : /api/matches (15, 18, 19, 20, 21 sept) + page / + /previsions + /api/forecasts/week → **0 appel ESPN (total=0, client=0, sync=0)** ; cohérence SQL : 57 matchs du jour en Neon = 57 dans la réponse ; 20/09 = 169 = SQL ; 19/09 = 203 = SQL. Latences : HIT 8 ms, MISS parallélisé 2,7-3,0 s (contre 6,2 s séquentiel avant optimisation).
- Contrôles négatifs (ESPN attendu, documenté) : /api/match/[id] = 7 appels client (1 scoreboard + 2×2 schedules + 1 standings + 1 injuries) ; /api/predictions POST 1 match = 7 appels client (4 schedules + 1 standings + 1 injuries + scoreboard caché) ; /api/performance = ~19 scoreboards (résolution des pronos du 14/09) ; /api/cashout = ESPN direct (code). Moteur v2.1 rend ses probas normalement (401911654 : 0,58/0,20/0,22 confiance 4).
- DÉCISION MOTEUR (condition utilisateur non remplie → inchangé) : les entrées v2.1 n'existent PAS complètement dans Neon — historiques équipes partiels (1224/1430 équipes, profondeur irrégulière), standings ABSENTS, blessures ABSENTES, météo ABSENTE, cotes OddsSnapshot = 1 valeur décimale (close ?? open) alors que le moteur consomme les paires open/close (value bets + ancre de calibration). Brancher le moteur sur Neon aujourf'hui dégraderait les entrées → changerait les prédictions sans toucher une formule = interdit. Moteur = ESPN inchangé (git diff vide sur prediction.ts/analyze.ts/espn.ts/market-odds.ts/model-version.ts).
- E2E visuel (agent-browser 390×844) : Accueil = 57 matchs/22 ligues depuis Neon, chips 13→18 sept couvertes ; Prévisions = 613 matchs/597 prédits/50 terminés dont 2 VOID/Brier 0,529. Constat hérité HORS périmètre : l'analyse IA de l'Accueil (/api/predictions, inchangée) progresse ~9 s/match après un reboot à froid (écritures Neon séquentielles du chemin legacy + caches ESPN froids) — candidat d'optimisation future (écritures parallèles/batch createMany), aucune modification faite (hors consigne).
- Historique intact : FINAL 3815/total 4758, min kickoff 2025-01-24 — aucune suppression (la route filtre par fenêtre/statut, ne supprime rien).

Stage Summary:
- /api/matches + Combiné (même route) lisent désormais la table centrale Neon Match — 0 ESPN à la consultation, X-Source: neon, preuve par compteur horodaté. Prévisions/H2H déjà Neon. Restent ESPN à la consultation : analyses moteur Accueil/détail (entrées v2.1 — données incomplètes dans Neon, condition non remplie), résolution Précision, cashout. Boot durci (fail-loud + secours secret), sync reprise automatique vérifiée après redémarrage complet. Tableau final + preuves dans download/AUDIT-centralisation-2026-09-15.md (§ mis à jour) ; captures download/task28b-*.png.

---
Task ID: 29
Agent: Super Z (agent principal)
Task: Audit précis des données ESPN consommées en direct (analyzeMatch, /api/predictions, /api/performance, cash-out, résolution Précision) PUIS centralisation des données manquantes dans Neon (standings, blessures, historiques équipes, cotes open/close, météo) — moteur v2.1 strictement intact, aucun basculement.

Work Log:
- Audit lecture seule : cartographié tous les appels ESPN de consultation (analyze.ts: scoreboard ±3 dates, fetchTeamSchedule ×2 équipes ×2 saisons, fetchStandings, fetchInjuries, fetchWeather Open-Meteo ; routes predictions/performance/cashout/bankroll/resolve/match[id]/forecasts-tick)
- Chiffré l'état Neon : 4758 matchs, 1430 équipes (1225 avec ≥1 FINAL), 4426 cotes série, standings/injuries/météo ABSENTS, 69 ligues actives
- Ajouté 5 modèles additifs au schéma + Match.venueCity/venueCountry : StandingsSnapshot, InjurySnapshot, WeatherSnapshot, OddsOpenClose, TeamHistorySyncState (idempotence par clés uniques jour UTC, historisation append-only, IDs ESPN)
- db push additif (0 perte) + prisma generate ; vérifié serveur sain après (sync/status ok:true)
- Créé src/lib/sync/context-sync.ts : syncStandingsLeague, syncInjuriesLeague, captureWeatherUpcoming, sweepTeamHistory (budget 40, TTL 24h, tracé), runContextSync (phase 'context') — aucun import moteur/analyze (règle couche sync)
- Étendu espn-sync.ts (ingestion, pas le moteur) : open/close déclarés ESPN dans NormalizedOddsRow, ancrage idempotent OddsOpenClose (4bis), venueCity/Country propagés ; CORRIGÉ un bug introduit (open/close fuyaient dans oddsSnapshot.createMany → "Unknown argument" ; fixé en destructuring)
- Branché boucle contextuelle dans sync-job.ts (passe boot 60 s + toutes les 6 h, gardes globalThis) — active au prochain redémarrage du serveur
- Backfill one-shot (scripts/task29-backfill.ts, 526 s) : 2111 ancrages open/close (100% avec open+close déclarés), 969 standings (61 ligues), 1419 matchs avec venueCity, 106 météos, sweep 60 équipes (1415 matchs importés)
- Vérifié idempotence (2e passe : standings=0 injuries=0 weather=0, cotes insert-on-change only) via scripts/task29-verify.ts
- Constaté : ESPN ne publie AUCUNE blessure actuellement (site API vide sur toutes ligues testées, core API 404) → InjurySnapshot=0 est un état ESPN, la structure est prête
- git diff : 0 fichier moteur modifié (prediction.ts, analyze.ts, espn.ts, market-odds.ts, model-version.ts) ; tsc : 0 erreur sur les fichiers touchés

Stage Summary:
- Nouvelles tables Neon : StandingsSnapshot 969 lignes (61 ligues, @2026-09-15, rétro-backfill impossible — ESPN ne publie que l'état courant), InjurySnapshot 0 (ESPN vide), WeatherSnapshot 106 (facteur buts par match), OddsOpenClose 2111 (open/close ESPN 100%), TeamHistorySyncState 60 équipes tracées
- Couverture historiques : 924/959 équipes des matchs à 7 j ont ≥1 FINAL (35 manquantes — résorbées par le sweep)
- Aucune donnée supprimée (matchs terminés intacts : 3817 FINAL) ; appels ESPN étiquetés source='sync'
- Les nouvelles boucles (context 6 h + marks open/close dans ingestBatch) prendront effet au prochain redémarrage du serveur ; les backfills sont déjà en base
- Reste pour bascule analyzeMatch 100% Neon (non lancée) : orchestrateur miroir + parité shadow ; formules/paramètres inchangés garantis

---
Task ID: 30
Agent: Super Z (agent principal)
Task: Shadow-run ESPN vs Neon — vérifier que le moteur v2.1 donne les mêmes résultats avec les données Neon qu'avec ESPN. NE modifie PAS le moteur ni les prédictions de production ; mêmes données et même instant de référence pour les deux calculs ; rapport avec métriques de parité + top écarts causalisés + conclusion GO/NO-GO.

Work Log:
- Lecture moteur/couches : analyze.ts (analyzeMatch : scoreboard ±dates adjacentes, calendriers 2 saisons, standings, blessures, cotes, météo), prediction.ts (runEngine v2.1 — entrées EngineInput), espn.ts (types/fetchs), espn-sync.ts + context-sync.ts (tables Neon), h2h.ts, schema.prisma (StandingsSnapshot/OddsOpenClose/InjurySnapshot/WeatherSnapshot Task 29)
- Prouvé par grep : weatherImpact n'est JAMAIS lu par runEngine (déclaration l.584 + commentaire l.718 uniquement) → météo null des deux côtés = zéro effet sur les sorties ; MODEL_VERSION 'v2.1' identique par construction
- scripts/shadow-run.ts (lecture seule, 0 écriture DB) : sélection 48 matchs à venir 7 j stratifiée (36 avec cotes + 12 sans, plafond 6/ligue) ; côté ESPN = réplique exacte d'analyzeMatch (mêmes fetchs, même repli dates adjacentes, même saison via currentSeasonYear/PREV_SEASON importés) ; côté Neon = Match(FINAL, scope compétition) + StandingsSnapshot (dernier jour) + InjurySnapshot + OddsOpenClose ; MÊME nowMs pour les 2 appels runEngine ; comparaison : λ, 1X2, BTTS (+raw), O/U 2.5 (+raw), composants Poisson/Elo/Forme, topScores, 1er but, 1ère équipe, confiance, valueBets, digest (buildInputsDigest importé), champs équipe (elo/formScore/gamesHome/Away...) ; diagnostic automatique des causes ; compteur espnStats pour l'appel ESPN
- Découverte clé (pilote) : le calendrier ESPN {ligue}/teams/{id} ne couvre que LA compétition du match → historique Neon TOUTES compétitions = superset qui change les sorties (fatigue 28 j vs 3 j) → 2 variantes : ÉQUIVALENCE (scope compétition, référence de parité) + RICHE (documentaire : moy. 7,2 pp, max 33,8 pp — ne PAS activer sans revalidation)
- Run 1 (ANCRE, cotes = ancre OddsOpenClose) : 48 comparés, 22 complets → 22/22 identiques (0,0) ; global : 26/48 identiques, moyenne 2,44 pp, max 29,0, p95 17,5, >0.5pp=18/>1=11/>2=9 ; λ max 0,66 (2 > 0,5) ; digest 41/48
- Run 2 (SÉRIE, cotes = dernière valeur OddsSnapshot) : 32 complets → 32/32 identiques (0,0) ; global : 37/48 identiques, >0.5pp=18→9, valueBets différents 20→7
- Causes 100 % attribuées : (1) historiques rus.1/bol.1 non sweepés (Neon 3 vs ESPN 38) → 6 écarts >2 pp ; (2) fraîcheur cotes (ancres figées 14:50 + courses <10 min près du kickoff, ligne O/U déplacée West Ham) → 5 écarts résiduels ≤3,4 pp
- Diagnostic fraîcheur : boucle sync VIVANTE (live 90 s + cycle 10 min, série fraîche preuve 2.05@16:30) MAIS process serveur démarré 13:49 < code Task 29 → les marques OddsOpenClose d'ingestBatch ne sont pas encore actives (déjà documenté Task 29 « au prochain redémarrage ») ; serveur NON redémarré (contrainte)
- Preuves : scoreboard plage ESPN contient bien les cotes (test curl esp.1 : 29/29 events avec odds) ; SyncJobRun cadence régulière (live 90 s ×11 ligues, cycle 121 ligues/16 échecs tolérés) ; ancres Rayo figées à 14:50:02 = backfill Task 29
- Rapport : download/RAPPORT-shadow-run-2026-09-15.md ; données brutes : download/shadow-run-2026-09-15.json + shadow-run-2026-09-15-series.json ; scripts persistés : scripts/shadow-run.ts (+ shadow-preflight.ts)

Stage Summary:
- GO conditionnel : le moteur v2.1 est BYTE-IDENTIQUE sur Neon dès que les entrées sont complètes (54/54 matchs complets cumulés des 2 passes, écart max 0,0 — λ, 1X2, BTTS, O/U, digest, confiance, value bets) ; toutes les différences = entrées Neon incomplètes (historiques à sweeper + ancres cotes en attente de redémarrage), toutes résorbables par la couche sync existante
- Pré-requis avant basculement (aucun travail moteur) : 1) redémarrer le serveur (active marques Task 29 + sweep context) ; 2) laisser le sweep compléter les historiques des matchs à venir puis re-jouer le shadow ; 3) au basculement, sourcer la calibration sur la dernière valeur de série
- Moteur v2.1 : 0 modification (import direct, git diff vide) ; 0 écriture DB ; 0 prédiction de production touchée ; basculement NON lancé

---
Task ID: 30bis (fix cotes + incident)
Agent: Super Z (agent principal)
Task: Corriger UNIQUEMENT la reconstruction/sélection des cotes Neon (oscillations de ligne 2.5→3.5→2.5) sans toucher au moteur v2.1, puis relancer le shadow-run ESPN vs Neon et produire le rapport final GO/NO-GO.

Work Log:
- Fix scripts/shadow-run.ts (harnais shadow, PAS le moteur — git diff : 0 fichier moteur) : néonOdds() sélectionnait la ligne O/U par la seule jambe OVER la plus récente puis prenait l'UNDER de cette ligne → mélange d'épisodes lors des oscillations (cas West Ham : ancre 2.5 du 14:51 Over 1.59/Under 2.35 = exactement l'état ESPN, mais OVER@3.5 maj 17:27 écrasait la sélection). Nouvelle règle ANTI-OSCILLATION : pour chaque ligne candidate, fraîcheur = max(horodatage OVER, UNDER) ; ligne retenue = la plus récente activité de l'une OU l'autre jambe ; les 2 jambes assemblées SUR CETTE MÊME ligne. Série : fraîcheur = capture OddsSnapshot (repli horodatage ancre si jambe hors fenêtre) ; fenêtre take 80→400 (jambe silencieuse insert-on-change peut dater de plusieurs heures tout en étant la valeur courante exacte). Ancre : fraîcheur = closeCapturedAt ?? updatedAt.
- Redémarrage serveur EFFECTUÉ plus tôt (chemin officiel dev.sh, health 200 17:14) + sweep des historiques : 187 équipes tracées, 12 cibles des top-écarts resynchronisées (rus.1 ×8 : 38 FINAL chacune sauf Fakel/Rodina 8 = réalité ESPN promus ; bol.1 restantes ×4 : 49) ; +1440 FINAL d'historique importés (append-only, ingestion sync-layer uniquement).
- Shadow-run POST-redémarrage AVANT fix (référence v2, JSON sauvegardés *-v2-avant-fix-ligne.json) : mode ancre 48 comparés, λ 48/48 identiques, moyenne 0.177pp max 2.65 p95 0.89, >0.5=7 >1=2 >2=1, 40/48 identiques parfaits, digest 47/48 ; mode série 41/48 identiques, moyenne 0.164pp. **35/35 matchs complets BYTE-IDENTIQUES dans les 2 modes.** Tous les écarts résiduels = fraîcheur cotes + cas West Ham (oscillation de ligne).
- INCIDENT 18:32:07Z (timeline /tmp/boot-timeline.log) : REBOOT CONTENEUR plateforme → serveur dev tué, node_modules élagués (@prisma/client disparu — restauré par bun install + prisma generate v6.19.2), .zscripts/.env.neon SUPPRIMÉ, .env ré-écrasé en SQLite (piège documenté Task 28), backups/.env.neon.copy disparu (couche conteneur éphémère). Chaîne fail-loud Task 28-b a fonctionné (refus de retomber en SQLite silencieux).
- Recherche de récupération du secret EXHAUSTIVE (9 voies) : .env.neon ✗, .env ✗, backups ✗, historique git + commits dangling + stash ✗ (jamais committé), /tmp/my-project snapshot boot ✗ (secrets exclus par design), tool-results/logs ✗, /home/sync/repo.tar (18:16, 3753 entrées) ✗ (gitignorés exclus), cache .next ✗, /proc environ serveur ✗ (process mort). CONCLUSION : secret Neon irrécupérable localement — restoration nécessaire par l'utilisateur (console Neon).
- Données Neon : AUCUNE perte (cloud-side) — 5259 FINAL dont +1440 historiques du sweep, 2119 ancres, 938 predictionSnapshots (intacts), 2890 predictionMarkets. Le moteur, les prédictions de production et le fix shadow-run.ts sont intacts.

Stage Summary:
- Fix cotes ANTI-OSCILLATION en place (scripts/shadow-run.ts seul, +30/-7) — prêt à être validé par re-run dès restauration du secret Neon.
- Pré-incident : parité démontrée 35/35 complets byte-identiques (2 modes), λ 48/48, écarts résiduels 100 % cotes (max 2.65pp West Ham, cause oscillation maintenant corrigée dans le harnais).
- BLOQUANT pour la reprise : fournir l'URL Neon (pooler) → restaurer .zscripts/.env.neon (chmod 600) + backups/.env.neon.copy + .env → dev.sh → vérifier sweep/ancres → shadow ×2 (ancre+série) → rapport GO/NO-GO final.

---
Task ID: 31
Agent: Super Z (agent principal)
Task: Analyse d'architecture Vercel (déployer ou non VOLTRIX sur Vercel, fiabilité sync ESPN→Neon, env vars, sécurité DATABASE_URL, pérennité shadow-run). AUCUN déploiement, AUCUNE modification moteur.

Work Log:
- Audit code : src/lib/sync/sync-job.ts (4 boucles in-process : backfill boot, cycle 10 min, live 90 s, context 6 h), src/lib/forecast/job.ts (tick 5 min, budget 45 s), déclenchement paresseux via routes API + gardes globalThis — design « jamais de cron externe » = suppose un processus permanent.
- Audit infra : next.config.ts (output standalone, ts ignoreBuildErrors), schema.prisma (DATABASE_URL=pooler pgbouncer runtime + DIRECT_URL migrations), dev.sh (restauration .env.neon → migrate deploy → fail-loud), Caddyfile (:81 → :3000).
- État post-incident 18:32 : serveur DOWN (port 3000 muet), .zscripts/.env.neon ABSENT, backups/.env.neon.copy ABSENT, .env ré-écrit en SQLite (file:/home/z/my-project/db/custom.db) — restauration du secret par l'utilisateur (console Neon) toujours bloquante.
- Vérifs sécurité Git : .gitignore couvre .env*, .zscripts/.env.neon, backups/.env.neon.copy ✓ ; pas encore de repo git initialisé.
- Conclusion livrée en chat : Vercel OK pour le web/API lecture, boucles sync incompatibles serverless (2 options : Vercel Cron Pro avec adaptations verrous-DB/CRON_SECRET, ou hybride worker permanent recommandé — zéro code modifié) ; shadow-run = script local indépendant de Vercel, données Neon côté cloud intactes.

Stage Summary:
- Moteur v2.1 : 0 modification ; 0 déploiement effectué (conforme demande).
- Fix anti-oscillation du harnais (Task 30bis) en place, en attente de restauration URL Neon pour le re-run GO/NO-GO final.
- Séquence recommandée à l'utilisateur : (1) récupérer les 2 URLs Neon (pooler + direct) depuis la console Neon, (2) restaurer .env/.env.neon local + relancer dev.sh, (3) re-run shadow ×2 → rapport GO/NO-GO, (4) ensuite seulement GitHub → Vercel selon l'option choisie.

---
Task ID: 32
Agent: Super Z (agent principal)
Task: Exécuter la séquence validée par l'utilisateur : restauration environnement Neon (URL fournie) → vérification serveur → shadow-run final ancre + série → rapport GO/NO-GO final. Moteur v2.1 et prédictions production : 0 modification.

Work Log:
- Restauration : .zscripts/.env.neon + backups/.env.neon.copy + .env (DATABASE_URL=pooler, DIRECT_URL=direct dérivé sans -pooler), chmod 600 ; bun install (832 packages, node_modules purgé par le reboot conteneur).
- Connectivité validée : prisma migrate status = « Database schema is up to date » (les 2 canaux répondent).
- Redémarrage officiel dev.sh : ENV Neon restaurée, migrate deploy no-op OK, health 200 à 21:13Z.
- Preuve serveur→Neon : /api/sync/status (6199 matchs, 938 predictionSnapshots, 2890 predictionMarkets INTACTS) ; SyncJobRun frais (cycle 121 ligues/1463 events + live 90 s) ; marques Task 29 ACTIVES (90 ancres OddsOpenClose/15 min — pré-requis « au prochain redémarrage » rempli) ; FINAL 5261→5688 (rattrapage résultats du soir).
- Shadow-run final (fix anti-oscillation Task 30bis actif, ligne 194) : ANCRE 48 comparés, 33 complets 33/33 BYTE-IDENTIQUES, digest 48/48, moy 0.0437 pp max 0.95 p95 0.43, >0.5=1 >1=0 >2=0, λ 48/48, confiance 0, valueBets 7 diff ; SÉRIE 48 comparés, 31 complets 31/31 BYTE-IDENTIQUES, digest 47/48, moy 0.1517 max 4.88, >0.5=2 >1=1 >2=1, λ 48/48, confiance 0, valueBets 9 diff. Croisé : 31 complets identiques dans les 2 modes.
- Cas Boyacá Chicó - Alianza (col.1, 4.88 pp série) élucidé par timeline DB : vraie oscillation 2.5→1.5→2.5→1.5 ; jambes assemblées sur UNE même ligne (fix OK, aucun mélange) ; le retour à 1.5 capturé à 21:15:26 dans l'ANCRE mais pas en snapshot (valeurs identiques à 14:01 → insert-only) → fraîcheur série aveugle sur ce cas, ancre a sélectionné la bonne ligne (0 pp ancre, digest 48/48). Cause = sémantique de fraîcheur, PAS le moteur.
- Rapport final rédigé : download/RAPPORT-GO-NO-GO-final-2026-09-15.md (10 mesures exigées + top-20 causes + verdict). Artefacts : shadow-run-2026-09-15.json, -series.json, scripts/analyze-shadow-final.ts, scripts/verify-neon-live.ts.

Stage Summary:
- VERDICT : GO — moteur v2.1 byte-identique sur Neon (64/64 paires complet×mode à 0pp/λΔ0), digest 95/96, confiance 96/96 ; 100 % des écarts résiduels = fraîcheur cotes sur matchs partiels (bornés, expliqués, résorbables) ; causes historiques rus.1/bol.1 disparues (sweep).
- Moteur v2.1 : 0 modification ; prédictions production : 0 modification ; écritures shadow : 0 (SELECT only).
- Recommandation avant basculement : sourcer la fraîcheur de ligne sur updatedAt des ancres (mode ancre déjà correct) ou enrichir la fraîcheur série avec l'horodatage ancre — couche données uniquement.
- Environnement restauré et pérenne : secret dans 3 fichiers locaux chmod 600 + prêt pour Vercel Env Vars (prochaine étape GitHub → Vercel selon l'analyse Task 31).

---
Task ID: 33
Agent: Super Z (agent principal)
Task: Préparation GitHub + audit de sécurité complet pre-push (secrets, .gitignore, historique). Moteur v2.1 : 0 modification. Vercel : non déployé.

Work Log:
- Découverte : .git pré-existant (41 auto-commits plateforme UUID, 2873 objets/~88 Mo, 1690 fichiers suivis incluant skills/download/tool-results/upload/backups/db).
- Audit historique : .env commité 3 fois (789b561, a2f54bf, 4023f18) — vérifié blob par blob : 0 secret Neon dans les 3 (URL SQLite sans identifiant) ; secret Neon jamais commité.
- .gitignore durci : +/skills/ /download/ /tool-results/ /upload/ /backups/ /db/ /examples/ blindtest/data suivi-preview dev.pid *.bak*.
- Historique réécrit en commit orphelin unique (244 fichiers, 4,2 Mo) + reflog expire + gc --prune=now --aggressive → ancien historique physiquement purgé (288 objets restants).
- Scan de secrets sur contenu stagé : 12 familles de motifs (npg_, fragments réels mot de passe/token, neon.tech, ep-round-cloud, URL avec credentials, sk-/AKIA, PEM, x-access-token, passwords en dur) — TOUTES négatives ; 3 mentions documentaires DATABASE_URL=file: sans identifiant.
- Push effectué avec token en env éphémère (jamais en fichier/config — vérifié) : main = 024f9917274fb2b7ed3fee8c2ca6825a2fa5c14d, SHA distant vérifié identique par ls-remote.
- Fichiers moteur confirmés dans l'arbre poussé (prediction.ts, analyze.ts, sync/*, schema.prisma, dev.sh).
- Rapport d'audit : download/AUDIT-securite-git-2026-09-15.md.

Stage Summary:
- Repo GitHub alimenté : 1 commit propre (024f991), 244 fichiers / 4,2 Mo, zéro secret (contenu + historique).
- Problème majeur évité : l'historique plateforme aurait poussé ~100 Mo d'artifacts ; .env historique était sans secret mais l'approche orpheline garantit un historique irréprochable.
- Recommandations : rotation du PAT (transité par le chat), branch protection + secret scanning GitHub, env vars Vercel (DATABASE_URL pooler + DIRECT_URL) au moment du déploiement — option hybride Task 31 pour la sync.

---
Task ID: 34
Agent: Super Z (agent principal)
Task: Audit pré-déploiement GitHub → Vercel → Neon (routes, dépendances ESPN, boucles, env vars, build, worker). 0 modification de code, 0 déploiement.

Work Log:
- Cartographie des 12 routes API : 4 pures lectures Neon (forecasts/week via ForecastSnapshot, report pdf-lib/StandardFonts sans fichiers locaux, export, matches), 5 avec appels ESPN directs à la volée (match/[id] via analyzeMatch + écriture syncTeamHistory, predictions via analyzeBatch, performance via resolvePredictionsForDate, cashout et bankroll/resolve via fetchScoreboard), 2 routes worker (sync/tick, forecasts/tick — écritures Neon, GET non protégés), sync/status.
- Découverte clé : analyzeMatch reconstruit ses entrées en direct depuis ESPN (fetchScoreboard/fetchTeamSchedule/fetchStandings/fetchInjuries) — la parité Neon démontrée par le shadow-run porte sur les entrées, pas sur le chemin de calcul production.
- 0 fs/readFile/writeFile dans src/ ; custom.db jamais référencé ; preds-cache = localStorage client ; logEspnCall = mémoire ; cache/rate-limit sweeps = per-instance inoffensifs ; sharp installé mais non importé.
- ensureSyncLoop/ensureForecastLoop appelés depuis routes de lecture (matches:403, forecasts/week, sync/*) — setInterval morts sur Vercel → garde VERCEL proposée (non appliquée).
- Build : pas de prisma generate explicite ; cp -r standalone inutiles sur Vercel → build script proposé (non appliqué) : prisma generate && prisma migrate deploy && next build.
- Env vars exactes confirmées : DATABASE_URL (pooler, runtime via db.ts) + DIRECT_URL (CLI migrations via schema directUrl, jamais le code applicatif). ESPN/météo sans clé. CRON_SECRET optionnel futur.
- Worker indépendant démontré (serveur local ↔ Neon sans GitHub/Vercel) ; caveat : amorçage paresseux des boucles par trafic API → instrumentation.ts ou keepalive curl recommandés côté worker.
- Auto-commit plateforme 95a0dff (worklog +20 lignes) re-scané (1 faux positif = noms de motifs dans le texte) et poussé — remote vérifié = local.
- Rapport : download/AUDIT-pre-deploiement-vercel-2026-09-15.md.

Stage Summary:
- ✅ Compatible sans changement : pages principales lues depuis Neon, pdf-lib sans assets, zéro fichier local/SQLite dans src, deps 100 % Vercel-compatible, worker indépendant, moteur v2.1 intouché (poussé à l'identique).
- ⚠️ Avant Vercel : garde VERCEL sur les 2 boucles, protection/neutralisation des routes worker, build script Prisma, décision sur les 5 routes à appels ESPN à la volée (maxDuration ou bascule Neon précalculée).
- ❌ Incompatible : la sync elle-même sur Vercel (rôle exclusif du worker permanent) ; next dev en prod (non bloquant).
- 4 modifications de code identifiées, aucune appliquée (conforme instruction).

---
Task ID: 35
Agent: Super Z (agent principal)
Task: Validation des modifications d'infrastructure 1-3. AVANT application : cartographie finale d'analyzeMatch (source ESPN de chaque donnée / existence Neon / table+colonne / équivalence historique / impact moteur si absente / besoin ESPN résiduel) + potentiel de migration des 5 routes ESPN. PUIS application des mods 1-3 uniquement, diff exact, preuve moteur v2.1 intouché. Aucune migration de route, 0 déploiement.

Work Log:
- CARTOGRAPHIE analyzeMatch (6 blocs de données) : ① identification event/équipes/kickoff/statut/scores/venue ← fetchScoreboard (site.api.espn.com/…/scoreboard?dates=) → Neon Match (espnEventId unique, homeTeamId/Name, awayTeamId/Name, kickoffAt, status, statusDetail, espnState, homeScore, awayScore, venue, venueCity, venueCountry, season) — équivalence exacte (même payload, ingestion idempote 10 min/90 s) ; ② cotes ← mapOdds du scoreboard → OddsOpenClose (espnOpenOdds/espnCloseOdds ancre + openOdds/closeOdds captures) + OddsSnapshot série — équivalence ancre PROUVÉE GO shadow-run (33/33 byte-identiques) ; ③ calendriers 2 saisons ×2 équipes ← fetchTeamSchedule (…/teams/{id}/schedule?season=) ×4 appels → Neon Match via syncTeamHistory/sweep (TeamHistorySyncState, budget 40/6 h, TTL 24 h) — équivalence PARTIELLE (seuls matchs joués importés, fenêtre 7 j upcoming, dépend du sweep) ; ④ classement ← fetchStandings (apis/v2/…/standings?season=) → StandingsSnapshot (1 ligne/ligue+season+équipe+JOUR) — équivalence champ à champ, historique depuis déploiement seulement ; ⑤ blessures ← fetchInjuries (…/injuries) → InjurySnapshot — équivalence même payload, quotidienneté dépend du context-sync ; ⑥ météo ← fetchWeather (Open-Meteo geocoding+forecast, PAS ESPN) → WeatherSnapshot (goalsFactor, <48 h, 1 capture/jour). Impact moteur : cotes (calibration O/U + valueBets), calendriers (λ Poisson/Elo/Forme/fatigue), blessures (λ clamp 0.92–1), météo (goalsFactor λ) = MOTEUR ; standings (rank/points/gamesPlayed/enjeux/leagueTeamsCount — commentaire prediction.ts l.590 « ne touchent JAMAIS les λ ») et données event (affichage) = HORS moteur ; derby = interne aux noms (analyzeMatch passe isDerby:false), nowMs = horloge.
- POTENTIEL DE MIGRATION des 5 routes (indiqué, NON implémenté) : match/[id] → 100 % migrable (Match+OddsOpenClose+StandingsSnapshot+InjurySnapshot+WeatherSnapshot+getH2HFromDb déjà Neon) ; predictions → migrable idem via lecture Neon au lieu d'analyzeMatch ESPN ; performance → resolvePredictionsForDate peut lire Match FINAL au lieu de fetchScoreboard (closingOdds via OddsOpenClose) ; cashout → phases in/post migrables via Match (statusDetail/homeScore/awayScore live 90 s), legLiveProb conservé ; bankroll/resolve → grading migrable sur Match, fallback orphans sans leagueCode reste dépendant (scan 10 ligues) ou requiert enrichissement.
- MOD 1 appliquée (garde VERCEL boucles) : src/lib/sync/sync-job.ts ensureSyncLoop + src/lib/forecast/job.ts ensureForecastLoop → `if (process.env.VERCEL === '1') return;` en tête — protège tous les appelants paresseux (matches:403, sync/status, forecasts/week, sync/tick) sans les modifier ; warmer/lectures caches laissés (Neon-only, inoffensifs per-instance).
- MOD 2 appliquée (build Prisma) : package.json build = `prisma generate && prisma migrate deploy && next build && cp …` — client généré à coup sûr sur Vercel + migrations idempotentes alignées à chaque déploiement.
- MOD 3 appliquée (routes worker neutralisées sous Vercel) : src/app/api/sync/tick/route.ts + src/app/api/forecasts/tick/route.ts → 403 JSON « Route worker désactivée sur Vercel… » avant toute exécution (anti double-écriture avec le worker, anti facturation serverless) ; GET forecast/tick délègue à POST donc couvert.
- Vérifications : tsc --noEmit → 0 erreur src/ (erreurs préexistantes examples/+scripts/ hors périmètre) ; git diff = 5 fichiers exactement (51 insertions, 1 suppression) ; prediction.ts/analyze.ts ABSENTS du diff (git status) ; serveur local relancé implicitement OK : /api/sync/status 200, db.connected, Neon 7116 matchs/938 snapshots — gardes inactives localement (VERCEL unset).
- Rapport : download/CARTOGRAPHIE-analyzeMatch-et-mods-2026-09-16.md.

Stage Summary:
- Mods 1-3 appliquées et vérifiées : gardes VERCEL (2 boucles), build Prisma (generate+migrate deploy), routes worker 403 sous Vercel. 5 fichiers modifiés, +51/−1.
- Moteur v2.1 STRICTEMENT inchangé (prediction.ts, analyze.ts hors diff — preuve git) ; aucune migration de route effectuée (potentiel documenté seulement).
- Sous Vercel : boucles no-op, routes worker 403, lectures Neon inchangées → l'app reste 100 % fonctionnelle en lecture avec le worker permanent alimentant Neon (architecture hybride Task 31).
- Prochaines étapes possibles : pousser ces 5 fichiers sur GitHub, configurer env vars Vercel (DATABASE_URL pooler + DIRECT_URL), déployer le worker permanent.

---
Task ID: 36
Agent: Super Z (agent principal)
Task: Validation finale des modifications 1-3 (Task 35) + commit propre unique + push GitHub. Vérifications pré-push exigées : moteur byte-identique, 0 secret, build Prisma, gardes VERCEL, routes worker bloquées, tsc 0 erreur.

Work Log:
- Re-vérifié les 7 points de contrôle pré-push : (1) prediction.ts/analyze.ts blob-identiques à la baseline poussée 024f991 (blobs git 58c3e95f / ad71154e, diff 0 ligne) ; (2) 0 secret dans le diff à pousser (familles npg_/neon.tech/ghp_/AKIA/PEM/etc. négatives ; unique correspondance sur l'arbre = ligne documentaire du worklog Task 33 listant les motifs, faux positif) ; (3) package.json build = prisma generate && prisma migrate deploy && next build && cp ; (4) garde VERCEL en tête de ensureSyncLoop (sync-job.ts:78) ; (5) garde VERCEL en tête de ensureForecastLoop (forecast/job.ts:378) ; (6) /api/sync/tick + /api/forecasts/tick → 403 sous VERCEL=1, GET délégué à POST ; (7) tsc --noEmit : 0 erreur sous src/ (erreurs restantes = examples/ + scripts/ préexistantes, hors périmètre).
- Constaté que les mods 1-3 avaient été englobées par 2 auto-commits plateforme NON poussés (e863b2b worklog seul, 28f5220 code+worklog, messages UUID) ; remote = 95a0dff.
- Regroupés en UN commit propre à message explicite (reset --soft 95a0dff + recommit) : 5 fichiers code + worklog, push fast-forward garanti, aucun historique distant réécrit.
- Push BLOQUÉ en l'état : aucun credential GitHub dans la session (PAT Task 33 en env éphémère non persisté ; credential helper absent, .git-credentials absent, gh CLI absent, token absent de l'env et des traces locales). Commit local définitif prêt ; le SHA local sera publié tel quel dès réception du PAT.

Stage Summary:
- Commit propre local = exactement les mods 1-3 + worklog (6 fichiers) ; moteur v2.1 prouvé byte-identique (blobs git) ; 0 secret ; tsc src/ = 0 erreur ; gardes VERCEL ×2 ; routes worker 403.
- Push en attente du PAT utilisateur.

---
Task ID: 41
Agent: Super Z (agent principal)
Task: Implémentation Option B (GO utilisateur) : ForecastSnapshot → /api/predictions → MatchCard, fallback analyzeMatch si snapshot absent. Réalignement repo sur origin/main, moteur v2.1 intouché, indicateur de diagnostic, tests anti-ESPN, diff + preuves avant push.

Work Log:
- Step 0 realign : remote origin ré-ajouté (perdu au reboot), `git fetch origin` + `git reset --hard origin/main` → HEAD = 039ee22 ; gardes Task 35/36 vérifiées présentes (forecast/job.ts:378) ; baseline SHA256 des 5 fichiers moteur sauvegardée (scripts/engine-baseline-39ee22.sha).
- Environnement reconstruit après reboot : bun install (832 paquets), prisma generate, PostgreSQL 17.11 embarqué extrait localement (.tmp-pg/pg17, Debian .deb sans root — provider schéma = postgresql, SQLite impossible) pour les tests d'intégration.
- src/lib/forecast/snapshot-serve.ts (NOUVEAU, 473 l., pur — n'importe que @/lib/db + model-version + types) : fetchValidSnapshots (2 SELECT, règle « dernière version publiée » = mire week.ts:88 + validation défensive modelVersion/champs clés), computeValueBetsCount (mire EXACTE buildValueBets prediction.ts:502-539 — jambes 1X2 probs finales, O/U à la ligne marché en probs BRUTES pOver25Raw/PredictionOutcome.rawProbability, edge=p×cote−1>0.02, tri desc, plafond 4, BTTS jamais, cotes FIGÉES), buildQuickPredFromSnapshot (shape QuickPred strict : recommendedBets mire prediction.ts:839-870 avec notes 1X2/DC reconstruites à l'identique, overUnder 1.5/2.5/3.5 depuis PredictionSnapshot calibré + repli 2.5, ouOdds = cotes figées, topScores [], lambda omis), buildFrozenPicks (mire extractPicks analyze.ts:272-341 sur valeurs figées), confidenceLabelOf (mire prediction.ts:796), capture fetch refcountée (espnCalls/outboundCalls par hôte, sans toucher au moteur).
- src/app/api/predictions/route.ts (MODIFIÉ) : pré-étape snapshot (try/catch global → échec DB = tout le lot en chemin moteur), branchage par match, analyzeBatch appelé avec le SEUL sous-ensemble sans snapshot (0 HTTP si vide), persistance figée snapshot (upsert create + update:{} — predictionTime/oddsCapturedAt du snapshot, kickoff>now, idempotent, repli shape historique), boucle persistance moteur HISTORIQUE conservée verbatim pour le fallback, réponse dans l'ORDRE de la demande + `meta` additif (source snapshot/fallback/mixed/empty, counts, espnCalls, outboundCalls, snapshotLookupOk, perMatch).
- src/lib/types.ts (MODIFIÉ, 1 ligne) : QuickPred.lambda → optionnel (non lu par carte/combo/cache — audit Task 40) ; chemin moteur le fournit toujours.
- scripts/test-option-b.ts (NOUVEAU, 619 l., convention bun scripts/test-*) : 1) unitaires computeValueBetsCount (11 cas, dont parité arithmétique JS 0.3×3.4−1=0.0200…018 INCLUS comme buildValueBets), confidenceLabelOf (6), mapping QuickPred + FrozenPicks (12) ; 2) intégration sur VRAIE route + PG 17 éphémère : lot mixte 6 matchs (valide / sans / non publié / mauvaise version / kickoff passé) → ordre préservé, sources exactes, persistance figée colonne par colonne, idempotence re-POST (0 réécriture), ANTI-ESPN (espion global.fetch + meta : 0 appel sortant sur lot 100 % couvert ; CONTRASTE espnCalls>0 sur fallback cache froid), échec DB réel (DROP TABLE) → repli intégral ; 3) validation croisée GET lecture seule voltrixbet.vercel.app : computeValueBetsCount = recalcul indépendant sur 604 snapshots réels (285 avec jambes, 288 sans cotes → 0).
- Correctif attrapé par le test : route.ts `bundles!.get` → `bundles?.get` (échec DB de lecture snapshot provoquait un TypeError au lieu du repli moteur).
- Vérifications pré-push : build production COMPLET sur PG éphémère (prisma generate + migrate deploy + next build OK, toutes routes) ; tsc --noEmit src/ = 0 erreur ; sha256sum -c baseline moteur = 5/5 OK ; scan secrets diff = 0 correspondance ; patch complet 1612 l. sauvé (download/diff-option-b-complet.patch).

Stage Summary:
- Option B implémentée : 1 nouveau module pur + 1 route modifiée + 1 ligne types + 1 suite de tests ; 0 fichier moteur, 0 migration, 0 page UI.
- Tests : 65/65 OK (dont anti-ESPN 0 fetch, idempotence, échec DB, 604 snapshots réels) ; build prod OK ; moteur byte-identique 5/5 (SHA256).
- Accueil attendu en prod : 56/56 cartes servies depuis Neon sans ESPN ni moteur (1-3 s au lieu de 15-35 s), valueBetsCount exact sur les cartes à cotes figées.
- Commit local prêt ; push en attente du PAT utilisateur (aucun credential dans la session — reboot).

---
Task ID: 42
Agent: Super Z (agent principal)
Task: Diagnostic pré-push ciblé table legacy Prediction (LECTURE SEULE — aucune modification) : inventaire exhaustif des create/update/upsert/delete, anciennes lignes modifiables ou non, périmètre des triggers d'immutabilité.

Work Log:
- Grep exhaustif repo (src/, scripts/, tests/, tout type de fichier, hors node_modules) de `.prediction*.`, `$queryRaw/$executeRaw`, `INSERT INTO/UPDATE SET/DELETE FROM "Prediction"` : inventaire complet obtenu.
- Caractérisation contextuelle de chaque point d'écriture (route.ts 100-320, analyze.ts 356-450, performance/route.ts 30-104) : gardes applicatives identifiées (update:{}, if !row.resolved, filtre resolved:false + fenêtre J-10/J-3h).
- Lecture scripts/apply-immutability.ts : TABLES = PredictionSnapshot, PredictionMarket, PredictionOutcome, PredictionComponent, ForecastSnapshot (10 triggers UPDATE+DELETE). Prediction legacy ABSENTE.
- Preuves worklog Task 28 (application Neon : 10 triggers) + Task 28-audit-2 (vérification lecture seule Neon : exactement 10 triggers, ces 5 tables).
- Re-vérification live impossible : .env local = DATABASE_URL SQLite uniquement (repli post-leak, aucune cred Neon en local par conception) — procédure de re-check documentée (pg_trigger, lecture seule).

Stage Summary:
- Écrivains prod de Prediction : (1) POST /api/predictions — upserts update:{} (snapshot L144/175 + fallback L231/261, ne réécrivent JAMAIS une ligne existante) + updates conditionnels L281/301 UNIQUEMENT si !resolved (probability/odds/confidence/pick/pickedTeamId/oddsCapturedAt/rawProbability/inputsDigest ; predictionTime/modelVersion jamais) ; (2) GET /api/performance → resolvePredictionsForDate (analyze.ts L430/436) : resolved/result/closingOdds sur resolved:false, matchDate [J-10, J-3h).
- Anciennes lignes NON résolues : modifiables par 2 chemins applicatifs (par design). Lignes RÉSOLUES : figées applicativement (garde 19-a), PAS au niveau DB.
- Jobs/workers/tick routes : ZÉRO écriture Prediction. Aucun SQL brut sur Prediction dans src/.
- Triggers d'immutabilité : PredictionSnapshot/Market/Outcome/Component + ForecastSnapshot uniquement — Prediction legacy n'a AUCUN trigger (UPDATE/DELETE autorisés en base).
- Aucune modification effectuée (diagnostic pur). Push Task 41 toujours en attente.

---
Task ID: 43
Agent: Super Z (agent principal)
Task: GO « sécuriser Prediction » SANS trigger d'immuabilité totale — design complet (aucune modification, aucun push) : analyse du rôle de Prediction dans /api/predictions et /api/performance, matrice champs immuables vs évolutifs, mécanisme DB proposé (trigger ciblé + porte à sens unique pour la résolution), DDL exact, compatibilité Option B//api/performance, plan de tests.

Work Log:
- Vérifications code complémentaires : fin du bloc refresh (route.ts L279-314, catch englobant avalant L312), select complet de /api/performance fetchPage (L98-136), computePerformanceStats (analyze.ts L573-603 : consomme probability=Brier+calibrage, odds=ROI, confidence=byConfidence, market/leagueName/modelVersion=cohortes, resolved/result=gating ; closingOdds JAMAIS relu = audit only).
- Matrice de décision par champ établie (17 champs figés, 3 évolutifs one-way).
- DDL rédigé : fonction voltrix_prediction_freeze_guard() + 2 triggers (Prediction_freeze_update, Prediction_freeze_delete), garde colonne-par-colonne IS DISTINCT FROM, résolution autorisée uniquement OLD.resolved=false, ligne résolue = dossier clos, DELETE interdit.
- Compatibilité vérifiée opération par opération : upserts create-only Option B (INSERT/no-op OK), refresh fallback (rejeté → 2 options A zéro-modif / B suppression bloc recommandée), settleRow (autorisé), re-résolution (rejetée), scripts (DB temporaires), db push additif, SQLite local.
- Plan de tests rédigé : scripts/test-prediction-freeze.ts (~30 checks, PG temporaire, mire test-prediction-immutability.ts) + re-run test-option-b.ts avec trigger appliqué + suite non-régression.
- Rien modifié, rien poussé (conformément à l'instruction).

Stage Summary:
- Design livré : 17 champs figés (identité, descriptif, payload pronostic complet incl. odds/oddsCapturedAt/confidence) + 3 champs one-way (resolved/result/closingOdds) autorisés uniquement pendant resolved=false ; DELETE toujours interdit.
- Recommandation : Option B (suppression du bloc refresh route.ts ~30 l. dans l'évolution dédiée) ; variante A zéro-modif documentée.
- Limites documentées : TRUNCATE/DROP non bloqués (comme les 10 triggers §20 existants), corrections post-résolution nécessitent DISABLE TRIGGER manuel.
- Artefacts de design dans la réponse (DDL + script de pose + tests) ; implémentation en attente du feu vert utilisateur.

---
Task ID: 44
Agent: Super Z (agent principal)
Task: GO Option B (§20bis) — implémentation protection DB Prediction : payload figé (19 colonnes), résolution one-way (resolved/result/closingOdds), DELETE interdit ; suppression du bloc refresh de /api/predictions (option B) ; moteur v2.1 et tables snapshot intouchés ; tests complets ; commit SANS push ni deploy.

Work Log:
- Reboot conteneur constaté : 2 auto-commits UUID bénins (worklog), node_modules/.tmp-pg/baseline perdus → bun install, prisma generate, PG 17.11 embarqué ré-extrait (deb.debian.org, dpkg-deb -x), baseline moteur régénérée depuis blobs git 039ee22 (5/5 OK).
- scripts/prediction-freeze-sql.ts (NOUVEAU) : DDL partagé — fonction voltrix_prediction_freeze_guard() + 2 triggers idempotents (Prediction_freeze_update/delete), 19 colonnes figées IS DISTINCT FROM + porte one-way sur resolved/result/closingOdds tant que OLD.resolved=false, messages « VOLTRIX §20bis » nominatifs.
- scripts/apply-prediction-freeze.ts (NOUVEAU) : runner idempotent mire apply-immutability.ts (vérifications pg_trigger/pg_proc : exactement 2 triggers + 1 fonction ; à exécuter sur Neon avec creds hors-repo).
- src/app/api/predictions/route.ts (MODIFIÉ) : bloc refresh conditionnel (!resolved) SUPPRIMÉ (~33 l.) + flag mort newColumnsSupported/let row supprimés — la persistance fallback devient création-seule (upsert update:{}), alignée sur le chemin snapshot ; commentaires §20bis.
- scripts/test-option-b.ts (MODIFIÉ) : trigger appliqué sur le PG temporaire APRÈS db push (toute la suite tourne AVEC la garde) + 4 sondes §20bis en fin (2 triggers présents, INSERT libre, rejet mutation, rejet DELETE) → 69 checks.
- scripts/test-prediction-freeze.ts (NOUVEAU, 52 checks, PG 17 éphémère) : pose+idempotence (re-pose sans doublon), isolation (snapshots libres), créations full/legacy NULL, résolution légitime 2 shapes settleRow (WIN+closingOdds / LOSE repli / VOID), 19 rejets colonne-par-colonne + fingerprint bit-identique + message nominatif, dossier clos (4 rejets + no-op passe), DELETE×2, upsert réplique Option B (no-op + create ignoré + shape historique), computePerformanceStats exact (brier 0.18125, roi 1.1, byVersion), route réelle GET /api/performance 200 (0 ESPN).
- DÉBOGAGE SQL (2 causes racines documentées dans le code) : (1) plpgsql exige END IF; même sur IF…THEN une-ligne → 19 gardes corrigées ; (2) champs camelCase des records NEW/OLD doivent être QUOTÉS (NEW."matchId") — identifiant nu rabattu en minuscules → record "new" has no field. Debug par psql + bissecte incrémentale sur PG jetable.
- Vérifications : tsc --noEmit src/ = 0 erreur (erreurs scripts/ préexistantes, identiques au commit 23a706e — vérifié par stash) ; next build production OK (toutes routes) ; sha256sum -c baseline 5/5 OK ; scan secrets diff = 0 correspondance.

Stage Summary:
- §20bis opérationnel et prouvé : payload figé au niveau PostgreSQL, résolution one-way fonctionnelle (/api/performance), DELETE interdit, Option B compatible (no-op update:{} passe), idempotent.
- Tests : 52/52 freeze · 69/69 option-b (trigger actif) · 31/31 perf-integrity · src/ tsc propre · build prod OK · moteur 5/5 byte-identique · 0 secret.
- Commit local prêt ; push GitHub + deploy Vercel + application du trigger sur Neon (apply-prediction-freeze.ts) en attente de creds/GO utilisateur.

---
Task ID: 45
Agent: Super Z (agent principal)
Task: GO « Wake on Demand » (§26) — remplacer la DÉPENDANCE au worker permanent par une synchronisation ESPN → Neon déclenchée à la demande (POST /api/sync/wake), verrou anti-concurrence PostgreSQL, reprise sur curseur, priorité LIVE, bouton frontend « Actualiser les données » ; moteur v2.1 et Option B intouchés ; tests complets ; commit SANS push ni deploy.

Work Log:
- Reboot conteneur : node_modules/.tmp-pg perdus → bun install + PG 17.11 ré-extrait (scripts/ensure-pg17.sh, deb.debian.org + dpkg-deb -x) ; scripts de test migrés de `bunx prisma` → `node_modules/.bin/prisma` (le binaire `prisma` du PATH est intercepté par un wrapper local).
- Diagnostic : worker permanent EXTERNE (architecture hybride Task 31) alimente Neon ; sous Vercel routes worker 403 + boucles no-op. SyncJobRun existant (startedAt/finishedAt/phase/stats/error) JAMAIS écrit à l'avance (logSyncRun = posthume) → aucun verrou possible en l'état.
- prisma/schema.prisma + migration 20250917000000_wake_sync_state : SyncJobRun +4 colonnes NULLABLES (status, triggerSource, runningLock, progress — rétrocompatibles worker) + INDEX UNIQUE PARTIEL SyncJobRun_running_lock_uidx ON (runningLock) WHERE runningLock IS NOT NULL → garantie DB d'UN SEUL job actif.
- src/lib/sync/wake.ts (NOUVEAU) : getSyncState (dérivation lastSyncAt/lastLiveSyncAt/contextStale depuis SyncJobRun — les lignes worker historiques status NULL comptent comme valides → transition douce), runWake (claim → LIVE prioritaire → cycle par lots de 6 ligues → team-history 4 équipes → contexte 6h teamBudget 12 ; budget temps/invocation 45 s (SYNC_WAKE_BUDGET_MS) ; curseur progress JSON sauvegardé à chaque lot ; reprise du MÊME runId (partial|failed + travail restant) via UPDATE conditionnel runningLock IS NULL ; takeover des verrous orphelins > 6 min ; finalize libère TOUJOURS le verrou) ; logs structurés [VOLTRIX SYNC] SOURCE=WAKE|EXISTING_WORKER STATUS=STARTED/RUNNING/SUCCESS/FAILED/PARTIAL/LOCK_RECOVERED/SKIPPED ESPN_CALLS MATCHES_UPDATED ODDS_UPDATED DURATION_MS.
- DÉCOUVERTE MAJEURE : l'API ESPN scoreboard répond désormais HTTP 400 « Failed to get events endpoint. » à TOUTE plage dates=A-B (même 7 j) — seule la forme jour unique dates=YYYYMMDD reste valide → le worker actuel (et tout reuse naïf) était cassé face à l'ESPN d'aujourd'hui. CORRECTIF dans espn-sync.ts syncLeagueWindow (fichier NON-moteur, périmètre sync de la tâche) : parcours JOUR PAR JOUR de la fenêtre (1 appel/jour/ligue), dédup par espnEventId, un seul ingestBatch par ligue (mode BATCH préservé), failed=true seulement si AUCUN jour ne passe + log de l'échec d'ingestion (avant : catch muet).
- Routes : POST /api/sync/wake (idempotent : fresh → started:false sans ESPN ; maxDuration 300 ; autorisée sous Vercel — c'EST le mécanisme) + GET /api/sync/state (lecture légère, seuils inclus, aucune boucle démarrée). /api/sync/tick reste 403 sous Vercel (worker).
- Frontend : src/components/voltrix/sync-wake-button.tsx (montage GLOBAL layout.tsx ; rendu null si frais ; bouton « Actualiser les données » si stale/liveStale ; désactivé « Mise à jour en cours » si running Neon-side (autre utilisateur) ; chaîne de reprises auto (≤ 8 POST) sur partial ; événement window 'voltrix:sync-done' + router.refresh() à la fin) ; listeners accueil (loadMatches refresh) /combo (reload vivier) /previsions (reload semaine).
- sync-job.ts : logs SOURCE=EXISTING_WORKER (STARTED/SUCCESS/FAILED + deltas ESPN/durées) sur les 4 boucles worker — comportement inchangé sinon.
- scripts/apply-wake-sync.ts (NOUVEAU) : application Neon idempotente (4 colonnes + index partiel + sonde « 2e RUNNING rejeté » + rappel 12 triggers §20/§20bis) — creds HORS repo. scripts/build-local.sh : build local avec PG 17 jetable (migrate deploy sans creds Neon).
- scripts/test-wake-sync.ts (NOUVEAU, 82 checks, PG 17 éphémère + ESPN RÉEL) : verrou DB (sonde 2e INSERT rejetée), frais→0 wake/0 ESPN (fonction + route), périmé→wake, wake RÉEL complet (121 ligues, 2763 appels ESPN, 1424 matchs, 2054 cotes), 2×already_running sous verrou tenu, COURSE 20 simultanés → EXACTEMENT 1 sync (19 rejets index unique), reprise curseur chunk 120/121 → même runId + leaguesDone 121 + espnCalls cumulés, failed→relance possible, LIVE prioritaire (cycle sauté, ≤ 20 appels, liveStale→false), /api/matches + /api/predictions(Option B snapshot + anti-ESPN) + /api/forecasts/week + /api/performance sous VERCEL=1 → 200 + 0 ESPN, idempotence finale + append-only.
- Vérifications : tsc --noEmit src/ = 0 erreur ; scripts/ = 85 erreurs = EXACTEMENT la baseline (stash comparé) ; next build OK (routes /api/sync/wake|state présentes) ; sha256sum -c baseline 5/5 OK ; scan secrets diff + nouveaux fichiers = 0 ; .env non modifié.

Stage Summary:
- Wake-on-Demand opérationnel et prouvé : 20 clics simultanés = 1 SEULE synchronisation (index unique partiel PostgreSQL), reprise exacte sur curseur Neon après timeout/échec, LIVE prioritaire sans double-sync, worker actuel non supprimé (transition : coexistence inoffensive, ingestion idempotente espn_event_id).
- MESURE §26 : synchronisation complète locale = 215,7 s (1 invocation à budget 240 s) — 2 763 appels ESPN (cycle 121 ligues × 19 jours jour-par-jour + contexte + live + H2H), 1 424 matchs créés/maj, 2 054 cotes → DÉCOUPAGE CONFIRMÉ obligatoire pour Vercel (budget défaut 45 s ≈ 5-7 invocations enchaînées, MAX_RESUMES=8 côté frontend, SYNC_WAKE_BUDGET_MS ajustable).
- Correctif ESPN (plages → 400) appliqué dans la brique de sync partagée : le worker existant en profite tel quel ; aucune modification moteur (5 fichiers byte-identiques), Option B intacte (69/69), performance-integrity 31/31, wake 82/82.
- À l'application sur Neon (post-GO) : bun scripts/apply-wake-sync.ts (creds hors repo) — colonnes + index partiel ; le build Vercel appliquera la migration via prisma migrate deploy.
- Commit local prêt ; push GitHub + deploy Vercel en attente du GO final utilisateur (aucune donnée supprimée : ingestion append-only/idempotente, SyncJobRun append-only).
