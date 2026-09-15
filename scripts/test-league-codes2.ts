// Retest des codes en échec avec le format SINGLE-DATE exact de l'app (dates=YYYYMMDD)
const DAYS = ['20260907', '20260908', '20260909', '20260910', '20260911', '20260912', '20260913'];
const CODES = ['kor.1', 'ger.3', 'jpn.2', 'kor.2', 'fra.f.1', 'esp.3', 'fra.3', 'chn.2', 'swe.2', 'ned.2'];

async function totalForCode(code: string): Promise<{ total: number; ok: boolean; name: string }> {
  let total = 0;
  let ok = true;
  let name = '?';
  for (const d of DAYS) {
    try {
      const res = await fetch(
        `https://site.api.espn.com/apis/site/v2/sports/soccer/${code}/scoreboard?dates=${d}`,
        { headers: { Accept: 'application/json', 'User-Agent': 'curl/8.5.0' }, signal: AbortSignal.timeout(8_000) }
      );
      if (!res.ok) { ok = false; break; }
      const json = (await res.json()) as { events?: unknown[]; leagues?: Array<{ name?: string }> };
      name = json.leagues?.[0]?.name ?? name;
      total += json.events?.length ?? 0;
    } catch { ok = false; break; }
    await new Promise((r) => setTimeout(r, 250));
  }
  return { total, ok, name };
}

for (const c of CODES) {
  const r = await totalForCode(c);
  if (!r.ok) console.log(`❌ ${c.padEnd(10)} invalide/rejeté`);
  else if (r.total === 0) console.log(`⚠️  ${c.padEnd(10)} valide mais 0 matchs (7j) — ESPN: "${r.name}"`);
  else console.log(`✅ ${c.padEnd(10)} ${r.total} matchs (7j) — ESPN: "${r.name}"`);
}
