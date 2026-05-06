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

/** Shared data structure for a project record */
interface ProjectRow {
  Indicator: string;
  Target: number;
  Progress: number;
  _status: "good" | "stable" | "critical";
  [key: string]: any; // Allow for dynamic spreadsheet columns
}

/** Structure of the AI summary response */
interface AiSummary {
  brief: string;
}

/** The full report object returned by the API */
interface ProjectReport {
  headers: string[];
  rows: ProjectRow[];
  lastUpdate: string;
  aiSummary: AiSummary | null;
}

/** Cloudflare Worker Environment Variables */
interface Env {
  REPORTS_KV: KVNamespace;
  APP_ENV: "development" | "production";
  DEBUG_MODE: "true" | "false";
  FIREBASE_PROJECT_NUMBER: string;
  FIREBASE_PROJECT_ID: string;
  GOOGLE_GENAI_API_KEY: string;
  [key: string]: any;
}
