/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
  readonly VITE_BUILD_ID: string;
  readonly VITE_COMMIT_SHA: string;
  readonly VITE_APP_ENV: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare const WORKER_BASE: string;
declare const BUILD_ID: string;
declare const COMMIT_SHA: string;
declare const APP_ENV: "development" | "production" | "test";
declare const APP_VERSION: string;
declare const APP_CHECK_DEBUG_TOKEN: string | boolean | undefined;
