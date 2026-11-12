# VOLTRIX

VOLTRIX est une application mobile-first de pronostics football et MMA (UFC), développée avec Next.js et TypeScript. Les pronostics des 7 prochains jours sont pré-calculés par un job serveur et servis depuis une base PostgreSQL (Neon) : l'utilisateur obtient matchs, combats et probabilités en une requête, sans calcul moteur dans son navigateur. Les données proviennent des endpoints publics d'ESPN. Règle du projet : aucune donnée inventée — une information absente est affichée « — », ou le pronostic est refusé.

## Fonctionnalités principales

### Accueil unifié (`src/components/voltrix/HomeScreen.tsx`)
- Football et MMA sur une même page, avec données 100 % réelles (ESPN).
- Sélecteur de date sur 7 jours (de J-2 à J+4) et filtres par ligue / par événement MMA.
- Scan progressif par vagues de priorité : top ligues d'abord, puis divisions secondaires, puis compétitions exotiques (140 compétitions au catalogue, 4 requêtes ESPN simultanées au maximum).
- Pronostics express football calculés en arrière-plan (jusqu'à 24 matchs à venir) puis conservés en base locale : à la réouverture de l'app, ils sont restaurés sans aucun recalcul tant que leur TTL est valide.
- Tirer-pour-rafraîchir, en-tête repliable au défilement, section MMA du jour (cartes UFC, combats perspectifs à adversaire non confirmé) et rappel du prochain événement quand aucun combat n'est programmé à la date choisie.

### Fiche match football (`src/components/voltrix/MatchScreen.tsx`)
Onglets Synthèse / Marchés / H2H / Contexte :
- Synthèse : favori et probabilités 1X2, buts attendus (lambda), scores exacts les plus probables, premier but (minute attendue, fenêtres temporelles, équipe marquant en premier, risque de 0-0), et détail du calcul avec les trois composantes du moteur (Poisson / Elo / forme).
- Marchés : value bets avec edge et part de Kelly, plus/moins 1.5 / 2.5 / 3.5, les deux équipes marquent (BTTS), distribution du total de buts issue de la grille Poisson bivariée et contrôlée par Monte Carlo (écart exact/simulation publié), cotes open/close du bookmaker quand ESPN les publie.
- H2H : confrontations directes reconstituées depuis les calendriers ESPN des deux équipes (2 saisons).
- Contexte : enjeux au classement, météo du match, blessures et fatigue, profils des équipes, stade.

### Fiche combat MMA (`src/components/voltrix/MmaFightScreen.tsx`)
Onglets Synthèse / Méthode / Rounds / Combattants / H2H :
- Synthèse : favori (probabilités bornées 25-75 %), méthode clé, rounds attendus, facteurs clés et points de vigilance, dimension par dimension.
- Méthode : répartition des victoires par KO/TKO, soumission ou décision (palmarès ESPN, repli honnête sur les stats de carrière avec libellé distinct).
- Rounds : cartographie des rounds de fin (probabilité par round, passage en décision), calculée sur les rounds de fin réels des deux combattants et un prior UFC documenté ; s'enrichit en arrière-plan à l'ouverture de la fiche.
- Combattants : palmarès et statistiques de carrière ; H2H : historique des confrontations.

### Réglages (`src/components/voltrix/SettingsScreen.tsx`)
- Statistiques du cache local (nombre d'entrées, taille approximative, répartition par hôte) et purge complète.
- Vérification du modèle MMA dans le navigateur : le pronostic voltrix-mma-v1 est recalculé sur des combats UFC terminés récents et confronté aux vrais vainqueurs, résultat publié tel quel, y compris s'il est défavorable.
- Versions des moteurs, sources de données et rappel des engagements (aucune donnée inventée, probabilités bornées, aucune cote éditée).

La navigation (`src/components/voltrix/VoltrixApp.tsx`) fonctionne par pile d'écrans : l'écran d'onglet reste monté sous les fiches détaillées, pour un retour instantané qui conserve date, filtres, listes, pronos et position de défilement.

## Moteurs

### Football — `voltrix-foot-v2.2` (`src/lib/foot/prediction.ts`, `montecarlo.ts`, `league-params.ts`)
- Ensemble final : Poisson bivarié 40 % + Elo 35 % + forme 25 %.
- Poisson bivarié (modèle de Karlis-Ntzoufras) avec composante partagée lambda3 = rho x racine(lambdaD x lambdaE), rho = 0,10 : tous les marchés de buts (1X2, plus/moins, BTTS, scores exacts, double chance, victoire sans encaisser) sortent d'une grille conjointe exacte, sans bruit d'échantillonnage.
- Monte Carlo de contrôle : 10 000 simulations par match, RNG déterministe seedé sur les paramètres du match (deux rendus du même match produisent les mêmes nombres) ; l'écart maximal entre grille exacte et simulation est publié dans l'interface.
- Elo local : K = 10, avantage domicile +110 points, part de nul décroissante avec l'écart (base 0,36, pente 0,7).
- Forme : 6 derniers matchs pondérés par récence (demi-vie d'environ 3 matchs), part de nul base 0,32 / pente 0,6.
- 20 championnats paramétrés par leurs moyennes de buts réelles domicile/extérieur (saison 2025-26, source football-data.co.uk), repli global 1,52 / 1,22 pour les ligues non couvertes.
- Constantes recalibrées par backtest le 11 novembre 2026 : fatigue neutralisée (facteur 1,0, aucun gain mesuré), derbys x 0,88, bornes lambda [0,25 ; 4,4] à domicile et [0,20 ; 4,0] à l'extérieur.
- Value bets : edge minimal 5 %, cote plafonnée à 2,50, mise de Kelly plafonnée à 10 %.

### MMA — `voltrix-mma-v1` (`src/lib/mma/prediction.ts`)
- 12 dimensions pondérées, comparées par indices relatifs 0-100, agrégées puis transformées par une fonction logistique (pente 2,6).
- Poids publics, affichés dans l'interface : forme 1,5 ; volume, précision, absorption 1,2 ; défense-frappes, lutte, défense-takedown, puissance 1,0 ; sol 0,8 ; expérience 0,8 ; frappes au sol 0,6 ; physique 0,6.
- Probabilités volontairement bornées entre 25 % et 75 % ; pronostic refusé si moins de 3 dimensions comparables sont disponibles.
- Aucune cote éditée, aucun conseil de paris : le moteur produit une lecture statistique des données observées.

## Performance honnête

Tous les chiffres de cette section sont extraits des fichiers de résultats du dépôt ; aucun n'est estimé.

### Football (`download/backtest-foot/constantes-optimisees.json`)

Backtest sur 37 715 matchs (football-data.co.uk, 6 ligues, 2010-2026), split temporel train 2010-22 / validation 2022-24 / test 2024-26. Métriques 1X2 sur la fenêtre de test :

| Variante | Précision | Log-loss | Brier | RPS | Nuls prédits |
|---|---|---|---|---|---|
| Moteur avant recalibration (as-built) | 50,09 % | 1,0166 | 0,6082 | 0,2084 | 23,09 % |
| Constantes v2.2 appliquées dans l'app | 50,13 % | 1,0110 | 0,6053 | 0,2076 | 25,20 % |
| Cotes de clôture Bet365 (référence marché) | 51,87 % | 0,9873 | 0,5891 | 0,2001 | 25,26 % |

En validation (2022-24), le moteur recalibré atteint 50,75 % de précision et un log-loss de 1,0049. La piste « Elo global » (non appliquée : l'API scoreboard ESPN ne supporte pas les plages de dates) donnerait un log-loss test de 1,0053 contre 1,0110. Le marché (cotes de clôture) reste meilleur que le modèle sur la fenêtre de test ; l'app affiche cette réalité plutôt que de la masquer.

Value bets, simulation backtest 1X2 sur la fenêtre de test, mise plate de 1 unité (documentée dans `src/lib/foot/league-params.ts`) :
- edge >= 2 % (ancienne règle) : ROI -12,8 % sur 3 913 paris ;
- edge >= 5 % : ROI -11,9 % sur 3 108 paris ;
- edge >= 5 % + cote <= 2,5 (règle retenue dans l'app) : ROI -3,7 % sur 766 paris.

Le ROI documenté des value bets est donc négatif : le filtre retenu réduit les pertes, il ne les élimine pas.

### MMA (`download/backtest-mma/resultats-complets.json`)

Rejeu anti-fuite sur 7 704 combats UFC 1998-2026 (dataset DanMcInerney/mma-ai : stats brutes ufcstats, cotes BestFightOdds), passes chronologiques avec instantanés strictement antérieurs à chaque combat, cotes utilisées uniquement comme baseline :

| Fenêtre | Combats | Précision | Brier | Log-loss |
|---|---|---|---|---|
| Train (< 2023) | 4 449 | 55,99 % | 0,2458 | 0,6849 |
| Validation (2023-24) | 670 | 55,82 % | 0,2474 | 0,6881 |
| Test (2025-26) | 563 | 56,48 % | 0,2466 | 0,6863 |
| Depuis 2010 | 5 053 | 55,75 % | 0,2467 | 0,6867 |
| Marché (cotes, test 2025-26) | 498 | 71,29 % | 0,1887 | 0,5584 |

Autres résultats publiés : le modèle n'émet un pronostic que sur 5 682 des 7 561 combats décidés (1 879 refusés pour données insuffisantes) ; sur les 1 949 combats où il contredit le marché (sur 5 015 combats avec cotes), il a raison dans 36,69 % des cas ; la prédiction de la méthode de victoire (KO/TKO, soumission, décision) est exacte dans 45,72 % des cas sur 3 086 combats. La seule dimension d'enrichissement validée (frappes au sol, testée dans `enrich_results.json`) est neutre en validation et gagne de 0,5 à 1,2 point en test ; les autres candidates ont été écartées faute de gain au-delà du bruit.

Un pronostic sportif reste un estimé probabiliste : cette application ne garantit aucun gain.

## Architecture — pré-calcul serveur + repli local

Depuis l'architecture n°6, le parcours de données est le suivant :

1. **Job de pré-calcul** (`.github/workflows/precompute.yml`, 4 passages par jour) : un runner GitHub Actions exécute `scripts/precompute/run.ts` — le MÊME code moteur TypeScript que l'app — sur les matchs et combats des 7 prochains jours, puis écrit chaque fiche et ses pronostics dans la base PostgreSQL Neon (table `Fixture` : `data` + `predQuick` + `predFull`). Le job est incrémental : une ligne déjà calculée (même version de moteur, statut inchangé) n'est que rafraîchie.
2. **Lecture app** : l'accueil appelle `GET /api/fixtures?date=…` (une requête) et affiche instantanément matchs + combats + pronostics ; les écrans de détail lisent `GET /api/fixtures/[id]`. Aucune écriture n'est exposée au client.
3. **Repli local** : si l'API est injoignable (réseau, base endormie, ligne périmée — match à venir dont le coup d'envoi est déjà passé), l'app retombe sur le moteur navigateur historique et ses caches localStorage/IndexedDB. Le jour J, un scan ESPN en arrière-plan rafraîchit les scores sous l'affichage déjà présent.

Sécurité : la clé de connexion Neon vit uniquement dans les variables d'environnement serveur (`DATABASE_URL`, `DIRECT_DATABASE_URL` — jamais de préfixe `NEXT_PUBLIC_`), injectées par Vercel et GitHub Actions Secrets.

## Sources de données

- ESPN, appelé directement depuis le navigateur (CORS ouvert, aucune clé) : `site.api.espn.com` pour les scoreboards, calendriers d'équipes, classements, blessés et résumés de match ; `sports.core.api.espn.com` pour les compétitions, athlètes, statistiques et palmarès MMA. Les requêtes sont limitées à 4 simultanées, avec relances polies en cas de bridage du CDN.
- Relai même-origine optionnel `/api/espn` (`src/app/api/espn/[...path]/route.ts`) : utilisé uniquement si les variables `NEXT_PUBLIC_ESPN_*_BASE` y pointent, pour les réseaux verrouillés ou les environnements de test ; il impose un User-Agent accepté par ESPN et transmet les statuts d'erreur tels quels (une donnée absente n'est jamais fabriquée).
- Météo : open-meteo (géocodage + prévisions, gratuit, sans clé), intégrée dans `src/lib/foot/espn.ts`.
- Backtests : CSV football-data.co.uk (football) ; dataset DanMcInerney/mma-ai (MMA).
- Cadre d'usage personnel et non commercial pour les endpoints ESPN (conditions Disney/ESPN).
- Caches locaux avec TTL, stockés dans localStorage et IndexedDB (repli localStorage si IndexedDB est absent) :
  - football : scoreboards 10 min (60 s le jour du match), calendriers et classements 3 h, blessés 6 h, analyses 30 min avant le match / 10 min en direct / 6 h après le coup d'envoi, pronos express 15 min (10 min en direct, 6 h une fois terminé) ;
  - MMA : scoreboards 10 min, compétitions et statistiques de combat 1 h, statistiques de carrière 12 h, fiches et historiques de combattants 24 h, prior de rounds UFC 7 jours.

## Backtests reproductibles

### Football — `scripts/backtest/` (Python)
`download_data.py` télécharge les CSV football-data.co.uk (6 championnats cœur de 2009-10 à 2025-26, ligues annexes sur les 3 dernières saisons). `voltrix_foot.py` réplique le moteur TypeScript à l'identique (fenêtre de données, Elo local, shrinkage, modificateurs, grille bivariée) et rejoue chaque match avec les seules informations antérieures à sa date. `optimize.py` / `optimize2.py` recherchent les constantes optimales sur le split temporel train / validation / test. `make_charts.py` et `generate_report.py` publient le rapport dans `download/backtest-foot/` (constantes optimisées, CSV du jeu de test, graphiques, PDF).

### MMA — `scripts/backtest-mma/` (Node)
`extract.sql` et `fights.jsonl` portent l'extraction du dataset (7 704 combats UFC). `replay.mjs` porte fidèlement le moteur voltrix-mma-v1 et le rejoue en passes chronologiques anti-fuite : stats « carrière » et « 8 derniers combats » prises strictement avant chaque combat, cotes jamais utilisées comme features. `enrich.mjs` et `enrich_career.mjs` testent des dimensions candidates (`enrich_results.json`, `enrich_career_results.json`). `make_charts.py` et `generate_report.py` publient le rapport dans `download/backtest-mma/` (résultats complets, graphiques, PDF).

## Démarrage

```bash
bun install        # ou npm install (bun.lock et package-lock.json sont fournis)
bun run dev        # développement sur http://localhost:3000
bun run build      # build standalone (next build + copie des statiques)
bun run start      # NODE_ENV=production bun .next/standalone/server.js
bun run lint       # eslint
```

Le dépôt n'impose aucune version de Node (pas de champ `engines` ni de `.nvmrc`) ; le script `start` exécute le serveur standalone via bun. Le fichier `.env.example` documente les deux variables serveur de la base Neon (`DATABASE_URL` pour le runtime, `DIRECT_DATABASE_URL` pour les migrations) : sans ces variables, les routes `/api/fixtures` répondent en erreur et l'app bascule sur le moteur navigateur. Des scripts `db:*` (Prisma) sont également définis dans `package.json`. Le job de pré-calcul se lance aussi à la main :

```bash
DATABASE_URL=… DIRECT_DATABASE_URL=… bun scripts/precompute/run.ts
```

## Structure du projet

```
src/
  components/voltrix/   Interface mobile VOLTRIX : VoltrixApp (navigation), HomeScreen,
                        MatchScreen, MmaFightScreen, SettingsScreen, TeamBadge,
                        FighterHead, ui-bits
  components/ui/        Composants de base du gabarit (shadcn/ui)
  lib/foot/             Moteur football : prediction.ts, montecarlo.ts, league-params.ts,
                        analyze.ts, espn.ts, leagues.ts (catalogue de 140 compétitions),
                        first-goal.ts, market-odds.ts, bets-ledger.ts, bridge.ts
  lib/mma/              Moteur MMA : prediction.ts (voltrix-mma-v1), analysis.ts
                        (dimensions), rounds.ts, espn.ts (transport ESPN partagé),
                        loaders.ts, types.ts
  lib/                  Caches locaux : persist.ts (localStorage avec TTL),
                        pred-db.ts (IndexedDB des pronostics) ; ponts et types partagés
  app/                  Page unique (Next.js App Router) + API /api/fixtures (lecture
                        base de pré-calcul) + relai optionnel /api/espn
scripts/
  precompute/           Job de pré-calcul serveur (football + MMA, 7 jours, Neon)
  backtest/             Backtest football (Python, données football-data.co.uk)
  backtest-mma/         Rejeu anti-fuite UFC (Node)
download/
  backtest-foot/        Rapport football : constantes-optimisees.json, CSV du jeu de
                        test, graphiques, PDF
  backtest-mma/         Rapport MMA : resultats-complets.json, enrich_results.json,
                        enrich_career_results.json, CSV, graphiques, PDF
public/                 Logos d'équipes, photos de stades et d'arènes, icônes PWA
```

## Avertissement

VOLTRIX est un outil informatif et éducatif de lecture statistique de données sportives publiques. Il ne constitue pas un conseil financier ou d'investissement. L'application n'édite aucune cote et ne promeut aucune plateforme de paris. Parier comporte des risques : jouez de manière responsable et ne misez jamais plus que ce que vous pouvez vous permettre de perdre.
