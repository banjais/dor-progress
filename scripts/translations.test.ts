import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';

const translationsPath = path.resolve(process.cwd(), 'src/locales/translations.json');

describe('Translations Integrity', () => {
    let translations: any = null;
    let fileExists = false;

    beforeAll(() => {
        fileExists = fs.existsSync(translationsPath);
        if (fileExists) {
            try {
                translations = JSON.parse(fs.readFileSync(translationsPath, 'utf8'));
            } catch (e) {
                translations = null;
            }
        }
    });

    it('should exist at src/locales/translations.json', () => {
        expect(fileExists,
            'Missing translations.json. Run "npx tsx scripts/sync-sheets.js" to sync from Google Sheets.'
        ).toBe(true);
    });

    it('should be valid JSON with expected top-level keys', () => {
        if (!fileExists) return;
        expect(translations, 'Could not parse translations.json - verify it is valid JSON').not.toBeNull();
        expect(translations).toHaveProperty('en');
        expect(translations).toHaveProperty('ne');
        expect(translations).toHaveProperty('_metadata');
    });

    it('should have parity between English and Nepali keys', () => {
        if (!translations) return;
        const { en, ne } = translations;
        const enKeys = Object.keys(en);
        const neKeys = Object.keys(ne);

        const missingInNe = enKeys.filter(key => !neKeys.includes(key));
        const missingInEn = neKeys.filter(key => !enKeys.includes(key));

        expect(missingInNe, `Missing in 'ne': ${missingInNe.join(', ')}`).toHaveLength(0);
        expect(missingInEn, `Missing in 'en': ${missingInEn.join(', ')}`).toHaveLength(0);
    });

    it('should not have empty or whitespace-only values', () => {
        if (!translations) return;
        const { en, ne } = translations;

        Object.entries({ en, ne }).forEach(([lang, data]: [string, any]) => {
            Object.entries(data).forEach(([key, value]) => {
                const strValue = String(value).trim();
                expect(strValue, `${lang} value for key "${key}" is empty`).not.toBe('');
            });
        });
    });

    it('should not exceed the character limit for values', () => {
        if (!translations) return;
        const MAX_LENGTH = 500;

        Object.entries({ en: translations.en, ne: translations.ne }).forEach(([lang, data]: [string, any]) => {
            Object.entries(data).forEach(([key, value]) => {
                expect(String(value).length, `${lang} value for key "${key}" exceeds ${MAX_LENGTH}`).toBeLessThanOrEqual(MAX_LENGTH);
            });
        });
    });

    it('should contain valid metadata from the sync process', () => {
        if (!translations) return;
        expect(translations._metadata).toHaveProperty('syncAt');
        expect(translations._metadata).toHaveProperty('fingerprint');

        const syncDate = new Date(translations._metadata.syncAt);
        expect(syncDate.toString()).not.toBe('Invalid Date');
    });
});