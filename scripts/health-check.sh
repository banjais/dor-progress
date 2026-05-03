#!/usr/bin/env bash
# Standalone Post-Deployment Health Check
set -e # Exit on error

BASE_URL="${APP_URL:-https://dor-progress.web.app}"
echo "📡 Running health checks on live endpoints..."
MAX_RETRIES=5          # Total attempts per endpoint
WAIT_SECONDS=10        # Time between retries (gives site more time to 'wake up')
INITIAL_DELAY=5        # Initial sleep to allow CDN propagation
LOCAL_SHA=$(git rev-parse --short HEAD 2>/dev/null || echo "UNKNOWN")

echo "⏳ Waiting ${INITIAL_DELAY}s for global propagation before starting..."
sleep $INITIAL_DELAY

check_live() {
    local URL=$1
    local LABEL=$2
    for ((i=1; i<=MAX_RETRIES; i++)); do
        # Get HTTP status code
        STATUS=$(curl --connect-timeout 5 --max-time 10 -o /dev/null -s -L -w "%{http_code}" "$URL")
        if [ "$STATUS" -eq 200 ]; then
            echo "   ✅ $LABEL is LIVE ($STATUS)"
            return 0
        fi
        echo "   ⚠️  $LABEL check failed ($STATUS). Retrying $i/$MAX_RETRIES in ${WAIT_SECONDS}s..."
        sleep $WAIT_SECONDS
    done
    echo "   ❌ $LABEL is NOT responding as expected after $MAX_RETRIES attempts."
    return 1
}

# Verify both Frontend and Backend
echo "🔍 Checking endpoints via ${BASE_URL}..."
check_live "${BASE_URL}" "Frontend UI"
check_live "${BASE_URL}/api/health" "Backend API (via Proxy)"
check_live "${BASE_URL}/translations.json" "Translations Asset"

if check_live "${BASE_URL}/sw.v2.js" "Service Worker Script"; then
    SW_VERSION=$(curl -s -L "${BASE_URL}/sw.v2.js" | grep "const VERSION =" | head -1 | sed -E "s/.*['\"](.*)['\"].*/\1/")
    echo "      ⭐ Detected SW Version: $SW_VERSION"
    LIVE_SHA=$(curl -s -L "${BASE_URL}/sw.v2.js" | grep "const COMMIT_SHA =" | head -1 | sed -E "s/.*['\"](.*)['\"].*/\1/")
    echo "      🆔 Detected Commit SHA: $LIVE_SHA"

    if [ "$LIVE_SHA" != "$LOCAL_SHA" ] && [ "$LOCAL_SHA" != "UNKNOWN" ]; then
        echo "      ⚠️  Warning: Live SHA ($LIVE_SHA) does not match local SHA ($LOCAL_SHA). Propagation may be delayed."
    fi
fi