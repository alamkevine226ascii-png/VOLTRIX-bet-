// ============================================================
// VOLTRIX — Task 44 §20bis : pose de la protection DB « Prediction »
// (mire de scripts/apply-immutability.ts §20, Task 28).
//
// Pose :
//   - fonction voltrix_prediction_freeze_guard() (CREATE OR REPLACE) ;
//   - 2 triggers : Prediction_freeze_update (BEFORE UPDATE) +
//     Prediction_freeze_delete (BEFORE DELETE) — idempotent
//     (DROP TRIGGER IF EXISTS → ré-exécutable sans doublon).
//
// Contrat §20bis (design Task 43, GO utilisateur) :
//   payload de prédiction immuable (19 colonnes) ; DELETE interdit ;
//   résolution one-way resolved:false→true + result + closingOdds
//   autorisée uniquement avant résolution ; ligne résolue = dossier
//   clos. IS DISTINCT FROM partout (NULL-safe). Aucun backfill :
//   les lignes existantes gardent leurs valeurs (les NULL legacy
//   restent NULL — Task 22-a « jamais réétiquetées »).
//
// Cible = la DATABASE_URL ACTIVE de l'environnement d'exécution
// (Neon en production). Le .env local étant volontairement sans
// cred (post-leak), exécuter avec la DATABASE_URL Neon injectée
// hors-repo :  DATABASE_URL="postgresql://…" bun scripts/apply-prediction-freeze.ts
// Idempotent : relançable sans erreur, sans doublon de trigger.
// ============================================================

import { PrismaClient } from '@prisma/client';
import { FREEZE_STATEMENTS } from './prediction-freeze-sql';

const db = new PrismaClient();

async function main() {
  console.log('→ §20bis : pose de la garde Prediction (fonction + 2 triggers)…');
  for (const stmt of FREEZE_STATEMENTS) {
    await db.$executeRawUnsafe(stmt);
  }

  // Vérification : exactement 2 triggers freeze sur Prediction, pas de doublon
  const rows = await db.$queryRawUnsafe<Array<{ tgname: string; relname: string }>>(
    `SELECT t.tgname, c.relname
       FROM pg_trigger t
       JOIN pg_class c ON t.tgrelid = c.oid
      WHERE t.tgname LIKE 'Prediction_freeze_%' AND NOT t.tgisinternal
      ORDER BY c.relname, t.tgname;`
  );
  console.log(`→ ${rows.length} triggers freeze actifs sur Prediction :`);
  for (const r of rows) console.log(`  - ${r.relname} :: ${r.tgname}`);
  if (rows.length !== 2) {
    throw new Error(`§20bis : attendu exactement 2 triggers, trouvé ${rows.length}`);
  }

  // Vérification : la fonction existe une seule fois
  const fns = await db.$queryRawUnsafe<Array<{ cnt: bigint }>>(
    `SELECT count(*) AS cnt FROM pg_proc WHERE proname = 'voltrix_prediction_freeze_guard';`
  );
  console.log(`→ fonction voltrix_prediction_freeze_guard : ${Number(fns[0].cnt)} occurrence(s)`);
  if (Number(fns[0].cnt) !== 1) {
    throw new Error(`§20bis : attendu exactement 1 fonction, trouvé ${Number(fns[0].cnt)}`);
  }

  console.log('✓ §20bis appliqué — Prediction : payload figé, résolution one-way, DELETE interdit');
}

main()
  .then(() => console.log('✓ Protection Prediction §20bis en place'))
  .catch((e) => {
    console.error('✗ Erreur:', e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
