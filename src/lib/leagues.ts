// ============================================================
// VOLTRIX bet — Catalogue des ligues ESPN (football/soccer)
// Chaque entrée = code ESPN + nom FR + région + priorité de scan
// ⚠️ Codes validés contre ESPN (HTTP 200 + événements réels).
// Task 13 : +10 divisions productives (eng.3/4/5, bra.2, ned.2, mex.2,
// arg.2, eng.w.1, fifa.friendly, uefa.wchampions) ; kor.1 RETIRÉE
// (HTTP 400 systématique — K League retirée de l'API publique ESPN).
// Task 50 : élargissement demande utilisateur (qualifs CAN + autres
// championnats) — +34 codes validés LIVE (registre officiel ESPN 219
// slugs + scoreboard HTTP 200 avec événements réels, 30 jours) ;
// 15 codes RETIRÉS (disparus de l'API ET du registre ESPN, HTTP 400
// confirmé en séquentiel ×2 : ukr.1 cro.1 hun.1 pol.1 srb.1 bul.1
// svk.1 uae.1 qat.1 irn.1 vie.1 egy.1 mar.1 tun.1 alg.1 — mêmes
// symptômes que kor.1 en T13) ; afc.asiancup migré vers
// afc.asian.cup (renommage côté ESPN, nouveau slug au registre).
// ============================================================

export interface LeagueDef {
  code: string; // code ESPN (ex: eng.1)
  name: string; // nom français
  shortName: string; // abréviation courte
  region: 'europe' | 'americas' | 'asia' | 'africa' | 'international';
  priority: number; // 1 = top ligues (scan prioritaire), 2 = secondaire, 3 = exotique
}

export const LEAGUES: LeagueDef[] = [
  // ---------- EUROPE — Top 5 ----------
  { code: 'eng.1', name: 'Premier League', shortName: 'PL', region: 'europe', priority: 1 },
  { code: 'esp.1', name: 'LaLiga', shortName: 'LIG', region: 'europe', priority: 1 },
  { code: 'ita.1', name: 'Serie A', shortName: 'SEA', region: 'europe', priority: 1 },
  { code: 'ger.1', name: 'Bundesliga', shortName: 'BUN', region: 'europe', priority: 1 },
  { code: 'fra.1', name: 'Ligue 1', shortName: 'L1', region: 'europe', priority: 1 },

  // ---------- EUROPE — Coupes d'Europe ----------
  { code: 'uefa.champions', name: 'Ligue des Champions', shortName: 'UCL', region: 'europe', priority: 1 },
  { code: 'uefa.europa', name: 'Ligue Europa', shortName: 'UEL', region: 'europe', priority: 1 },
  { code: 'uefa.europa.conf', name: 'Conference League', shortName: 'UECL', region: 'europe', priority: 2 },
  { code: 'uefa.super_cup', name: 'Supercoupe de l\'UEFA', shortName: 'USC', region: 'europe', priority: 2 },
  // Task 50 : tours de qualification des coupes d'Europe (actifs
  // juillet-août, événements réels validés ; no-op le reste de l'année) :
  { code: 'uefa.champions_qual', name: 'Qualifications Ligue des Champions', shortName: 'QCL', region: 'europe', priority: 3 },
  { code: 'uefa.europa_qual', name: 'Qualifications Ligue Europa', shortName: 'QEL', region: 'europe', priority: 3 },
  { code: 'uefa.europa.conf_qual', name: 'Qualifications Conference League', shortName: 'QCF', region: 'europe', priority: 3 },

  // ---------- EUROPE — Divisions inférieures ----------
  { code: 'eng.2', name: 'Championship', shortName: 'CHA', region: 'europe', priority: 2 },
  { code: 'eng.3', name: 'League One (D3 anglaise)', shortName: 'LO', region: 'europe', priority: 2 },
  { code: 'eng.4', name: 'League Two (D4 anglaise)', shortName: 'LT', region: 'europe', priority: 3 },
  { code: 'eng.5', name: 'National League (D5 anglaise)', shortName: 'NAT', region: 'europe', priority: 3 },
  { code: 'esp.2', name: 'LaLiga 2', shortName: 'L2E', region: 'europe', priority: 2 },
  { code: 'ita.2', name: 'Serie B', shortName: 'SEB', region: 'europe', priority: 2 },
  { code: 'ita.3', name: 'Serie C — Girone A', shortName: 'SEC', region: 'europe', priority: 3 },
  { code: 'ita.4', name: 'Serie C — Girone B', shortName: 'SCB', region: 'europe', priority: 3 },
  { code: 'ita.5', name: 'Serie C — Girone C', shortName: 'SCC', region: 'europe', priority: 3 },
  { code: 'ger.2', name: '2. Bundesliga', shortName: '2BU', region: 'europe', priority: 2 },
  { code: 'fra.2', name: 'Ligue 2', shortName: 'L2', region: 'europe', priority: 2 },

  // ---------- EUROPE — Autres championnats ----------
  { code: 'ned.1', name: 'Eredivisie', shortName: 'ERE', region: 'europe', priority: 1 },
  { code: 'ned.2', name: 'Eerste Divisie (Pays-Bas)', shortName: 'NED2', region: 'europe', priority: 3 },
  { code: 'por.1', name: 'Primeira Liga', shortName: 'POR', region: 'europe', priority: 1 },
  { code: 'bel.1', name: 'Pro League (Belgique)', shortName: 'BEL', region: 'europe', priority: 2 },
  { code: 'tur.1', name: 'Süper Lig', shortName: 'TUR', region: 'europe', priority: 1 },
  { code: 'tur.2', name: '1. Lig (D2 turque)', shortName: 'TU2', region: 'europe', priority: 3 },
  { code: 'sco.1', name: 'Scottish Premiership', shortName: 'SCO', region: 'europe', priority: 2 },
  { code: 'sco.2', name: 'Championship (Écosse)', shortName: 'SC2', region: 'europe', priority: 3 },
  { code: 'gre.1', name: 'Super League (Grèce)', shortName: 'GRE', region: 'europe', priority: 2 },
  { code: 'sui.1', name: 'Super League (Suisse)', shortName: 'SUI', region: 'europe', priority: 2 },
  { code: 'aut.1', name: 'Bundesliga (Autriche)', shortName: 'AUT', region: 'europe', priority: 2 },
  { code: 'den.1', name: 'Superliga (Danemark)', shortName: 'DEN', region: 'europe', priority: 2 },
  { code: 'nor.1', name: 'Eliteserien (Norvège)', shortName: 'NOR', region: 'europe', priority: 2 },
  { code: 'swe.1', name: 'Allsvenskan (Suède)', shortName: 'SWE', region: 'europe', priority: 2 },
  { code: 'rus.1', name: 'Premier-Liga (Russie)', shortName: 'RUS', region: 'europe', priority: 2 },
  { code: 'irl.1', name: 'Premier Division (Irlande)', shortName: 'IRL', region: 'europe', priority: 3 },
  { code: 'rou.1', name: 'Liga 1 (Roumanie)', shortName: 'ROU', region: 'europe', priority: 3 },
  { code: 'cze.1', name: 'Ligue tchèque', shortName: 'CZE', region: 'europe', priority: 3 },
  { code: 'wal.1', name: 'Cymru Premier (Pays de Galles)', shortName: 'WAL', region: 'europe', priority: 3 },
  { code: 'nir.1', name: 'Premiership (Irlande du Nord)', shortName: 'NIR', region: 'europe', priority: 3 },
  { code: 'mlt.1', name: 'Premier League (Malte)', shortName: 'MLT', region: 'europe', priority: 3 },
  { code: 'isr.1', name: 'Ligat Ha\'Al (Israël)', shortName: 'ISR', region: 'europe', priority: 3 },
  // Task 50 : ukr.1/cro.1/srb.1/bul.1/hun.1/svk.1/pol.1 RETIRÉES —
  // codes disparus de l'API ET du registre ESPN (HTTP 400, cf. kor.1).
  { code: 'eng.w.1', name: "Super League féminine (Angleterre)", shortName: 'WSL', region: 'europe', priority: 3 },
  { code: 'fra.w.1', name: 'D1 Féminine (France)', shortName: 'D1F', region: 'europe', priority: 3 },
  { code: 'esp.w.1', name: 'Liga F féminine (Espagne)', shortName: 'LFF', region: 'europe', priority: 3 },
  { code: 'uefa.wchampions', name: "Ligue des Champions féminine", shortName: 'UWCL', region: 'europe', priority: 3 },

  // ---------- COUPES NATIONALES ----------
  { code: 'eng.fa', name: 'FA Cup', shortName: 'FAC', region: 'europe', priority: 2 },
  { code: 'eng.league_cup', name: 'Carabao Cup', shortName: 'EFL', region: 'europe', priority: 2 },
  { code: 'eng.trophy', name: 'EFL Trophy', shortName: 'EFT', region: 'europe', priority: 2 },
  { code: 'esp.copa_del_rey', name: 'Copa del Rey', shortName: 'CDR', region: 'europe', priority: 2 },
  { code: 'ita.coppa_italia', name: 'Coppa Italia', shortName: 'CIT', region: 'europe', priority: 2 },
  { code: 'ger.dfb_pokal', name: 'DFB Pokal', shortName: 'DFB', region: 'europe', priority: 2 },
  { code: 'fra.coupe_de_france', name: 'Coupe de France', shortName: 'CDF', region: 'europe', priority: 2 },
  { code: 'ned.cup', name: 'Coupe des Pays-Bas (KNVB Beker)', shortName: 'KNVB', region: 'europe', priority: 2 },
  { code: 'por.taca.portugal', name: 'Taça de Portugal', shortName: 'TDP', region: 'europe', priority: 2 },

  // ---------- AMÉRIQUES ----------
  { code: 'usa.1', name: 'MLS', shortName: 'MLS', region: 'americas', priority: 1 },
  { code: 'mex.1', name: 'Liga MX', shortName: 'LMX', region: 'americas', priority: 1 },
  { code: 'mex.2', name: 'Liga de Expansión (Mexique)', shortName: 'MEX2', region: 'americas', priority: 3 },
  { code: 'bra.1', name: 'Brasileirão', shortName: 'BRA', region: 'americas', priority: 1 },
  { code: 'bra.2', name: 'Serie B (Brésil)', shortName: 'BRB', region: 'americas', priority: 2 },
  { code: 'arg.1', name: 'Liga Profesional (Argentine)', shortName: 'ARG', region: 'americas', priority: 1 },
  { code: 'arg.2', name: 'Primera Nacional (Argentine)', shortName: 'ARG2', region: 'americas', priority: 3 },
  { code: 'usa.nwsl', name: 'NWSL (féminin)', shortName: 'NWSL', region: 'americas', priority: 2 },
  { code: 'chi.1', name: 'Primera División (Chili)', shortName: 'CHI', region: 'americas', priority: 2 },
  { code: 'col.1', name: 'Liga BetPlay (Colombie)', shortName: 'COL', region: 'americas', priority: 2 },
  { code: 'uru.1', name: 'Primera División (Uruguay)', shortName: 'URU', region: 'americas', priority: 3 },
  { code: 'par.1', name: 'División Profesional (Paraguay)', shortName: 'PAR', region: 'americas', priority: 3 },
  { code: 'ecu.1', name: 'LigaPro (Équateur)', shortName: 'ECU', region: 'americas', priority: 3 },
  { code: 'per.1', name: 'Liga 1 (Pérou)', shortName: 'PER', region: 'americas', priority: 3 },
  { code: 'ven.1', name: 'Liga FUTVE (Venezuela)', shortName: 'VEN', region: 'americas', priority: 3 },
  { code: 'bol.1', name: 'División Profesional (Bolivie)', shortName: 'BOL', region: 'americas', priority: 3 },
  { code: 'usa.usl.1', name: 'USL Championship', shortName: 'USL', region: 'americas', priority: 3 },
  { code: 'usa.open', name: 'US Open Cup', shortName: 'USO', region: 'americas', priority: 3 },
  { code: 'crc.1', name: 'Primera División (Costa Rica)', shortName: 'CRC', region: 'americas', priority: 3 },
  { code: 'hon.1', name: 'Liga Nacional (Honduras)', shortName: 'HON', region: 'americas', priority: 3 },
  { code: 'slv.1', name: 'Primera División (Salvador)', shortName: 'SLV', region: 'americas', priority: 3 },
  { code: 'gua.1', name: 'Liga Nacional (Guatemala)', shortName: 'GUA', region: 'americas', priority: 3 },
  { code: 'jam.1', name: 'Premier League (Jamaïque)', shortName: 'JAM', region: 'americas', priority: 3 },
  { code: 'bra.copa_do_brazil', name: 'Copa do Brasil', shortName: 'CDB', region: 'americas', priority: 2 },
  { code: 'arg.copa', name: 'Copa Argentina', shortName: 'CAR', region: 'americas', priority: 3 },
  { code: 'chi.copa_chi', name: 'Copa Chile', shortName: 'CCH', region: 'americas', priority: 3 },
  { code: 'col.copa', name: 'Copa Colombia', shortName: 'COC', region: 'americas', priority: 3 },

  // ---------- ASIE / OCÉANIE ----------
  { code: 'jpn.1', name: 'J1 League (Japon)', shortName: 'J1', region: 'asia', priority: 1 },
  // kor.1 (K League 1) RETIRÉE Task 13 : HTTP 400 systématique chez ESPN,
  // chaque scan payait une requête morte + retry (~1,2 s de latence perdue).
  { code: 'chn.1', name: 'Chinese Super League', shortName: 'CSL', region: 'asia', priority: 2 },
  { code: 'aus.1', name: 'A-League (Australie)', shortName: 'AUS', region: 'asia', priority: 2 },
  { code: 'ksa.1', name: 'Saudi Pro League', shortName: 'SPL', region: 'asia', priority: 1 },
  { code: 'ind.1', name: 'Indian Super League', shortName: 'ISL', region: 'asia', priority: 3 },
  { code: 'idn.1', name: 'Liga 1 (Indonésie)', shortName: 'IDN', region: 'asia', priority: 3 },
  { code: 'tha.1', name: 'Thai League 1', shortName: 'THA', region: 'asia', priority: 3 },
  { code: 'mys.1', name: 'Super League (Malaisie)', shortName: 'MYS', region: 'asia', priority: 3 },
  { code: 'sgp.1', name: 'Premier League (Singapour)', shortName: 'SGP', region: 'asia', priority: 3 },
  { code: 'ksa.kings.cup', name: "King's Cup (Arabie saoudite)", shortName: 'KSC', region: 'asia', priority: 3 },
  // Task 50 : uae.1/qat.1/irn.1/vie.1 RETIRÉES — codes disparus de
  // l'API ET du registre ESPN (HTTP 400, cf. kor.1).

  // ---------- AFRIQUE ----------
  { code: 'rsa.1', name: 'Premier Soccer League (Afrique du Sud)', shortName: 'RSA', region: 'africa', priority: 2 },
  // Task 50 : egy.1/mar.1/tun.1/alg.1 RETIRÉES (disparues chez ESPN,
  // HTTP 400) — remplacées par 5 championnats africains servis par
  // ESPN avec événements réels validés :
  { code: 'gha.1', name: 'Premier League (Ghana)', shortName: 'GHA', region: 'africa', priority: 3 },
  { code: 'nga.1', name: 'Premier League (Nigeria)', shortName: 'NGA', region: 'africa', priority: 3 },
  { code: 'ken.1', name: 'Premier League (Kenya)', shortName: 'KEN', region: 'africa', priority: 3 },
  { code: 'uga.1', name: 'Premier League (Ouganda)', shortName: 'UGA', region: 'africa', priority: 3 },
  { code: 'zim.1', name: 'Premier Soccer League (Zimbabwe)', shortName: 'ZIM', region: 'africa', priority: 3 },
  { code: 'caf.champions', name: 'Ligue des Champions CAF', shortName: 'CCL', region: 'africa', priority: 2 },
  { code: 'caf.confed', name: 'Coupe de la Confédération', shortName: 'CCF', region: 'africa', priority: 3 },

  // ---------- COMPÉTITIONS INTERNATIONALES ----------
  { code: 'fifa.world', name: 'Coupe du Monde', shortName: 'WC', region: 'international', priority: 1 },
  { code: 'fifa.cwc', name: 'Coupe du Monde des Clubs', shortName: 'CWC', region: 'international', priority: 1 },
  { code: 'fifa.friendly', name: 'Matchs Amicaux', shortName: 'AMI', region: 'international', priority: 2 },
  // Amicaux : remplissent les journées creuses pendant les trêves
  // internationales (0 match en plein championnat, mais crucial en trêve).
  { code: 'uefa.nations', name: 'Ligue des Nations', shortName: 'UNL', region: 'international', priority: 1 },
  { code: 'uefa.euro', name: 'Euro', shortName: 'EURO', region: 'international', priority: 1 },
  { code: 'conmebol.america', name: 'Copa América', shortName: 'CA', region: 'international', priority: 1 },
  { code: 'concacaf.gold', name: 'Gold Cup', shortName: 'GC', region: 'international', priority: 2 },
  { code: 'afc.asian.cup', name: 'Coupe d\'Asie', shortName: 'AC', region: 'international', priority: 2 },
  // Task 50 : afc.asiancup → afc.asian.cup (renommé par ESPN, nouveau
  // slug présent au registre officiel).
  { code: 'caf.nations', name: 'CAN', shortName: 'CAN', region: 'international', priority: 1 },
  // Task 50 — demande utilisateur : éliminatoires et compétitions CAF
  // (codes validés live contre ESPN, événements réels) :
  { code: 'caf.nations_qual', name: 'Éliminatoires CAN', shortName: 'QCAN', region: 'international', priority: 2 },
  { code: 'caf.championship', name: 'CHAN — Championnat d\'Afrique des Nations', shortName: 'CHAN', region: 'international', priority: 2 },
  { code: 'caf.cosafa', name: 'Coupe COSAFA (Afrique australe)', shortName: 'COSA', region: 'international', priority: 3 },
  { code: 'caf.w.nations', name: 'CAN féminine', shortName: 'CANF', region: 'international', priority: 3 },
  { code: 'global.gulf_cup', name: 'Coupe du Golfe arabe', shortName: 'GULF', region: 'international', priority: 3 },
  { code: 'fifa.worldq.uefa', name: 'Éliminatoires CDM (Europe)', shortName: 'WQE', region: 'international', priority: 2 },
  { code: 'fifa.worldq.conmebol', name: 'Éliminatoires CDM (Amérique du Sud)', shortName: 'WQS', region: 'international', priority: 2 },
  { code: 'fifa.worldq.concacaf', name: 'Éliminatoires CDM (CONCACAF)', shortName: 'WQC', region: 'international', priority: 2 },
  { code: 'fifa.worldq.afc', name: 'Éliminatoires CDM (Asie)', shortName: 'WQA', region: 'international', priority: 2 },
  { code: 'fifa.worldq.caf', name: 'Éliminatoires CDM (Afrique)', shortName: 'WQF', region: 'international', priority: 2 },
  { code: 'fifa.worldq.ofc', name: 'Éliminatoires CDM (Océanie)', shortName: 'WQO', region: 'international', priority: 2 },
  { code: 'fifa.wcq.ply', name: 'Barrages Éliminatoires CDM', shortName: 'WQP', region: 'international', priority: 2 },
  { code: 'uefa.euroq', name: 'Éliminatoires Euro', shortName: 'EQ', region: 'international', priority: 2 },
  { code: 'uefa.euro_u21', name: 'Euro U21', shortName: 'EU21', region: 'international', priority: 3 },
  { code: 'uefa.euro_u21_qual', name: 'Éliminatoires Euro U21', shortName: 'EQ21', region: 'international', priority: 3 },
  { code: 'fifa.olympics', name: 'Jeux Olympiques — Football', shortName: 'JO', region: 'international', priority: 2 },
  { code: 'fifa.world.u20', name: 'Coupe du Monde U20', shortName: 'U20', region: 'international', priority: 3 },
  { code: 'fifa.world.u17', name: 'Coupe du Monde U17', shortName: 'U17', region: 'international', priority: 3 },
  { code: 'fifa.friendly_u21', name: 'Amicaux U21', shortName: 'AU21', region: 'international', priority: 3 },
  { code: 'conmebol.libertadores', name: 'Copa Libertadores', shortName: 'LIB', region: 'international', priority: 2 },
  { code: 'conmebol.sudamericana', name: 'Copa Sudamericana', shortName: 'SUD', region: 'international', priority: 2 },
  { code: 'concacaf.champions', name: 'CONCACAF Champions Cup', shortName: 'CCC', region: 'international', priority: 2 },
  { code: 'afc.champions', name: 'AFC Champions League Elite', shortName: 'ACL', region: 'international', priority: 2 },
  { code: 'afc.cup', name: 'AFC Champions League Two', shortName: 'AC2', region: 'international', priority: 2 },
  { code: 'afc.champions_qual', name: 'Qualifications LDC Elite (AFC)', shortName: 'QACL', region: 'international', priority: 3 },
  { code: 'afc.cup_qual', name: 'Qualifications ACL Two (AFC)', shortName: 'QA2', region: 'international', priority: 3 },
  { code: 'club.friendly', name: 'Amicaux de Clubs', shortName: 'AMC', region: 'international', priority: 3 },
  { code: 'concacaf.nations.league', name: 'Ligue des Nations CONCACAF', shortName: 'CNL', region: 'international', priority: 3 },
];

export const LEAGUE_MAP: Record<string, LeagueDef> = Object.fromEntries(
  LEAGUES.map((l) => [l.code, l])
);

export function getLeague(code: string): LeagueDef | undefined {
  return LEAGUE_MAP[code];
}

export const REGION_LABELS: Record<LeagueDef['region'], string> = {
  europe: 'Europe',
  americas: 'Amériques',
  asia: 'Asie / Océanie',
  africa: 'Afrique',
  international: 'International',
};
