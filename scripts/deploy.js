import { spawn } from 'child_process';

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
  { name: 'NPM Install',    command: 'npm install' },
  { name: 'Lint Code',      command: 'npm run lint' },
  { name: 'Clean Dist',     command: 'npm run clean' },
  { name: 'Build App',      command: 'npm run build' },
  { name: 'Deploy Worker',  command: 'npm run deploy:worker' },
  { name: 'Deploy Hosting', command: 'npm run deploy:hosting' },
  { name: 'Deploy Git',     command: 'npm run deploy:git' }
];

function runJob(job) {
  return new Promise((resolve) => {
    console.log(`\n${colors.bold}${colors.cyan}======================================================================${colors.reset}`);
    console.log(`🚀 ${colors.bold}RUNNING: ${job.name}${colors.reset} (${colors.yellow}${job.command}${colors.reset})`);
    console.log(`${colors.bold}${colors.cyan}======================================================================${colors.reset}\n`);

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
