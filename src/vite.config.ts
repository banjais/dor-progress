import { defineConfig } from 'vite';
import { resolve } from 'node:path';

/**
 * Vite configuration for Dor‑Progress.
 * It loads environment variables prefixed with `VITE_` from .env files,
 * makes them available to the client via `import.meta.env`, and proxies
 * `/api` requests to the appropriate Cloudflare Worker URL.
 *
 * Development mode expects a local worker (`VITE_WORKER_BASE`).
 * Production mode expects the public worker endpoint (`VITE_API_BASE_URL`).
 */
export default defineConfig(({ mode }) => {
  // Vite automatically reads .env files and injects any VITE_ prefixed vars.
  const env = process.env;

  // Choose the proper base URL depending on the mode.
  const apiBaseUrl = mode === 'production' ? env.VITE_API_BASE_URL : env.VITE_WORKER_BASE;

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
    // Make the variable available in the client bundle.
    define: {
      'import.meta.env.VITE_API_BASE_URL': JSON.stringify(env.VITE_API_BASE_URL ?? ''),
      'import.meta.env.VITE_WORKER_BASE': JSON.stringify(env.VITE_WORKER_BASE ?? ''),
      'import.meta.env.VITE_FIREBASE_URL': JSON.stringify(env.VITE_FIREBASE_URL ?? '')
    },
  };
});