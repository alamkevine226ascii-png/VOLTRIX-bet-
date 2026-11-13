/**
 * Diagnostic hors ligne du combinateur (mode semaine) sur données Neon.
 * Reproduit exactement le parcours de CombinatorScreen.analyze() :
 * buildLegPool puis findBestCombos(target, minProb), et instrumente
 * chaque phase pour comprendre un éventuel « aucun combiné ».
 */
import { PrismaClient } from "@prisma/client";
import { buildLegPool, findBestCombos, type ComboDayInput } from "../src/lib/foot/combinator";
import type { MatchesResponse, QuickPred, LightMatch } from "../src/lib/voltrix-types";
import { getLeague } from "../src/lib/foot/leagues";

const URL = (
  process.env.NEON_POOLER_URL ??
  "postgresql://neondb_owner:npg_D1OymYeRSnr2@ep-round-cloud-ae3m3lka-pooler.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require"
).replace(/[?&]channel_binding=[^&]*/g, "");

const prisma = new PrismaClient({ datasourceUrl: URL });

function isoAddDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

async function loadDay(date: string): Promise<ComboDayInput> {
  const rows = await prisma.fixture.findMany({
    where: { sport: "foot", dayKeys: { has: date } },
    select: { data: true, predQuick: true },
  });
  const groups = new Map<string, MatchesResponse["leagues"][number]>();
  const preds: Record<string, QuickPred> = {};
  for (const row of rows) {
    const m = row.data as unknown as LightMatch;
    let g = groups.get(m.leagueCode);
    if (!g) {
      const def = getLeague(m.leagueCode);
      g = {
        code: m.leagueCode,
        name: def?.name ?? m.leagueName,
        shortName: def?.shortName ?? m.leagueCode.toUpperCase(),
        region: def?.region ?? "europe",
        matches: [],
      };
      groups.set(m.leagueCode, g);
    }
    g.matches.push(m);
    if (row.predQuick) preds[m.id] = row.predQuick as unknown as QuickPred;
  }
  const leagues = [...groups.values()];
  for (const g of leagues) g.matches.sort((a, b) => (a.date < b.date ? -1 : 1));
  return {
    date,
    foot: leagues.length
      ? { date, totalMatches: leagues.reduce((n, l) => n + l.matches.length, 0), leagues, scanMs: 0 }
      : null,
    footPreds: preds,
  };
}

async function main() {
  const today = todayISO();
  const dates = [0, 1, 2, 3, 4, 5, 6].map((i) => isoAddDays(today, i));
  console.log(`Aujourd'hui : ${today} — jours analysés : ${dates.join(", ")}`);

  const days: ComboDayInput[] = [];
  for (const d of dates) {
    const day = await loadDay(d);
    const n = day.foot?.totalMatches ?? 0;
    console.log(`  ${d} : ${n} matchs en base, ${Object.keys(day.footPreds ?? {}).length} pronos`);
    days.push(day);
  }

  const { legs, matches } = buildLegPool(days);
  console.log(`\nPool brut : ${legs.length} jambes sur ${matches} matchs à venir`);

  /* Réplication du pré-filtrage de findBestCombos pour diagnostiquer */
  const target = 3;
  const minProb = 0.5;
  const maxOdds = target * 1.25;
  const eligible = legs.filter(
    (l) => l.odds <= maxOdds && l.prob >= minProb && l.prob * l.odds >= 0.8,
  );
  console.log(`Éligibles (cote ≤ ${maxOdds}, prob ≥ ${minProb}, prob×cote ≥ 0.8) : ${eligible.length}`);

  const byMatch = new Map<string, typeof legs>();
  for (const l of eligible) {
    const arr = byMatch.get(l.matchId);
    if (arr) arr.push(l);
    else byMatch.set(l.matchId, [l]);
  }
  const perMatchCapped: typeof legs = [];
  for (const arr of byMatch.values()) {
    arr.sort((a, b) => b.prob - a.prob);
    perMatchCapped.push(...arr.slice(0, 5));
  }
  console.log(`perMatchCapped : ${perMatchCapped.length} jambes (${byMatch.size} matchs)`);

  /* Répartition des cotes dans le pool */
  const oddsBuckets = [0, 0, 0, 0, 0];
  for (const l of perMatchCapped) {
    const b = l.odds < 1.3 ? 0 : l.odds < 1.6 ? 1 : l.odds < 2 ? 2 : l.odds < 3 ? 3 : 4;
    oddsBuckets[b]++;
  }
  console.log(
    `Cotes : <1.3:${oddsBuckets[0]}  1.3-1.6:${oddsBuckets[1]}  1.6-2:${oddsBuckets[2]}  2-3:${oddsBuckets[3]}  3+:${oddsBuckets[4]}`,
  );

  /* Combien de jambes prob≥0.5 ont une cote ≥ sqrt(3)≈1.73 (atteignables en 2) ? */
  const hi = perMatchCapped.filter((l) => l.odds >= Math.sqrt(target)).length;
  console.log(`Jambes cote ≥ √cible (${Math.sqrt(target).toFixed(2)}) : ${hi}`);

  const t0 = Date.now();
  const res = findBestCombos(legs, matches, { target, minProb });
  const ms = Date.now() - t0;
  console.log(
    `\nfindBestCombos → ${res.results.length} combinés, pool=${res.poolSize}, relaxed=${res.relaxed}, aborted=${res.aborted}, ${ms} ms`,
  );
  for (const c of res.results) {
    console.log(
      `  cote ${c.odds.toFixed(2)} · réussite ${(c.prob * 100).toFixed(0)}% · seuil ${c.meetsThreshold ? "OK" : "SOUS"} · ${c.legs.length} jambes`,
    );
  }

  /* Force brute : existe-t-il un combiné STRICT (prob ≥ seuil) ?
     DFS exhaustif gros budget sur TOUT le pool éligible. */
  {
    const eligibleAll = legs.filter(
      (l) => l.odds <= maxOdds && l.prob >= minProb && l.prob * l.odds >= 0.8,
    );
    eligibleAll.sort((a, b) => a.odds - b.odds);
    let best = 0;
    let nodes = 0;
    const used = new Set<string>();
    const dfs = (start: number, o: number, p: number, depth: number) => {
      if (nodes++ > 20_000_000) return;
      for (let i = start; i < eligibleAll.length; i++) {
        const l = eligibleAll[i];
        const o2 = o * l.odds;
        if (o2 > maxOdds) break;
        if (used.has(l.matchId)) continue;
        const p2 = p * l.prob;
        if (p2 < minProb) continue;
        if (depth + 1 >= 2 && o2 >= target) {
          if (p2 > best) best = p2;
        }
        if (depth + 1 < 6) {
          used.add(l.matchId);
          dfs(i + 1, o2, p2, depth + 1);
          used.delete(l.matchId);
        }
      }
    };
    dfs(0, 1, 1, 0);
    console.log(
      `\nForce brute (budget 20M, pool complet ${eligibleAll.length}) : meilleur strict = ${(best * 100).toFixed(1)}% ${best >= minProb ? "→ EXISTE" : "→ N'EXISTE PAS"}`,
    );
  }

  /* Matrice de paramètres : chaque configuration utilisateur doit
     soit trouver un combiné ≥ seuil, soit expliquer pourquoi non. */
  console.log(`\nMatrice de paramètres (semaine) :`);
  for (const tgt of [2, 2.5, 3, 4, 5, 8]) {
    for (const mp of [0.4, 0.5, 0.6]) {
      const r = findBestCombos(legs, matches, { target: tgt, minProb: mp });
      const top = r.results[0];
      const strictN = r.results.filter((c) => c.meetsThreshold).length;
      console.log(
        `  cible ${tgt.toFixed(1)} seuil ${Math.round(mp * 100)}% → ${r.results.length} combinés` +
          (top
            ? ` (meilleur ${top.odds.toFixed(2)} à ${Math.round(top.prob * 100)}%, ${strictN} ≥ seuil)`
            : " (aucun)") +
          `${r.aborted ? " [budget]" : ""}`,
      );
    }
  }
}

main()
  .catch((e) => {
    console.error("ERREUR :", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
