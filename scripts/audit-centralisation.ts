/**
 * AUDIT CENTRALISATION — Task 28 suite (demande utilisateur 15/09)
 * STRICTEMENT LECTURE SEULE : aucune écriture, aucune DDL, aucun appel ESPN.
 * Répond point par point au cahier d'audit de centralisation.
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const q = (sql: string): Promise<Record<string, unknown>[]> =>
  prisma.$queryRawUnsafe(sql) as Promise<Record<string, unknown>[]>

function log(s = '') { console.log(s) }
const n = (x: unknown) => Number(x ?? 0)
const iso = (x: unknown) => (x instanceof Date ? x.toISOString() : String(x ?? ''))

async function main() {
  log('='.repeat(78))
  log('AUDIT CENTRALISATION NEON —', iso(new Date()))
  log('(lecture seule — aucune modification)')
  log('='.repeat(78))

  // ---------- 1. INVENTAIRE COMPLET DES TABLES / VUES ----------
  log('\n[1] INVENTAIRE information_schema (tables + vues du schéma public)')
  const inv = await q(`SELECT table_name, table_type FROM information_schema.tables
     WHERE table_schema='public' ORDER BY table_type, table_name`)
  for (const r of inv) log(`  ${String(r.table_type).padEnd(22)} ${r.table_name}`)

  // Recherche de tables standings / injuries / weather / h2h
  log('\n[1b] Recherche tables standings/injuries/weather/form/h2h')
  const hunt = await q(`SELECT table_name FROM information_schema.tables
     WHERE table_schema='public' AND (table_name ILIKE '%standing%' OR table_name ILIKE '%injur%'
       OR table_name ILIKE '%weather%' OR table_name ILIKE '%form%' OR table_name ILIKE '%h2h%')`)
  log(hunt.length === 0 ? '  AUCUNE table correspondante — standings/blessures/météo NON persistés' : `  Trouvé: ${hunt.map((r) => r.table_name).join(', ')}`)

  // ---------- 2. COMPTAGES ----------
  log('\n[2] COMPTAGES (via vues conformes snake_case)')
  const counts = await q(`SELECT 'matches' t, COUNT(*) c FROM matches
    UNION ALL SELECT 'teams', COUNT(*) FROM teams
    UNION ALL SELECT 'competitions', COUNT(*) FROM competitions
    UNION ALL SELECT 'odds', COUNT(*) FROM odds
    UNION ALL SELECT 'results (match_results)', COUNT(*) FROM results
    UNION ALL SELECT 'prediction_snapshots', COUNT(*) FROM prediction_snapshots
    UNION ALL SELECT 'prediction_markets', COUNT(*) FROM prediction_markets
    UNION ALL SELECT 'prediction_outcomes', COUNT(*) FROM prediction_outcomes
    UNION ALL SELECT 'prediction_components', COUNT(*) FROM prediction_components
    UNION ALL SELECT 'forecast_snapshots (legacy)', COUNT(*) FROM "ForecastSnapshot"
    UNION ALL SELECT 'forecast_matches (legacy)', COUNT(*) FROM "ForecastMatch"
    UNION ALL SELECT 'predictions (legacy Précision)', COUNT(*) FROM "Prediction"
    UNION ALL SELECT 'forecast_evaluations', COUNT(*) FROM "ForecastEvaluation"
    UNION ALL SELECT 'sync_job_runs', COUNT(*) FROM sync_job_runs
    UNION ALL SELECT 'forecast_job_runs', COUNT(*) FROM "ForecastJobRun"`)
  for (const r of counts) log(`  ${String(r.t).padEnd(34)} = ${n(r.c)}`)

  // ---------- 3. RÉPARTITION 8 JOURS (requête utilisateur) ----------
  log('\n[3] MATCHS FUTURS PAR JOUR (kickoff_at >= NOW(), fenêtre 8 jours — requête SQL utilisateur)')
  const byDay = await q(`SELECT DATE(kickoff_at) jour, COUNT(*) matchs FROM matches
    WHERE kickoff_at >= NOW() AND kickoff_at < NOW() + INTERVAL '8 days'
    GROUP BY DATE(kickoff_at) ORDER BY jour`)
  let tot8 = 0
  for (const r of byDay) { tot8 += n(r.matchs); log(`  ${iso(r.jour).slice(0, 10)}  ${n(r.matchs)}`) }
  log(`  TOTAL 8 jours = ${tot8}`)
  const totFut = await q(`SELECT COUNT(*) c FROM matches WHERE kickoff_at >= NOW()`)
  const totPast = await q(`SELECT COUNT(*) c FROM matches WHERE kickoff_at < NOW()`)
  log(`  Total futurs = ${n(totFut[0].c)} | Total passés = ${n(totPast[0].c)}`)

  // ---------- 4. PROFONDEUR HISTORIQUE ----------
  log('\n[4] PROFONDEUR HISTORIQUE (finalisés par mois — capacité Poisson/Elo/Forme/H2H)')
  log(`  min kickoff = ${iso((await q(`SELECT MIN(kickoff_at) m FROM matches`))[0].m)}`)
  log(`  max kickoff = ${iso((await q(`SELECT MAX(kickoff_at) m FROM matches`))[0].m)}`)
  const hist = await q(`SELECT DATE_TRUNC('month', kickoff_at) mois, COUNT(*) c,
      SUM(CASE WHEN status='FINAL' AND home_score IS NOT NULL THEN 1 ELSE 0 END) finis
    FROM matches WHERE kickoff_at < NOW() GROUP BY 1 ORDER BY 1 DESC LIMIT 8`)
  for (const r of hist) log(`  ${iso(r.mois).slice(0, 7)}  total=${n(r.c).toString().padStart(5)}  FINAL+score=${n(r.finis)}`)

  // Équipes ayant au moins 1 match finalisé en base (couverture historique)
  const teamsHist = await q(`SELECT COUNT(DISTINCT t) c FROM (
      SELECT home_team_id t FROM matches WHERE status='FINAL' AND home_team_id IS NOT NULL
      UNION SELECT away_team_id FROM matches WHERE status='FINAL' AND away_team_id IS NOT NULL) x`)
  log(`  Équipes avec >=1 match FINAL en base = ${n(teamsHist[0].c)} / total équipes`)

  // ---------- 5. COTES HISTORISÉES (§ utilisateur : timestamp + jamais écrasées) ----------
  log('\n[5] COTES HISTORISÉES')
  const byMkt = await q(`SELECT market_type, outcome, COUNT(*) c FROM odds GROUP BY 1,2 ORDER BY 1,2`)
  for (const r of byMkt) log(`  ${String(r.market_type).padEnd(12)} ${String(r.outcome).padEnd(6)} = ${n(r.c)}`)
  const multi = await q(`SELECT COUNT(*) c FROM (
      SELECT match_id, market_type, outcome, COUNT(*) k FROM odds
      GROUP BY 1,2,3 HAVING COUNT(*) > 1) x`)
  const totCaptures = await q(`SELECT COUNT(*) c FROM odds`)
  log(`  Séries de captures multiples (même match+marché+issue) = ${n(multi[0].c)} — preuve d'historisation`)
  log(`  Captures totales = ${n(totCaptures[0].c)}`)
  // Exemple concret de timeline de cote
  const ex = await q(`SELECT o.match_id, o.market_type, o.outcome, o.odds, o.captured_at, o.bookmaker
    FROM odds o JOIN (
      SELECT match_id, market_type, outcome FROM odds GROUP BY 1,2,3 HAVING COUNT(*) >= 3 LIMIT 1) s
    ON o.match_id=s.match_id AND o.market_type=s.market_type AND o.outcome=s.outcome
    ORDER BY o.captured_at ASC LIMIT 6`)
  if (ex.length) {
    log(`  EXEMPLE timeline (match ${ex[0].match_id}, ${ex[0].market_type}/${ex[0].outcome}) :`)
    for (const r of ex) log(`    ${iso(r.captured_at)}  cote=${Number(r.odds).toFixed(2)}  book=${r.bookmaker}`)
  } else log('  (aucune série >= 3 captures pour le moment)')
  // Couverture cotes
  const covOdds = await q(`SELECT COUNT(DISTINCT match_id) c FROM odds`)
  const futWithOdds = await q(`SELECT COUNT(DISTINCT o.match_id) c FROM odds o JOIN matches m ON m.espn_event_id=o.match_id
     WHERE m.kickoff_at >= NOW()`)
  log(`  Matchs avec >=1 cote = ${n(covOdds[0].c)} ; matchs futurs avec cote = ${n(futWithOdds[0].c)}`)

  // ---------- 6. RÉSULTATS SÉPARÉS + LIEN MATCH ----------
  log('\n[6] RÉSULTATS SÉPARÉS (results / MatchResult)')
  const resStat = await q(`SELECT status, COUNT(*) c, SUM(CASE WHEN winner IS NOT NULL THEN 1 ELSE 0 END) w FROM results GROUP BY 1 ORDER BY 2 DESC`)
  for (const r of resStat) log(`  ${String(r.status).padEnd(10)} = ${n(r.c)}  (winner renseigné: ${n(r.w)})`)
  const orphans = await q(`SELECT COUNT(*) c FROM results r LEFT JOIN matches m ON m.espn_event_id=r.match_id WHERE m.espn_event_id IS NULL`)
  log(`  Résultats orphelins (sans ligne match) = ${n(orphans[0].c)}`)
  const noRes = await q(`SELECT COUNT(*) c FROM matches m WHERE m.status='FINAL' AND m.home_score IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM results r WHERE r.match_id=m.espn_event_id)`)
  log(`  Matchs FINAL+score sans ligne résultat séparée = ${n(noRes[0].c)}`)

  // ---------- 7. IMMUTABILITÉ PRÉDICTIONS (triggers) ----------
  log('\n[7] IMMUTABILITÉ — triggers PostgreSQL actifs')
  const trg = await q(`SELECT event_object_table, action_timing, event_manipulation FROM information_schema.triggers
     WHERE trigger_schema='public' AND trigger_name ILIKE '%immut%' ORDER BY 1, 3`)
  if (!trg.length) {
    const trg2 = await q(`SELECT event_object_table, action_timing, event_manipulation FROM information_schema.triggers
       WHERE trigger_schema='public' AND event_object_table ILIKE '%prediction%' ORDER BY 1,3`)
    for (const r of trg2) log(`  ${r.event_object_table} : ${r.action_timing} ${r.event_manipulation} bloqué`)
    if (!trg2.length) log('  AUCUN trigger immutabilité trouvé — ANOMALIE')
  } else for (const r of trg) log(`  ${r.event_object_table} : ${r.action_timing} ${r.event_manipulation} bloqué`)

  // ---------- 8. PRÉDICTIONS GÉNÉRIQUES : couverture + composants ----------
  log('\n[8] PRÉDICTIONS GÉNÉRIQUES (PredictionSnapshot — audit/agents futurs)')
  const ps = await q(`SELECT COUNT(*) snaps, COUNT(DISTINCT match_id) matchs, MIN(prediction_time) t0, MAX(prediction_time) t1 FROM prediction_snapshots`)
  log(`  snapshots=${n(ps[0].snaps)} sur ${n(ps[0].matchs)} matchs distincts ; générés entre ${iso(ps[0].t0)} et ${iso(ps[0].t1)}`)
  const guard = await q(`SELECT COUNT(*) c FROM prediction_snapshots WHERE prediction_time >= kickoff_at`)
  log(`  Violations garde temporelle (prediction_time >= kickoff) = ${n(guard[0].c)}`)
  const mv = await q(`SELECT model_version, COUNT(*) c FROM prediction_snapshots GROUP BY 1 ORDER BY 2 DESC`)
  for (const r of mv) log(`  model_version = ${r.model_version} : ${n(r.c)}`)
  const comp = await q(`SELECT pc.component, COUNT(*) c FROM prediction_components pc GROUP BY 1 ORDER BY 2 DESC`)
  for (const r of comp) log(`  composants stockés : ${r.component} = ${n(r.c)}`)
  const mk = await q(`SELECT market_key, COUNT(*) c FROM prediction_markets GROUP BY 1 ORDER BY 2 DESC`)
  for (const r of mk) log(`  marchés stockés : ${r.market_key} = ${n(r.c)}`)
  // Couverture de la semaine courante + suivante
  const weekCov = await q(`SELECT
      (SELECT COUNT(*) FROM matches WHERE kickoff_at >= DATE_TRUNC('week', NOW()) AND kickoff_at < DATE_TRUNC('week', NOW()) + INTERVAL '14 days') m,
      (SELECT COUNT(DISTINCT match_id) FROM prediction_snapshots WHERE kickoff_at >= DATE_TRUNC('week', NOW()) AND kickoff_at < DATE_TRUNC('week', NOW()) + INTERVAL '14 days') s`)
  log(`  Semaine courante+suivante : matchs=${n(weekCov[0].m)} avec snapshot générique=${n(weekCov[0].s)}`)
  const futSnap = await q(`SELECT COUNT(*) c FROM prediction_snapshots s JOIN matches m ON m.espn_event_id=s.match_id
     WHERE m.kickoff_at >= NOW()`)
  log(`  Snapshots pour matchs FUTURS = ${n(futSnap[0].c)}`)

  // ---------- 9. H2H DEPUIS LA BASE (capacité) ----------
  log('\n[9] CAPACITÉ H2H depuis Neon')
  const h2h = await q(`SELECT COUNT(*) c FROM (
      SELECT LEAST(home_team_id, away_team_id) a, GREATEST(home_team_id, away_team_id) b
      FROM matches WHERE status='FINAL' AND home_score IS NOT NULL AND away_score IS NOT NULL
        AND home_team_id IS NOT NULL AND away_team_id IS NOT NULL
      GROUP BY 1,2 HAVING COUNT(*) >= 2) x`)
  log(`  Paires d'équipes avec >=2 confrontations FINAL en base = ${n(h2h[0].c)}`)
  const h2h1 = await q(`SELECT COUNT(*) c FROM (
      SELECT LEAST(home_team_id, away_team_id) a, GREATEST(home_team_id, away_team_id) b
      FROM matches WHERE status='FINAL' AND home_score IS NOT NULL AND home_team_id IS NOT NULL AND away_team_id IS NOT NULL
      GROUP BY 1,2) x`)
  log(`  Paires avec >=1 confrontation = ${n(h2h1[0].c)}`)

  // ---------- 10. COMPLÉTUDE DES COLONNES (futurs 8 jours) ----------
  log('\n[10] COMPLÉTUDE matchs futurs 8 jours (espn_event_id/équipes/compétition/statut)')
  const comp7 = await q(`SELECT
      COUNT(*) total,
      SUM(CASE WHEN espn_event_id IS NOT NULL THEN 1 ELSE 0 END) id_ok,
      SUM(CASE WHEN home_team_id IS NOT NULL AND away_team_id IS NOT NULL THEN 1 ELSE 0 END) teams_ok,
      SUM(CASE WHEN competition_id IS NOT NULL THEN 1 ELSE 0 END) comp_ok,
      SUM(CASE WHEN status IS NOT NULL AND status <> 'UNKNOWN' THEN 1 ELSE 0 END) status_ok,
      SUM(CASE WHEN venue IS NOT NULL THEN 1 ELSE 0 END) venue_ok
    FROM matches WHERE kickoff_at >= NOW() AND kickoff_at < NOW() + INTERVAL '8 days'`)
  const c7 = comp7[0]
  log(`  total=${n(c7.total)} id=${n(c7.id_ok)} équipes=${n(c7.teams_ok)} compétition=${n(c7.comp_ok)} statut=${n(c7.status_ok)} stade=${n(c7.venue_ok)}`)

  // ---------- 11. SYNCHRONISEUR : activité récente ----------
  log('\n[11] ACTIVITÉ SYNCHRONISATION (sync_job_runs — 12 dernières)')
  const runs = await q(`SELECT phase, started_at, finished_at, stats FROM sync_job_runs ORDER BY started_at DESC LIMIT 12`)
  for (const r of runs) {
    const s = r.stats ? JSON.parse(String(r.stats)) : {}
    log(`  ${iso(r.started_at)} ${String(r.phase).padEnd(8)} ligues=${s.leaguesTotal ?? '-'} events=${s.eventsSeen ?? '-'} créés=${s.matchesCreated ?? '-'} màj=${s.matchesUpdated ?? '-'} cotes=${s.oddsInserted ?? '-'} échecs=${s.leaguesFailed ?? '-'}`)
  }
  const lastBackfill = await q(`SELECT MAX(started_at) m FROM sync_job_runs WHERE phase IN ('backfill','seed')`)
  log(`  Dernier backfill 21 j = ${iso(lastBackfill[0].m)}`)

  // ---------- 12. DOUBLONS (idempotence) ----------
  log('\n[12] IDEMPOTENCE — doublons espn_event_id')
  const dup = await q(`SELECT COUNT(*) c FROM (SELECT espn_event_id FROM matches GROUP BY 1 HAVING COUNT(*) > 1) x`)
  log(`  Doublons = ${n(dup[0].c)}`)

  // ---------- 13. LEGACY PRÉCISION (Prediction) ----------
  log('\n[13] LEGACY « Précision » (table Prediction — source /api/performance)')
  const leg = await q(`SELECT COUNT(*) total, SUM(CASE WHEN resolved THEN 1 ELSE 0 END) resolus, COUNT(DISTINCT "matchId") matchs FROM "Prediction"`)
  log(`  lignes=${n(leg[0].total)} résolues=${n(leg[0].resolus)} matchs distincts=${n(leg[0].matchs)}`)

  // ---------- 14. TOUS LES TRIGGERS (vérif ForecastSnapshot legacy) ----------
  log('\n[14] TOUS LES TRIGGERS du schéma public')
  const allTrg = await q(`SELECT DISTINCT event_object_table, action_timing, event_manipulation FROM information_schema.triggers
     WHERE trigger_schema='public' ORDER BY 1, 2, 3`)
  for (const r of allTrg) log(`  ${r.event_object_table} : ${r.action_timing} ${r.event_manipulation}`)

  await prisma.$disconnect()
}

main().catch(async (e) => { console.error('ERREUR AUDIT:', e.message); await prisma.$disconnect(); process.exit(1) })
