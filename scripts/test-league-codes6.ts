// Validation finale Task 16 — codes issus du registre sports.core ESPN
const SITE = 'https://site.api.espn.com/apis/site/v2/sports/soccer';
const CODES = [
  'usa.usl.l1', 'usa.usl.l1.cup', 'usa.w.usl.1',
  'concacaf.central.american.cup', 'concacaf.w.champions_cup',
  'concacaf.womens.championship', 'caf.nations_qual', 'caf.w.nations',
];
for (const code of CODES) {
  try {
    const res = await fetch(`${SITE}/${code}/scoreboard`, {
      headers: { 'User-Agent': 'curl/8.5.0', Accept: 'application/json' },
    });
    if (!res.ok) { console.log(`❌ ${code.padEnd(34)} HTTP ${res.status}`); }
    else {
      const j = await res.json() as { leagues?: Array<{ name?: string }>; events?: unknown[] };
      console.log(`✅ ${code.padEnd(34)} "${j.leagues?.[0]?.name ?? '?'}" — ${j.events?.length ?? 0} év.`);
    }
  } catch (e) { console.log(`⚠️ ${code}: ${(e as Error).message}`); }
  await new Promise(r => setTimeout(r, 320));
}
