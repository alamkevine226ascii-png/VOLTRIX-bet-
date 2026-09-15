// ============================================================
// Task 21-a (FIX 4 + FIX 5 + FIX 2) — tests d'intégrité du grading
//  1) gradeEvent : annulé/reporté/suspendu → VOID (jamais PENDING à vie),
//     événement normal inchangé ; résolution 1X2 par ID équipe ESPN en
//     priorité, repli sur le nom (rétrocompatibilité).
//  2) resolvePredictionsForDate (avec mock ESPN) : VOID écrit en DB,
//     closingOdds capturée à la résolution, repli silencieux si le client
//     Prisma ne connaît pas la colonne (serveur long-running).
// 100 % hors serveur : réseau ESPN simulé, DB simulée (recorder).
// ============================================================
// @ts-ignore — 'bun:test' n'est pas déclaré dans tsconfig types (runtime Bun uniquement)
import { mock } from 'bun:test';

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

// ---------- Fixtures ESPN synthétiques (shapes réels observés) ----------
function team(id: string, displayName: string) {
  return { id, name: displayName, displayName, shortDisplayName: displayName, abbreviation: '', logo: null };
}
function competitor(id: string, name: string, score: number | null) {
  return { homeAway: 'home' as const, team: team(id, name), score, winner: null, form: null, recordSummary: null };
}
function ev(partial: {
  id: string;
  completed: boolean;
  statusDetail: string;
  homeScore?: number | null;
  awayScore?: number | null;
  homeId?: string;
  homeName?: string;
  awayId?: string;
  awayName?: string;
  odds?: unknown;
}) {
  return {
    id: partial.id,
    date: '2026-09-01T19:00Z',
    name: `${partial.homeName} vs ${partial.awayName}`,
    shortName: 'TST v TST',
    status: partial.completed ? ('post' as const) : ('in' as const),
    statusDetail: partial.statusDetail,
    completed: partial.completed,
    venue: { name: null, city: null, country: null },
    home: competitor(partial.homeId ?? '363', partial.homeName ?? 'Chelsea', partial.homeScore ?? null),
    away: competitor(partial.awayId ?? '42', partial.awayName ?? 'Arsenal', partial.awayScore ?? null),
    odds: (partial.odds ?? null) as never,
  };
}
const CHELSEA = '363';
const ARSENAL = '42';
// Match normal terminé : Chelsea 1 - 2 Arsenal
const finished = (odds?: unknown) =>
  ev({
    id: '9002',
    completed: true,
    statusDetail: 'FT',
    homeScore: 1,
    awayScore: 2,
    homeId: CHELSEA,
    homeName: 'Chelsea',
    awayId: ARSENAL,
    awayName: 'Arsenal',
    odds,
  });

// ---------- Partie 1 : gradeEvent (pur) ----------
console.log('\n[1] gradeEvent — annulation/report → VOID (FIX 4)');
{
  const { gradeEvent } = await import('../src/lib/grade');
  const leg1x2 = { matchId: '9001', market: '1X2', pick: 'Victoire Arsenal' };
  const legOU = { matchId: '9001', market: 'O/U 2.5', pick: 'Plus de 2.5' };
  const legBTTS = { matchId: '9001', market: 'BTTS', pick: 'Oui' };

  const voidDetails = [
    'Postponed', // STATUS_POSTPONED
    'Postponed - Waterlogged pitch',
    'Cancelled', // variante britannique
    'Canceled', // variante US ESPN
    'Suspended', // STATUS_SUSPENDED
    'Delayed', // STATUS_DELAYED
    'Abandoned', // abandon
    'Forfeited', // STATUS_FORFEITED
  ];
  for (const d of voidDetails) {
    const canceled = ev({ id: '9001', completed: false, statusDetail: d });
    check(`"${d}" → VOID (1X2)`, gradeEvent(leg1x2, canceled).status === 'VOID');
  }
  check('annulé → VOID (O/U)', gradeEvent(legOU, ev({ id: '9001', completed: false, statusDetail: 'Postponed' })).status === 'VOID');
  check('annulé → VOID (BTTS)', gradeEvent(legBTTS, ev({ id: '9001', completed: false, statusDetail: 'Postponed' })).status === 'VOID');

  console.log('\n[1b] gradeEvent — pas de faux positif sur les statuts RÉELS observés');
  const normalDetails: Array<[string, 'PENDING' | 'WIN' | 'LOSE']> = [
    ["Sat, September 12th at 8:30 PM EDT", 'PENDING'], // STATUS_SCHEDULED (pré-match)
    ["45'+2", 'PENDING'], // STATUS_FIRST_HALF / IN_PROGRESS
    ['HT', 'PENDING'], // STATUS_HALFTIME
  ];
  for (const [d, expected] of normalDetails) {
    const notDone = ev({ id: '9001', completed: false, statusDetail: d });
    check(`"${d}" → ${expected} (jamais VOID)`, gradeEvent(leg1x2, notDone).status === expected);
  }
  // terminé normal : "FT" — verdict inchangé
  check('FT normal → verdict normal (Victoire Arsenal 1-2 = WIN)', gradeEvent(leg1x2, finished()).status === 'WIN');

  console.log('\n[1c] gradeEvent — 1X2 par ID équipe en priorité (FIX 5)');
  check('ID Arsenal (42) + pick Victoire Arsenal → WIN', gradeEvent({ ...leg1x2, pickedTeamId: ARSENAL }, finished()).status === 'WIN');
  check('ID Chelsea (363) + pick Victoire Arsenal → LOSE (ID prioritaire sur le nom)',
    gradeEvent({ ...leg1x2, pickedTeamId: CHELSEA }, finished()).status === 'LOSE');
  // Fragilité historique du nom : deux équipes au nom proche — l'ID tranche
  const nearName = ev({
    id: '9004', completed: true, statusDetail: 'FT', homeScore: 0, awayScore: 1,
    homeId: '111', homeName: 'Manchester United', awayId: '222', awayName: 'Manchester City',
  });
  check('noms proches (United/City) : ID City → WIN',
    gradeEvent({ matchId: '9004', market: '1X2', pick: 'Victoire Manchester City', pickedTeamId: '222' }, nearName).status === 'WIN');
  check('noms proches : ID United → LOSE',
    gradeEvent({ matchId: '9004', market: '1X2', pick: 'Victoire Manchester City', pickedTeamId: '111' }, nearName).status === 'LOSE');

  console.log('\n[1d] gradeEvent — repli sur le nom (lignes existantes sans ID)');
  check('nom exact sans pickedTeamId → WIN', gradeEvent(leg1x2, finished()).status === 'WIN');
  check('nom partiel (includes) sans pickedTeamId → WIN',
    gradeEvent({ matchId: '9002', market: '1X2', pick: 'Victoire Arsenal FC' }, finished()).status === 'WIN');
  check('ID inconnu des deux côtés → repli nom',
    gradeEvent({ ...leg1x2, pickedTeamId: '99999' }, finished()).status === 'WIN');
  check('nom inconnu sans ID → PENDING (on ne devine pas)',
    gradeEvent({ matchId: '9002', market: '1X2', pick: 'Victoire Tottenham' }, finished()).status === 'PENDING');
  check('Match nul 1-2 → LOSE', gradeEvent({ matchId: '9002', market: '1X2', pick: 'Match nul' }, finished()).status === 'LOSE');
}

// ---------- Partie 2 : resolvePredictionsForDate (mock ESPN + recorder DB) ----------
console.log('\n[2] resolvePredictionsForDate — VOID, closingOdds, repli colonne manquante');
{
  const FAKE_ODDS = {
    provider: 'DraftKings',
    overUnderLine: 2.5,
    moneyline: {
      home: { open: 1.9, close: 1.95 },
      draw: { open: 3.5, close: 3.4 },
      away: { open: 3.9, close: 3.8 },
    },
    total: {
      over: { line: 2.5, openOdds: 1.75, closeOdds: 1.8 },
      under: { line: 2.5, openOdds: 2.05, closeOdds: 2.0 },
    },
    hasOdds: true,
  };
  // Scoreboard simulé : 9001 annulé · 9002 terminé 1-2 · 9003 en cours
  const fakeBoard = {
    leagueCode: 'tst.1',
    leagueName: 'Test League',
    seasonYear: 2026,
    events: [
      ev({ id: '9001', completed: false, statusDetail: 'Postponed', homeId: CHELSEA, awayId: ARSENAL }),
      finished(FAKE_ODDS),
      ev({ id: '9003', completed: false, statusDetail: "45'", homeScore: null, awayScore: null }),
    ],
  };
  // mock AVANT l'import d'analyze (qui référence ./espn → même chemin résolu)
  mock.module('/home/z/my-project/src/lib/espn.ts', () => ({
    fetchScoreboard: async (_league: string, _date: string) => ({ ...fakeBoard, events: [...fakeBoard.events] }),
    fetchTeamSchedule: async () => [],
    fetchStandings: async () => [],
    fetchInjuries: async () => [],
  }));

  const { resolvePredictionsForDate } = await import('../src/lib/analyze');
  type UpdateCall = { where: { id: string }; data: { resolved: boolean; result: string; closingOdds?: number | null } };

  function recorder(opts: { rejectClosingOdds?: boolean } = {}) {
    const calls: UpdateCall[] = [];
    return {
      calls,
      db: {
        prediction: {
          update: async (args: UpdateCall) => {
            if (opts.rejectClosingOdds && args.data.closingOdds !== undefined) {
              throw new Error('Unknown argument `closingOdds` (client Prisma ancien)');
            }
            calls.push(args);
            return {};
          },
        },
      },
    };
  }

  const stored = [
    { id: 'r1', matchId: '9001', league: 'tst.1', market: 'BTTS', pick: 'Oui', odds: null, pickedTeamId: null },
    { id: 'r2', matchId: '9002', league: 'tst.1', market: '1X2', pick: '1 - Chelsea', odds: 1.9, pickedTeamId: CHELSEA },
    { id: 'r3', matchId: '9002', league: 'tst.1', market: '1X2', pick: '2 - Arsenal', odds: 3.8, pickedTeamId: ARSENAL },
    { id: 'r4', matchId: '9002', league: 'tst.1', market: 'O/U 2.5', pick: 'Plus de 2.5', odds: 1.75, pickedTeamId: null },
    { id: 'r5', matchId: '9003', league: 'tst.1', market: 'BTTS', pick: 'Oui', odds: null, pickedTeamId: null },
  ];

  const r = recorder();
  const count = await resolvePredictionsForDate('2026-09-01', stored, r.db as never);
  const byId = new Map(r.calls.map((c) => [c.where.id, c.data]));

  // Rappel du fixture : Chelsea (dom) 1 - 2 Arsenal (ext) → total 3 buts
  check('resolvedCount = 4 (9001 VOID + 3 sur 9002 ; 9003 ignoré)', count === 4, `got ${count}`);
  check('annulé (r1) → VOID écrit', byId.get('r1')?.result === 'VOID');
  check('1X2 par ID domicile (r2) → LOSE (domicile battu 1-2)', byId.get('r2')?.result === 'LOSE');
  check('1X2 par ID extérieur (r3) → WIN (extérieur gagne 2-1)', byId.get('r3')?.result === 'WIN');
  check('O/U Plus 2.5 (total 3) → WIN', byId.get('r4')?.result === 'WIN');
  check('en cours (r5) → AUCUNE écriture (reste PENDING)', !byId.has('r5'));
  check('closingOdds 1X2 domicile = cote close 1.95', byId.get('r2')?.closingOdds === 1.95);
  check('closingOdds 1X2 extérieur = cote close 3.8', byId.get('r3')?.closingOdds === 3.8);
  check('closingOdds O/U over = cote close 1.8', byId.get('r4')?.closingOdds === 1.8);
  check('VOID → closingOdds null (pas de cote exploitable)', byId.get('r1')?.closingOdds === null);

  console.log('\n[2b] resolvePredictionsForDate — client Prisma sans colonne closingOdds (repli silencieux)');
  const r2 = recorder({ rejectClosingOdds: true });
  const stored2 = stored.map((s) => ({ ...s, id: `${s.id}-b` }));
  const count2 = await resolvePredictionsForDate('2026-09-01', stored2, r2.db as never);
  const byId2 = new Map(r2.calls.map((c) => [c.where.id, c.data]));
  check('résolution inchangée malgré le repli (count = 4)', count2 === 4, `got ${count2}`);
  check('r2-b → LOSE écrit SANS closingOdds (fallback)', byId2.get('r2-b')?.result === 'LOSE' && !('closingOdds' in (byId2.get('r2-b') ?? {})));
  check('r1-b → VOID écrit SANS closingOdds (fallback)', byId2.get('r1-b')?.result === 'VOID');
}

console.log(`\n=== ${pass} OK / ${fail} KO ===`);
if (fail > 0) process.exit(1);
