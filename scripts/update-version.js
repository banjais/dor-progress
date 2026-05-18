import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';

async function updateVersion() {
  // 0.1 Ensure we are on the 'main' branch
  const branchName = await new Promise((resolve) => {
    exec('git rev-parse --abbrev-ref HEAD', (error, stdout) => {
      if (error) {
        console.error('Error: Failed to determine current branch.');
        process.exit(1);
      }
      resolve(stdout.trim());
    });
  });

  if (branchName !== 'main') {
    console.error(`Aborting: Deployment must be run from the 'main' branch. Current branch is '${branchName}'.`);
    process.exit(1);
  }

  const packageJsonPath = path.join(process.cwd(), 'package.json');
  const brandingPath = path.join(process.cwd(), 'config', 'branding.json');

  // 1. Update package.json version
  const packageJsonContent = await fs.readFile(packageJsonPath, 'utf8');
  const packageJson = JSON.parse(packageJsonContent);
  console.log(`Current version: ${packageJson.version}`);

  const [major, minor, patch] = packageJson.version.split('.').map(Number);
  const newVersion = `${major}.${minor}.${patch + 1}`;
  packageJson.version = newVersion;

  await fs.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');
  console.log(`New version saved: ${newVersion}`);

  // 2. Update lastUpdate in branding.json
  try {
    const branding = JSON.parse(await fs.readFile(brandingPath, 'utf8'));

    // Get last commit hash
    let lastCommitHash = '';
    try {
      const { stdout } = await new Promise((resolve, reject) => {
        exec('git rev-parse HEAD', (error, stdout, stderr) => {
          if (error) reject(error);
          resolve({ stdout, stderr });
        });
      });
      lastCommitHash = stdout.trim();
    } catch (gitErr) {
      console.warn('Warning: Could not get last Git commit hash.', gitErr.message);
    }

    branding.app.lastUpdate = new Date().toISOString().split('T')[0];
    branding.app.lastCommitHash = lastCommitHash;

    await fs.writeFile(brandingPath, JSON.stringify(branding, null, 2) + '\n');
    console.log(`Branding updated with date: ${branding.app.lastUpdate} and commit hash: ${branding.app.lastCommitHash}`);

    // Git logic moved to final deployment step in deploy.js
  } catch {
    console.error('Warning: Could not update branding.json. Ensure it exists at config/branding.json');
  }
}

updateVersion().catch(console.error);