/**
 * Shared type definitions for the Department of Roads (DoR) MIS Dashboard.
 * These types are used by both the Frontend client and the Cloudflare Worker.
 */

import { z } from "zod";

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
  return headers.find((h) =>
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

  const t_val = parseFloat(String(row[targetKey] || "0").replace(/,/g, ""));
  const p_val = parseFloat(String(row[progKey] || "0").replace(/,/g, ""));

  return t_val > 0 ? Math.round((p_val / t_val) * 100) : 0;
}

export const AiSummarySchema = z.object({
  brief: z.string().describe("A high-level executive summary for senior management (under 100 words)."),
  overallHealth: z.enum(["good", "moderate", "critical"]).optional()
    .describe("The general status of the road network based on cumulative progress."),
  criticalProjects: z.array(z.string()).optional()
    .describe("List names of projects where annual progress is significantly below target (e.g., < 40%)."),
  exceedingProjects: z.array(z.string()).optional()
    .describe("List names of projects that have surpassed their annual targets."),
  discrepancies: z.array(z.object({
    text: z.string().describe("Description of a data mismatch or logical error found in the report."),
    severity: z.enum(["low", "medium", "high"]).describe("Impact of the discrepancy.")
  })).optional().describe("List any logical inconsistencies found in the project data."),
  extractedData: z.object({
    headers: SpreadsheetHeadersSchema.describe("The exact column headers found in the PDF table."),
    rows: z.array(ProjectRowSchema).describe("An array of objects representing every row in the project table."),
    date: z.string().optional().describe("The report date found in the document header (ISO format if possible).")
  }).optional().describe("The raw tabular data extracted from the document.")
});
export type AiSummary = z.infer<typeof AiSummarySchema>;

export const ProjectReportSchema = z.object({
  created: z.string().optional(),
  headers: SpreadsheetHeadersSchema,
  rows: z.array(ProjectRowSchema),
  lastUpdate: z.string(),
  aiSummary: AiSummarySchema.nullable(),
  adminMessage: z.string().optional()
}).transform((report) => {
  const { headers, rows } = report;

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

  return { ...report, rows: updatedRows };
});
export type ProjectReport = z.infer<typeof ProjectReportSchema>;

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

export interface Env {
  APP_ENV?: string;
  FIREBASE_PROJECT_ID?: string;
  FIREBASE_PROJECT_NUMBER?: string;
  FIREBASE_APP_ID?: string;
  GOOGLE_GENAI_API_KEY?: string;
  PUBLISHED_SHEET_ID?: string;
  SNAPSHOT_KEY?: string;
  REPORTS_KV?: any; // KVNamespace on Worker, any on Client
  [key: string]: any;
}