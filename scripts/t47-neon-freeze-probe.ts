// ============================================================
// VOLTRIX — Task 47 : SONDE FREEZE §20bis sur NEON RÉEL
//
// Prouve que la garde Prediction est OPÉRATIONNELLE en production :
//   - UPDATE d'une colonne figée → REJETÉ par le trigger ;
//   - DELETE d'une ligne → REJETÉ par le trigger.
// SÉCURITÉ ABSOLUE : chaque sonde tourne dans une transaction
// systématiquement ROLLBACK-ée (exception sentinelle) — même si la
// garde était absente, AUCUNE mutation ne pourrait subsister.
//
// Usage : DATABASE_URL="postgresql://…neon…" bun scripts/t47-neon-freeze-probe.ts
// ============================================================

import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

if (!process.env.DATABASE_URL?.includes('neon.tech')) {
  console.error('✗ DATABASE_URL ne pointe pas vers Neon — abandon (garde-fou production)');
  process.exit(1);
}

class ProbeDone extends Error {
  constructor(public rejected: boolean) {
    super('PROBE_EXPECTED');
  }
}

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function probe(query: string): Promise<{ rejected: boolean; msg: string }> {
  let rejected = true;
  let msg = '';
  try {
    await db.$transaction(async (tx) => {
      try {
        await tx.$executeRawUnsafe(query);
        rejected = false; // la garde n'a PAS rejeté → anomalie
      } catch (e) {
        msg = e instanceof Error ? e.message : String(e);
        rejected = true; // rejet attendu (trigger §20bis)
      }
      throw new ProbeDone(rejected); // ROLLBACK systématique — zéro résidu
    });
  } catch (e) {
    if (!(e instanceof ProbeDone)) throw e;
  }
  return { rejected, msg };
}

async function main() {
  // Ligne d'exemple (la plus ancienne — jamais utilisée par l'app courant)
  const row = await db.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id FROM "Prediction" ORDER BY "createdAt" ASC LIMIT 1;`
  );
  if (row.length === 0) {
    console.error('✗ aucune ligne Prediction sur Neon');
    process.exit(1);
  }
  const id = row[0].id;
  console.log(`━ sonde sur Prediction id=${id} (transactions ROLLBACK-ées — zéro risque) ━`);

  // 1) UPDATE d'une colonne figée → doit être rejeté
  const up = await probe(`UPDATE "Prediction" SET "confidence" = "confidence" + 1 WHERE id = '${id}';`);
  check('UPDATE figé REJETÉ par Prediction_freeze_update', up.rejected, up.msg.slice(0, 140));
  if (up.rejected) console.log(`    ↳ message: ${up.msg.split('\n')[0].slice(0, 120)}`);

  // 2) DELETE → doit TOUJOURS être rejeté
  const del = await probe(`DELETE FROM "Prediction" WHERE id = '${id}';`);
  check('DELETE REJETÉ par Prediction_freeze_delete', del.rejected, del.msg.slice(0, 140));
  if (del.rejected) console.log(`    ↳ message: ${del.msg.split('\n')[0].slice(0, 120)}`);

  // 3) La ligne ciblée est TOUJOURS intacte (les sondes ont été rollbackées)
  const after = await db.$queryRawUnsafe<Array<{ n: bigint }>>(
    `SELECT count(*)::bigint AS n FROM "Prediction" WHERE id = '${id}';`
  );
  check('ligne sonde INTACTE (aucune mutation subsistante)', Number(after[0].n) === 1, `${after[0].n} ligne`);

  console.log(`\n${pass} PASS / ${fail} FAIL`);
  if (fail > 0) process.exit(1);
  console.log('✓✓ FREEZE §20bis OPÉRATIONNEL SUR NEON RÉEL');
}

main()
  .catch((e) => {
    console.error('✗', e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
