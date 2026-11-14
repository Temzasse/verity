#!/usr/bin/env bash
# Resets the deployed server's cache: cached analyses and fact-checks, reader votes, feedback and the
# landing-page stats. Keeps spend.json so the daily budget cap keeps counting.
# A backup goes to /opt/verity/cache-backup/<timestamp> on the VPS first.
#   pnpm reset:vps          (asks for confirmation)
#   pnpm reset:vps --yes    (no prompt)
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -f .env ]; then set -a; source .env; set +a; fi
: "${VPS_HOST:?Set VPS_HOST in .env, e.g. root@203.0.113.10}"
VPS_DIR="${VPS_DIR:-/opt/verity}"
CONTAINER="${VERITY_CONTAINER:-verity-server-1}"

if [ "${1:-}" != "--yes" ]; then
  read -r -p "Reset the production cache, votes and stats on $VPS_HOST? [y/N] " answer
  [[ "$answer" =~ ^[Yy]$ ]] || { echo "Cancelled."; exit 1; }
fi

ssh "$VPS_HOST" "VPS_DIR='$VPS_DIR' CONTAINER='$CONTAINER' bash -s" <<'REMOTE'
set -euo pipefail
cache=$(docker exec "$CONTAINER" sh -c 'cd server/.cache && pwd')
backup="$VPS_DIR/cache-backup/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$backup"
docker cp "$CONTAINER:$cache/." "$backup/"
echo "Backup: $backup ($(ls "$backup" | wc -l | tr -d ' ') files)"
docker exec "$CONTAINER" sh -c 'cd server/.cache && find . -maxdepth 1 -type f ! -name spend.json -delete'
# Votes and stats are held in memory too, so restart to start from the empty files.
docker restart "$CONTAINER" >/dev/null
echo "Cache cleared and server restarted."
REMOTE

if [ -n "${VERITY_DOMAIN:-}" ]; then
  sleep 3
  curl -fsS "https://$VERITY_DOMAIN/api/stats" && echo
fi
