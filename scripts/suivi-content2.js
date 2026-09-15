// Contenu — chapitres 5 à 7 + annexe A
const { h1, h2, h3, para, bullet, tableCaption, dataTable, callout } = require("./suivi-helpers");

const c5 = [
  h1("5. \u00c9tat actuel de l\u2019application"),
  h2("5.1 Fonctionnalit\u00e9s livr\u00e9es et op\u00e9rationnelles"),
  para("L\u2019application couvre le parcours complet du parieur simul\u00e9 : consultation des matchs du jour sur 97 ligues ESPN, analyse d\u00e9taill\u00e9e par rencontre avec cotes et onglets de pronostics, g\u00e9n\u00e9ration de combin\u00e9s \u00e0 objectif de cote avec crit\u00e8res de triage et remplacement de jambes, \u00e9valuation de l\u2019offre de rachat d\u2019un coupon en cours, puis bilan dans les pages Pr\u00e9cision et Portefeuille. L\u2019exp\u00e9rience est installable en PWA, fonctionne en mode d\u00e9grad\u00e9 lisible en cas d\u2019erreur r\u00e9seau, et b\u00e9n\u00e9ficie d\u2019un cache de session qui rend instantan\u00e9 le retour sur l\u2019accueil. La barre de navigation Liquid Glass, le th\u00e8me noir et jaune \u00e9lectrique et la typographie sp\u00e9cifique constituent l\u2019identit\u00e9 visuelle valid\u00e9e par l\u2019utilisateur."),
  para("C\u00f4t\u00e9 serveur, les quatre routes publiques sensibles sont prot\u00e9g\u00e9es par le limiteur de d\u00e9bit maison (60 requ\u00eates par minute sur les matchs, 20 sur la g\u00e9n\u00e9ration de pronostics, 30 sur la performance, 15 sur le cash-out), la concurrence du cash-out est plafonn\u00e9e \u00e0 quatre requ\u00eates simultan\u00e9es, et tous les caches serveur sont born\u00e9s (LRU, dur\u00e9e de vie, balayage). L\u2019API de performance parcourt d\u00e9sormais l\u2019historique int\u00e9gral par pagination curseur et publie les statistiques \u00e9conomiques s\u00e9par\u00e9es des indicateurs pr\u00e9dictifs, y compris par version de mod\u00e8le."),
  h2("5.2 Garanties d\u2019ing\u00e9nierie en place"),
  para("Les garanties suivantes sont actives dans le code livr\u00e9 et couvertes par les suites de tests. Le filtre de journ\u00e9e UTC r\u00e9git le p\u00e9rim\u00e8tre des matchs ; la cote d\u2019un combin\u00e9 est le produit exact de ses jambes ; la calibration des totaux est une \u00e9tape unique et officielle du moteur, partag\u00e9e par tous les \u00e9crans ; le calcul de value s\u2019appuie sur les probabilit\u00e9s brutes tandis que l\u2019affichage utilise les calibr\u00e9es ; les colonnes de persistance ajout\u00e9es depuis la Task 21 sont strictement additives et leurs champs d\u2019audit (horodatage de g\u00e9n\u00e9ration, version du mod\u00e8le, probabilit\u00e9 brute, empreinte d\u2019entr\u00e9es) sont fig\u00e9s \u00e0 la cr\u00e9ation et jamais r\u00e9\u00e9crits. Enfin, aucune variable pr\u00e9dictive nouvelle n\u2019a \u00e9t\u00e9 introduite depuis la version 2.1 : l\u2019ablation contextMode est un instrument de mesure dont le d\u00e9faut reproduit bit \u00e0 bit le comportement livr\u00e9."),
  h2("5.3 Suites de tests et base de donn\u00e9es"),
  para("Le projet s\u2019appuie sur une douzaine de suites de tests autonomes (scripts Bun sans d\u00e9pendance r\u00e9seau pour la majorit\u00e9), totalisant plus de trois cents v\u00e9rifications. Le tableau 5 en donne l\u2019inventaire avec leur score \u00e0 la derni\u00e8re ex\u00e9cution. La base SQLite contient 2\u00a0850 pronostics ; les lignes ant\u00e9rieures \u00e0 l\u2019introduction du versionnage portent une version nulle et forment une cohorte \u00ab legacy \u00bb d\u00e9lib\u00e9r\u00e9ment conserv\u00e9e sans r\u00e9\u00e9tiquetage, s\u00e9par\u00e9e des statistiques de la version 2.1 dans l\u2019API."),
  tableCaption("Suites de tests du projet et dernier score d\u2019ex\u00e9cution"),
  dataTable({
    headers: ["Suite", "P\u00e9rim\u00e8tre v\u00e9rifi\u00e9", "Score"],
    widths: [34, 52, 14],
    rows: [
      ["test-combo", "G\u00e9n\u00e9ration de combin\u00e9s, objectifs de cote, s\u00e9curit\u00e9s", "76 / 76"],
      ["test-same-match-swap", "Remplacement de jambes, produit exact des cotes", "46 / 46"],
      ["test-consistency", "Coh\u00e9rence inter-\u00e9crans du moteur (une seule v\u00e9rit\u00e9)", "31 / 31"],
      ["test-performance-integrity", "S\u00e9paration pr\u00e9dictif / \u00e9conomique, ROI sans fallback", "31 / 31"],
      ["test-void", "Classement VOID des matchs annul\u00e9s ou report\u00e9s", "36 / 36"],
      ["test-rate-limit", "Limiteur de d\u00e9bit, 429 et Retry-After (test E2E)", "18 / 18"],
      ["test-cashout-concurrency", "Bornage \u00e0 4 requ\u00eates simultan\u00e9es du cash-out", "10 / 10"],
      ["test-ablation", "Instrument contextMode, bit-identicit\u00e9 du mode full", "27 / 27"],
      ["test-anti-leak", "Anti-fuite du backtest, invariance au futur", "28 / 28"],
      ["test-prediction-immutability", "Immuabilit\u00e9 des colonnes d\u2019audit v2.1", "40 / 40"],
      ["test-engine-fix", "Correctifs cibl\u00e9s du moteur (calibration, consensus)", "3 / 3"],
      ["test-predictions-persist", "Persistence des pronostics via l\u2019API", "5 / 5"],
    ],
  }),
  para("Une r\u00e9serve d\u2019exploitation doit \u00eatre document\u00e9e en toute transparence : le client Prisma r\u00e9sident dans le serveur de d\u00e9veloppement de longue date ne conna\u00eet pas encore les quatre colonnes ajout\u00e9es par la Task 22 et fonctionne en repli gracieux (colonnes ignor\u00e9es \u00e0 l\u2019\u00e9criture, indicateur de support expos\u00e9 dans l\u2019API). Conform\u00e9ment \u00e0 la convention du projet qui interdit le red\u00e9marrage \u00e0 chaud, ce client sera recharg\u00e9 au prochain arr\u00eat et red\u00e9marrage planifi\u00e9 du serveur ; la cohorte \u00ab legacy \u00bb cessera alors de s\u2019allonger et la version 2.1 commencera \u00e0 s\u2019\u00e9crire en production. Ce point figure en t\u00eate de la feuille de route."),
];

const c6 = [
  h1("6. Ce qui reste \u00e0 faire \u2014 feuille de route"),
  h2("6.1 Priorit\u00e9 0 : activer la persistance versionn\u00e9e"),
  para("La premi\u00e8re action consiste \u00e0 recharger le client Prisma du serveur de d\u00e9veloppement lors du prochain red\u00e9marrage planifi\u00e9, afin que les \u00e9critures alimentent r\u00e9ellement predictionTime, modelVersion, rawProbability et inputsDigest. Tant que ce rechargement n\u2019a pas eu lieu, chaque nouvelle pr\u00e9diction rejoint la cohorte \u00ab legacy \u00bb et la mesure par version reste vide en production, m\u00eame si l\u2019infrastructure est pr\u00eate et test\u00e9e. Il conviendra ensuite de v\u00e9rifier quelques jours durant que modelVersion vaut bien 2.1 sur les nouvelles lignes, puis d\u2019exposer la ventilation par version dans l\u2019interface de la page Pr\u00e9cision, l\u2019API la fournissant d\u00e9j\u00e0."),
  h2("6.2 Priorit\u00e9 1 : \u00e9laguer le mod\u00e8le \u00e0 partir de la mesure"),
  para("La deuxi\u00e8me priorit\u00e9 exploite les instruments livr\u00e9s. L\u2019ablation du contexte doit \u00eatre conduite march\u00e9 par march\u00e9, en commen\u00e7ant par le BTTS o\u00f9 la d\u00e9gradation est \u00e9tablie : comparer le mode \u00ab mix \u00bb au mode \u00ab full \u00bb pli par pli, puis neutraliser un \u00e0 un fatigue, blessures et derby pour d\u00e9signer le ou les coupables, conform\u00e9ment \u00e0 l\u2019\u00e9tape 11 du plan qui pr\u00e9voit un retrait \u2014 et non un ajout \u2014 de variables. Dans le m\u00eame mouvement, l\u2019\u00e9chantillon de validation doit \u00eatre \u00e9largi : plis suppl\u00e9mentaires (mois restants et saisons pass\u00e9es), ligues additionnelles du catalogue, y compris celles en ann\u00e9e calendaire d\u00e9j\u00e0 correctement g\u00e9r\u00e9es, et stratification des r\u00e9sultats par niveau de confiance \u00e0 \u00e9toiles pour v\u00e9rifier si la hi\u00e9rarchie annonc\u00e9e par le mod\u00e8le se mat\u00e9rialise. Enfin, la question des param\u00e8tres de ligues (league-params.ts, actuellement inactifs) sera r\u00e9\u00e9valu\u00e9e sur cette base \u00e9largie, avec un crit\u00e8re de sortie strict : am\u00e9lioration simultan\u00e9e du Brier 1X2 et de l\u2019O/U, sinon le fichier reste hors production."),
  h2("6.3 Priorit\u00e9 2 : mesurer l\u2019avantage r\u00e9el et pr\u00e9parer la suite"),
  para("Troisi\u00e8me priorit\u00e9, la mesure continue. Les cotes de cl\u00f4ture sont captur\u00e9es \u00e0 la r\u00e9solution depuis la Task 21 : une fois l\u2019\u00e9chantillon de paris avec cote d\u2019ouverture et de cl\u00f4ture suffisamment fourni, le suivi du closing line value dira objectivement si les s\u00e9lections du mod\u00e8le battent la ligne de cl\u00f4ture \u2014 le test de comp\u00e9tence le plus reconnu en pr\u00e9diction sportive. Parall\u00e8lement, le suivi du Brier par version rendra visible tout gain ou r\u00e9gression apport\u00e9 par une future version 2.2. Les am\u00e9liorations techniques restantes sont volontairement secondaires : elles n\u2019ont de sens qu\u2019apr\u00e8s que la mesure aura d\u00e9sign\u00e9 les axes rentables."),
  h2("6.4 R\u00e8gles de d\u00e9cision pour la version 3"),
  para("Le plan de r\u00e9solution fourni par l\u2019utilisateur fixe un cadre que ce dossier reprend \u00e0 son compte : aucune complexification du moteur tant qu\u2019aucune am\u00e9lioration reproductible hors \u00e9chantillon n\u2019est d\u00e9montr\u00e9e ; privil\u00e9gier le retrait de variables au rajout ; documenter toute exception. Les chantiers \u00e9voqu\u00e9s pour la version 3 \u2014 mod\u00e8les de xG, march\u00e9s d\u00e9riv\u00e9s, personnalisation \u2014 restent donc en attente derri\u00e8re la porte de la validation. Le tableau 6 synth\u00e9tise la feuille de route avec les crit\u00e8res de sortie de chaque action."),
  tableCaption("Feuille de route synth\u00e9tique et crit\u00e8res de sortie"),
  dataTable({
    headers: ["Priorit\u00e9", "Action", "Crit\u00e8re de sortie", "Statut"],
    widths: [12, 40, 34, 14],
    rows: [
      ["P0", "Recharger le client Prisma au prochain red\u00e9marrage planifi\u00e9", "modelVersion = 2.1 \u00e9crite sur les nouvelles lignes", "\u00c0 faire"],
      ["P0", "V\u00e9rifier la cohorte versionn\u00e9e quelques jours", "byVersion renseign\u00e9 dans /api/performance", "\u00c0 faire"],
      ["P1", "Ablation BTTS par modificateur (fatigue, blessures, derby)", "Coupables d\u00e9sign\u00e9s, retrait d\u00e9cid\u00e9 et test\u00e9", "\u00c0 faire"],
      ["P1", "\u00c9largir les plis et ligues du backtest V3", "Plus de 2\u00a0000 matchs, conclusion inchang\u00e9e ou r\u00e9vis\u00e9e", "\u00c0 faire"],
      ["P1", "Stratifier les r\u00e9sultats par \u00e9toiles de confiance", "Hi\u00e9rarchie de confiance valid\u00e9e ou invalid\u00e9e", "\u00c0 faire"],
      ["P2", "R\u00e9\u00e9valuer league-params sur l\u2019\u00e9chantillon \u00e9largi", "Brier 1X2 et O/U am\u00e9lior\u00e9s ensemble, sinon hors prod", "En attente"],
      ["P2", "Mettre en place le suivi du closing line value", "CLV positif et significatif, ou abandon de l\u2019hypoth\u00e8se", "En attente"],
      ["P2", "Exposer byVersion et la calibration dans la page Pr\u00e9cision", "Interface publi\u00e9e, tests de non-r\u00e9gression verts", "\u00c0 faire"],
    ],
  }),
  h2("6.5 \u00c9carts connus et limites document\u00e9es"),
  para("Pour une lecture sans surprise, les limites suivantes sont assum\u00e9es et trac\u00e9es. Dans le backtest, les blessures sont neutralis\u00e9es et les cotes d\u2019ouverture servent de proxy de march\u00e9 \u00e0 l\u2019instant T, la cl\u00f4ture \u00e9tant interdite en entr\u00e9e ; le mod\u00e8le backtest est donc l\u00e9g\u00e8rement plus pauvre que le moteur en production. Les anciens tickets stock\u00e9s c\u00f4t\u00e9 client avant les correctifs peuvent conserver des valeurs d\u00e9pass\u00e9es, sans effet sur les calculs nouveaux. Le limiteur de d\u00e9bit de la route de g\u00e9n\u00e9ration (20 requ\u00eates par minute) impose d\u2019espacer les scripts de charge, comme l\u2019a montr\u00e9 l\u2019incident du test lambda-bias r\u00e9solu par ex\u00e9cution \u00e9tal\u00e9e. Enfin, le sandbox d\u2019ex\u00e9cution interrompt les traitements en arri\u00e8re-plan de longue dur\u00e9e : les backtests s\u2019ex\u00e9cutent pli par pli en avant-plan, ce qui est document\u00e9 dans le harnais."),
];

const c7 = [
  h1("7. Conclusion"),
  para("En douze jours, VOLTRIX bet est pass\u00e9 d\u2019un prototype \u00e0 un produit complet, robuste et surtout instrument\u00e9 : la cha\u00eene qui va de la donn\u00e9e ESPN au pronostic horodat\u00e9, puis au r\u00e9sultat mesur\u00e9 sans biais, existe et est test\u00e9e de bout en bout. Les audits ont \u00e9t\u00e9 trait\u00e9s jusqu\u2019au bout, les d\u00e9fauts majeurs ont \u00e9t\u00e9 corrig\u00e9s avec des preuves, et le code livr\u00e9 dans l\u2019archive accompagnant ce dossier refl\u00e8te exactement cet \u00e9tat."),
  para("La v\u00e9rit\u00e9 statistique, elle, est plus s\u00e8ve et doit \u00eatre dite telle quelle : le mod\u00e8le ne bat pas le march\u00e9 aujourd\u2019hui, le signal O/U de la premi\u00e8re mesure \u00e9tait un artefact, et les couches contextuelles nuisent au march\u00e9 BTTS. Ce constat n\u2019est pas un \u00e9chec mais le point de d\u00e9part sain que le projet n\u2019avait jamais eu : pour la premi\u00e8re fois, chaque futur changement pourra \u00eatre jug\u00e9 sur un protocole sans fuite, avec intervalles de confiance et par version. La feuille de route du chapitre 6 en d\u00e9coule m\u00e9caniquement : recharger la persistance versionn\u00e9e, r\u00e9aliser l\u2019ablation du contexte sur le BTTS, \u00e9largir les plis de validation, puis \u2014 seulement si les preuves s\u2019accumulent \u2014 r\u00e9\u00e9valuer les param\u00e8tres de ligues et envisager la moindre complexification. L\u2019avantage pr\u00e9dictif, s\u2019il existe, devra se montrer hors \u00e9chantillon ; tout le dispositif est d\u00e9sormais en place pour le savoir rapidement."),
];

const annexe = [
  h1("Annexe A. Inventaire des livrables et des fichiers cl\u00e9s"),
  para("L\u2019archive du code source livr\u00e9e avec ce dossier (voltrix-bet-source-2026-09-13-v2.zip, 188 fichiers) contient les r\u00e9pertoires src, prisma, scripts, tests et public ainsi que les fichiers de configuration racine ; elle exclut volontairement les d\u00e9pendances, la base de donn\u00e9es d\u2019exploitation et les artefacts de g\u00e9n\u00e9ration. Les livrables de mesure et de documentation produits au fil du projet sont r\u00e9unis dans le tableau 7, et le tableau 8 d\u00e9crit les fichiers du code dont la connaissance est indispensable pour reprendre le projet."),
  tableCaption("Livrables du projet disponibles au t\u00e9l\u00e9chargement"),
  dataTable({
    headers: ["Livrable", "Contenu"],
    widths: [42, 58],
    rows: [
      ["voltrix-bet-source-2026-09-13-v2.zip", "Code source complet \u00e0 la date du 13 septembre 2026 (Tasks 1 \u00e0 22)"],
      ["VOLTRIX-bet-Dossier-technique.pdf", "Dossier technique de 23 pages, guide \u00e9cran par \u00e9cran (Task 20)"],
      ["VOLTRIX-bet-Dossier-de-suivi-projet.docx", "Le pr\u00e9sent document de suivi"],
      ["backtest-results.json", "R\u00e9sultats du backtest V2 en marche avant (n = 250, 10 ligues)"],
      ["backtest-v3-replay-results.json", "R\u00e9sultats pool\u00e9s du backtest V3 (7 plis, 459 matchs)"],
      ["backtest-runs/POOL-2026-v3/", "Donn\u00e9es brutes des 7 plis mensuels et scripts de relecture (--replay)"],
    ],
  }),
  tableCaption("Fichiers cl\u00e9s du code source"),
  dataTable({
    headers: ["Fichier", "R\u00f4le"],
    widths: [38, 62],
    rows: [
      ["src/lib/prediction.ts", "Moteur de pr\u00e9diction : Poisson, Elo, forme, contexte, consensus, contextMode"],
      ["src/lib/market-odds.ts", "March\u00e9s d\u00e9riv\u00e9s, calibration des totaux, formule ferm\u00e9e BTTS"],
      ["src/lib/analyze.ts", "Extraction des s\u00e9lections, empreinte des entr\u00e9es, statistiques de performance"],
      ["src/lib/grade.ts", "R\u00e8glement des pronostics, classement VOID"],
      ["src/lib/rate-limit.ts", "Limiteur de d\u00e9bit m\u00e9moire (fen\u00eatre glissante, LRU, balayage)"],
      ["src/lib/cache.ts", "Caches serveur born\u00e9s (LRU, TTL, balayage, concurrence)"],
      ["src/lib/model-version.ts", "Constante MODEL_VERSION (v2.1) fig\u00e9e \u00e0 la cr\u00e9ation des lignes"],
      ["src/lib/league-params.ts", "Param\u00e8tres de ligues empiriques, g\u00e9n\u00e9r\u00e9s et non activ\u00e9s"],
      ["scripts/backtest.ts / backtest-lib.ts", "Harnais de backtest V3 : plis, horizons T \u2212 Xh, anti-fuite, bootstrap"],
      ["scripts/test-*.ts", "Douze suites de tests autonomes (voir tableau 5)"],
    ],
  }),
  para("Pour toute reprise du projet, l\u2019ordre de lecture recommand\u00e9 est le suivant : le pr\u00e9sent dossier pour l\u2019\u00e9tat et les d\u00e9cisions, le dossier technique PDF pour l\u2019architecture et les \u00e9crans, puis les tests du r\u00e9pertoire scripts qui servent de sp\u00e9cification ex\u00e9cutable du comportement attendu du moteur et de la cha\u00eene de mesure."),
];

module.exports = { c5, c6, c7, annexe };
