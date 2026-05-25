import { defineConfig, loadEnv } from 'vite';
import { resolve } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

/**
 * Standard root-level Vite configuration.
 * This file automatically picks up .env files in the same directory.
 */
export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory (root).
  const env = loadEnv(mode, process.cwd(), '');

  // Priority: 1. Env Variable, 2. Default Local Wrangler Port
  const apiBaseUrl = env.VITE_WORKER_BASE || 'http://localhost:8787';

  // --- Branding Automation ---
  if (mode === 'production') {
    try {
      const brandingPath = resolve(__dirname, 'public/branding.json');
      const branding = JSON.parse(readFileSync(brandingPath, 'utf-8'));

      // Auto-update commit hash and date
      branding.lastCommitHash = execSync('git rev-parse --short HEAD').toString().trim();
      branding.lastUpdate.value = new Date().toISOString().split('T')[0];

      writeFileSync(brandingPath, JSON.stringify(branding, null, 2) + '\n');
      console.log(`[Build] Updated branding.json to commit ${branding.lastCommitHash}`);
    } catch (e) {
      console.warn('[Build] Failed to update branding.json metadata:', e);
    }
  }
  // ---------------------------

  return {
    // Define global constants for build-time injection
    define: {
      WORKER_BASE: JSON.stringify(apiBaseUrl),
    },
    resolve: {
      alias: {
        // Points '@' to the 'src' directory
        '@': resolve(__dirname, './src'),
      },
    },
    server: {
      proxy: {
        '/api': {
          target: apiBaseUrl,
          changeOrigin: true,
          secure: false,
        },
      },
    },
  };
});