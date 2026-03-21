#!/usr/bin/env bash
#
# Smoke test for a deployed web-explorer instance.
# Usage: ./scripts/smoke-test.sh https://web-explorer.<subdomain>.workers.dev
#
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: $0 <base-url>"
  echo "Example: $0 https://web-explorer.your-account.workers.dev"
  exit 1
fi

BASE_URL="${1%/}"
PASS=0
FAIL=0

pass() { echo "  ✓ $1"; PASS=$((PASS + 1)); }
fail() { echo "  ✗ $1"; FAIL=$((FAIL + 1)); }

echo "Smoke testing: $BASE_URL"
echo

# 1. Health endpoint
echo "1. Health endpoint"
HEALTH=$(curl -sf "$BASE_URL/api/health" 2>/dev/null || true)
if echo "$HEALTH" | grep -q '"ok":true'; then
  pass "/api/health returns ok"
else
  fail "/api/health did not return ok (got: $HEALTH)"
fi

# 2. Frontend serves HTML
echo "2. Frontend"
FRONTEND=$(curl -sf "$BASE_URL" 2>/dev/null || true)
if echo "$FRONTEND" | grep -q '</html>'; then
  pass "Root URL returns HTML"
else
  fail "Root URL did not return HTML"
fi

# 3. WebSocket upgrade is available (should return 426 without Upgrade header)
echo "3. WebSocket endpoint"
HTTP_CODE=$(curl -sf -o /dev/null -w "%{http_code}" "$BASE_URL/api/stream" 2>/dev/null || true)
if [ "$HTTP_CODE" = "426" ]; then
  pass "/api/stream returns 426 without Upgrade header (correct)"
else
  fail "/api/stream returned $HTTP_CODE (expected 426)"
fi

# 4. WebSocket connects and receives history-end
echo "4. WebSocket connection"
WS_URL="${BASE_URL/https:/wss:}"
WS_URL="${WS_URL/http:/ws:}"

WS_RESULT=$(node -e "
const ws = new WebSocket('${WS_URL}/api/stream');
const timeout = setTimeout(() => { console.log('timeout'); process.exit(1); }, 15000);
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.event === 'history-end') {
    console.log('ok:history-end');
    clearTimeout(timeout);
    ws.close();
  } else if (msg.event === 'card') {
    console.log('ok:card');
  }
};
ws.onerror = (e) => { console.log('error'); clearTimeout(timeout); process.exit(1); };
ws.onclose = () => process.exit(0);
" 2>/dev/null || true)

if echo "$WS_RESULT" | grep -q "ok:history-end"; then
  pass "WebSocket connects and receives history-end"
else
  fail "WebSocket did not receive history-end (got: $WS_RESULT)"
fi

if echo "$WS_RESULT" | grep -q "ok:card"; then
  pass "WebSocket received card events from history replay"
else
  echo "  - No cards in history (expected on first deploy)"
fi

echo
echo "Results: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
