// scripts/deploy.js
import { spawn } from 'child_process';
import { execSync } from 'child_process';
import fs from 'fs';

const colors = {
  green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m',
  cyan: '\x1b[36m', bold: '\x1b[1m', reset: '\x1b[0m'
};

const JOBS = [
  { name: 'Update Version', command: 'npm run update-version' },
  { name: 'Install Dependencies', command: 'npm ci' },
  { name: 'Security Audit', command: 'node --no-deprecation scripts/audit-check.js' },
  { name: 'Lint & Typecheck', command: 'npm run lint && npm run typecheck' },
  { name: 'Clean', command: 'npm run clean' },
  { name: 'Build', command: 'npm run build' },
  { name: 'Deploy Worker', command: 'npm run deploy:worker' },
  { name: 'Deploy Hosting', command: 'npm run deploy:hosting' },
  { name: 'Git Sync', command: 'GIT_SYNC' }
];

function runJob(job) {
  return new Promise((resolve) => {
    console.log(`\n${colors.bold}${colors.cyan}════════════════════════════════════════════════════════════${colors.reset}`);
    console.log(`🚀 ${colors.bold}${job.name}${colors.reset}`);
    console.log(`   ${colors.yellow}${job.command}${colors.reset}`);
    console.log(`${colors.bold}${colors.cyan}════════════════════════════════════════════════════════════${colors.reset}\n`);

    if (job.command === 'GIT_SYNC') {
      return resolve(handleGitSync());
    }

    const [cmd, ...args] = job.command.split(' ');
    const cp = spawn(cmd, args, { shell: true, stdio: 'inherit' });

    cp.on('close', (code) => resolve({ success: code === 0, code }));
    cp.on('error', (err) => resolve({ success: false, error: err.message }));
  });
}

function handleGitSync() {
  const isCI = !!process.env.GITHUB_SHA;
  const branch = process.env.GITHUB_REF_NAME || 'local';
  const allowCiPush = process.env.ALLOW_CI_PUSH === 'true';

  // Guard: Only allow git sync in CI if explicitly allowed AND we are on the main branch
  if (isCI && (!allowCiPush || branch !== 'main')) {
    console.log(`${colors.yellow}→ skipping git commit/push (CI: ${isCI}, Branch: ${branch}, Allowed: ${allowCiPush})${colors.reset}`);
    return { success: true };
  }

  if (isCI) {
    console.log(`${colors.cyan}→ Diagnostic: Verifying CI environment permissions...${colors.reset}`);
    try {
      // This will print the active account and token scopes to the logs
      execSync('git config --get user.name || echo "No git user.name configured"', { stdio: 'inherit' });
      execSync('gh auth status', { stdio: 'inherit' });
    } catch (e) { /* Diagnostic failed, likely gh CLI not authenticated in this env */ }
  }

  // Proceed with git commit/push (Local or Authorized CI)
  try {
    const status = execSync('git status --porcelain').toString().trim();
    if (!status) {
      console.log(`${colors.yellow}→ No changes to commit${colors.reset}`);
      return { success: true };
    }

    const version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
    execSync('git add . -- :!*.env');
    execSync(`git commit -m "chore(release): v${version} [skip ci]"`);
    execSync(`git tag -a v${version} -m "Release v${version}"`);
    execSync('git push origin main --tags');

    console.log(`${colors.green}✓ Successfully tagged and pushed v${version}${colors.reset}`);
    return { success: true };
  } catch (err) {
    console.error(`${colors.red}Git sync failed:${colors.reset}`, err.message);
    return { success: false, error: err.message };
  }
}

async function main() {
  console.log(`${colors.bold}${colors.cyan}🚀 Starting DoR Progress Deployment${colors.reset}\n`);

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