// scripts/update-version.js
import fs from 'fs/promises';
import path from 'path';
import { execSync } from 'child_process';

async function updateVersion() {
  try {
    console.log('🔄 Updating version and branding...');

    const branch = process.env.GITHUB_REF_NAME || execSync('git rev-parse --abbrev-ref HEAD').toString().trim();

    if (branch !== 'main') {
      console.log(`⏭️  Skipping version bump: Current branch is "${branch}", not "main".`);
      return; // Exit gracefully without updating files
    }

    const packageJsonPath = path.join(process.cwd(), 'package.json');
    const brandingPath = path.join(process.cwd(), 'config', 'branding.json');

    // Update package.json version
    const pkg = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
    const [major, minor, patch] = pkg.version.split('.').map(Number);
    const newVersion = `${major}.${minor}.${patch + 1}`;

    pkg.version = newVersion;
    await fs.writeFile(packageJsonPath, JSON.stringify(pkg, null, 2) + '\n');
    console.log(`✅ Version updated: ${newVersion}`);

    // Update branding.json
    if (await fs.access(brandingPath).then(() => true).catch(() => false)) {
      const branding = JSON.parse(await fs.readFile(brandingPath, 'utf8'));

      branding.app.lastUpdate = new Date().toISOString().split('T')[0];
      branding.app.lastCommitHash = execSync('git rev-parse HEAD').toString().trim();

      await fs.writeFile(brandingPath, JSON.stringify(branding, null, 2) + '\n');
      console.log(`✅ Branding updated (lastUpdate: ${branding.app.lastUpdate})`);
    }

  } catch (err) {
    console.error('❌ Failed to update version:', err.message);
    process.exit(1);
  }
}

updateVersion();