// ============================================================
// Audit 19-c — (1) fetchStandings : vérification de la fusion des children
// (fix 17-d) sur des compétitions à plusieurs groupes, en live.
// (2) Spot-check de 8 codes ajoutés récemment au catalogue (Task 16).
// Exécution : bun scripts/audit-19-c-standings-codes.ts
// ============================================================

import { fetchStandings } from '../src/lib/espn';

const UA = { Accept: 'application/json', 'User-Agent': 'curl/8.5.0' };

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

interface RawStandings {
  children?: Array<{ name?: string; standings?: { entries?: unknown[] } }>;
}

async function probeStandings(code: string, season: number) {
  const url = `https://site.api.espn.com/apis/v2/sports/soccer/${code}/standings?season=${season}`;
  try {
    const res = await fetch(url, { headers: UA, cache: 'no-store' as RequestCache });
    if (!res.ok) {
      console.log(`  [raw] ${code} season=${season}: HTTP ${res.status}`);
      return;
    }
    const raw = (await res.json()) as RawStandings;
    const children = raw.children ?? [];
    const perChild = children.map((c) => c.standings?.entries?.length ?? 0);
    const total = perChild.reduce((a, b) => a + b, 0);
    console.log(
      `  [raw] ${code} season=${season}: HTTP 200, children=${children.length}, ` +
        `entries/child=[${perChild.join(',')}], total=${total}`
    );
    const merged = await fetchStandings(code, season);
    console.log(
      `  [repo] fetchStandings(${code}, ${season}) → ${merged.length} équipes ` +
        `${merged.length === total ? '✓ fusion complète' : `✗ ATTENDU ${total}`}`
    );
  } catch (e) {
    console.log(`  [raw] ${code}: EXCEPTION ${(e as Error).message}`);
  }
}

interface RawScoreboard {
  leagues?: Array<{ name?: string }>;
  events?: unknown[];
}

async function probeScoreboard(code: string, date: string) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${code}/scoreboard?dates=${date}`;
  try {
    const res = await fetch(url, { headers: UA, cache: 'no-store' as RequestCache });
    if (!res.ok) {
      console.log(`  [spot] ${code} dates=${date}: HTTP ${res.status}`);
      return;
    }
    const raw = (await res.json()) as RawScoreboard;
    const n = raw.events?.length ?? 0;
    console.log(
      `  [spot] ${code} dates=${date}: HTTP 200, events=${n}, league="${raw.leagues?.[0]?.name ?? '(sans nom)'}"`
    );
  } catch (e) {
    console.log(`  [spot] ${code} dates=${date}: EXCEPTION ${(e as Error).message}`);
  }
}

async function main() {
  console.log('=== 1. fetchStandings multi-groupes (fix 17-d — fusion children) ===');
  await probeStandings('fifa.world', 2026); // 12 groupes attendus
  await sleep(420);
  await probeStandings('conmebol.libertadores', 2026); // 8 groupes en phase de groupes
  await sleep(420);
  await probeStandings('afc.champions', 2025); // East/West
  await sleep(420);
  await probeStandings('uefa.champions', 2026); // 1 child (league phase) — témoin

  console.log('\n=== 2. Spot-check 8 codes récents (Task 16) sur 2 dates ===');
  const codes = [
    'rsa.2',
    'nga.1',
    'ken.1',
    'wafu.nations',
    'caf.championship',
    'usa.ncaa.m.1',
    'usa.w.usl.1',
    'concacaf.central.american.cup',
  ];
  const dates = ['20260905', '20260829'];
  for (const c of codes) {
    for (const d of dates) {
      await probeScoreboard(c, d);
      await sleep(350);
    }
  }
}

main();
