// Audit 20-b — Chasse aux bugs : DOUBLE RATTACHEMENT / double grading dans
// resolvePredictionsForDate (src/lib/analyze.ts, code RÉEL importé), avec une
// fausse DB (compteur d'updates par id de prono) et des données ESPN réelles.
// Vérifie aussi : garde LIVE (match 'in' → 0 update), match futur vu par la
// passe 2 (→ 0 update), ligue ESPN-absente (0 update), et l'exactitude des verdicts.
import { resolvePredictionsForDate } from '../src/lib/analyze';

let failures = 0;
const check = (label: string, cond: boolean, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'} — ${label}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures++;
};

interface Stored { id: string; matchId: string; league: string; market: string; pick: string; odds: number | null }

function makeDb() {
  const calls: Record<string, number> = {};
  const results: Record<string, string> = {};
  return {
    calls,
    results,
    db: {
      prediction: {
        update: async (args: { where: { id: string }; data: { resolved: boolean; result: string } }) => {
          calls[args.where.id] = (calls[args.where.id] ?? 0) + 1;
          results[args.where.id] = args.data.result;
        },
      },
    },
  };
}

// ---------- Scénario 1 : ned.1 2026-09-05 (3 FT réels + Utrecht replanifié +3 j) ----------
console.log('=== 1. ned.1 2026-09-05 — 3 matchs FT + Utrecht replanifié (2e passe) ===');
// Boards réels : #401875620 NEC 1-3 Feyenoord (FT) · #401875618 Ajax 1-3 PSV (FT)
// · #401875617 Willem II 0-3 Excelsior (FT) · #401875619 Utrecht ABSENT (vit sur 0908, post+Suspended 1-3)
const stored1: Stored[] = [
  { id: 'p1', matchId: '401875620', league: 'ned.1', market: '1X2', pick: '2 - Feyenoord Rotterdam', odds: 2.1 }, // ext gagne 1-3 → WIN
  { id: 'p2', matchId: '401875620', league: 'ned.1', market: 'O/U 2.5', pick: 'Plus de 2.5', odds: 1.8 }, // 4 buts → WIN
  { id: 'p3', matchId: '401875618', league: 'ned.1', market: 'BTTS', pick: 'Oui', odds: null }, // 1-3 → WIN
  { id: 'p4', matchId: '401875617', league: 'ned.1', market: '1X2', pick: '1 - Willem II', odds: 3.2 }, // dom perd 0-3 → LOSE
  { id: 'p5', matchId: '401875617', league: 'ned.1', market: 'BTTS', pick: 'Non', odds: null }, // 0-3 → WIN
  { id: 'p6', matchId: '401875619', league: 'ned.1', market: '1X2', pick: '1 - FC Utrecht', odds: 2.15 }, // suspendu → VOID (pas LOSE sur 1-3 !)
  { id: 'p7', matchId: '401875619', league: 'ned.1', market: 'O/U 2.5', pick: 'Plus de 2.5', odds: 2.25 }, // suspendu → VOID
];
const s1 = makeDb();
const n1 = await resolvePredictionsForDate('2026-09-05', stored1, s1.db as Parameters<typeof resolvePredictionsForDate>[2]);
console.log(`resolvedCount=${n1} — updates par id : ${JSON.stringify(s1.calls)}`);
console.log(`verdicts : ${JSON.stringify(s1.results)}`);
check('resolvedCount = 7 (7 pronos, 1 update chacun)', n1 === 7, `n=${n1}`);
check('AUCUN id mis à jour plus d\'une fois (pas de double rattachement)', Object.values(s1.calls).every((c) => c === 1) && Object.keys(s1.calls).length === 7, JSON.stringify(s1.calls));
check('Utrecht (p6/p7) → VOID via 2e passe, jamais gradé sur le score figé 1-3', s1.results['p6'] === 'VOID' && s1.results['p7'] === 'VOID');
check('FT corrects : p1 WIN, p2 WIN, p3 WIN, p4 LOSE, p5 WIN', s1.results['p1'] === 'WIN' && s1.results['p2'] === 'WIN' && s1.results['p3'] === 'WIN' && s1.results['p4'] === 'LOSE' && s1.results['p5'] === 'WIN');

// Re-run sur les MÊMES stored (simule un drain immédiat sans filtre resolved:false)
console.log('— re-run immédiat sur les mêmes pronos (si le filtre resolved:false disparaissait) —');
const s1b = makeDb();
const n1b = await resolvePredictionsForDate('2026-09-05', stored1, s1b.db as Parameters<typeof resolvePredictionsForDate>[2]);
check('re-run : verdicts STABLES (VOID reste VOID, pas de bascule WIN/LOSE sur 1-3)', s1b.results['p6'] === 'VOID' && s1b.results['p1'] === 'WIN' && n1b === 7, `n=${n1b} ${JSON.stringify(s1b.results)}`);

// ---------- Scénario 2 : garde LIVE — match 'in' réel (usa.ncaa.m.1 #401898555) ----------
console.log('\n=== 2. Garde LIVE : match IN (ncaa #401898555, 0-0 en cours) → 0 update ===');
const stored2: Stored[] = [
  { id: 'live1', matchId: '401898555', league: 'usa.ncaa.m.1', market: '1X2', pick: 'X - Nul', odds: null },
  { id: 'live2', matchId: '401898555', league: 'usa.ncaa.m.1', market: 'BTTS', pick: 'Non', odds: null },
];
const s2 = makeDb();
const n2 = await resolvePredictionsForDate('2026-09-07', stored2, s2.db as Parameters<typeof resolvePredictionsForDate>[2]);
console.log(`resolvedCount=${n2} calls=${JSON.stringify(s2.calls)}`);
check('match EN DIRECT → aucun grading (0 update, 0 VOID fictif)', n2 === 0 && Object.keys(s2.calls).length === 0);

// ---------- Scénario 3 : match du FUTUR vu par la passe 2 (#401875636 board 0908, 16:45Z) ----------
console.log('\n=== 3. Match du futur atteint par la 2e passe (ned.1 #401875636, pre) → 0 update ===');
const stored3: Stored[] = [
  { id: 'fut1', matchId: '401875636', league: 'ned.1', market: '1X2', pick: 'X - Nul', odds: null },
];
const s3 = makeDb();
const n3 = await resolvePredictionsForDate('2026-09-05', stored3, s3.db as Parameters<typeof resolvePredictionsForDate>[2]);
console.log(`resolvedCount=${n3} calls=${JSON.stringify(s3.calls)}`);
check('match pre (coup d\'envoi futur) → aucune résolution prématurée', n3 === 0 && Object.keys(s3.calls).length === 0);

// ---------- Scénario 4 : ligue où le match est absent de tous les boards ±3 j (CAF 04/09) ----------
console.log('\n=== 4. CAF absent des boards (±3 j) → 0 update, reste PENDING ===');
const stored4: Stored[] = [
  { id: 'caf1', matchId: '401911598', league: 'caf.champions', market: '1X2', pick: '2 - Fomboni', odds: null },
];
const s4 = makeDb();
const n4 = await resolvePredictionsForDate('2026-09-04', stored4, s4.db as Parameters<typeof resolvePredictionsForDate>[2]);
console.log(`resolvedCount=${n4} calls=${JSON.stringify(s4.calls)}`);
check('match absent partout (passe 1 + passe 2 ±3) → 0 update, pas de VOID inventé', n4 === 0 && Object.keys(s4.calls).length === 0);

console.log(`\n=== audit-20-b-doublegrade : ${failures === 0 ? 'ALL PASS' : failures + ' FAIL'} ===`);
process.exit(failures === 0 ? 0 : 1);
