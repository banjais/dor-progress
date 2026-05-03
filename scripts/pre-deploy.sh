#!/bin/bash

# Exit immediately if a command exits with a non-zero status.
set -e

echo "🚀 Starting Pre-deployment Verification..."
echo "=========================================="

# 1. Validate Secrets (Hard fail if missing)
echo "🔑 Step 1: Validating Secrets..."
pnpm exec tsx scripts/setup-secrets.js

# 2. Sync & Fix Translations (The Auto-Fix)
echo -e "\n🌐 Step 2: Syncing and Fixing Translations from Sheets..."
pnpm exec tsx scripts/sync-sheets.js

# 3. Run Translation & Integrity Tests
echo -e "\n🧪 Step 3: Running Translation Integrity Tests..."
pnpm exec vitest run scripts/translations.test.ts --run

# 4. Verify Genkit Registry (Tools and Flows)
echo -e "\n🤖 Step 4: Verifying AI Registry..."
pnpm exec tsx scripts/index.ts

# 5. Prune Public Directory (Cleanup non-production assets)
echo -e "\n🧹 Step 5: Pruning Public Directory..."
pnpm exec tsx scripts/prune-public.ts

# 6. Project Summary & Final Checks
echo -e "\n📊 Step 6: Final Project Status..."
pnpm exec tsx scripts/project-info.ts

echo "=========================================="
echo -e "✅ PRE-DEPLOYMENT CHECKS PASSED. Ready for deployment!"