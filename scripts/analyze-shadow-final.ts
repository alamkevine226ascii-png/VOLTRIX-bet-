// ============================================================
// VOLTRIX — Task 31 : ANALYSE FINALE DES 2 PASSES SHADOW
// Croisement complétude × identité byte-à-byte, top écarts avec
// causes, digest divergents, ventilation des partiels.
// Lecture seule des JSON produits par shadow-run.ts.
// ============================================================
import { readFileSync } from 'node:fs';

interface Rep {
  matchId: string; league: string; home: string; away: string; kickoff: string;
  status: string; neonComplete: boolean; digestEqual: boolean; digestE: string; digestN: string;
  maxProbDiffPp: number; maxLambdaDiff: number;
  prob: { key: string; e: number; n: number; diff: number }[];
  lambda: { key: string; e: number; n: number; diff: number }[];
  team?: { key: string; diff: number }[];
  causes: string[];
}

function load(p: string): { summary: any; top20: Rep[]; reports: Rep[] } {
  return JSON.parse(readFileSync(p, 'utf8'));
}

const ancre = load('/home/z/my-project/download/shadow-run-2026-09-15.json');
const serie = load('/home/z/my-project/download/shadow-run-2026-09-15-series.json');

for (const [mode, data] of [['ANCRE', ancre], ['SÉRIE', serie]] as const) {
  const reps: Rep[] = data.reports;
  const complets = reps.filter((r) => r.neonComplete);
  const partiels = reps.filter((r) => !r.neonComplete);
  const completsIdentiques = complets.filter((r) => r.maxProbDiffPp === 0 && r.maxLambdaDiff === 0);
  const completsNonIdentiques = complets.filter((r) => r.maxProbDiffPp > 0 || r.maxLambdaDiff > 0);
  const digestKo = reps.filter((r) => !r.digestEqual);

  console.log(`\n================= MODE ${mode} =================`);
  console.log(`Comparés : ${reps.length} | complets : ${complets.length} | partiels : ${partiels.length}`);
  console.log(`Complets BYTE-IDENTIQUES : ${completsIdentiques.length}/${complets.length}`);
  if (completsNonIdentiques.length) {
    console.log('-- Complets NON identiques :');
    for (const r of completsNonIdentiques) {
      console.log(`   ${r.maxProbDiffPp}pp λΔ${r.maxLambdaDiff} — ${r.home} - ${r.away} (${r.league}) :: ${r.causes.slice(0, 3).join(' | ')}`);
    }
  }
  console.log(`Digest égaux : ${reps.length - digestKo.length}/${reps.length}`);
  for (const r of digestKo) {
    console.log(`   DIGEST≠ ${r.home} - ${r.away} (${r.league}) statut=${r.status} complet=${r.neonComplete} maxDiff=${r.maxProbDiffPp}pp`);
    console.log(`     E=${r.digestE.slice(0, 120)}`);
    console.log(`     N=${r.digestN.slice(0, 120)}`);
    console.log(`     causes=${r.causes.join(' | ') || '—'}`);
    const tops = [...r.prob].sort((a, b) => b.diff - a.diff).slice(0, 4);
    console.log(`     prob: ${tops.map((p) => `${p.key} E${(p.e * 100).toFixed(1)}% N${(p.n * 100).toFixed(1)}% Δ${p.diff.toFixed(2)}pp`).join(' ; ')}`);
  }
  // Top écarts (tous matchs) avec détails
  const top = [...reps].sort((a, b) => b.maxProbDiffPp - a.maxProbDiffPp || b.maxLambdaDiff - a.maxLambdaDiff).slice(0, 10);
  console.log('-- Top 10 écarts (tous) :');
  for (const r of top) {
    const tops = [...r.prob].sort((a, b) => b.diff - a.diff).slice(0, 2);
    console.log(`   ${r.maxProbDiffPp}pp — ${r.home} - ${r.away} (${r.league}) complet=${r.neonComplete} :: ${r.causes.slice(0, 2).join(' | ') || 'numérique pur'} ${tops.length ? ':: ' + tops.map((p) => `${p.key} Δ${p.diff.toFixed(2)}`).join(' ; ') : ''}`);
  }
  // Ventilation des partiels
  console.log('-- Partiels : causes ventilées :');
  const byCause = new Map<string, number>();
  for (const p of partiels) for (const c of p.causes) {
    const k = c.replace(/=[^=]*$/, '').split('(')[0].trim();
    byCause.set(k, (byCause.get(k) ?? 0) + 1);
  }
  for (const [k, v] of [...byCause.entries()].sort((a, b) => b[1] - a[1])) console.log(`   ${v}× ${k}`);
  const partielsIdentiques = partiels.filter((r) => r.maxProbDiffPp === 0 && r.maxLambdaDiff === 0);
  console.log(`   partiels 0pp quand même : ${partielsIdentiques.length}/${partiels.length}`);
}

// Croisement inter-modes : matchs complets dans LES DEUX passes
const ancreById = new Map(ancre.reports.map((r) => [r.matchId, r]));
const serieById = new Map(serie.reports.map((r) => [r.matchId, r]));
const communs = [...ancreById.keys()].filter((id) => serieById.has(id));
let identiquesDeuxModes = 0;
for (const id of communs) {
  const a = ancreById.get(id)!, s = serieById.get(id)!;
  if (a.neonComplete && s.neonComplete && a.maxProbDiffPp === 0 && s.maxProbDiffPp === 0 && a.maxLambdaDiff === 0 && s.maxLambdaDiff === 0) identiquesDeuxModes++;
}
console.log(`\n================= CROISÉ =================`);
console.log(`Matchs communs aux 2 passes : ${communs.length} | complets+identiques dans LES DEUX modes : ${identiquesDeuxModes}`);
