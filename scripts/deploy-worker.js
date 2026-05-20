// scripts/deploy-worker.js
import { execSync } from 'child_process';

console.log('🚀 Deploying Cloudflare Worker...');

try {
  execSync('npx wrangler deploy src/worker.ts', {
    stdio: 'inherit',     // Show live logs
    env: process.env
  });

  console.log('✅ Cloudflare Worker deployed successfully!');
} catch (error) {
  console.error('❌ Worker deployment failed!');
  console.error(error.message);
  process.exit(1);
}