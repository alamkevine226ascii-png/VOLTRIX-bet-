#!/bin/bash

set -euo pipefail

# 获取脚本所在目录（.zscripts）
# 使用 $0 获取脚本路径（与 build.sh 保持一致）
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

log_step_start() {
        local step_name="$1"
        echo "=========================================="
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting: $step_name"
        echo "=========================================="
        export STEP_START_TIME
        STEP_START_TIME=$(date +%s)
}

log_step_end() {
        local step_name="${1:-Unknown step}"
        local end_time
        end_time=$(date +%s)
        local duration=$((end_time - STEP_START_TIME))
        echo "=========================================="
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] Completed: $step_name"
        echo "[LOG] Step: $step_name | Duration: ${duration}s"
        echo "=========================================="
        echo ""
}

start_mini_services() {
        local mini_services_dir="$PROJECT_DIR/mini-services"
        local started_count=0

        log_step_start "Starting mini-services"
        if [ ! -d "$mini_services_dir" ]; then
                echo "Mini-services directory not found, skipping..."
                log_step_end "Starting mini-services"
                return 0
        fi

        echo "Found mini-services directory, scanning for sub-services..."

        for service_dir in "$mini_services_dir"/*; do
                if [ ! -d "$service_dir" ]; then
                        continue
                fi

                local service_name
                service_name=$(basename "$service_dir")
                echo "Checking service: $service_name"

                if [ ! -f "$service_dir/package.json" ]; then
                        echo "[$service_name] No package.json found, skipping..."
                        continue
                fi

                if ! grep -q '"dev"' "$service_dir/package.json"; then
                        echo "[$service_name] No dev script found, skipping..."
                        continue
                fi

                echo "Starting $service_name in background..."
                (
                        cd "$service_dir"
                        echo "[$service_name] Installing dependencies..."
                        bun install
                        echo "[$service_name] Running bun run dev..."
                        exec bun run dev
                ) >"$PROJECT_DIR/.zscripts/mini-service-${service_name}.log" 2>&1 &

                local service_pid=$!
                echo "[$service_name] Started in background (PID: $service_pid)"
                echo "[$service_name] Log: $PROJECT_DIR/.zscripts/mini-service-${service_name}.log"
                disown "$service_pid" 2>/dev/null || true
                started_count=$((started_count + 1))
        done

        echo "Mini-services startup completed. Started $started_count service(s)."
        log_step_end "Starting mini-services"
}

wait_for_service() {
        local host="$1"
        local port="$2"
        local service_name="$3"
        local max_attempts="${4:-60}"
        local attempt=1

        echo "Waiting for $service_name to be ready on $host:$port..."

        while [ "$attempt" -le "$max_attempts" ]; do
                if curl -s --connect-timeout 2 --max-time 5 "http://$host:$port" >/dev/null 2>&1; then
                        echo "$service_name is ready!"
                        return 0
                fi

                echo "Attempt $attempt/$max_attempts: $service_name not ready yet, waiting..."
                sleep 1
                attempt=$((attempt + 1))
        done

        echo "ERROR: $service_name failed to start within $max_attempts seconds"
        return 1
}

cleanup() {
        if [ -n "${DEV_PID:-}" ] && kill -0 "$DEV_PID" >/dev/null 2>&1; then
                echo "Stopping Next.js dev server (PID: $DEV_PID)..."
                kill "$DEV_PID" >/dev/null 2>&1 || true
        fi
}

trap cleanup EXIT INT TERM

cd "$PROJECT_DIR"

if ! command -v bun >/dev/null 2>&1; then
        echo "ERROR: bun is not installed or not in PATH"
        exit 1
fi

# ------------------------------------------------------------------
# Task 28 — AUDIT UTILISATEUR : PERSISTANCE DE L'ENVIRONNEMENT NEON
# Le boot plateforme écrase le .env racine avec l'URL SQLite
# (start.sh : echo DATABASE_URL=file:... > .env) — ce qui cassait
# `prisma db push` (schéma PostgreSQL + URL SQLite) et empêchait le
# démarrage du serveur. On restaure ici l'environnement Neon AVANT
# toute opération Prisma. Le secret vit dans .zscripts/.env.neon
# (gitignore — jamais committé), fichier qui survit aux restaurations
# (l'archive de restauration inclut .zscripts/, contrairement au
# .env racine qu'elle exclut).
# ------------------------------------------------------------------
log_step_start "Neon environment"
# Task 28-b : purge des variables héritées du shell — le .env DOIT faire foi.
# (un shell qui exporterait DATABASE_URL=file: ferait basculer Prisma en SQLite
# silencieusement, même avec un .env Neon correct)
unset DATABASE_URL DIRECT_URL || true
if [ -f "$PROJECT_DIR/.zscripts/.env.neon" ]; then
        cat "$PROJECT_DIR/.zscripts/.env.neon" > "$PROJECT_DIR/.env"
        echo "[ENV] Neon PostgreSQL environment written to .env (from .zscripts/.env.neon)"
elif [ -f "$PROJECT_DIR/backups/.env.neon.copy" ]; then
        # Copie de secours (backups/ est archivé dans repo.tar — Task 28-b)
        cat "$PROJECT_DIR/backups/.env.neon.copy" > "$PROJECT_DIR/.env"
        echo "[ENV] Neon PostgreSQL environment written to .env (from backups/.env.neon.copy — SECOURS)"
elif grep -q 'postgresql://' "$PROJECT_DIR/.env" 2>/dev/null; then
        echo "[ENV] .env pointe déjà vers PostgreSQL — conservé tel quel (secours indisponibles)"
else
        # FAIL LOUD : sans secret Neon, le boot retomberait en SQLite silencieux
        # (schéma PostgreSQL + URL file: → toutes les routes DB en échec). Mieux
        # vaut un démarrage en échec VISIBLE qu'une app muette hors ligne.
        echo "[ENV] ERREUR FATALE : ni .zscripts/.env.neon ni backups/.env.neon.copy"
        echo "[ENV] ne sont présents et .env ne contient pas d'URL PostgreSQL."
        echo "[ENV] Refus de démarrer en SQLite silencieux — restaurer le secret Neon."
        exit 1
fi
log_step_end "Neon environment"

log_step_start "bun install"
echo "[BUN] Installing dependencies..."
bun install
log_step_end "bun install"

# NB : `db push --accept-data-loss` contre la base de PRODUCTION est
# interdit — les migrations sont baseline-résolues ; `migrate deploy`
# n'applique que les migrations en attente (idempotent, sûr).
log_step_start "prisma generate + migrate deploy"
echo "[PRISMA] Generating client..."
bunx prisma generate
if bunx prisma migrate deploy; then
        echo "[PRISMA] migrate deploy OK (aucune migration en attente = no-op)"
else
        echo "[PRISMA] WARNING: migrate deploy a échoué — démarrage toléré"
fi
log_step_end "prisma generate + migrate deploy"

log_step_start "Starting Next.js dev server"
echo "[BUN] Starting development server..."
bun run dev &
DEV_PID=$!
log_step_end "Starting Next.js dev server"

log_step_start "Waiting for Next.js dev server"
wait_for_service "localhost" "3000" "Next.js dev server"
log_step_end "Waiting for Next.js dev server"

log_step_start "Health check"
echo "[BUN] Performing health check..."
curl -fsS localhost:3000 >/dev/null
echo "[BUN] Health check passed"
log_step_end "Health check"

start_mini_services

echo "Next.js dev server is running in background (PID: $DEV_PID)."
echo "Use 'kill $DEV_PID' to stop it."
disown "$DEV_PID" 2>/dev/null || true
unset DEV_PID
