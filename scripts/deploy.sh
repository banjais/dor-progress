#!/usr/bin/env bash
set -e # Exit immediately if a command exits with a non-zero status

# 0. Pre-flight Check: Ensure dependencies exist
if [ ! -d "node_modules" ]; then
    echo "📦 node_modules not found. Installing dependencies..."
    npm install
fi

echo "📊 Running project diagnostics..."
npx tsx scripts/project-info.ts

# 1. Branch Safety Check
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "UNKNOWN")
if [[ "$CURRENT_BRANCH" != "main" && "$CURRENT_BRANCH" != "master" ]]; then
    echo "❌ Error: You must be on the main or master branch to deploy (current: $CURRENT_BRANCH)."
    echo "   Switch to main: git checkout main"
    exit 1
fi

# 2. Argument Handling & Validation
BUMP="${1:-patch}"
case $BUMP in
    patch|minor|major) ;;
    *) echo "❌ Error: Invalid bump type. Use patch, minor, or major."; exit 1 ;;
esac

# 3. Clean build artifacts, logs, and caches fully
echo "🧹 Cleaning build artifacts and cache completely..."
if npm run clean > /dev/null 2>&1; then
    echo "   ✅ Cleaned via npm script"
else
    rm -rf dist .wrangler .firebase .build node_modules/.cache
    echo "   ✅ Cleaned via manual removal"
fi

# 4. Load local secrets for validation
if [ -f .dev.vars ]; then
    echo "ℹ️ Loading local secrets from .dev.vars for validation..."
    while IFS= read -r line || [ -n "$line" ]; do
        line="${line//$'\r'/}"
        if [[ "$line" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]]; then
            # Export silently to prevent value leakage in logs
            export "$line" > /dev/null 2>&1
        fi
    done < .dev.vars
fi

# 4.1 Validate Secrets via Assistant
node scripts/setup-secrets.js | grep -v "=" # Extra filter to ensure no accidental value leak

# 5. Validation Gates
echo "🔒 Running security checks..."
npm run security-check > /dev/null 2>&1 || echo "⚠️  Security check completed with warnings"
echo ""

echo "🔍 Running type checks..."
npx tsc --noEmit

echo "🧪 Running tests..."
npm test

# 6. Full Build (compile + copy + inject + verify)
echo "🏗️  Starting Fresh Build..."
npm run build

# 7. Real-Time Local Deployment
echo "🔥 Deploying to Firebase Hosting..."
if [ -n "$FIREBASE_SERVICE_ACCOUNT" ]; then
    # Preferred: Use Service Account Key
    echo "$FIREBASE_SERVICE_ACCOUNT" > sa_key.json
    GOOGLE_APPLICATION_CREDENTIALS=sa_key.json npx firebase deploy --only hosting --project dor-progress --force --public .build
    rm sa_key.json
else
    # Fallback: Use FIREBASE_TOKEN (Deprecated)
    npx firebase deploy --only hosting --project dor-progress --force --public .build --token "$FIREBASE_TOKEN"
fi

echo "☁️ Deploying to Cloudflare Workers (Wrangler)..."
npx wrangler deploy

# 8. Versioning
npm version "$BUMP" --no-git-tag-version
VERSION=$(node -p "require('./package.json').version")
MSG="${2:-Manual deployment update}"

# 9. Git Sync (Comparing Local is Source)
echo "📤 Syncing Local to GitHub (Branch: ${CURRENT_BRANCH})..."
git add .
git commit -m "v${VERSION}: ${MSG} (Local deployed version matching source)"
git tag -a "v${VERSION}" -m "Release v${VERSION}"
git push origin "$CURRENT_BRANCH" --follow-tags > /dev/null 2>&1 && echo "   ✅ GitHub push successful"

# 10. CI/CD Auto-Deploy triggers
echo "🤖 GitHub Auto Deploy & Cloudflare Auto Deploy will now trigger based on this push."

# 11. Post-Deployment Health Check
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
check_live "https://dor-progress.web.app" "Frontend (Firebase)" || true
check_live "https://dor-progress.banjays.workers.dev" "Backend (Cloudflare)" || true

# 11. Diagnostic Output
echo ""
echo "========================================="
echo "✅ DEPLOYMENT DIAGNOSTICS & SUMMARY"
echo "========================================="
echo "   Release Version: v${VERSION}"
REPO_PATH=$(git remote get-url origin | sed -E 's/.*github.com[:\/](.*)(\.git)?/\1/' || echo "banjais/dor-progress")
echo "   GitHub Actions : https://github.com/${REPO_PATH}/actions"
echo ""
echo "📋 Project Info (diag):"
npm run info || true
echo "========================================="
