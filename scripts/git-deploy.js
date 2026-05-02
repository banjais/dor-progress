import { execSync } from 'child_process';

try {
  // Get current branch
  let currentBranch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
  
  // If on master, rename to main locally and push
  if (currentBranch === 'master') {
    try {
      execSync('git branch -m main', { stdio: 'inherit' });
      console.log('✅ Renamed local branch from master to main');
      currentBranch = 'main';
    } catch (e) {
      // Branch might already exist or other issue, continue
    }
  }
  
  // Push to main
  try {
    execSync('git push -u origin main', { stdio: 'inherit' });
    console.log('✅ Pushed to origin/main');
  } catch (e) {
    // Try regular push if upstream already set
    execSync('git push', { stdio: 'inherit' });
    console.log('✅ Pushed to origin');
  }
} catch (err) {
  console.error('❌ Git deploy failed:', err.message);
  process.exit(1);
}