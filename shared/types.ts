/**
 * Shared type definitions for the Department of Roads (DoR) MIS Dashboard.
 * These types are used by both the Frontend client and the Cloudflare Worker.
 */

import { z } from "zod";

/** Shared Environment variables/bindings */
export interface Env {
  UPSTASH_REDIS_REST_URL?: string;
  UPSTASH_REDIS_REST_TOKEN?: string;
  GEMINI_API_KEY?: string;
  GOOGLE_GENAI_API_KEY?: string;
  FIREBASE_PROJECT_ID?: string;
  FIREBASE_PROJECT_NUMBER?: string;
  FIREBASE_APP_ID?: string;
  FIREBASE_API_KEY?: string;
  FIREBASE_AUTH_DOMAIN?: string;
  FIREBASE_STORAGE_BUCKET?: string;
  FIREBASE_MESSAGING_SENDER_ID?: string;
  FIREBASE_MEASUREMENT_ID?: string;
  PUBLISHED_SHEET_ID?: string;
  SNAPSHOT_KEY?: string;
  APP_ENV?: string;
  DIGITAL_SIGNATURE?: string;
  RECAPTCHA_SITE_KEY?: string;
}

export const SpreadsheetHeadersSchema = z.array(z.string());
export type SpreadsheetHeaders = z.infer<typeof SpreadsheetHeadersSchema>;

export const ProjectRowSchema = z.object({
  _status: z.enum(["good", "moderate", "critical", "stable"]).optional(),
  _insight: z.string().optional(),
}).catchall(z.any());
export type ProjectRow = z.infer<typeof ProjectRowSchema>;

/**
 * Robustly finds a column header based on known aliases.
 */
export function getColumnKey(
  headers: SpreadsheetHeaders,
  field: "indicator" | "annualTarget" | "annualProgress" | "totalTarget" | "totalProgress",
): string | undefined {
  const aliases: Record<string, string[]> = {
    indicator: ["Indicator", "सूचक", "विवरण", "Indicator Name"],
    annualTarget: ["Annual Target", "बार्षिक लक्ष्य", "Yearly Target", "Target (Annual)"],
    annualProgress: ["Annual Progress", "हाल सम्म को बार्षिक प्रगति", "Yearly Progress", "Achievement"],
    totalTarget: ["Total Target", "कुल लक्ष्य", "Overall Target"],
    totalProgress: ["Total Progress", "कुल प्रगति", "Overall Progress"],
  };

  const searchTerms = aliases[field] || [];
  return headers.find((h: string) =>
    searchTerms.some((term) => h.toLowerCase().includes(term.toLowerCase())),
  );
}

/**
 * Calculates progress percentage based on row data.
 */
export function getProgress(row: ProjectRow, headers: SpreadsheetHeaders): number {
  const targetKey = getColumnKey(headers, "annualTarget");
  const progKey = getColumnKey(headers, "annualProgress");

  if (!targetKey || !progKey) return 0;

  const clean = (val: any) => parseFloat(String(val || "0").replace(/[^0-9.-]/g, ""));
  const t_val = clean(row[targetKey]);
  const p_val = clean(row[progKey]);

  return t_val > 0 ? Math.round((p_val / t_val) * 100) : 0;
}

export const AiSummarySchema = z.object({
  brief: z.string().describe("A high-level executive summary for senior management (under 100 words)."),
  overallHealth: z.enum(["good", "moderate", "critical"]).optional()
    .describe("The general status of the road network based on cumulative progress."),
  criticalProjects: z.array(z.string()).optional().nullable() // Could be null if no critical projects
    .describe("List names of projects where annual progress is significantly below target (e.g., < 40%)."),
  exceedingProjects: z.array(z.string()).optional().nullable() // Could be null if no exceeding projects
    .describe("List names of projects that have surpassed their annual targets."),
  discrepancies: z.array(z.object({
    text: z.string().min(1).describe("Description of a data mismatch or logical error found in the report."),
    severity: z.enum(["low", "medium", "high"]).describe("Impact of the discrepancy.").default("medium")
  })).optional().nullable().describe("List any logical inconsistencies found in the project data."), // Could be null if no discrepancies
  extractedData: z.object({
    headers: SpreadsheetHeadersSchema.describe("The exact column headers found in the PDF table."),
    rows: z.array(ProjectRowSchema).describe("An array of objects representing every row in the project table."),
    date: z.string().optional().describe("The report date found in the document header (ISO format if possible).")
  }).optional().nullable().describe("The raw tabular data extracted from the document.") // Could be null if extraction failed
});
export type AiSummary = z.infer<typeof AiSummarySchema>;

const ProjectReportBaseSchema = z.object({
  created: z.string().optional(),
  headers: SpreadsheetHeadersSchema,
  rows: z.array(ProjectRowSchema),
  lastUpdate: z.string(),
  aiSummary: AiSummarySchema.nullable(),
  adminMessage: z.string().optional()
});

export const ProjectReportSchema = ProjectReportBaseSchema.transform((report) => {
  const { headers, created = new Date().toISOString(), lastUpdate = new Date().toISOString(), aiSummary, adminMessage, rows } = report;

  // Automatically calculate status color/enum for each row during the parsing phase.
  const updatedRows = rows.map((row) => {
    // If the API already provided a status, preserve it
    if (row._status) return row;

    const progress = getProgress(row, headers);
    let status: "good" | "stable" | "critical" = "critical";

    if (progress >= 80) status = "good";
    else if (progress >= 40) status = "stable";

    return { ...row, _status: status };
  });

  return { headers, rows: updatedRows, created, lastUpdate, aiSummary, adminMessage };
});
export type ProjectReport = z.infer<typeof ProjectReportSchema>;

/** Schema for metadata stored in KV alongside archived reports */
export const ArchiveMetadataSchema = z.object({
  date: z.string(),
  summary: z.string().optional(),
  created: z.string(),
  bsDate: z.string().optional(),
  recordCount: z.number(),
});
export type ArchiveMetadata = z.infer<typeof ArchiveMetadataSchema>;

/** Schema for snapshot creation requests from the dashboard */
export const SnapshotRequestSchema = z.object({
  headers: SpreadsheetHeadersSchema.optional(),
  records: z.array(ProjectRowSchema),
  meta: z.object({
    lastUpdate: z.string(),
    total: z.number()
  })
});
export type SnapshotRequest = z.infer<typeof SnapshotRequestSchema>;

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
 * Converts an ArrayBuffer to a Base64 string.
 */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}