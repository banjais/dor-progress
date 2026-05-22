// scripts/deploy-worker.js
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const WORKER_ENTRY = 'src/worker.ts';
const TOML_PATH = 'wrangler.toml';


console.log('🚀 Deploying Cloudflare Worker...');

try {
  // 1. Ensure wrangler.toml is in sync with the script's entry point
  if (fs.existsSync(TOML_PATH)) {
    let tomlContent = fs.readFileSync(TOML_PATH, 'utf8');
    const mainRegex = /^main\s*=\s*".*"/m;
    const expectedMain = `main = "${WORKER_ENTRY}"`;

    if (mainRegex.test(tomlContent)) {
      const currentMain = tomlContent.match(mainRegex)[0];
      if (currentMain !== expectedMain) {
        console.log(`🔄 Syncing wrangler.toml: updating entry point to ${WORKER_ENTRY}`);
        tomlContent = tomlContent.replace(mainRegex, expectedMain);
        fs.writeFileSync(TOML_PATH, tomlContent);
      }
    }
  }

  // 2. Sync version from package.json into wrangler.toml [vars]
  const packageJsonPath = path.join(process.cwd(), 'package.json');
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const pkgVersion = pkg.version;
  const expectedVersionVar = `version = "${pkgVersion}"`;

  let tomlContent = fs.readFileSync(TOML_PATH, 'utf8');
  const varsRegex = /\[vars\]\n([\s\S]*?)(?=\n\[|$)/; // Matches [vars] section and its content
  const versionVarRegex = /^\s*version\s*=\s*".*?"/m; // Matches 'version = "..."' line

  if (varsRegex.test(tomlContent)) {
    tomlContent = tomlContent.replace(varsRegex, (match, varsContent) => {
      if (versionVarRegex.test(varsContent)) {
        return `[vars]\n${varsContent.replace(versionVarRegex, expectedVersionVar)}`;
      } else {
        return `[vars]\n${varsContent.trim()}\n${expectedVersionVar}`;
      }
    });
  } else {
    tomlContent += `\n[vars]\n${expectedVersionVar}`;
  }
  fs.writeFileSync(TOML_PATH, tomlContent);

  // 2. Run deploy (Wrangler now uses the synced TOML automatically)
  execSync('npx wrangler deploy', {
    stdio: 'inherit',     // Show live logs
    env: process.env
  });

  console.log('✅ Cloudflare Worker deployed successfully!');
} catch (error) {
  console.error('❌ Worker deployment failed!');
  console.error(error.message);
  process.exit(1);
}