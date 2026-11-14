#!/usr/bin/env bash
# Builds the downloadable extension zip, pointed at the production API, into site/downloads/.
#   pnpm release              (uses VERITY_DOMAIN from .env)
#   pnpm release verity.example.com
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -f .env ]; then set -a; source .env; set +a; fi
DOMAIN="${1:-${VERITY_DOMAIN:-}}"
if [ -z "$DOMAIN" ]; then
  echo "No domain. Run: pnpm release <domain>, or set VERITY_DOMAIN in .env" >&2
  exit 1
fi

API_URL="https://${DOMAIN}/api"
echo "Building extension for ${API_URL}"
rm -f .output/*-chrome.zip
WXT_API_URL="$API_URL" pnpm exec wxt zip

ZIP=$(ls -t .output/*-chrome.zip | head -1)
mkdir -p site/downloads
cp "$ZIP" site/downloads/verity-extension.zip
echo "-> site/downloads/verity-extension.zip ($(du -h site/downloads/verity-extension.zip | cut -f1))"
