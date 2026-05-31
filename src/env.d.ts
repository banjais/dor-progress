/// <reference types="vite/client" />

/**
 * =========================================================
 * GLOBALS (Worker / runtime injected variables)
 * =========================================================
 */
declare const WORKER_BASE: string;

/**
 * =========================================================
 * VITE ENV TYPES (Type-safe import.meta.env)
 * =========================================================
 */
interface ImportMetaEnv {
  readonly VITE_APP_ENV: string;

  /**
   * Base URL of Cloudflare Worker / API backend
   */
  readonly VITE_WORKER_BASE: string;

  /**
   * Firebase / App Check debug token (optional)
   */
  readonly VITE_APP_CHECK_DEBUG_TOKEN?: string;

  /**
   * Firebase configuration
   */
  readonly VITE_FIREBASE_URL: string;
  readonly VITE_FIREBASE_PROJECT_ID: string;
}

/**
 * =========================================================
 * VITE MODULE AUGMENTATION
 * =========================================================
 */
interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/**
 * =========================================================
 * ASSET MODULE SUPPORT
 * =========================================================
 */
declare module "*.css";
declare module "*.svg";
declare module "*.png";
declare module "*.jpg";
declare module "*.jpeg";
declare module "*.webp";