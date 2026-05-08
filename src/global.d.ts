/**
 * Global type definitions for vendor-prefixed APIs.
 */
interface Window {
  /** Prefix for older WebKit browsers */
  webkitAudioContext: typeof AudioContext;
  /** Prefix for older WebKit browsers */
  webkitSpeechRecognition: any;
  SpeechRecognition: any;
}

import {
  Env as SharedEnv,
  ProjectRow as SharedProjectRow,
  AiSummary as SharedAiSummary,
  ProjectReport as SharedProjectReport,
} from "../shared/types";

declare global {
  interface Env extends SharedEnv {
    PUBLISHED_SHEET_ID: string;
    GOOGLE_GENAI_API_KEY: string;
    REPORTS_KV: KVNamespace;
    FIREBASE_PROJECT_NUMBER: string;
    FIREBASE_PROJECT_ID: string;
    APP_ENV: string;
    DEBUG_MODE: string;
    RECAPTCHA_SITE_KEY: string;
    ADMIN_SECRET: string;
    VITE_API_BASE_URL?: string;
  }
  interface ProjectRow extends SharedProjectRow {}
  interface AiSummary extends SharedAiSummary {}
  interface ProjectReport extends SharedProjectReport {
    created?: string;
  }

  /**
   * Bridge the gap between generic Uint8Arrays and Worker APIs.
   * This helps when libraries return Uint8Array<ArrayBufferLike>.
   */
  type BodyInit =
    | string
    | ArrayBuffer
    | ArrayBufferView
    | ReadableStream
    | FormData
    | URLSearchParams
    | Uint8Array<any>;
}
