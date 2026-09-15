// Test des codes ESPN candidats à l'ajout au catalogue VOLTRIX
// Fenêtre : 10 jours pour maximiser les chances de voir des fixtures
const FROM = '20260907';
const TO = '20260916';

// Contrôles : codes déjà utilisés en prod (doivent passer) + candidats
const CANDIDATES: Array<{ code: string; label: string }> = [
  { code: 'eng.1', label: 'CONTRÔLE Premier League (prod)' },
  { code: 'rus.1', label: 'CONTRÔLE Russie (prod)' },
  { code: 'kor.1', label: 'CONTRÔLE Corée du Sud (prod)' },
  // Angletterre D3-D5
  { code: 'eng.3', label: 'League One' },
  { code: 'eng.4', label: 'League Two' },
  { code: 'eng.5', label: 'National League' },
  // Allemagne D3
  { code: 'ger.3', label: '3. Liga' },
  // Brésil D2
  { code: 'bra.2', label: 'Serie B Bresil' },
  // Asie D2
  { code: 'jpn.2', label: 'J2 League' },
  { code: 'kor.2', label: 'K League 2' },
  // Amicaux internationaux (cruciaux pendant les trêves)
  { code: 'fifa.friendly', label: 'Amicaux internationaux' },
  // Feminin
  { code: 'eng.w.1', label: 'WSL (feminin ENG)' },
  { code: 'fra.f.1', label: 'D1 Arkema (feminin FRA)' },
  { code: 'uefa.wchampions', label: 'UWCL (feminin)' },
  // Mexique D2
  { code: 'mex.2', label: 'Liga Expansion MX' },
  // Codes potentiellement renommes (verif)
  { code: 'afc.champions', label: 'AFC Champions (code actuel)' },
  { code: 'afc.champions.elite', label: 'AFC Champions Elite (nouveau?)' },
  // Orthographes douteuses a tester quand meme
  { code: 'esp.3', label: 'Primera RFEF?' },
  { code: 'fra.3', label: 'National (FRA D3)?' },
];

async function check(c: { code: string; label: string }) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${c.code}/scoreboard?dates=${FROM}-${TO}`;
  try {
    const res = await fetch(url, {
      // ⚠️ ESPN renvoie 403 aux User-Agent navigateur (anti-scraping) ;
      // le serveur Next/undici passe car son UA n'est pas navigateur.
      headers: { Accept: 'application/json', 'User-Agent': 'curl/8.5.0' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { ...c, ok: false, info: `HTTP ${res.status}` };
    const json = (await res.json()) as {
      events?: unknown[];
      leagues?: Array<{ name?: string; abbreviation?: string }>;
    };
    const n = json.events?.length ?? 0;
    const espnName = json.leagues?.[0]?.name ?? '?';
    return { ...c, ok: true, info: `${n} matchs (10j) — ESPN: "${espnName}"` };
  } catch (e) {
    return { ...c, ok: false, info: `ERR ${(e as Error).message.slice(0, 40)}` };
  }
}

// Séquentiel avec petite pause : éviter le rate-limit ESPN (403 en rafale)
for (const c of CANDIDATES) {
  const r = await check(c);
  const flag = !r.ok ? '❌' : r.info.startsWith('0 matchs') ? '⚠️ ' : '✅';
  console.log(`${flag} ${r.code.padEnd(20)} ${r.ok ? r.info : r.info}`);
  await new Promise((res) => setTimeout(res, 400));
}
