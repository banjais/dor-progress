import fs from 'fs';
import path from 'path';

const versionFilePath = path.join(process.cwd(), 'VERSION');
const packageJsonPath = path.join(process.cwd(), 'package.json');

// Read current version from VERSION file
let currentVersion = fs.readFileSync(versionFilePath, 'utf8').trim();
console.log(`Current version: ${currentVersion}`);

// Parse version (assuming semantic versioning: major.minor.patch)
const [major, minor, patch] = currentVersion.split('.').map(Number);
const newVersion = `${major}.${minor}.${patch + 1}`;
console.log(`New version: ${newVersion}`);

// Update VERSION file
fs.writeFileSync(versionFilePath, newVersion + '\n');

// Update package.json
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
packageJson.version = newVersion;
fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');

console.log('Version updated successfully.');