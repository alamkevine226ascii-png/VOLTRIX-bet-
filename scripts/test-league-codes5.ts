// ============================================================
// VOLTRIX bet — Validation des codes ESPN (Task 16)
// Compétitions demandées : USA/CONCACAF + Afrique (Russie déjà présente).
// Critère : HTTP 200 = code valide chez ESPN (même hors saison, avec 0
// événement) ; 4xx = code inexistant. leagues[0].name donne le nom officiel
// pour vérifier le mapping. Requêtes SÉQUENTIELLES avec pause (anti-403),
// User-Agent curl (ESPN bloque les UA navigateur sur les scripts).
// ============================================================

const SITE = 'https://site.api.espn.com/apis/site/v2/sports/soccer';

const CANDIDATES: Array<{ label: string; codes: string[] }> = [
  // ---------- USA / CONCACAF ----------
  { label: 'USL League One', codes: ['usa.usl.2', 'usa.usl1', 'usa.usl_league_one'] },
  { label: 'USL Super League', codes: ['usa.usl.w', 'usa.uslsuper', 'usa.usl_super_league'] },
  { label: 'USL Cup', codes: ['usa.usl.cup', 'usa.uslcup'] },
  { label: 'NCAA hommes', codes: ['usa.ncaa.m.1', 'usa.ncaa.men1', 'usa.ncaa'] },
  { label: 'NCAA femmes', codes: ['usa.ncaa.w.1', 'usa.ncaa.women1'] },
  { label: 'Leagues Cup', codes: ['usa.leagues.cup', 'concacaf.leagues.cup', 'usa.leaguescup'] },
  { label: 'NWSL Challenge Cup', codes: ['usa.nwsl.cup', 'usa.nwsl.challenge'] },
  { label: 'Concacaf Central American Cup', codes: ['concacaf.central_american_cup', 'concacaf.central', 'concacaf.central.cup'] },
  { label: 'Concacaf W Champions Cup', codes: ['concacaf.w_champions_cup', 'concacaf.wchampions', 'concacaf.w.champions'] },
  { label: 'Concacaf W Championship', codes: ['concacaf.w_championship', 'concacaf.wchampionship', 'concacaf.w'] },
  { label: 'Concacaf W Gold Cup', codes: ['concacaf.w_gold_cup', 'concacaf.wgold', 'concacaf.w.gold'] },
  // ---------- AFRIQUE ----------
  { label: 'D2 sud-africaine', codes: ['rsa.2'] },
  { label: 'Nigeria', codes: ['nga.1'] },
  { label: 'Kenya', codes: ['ken.1'] },
  { label: 'Zambie', codes: ['zam.1'] },
  { label: 'Ghana', codes: ['gha.1'] },
  { label: 'Ouganda', codes: ['uga.1'] },
  { label: 'Zimbabwe', codes: ['zim.1'] },
  { label: 'Qualifs CAN', codes: ['caf.nations.qual', 'caf.nations_qualification', 'caf.nationsq'] },
  { label: 'CAN féminine', codes: ['caf.nations.w', 'caf.womens_nations_cup', 'caf.women'] },
  { label: 'CHAN (Championnat des nations locales)', codes: ['caf.championship', 'caf.nations_championship'] },
  { label: 'WAFU Cup', codes: ['caf.wafu', 'wafu.nations', 'caf.wafu_nations'] },
  // ---------- CONTRÔLES ----------
  { label: 'contrôle Premier League (200 attendu)', codes: ['eng.1'] },
  { label: 'contrôle Russie (déjà au catalogue)', codes: ['rus.1'] },
];

interface Board {
  leagues?: Array<{ name?: string }>;
  events?: unknown[];
}

async function check(code: string): Promise<void> {
  try {
    const res = await fetch(`${SITE}/${code}/scoreboard`, {
      headers: { 'User-Agent': 'curl/8.5.0', Accept: 'application/json' },
    });
    if (!res.ok) {
      console.log(`  ❌ ${code.padEnd(30)} HTTP ${res.status}`);
      return;
    }
    const j = (await res.json()) as Board;
    const name = j.leagues?.[0]?.name ?? '?';
    console.log(`  ✅ ${code.padEnd(30)} 200 — "${name}" — ${j.events?.length ?? 0} év. (slate courant)`);
  } catch (e) {
    console.log(`  ⚠️ ${code.padEnd(30)} erreur réseau: ${(e as Error).message}`);
  }
}

for (const { label, codes } of CANDIDATES) {
  console.log(`\n=== ${label} ===`);
  for (const code of codes) {
    await check(code);
    await new Promise((r) => setTimeout(r, 320)); // pause anti-rate-limit
  }
}
console.log('\nTerminé.');
