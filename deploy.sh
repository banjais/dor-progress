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

# 3. Clean build artifacts
echo "🧹 Cleaning build artifacts..."
rm -rf dist .wrangler .firebase

# 4. Load local secrets for validation
if [ -f .dev.vars ]; then
    echo "ℹ️ Loading local secrets from .dev.vars for validation..."
    while IFS= read -r line || [ -n "$line" ]; do
        if [[ "$line" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]]; then
            export "$line"
        fi
    done < .dev.vars
fi

# 5. Validation Gates
echo "🔒 Running security checks..."
npm run security-check

echo "🔍 Running type checks..."
npm run lint

echo "🧪 Running tests..."
npm test

# 6. Build Worker (TypeScript → dist/)
echo "🏗️  Building Worker..."
npm run compile

# 7. Local Deploy to Cloudflare (shows logs in terminal)
echo "🚀 Deploying to Cloudflare Workers..."
npx wrangler deploy --outdir=dist

# 8. Versioning
npm version "$BUMP" --no-git-tag-version
VERSION=$(node -p "require('./package.json').version")

# 9. Commit message
MSG="${2:-Deploy v$VERSION}"

# 10. Git Sync
echo "📤 Pushing to GitHub..."
git add .
git commit -m "v${VERSION}: $MSG"
git tag -a "v${VERSION}" -m "Release v${VERSION}"
git push origin main --follow-tags

# 11. Done
echo ""
echo "✅ Deploy complete!"
echo "   Version: v${VERSION}"
echo "   📊 Actions: https://github.com/$(basename "$(git remote get-url origin)" .git)/actions"
