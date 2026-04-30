#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { GoogleGenerativeAI } from '@google/generative-ai';

// 1. Setup paths and API
const TRANSLATION_FILE = path.resolve(process.cwd(), 'scripts/translations.json');
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

async function translate() {
    console.log('🤖 Starting Gemini Auto-Translation...');

    if (!process.env.GEMINI_API_KEY) {
        console.error('❌ GEMINI_API_KEY not found in environment variables.');
        process.exit(1);
    }

    const data = JSON.parse(fs.readFileSync(TRANSLATION_FILE, 'utf8'));
    const neKeys = Object.keys(data.ne);
    const enKeys = Object.keys(data.en);

    // Find keys in Nepali that don't have an English translation yet
    const missingTranslations = neKeys.filter(key => !data.en[key] && isNepali(key));

    if (missingTranslations.length === 0) {
        console.log('✅ All indicators are already translated.');
        return;
    }

    console.log(`📝 Found ${missingTranslations.length} missing translations. Consulting Gemini...`);

    const prompt = `
        You are a professional translator specializing in Civil Engineering and Road Infrastructure.
        I have a JSON object for a Department of Roads dashboard. 
        Translate these Nepali keys into concise, professional English.
        
        Input Keys: ${JSON.stringify(missingTranslations)}
        
        Return ONLY a JSON object where the keys are the original Nepali strings and the values are the English translations.
        Example format: {"सडक": "Road"}
    `;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text().replace(/```json|```/g, '').trim();
        const newTranslations = JSON.parse(text);

        // Merge new translations into the 'en' block
        data.en = { ...data.en, ...newTranslations };

        fs.writeFileSync(TRANSLATION_FILE, JSON.stringify(data, null, 4), 'utf8');
        console.log('✨ translations.json updated successfully!');
    } catch (error) {
        console.error('❌ Translation failed:', error);
    }
}

function isNepali(text) {
    return /[\u0900-\u097F]/.test(text);
}

translate();