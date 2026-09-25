# -*- coding: utf-8 -*-
"""Audit 39 bis — creuse : champs manquants, couverture par jour, valueBets feasible."""
import json
from collections import Counter, defaultdict
from datetime import datetime, timezone

BASE = '/home/z/my-project/scripts/tmp-audit39'
week_doc = json.load(open(f'{BASE}/week.json'))
matches_doc = json.load(open(f'{BASE}/matches.json'))
rows = week_doc['matches']

P = print
now = datetime.now(tz=timezone.utc)

# ---- 1) Champs manquants dans les snapshots incomplets ----
KEYS = ['p1x2Home','p1x2Draw','p1x2Away','pick1x2','pick1x2Label','confidence',
        'pOver25','pUnder25','pOver25Raw','pUnder25Raw','pickOu25',
        'pBttsYes','pBttsNo','pBttsYesRaw','pBttsNoRaw','pickBtts',
        'odds1x2Home','odds1x2Draw','odds1x2Away','oddsOver25','oddsUnder25',
        'oddsBttsYes','oddsBttsNo','ouMarketLine','predictionTime','modelVersion','frozenAt','oddsCapturedAt']
miss_counter = Counter()
incomplete = []
for w in rows:
    s = w['snapshot']
    if not s:
        continue
    miss = [k for k in KEYS if s.get(k) is None]
    for k in miss:
        miss_counter[k] += 1
    if miss:
        incomplete.append((w, miss))
P('[A] CHAMPS MANQUANTS parmi %d snapshots publiés de la semaine' % sum(1 for w in rows if w['snapshot']))
for k, c in miss_counter.most_common():
    P('    %-16s absent dans %d/%d snapshots' % (k, c, sum(1 for w in rows if w['snapshot'])))
P('    snapshots avec >=1 champ manquant (semaine): %d' % len(incomplete))
P()

# ---- 2) Couverture par jour de la semaine (générateur : quand s'est-il arrêté ?) ----
P('[B] COUVERTURE SNAPSHOT PAR JOUR (semaine 14-20/09, %d matchs)' % len(rows))
per_day = defaultdict(lambda: [0, 0, 0, 0])  # total, avec snap, pending, outOfRange
for w in rows:
    d = w['kickoff'][:10]
    per_day[d][0] += 1
    if w['snapshot']:
        per_day[d][1] += 1
    elif w.get('predictionPending'):
        per_day[d][2] += 1
    elif w.get('predictionOutOfRange'):
        per_day[d][3] += 1
for d in sorted(per_day):
    t, s, p, o = per_day[d]
    P('    %s : %3d matchs | snapshot %3d (%3d%%) | pending %3d | outOfRange %3d' % (d, t, s, 100*s//max(t,1), p, o))
P()

# ---- 3) Le match terminé du 16/09 + stale pre ----
P('[C] MATCHS DU 16/09 TERMINÉS (post) côté accueil')
home_by_id = {}
for lg in matches_doc['leagues']:
    for m in lg['matches']:
        home_by_id[m['id']] = m
for m in home_by_id.values():
    if m['status'] == 'post':
        w = next((x for x in rows if x['espnEventId'] == m['id']), None)
        P('    %s vs %s | score %s-%s | detail=%s | effectiveStatus=%s | result=%s' % (
            m['home']['name'], m['away']['name'], m['home']['score'], m['away']['score'],
            m['statusDetail'], (w or {}).get('effectiveStatus'),
            json.dumps((w or {}).get('result'))[:160]))
P()

# ---- 4) valueBetsCount recalculable ? (probas brutes + cotes présentes) ----
day_rows = [w for w in rows if w['kickoff'][:10] == '2026-09-16']
def feas(s):
    f = {}
    f['1X2'] = all(s.get(k) is not None for k in ['p1x2Home','p1x2Draw','p1x2Away','odds1x2Home','odds1x2Draw','odds1x2Away'])
    f['O/U'] = all(s.get(k) is not None for k in ['pOver25Raw','pUnder25Raw','oddsOver25','oddsUnder25'])
    f['BTTS'] = all(s.get(k) is not None for k in ['pBttsYesRaw','pBttsNoRaw','oddsBttsYes','oddsBttsNo'])
    return f
cnt = Counter()
no_odds_at_all = []
for w in day_rows:
    s = w['snapshot']
    if not s:
        continue
    f = feas(s)
    cnt[(f['1X2'], f['O/U'], f['BTTS'])] += 1
    if not any(f.values()):
        no_odds_at_all.append(w)
P('[D] FAISABILITÉ valueBetsCount (16/09, %d snapshots)' % len(day_rows))
P('    (1X2, O/U, BTTS) -> nombre de snapshots:')
for k, v in sorted(cnt.items(), key=lambda x: -x[1]):
    P('    %s : %d' % (k, v))
P('    aucun marché value calculable: %d' % len(no_odds_at_all))
for w in no_odds_at_all[:8]:
    P('      * %s vs %s | cotes accueil hasOdds=%s' % (
        w['homeTeam'][:18], w['awayTeam'][:18],
        home_by_id.get(w['espnEventId'], {}).get('hasOdds')))
P()

# ---- 5) Cotes côté accueil vs cotes figées snapshot (16/09 non terminés) ----
home_odds = sum(1 for m in home_by_id.values() if m['status'] != 'post' and m['hasOdds'])
snap_odds = sum(1 for w in day_rows if w['snapshot'] and w['snapshot'].get('odds1x2Home') is not None)
P('[E] COTES 1X2 sur les %d cartes non terminées : accueil /api/matches hasOdds=%d | snapshot odds1x2Home=%d' % (
    sum(1 for m in home_by_id.values() if m['status'] != 'post'), home_odds, snap_odds))
P()

# ---- 6) frozenAt vs kickoff (anti look-ahead) sur les 56 ----
bad = 0
for w in day_rows:
    s = w['snapshot']
    if s and s.get('frozenAt'):
        if datetime.fromisoformat(s['frozenAt'].replace('Z', '+00:00')) >= datetime.fromisoformat(w['kickoff'].replace('Z', '+00:00')):
            bad += 1
P('[F] snapshots figés APRÈS le kickoff (anomalie): %d / %d' % (bad, len(day_rows)))
