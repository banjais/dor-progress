// scripts/deploy.js
import { spawn, spawnSync, execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

// Silence Node.js deprecation warnings (like the punycode warning in Node 21+) 
// to keep the deployment logs clean.
process.env.NODE_NO_WARNINGS = '1';

const colors = {
  green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m',
  cyan: '\x1b[36m', bold: '\x1b[1m', reset: '\x1b[0m'
};

const IS_CI = !!process.env.GITHUB_ACTIONS || !!process.env.CI || !!process.env.GITHUB_SHA;

// Locally, try to load environment variables from .env files if they aren't already set.
// This prevents "MISSING" prints when running outside of GitHub Actions.
if (!IS_CI) {
  const envFiles = ['.env.production', '.env.development', '.env.local', '.env', 'src/.env.production', 'src/.env.development'];
  for (const file of envFiles) {
    if (fs.existsSync(file)) {
      const content = fs.readFileSync(file, 'utf8');
      const lines = content.split(/\r?\n/);
      let currentKey = null;
      let currentValue = [];

      for (const line of lines) {
        const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?$/);
        if (match) {
          const key = match[1];
          const val = (match[2] || '').trim();
          // Handle start of multi-line quoted value
          if (val.startsWith('"') && !val.endsWith('"')) {
            currentKey = key;
            currentValue = [val.slice(1)];
          } else if (!process.env[key]) {
            process.env[key] = val.replace(/^["'](.*)["']$/, '$1');
          }
        } else if (currentKey) {
          // Handle end of multi-line quoted value
          if (line.trim().endsWith('"')) {
            currentValue.push(line.trim().slice(0, -1));
            if (!process.env[currentKey]) process.env[currentKey] = currentValue.join('\n');
            currentKey = null;
          } else {
            currentValue.push(line);
          }
        }
      }

      if (process.env.VERBOSE === 'true') {
        console.log(`${colors.yellow}💡 Loaded environment from ${file}${colors.reset}`);
      }
    }
  }
}

const SKIP_PRE_DEPLOY_CHECKS = String(process.env.SKIP_PRE_DEPLOY_CHECKS).toLowerCase() === 'true';

const JOBS = [
  { name: 'Install Dependencies', command: IS_CI ? 'echo "Skipping: already installed by workflow."' : 'npm install --prefer-offline --no-audit' },
  { name: 'Workflow Validation', command: SKIP_PRE_DEPLOY_CHECKS ? 'echo "Skipping: verified in CI workflow."' : 'node scripts/validate-workflow.js' },
  { name: 'Worker Type-Check', command: SKIP_PRE_DEPLOY_CHECKS ? 'echo "Skipping: verified in CI workflow."' : 'npm run typecheck:worker' },
  { name: 'Lint & Typecheck', command: SKIP_PRE_DEPLOY_CHECKS ? 'echo "Skipping: verified in CI workflow."' : 'npm run lint && npm run typecheck' },
  { name: 'Security Audit', command: SKIP_PRE_DEPLOY_CHECKS ? 'echo "Skipping: verified in CI workflow."' : 'node scripts/audit-check.js' },
  { name: 'Update Version', command: 'npm run update-version' },
  { name: 'Clean', command: 'npm run clean' },
  { name: 'Build', command: 'npm run build' },
  { name: 'Sync Worker Secrets', command: 'node scripts/sync-worker-secrets.js' },
  { name: 'Deploy Worker', command: 'npm run deploy:worker' },
  { name: 'Deploy Hosting', command: 'npm run deploy:hosting' },
  { name: 'Git Sync', command: 'GIT_SYNC' }
];

// List of environment variable keys that should never appear in logs
const SENSITIVE_KEYS = [
  'CLOUDFLARE_API_TOKEN',
  'GOOGLE_GENAI_API_KEY',
  'FIREBASE_SERVICE_ACCOUNT',
  'SNAPSHOT_KEY'
];

function maskSensitive(text) {
  if (!text) return text;
  return SENSITIVE_KEYS.reduce((acc, key) => {
    const val = process.env[key];
    return val ? acc.split(val).join('********') : acc;
  }, text);
}

function runJob(job) {
  return new Promise((resolve) => {
    console.log(`\n${colors.bold}${colors.cyan}════════════════════════════════════════════════════════════${colors.reset}`);
    console.log(`🚀 ${colors.bold}${job.name}${colors.reset}`);
    console.log(`   ${colors.yellow}${maskSensitive(job.command)}${colors.reset}`);
    console.log(`${colors.bold}${colors.cyan}════════════════════════════════════════════════════════════${colors.reset}\n`);

    if (job.command === 'GIT_SYNC') {
      return resolve(handleGitSync());
    }

    const cp = spawn(job.command, { shell: true, stdio: 'inherit' });

    cp.on('close', (code) => resolve({ success: code === 0, code }));
    cp.on('error', (err) => resolve({ success: false, error: err.message }));
  });
}

function handleGitSync() {
  let branch = process.env.GITHUB_REF_NAME;
  if (!branch) {
    try {
      branch = execSync('git rev-parse --abbrev-ref HEAD').toString().trim();
    } catch (e) {
      branch = 'local';
    }
  }
  const allowCiPush = process.env.ALLOW_CI_PUSH === 'true';

  // Guard: Only allow git sync in CI if explicitly allowed AND we are on the main branch.
  // Also prevent syncing if this is a Pull Request build to avoid polluting main.
  const isPR = process.env.GITHUB_EVENT_NAME === 'pull_request';

  if (IS_CI && (!allowCiPush || branch !== 'main' || isPR)) {
    console.log(`${colors.yellow}→ skipping git commit/push (CI: ${IS_CI}, Branch: ${branch}, PR: ${isPR}, Allowed: ${allowCiPush})${colors.reset}`);
    return { success: true };
  }

  if (IS_CI) {
    console.log(`${colors.cyan}→ Configuring Git identity for CI...${colors.reset}`);
    try {
      // Ensure git user is configured so commit doesn't fail
      execSync('git config user.name "github-actions[bot]"');
      execSync('git config user.email "github-actions[bot]@users.noreply.github.com"');
    } catch (e) {
      console.warn(`${colors.yellow}⚠️ Failed to configure git identity, commit might fail.${colors.reset}`);
    }
  }

  // Proceed with git commit/push (Local or Authorized CI)
  try {
    const status = execSync('git status --porcelain').toString().trim();
    if (!status) {
      console.log(`${colors.yellow}→ No changes to commit${colors.reset}`);
      return { success: true };
    }

    const version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;

    // 1. Safety Unstage: Attempt to remove any .env files from the index globally.
    // We use a try/catch because this might fail if no files match or if the repo is in a specific state.
    try {
      execSync('git reset HEAD -- "**/.env*" ".env*" "src/.env*" "public/.env*"', { stdio: 'ignore' });
    } catch (e) { /* ignore */ }

    // 2. Recursive Exclusion: Stage all changes except any file matching .env anywhere in the tree.
    // The ':(exclude)**/.env*' pathspec is the most robust way to handle global exclusions in Git.
    execSync('git add . -- ":(exclude)**/.env*"');

    // Check if there are actually any changes staged after filtering out secrets.
    const staged = execSync('git diff --cached --name-only').toString().trim();
    if (!staged) {
      console.log(`${colors.yellow}→ No non-sensitive changes to commit (skipping sync)${colors.reset}`);
      return { success: true };
    }

    // 3. Verification Guard: Final check of the index. If a .env file is found, we abort immediately.
    const stagedSecrets = execSync('git diff --cached --name-only').toString().split('\n').filter(f => f.includes('.env'));
    if (stagedSecrets.length > 0 && stagedSecrets[0] !== '') {
      throw new Error(`Security Guard: Aborting commit. Sensitive files detected in git index: ${stagedSecrets.join(', ')}`);
    }

    execSync(`git commit -m "chore(release): v${version} [skip ci] [ci skip]"`);
    // Use -f to overwrite tag if it exists locally from a previous failed run
    execSync(`git tag -af v${version} -m "Release v${version}"`);

    console.log(`${colors.cyan}→ Pushing to origin...${colors.reset}`);
    execSync(`git push origin HEAD:${branch}`);
    execSync(`git push origin v${version} --force`);

    console.log(`${colors.green}✓ Successfully tagged and pushed v${version}${colors.reset}`);
    return { success: true };
  } catch (err) {
    console.error(`${colors.red}Git sync failed:${colors.reset}`, err.message);
    return { success: false, error: err.message };
  }
}

async function verifyCloudflareToken() {
  const token = process.env.CLOUDFLARE_API_TOKEN;

  if (!token) {
    if (IS_CI) {
      console.error(`   ${colors.red}❌ Error: CLOUDFLARE_API_TOKEN is missing in CI.${colors.reset}`);
      return false;
    }
    console.log(`   ${colors.yellow}⚠️  No CLOUDFLARE_API_TOKEN found. Proceeding with local session...${colors.reset}`);
    return true;
  }

  // We skip 'wrangler whoami' because it requires 'User:Read' permissions 
  // which deployment tokens usually don't have. If the token is invalid, 
  // the 'Deploy Worker' job will fail with a clear error anyway.
  console.log(`   ${colors.green}✅ CLOUDFLARE_API_TOKEN is present.${colors.reset}`);
  return true;
}

async function verifyFirebaseAccess() {
  let projectId = process.env.VITE_FIREBASE_PROJECT_ID;

  // Fallback: try to read from .firebaserc if the environment variable is missing
  if (!projectId && fs.existsSync('.firebaserc')) {
    try {
      const rc = JSON.parse(fs.readFileSync('.firebaserc', 'utf8'));
      projectId = rc.projects?.default;
    } catch (e) { /* ignore parse errors */ }
  }

  projectId = projectId || 'dor-progress';

  let tempKeyPath = null;
  let originalGoogleCreds = process.env.GOOGLE_APPLICATION_CREDENTIALS;

  try {
    if (!IS_CI && process.env.FIREBASE_SERVICE_ACCOUNT && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      try {
        // Validate that the service account string is actual JSON before trying to use it
        JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

        console.log(`   ${colors.cyan}📝 Using FIREBASE_SERVICE_ACCOUNT for local Firebase authentication.${colors.reset}`);
        tempKeyPath = 'temp-firebase-key.json';
        fs.writeFileSync(tempKeyPath, process.env.FIREBASE_SERVICE_ACCOUNT);
        process.env.GOOGLE_APPLICATION_CREDENTIALS = path.resolve(tempKeyPath);
      } catch (e) {
        console.log(`   ${colors.yellow}⚠️  FIREBASE_SERVICE_ACCOUNT found but is not valid JSON. Falling back to CLI session...${colors.reset}`);
      }
    }

    if (!IS_CI && !process.env.FIREBASE_SERVICE_ACCOUNT && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      console.log(`   ${colors.cyan}📡 Checking Firebase session for project: ${colors.bold}${projectId}${colors.reset}...`);
    }

    if (IS_CI && !process.env.GOOGLE_APPLICATION_CREDENTIALS && !process.env.FIREBASE_TOKEN) {
      console.error(`   ${colors.red}❌ Error: Firebase credentials missing in CI.${colors.reset}`);
      return false;
    }

    if (IS_CI || SKIP_PRE_DEPLOY_CHECKS) {
      console.log(`   ${colors.green}✅ Firebase credentials are present.${colors.reset}`);
      return true;
    }

    // Capture all output for better error reporting.
    // Note: projects:list verifies access to the account.
    const result = spawnSync('npx', ['firebase', 'projects:list'], {
      shell: true,
      encoding: 'utf8',
      env: process.env
    });

    if (result.status !== 0) {
      const output = (result.stdout + (result.stderr || '')).trim();
      const errorDetail = output.split('\n')[0] || 'Check if you are logged in (npx firebase login)';
      console.error(`   ${colors.red}❌ Firebase access validation failed: ${errorDetail}${colors.reset}`);
      return false;
    }

    // Verify the expected project is in the list
    if (!result.stdout.includes(projectId)) {
      console.error(`   ${colors.red}❌ Firebase access validation failed: Project "${projectId}" not found in accessible projects.${colors.reset}`);
      return false;
    }

    console.log(`   ${colors.green}✅ Firebase access is valid.${colors.reset}`);
    return true;
  } finally {
    if (tempKeyPath && fs.existsSync(tempKeyPath)) {
      fs.unlinkSync(tempKeyPath);
      process.env.GOOGLE_APPLICATION_CREDENTIALS = originalGoogleCreds; // Restore original value
    }
  }
}

async function main() {
  console.log(`${colors.bold}${colors.cyan}🚀 Starting DoR Progress Deployment${colors.reset}\n`);

  if (process.env.VERBOSE === 'true') {
    console.log(`${colors.bold}🔍 Environment Verification:${colors.reset}`);
    SENSITIVE_KEYS.forEach(key => {
      const val = process.env[key];
      const status = val ? `${colors.green}PRESENT${colors.reset} (length: ${val.length})` : `${colors.red}MISSING${colors.reset}`;
      console.log(`   - ${key.padEnd(25)}: ${status}`);
    });
  }

  if (!(await verifyCloudflareToken()) || !(await verifyFirebaseAccess())) {
    console.error(`\n${colors.red}❌ Authentication check failed. Deployment aborted.${colors.reset}\n`);
    process.exit(1);
  }

  let hasFailed = false;
  const results = [];

  for (const job of JOBS) {
    if (hasFailed) {
      results.push({ name: job.name, status: 'SKIPPED' });
      continue;
    }

    const res = await runJob(job);
    results.push({ name: job.name, status: res.success ? 'SUCCESS' : 'FAILED' });

    if (!res.success) hasFailed = true;
  }

  // Final Summary
  console.log(`\n${colors.bold}${colors.cyan}═══════════════ DEPLOYMENT SUMMARY ═══════════════${colors.reset}`);
  results.forEach((r, i) => {
    const icon = r.status === 'SUCCESS' ? '✅' : r.status === 'FAILED' ? '❌' : '⏭️';
    console.log(` ${String(i + 1).padStart(2)}. ${r.name.padEnd(24)} ${icon} ${r.status}`);
  });

  if (!hasFailed) {
    console.log(`\n${colors.bold}${colors.green}🎉 DEPLOYMENT COMPLETED SUCCESSFULLY!${colors.reset}\n`);
    process.exit(0);
  } else {
    console.log(`\n${colors.bold}${colors.red}❌ DEPLOYMENT FAILED${colors.reset}\n`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});