#!/usr/bin/env bash
# ============================================================
# VOLTRIX — scripts/build-local.sh
# Build de production local SANS credentials Neon (post-leak :
# le .env local ne contient ni Neon ni DIRECT_URL).
# Principe : `prisma migrate deploy` (étape du build) a besoin d'une
# base PostgreSQL → on boot un PG 17 ÉPHÉMÈRE (.tmp-pg/pg17), on y
# applique les migrations, on build, on jette. L'artefact .next est
# indépendant de la base utilisée pendant le build.
# Usage : bash scripts/build-local.sh
# ============================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PGBIN="$ROOT/.tmp-pg/pg17/usr/lib/postgresql/17/bin"
bash "$ROOT/scripts/ensure-pg17.sh" > /dev/null

BUILD_TMP="$(mktemp -d /tmp/voltrix-build-XXXXXX)"
PG_PORT=5833 + $(( $$ % 50 )) 2>/dev/null || PG_PORT=5833
PG_PORT=$(( 5833 + ($$ % 50) ))
DATA_DIR="$BUILD_TMP/pgdata"
LOG_DIR="$BUILD_TMP"

"$PGBIN"/initdb -D "$DATA_DIR" -U postgres -A trust -E UTF8 --no-locale > /dev/null 2>&1
"$PGBIN"/pg_ctl -D "$DATA_DIR" -o "-p $PG_PORT -c listen_addresses=127.0.0.1 -k $BUILD_TMP" -l "$LOG_DIR/pg.log" start > /dev/null 2>&1

for i in $(seq 1 50); do
  if "$PGBIN"/pg_isready -h 127.0.0.1 -p "$PG_PORT" > /dev/null 2>&1; then break; fi
  sleep 0.2
done

export DATABASE_URL="postgresql://postgres@127.0.0.1:$PG_PORT/postgres"
export DIRECT_URL="$DATABASE_URL"

cleanup() {
  "$PGBIN"/pg_ctl -D "$DATA_DIR" stop -m fast > /dev/null 2>&1 || true
  rm -rf "$BUILD_TMP"
}
trap cleanup EXIT

npm run build
