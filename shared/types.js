/// <reference types="@cloudflare/workers-types" />
import { z } from "zod";

/**
 * Zod schema for AI-generated project summaries.
 */
export const AiSummarySchema = z.object({
    brief: z.string(),
    extractedData: z.object({
        headers: z.array(z.string()),
        rows: z.array(z.any()),
        date: z.string().optional(),
    }).optional(),
});

/**
 * Zod schema for the primary Project Report data structure.
 */
export const ProjectReportSchema = z.object({
    headers: z.array(z.string()),
    rows: z.array(z.any()),
    lastUpdate: z.string(),
    aiSummary: AiSummarySchema.nullable(),
});

/**
 * Zod schema for incoming snapshot data via the /api/snapshot endpoint.
 */
export const SnapshotRequestSchema = z.object({
    records: z.array(z.any()),
    headers: z.array(z.string()).optional(),
    meta: z.object({
        total: z.number(),
        lastUpdate: z.string(),
    }),
});

export function getColumnKey(headers, index) {
    return headers && headers[index] ? headers[index] : `col_${index}`;
}

export function getProgress(row, targetKey, progressKey) {
    const target = parseFloat(row?.[targetKey]) || 0;
    const progress = parseFloat(row?.[progressKey]) || 0;
    return target > 0 ? Math.min(100, Math.max(0, (progress / target) * 100)) : 0;
}
