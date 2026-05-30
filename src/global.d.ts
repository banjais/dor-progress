/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_ENV: string;
  readonly VITE_APP_CHECK_DEBUG_TOKEN: string;
  readonly VITE_WORKER_BASE: string;
  readonly VITE_FIREBASE_URL: string;
  // Add other VITE_ prefixed environment variables here as needed
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare const WORKER_BASE: string; // Declares the global WORKER_BASE variable
