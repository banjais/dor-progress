import dotenv from 'dotenv';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

dotenv.config({ path: '.dev.vars' });

console.log('Environment variables loaded:');
console.log('TRANSLATION_KV_ID:', process.env.TRANSLATION_KV_ID ? 'SET' : 'NOT SET');
console.log('REPORTS_KV_ID:', process.env.REPORTS_KV_ID ? 'SET' : 'NOT SET');

async function deployWorker() {
  try {
    console.log('Deploying Worker...');
    const { stdout, stderr } = await execFileAsync('./node_modules/.bin/wrangler', [ 'deploy', 'index.ts', '--env-file', '.dev.vars' ], { 
      env: process.env,
      stdio: 'pipe'
    });
    console.log('Worker deployed successfully!');
    console.log(stdout);
    if (stderr) {
      console.error('stderr:', stderr);
    }
  } catch (error) {
    console.error('Deployment failed:', error.message);
    if (error.stderr) {
      console.error('stderr:', error.stderr.toString());
    }
    if (error.stdout) {
      console.error('stdout:', error.stdout.toString());
    }
    process.exit(1);
  }
}

deployWorker();
  } catch (error) {
    console.error('Deployment failed:', error.message);
    if (error.stderr) {
      console.error('stderr:', error.stderr.toString());
    }
    if (error.stdout) {
      console.error('stdout:', error.stdout.toString());
    }
    process.exit(1);
  }
}

deployWorker();