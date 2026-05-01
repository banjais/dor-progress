#!/usr/bin/env bash
set -e # Exit immediately if a command exits with a non-zero status

# 1. Branch Safety Check
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "UNKNOWN")
if [ "$CURRENT_BRANCH" != "main" ]; then
    echo "❌ Error: You must be on the main branch to deploy (current: $CURRENT_BRANCH)."
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
rm -rf dist .wrangler .firebase .build node_modules/.cache

# 4. Load local secrets for validation
if [ -f .dev.vars ]; then
    echo "ℹ️ Loading local secrets from .dev.vars for validation..."
    while IFS= read -r line || [ -n "$line" ]; do
        line="${line//$'\r'/}"
        if [[ "$line" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]]; then
            export "$line"
        fi
    done < .dev.vars
fi

# 5. Validation Gates
echo "🔒 Running security checks..."
npm run security-check || echo "⚠️  Security check failed (non-blocking – see report above)"
echo ""

echo "🔍 Running type checks..."
npm run lint

echo "🧪 Running tests..."
npm test

# 6. Full Build (compile + copy + inject + verify)
echo "🏗️  Rebuilding project completely..."
npm run build

# 7. Real-Time Local Deployment
echo "🔥 Deploying to Firebase Hosting..."
npx firebase deploy --only hosting --project dor-progress --force --public .build

echo "☁️ Deploying to Cloudflare Workers (Wrangler)..."
npx wrangler deploy

# 8. Versioning
npm version "$BUMP" --no-git-tag-version
VERSION=$(node -p "require('./package.json').version")
MSG="${2:-Manual deployment update}"

# 9. Git Sync (Comparing Local is Source)
echo "📤 Committing Local source changes and Pushing v${VERSION} to GitHub..."
git add .
git commit -m "v${VERSION}: ${MSG} (Local deployed version matching source)"
git tag -a "v${VERSION}" -m "Release v${VERSION}"
git push origin main --follow-tags

# 10. CI/CD Auto-Deploy triggers
echo "🤖 GitHub Auto Deploy & Cloudflare Auto Deploy will now trigger based on this push."

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
