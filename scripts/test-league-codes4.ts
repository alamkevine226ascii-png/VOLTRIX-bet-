// Dernière passe ciblée : D2/D3 non testées + coupes saisonnières
const DAYS = ['20260907', '20260912', '20260915', '20260916', '20260919'];
const CODES = ['por.2','tur.2','sco.2','bel.2','ita.3','aus.cup','usa.open','conmebol.recopa','nzl.1','afc.cup','esp.copa_federacion','uefa.regionscup'];
const H = { headers: { Accept: 'application/json', 'User-Agent': 'curl/8.5.0' } };
for (const c of CODES) {
  let total = 0; let ok = true; let name = '';
  for (const d of DAYS) {
    try {
      const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${c}/scoreboard?dates=${d}`, { ...H, signal: AbortSignal.timeout(8000) });
      if (!res.ok) { ok = false; break; }
      const j = await res.json();
      name = j.leagues?.[0]?.name ?? name;
      total += j.events?.length ?? 0;
    } catch { ok = false; break; }
    await new Promise(r => setTimeout(r, 200));
  }
  if (!ok) console.log(`❌ ${c.padEnd(20)} invalide`);
  else if (total === 0) console.log(`⚠️  ${c.padEnd(20)} valide, 0 matchs — "${name}"`);
  else console.log(`✅ ${c.padEnd(20)} ${total} matchs (5 dates) — "${name}"`);
}
