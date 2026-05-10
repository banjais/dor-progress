---
name: firebase-master
description: Consolidated Project Logic for Firestore, AI, and Hosting
---

# Project Master Skill: Firebase & AI

## 1. Firestore & Security
- **Default Deny**: All rules start with `allow read, write: if false;`.
- **Validator Pattern**: Use `isValidUser(data)` functions in rules for both `create` and `update`.
- **Index Management**: Standard mode uses auto-indexing; Enterprise requires manual `firestore.indexes.json` updates.

## 2. AI Logic (Gemini 2.5+)
- **Models**: Strictly use `gemini-2.5-flash` or higher.
- **Integration**: Use `generateContentStream` for streaming and mandatory **App Check** for security.

## 3. Firebase Hosting
- **Public Dir**: Always points to `dist/`.
- **Deployment**: Handled via `scripts/deploy.sh` which runs `wrangler` and `firebase` CLI.

## 4. Deployment Flow
1. Clean build artifacts.
2. Sync translations/sheets.
3. Inject `package.json` version into `src/sw.v2.js`.
4. `npm run build` (Vite).
5. `wrangler deploy` (Cloudflare).