#!/bin/bash
# Recherche d'images de stades réels pour VOLTRIX — capture stdout (JSON après les lignes de progression)
mkdir -p /tmp/stadium-search
cd /tmp/stadium-search

search() {
  local key="$1"; local query="$2"
  # déjà fait ?
  if [ -s "$key.json" ] && grep -q '"success": true' "$key.json" 2>/dev/null; then
    echo "[skip] $key"
    return
  fi
  z-ai image-search -q "$query" -c 3 --gl us --no-rank > "$key.raw" 2>/dev/null
  # extraire le JSON (à partir de la première accolade)
  sed -n '/^{/,$p' "$key.raw" > "$key.json"
  rm -f "$key.raw"
  echo "[done] $key ($(grep -c original_url "$key.json" 2>/dev/null || echo 0) urls)"
}

search arsenal "Emirates Stadium Arsenal London football stadium" &
search liverpool "Anfield Stadium Liverpool football" &
search mancity "Etihad Stadium Manchester City football ground" &
wait
search chelsea "Stamford Bridge Chelsea football stadium" &
search tottenham "Tottenham Hotspur Stadium London football arena" &
search newcastle "St James Park Newcastle United football stadium" &
search realmadrid "Santiago Bernabeu Real Madrid stadium" &
wait
search barcelona "Camp Nou FC Barcelona stadium" &
search atletico "Civitas Metropolitano Atletico Madrid stadium" &
search sevilla "Ramon Sanchez Pizjuan Sevilla football stadium" &
search inter "San Siro stadium Milan football" &
wait
search juventus "Allianz Stadium Juventus Turin football" &
search napoli "Stadio Diego Armando Maradona Napoli football" &
search roma "Stadio Olimpico Rome football stadium" &
search bayern "Allianz Arena Bayern Munich football stadium" &
wait
search dortmund "Signal Iduna Park Borussia Dortmund stadium" &
search leipzig "Red Bull Arena Leipzig football stadium" &
search leverkusen "BayArena Bayer Leverkusen football stadium" &
search psg "Parc des Princes Paris Saint Germain stadium" &
wait
search marseille "Orange Velodrome Marseille football stadium" &
search monaco "Stade Louis II Monaco football" &
search lyon "Groupama Stadium Lyon football" &
search lille "Stade Pierre Mauroy Lille football stadium" &
wait
search nice "Allianz Riviera Nice football stadium" &
wait

echo "=== Résumé ==="
for f in *.json; do
  key="${f%.json}"
  ok=$(grep -c '"success": true' "$f" 2>/dev/null)
  n=$(grep -c 'original_url' "$f" 2>/dev/null)
  echo "$key: success=$ok urls=$n"
done
