# -*- coding: utf-8 -*-
"""Audit 39 — couverture ForecastSnapshot du 16/09/2026 (lecture seule).
Sources: voltrixbet.vercel.app (production publique): matches.json, week.json, sync-status.json.
Aucune écriture, aucun secret, aucune modification de fichier projet.
"""
import json, sys
from datetime import datetime, timezone

BASE = '/home/z/my-project/scripts/tmp-audit39'
DAY = '2026-09-16'
NOW_MS = None  # fixé à l'instant de l'analyse

def iso2ms(s):
    return int(datetime.fromisoformat(s.replace('Z', '+00:00')).timestamp() * 1000)

def fmt(ms):
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')

matches_doc = json.load(open(f'{BASE}/matches.json'))
week_doc = json.load(open(f'{BASE}/week.json'))
status_doc = json.load(open(f'{BASE}/sync-status.json'))

now_ms = int(datetime.now(tz=timezone.utc).timestamp() * 1000)

# ---------- 1) Liste accueil du 16/09 (LightMatch) ----------
home = []
for lg in matches_doc['leagues']:
    for m in lg['matches']:
        m['_league'] = lg['name']
        home.append(m)

total_home = len(home)
by_status = {}
for m in home:
    by_status[m['status']] = by_status.get(m['status'], 0) + 1
pending = [m for m in home if m['status'] != 'post']   # compteur accueil = non-'post'
finished = [m for m in home if m['status'] == 'post']

# ---------- 2) Lignes semaine (16/09 uniquement) + jointure ----------
wk16 = [w for w in week_doc['matches'] if w['kickoff'][:10] == DAY]
wk_by_id = {w['espnEventId']: w for w in wk16}
home_ids = {m['id'] for m in home}

ids_home_only = home_ids - set(wk_by_id)
ids_week_only = set(wk_by_id) - home_ids

# ---------- 3) Couverture snapshots ----------
KEY_FIELDS = ['p1x2Home', 'p1x2Draw', 'p1x2Away', 'pick1x2', 'confidence',
              'pOver25', 'pUnder25', 'pBttsYes', 'pBttsNo',
              'odds1x2Home', 'odds1x2Draw', 'odds1x2Away', 'frozenAt', 'modelVersion']

def payload_complete(snap):
    miss = [k for k in KEY_FIELDS if snap.get(k) is None]
    return len(miss) == 0, miss

rows = []
for m in home:
    w = wk_by_id.get(m['id'])
    snap = (w or {}).get('snapshot')
    complete, miss = (payload_complete(snap) if snap else (False, ['PAS DE SNAPSHOT']))
    rows.append({
        'id': m['id'],
        'league': m['_league'],
        'kickoff': m['date'],
        'status_home': m['status'],
        'statusDetail': m.get('statusDetail', ''),
        'home': m['home']['name'], 'away': m['away']['name'],
        'homeScore': m['home']['score'], 'awayScore': m['away']['score'],
        'espnState': (w or {}).get('espnState'),
        'effectiveStatus': (w or {}).get('effectiveStatus'),
        'has_snapshot': bool(snap),
        'versionCount': (snap or {}).get('versionCount', 0),
        'frozenAt': (snap or {}).get('frozenAt'),
        'predictionTime': (snap or {}).get('predictionTime'),
        'oddsCapturedAt': (snap or {}).get('oddsCapturedAt'),
        'modelVersion': (snap or {}).get('modelVersion'),
        'predictionPending': (w or {}).get('predictionPending'),
        'predictionOutOfRange': (w or {}).get('predictionOutOfRange'),
        'payload_complete': complete,
        'missing_fields': miss,
        'has_odds_home_api': m['hasOdds'],
    })

pend_rows = [r for r in rows if r['status_home'] != 'post']
fin_rows = [r for r in rows if r['status_home'] == 'post']

def cov(rs):
    return sum(1 for r in rs if r['has_snapshot']), sum(1 for r in rs if r['payload_complete'])

cov_pend, comp_pend = cov(pend_rows)
cov_all, comp_all = cov(rows)

# ---------- 4) Distribution versionCount + horodatages ----------
from collections import Counter
vc_dist = Counter(r['versionCount'] for r in pend_rows if r['has_snapshot'])
frozen_list = sorted((r for r in rows if r['frozenAt']), key=lambda r: r['frozenAt'])
global_last_frozen = frozen_list[-1] if frozen_list else None
global_first_frozen = frozen_list[0] if frozen_list else None
last_odds = max((r['oddsCapturedAt'] for r in rows if r['oddsCapturedAt']), default=None)

# ---------- 5) Fraîcheur / activité de synchronisation ----------
kick_ms = lambda r: iso2ms(r['kickoff'])
started_not_post = [r for r in rows if kick_ms(r) < now_ms - 15 * 60_000 and r['status_home'] == 'pre']
live_now = [r for r in rows if r['status_home'] == 'in']
with_scores = [r for r in live_now if r['homeScore'] is not None and r['awayScore'] is not None]

# ---------- Affichage ----------
P = print
P('=' * 78)
P('AUDIT 39 — couverture ForecastSnapshot du', DAY, '| analyse à', fmt(now_ms))
P('=' * 78)
P()
P('[1] ACCUEIL /api/matches?date=%s' % DAY)
P('    totalMatches (API): %d | cartes réunies ici: %d' % (matches_doc['totalMatches'], total_home))
P('    statuts: %s' % json.dumps(by_status))
P('    -> non terminés (pre+in, compteur accueil): %d | terminés (post): %d' % (len(pending), len(finished)))
P()
P('[2] JOINTURE accueil <-> /api/forecasts/week (16/09)')
P('    lignes semaine du 16/09: %d | ids accueil absents de week: %d | ids week absents accueil: %d'
  % (len(wk16), len(ids_home_only), len(ids_week_only)))
if ids_home_only:
    P('    ids accueil hors week: %s' % sorted(ids_home_only)[:10])
if ids_week_only:
    P('    ids week hors accueil: %s' % sorted(ids_week_only)[:10])
P()
P('[3] COUVERTURE SNAPSHOT (snapshot publié le plus récent, /previsions)')
P('    Sur les %d cartes NON TERMINÉES (les « %d » de l accueil):' % (len(pending), len(pending)))
P('      - avec snapshot publié : %d' % cov_pend)
P('      - dont payload 100%% complet (15 champs clés) : %d' % comp_pend)
P('      - sans snapshot : %d' % (len(pending) - cov_pend))
P('    Sur les %d cartes terminées (post): avec snapshot %d' % (len(fin_rows), sum(1 for r in fin_rows if r['has_snapshot'])))
P('    Total jour (%d cartes): avec snapshot %d | payload complet %d' % (total_home, cov_all, comp_all))
P()
P('[4] SNAPSHOTS PAR MATCH (versionCount, cartes non terminées avec snapshot)')
P('    distribution: %s' % dict(sorted(vc_dist.items())))
P('    total versions sur ces matchs: %d' % sum(k * v for k, v in vc_dist.items()))
P()
P('[5] HORODATAGES DES SNAPSHOTS')
if global_first_frozen and global_last_frozen:
    P('    premier frozenAt du jour : %s (%s - %s)' % (fmt(iso2ms(global_first_frozen['frozenAt'])), global_first_frozen['home'], global_first_frozen['away']))
    P('    DERNIER frozenAt du jour : %s (%s - %s)' % (fmt(iso2ms(global_last_frozen['frozenAt'])), global_last_frozen['home'], global_last_frozen['away']))
P('    dernier oddsCapturedAt   : %s' % (fmt(iso2ms(last_odds)) if last_odds else None))
P('    lastSync  (SyncJobRun)   : %s (phase=%s, eventsSeen=%s)' % (
    status_doc['lastSync']['startedAt'], status_doc['lastSync']['phase'],
    (status_doc['lastSync'].get('stats') or {}).get('eventsSeen')))
P('    lastForecast (ForecastJobRun): %s (phase=%s, finishedAt=%s)' % (
    status_doc['lastForecastJob']['startedAt'], status_doc['lastForecastJob']['phase'],
    status_doc['lastForecastJob']['finishedAt']))
P()
P('[6] SANS SNAPSHOT — détail des cartes non terminées')
no_snap = [r for r in pend_rows if not r['has_snapshot']]
P('    count: %d' % len(no_snap))
for r in sorted(no_snap, key=kick_ms):
    P('    - %s | %s | KO %s | statut=%s/%s | pending=%s outOfRange=%s | detail=%s'
      % (r['home'][:18].ljust(18), r['away'][:18].ljust(18), r['kickoff'][11:16] + ' UTC',
         r['status_home'], r['espnState'], r['predictionPending'], r['predictionOutOfRange'],
         (r['statusDetail'] or '')[:20]))
P()
P('[7] AVEC SNAPSHOT — frozenAt par carte (non terminées, triées par KO)')
for r in sorted((x for x in pend_rows if x['has_snapshot']), key=kick_ms):
    P('    - %s vs %s | KO %s | v%s | figé %s | modèle %s | complet=%s'
      % (r['home'][:16].ljust(16), r['away'][:16].ljust(16), r['kickoff'][11:16],
         r['versionCount'], fmt(iso2ms(r['frozenAt'])) if r['frozenAt'] else '?',
         r['modelVersion'], r['payload_complete']))
P()
P('[8] FRAÎCHEUR SYNC (signaux indirects)')
P('    matchs démarrés depuis >15 min mais toujours statut "pre": %d' % len(started_not_post))
for r in started_not_post[:12]:
    P('      * %s vs %s | KO %s | statut=%s | detail=%s' % (r['home'][:16], r['away'][:16], r['kickoff'][11:16], r['status_home'], (r['statusDetail'] or '')[:24]))
P('    matchs EN DIRECT maintenant: %d | avec scores renseignés: %d' % (len(live_now), len(with_scores)))
for r in live_now[:12]:
    P('      * %s vs %s | score %s-%s | detail=%s' % (r['home'][:16], r['away'][:16], r['homeScore'], r['awayScore'], (r['statusDetail'] or '')[:24]))

# payload d'exemple
ex = next((r for r in pend_rows if r['has_snapshot'] and r['payload_complete']), None)
if ex:
    snap = wk_by_id[ex['id']]['snapshot']
    P()
    P('[9] EXTRAIT PAYLOAD SNAPSHOT (%s vs %s)' % (ex['home'], ex['away']))
    for k in ['p1x2Home', 'p1x2Draw', 'p1x2Away', 'pick1x2Label', 'confidence', 'pOver25', 'pUnder25',
              'pBttsYes', 'pBttsNo', 'odds1x2Home', 'odds1x2Draw', 'odds1x2Away', 'ouMarketLine',
              'modelVersion', 'versionCount']:
        P('    %-14s = %s' % (k, snap.get(k)))

# export JSON pour le rapport
out = {r['id']: {k: v for k, v in r.items() if k != 'missing_fields'} for r in rows}
json.dump(out, open(f'{BASE}/analysis.json', 'w'), indent=1)
print('\n(analysis.json écrit)')
