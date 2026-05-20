/**
 * Fix every fixable advisory, then gate the deploy on remaining high/critical only.
 *
 * Background:
 *   npm audit fix --force exits non-zero on ANY unresolved finding (even moderate),
 *   so we always swallow that exit-code.  The final gate is: are high/critical still
 *   in the audit report *after* applying fixes?
 *
 *   npm audit --json throws (non-zero exit) on any non-zero vulnerability, but
 *   emits the JSON on stdout (capturable via the error object's .output[1]).
 */
import { execSync, spawnSync } from 'child_process';

// ── Step 1 – apply every fixable advisory ─────────────────────────────────────
// Always silent; swallow non-zero exit (only means: moderate/low still remain)
spawnSync('npm', ['audit', 'fix', '--force'], { stdio: 'ignore' });

// ── Step 2 – re-read the current audit report as structured JSON ───────────────
// execSync throws on non-zero exit, but stdout (the JSON) lives in err.output[1]
const rawJson = (() => {
  try {
    return execSync('npm audit --json', { encoding: 'utf8', env: { ...process.env, CI: 'true', NODE_NO_WARNINGS: '1' } });
  } catch (err) {
    return err?.output?.[1] ?? '';
  }
})();

// ── Step 3 – count by severity ────────────────────────────────────────────────
const parsed = JSON.parse(rawJson);
const v = (parsed.metadata || {}).vulnerabilities || {};
const highCount = v.high || 0;
const criticalCount = v.critical || 0;
const moderateCount = v.moderate || 0;
const lowCount = v.low || 0;
const infoCount = v.info || 0;
const total = highCount + criticalCount + moderateCount + lowCount + infoCount;

console.log(`\nAudit summary — high: ${highCount}, critical: ${criticalCount}, moderate: ${moderateCount}, low: ${lowCount}, info: ${infoCount} (${total} total)\n`);

// ── Step 4 – fail only on high / critical ─────────────────────────────────────
const blocking = criticalCount + highCount;
if (blocking > 0) {
  console.error(`Blocked: ${blocking} high/critical vulnerability(s) remain.\n`);
  process.exit(1);
}
console.log('Passed: no high/critical vulnerabilities. Moderate/low were tolerated.\n');
