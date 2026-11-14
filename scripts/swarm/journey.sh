#!/usr/bin/env bash
# ============================================================
# ESSAIM VOLTRIX — parcours réel pour UN viewport donné.
#   $1 = largeur  $2 = hauteur  $3 = nom court (slug)
# Parcours : accueil → jour J+2 → fiche match → combinateur
# (paramètres + résultats) → retour. Audits JSON + captures.
# ============================================================
set -u
cd /home/z/my-project
BASE="http://127.0.0.1:3000"
W="${1:?largeur}"; H="${2:?hauteur}"; SLUG="${3:?slug}"
OUT="/tmp/swarm/$SLUG"
AUDIT="$(cat scripts/swarm/audit.js)"
SESS="swarm-$SLUG"
rm -rf "$OUT" && mkdir -p "$OUT"
log() { echo "[$SLUG] $*"; }

agent-browser open "$BASE" --session "$SESS" >/dev/null 2>&1
agent-browser set viewport "$W" "$H" --session "$SESS" >/dev/null 2>&1
agent-browser open "$BASE" --session "$SESS" >/dev/null 2>&1
sleep 9

run_audit() { # $1 = écran
  agent-browser eval "$AUDIT" --session "$SESS" 2>/dev/null \
    | python3 -c "import sys,json;print(json.dumps(json.loads(json.loads(sys.stdin.read()))))" \
    > "$OUT/$1.json" 2>/dev/null || echo '{"error":"eval"}' > "$OUT/$1.json"
}

run_audit home
agent-browser screenshot "$OUT/home.png" --session "$SESS" >/dev/null 2>&1
log "home audité"

# ---- navigation jour J+2 ----
agent-browser eval "
(() => {
  const days = [...document.querySelectorAll('button[aria-pressed]')];
  const d = days[4] || days[days.length-1];
  if (d) d.click();
  return d ? d.innerText.replace(/\n/g,' ') : 'ABSENT';
})()" --session "$SESS" >/dev/null 2>&1
sleep 6
run_audit home-j2
log "jour J+2 audité"

# ---- fiche du premier match visible ----
agent-browser eval "
(() => {
  const cards = [...document.querySelectorAll('section[aria-label] button, [aria-label*=\"Match\"]')];
  const c = cards.find(x => /vs|–|—/.test(x.innerText || ''));
  if (c) { c.click(); return 'OUVERTE'; }
  return 'PAS_DE_CARTE';
})()" --session "$SESS" >/dev/null 2>&1
sleep 6
run_audit match
agent-browser screenshot "$OUT/match.png" --session "$SESS" >/dev/null 2>&1
log "fiche match auditée"

# ---- retour puis combinateur ----
agent-browser eval "document.querySelector('button[aria-label*=\"Retour\"]')?.click(); 1" --session "$SESS" >/dev/null 2>&1
sleep 2
agent-browser eval "document.querySelector('button[aria-label*=\"Combinateur\"]')?.click(); 1" --session "$SESS" >/dev/null 2>&1
sleep 2
run_audit combo-params
agent-browser screenshot "$OUT/combo-params.png" --session "$SESS" >/dev/null 2>&1
log "combinateur (paramètres) audité"

agent-browser eval "
(() => {
  const btns = [...document.querySelectorAll('button')];
  btns.find(b => /analyser/i.test(b.innerText))?.click();
  return 1;
})()" --session "$SESS" >/dev/null 2>&1
for i in $(seq 1 25); do
  E=$(agent-browser eval "
(() => {
  const mains = [...document.querySelectorAll('main')];
  const t = (mains[mains.length-1]?.innerText || '').toUpperCase();
  if (t.includes('ANALYSE EN COURS')) return 'RUN';
  if (t.includes('COMBINÉ PROPOSÉ') || t.includes('VARIANTE')) return 'DONE';
  if (t.includes('AUCUN')) return 'NONE';
  return '...';
})()" --session "$SESS" 2>/dev/null | tr -d '"' | head -1)
  case "$E" in DONE|NONE) break;; esac; sleep 2
done
run_audit combo-results
agent-browser screenshot "$OUT/combo-results.png" --session "$SESS" >/dev/null 2>&1
log "combinateur (résultats: $E) audité"

agent-browser close --session "$SESS" >/dev/null 2>&1
log "terminé"
