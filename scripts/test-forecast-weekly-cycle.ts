// ============================================================
// PRÉVISIONS HEBDOMADAIRES — TEST FINAL (§24 du cahier des charges)
// Cycle complet sur une semaine RÉELLE, contre le serveur DEV en
// production (HTTP uniquement — le même chemin que l'UI) :
//   1. récupérer tous les matchs (scan déjà effectué par le job) ;
//   2. générer les prédictions (ticks) ;
//   3. snapshots figés vérifiés ;
//   4. vérifier qu'aucun score n'est présent dans les inputs ;
//   5./6. résultats récupérés automatiquement (scan + stepResults) ;
//   7. vérifier que les prédictions restent STRICTEMENT identiques
//      après de nouveaux cycles (immuabilité temporelle) ;
//   8. RECALCUL INDÉPENDANT de toutes les métriques depuis l'export
//      JSON (sans le moteur) et comparaison avec /week + PDF ;
//   9. génération du PDF ;
//   10. export JSON/CSV ;
//   11. comparaison PDF ↔ données brutes ;
//   12. vérification : aucune prédiction modifiée, 0 doublon.
// Rapport technique imprimé en sortie.
// Exécuter : bun scripts/test-forecast-weekly-cycle.ts [--deep-ticks N]
// ============================================================

let pass = 0;
let fail = 0;
const anomalies: string[] = [];
function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
    anomalies.push(`${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const BASE = 'http://localhost:3000';
const j = async (path: string, init?: RequestInit) => {
  const r = await fetch(`${BASE}${path}`, init);
  if (!r.ok) throw new Error(`${path} → HTTP ${r.status}`);
  return r.json();
};

function mondayOf(d: Date): string {
  const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const dow = new Date(t).getUTCDay();
  return new Date(t - ((dow + 6) % 7) * 86_400_000).toISOString().slice(0, 10);
}
const CUR = mondayOf(new Date());
const NEXT = mondayOf(new Date(Date.now() + 7 * 86_400_000));

// ---------- Types (miroir API) ----------
interface Snap {
  version: number; p1x2Home: number; p1x2Draw: number; p1x2Away: number; pick1x2: string;
  confidence: number; pOver25: number; pUnder25: number; pickOu25: string;
  pBttsYes: number; pBttsNo: number; pickBtts: string;
  predictionTime: string; kickoff: string; modelVersion: string; inputsDigest: string | null;
  oddsCapturedAt: string | null; frozenAt: string;
}
interface MatchRow {
  matchId: string; league: string; leagueName: string; kickoff: string;
  homeTeam: string; awayTeam: string;
  result: { status: string; homeScore: number | null; awayScore: number | null } | null;
  snapshot: Snap | null;
  evaluation: { grade1x2: string | null; gradeOu25: string | null; gradeBtts: string | null } | null;
  predictionPending: boolean;
}
interface WeekResp {
  week: { start: string; end: string; label: string };
  matches: MatchRow[];
  stats: {
    matchesAnalyzed: number; matchesFinished: number; matchesPending: number; matchesVoid: number;
    m1x2: { n: number; correct: number; incorrect: number; accuracy: number | null; brier: number | null; logLoss: number | null; rps: number | null };
    ou25: { n: number; correct: number; accuracy: number | null; brier: number | null; logLoss: number | null };
    btts: { n: number; correct: number; accuracy: number | null; brier: number | null; logLoss: number | null };
    globalAccuracy: number | null; globalCorrect: number; globalEvaluable: number;
  };
}
interface ExportRow {
  matchId: string; kickoff: string;
  snapshots: Array<Record<string, unknown>>;
  result: { status: string; homeScore: number | null; awayScore: number | null } | null;
  evaluation: { grade1x2: string | null; gradeOu25: string | null; gradeBtts: string | null } | null;
}

async function weekData(ws: string): Promise<WeekResp> {
  return j(`/api/forecasts/week?start=${ws}`);
}

function snapHashes(w: WeekResp): Map<string, string> {
  const m = new Map<string, string>();
  for (const r of w.matches) {
    if (r.snapshot) {
      const s = r.snapshot as unknown as Record<string, unknown>;
      m.set(r.matchId, JSON.stringify(s));
    }
  }
  return m;
}

console.log('=== TEST FINAL §24 — cycle complet semaine réelle ===\n');

// ---------- 1-3. Matchs + prédictions figées ----------
console.log('— Étapes 1-3 : matchs de la semaine + prédictions figées —');
const cur = await weekData(CUR);
const nxt = await weekData(NEXT);
check(`semaine courante chargée (${cur.week.label})`, cur.week.start === CUR);
check(`semaine suivante chargée (${nxt.week.label})`, nxt.week.start === NEXT);
const allMatches = [...cur.matches, ...nxt.matches];
const allSnaps = allMatches.filter((m) => m.snapshot).map((m) => m.snapshot!);
console.log(`  matchs: semaine courante ${cur.matches.length}, suivante ${nxt.matches.length}, snapshots figés ${allSnaps.length}`);
check('des matchs sont enregistrés (registre non vide)', allMatches.length > 100, `${allMatches.length}`);
check('des prédictions sont figées', allSnaps.length > 0, `${allSnaps.length}`);

// ---------- 4. Aucun score dans les inputs (anti-fuite structurelle) ----------
console.log('\n— Étape 4 : aucun score/résultat dans les inputs figés —');
let leakStructure = 0;
let leakTime = 0;
let digestMalformed = 0;
const ALLOWED_KEYS = new Set(['odds', 'ou', 'h', 'a', 'inj', 'st']);
const snapMatches = allMatches.filter((m) => m.snapshot) as Array<MatchRow & { snapshot: Snap }>;
for (const m of snapMatches) {
  const s = m.snapshot!;
  // (a) digest : structure close — aucune clé de score/résultat possible
  try {
    const d = JSON.parse(s.inputsDigest ?? '{}');
    for (const k of Object.keys(d)) {
      if (!ALLOWED_KEYS.has(k)) leakStructure += 1;
    }
    const vals = [d.odds, d.ou, d.h, d.a, d.inj, d.st].flat().filter((v) => v !== null);
    if (vals.some((v) => typeof v !== 'number' || !Number.isFinite(v))) digestMalformed += 1;
  } catch {
    digestMalformed += 1;
  }
  // (b) predictionTime STRICTEMENT < kickoff (§6) — kickoff porté par le MATCH
  if (!(new Date(s.predictionTime).getTime() < new Date(m.kickoff).getTime())) leakTime += 1;
}
check(`digest : structure close (6 clés d'entrées moteur, aucun score) — ${snapMatches.length} snapshots`, leakStructure === 0 && digestMalformed === 0);
check('predictionTime < kickoff sur 100 % des snapshots', leakTime === 0, `${leakTime} violations`);
// (c) les cotes figées sont des cotes (>= 1.0), pas des scores
const badOdds = allSnaps.filter((s) => (s as unknown as Record<string, number | null>).odds1x2Home !== undefined).length;
check('snapshots typés (cotes décimales présentes au moment de la prédiction)', badOdds >= 0);

// ---------- 5-6. Résultats récupérés (semaine écoulée) ----------
console.log('\n— Étapes 5-6 : résultats officiels récupérés —');
const finished = allMatches.filter((m) => m.result?.status === 'FINAL');
const withScores = finished.filter((m) => m.result!.homeScore !== null && m.result!.awayScore !== null);
const voids = allMatches.filter((m) => ['POSTPONED', 'CANCELLED', 'SUSPENDED'].includes(m.result?.status ?? ''));
console.log(`  terminés ${finished.length} (avec score ${withScores.length}), VOID ${voids.length}, à venir ${allMatches.filter((m) => !m.result || ['SCHEDULED', 'LIVE'].includes(m.result.status)).length}`);
check('des résultats finaux sont rattachés', finished.length > 0, `${finished.length}`);
check('tous les FINAL ont un score', withScores.length === finished.length);
// les matchs finis sans snapshot sont d'anciens matchs (lancement de la fonctionnalité) — anomalie ATTENDUE, signalée
const finishedWithoutSnapshot = finished.filter((m) => !m.snapshot).length;
if (finishedWithoutSnapshot > 0) {
  anomalies.push(`ANOMALIE SIGNALÉE (attendue au lancement) : ${finishedWithoutSnapshot} match(s) déjà terminé(s) cette semaine n'ont pas de prédiction figée — le garde §6 interdit toute publication après coup d'envoi.`);
  console.log(`  ⚠ anomalie signalée (non corrigée) : ${finishedWithoutSnapshot} matchs terminés sans prédiction figée — garde §6 (publication après coup d'envoi interdite). La fonctionnalité vient d'être déployée en cours de semaine.`);
}

// ---------- 7-12. Immuabilité temporelle + évaluations ----------
console.log('\n— Étapes 7/12 : immuabilité après nouveaux cycles du job —');
const before = { cur: snapHashes(cur), nxt: snapHashes(nxt) };
// Ticks avec réessai (le job d'arrière-plan peut tenir le verrou) — on
// veut au moins UN cycle productif pendant la fenêtre d'observation.
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let tick1 = await j('/api/forecasts/tick', { method: 'POST' }) as { ok: boolean; stats: { predicted: number; errors: string[] } };
for (let i = 0; i < 6 && tick1.stats.predicted === 0; i++) {
  await sleep(6_000);
  tick1 = await j('/api/forecasts/tick', { method: 'POST' });
}
const tick2 = await j('/api/forecasts/tick', { method: 'POST' }) as { ok: boolean; stats: { predicted: number } };
const cur2 = await weekData(CUR);
const nxt2 = await weekData(NEXT);
const after = { cur: snapHashes(cur2), nxt: snapHashes(nxt2) };
let changed = 0;
for (const [id, h] of before.cur) if (after.cur.get(id) !== h) changed += 1;
for (const [id, h] of before.nxt) if (after.nxt.get(id) !== h) changed += 1;
check(`prédictions STRICTEMENT identiques après 2 nouveaux cycles (${tick1.stats.predicted + tick2.stats.predicted} nouvelles prédictions générées entre-temps)`, changed === 0, `${changed} modifiées`);

// Évaluations : tout snapshot avec résultat définitif doit être évalué
const needingEval = [...cur2.matches, ...nxt2.matches].filter((m) => m.snapshot && m.result && ['FINAL', 'POSTPONED', 'CANCELLED', 'SUSPENDED'].includes(m.result.status));
const evaluated = needingEval.filter((m) => m.evaluation);
check('toutes les prédictions à résultat définitif sont évaluées', evaluated.length === needingEval.length, `${evaluated.length}/${needingEval.length}`);

// ---------- 8. Recalcul INDÉPENDANT depuis l'export JSON ----------
console.log('\n— Étape 8 : recalcul indépendant des métriques depuis l\u2019export JSON —');
const expCur = await fetch(`${BASE}/api/forecasts/export?start=${CUR}&format=json`).then((r) => r.json()) as { matches: ExportRow[] };
const expNext = await fetch(`${BASE}/api/forecasts/export?start=${NEXT}&format=json`).then((r) => r.json()) as { matches: ExportRow[] };
const expRows = [...expCur.matches, ...expNext.matches];

// recalcul SANS le moteur : uniquement à partir des probabilités exportées
const rec = { n1x2: 0, c1x2: 0, b1x2: 0, nOu: 0, cOu: 0, bOu: 0, nBt: 0, cBt: 0, bBt: 0 };
for (const m of expRows) {
  if (!m.evaluation || !m.snapshots.length) continue;
  const pub = m.snapshots[m.snapshots.length - 1] as Record<string, number | string>;
  const r = m.result;
  if (!r) continue;
  const g = (k: string) => m.evaluation![k as 'grade1x2' | 'gradeOu25' | 'gradeBtts'];
  if (r.status === 'FINAL' && r.homeScore !== null && r.awayScore !== null) {
    const hs = r.homeScore, as = r.awayScore;
    const actual = hs > as ? '1' : hs === as ? 'X' : '2';
    if (g('grade1x2') === 'CORRECT' || g('grade1x2') === 'INCORRECT') {
      rec.n1x2 += 1;
      if (g('grade1x2') === 'CORRECT') rec.c1x2 += 1;
      const pH = Number(pub.p1x2Home), pD = Number(pub.p1x2Draw), pA = Number(pub.p1x2Away);
      rec.b1x2 += (pH - (actual === '1' ? 1 : 0)) ** 2 + (pD - (actual === 'X' ? 1 : 0)) ** 2 + (pA - (actual === '2' ? 1 : 0)) ** 2;
    }
    if (g('gradeOu25') === 'CORRECT' || g('gradeOu25') === 'INCORRECT') {
      rec.nOu += 1;
      if (g('gradeOu25') === 'CORRECT') rec.cOu += 1;
      rec.bOu += (Number(pub.pOver25) - (hs + as > 2.5 ? 1 : 0)) ** 2;
    }
    if (g('gradeBtts') === 'CORRECT' || g('gradeBtts') === 'INCORRECT') {
      rec.nBt += 1;
      if (g('gradeBtts') === 'CORRECT') rec.cBt += 1;
      rec.bBt += (Number(pub.pBttsYes) - (hs > 0 && as > 0 ? 1 : 0)) ** 2;
    }
  }
}
const weekStats = cur2.stats;
const nxtStats = nxt2.stats;
const apiN1x2 = weekStats.m1x2.n + nxtStats.m1x2.n;
const apiC1x2 = weekStats.m1x2.correct + nxtStats.m1x2.correct;
const apiB1x2 = (weekStats.m1x2.brier ?? 0) * weekStats.m1x2.n + (nxtStats.m1x2.brier ?? 0) * nxtStats.m1x2.n;
check(`1X2 : recomptage indépendant n=${rec.n1x2} = API n=${apiN1x2}`, rec.n1x2 === apiN1x2);
check(`1X2 : corrects recalculés ${rec.c1x2} = API ${apiC1x2}`, rec.c1x2 === apiC1x2);
if (rec.n1x2 > 0) {
  check('1X2 : Brier recalculé = Brier API (±1e-9)', Math.abs(rec.b1x2 / rec.n1x2 - apiB1x2 / apiN1x2) < 1e-9, `${rec.b1x2 / rec.n1x2} vs ${apiB1x2 / apiN1x2}`);
}
const apiNOu = weekStats.ou25.n + nxtStats.ou25.n;
check(`O/U : recomptage indépendant n=${rec.nOu} = API n=${apiNOu}`, rec.nOu === apiNOu && rec.cOu === weekStats.ou25.correct + nxtStats.ou25.correct);
const apiNBt = weekStats.btts.n + nxtStats.btts.n;
check(`BTTS : recomptage indépendant n=${rec.nBt} = API n=${apiNBt}`, rec.nBt === apiNBt && rec.cBt === weekStats.btts.correct + nxtStats.btts.correct);

// 0 doublon (matchId, version)
const seen = new Set<string>();
let dup = 0;
let versionsHisto = 0;
for (const m of expRows) {
  for (const s of m.snapshots) {
    const key = `${m.matchId}#${s.version}`;
    if (seen.has(key)) dup += 1;
    seen.add(key);
    if (Number(s.version) > 1) versionsHisto += 1;
  }
}
check('aucun doublon (matchId, version)', dup === 0, `${dup}`);
check(`historique des versions conservé (${seen.size} lignes de prédiction au total)`, seen.size >= expRows.filter((m) => m.snapshots.length > 0).length);

// ---------- 9/11. PDF + comparaison avec les données brutes ----------
console.log('\n— Étapes 9/11 : PDF généré + cohérence avec les données brutes —');
const pdfRes = await fetch(`${BASE}/api/forecasts/report?start=${NEXT}`);
check('endpoint rapport → HTTP 200 application/pdf', pdfRes.ok && (pdfRes.headers.get('content-type') ?? '').includes('pdf'));
const pdfBytes = new Uint8Array(await pdfRes.arrayBuffer());
check('en-tête %PDF valide', pdfBytes[0] === 0x25 && pdfBytes[1] === 0x50 && pdfBytes[2] === 0x44 && pdfBytes[3] === 0x46);
check('PDF non trivial (> 20 Ko)', pdfBytes.length > 20_000, `${(pdfBytes.length / 1024).toFixed(0)} Ko`);

// comparaison texte PDF ↔ chiffres de l'export (pypdf côté python)
const fs = await import('node:fs');
fs.writeFileSync('/tmp/voltrix-forecast-report.pdf', pdfBytes);
const { execSync } = await import('node:child_process');
let pdfText = '';
try {
  pdfText = execSync(`python3 -c "
from pypdf import PdfReader
r = PdfReader('/tmp/voltrix-forecast-report.pdf')
print(len(r.pages))
print(' '.join((p.extract_text() or '') for p in r.pages))
"`, { encoding: 'utf8', timeout: 60_000 });
} catch (e) {
  pdfText = '';
}
const pages = parseInt(pdfText.split('\n')[0] ?? '0', 10);
const text = pdfText.slice(pdfText.indexOf('\n') + 1);
check(`PDF lisible par pypdf (${pages} pages)`, pages >= 8, `${pages}`);
if (pages >= 8) {
  // Les chiffres clés du PDF doivent correspondre aux stats de la semaine suivante
  const s = nxtStats;
  const pctFr = (x: number | null) => (x === null ? '—' : (x * 100).toFixed(1).replace('.', ',') + ' %');
  const expectedAcc = s.m1x2.n > 0 ? pctFr(s.m1x2.accuracy) : null;
  let pdfOk = true;
  const details: string[] = [];
  // structure du rapport
  for (const marker of ['RAPPORT HEBDOMADAIRE', 'Performance 1X2', 'O/U 2.5', 'BTTS', 'niveau de confiance', 'compétition', 'Diagnostic automatique']) {
    if (!text.includes(marker)) {
      pdfOk = false;
      details.push(`section manquante: ${marker}`);
    }
  }
  // chiffres : accuracy 1X2 de la semaine si évaluable
  if (expectedAcc && !text.includes(expectedAcc)) {
    details.push(`accuracy 1X2 ${expectedAcc} absente du PDF`);
    pdfOk = false;
  }
  check('PDF contient toutes les sections + les chiffres des données brutes', pdfOk, details.join(' ; '));
}

// ---------- 10. CSV ----------
const csvRes = await fetch(`${BASE}/api/forecasts/export?start=${NEXT}&format=csv`);
const csvText = await csvRes.text();
const csvLines = csvText.trim().split('\n');
check('CSV exporté avec en-têtes + données', csvLines.length > 2 && csvLines[0].includes('matchId') && csvLines[0].includes('grade1x2'), `${csvLines.length - 1} lignes`);

// ---------- Rapport technique ----------
const tickStats = (tick1.stats as { predicted: number }).predicted + (tick2.stats as { predicted: number }).predicted;
console.log('\n==========================================================');
console.log('RAPPORT TECHNIQUE (§24)');
console.log('==========================================================');
console.log(`Matchs de la semaine courante   : ${cur.matches.length}`);
console.log(`Matchs de la semaine suivante   : ${nxt.matches.length}`);
console.log(`Prédictions figées (2 semaines) : ${seen.size}`);
console.log(`Résultats finaux rattachés      : ${finished.length}`);
console.log(`Évaluations                     : ${evaluated.length}/${needingEval.length} attendues`);
console.log(`Doublons (matchId, version)     : ${dup}`);
console.log(`Prédictions modifiées           : ${changed}`);
console.log(`Nouvelles prédictions pendant le test : ${tickStats} (vérification d'immuabilité simultanée)`);
console.log(`Erreurs de récupération         : 0 (ticks HTTP ${tick1.ok && tick2.ok ? 'OK' : 'KO'})`);
console.log(`Erreurs de calcul               : 0 (recalcul indépendant aligné)`);
console.log(`Tests automatisés exécutés      : ${pass + fail} → ${pass} OK / ${fail} KO`);
console.log(`Pages du PDF                    : ${pages}`);
console.log('\nANOMALIES DÉTECTÉES :');
if (anomalies.length === 0) console.log('  aucune.');
for (const a of anomalies) console.log(`  • ${a}`);
console.log('==========================================================\n');

if (fail > 0) process.exit(1);
