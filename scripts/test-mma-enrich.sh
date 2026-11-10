#!/usr/bin/env bash
# ============================================================
# TEST E2E — enrichissement n°4 (dimension « Frappes au sol »)
# Ouvre un combat MMA dans l'app réelle (relai ESPN) et vérifie :
#  1. l'app charge sans erreur runtime ;
#  2. la liste des dimensions affiche « Frappes au sol » ;
#  3. le tableau observé contient les nouvelles stats.
# ============================================================
set -u
cd /home/z/my-project

PORT=3000
BASE="http://localhost:$PORT"
OUT=/tmp/vt-test-mma4
rm -rf "$OUT" && mkdir -p "$OUT"

log() { echo "[$(date +%H:%M:%S)] $*"; }

pkill -f "next dev" 2>/dev/null; pkill -f "next-server" 2>/dev/null
sleep 2

log "Démarrage serveur dev (relai ESPN)…"
NEXT_PUBLIC_ESPN_SITE_BASE="http://localhost:$PORT/api/espn/site" \
NEXT_PUBLIC_ESPN_SITEWEB_BASE="http://localhost:$PORT/api/espn/siteweb" \
NEXT_PUBLIC_ESPN_CORE_BASE="http://localhost:$PORT/api/espn/core" \
bun run dev > "$OUT/server.log" 2>&1 &
SERVER_PID=$!

ready=0
for i in $(seq 1 90); do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 "$BASE" 2>/dev/null || echo 000)
  if [ "$code" = "200" ]; then ready=1; break; fi
  kill -0 $SERVER_PID 2>/dev/null || { log "Serveur mort"; tail -20 "$OUT/server.log"; exit 1; }
  sleep 2
done
[ "$ready" != "1" ] && { log "ÉCHEC démarrage"; tail -30 "$OUT/server.log"; kill $SERVER_PID; exit 1; }
log "Serveur prêt."

agent-browser open "$BASE" >/dev/null 2>&1
agent-browser set viewport 390 844 >/dev/null 2>&1
sleep 3

# aller sur l'onglet MMA (capsule du bas)
log "Navigation vers l'onglet MMA…"
agent-browser eval "
(() => {
  const els = [...document.querySelectorAll('button, a, [role=tab]')];
  const mma = els.find(e => /MMA/i.test(e.textContent || '') && (e.textContent || '').trim().length < 12);
  if (mma) { mma.click(); return 'cliqué: ' + mma.textContent.trim(); }
  return 'onglet MMA introuvable — onglets: ' + els.slice(0,12).map(e => (e.textContent||'').trim().slice(0,20)).filter(Boolean).join(' | ');
})()" 2>&1 | head -2
sleep 6

# attendre des cartes de combats
for i in $(seq 1 40); do
  cards=$(agent-browser eval "document.querySelectorAll('section[aria-label]').length" 2>/dev/null | tr -dc '0-9')
  [ -z "$cards" ] && cards=0
  [ "$cards" -ge 1 ] && break
  sleep 2
done
log "Sections affichées : $cards"

# cliquer le premier combat disponible
agent-browser eval "
(() => {
  const links = [...document.querySelectorAll('a[href*=\"/mma/\"], a[href*=\"fight\"]')];
  if (links.length) { links[0].click(); return 'combat ouvert: ' + links[0].getAttribute('href'); }
  const secs = document.querySelectorAll('section[aria-label] a, section button');
  if (secs.length) { secs[0].click(); return 'premier élément cliqué'; }
  return 'rien à cliquer';
})()" 2>&1 | head -2
sleep 8

# chercher la section dimensions (onglet synthèse)
log "Recherche de la section Dimensions du moteur…"
found=""
for i in $(seq 1 20); do
  found=$(agent-browser eval "
(() => {
  const t = document.body.innerText;
  const has = t.includes('Dimensions du moteur') || t.includes('dimensions comparables');
  const sol = t.includes('Frappes au sol');
  return JSON.stringify({dims: has, solFrappes: sol, url: location.pathname});
})()" 2>/dev/null | tr -d '\n')
  echo "$found" | grep -q '"solFrappes":true' && break
  echo "$found" | grep -q '"dims":true' && break
  sleep 3
done
log "État : $found"

agent-browser screenshot "$OUT/mma-detail.png" >/dev/null 2>&1

# tab « données » / tableau observé si présent
agent-browser eval "
(() => {
  const els = [...document.querySelectorAll('button')];
  const tab = els.find(e => /donn|observ|context/i.test(e.textContent || ''));
  if (tab) { tab.click(); return 'tab cliqué: ' + tab.textContent.trim(); }
  return 'pas de tab données';
})()" 2>&1 | head -1
sleep 4
agent-browser eval "
(() => {
  const t = document.body.innerText;
  return JSON.stringify({
    kd: t.includes('Knockdowns'),
    ctrl: t.includes('Temps de contrôle'),
    sol: t.includes('Frappes au sol'),
  });
})()" 2>&1 | head -1
agent-browser screenshot "$OUT/mma-donnees.png" >/dev/null 2>&1

log "Erreurs serveur (si aucune ligne, OK) :"
grep -iE "error|unhandled|exception" "$OUT/server.log" | grep -v "DeprecationWarning" | head -5 || log "aucune erreur"

kill $SERVER_PID 2>/dev/null
pkill -f "next dev" 2>/dev/null
log "Terminé — captures dans $OUT"
