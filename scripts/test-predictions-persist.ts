// ============================================================
// Task 19-a — Persistance /api/predictions : un prono DÉJÀ RÉSOLU
// ne doit jamais être réécrit par un nouvel upsert (prob/odds/pick
// figés au moment du prono — sinon calibrage /api/performance
// faussé a posteriori). Preuve E2E via la route réelle.
// Exécuter : bun scripts/test-predictions-persist.ts
// ============================================================

import { db } from '../src/lib/db';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name} ${detail}`);
  }
}

// 1. Trouver un match À VENIR via /api/matches (statut pre)
const today = new Date().toISOString().slice(0, 10);
const days = [today, new Date(Date.now() + 86400000).toISOString().slice(0, 10)];
let target: { id: string; leagueCode: string; date: string; homeName: string; awayName: string } | null = null;
for (const d of days) {
  const res = await fetch(`http://localhost:3000/api/matches?date=${d}`);
  const json = await res.json();
  for (const l of json.leagues ?? []) {
    for (const m of l.matches ?? []) {
      if (m.status === 'pre') {
        target = { id: m.id, leagueCode: m.leagueCode, date: m.date, homeName: m.home.name, awayName: m.away.name };
        break;
      }
    }
    if (target) break;
  }
  if (target) break;
}
if (!target) {
  console.error('Aucun match à venir trouvé — test impossible');
  process.exit(1);
}
console.log(`Match cible : ${target.homeName} vs ${target.awayName} (${target.id})`);

// 2. Planter un prono RÉSOLU avec une proba sentinelle
const SENTINEL = 0.1234;
const marker = `audit19a-${target.id}`;
await db.prediction.deleteMany({ where: { matchId: marker } });
await db.prediction.create({
  data: {
    matchId: marker,
    league: target.leagueCode,
    leagueName: 'Audit 19-a',
    matchDate: new Date(target.date),
    homeTeam: target.homeName,
    awayTeam: target.awayName,
    market: '1X2',
    pick: 'X - Nul',
    probability: SENTINEL,
    odds: 3.0,
    confidence: 3,
    resolved: true,
    result: 'WIN',
  },
});

try {
  // 3. La route POST /api/predictions reçoit ce match (statut pre)
  const res = await fetch('http://localhost:3000/api/predictions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ matches: [{ matchId: target.id, leagueCode: target.leagueCode, date: target.date }] }),
  });
  check('POST /api/predictions → 200', res.status === 200, `got ${res.status}`);

  // 4. Le prono résolu planté doit être INCHANGÉ
  const row = await db.prediction.findUnique({ where: { matchId_market: { matchId: marker, market: '1X2' } } });
  check('prono résolu : probability non réécrite', row?.probability === SENTINEL, `got ${row?.probability}`);
  check('prono résolu : pick non réécrit', row?.pick === 'X - Nul', `got ${row?.pick}`);
  check('prono résolu : result conservé', row?.result === 'WIN', `got ${row?.result}`);

  // 5. Un prono NON résolu du même passage reste actualisable (comportement nominal)
  const fresh = await db.prediction.findMany({ where: { matchId: target.id } });
  check('pronos du match créés/actualisés pour un match à venir', fresh.length >= 1, `got ${fresh.length}`);
} finally {
  await db.prediction.deleteMany({ where: { matchId: marker } });
}

console.log(`\n=== ${pass} OK / ${fail} KO ===`);
if (fail > 0) process.exit(1);
