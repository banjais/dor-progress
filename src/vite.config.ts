import { defineConfig, loadEnv } from 'vite';
import { resolve } from 'node:path';

/**
 * Vite configuration for Dor‑Progress.
 * It loads environment variables prefixed with `VITE_` from .env files,
 * makes them available to the client via `import.meta.env`, and proxies
 * `/api` requests to the appropriate Cloudflare Worker URL.
 *
 * Development mode expects a local worker (`VITE_WORKER_BASE`).
 * Production mode expects the public worker endpoint (`VITE_WORKER_BASE`).
 */
export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  // Set the third parameter to '' to load all env regardless of the `VITE_` prefix.
  const env = loadEnv(mode, process.cwd(), '');

  // Using VITE_WORKER_BASE as the primary API target per the updated secrets list.
  const apiBaseUrl = env.VITE_WORKER_BASE || '';

  return {
    // Resolve path aliases for convenience.
    resolve: {
      alias: {
        '@': resolve(__dirname, './src'),
      },
    },
    // Proxy all /api calls to the worker URL during development.
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