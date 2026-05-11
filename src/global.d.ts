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
    // Specific overrides for global scope if necessary, otherwise inherits SharedEnv
    VITE_API_BASE_URL?: string;
    MONITORING_SECRET?: string; // Add this line
  }
  type ProjectRow = SharedProjectRow;
  type AiSummary = SharedAiSummary;
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
