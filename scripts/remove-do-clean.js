import fs from 'fs';
import path from 'path';

const file = path.resolve(process.cwd(), 'index.ts');
const lines = fs.readFileSync(file, 'utf8').split('\n');
const result = [];
let skipBlock = false;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];

  // 1. Skip RATE_LIMITER line in Env interface
  if (line.includes('RATE_LIMITER: DurableObjectNamespace;')) {
    continue;
  }

  // 2. Skip Durable Object health check block (start)
  if (line.includes('// 3. Durable Object Storage Integrity Check')) {
    skipBlock = true;
    continue;
  }

  // 3. Skip lines within DO block
  if (skipBlock) {
    if (line.trim() === '}') {
      skipBlock = false;
    }
    continue;
  }

  // 4. Remove RATE_LIMITER from keys array
  if (line.includes("'TRANSLATION_KV', 'RATE_LIMITER'")) {
    const cleaned = line.replace("'TRANSLATION_KV', 'RATE_LIMITER',", "'TRANSLATION_KV',");
    result.push(cleaned);
    continue;
  }

  // 5. Replace checkRateLimit function entirely
  if (line.includes('async checkRateLimit(clientIp: string, env: Env): Promise<boolean> {')) {
    // Find the closing brace of this function
    result.push(line);
    result.push('  // Rate limiting disabled – Durable Objects not available');
    result.push('  return false;');
    result.push('},');
    // Skip until closing brace
    let braceCount = 1;
    i++;
    while (i < lines.length && braceCount > 0) {
      const nextLine = lines[i];
      braceCount += (nextLine.match(/{/g) || []).length;
      braceCount -= (nextLine.match(/}/g) || []).length;
      i++;
    }
    continue;
  }

  result.push(line);
}

fs.writeFileSync(file, result.join('\n'), 'utf8');
console.log('✅ Durable Objects removed cleanly from index.ts');
