#!/usr/bin/env bash
# Lance le serveur de production PUIS une série de parcours
# (un viewport chacun) dans le même appel — le sandbox ne
# conserve pas les processus entre les appels.
#   $@ : liste "slug largeur hauteur"
set -u
cd /home/z/my-project

DB='postgresql://neondb_owner:npg_D1OymYeRSnr2@ep-round-cloud-ae3m3lka-pooler.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require'

pkill -f "standalone/server.js" 2>/dev/null; pkill -f agent-browser 2>/dev/null; sleep 1
DATABASE_URL="$DB" NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 \
  nohup bun .next/standalone/server.js > /tmp/prodserver.log 2>&1 &
SRV=$!
for i in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 http://127.0.0.1:3000 2>/dev/null || echo 000)
  [ "$code" = "200" ] && break; sleep 1
done
echo "Serveur HTTP $code (PID $SRV)"
[ "$code" != "200" ] && exit 1

while [ $# -ge 3 ]; do
  slug="$1"; w="$2"; h="$3"; shift 3
  bash scripts/swarm/journey.sh "$w" "$h" "$slug"
done

kill $SRV 2>/dev/null
pkill -f agent-browser 2>/dev/null
echo "=== LOT TERMINÉ ==="
