#!/usr/bin/env bash
#
# Smoke test for a deployed web-explorer instance.
# Usage: ./scripts/smoke-test.sh <base-url> [--deep]
#
# Without --deep: checks infrastructure (health, frontend, WebSocket connect).
# With --deep: also waits for a live card from the exploration loop (~60s).
#
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: $0 <base-url> [--deep]"
  echo "Example: $0 https://web-explorer.your-account.workers.dev"
  echo "         $0 https://web-explorer.your-account.workers.dev --deep"
  exit 1
fi

BASE_URL="${1%/}"
DEEP=false
[ "${2:-}" = "--deep" ] && DEEP=true

PASS=0
FAIL=0

pass() { echo "  ✓ $1"; PASS=$((PASS + 1)); }
fail() { echo "  ✗ $1"; FAIL=$((FAIL + 1)); }

echo "Smoke testing: $BASE_URL"
[ "$DEEP" = true ] && echo "(deep mode: will wait for live card)"
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

# 5. Deep check: wait for a live card from the exploration loop
if [ "$DEEP" = true ]; then
  echo "5. Exploration produces cards"
  CARD_RESULT=$(node -e "
const ws = new WebSocket('${WS_URL}/api/stream');
const timeout = setTimeout(() => { console.log('timeout'); process.exit(1); }, 60000);
let historyDone = false;
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.event === 'history-end') {
    historyDone = true;
    return;
  }
  if (msg.event === 'error') {
    console.log('error:' + (msg.data?.message || 'unknown'));
    clearTimeout(timeout);
    ws.close();
    return;
  }
  if (msg.event === 'card' && historyDone) {
    console.log('ok:live-card:' + (msg.data?.title || '').slice(0, 60));
    clearTimeout(timeout);
    ws.close();
  }
};
ws.onerror = () => { console.log('ws-error'); clearTimeout(timeout); process.exit(1); };
ws.onclose = () => process.exit(0);
" 2>/dev/null || true)

  if echo "$CARD_RESULT" | grep -q "ok:live-card"; then
    CARD_TITLE=$(echo "$CARD_RESULT" | grep "ok:live-card" | sed 's/ok:live-card://')
    pass "Exploration produced a live card: $CARD_TITLE"
  elif echo "$CARD_RESULT" | grep -q "^error:"; then
    ERROR_MSG=$(echo "$CARD_RESULT" | grep "^error:" | sed 's/^error://')
    fail "Exploration error: $ERROR_MSG"
  else
    fail "No live card received within 60s (got: $CARD_RESULT)"
  fi
fi

echo
echo "Results: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
