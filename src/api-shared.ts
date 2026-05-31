import { z } from "zod";

/**
 * Environment-agnostic Types & Schemas
 * Safe for use in both Browser and Cloudflare Worker environments.
 */

export const BaseEnvSchema = z.object({
  UPSTASH_REDIS_REST_URL: z.string().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  GOOGLE_GENAI_API_KEY: z.string().optional(),
  FIREBASE_PROJECT_ID: z.string().optional(),
  FIREBASE_PROJECT_NUMBER: z.string().optional(),
  FIREBASE_APP_ID: z.string().optional(),
  FIREBASE_API_KEY: z.string().optional(),
  FIREBASE_AUTH_DOMAIN: z.string().optional(),
  FIREBASE_STORAGE_BUCKET: z.string().optional(),
  FIREBASE_MESSAGING_SENDER_ID: z.string().optional(),
  FIREBASE_MEASUREMENT_ID: z.string().optional(),
  PUBLISHED_SHEET_ID: z.string().optional(),
  SNAPSHOT_KEY: z.string().optional(),
  APP_ENV: z.string().optional(),
  DIGITAL_SIGNATURE: z.string().optional(),
  RECAPTCHA_SITE_KEY: z.string().optional(),
});

export type BaseEnv = z.infer<typeof BaseEnvSchema>;

export const SpreadsheetHeadersSchema = z.array(z.string());
export type SpreadsheetHeaders = z.infer<typeof SpreadsheetHeadersSchema>;

export const ProjectRowSchema = z
  .object({
    _status: z.enum(["good", "moderate", "critical", "stable"]).optional(),
    _insight: z.string().optional(),
  })
  .catchall(z.any());
export type ProjectRow = z.infer<typeof ProjectRowSchema>;

export const AiSummarySchema = z.object({
  brief: z.string(),
  model: z.string().optional(),
  overallHealth: z.enum(["good", "moderate", "critical"]).optional(),
  criticalProjects: z.array(z.string()).optional().nullable(),
  exceedingProjects: z.array(z.string()).optional().nullable(),
  discrepancies: z
    .array(
      z.object({
        text: z.string().min(1),
        severity: z.enum(["low", "medium", "high"]).default("medium"),
      }),
    )
    .optional()
    .nullable(),
  extractedData: z
    .object({
      headers: SpreadsheetHeadersSchema,
      rows: z.array(ProjectRowSchema),
      date: z.string().optional(),
    })
    .optional()
    .nullable(),
});
export type AiSummary = z.infer<typeof AiSummarySchema>;

export const ProjectReportSchema = z.object({
  created: z.string().optional(),
  headers: SpreadsheetHeadersSchema,
  rows: z.array(ProjectRowSchema),
  lastUpdate: z.string(),
  aiSummary: AiSummarySchema.nullable(),
  adminMessage: z.string().optional(),
});
export type ProjectReport = z.infer<typeof ProjectReportSchema>;

export const ArchiveMetadataSchema = z.object({
  date: z.string(),
  summary: z.string().optional(),
  created: z.string(),
  bsDate: z.string().optional(),
  recordCount: z.number(),
});
export type ArchiveMetadata = z.infer<typeof ArchiveMetadataSchema>;

export const SnapshotRequestSchema = z.object({
  headers: SpreadsheetHeadersSchema.optional(),
  records: z.array(ProjectRowSchema),
  meta: z.object({ lastUpdate: z.string(), total: z.number() }),
});

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

export interface ReportState {
  type: "idle" | "loading" | "success" | "error";
  report: ProjectReport | null;
  message: string | null;
}

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

/** Arabic to Nepali numerals */
export function toNepaliNumerals(
  num: number | string | null | undefined,
): string {
  return String(num || "").replace(
    /[0-9]/g,
    (d: string) => AR_TO_NE[Number(d)],
  );
}

/** Nepali to Arabic numerals */
export function toArabicNumerals(str: string | null | undefined): string {
  return String(str || "").replace(/[०-९]/g, (d: string) => NE_TO_AR[d] ?? d);
}

/** Finds column keys based on aliases */
export function getColumnKey(
  headers: SpreadsheetHeaders,
  field:
    | "indicator"
    | "annualTarget"
    | "annualProgress"
    | "totalTarget"
    | "totalProgress",
): string | undefined {
  const aliases: Record<string, string[]> = {
    indicator: ["Indicator", "सूचक", "विवरण", "Indicator Name"],
    annualTarget: [
      "Annual Target",
      "बार्षिक लक्ष्य",
      "Yearly Target",
      "Target (Annual)",
    ],
    annualProgress: [
      "Annual Progress",
      "हाल सम्म को बार्षिक प्रगति",
      "Yearly Progress",
      "Achievement",
    ],
    totalTarget: ["Total Target", "कुल लक्ष्य", "Overall Target"],
    totalProgress: ["Total Progress", "कुल प्रगति", "Overall Progress"],
  };
  const searchTerms = aliases[field] || [];
  return headers.find((h: string) =>
    searchTerms.some((term) => h.toLowerCase().includes(term.toLowerCase())),
  );
}

const NON_NUMERIC_REGEX = /[^0-9.-]/g;

/** Calculates progress percentage */
export function getProgress(
  row: ProjectRow,
  headers: SpreadsheetHeaders,
): number {
  const targetKey = getColumnKey(headers, "annualTarget");
  const progKey = getColumnKey(headers, "annualProgress");
  if (!targetKey || !progKey) return 0;
  const clean = (val: any) => {
    const parsed = parseFloat(
      String(val || "0").replace(NON_NUMERIC_REGEX, ""),
    );
    return isNaN(parsed) ? 0 : parsed;
  };
  const t_val = clean(row[targetKey]);
  const p_val = clean(row[progKey]);
  return t_val > 0 ? Math.round((p_val / t_val) * 100) : 0;
}

/** Converts ArrayBuffer to Base64 (Isomorphic) */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  // Works in both Browser and Cloudflare Workers
  return btoa(new TextDecoder("latin1").decode(buffer));
}

/** UI states helpers */
export const isReportSuccess = (
  s: ReportState,
): s is { type: "success"; report: ProjectReport; message: null } =>
  s.type === "success";
export const isReportLoading = (
  s: ReportState,
): s is { type: "loading"; report: null; message: null } =>
  s.type === "loading";
export const isReportError = (
  s: ReportState,
): s is { type: "error"; report: null; message: string } => s.type === "error";
export const isReportIdle = (
  s: ReportState,
): s is { type: "idle"; report: null; message: null } => s.type === "idle";

export type DashboardState = any; // Simplified for shared access; fully typed in api-utils
