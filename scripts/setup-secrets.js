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
let activeSecretNames = [];

console.log('\n1️⃣  Local Development (.dev.vars)\n');
if (fs.existsSync(devVarsPath)) {
  console.log('   ✅ .dev.vars exists');
  const content = fs.readFileSync(devVarsPath, 'utf8');
  const vars = content.split('\n')
    .filter(l => l && !l.startsWith('#') && l.includes('='));

  activeSecretNames = vars.map(l => l.split('=')[0].trim());

  console.log('   Status: (Values masked for security)');
  activeSecretNames.forEach(name => console.log(`     ✅ ${name}`));
} else {
  console.log('   ❌ .dev.vars not found');
  console.log('   Please create .dev.vars with your secrets first.');
  process.exit(1);
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
for (const secret of activeSecretNames) {
  const isSet = !!process.env[secret];
  if (!isSet) missingCount++;
  console.log(`     ${isSet ? '✅' : '❌'} ${secret}`);
}

if (missingCount > 0 && process.env.GITHUB_ACTIONS) {
  console.log(`\n❌ Failed: ${missingCount} GitHub secrets are not configured in this workflow run.`);
  // Do not exit with 1, allow the workflow to continue for graph visibility.
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
