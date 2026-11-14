#!/usr/bin/env bash
# Vérification fonctionnelle (serveur de production inclus dans l'appel) :
#  - seuils combinateur 20/30/40 %
#  - diversité des marchés (dont Premier but)
#  - cohérence minute médiane ↔ fenêtre surlignée (fiche match)
set -u
cd /home/z/my-project
DB='postgresql://neondb_owner:npg_D1OymYeRSnr2@ep-round-cloud-ae3m3lka-pooler.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require'
pkill -f "standalone/server.js" 2>/dev/null; pkill -f agent-browser 2>/dev/null; sleep 1
DATABASE_URL="$DB" NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 nohup bun .next/standalone/server.js > /tmp/prodserver.log 2>&1 &
for i in $(seq 1 45); do code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 http://127.0.0.1:3000 2>/dev/null || echo 000); [ "$code" = "200" ] && break; sleep 1; done
echo "Serveur HTTP $code"
S=fonct
agent-browser open http://127.0.0.1:3000 --session $S >/dev/null 2>&1
agent-browser set viewport 390 844 --session $S >/dev/null 2>&1
sleep 9

agent-browser eval "document.querySelector('button[aria-label*=\"Combinateur\"]')?.click(); 1" --session $S >/dev/null 2>&1
sleep 2
echo "SEUILS : $(agent-browser eval "
(() => {
  const groups = [...document.querySelectorAll('[role=group][aria-label=\"Seuil de chance de réussite\"] button')];
  return groups.map(b => b.innerText.trim()).join('/');
})()" --session $S 2>/dev/null | tr -d '"')"
agent-browser eval "
(() => {
  const btns = [...document.querySelectorAll('button')];
  btns.find(b => /semaine/i.test(b.innerText))?.click();
  return 1;
})()" --session $S >/dev/null 2>&1
sleep 1
agent-browser eval "
(() => {
  const btns = [...document.querySelectorAll('button')];
  btns.find(b => /analyser/i.test(b.innerText))?.click();
  return 1;
})()" --session $S >/dev/null 2>&1
for i in $(seq 1 45); do
  E=$(agent-browser eval "
(() => {
  const mains=[...document.querySelectorAll('main')]; const t = (mains[mains.length-1]?.innerText || '').toUpperCase();
  if (t.includes('ANALYSE EN COURS')) return 'RUN';
  if (t.includes('COMBINÉ PROPOSÉ') || t.includes('VARIANTE')) return 'DONE';
  if (t.includes('AUCUN')) return 'NONE';
  return '...';
})()" --session $S 2>/dev/null | tr -d '"' | head -1)
  case "$E" in DONE|NONE) break;; esac; sleep 2
done
echo "ANALYSE SEMAINE : $E"
agent-browser eval "
(() => {
  const mains=[...document.querySelectorAll('main')]; const main = mains[mains.length-1];
  const t = main.innerText;
  const legs = [...main.querySelectorAll('section[aria-label] button')].map(b => b.innerText);
  const marches = {};
  for (const l of legs) {
    if (/double chance/i.test(l)) marches.dc = (marches.dc||0)+1;
    if (/1er but/i.test(l)) marches.fg = (marches.fg||0)+1;
    if (/buts/i.test(l) && !/1er/.test(l)) marches.ou = (marches.ou||0)+1;
    if (/victoire/i.test(l)) marches.res = (marches.res||0)+1;
  }
  const m = t.match(/(\d+) MATCHS ANALYSÉS · (\d+) SÉLECTIONS?/);
  const c = t.match(/CÔTE\s*\n\s*([\d.]+)/);
  const p = t.match(/RÉUSSITE\s*\n\s*(\d+)%/);
  return JSON.stringify({ stats: m ? m[1]+' matchs / '+m[2]+' sél.' : '?', cote: c?.[1], reussite: p?.[1]+'%', marches });
})()" --session $S 2>/dev/null | python3 -c "import sys,json; print(json.dumps(json.loads(json.loads(sys.stdin.read())), ensure_ascii=False))"

# cohérence premier but sur une fiche
agent-browser eval "
(() => {
  const legs = [...document.querySelectorAll('main section[aria-label] button')].filter(b => /1er but/i.test(b.innerText));
  if (legs.length) { legs[0].click(); return 'OUVERTE'; }
  const any = [...document.querySelectorAll('main section[aria-label] button')].find(b => /\d\.\d{2}/.test(b.innerText));
  if (any) { any.click(); return 'OUVERTE_GENERIQUE'; }
  return 'PAS_DE_JAMBE';
})()" --session $S 2>/dev/null | tr -d '"' | xargs -I{} echo "FICHE : {}"
sleep 6
agent-browser eval "
(() => {
  const t = document.body.innerText;
  const min = t.match(/(\d+)\s*\n?\s*e minute/);
  const fen = t.match(/Fenêtre attendue\s*:\s*([^\n(]+)/);
  return JSON.stringify({ minuteMediane: min?.[1], fenetreAttendue: fen?.[1]?.trim() });
})()" --session $S 2>/dev/null | python3 -c "import sys,json; print(json.dumps(json.loads(json.loads(sys.stdin.read())), ensure_ascii=False))"
agent-browser close --session $S >/dev/null 2>&1
pkill -f "standalone/server.js" 2>/dev/null; pkill -f agent-browser 2>/dev/null
echo "=== VÉRIFICATION TERMINÉE ==="
