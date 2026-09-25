#!/usr/bin/env bash
# Task 50 pass 2 — (a) sondage shortlist candidats du registre, (b) health-check des 121 codes du catalogue.
cd /home/z/my-project || exit 1
OUT=tool-results/espn-probe
mkdir -p $OUT

SHORT="caf.nations_qual caf.cosafa caf.w.nations global.gulf_cup ned.cup por.taca.portugal ksa.kings.cup \
bra.copa_do_brazil col.copa chi.copa_chi arg.copa \
uefa.champions_qual uefa.europa_qual uefa.europa.conf_qual afc.champions_qual afc.cup_qual \
uefa.euro_u21 uefa.euro_u21_qual fifa.world.u20 fifa.world.u17 fifa.olympics fifa.friendly_u21 \
fifa.worldq.ofc fifa.wcq.ply"

# (b) codes existants extraits du catalogue
EXIST=$(grep -oE "code: '[^']+'" src/lib/leagues.ts | sed "s/code: '//; s/'//")

probe() {
  c="$1"; f="$OUT/hc.$1.json"
  curl -s -m 8 -o "$f" -w "%{http_code}" "https://site.api.espn.com/apis/site/v2/sports/soccer/$c/scoreboard" 2>/dev/null
}

printf '%s\n' $SHORT  | xargs -P 8 -I{} bash -c 'c="{}"; http=$(curl -s -m 8 -o "tool-results/espn-probe/s.{}.json" -w "%{http_code}" "https://site.api.espn.com/apis/site/v2/sports/soccer/$c/scoreboard" 2>/dev/null; curl -s -m 8 -o "tool-results/espn-probe/s.{}.json" -w "%{http_code}" "https://site.api.espn.com/apis/site/v2/sports/soccer/{} /scoreboard" >/dev/null 2>&1); echo "{} {}"' > /dev/null 2>&1
# (plus simple : boucle séquentielle sur la shortlist, ~24 appels)
for c in $SHORT; do
  http=$(curl -s -m 8 -o "$OUT/s.$c.json" -w "%{http_code}" "https://site.api.espn.com/apis/site/v2/sports/soccer/$c/scoreboard" 2>/dev/null)
  echo "$c $http" >> $OUT/short_status.txt
done

printf '%s\n' $EXIST | xargs -P 8 -I{} bash -c '
  c="{}"
  http=$(curl -s -m 8 -o "tool-results/espn-probe/hc.{}.json" -w "%{http_code}" "https://site.api.espn.com/apis/site/v2/sports/soccer/$c/scoreboard" 2>/dev/null)
  echo "$c $http"
' > $OUT/health_status.txt

python3 - <<'EOF'
import json
print('=== SHORTLIST (candidats registre) ===')
for line in sorted(open('tool-results/espn-probe/short_status.txt')):
    code, http = line.split()
    if http != '200':
        print(f'{code:22s} HTTP {http}  (rejeté)'); continue
    d=json.load(open(f'tool-results/espn-probe/s.{code}.json'))
    lg = d.get('leagues') or [{}]
    name = lg[0].get('name','?')
    n = len(d.get('events') or [])
    print(f'{code:22s} evts_auj={n:3d}  {name[:55]}')
print()
print('=== HEALTH-CHECK catalogue existant (121 codes) ===')
ok=[]; dead=[]
for line in open('tool-results/espn-probe/health_status.txt'):
    code, http = line.split()
    (ok if http=='200' else dead).append((code, http))
print(f'OK 200 : {len(ok)}')
print(f'MORTS/ERREURS : {len(dead)}', ' '.join(f'{c}({h})' for c,h in dead))
EOF
