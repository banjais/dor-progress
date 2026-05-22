// scripts/sync-worker-secrets.js
import { spawnSync } from 'child_process';

/**
 * List of secrets required by the Worker that are stored in GitHub Secrets
 */
const REQUIRED_SECRETS = [
    'GOOGLE_GENAI_API_KEY',
    'SNAPSHOT_KEY',
    'FIREBASE_API_KEY'
];

async function main() {
    if (process.env.GITHUB_ACTIONS && !process.env.CLOUDFLARE_API_TOKEN) {
        console.error('❌ CLOUDFLARE_API_TOKEN is missing in the CI environment.');
        process.exit(1);
    }

    console.log('🔐 Syncing Worker secrets to Cloudflare...');
    let hasError = false;

    for (const secret of REQUIRED_SECRETS) {
        const value = process.env[secret];
        if (!value) {
            console.warn(`⚠️  Skip: ${secret} is not defined in the environment.`);
            continue;
        }

        // Use stdin to pass the secret. This prevents it from appearing in process lists.
        // shell: true is required for Windows systems to correctly resolve the 'npx' command.
        const result = spawnSync('npx', ['wrangler', 'secret', 'put', secret], {
            input: value,
            encoding: 'utf8',
            shell: true
        });

        if (result.status === 0 && !result.error) {
            console.log(`✅ ${secret} synced.`);
        } else {
            const errorDetail = result.stderr?.trim() || result.error?.message || 'Check if you are logged in to wrangler (npx wrangler login)';
            console.error(`❌ Failed to sync ${secret}: ${errorDetail}`);
            hasError = true;
        }
    }

    if (hasError) {
        process.exit(1);
    }
}

main().catch(err => {
    console.error('Fatal error during secret sync:', err);
    process.exit(1);
});