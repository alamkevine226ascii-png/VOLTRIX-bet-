# -*- coding: utf-8 -*-
"""Audit 39 ter — datation arrêt générateur + 9 manquants du 14/09 + cotes récupérables."""
import json
from collections import defaultdict
from datetime import datetime, timezone

BASE = '/home/z/my-project/scripts/tmp-audit39'
week_doc = json.load(open(f'{BASE}/week.json'))
matches_doc = json.load(open(f'{BASE}/matches.json'))
rows = week_doc['matches']
P = print

home_by_id = {}
for lg in matches_doc['leagues']:
    for m in lg['matches']:
        home_by_id[m['id']] = m

def fmt(s):
    return datetime.fromisoformat(s.replace('Z', '+00:00')).strftime('%m-%d %H:%M:%S') if s else '?'

# 1) frozenAt min/max par jour de kickoff
P('[G] frozenAt (min -> max) par jour de kickoff')
per_day = defaultdict(list)
for w in rows:
    if w['snapshot'] and w['snapshot'].get('frozenAt'):
        per_day[w['kickoff'][:10]].append(w['snapshot']['frozenAt'])
for d in sorted(per_day):
    f = sorted(per_day[d])
    P('    KO %s : figés de %s -> %s (n=%d)' % (d, fmt(f[0]), fmt(f[-1]), len(f)))
allf = sorted(x['snapshot']['frozenAt'] for x in rows if x['snapshot'] and x['snapshot'].get('frozenAt'))
P('    GLOBAL : %s -> %s' % (fmt(allf[0]), fmt(allf[-1])))
P()

# 2) Les 9 matchs du 14/09 sans snapshot
P('[H] Matchs du 14/09 SANS snapshot (%d)' % sum(1 for w in rows if w['kickoff'][:10]=='2026-09-14' and not w['snapshot']))
for w in rows:
    if w['kickoff'][:10] == '2026-09-14' and not w['snapshot']:
        P('    - %s vs %s | KO %s | espnState=%s | statut=%s | detail=%s | eff=%s' % (
            w['homeTeam'][:18], w['awayTeam'][:18], w['kickoff'][5:16], w['espnState'],
            w['status'], (w['statusDetail'] or '')[:28], w['effectiveStatus']))
P()

# 3) versionCount distribution sur toute la semaine
vc = defaultdict(int)
for w in rows:
    if w['snapshot']:
        vc[w['snapshot'].get('versionCount')] += 1
P('[I] versionCount (semaine): %s' % dict(sorted(vc.items())))
P()

# 4) Les 24 du 16/09 sans cotes figées : cotes récupérables via OddsSnapshot (accueil) ?
P('[J] 16/09 — snapshots sans cotes 1X2 figées : cotes présentes dans OddsSnapshot (accueil hasOdds) ?')
recov = 0
tot = 0
for w in rows:
    if w['kickoff'][:10] != '2026-09-16':
        continue
    s = w['snapshot']
    if s and s.get('odds1x2Home') is None:
        tot += 1
        h = home_by_id.get(w['espnEventId'], {})
        ok = h.get('hasOdds')
        recov += 1 if ok else 0
        P('    - %s vs %s | hasOdds accueil=%s | KO %s' % (w['homeTeam'][:18], w['awayTeam'][:18], ok, w['kickoff'][11:16]))
P('    total sans cotes figées: %d | dont cotes disponibles dans OddsSnapshot: %d' % (tot, recov))
P()

# 5) EspnState des 55 "pending" du 16/09 (realité terrain vs statut Neon)
st = defaultdict(int)
for w in rows:
    if w['kickoff'][:10] == '2026-09-16':
        st[(w['espnState'], w['status'])] += 1
P('[K] (espnState, Match.status) des 56 du 16/09: %s' % dict(st))
