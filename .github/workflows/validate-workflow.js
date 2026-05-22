/* global process, console */
import fs from 'fs';
import path from 'path';

const WORKFLOW_PATH = path.join(process.cwd(), '.github/workflows/deploy.yml');
const SCRIPTS_TO_SCAN = [
    { path: 'scripts/deploy.js', regex: /const SENSITIVE_KEYS = \[\s*([\s\S]*?)\s*\];/ },
    { path: 'scripts/sync-worker-secrets.js', regex: /const REQUIRED_SECRETS = \[\s*([\s\S]*?)\s*\];/ }
];

async function validateWorkflow() {
    console.log('🔍 Validating GitHub Actions workflow mappings...');

    try {
        // 1. Extract required keys from scripts
        const requiredKeys = new Set();
        for (const script of SCRIPTS_TO_SCAN) {
            const content = fs.readFileSync(path.join(process.cwd(), script.path), 'utf8');
            const match = content.match(script.regex);
            if (match && match[1]) {
                match[1]
                    .split(',')
                    .map(key => key.trim().replace(/['"]/g, ''))
                    .filter(key => key.length > 0)
                    .forEach(key => requiredKeys.add(key));
            }
        }

        // 2. Read workflow file
        if (!fs.existsSync(WORKFLOW_PATH)) {
            throw new Error(`Workflow file not found at ${WORKFLOW_PATH}`);
        }
        const workflowContent = fs.readFileSync(WORKFLOW_PATH, 'utf8');

        // 3. Check for missing mappings
        const missing = [];
        for (const key of requiredKeys) {
            // Look for "KEY:" at the start of a line (with optional indentation)
            const mappingRegex = new RegExp(`^\\s*${key}:`, 'm');
            if (!mappingRegex.test(workflowContent)) {
                missing.push(key);
            }
        }

        if (missing.length > 0) {
            console.error(`\n❌ Missing secret mappings in deploy.yml:\n   ${missing.join('\n   ')}\n`);
            process.exit(1);
        }

        console.log('✅ All required secrets are correctly mapped in deploy.yml.');
    } catch (err) {
        console.error('❌ Validation failed:', err.message);
        process.exit(1);
    }
}

validateWorkflow();