#!/usr/bin/env npx tsx

/**
 * Secrets Setup Helper
 * Helps configure required secrets for local development and CI/CD
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

console.log('\n🔧 SECRETS SETUP ASSISTANT\n');
console.log('═'.repeat(60));

// Check .dev.vars
const devVarsPath = path.resolve(process.cwd(), '.dev.vars');
// Define core required secrets for CI validation if .dev.vars is missing
const REQUIRED_SECRETS = [
  'CLOUDFLARE_API_TOKEN',
  'FIREBASE_TOKEN',
  'PUBLISHED_SHEET_ID'
];

// Purpose map for "Why" explanation
const SECRET_PURPOSES = {
  'CLOUDFLARE_API_TOKEN': 'Deployment of Cloudflare Workers and API management.',
  'FIREBASE_TOKEN': 'Authentication for Firebase Hosting and Firestore rules deployment.',
  'PUBLISHED_SHEET_ID': 'Accessing Google Sheets for UI translation synchronization.',
  'API_BASE_URL': 'Connecting the Frontend to the correct Backend environment.'
};

let activeSecretNames = [...REQUIRED_SECRETS];

/**
 * Writes a formatted table to GitHub Job Summary
 */
const writeGithubSummary = (results) => {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;

  let markdown = '### 🔐 Secrets Validation Report\n\n';
  markdown += '| Status | Secret Name | Description / Why | Result |\n';
  markdown += '| :---: | :--- | :--- | :--- |\n';

  results.forEach(res => {
    const statusIcon = res.passed ? '✅' : '❌';
    const description = SECRET_PURPOSES[res.name] || 'Required for application runtime/build.';
    const resultText = res.passed ? 'Available' : '**MISSING**';
    markdown += `| ${statusIcon} | \`${res.name}\` | ${description} | ${resultText} |\n`;
  });

  fs.appendFileSync(summaryPath, markdown);
};

console.log('\n1️⃣  Local Development (.dev.vars)\n');
if (fs.existsSync(devVarsPath)) {
  console.log('   ✅ .dev.vars exists');
  const content = fs.readFileSync(devVarsPath, 'utf8');
  const vars = content.split('\n')
    .filter(l => l && !l.startsWith('#') && l.includes('='));

  // Merge unique secret names found in local vars
  const foundNames = vars.map(l => l.split('=')[0].trim());
  activeSecretNames = Array.from(new Set([...activeSecretNames, ...foundNames]));

  console.log('   Status: (Values masked for security)');
  activeSecretNames.forEach(name => console.log(`     ✅ ${name}`));
} else {
  console.log('   ❌ .dev.vars not found');
  if (!process.env.GITHUB_ACTIONS) {
    console.log('   Please create .dev.vars with your secrets first.');
    process.exit(1);
  }
  console.log('   (Using required core list for CI validation)');
}

// Cloudflare Wrangler secrets
console.log('\n2️⃣  Cloudflare Worker Secrets\n');
console.log('   These are set via: wrangler secret put <NAME>');
console.log('   Status in current environment:\n');
try {
  const output = execSync('wrangler secret list --format json 2>/dev/null', { encoding: 'utf8' });
  const secrets = JSON.parse(output);
  console.log(`   ✅ Connected to Cloudflare (${secrets.length} secrets)`);
  // Exclude deployment-only tokens from worker runtime check
  const runtimeExclusions = ['FIREBASE_TOKEN', 'FIREBASE_SERVICE_ACCOUNT', 'CLOUDFLARE_API_TOKEN'];
  for (const s of activeSecretNames.filter(k => !runtimeExclusions.includes(k))) {
    const found = secrets.find(ss => ss.name === s);
    console.log(`     ${found ? '✅' : '❌'} ${s}`);
  }
} catch (e) {
  console.log('   ⚠️  Not authenticated or no secrets set');
  console.log('   Run: wrangler secret put CLOUDFLARE_API_TOKEN');
}

// GitHub Actions secrets
console.log('\n3️⃣  GitHub Actions Secrets\n');
console.log('   Set via: gh secret set <NAME>');
console.log('   Or via GitHub UI: Settings → Secrets and variables → Actions\n');
console.log('   Status in current environment (as passed to CI step):');

let missingCount = 0;
const summaryResults = [];

for (const secret of activeSecretNames) {
  const isSet = !!process.env[secret];
  if (!isSet) missingCount++;
  summaryResults.push({ name: secret, passed: isSet });
  console.log(`     ${isSet ? '✅' : '❌'} ${secret}`);
}

if (process.env.GITHUB_ACTIONS) writeGithubSummary(summaryResults);

if (missingCount > 0 && process.env.GITHUB_ACTIONS) {
  // GitHub Actions Annotation: Creates the "Reason" visible in the UI summary
  console.error(`\n::error title=Secrets Validation Failed::${missingCount} required secrets are missing from the environment.`);
  console.error('Check your GitHub Repository Settings > Secrets > Actions mapping.');

  // Hard error to fail the job
  process.exit(1);
}

// Firebase config
console.log('\n4️⃣  Firebase Configuration\n');
console.log('   These are in Cloudflare Worker env (not GitHub):');
console.log('   (fetched via /api/client-config endpoint)\n');
const firebaseKeys = [
  'FIREBASE_API_KEY',
  'FIREBASE_PROJECT_ID',
  'FIREBASE_PROJECT_NUMBER',
  'FIREBASE_AUTH_DOMAIN',
  'FIREBASE_STORAGE_BUCKET',
  'FIREBASE_MESSAGING_SENDER_ID',
  'FIREBASE_APP_ID',
  'FIREBASE_MEASUREMENT_ID',
  'RECAPTCHA_SITE_KEY'
];
for (const key of firebaseKeys) {
  console.log(`     • ${key}`);
}

// Summary
console.log('\n' + '═'.repeat(60));
console.log('\n📋 Quick Commands:\n');
console.log('   # Check status');
console.log('   npm run secrets\n');
console.log('   # Set Cloudflare secret');
console.log('   wrangler secret put CLOUDFLARE_API_TOKEN\n');
console.log('   # Set GitHub secret (using GitHub CLI)');
console.log('   gh secret set CLOUDFLARE_API_TOKEN\n');
console.log('   # View Worker logs');
console.log('   npm run logs\n');

console.log('');
