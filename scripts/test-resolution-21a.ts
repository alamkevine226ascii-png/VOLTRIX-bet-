// ============================================================
// Task 21-a — non-régression résolution sur VRAIES données ESPN + DB réelle
//  - réinitialise les 3 pronos du match réel 401879295 (Aston Villa 0-1
//    Arsenal, eng.1, 2026-08-31), les re-résout via resolvePredictionsForDate
//    et vérifie 3× WIN (régression zéro vs scripts/test_resolution.ts historique) ;
//  - FIX 5 : le 1X2 est résolu par pickedTeamId (ID ESPN du vainqueur réel)
//    MÊME si le pick nommé désigne l'autre côté (priorité ID) ;
//  - FIX 2 : closingOdds est archivée à la résolution (cote de clôture ESPN
//    de la sélection) sans toucher à `odds` (utilisé par le ROI).
// Nettoyage : les lignes synthétiques (matchId test-*) sont supprimées en fin.
// ============================================================
import { PrismaClient } from '@prisma/client';
import { resolvePredictionsForDate } from '../src/lib/analyze';
import { fetchScoreboard } from '../src/lib/espn';

const db = new PrismaClient();
let pass = 0;
let fail = 0;
function check(label: string, cond: boolean, detail = '') {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

async function main() {
  const DATE = '2026-08-31';
  const MATCH_ID = '401879295'; // Aston Villa - Arsenal (réel, terminé)

  const board = await fetchScoreboard('eng.1', DATE);
  check('scoreboard eng.1 2026-08-31 disponible', !!board && board.events.length > 0);
  const mainEvent = board?.events.find((e) => e.id === MATCH_ID);
  check('match 401879295 trouvé et terminé', !!mainEvent && mainEvent.completed, mainEvent?.statusDetail);
  if (!mainEvent || !mainEvent.home || !mainEvent.away) return;

  const homeId = mainEvent.home.team.id;
  const awayId = mainEvent.away.team.id;
  const hs = mainEvent.home.score ?? -1;
  const as = mainEvent.away.score ?? -1;
  const actual = hs > as ? '1' : hs === as ? 'X' : '2';
  console.log(`  → ${mainEvent.home.team.displayName} ${hs}-${as} ${mainEvent.away.team.displayName} (ids ${homeId}/${awayId}, actual ${actual})`);

  // ---- 1) Réinitialisation + re-résolution des 3 pronos réels ----
  const rows = [
    { market: '1X2', pick: '2 - Arsenal', probability: 0.44, odds: 1.85, pickedTeamId: awayId, expected: 'WIN' },
    { market: 'O/U 2.5', pick: 'Moins de 2.5', probability: 0.58, odds: 1.7, pickedTeamId: null, expected: 'WIN' },
    { market: 'BTTS', pick: 'Non', probability: 0.55, odds: null, pickedTeamId: null, expected: 'WIN' },
  ];
  const stored: Array<{ id: string; matchId: string; league: string; market: string; pick: string; odds: number | null; pickedTeamId: string | null }> = [];
  for (const r of rows) {
    const row = await db.prediction.upsert({
      where: { matchId_market: { matchId: MATCH_ID, market: r.market } },
      create: {
        matchId: MATCH_ID,
        league: 'eng.1',
        leagueName: 'Premier League',
        matchDate: new Date('2026-08-31T19:00:00Z'),
        homeTeam: mainEvent.home.team.displayName,
        awayTeam: mainEvent.away.team.displayName,
        market: r.market,
        pick: r.pick,
        probability: r.probability,
        odds: r.odds,
        pickedTeamId: r.pickedTeamId,
        oddsCapturedAt: new Date(),
        confidence: 4,
      },
      update: { resolved: false, result: null, pickedTeamId: r.pickedTeamId },
    });
    stored.push({ id: row.id, matchId: MATCH_ID, league: 'eng.1', market: r.market, pick: r.pick, odds: r.odds, pickedTeamId: r.pickedTeamId });
  }

  const resolvedCount = await resolvePredictionsForDate(DATE, stored, db);
  check('resolvePredictionsForDate → 3 pronos réglés', resolvedCount === 3, `got ${resolvedCount}`);

  const after = await db.prediction.findMany({ where: { matchId: MATCH_ID } });
  for (const r of rows) {
    const a = after.find((p) => p.market === r.market);
    check(`${r.market} "${r.pick}" → ${r.expected} (non-régression)`, a?.result === r.expected && a?.resolved === true, `got ${a?.result}`);
  }
  const row1x2 = after.find((p) => p.market === '1X2');
  check('pickedTeamId persisté (1X2)', row1x2?.pickedTeamId === awayId, `got ${row1x2?.pickedTeamId}`);
  const closeOddsAvailable =
    mainEvent.odds != null &&
    (actual === '1' ? mainEvent.odds.moneyline.home.close : actual === '2' ? mainEvent.odds.moneyline.away.close : mainEvent.odds.moneyline.draw.close) != null;
  const expectedClose = closeOddsAvailable
    ? actual === '1'
      ? mainEvent.odds!.moneyline.home.close
      : actual === '2'
        ? mainEvent.odds!.moneyline.away.close
        : mainEvent.odds!.moneyline.draw.close
    : null;
  if (closeOddsAvailable) {
    check(`closingOdds archivée à la résolution = cote clôture ESPN (${expectedClose})`, row1x2?.closingOdds === expectedClose, `got ${row1x2?.closingOdds}`);
    check('odds (pré-match) INTACTE — le ROI ne lit qu\'elle', row1x2?.odds === 1.85, `got ${row1x2?.odds}`);
  } else {
    check('closingOdds null (pas de cote de clôture publiée pour ce match)', row1x2?.closingOdds == null, `got ${row1x2?.closingOdds}`);
    console.log('  ℹ ESPN ne publie pas de cote de clôture sur cet événement — assertion d\'clôture couverte par scripts/test-void.ts [2]');
  }

  // ---- 2) FIX 5 : priorité de l'ID sur le côté nommé (lignes synthétiques, nettoyées) ----
  // Marché strictement « 1X2 » (seule valeur grada 1X2 par le résolveur) sur un
  // AUTRE vrai match terminé de la même journée (contrainte @@unique(matchId, market)).
  const secondEvent = board?.events.find((e) => e.completed && e.id !== MATCH_ID && e.home?.score != null && e.away?.score != null && e.home.score !== e.away.score);
  if (!secondEvent || !secondEvent.home || !secondEvent.away) {
    console.log('  ℹ pas de 2e match décisif terminé ce jour — tests de priorité ID sautés (couverts par scripts/test-void.ts [1c])');
  } else {
    const h2 = secondEvent.home;
    const a2 = secondEvent.away;
    const winnerIsHome = (h2.score ?? 0) > (a2.score ?? 0);
    const winnerId = winnerIsHome ? h2.team.id : a2.team.id;
    const loserId = winnerIsHome ? a2.team.id : h2.team.id;
    const loserSidePick = winnerIsHome ? `2 - ${a2.team.displayName}` : `1 - ${h2.team.displayName}`;
    const winnerSidePick = winnerIsHome ? `1 - ${h2.team.displayName}` : `2 - ${a2.team.displayName}`;
    console.log(`  → 2e match : ${secondEvent.shortName} ${h2.score}-${a2.score} (vainqueur id ${winnerId})`);
    const synthRows: Array<{ pick: string; pickedTeamId: string; expected: string }> = [
      // pick nommé côté PERDANT mais ID = VAINQUEUR → l'ID DOIT gagner (priorité sur le pick/nom)
      { pick: loserSidePick, pickedTeamId: winnerId, expected: 'WIN' },
      // ID = perdant (pick nommé perdant aussi) → LOSE
      { pick: loserSidePick, pickedTeamId: loserId, expected: 'LOSE' },
      // ID inconnu → repli sur le côté encodé dans le pick (côté vainqueur) → WIN
      { pick: winnerSidePick, pickedTeamId: '999999', expected: 'WIN' },
    ];
    const synthStored: Array<{ id: string; matchId: string; league: string; market: string; pick: string; odds: number | null; pickedTeamId: string | null }> = [];
    const synthIds: string[] = [];
    for (let i = 0; i < synthRows.length; i++) {
      const s = synthRows[i];
      const row = await db.prediction.create({
        data: {
          matchId: secondEvent.id,
          league: 'eng.1',
          leagueName: 'Premier League',
          matchDate: new Date('2026-08-31T19:00:00Z'),
          homeTeam: h2.team.displayName,
          awayTeam: a2.team.displayName,
          market: '1X2',
          pick: s.pick,
          probability: 0.4,
          odds: null,
          pickedTeamId: s.pickedTeamId,
          confidence: 3,
        },
      });
      synthIds.push(row.id);
      synthStored.push({ id: row.id, matchId: secondEvent.id, league: 'eng.1', market: '1X2', pick: s.pick, odds: null, pickedTeamId: s.pickedTeamId });
    }
    await resolvePredictionsForDate(DATE, synthStored, db);
    const synthAfter = await db.prediction.findMany({ where: { id: { in: synthIds } } });
    for (let i = 0; i < synthRows.length; i++) {
      const a = synthAfter.find((p) => p.id === synthIds[i]);
      check(`priorité ID [${i}] pick "${synthRows[i].pick}" + ID ${synthRows[i].pickedTeamId} → ${synthRows[i].expected}`,
        a?.result === synthRows[i].expected, `got ${a?.result}`);
    }
    // Nettoyage des lignes synthétiques
    await db.prediction.deleteMany({ where: { id: { in: synthIds } } });
    const remaining = await db.prediction.count({ where: { id: { in: synthIds } } });
    check('lignes synthétiques nettoyées', remaining === 0);
  }

  console.log(`\n=== ${pass} OK / ${fail} KO ===`);
  if (fail > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
