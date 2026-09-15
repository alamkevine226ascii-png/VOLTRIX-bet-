// Probe massif de codes ESPN candidats (élargissement Task 13-b — objectif ≥100 matchs/jour)
// Passe 1 : validité + nb matchs le samedi 2026-09-12 (jour le plus chargé)
// Passe 2 : pour les codes valides, scan de 5 jours creuses (7,8,9,10,14 sept)
const H = { headers: { Accept: 'application/json', 'User-Agent': 'curl/8.5.0' } };
const SAT = '20260912';
const MIDWEEK = ['20260907', '20260908', '20260909', '20260910', '20260914'];

const CANDIDATES: Array<{ code: string; label: string }> = [
  // --- Europe petits championnats (jamais couverts) ---
  { code: 'alb.1', label: 'Albanie' }, { code: 'and.1', label: 'Andorre' },
  { code: 'arm.1', label: 'Arménie' }, { code: 'aze.1', label: 'Azerbaïdjan' },
  { code: 'bih.1', label: 'Bosnie' }, { code: 'blr.1', label: 'Bélarus' },
  { code: 'cyp.1', label: 'Chypre' }, { code: 'est.1', label: 'Estonie' },
  { code: 'far.1', label: 'Féroé' }, { code: 'geo.1', label: 'Géorgie' },
  { code: 'kos.1', label: 'Kosovo' }, { code: 'ltu.1', label: 'Lituanie' },
  { code: 'lva.1', label: 'Lettonie' }, { code: 'mda.1', label: 'Moldavie' },
  { code: 'mkd.1', label: 'Macédoine N.' }, { code: 'mlt.1', label: 'Malte' },
  { code: 'mne.1', label: 'Monténégro' }, { code: 'nir.1', label: 'Irlande du Nord' },
  { code: 'svn.1', label: 'Slovénie' }, { code: 'wal.1', label: 'Pays de Galles' },
  { code: 'lux.1', label: 'Luxembourg' },
  // --- Féminines européennes (orthographe .w.1) ---
  { code: 'fra.w.1', label: 'D1 FÉM. France' }, { code: 'ger.w.1', label: 'FRAUEN Bundesliga' },
  { code: 'esp.w.1', label: 'Liga F (ESP)' }, { code: 'ita.w.1', label: 'Serie A FÉM.' },
  { code: 'sco.w.1', label: 'SCO féminine' },
  // --- Coupes nationales (tours de milieu de semaine en sept.) ---
  { code: 'eng.trophy', label: 'EFL Trophy' }, { code: 'ned.cup', label: 'Coupe PB' },
  { code: 'por.cup', label: 'Taça de Portugal' }, { code: 'tur.cup', label: 'Coupe Turquie' },
  { code: 'sco.cup', label: 'Coupe Écosse' }, { code: 'cro.cup', label: 'Coupe Croatie' },
  { code: 'den.cup', label: 'Coupe Danemark' }, { code: 'nor.cup', label: 'Coupe Norvège' },
  { code: 'sui.cup', label: 'Coupe Suisse' }, { code: 'bel.cup', label: 'Coupe Belgique' },
  { code: 'rus.cup', label: 'Coupe Russie' }, { code: 'ukr.cup', label: 'Coupe Ukraine' },
  { code: 'pol.cup', label: 'Coupe Pologne' }, { code: 'cze.cup', label: 'Coupe Tchéquie' },
  { code: 'gre.cup', label: 'Coupe Grèce' },
  // --- Asie / Golfe ---
  { code: 'hkg.1', label: 'Hong Kong' }, { code: 'uzb.1', label: 'Ouzbékistan' },
  { code: 'kuw.1', label: 'Koweït' }, { code: 'bhr.1', label: 'Bahreïn' },
  { code: 'omn.1', label: 'Oman' }, { code: 'jor.1', label: 'Jordanie' },
  { code: 'lbn.1', label: 'Liban' }, { code: 'jpn.cup', label: 'Coupe Japon' },
  // --- Amériques ---
  { code: 'crc.1', label: 'Costa Rica' }, { code: 'gua.1', label: 'Guatemala' },
  { code: 'hon.1', label: 'Honduras' }, { code: 'slv.1', label: 'Salvador' },
  { code: 'pan.1', label: 'Panama' }, { code: 'jam.1', label: 'Jamaïque' },
  { code: 'bra.3', label: 'Série C Brésil' },
  // --- Afrique ---
  { code: 'nig.1', label: 'Nigeria' }, { code: 'gha.1', label: 'Ghana' },
  { code: 'sen.1', label: 'Sénégal' },
  // --- Divers / jeunes / autres ---
  { code: 'eng.6', label: 'National League N/S' }, { code: 'club.friendly', label: 'Amicaux clubs' },
  { code: 'uefa.youth', label: 'Youth League' }, { code: 'afc.cup', label: 'AFC Challenge Lge' },
  { code: 'fifa.u20', label: 'Mondial U20' }, { code: 'fifa.u17', label: 'Mondial U17' },
];

async function dayCount(code: string, d: string): Promise<number | null> {
  try {
    const res = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/soccer/${code}/scoreboard?dates=${d}`,
      { ...H, signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return null; // code invalide/rejeté
    const j = (await res.json()) as { events?: unknown[] };
    return j.events?.length ?? 0;
  } catch {
    return null;
  }
}

interface Row { code: string; label: string; total: number; today: number; name: string }

async function probe(c: { code: string; label: string }): Promise<Row | null> {
  const satN = await dayCount(c.code, SAT);
  if (satN === null) {
    console.log(`❌ ${c.code.padEnd(14)} invalide`);
    return null;
  }
  const days = satN > 0 ? [] : MIDWEEK; // samedi déjà compté si > 0
  let total = satN;
  let today = 0;
  let name = '';
  for (const d of [d2, ...days].filter((v, i, a) => a.indexOf(v) === i)) {
    const n = await dayCount(c.code, d);
    if (n === null) return null;
    total += n;
    if (d === '20260907') today = n;
    await new Promise((r) => setTimeout(r, 200));
  }
  return { code: c.code, label: c.label, total, today, name };
}

const d2 = '20260907'; // compté comme « today »
const rows: Row[] = [];
for (const c of CANDIDATES) {
  const r = await probe(c);
  if (r && r.total > 0) rows.push(r);
  await new Promise((res) => setTimeout(res, 150));
}

console.log('\n=== CODES PRODUCTIFS (fenêtre ~6 jours dont samedi) ===');
rows.sort((a, b) => b.total - a.total);
for (const r of rows) {
  console.log(`✅ ${r.code.padEnd(14)} total=${String(r.total).padStart(3)} (lundi 07: ${r.today})`);
}
console.log(`\nBilan : ${rows.length} codes productifs / ${CANDIDATES.length} testés`);
