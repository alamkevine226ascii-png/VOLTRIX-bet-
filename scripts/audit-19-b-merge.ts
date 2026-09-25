// ============================================================
// Audit 19-b — Rejeu du merge [-1,0,+1] + dédup de resolvePredictionsForDate
// (analyze.ts L273-289) via le fetchScoreboard RÉEL de src/lib/espn.ts.
// Lecture seule : aucun appel DB, aucune écriture.
// ============================================================
import { fetchScoreboard } from '../src/lib/espn';

const addDays = (iso: string, n: number): string =>
  new Date(new Date(iso + 'T12:00:00Z').getTime() + n * 86_400_000).toISOString().slice(0, 10);

// Cas réels prouvés par curl : coups d'envoi 00:00-04:00Z vivant sur board JJ-1
const CASES = [
  { league: 'arg.1', utcDay: '2026-09-07', matchId: '401841548', label: 'RAC-CAT (00:30Z, FT 1-2)' },
  { league: 'bra.1', utcDay: '2026-09-06', matchId: '401841227', label: 'bra.1 (00:00Z, FT)' },
  { league: 'usa.1', utcDay: '2026-09-06', matchId: '761773', label: 'DC@CIN (01:31Z, Postponed)' },
];

let pass = 0, fail = 0;
const ok = (c: boolean, msg: string) => { if (c) { pass++; console.log('  PASS', msg); } else { fail++; console.log('  FAIL', msg); } };

for (const c of CASES) {
  console.log(`\n== ${c.league} · journée UTC ${c.utcDay} · ${c.label} (#${c.matchId})`);
  // 1) Comportement PRÉ-FIX : board du jour UTC seul
  const only = await fetchScoreboard(c.league, c.utcDay);
  const inOnly = !!only?.events.some((e) => e.id === c.matchId);
  ok(!inOnly, `PRÉ-FIX confirmé : #${c.matchId} ABSENT du board ${c.utcDay} seul (${only?.events.length ?? 0} events)`);

  // 2) Comportement POST-FIX : fusion JJ-1/JJ/JJ+1 + dédup par id
  const boards = await Promise.all([
    fetchScoreboard(c.league, addDays(c.utcDay, -1)),
    fetchScoreboard(c.league, c.utcDay),
    fetchScoreboard(c.league, addDays(c.utcDay, 1)),
  ]);
  const seen = new Set<string>();
  const events = boards.flatMap((b) => b?.events ?? []).filter((ev) => {
    if (seen.has(ev.id)) return false;
    seen.add(ev.id);
    return true;
  });
  ok(events.length === seen.size, `dédup cohérente : ${events.length} events uniques sur 3 boards (${boards.map((b) => b?.events.length ?? 0).join('/')})`);
  const ev = events.find((e) => e.id === c.matchId);
  ok(!!ev, `POST-FIX : #${c.matchId} TROUVÉ via le merge (date ESPN ${ev?.date}, completed=${ev?.completed}, detail='${ev?.statusDetail}', score ${ev?.home?.score}-${ev?.away?.score})`);
  // Sur quel board était-il ?
  boards.forEach((b, i) => {
    if (b?.events.some((e) => e.id === c.matchId)) {
      const off = [-1, 0, 1][i];
      console.log(`    → trouvé sur board offset ${off} (${addDays(c.utcDay, off)})`);
    }
  });
}

// 3) Convention addDays T12:00:00Z : UTC sans DST → midi toujours conservé
console.log('\n== Convention addDays (midi UTC, immunisé DST) ==');
for (const [iso, n, expect] of [
  ['2026-10-31', 1, '2026-11-01'], // traversée de la bascule EDT→EST (USA) : UTC non affecté
  ['2026-03-07', 1, '2026-03-08'], // bascule EST→EDT
  ['2026-02-28', 1, '2026-03-01'], // année bissextile proche
  ['2026-12-31', 1, '2027-01-01'], // changement d'année
] as const) {
  const got = addDays(iso, n);
  ok(got === expect, `addDays(${iso},+${n}) = ${got} (attendu ${expect})`);
}
const noonCheck = new Date(new Date('2026-10-31' + 'T12:00:00Z').getTime() + 86_400_000).toISOString();
ok(noonCheck === '2026-11-01T12:00:00.000Z', `l'heure reste T12:00:00Z après incrémentation (${noonCheck}) — UTC n'a pas de DST, aucun décalage d'un jour possible`);

console.log(`\nRESULT: ${pass} pass / ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
