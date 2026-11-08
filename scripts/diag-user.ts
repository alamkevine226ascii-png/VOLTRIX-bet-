/* ============================================================
   Diagnostic utilisateur — rejoue ce que l'App affiche vraiment :
   1. matchs à venir (status pre) des top ligues
   2. analyse complète (analyzeMatch) → marché « Premier but »
   3. compos (loadMatchLineups) → joueurs/formations/sources
   Exécution : bun run scripts/diag-user.ts
   ============================================================ */

const origFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const headers = new Headers(init?.headers);
  if (!headers.has("User-Agent")) headers.set("User-Agent", "Mozilla/5.0");
  return origFetch(input, { ...init, headers });
}) as typeof fetch;

import { fetchScoreboard } from "../src/lib/foot/espn";
import { analyzeMatch } from "../src/lib/foot/analyze";
import { loadMatchLineups } from "../src/lib/foot/lineups";
import { LEAGUES } from "../src/lib/foot/leagues";

function fmtPct(p: number): string {
  return `${(p * 100).toFixed(1)}%`;
}

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

  /* 1. Cherche des matchs à venir aujourd'hui/demain */
  const found: Array<{ id: string; leagueCode: string; date: string; label: string }> = [];
  for (const day of [today, tomorrow]) {
    for (const l of LEAGUES.filter((x) => x.priority === 1)) {
      const board = await fetchScoreboard(l.code, day).catch(() => null);
      if (!board) continue;
      for (const e of board.events) {
        if (e.status !== "pre" && new Date(e.date).getTime() > Date.now()) continue;
        if (new Date(e.date).getTime() < Date.now()) continue; // seulement futurs
        found.push({
          id: e.id,
          leagueCode: board.leagueCode,
          date: e.date,
          label: `${e.home?.team.displayName} vs ${e.away?.team.displayName} (${board.leagueCode})`,
        });
      }
    }
    if (found.length >= 4) break;
  }

  console.log(`\n=== MATCHS À VENIR TROUVÉS (${found.length}) ===`);
  for (const f of found) console.log(` - ${f.label} @ ${f.date}`);

  /* 2. Analyse complète des 3 premiers → marché Premier but */
  for (const m of found.slice(0, 3)) {
    console.log(`\n===== ANALYSE : ${m.label} =====`);
    const t0 = Date.now();
    const res = await analyzeMatch({ matchId: m.id, leagueCode: m.leagueCode, date: m.date });
    if (!res) {
      console.log("  analyzeMatch → null");
      continue;
    }
    console.log(`  analyse en ${Date.now() - t0} ms`);
    const fg = res.prediction.firstGoalTiming;
    const windows = fg.slice(0, 6);
    const argmax = windows.reduce((best, w, i) => (w.prob > windows[best].prob ? i : best), 0);
    console.log(`  Premier but — basis=${fg[0]?.basis} sampleGoals=${fg[0]?.sampleGoals}`);
    for (const w of fg) console.log(`    ${w.label.padEnd(24)} ${fmtPct(w.prob)}`);
    console.log(`  >>> FENÊTRE MAX = ${windows[argmax].label} (${fmtPct(windows[argmax].prob)})`);
    console.log(`  λ total = ${res.prediction.lambda.total.toFixed(2)}`);
    console.log(`  Paris recommandés : ${res.prediction.recommendedBets.map((b) => `${b.market}:${b.pick}(${fmtPct(b.prob)})`).join(" | ")}`);
    void m;

    /* 3. Compos */
    console.log(`  --- COMPOS ---`);
    const ctx = {
      matchDate: res.matchDate,
      homeTeamId: res.home.id,
      awayTeamId: res.away.id,
      homeName: res.home.name,
      awayName: res.away.name,
      homeLogo: res.home.logo,
      awayLogo: res.away.logo,
    };
    const lu = await loadMatchLineups(m.id, m.leagueCode, ctx);
    if (!lu) {
      console.log("  loadMatchLineups → null");
      continue;
    }
    console.log(`  published=${lu.published}`);
    for (const side of ["home", "away"] as const) {
      const t = lu[side];
      if (!t) {
        console.log(`  ${side}: null`);
        continue;
      }
      console.log(
        `  ${side}: ${t.name} | ${t.formation ?? "formation ?"} | source=${t.source} | prev=${t.previousLabel ?? "-"} | ${t.starters.length} titulaires`,
      );
      console.log(`     titulaires: ${t.starters.slice(0, 5).map((p) => `${p.jersey ?? "?"} ${p.name} (${p.positionDetail ?? "?"})`).join(", ")}`);
    }
  }
}

main().catch((e) => {
  console.error("ERREUR:", e);
  process.exit(1);
});
