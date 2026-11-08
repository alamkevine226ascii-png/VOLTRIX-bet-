/* Récupère les logos d'équipes via l'API ESPN (même source que VOLTRIX)
   et les télécharge dans public/logos/. Génère src/lib/team-logos.generated.ts
   (mapping nom d'équipe -> chemin local). */
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = "/home/z/my-project";
const OUT_DIR = join(ROOT, "public", "logos");
const LEAGUES = ["eng.1", "esp.1", "ita.1", "ger.1", "fra.1", "uefa.champions"];

mkdirSync(OUT_DIR, { recursive: true });

const byName = new Map(); // displayName -> file
const byAlt = new Map(); // alias (name, shortName, abbreviation) -> file

async function fetchJson(url) {
  const res = await fetch(url, { headers: { "User-Agent": "voltrix-front/1.0" } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function download(url, dest) {
  const res = await fetch(url, { headers: { "User-Agent": "voltrix-front/1.0" } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 300) throw new Error(`trop petit (${buf.length}o) ${url}`);
  writeFileSync(dest, buf);
  return buf.length;
}

let total = 0;
for (const league of LEAGUES) {
  try {
    const j = await fetchJson(
      `https://site.api.espn.com/apis/site/v2/sports/soccer/${league}/teams?limit=200`,
    );
    const teams =
      j?.sports?.[0]?.leagues?.[0]?.teams?.map((t) => t.team).filter(Boolean) ?? [];
    console.log(`${league}: ${teams.length} équipes`);
    for (const t of teams) {
      const href = t.logos?.[0]?.href ?? t.logo;
      if (!href) continue;
      const file = `${t.abbreviation?.toLowerCase().replace(/[^a-z0-9]/g, "") || t.id}-${t.id}.png`;
      const dest = join(OUT_DIR, file);
      if (!existsSync(dest)) {
        try {
          const size = await download(href, dest);
          total += size;
        } catch (e) {
          console.log(`  !! ${t.displayName}: ${e.message}`);
          continue;
        }
      }
      const path = `/logos/${file}`;
      if (t.displayName) byName.set(t.displayName, path);
      if (t.name && !byName.has(t.name)) byName.set(t.name, path);
      if (t.shortName && !byAlt.has(t.shortName)) byAlt.set(t.shortName, path);
    }
  } catch (e) {
    console.log(`ERREUR ${league}: ${e.message}`);
  }
}

// fusion : alias -> logo (sans écraser les noms complets)
const entries = [...byName.entries()].map(([name, path]) => `  ${JSON.stringify(name)}: ${JSON.stringify(path)},`);
const altEntries = [...byAlt.entries()]
  .filter(([k]) => !byName.has(k))
  .map(([name, path]) => `  ${JSON.stringify(name)}: ${JSON.stringify(path)},`);

const ts = `/* AUTO-GÉNÉRÉ — logos ESPN téléchargés dans public/logos/ */\nexport const TEAM_LOGOS: Record<string, string> = {\n${entries.join("\n")}\n};\n\n/* Alias courts (secours) */\nexport const TEAM_LOGOS_ALT: Record<string, string> = {\n${altEntries.join("\n")}\n};\n`;
writeFileSync(join(ROOT, "src", "lib", "team-logos.generated.ts"), ts);
console.log(`\nOK — ${byName.size} noms, ${byAlt.size} alias, ~${Math.round(total / 1024)} Ko téléchargés`);
