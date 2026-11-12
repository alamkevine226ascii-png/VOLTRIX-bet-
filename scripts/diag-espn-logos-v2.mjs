/* Diagnostic v2 : scan de ligues sur plusieurs jours (dates uniques),
   agrège les équipes sans logo dans le scoreboard ESPN. */
const BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer";
const LEAGUES = [
  "eng.1","eng.2","eng.3","fra.1","fra.2","esp.1","esp.2","ita.1","ita.2","ger.1","ger.2",
  "ned.1","ned.2","por.1","bel.1","tur.1","sco.1","gre.1","sui.1","aut.1","den.1","nor.1","swe.1",
  "usa.1","mex.1","bra.1","bra.2","arg.1","jpn.1","chn.1","aus.1","ksa.1",
  "rsa.1","gha.1","nga.1","ken.1","zim.1","caf.champions","caf.confed",
  "uefa.champions","uefa.europa","uefa.europa.conf","eng.fa","eng.league_cup",
  "esp.copa_del_rey","ita.coppa_italia","ger.dfb_pokal","fra.coupe_de_france",
  "fifa.friendly","conmebol.libertadores","usa.nwsl","eng.w.1",
];

const fmt = (d) =>
  `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
const now = new Date();
const DAYS = [-4, -3, -2, -1, 0, 1, 2, 3, 4].map((o) => fmt(new Date(now.getTime() + o * 86400000)));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const noLogoTeams = new Map(); // name -> leagues
let totalTeams = 0, totalLogo = 0;

for (const lg of LEAGUES) {
  let nEv = 0;
  for (const day of DAYS) {
    try {
      const res = await fetch(`${BASE}/${lg}/scoreboard?dates=${day}`, {
        headers: { "User-Agent": "voltrix-front/1.0" },
      });
      if (!res.ok) continue;
      const j = await res.json();
      for (const e of j?.events ?? []) {
        nEv++;
        for (const c of e.competitions ?? []) {
          for (const comp of c.competitors ?? []) {
            totalTeams++;
            const has = comp.team?.logo ?? comp.team?.logos?.[0]?.href ?? null;
            if (has) totalLogo++;
            else {
              const nm = comp.team?.displayName ?? comp.team?.name ?? "?";
              if (!noLogoTeams.has(nm)) noLogoTeams.set(nm, new Set());
              noLogoTeams.get(nm).add(lg);
            }
          }
        }
      }
    } catch {}
    await sleep(120); // poli avec l API
  }
  process.stdout.write(`${lg}:${nEv} `);
}
console.log("\n");
const pct = totalTeams ? Math.round((100 * totalLogo) / totalTeams) : 0;
console.log(`TOTAL: ${totalTeams} équipes vues, ${pct}% avec logo API`);
console.log(`\nÉquipes SANS logo API (${noLogoTeams.size}):`);
const sorted = [...noLogoTeams.entries()].sort((a, b) => a[0].localeCompare(b[0]));
for (const [name, lgs] of sorted) console.log(`  ${name}  [${[...lgs].join(", ")}]`);
