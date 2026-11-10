# VOLTRIX — Moteur MMA complet (voltrix-mma-v1)

Code source TypeScript du moteur de pronostics MMA de l'application VOLTRIX.
Tout est exécuté dans le navigateur (100 % frontend, fonctions pures) à partir
des données publiques ESPN. Aucune valeur inventée : chaque champ est soit
observé chez ESPN, soit calculé et étiqueté comme tel.

## Arborescence

```
voltrix-mma/
├── README.md                  ← ce fichier
├── src/lib/mma/               ← LE MOTEUR (6 fichiers)
│   ├── espn.ts        (784 l.) Accès aux API ESPN + cache + limitation de concurrence
│   ├── types.ts       (200 l.) Types partagés, parsing palmarès, score de forme
│   ├── analysis.ts    (711 l.) DIMENSIONS : construction des 11 indices + dérivés
│   ├── prediction.ts  (369 l.) AGRÉGATION : voltrix-mma-v1, logistique, bornage 25-75 %
│   ├── rounds.ts      (230 l.) MODÈLE DE ROUNDS : prior UFC + rétrécissement bayésien
│   └── loaders.ts     (596 l.) Chargement des vues + BACKTEST (runModelCheck)
├── src/lib/mma-bridge.ts      (reliage moteur → UI React : écrans VOLTRIX)
├── src/lib/mma-types.ts       (types des vues UI)
└── src/lib/persist.ts         (helper localStorage/sessionStorage utilisé par le moteur)
```

## 1. voltrix-mma-v1 — les 11 dimensions et l'agrégation

### `src/lib/mma/analysis.ts`

**`buildDimensions()` (l. 532-600)** construit les 11 dimensions :

| # | Clé | Libellé | Source |
|---|-----|---------|--------|
| 1 | `forme` | Forme récente | Historique ESPN (5 derniers combats) |
| 2 | `volume` | Volume de frappes | Carrière ESPN (SLpM) |
| 3 | `precision` | Précision des frappes | Carrière ESPN |
| 4 | `absorption` | Frappes absorbées | Calculé (fenêtre 8 combats) |
| 5 | `defense-frappes` | Défense contre les frappes | Calculé |
| 6 | `lutte` | Lutte (takedowns) | Carrière ESPN |
| 7 | `defense-takedown` | Défense contre les takedowns | Calculé |
| 8 | `sol` | Soumissions | Carrière ESPN |
| 9 | `puissance` | Pouvoir de finition (KO%+TKO%) | Carrière ESPN |
| 10 | `experience` | Expérience (total combats) | Palmarès ESPN |
| 11 | `physique` | Envergure (allonge) | Fiche ESPN |

**`edge()` (l. 511-530)** — indice relatif 0-100 entre deux valeurs x, y :

```
score = 50 + 50·(x−y)/(x+y+ε)
```

- `ε` (amortissement) : écart typique sous lequel deux carrières ne se
  distinguent pas, calibré par dimension ;
- `floor` (plancher) : si les DEUX valeurs sont sous le plancher, la dimension
  est déclarée indisponible (l'absence d'activité n'est pas une faiblesse) ;
- `lowerBetter` : inverse le sens (ex. frappes absorbées).

**`computeDerivedStats()` (l. 314-424)** — calcule dans le navigateur les
indicateurs qu'ESPN ne publie pas en fiche : frappes reçues/minute (SApM),
défenses frappes/takedowns, temps moyen de combat. Fenêtre explicite de
**8 combats terminés**, une requête `getFightStatsFor` + `getCompetitionStatus`
par combat, cache localStorage 12 h, correction des no-contests (→ « NC »),
collecte du round de fin (`status.period`) sans requête supplémentaire.

### `src/lib/mma/prediction.ts`

**Poids publics (`DIMENSION_WEIGHTS`, l. 39-51)** :

```
forme 1.5 · volume 1.2 · precision 1.2 · absorption 1.2
defense-frappes 1.0 · lutte 1.0 · defense-takedown 1.0 · puissance 1.0
sol 0.8 · experience 0.8 · physique 0.6
```

**`computePrediction()` (l. 114-245)** — agrégation :

```
avantage_pondéré    = Σ wᵢ·(scoreᵢ − 50)          sur les dimensions utilisables
avantage_normalisé  = avantage_pondéré / (Σwᵢ × 50)   ∈ [−1, +1]
P(A)                = 1 / (1 + e^(−2.6 · avantage_normalisé))   (logistique)
P(A) finale         = min(75, max(25, P(A)))      (bornage volontaire)
```

- Refus si moins de **3 dimensions comparables** ;
- Confiance = `0.45·couverture + 0.55·couverture_cœur`
  (dimensions cœur : forme, volume, precision, absorption, lutte, puissance) ;
- `predictMethod()` : méthode de victoire la plus fréquente, UNE source à la
  fois (palmarès par victoire, sinon stats de carrière par combat) ;
- `computeExpressPrediction()` : version allégée (palmarès + forme,
  logistique pente 2.2, bornage 30-70 %) pour les lignes de carte.

## 2. Le modèle de rounds — `src/lib/mma/rounds.ts`

Trois fonctions :

1. **`fetchUfcRoundPrior()` (l. 79-142)** — prior UFC : scan des **6 derniers
   événements UFC terminés** (scoreboard uniquement, 6 requêtes). Pour chaque
   combat terminé : format (3 ou 5 rounds) et round de fin (`status.period`).
   Une décision s'identifie par « dernier round prévu atteint + horloge pleine
   (≥ 295 s) ». Distribution agrégée par format, cache localStorage 7 jours.
   Garde-fous : ≥ 20 combats échantillonnés, ≥ 8 (format 3) / ≥ 4 (format 5).

2. **`personalRoundRates()` (l. 152-201)** — taux personnalisés du combattant :
   ses victoires documentées (fenêtre dérivée, rounds de fin réels) fondues
   avec le prior par **rétrécissement de type Dirichlet** (n0 = 6
   pseudo-victoires) :

   ```
   taux = (n0·part_prior + observé) / (n0 + victoires_documentées)
   ```

   Moins de 3 victoires documentées → le taux rejoint le prior, étiqueté
   honnêtement (`basis: 'prior UFC'`).

3. **`fuseRoundDistribution()` (l. 209-230)** — fusion des deux combattants :

   ```
   P(fini au round r) = pA·rateA[r] + pB·rateB[r]
   P(décision)        = pA·decA    + pB·decB
   ```

   (la somme vaut exactement 1 par construction).

## 3. Backtest et récupération des statistiques — `loaders.ts` + `espn.ts`

### `runModelCheck()` (`src/lib/mma/loaders.ts`, l. 511-596)

Vérification publique du modèle : recalcul du pronostic sur les combats
terminés des **3 derniers événements UFC** (12 combats max), confrontation du
favori prédit au vainqueur réel, publication du taux de réussite tel quel.
Notes de transparence : biais de recul (stats d'aujourd'hui, pas d'avant le
combat), pas d'indicateurs dérivés dans ce check, probabilités bornées.

### Endpoints ESPN (`src/lib/mma/espn.ts`)

| Fonction | Endpoint |
|---|---|
| `getScoreboard()` | `site.api.espn.com/apis/site/v2/sports/mma/{ligue}/scoreboard?dates=…` |
| `getCompetitionDetail()` | `sports.core.api.espn.com/v2/sports/mma/leagues/{ligue}/events/{eid}/competitions/{cid}` |
| `getAthlete()` | `sports.core.api.espn.com/v2/sports/mma/athletes/{aid}` |
| `getAthleteStats()` | stats de carrière |
| `getAthleteRecord()` | palmarès |
| `getAthleteHistory()` | historique des combats |
| `getFightStatsFor()` | stats d'un combat (base des dérivés) |
| `getCompetitionStatus()` | statut (round de fin, méthode, durée) |

Cache mémoire avec TTL par type, `mapLimited()` pour limiter la concurrence
des requêtes, organisation active : UFC.

## Fichiers annexes

- `src/lib/mma-bridge.ts` — adapte le moteur aux écrans React de l'App
  (écran Accueil, carte d'événement, page combat) ;
- `src/lib/mma-types.ts` — types sérialisables des vues UI.

## Dépendances

Aucune dépendance externe : TypeScript pur, `fetch` navigateur, et
`persistGet/persistSet` (helper localStorage/sessionStorage maison).
