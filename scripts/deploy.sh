#!/usr/bin/env bash
# Deploys the landing page + analysis server to the Hostinger VPS over SSH.
# Needs in .env: VERITY_DOMAIN (e.g. verity.example.com) and VPS_HOST (e.g. root@203.0.113.10).
# The VPS needs Docker (Hostinger's Docker template has it) and the domain's A record pointing at it.
#   pnpm deploy:vps
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -f .env ]; then set -a; source .env; set +a; fi
: "${VERITY_DOMAIN:?Set VERITY_DOMAIN in .env}"
: "${VPS_HOST:?Set VPS_HOST in .env, e.g. root@203.0.113.10}"
VPS_DIR="${VPS_DIR:-/opt/verity}"

# 1. Extension zip for the download button, pointed at this domain
bash scripts/release.sh "$VERITY_DOMAIN"

# 2. Copy application files; keep Hostinger's managed environment on the VPS.
ssh "$VPS_HOST" "mkdir -p '$VPS_DIR/utils'"
# One rsync per folder: macOS's openrsync doesn't apply --delete with -R, so removed files would linger.
for dir in server site deploy; do
  rsync -az --delete --exclude '.cache' --exclude '.env' "$dir/" "$VPS_HOST:$VPS_DIR/$dir/"
done
rsync -az utils/analysis.ts "$VPS_HOST:$VPS_DIR/utils/"
rsync -az docker-compose.yml "$VPS_HOST:$VPS_DIR/"
# Only bootstrap a missing project file. Never replace Docker Manager's saved keys/settings.
ssh "$VPS_HOST" "if [ ! -f '$VPS_DIR/.env' ]; then umask 077; printf 'VERITY_DOMAIN=%s\nVERITY_ALIASES=%s\n' '$VERITY_DOMAIN' '${VERITY_ALIASES:-}' > '$VPS_DIR/.env'; fi; chmod 600 '$VPS_DIR/.env'; if [ -f '$VPS_DIR/server/.env' ]; then chmod 600 '$VPS_DIR/server/.env'; fi"

# 3. Build and (re)start the containers
ssh "$VPS_HOST" bash -s -- "$VPS_DIR" <<'REMOTE'
set -euo pipefail
cd "$1"
# Keep existing file-based deployments working, with Docker Manager's settings taking precedence.
env_args=()
if [ -f server/.env ]; then env_args+=(--env-file server/.env); fi
env_args+=(--env-file .env)
docker compose "${env_args[@]}" up -d --build --remove-orphans
docker compose "${env_args[@]}" ps
REMOTE

echo
echo "Deployed: https://${VERITY_DOMAIN}  (API: https://${VERITY_DOMAIN}/api/health)"
