#!/usr/bin/env bash
set -e # Exit immediately if a command exits with a non-zero status

# 1. Branch Safety Check
CURRENT_BRANCH=$(git branch --show-current)
if [ "$CURRENT_BRANCH" != "main" ]; then
    echo "❌ Error: You must be on the main branch to deploy (current: $CURRENT_BRANCH)."
    exit 1
fi

# 2. Argument Handling & Validation
BUMP="${1:-patch}"
case $BUMP in
    patch|minor|major) ;;
    *) echo "❌ Error: Invalid bump type. Use patch, minor, or major."; exit 1 ;;
esac

# Load local secrets for testing if they exist (.dev.vars is the Wrangler standard)
if [ -f .dev.vars ]; then
    echo "ℹ️ Loading local secrets from .dev.vars for validation..."
    while IFS= read -r line || [ -n "$line" ]; do
        if [[ "$line" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]]; then # Only export lines that look like KEY=VALUE
            export "$line"
        fi
    done < .dev.vars
fi

# 3. Validation Gates
npm run security-check
npm run lint
npm run test

# 4. Versioning
npm version "$BUMP" --no-git-tag-version
VERSION=$(node -p "require('./package.json').version")

# Auto-generate commit message if not provided
MSG="${2:-Deploy v$VERSION}"

# 5. Git Sync
git add .
git commit -m "v$VERSION: $MSG"
git tag -a "v$VERSION" -m "Release v$VERSION"
git push origin main --follow-tags

# 6. Real-time Monitoring
echo "🚀 Deployment triggered for v$VERSION!"
echo "📊 Monitor: https://github.com/$(basename "$(git remote get-url origin)" .git)/actions"