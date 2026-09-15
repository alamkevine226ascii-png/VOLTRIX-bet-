// ============================================================
// Task 21-a (FIX 6) — saisons calendaires vs calendrier européen
// Assertions pures sur currentSeasonYear (src/lib/analyze.ts).
// Validation empirique amont (curl ESPN réel, Task 21-a) :
//  - MLS usa.1, équipe 21812 (St. Louis CITY SC) : /teams/21812/schedule?season=2026
//    → 24 matchs du 2026-02-21 au 2026-09-10 (février 2026 INCLUS = saison 2026)
//    ; season=2025 → 34 matchs 2025-02-23..2025-10-19 (aucun en 2026).
//  - eng.1, équipe 360 (Manchester United) : season=2025 → 38 matchs
//    2025-08-17..2026-05-24 (février 2026 INCLUS = saison 2025) ;
//    season=2026 → matchs à partir du 2026-08-22 uniquement.
// Exécuter : bun scripts/test-seasons.ts
// ============================================================
import { currentSeasonYear } from '../src/lib/analyze';

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

console.log('\n[1] Ligue à saison calendaire (MLS = fév→oct de l\'année N)');
check('MLS 2026-02-21 → saison 2026 (ANCIEN code : 2025 ✗)', currentSeasonYear('2026-02-21T19:30Z', 'usa.1') === 2026);
check('MLS 2026-03-07 → 2026', currentSeasonYear('2026-03-07T23:00Z', 'usa.1') === 2026);
check('NWSL 2026-03-15 → 2026', currentSeasonYear('2026-03-15T18:00Z', 'usa.nwsl') === 2026);
check('Brésil bra.1 2026-04-12 → 2026', currentSeasonYear('2026-04-12T21:00Z', 'bra.1') === 2026);
check('Argentine arg.1 2026-01-25 → 2026', currentSeasonYear('2026-01-25T00:30Z', 'arg.1') === 2026);
check('Japon jpn.1 2026-02-14 → 2026', currentSeasonYear('2026-02-14T10:00Z', 'jpn.1') === 2026);
check('Corée kor.1 2026-05-03 → 2026', currentSeasonYear('2026-05-03T10:30Z', 'kor.1') === 2026);
check('Chine chn.1 2026-06-20 → 2026', currentSeasonYear('2026-06-20T11:35Z', 'chn.1') === 2026);
check('Norvège nor.1 2026-04-01 → 2026', currentSeasonYear('2026-04-01T17:00Z', 'nor.1') === 2026);
check('Suède swe.1 2026-03-30 → 2026', currentSeasonYear('2026-03-30T17:30Z', 'swe.1') === 2026);
check('Finlande fin.1 2026-04-08 → 2026', currentSeasonYear('2026-04-08T16:00Z', 'fin.1') === 2026);
check('Irlande irl.1 2026-02-27 → 2026', currentSeasonYear('2026-02-27T19:45Z', 'irl.1') === 2026);
check('MLS 2026-10-24 (fin de saison) → 2026', currentSeasonYear('2026-10-24T23:00Z', 'usa.1') === 2026);

console.log('\n[2] Calendrier européen août→mai : règle mois ≥ 7 inchangée');
check('eng.1 2026-02-07 → saison 2025 (2025-26)', currentSeasonYear('2026-02-07T12:30Z', 'eng.1') === 2025);
check('eng.1 2026-05-24 → saison 2025', currentSeasonYear('2026-05-24T15:00Z', 'eng.1') === 2025);
check('eng.1 2026-08-22 → saison 2026 (reprise)', currentSeasonYear('2026-08-22T11:30Z', 'eng.1') === 2026);
check('esp.1 2026-12-31 → saison 2026', currentSeasonYear('2026-12-31T20:00Z', 'esp.1') === 2026);
check('esp.1 2027-01-03 → saison 2026 (année-1 en janv-juin)', currentSeasonYear('2027-01-03T17:30Z', 'esp.1') === 2026);
check('uefa.champions 2026-09-16 → 2026', currentSeasonYear('2026-09-16T19:00Z', 'uefa.champions') === 2026);
check('fra.1 2026-06-01 → saison 2025 (fin 2025-26)', currentSeasonYear('2026-06-01T19:00Z', 'fra.1') === 2025);

console.log(`\n=== ${pass} OK / ${fail} KO ===`);
if (fail > 0) process.exit(1);
