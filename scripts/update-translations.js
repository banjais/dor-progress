#!/usr/bin/env node

/**
 * Updates translation data in Cloudflare KV from a local JSON file.
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const TRANSLATION_FILE = path.resolve(process.cwd(), 'src/locales/translations.json');
const KV_NAMESPACE = 'TRANSLATION_KV'; // Name of your KV binding
const KV_KEY = 'locales';              // Key under which translations are stored

console.log(`\n🌐 Updating translations in Cloudflare KV...`);

if (!fs.existsSync(TRANSLATION_FILE)) {
    console.error(`❌ Translation file not found: ${TRANSLATION_FILE}`);
    process.exit(1);
}

try {
    const translations = fs.readFileSync(TRANSLATION_FILE, 'utf8');

    // Use the wrangler CLI to put the JSON into KV
    // Note: For Windows PowerShell, you might need to adjust quoting if this fails.
    // The current command assumes a shell that correctly handles the JSON string.
    execSync(`wrangler kv key put --namespace=${KV_NAMESPACE} "${KV_KEY}" '${translations}'`, { stdio: 'inherit' });

    console.log(`✅ Translations from ${TRANSLATION_FILE} successfully uploaded to KV namespace ${KV_NAMESPACE} under key "${KV_KEY}".`);

} catch (error) {
    console.error(`❌ Failed to update translations in KV:`, error.message);
    console.error(`   Ensure 'wrangler' is installed and authenticated.`);
    console.error(`   And that your 'wrangler.toml' has a KV namespace binding for '${KV_NAMESPACE}'.`);
    process.exit(1);
}