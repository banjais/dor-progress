/// <reference types="@cloudflare/workers-types" />

export type ProjectRow = Record<string, string | number>;

export interface SnapshotMetadata {
  date: string;
  recordCount: number;
  checksum: string;
  createdAt: string;
  bsDate?: string;
}

export interface Jwk {
  kty: string;
  alg: string;
  use: string;
  kid: string;
  n: string;
  e: string;
}

export interface Jwks {
  keys: Jwk[];
}

export interface ProjectData {
  records: ProjectRow[];
  meta: { lastUpdate?: string; total?: number };
}

export interface SummaryInput {
  rows: ProjectRow[];
  mainSheet?: Record<string, any>;
  lang: "en" | "ne";
}

export interface AiSummary {
  overallHealth?: "good" | "moderate" | "critical";
  criticalProjects?: string[];
  exceedingProjects?: string[];
  discrepancies?: Array<{ text: string; severity: "low" | "medium" | "high" }>;
  extractedData?: {
    headers: string[];
    rows: ProjectRow[];
  };
  brief: string;
}

export interface ProjectReport {
  headers: string[];
  rows: ProjectRow[];
  lastUpdate: string;
  aiSummary: AiSummary | null;
}

export interface Env {
  TRANSLATION_KV?: KVNamespace;
  REPORTS_KV?: KVNamespace;
  STAGING_TRANSLATION_KV?: KVNamespace;
  STAGING_REPORTS_KV?: KVNamespace;
  PUBLISHED_SHEET_ID: string;
  UPSTASH_REDIS_REST_URL: string;
  UPSTASH_REDIS_REST_TOKEN: string;
  GOOGLE_GENAI_API_KEY: string;
  GEMINI_API_KEY?: string; // Kept for backward compatibility if needed
  FIREBASE_PROJECT_ID?: string;
  FIREBASE_PROJECT_NUMBER?: string;
  FIREBASE_API_KEY?: string;
  FIREBASE_AUTH_DOMAIN?: string;
  FIREBASE_APP_ID?: string;
  FIREBASE_MESSAGING_SENDER_ID?: string;
  FIREBASE_STORAGE_BUCKET?: string;
  FIREBASE_MEASUREMENT_ID?: string;
  RECAPTCHA_SITE_KEY?: string;
  ADMIN_SECRET?: string;
  APP_ENV?: string;
  DEBUG_MODE?: string;
  BUILD_ID?: string;
  COMMIT_SHA?: string;
  DEPLOY_TIMESTAMP?: string;
  // Missing Notification Secrets
  SMTP_SERVER?: string;
  SMTP_USERNAME?: string;
  SMTP_PASSWORD?: string;
  SLACK_WEBHOOK_URL?: string;
  ALERT_RECIPIENT_EMAIL?: string;
}
