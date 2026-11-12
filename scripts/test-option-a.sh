#!/usr/bin/env bash
# ============================================================
# TEST OPTION A — VOLTRIX App (navigateur headless 390×844)
# Correctif « rechargement du moteur » : l'écran d'onglet reste
# monté sous les fiches détaillées. Ce test vérifie :
#   1. ouverture d'une fiche match (football à venir) ;
#   2. séjour de 12 s sur la fiche (scénario utilisateur ~20 s) ;
#   3. RETOUR instantané : aucune carte squelette (.animate-pulse),
#      sections ligues toujours présentes dès la 1re seconde,
#      position de défilement conservée, date/filtres intacts ;
#   4. stabilité 5 s après le retour (pas de re-scan différé).
# ============================================================
set -u
cd /home/z/my-project

PORT=3000
BASE="http://localhost:$PORT"
OUT=/tmp/vt-option-a
rm -rf "$OUT" && mkdir -p "$OUT"

log() { echo "[$(date +%H:%M:%S)] $*"; }

# ---------- 0. nettoyer tout résidu sur le port ----------
pkill -f "next dev" 2>/dev/null; pkill -f "next-server" 2>/dev/null
sleep 2

# ---------- 1. démarrage serveur (relai ESPN même-origine) ----------
NEXT_PUBLIC_ESPN_SITE_BASE="http://localhost:$PORT/api/espn/site" \
NEXT_PUBLIC_ESPN_SITEWEB_BASE="http://localhost:$PORT/api/espn/siteweb" \
NEXT_PUBLIC_ESPN_CORE_BASE="http://localhost:$PORT/api/espn/core" \
bun run dev > "$OUT/server.log" 2>&1 &
SERVER_PID=$!

ready=0
for i in $(seq 1 90); do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 "$BASE" 2>/dev/null || echo 000)
  if [ "$code" = "200" ]; then ready=1; break; fi
  kill -0 $SERVER_PID 2>/dev/null || { log "Processus serveur mort"; sed -n '1,25p' "$OUT/server.log"; exit 1; }
  sleep 2
done
[ "$ready" = "1" ] || { log "ÉCHEC : serveur non prêt"; sed -n '1,30p' "$OUT/server.log"; kill $SERVER_PID 2>/dev/null; exit 1; }
log "Serveur prêt (HTTP 200)."

# ---------- 2. accueil : attendre les sections + moteur au repos ----------
agent-browser open "$BASE" >/dev/null 2>&1
agent-browser set viewport 390 844 >/dev/null 2>&1
log "App ouverte — attente des cartes (scan ESPN par vagues)…"

cards=0
for i in $(seq 1 120); do
  cards=$(agent-browser eval "document.querySelectorAll('section[aria-label]').length" 2>/dev/null | tr -dc '0-9')
  [ -z "$cards" ] && cards=0
  [ "$cards" -ge 1 ] && break
  sleep 2
done
log "Sections affichées : $cards"

# laisser le moteur finir ses pronos rapides (max ~80 s)
for i in $(seq 1 40); do
  busy=$(agent-browser eval "document.body.innerText.includes('Moteur en analyse')" 2>/dev/null | head -1)
  echo "$busy" | grep -qi "true" || break
  sleep 2
done
log "Moteur au repos."

# ---------- 3. état de référence avant ouverture de la fiche ----------
agent-browser eval "
(() => {
  const main = document.querySelector('main');
  if (main) main.scrollTop = 600;
  return 'scroll=' + (main ? main.scrollTop : -1);
})()" 2>/dev/null | head -1
sleep 1
AVANT=$(agent-browser eval "
(() => {
  const main = document.querySelector('main');
  return JSON.stringify({
    sections: document.querySelectorAll('section[aria-label]').length,
    squelettes: document.querySelectorAll('.animate-pulse').length,
    scrollTop: main ? main.scrollTop : -1,
    date: (document.querySelector('main p') || {}).innerText || ''
  });
})()" 2>/dev/null | head -1)
log "AVANT  : $AVANT"
agent-browser screenshot "$OUT/1-avant.png" >/dev/null 2>&1

# ---------- 4. ouvrir une fiche match (football à venir) ----------
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
    target.scrollIntoView({block: 'center'});
    const y = document.querySelector('main').scrollTop;
    target.click();
    return 'CLICKED [' + s.getAttribute('aria-label') + '] scroll=' + y;
  }
  return 'AUCUN_ARTICLE';
})()" 2>/dev/null | tr -d '"' | head -1)
  echo "$CLICKED" | grep -q "AUCUN" || break
  sleep 3
done
log "Carte cliquée → $CLICKED"
if echo "$CLICKED" | grep -q "AUCUN"; then
  agent-browser screenshot "$OUT/0-accueil-vide.png" >/dev/null 2>&1
  kill $SERVER_PID 2>/dev/null; exit 1
fi

# le détail doit s'afficher : bouton retour présent, home recouvert
sleep 6
DETAIL=$(agent-browser eval "
(() => {
  const back = [...document.querySelectorAll('button')].some(b => (b.getAttribute('aria-label')||'').toLowerCase().includes('retour'));
  return JSON.stringify({ boutonRetour: back });
})()" 2>/dev/null | head -1)
log "DÉTAIL : $DETAIL"
agent-browser screenshot "$OUT/2-detail.png" >/dev/null 2>&1

# ---------- 5. séjour sur la fiche (scénario utilisateur) ----------
log "Séjour sur la fiche : 12 s…"
sleep 12

# ---------- 6. RETOUR : l'accueil doit être instantané ----------
t0=$(date +%s%3N)
agent-browser eval "
(() => {
  const btns = [...document.querySelectorAll('button')];
  const back = btns.find(b => (b.getAttribute('aria-label')||'').toLowerCase().includes('retour'));
  if (back) { back.click(); return 'BACK'; }
  return 'NO-BACK';
})()" 2>/dev/null | head -1
sleep 1   # fin de l'animation de sortie (0,32 s) + marge
APRES=$(agent-browser eval "
(() => {
  const main = document.querySelector('main');
  return JSON.stringify({
    sections: document.querySelectorAll('section[aria-label]').length,
    squelettes: document.querySelectorAll('.animate-pulse').length,
    scrollTop: main ? main.scrollTop : -1,
    date: (document.querySelector('main p') || {}).innerText || ''
  });
})()" 2>/dev/null | head -1)
t1=$(date +%s%3N)
log "APRÈS (mesuré $((t1 - t0)) ms après le clic retour) : $APRES"
agent-browser screenshot "$OUT/3-retour.png" >/dev/null 2>&1

# ---------- 7. stabilité 5 s plus tard ----------
sleep 5
STABLE=$(agent-browser eval "
(() => {
  const main = document.querySelector('main');
  return JSON.stringify({
    sections: document.querySelectorAll('section[aria-label]').length,
    squelettes: document.querySelectorAll('.animate-pulse').length,
    scrollTop: main ? main.scrollTop : -1
  });
})()" 2>/dev/null | head -1)
log "STABLE (+5 s) : $STABLE"
agent-browser screenshot "$OUT/4-retour-stable.png" >/dev/null 2>&1

kill $SERVER_PID 2>/dev/null
pkill -f "next dev" 2>/dev/null
log "Test terminé."
