#!/usr/bin/env npx tsx

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

const devVarsPath = path.resolve(process.cwd(), '.dev.vars');

// Tokens used strictly for CI/CD that should NOT be put into the Worker runtime
const CLOUDFLARE_RUNTIME_EXCLUSIONS = [
    'CLOUDFLARE_API_TOKEN',
    'FIREBASE_TOKEN',
    'FIREBASE_SERVICE_ACCOUNT'
];

if (!fs.existsSync(devVarsPath)) {
    console.error('❌ Error: .dev.vars file not found. Create it first.');
    process.exit(1);
}

console.log('🔄 Starting Secrets Synchronization...\n');

const content = fs.readFileSync(devVarsPath, 'utf8');
const vars = Object.fromEntries(
    content.split('\n')
        .filter(line => line && !line.startsWith('#') && line.includes('='))
        .map(line => {
            const [key, ...val] = line.split('=');
            return [key.trim(), val.join('=').trim().replace(/^["']|["']$/g, '')];
        })
);

for (const [key, value] of Object.entries(vars)) {
    // 1. Sync to Cloudflare Wrangler (Runtime Secrets)
    if (!CLOUDFLARE_RUNTIME_EXCLUSIONS.includes(key)) {
        console.log(`☁️  Pushing ${key} to Cloudflare...`);
        const wr = spawnSync('npx', ['wrangler', 'secret', 'put', key], { input: value, encoding: 'utf8' });
        if (wr.status === 0) {
            console.log(`   ✅ ${key} synced to Cloudflare.`);
        } else {
            console.error(`   ❌ Failed to sync ${key} to Cloudflare.`);
        }
    }

    // 2. Sync to GitHub Actions (All secrets in .dev.vars)
    console.log(`🐙 Pushing ${key} to GitHub...`);
    const gh = spawnSync('gh', ['secret', 'set', key], { input: value, encoding: 'utf8' });
    if (gh.status === 0) {
        console.log(`   ✅ ${key} synced to GitHub.`);
    } else {
        console.error(`   ❌ Failed to sync ${key} to GitHub. Ensure 'gh' CLI is authenticated.`);
    }
}

console.log('\n✨ Synchronization complete!');
console.log('💡 Note: Remember to verify the status using: npm run secrets');