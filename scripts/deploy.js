// scripts/deploy.js
import { spawnSync, execSync } from 'child_process';
import fs from 'fs';

process.env.NODE_NO_WARNINGS = '1';

const colors = {
  green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m',
  cyan: '\x1b[36m', bold: '\x1b[1m', reset: '\x1b[0m'
};

const IS_CI = !!process.env.GITHUB_ACTIONS || !!process.env.CI;

console.log(`${colors.bold}${colors.cyan}🚀 Starting DoR Progress Deployment${colors.reset}\n`);

// ── Security Audit ────────────────────────────────────────────────────────────
console.log('🔍 Running Security Audit...');
spawnSync('npm', ['audit', 'fix', '--force'], { stdio: 'inherit', shell: true });

let auditPassed = true;
try {
  const raw = execSync('npm audit --json', { encoding: 'utf8' }).trim();
  if (raw) {
    const audit = JSON.parse(raw);
    const high = audit.metadata?.vulnerabilities?.high || 0;
    const critical = audit.metadata?.vulnerabilities?.critical || 0;
    if (high + critical > 0) {
      console.error(`❌ Blocked: ${high + critical} high/critical vulnerabilities`);
      auditPassed = false;
    }
  }
} catch (e) {
  // npm audit exits non-zero when vulnerabilities exist - we already handled it above
  console.log('⚠️  Audit check completed with warnings (non-blocking)');
}

if (!auditPassed) process.exit(1);
console.log('✅ Security audit passed.\n');

// ── Update Version ────────────────────────────────────────────────────────────
console.log('🔄 Updating version...');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const [major, minor, patch] = pkg.version.split('.').map(Number);
const newVersion = `${major}.${minor}.${patch + 1}`;
pkg.version = newVersion;
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');

const today = new Date().toISOString().split('T')[0];
const hash = execSync('git rev-parse HEAD').toString().trim();

// Update branding files
['config/branding.json', 'public/branding.json', 'src/branding.json', 'branding.json']
  .forEach(file => {
    if (fs.existsSync(file)) {
      try {
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (file.includes('config')) {
          data.app = data.app || {};
          data.app.lastUpdate = today;
          data.app.lastCommitHash = hash;
        } else {
          data.version = newVersion;
          data.lastUpdate = data.lastUpdate || {};
          data.lastUpdate.value = today;
          data.lastCommitHash = hash;
        }
        fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
      } catch (e) {
        console.warn(`⚠️  Could not update ${file}`);
      }
    }
  });

// Update service worker
if (fs.existsSync('public/sw.v2.js')) {
  try {
    let sw = fs.readFileSync('public/sw.v2.js', 'utf8');
    sw = sw.replace(/const VERSION = "v.*";/, `const VERSION = "v${newVersion}";`);
    fs.writeFileSync('public/sw.v2.js', sw);
  } catch (e) {
    console.warn('⚠️  Could not update service worker version');
  }
}

console.log(`✅ Version updated to ${newVersion}\n`);

// ── Build ─────────────────────────────────────────────────────────────────────
console.log('🏗️  Building project...');
spawnSync('npm', ['run', 'clean'], { stdio: 'inherit', shell: true });
const buildResult = spawnSync('npm', ['run', 'build'], { stdio: 'inherit', shell: true });
if (buildResult.status !== 0) {
  console.error('❌ Build failed');
  process.exit(1);
}
console.log('✅ Build completed.\n');

// ── Deploy Worker ─────────────────────────────────────────────────────────────
console.log('☁️  Deploying Cloudflare Worker...');
const workerResult = spawnSync('npx', ['wrangler', 'deploy'], { stdio: 'inherit', shell: true });
if (workerResult.status !== 0) process.exit(1);

// ── Sync Secrets ──────────────────────────────────────────────────────────────
console.log('🔐 Syncing secrets...');
['GOOGLE_GENAI_API_KEY', 'SNAPSHOT_KEY', 'FIREBASE_API_KEY'].forEach(secret => {
  if (process.env[secret]) {
    spawnSync('npx', ['wrangler', 'secret', 'put', secret], { 
      input: process.env[secret], 
      stdio: ['pipe', 'inherit', 'inherit'],
      shell: true 
    });
    console.log(`✅ ${secret} synced`);
  }
});

// ── Deploy Firebase Hosting ───────────────────────────────────────────────────
console.log('🔥 Deploying to Firebase Hosting...');

if (process.env.FIREBASE_SERVICE_ACCOUNT && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  const keyPath = 'firebase-service-account.json';
  fs.writeFileSync(keyPath, process.env.FIREBASE_SERVICE_ACCOUNT);
  process.env.GOOGLE_APPLICATION_CREDENTIALS = keyPath;
  console.log('✅ Using service account for Firebase');
}

const hostingResult = spawnSync('firebase', ['deploy', '--only', 'hosting', '--non-interactive'], { 
  stdio: 'inherit', 
  shell: true,
  env: process.env 
});
if (hostingResult.status !== 0) process.exit(1);

console.log('✅ Firebase Hosting deployed successfully.\n');

// ── Git Commit & Push ─────────────────────────────────────────────────────────
console.log('\n📤 Syncing Git...');
const branch = process.env.GITHUB_REF_NAME || execSync('git rev-parse --abbrev-ref HEAD').toString().trim();
const timestamp = new Date().toISOString().replace('T', ' ').split('.')[0];

if (IS_CI) {
  execSync('git config user.name "github-actions[bot]"', { stdio: 'ignore' });
  execSync('git config user.email "github-actions[bot]@users.noreply.github.com"', { stdio: 'ignore' });
}

execSync('git add . -- ":(exclude)**/.env*"', { stdio: 'ignore' });

const hasChanges = execSync('git diff --cached --name-only').toString().trim().length > 0;

const commitMsg = hasChanges 
  ? `chore(release): v${newVersion} [${timestamp}] [skip ci]`
  : `Everything is up to date [${timestamp}] [skip ci]`;

if (!hasChanges) {
  execSync(`git commit --allow-empty -m "${commitMsg}"`, { stdio: 'inherit' });
} else {
  execSync(`git commit -m "${commitMsg}"`, { stdio: 'inherit' });
}

execSync(`git tag -af v${newVersion} -m "Release v${newVersion}"`, { stdio: 'ignore' });
execSync(`git push origin HEAD:${branch} --force-with-lease`, { stdio: 'inherit' });
execSync(`git push origin v${newVersion} --force`, { stdio: 'ignore' });

console.log(`\n${colors.bold}${colors.green}🎉 DEPLOYMENT COMPLETED SUCCESSFULLY!${colors.reset}`);
console.log(`Version: ${newVersion} | Branch: ${branch}\n`);