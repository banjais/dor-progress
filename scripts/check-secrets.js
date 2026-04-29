#!/usr/bin/env node

/**
 * Secrets Status Checker
 * Verifies which secrets are configured locally and in GitHub
 */

import fs from 'fs';
import path from 'path';

const REQUIRED_SECRETS = {
  local: [
    'CLOUDFLARE_API_TOKEN',
    'UPSTASH_REDIS_REST_URL',
    'UPSTASH_REDIS_REST_TOKEN',
    'GEMINI_API_KEY',
    'ADMIN_SECRET',
    'FIREBASE_TOKEN'
  ],
  runtime: [
    'FIREBASE_API_KEY',
    'FIREBASE_PROJECT_ID',
    'FIREBASE_PROJECT_NUMBER',
    'FIREBASE_AUTH_DOMAIN',
    'FIREBASE_STORAGE_BUCKET',
    'FIREBASE_MESSAGING_SENDER_ID',
    'FIREBASE_APP_ID',
    'FIREBASE_MEASUREMENT_ID',
    'RECAPTCHA_SITE_KEY'
  ]
};

console.log('\n🔐 SECRETS STATUS CHECK\n');
console.log('═'.repeat(60));

// Check .dev.vars
const devVarsPath = path.resolve(process.cwd(), '.dev.vars');
console.log('\n📁 Local (.dev.vars):');
if (fs.existsSync(devVarsPath)) {
  const content = fs.readFileSync(devVarsPath, 'utf8');
  const defined = [];
  const missing = [];

  for (const secret of [...REQUIRED_SECRETS.local, ...REQUIRED_SECRETS.runtime]) {
    if (content.includes(`${secret}=`)) {
      defined.push(secret);
    }
  }

  console.log(`  ✅ Defined (${defined.length}): ${defined.join(', ')}`);

  const allRequired = [...REQUIRED_SECRETS.local, ...REQUIRED_SECRETS.runtime];
  const undefined = allRequired.filter(s => !defined.includes(s));
  if (undefined.length) {
    console.log(`  ⚠️  Not in .dev.vars: ${undefined.join(', ')}`);
  }
} else {
  console.log('  ❌ .dev.vars file not found');
}

console.log('\n☁️  Cloudflare (wrangler secret list):');
try {
  const { execSync } = await import('child_process');
  const output = execSync('wrangler secret list --format json', { encoding: 'utf8' });
  const secrets = JSON.parse(output);
  const secretNames = secrets.map(s => s.name);

  for (const secret of REQUIRED_SECRETS.local) {
    const status = secretNames.includes(secret) ? '✅' : '❌';
    console.log(`  ${status} ${secret}`);
  }
} catch (e) {
  console.log('  ⚠️  Could not fetch (wrangler not authenticated or no secrets)');
}

console.log('\n🔥 Firebase (project settings):');
// These are set in Firebase console, not via CLI
console.log('  ℹ️  Configured in Firebase Console → Project Settings:');
console.log('     FIREBASE_API_KEY');
console.log('     FIREBASE_PROJECT_ID');
console.log('     FIREBASE_PROJECT_NUMBER');
console.log('     FIREBASE_AUTH_DOMAIN');
console.log('     FIREBASE_STORAGE_BUCKET');
console.log('     FIREBASE_MESSAGING_SENDER_ID');
console.log('     FIREBASE_APP_ID');
console.log('     FIREBASE_MEASUREMENT_ID');
console.log('  ℹ️  Also set in Cloudflare Worker env vars (for /api/client-config)');

console.log('\n🔗 GitHub Actions Secrets:');
console.log('  Set in: Repository → Settings → Secrets and variables → Actions');
console.log('  Required:');
for (const secret of REQUIRED_SECRETS.local) {
  console.log(`    • ${secret}`);
}

console.log('\n' + '═'.repeat(60));
console.log('\n📝 Quick Setup:\n');
console.log('1. Local dev (.dev.vars):');
console.log('   cp .env.example .dev.vars  # then fill in values\n');
console.log('2. Cloudflare secrets:');
console.log('   wrangler secret put CLOUDFLARE_API_TOKEN\n');
console.log('3. GitHub Actions secrets:');
console.log('   gh secret set CLOUDFLARE_API_TOKEN\n');
console.log('\n');
