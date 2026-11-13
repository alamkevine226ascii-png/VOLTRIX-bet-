#!/usr/bin/env bash
# ============================================================
# TEST FINAL COMBINATEUR + SYNC — VOLTRIX (390×844, une session)
#   1. accueil base Neon ;
#   2. combinateur : analyse JOURNÉE puis SEMAINE ;
#   3. clic sur une jambe → fiche match ;
#   4. retour accueil instantané ;
#   5. Réinitialiser → toast « Base synchronisée » ;
#   6. jour passé (J-1) → statuts rafraîchis (FT).
# Détection insensible à la casse (le CSS uppercasse innerText).
# ============================================================
set -u
cd /home/z/my-project

BASE="http://localhost:3000"
OUT=/tmp/vt-final
rm -rf "$OUT" && mkdir -p "$OUT"
log() { echo "[$(date +%H:%M:%S)] $*"; }

pkill -f "next dev" 2>/dev/null; pkill -f "next-server" 2>/dev/null
sleep 2

DATABASE_URL='postgresql://neondb_owner:npg_D1OymYeRSnr2@ep-round-cloud-ae3m3lka-pooler.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require' \
NEXT_PUBLIC_ESPN_SITE_BASE="$BASE/api/espn/site" \
NEXT_PUBLIC_ESPN_SITEWEB_BASE="$BASE/api/espn/siteweb" \
NEXT_PUBLIC_ESPN_CORE_BASE="$BASE/api/espn/core" \
bun run dev > "$OUT/server.log" 2>&1 &
SERVER_PID=$!

for i in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 "$BASE" 2>/dev/null || echo 000)
  [ "$code" = "200" ] && break; sleep 2
done
log "Serveur HTTP $code"

agent-browser open "$BASE" >/dev/null 2>&1
agent-browser set viewport 390 844 >/dev/null 2>&1
sleep 8
log "Accueil : $(agent-browser eval "document.querySelectorAll('section[aria-label]').length" 2>/dev/null | tr -dc '0-9') sections"
agent-browser screenshot "$OUT/1-accueil.png" >/dev/null 2>&1

# ---- combinateur : journée ----
agent-browser eval "document.querySelector('button[aria-label*=\"Combinateur\"]')?.click()" >/dev/null 2>&1
sleep 2
agent-browser eval "
(() => {
  const btns = [...document.querySelectorAll('button')];
  btns.find(b => /analyser/i.test(b.innerText))?.click();
  return 1;
})()" >/dev/null 2>&1
for i in $(seq 1 25); do
  E=$(agent-browser eval "
(() => {
  const mains = [...document.querySelectorAll('main')];
  const t = (mains[mains.length-1]?.innerText || '').toUpperCase();
  if (t.includes('ANALYSE EN COURS')) return 'ANALYSE';
  if (t.includes('COMBINÉ PROPOSÉ')) return 'COMBO';
  if (t.includes('AUCUN COMBINÉ')) return 'AUCUN';
  if (t.includes('AUCUN MATCH À VENIR')) return 'VIDE';
  return '...';
})()" 2>/dev/null | tr -d '"' | head -1)
  case "$E" in COMBO|AUCUN|VIDE) break;; esac; sleep 2
done
log "Analyse JOURNÉE : $E"
agent-browser screenshot "$OUT/2-combo-journee.png" >/dev/null 2>&1

# ---- bascule semaine ----
agent-browser eval "
(() => {
  const mains = [...document.querySelectorAll('main')];
  const combo = mains[mains.length-1];
  const btns = [...combo.querySelectorAll('button')];
  btns.find(b => /^semaine$/i.test(b.innerText.trim()))?.click();
  return 1;
})()" >/dev/null 2>&1
sleep 1
agent-browser eval "
(() => {
  const mains = [...document.querySelectorAll('main')];
  const combo = mains[mains.length-1];
  const btns = [...combo.querySelectorAll('button')];
  btns.find(b => /analyser/i.test(b.innerText))?.click();
  return 1;
})()" >/dev/null 2>&1
for i in $(seq 1 30); do
  E=$(agent-browser eval "
(() => {
  const mains = [...document.querySelectorAll('main')];
  const t = (mains[mains.length-1]?.innerText || '').toUpperCase();
  if (t.includes('ANALYSE EN COURS')) return 'ANALYSE';
  if (t.includes('COMBINÉ PROPOSÉ')) return 'COMBO';
  if (t.includes('AUCUN COMBINÉ')) return 'AUCUN';
  if (t.includes('AUCUN MATCH À VENIR')) return 'VIDE';
  return '...';
})()" 2>/dev/null | tr -d '"' | head -1)
  case "$E" in COMBO|AUCUN|VIDE) break;; esac; sleep 2
done
RESUME=$(agent-browser eval "
(() => {
  const mains = [...document.querySelectorAll('main')];
  const t = mains[mains.length-1]?.innerText || '';
  const m = t.match(/(\d+) MATCHS ANALYSÉS · (\d+) SÉLECTIONS?/);
  const c = t.match(/CÔTE\s*\n\s*([\d.]+)/);
  const p = t.match(/RÉUSSITE\s*\n\s*(\d+)%/);
  return JSON.stringify({ stats: m ? m[1]+' matchs / '+m[2]+' sélections' : '?', cote: c ? c[1] : '?', reussite: p ? p[1]+'%' : '?' });
})()" 2>/dev/null | tr -d '"' | head -1)
log "Analyse SEMAINE : $E → $RESUME"
agent-browser screenshot "$OUT/3-combo-semaine.png" >/dev/null 2>&1

# ---- clic sur une jambe → fiche match ----
CLIC=$(agent-browser eval "
(() => {
  const mains = [...document.querySelectorAll('main')];
  const combo = mains[mains.length-1];
  const leg = [...combo.querySelectorAll('section[aria-label] button')].find(b => /\d\.\d{2}/.test(b.innerText));
  if (leg) { leg.click(); return 'OUVERTE'; }
  return 'PAS_DE_JAMBE';
})()" 2>/dev/null | tr -d '"' | head -1)
log "Clic jambe : $CLIC"
sleep 3
FICHE=$(agent-browser eval "
(() => {
  const mains = [...document.querySelectorAll('main')];
  const t = (mains[mains.length-1]?.innerText || '').toUpperCase();
  return t.includes('SYNTHÈSE') || t.includes('MARCHÉS') ? 'FICHE_MATCH_OK' : 'PAS_DE_FICHE';
})()" 2>/dev/null | tr -d '"' | head -1)
log "Fiche match depuis le combiné : $FICHE"
agent-browser screenshot "$OUT/4-fiche-depuis-combo.png" >/dev/null 2>&1

# ---- retour accueil (double pop : fiche puis combinateur) ----
agent-browser eval "document.querySelector('button[aria-label*=\"Retour\"]')?.click()" >/dev/null 2>&1
sleep 1
agent-browser eval "document.querySelector('button[aria-label*=\"Retour\"]')?.click()" >/dev/null 2>&1
sleep 1.5
log "Retour accueil : $(agent-browser eval "
(() => JSON.stringify({ sections: document.querySelectorAll('section[aria-label]').length, squelettes: document.querySelectorAll('.animate-pulse').length })
})()" 2>/dev/null | tr -d '"' | head -1)"

# ---- réinitialiser ----
agent-browser eval "document.querySelector('button[aria-label*=\"Réinitialiser\"]')?.click()" >/dev/null 2>&1
T=""
for i in $(seq 1 60); do
  T=$(agent-browser eval "document.body.innerText.includes('Base synchronisée') ? 'TOAST_OK' : '...'" 2>/dev/null | tr -d '"' | head -1)
  [ "$T" = "TOAST_OK" ] && break; sleep 2
done
log "Réinitialiser : $T"
sleep 1
agent-browser screenshot "$OUT/5-apres-reset.png" >/dev/null 2>&1

# ---- jour passé : statuts ----
SEL=$(agent-browser eval "
(() => {
  const days = [...document.querySelectorAll('button[aria-pressed]')];
  if (days.length >= 2) { days[1].click(); return 'J-1'; }
  return 'ABSENT';
})()" 2>/dev/null | tr -d '"' | head -1)
log "Sélection $SEL"
sleep 14
log "J-1 statuts : $(agent-browser eval "
(() => {
  const t = document.body.innerText;
  return 'FT=' + (t.match(/FT/g) || []).length + ' Live=' + (t.match(/Live/g) || []).length;
})()" 2>/dev/null | tr -d '"' | head -1)"
agent-browser screenshot "$OUT/6-jour-passe.png" >/dev/null 2>&1

log "=== TERMINÉ — captures dans $OUT ==="
kill $SERVER_PID 2>/dev/null
pkill -f "next dev" 2>/dev/null
