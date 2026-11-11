#!/usr/bin/env bash
# ============================================================
# TEST OPTION A (complément) — conservation de la position de
# défilement. Le scroll est réglé PAR PROGRAMMATION pendant le
# séjour sur la fiche (l'accueil est alors recouvert et inerte) :
# s'il survit au retour, l'écran n'a jamais été démonté.
# ============================================================
set -u
cd /home/z/my-project

PORT=3000
BASE="http://localhost:$PORT"
OUT=/tmp/vt-option-a-scroll
rm -rf "$OUT" && mkdir -p "$OUT"

log() { echo "[$(date +%H:%M:%S)] $*"; }

pkill -f "next dev" 2>/dev/null; pkill -f "next-server" 2>/dev/null
sleep 2

NEXT_PUBLIC_ESPN_SITE_BASE="http://localhost:$PORT/api/espn/site" \
NEXT_PUBLIC_ESPN_SITEWEB_BASE="http://localhost:$PORT/api/espn/siteweb" \
NEXT_PUBLIC_ESPN_CORE_BASE="http://localhost:$PORT/api/espn/core" \
bun run dev > "$OUT/server.log" 2>&1 &
SERVER_PID=$!

ready=0
for i in $(seq 1 90); do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 "$BASE" 2>/dev/null || echo 000)
  if [ "$code" = "200" ]; then ready=1; break; fi
  kill -0 $SERVER_PID 2>/dev/null || { log "Serveur mort"; exit 1; }
  sleep 2
done
[ "$ready" = "1" ] || { log "ÉCHEC : serveur non prêt"; kill $SERVER_PID 2>/dev/null; exit 1; }
log "Serveur prêt."

agent-browser open "$BASE" >/dev/null 2>&1
agent-browser set viewport 390 844 >/dev/null 2>&1

cards=0
for i in $(seq 1 120); do
  cards=$(agent-browser eval "document.querySelectorAll('section[aria-label]').length" 2>/dev/null | tr -dc '0-9')
  [ -z "$cards" ] && cards=0
  [ "$cards" -ge 1 ] && break
  sleep 2
done
log "Sections : $cards"

CLICKED=""
for i in $(seq 1 30); do
  CLICKED=$(agent-browser eval "
(() => {
  const secs = [...document.querySelectorAll('section[aria-label]')];
  for (const s of secs) {
    const label = (s.getAttribute('aria-label') || '').toUpperCase();
    if (label.includes('UFC') || label.includes('COMBAT') || label.includes('PERSPECT')) continue;
    const cards = [...s.querySelectorAll('article')];
    const target = cards.find(c => /\d{1,2}:\d{2}/.test(c.innerText));
    if (!target) continue;
    target.click();
    return 'CLICKED [' + s.getAttribute('aria-label') + ']';
  }
  return 'AUCUN_ARTICLE';
})()" 2>/dev/null | tr -d '"' | head -1)
  echo "$CLICKED" | grep -q "AUCUN" || break
  sleep 3
done
log "Fiche ouverte → $CLICKED"
echo "$CLICKED" | grep -q "AUCUN" && { kill $SERVER_PID 2>/dev/null; exit 1; }

sleep 5
# RÉGLER LE SCROLL DE L'ACCUIEL RECOUVERT (1er <main> du DOM = accueil)
log "Réglage scrollTop=900 sur l'accueil recouvert…"
agent-browser eval "
(() => {
  const main = document.querySelector('main');
  if (!main) return 'PAS-DE-MAIN';
  main.scrollTop = 900;
  return 'scroll=' + main.scrollTop + ' hauteur=' + main.scrollHeight;
})()" 2>/dev/null | head -1

log "Séjour sur la fiche : 10 s…"
sleep 10

agent-browser eval "
(() => {
  const back = [...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label')||'').toLowerCase().includes('retour'));
  if (back) { back.click(); return 'BACK'; }
  return 'NO-BACK';
})()" 2>/dev/null | head -1
sleep 1.5

RESULT=$(agent-browser eval "
(() => {
  const main = document.querySelector('main');
  return JSON.stringify({
    scrollTop: main ? main.scrollTop : -1,
    sections: document.querySelectorAll('section[aria-label]').length,
    squelettes: document.querySelectorAll('.animate-pulse').length
  });
})()" 2>/dev/null | head -1)
log "APRÈS RETOUR : $RESULT"
agent-browser screenshot "$OUT/retour-scroll.png" >/dev/null 2>&1

kill $SERVER_PID 2>/dev/null
pkill -f "next dev" 2>/dev/null
log "Test complémentaire terminé."
