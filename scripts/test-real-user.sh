#!/usr/bin/env bash
# ============================================================
# TEST UTILISATEUR RÉEL — VOLTRIX App (navigateur headless 390×844)
# 1. Accueil : chargement matchs + pronos rapides
# 2. Détail match : section « Premier but » (minute attendue)
# 3. Compos : source publiée / match précédent
# 4. PERSISTANCE : rechargement → pronos restaurés de la base locale
# Tout en une commande : le serveur meurt à la fin de l'appel outil.
# ============================================================
set -u
cd /home/z/my-project

PORT=3000
BASE="http://localhost:$PORT"
OUT=/tmp/vt-test
rm -rf "$OUT" && mkdir -p "$OUT"

log() { echo "[$(date +%H:%M:%S)] $*"; }

# ---------- 0. nettoyer tout résidu sur le port ----------
pkill -f "next dev" 2>/dev/null; pkill -f "next-server" 2>/dev/null
sleep 2
code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 2 "$BASE" 2>/dev/null || echo 000)
if [ "$code" != "000" ]; then
  log "ATTENTION : quelque chose répond encore sur $PORT (code $code)"
fi

# ---------- 1. démarrage serveur ----------
# Relai ESPN même-origine : le navigateur headless de ce sandbox n'a pas
# d'accès Internet direct (le serveur, lui, en a). Les variables
# NEXT_PUBLIC_* pointent l'adaptateur client vers /api/espn/* qui relaie
# côté serveur. Chez un vrai utilisateur (navigateur avec Internet), les
# appels vont directement chez ESPN (CORS ouvert) — même code.
log "Démarrage du serveur dev (relai ESPN activé)…"
NEXT_PUBLIC_ESPN_SITE_BASE="http://localhost:$PORT/api/espn/site" \
NEXT_PUBLIC_ESPN_SITEWEB_BASE="http://localhost:$PORT/api/espn/siteweb" \
NEXT_PUBLIC_ESPN_CORE_BASE="http://localhost:$PORT/api/espn/core" \
bun run dev > "$OUT/server.log" 2>&1 &
SERVER_PID=$!

ready=0
for i in $(seq 1 90); do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 "$BASE" 2>/dev/null || echo 000)
  if [ "$code" = "200" ]; then ready=1; break; fi
  # si le serveur meurt → arrêt immédiat
  kill -0 $SERVER_PID 2>/dev/null || { log "Processus serveur mort"; tail -20 "$OUT/server.log"; exit 1; }
  sleep 2
done
if [ "$ready" != "1" ]; then
  log "ÉCHEC : serveur non prêt (dernier code $code)"
  tail -30 "$OUT/server.log"
  kill $SERVER_PID 2>/dev/null; exit 1
fi
log "Serveur prêt (HTTP 200) — PID $SERVER_PID."

# ---------- 2. accueil ----------
agent-browser open "$BASE" >/dev/null 2>&1
agent-browser set viewport 390 844 >/dev/null 2>&1
log "App ouverte — attente des cartes de match (scan ESPN par vagues)…"

cards=0
for i in $(seq 1 120); do
  cards=$(agent-browser eval "document.querySelectorAll('section[aria-label]').length" 2>/dev/null | tr -dc '0-9')
  [ -z "$cards" ] && cards=0
  if [ "$cards" -ge 1 ]; then break; fi
  sleep 2
done
log "Sections ligues affichées : $cards"

# attendre que des matchs À VENIR existent (pronos = seulement status 'pre')
for i in $(seq 1 30); do
  upcoming=$(agent-browser eval "
(() => {
  const t = document.body.innerText;
  const hours = (t.match(/\\b\\d{1,2}:\\d{2}\\b/g) || []).length;
  return String(hours);
})()" 2>/dev/null | tr -dc '0-9')
  [ -z "$upcoming" ] && upcoming=0
  if [ "$upcoming" -ge 1 ]; then break; fi
  sleep 2
done
log "Heures de matchs visibles : $upcoming"
sleep 25  # laisser les pronos rapides se calculer
agent-browser screenshot "$OUT/1-accueil.png" >/dev/null 2>&1
log "Capture accueil prise."

agent-browser eval "
(() => {
  const t = document.body.innerText;
  return JSON.stringify({
    restaure: t.includes('restauré'),
    busy: t.includes('Moteur en analyse'),
    pctCartes: (t.match(/\\d{1,3}[,.]?\\d?\\s*%/g) || []).length
  });
})()" 2>/dev/null | head -3

# ---------- 3. ouvrir un détail de match (carte FOOTBALL à venir) ----------
# Approche par SECTION : les cartes football vivent dans des sections
# <section aria-label="Nom de ligue"> (Eliteserien, FA Cup, Laliga 2…).
# Les cartes MMA vivent dans des sections d'événement UFC — exclues.
log "Attente d'une carte de match FOOTBALL à venir…"
CLICKED=""
for i in $(seq 1 30); do
  CLICKED=$(agent-browser eval "
(() => {
  const secs = [...document.querySelectorAll('section[aria-label]')];
  for (const s of secs) {
    const label = (s.getAttribute('aria-label') || '').toUpperCase();
    if (label.includes('UFC') || label.includes('COMBAT') || label.includes('PERSPECT')) continue;
    const cards = [...s.querySelectorAll('article')];
    const target = cards.find(c => /\\d{1,2}:\\d{2}|AT \\d/.test(c.innerText));
    if (!target) continue;
    const label2 = target.innerText.split('\\n').filter(x => x.trim()).slice(0, 2).join(' vs ').slice(0, 90);
    target.scrollIntoView({block: 'center'});
    target.click();
    return 'CLICKED [' + s.getAttribute('aria-label') + ']: ' + label2;
  }
  return 'AUCUN_ARTICLE';
})()" 2>/dev/null | tr -d '"' | head -1)
  if ! echo "$CLICKED" | grep -q "AUCUN"; then break; fi
  sleep 3
done
log "Carte cliquée → $CLICKED"

if echo "$CLICKED" | grep -q "AUCUN"; then
  log "Aucune carte de match — échec."
  agent-browser screenshot "$OUT/0-accueil-vide.png" >/dev/null 2>&1
  kill $SERVER_PID 2>/dev/null; exit 1
fi
sleep 5

# attendre la fin de l'analyse (max 120 s : 1re compile + analyse ESPN)
for i in $(seq 1 60); do
  done=$(agent-browser eval "document.body.innerText.includes('1er but attendu')" 2>/dev/null | head -1)
  if echo "$done" | grep -qi "true"; then break; fi
  sleep 2
done
agent-browser screenshot "$OUT/2-detail-haut.png" >/dev/null 2>&1
log "Capture détail prise."

# ---------- 4. section Premier but : extraire la minute ----------
agent-browser eval "
(() => {
  const t = document.body.innerText;
  const i = t.indexOf('1er but attendu');
  const m = i >= 0 ? t.slice(i, i + 320).replace(/\\n+/g, ' | ') : 'SECTION ABSENTE';
  return m;
})()" 2>/dev/null | head -4

agent-browser eval "
(() => {
  const els = [...document.querySelectorAll('p,span,h2,div')].filter(e => e.textContent && e.textContent.trim() === 'Premier but');
  if (els.length) { els[0].scrollIntoView({block:'center'}); return 'SCROLLED'; }
  return 'PAS_TROUVE';
})()" 2>/dev/null | head -1
sleep 1
agent-browser screenshot "$OUT/3-premier-but.png" >/dev/null 2>&1

# ---------- 5. onglet Compos ----------
log "Onglet Compos…"
agent-browser find text "Compos" click >/dev/null 2>&1
sleep 15
agent-browser screenshot "$OUT/4-compos.png" >/dev/null 2>&1
agent-browser eval "
(() => {
  const t = document.body.innerText;
  const i = Math.max(t.indexOf('Compos'), 0);
  return 'EXTRAIT: ' + t.slice(i, i + 600).replace(/\\n+/g, ' | ');
})()" 2>/dev/null | head -6

# ---------- 6. retour accueil + TEST DE PERSISTANCE ----------
log "Retour accueil puis test persistance…"
agent-browser eval "
(() => {
  const btns = [...document.querySelectorAll('button,[role=button],a,div')];
  const back = btns.find(b => b.getAttribute('aria-label') && String(b.getAttribute('aria-label')).toLowerCase().includes('retour'));
  if (back) { back.click(); return 'BACK-ARIA'; }
  const first = btns.find(b => b.querySelector('svg') && b.getBoundingClientRect().width < 60 && b.getBoundingClientRect().top < 120);
  if (first) { first.click(); return 'BACK-ICON'; }
  return 'NO-BACK';
})()" 2>/dev/null | head -1
sleep 5

# attendre que des pronos soient stockés dans IndexedDB
for i in $(seq 1 40); do
  n=$(agent-browser eval "
(async () => {
  try {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open('voltrix-pred-db');
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    return await new Promise((res) => {
      try {
        const tx = db.transaction('preds','readonly');
        const rq = tx.objectStore('preds').count();
        rq.onsuccess = () => res(String(rq.result)); rq.onerror = () => res('0');
      } catch { res('0'); }
    });
  } catch { return '0'; }
})()" 2>/dev/null | tr -dc '0-9')
  [ -z "$n" ] && n=0
  if [ "$n" -ge 1 ]; then break; fi
  sleep 3
done
log "Entrées en base IndexedDB : $n"

# RELOAD — mesure du temps de restauration
log "RECHARGEMENT de la page (simulation : quitter puis revenir)…"
t0=$(date +%s%3N)
agent-browser eval "location.reload(); 'reload'" >/dev/null 2>&1
sleep 3
restored=""
for i in $(seq 1 60); do
  r=$(agent-browser eval "document.body.innerText.toLowerCase().includes('restauré')" 2>/dev/null | head -1)
  if echo "$r" | grep -qi "true"; then
    t1=$(date +%s%3N)
    restored="OK en $((t1 - t0)) ms"
    break
  fi
  sleep 1
done
log "Pronos restaurés après reload : ${restored:-NON TROUVÉ}"
agent-browser screenshot "$OUT/5-apres-reload.png" >/dev/null 2>&1

agent-browser eval "
(() => {
  const t = document.body.innerText;
  const badge = (t.match(/⚡[^\\n]*/g) || []).join(' | ');
  return JSON.stringify({badge, busy: t.includes('Moteur en analyse')});
})()" 2>/dev/null | head -3

# ---------- 7. bilan ----------
log "Bilan des captures :"
for f in "$OUT"/*.png; do
  [ -f "$f" ] && echo "  $(basename "$f") : $(stat -c%s "$f") octets"
done

kill $SERVER_PID 2>/dev/null
pkill -f "next dev" 2>/dev/null
log "Test terminé."
