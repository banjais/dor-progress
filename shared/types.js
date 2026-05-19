import { z } from "zod";

export const SpreadsheetHeadersSchema = z.array(z.string());

export const ProjectRowSchema = z.object({
    _status: z.enum(["good", "moderate", "critical", "stable"]).optional(),
    _insight: z.string().optional(),
}).catchall(z.any());

export const AiSummarySchema = z.object({
    brief: z.string().describe("A high-level executive summary for senior management (under 100 words)."),
    overallHealth: z.enum(["good", "moderate", "critical"]).optional()
        .describe("The general status of the road network based on cumulative progress."),
    criticalProjects: z.array(z.string()).optional().nullable()
        .describe("List names of projects where annual progress is significantly below target (e.g., < 40%)."),
    exceedingProjects: z.array(z.string()).optional().nullable()
        .describe("List names of projects that have surpassed their annual targets."),
    discrepancies: z.array(z.object({
        text: z.string().min(1).describe("Description of a data mismatch or logical error found in the report."),
        severity: z.enum(["low", "medium", "high"]).describe("Impact of the discrepancy.").default("medium")
    })).optional().nullable().describe("List any logical inconsistencies found in the project data."),
    extractedData: z.object({
        headers: SpreadsheetHeadersSchema.describe("The exact column headers found in the PDF table."),
        rows: z.array(ProjectRowSchema).describe("An array of objects representing every row in the project table."),
        date: z.string().optional().describe("The report date found in the document header (ISO format if possible).")
    }).optional().nullable().describe("The raw tabular data extracted from the document.")
});

export const ProjectReportSchema = z.object({
    headers: SpreadsheetHeadersSchema,
    rows: z.array(ProjectRowSchema),
    lastUpdate: z.string(),
    aiSummary: AiSummarySchema.nullable(),
    adminMessage: z.string().optional(),
}).transform((report) => {
    const { headers, created = new Date().toISOString(), lastUpdate, aiSummary, adminMessage } = report;
    const rows = Array.isArray(report.rows) ? report.rows : [];
    const updatedRows = rows.map((row) => {
        if (row && row._status) return row;
        const targetKey = Array.isArray(headers) ? (headers[0] || "Annual Target") : "Annual Target";
        const progKey = Array.isArray(headers) ? (headers[1] || "Annual Progress") : "Annual Progress";
        const t_val = parseFloat(String(row?.[targetKey] || "0").replace(/,/g, "")) || 0;
        const p_val = parseFloat(String(row?.[progKey] || "0").replace(/,/g, "")) || 0;
        const progress = t_val > 0 ? Math.round((p_val / t_val) * 100) : 0;
        let status = "critical";
        if (progress >= 80) status = "good";
        else if (progress >= 40) status = "stable";
        return { ...row, _status: status };
    });
    return { headers: Array.isArray(headers) ? headers : [], rows: updatedRows, created: created || new Date().toISOString(), lastUpdate: lastUpdate || new Date().toISOString(), aiSummary, adminMessage };
});

export const ArchiveMetadataSchema = z.object({
    date: z.string(),
    summary: z.string().optional(),
    created: z.string(),
    bsDate: z.string().optional(),
    recordCount: z.number(),
});

export const SnapshotRequestSchema = z.object({
    headers: SpreadsheetHeadersSchema.optional(),
    records: z.array(ProjectRowSchema),
    meta: z.object({
        lastUpdate: z.string(),
        total: z.number()
    })
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

export function getColumnKey(headers, index) {
    return headers && headers[index] ? headers[index] : `col_${index}`;
}

export function getProgress(row, targetKey, progressKey) {
    const t_val = parseFloat(String(row?.[targetKey] || "0").replace(/,/g, "")) || 0;
    const p_val = parseFloat(String(row?.[progressKey] || "0").replace(/,/g, "")) || 0;
    return t_val > 0 ? Math.min(100, Math.max(0, Math.round((p_val / t_val) * 100))) : 0;
}
