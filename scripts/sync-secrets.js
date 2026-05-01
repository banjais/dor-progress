#!/usr/bin/env npx tsx

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

const devVarsPath = path.resolve(process.cwd(), '.dev.vars');

const REQUIRED_GITHUB = [
    'CLOUDFLARE_API_TOKEN',
    'UPSTASH_REDIS_REST_URL',
    'UPSTASH_REDIS_REST_TOKEN',
    'GEMINI_API_KEY',
    'ADMIN_SECRET',
    'FIREBASE_TOKEN',
    'FIREBASE_SERVICE_ACCOUNT'
];

const FOR_CLOUDFLARE = [
    'CLOUDFLARE_API_TOKEN',
    'UPSTASH_REDIS_REST_URL',
    'UPSTASH_REDIS_REST_TOKEN',
    'GEMINI_API_KEY',
    'ADMIN_SECRET'
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
    // 1. Sync to Cloudflare Wrangler
    if (FOR_CLOUDFLARE.includes(key)) {
        console.log(`☁️  Pushing ${key} to Cloudflare...`);
        const wr = spawnSync('npx', ['wrangler', 'secret', 'put', key], { input: value, encoding: 'utf8' });
        if (wr.status === 0) {
            console.log(`   ✅ ${key} synced to Cloudflare.`);
        } else {
            console.error(`   ❌ Failed to sync ${key} to Cloudflare.`);
        }
    }

    // 2. Sync to GitHub Actions
    if (REQUIRED_GITHUB.includes(key)) {
        console.log(`🐙 Pushing ${key} to GitHub...`);
        // Using --stdin avoids exposing the secret in command line arguments/history
        const gh = spawnSync('gh', ['secret', 'set', key], { input: value, encoding: 'utf8' });
        if (gh.status === 0) {
            console.log(`   ✅ ${key} synced to GitHub.`);
        } else {
            console.error(`   ❌ Failed to sync ${key} to GitHub. Ensure 'gh' CLI is authenticated.`);
        }
    }
}

console.log('\n✨ Synchronization complete!');
console.log('💡 Note: Remember to verify the status using: npm run secrets');