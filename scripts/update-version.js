import fs from 'fs/promises';
import path from 'path';

async function updateVersion() {
  const versionFilePath = path.join(process.cwd(), 'VERSION');
  const packageJsonPath = path.join(process.cwd(), 'package.json');

  // Read current version from VERSION file
  let currentVersion = await fs.readFile(versionFilePath, 'utf8');
  currentVersion = currentVersion.trim();
  console.log(`Current version: ${currentVersion}`);

  // Parse version (assuming semantic versioning: major.minor.patch)
  const [major, minor, patch] = currentVersion.split('.').map(Number);
  const newVersion = `${major}.${minor}.${patch + 1}`;
  console.log(`New version: ${newVersion}`);

  // Update VERSION file
  await fs.writeFile(versionFilePath, newVersion + '\n');

  // Update package.json
  const packageJsonContent = await fs.readFile(packageJsonPath, 'utf8');
  const packageJson = JSON.parse(packageJsonContent);
  packageJson.version = newVersion;
  await fs.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');

  console.log('Version updated successfully.');
}

updateVersion().catch(console.error);