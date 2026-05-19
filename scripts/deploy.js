import { spawn } from 'child_process';
import { execSync } from 'child_process';

const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
  reset: '\x1b[0m'
};

const JOBS = [
  { name: 'Update Version', command: 'npm run update-version' },
  { name: 'NPM Install', command: 'npm ci' },
  { name: 'Lint Code', command: 'npm run lint' },
  { name: 'Typecheck', command: 'npm run typecheck' },
  { name: 'Clean Dist', command: 'npm run clean' },
  { name: 'Build App', command: 'npm run build' },
  { name: 'Deploy Worker', command: 'npm run deploy:worker' },
  { name: 'Deploy Hosting', command: 'npm run deploy:hosting' },
  { name: 'Sync Git', command: 'GIT_SYNC' } // Custom logic below
];

function runJob(job) {
  return new Promise((resolve) => {
    console.log(`\n${colors.bold}${colors.cyan}======================================================================${colors.reset}`);
    console.log(`🚀 ${colors.bold}RUNNING: ${job.name}${colors.reset} (${colors.yellow}${job.command}${colors.reset})`);
    console.log(`${colors.bold}${colors.cyan}======================================================================${colors.reset}\n`);

    if (job.command === 'GIT_SYNC') {
      const result = handleGitSync();
      return resolve(result);
    }

    const parts = job.command.split(' ');
    const cmd = parts[0];
    const args = parts.slice(1);

    const cp = spawn(cmd, args, {
      shell: true,
      stdio: 'inherit',
      env: {
        ...process.env,
        NODE_NO_WARNINGS: '1'
      }
    });

    cp.on('close', (code) => {
      resolve({
        success: code === 0,
        code
      });
    });

    cp.on('error', (err) => {
      resolve({
        success: false,
        error: err.message
      });
    });
  });
}

/**
 * Checks for local changes and pushes to origin
 */
function handleGitSync() {
  // When running inside GitHub Actions, GITHUB_SHA is always present.
  // Skip the commit / push step to avoid rate-limiting, duplicate tags,
  // or any recursive trigger issues — the CI runner already has the code.
  const isCI = Boolean(process.env.GITHUB_SHA);
  const status = execSync('git status --porcelain').toString().trim();
  if (!status || isCI) {
    console.log(isCI
      ? `${colors.yellow}Running in GitHub Actions — skipping git push.${colors.reset}`
      : `${colors.yellow}No local changes to commit.${colors.reset}`);
    return { success: true };
  }

  try {
    const version = JSON.parse(execSync('cat package.json').toString()).version;
    console.log(`${colors.cyan}Syncing version v${version} to Git...${colors.reset}`);

    execSync('git add .');
    execSync(`git commit -m "chore(deploy): release v${version} [skip ci]"`);
    execSync(`git tag -a v${version} -m "Release v${version}"`);
    execSync('git push origin main --tags');

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function runDeploy() {
  const results = [];
  let skippedRemaining = false;

  for (const job of JOBS) {
    if (skippedRemaining) {
      results.push({ name: job.name, status: 'SKIPPED' });
      continue;
    }

    const res = await runJob(job);
    if (res.success) {
      results.push({ name: job.name, status: 'SUCCESS' });
    } else {
      results.push({ name: job.name, status: 'FAILED', reason: res.error || `Exit Code ${res.code}` });
      skippedRemaining = true;
    }
  }

  // Print short, clear deployment summary
  console.log(`\n\n${colors.bold}${colors.cyan}======================================================================${colors.reset}`);
  console.log(`📊 ${colors.bold}DEPLOYMENT JOBS SUMMARY${colors.reset}`);
  console.log(`${colors.bold}${colors.cyan}======================================================================${colors.reset}`);

  let successCount = 0;
  let failCount = 0;
  let skipCount = 0;

  results.forEach((res, index) => {
    let statusText = '';
    if (res.status === 'SUCCESS') {
      statusText = `${colors.green}✅ SUCCESS${colors.reset}`;
      successCount++;
    } else if (res.status === 'FAILED') {
      statusText = `${colors.red}❌ FAILED (${res.reason})${colors.reset}`;
      failCount++;
    } else {
      statusText = `${colors.yellow}⏭️  SKIPPED${colors.reset}`;
      skipCount++;
    }
    console.log(`  [${index + 1}/${JOBS.length}] ${res.name.padEnd(16)} : ${statusText}`);
  });

  console.log(`${colors.bold}${colors.cyan}----------------------------------------------------------------------${colors.reset}`);

  if (failCount === 0) {
    console.log(`🎉 ${colors.bold}${colors.green}ALL DEPLOYMENT JOBS COMPLETED SUCCESSFULLY! (${successCount}/${JOBS.length} passed)${colors.reset}`);
    console.log(`${colors.bold}${colors.cyan}======================================================================${colors.reset}\n`);
    process.exit(0);
  } else {
    console.log(`❌ ${colors.bold}${colors.red}DEPLOYMENT FAILED. ${failCount} job failed, ${skipCount} skipped, ${successCount} succeeded.${colors.reset}`);
    console.log(`${colors.bold}${colors.cyan}======================================================================${colors.reset}\n`);
    process.exit(1);
  }
}

runDeploy().catch((err) => {
  console.error('Fatal deployment error:', err);
  process.exit(1);
});
