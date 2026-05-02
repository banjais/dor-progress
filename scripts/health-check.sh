#!/usr/bin/env bash
# Standalone Post-Deployment Health Check

BASE_URL="${APP_URL:-https://dor-progress.web.app}"
echo "📡 Running health checks on live endpoints..."
MAX_RETRIES=3
WAIT_SECONDS=5

check_live() {
    local URL=$1
    local LABEL=$2
    for ((i=1; i<=MAX_RETRIES; i++)); do
        # Get HTTP status code
        STATUS=$(curl -o /dev/null -s -L -w "%{http_code}" "$URL")
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
check_live "${BASE_URL}" "Frontend UI" || true
check_live "${BASE_URL}/api/health" "Backend API (via Proxy)" || true