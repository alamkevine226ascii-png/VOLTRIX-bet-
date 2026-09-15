// ============================================================
// VOLTRIX bet — Analyse complète d'un match
// Orchestre : historiques équipes + classements + blessures +
// météo + cotes -> moteur de prédiction, avec cache.
// ============================================================

import {
  fetchTeamSchedule,
  fetchStandings,
  fetchInjuries,
  fetchScoreboard,
  type EspnEvent,
  type EspnScheduleGame,
  type EspnStandingsTeam,
} from './espn';
import { runEngine, type MatchAnalysis } from './prediction';
import { isVoidStatusDetail } from './grade';
import { fetchWeather } from './weather';
import { cacheGet, cacheSet, mapWithConcurrency } from './cache';
import { getLeague } from './leagues';

export interface AnalyzeRequest {
  matchId: string;
  leagueCode: string;
  date: string; // ISO date du match
}

export interface AnalyzeResult extends MatchAnalysis {
  matchId: string;
  leagueCode: string;
  leagueName: string;
  matchDate: string;
  status: 'pre' | 'in' | 'post';
  statusDetail: string;
  homeScore: number | null;
  awayScore: number | null;
  venue: { name: string | null; city: string | null; country: string | null };
  odds: {
    provider: string;
    hasOdds: boolean;
    moneyline: { home: { open: number | null; close: number | null }; draw: { open: number | null; close: number | null }; away: { open: number | null; close: number | null } };
    overUnderLine: number | null;
    total: {
      over: { line: number | null; openOdds: number | null; closeOdds: number | null };
      under: { line: number | null; openOdds: number | null; closeOdds: number | null };
    };
  } | null;
}

// Task 21-a (FIX 6) : exportées pour tests hors serveur (scripts/test-seasons.ts)
// + réutilisées par la route détail (Task 28 §7 : sync H2H depuis la base).
export const CURRENT_SEASON = 2026;
export const PREV_SEASON = 2025;

// Cache des analyses : le store PARTAGÉ borné de cache.ts (LRU + TTL +
// sweep) remplace l'ancien Map module-level sans limite — chaque analyse
// jamais calculée y restait pour toujours (fuite mémoire, Task 18-a).
// Clé : `analysis:{matchId}` (mêmes entrées que cacheAnalysisDirectly,
// qui alimentait un second canal de rétention désormais unifié).
const analysisKey = (matchId: string) => `analysis:${matchId}`;

// Task 21-a (FIX 6) : exportée pour tests hors serveur (scripts/test-seasons.ts).
export function currentSeasonYear(matchDate: string, leagueCode: string): number {
  // Task 19-a : getters UTC — la date du match est un ISO « …Z » et toutes
  // les fenêtres du projet sont en jour UTC (Task 14) ; les getters locaux
  // décalaient le mois d'un jour sur un serveur TZ≠UTC (01/08 00h30Z lu
  // « juillet » en UTC−5 → saison 2025 au lieu de 2026 → historiques vides).
  const d = new Date(matchDate);
  const year = d.getUTCFullYear();
  // Task 21-a (FIX 6) : championnats « année calendaire » — la saison EST
  // l'année du match (MLS 2026 = fév→oct 2026). L'ancienne règle unique
  // « mois ≥ 7 » supposait un calendrier européen août→mai et coupait les
  // débuts de saison (février-mars) sur l'année précédente → historiques
  // vides. Validé empiriquement (Task 21-a) : /teams/{id}/schedule?season=2026
  // MLS inclut les matchs de fév. 2026 ; eng.1 season=2025 inclut fév. 2026.
  if (CALENDAR_YEAR_LEAGUES.has(leagueCode)) return year;
  // Saisons européennes : août -> mai ; saison = année de départ
  const month = d.getUTCMonth() + 1;
  return month >= 7 ? year : year - 1;
}

// Task 21-a (FIX 6) : ligues à saison calendaire (janv→déc) — la saison =
// année calendaire du match, sans bascule « mois ≥ 7 ».
const CALENDAR_YEAR_LEAGUES: ReadonlySet<string> = new Set([
  'usa.1', // MLS
  'usa.nwsl', // NWSL
  'bra.1', // Brésil Série A
  'bra.2', // Brésil Série B
  'arg.1', // Argentine
  'jpn.1', // Japon
  'kor.1', // Corée du Sud
  'chn.1', // Chine
  'nor.1', // Norvège
  'swe.1', // Suède
  'fin.1', // Finlande
  'irl.1', // Irlande
]);

export async function analyzeMatch(req: AnalyzeRequest): Promise<AnalyzeResult | null> {
  const { matchId, leagueCode, date } = req;
  const isLiveOrDone = (() => {
    const matchTime = new Date(date).getTime();
    return Date.now() > matchTime - 60 * 60 * 1000; // 1h avant le coup d'envoi
  })();
  const ttl = isLiveOrDone ? 60 * 1000 : 30 * 60 * 1000;

  const key = analysisKey(matchId);
  const cachedEntry = cacheGet<AnalyzeResult>(key);
  if (cachedEntry) return cachedEntry;

  // 1. Scoreboard de la ligue pour ce match (données de base + cotes)
  //    Si le match est introuvable sur la date demandée (match tardif classé
  //    sur une autre journée par ESPN), on essaie les dates adjacentes.
  const dateParam = date.slice(0, 10);
  let board = await fetchScoreboard(leagueCode, dateParam);
  if (board && !board.events.some((e) => e.id === matchId)) {
    const prev = new Date(new Date(dateParam + 'T12:00:00Z').getTime() - 86400000)
      .toISOString()
      .slice(0, 10);
    const next = new Date(new Date(dateParam + 'T12:00:00Z').getTime() + 86400000)
      .toISOString()
      .slice(0, 10);
    board =
      (await fetchScoreboard(leagueCode, next))?.events.some((e) => e.id === matchId)
        ? await fetchScoreboard(leagueCode, next)
        : (await fetchScoreboard(leagueCode, prev))?.events.some((e) => e.id === matchId)
          ? await fetchScoreboard(leagueCode, prev)
          : board;
  }
  if (!board) return null;
  const event = board.events.find((e) => e.id === matchId);
  if (!event) return null;
  if (!event.home || !event.away) return null;

  const season = currentSeasonYear(date, leagueCode);

  // 2. Historiques des 2 équipes (saison courante + précédente)
  const seasons = [PREV_SEASON, season].filter((s) => s > 0);
  let homeSchedule: EspnScheduleGame[] = [];
  let awaySchedule: EspnScheduleGame[] = [];
  try {
    const [hs, as] = await Promise.all([
      fetchTeamSchedule(leagueCode, event.home.team.id, seasons),
      fetchTeamSchedule(leagueCode, event.away.team.id, seasons),
    ]);
    homeSchedule = hs;
    awaySchedule = as;
  } catch {
    homeSchedule = [];
    awaySchedule = [];
  }

  // 3. Classement + blessures (par ligue)
  let standings: EspnStandingsTeam[] = [];
  let injuries: Awaited<ReturnType<typeof fetchInjuries>> = [];
  try {
    const [st, inj] = await Promise.all([fetchStandings(leagueCode, season), fetchInjuries(leagueCode)]);
    standings = st;
    injuries = inj;
  } catch {
    standings = [];
  }

  // 4. Météo (ville du stade)
  const weather = await fetchWeather(event.venue.city, event.venue.country);

  const leagueDef = getLeague(leagueCode);

  // 5. Moteur !
  const analysis = runEngine({
    homeTeam: {
      id: event.home.team.id,
      name: event.home.team.displayName,
      logo: event.home.team.logo,
      schedule: homeSchedule,
      standings: standings.find((s) => s.teamId === event.home!.team.id) ?? null,
    },
    awayTeam: {
      id: event.away.team.id,
      name: event.away.team.displayName,
      logo: event.away.team.logo,
      schedule: awaySchedule,
      standings: standings.find((s) => s.teamId === event.away!.team.id) ?? null,
    },
    injuries,
    odds: event.odds,
    isDerby: false,
    weatherImpact: weather ? { goalsFactor: weather.goalsFactor } : null,
    nowMs: Date.now(),
    leagueTeamsCount: standings.length || 20,
  });

  // Task 28 §7 : le H2H « depuis la base Neon » est résolu dans la route
  // de DÉTAIL (/api/match/[id] — seul consommateur de l'historique),
  // PAS ici : la passe d'analyse en lot de l'accueil (51 matchs) ne doit
  // subir aucune latence Neon. L'orchestrateur reste 100 % ESPN, le
  // moteur n'est pas modifié, et getH2HFromDb (les deux ordres §7)
  // remplace le H2H moteur côté détail — voir src/app/api/match/[id]/route.ts.

  const result: AnalyzeResult = {
    ...analysis,
    matchId,
    leagueCode,
    leagueName: leagueDef?.name ?? board.leagueName,
    matchDate: event.date,
    status: event.status,
    statusDetail: event.statusDetail,
    homeScore: event.home.score,
    awayScore: event.away.score,
    venue: event.venue,
    odds: event.odds
      ? {
          provider: event.odds.provider,
          hasOdds: event.odds.hasOdds,
          moneyline: event.odds.moneyline,
          overUnderLine: event.odds.overUnderLine,
          total: event.odds.total,
        }
      : null,
  };

  cacheSet(key, result, ttl);
  return result;
}

// Analyse en lot (pour remplir progressivement les cartes)
export async function analyzeBatch(
  requests: AnalyzeRequest[],
  concurrency = 6
): Promise<(AnalyzeResult | null)[]> {
  return mapWithConcurrency(requests, concurrency, (r) => analyzeMatch(r).catch(() => null));
}

// ---------- Persistance des pronos (suivi de performance) ----------

export interface StoredPick {
  market: string;
  pick: string;
  probability: number;
  odds: number | null;
  /** Task 21-a (FIX 5) : ID équipe ESPN du côté piqué (1X2 uniquement, null pour X/O-U/BTTS). */
  pickedTeamId: string | null;
  /** Task 22-a : probabilité BRUTE (pré-calibration) du pick — plan V2→V3 « probabilités brutes ».
   *  O/U et BTTS : issues BRUTES correspondantes (p.raw) ; 1X2/DC : la calibration (21-b) ne
   *  touche que les totals → la proba du moteur est déjà brute, rawProbability = probability. */
  rawProbability: number;
  /** Task 22-a : empreinte JSON compacte (< 300 car.) des entrées consommées par le moteur —
   *  plan étape 5 « geler les entrées » / reconstructibilité. */
  inputsDigest: string;
  confidence: number;
}

// Task 22-a (plan V2→V3 étape 5, reconstructibilité) : empreinte COMPACTE des entrées
// réellement consommées par runEngine pour ce match — cotes marché présentes, ligne O/U
// du marché (ancre de calibration), tailles d'historique (matchs dom/ext PAR équipe —
// échantillons réels des ratios attaque/défense), blessures actives par équipe,
// disponibilité du classement (nb d'équipes avec rang connu : 0, 1 ou 2).
// Typiquement ~65 caractères ; la limite dure est 300 (garde-fou testé dans
// scripts/test-prediction-immutability.ts).
export function buildInputsDigest(analysis: AnalyzeResult): string {
  const o = analysis.odds;
  return JSON.stringify({
    odds: o?.hasOdds ? 1 : 0, // cotes marché publiées (moteur calibre les totals si 1)
    ou: o?.overUnderLine ?? null, // ligne O/U du marché
    h: [analysis.home.gamesHome, analysis.home.gamesAway], // historique équipe dom : matchs dom/ext
    a: [analysis.away.gamesHome, analysis.away.gamesAway], // historique équipe ext : matchs dom/ext
    inj: [analysis.home.injuriesCount, analysis.away.injuriesCount], // blessures actives
    st: (analysis.home.rank != null ? 1 : 0) + (analysis.away.rank != null ? 1 : 0), // standings dispo (rank != null ⟺ entrée classement trouvée)
  });
}

export function extractPicks(analysis: AnalyzeResult): StoredPick[] {
  const p = analysis.prediction;
  const picks: StoredPick[] = [];
  // Garde-fous : une probabilité non finie (NaN/null après JSON) est rejetée par Prisma
  const safeProb = (x: number) => (Number.isFinite(x) && x > 0 ? Math.round(x * 10000) / 10000 : 0.3333);
  // Task 22-a : issues BRUTES (p.raw, pré-calibration — audit 21-b FIX 4). Optional chaining
  // défensif : une analyse encore en cache LRU d'avant 21-b peut ne pas exposer `raw` →
  // repli sur le calibré (= probability) pour ne jamais stocker NULL par négligence.
  const rawOu25 = p.raw?.overUnder?.find((o) => o.line === 2.5);
  const rawBtts = p.raw?.btts;

  const homeName = analysis.home.name;
  const awayName = analysis.away.name;
  const best = p.probs.home >= p.probs.away ? (p.probs.home >= p.probs.draw ? 'home' : 'draw') : p.probs.away >= p.probs.draw ? 'away' : 'draw';
  // Task 22-a : la calibration marché (deMarginOverUnder + calibrateTotals, audit 21-b FIX 1)
  // ne touche QUE les marchés de buts (overUnder/btts) — la proba 1X2 (et DC) du moteur n'est
  // PAS calibrée en v2.1 → brut = final pour ces marchés (rawProbability = probability).
  const prob1x2 = safeProb(best === 'home' ? p.probs.home : best === 'away' ? p.probs.away : p.probs.draw);
  picks.push({
    market: '1X2',
    pick: best === 'home' ? `1 - ${homeName}` : best === 'away' ? `2 - ${awayName}` : 'X - Nul',
    probability: prob1x2,
    rawProbability: prob1x2, // 1X2 non calibré : la proba du moteur est déjà brute (v2.1)
    odds:
      best === 'home'
        ? (analysis.odds?.moneyline.home.close ?? null)
        : best === 'away'
          ? (analysis.odds?.moneyline.away.close ?? null)
          : (analysis.odds?.moneyline.draw.close ?? null),
    // Task 21-a (FIX 5) : l'ID équipe ESPN du côté piqué accompagne le pick —
    // le grading 1X2 sera fait par ID (fiable), repli sur le nom sinon.
    pickedTeamId:
      best === 'home' ? (analysis.home.id ?? null) : best === 'away' ? (analysis.away.id ?? null) : null,
    inputsDigest: buildInputsDigest(analysis),
    confidence: p.confidence,
  });

  const ou = p.overUnder.find((o) => o.line === 2.5);
  if (ou) {
    picks.push({
      market: 'O/U 2.5',
      pick: ou.over >= ou.under ? 'Plus de 2.5' : 'Moins de 2.5',
      probability: safeProb(Math.max(ou.over, ou.under)),
      // Task 22-a : brut = issue O/U 2.5 de p.raw (pré-calibration) — le calibré ancré marché
      // reste dans `probability` ; les deux cohabitent pour mesurer l'apport de la calibration.
      rawProbability: safeProb(rawOu25 ? Math.max(rawOu25.over, rawOu25.under) : Math.max(ou.over, ou.under)),
      odds:
        ou.over >= ou.under
          ? (analysis.odds?.total.over.closeOdds ?? null)
          : (analysis.odds?.total.under.closeOdds ?? null),
      pickedTeamId: null,
      inputsDigest: buildInputsDigest(analysis),
      confidence: p.confidence,
    });
  }

  picks.push({
    market: 'BTTS',
    pick: p.btts.yes >= p.btts.no ? 'Oui' : 'Non',
    probability: safeProb(Math.max(p.btts.yes, p.btts.no)),
    // Task 22-a : brut = issue BTTS de p.raw (forme fermée pré-calibration).
    rawProbability: safeProb(rawBtts ? Math.max(rawBtts.yes, rawBtts.no) : Math.max(p.btts.yes, p.btts.no)),
    odds: null,
    pickedTeamId: null,
    inputsDigest: buildInputsDigest(analysis),
    confidence: p.confidence,
  });

  return picks;
}

// Résoudre les pronos stockés d'une date donnée
// Task 18-a : les scoreboards des ligues sont récupérés EN PARALLÈLE
// (concurrency bornée 5) au lieu d'une boucle séquentielle — une date avec
// 30 ligues coûtait 30 fetchs ESPN à la file (GET /api/performance à 13.3 s).
// Les écritures DB restent SÉQUENTIELLES (SQLite n'accepte qu'un écrivain).
// Task 21-a (FIX 2/4/5) :
//  - FIX 4 : événement annulé/reporté/suspendu → result VOID (remboursement)
//    au lieu de rester PENDING à vie ;
//  - FIX 2 : à la résolution (résultat connu = cotes de clôture disponibles),
//    la cote de clôture ESPN de la sélection est archivée dans closingOdds —
//    elle n'est JAMAIS utilisée pour le ROI (qui ne lit que `odds`) ;
//  - FIX 5 : le 1X2 est noté par pickedTeamId (ID ESPN) en priorité, avec
//    repli sur le côté encodé dans le pick (« 1 - » / « X - » / « 2 - »).
export async function resolvePredictionsForDate(
  dateParam: string,
  stored: Array<{
    id: string;
    matchId: string;
    league: string;
    market: string;
    pick: string;
    odds: number | null;
    pickedTeamId?: string | null;
  }>,
  db: {
    prediction: {
      update: (args: {
        where: { id: string };
        data: { resolved: boolean; result: string; closingOdds?: number | null };
      }) => Promise<unknown>;
    };
  }
): Promise<number> {
  if (stored.length === 0) return 0;
  const byLeague = new Map<string, Set<string>>();
  for (const s of stored) {
    if (!byLeague.has(s.league)) byLeague.set(s.league, new Set());
    byLeague.get(s.league)!.add(s.matchId);
  }

  // 1) Fetchs ESPN en parallèle borné (5) — le résultat intermédiaire
  //    ne garde que ce qui est nécessaire (events par ligue).
  const boards = await mapWithConcurrency([...byLeague.keys()], 5, async (league) => {
    try {
      return await fetchScoreboard(league, dateParam);
    } catch {
      return null;
    }
  });

  // 1bis) Task 19-a (finding ②) : ESPN classe les matchs de 00h-04h UTC sur
  //    la feuille scoreboard de la VEILLE (regroupement heure US Eastern,
  //    EDT = UTC−4) → ces pronos n'étaient jamais trouvés, jamais résolus.
  //    On ne refetch que les ligues dont au moins un matchId est absent.
  const seenIds = new Set<string>();
  for (const board of boards) for (const ev of board?.events ?? []) seenIds.add(ev.id);
  const missingLeagues = new Set<string>();
  for (const s of stored) {
    if (!seenIds.has(s.matchId) && byLeague.has(s.league)) missingLeagues.add(s.league);
  }
  if (missingLeagues.size > 0) {
    const prevDate = new Date(Date.parse(`${dateParam}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    const prevBoards = await mapWithConcurrency([...missingLeagues], 5, async (league) => {
      try {
        return await fetchScoreboard(league, prevDate);
      } catch {
        return null;
      }
    });
    boards.push(...prevBoards);
  }

  // 2) Grading + écritures DB séquentielles
  //    Task 19-a : un événement peut figurer sur les feuilles J ET J−1
  //    (report/reclassement ESPN) — sans dédoublonnage, chaque prono serait
  //    réécrit 2× et `resolvedCount` compté 2× (métrique faussée).
  let resolvedCount = 0;
  const donePickIds = new Set<string>();

  // Task 21-a (FIX 2) : écriture avec closingOdds ; si le client Prisma en
  // mémoire du serveur long-running ne connaît pas encore la colonne ajoutée
  // par db push, repli silencieux sur l'écriture historique (résultat seul) —
  // la capture d'clôture redeviendra active au prochain rechargement du client.
  let closingOddsSupported = true;
  const settleRow = async (id: string, result: string, closingOdds: number | null) => {
    if (closingOddsSupported) {
      try {
        await db.prediction.update({ where: { id }, data: { resolved: true, result, closingOdds } });
        return;
      } catch {
        closingOddsSupported = false;
      }
    }
    await db.prediction.update({ where: { id }, data: { resolved: true, result } });
  };

  // Task 21-a (FIX 5) : côté piqué 1X2 — par ID équipe ESPN en priorité,
  // repli sur le côté encodé dans le pick (« 1 - » / « X - » / « 2 - »).
  const pickedSide1X2 = (s: { pick: string; pickedTeamId?: string | null }, ev: EspnEvent): string => {
    const side = s.pick.split(' - ')[0];
    const homeId = ev.home?.team?.id ?? '';
    const awayId = ev.away?.team?.id ?? '';
    if (s.pickedTeamId && homeId && awayId) {
      if (s.pickedTeamId === homeId) return '1';
      if (s.pickedTeamId === awayId) return '2';
    }
    return side;
  };

  // Task 21-a (FIX 2) : cote de clôture ESPN de la sélection (même sémantique
  // que `odds`), lue sur le scoreboard au moment de la résolution.
  const closingOddsForPick = (s: { market: string; pick: string; pickedTeamId?: string | null }, ev: EspnEvent): number | null => {
    const o = ev.odds;
    if (!o) return null;
    if (s.market === '1X2') {
      const side = pickedSide1X2(s, ev);
      if (side === '1') return o.moneyline.home.close ?? null;
      if (side === '2') return o.moneyline.away.close ?? null;
      return o.moneyline.draw.close ?? null;
    }
    if (s.market.startsWith('O/U')) {
      const over = s.pick.startsWith('Plus');
      return (over ? o.total.over.closeOdds : o.total.under.closeOdds) ?? null;
    }
    return null; // BTTS : pas de cote ESPN publiée
  };

  for (const board of boards) {
    if (!board) continue;
    for (const ev of board.events) {
      // Task 21-a (FIX 4) : annulé/reporté/suspendu/retardé/forfait → VOID
      // (remboursement), AVANT le filtre completed/score — un événement annulé
      // n'est jamais "completed" et restait PENDING à vie avant ce correctif.
      if (isVoidStatusDetail(ev.statusDetail)) {
        for (const s of stored) {
          if (s.matchId !== ev.id) continue;
          if (donePickIds.has(s.id)) continue;
          donePickIds.add(s.id);
          await settleRow(s.id, 'VOID', null);
          resolvedCount++;
        }
        continue;
      }
      if (!ev.completed || ev.home?.score === null || ev.home?.score === undefined) continue;
      if (ev.away?.score === null || ev.away?.score === undefined) continue;
      const hs = ev.home.score!;
      const as = ev.away.score!;
      const totalGoals = hs + as;
      const btts = hs > 0 && as > 0;
      for (const s of stored) {
        if (s.matchId !== ev.id) continue;
        if (donePickIds.has(s.id)) continue;
        donePickIds.add(s.id);
        let result: string;
        if (s.market === '1X2') {
          const actual = hs > as ? '1' : hs === as ? 'X' : '2';
          const pickedSide = pickedSide1X2(s, ev);
          result = pickedSide === actual ? 'WIN' : 'LOSE';
        } else if (s.market === 'O/U 2.5') {
          const over = s.pick.startsWith('Plus');
          result = (totalGoals > 2.5) === over ? 'WIN' : 'LOSE';
        } else if (s.market === 'BTTS') {
          const yes = s.pick === 'Oui';
          result = btts === yes ? 'WIN' : 'LOSE';
        } else {
          result = 'VOID';
        }
        await settleRow(s.id, result, closingOddsForPick(s, ev));
        resolvedCount++;
      }
    }
  }
  return resolvedCount;
}

// ---------- Statistiques de performance (fonction PURE — Task 21-a FIX 1/3) ----------
// Extraite de /api/performance pour être testable hors serveur
// (scripts/test-performance-integrity.ts). Les règles :
//  - FIX 1 : métriques PRÉDICTIVES (accuracy, Brier, par marché/confiance/ligue)
//    portent sur TOUS les pronos réglés WIN/LOSE ; métriques ÉCONOMIQUES
//    (staked, returned, ROI) sur le seul sous-ensemble avec cote réelle
//    (odds != null && odds > 1) — plus JAMAIS de fallback « cote 2.00 » ;
//  - VOID exclu des deux (jambe remboursée : ni réussite ni perte) ;
//  - FIX 3 : la route alimente ces accumulateurs avec TOUTE l'historique
//    (pagination par curseur), le bloc `sample` en atteste.

export interface PerfStatRow {
  id: string;
  leagueName: string;
  market: string;
  pick: string;
  probability: number;
  odds: number | null;
  confidence: number;
  resolved: boolean;
  result: string | null;
  /** Task 22-a : version du modèle ayant produit le prono (NULL = lignes d'avant le versionnement). Optionnel pour rétrocompatibilité des appels/tests. */
  modelVersion?: string | null;
}

export interface PerfStats {
  totalPredictions: number;
  pendingCount: number;
  totalResolved: number;
  wins: number;
  winRate: number;
  staked: number;
  returned: number;
  roi: number;
  economic: { settledWithOdds: number; staked: number; returned: number; roi: number };
  byMarket: Record<string, { total: number; wins: number; winRate: number }>;
  byConfidence: Record<string, { total: number; wins: number; winRate: number }>;
  byLeague: Record<string, { total: number; wins: number; winRate: number }>;
  /** Task 22-a (plan V2→V3 étape 14) : métriques de base PAR VERSION du modèle (n = pronos
   *  réglés WIN/LOSE, même filtre que byMarket) — les futures validations comparent les
   *  versions sans les mélanger. Clé 'legacy' = modelVersion NULL (avant versionnement). */
  byVersion: Record<string, { n: number; wins: number; winRate: number }>;
  calibration: {
    brierScore: number;
    sample: number;
    buckets: Array<{ label: string; count: number; avgProb: number; actualRate: number }>;
  };
  sample: { settled: number; withOdds: number; source: 'full-history' };
}

/** Cote réelle publiée (une cote absente/≤ 1 n'est pas une cote). */
export function hasRealOdds(odds: number | null | undefined): boolean {
  return odds !== null && odds !== undefined && odds > 1;
}

export function computePerformanceStats(rows: PerfStatRow[], stake = 10): PerfStats {
  const BUCKETS: Array<{ label: string; min: number; max: number }> = [
    { label: '30-40 %', min: 0.3, max: 0.4 },
    { label: '40-50 %', min: 0.4, max: 0.5 },
    { label: '50-60 %', min: 0.5, max: 0.6 },
    { label: '60-70 %', min: 0.6, max: 0.7 },
    { label: '70-80 %', min: 0.7, max: 0.8 },
    { label: '80-90 %', min: 0.8, max: 0.9 },
    { label: '90-100 %', min: 0.9, max: 1.01 },
  ];
  const bucketAcc = BUCKETS.map((b) => ({ ...b, count: 0, probSum: 0, wins: 0 }));
  const byMarket: Record<string, { total: number; wins: number; winRate: number }> = {};
  const byConfidence: Record<string, { total: number; wins: number; winRate: number }> = {};
  const byLeague: Record<string, { total: number; wins: number; winRate: number }> = {};
  const byVersion: Record<string, { n: number; wins: number; winRate: number }> = {};

  let pendingCount = 0;
  let totalResolved = 0;
  let wins = 0;
  let staked = 0;
  let returned = 0;
  let settledWithOdds = 0;
  let brierSum = 0;

  for (const p of rows) {
    if (!p.resolved) {
      pendingCount++;
      continue;
    }
    // VOID / statuts inconnus : hors métriques (jambe remboursée — ni réussite ni perte)
    if (p.result !== 'WIN' && p.result !== 'LOSE') continue;

    totalResolved++;
    const isWin = p.result === 'WIN';
    if (isWin) wins++;

    // Prédictif (accuracy + Brier) : TOUS les pronos réglés, avec ou sans cote
    const outcome = isWin ? 1 : 0;
    brierSum += (p.probability - outcome) ** 2;
    const bucket = bucketAcc.find((b) => p.probability >= b.min && p.probability < b.max);
    if (bucket) {
      bucket.count++;
      bucket.probSum += p.probability;
      if (isWin) bucket.wins++;
    }

    const acc = (map: Record<string, { total: number; wins: number; winRate: number }>, key: string) => {
      if (!map[key]) map[key] = { total: 0, wins: 0, winRate: 0 };
      map[key].total++;
      if (isWin) map[key].wins++;
      map[key].winRate = map[key].wins / map[key].total;
    };
    acc(byMarket, p.market);
    acc(byConfidence, String(p.confidence));
    acc(byLeague, p.leagueName);
    // Task 22-a : groupement par version du modèle (même filtre WIN/LOSE que les autres
    // groupements) — NULL → 'legacy' : une clé JSON doit être une chaîne, et « avant
    // versionnement » est une cohorte en soi (ne JAMAIS la fusionner avec 'v2.1').
    const vKey = p.modelVersion ?? 'legacy';
    if (!byVersion[vKey]) byVersion[vKey] = { n: 0, wins: 0, winRate: 0 };
    byVersion[vKey].n++;
    if (isWin) byVersion[vKey].wins++;
    byVersion[vKey].winRate = byVersion[vKey].wins / byVersion[vKey].n;

    // Économique : UNIQUEMENT les sélections avec cote réelle au moment du prono
    if (hasRealOdds(p.odds)) {
      settledWithOdds++;
      staked += stake;
      if (isWin) returned += p.odds! * stake;
    }
  }

  const roi = staked > 0 ? (returned - staked) / staked : 0;
  const economicRoi = roi;
  return {
    totalPredictions: rows.length,
    pendingCount,
    totalResolved,
    wins,
    winRate: totalResolved > 0 ? wins / totalResolved : 0,
    staked,
    returned,
    roi,
    economic: { settledWithOdds, staked, returned, roi: economicRoi },
    byMarket,
    byConfidence,
    byLeague,
    byVersion,
    calibration: {
      brierScore: totalResolved > 0 ? brierSum / totalResolved : 0,
      sample: totalResolved,
      buckets: bucketAcc
        .filter((b) => b.count >= 3)
        .map((b) => ({
          label: b.label,
          count: b.count,
          avgProb: b.probSum / b.count,
          actualRate: b.wins / b.count,
        })),
    },
    sample: { settled: totalResolved, withOdds: settledWithOdds, source: 'full-history' },
  };
}

export function cacheAnalysisDirectly(matchId: string, result: AnalyzeResult, ttlMs: number) {
  cacheSet(analysisKey(matchId), result, ttlMs);
}

export function getCachedAnalysis(matchId: string): AnalyzeResult | undefined {
  return cacheGet<AnalyzeResult>(analysisKey(matchId));
}
