// scripts/update-version.js
import fs from 'fs/promises';
import path from 'path';
import { execSync } from 'child_process';

async function updateVersion() {
  // Silence deprecation warnings in this process as well
  process.env.NODE_NO_WARNINGS = '1';

  try {
    console.log('🔄 Updating version and branding...');

    const branch = process.env.GITHUB_REF_NAME || execSync('git rev-parse --abbrev-ref HEAD').toString().trim();
    const isCI = !!process.env.GITHUB_ACTIONS || !!process.env.CI;

    // Only restrict to 'main' in CI to avoid automated tags on feature branches.
    // Locally, we allow versioning on any branch.
    if (isCI && branch !== 'main') {
      console.log(`⏭️  Skipping version bump: Current branch is "${branch}", not "main" (CI mode).`);
      return;
    }

    const packageJsonPath = path.join(process.cwd(), 'package.json');
    const swPath = path.join(process.cwd(), 'public', 'sw.v2.js');

    // Update package.json version
    const pkg = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
    const [major, minor, patch] = pkg.version.split('.').map(Number);
    const newVersion = `${major}.${minor}.${patch + 1}`;

    pkg.version = newVersion;
    await fs.writeFile(packageJsonPath, JSON.stringify(pkg, null, 2) + '\n');
    console.log(`✅ Version updated: ${newVersion}`);

    // Update branding files
    const updateBrandingFile = async (filePath, isConfigSchema) => {
      if (await fs.access(filePath).then(() => true).catch(() => false)) {
        const branding = JSON.parse(await fs.readFile(filePath, 'utf8'));
        const today = new Date().toISOString().split('T')[0];
        const hash = execSync('git rev-parse HEAD').toString().trim();

        if (isConfigSchema) {
          branding.app = branding.app || {};
          branding.app.lastUpdate = today;
          branding.app.lastCommitHash = hash;
        } else {
          branding.version = newVersion;
          branding.lastUpdate = branding.lastUpdate || {};
          branding.lastUpdate.value = today;
          branding.lastCommitHash = hash;
        }

        await fs.writeFile(filePath, JSON.stringify(branding, null, 2) + '\n');
        console.log(`✅ Branding updated: ${path.relative(process.cwd(), filePath)}`);
      }
    };

    await updateBrandingFile(path.join(process.cwd(), 'config', 'branding.json'), true);
    await updateBrandingFile(path.join(process.cwd(), 'public', 'branding.json'), false);
    await updateBrandingFile(path.join(process.cwd(), 'src', 'branding.json'), false);
    await updateBrandingFile(path.join(process.cwd(), 'branding.json'), false);

    // Update Service Worker version for cache busting
    if (await fs.access(swPath).then(() => true).catch(() => false)) {
      let swContent = await fs.readFile(swPath, 'utf8');
      const versionRegex = /const VERSION = "v.*";/;
      swContent = swContent.replace(versionRegex, `const VERSION = "v${newVersion}";`);
      await fs.writeFile(swPath, swContent);
      console.log(`✅ Service Worker version updated: v${newVersion}`);
    }

  } catch (err) {
    console.error('❌ Failed to update version:', err.message);
    process.exit(1);
  }
}

updateVersion();