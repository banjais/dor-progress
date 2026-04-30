#!/usr/bin/env node

/**
 * Remove Durable Objects from worker code
 * - Removes RATE_LIMITER from Env interface
 * - Removes DurableObjectNamespace import if not used elsewhere
 * - Removes health check DO usage
 * - Removes from config-check keys
 */

import fs from 'fs';
import path from 'path';

const filePath = path.resolve(process.cwd(), 'index.ts');
const content = fs.readFileSync(filePath, 'utf8');
let modified = false;

// 1. Remove RATE_LIMITER from Env interface
let newContent = content.replace(
  /(\s*\/\/ Bindings and Vars from wrangler\.toml\n\s*TRANSLATION_KV: KVNamespace;\s*)\n\s*RATE_LIMITER: DurableObjectNamespace;/,
  '$1\n    // RATE_LIMITER removed – Durable Objects not in use'
);

if (newContent !== content) {
  modified = true;
  console.log('✅ Removed RATE_LIMITER from Env interface');
}

// 2. Remove DurableObjectNamespace import if now unused
newContent = newContent.replace(
  /import\s*\{[^}]*DurableObjectNamespace[^}]*\}/,
  match => {
    // Check if DurableObjectNamespace appears elsewhere
    const withoutImport = newContent.replace(match, '');
    if (withoutImport.includes('DurableObjectNamespace')) {
      return match; // still used elsewhere
    }
    return '';
  }
);

// 3. Remove DO health check block (lines ~342-349)
newContent = newContent.replace(
  /(\s*\/\/ 3\. Durable Object Storage Integrity Check\n\s*\/\/ [^\n]*\n[\s\S]*?\s*\).*?\n)/,
  ''
);

if (newContent !== content) {
  modified = true;
  console.log('✅ Removed Durable Object health check');
}

// 4. Remove RATE_LIMITER from config-check keys array
newContent = newContent.replace(
  /(\s*keys:\s*\(keyof Env\)\[\]\s*=\s*\[[\s\n]*'TRANSLATION_KV',\s*')RATE_LIMITER(,?[\s\n]*'[^']+'\])/,
  (match, p1, p2) => {
    // If there's a comma after, remove the comma and entry
    return p1.trim() + (p2.startsWith(',') ? p2.substring(1) : p2);
  }
);

if (newContent !== content) {
  modified = true; // may have changed
}

// 5. Remove any other direct RATE_LIMITER usage (stub fetch calls)
const rateLimiterPattern = /env\.RATE_LIMITER\.idFromName\([^)]+\)/g;
if (rateLimiterPattern.test(newContent)) {
  newContent = newContent.replace(rateLimiterPattern, '/* RATE_LIMITER removed */');
  modified = true;
  console.log('✅ Removed RATE_LIMITER.idFromName calls');
}

const getStubPattern = /env\.RATE_LIMITER\.get\([^)]+\)/g;
if (getStubPattern.test(newContent)) {
  newContent = newContent.replace(getStubPattern, '/* RATE_LIMITER removed */');
  modified = true;
  console.log('✅ Removed RATE_LIMITER.get calls');
}

const stubFetchPattern = /stub\.fetch\([^)]+\)/g;
if (stubFetchPattern.test(newContent)) {
  newContent = newContent.replace(stubFetchPattern, '/* RATE_LIMITER removed */');
  modified = true;
  console.log('✅ Removed stub.fetch calls');
}

if (modified) {
  fs.writeFileSync(filePath, newContent, 'utf8');
  console.log('✨ Durable Objects removed from worker code');
} else {
  console.log('⚠️ No changes made – check if RATE_LIMITER usage exists');
}
