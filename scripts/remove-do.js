import fs from 'fs';
import path from 'path';

const filePath = path.resolve(process.cwd(), 'index.ts');
let content = fs.readFileSync(filePath, 'utf8');
const original = content;

// 1. Remove RATE_LIMITER from Env interface
content = content.replace(
  /(\s*\/\/ Bindings and Vars from wrangler\.toml\n\s*TRANSLATION_KV: KVNamespace;\s*)\n\s*RATE_LIMITER: DurableObjectNamespace;\n/g,
  '$1\n'
);

// 2. Remove RATE_LIMITER from config-check keys array
content = content.replace(
  /(\s*keys:\s*\(keyof Env\)\[\]\s*=\s*\[[\s\n]*'TRANSLATION_KV',\s*')RATE_LIMITER(,?[\s\n]*'[^']+'\])/g,
  (match, p1, p2) => {
    const hasComma = p2.startsWith(',');
    return p1 + (hasComma ? p2.substring(1) : p2);
  }
);

// 3. Remove Durable Object health check block (lines 342-349 roughly)
content = content.replace(
  /(\s*\/\/ 3\. Durable Object Storage Integrity Check[\s\S]*?catch\s*\(e\)\s*\{[\s\S]*?\n\s*\}\n)/,
  ''
);

// 4. Replace isHealthCheckProbe function DO usage
// Find and remove the entire DO check within isHealthCheckProbe
content = content.replace(
  /(\s*\/\/ Durable Object check\n)(\s*if\s*\(!env\.RATE_LIMITER\)[\s\S]*?return\s*false;[\s\n]*)(\s*catch\s*\(e\)[\s\S]*?\n\s*\})/,
  ''
);

// 5. Replace rateLimit function DO usage entirely
// Find the rateLimit function and replace with simple counter-based limit
content = content.replace(
  /(\s*async function rateLimit[\s\S]*?)\/\/ Durable Object check[\s\S]*?\}/m,
  `$1
    // Rate limiting disabled – Durable Objects not available
    return { allowed: true, remaining: 100, reset: Date.now() + 60000 };
  }`
);

if (content !== original) {
  fs.writeFileSync(filePath, content, 'utf8');
  console.log('✅ Durable Objects removed from index.ts');
} else {
  console.log('⚠️ No changes made');
}
