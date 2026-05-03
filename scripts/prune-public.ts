#!/usr/bin/env npx tsx

import fs from 'fs';
import path from 'path';

const PUBLIC_DIR = path.resolve(process.cwd(), 'public');

// Files and extensions that should never be in the production public folder
const FORBIDDEN_EXTENSIONS = ['.sh', '.yml', '.yaml', '.md', '.ts', '.dev.vars', '.map'];
const FORBIDDEN_FILES = ['action.yml', 'pipeline.yml', 'firebase.json', 'package.json', 'package-lock.json'];

function prune(dir: string) {
    if (!fs.existsSync(dir)) return;

    const items = fs.readdirSync(dir, { withFileTypes: true });
    for (const item of items) {
        const fullPath = path.join(dir, item.name);

        if (item.isDirectory()) {
            // Recurse into subdirectories
            prune(fullPath);
            // Remove empty directories left behind after pruning
            if (fs.readdirSync(fullPath).length === 0) {
                console.log(`📁 Removing empty directory: ${fullPath}`);
                fs.rmdirSync(fullPath);
            }
        } else {
            const ext = path.extname(item.name).toLowerCase();
            const shouldPrune = FORBIDDEN_EXTENSIONS.includes(ext) || FORBIDDEN_FILES.includes(item.name);

            if (shouldPrune) {
                console.log(`🗑️  Pruning non-asset file: ${item.name}`);
                fs.unlinkSync(fullPath);
            }
        }
    }
}

console.log('\n🧹 PRUNING PUBLIC DIRECTORY');
console.log('═'.repeat(40));
prune(PUBLIC_DIR);
console.log('═'.repeat(40));
console.log('✅ Prune complete.\n');