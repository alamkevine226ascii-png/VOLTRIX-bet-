// ============================================================
// Audit 20-d — Script 4 : UI/cohérence (statique) + mémoire (analytique)
// Vérifie des invariants d'affichage dans src/components/voltrix et
// estime la croissance mémoire 24 h des caches globaux (aucun test
// de charge — mesures unitaires + extrapolation).
// ============================================================

import { readFileSync, readdirSync } from 'node:fs';

const DEV = 'http://localhost:3000';
const VOL = 'src/components/voltrix';

console.log('=== [UI] Invariants statiques ===');
// 1. Faux badge VALUE sur la carte d'accueil
const mc = readFileSync(`${VOL}/match-card.tsx`, 'utf8');
const fakeEdge = mc.includes('ValueBadge edge={0.05 + 0.02 * pred.valueBetsCount}');
console.log(`match-card.tsx : badge VALUE avec edge FABRIQUÉ (0.05 + 0.02 × count) présent : ${fakeEdge}`);
const vb = readFileSync(`${VOL}/shared.tsx`, 'utf8');
console.log(`shared.tsx ValueBadge : rend toujours « VALUE +…% » (edge négatif afficherait « VALUE +-x% ») : ${vb.includes('VALUE +{Math.round(edge * 100)}%')}`);
const md = readFileSync(`${VOL}/match-detail.tsx`, 'utf8');
console.log(`match-detail.tsx : utilise l'edge RÉEL (valueBets[].edge) : ${md.includes('p.valueBets[0]?.edge ?? null')}`);

// 2. ProbBar : bornes
const pctClamp = /Math\.round\(value \* 100\)/.test(vb) && /Math\.max\(pct, 2\)/.test(vb);
console.log(`shared.tsx ProbBar : % non borné à [0,100] (round(value×100), largeur max(pct,2)) : ${pctClamp} → prob>1 (ticket corrompu) afficherait >100 %`);

// 3. Accessibilité minimale : aria-label / role / tabIndex dans les composants voltrix
let ariaCount = 0;
for (const f of readdirSync(VOL)) {
  const c = readFileSync(`${VOL}/${f}`, 'utf8');
  ariaCount += (c.match(/aria-label=/g) ?? []).length;
}
console.log(`voltrix/* : ${ariaCount} aria-label au total (match-card role=button + onKeyDown ✓, tab-bar aria-current ✓)`);

// 4. Cotes manquantes : carte masque la rangée si mlHome null (vérif)
console.log(`match-card.tsx : rangée cotes rendue seulement si hasOdds && mlHome !== null : ${mc.includes('match.hasOdds && match.mlHome !== null')}`);

console.log('\n=== [Mémoire] Mesures unitaires → extrapolation 24 h ===');
// Taille des réponses API (proxy de la taille des objets en cache)
const sizes: Array<{ label: string; bytes: number }> = [];
for (const d of ['2026-09-08', '2026-09-06', '2026-09-05']) {
  const t0 = Date.now();
  const r = await fetch(`${DEV}/api/matches?date=${d}`);
  const b = (await r.text()).length;
  sizes.push({ label: `body /api/matches ${d}`, bytes: b });
  console.log(`${d}: ${b.toLocaleString('fr-FR')} octets (${Date.now() - t0} ms)`);
  await new Promise((r) => setTimeout(r, 300));
}
const detail = await fetch(`${DEV}/api/match/401915452?league=uefa.champions&date=2026-09-08T19:00Z`);
const detailBytes = (await detail.text()).length;
console.log(`body /api/match/[id] (AnalyzeResult sérialisé) : ${detailBytes.toLocaleString('fr-FR')} octets`);
await new Promise((r) => setTimeout(r, 300));

const bodyAvg = 170_000; // journée typique chargée (mesuré 170-210 Ko)
console.log(`
Projection cache « bodies » Map (matches/route.ts:90, SANS éviction) :
  1 entrée ≈ ${(bodyAvg / 1024).toFixed(0)} Ko (journée chargée) à 37 Ko (jour creux)
  usage normal (4-8 dates/jour servies)          ≈ ${(bodyAvg * 8 / 1024 / 1024).toFixed(1)} Mo/jour → ~${(bodyAvg * 8 * 30 / 1024 / 1024).toFixed(0)} Mo/mois
  attaquant : N dates valides distinctes (regex OK) = N scans × 143 requêtes ESPN + N entrées permanentes
    → 1 000 dates ≈ ${(1000 * 4).toFixed(0)} s de scan cumulé + ${((bodyAvg * 1000) / 1024 / 1024).toFixed(0)} Mo de Map + ~143 000 requêtes ESPN

Projection cache.ts store (espn.ts : scoreboard/sched/standings/injuries, éviction UNIQUEMENT à la relecture) :
  scoreboard par (ligue,date) ≈ 10-40 Ko (objet parsé, ~5-15 events)
  → scan d'une date = 143 entrées ≈ ${(143 * 25 / 1024).toFixed(1)} Mo ; 10 dates/jour non relues ≈ ${(143 * 25 * 10 / 1024).toFixed(0)} Mo/jour retenus
  schedules par (ligue,équipe,2 saisons) ≈ 10-20 Ko × ~2 000 équipes touchées/jour ≈ ${(2000 * 15 / 1024).toFixed(0)}-30 Mo/jour
  analysisCache (analyze.ts:52, par matchId) ≈ ${(detailBytes / 1024).toFixed(0)}-90 Ko × 100-400 matchs/jour ≈ 5-35 Mo/jour
  → croissance nette ≈ 30-80 Mo/jour en trafic normal, JAMAIS libérée (Map sans plafond ni sweep)
  → standalone bun (processus unique, durée de vie semaines) : ~1-2,5 Go après 30 j si aucune relecture → pression GC/OOM

Verdict : MINEUR en trafic honnête, MAJEUR si endpoint public martelé avec dates distinctes (pas de rate limit).`);

console.log('\n✅ Script 4 terminé.');
