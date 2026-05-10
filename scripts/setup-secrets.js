#!/usr/bin/env npx tsx

/**
 * Secrets Setup Helper
 * Helps configure required secrets for local development and CI/CD
 */

import fs from "fs";
import path from "path";
import { execSync } from "child_process";

console.log("\n🔧 SECRETS SETUP ASSISTANT\n");
const PROJECT_ID = "dor-progress";
console.log("═".repeat(60));

// Check .dev.vars
const devVarsPath = path.resolve(process.cwd(), ".dev.vars");
// Define core required secrets for CI validation if .dev.vars is missing
const REQUIRED_SECRETS = [
  "CLOUDFLARE_API_TOKEN",
  "PUBLISHED_SHEET_ID",
  "FIREBASE_SERVICE_ACCOUNT",
  "RECAPTCHA_SITE_KEY",
];

// Purpose map for "Why" explanation
const SECRET_PURPOSES = {
  CLOUDFLARE_API_TOKEN: "Deployment of Cloudflare Workers and API management.",
  FIREBASE_TOKEN: `Legacy authentication for ${PROJECT_ID}. (Service Account preferred).`,
  FIREBASE_SERVICE_ACCOUNT: `Service Account JSON for ${PROJECT_ID} (Hosting & Firestore Rules).`,
  PUBLISHED_SHEET_ID:
    "Accessing Google Sheets for UI translation synchronization.",
  API_BASE_URL: "Connecting the Frontend to the correct Backend environment.",
};

let activeSecretNames = [...REQUIRED_SECRETS];
let missingCount = 0;
const summaryResults = [];

/**
 * Writes a formatted table to GitHub Job Summary
 */
const writeGithubSummary = (results) => {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;

  let markdown = "### 🔐 Secrets Validation Report\n\n";
  markdown += "| Status | Secret Name | Description / Why |\n";
  markdown += "| :---: | :--- | :--- |\n";

  results.forEach((res) => {
    const statusIcon = res.icon || (res.passed ? "✅" : "❌");
    const description =
      SECRET_PURPOSES[res.name] || "Required for application runtime/build.";
    markdown += `| ${statusIcon} | \`${res.name}\` | ${description} |\n`;
  });

  fs.appendFileSync(summaryPath, markdown);
};

console.log("\n1️⃣  Local Development (.dev.vars)\n");
if (fs.existsSync(devVarsPath)) {
  console.log("   ✅ .dev.vars exists");
  const content = fs.readFileSync(devVarsPath, "utf8");
  const vars = content
    .split("\n")
    .filter((l) => l && !l.startsWith("#") && l.includes("="));

  // Merge unique secret names found in local vars
  const foundNames = vars.map((l) => l.split("=")[0].trim());
  activeSecretNames = Array.from(
    new Set([...activeSecretNames, ...foundNames]),
  );

  console.log("   Status: (Values masked for security)");
  activeSecretNames.forEach((name) => console.log(`     ✅ ${name}`));
} else {
  console.log("   ❌ .dev.vars not found");
  if (!process.env.GITHUB_ACTIONS) {
    console.log("   Please create .dev.vars with your secrets first.");
  }
  console.log("   (Using required core list for CI validation)");
}

// Cloudflare Wrangler secrets
console.log("\n2️⃣  Cloudflare Worker Secrets\n");
console.log("   These are set via: wrangler secret put <NAME>");
console.log("   Status in current environment:\n");
try {
  const nullRedirect = process.platform === 'win32' ? '2>nul' : '2>/dev/null';
  const output = execSync(`wrangler secret list --format json ${nullRedirect}`, {
    encoding: "utf8",
  });
  const secrets = JSON.parse(output);
  console.log(
    `   ✅ Connected to Cloudflare (${Array.isArray(secrets) ? secrets.length : 0} secrets)`,
  );
  // Exclude deployment-only tokens from worker runtime check
  const runtimeExclusions = [
    "FIREBASE_TOKEN",
    "FIREBASE_SERVICE_ACCOUNT",
    "CLOUDFLARE_API_TOKEN",
  ];

  // Filter keys: must be in active list AND not excluded
  const runtimeChecklist = activeSecretNames.filter(
    (k) => !runtimeExclusions.includes(k),
  );

  // Add a special check: If neither Firebase credential exists, add one to the checklist for visibility
  const hasFirebaseCred = activeSecretNames.some((k) =>
    ["FIREBASE_TOKEN", "FIREBASE_SERVICE_ACCOUNT"].includes(k),
  );
  if (!hasFirebaseCred) {
    console.log("     ❌ MISSING: FIREBASE_SERVICE_ACCOUNT or FIREBASE_TOKEN");
  }

  for (const s of runtimeChecklist) {
    const found = secrets.find((ss) => ss.name === s);
    console.log(`     ${found ? "✅" : "❌"} ${s}`);
  }
} catch (_e) {
  console.log("   ⚠️  Not authenticated or no secrets set");
  console.log("   Run: wrangler secret put CLOUDFLARE_API_TOKEN");
}

// GitHub Actions secrets
console.log("\n3️⃣  GitHub Actions Secrets\n");
console.log("   Set via: gh secret set <NAME>");
console.log(
  "   Or via GitHub UI: Settings → Secrets and variables → Actions\n",
);
console.log("   Status in current environment (as passed to CI step):");

for (const secret of activeSecretNames) {
  let value = process.env[secret];
  let isSet = !!value;
  let statusIcon = isSet ? "✅" : "❌";
  let validationError = "";

  // Verification: Ensures the environment variable is a valid JSON and contains key fields
  if (isSet && secret === "FIREBASE_SERVICE_ACCOUNT") {
    try {
      const parsed = JSON.parse(value);
      if (!parsed.project_id || !parsed.private_key) {
        statusIcon = "⚠️";
        validationError = " (JSON missing project_id or private_key)";
      } else {
        statusIcon = "✅";
      }
    } catch (_e) {
      isSet = false;
      statusIcon = "❌";
      validationError = " (Invalid JSON format)";
    }
  }

  // Alternative logic: Only one Firebase credential (Token or Service Account) is required
  if (
    !isSet &&
    !validationError &&
    (secret === "FIREBASE_TOKEN" || secret === "FIREBASE_SERVICE_ACCOUNT")
  ) {
    const alt =
      secret === "FIREBASE_TOKEN"
        ? "FIREBASE_SERVICE_ACCOUNT"
        : "FIREBASE_TOKEN";
    if (process.env[alt]) {
      isSet = true;
      statusIcon = "💡"; // Mark as satisfied by alternative
    }
  }

  if (!isSet) missingCount++;
  summaryResults.push({ name: secret, passed: isSet, icon: statusIcon });
  console.log(`     ${statusIcon} ${secret}${validationError}`);
}

if (process.env.GITHUB_ACTIONS) writeGithubSummary(summaryResults);

if (missingCount > 0 && process.env.GITHUB_ACTIONS) {
  // GitHub Actions Annotation: Creates the "Reason" visible in the UI summary
  console.error(
    `\n::error title=Secrets Validation Failed::${missingCount} required secrets are missing from the environment.`,
  );
  console.error(
    "Check your GitHub Repository Settings > Secrets > Actions mapping.",
  );

  // Hard error to fail the job
  process.exit(1);
}

// Firebase config
console.log("\n4️⃣  Firebase Configuration\n");
console.log("   These are in Cloudflare Worker env (not GitHub):");
console.log("   (fetched via /api/client-config endpoint)\n");
const firebaseKeys = [
  "FIREBASE_API_KEY",
  "FIREBASE_PROJECT_ID",
  "FIREBASE_PROJECT_NUMBER",
  "FIREBASE_AUTH_DOMAIN",
  "FIREBASE_STORAGE_BUCKET",
  "FIREBASE_MESSAGING_SENDER_ID",
  "FIREBASE_APP_ID",
  "FIREBASE_MEASUREMENT_ID",
  "RECAPTCHA_SITE_KEY",
];
for (const key of firebaseKeys) {
  console.log(`     • ${key}`);
}

// 5️⃣ Live Worker Runtime Verification
console.log("\n5️⃣  Live Worker Runtime Verification\n");
const WORKER_URL = "https://dor-progress.banjays.workers.dev/api/client-config";

try {
  console.log(`   Pinging: ${WORKER_URL}...`);
  const response = await fetch(WORKER_URL);
  if (response.ok) {
    const liveConfig = await response.json();
    console.log("   ✅ Live Worker responded. Checking keys:");

    const expectedLiveKeys = ["RECAPTCHA_SITE_KEY", "firebase"];
    expectedLiveKeys.forEach(key => {
      const exists = key === "firebase" ? !!liveConfig.firebase : !!liveConfig[key];
      if (exists) {
        console.log(`     ✅ ${key} is active in production`);
      } else {
        console.log(`     ❌ ${key} IS MISSING from production response`);
        missingCount++;
      }
    });
  } else {
    console.log(`   ⚠️  Live check failed (HTTP ${response.status}). Worker might be down or unauthorized.`);
  }
} catch (err) {
  console.log("   ⚠️  Live check skipped: Could not reach Worker.");
}

// Summary
console.log("\n" + "═".repeat(60));
console.log("\n📋 Quick Commands:\n");
console.log("   # Check status");
console.log("   pnpm run secrets\n");
console.log("   # Set Cloudflare secret");
console.log("   wrangler secret put CLOUDFLARE_API_TOKEN\n");
console.log("   # Set GitHub secret (using GitHub CLI)");
console.log("   gh secret set <NAME>\n");
console.log("=".repeat(60));
console.log("   🌐 UI Translations: pnpm exec vitest run scripts/translations.test.ts");
console.log("   📝 Update from Sheets: pnpm exec tsx scripts/sync-sheets.js");
console.log("\n" + "═".repeat(60));
console.log("   🎯 Dashboard: https://dor-progress.web.app");
console.log("   🔧 Worker: https://dor-progress.banjays.workers.dev");
console.log("   📊 Project: https://console.firebase.google.com/project/dor-progress/overview");
console.log("═".repeat(60));