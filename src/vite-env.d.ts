/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_ENV: 'development' | 'production' | 'test';
  readonly VITE_WORKER_BASE: string;
  readonly VITE_FIREBASE_URL: string;
  readonly VITE_APP_CHECK_DEBUG_TOKEN?: string;
  // Add other VITE_ variables here...
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}