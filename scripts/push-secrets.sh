#!/usr/bin/env bash
#
# Push secrets from .dev.vars to Cloudflare Workers production.
# Requires CLOUDFLARE_API_TOKEN in environment or wrangler login.
#
# Usage: ./scripts/push-secrets.sh
#
set -euo pipefail

WORKER_DIR="$(cd "$(dirname "$0")/../apps/worker" && pwd)"
DEV_VARS="$WORKER_DIR/.dev.vars"

if [ ! -f "$DEV_VARS" ]; then
  echo "Error: $DEV_VARS not found. Create it from .dev.vars.example first."
  exit 1
fi

echo "Pushing secrets from $DEV_VARS to Cloudflare Workers..."
echo

# Read each KEY=VALUE line (skip comments and blank lines)
while IFS='=' read -r key value; do
  # Skip comments and empty lines
  [[ -z "$key" || "$key" =~ ^# ]] && continue
  # Trim whitespace
  key=$(echo "$key" | xargs)
  value=$(echo "$value" | xargs)

  echo "  Setting $key..."
  echo "$value" | npx wrangler secret put "$key" --config "$WORKER_DIR/wrangler.jsonc" 2>&1 | grep -v "^$"
done < "$DEV_VARS"

echo
echo "Done. Secrets are live after the next request to the worker."
echo
echo "Verify with: ./scripts/smoke-test.sh https://web-explorer.juanibiapina.workers.dev --deep"
