import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const buildDir = path.resolve('.build');
const swPath = path.join(buildDir, 'sw.v2.js');

if (fs.existsSync(swPath)) {
  let sw = fs.readFileSync(swPath, 'utf8');

  const apiBase = process.env.API_BASE_URL || '';
  const buildId = `${Date.now().toString(36).slice(-6)}`;
  const commitSha = execSync('git rev-parse --short HEAD').toString().trim();

  sw = sw.replace(/__API_BASE_URL__/g, apiBase)
    .replace(/__BUILD_ID__/g, buildId)
    .replace(/__COMMIT_SHA__/g, commitSha);

  fs.writeFileSync(swPath, sw);
  console.log('✅ Service Worker environment variables injected');
} else {
  console.warn('⚠️ sw.v2.js not found in .build');
}
