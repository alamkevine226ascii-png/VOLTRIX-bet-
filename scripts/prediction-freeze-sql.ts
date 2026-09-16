// ============================================================
// VOLTRIX — Task 44 §20bis : PROTECTION DB DE LA TABLE LEGACY
// « Prediction » — payload de prédiction FIGÉ, résolution one-way.
//
// Rôle (diagnostic Task 42 + design Task 43) :
//   Prediction = dossier HISTORIQUE de chaque prono persisté par
//   POST /api/predictions (suivi de performance /api/performance).
//   Deux chemins d'écriture légitimes seulement :
//     1) CRÉATION (upsert update:{} — idempotent, ne réécrit jamais) ;
//     2) RÉSOLUTION post-match (/api/performance → analyze.ts
//        settleRow) : resolved:false→true + result + closingOdds.
//   Tout le reste du payload (pick, probabilités, cotes, digest…)
//   ne doit JAMAIS bouger après création — sinon calibrage/Brier/ROI
//   falsifiés a posteriori (contrepied, Task 19-a/21-a/22-a).
//
// Mécanisme (contrairement au §20 apply-immutability.ts qui interdit
// TOUTE mutation des tables snapshot) : garde ciblée colonne par
// colonne — IS DISTINCT FROM OLD vs NEW :
//   - 19 colonnes FIGÉES (identité, descriptif, payload complet) ;
//   - 3 colonnes ÉVOLUTIVES one-way : resolved, result, closingOdds,
//     autorisées uniquement tant que OLD.resolved = false ;
//   - une fois resolved = true : ligne = dossier clos, AUCUNE
//     mutation supplémentaire (même result/closingOdds) ;
//   - DELETE toujours interdit (aucune voie applicative légitime).
// Idempotent : CREATE OR REPLACE + DROP TRIGGER IF EXISTS.
//
// Partagé par : scripts/apply-prediction-freeze.ts (pose sur Neon,
// à exécuter avec les creds hors-repo) et les suites de tests
// (test-prediction-freeze.ts, test-option-b.ts — PG temporaires).
// Ne contient AUCUN secret. Compatible SQLite ? Non — plpgsql pur ;
// les DB temporaires des tests utilisent PostgreSQL 17 embarqué.
// ============================================================

export const FREEZE_FN = `CREATE OR REPLACE FUNCTION voltrix_prediction_freeze_guard() RETURNS trigger AS $$
DECLARE
  changed text := '';
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'VOLTRIX §20bis : Prediction = enregistrement historique — DELETE interdit (id=%)', OLD."id";
  END IF;

  -- 1) Payload de prédiction FIGÉ dès la création (aucune évolution légitime).
  --    moindre diff → rejet nominatif (colonne listée dans le message).
  --    NB plpgsql : chaque IF…THEN exige son END IF; même sur une seule ligne,
  --    et les champs camelCase des records NEW/OLD doivent être QUOTÉS
  --    (NEW."matchId") — un identifiant nu est rabattu en minuscules et ne
  --    correspond plus à la colonne "matchId" (record "new" has no field).
  IF NEW."matchId"        IS DISTINCT FROM OLD."matchId"        THEN changed := changed || 'matchId ';        END IF;
  IF NEW."market"         IS DISTINCT FROM OLD."market"         THEN changed := changed || 'market ';         END IF;
  IF NEW."league"         IS DISTINCT FROM OLD."league"         THEN changed := changed || 'league ';         END IF;
  IF NEW."leagueName"     IS DISTINCT FROM OLD."leagueName"     THEN changed := changed || 'leagueName ';     END IF;
  IF NEW."matchDate"      IS DISTINCT FROM OLD."matchDate"      THEN changed := changed || 'matchDate ';      END IF;
  IF NEW."homeTeam"       IS DISTINCT FROM OLD."homeTeam"       THEN changed := changed || 'homeTeam ';       END IF;
  IF NEW."awayTeam"       IS DISTINCT FROM OLD."awayTeam"       THEN changed := changed || 'awayTeam ';       END IF;
  IF NEW."pick"           IS DISTINCT FROM OLD."pick"           THEN changed := changed || 'pick ';           END IF;
  IF NEW."pickedTeamId"   IS DISTINCT FROM OLD."pickedTeamId"   THEN changed := changed || 'pickedTeamId ';   END IF;
  IF NEW."probability"    IS DISTINCT FROM OLD."probability"    THEN changed := changed || 'probability ';    END IF;
  IF NEW."rawProbability" IS DISTINCT FROM OLD."rawProbability" THEN changed := changed || 'rawProbability '; END IF;
  IF NEW."inputsDigest"   IS DISTINCT FROM OLD."inputsDigest"   THEN changed := changed || 'inputsDigest ';   END IF;
  IF NEW."predictionTime" IS DISTINCT FROM OLD."predictionTime" THEN changed := changed || 'predictionTime '; END IF;
  IF NEW."modelVersion"   IS DISTINCT FROM OLD."modelVersion"   THEN changed := changed || 'modelVersion ';   END IF;
  IF NEW."confidence"     IS DISTINCT FROM OLD."confidence"     THEN changed := changed || 'confidence ';     END IF;
  IF NEW."odds"           IS DISTINCT FROM OLD."odds"           THEN changed := changed || 'odds ';           END IF;
  IF NEW."oddsCapturedAt" IS DISTINCT FROM OLD."oddsCapturedAt" THEN changed := changed || 'oddsCapturedAt '; END IF;
  IF NEW."id"             IS DISTINCT FROM OLD."id"             THEN changed := changed || 'id ';             END IF;
  IF NEW."createdAt"      IS DISTINCT FROM OLD."createdAt"      THEN changed := changed || 'createdAt ';      END IF;

  IF changed <> '' THEN
    RAISE EXCEPTION 'VOLTRIX §20bis : prédiction figée (id=%) — colonnes non mutables : %', OLD."id", changed;
  END IF;

  -- 2) Porte à sens unique : resolved/result/closingOdds ne bougent que
  --    PENDANT la résolution (OLD.resolved = false). Une ligne résolue
  --    est un dossier clos : plus AUCUNE modification, jamais.
  IF OLD."resolved" AND (
       NEW."resolved"       IS DISTINCT FROM OLD."resolved"
    OR NEW."result"         IS DISTINCT FROM OLD."result"
    OR NEW."closingOdds"    IS DISTINCT FROM OLD."closingOdds"
  ) THEN
    RAISE EXCEPTION 'VOLTRIX §20bis : ligne résolue = dossier clos (id=%) — résolution définitive', OLD."id";
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;`;

export const FREEZE_STATEMENTS: string[] = [
  FREEZE_FN,
  `DROP TRIGGER IF EXISTS "Prediction_freeze_update" ON "Prediction";`,
  `CREATE TRIGGER "Prediction_freeze_update" BEFORE UPDATE ON "Prediction" FOR EACH ROW EXECUTE FUNCTION voltrix_prediction_freeze_guard();`,
  `DROP TRIGGER IF EXISTS "Prediction_freeze_delete" ON "Prediction";`,
  `CREATE TRIGGER "Prediction_freeze_delete" BEFORE DELETE ON "Prediction" FOR EACH ROW EXECUTE FUNCTION voltrix_prediction_freeze_guard();`,
];
