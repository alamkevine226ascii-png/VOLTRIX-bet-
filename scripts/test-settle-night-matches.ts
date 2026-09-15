// ============================================================
// Task 19-a — Règlement des matchs nocturnes (00h-04h UTC) via
// /api/bankroll/resolve : preuve E2E du correctif finding ②.
// Les 3 jambes ci-dessous sont des matchs MLS réels du 2026-09-10
// à 00h30/02h30 UTC (classés par ESPN sur la feuille scoreboard
// du 2026-09-09). AVANT correctif : PENDING à vie. APRÈS : verdicts.
// Exécuter : bun scripts/test-settle-night-matches.ts
// ============================================================

const BASE = 'http://localhost:3000';

const LEGS = [
  { matchId: '761796', leagueCode: 'usa.1', matchDate: '2026-09-10T02:30Z', market: '1X2', pick: 'Match nul' },
  { matchId: '761797', leagueCode: 'usa.1', matchDate: '2026-09-10T02:30Z', market: 'O/U 2.5', pick: 'Plus de 2.5' },
  { matchId: '761794', leagueCode: 'usa.1', matchDate: '2026-09-10T00:30Z', market: 'BTTS', pick: 'Les 2 équipes marquent : Oui' },
];

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

const res = await fetch(`${BASE}/api/bankroll/resolve`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ legs: LEGS }),
});
const json = await res.json();
const results: Array<{ matchId: string; status: string; score: string | null }> = json.results ?? [];

console.log(`HTTP ${res.status} — ${results.length} verdicts`);
for (const r of results) console.log(`  ${r.matchId} → ${r.status} (${r.score})`);

for (const leg of LEGS) {
  const r = results.find((x) => x.matchId === leg.matchId);
  check(`jambe nocturne ${leg.matchId} trouvée (pas PENDING)`, !!r && r.status !== 'PENDING', r ? r.status : 'absente');
  check(`jambe nocturne ${leg.matchId} porte le score final`, !!r && r.score !== null, r?.score ?? 'null');
}

// Cohérence grading : 761796 = 2-2 → « Match nul » gagné
const v1 = results.find((x) => x.matchId === '761796');
if (v1?.score === '2 - 2') check('761796 (2-2) → Match nul = WIN', v1.status === 'WIN', v1.status);

console.log(`\n=== ${pass} OK / ${fail} KO ===`);
if (fail > 0) process.exit(1);
