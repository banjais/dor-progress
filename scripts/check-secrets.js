#!/usr/bin/env node

/**
 * Secrets Status Checker
 * Verifies which secrets are configured locally and in GitHub
 */

import fs from "fs";
import path from "path";

console.log("\n🔐 SECRETS STATUS CHECK\n");
console.log("═".repeat(60));
const PROJECT_ID = "dor-progress";

// Check .dev.vars
const devVarsPath = path.resolve(process.cwd(), ".dev.vars");
console.log("\n📁 Local (.dev.vars):");
let discoveredKeys = [];

if (fs.existsSync(devVarsPath)) {
  const content = fs.readFileSync(devVarsPath, "utf8");
  discoveredKeys = content
    .split("\n")
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => l.split("=")[0].trim());

  console.log(`  ✅ Found ${discoveredKeys.length} keys in .dev.vars`);
} else {
  console.log("  ❌ .dev.vars file not found");
}

console.log("\n☁️  Cloudflare (wrangler secret list):");
try {
  const { execSync } = await import("child_process");
  const output = execSync("wrangler secret list --format json", {
    encoding: "utf8",
  });
  const secrets = JSON.parse(output);
  const secretNames = secrets.map((s) => s.name);

  const cfExclusions = [
    "FIREBASE_TOKEN",
    "FIREBASE_SERVICE_ACCOUNT",
    "CLOUDFLARE_API_TOKEN",
  ];
  for (const secret of discoveredKeys.filter(
    (k) => !cfExclusions.includes(k),
  )) {
    const status = secretNames.includes(secret) ? "✅" : "  ❓";
    console.log(`  ${status} ${secret}`);
  }
} catch (_e) {
  console.log(
    "  ⚠️  Could not fetch (wrangler not authenticated or no secrets)",
  );
}

console.log(`\n🔥 Firebase (project: ${PROJECT_ID}):`);
const hasSA = discoveredKeys.includes("FIREBASE_SERVICE_ACCOUNT");
if (hasSA && fs.existsSync(devVarsPath)) {
  const saValue = fs
    .readFileSync(devVarsPath, "utf8")
    .split("\n")
    .find((l) => l.startsWith("FIREBASE_SERVICE_ACCOUNT="))
    ?.split("=")[1]
    ?.trim();

  try {
    const parsed = JSON.parse(saValue.replace(/^["']|["']$/g, ""));
    console.log(
      `  ✅ Using FIREBASE_SERVICE_ACCOUNT (Valid JSON for ${parsed.project_id})`,
    );
  } catch (_e) {
    console.log("  ❌ FIREBASE_SERVICE_ACCOUNT is NOT valid JSON");
  }
}
// These are set in Firebase console, not via CLI
console.log("  ℹ️  Configured in Firebase Console → Project Settings:");
console.log("     FIREBASE_API_KEY");
console.log("     FIREBASE_PROJECT_ID");
console.log("     FIREBASE_PROJECT_NUMBER");
console.log("     FIREBASE_AUTH_DOMAIN");
console.log("     FIREBASE_STORAGE_BUCKET");
console.log("     FIREBASE_MESSAGING_SENDER_ID");
console.log("     FIREBASE_APP_ID");
console.log("     FIREBASE_MEASUREMENT_ID");
console.log(
  "  ℹ️  Also set in Cloudflare Worker env vars (for /api/client-config)",
);

console.log("\n🔗 GitHub Actions Secrets:");
console.log(
  "  Set in: Repository → Settings → Secrets and variables → Actions",
);
console.log("  Mapped from .dev.vars:");
for (const secret of discoveredKeys) {
  console.log(`    ✅ ${secret}`);
}

console.log("\n" + "═".repeat(60));
console.log("\n📝 Quick Setup:\n");
console.log("1. Local dev (.dev.vars):");
console.log("   cp .env.example .dev.vars  # then fill in values\n");
console.log("2. Cloudflare secrets:");
console.log("   wrangler secret put CLOUDFLARE_API_TOKEN\n");
console.log("3. GitHub Actions secrets:");
console.log("   gh secret set CLOUDFLARE_API_TOKEN\n");
console.log("\n");
