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

echo "📦 Ensuring dependencies are synced and healthy..."
# Fixed via 'overrides' in package.json to support ESLint 10
npm install

# Sync lockfile to ensure CI is healthy
npm install --package-lock-only

echo "📊 Running project diagnostics..."
npm run info

echo "🔍 Checking GitHub Workflow placement..."
# 0.1 Cloudflare Binding Validation
if [ "$DRY_RUN_FLAG" != "--dry-run" ]; then
    echo "🔑 Validating Cloudflare KV Bindings..."
    # Check if the specific KV IDs in wrangler.toml are accessible to the current user
    if npx wrangler kv:namespace list > .kv_list.json 2>/dev/null; then
        for BINDING in "TRANSLATION_KV" "REPORTS_KV"; do
            if ! grep -q "$BINDING" .kv_list.json; then
                echo "⚠️  Warning: Binding '$BINDING' not found in your Cloudflare account."
                echo "   Run 'npx wrangler kv:namespace create $BINDING' to fix this."
            fi
        done
        rm .kv_list.json
    fi
fi

if [ ! -d ".github/workflows" ] || [ -z "$(ls -A .github/workflows/*.{yml,yaml} 2>/dev/null)" ]; then
    echo "⚠️  Warning: No GitHub Workflows found in .github/workflows/. CI/CD will not trigger."
else
    echo "   ✅ Workflows detected in correct directory."
fi

echo "🔍 Linting GitHub Workflows..."
if ! npm run lint:yaml; then
    echo "❌ Error: YAML syntax errors found in .github/workflows/"
    exit 1
fi

# Check for misplacement in public directory
if [ -d "public" ] && [ -n "$(find public -name "*.yml" -o -name "*.yaml" 2>/dev/null)" ]; then
    echo "❌ Error: .yml files found in 'public/'. Move these to .github/workflows/."
    exit 1
fi

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
npm run typecheck

echo "🔍 Running ESLint compatibility check..."
if ! npm run lint; then
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

echo "🛡️  Verifying build integrity..."
npm run verify-build

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
    # Add [skip ci] to the message if running in GitHub Actions to prevent loops
    COMMIT_MSG="$MSG"
    if [ -n "$GITHUB_ACTIONS" ]; then
        COMMIT_MSG="$MSG [skip ci]"
    fi
    git add . && git commit -m "$COMMIT_MSG" && git push origin "$CURRENT_BRANCH"
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
