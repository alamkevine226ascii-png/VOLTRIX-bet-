// Audit 20-b — Sonde LIVE ESPN via le VRAI client du repo (src/lib/espn.ts).
// Partie A : trouver un match EN DIRECT ('in') pour tester le garde VOID live.
// Partie B : valider empiriquement les 19 codes FALLBACK_LEAGUES extraits du
// fichier réel src/app/api/bankroll/resolve/route.ts (200 OK + nom de ligue).
// Pause 350 ms entre les requêtes directes ; fetchScoreboard est en cache.
import { fetchScoreboard } from '../src/lib/espn';
import { readFileSync } from 'node:fs';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const UA = 'curl/8.5.0';
let failures = 0;
const check = (label: string, cond: boolean, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'} — ${label}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures++;
};

// ---------- Partie A : chasse d'un match LIVE ----------
console.log('=== PARTIE A — recherche d\'un match EN DIRECT (state \'in\') ===');
const scanLeagues = ['mex.1', 'arg.1', 'chi.1', 'col.1', 'bra.1', 'usa.nwsl', 'uru.1', 'ecu.1', 'per.1', 'crc.1'];
const scanDates = ['2026-09-07', '2026-09-08'];
const liveCandidates: Array<{ league: string; id: string; name: string; detail: string; date: string; homeScore: unknown; awayScore: unknown }> = [];
for (const lg of scanLeagues) {
  for (const d of scanDates) {
    const sb = await fetchScoreboard(lg, d);
    const evs = sb?.events ?? [];
    const inPlay = evs.filter((e) => e.status === 'in');
    if (inPlay.length > 0) {
      for (const e of inPlay) {
        liveCandidates.push({
          league: lg,
          id: e.id,
          name: e.name,
          detail: e.statusDetail,
          date: e.date,
          homeScore: e.home?.score,
          awayScore: e.away?.score,
        });
        console.log(`LIVE : ${lg} #${e.id} ${e.name} — « ${e.statusDetail} » (${e.date}) score ${e.home?.score}-${e.away?.score} completed=${e.completed}`);
      }
    } else {
      console.log(`${lg} ${d} : ${evs.length} events, 0 en direct`);
    }
    await sleep(350);
  }
}
// NB : la disponibilité d'un match EN DIRECT dépend de l'heure — un échec ici
// n'invalide pas l'audit (le test PENDING est alors joué par audit-20-b-endpoint.ts
// sur un match repéré par un scan étendu, ex. usa.ncaa.m.1 nocturnes).
if (liveCandidates.length > 0) {
  check(`Match(s) EN DIRECT trouvé(s) pour le test PENDING`, true, `${liveCandidates.length} candidat(s)`);
} else {
  console.log(`INFO — aucun match 'in' à cette heure (${new Date().toISOString()}) : le test PENDING est joué par audit-20-b-endpoint.ts / audit-20-b-doublegrade.ts sur un match repéré par scan étendu`);
}

// ---------- Partie B : validation FALLBACK_LEAGUES (codes extraits du fichier réel) ----------
console.log("\n=== PARTIE B — validation empirique FALLBACK_LEAGUES (route.ts réel) ===");
const routeSrc = readFileSync('/home/z/my-project/src/app/api/bankroll/resolve/route.ts', 'utf8');
const m = routeSrc.match(/const FALLBACK_LEAGUES = \[([\s\S]*?)\] as const/);
if (!m) {
  console.log('FAIL — bloc FALLBACK_LEAGUES introuvable dans route.ts');
  failures++;
  process.exit(1);
}
const codes = [...m[1].matchAll(/'([a-z0-9.]+)'/g)].map((x) => x[1]);
console.log(`Codes extraits du fichier (${codes.length}) : ${codes.join(', ')}`);
check('19 codes dans FALLBACK_LEAGUES (10 européennes + 9 ajoutées)', codes.length === 19);
check('chi.1 présent (remplacement de chl.1)', codes.includes('chi.1') && !codes.includes('chl.1'));
const added = ['usa.1', 'mex.1', 'bra.1', 'arg.1', 'uru.1', 'col.1', 'chi.1', 'concacaf.champions', 'usa.open'];
check('les 9 codes ajoutés par la Task 19 sont tous présents', added.every((c) => codes.includes(c)));
const europeans = ['eng.1', 'esp.1', 'ita.1', 'ger.1', 'fra.1', 'uefa.champions', 'uefa.europa', 'ned.1', 'por.1', 'tur.1'];
check('les 10 européennes d\'origine sont intactes', europeans.every((c) => codes.includes(c)));

// Date primaire par ligue (calendrier plausible sept. 2026) + 2 dates de repli hors-saison
const primaryDate: Record<string, string> = {
  'eng.1': '2026-09-07', 'esp.1': '2026-09-07', 'ita.1': '2026-09-07', 'ger.1': '2026-09-06',
  'fra.1': '2026-09-06', 'uefa.champions': '2026-09-08', 'uefa.europa': '2026-09-10',
  'ned.1': '2026-09-08', 'por.1': '2026-09-07', 'tur.1': '2026-09-07',
  'usa.1': '2026-09-06', 'mex.1': '2026-09-06', 'bra.1': '2026-09-06', 'arg.1': '2026-09-06',
  'uru.1': '2026-09-06', 'col.1': '2026-09-07', 'chi.1': '2026-09-06',
  'concacaf.champions': '2026-03-10', 'usa.open': '2026-09-16',
};
const alternates: Record<string, string[]> = {
  'concacaf.champions': ['2026-02-24', '2026-04-14'],
  'usa.open': ['2026-07-08', '2026-08-12'],
  'uru.1': ['2026-09-13', '2026-06-14'],
  'chi.1': ['2026-09-13', '2026-08-16'],
  'col.1': ['2026-09-13', '2026-08-16'],
  'tur.1': ['2026-09-12', '2026-08-16'],
};

interface Row { code: string; http: number | null; name: string; events: number; date: string; repoName: string | null }
const rows: Row[] = [];
for (const code of codes) {
  const tryDates = [primaryDate[code] ?? '2026-09-07', ...(alternates[code] ?? [])];
  let row: Row | null = null;
  for (const d of tryDates) {
    const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${code}/scoreboard?dates=${d.replace(/-/g, '')}`;
    let http: number | null = null;
    let name = '';
    let n = 0;
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': UA }, cache: 'no-store' });
      http = res.status;
      if (res.ok) {
        const j = (await res.json()) as { leagues?: Array<{ name?: string }>; events?: unknown[] };
        name = j.leagues?.[0]?.name ?? '';
        n = (j.events ?? []).length;
      }
    } catch {
      http = null;
    }
    if (http === 200 && (n > 0 || !row)) {
      // on garde le premier 200 ; si events>0 on s'arrête (preuve de vie)
      const sb = await fetchScoreboard(code, d); // chemin RÉEL du repo (cache server-side partagé)
      row = { code, http, name, events: n, date: d, repoName: sb?.leagueName ?? null };
      if (n > 0) break;
    }
    await sleep(350);
  }
  if (row) rows.push(row);
  else rows.push({ code, http: null, name: '', events: 0, date: '-', repoName: null });
  await sleep(350);
}

console.log('\n| code | HTTP | ligue ESPN | events | date utilisée | nom via repo |');
console.log('|---|---|---|---|---|---|');
for (const r of rows) console.log(`| ${r.code} | ${r.http ?? 'ERR'} | ${r.name || '—'} | ${r.events} | ${r.date} | ${r.repoName ?? '—'} |`);

for (const r of rows) {
  check(`code ${r.code} → scoreboard HTTP 200 avec nom de ligue`, r.http === 200 && r.name !== '', `${r.events} events le ${r.date}`);
}

console.log(`\n=== audit-20-b-liveprobe : ${failures === 0 ? 'ALL PASS' : failures + ' FAIL'} ===`);
console.log('CANDIDATS_LIVE=' + JSON.stringify(liveCandidates));
process.exit(failures === 0 ? 0 : 1);
