#!/usr/bin/env npx tsx
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

// 💡 Configured via environment variable for security and flexibility
const PUBLISHED_SHEET_ID = process.env.PUBLISHED_SHEET_ID;
const PUBLISHED_URL = `https://docs.google.com/spreadsheets/d/e/${PUBLISHED_SHEET_ID}/pub?output=csv`;

const OUTPUT_PATH = path.resolve(process.cwd(), 'src/locales/translations.json');

async function syncTranslations() {
    if (!PUBLISHED_SHEET_ID) {
        console.error('❌ Error: PUBLISHED_SHEET_ID is not defined in the environment.');
        process.exit(1);
    }

    console.log('🌐 Fetching published translations from Google Sheets...');

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

        rows.slice(1).forEach(row => {
            if (row && row.length >= 3) {
                const key = row[0]?.trim().replace(/^"|"$/g, '');
                const enVal = row[1]?.trim().replace(/^"|"$/g, '');
                const neVal = row[2]?.trim().replace(/^"|"$/g, '');

                if (key) {
                    translations.en[key] = enVal;
                    translations.ne[key] = neVal;
                }
            }
        });

        // Generate fingerprint to prevent unnecessary Gemini recreation
        const fingerprint = crypto.createHash('sha256')
            .update(JSON.stringify(translations.en) + JSON.stringify(translations.ne))
            .digest('hex');
        translations._metadata.fingerprint = fingerprint;

        fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
        fs.writeFileSync(OUTPUT_PATH, JSON.stringify(translations, null, 2));

        console.log(`✅ Successfully synced ${Object.keys(translations.en).length} keys to ${OUTPUT_PATH}`);
    } catch (error) {
        console.error('❌ Error syncing translations:', error.message);
        process.exit(1);
    }
}

syncTranslations();