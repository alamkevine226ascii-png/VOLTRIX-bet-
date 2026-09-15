
# ── Sommaire ─────────────────────────────────────────────────────────────
toc = TableOfContents()
toc.levelStyles = [toc0, toc1]
story.append(Paragraph('<b>Sommaire</b>', toc_title_s))
story.append(toc)
story.append(PageBreak())

# ═══════════════════════ CHAPITRE 1 ═══════════════════════
h1(story, '1. VOLTRIX bet : présentation', P(
    'VOLTRIX bet est une application web mobile-first d\'aide à la décision pour les pronostics '
    'football, écrite en français et conçue autour d\'un principe simple : afficher uniquement des '
    'probabilités calibrées et des cotes réellement obtenables. L\'application ne gère aucun argent '
    'et ne prend aucun pari : elle scanne chaque jour les matchs, calcule des probabilités de '
    'résultat par un modèle statistique propriétaire, puis transforme ces probabilités en outils '
    'concrets — un combinateur de paris avec cote cible et un conseiller de revente de coupon '
    'de type cash-out. L\'interface adopte un thème sombre premium (fond noir, accent volt '
    '#e8ff00) pensé pour un usage sur téléphone, et s\'installe comme PWA directement depuis le '
    'navigateur.', lead_s), body_start=True)

story.append(P(
    'Le produit s\'articule autour de quatre écrans complémentaires. L\'accueil présente les matchs '
    'du jour (filtrés strictement sur le jour calendaire UTC), enrichis d\'une analyse immédiate : '
    'pronostic principal, niveau de confiance et cotes du marché. Le Combinator construit des '
    'combinés optimaux à partir d\'une cote visée, en empilant les sélections les plus sûres du '
    'vivier, avec des critères de triage entièrement contrôlables par l\'utilisateur. La Vente '
    'accompagne le coupon après l\'achat : elle évalue en direct l\'offre de rachat proposée par le '
    'bookmaker et tranche — vendre ou garder. Enfin, l\'écran Précision mesure honnêtement la '
    'performance passée du modèle (taux de réussite par niveau de confiance, score de Brier), ce '
    'qui boucle la boucle entre prédictions et réalité.'))

callout_row(story, [
    ('121', 'ligues couvertes (catalogue ESPN validé)'),
    ('4', 'écrans : Accueil, Combinator, Vente, Précision'),
    ('18+', 'outil informatif — aucun argent réel'),
])

story.append(P(
    'Trois principes fondateurs guident chaque choix technique du projet. Premier principe, '
    'l\'honnêteté d\'affichage : la cote totale d\'un combiné est le produit exact des cotes '
    'affichées, les matchs affichés sont ceux du jour réel, et un échec de chargement est annoncé '
    'comme tel plutôt que masqué derrière un état vide. Deuxième principe, la calibration : les '
    'probabilités sont ancrées sur les cotes réelles du marché quand elles existent, ce qui évite '
    'les dérives classiques des modèles fermés. Troisième principe, la sobriété volontaire : '
    'chaque sélection proposée respecte un plancher de probabilité, et le moteur refuse '
    'explicitement d\'empiler des paris à 30 % de chances pour gonfler artificiellement une cote. '
    'Ces principes se retrouvent jusque dans les mentions légales de l\'interface, qui rappelle '
    'que l\'outil est informatif et destiné à un public majeur.'))

# ═══════════════════════ CHAPITRE 2 ═══════════════════════
h1(story, '2. Architecture technique', P(
    'VOLTRIX bet repose sur une pile JavaScript unifiée exécutée par Bun. Le front-end et les '
    'routes API partagent le même projet Next.js 16 (App Router) en TypeScript strict, stylé avec '
    'Tailwind CSS v4 ; la persistance passe par Prisma sur une base SQLite embarquée. Cette '
    'homogénéité simplifie le déploiement sur une seule machine : un processus Node/Next écoute '
    'sur le port 3000, compile à la volée via Turbopack en développement, et sert à la fois '
    'l\'interface et les calculs. L\'application est une PWA : le thème, les icônes et le '
    'manifeste permettent une installation sur l\'écran d\'accueil du téléphone, et la navigation '
    'par onglets (Accueil, Ligues, Vente, Précision, Profil) reste utilisable à une main.'))

h2(story, '2.1 Organisation du code', P(
    'Le code source sépare nettement les trois responsabilités du produit. Le dossier '
    '<font name="DejaVuSans">src/app</font> contient les pages (accueil, combinator, ticket, vente, '
    'précision) et les routes API ; <font name="DejaVuSans">src/lib</font> regroupe le moteur '
    'purement calculatoire (prédiction, combinatoire, probabilités live, règlement) ainsi que les '
    'adaptateurs de données ; <font name="DejaVuSans">src/components</font> porte les composants '
    'd\'interface partagés (cartes de match, barres de probabilité, navigation). Cette séparation '
    'permet de tester le moteur sans interface : les suites de tests attaquent directement les '
    'modules de <font name="DejaVuSans">src/lib</font>, ce qui a permis de corriger et de '
    're-vérifier empiriquement chaque biais de calibration documenté au chapitre 9.'))
story.append(Paragraph(
    'src/app/          pages + routes API (App Router)<br/>'
    'src/lib/          moteur : prediction.ts, combo.ts, live-prob.ts, cache.ts, espn.ts...<br/>'
    'src/components/   UI : match-card, match-detail, tab-bar, shared<br/>'
    'prisma/           schéma SQLite (pronostics, bankroll)<br/>'
    'scripts/          harnais de tests (combo, critères, live-prob, bankroll...)', code_s))

h2(story, '2.2 Routes API', P(
    'L\'interface ne calcule rien elle-même : elle consomme six routes API qui encapsulent le scan, '
    'le calcul et le règlement. Chaque route répond en JSON et met en cache son résultat serveur '
    'pour amortir les appels répétés — le TTL effectif observé est de 60 à 90 secondes, ce qui '
    'correspond à la fenêtre de fraîcheur des données ESPN tout en protégeant la source contre les '
    'rafales de requêtes. Le tableau ci-dessous résume le contrat de chaque route.'))
table(story,
      ['Route', 'Méthode', 'Rôle'],
      [
          ['/api/matches?date=AAAA-MM-JJ', 'GET', 'Scan du jour : matchs UTC stricts, ligues actives, cotes, cache LRU'],
          ['/api/predictions', 'POST', 'Analyse d\'un match : λ, probabilités, marchés, value, Kelly'],
          ['api/match/[id]', 'GET', 'Dossier complet d\'un match (forme, Elo, blessures, historique)'],
          ['/api/cashout', 'POST', 'Évaluation d\'une offre de revente jambe par jambe (live)'],
          ['/api/bankroll/resolve', 'POST', 'Règlement des pronostics (grading) et statistiques'],
          ['/api/performance', 'GET', 'Agrégation de précision bornée aux 10 derniers jours'],
      ],
      [0.34, 0.12, 0.54],
      caption='Tableau 2.1 — Contrats des routes API internes.')

h2(story, '2.3 Cache serveur et résilience', P(
    'Toutes les données distantes transitent par un store partagé sur '
    '<font name="DejaVuSans">globalThis</font>, organisé par familles de clés (scoreboards, '
    'calendriers d\'équipes, classements, blessures, météo, analyses). Ce store est un LRU borné à '
    '600 entrées avec un balayage des expirations toutes les 60 secondes ; chaque entrée porte son '
    'TTL propre et un compteur d\'évictions est journalisé régulièrement dans les logs serveur '
    '(lignes <font name="DejaVuSans">[mem]</font>). Cette borne est née d\'un incident réel : deux '
    'crashs par épuisement du tas Node (OOM) ont montré que des caches non bornés finissent par '
    'consommer les 2 Go du processus. Depuis la correction, le test de charge montre un plateau : '
    'la RSS monte transitoirement sous les salves puis retombe au niveau initial après passage du '
    'ramasse-miettes.'))
story.append(P(
    'Côté client, la résilience est traitée comme une fonctionnalité à part entière. La page '
    'd\'accueil distingue trois états : chargement (squelettes), vide réel (HTTP 200 avec zéro '
    'match — seul cas où « Aucun match trouvé » s\'affiche) et erreur (réseau, timeout ou 5xx), '
    'cette dernière affichant « Impossible de charger les matchs » avec un bouton Réessayer, deux '
    'relances automatiques en backoff et la conservation des dernières données connues derrière un '
    'bandeau de reconnexion. Ce choix répond à un bug utilisateur réel : un serveur momentanément '
    'mort faisait croire à une journée sans matchs, ce qui est inacceptable pour un outil de '
    'décision. Le même motif d\'erreur explicite a été étendu au Combinator et à l\'onglet Ligues.'))

# ═══════════════════════ CHAPITRE 3 ═══════════════════════
h1(story, '3. Sources de données : ESPN', P(
    'Toutes les données brutes proviennent d\'un unique fournisseur : les endpoints publics ESPN. '
    'Ce choix fait suite à une comparaison empirique menée avec des alternatives (Sofascore, '
    'FBref, ClubElo) : Sofascore bloque les IP de datacenter derrière Cloudflare (HTTP 403 '
    'systématique), tandis qu\'ESPN répond 200 avec un user-agent adapté et couvre l\'intégralité '
    'du besoin — calendriers et scores, cotes d\'ouverture et de clôture DraftKings, forme '
    'récente, classements, historique de deux saisons pour les Elo, compositions et blessures. Le '
    'module <font name="DejaVuSans">espn.ts</font> centralise la totalité des appels : un seul '
    'point de fetch, des en-têtes explicites (user-agent <font name="DejaVuSans">curl/8.5.0</font>), '
    'des pauses de 250 à 400 ms entre requêtes et des timeouts avec AbortController (8 s pour les '
    'payloads lourds, 6 s pour la météo).'))
table(story,
      ['Ressource ESPN', 'Contenu consommé', 'Usage'],
      [
          ['scoreboard (par ligue, par date)', 'Événements, horaires, scores, statut', 'Scan du jour, suivi live, règlement'],
          ['odds (DraftKings)', '1X2, O/U avec lignes, ouverture/clôture', 'Ancrage du modèle, cotes réelles'],
          ['teams schedule', 'Matchs récents par équipe', 'Forme, GF/GA par contexte'],
          ['standings', 'Rang, points, groupe', 'Contexte de classement'],
          ['history 2 saisons', 'Résultats passés', 'Elo par équipe'],
          ['injuries /Athlete', 'Joueurs absents et statut', 'Multiplicateur de λ'],
      ],
      [0.30, 0.38, 0.32],
      caption='Tableau 3.1 — Ressources ESPN consommées et leur usage dans le moteur.')

h2(story, '3.1 Le problème des journées et le filtre UTC', P(
    'ESPN groupe ses scoreboards par journée sportive américaine (fuseau US Eastern), ce qui '
    'déborde largement du jour calendaire européen : un match de MLS de nuit apparaît sur la '
    'feuille d\'une autre date. Pour garantir que « Aujourd\'hui » ne montre que les matchs '
    'réellement joués ce jour, la route de scan applique un filtre strict en temps UTC : chaque '
    'événement doit satisfaire '
    '<font name="DejaVuSans">t ≥ JJ 00:00 UTC</font> et '
    '<font name="DejaVuSans">t &lt; JJ+1 00:00 UTC</font>. Ce garde-fou, protégé par des tests de '
    'non-régression, est la réponse à un bug signalé par les utilisateurs : des matchs de demain '
    'dans « Aujourd\'hui » et inversement. Il a un corollaire : les matchs qui se jouent entre '
    '00 h et 04 h UTC existent sur la feuille de la veille côté ESPN. Le règlement et l\'analyse '
    'live appliquent donc un repli systématique sur la feuille J−1 quand un identifiant de match '
    'est introuvable sur la feuille du jour — ce repli a été validé de bout en bout sur des matchs '
    'MLS nocturnes réels, réglés avec leurs vrais scores.'))

h2(story, '3.2 Fraîcheur, volume et catalogue', P(
    'Le scan d\'une journée parcourt les 121 ligues du catalogue par ordre de priorité fixe, en '
    'concurrence limitée, et ne conserve que les ligues ayant au moins un événement dans la fenêtre '
    'UTC du jour. Une journée de semaine type renvoie de 15 à 60 matchs ; un samedi de compétitions '
    'peut dépasser 200 matchs, analyse comprise en quelques secondes grâce au cache. Le catalogue '
    'couvre les cinq grands championnats européens, les coupes continentales, l\'Amérique du Sud, '
    'l\'Asie et un ensemble croissant de divisions secondaires — chaque code ESPN du catalogue a '
    'été validé empiriquement (HTTP 200 et payload exploitable) avant intégration. Les réponses du '
    'scan excluent volontairement toute complétion par les jours suivants : si le jour offre 15 '
    'matchs, l\'application en affiche 15, et non un pool gonflé par les journées voisines.'))
