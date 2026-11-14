#!/usr/bin/env bash
# Backfill séquentiel jour par jour (chaque jour dans son propre
# processus : la mémoire est libérée entre les jours, un crash
# n'interrompt pas toute la fenêtre).
set -u
cd /home/z/my-project
LOG=/tmp/backfill
mkdir -p "$LOG"

DB='postgresql://neondb_owner:npg_D1OymYeRSnr2@ep-round-cloud-ae3m3lka-pooler.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require'
DIRECT='postgresql://neondb_owner:npg_D1OymYeRSnr2@ep-round-cloud-ae3m3lka.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require'

for START in "$@"; do
  echo "=== Jour offset $START ($(date +%H:%M:%S)) ==="
  for attempt in 1 2 3; do
    if env DATABASE_URL="$DB" DIRECT_DATABASE_URL="$DIRECT" \
        PRECOMPUTE_START="$START" PRECOMPUTE_DAYS=1 PRECOMPUTE_CONCURRENCY=2 \
        bun scripts/precompute/run.ts > "$LOG/jour-$START-essai$attempt.log" 2>&1; then
      echo "  OK (essai $attempt) : $(tail -1 "$LOG/jour-$START-essai$attempt.log")"
      break
    else
      echo "  ÉCHEC essai $attempt — $(tail -2 "$LOG/jour-$START-essai$attempt.log" | head -1)"
      sleep 3
    fi
  done
done
echo "=== BACKFILL TERMINÉ ($(date +%H:%M:%S)) ==="
