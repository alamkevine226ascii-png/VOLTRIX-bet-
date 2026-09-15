// Vérifie le grading de /api/bankroll/resolve sur des pronos déjà résolus dans la DB
import { db } from '../src/lib/db';

const preds = await db.prediction.findMany({
  where: { resolved: true, result: { in: ['WIN', 'LOSE'] } },
  orderBy: { matchDate: 'desc' },
  take: 36,
});
console.log(`DB: ${preds.length} pronos résolus trouvés`);
const legs = preds.map((p) => {
  const d = new Date(p.matchDate);
  const dateISO = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  let pick = p.pick;
  if (p.market === '1X2') {
    pick = p.pick.startsWith('1') ? `Victoire ${p.homeTeam}` : p.pick.startsWith('2') ? `Victoire ${p.awayTeam}` : 'Match nul';
  } else if (p.market === 'O/U 2.5') {
    pick = p.pick.startsWith('Plus') ? 'Plus de 2.5 buts' : 'Moins de 2.5 buts';
  } else if (p.market === 'BTTS') {
    pick = `Les 2 équipes marquent : ${p.pick}`;
  }
  return { matchId: p.matchId, leagueCode: p.league, matchDate: dateISO, market: p.market, pick, expected: p.result };
});
const res = await fetch('http://localhost:3000/api/bankroll/resolve', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ legs }),
});
const json = await res.json();
const key = (m: string, p: string, id: string) => `${id}|${m}|${p}`;
let ok = 0;
let ko = 0;
for (const l of legs) {
  const v = (json.results as Array<{ matchId: string; market: string; pick: string; status: string }>).find(
    (r) => key(r.market, r.pick, r.matchId) === key(l.market, l.pick, l.matchId)
  );
  const match = v && v.status === l.expected;
  if (match) ok++;
  else {
    ko++;
    console.log(`  divergence: ${l.market} "${l.pick}" attendu=${l.expected} obtenu=${v?.status ?? 'aucun'}`);
  }
}
console.log(`Grading : ${ok} concordants / ${ko} divergents sur ${legs.length}`);
process.exit(0);
