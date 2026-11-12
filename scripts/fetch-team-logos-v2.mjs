/* Pipeline v2 — logos locaux exhaustifs (source : ESPN uniquement).
 *
 * Pourquoi : le mapping actuel (112 clubs, 6 ligues) est trop maigre pour
 * servir de secours, et le endpoint `teams` de certaines ligues est périmé
 * (fra.1 : 18 équipes, sans Nantes/Metz/Saint-Étienne !). On collecte donc
 * les logos depuis DEUX sources ESPN :
 *   A. endpoint `teams` de chaque ligue du catalogue (rosters complets) ;
 *   B. scan des scoreboards sur une fenêtre de dates (équipes réellement
 *      affichables dans l'app : coupes nationales, CAF, promotions...).
 *
 * Le sandbox tue les processus en arrière-plan entre les appels : le
 * pipeline s'exécute donc en 3 phases au premier plan, avec état sur disque :
 *   node scripts/fetch-team-logos-v2.mjs collect    (A+B -> /tmp/logos-teams.json)
 *   node scripts/fetch-team-logos-v2.mjs download   (-> /tmp/logos-raw/*.png)
 *   node scripts/fetch-team-logos-v2.mjs finalize   (resize 96px + mapping TS)
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = "/home/z/my-project";
const OUT_DIR = join(ROOT, "public", "logos");
const RAW_DIR = "/tmp/logos-raw";
const TEAMS_JSON = "/tmp/logos-teams.json";
const SITE = "https://site.api.espn.com/apis/site/v2/sports/soccer";
const UA = { "User-Agent": "voltrix-front/1.0" };
const PHASE = process.argv[2] ?? "collect";

mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(RAW_DIR, { recursive: true });

/* --- codes de ligues extraits du catalogue app --- */
const leaguesSrc = readFileSync(join(ROOT, "src/lib/foot/leagues.ts"), "utf8");
const CODES = [...leaguesSrc.matchAll(/code:\s*'([^']+)'/g)].map((m) => m[1]);

/* --- utilitaires --- */
async function fetchJson(url, timeoutMs = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: UA, signal: ctrl.signal });
    if (!res.ok) throw new Error(`${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

async function pool(items, size, worker, label) {
  let done = 0;
  const queue = [...items.entries()];
  await Promise.all(
    Array.from({ length: size }, async () => {
      for (;;) {
        const next = queue.shift();
        if (!next) return;
        const [idx, item] = next;
        try {
          await worker(item, idx);
        } catch {
          /* erreur individuelle : on continue */
        }
        done++;
        if (done % 500 === 0 || done === items.length)
          console.log(`  [${label}] ${done}/${items.length}`);
      }
    }),
  );
}

/* --- collecte : id -> { displayName, shortName, url } --- */

function noteTeam(teams, t) {
  const id = String(t?.id ?? "");
  if (!id || !t?.displayName) return;
  const url = t.logo ?? t.logos?.[0]?.href ?? null;
  if (!url) return; // pas de crest ESPN -> médaille initiales à l'écran
  const prev = teams.get(id);
  if (prev) {
    if (!prev.shortName && t.shortDisplayName) prev.shortName = t.shortDisplayName;
    return;
  }
  teams.set(id, {
    displayName: t.displayName,
    shortName: t.shortDisplayName ?? null,
    url,
  });
}

async function phaseCollect() {
  const teams = new Map();
  console.log(`Catalogue : ${CODES.length} codes de ligue`);

  /* ===== SOURCE A : endpoint teams par ligue ===== */
  console.log("=== Source A : endpoint teams (concurrence 8) ===");
  let aOk = 0;
  await pool(CODES, 8, async (code) => {
    try {
      const j = await fetchJson(`${SITE}/${code}/teams?limit=500`, 9000);
      const arr = (j?.sports?.[0]?.leagues?.[0]?.teams ?? []).map((x) => x.team);
      arr.forEach((t) => noteTeam(teams, t));
      if (arr.length) aOk++;
    } catch {
      /* coupes & codes morts : pas de roster, on ignore */
    }
  }, "rosters");
  console.log(`Rosters : ${aOk} ligues, ${teams.size} équipes`);

  /* ===== SOURCE B : scan scoreboards (-35j..+21j) ===== */
  console.log("=== Source B : scan scoreboards -35j..+21j ===");
  const fmt = (d) =>
    `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
  const now = Date.now();
  const days = [];
  for (let off = -35; off <= 21; off++) days.push(fmt(new Date(now + off * 86400000)));
  const pairs = [];
  for (const day of days) for (const code of CODES) pairs.push([day, code]);
  console.log(`${pairs.length} requêtes scoreboard (concurrence 10)…`);
  let nEvents = 0;
  await pool(pairs, 10, async ([day, code]) => {
    const j = await fetchJson(`${SITE}/${code}/scoreboard?dates=${day}`, 8000).catch(() => null);
    if (!j?.events) return;
    for (const e of j.events) {
      nEvents++;
      for (const c of e.competitions ?? [])
        for (const comp of c.competitors ?? []) noteTeam(teams, comp.team ?? {});
    }
  }, "scoreboard");
  console.log(`Matchs scannés : ${nEvents}`);

  const arr = [...teams.entries()].map(([id, t]) => ({ id, ...t }));
  writeFileSync(TEAMS_JSON, JSON.stringify(arr));
  console.log(`OK — ${arr.length} équipes avec crest -> ${TEAMS_JSON}`);
}

async function phaseDownload() {
  const teams = JSON.parse(readFileSync(TEAMS_JSON, "utf8"));
  console.log(`${teams.length} équipes à télécharger (concurrence 10)…`);
  let dl = 0, skip = 0, fail = 0;
  await pool(teams, 10, async (t) => {
    const abbr = (t.displayName ?? "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 3);
    const file = `${abbr || "t"}-${t.id}.png`;
    const dest = join(RAW_DIR, file);
    if (existsSync(dest)) {
      skip++;
      return;
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(t.url, { headers: UA });
        if (!res.ok) throw new Error(`${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length < 300) throw new Error("trop petit");
        writeFileSync(dest, buf);
        dl++;
        return;
      } catch {
        if (attempt === 1) fail++;
        else await new Promise((r) => setTimeout(r, 400));
      }
    }
  }, "download");
  console.log(`Téléchargés : ${dl}, déjà présents : ${skip}, échecs : ${fail}`);
}

function phaseFinalize() {
  const teams = JSON.parse(readFileSync(TEAMS_JSON, "utf8"));

  /* ===== redimensionnement (PIL) ===== */
  console.log("=== Redimensionnement 96px (PIL) ===");
  try {
    const out = execFileSync(
      "python3",
      [join(ROOT, "scripts", "resize-logos.py"), RAW_DIR, OUT_DIR],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    console.log(out.trim());
  } catch (e) {
    console.log("ERREUR resize:", e.message, (e.stderr ?? "").toString().slice(0, 300));
    process.exit(1);
  }

  /* ===== régénération du mapping ===== */
  console.log("=== Mapping team-logos.generated.ts ===");
  const manifest = new Map(); // displayName -> /logos/file.png
  const byAlt = new Map(); // shortName -> path
  for (const t of teams) {
    const abbr = (t.displayName ?? "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 3);
    const file = `${abbr || "t"}-${t.id}.png`;
    if (!existsSync(join(OUT_DIR, file))) continue; // échec de téléchargement
    const path = `/logos/${file}`;
    manifest.set(t.displayName, path);
    if (t.shortName && !manifest.has(t.shortName)) byAlt.set(t.shortName, path);
  }
  const entries = [...manifest.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, path]) => `  ${JSON.stringify(name)}: ${JSON.stringify(path)},`);
  const altEntries = [...byAlt.entries()]
    .filter(([k]) => !manifest.has(k))
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, path]) => `  ${JSON.stringify(name)}: ${JSON.stringify(path)},`);
  const ts = `/* AUTO-GÉNÉRÉ — logos ESPN téléchargés dans public/logos/
 * (sources : endpoint teams + scan scoreboards, redimensionnés 96px)
 * Voir scripts/fetch-team-logos-v2.mjs — ne pas éditer à la main. */
export const TEAM_LOGOS: Record<string, string> = {
${entries.join("\n")}
};

/* Alias courts (secours) */
export const TEAM_LOGOS_ALT: Record<string, string> = {
${altEntries.join("\n")}
};
`;
  writeFileSync(join(ROOT, "src", "lib", "team-logos.generated.ts"), ts);
  const nFiles = readdirSync(OUT_DIR).filter((f) => f.endsWith(".png")).length;
  console.log(`OK — ${manifest.size} noms, ${byAlt.size} alias, ${nFiles} fichiers dans public/logos/`);
}

switch (PHASE) {
  case "collect":
    await phaseCollect();
    break;
  case "download":
    await phaseDownload();
    break;
  case "finalize":
    phaseFinalize();
    break;
  default:
    console.log("Phase inconnue :", PHASE, "(collect | download | finalize)");
    process.exit(1);
}
