import { z } from "zod";

/**
 * =========================================================
 * ENVIRONMENT SCHEMAS (STRICT + SAFE)
 * =========================================================
 */

export const RequiredEnvSchema = z.object({
  GEMINI_API_KEY: z.string(),
  PUBLISHED_SHEET_ID: z.string(),
});

export const OptionalEnvSchema = z.object({
  UPSTASH_REDIS_REST_URL: z.string().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),

  GOOGLE_GENAI_API_KEY: z.string().optional(),

  FIREBASE_PROJECT_ID: z.string().optional(),
  FIREBASE_PROJECT_NUMBER: z.string().optional(),
  FIREBASE_APP_ID: z.string().optional(),
  FIREBASE_API_KEY: z.string().optional(),
  FIREBASE_AUTH_DOMAIN: z.string().optional(),
  FIREBASE_STORAGE_BUCKET: z.string().optional(),
  FIREBASE_MESSAGING_SENDER_ID: z.string().optional(),
  FIREBASE_MEASUREMENT_ID: z.string().optional(),

  SNAPSHOT_KEY: z.string().optional(),
  APP_ENV: z.string().optional(),
  DIGITAL_SIGNATURE: z.string().optional(),
  RECAPTCHA_SITE_KEY: z.string().optional(),
});

export type RequiredEnv = z.infer<typeof RequiredEnvSchema>;
export type OptionalEnv = z.infer<typeof OptionalEnvSchema>;

/**
 * =========================================================
 * SPREADSHEET TYPES
 * =========================================================
 */

export const SpreadsheetHeadersSchema = z.array(z.string());
export type SpreadsheetHeaders = z.infer<typeof SpreadsheetHeadersSchema>;

/**
 * Strict row model for infrastructure + AI systems
 * NO unsafe catch-all any()
 */
export const ProjectRowSchema = z
  .object({
    _status: z.enum(["good", "moderate", "critical", "stable"]).optional(),
    _insight: z.string().optional(),
    _confidence: z.number().min(0).max(1).optional(),
    _source: z.string().optional(),
  })
  .catchall(z.union([z.string(), z.number(), z.boolean(), z.null(), z.undefined()]));

export type ProjectRow = z.infer<typeof ProjectRowSchema>;

/**
 * =========================================================
 * AI OUTPUT SCHEMA (CORE BUSINESS MODEL)
 * =========================================================
 */

export const AiSummarySchema = z.object({
  brief: z.string(),

  model: z.string().optional(),

  overallHealth: z.enum(["good", "moderate", "critical"]).optional(),

  criticalProjects: z.array(z.string()).optional(),

  exceedingProjects: z.array(z.string()).optional(),

  discrepancies: z
    .array(
      z.object({
        text: z.string().min(1),
        severity: z.enum(["low", "medium", "high"]),
      }),
    )
    .optional(),

  extractedData: z
    .object({
      headers: SpreadsheetHeadersSchema,
      rows: z.array(ProjectRowSchema),
      date: z.string().optional(),
    })
    .optional(),
});

export type AiSummary = z.infer<typeof AiSummarySchema>;

/**
 * =========================================================
 * PROJECT REPORT (SYSTEM CORE)
 * =========================================================
 */

export const ProjectReportSchema = z.object({
  created: z.string().optional(),

  headers: SpreadsheetHeadersSchema,

  rows: z.array(ProjectRowSchema),

  lastUpdate: z.string(),

  aiSummary: AiSummarySchema.optional(),

  adminMessage: z.string().optional(),
});

export type ProjectReport = z.infer<typeof ProjectReportSchema>;

/**
 * =========================================================
 * ARCHIVE SYSTEM
 * =========================================================
 */

export const ArchiveMetadataSchema = z.object({
  date: z.string(),
  created: z.string(),
  summary: z.string().optional(),
  bsDate: z.string().optional(),
  recordCount: z.number().min(0),
});

export type ArchiveMetadata = z.infer<typeof ArchiveMetadataSchema>;

/**
 * =========================================================
 * SNAPSHOT REQUEST (SYNC PIPELINE)
 * =========================================================
 */

export const SnapshotRequestSchema = z.object({
  headers: SpreadsheetHeadersSchema.optional(),
  records: z.array(ProjectRowSchema),
  meta: z.object({
    lastUpdate: z.string(),
    total: z.number().min(0),
  }),
});

/**
 * =========================================================
 * CLIENT CONFIG (SAFE FRONTEND CONFIG)
 * =========================================================
 */

export const ClientConfigSchema = z.object({
  firebase: z.object({
    apiKey: z.string(),
    authDomain: z.string(),
    projectId: z.string(),
    storageBucket: z.string(),
    messagingSenderId: z.string(),
    appId: z.string(),
    measurementId: z.string().optional(),
  }),

  recaptchaKey: z.string().optional(),

  digitalSignatureEnabled: z.boolean().optional(),
});

export type ClientConfig = z.infer<typeof ClientConfigSchema>;

/**
 * =========================================================
 * REPORT STATE (UI SAFE)
 * =========================================================
 */

export interface ReportState {
  type: "idle" | "loading" | "success" | "error";
  report?: ProjectReport;
  message?: string;
}

/**
 * =========================================================
 * DASHBOARD STATE (CLEAN + STRICT)
 * =========================================================
 */

export interface DashboardState {
  lang: "en" | "ne" | string;
  view: string;
  search: string;

  sort: {
    key: string | null;
    dir: -1 | 0 | 1;
  };

  reportData: ReportState;

  riskLevel: number;

  uiVolume: number;
  musicVolume: number;

  diffMode: boolean;

  compareReport?: ProjectReport;

  lastFetchTime: number | null;

  history: { value: number }[];

  dynamicCache: Record<string, string>;

  cumulativeReport?: ProjectReport;
  store?: ProjectReport;

  clientConfig?: ClientConfig;

  isAudioMuted: boolean;
  isAudioContextSuspended: boolean;
  isAudioEngineBroken: boolean;

  appCheckFallbackMode: boolean;
  isAppInstalled: boolean;

  performanceMode: boolean;

  dynamicChunkSize: number;
  workerDebounceTime: number;

  isGlitching: boolean;
  lowBatteryMode: boolean;
  isEmergencyOverride: boolean;
  isLogoKicking: boolean;

  signalStrength: 0 | 1 | 2 | 3 | 4 | 5;

  isOnline: boolean;
}

/**
 * =========================================================
 * NUMERAL UTILITIES (SAFE + FAST)
 * =========================================================
 */

const AR_TO_NE = ["०", "१", "२", "३", "४", "५", "६", "७", "८", "९"];

const NE_TO_AR: Record<string, string> = {
  "०": "0",
  "१": "1",
  "२": "2",
  "३": "3",
  "४": "4",
  "५": "5",
  "६": "6",
  "७": "7",
  "८": "8",
  "९": "9",
};

export function toNepaliNumerals(
  num: number | string | null | undefined,
): string {
  if (num === null || num === undefined) return "";

  return String(num).replace(/[0-9]/g, (d: string) => AR_TO_NE[Number(d)]);
}

export function toArabicNumerals(
  str: string | null | undefined,
): string {
  if (str === null || str === undefined) return "";

  return String(str).replace(/[०-९]/g, (d: string) => NE_TO_AR[d] ?? d);
}

/**
 * =========================================================
 * BINARY UTILITIES (WORKER SAFE)
 * =========================================================
 */

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(buffer);

  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }

  return btoa(binary);
}

/**
 * =========================================================
 * DASHBOARD RUNTIME TYPE
 * =========================================================
 */

export interface ReportRuntime {
  loading: boolean;
  error: string | null;
  lastUpdated: string | null;
}