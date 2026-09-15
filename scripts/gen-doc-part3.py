
# ═══════════════════════ CHAPITRE 4 ═══════════════════════
h1(story, '4. Moteur de prédiction : de ESPN aux probabilités', P(
    'Le cœur de VOLTRIX bet est un pipeline qui transforme des statistiques brutes en probabilités '
    'de match calibrées. Le principe directeur est le retrait vers la moyenne : chaque composante '
    'statistique est normalisée, bornée et ancrée sur les références du football professionnel, si '
    'bien qu\'un match entre équipes moyennes produit un total de buts attendus autour de 2,7 — '
    'conformément au marché — plutôt qu\'un λ aberrant. Ce chapitre détaille chaque étape du '
    'pipeline, dans l\'ordre d\'exécution du code.'))

story.append(fit_image('/home/z/my-project/download/doc-voltrix/pipeline.png', AVAIL_W, 300))
story.extend([Spacer(1, 5), Paragraph(
    'Figure 4.1 — Pipeline de calcul : de la donnée ESPN aux produits utilisateur.', caption_s)])
story.append(Spacer(1, 8))

h2(story, '4.1 Normalisation et shrinkage des forces d\'attaque et de défense', P(
    'Pour chaque équipe, le module extrait les buts marqués et encaissés par match (GF/GA) dans le '
    'contexte exact du match à venir : une équipe jouant à domicile est jugée sur ses matchs à '
    'domicile, une équipe à l\'extérieur sur ses matchs à l\'extérieur. Ces ratios sont ensuite '
    'normalisés par les références empiriques du football professionnel — 1,52 but marqué par '
    'match à domicile, 1,22 à l\'extérieur, 1,37 pour la moyenne des encaissements — ce qui donne '
    'un ratio neutre à 1,0 pour une équipe moyenne. Chaque ratio est enfin compressé par un '
    'shrinkage de type empirical Bayes d\'intensité n/(n+K) avec K = 10 : un petit échantillon '
    'est fortement tiré vers la moyenne, un grand échantillon conserve sa valeur observée. '
    'Formellement, pour un ratio r observé sur n matchs :'))
story.append(Paragraph(
    'r<super>*</super> = (n / (n + 10)) × r + (10 / (n + 10)) × 1,0', code_s))
story.append(P(
    'Cette étape est la réponse directe au premier biais diagnostiqué du moteur : en coupe, une '
    'équipe n\'ayant qu\'un ou deux matchs dans sa compétition produisait des ratios extrêmes '
    '(0,45 à 7,5 buts attendus) sans garde-fou. Le shrinkage rend mathématiquement impossible ce '
    'type d\'explosion : avec n = 2, le poids de l\'observation n\'est plus que de 16,7 %. Le '
    'contexte du match est également corrigé pour l\'équipe extérieure — ses buts marqués à '
    'l\'extérieur alimentent son attaque, et non ceux du match lui-même, une inversion de champs '
    'qui avait faussé les premières versions.'))

h2(story, '4.2 Étape Elo : redistribution préservant le total', P(
    'Les Elo des deux équipes (calculés sur l\'historique des deux saisons ESPN, avec avantage du '
    'terrain compté une seule fois) convertissent l\'écart de niveau en attente de résultat via la '
    'formule logistique classique, puis modulent les buts attendus. La contrainte clé est la '
    'conservation du total : l\'étape Elo redistribue la force relative entre λ domicile et λ '
    'extérieur sans jamais gonfler leur somme — un favori voit son λ augmenter au détriment de '
    'celui de son adversaire, avec un clamp de ±250 points d\'écart effectif. Avant correction, '
    'l\'avantage du terrain était compté en double (déjà inclus dans les références 1,52/1,22) et '
    'le signe du bonus était inversé dans la conversion logistique : à Elo égal, l\'équipe '
    'domicile était désavantagée. Ces deux défauts ont été corrigés et verrouillés par un harnais '
    'de 20 vérifications, dont le cas canonique : à Elo égal, probabilité domicile ≈ 46,6 % '
    'contre ≈ 28,1 % pour l\'extérieur, le nul prenant le reste.'))
story.append(Paragraph(
    'E<sub>dom</sub> = 1 / (1 + 10<super>((R<sub>ext</sub> + ADV − R<sub>dom</sub>) / 400)</super>)'
    '   avec ADV ≈ 65 points, R\' = R + K(S − E)', code_s))

h2(story, '4.3 Blessures et bornes finales', P(
    'Les absents déclarés ESPN modulent les buts attendus de l\'équipe concernée, avec un seuil '
    'd\'entrée volontairement haut : les deux premières indisponibilités ne comptent pas — les '
    'listes ESPN incluent en effet des joueurs de rotation — puis chaque absent supplémentaire '
    'retire 2 % par joueur, avec un plancher à 0,92 (8 % de baisse maximum). Le λ final de chaque '
    'équipe est enfin borné dans un couloir réaliste : [0,30 ; 3,80] pour le domicile et '
    '[0,25 ; 3,40] pour l\'extérieur. Ces bornes garantissent qu\'aucun marché dérivé ne peut '
    'produire une probabilité absurde (un « Moins de 2,5 buts » à 99 % n\'a plus jamais été émis '
    'depuis la correction, alors que le biais pré-correction en produisait régulièrement).'))

h2(story, '4.4 Calibration sur les marchés réels', P(
    'Quand ESPN publie une ligne Over/Under avec cotes pour le match, le module compare le total '
    'attendu du modèle au λ implicite du marché. Ce λ implicite est obtenu par dé-marging : les '
    'deux cotes du marché sont converties en probabilités brutes, la marge du bookmaker est '
    'retirée en normalisant leur somme à 1, puis le λ est inversé depuis la loi de Poisson sur la '
    'ligne proposée. Le total du modèle est ensuite ré-ancré (calibrateTotals) vers le λ marché '
    'dans une fenêtre bornée — le marché reste la référence, mais une divergence modérée du modèle '
    'est précisément ce qui crée les value bets détectés au chapitre suivant. Sur l\'échantillon '
    'de contrôle de 72 matchs avec ligne réelle, la médiane du rapport λ modèle / λ marché est de '
    '0,90 et 26 matchs sur 30 restent dans une bande de ±20 % après corrections.'))
story.append(Paragraph(
    'p<sub>i</sub><super>démargée</super> = p<sub>i</sub> / (p<sub>1</sub> + p<sub>2</sub>)'
    '   puis inversion Poisson → λ<sub>marché</sub>', code_s))

h2(story, '4.5 Matrice de Poisson et marchés dérivés', P(
    'Les buts attendus des deux équipes alimentent une matrice de Poisson 16 × 16 : chaque cellule '
    '(i, j) porte la probabilité du score final i-j, calculée indépendamment par équipe puis '
    'multipliée (hypothèse d\'indépendance des attaques). Tous les marchés proposés par '
    'l\'application découlent de cette matrice par simple sommation de cellules : 1X2 (somme du '
    'triangle inférieur, diagonale, triangle supérieur), double chance (réunion de deux '
    'issues), Over/Under par ligne (somme des cellules au-delà de la ligne), BTTS (produit des '
    'queues non nulles) et premier buteur d\'un côté ou de l\'autre. La loi de Poisson utilisée '
    'est la formulation standard :'))
story.append(Paragraph(
    'P(X = k) = e<super>−λ</super> × λ<super>k</super> / k!   ;   '
    'P(Moins de 2,5) = Σ<sub>k=0..2</sub> P(k)   ;   somme des marches firstToScore ≡ 1,000', code_s))
story.append(P(
    'La décomposition firstToScore (qui marque en premier : domicile, extérieur, personne) est '
    'testée par un harnais dédié sur une grille de λ allant de 0,1 à 4,0 : la somme des trois '
    'probabilités vaut exactement 1,000, y compris dans le cas dégénéré λ = 0 où « personne ne '
    'marque » vaut 1. Ce test existait pour une raison précise : la version initiale sommait à '
    '1 + e<super>−λ</super>, soit environ 1,06, et cette incohérence se propageait aux marchés '
    'composés. Chaque correction du moteur est ainsi accompagnée de son harnais de non-régression, '
    'et l\'ensemble des suites (76 tests combinatoires, 46 tests de remplacement, 25 tests de '
    'probabilités live, 61 tests de bankroll, 36 tests de règlement) est relancé à chaque '
    'modification.'))

h2(story, '4.6 De la probabilité à la cote : value bets et Kelly', P(
    'La cote juste d\'un marché est simplement l\'inverse de sa probabilité, '
    '<font name="DejaVuSans">cote = 1/p</font> : un événement à 40 % vaut 2,50. Un marché devient '
    'un value bet lorsque la cote réelle du bookmaker dépasse la cote juste du modèle — l\'écart '
    'en pourcentage (edge) est affiché sur la fiche de chaque match avec la comparaison « Marché '
    'vs Modèle ». La mise conseillée suit le critère de Kelly fractionné, plafonné à 10 % du '
    'capital pour refléter l\'incertitude résiduelle du modèle :'))
story.append(Paragraph(
    'f<super>*</super> = (b × p − q) / b   avec b = cote − 1, q = 1 − p ;   mise = min(f<super>*</super>, 0,10) × capital', code_s))
story.append(P(
    'Deux garde-fous complètent le dispositif. D\'une part, les cotes « estimées » — celles que le '
    'modèle déduit de ses probabilités quand aucune cote réelle n\'existe — sont marquées comme '
    'telles dans le vivier et exclues par défaut des combinés, puisque aucune d\'entre elles '
    'n\'est obtenable chez un bookmaker ; le critère « cotes réelles uniquement » est activé '
    'd\'usine. D\'autre part, les lignes Over/Under non couvertes par le modèle (par exemple une '
    'ligne 4,5 quand le modèle n\'évalue que 1,5/2,5/3,5) affichent un tiret plutôt qu\'un zéro, '
    'pour ne jamais présenter une probabilité modèle inexistante comme une certitude nulle.'))

# ═══════════════════════ CHAPITRE 5 ═══════════════════════
h1(story, '5. Le Combinator : construire un combiné à cote cible', P(
    'Le Combinator répond à une question difficile : « je vise une cote de 10, quelle est la '
    'meilleure combinaison de paris que je peux empiler ? ». L\'algorithme part du vivier du '
    'jour — l\'ensemble des marchés analysés pour chaque match — puis recherche une combinaison '
    'dont le produit de cotes atteint la cible en maximisant la probabilité de gain du produit. '
    'La contrainte d\'or est structurelle : la cote totale affichée est le produit exact des '
    'cotes affichées de chaque jambe, sans arrangement ni arrondi flatteur. Un combiné ×10,14 '
    'affiché est, chez le bookmaker, un combiné ×10,14.'))

h2(story, '5.1 Critères de triage', P(
    'L\'utilisateur filtre le vivier avant la recherche via un panneau de critères persistés : '
    'marchés autorisés (1X2, double chance, Over/Under, BTTS), niveau de confiance minimal du '
    'modèle, exclusion des cotes estimées (activée par défaut, voir chapitre 4.6) et exclusion de '
    'ligues entières. Les critères s\'appliquent à la génération initiale ET aux échanges manuels '
    'ultérieurs : une jambe remplacée hérite des mêmes contraintes. Le tableau ci-dessous résume '
    'les critères et leurs valeurs par défaut.'))
table(story,
      ['Critère', 'Défaut', 'Effet sur le vivier'],
      [
          ['Marchés autorisés', 'tous', 'Restreint aux types de marchés cochés'],
          ['Confiance minimale', 'aucune', 'Écarte les sélections sous le niveau choisi (1 à 4 étoiles)'],
          ['Cotes réelles uniquement', 'activé', 'Exclut les cotes estimées non obtenables au guichet'],
          ['Ligues exclues', 'aucune', 'Retire du vivier les ligues décochées'],
      ],
      [0.30, 0.16, 0.54],
      caption='Tableau 5.1 — Critères de triage du Combinator et valeurs d\'usine.')

h2(story, '5.2 Réparation vers la cible et remplacement même-match', P(
    'Deux mécanismes garantissent que le combiné reste cohérent après manipulation. La réparation '
    'automatique (repairToTarget) s\'applique quand un échange manuel fait tomber la cote sous la '
    'cible : le moteur procède à des échanges un-pour-un à probabilité maximale, sous les mêmes '
    'contraintes, jusqu\'à rétablir la cible — ou affiche explicitement un badge « sous '
    'l\'objectif » avec la mention de la cote réelle. Le remplacement même-match, ajouté à la '
    'demande des utilisateurs, permet de changer de pari sur un match sans changer de match : la '
    'feuille d\'échange liste tous les candidats du même matchId, regroupés par famille de marché '
    '(Résultat 1X2, Double chance, Buts Over/Under, BTTS), avec cote réelle, source et confiance ; '
    'la sélection est exclusive avec les échanges inter-matchs et l\'aperçu affiche la cote '
    'totale avant/après. L\'exemple réel ci-dessous illustre le flux complet.'))
story.append(P(
    'Exemple chiffré (capture du chapitre 8) : un combiné ×3,06 = 2,00 × 1,53 contient la jambe '
    '« Slavia Prague ou Nul » (double chance à 2,00). L\'utilisateur ouvre la feuille d\'échange, '
    'choisit « Victoire Slavia Prague » (1X2, cote 2,70, même match) : la nouvelle cote totale '
    'est 2,00 × 2,70 = 5,40, affichée avant validation, probabilité recalculée à la baisse. Dans '
    'le cas inverse — un remplacement qui fait passer sous la cible — la réparation automatique '
    'relance la recherche et ramène le produit au niveau visé. Chaque étape est annulable (undo) '
    'et le ticket final transférable vers la Vente en un tap.'))

# ═══════════════════════ CHAPITRE 6 ═══════════════════════
h1(story, '6. La Vente : conseiller de revente de coupon', P(
    'Certains bookmakers proposent de racheter un coupon avant la fin de ses matchs : l\'utilisateur '
    'qui a misé 100 peut se voir offrir 25 pour céder son ticket. La Vente répond à la question '
    '« dois-je vendre ? » par une analyse probabiliste en direct plutôt qu\'à l\'intuition. Le '
    'coupon est transféré depuis le Combinator avec sa mise réellement engagée et sa devise (16 '
    'devises gérées, formatage Intl) ; à tout moment, l\'utilisateur saisit l\'offre du bookmaker '
    'et lance l\'analyse.'))

h2(story, '6.1 Calcul de la valeur juste', P(
    'Pour chaque jambe du coupon, la route /api/cashout consulte l\'état ESPN réel du match. Un '
    'match terminé est noté gagné ou perdu par le module de grading partagé avec le règlement. Un '
    'match en cours est re-probabilisé par le module live-prob : le score courant est retiré de la '
    'distribution ( convolution par le score final restant), le λ restant est proportionnel à la '
    'fraction de temps restant — l\'horloge ESPN (minute, mi-temps) prime sur le temps mural — et '
    'la probabilité de la sélection est recalculée sur cette base. Un match pas encore commencé '
    'conserve sa probabilité initiale, en dégradation propre si la donnée manque. La valeur juste '
    'du coupon est alors :'))
story.append(Paragraph(
    'V = mise × cote × Π p<sub>j</sub> (jambes encore vivantes, gagnées = 1)', code_s))
story.append(P(
    'L\'offre du bookmaker est comparée à V avec trois zones de décision : vendre si l\'offre '
    'dépasse la valeur juste, zone grise si l\'offre en couvre au moins 85 % (l\'utilisateur '
    'arbitre alors entre certitude et espérance), garder sinon. Le verdict s\'accompagne d\'un '
    'message explicite — « l\'offre est 74 % sous sa valeur estimée » — et du détail jambe par '
    'jambe (score, horloge, delta de probabilité). L\'exemple réel de la capture : coupon à mise '
    '100, cote 10,14, quatre matchs pas encore commencés, offre de 25 — valeur juste ≈ 96, verdict '
    'GARDER. Les coupons vendus sont archivés avec leur prix réel et le bilan ± est suivi par '
    'devise. Un garde-fou limite à 50 le nombre de jambes d\'une requête pour éviter tout fan-out '
    'excessif vers ESPN.'))

# ═══════════════════════ CHAPITRE 7 ═══════════════════════
h1(story, '7. Précision et règlement des pronostics', P(
    'Un modèle sans mesure de performance n\'est qu\'une opinion. VOLTRIX bet règle '
    'automatiquement ses pronostics passés et expose les statistiques de réussite dans l\'écran '
    'Précision. Le règlement s\'appuie sur un module de grading unique (grade.ts) partagé entre '
    'la Vente et la route de règlement : un même événement est noté une seule fois, avec repli '
    'systématique sur la feuille ESPN de la veille pour les matchs nocturnes (chapitre 3.1). La '
    'route /api/performance agrège les pronostics des 10 derniers jours — borne ajoutée pour '
    'garantir des temps de réponse de l\'ordre de 150 ms — et calcule par niveau de confiance le '
    'taux de réussite observé.'))

story.append(P(
    'L\'indicateur central est le score de Brier, moyenne des carrés des écarts entre probabilité '
    'annoncée et issue observée (0 = parfait, 0,25 = hasard sur un binaire). Les valeurs observées '
    'en production tournent autour de 0,25-0,26 sur l\'ensemble des pronostics, ce qui est '
    'cohérent avec un modèle calibré sur des événements incertains ; l\'écran distingue '
    'explicitement les bandes de confiance où le modèle est le plus fiable. Cette transparence '
    'est un choix produit : l\'utilisateur voit où le modèle se trompe, pas seulement où il '
    'réussit. Les pronostics déjà résolus ne sont jamais réécrits par une nouvelle analyse — '
    'correction apportée après observation d\'un upsert qui déformait a posteriori les '
    'statistiques historiques.'))

# ═══════════════════════ CHAPITRE 8 ═══════════════════════
h1(story, '8. Guide écran par écran', P(
    'Ce chapitre illustre le parcours utilisateur complet avec des captures réelles de '
    'l\'application (viewport 390 × 844, données du jour). Pour chaque écran : son rôle, les '
    'éléments clés et le geste principal. Les captures sont présentées dans l\'ordre du parcours '
    'type : consulter le jour, analyser un match, construire un combiné, ajuster une jambe, '
    'transférer le ticket, évaluer une offre de revente, puis vérifier la précision du modèle.'))

h2(story, '8.1 Accueil — le jour réel')
story.append(P(
    'L\'accueil s\'ouvre sur la journée du jour : une rangée de chips de dates (Hier, '
    'Aujourd\'hui, Demain, puis la semaine), une rangée de chips de ligues avec compteurs, et la '
    'liste des matchs filtrée strictement sur le jour UTC. Chaque carte porte les équipes, '
    'l\'heure, l\'épine de ligue, le pronostic principal du modèle et son pourcentage ; les '
    'matchs en direct affichent leur score. Le bouton Rafraîchir force un re-scan ; en cas de '
    'panne réseau, l\'écran d\'erreur propose Réessayer au lieu d\'un faux état vide.'))
figure(story, f'{SHOT}/01-accueil.png', 'Capture 8.1 — Accueil : header, chips de dates, cote cible du jour.')

h2(story, '8.2 Liste de matchs analysés')
story.append(P(
    'Le défilement fait apparaître les cartes de matchs du jour, chacune enrichie de l\'analyse : '
    'pronostic, barre de probabilité, badge de confiance. Un samedi de compétitions peut afficher '
    'plus de 200 matchs analysés — tous du jour, sans complétion par les jours voisins. Chaque '
    'carte est un point d\'entrée vers le dossier complet du match.'))
figure(story, f'{SHOT}/02-accueil-cartes.png', 'Capture 8.2 — Cartes de matchs avec pronostics et confiance.')

h2(story, '8.3 Dossier de match')
story.append(P(
    'Un tap sur une carte ouvre le dossier du match : en-tête avec compétition, rangs des équipes '
    'et stade, bannière « Confiance du modèle », puis les pronostics par marché avec la '
    'comparaison Marché vs Modèle (l\'edge en pourcentage signale les value bets). Les lignes '
    'non couvertes par le modèle affichent un tiret — jamais un faux 0 %. En direct, le score et '
    'l\'horloge ESPN alimentent aussi la Vente.'))
figure(story, f'{SHOT}/03-detail-match.png', 'Capture 8.3 — Dossier : Palmeiras − São Paulo en direct.')

h2(story, '8.4 Pronostics et cotes du match')
story.append(P(
    'La suite du dossier détaille chaque marché : probabilité modèle, cote juste 1/p, cote du '
    'marché et écart. C\'est l\'écran de référence pour juger un pari isolé avant de l\'empiler '
    'dans un combiné — le modèle y affiche à la fois sa force (probabilités calibrées) et ses '
    'limites (tiret sur les lignes non couvertes).'))
figure(story, f'{SHOT}/04-detail-pronos.png', 'Capture 8.4 — Marchés du match : Marché vs Modèle, edge.')

h2(story, '8.5 Combinator — formulaire et critères')
story.append(P(
    'Le Combinator demande trois entrées : la cote cible (champ libre ou pastilles ×2 à ×50), le '
    'profil de risque (Prudent, Équilibré, Agressif — qui fixe le plancher de probabilité et le '
    'plafond de cote par jambe) et, via le panneau Critères, les marchés autorisés, la confiance '
    'minimale, l\'exclusion des cotes estimées et les ligues exclues. Le jour analysé se change '
    'par chips (Aujourd\'hui / Demain).'))
figure(story, f'{SHOT}/05-combo-form.png', 'Capture 8.5 — Formulaire : cote cible, profil de risque.')

h2(story, '8.6 Combinator — résultat à cote exacte')
story.append(P(
    'Après génération, le ticket affiche chaque jambe (match, marché, cote, source, confiance) et '
    'la cote totale — produit exact des jambes. L\'exemple du jour : quatre jambes toutes à cote '
    'réelle, total ×10,14, probabilité du combiné et mise Kelly conseillée affichées. Un badge '
    '« sous l\'objectif » apparaîtrait explicitement si un échange faisait tomber le produit sous '
    'la cible avant réparation.'))
figure(story, f'{SHOT}/07-combo-result.png', 'Capture 8.6 — Combiné généré : 4 jambes, cote totale exacte.')

h2(story, '8.7 Remplacement par un pari du même match')
story.append(P(
    'Le bouton d\'échange d\'une jambe ouvre la feuille de remplacement : section « Autres paris '
    'du même match » regroupée par famille (Résultat 1X2, Double chance, Buts Over/Under, BTTS), '
    'chacune avec cote réelle et confiance ; puis, en dessous, les candidats d\'autres matchs. '
    'Les deux sections sont exclusives — jamais deux jambes du même match — et l\'aperçu montre '
    'la cote totale avant/après avant validation du remplacement.'))
figure(story, f'{SHOT}/08-meme-match.png', 'Capture 8.7 — Feuille d\'échange : alternatives du même match.')

h2(story, '8.8 Ticket plein écran et transfert')
story.append(P(
    'Le ticket en plein écran détaille le combiné (noms complets, marchés, cotes, probabilité '
    'multipliée des jambes indépendantes) et porte le bouton « Transférer vers la Vente ». Le '
    'transfert demande la mise réellement engagée et la devise — c\'est cette mise qui servira de '
    'base au calcul de la valeur juste du coupon.'))

h2(story, '8.9 Vente — évaluer une offre de rachat')
story.append(P(
    'Sur l\'écran Vente, le coupon en cours expose son gain potentiel et le bouton « Évaluer une '
    'offre ». L\'utilisateur saisit le prix proposé par le bookmaker (25 dans la capture), lance '
    'l\'analyse : chaque jambe est re-probabilisée selon son état réel ESPN, la valeur juste est '
    'affichée en face de l\'offre, et le verdict tranché — ici GARDER, l\'offre étant 74 % sous '
    'la valeur estimée. Les coupons vendus passent en section VENDUS avec le bilan ± par devise.'))
figure(story, f'{SHOT}/12-vente-eval.png', 'Capture 8.8 — Verdict : offre 25 vs valeur juste, GARDER.')

h2(story, '8.10 Précision — le modèle rend des comptes')
story.append(P(
    'L\'écran Précision agrège les pronostics réglés : taux de réussite global et par bande de '
    'confiance, score de Brier, historique des 10 derniers jours. C\'est l\'outil d\'audit '
    'permanent du modèle — et le contrepoint honnête de ses réussites.'))
figure(story, f'{SHOT}/13-precision.png', 'Capture 8.9 — Précision : réussite par confiance, Brier.')

# ═══════════════════════ CHAPITRE 9 ═══════════════════════
h1(story, '9. Qualité, limites et évolution', P(
    'La qualité du projet repose sur un triptyque : suites de tests unitaires sur le moteur, '
    'validation croisée par sous-agents sur chaque évolution, et parcours E2E automatisés sur '
    'viewport mobile. Les suites couvrent le moteur combinatoire (76 tests dont l\'invariant de '
    'produit), les critères de triage (25), les probabilités live (25), la bankroll (61) et le '
    'règlement (36, concordance totale avec le grading partagé), auxquels s\'ajoutent les 46 '
    'tests du remplacement même-match et les harnais de biais (Elo, λ, firstToScore). Le type-checking '
    'TypeScript et le lint passent sans erreur sur l\'ensemble du code source.'))
table(story,
      ['Domaine', 'Suite', 'Checks'],
      [
          ['Moteur combinatoire', 'test-combo + invariant', '76 + 756'],
          ['Remplacement même-match', 'test-same-match-swap', '46'],
          ['Critères de triage', 'test-criteria', '25'],
          ['Probabilités live', 'test-live-prob', '25'],
          ['Bankroll et règlement', 'bankroll + resolve-api', '61 + 36'],
      ],
      [0.38, 0.38, 0.24],
      caption='Tableau 9.1 — Suites de tests du moteur et nombre de vérifications.')

story.append(P(
    'Les corrections majeures documentées au fil des itérations sont autant de leçons d\''
    'ingénierie : filtre strict des journées UTC contre les matchs déplacés, signe de l\'avantage '
    'Elo vérifié mathématiquement et empiriquement, repli J−1 pour le règlement des matchs '
    'nocturnes, en-têtes user-agent explicites contre les 403 en production, cotes réelles par '
    'défaut dans les combinés, et caches bornés après deux crashs mémoire réels. Chacune de ces '
    'corrections est protégée par son test de non-régression et documentée dans le journal de '
    'travail du projet.'))

story.append(P(
    'Les limites sont assumées et affichées. Le modèle repose sur une seule source de données : '
    'une indisponibilité ESPN dégrade le scan (avec cache et replis, mais jamais d\'invention). '
    'Les probabilités sont des estimations calibrées, pas des certitudes — un verdict GARDER de '
    'la Vente est une espérance mathématique, pas une prédiction du futur ; l\'interface le '
    'rappelle sur chaque écran d\'analyse. L\'hypothèse d\'indépendance des attaques dans la '
    'matrice de Poisson reste une simplification classique. Enfin, l\'outil ne gère aucun argent '
    'réel et s\'adresse à un public majeur : la mise Kelly est un conseil arithmétique, pas une '
    'incitation. Les pistes d\'évolution identifiées sont l\'extension du catalogue de ligues '
    '(validation empirique par lots), l\'analyse live temps réel pour le suivi des matchs en '
    'cours depuis l\'accueil, et l\'enrichissement du conseiller de revente avec l\'historique '
    'des offres observées par bookmaker.'))

# ── Construction ─────────────────────────────────────────────────────────
doc = TocDocTemplate(
    OUT_BODY, pagesize=A4,
    leftMargin=MARGIN, rightMargin=MARGIN,
    topMargin=MARGIN, bottomMargin=MARGIN,
    title=DOC_TITLE, author='Z.ai', creator='Z.ai',
    subject='Dossier technique de l\'application VOLTRIX bet',
)
doc.multiBuild(story, onFirstPage=page_deco, onLaterPages=page_deco)
print('body OK:', OUT_BODY)

# ── Fusion couverture + corps ────────────────────────────────────────────
from pypdf import PdfReader, PdfWriter
A4_W, A4_H = 595.28, 841.89

def normalize(page):
    b = page.mediabox
    w, h = float(b.width), float(b.height)
    if abs(w - A4_W) > 0.1 or abs(h - A4_H) > 0.1:
        page.scale_to(A4_W, A4_H)
    return page

FINAL = '/home/z/my-project/download/VOLTRIX-bet-Dossier-technique.pdf'
writer = PdfWriter()
writer.add_page(normalize(PdfReader('/home/z/my-project/scripts/doc-voltrix-cover.pdf').pages[0]))
for pg in PdfReader(OUT_BODY).pages:
    writer.add_page(normalize(pg))
writer.add_metadata({'/Title': DOC_TITLE, '/Author': 'Z.ai', '/Creator': 'Z.ai',
                     '/Subject': "Dossier technique de l'application VOLTRIX bet"})
with open(FINAL, 'wb') as f:
    writer.write(f)
print('final OK:', FINAL, len(writer.pages), 'pages')
