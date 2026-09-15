// ============================================================
// VOLTRIX bet — Test de charge mémoire (Task 18-a)
// ============================================================
// Reproduit la séquence qui a fait OOMer le serveur dev (2 crashes,
// heap Node ~2 Go épuisé) : rafales de POST /api/predictions +
// GET /api/performance + rescans /api/matches — et mesure la RSS du
// process next-server à chaque vague.
//
// Usage : bun scripts/load-memory-test.ts [date] [vagues]
//   date   : journée à scanner (défaut 2026-09-10, matchs réels ESPN)
//   vagues : nombre de vagues (défaut 3)
//
// Une vague = 1× GET /api/matches?date=…  +  10× POST /api/predictions
// (12 matchs réels par lot, concurrence 3)  +  2× GET /api/performance.
//
// Critère de réussite :
//   - croissance RSS totale (baseline → fin) < 250 Mo
//   - stabilisation : la 3e vague ne doit plus faire croître la RSS
//     (pas de croissance linéaire continue)
// Le TTL serveur 60-90 s fait que les vagues 2-3 servent surtout du
// cache — c'est le comportement attendu d'un serveur sain.
// ============================================================

import { execSync } from 'node:child_process';

const BASE = 'http://localhost:3000';
const DATE = process.argv[2] ?? '2026-09-10';
const WAVES = Number(process.argv[3] ?? 3);
const BATCH_SIZE = 12; // plafond serveur de /api/predictions
const POSTS_PER_WAVE = 10;
const POST_CONCURRENCY = 3;
const RSS_BUDGET_MB = 250;

function findNextServerPid(): number {
  // Titre du process Next dev : « next-server (v16.1.3) »
  try {
    const out = execSync("pgrep -f 'next-server'", { encoding: 'utf8' }).trim();
    const first = out.split('\n')[0]?.trim();
    if (first && /^\d+$/.test(first)) return Number(first);
  } catch {
    /* pgrep a échoué → fallback ps */
  }
  const ps = execSync("ps aux | grep 'next-server' | grep -v grep", { encoding: 'utf8' });
  for (const line of ps.split('\n')) {
    const cols = line.trim().split(/\s+/);
    if (cols.length > 1 && /^\d+$/.test(cols[1])) return Number(cols[1]);
  }
  throw new Error('Process next-server introuvable — le serveur dev tourne-t-il ?');
}

function rssMB(pid: number): number {
  const kb = Number(execSync(`ps -o rss= -p ${pid}`, { encoding: 'utf8' }).trim());
  return Math.round((kb / 1024) * 10) / 10;
}

const MB = (b: number) => Math.round((b / (1024 * 1024)) * 10) / 10;

async function httpJSON<T>(
  path: string,
  init?: RequestInit & { timeoutMs?: number }
): Promise<{ status: number; xCache: string | null; json: T | null; ms: number }> {
  const t0 = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init?.timeoutMs ?? 180_000);
  try {
    const res = await fetch(BASE + path, { ...init, signal: controller.signal });
    const xCache = res.headers.get('x-cache');
    let json: T | null = null;
    try {
      json = (await res.json()) as T;
    } catch {
      json = null;
    }
    return { status: res.status, xCache, json, ms: Date.now() - t0 };
  } finally {
    clearTimeout(timer);
  }
}

interface LightMatch {
  id: string;
  leagueCode: string;
  date: string;
  home: { name: string };
  away: { name: string };
}
interface MatchesResp {
  totalMatches: number;
  leagues: Array<{ matches: LightMatch[] }>;
}

function matchesFrom(d: MatchesResp | null): LightMatch[] {
  if (!d?.leagues) return [];
  return d.leagues.flatMap((l) => l.matches ?? []);
}

function shiftDate(dateISO: string, days: number): string {
  return new Date(Date.parse(dateISO + 'T12:00:00Z') + days * 86_400_000).toISOString().slice(0, 10);
}

async function postBatch(pool: LightMatch[], offset: number): Promise<number> {
  const batch: LightMatch[] = [];
  for (let i = 0; i < BATCH_SIZE; i++) batch.push(pool[(offset + i) % pool.length]);
  const res = await httpJSON<unknown>('/api/predictions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ matches: batch.map((m) => ({ matchId: m.id, leagueCode: m.leagueCode, date: m.date })) }),
  });
  if (res.status !== 200) throw new Error(`POST /api/predictions → HTTP ${res.status}`);
  return res.ms;
}

async function mapLimited<T, R>(items: T[], limit: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const i = cursor++;
        out[i] = await fn(items[i], i);
      }
    })
  );
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const pid = findNextServerPid();
  console.log(`Serveur détecté : next-server pid=${pid}`);
  console.log(`Cible : ${BASE} · journée ${DATE} · ${WAVES} vagues · budget RSS +${RSS_BUDGET_MB} Mo\n`);

  // ---------- Préchauffage (absorbe les compiles dev + scan ESPN à froid) ----------
  console.log('— Préchauffage —');
  const pool = new Map<string, LightMatch>();
  for (const d of [shiftDate(DATE, -1), DATE, shiftDate(DATE, 1)]) {
    const r = await httpJSON<MatchesResp>(`/api/matches?date=${d}`);
    const ms = matchesFrom(r.json);
    ms.forEach((m) => pool.set(m.id, m));
    console.log(
      `  GET /api/matches?date=${d} → ${r.status} ${r.xCache ?? ''} ${ms.length} matchs (${r.ms} ms)`
    );
  }
  if (pool.size < 12) throw new Error(`Pool de matchs réels insuffisant (${pool.size}) — date sans données ESPN ?`);
  const matches = [...pool.values()];
  console.log(`  Pool de matchs réels : ${matches.length} (3 journées)`);

  const p1 = await postBatch(matches, 0);
  const perf1 = await httpJSON<unknown>('/api/performance');
  console.log(`  POST /api/predictions (12 matchs) → ${p1} ms · GET /api/performance → ${perf1.status} (${perf1.ms} ms)`);
  await sleep(5000);

  const baseline = rssMB(pid);
  console.log(`\nRSS baseline (post préchauffage) : ${baseline} Mo\n`);

  // ---------- Vagues ----------
  const waveRSS: number[] = [];
  for (let w = 1; w <= WAVES; w++) {
    const t0 = Date.now();
    const m = await httpJSON<MatchesResp>(`/api/matches?date=${DATE}`);
    const postMs = await mapLimited(Array.from({ length: POSTS_PER_WAVE }, (_, i) => i), POST_CONCURRENCY, (i) =>
      postBatch(matches, (w * 37 + i * 11) % matches.length)
    );
    const perf = [await httpJSON<unknown>('/api/performance'), await httpJSON<unknown>('/api/performance')];
    await sleep(2000);
    const rss = rssMB(pid);
    waveRSS.push(rss);
    const totalPostMs = postMs.reduce((a, b) => a + b, 0);
    console.log(
      `Vague ${w}/${WAVES} : matches ${m.xCache ?? m.status} · ${POSTS_PER_WAVE} POST (${totalPostMs} ms cumulés, max ${Math.max(...postMs)} ms) · perf ${perf.map((p) => `${p.ms}ms`).join(' + ')} → RSS ${rss} Mo (${(Date.now() - t0) / 1000 | 0} s)`
    );
    await sleep(3000);
  }

  // ---------- Stabilisation ----------
  // Laisse passer le GC + le sweep cache : on attend soit un retour sous la
  // baseline, soit un plateau (variation < 15 Mo entre deux mesures 15 s
  // apart), 120 s max. Une croissance linéaire continue n'aurait AUCUN
  // plateau → échec (c'est le schéma d'une fuite).
  console.log('\n— Stabilisation (GC + sweep, 120 s max) —');
  let finalRSS = rssMB(pid);
  let peakRSS = Math.max(finalRSS, ...waveRSS);
  let settled = false;
  let settledBy = 'délai écoulé sans plateau';
  const settleDeadline = Date.now() + 120_000;
  let prev = finalRSS;
  while (Date.now() < settleDeadline) {
    await sleep(15_000);
    const cur = rssMB(pid);
    peakRSS = Math.max(peakRSS, cur);
    const diff = Math.abs(cur - prev);
    prev = cur;
    finalRSS = cur;
    console.log(`  RSS ${cur} Mo (Δ ${Math.round(diff * 10) / 10})`);
    if (cur <= baseline) {
      settled = true;
      settledBy = 'retour sous la baseline (GC/sweep)';
      break;
    }
    if (diff < 15) {
      settled = true;
      settledBy = 'plateau (garbage évacué, RSS stable)';
      break;
    }
  }

  const growth = Math.round((finalRSS - baseline) * 10) / 10;
  const d1 = Math.round((waveRSS[0] - baseline) * 10) / 10;
  const d2 = WAVES > 1 ? Math.round((waveRSS[1] - waveRSS[0]) * 10) / 10 : 0;
  const d3 = WAVES > 2 ? Math.round((waveRSS[2] - waveRSS[1]) * 10) / 10 : 0;

  console.log('\n================ RÉSULTATS ================');
  console.log(`RSS baseline            : ${baseline} Mo`);
  console.log(`RSS fin vague 1         : ${waveRSS[0]} Mo (Δ ${d1 >= 0 ? '+' : ''}${d1})`);
  if (WAVES > 1) console.log(`RSS fin vague 2         : ${waveRSS[1]} Mo (Δ ${d2 >= 0 ? '+' : ''}${d2})`);
  if (WAVES > 2) console.log(`RSS fin vague 3         : ${waveRSS[2]} Mo (Δ ${d3 >= 0 ? '+' : ''}${d3})`);
  console.log(`RSS pic observé         : ${peakRSS} Mo (garbage transitoire + compiles dev)`);
  console.log(`RSS finale stabilisée   : ${finalRSS} Mo`);
  console.log(`CROISSANCE STABILISÉE   : ${growth >= 0 ? '+' : ''}${growth} Mo (budget ${RSS_BUDGET_MB} Mo)`);

  const okGrowth = growth < RSS_BUDGET_MB;
  const okStable = settled;
  console.log(`Croissance < budget     : ${okGrowth ? 'OUI' : 'NON'}`);
  console.log(`Stabilisation           : ${okStable ? `OUI (${settledBy})` : 'NON — croissance linéaire continue'}`);
  console.log('===========================================');
  console.log(
    okGrowth && okStable
      ? 'VERDICT : PASSE — plus de fuite mémoire mesurable côté serveur.'
      : 'VERDICT : ÉCHEC — accumulation non bornée résiduelle, investiguer.'
  );
  process.exit(okGrowth && okStable ? 0 : 1);
}

main().catch((e) => {
  console.error('ERREUR:', e instanceof Error ? e.message : e);
  process.exit(2);
});
