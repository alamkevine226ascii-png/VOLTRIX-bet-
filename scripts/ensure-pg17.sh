#!/usr/bin/env bash
# ============================================================
# VOLTRIX — scripts/ensure-pg17.sh
# Garantit la présence des binaires PostgreSQL 17 extraits localement
# (.tmp-pg/pg17) requis par les suites de tests (test-option-b.ts,
# test-wake-sync.ts, …). Le cluster de test est ÉPHÉMÈRE (tmpdir, port
# dérivé du PID) — JAMAIS la base de production.
# Le reboot du conteneur efface .tmp-pg → ce script ré-extrait depuis
# deb.debian.org (postgresql-17 + client + libpq5, dpkg-deb -x, sans
# installation système).
# Usage : bash scripts/ensure-pg17.sh
# ============================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN="$ROOT/.tmp-pg/pg17/usr/lib/postgresql/17/bin"

if [ -x "$PGBIN/initdb" ] && [ -x "$PGBIN/pg_ctl" ] && [ -x "$PGBIN/pg_isready" ]; then
  "$PGBIN/postgres" --version
  echo "✓ PostgreSQL 17 déjà extrait (.tmp-pg/pg17)"
  exit 0
fi

mkdir -p "$ROOT/.tmp-pg/debs"
cd "$ROOT/.tmp-pg/debs"

# Téléchargement des .deb (rejouable — apt-get download est idempotent)
if ! ls postgresql-17_*.deb >/dev/null 2>&1; then
  apt-get download postgresql-17 postgresql-client-17 libpq5
fi

for deb in *.deb; do
  dpkg-deb -x "$deb" "$ROOT/.tmp-pg/pg17/"
done

chmod +x "$PGBIN"/* 2>/dev/null || true
"$PGBIN/postgres" --version
echo "✓ PostgreSQL 17 extrait dans .tmp-pg/pg17"
