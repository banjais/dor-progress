#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execSync } from 'child_process';

// 💡 Configured via environment variable for security and flexibility
const isVerbose = process.argv.includes('--verbose') || process.argv.includes('-v');
const isDryRun = process.argv.includes('--dry-run');

/**
 * Automatically load .dev.vars if running locally without environment variables set
 */
if (!process.env.PUBLISHED_SHEET_ID) {
    const devVarsPath = path.resolve(process.cwd(), '.dev.vars');
    if (fs.existsSync(devVarsPath)) {
        const content = fs.readFileSync(devVarsPath, 'utf8');
        content.split(/\r?\n/).forEach(line => {
            const [key, ...val] = line.split('=');
            if (key && val.length > 0) process.env[key.trim()] = val.join('=').trim();
        });
    }
}

/**
 * Extract Sheet ID from a full URL if provided, otherwise use as is
 */
const rawId = process.env.PUBLISHED_SHEET_ID;
const PUBLISHED_SHEET_ID = rawId?.includes('/d/e/')
    ? rawId.split('/d/e/')[1].split('/')[0]
    : rawId;

const PUBLISHED_URL = `https://docs.google.com/spreadsheets/d/e/${PUBLISHED_SHEET_ID}/pub?output=csv`;

const OUTPUT_PATH = path.resolve(process.cwd(), 'src/locales/translations.json');
const PUBLIC_PATH = path.resolve(process.cwd(), 'public/translations.json');
const BUILD_PATH = path.resolve(process.cwd(), '.build/translations.json');

/**
 * Helper to sort object keys alphabetically
 */
function sortObject(obj) {
    return Object.keys(obj).sort().reduce((acc, key) => {
        acc[key] = obj[key];
        return acc;
    }, {});
}

async function syncTranslations() {
    if (!PUBLISHED_SHEET_ID) {
        console.warn('⚠️  Skipping translation sync: PUBLISHED_SHEET_ID not found in environment or .dev.vars');
        return;
    }

    console.log('🌐 Fetching published translations from Google Sheets...');

    let baseline = null;
    if (fs.existsSync(OUTPUT_PATH)) {
        try {
            baseline = JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8'));
        } catch (e) { /* ignore baseline if file is missing or invalid */ }
    }

    try {
        const response = await fetch(PUBLISHED_URL);
        if (!response.ok) throw new Error(`Failed to fetch: ${response.statusText}`);

        const csvText = await response.text();
        // Handle potential CSV quoting and line endings
        const rows = csvText.split(/\r?\n/).map(row => row.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/));

        // Single Tab Logic: Columns are [Key, English, Nepali]
        const translations = {
            en: {},
            ne: {},
            _metadata: { syncAt: new Date().toISOString() }
        };

        const duplicates = [];
        const missing = [];
        const unchanged = [];
        const nestedKeys = [];

        rows.slice(1).forEach(row => {
            if (row && row.length >= 3) {
                const key = row[0]?.replace(/^"|"$/g, '').trim();
                const enVal = row[1]?.replace(/^"|"$/g, '').trim();
                const neVal = row[2]?.replace(/^"|"$/g, '').trim();

                if (key) {
                    // Prevent keys with dots to ensure a strictly flat translation structure
                    if (key.includes('.')) {
                        nestedKeys.push(key);
                    }

                    if (key in translations.en) {
                        duplicates.push(key);
                    }

                    // Flag keys that haven't changed from the local baseline values
                    if (baseline && baseline.en?.[key] === enVal && baseline.ne?.[key] === neVal) {
                        unchanged.push(key);
                    }

                    if (!enVal || !neVal) {
                        missing.push({ key, en: !enVal, ne: !neVal });
                    }
                    translations.en[key] = enVal;
                    translations.ne[key] = neVal;
                }
            }
        });

        let hasErrors = false;
        if (duplicates.length > 0) {
            console.error(`❌ Error: Found ${duplicates.length} duplicate key(s) in the Google Sheet:`);
            duplicates.forEach(k => console.error(`   - ${k}`));
            hasErrors = true;
        }

        if (missing.length > 0) {
            console.error(`❌ Error: Found ${missing.length} key(s) with missing translations:`);
            missing.forEach(m => {
                const langs = [];
                if (m.en) langs.push('English');
                if (m.ne) langs.push('Nepali');
                console.error(`   - ${m.key} (Missing: ${langs.join(' & ')})`);
            });
            hasErrors = true;
        }

        if (nestedKeys.length > 0) {
            console.error(`❌ Error: Found ${nestedKeys.length} key(s) containing dots (nested objects are forbidden):`);
            nestedKeys.forEach(k => console.error(`   - ${k}`));
            hasErrors = true;
        }

        if (hasErrors) process.exit(1);

        // 1. Sort keys for consistency and cleaner diffs
        const sortedEn = sortObject(translations.en);
        const sortedNe = sortObject(translations.ne);

        // Generate fingerprint based ONLY on translation content
        // This ensures the fingerprint ignores the 'syncAt' timestamp in _metadata
        const fingerprint = crypto.createHash('sha256')
            .update(JSON.stringify({ en: sortedEn, ne: sortedNe }))
            .digest('hex');
        translations._metadata.fingerprint = fingerprint;

        if (isVerbose && unchanged.length > 0) {
            console.log(`ℹ️ Unchanged keys (${unchanged.length}):`);
            unchanged.forEach(k => console.log(`   - ${k}`));
        }

        // Skip write if fingerprint matches the baseline
        if (baseline && baseline._metadata?.fingerprint === fingerprint) {
            console.log(`✨ No changes detected (fingerprint: ${fingerprint}). Skipping write operation.`);
            return;
        }

        if (isDryRun) {
            console.log(`\n--- DRY RUN: No files were written ---`);
            console.log(`Would sync ${Object.keys(translations.en).length} keys.`);
            console.log(`New Fingerprint: ${fingerprint}`);
            return;
        }

        const finalOutput = {
            en: sortedEn,
            ne: sortedNe,
            _metadata: translations._metadata
        };
        const jsonContent = JSON.stringify(finalOutput, null, 2);

        // 1. Write to src (for application code imports)
        fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
        fs.writeFileSync(OUTPUT_PATH, jsonContent);

        // 2. Write to public (Ensures it is bundled into the final build artifact)
        fs.mkdirSync(path.dirname(PUBLIC_PATH), { recursive: true });
        fs.writeFileSync(PUBLIC_PATH, jsonContent);

        // 3. Write to .build (Ensures build artifacts are consistent even if sync runs before build)
        fs.mkdirSync(path.dirname(BUILD_PATH), { recursive: true });
        fs.writeFileSync(BUILD_PATH, jsonContent);

        // 4. Post-sync Formatting Step
        try {
            console.log('✨ Formatting generated files...');
            execSync(`npx prettier --write "${OUTPUT_PATH}" "${PUBLIC_PATH}"`, { stdio: 'ignore' });
        } catch (e) {
            console.warn('⚠️  Note: Prettier formatting skipped (not installed or failed).');
        }

        console.log(`✅ Successfully synced ${Object.keys(finalOutput.en).length} keys (${unchanged.length} unchanged from baseline).`);
    } catch (error) {
        console.error('❌ Error syncing translations:', error.message);
        process.exit(1);
    }
}

syncTranslations();