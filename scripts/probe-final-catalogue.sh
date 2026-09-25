#!/usr/bin/env bash
# Task 50 — re-sonde finale : TOUS les codes du catalogue doivent répondre HTTP 200.
cd /home/z/my-project || exit 1
mkdir -p tool-results/espn-probe

printf '%s\n' $(cat tool-results/final-codes.txt) | xargs -P 4 -I{} bash -c '
  c="{}"
  http=$(curl -s -m 8 -o "tool-results/espn-probe/fin.$c.json" -w "%{http_code}" "https://site.api.espn.com/apis/site/v2/sports/soccer/$c/scoreboard" 2>/dev/null)
  echo "$c $http"
' > tool-results/espn-probe/final_status.txt

python3 - <<'EOF'
rows=[l.split() for l in open('tool-results/espn-probe/final_status.txt')]
ok=[c for c,h in rows if h=='200']
bad=[(c,h) for c,h in rows if h!='200']
print(f'HTTP 200 : {len(ok)}/{len(rows)}')
print('non-200 :', ' '.join(f'{c}({h})' for c,h in bad) or 'AUCUN')
# événements réels aujourd'hui sur les nouvelles ligues clés
import json
for c in ['caf.nations_qual','caf.championship','gha.1','nga.1','ken.1']:
    try:
        d=json.load(open(f'tool-results/espn-probe/fin.{c}.json'))
        evs=d.get('events') or []
        if evs:
            e=evs[0]
            name=e.get('name','?')
            print(f'{c}: {len(evs)} evts, ex: {name[:50]} ({e.get("date","")[:10]})')
        else:
            print(f'{c}: 0 evt aujourdhui (valide 200)')
    except Exception as ex:
        print(f'{c}: erreur {ex}')
EOF
