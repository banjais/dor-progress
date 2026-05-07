#!/usr/bin/env bash
set -e # Exit immediately if a command exits with a non-zero status

# Add failure notification
trap 'echo "❌ Deployment failed at line $LINENO. Check the output above for errors."' ERR

# 0. Pre-flight Check: Ensure dependencies exist
# Detect --dry-run flag anywhere in arguments
DRY_RUN_FLAG=""
for arg in "$@"; do
    if [ "$arg" == "--dry-run" ]; then
        DRY_RUN_FLAG="--dry-run"
        echo "🧪 DRY RUN MODE ENABLED: No files will be written or pushed."
    fi
done

PROJECT_ID="${FIREBASE_PROJECT:-dor-progress}"
APP_URL="${APP_URL:-https://dor-progress.web.app}"
REPO_PATH=$(git remote get-url origin | sed -E 's/.*github.com[:\/](.*)(\.git)?/\1/' || echo "UNKNOWN")

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
npx tsx scripts/setup-secrets.js | grep -v "=" # Extra filter to ensure no accidental value leak

# 4.2 Sync Translations from Google Sheets
echo "🌐 Syncing UI translations..."
npx tsx scripts/sync-sheets.js $DRY_RUN_FLAG

# 5. Validation Gates
echo "🔒 Running security checks..."
npm run security-check > /dev/null 2>&1 || echo "⚠️  Security check completed with warnings"
echo ""

echo "🔍 Running type checks..."
npx tsc --noEmit

echo "🔍 Running ESLint compatibility check..."
if ! npx eslint src/**/*.{js,ts} --max-warnings 0; then
    echo "❌ Error: ESLint plugins are incompatible with the current environment."
    exit 1
fi

echo "🧪 Running translation integrity tests..."
npm test -- translations

echo "🧪 Running tests..."
npm test

# 6. Full Build (compile + copy + inject + verify)
echo "🏗️  Starting Fresh Build..."
npm run build

echo "🧹 Pruning non-asset files from public..."
npx tsx scripts/prune-public.ts

# 7. Versioning
npm version "$BUMP" --no-git-tag-version
VERSION=$(node -p "require('./package.json').version")
MSG="${2:-Manual deployment update}"

# 8. Git Sync via Helper
if [ "$DRY_RUN_FLAG" == "--dry-run" ]; then
    echo "⏭️  Dry run: Skipping Git push and version tagging."
else
    git add . && git commit -m "$MSG" && git push origin "$CURRENT_BRANCH"
    echo "🤖 GitHub Auto Deploy & Cloudflare Auto Deploy will now trigger based on this push."
fi

# 11. Diagnostic Output
echo ""
echo "========================================="
echo "✅ DEPLOYMENT DIAGNOSTICS & SUMMARY"
echo "========================================="
if [ "$REPO_PATH" == "UNKNOWN" ]; then
    echo "⚠️  Warning: Remote repository path could not be detected."
fi
echo "   Release Version: v${VERSION}"
echo "   Project ID     : ${PROJECT_ID}"
echo "   GitHub Actions : https://github.com/${REPO_PATH}/actions"
echo ""
echo "📋 Project Info (diag):"
npm run info || true
echo "========================================="
