#!/usr/bin/env bash
# Scan final — valeurs réelles (password Neon, token GitHub, hôte) dans TOUT l'historique Git.
# Aucune valeur n'est jamais affichée : seuls les compteurs et longueurs sont imprimés.
cd /home/z/my-project || exit 1
if [ -f .zscripts/.env.neon ]; then
  set -a; source .zscripts/.env.neon; set +a
else
  echo "NOTE: .zscripts/.env.neon absent (perdu au reboot conteneur) -> scan PATTERNS uniquement ; le scan valeurs réelles a été fait au moment du push (Task 48, worklog)"
fi

VALS=$(python3 - <<'PYEOF'
import os, urllib.parse as u
s = os.environ.get('DATABASE_URL','')
p = u.urlparse(s)
pw = u.unquote(p.password or '')
host = p.hostname or ''
tok = os.environ.get('GH_TOKEN','')
print(len(pw)); print(host); print(len(tok))
print(pw); print(tok)
PYEOF
)
PW_LEN=$(echo "$VALS" | sed -n 1p)
HOST=$(echo "$VALS" | sed -n 2p)
TOK_LEN=$(echo "$VALS" | sed -n 3p)
PW=$(echo "$VALS" | sed -n 4p)
TOK=$(echo "$VALS" | sed -n 5p)
echo "longueurs: pw=$PW_LEN host=$PW_LEN(hote.non-affiche=${#HOST}) token=$TOK_LEN"

scan_all() {
  local label="$1" val="$2"
  if [ -z "$val" ]; then echo "$label: VALEUR VIDE (skip)"; return; fi
  local hits=0 files=""
  for c in $(git rev-list --all); do
    local f
    f=$(git grep -F -l "$val" "$c" 2>/dev/null | wc -l)
    hits=$((hits+f))
  done
  echo "$label -> $hits fichier/commit dans TOUT l'historique ($(git rev-list --all | wc -l) commits scannés)"
}

scan_all "password Neon" "$PW"
scan_all "hote Neon" "$HOST"
scan_all "token GitHub" "$TOK"

gen() {
  local label="$1" pat="$2"
  local total=0 list=""
  for c in $(git rev-list --all); do
    local f
    f=$(git grep -E -l "$pat" "$c" 2>/dev/null)
    if [ -n "$f" ]; then
      total=$((total+$(echo "$f" | wc -l)))
      list="$list $f"
    fi
  done
  echo "pattern $label -> $total fichier(s) total"
  [ -n "$list" ] && echo "   fichiers: $(echo $list | tr ' ' '\n' | sort -u | tr '\n' ' ')"
}

gen "npg_" 'npg_[A-Za-z0-9]{10,}'
gen "github_pat_" 'github_pat_[A-Za-z0-9_]{10,}'
gen "ghp_" 'ghp_[A-Za-z0-9]{20,}'
gen "creds postgres inline" 'postgres(ql)?://[^/\"[:space:]]+:[^@\"[:space:]]+@'

echo "fichiers suivis sous .zscripts: $(git ls-files .zscripts | wc -l) (attendu 0)"
git check-ignore -v .zscripts/.env.neon
