#!/usr/bin/env bash
# Task 50 — Sondage ESPN des codes de ligues candidats (lecture seule).
# Chaque code est interrogé sur une fenêtre de 30 jours pour détecter les fixtures réelles.
cd /home/z/my-project || exit 1
OUT=tool-results/espn-probe
mkdir -p $OUT

CODES="caf.acnq caf.acn caf.chan caf.championship caf.super_cup fifa.arabcup fifa.arab_cup \
nga.1 cod.1 civ.1 sen.1 cmr.1 gha.1 bfa.1 mli.1 gui.1 gab.1 ben.1 tgo.1 nig.1 bur.1 rwa.1 \
zmb.1 zim.1 mwi.1 moz.1 ang.1 eth.1 tza.1 tan.1 ken.1 uga.1 lby.1 mrt.1 gnb.1 sle.1 \
irq.1 jor.1 kuw.1 omn.1 bhr.1 syr.1 lib.1 lbn.1 lby \
nzl.1 fij.1 sol.1 png.1 tah.1 \
wal.1 nir.1 bih.1 svn.1 mne.1 mkd.1 alb.1 kos.1 mol.1 arm.1 geo.1 azb.1 est.1 lva.1 ltu.1 lt.1 far.1 isl.1 lux.1 mlr.1 mlt.1 \
jam.1 tri.1 hai.1 dom.1 cub.1 sur.1 guy.1"

printf '%s\n' $CODES | xargs -P 8 -I{} bash -c '
  c="{}"
  f="tool-results/espn-probe/{}.json"
  http=$(curl -s -m 8 -o "$f" -w "%{http_code}" "https://site.api.espn.com/apis/site/v2/sports/soccer/$c/scoreboard" 2>/dev/null)
  echo "$c $http"
' > $OUT/status.txt

# 2e passe : ligues valides mais 0 événement aujourdhui -> sondes single-dates (fenêtres internationales)
python3 - <<'EOF' > $OUT/empty_codes.txt
import json
for line in open('tool-results/espn-probe/status.txt'):
    code, http = line.split()
    if http == '200':
        try:
            d=json.load(open(f'tool-results/espn-probe/{code}.json'))
            if not (d.get('events') or []):
                print(code)
        except Exception:
            pass
EOF

while read -r c; do
  [ -z "$c" ] && continue
  for d in 20261010 20261114 20270320; do
    curl -s -m 8 "https://site.api.espn.com/apis/site/v2/sports/soccer/$c/scoreboard?dates=$d" \
      -o "$OUT/$c.$d.json" 2>/dev/null
  done
done < $OUT/empty_codes.txt

python3 - <<'EOF'
import json, os, glob
rows=[]
for line in open('tool-results/espn-probe/status.txt'):
    code, http = line.split()
    rows.append((code, int(http)))
ok=[]; dead=[]
for code, http in sorted(rows):
    if http != 200:
        dead.append((code, http)); continue
    try:
        d=json.load(open(f'tool-results/espn-probe/{code}.json'))
    except Exception:
        dead.append((code, 'parse')); continue
    leagues = d.get('leagues') or []
    name = leagues[0].get('name','?') if leagues else '?'
    evs = d.get('events') or []
    n = len(evs)
    dates = sorted(set((e.get('date') or '')[:10] for e in evs))[:3]
    ok.append((code, name, n, dates))
print(f'=== VALABLES (HTTP 200) : {len(ok)} ===')
for code, name, n, dates in ok:
    extra=''
    if n == 0:
        mx=0; best=''
        for dd in ('20261010','20261114','20270320'):
            try:
                e2=json.load(open(f'tool-results/espn-probe/{code}.{dd}.json'))
                k=len(e2.get('events') or [])
                if k>mx: mx, best = k, dd
            except Exception:
                pass
        extra=f'  | single-dates: max {mx} evts ({best or "rien"})'
    print(f'{code:12s} evts_auj={n:3d}  {name[:52]}{extra}')
print(f'=== INVALIDES/MORTS : {len(dead)} ===')
print(' '.join(f'{c}({h})' for c,h in dead))
EOF
