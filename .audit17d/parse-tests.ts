// Audit 17-d — vérifications numériques des parseurs de src/lib/espn.ts
// Les fonctions étant non exportées, elles sont copiées VERBATIM depuis espn.ts
// (lignes 131-219). Aucune modification de src/.

// ---------- COPIES VERBATIM (espn.ts) ----------
export function americanToDecimal(american: number | null | undefined): number | null {
  if (american === null || american === undefined || Number.isNaN(american)) return null;
  if (american > 0) return Math.round((1 + american / 100) * 100) / 100;
  if (american < 0) return Math.round((1 + 100 / Math.abs(american)) * 100) / 100;
  return 1.0;
}

function parseAmerican(str: unknown): number | null {
  if (typeof str !== 'string') return null;
  const n = parseInt(str.replace(/[+]/, ''), 10);
  if (Number.isNaN(n)) return null;
  // "+120" -> 120, "-145" -> -145
  return str.trim().startsWith('-') ? -Math.abs(n) : Math.abs(n);
}

function parseLine(line: unknown): number | null {
  if (typeof line !== 'string') return null;
  const n = parseFloat(line.replace(/[ouOU]/, ''));
  return Number.isNaN(n) ? null : n;
}

function parseScore(score: unknown): number | null {
  if (typeof score === 'object' && score !== null && 'value' in (score as Record<string, unknown>)) {
    const v = (score as { value?: number }).value;
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  }
  if (typeof score === 'number' && Number.isFinite(score)) return score;
  if (typeof score === 'string' && score.trim() !== '' && !Number.isNaN(parseInt(score, 10))) {
    return parseInt(score, 10);
  }
  return null;
}
// ---------- FIN COPIES ----------

let pass = 0;
let fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = Object.is(actual, expected);
  if (ok) { pass++; console.log(`  OK   ${name} -> ${String(actual)}`); }
  else { fail++; console.log(`  FAIL ${name} -> ${String(actual)} (attendu ${String(expected)})`); }
}

console.log('== americanToDecimal ==');
check('+120', americanToDecimal(120), 2.2);
check('-110', americanToDecimal(-110), 1.91); // 1+100/110 = 1.909090... arrondi 2dp
check('+100', americanToDecimal(100), 2.0);
check('-100', americanToDecimal(-100), 2.0);
check('0', americanToDecimal(0), 1.0);
check('null', americanToDecimal(null), null);
check('undefined', americanToDecimal(undefined), null);
check('NaN', americanToDecimal(NaN), null);
console.log('  valeur brute -110 non arrondie:', 1 + 100 / 110);
check('-235 (précision)', americanToDecimal(-235), Math.round((1 + 100 / 235) * 100) / 100);
check('+585', americanToDecimal(585), 6.85);
check('Infinity (edge) -> non finie', Number.isFinite(americanToDecimal(Infinity) as number), false);
check('-Infinity (edge) -> non finie', Number.isFinite(americanToDecimal(-Infinity) as number), false);

console.log('== parseAmerican ==');
check('"+120"', parseAmerican('+120'), 120);
check('"-145"', parseAmerican('-145'), -145);
check('"  +120 " (espaces)', parseAmerican('  +120 '), 120);
check('"" (vide)', parseAmerican(''), null);
check('"even"', parseAmerican('even'), null);
check('"EVEN"', parseAmerican('EVEN'), null);
check('"+0"', parseAmerican('+0'), 0);
check('"-0" -> -0', Object.is(parseAmerican('-0'), -0), true);
check('"+1.5" (décimal, parseInt tronque)', parseAmerican('+1.5'), 1);
check('nombre 120 (pas string)', parseAmerican(120), null);
check('null', parseAmerican(null), null);
check('"+" seul', parseAmerican('+'), null);
check('"-abc"', parseAmerican('-abc'), null);
check('" -200 " (espaces négatif)', parseAmerican(' -200 '), -200);

console.log('== parseLine ==');
check('"o2.5"', parseLine('o2.5'), 2.5);
check('"u2.5"', parseLine('u2.5'), 2.5);
check('"2.5" (nu)', parseLine('2.5'), 2.5);
check('"O2.5" (O majuscule)', parseLine('O2.5'), 2.5);
check('"U2.5" (U majuscule)', parseLine('U2.5'), 2.5);
check('"o0.5"', parseLine('o0.5'), 0.5);
check('"Over 2.5" (mot complet)', parseLine('Over 2.5'), null); // parseFloat("ver 2.5") = NaN
check('"" vide', parseLine(''), null);
check('nombre 2.5 (pas string)', parseLine(2.5), null);
check('"o2.5u" (double lettre)', parseLine('o2.5u'), 2.5);
check('"ou3.5"', parseLine('ou3.5'), 3.5);
check('"-1.5" (ligne négative, edge)', parseLine('-1.5'), -1.5);

console.log('== parseScore ==');
check('{value:2}', parseScore({ value: 2 }), 2);
check('{value:0}', parseScore({ value: 0 }), 0);
check('{value:undefined}', parseScore({ value: undefined }), null);
check('{displayValue:"1",value:1}', parseScore({ displayValue: '1', value: 1 }), 1);
check('{} (sans value)', parseScore({}), null);
check('2 (nombre)', parseScore(2), 2);
check('0 (nombre)', parseScore(0), 0);
check('"2" (string)', parseScore('2'), 2);
check('" 2 " (string espaces)', parseScore(' 2 '), 2);
check('"" (string vide)', parseScore(''), null);
check('"2.7" (string décimal, parseInt tronque)', parseScore('2.7'), 2);
check('2.7 (nombre décimal)', parseScore(2.7), 2.7); // renvoyé tel quel (Number.isFinite)
check('null', parseScore(null), null);
check('undefined', parseScore(undefined), null);
check('{value:"3"} (value string)', parseScore({ value: '3' }), null);
check('{value:NaN}', parseScore({ value: NaN }), null);

console.log('== frontière UTC (logique route.ts Task 14) ==');
function inDay(dateISO: string, iso: string): boolean {
  const dayStartMs = Date.parse(`${dateISO}T00:00:00Z`);
  const dayEndMs = dayStartMs + 86_400_000;
  const t = Date.parse(iso);
  return Number.isFinite(t) && t >= dayStartMs && t < dayEndMs;
}
check('12:00Z même jour', inDay('2026-09-08', '2026-09-08T12:00:00Z'), true);
check('23:59:59.999Z même jour', inDay('2026-09-08', '2026-09-08T23:59:59.999Z'), true);
check('exactement minuit JJ+1 (t===dayEndMs) -> exclu', inDay('2026-09-08', '2026-09-09T00:00:00Z'), false);
check('minuit JJ inclus', inDay('2026-09-08', '2026-09-08T00:00:00Z'), true);
check('date NaN (string vide) -> exclu', inDay('2026-09-08', ''), false);
check('00:00 JJ-1 -> exclu', inDay('2026-09-08', '2026-09-07T00:00:00Z'), false);
check('dayStart epoch = UTC', Date.parse('2026-09-08T00:00:00Z'), Date.UTC(2026, 8, 8));
console.log('  TZ process:', process.env.TZ || '(système UTC)');

console.log('== ?? vs 0 sur overUnderLine (espn.ts:256) ==');
const parsed = (0 as number | undefined) ?? parseLine('2.5') ?? null;
check('overUnder=0 ?? parseLine -> garde 0 (pas de bascule)', parsed, 0);

console.log(`\nTOTAL: ${pass} OK, ${fail} FAIL`);
process.exit(fail > 0 ? 1 : 0);
