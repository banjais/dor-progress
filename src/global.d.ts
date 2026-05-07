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
  interface Env extends SharedEnv {}
  interface ProjectRow extends SharedProjectRow {}
  interface AiSummary extends SharedAiSummary {}
  interface ProjectReport extends SharedProjectReport {}
}
