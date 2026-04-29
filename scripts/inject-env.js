#!/usr/bin/env node

/**
 * Environment Injector
 * Replaces __PLACEHOLDER__ tokens in static files with environment variables.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveValue(envKey, fallbackFn) {
  if (process.env[envKey]) {
    return process.env[envKey];
  }

  try {
    const devVarsPath = path.resolve(process.cwd(), '.dev.vars');
    if (fs.existsSync(devVarsPath)) {
      const content = fs.readFileSync(devVarsPath, 'utf8');
      const match = content.match(new RegExp(`^${envKey}=(.*)$`, 'm'));
      if (match) return match[1];
    }
  } catch {}
  return fallbackFn();
}

function getGitSha() {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'local';
  }
}

function getBuildId(sha) {
  const timestamp = Date.now().toString(36).slice(-6);
  return `${timestamp}-${sha}`;
}

const commitSha = getGitSha();
const buildId = getBuildId(commitSha);

const values = {
  '__API_BASE_URL__': resolveValue('API_BASE_URL', () => ''),
  '__BUILD_ID__': resolveValue('BUILD_ID', () => buildId),
  '__COMMIT_SHA__': resolveValue('COMMIT_SHA', () => commitSha)
};

console.log('🔧 Injecting environment variables into static assets...');
console.table(values);

const targetDir = process.argv[2] ? path.resolve(process.cwd(), process.argv[2]) : path.resolve(process.cwd(), 'public');

const filesToInject = [
  path.join(targetDir, 'index.html'),
  path.join(targetDir, 'sw.v2.js')
];

let changed = 0;

for (const filePath of filesToInject) {
  if (!fs.existsSync(filePath)) {
    console.warn(`⚠️  File not found: ${filePath}`);
    continue;
  }

  let content = fs.readFileSync(filePath, 'utf8');
  let fileChanged = false;

  for (const [placeholder, value] of Object.entries(values)) {
    if (content.includes(placeholder)) {
      const escaped = placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      content = content.replace(new RegExp(escaped, 'g'), value);
      fileChanged = true;
    }
  }

  if (fileChanged) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`✅ Injected: ${path.relative(process.cwd(), filePath)}`);
    changed++;
  } else {
    console.log(`➖ No changes: ${path.relative(process.cwd(), filePath)}`);
  }
}

console.log(`\n✨ Injection complete. ${changed} file(s) updated.`);
process.exit(0);
