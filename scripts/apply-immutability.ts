// ============================================================
// VOLTRIX — Task 28 §20 : IMMUTABILITÉ DES PRÉDICTIONS (PostgreSQL)
//
// « Une prédiction doit être figée au moment où elle est créée.
//  Si le modèle recalcule une nouvelle prédiction : NOUVEAU SNAPSHOT,
//  et non UPDATE de l'ancienne prédiction. »
//
// Application concrète : triggers PostgreSQL qui REJETTENT tout
// UPDATE/DELETE sur les tables de prédiction figées :
//   - "PredictionSnapshot" / "PredictionMarket" / "PredictionOutcome"
//     / "PredictionComponent"  (architecture générique Task 28)
//   - "ForecastSnapshot"       (prévisions hebdomadaires Task 25,
//     déjà insert-only dans le code — verrouillé en base maintenant)
//
// Idempotent : ré-exécutable sans erreur (DROP TRIGGER IF EXISTS).
// Usage : bun scripts/apply-immutability.ts
// ============================================================

import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

const FN = `
CREATE OR REPLACE FUNCTION voltrix_forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'VOLTRIX §20 : % est immuable (insert-only) — créer un NOUVEAU snapshot au lieu de modifier', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;
`;

const TABLES = ['PredictionSnapshot', 'PredictionMarket', 'PredictionOutcome', 'PredictionComponent', 'ForecastSnapshot'];

async function main() {
  console.log('→ Création fonction voltrix_forbid_mutation()…');
  await db.$executeRawUnsafe(FN);

  for (const table of TABLES) {
    for (const action of ['UPDATE', 'DELETE']) {
      const name = `${table}_no_${action.toLowerCase()}`;
      await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${name}" ON "${table}";`);
      await db.$executeRawUnsafe(
        `CREATE TRIGGER "${name}" BEFORE ${action} ON "${table}" FOR EACH ROW EXECUTE FUNCTION voltrix_forbid_mutation();`
      );
    }
    console.log(`  ✓ ${table} : UPDATE + DELETE interdits`);
  }

  // Vérification : liste des triggers posés
  const rows = await db.$queryRawUnsafe<Array<{ tgname: string; relname: string }>>(
    `SELECT t.tgname, c.relname FROM pg_trigger t JOIN pg_class c ON t.tgrelid = c.oid WHERE t.tgname LIKE '%_no_%' ORDER BY c.relname, t.tgname;`
  );
  console.log(`→ ${rows.length} triggers actifs :`);
  for (const r of rows) console.log(`  - ${r.relname} :: ${r.tgname}`);
}

main()
  .then(() => console.log('✓ Immutabilité §20 appliquée'))
  .catch((e) => {
    console.error('✗ Erreur:', e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
