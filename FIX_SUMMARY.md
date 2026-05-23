# Project Configuration & Pipeline Improvements

This document summarizes the recent updates made to stabilize, automate, and clean up the deployment pipeline and branding resources.

## 1. CI/CD Pipeline Modernization (GitHub Actions)
The Build and Deploy workflow in `.github/workflows/deploy.yml` has been restructured into **five distinct, sequential jobs** to improve visual status reporting and gate-keeping in GitHub:
1. **Validate Secrets:** Ensures that deployment secrets (`FIREBASE_SERVICE_ACCOUNT` and `CLOUDFLARE_API_TOKEN`) exist and that the Firebase service account JSON is valid.
2. **Lint & Typecheck:** Runs ESLint and the TypeScript compiler checks for both the frontend and Cloudflare worker.
3. **Security Audit:** Runs `scripts/audit-check.js` to ensure zero vulnerabilities before continuing.
4. **Build Frontend:** Verifies that `npm run build` compiles successfully.
5. **Deploy Production:** Executes the custom orchestration script `scripts/deploy.js` to trigger version bumping, production build compiling, final hosting/worker deployments, and Git release synchronization.

*Note: Added a `SKIP_PRE_DEPLOY_CHECKS` flag to the deploy script. When running in the final deploy job under CI, it bypasses redundant checks that have already passed in the earlier jobs.*

## 2. Branding Resource Synchronization
Previously, there were four different `branding.json` files in the repository which had diverged or were ignored:
- `config/branding.json` (Updated by script, but never read by frontend)
- `public/branding.json` (Read by frontend, but never updated by script)
- `src/branding.json` (Imported by BrandingEngine, but never updated by script)
- `branding.json` (Root duplicate, never updated or read)

**Fixes Applied:**
* Updated `src/components/BrandingEngine.ts` to import `public/branding.json` instead of the local duplicate.
* Refactored `scripts/update-version.js` to write version changes, commit hashes, and build timestamps to **all four copies** automatically. This keeps every file perfectly in sync and ensures the live dashboard matches the deployed release.

## 3. Deployment Branch Resolution (Git Sync)
Resolved a bug in `scripts/deploy.js` where running `npm run deploy` locally would fallback to pushing to a remote branch named `local` on origin. It now dynamically checks your current branch name using `git rev-parse --abbrev-ref HEAD`.

## 4. Entrypoint Exports
* Added `export * from './types';` to the empty entrypoint `shared/index.ts` so it acts as a proper exports manager.
* Updated wrangler backup configuration (`wrangler.toml.bak`) and production environment overrides (`src/.env.production`) to remain accurate.