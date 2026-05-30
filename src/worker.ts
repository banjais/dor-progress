import type {
  ExecutionContext,
  ExportedHandler,
  KVNamespace,
  KVNamespaceListKey,
} from "@cloudflare/workers-types";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { z } from "zod";

import { runProjectSummary } from "./ai-service.ts";
import {
  type AiSummary,
  AiSummarySchema,
  type ArchiveMetadata,
  type BaseEnv,
  BaseEnvSchema,
  type ProjectReport,
  ProjectReportSchema,
  SnapshotRequestSchema,
  arrayBufferToBase64,
} from "./api-shared.js";
import { devanagariFontBase64 } from "./fonts.js";

interface Env extends BaseEnv {
  REPORTS_KV: KVNamespace;
}

// Type aliases to use Cloudflare-specific interfaces without shadowing global values.
type WorkerRequest = import("@cloudflare/workers-types").Request;
type WorkerResponse = import("@cloudflare/workers-types").Response;

/**
 * Generates a tabular PDF report from JSON data.
 */
function generatePdfFromReport(report: ProjectReport): ArrayBuffer {
  const doc = new jsPDF();

  // Register and set the custom Devanagari font
  const fontFileName = "NotoSansDevanagari.ttf";
  const fontName = "NotoSansDevanagari";

  doc.addFileToVFS(fontFileName, devanagariFontBase64);
  doc.addFont(fontFileName, fontName, "normal");
  doc.setFont(fontName);

  // Add Title and Metadata
  doc.setFontSize(18);
  doc.text("Department of Roads - MIS Snapshot", 14, 22);
  doc.setFontSize(10);
  doc.setTextColor(100);
  doc.text(`Report Date: ${report.lastUpdate}`, 14, 30);
  doc.text(`Generated on: ${new Date().toISOString().split("T")[0]}`, 14, 36);

  // Prepare table data (excluding internal status fields)
  const tableData = report.rows.map((row) =>
    report.headers.map((header) => String(row[header] || "")),
  );

  autoTable(doc, {
    head: [report.headers],
    body: tableData,
    startY: 45,
    styles: { font: fontName, fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [0, 102, 204] },
  });

  return doc.output("arraybuffer");
}

class ServiceError extends Error {
  status: number;
  cause?: unknown;

  constructor(message: string, options?: { cause?: unknown; status?: number }) {
    super(message);
    this.name = "ServiceError";
    this.status = options?.status || 500;
    this.cause = options?.cause;
  }
}

const SNAPSHOT_RETENTION_COUNT = 30; // Keep the last 30 snapshots

const JWKS = createRemoteJWKSet(
  new URL("https://firebaseappcheck.googleapis.com/v1/jwks"),
);

const getCorsHeaders = (origin: string | null) => {
  const isAllowedOrigin =
    origin &&
    (origin === "https://dor-progress.web.app" ||
      origin === "https://dor-progress.firebaseapp.com" ||
      origin.includes("localhost:") ||
      origin.includes("127.0.0.1") ||
      origin.includes("dor-progress"));

  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": isAllowedOrigin
      ? origin
      : "https://dor-progress.web.app",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS, HEAD",
    "Access-Control-Allow-Headers":
      "Content-Type, X-Firebase-AppCheck, X-Low-Data, X-Snapshot-Key, X-AppCheck-Fallback",
    "Access-Control-Max-Age": "86400",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": [
      "default-src 'self';",
      "connect-src 'self' https://fonts.googleapis.com https://*.googleapis.com https://*.gstatic.com https://unpkg.com https://api.qrserver.com https://*.firebaseapp.com https://*.web.app http://localhost:*;",
      "font-src 'self' data: https://fonts.gstatic.com https://fonts.googleapis.com;",
      "img-src 'self' data: https://api.qrserver.com https://*.googleusercontent.com;",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://unpkg.com;",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://unpkg.com https://www.gstatic.com;",
      "worker-src 'self' blob:;",
    ].join(" "),
  };
};

function jsonResponse(
  data: unknown,
  status = 200,
  origin: string | null = null,
): WorkerResponse {
<<<<<<< HEAD
  return new Response(JSON.stringify(data) as any, {
    status,
    headers: getCorsHeaders(origin),
  }) as unknown as WorkerResponse;
}

async function generateFingerprint(buffer: ArrayBuffer): Promise<string> {
=======
  // No citation needed, this is internal code.
  return new Response(JSON.stringify(data) as any, {
    // No citation needed, this is internal code.
    status,
    headers: getCorsHeaders(origin),
  }) as unknown as WorkerResponse; // No citation needed, this is internal code.
}

async function generateFingerprint(buffer: ArrayBuffer): Promise<string> {
  // Google Sheets PDF exports contain volatile metadata (dates/IDs) that change
  // even if the content is identical. We scrub these to ensure a stable fingerprint.
>>>>>>> 2d1b30ec7401193df1d535d89d3fe40539ed54b8
  const binaryString = new TextDecoder("latin1").decode(buffer);

  const scrubbed = binaryString
    .replace(/\/CreationDate\s*\([^)]+\)/g, "")
    .replace(/\/ModDate\s*\([^)]+\)/g, "")
<<<<<<< HEAD
    .replace(/\/ID\s*\[<[0-9A-F]+>\s*<[0-9A-F]+>\]/gi, "");

=======
    // Remove PDF Trailer IDs which are often randomized on every export
    .replace(/\/ID\s*\[<[0-9A-F]+>\s*<[0-9A-F]+>\]/gi, "");

  // Use Uint8Array.from with a mapping function to rebuild the buffer.
  // While still a loop, it is more idiomatic and allows the engine to optimize the allocation.
>>>>>>> 2d1b30ec7401193df1d535d89d3fe40539ed54b8
  const scrubbedBuffer = new Uint8Array(scrubbed.length);
  for (let i = 0; i < scrubbed.length; i++)
    scrubbedBuffer[i] = scrubbed.charCodeAt(i);

  const hashBuffer = await crypto.subtle.digest("SHA-256", scrubbedBuffer);
  return [...new Uint8Array(hashBuffer)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function verifyAppCheck(request: WorkerRequest, env: Env): Promise<void> {
<<<<<<< HEAD
=======
  // Define environments where App Check should be bypassed (e.g., for local development or testing)
>>>>>>> 2d1b30ec7401193df1d535d89d3fe40539ed54b8
  const bypassEnvironments = ["development", "test"];
  if (env.APP_ENV && bypassEnvironments.includes(env.APP_ENV)) {
    console.warn(`App Check bypassed for ${env.APP_ENV} environment.`);
    return;
  }

  const token = request.headers.get("X-Firebase-AppCheck");
<<<<<<< HEAD

  if (!token) {
=======
  const isFallbackMode = request.headers.get("X-AppCheck-Fallback") === "true";

  if (!token) {
    if (isFallbackMode) {
      console.warn(
        "[App Check] Request received in fallback mode without a token. Proceeding with caution.",
      );
      return; // Allow request to proceed without App Check verification
    }
>>>>>>> 2d1b30ec7401193df1d535d89d3fe40539ed54b8
    throw new ServiceError("Unauthorized: No App Check token", { status: 401 });
  }

  const projectNumber = env.FIREBASE_PROJECT_NUMBER;
  const projectId = env.FIREBASE_PROJECT_ID;
  const appId = env.FIREBASE_APP_ID;

  if (!projectNumber || !projectId || !appId) {
    throw new ServiceError(
      "Server configuration error: Firebase configuration missing",
      { status: 500 },
    );
  }

  try {
<<<<<<< HEAD
=======
    // The issuer must use the Project NUMBER, not the Project ID.
>>>>>>> 2d1b30ec7401193df1d535d89d3fe40539ed54b8
    const issuer = `https://firebaseappcheck.googleapis.com/${projectNumber}`;

    const { payload } = await jwtVerify(token, JWKS, {
      issuer,
      audience: [`projects/${projectNumber}`, `projects/${projectId}`],
      clockTolerance: "1m",
    });

<<<<<<< HEAD
=======
    // Validate Subject (App ID)
>>>>>>> 2d1b30ec7401193df1d535d89d3fe40539ed54b8
    if (payload.sub !== appId) {
      console.error(
        `[App Check] Subject mismatch. Expected ${appId}, got ${payload.sub}`,
      );
      throw new Error("Invalid Subject");
    }
  } catch (e: any) {
<<<<<<< HEAD
=======
    // Log the specific jose verification error to Cloudflare Logs for debugging
>>>>>>> 2d1b30ec7401193df1d535d89d3fe40539ed54b8
    console.error(`[App Check] Verification failed: ${e.message}`, {
      code: e.code,
      project: projectId,
    });
    throw new ServiceError(
      `Unauthorized: ${e.code === "ERR_JWT_EXPIRED" ? "Token Expired" : "Invalid App Check Token"}`,
      {
        status: 401,
        cause: e,
      },
    );
  }
}

// Schema for /api/report parameters
const ReportRequestSchema = z.object({
  lang: z.enum(["en", "ne"]).default("en"),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  force: z
    .preprocess((val: unknown) => val === "true", z.boolean())
    .default(false),
  isLowData: z.boolean().default(false),
});

async function handleFetch(
  request: WorkerRequest,
  env: Env,
  ctx: ExecutionContext,
): Promise<WorkerResponse> {
  const origin = request.headers.get("Origin");
  const url = new URL(request.url);

<<<<<<< HEAD
=======
  // Validate environment at the entry point
>>>>>>> 2d1b30ec7401193df1d535d89d3fe40539ed54b8
  const envValidation = BaseEnvSchema.safeParse(env);
  if (!envValidation.success) {
    console.error(
      "❌ Environment configuration mismatch:",
      envValidation.error.format(),
    );
<<<<<<< HEAD
=======
    // Optionally return an error response in development
>>>>>>> 2d1b30ec7401193df1d535d89d3fe40539ed54b8
    if (env.APP_ENV === "development")
      return jsonResponse(
        {
          error: "Environment Configuration Mismatch",
          details: envValidation.error.format(),
        },
        500,
        origin,
      );
  }

<<<<<<< HEAD
=======
  // Diagnostic log to verify Vite proxy hand-off
>>>>>>> 2d1b30ec7401193df1d535d89d3fe40539ed54b8
  console.log(`[Worker] ${request.method} ${url.pathname} (Origin: ${origin})`);

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: getCorsHeaders(origin),
    }) as unknown as WorkerResponse;
  }

  try {
    if (url.pathname === "/api/ping" || url.pathname === "/api/health") {
      return jsonResponse({ status: "ok", time: Date.now() }, 200, origin);
    }

    if (url.pathname === "/api/hello-worker") {
      return jsonResponse(
        { message: "Hello from Cloudflare Worker!" },
        200,
        origin,
      );
    }

    if (url.pathname === "/api/client-config") {
      return jsonResponse(
        {
          firebase: {
            apiKey: env.FIREBASE_API_KEY,
            authDomain:
              env.FIREBASE_AUTH_DOMAIN ||
              `${env.FIREBASE_PROJECT_ID}.firebaseapp.com`,
            projectId: env.FIREBASE_PROJECT_ID,
            storageBucket:
              env.FIREBASE_STORAGE_BUCKET ||
              `${env.FIREBASE_PROJECT_ID}.appspot.com`,
            messagingSenderId:
              env.FIREBASE_MESSAGING_SENDER_ID || env.FIREBASE_PROJECT_NUMBER,
            appId:
              env.FIREBASE_APP_ID ||
              `1:${env.FIREBASE_PROJECT_NUMBER}:web:dynamic`,
            measurementId: env.FIREBASE_MEASUREMENT_ID,
          },
          recaptchaKey: env.RECAPTCHA_SITE_KEY,
          digitalSignatureEnabled: env.DIGITAL_SIGNATURE === "true",
        },
        200,
        origin,
      );
    }

    if (url.pathname === "/api/reports") {
      await verifyAppCheck(request, env);
      const list = await env.REPORTS_KV.list<ArchiveMetadata>({
        prefix: "report:",
        limit: 50,
      });
      const archives: ArchiveMetadata[] = list.keys
        .map((k: KVNamespaceListKey<ArchiveMetadata>) => ({
          date: k.name.replace("report:", ""),
          summary: k.metadata?.summary || "Weekly progress snapshot.",
          created: k.metadata?.created || "",
          bsDate: k.metadata?.bsDate,
          recordCount: k.metadata?.recordCount ?? 0,
        }))
        .sort((a: ArchiveMetadata, b: ArchiveMetadata) =>
          b.date.localeCompare(a.date),
        );
      return jsonResponse(archives, 200, origin);
    }

    if (url.pathname === "/api/report") {
      const validation = ReportRequestSchema.safeParse({
        lang: url.searchParams.get("lang") || undefined,
        date: url.searchParams.get("date") || undefined,
        force: url.searchParams.get("force"),
        isLowData: request.headers.get("X-Low-Data") === "true",
      });
      if (!validation.success) {
        throw new ServiceError("Validation Failed", {
          status: 400,
          cause: validation.error.format(),
        });
      }
      const { lang, date, force: forceRefresh, isLowData } = validation.data;
      await verifyAppCheck(request, env);

      let report: ProjectReport;
      let fingerprint: string | undefined;
      let pdfBuffer: ArrayBuffer | undefined;

      if (date) {
        const rawData = await env.REPORTS_KV.get(`report:${date}`, {
          type: "json",
        });
        if (!rawData)
          throw new ServiceError(`Archived report for ${date} not found.`, {
            status: 404,
          });
        const archiveValidation = ProjectReportSchema.safeParse(rawData);
        if (!archiveValidation.success)
          throw new ServiceError(`Corrupted archive data for ${date}`, {
            status: 500,
          });
        report = archiveValidation.data;
      } else {
        pdfBuffer = await fetchProjectPdf(env);
        fingerprint = await generateFingerprint(pdfBuffer);
        report = {
          headers: [],
          rows: [],
          lastUpdate: new Date().toISOString().split("T")[0],
          aiSummary: null,
          created: new Date().toISOString(),
          adminMessage: undefined,
        };
      }

      if (!isLowData && !report.aiSummary && fingerprint && pdfBuffer) {
        const cacheKey = `ai_summary_${lang}_${fingerprint}`;
        const cachedRaw = forceRefresh
          ? null
          : await env.REPORTS_KV.get(cacheKey, { type: "json" });
        let aiResult: AiSummary | null = null;
        if (cachedRaw) {
          const parsed = AiSummarySchema.safeParse(cachedRaw);
          if (parsed.success) aiResult = parsed.data;
        }
        if (!aiResult && pdfBuffer) {
          const pdfBase64 = arrayBufferToBase64(pdfBuffer);
          for (let i = 0; i < 2; i++) {
            try {
              const apiKey = env.GOOGLE_GENAI_API_KEY;
              if (!apiKey)
                throw new ServiceError("GOOGLE_GENAI_API_KEY not configured", {
                  status: 500,
                });
              aiResult = await runProjectSummary(apiKey, { pdfBase64, lang });
              if (aiResult?.brief) {
                ctx.waitUntil(
                  env.REPORTS_KV.put(cacheKey, JSON.stringify(aiResult), {
                    expirationTtl: 604800,
                  }),
                );
              }
              break;
            } catch (aiError) {
              if (i === 1) throw aiError;
              await new Promise((r) => setTimeout(r, 2000));
            }
          }
        }
        report.aiSummary = aiResult;
        if (aiResult?.extractedData) {
          report.headers = aiResult.extractedData.headers;
          report.rows = aiResult.extractedData.rows;
        }
      }
      return jsonResponse(report, 200, origin);
    }

    if (url.pathname === "/api/summary") {
      await verifyAppCheck(request, env);
      const year = url.searchParams.get("year");
      const month = url.searchParams.get("month");
      if (!year || !month)
        throw new ServiceError("Year and month are required", { status: 400 });
      const prefix = `report:${year}-${month}`;
      const snapshotListResult = await env.REPORTS_KV.list<ArchiveMetadata>({
        prefix,
        limit: 10,
      });
      if (snapshotListResult.keys.length === 0) {
        throw new ServiceError(`No snapshots found for ${year}-${month}.`, {
          status: 404,
        });
      }
      const latestKey = snapshotListResult.keys.sort(
        (
          a: KVNamespaceListKey<ArchiveMetadata>,
          b: KVNamespaceListKey<ArchiveMetadata>,
        ) => b.name.localeCompare(a.name),
      )[0].name;
<<<<<<< HEAD
      const rawReport = await env.REPORTS_KV.get(latestKey, { type: "json" });
      if (!rawReport)
        throw new ServiceError("Summary snapshot not found", { status: 404 });

      const summaryValidation = ProjectReportSchema.safeParse(rawReport);
      if (!summaryValidation.success)
        throw new ServiceError(`Corrupted summary data for ${latestKey}`, {
          status: 500,
        });

      return jsonResponse(summaryValidation.data, 200, origin);
=======
      const report = await env.REPORTS_KV.get(latestKey, { type: "json" });
      return jsonResponse(report, 200, origin);
>>>>>>> 2d1b30ec7401193df1d535d89d3fe40539ed54b8
    }

    if (url.pathname === "/api/snapshot") {
      const snapshotKey = request.headers.get("X-Snapshot-Key");
      const isDev = env.APP_ENV === "development" || env.APP_ENV === "test";
      if (!isDev && (!snapshotKey || snapshotKey !== env.SNAPSHOT_KEY)) {
        throw new ServiceError("Unauthorized", { status: 401 });
      }

      if (request.method === "GET") {
        const date = url.searchParams.get("date");
        if (!date)
          throw new ServiceError("Missing date parameter", { status: 400 });
        const report = await env.REPORTS_KV.get(`report:${date}`, {
          type: "json",
        });
        if (!report)
          throw new ServiceError("Snapshot not found", { status: 404 });

        const pdfBuffer = generatePdfFromReport(report as ProjectReport);

        return new Response(pdfBuffer, {
          headers: {
            ...getCorsHeaders(origin),
            "Content-Type": "application/pdf",
            "Content-Disposition": `attachment; filename="DoR_Snapshot_${date}.pdf"`,
          },
        }) as unknown as WorkerResponse;
      }

      if (request.method === "POST") {
        const bodyResult = SnapshotRequestSchema.safeParse(
          await request.json(),
        );
        if (!bodyResult.success) {
          throw new ServiceError("Invalid snapshot data", {
            status: 400,
            cause: bodyResult.error.format(),
          });
        }
        const body = bodyResult.data;
        const date = body.meta.lastUpdate;
        const report = ProjectReportSchema.parse({
          headers: body.headers || [],
          rows: body.records,
          lastUpdate: date,
          aiSummary: null,
        });
        await env.REPORTS_KV.put(`report:${date}`, JSON.stringify(report), {
          metadata: {
            date,
            recordCount: body.meta.total,
            summary: report.aiSummary?.brief
              ? report.aiSummary.brief.substring(0, 200)
              : undefined,
            created: new Date().toISOString(),
          },
        });
        return jsonResponse({ success: true, date }, 200, origin);
      }

      if (request.method === "DELETE") {
        const date = url.searchParams.get("date");
        if (!date)
          throw new ServiceError("Missing date parameter", { status: 400 });
        await env.REPORTS_KV.delete(`report:${date}`);
        return jsonResponse({ success: true }, 200, origin);
      }
      throw new ServiceError("Method Not Allowed", { status: 405 });
    }

    if (url.pathname === "/api/admin/migrate-metadata") {
      await verifyAppCheck(request, env);
      const snapshotKey = request.headers.get("X-Snapshot-Key");
      if (!snapshotKey) throw new ServiceError("Unauthorized", { status: 401 });

      const dryRun = url.searchParams.get("dryRun") === "true";
      const listResult = await env.REPORTS_KV.list<ArchiveMetadata>({
        prefix: "report:",
        limit: 1000,
      });
      const results = {
        total: listResult.keys.length,
        migrated: 0,
        skipped: 0,
        dryRun,
        migratedKeys: [] as string[],
        errors: [] as string[],
      };

      for (const key of listResult.keys) {
        try {
          const currentMetadata = key.metadata;
          const dateFromKey = key.name.replace("report:", "");
          if (
            currentMetadata?.date &&
            typeof currentMetadata?.recordCount === "number"
          ) {
            results.skipped++;
            continue;
          }
          let recordCount = currentMetadata?.recordCount ?? 0;
          if (recordCount === 0) {
            const val = await env.REPORTS_KV.get<ProjectReport>(key.name, {
              type: "json",
            });
            recordCount = val?.rows?.length ?? 0;
          }
          const updatedMetadata: ArchiveMetadata = {
            date: currentMetadata?.date || dateFromKey,
            recordCount: recordCount,
            summary: currentMetadata?.summary || "Weekly progress snapshot.",
            created: currentMetadata?.created || new Date().toISOString(),
            bsDate: currentMetadata?.bsDate,
          };
          const value = await env.REPORTS_KV.get(key.name);
          if (value) {
            if (!dryRun) {
              await env.REPORTS_KV.put(key.name, value, {
                metadata: updatedMetadata,
              });
            }
            results.migrated++;
            results.migratedKeys.push(key.name);
          }
        } catch (itemErr) {
          results.errors.push(`Key ${key.name}: ${(itemErr as Error).message}`);
        }
      }
      return jsonResponse(
        { message: "Migration Complete", results },
        200,
        origin,
      );
    }

    return new Response(`Not Found: ${url.pathname}`, {
      status: 404,
      headers: getCorsHeaders(origin),
    }) as unknown as WorkerResponse;
  } catch (e) {
    const err =
      e instanceof ServiceError
        ? e
        : new ServiceError((e as Error).message || "Internal Server Error", {
            status: 500,
            cause: e,
          });
<<<<<<< HEAD
=======
    // Surface the cause (e.g., Zod validation errors or PDF export errors) to the client
>>>>>>> 2d1b30ec7401193df1d535d89d3fe40539ed54b8
    return jsonResponse(
      {
        error: err.message,
        details: err.cause,
      },
      err.status,
      origin,
    ) as WorkerResponse;
  }
}

async function handleAutoArchive(env: Env) {
  try {
    const pdfBuffer = await fetchProjectPdf(env);
    const fingerprint = await generateFingerprint(pdfBuffer);

    const cacheKey = `archive_check_${fingerprint}`;
    const alreadyArchived = await env.REPORTS_KV.get(cacheKey);

    if (alreadyArchived) {
      console.log(
<<<<<<< HEAD
=======
        // No citation needed, this is internal code.
>>>>>>> 2d1b30ec7401193df1d535d89d3fe40539ed54b8
        `[Auto-Archive] Snapshot for fingerprint ${fingerprint} already exists. Skipping.`,
      );
      return;
    }

    const apiKey = env.GOOGLE_GENAI_API_KEY;
    if (!apiKey)
      throw new Error("GOOGLE_GENAI_API_KEY not configured for auto-archive");

<<<<<<< HEAD
    const pdfBase64 = arrayBufferToBase64(pdfBuffer);

=======
    // Convert PDF to Base64 for Gemini processing
    const pdfBase64 = arrayBufferToBase64(pdfBuffer);

    // Trigger AI Extraction (defaulting to Nepali as it's the primary report language)
>>>>>>> 2d1b30ec7401193df1d535d89d3fe40539ed54b8
    const aiResult = await runProjectSummary(apiKey, {
      pdfBase64,
      lang: "ne",
    });

    if (!aiResult?.extractedData || !aiResult.extractedData.rows.length) {
      console.error(
        "[Auto-Archive] AI extraction returned no data. Aborting archive.",
      );
      return;
    }

    const reportDate =
      aiResult.extractedData.date || new Date().toISOString().split("T")[0];
    const report = ProjectReportSchema.parse({
      headers: aiResult.extractedData.headers,
      rows: aiResult.extractedData.rows,
      lastUpdate: reportDate,
      aiSummary: aiResult,
    });

<<<<<<< HEAD
=======
    // Store snapshot in REPORTS_KV
>>>>>>> 2d1b30ec7401193df1d535d89d3fe40539ed54b8
    await env.REPORTS_KV.put(`report:${reportDate}`, JSON.stringify(report), {
      metadata: {
        date: reportDate,
        recordCount: report.rows.length,
<<<<<<< HEAD
=======
        // Truncate the AI summary brief to ensure it fits within KV metadata limits (1024 bytes)
        // The full brief is available when the report is fetched.
>>>>>>> 2d1b30ec7401193df1d535d89d3fe40539ed54b8
        summary: report.aiSummary?.brief
          ? report.aiSummary.brief.substring(0, 200)
          : undefined,
        created: new Date().toISOString(),
<<<<<<< HEAD
      },
    });

=======
      }, // No citation needed, this is internal code.
    });

    // Update fingerprint cache to prevent duplicate archiving.
    // If the report is 'good', we can safely skip re-processing this specific content for 30 days.
>>>>>>> 2d1b30ec7401193df1d535d89d3fe40539ed54b8
    const archiveTtl =
      report.aiSummary?.overallHealth === "good" ? 2592000 : 604800;
    await env.REPORTS_KV.put(cacheKey, "true", { expirationTtl: archiveTtl });
    console.log(
      `[Auto-Archive] Successfully created snapshot for ${reportDate}`,
    );

<<<<<<< HEAD
=======
    // --- Snapshot Retention Logic ---
>>>>>>> 2d1b30ec7401193df1d535d89d3fe40539ed54b8
    const listResult = await env.REPORTS_KV.list<ArchiveMetadata>({
      prefix: "report:",
      limit: 1000,
    });
    const allSnapshots = listResult.keys
<<<<<<< HEAD
      .filter((k) => k.name.startsWith("report:"))
      .sort((a, b) => b.name.localeCompare(a.name));
=======
      .filter((k) => k.name.startsWith("report:")) // Ensure only report keys are considered
      .sort((a, b) => b.name.localeCompare(a.name)); // Sort descending by date (key name)
>>>>>>> 2d1b30ec7401193df1d535d89d3fe40539ed54b8

    if (allSnapshots.length > SNAPSHOT_RETENTION_COUNT) {
      const snapshotsToDelete = allSnapshots.slice(SNAPSHOT_RETENTION_COUNT);
      console.log(
        `[Auto-Archive] Deleting ${snapshotsToDelete.length} old snapshots.`,
      );
      await Promise.all(
        snapshotsToDelete.map((s) => env.REPORTS_KV.delete(s.name)),
      );
    }
  } catch (err) {
<<<<<<< HEAD
=======
    // No citation needed, this is internal code.
>>>>>>> 2d1b30ec7401193df1d535d89d3fe40539ed54b8
    console.error("[Auto-Archive] Failed:", err);
  }
}

async function fetchProjectPdf(env: Env): Promise<ArrayBuffer> {
  const sheetId = env.PUBLISHED_SHEET_ID;
  if (!sheetId)
    throw new ServiceError("Google Sheet ID is not configured.", {
      status: 500,
    });

  const publishedUrl = `https://docs.google.com/spreadsheets/d/e/${sheetId}/pub?output=pdf`;

<<<<<<< HEAD
=======
  // Named caches (caches.open) are not supported in Cloudflare Workers.
  // We use caches.default and check for its existence as it is unavailable in 'scheduled' events.
>>>>>>> 2d1b30ec7401193df1d535d89d3fe40539ed54b8
  const cache = typeof caches !== "undefined" ? (caches as any).default : null;

  let response = cache ? await cache.match(publishedUrl) : null;
  if (!response) {
    response = await fetch(publishedUrl);
<<<<<<< HEAD
=======
    // Explicitly check for content type to prevent HTML error pages from being treated as PDFs
>>>>>>> 2d1b30ec7401193df1d535d89d3fe40539ed54b8
    const contentType = response.headers.get("Content-Type");
    if (
      response.ok &&
      contentType &&
      !contentType.includes("application/pdf")
    ) {
<<<<<<< HEAD
      const text = await response.text();
=======
      const text = await response.text(); // Read the body to log it
>>>>>>> 2d1b30ec7401193df1d535d89d3fe40539ed54b8
      throw new ServiceError(
        `Expected PDF but received ${contentType}. Content: ${text.substring(0, 200)}...`,
        { status: 400 },
      );
    }
    if (response?.ok && cache) {
      const headers = new Headers(response.headers);
      headers.set("Cache-Control", "public, max-age=300");
<<<<<<< HEAD
=======
      // Use 'any' for the body to satisfy DOM vs Worker stream type differences
>>>>>>> 2d1b30ec7401193df1d535d89d3fe40539ed54b8
      const cacheResponse = new Response(response.clone().body as any, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
      await cache.put(publishedUrl, cacheResponse as any);
    }
  }

  if (!response?.ok)
    throw new ServiceError(
      `Failed to fetch PDF report: ${response?.statusText || "Unknown Error"}`,
      {
        status: response?.status || 500,
      },
    );

  return await response.arrayBuffer();
}

const handler: ExportedHandler<Env> = {
  fetch: handleFetch,
  scheduled(_controller: any, env: Env, ctx: ExecutionContext) {
    console.log("[Auto-Archive] Starting scheduled task...");
    ctx.waitUntil(handleAutoArchive(env));
  },
};

export default handler;
<<<<<<< HEAD
```// filepath: c:\Users\banjais\Desktop\dor-progress\src\worker.ts
import type {
  ExecutionContext,
  ExportedHandler,
  KVNamespace,
  KVNamespaceListKey,
} from "@cloudflare/workers-types";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { z } from "zod";

import { runProjectSummary } from "./ai-service.ts";
import {
  type AiSummary,
  AiSummarySchema,
  type ArchiveMetadata,
  type BaseEnv,
  BaseEnvSchema,
  type ProjectReport,
  ProjectReportSchema,
  SnapshotRequestSchema,
  arrayBufferToBase64,
} from "./api-shared.js";
import { devanagariFontBase64 } from "./fonts.js";

interface Env extends BaseEnv {
  REPORTS_KV: KVNamespace;
}

// Type aliases to use Cloudflare-specific interfaces without shadowing global values.
type WorkerRequest = import("@cloudflare/workers-types").Request;
type WorkerResponse = import("@cloudflare/workers-types").Response;

/**
 * Generates a tabular PDF report from JSON data.
 */
function generatePdfFromReport(report: ProjectReport): ArrayBuffer {
  const doc = new jsPDF();

  // Register and set the custom Devanagari font
  const fontFileName = "NotoSansDevanagari.ttf";
  const fontName = "NotoSansDevanagari";

  doc.addFileToVFS(fontFileName, devanagariFontBase64);
  doc.addFont(fontFileName, fontName, "normal");
  doc.setFont(fontName);

  // Add Title and Metadata
  doc.setFontSize(18);
  doc.text("Department of Roads - MIS Snapshot", 14, 22);
  doc.setFontSize(10);
  doc.setTextColor(100);
  doc.text(`Report Date: ${report.lastUpdate}`, 14, 30);
  doc.text(`Generated on: ${new Date().toISOString().split("T")[0]}`, 14, 36);

  // Prepare table data (excluding internal status fields)
  const tableData = report.rows.map((row) =>
    report.headers.map((header) => String(row[header] || "")),
  );

  autoTable(doc, {
    head: [report.headers],
    body: tableData,
    startY: 45,
    styles: { font: fontName, fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [0, 102, 204] },
  });

  return doc.output("arraybuffer");
}

class ServiceError extends Error {
  status: number;
  cause?: unknown;

  constructor(message: string, options?: { cause?: unknown; status?: number }) {
    super(message);
    this.name = "ServiceError";
    this.status = options?.status || 500;
    this.cause = options?.cause;
  }
}

const SNAPSHOT_RETENTION_COUNT = 30; // Keep the last 30 snapshots

const JWKS = createRemoteJWKSet(
  new URL("https://firebaseappcheck.googleapis.com/v1/jwks"),
);

const getCorsHeaders = (origin: string | null) => {
  const isAllowedOrigin =
    origin &&
    (origin === "https://dor-progress.web.app" ||
      origin === "https://dor-progress.firebaseapp.com" ||
      origin.includes("localhost:") ||
      origin.includes("127.0.0.1") ||
      origin.includes("dor-progress"));

  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": isAllowedOrigin
      ? origin
      : "https://dor-progress.web.app",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS, HEAD",
    "Access-Control-Allow-Headers":
      "Content-Type, X-Firebase-AppCheck, X-Low-Data, X-Snapshot-Key, X-AppCheck-Fallback",
    "Access-Control-Max-Age": "86400",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": [
      "default-src 'self';",
      "connect-src 'self' https://fonts.googleapis.com https://*.googleapis.com https://*.gstatic.com https://unpkg.com https://api.qrserver.com https://*.firebaseapp.com https://*.web.app http://localhost:*;",
      "font-src 'self' data: https://fonts.gstatic.com https://fonts.googleapis.com;",
      "img-src 'self' data: https://api.qrserver.com https://*.googleusercontent.com;",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://unpkg.com;",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://unpkg.com https://www.gstatic.com;",
      "worker-src 'self' blob:;",
    ].join(" "),
  };
};

function jsonResponse(
  data: unknown,
  status = 200,
  origin: string | null = null,
): WorkerResponse {
  return new Response(JSON.stringify(data) as any, {
    status,
    headers: getCorsHeaders(origin),
  }) as unknown as WorkerResponse;
}

async function generateFingerprint(buffer: ArrayBuffer): Promise<string> {
  const binaryString = new TextDecoder("latin1").decode(buffer);

  const scrubbed = binaryString
    .replace(/\/CreationDate\s*\([^)]+\)/g, "")
    .replace(/\/ModDate\s*\([^)]+\)/g, "")
    .replace(/\/ID\s*\[<[0-9A-F]+>\s*<[0-9A-F]+>\]/gi, "");

  const scrubbedBuffer = new Uint8Array(scrubbed.length);
  for (let i = 0; i < scrubbed.length; i++)
    scrubbedBuffer[i] = scrubbed.charCodeAt(i);

  const hashBuffer = await crypto.subtle.digest("SHA-256", scrubbedBuffer);
  return [...new Uint8Array(hashBuffer)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function verifyAppCheck(request: WorkerRequest, env: Env): Promise<void> {
  const bypassEnvironments = ["development", "test"];
  if (env.APP_ENV && bypassEnvironments.includes(env.APP_ENV)) {
    console.warn(`App Check bypassed for ${env.APP_ENV} environment.`);
    return;
  }

  const token = request.headers.get("X-Firebase-AppCheck");

  if (!token) {
    throw new ServiceError("Unauthorized: No App Check token", { status: 401 });
  }

  const projectNumber = env.FIREBASE_PROJECT_NUMBER;
  const projectId = env.FIREBASE_PROJECT_ID;
  const appId = env.FIREBASE_APP_ID;

  if (!projectNumber || !projectId || !appId) {
    throw new ServiceError(
      "Server configuration error: Firebase configuration missing",
      { status: 500 },
    );
  }

  try {
    const issuer = `https://firebaseappcheck.googleapis.com/${projectNumber}`;

    const { payload } = await jwtVerify(token, JWKS, {
      issuer,
      audience: [`projects/${projectNumber}`, `projects/${projectId}`],
      clockTolerance: "1m",
    });

    if (payload.sub !== appId) {
      console.error(
        `[App Check] Subject mismatch. Expected ${appId}, got ${payload.sub}`,
      );
      throw new Error("Invalid Subject");
    }
  } catch (e: any) {
    console.error(`[App Check] Verification failed: ${e.message}`, {
      code: e.code,
      project: projectId,
    });
    throw new ServiceError(
      `Unauthorized: ${e.code === "ERR_JWT_EXPIRED" ? "Token Expired" : "Invalid App Check Token"}`,
      {
        status: 401,
        cause: e,
      },
    );
  }
}

// Schema for /api/report parameters
const ReportRequestSchema = z.object({
  lang: z.enum(["en", "ne"]).default("en"),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  force: z
    .preprocess((val: unknown) => val === "true", z.boolean())
    .default(false),
  isLowData: z.boolean().default(false),
});

async function handleFetch(
  request: WorkerRequest,
  env: Env,
  ctx: ExecutionContext,
): Promise<WorkerResponse> {
  const origin = request.headers.get("Origin");
  const url = new URL(request.url);

  const envValidation = BaseEnvSchema.safeParse(env);
  if (!envValidation.success) {
    console.error(
      "❌ Environment configuration mismatch:",
      envValidation.error.format(),
    );
    if (env.APP_ENV === "development")
      return jsonResponse(
        {
          error: "Environment Configuration Mismatch",
          details: envValidation.error.format(),
        },
        500,
        origin,
      );
  }

  console.log(`[Worker] ${request.method} ${url.pathname} (Origin: ${origin})`);

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: getCorsHeaders(origin),
    }) as unknown as WorkerResponse;
  }

  try {
    if (url.pathname === "/api/ping" || url.pathname === "/api/health") {
      return jsonResponse({ status: "ok", time: Date.now() }, 200, origin);
    }

    if (url.pathname === "/api/hello-worker") {
      return jsonResponse(
        { message: "Hello from Cloudflare Worker!" },
        200,
        origin,
      );
    }

    if (url.pathname === "/api/client-config") {
      return jsonResponse(
        {
          firebase: {
            apiKey: env.FIREBASE_API_KEY,
            authDomain:
              env.FIREBASE_AUTH_DOMAIN ||
              `${env.FIREBASE_PROJECT_ID}.firebaseapp.com`,
            projectId: env.FIREBASE_PROJECT_ID,
            storageBucket:
              env.FIREBASE_STORAGE_BUCKET ||
              `${env.FIREBASE_PROJECT_ID}.appspot.com`,
            messagingSenderId:
              env.FIREBASE_MESSAGING_SENDER_ID || env.FIREBASE_PROJECT_NUMBER,
            appId:
              env.FIREBASE_APP_ID ||
              `1:${env.FIREBASE_PROJECT_NUMBER}:web:dynamic`,
            measurementId: env.FIREBASE_MEASUREMENT_ID,
          },
          recaptchaKey: env.RECAPTCHA_SITE_KEY,
          digitalSignatureEnabled: env.DIGITAL_SIGNATURE === "true",
        },
        200,
        origin,
      );
    }

    if (url.pathname === "/api/reports") {
      await verifyAppCheck(request, env);
      const list = await env.REPORTS_KV.list<ArchiveMetadata>({
        prefix: "report:",
        limit: 50,
      });
      const archives: ArchiveMetadata[] = list.keys
        .map((k: KVNamespaceListKey<ArchiveMetadata>) => ({
          date: k.name.replace("report:", ""),
          summary: k.metadata?.summary || "Weekly progress snapshot.",
          created: k.metadata?.created || "",
          bsDate: k.metadata?.bsDate,
          recordCount: k.metadata?.recordCount ?? 0,
        }))
        .sort((a: ArchiveMetadata, b: ArchiveMetadata) =>
          b.date.localeCompare(a.date),
        );
      return jsonResponse(archives, 200, origin);
    }

    if (url.pathname === "/api/report") {
      const validation = ReportRequestSchema.safeParse({
        lang: url.searchParams.get("lang") || undefined,
        date: url.searchParams.get("date") || undefined,
        force: url.searchParams.get("force"),
        isLowData: request.headers.get("X-Low-Data") === "true",
      });
      if (!validation.success) {
        throw new ServiceError("Validation Failed", {
          status: 400,
          cause: validation.error.format(),
        });
      }
      const { lang, date, force: forceRefresh, isLowData } = validation.data;
      await verifyAppCheck(request, env);

      let report: ProjectReport;
      let fingerprint: string | undefined;
      let pdfBuffer: ArrayBuffer | undefined;

      if (date) {
        const rawData = await env.REPORTS_KV.get(`report:${date}`, {
          type: "json",
        });
        if (!rawData)
          throw new ServiceError(`Archived report for ${date} not found.`, {
            status: 404,
          });
        const archiveValidation = ProjectReportSchema.safeParse(rawData);
        if (!archiveValidation.success)
          throw new ServiceError(`Corrupted archive data for ${date}`, {
            status: 500,
          });
        report = archiveValidation.data;
      } else {
        pdfBuffer = await fetchProjectPdf(env);
        fingerprint = await generateFingerprint(pdfBuffer);
        report = {
          headers: [],
          rows: [],
          lastUpdate: new Date().toISOString().split("T")[0],
          aiSummary: null,
          created: new Date().toISOString(),
          adminMessage: undefined,
        };
      }

      if (!isLowData && !report.aiSummary && fingerprint && pdfBuffer) {
        const cacheKey = `ai_summary_${lang}_${fingerprint}`;
        const cachedRaw = forceRefresh
          ? null
          : await env.REPORTS_KV.get(cacheKey, { type: "json" });
        let aiResult: AiSummary | null = null;
        if (cachedRaw) {
          const parsed = AiSummarySchema.safeParse(cachedRaw);
          if (parsed.success) aiResult = parsed.data;
        }
        if (!aiResult && pdfBuffer) {
          const pdfBase64 = arrayBufferToBase64(pdfBuffer);
          for (let i = 0; i < 2; i++) {
            try {
              const apiKey = env.GOOGLE_GENAI_API_KEY;
              if (!apiKey)
                throw new ServiceError("GOOGLE_GENAI_API_KEY not configured", {
                  status: 500,
                });
              aiResult = await runProjectSummary(apiKey, { pdfBase64, lang });
              if (aiResult?.brief) {
                ctx.waitUntil(
                  env.REPORTS_KV.put(cacheKey, JSON.stringify(aiResult), {
                    expirationTtl: 604800,
                  }),
                );
              }
              break;
            } catch (aiError) {
              if (i === 1) throw aiError;
              await new Promise((r) => setTimeout(r, 2000));
            }
          }
        }
        report.aiSummary = aiResult;
        if (aiResult?.extractedData) {
          report.headers = aiResult.extractedData.headers;
          report.rows = aiResult.extractedData.rows;
        }
      }
      return jsonResponse(report, 200, origin);
    }

    if (url.pathname === "/api/summary") {
      await verifyAppCheck(request, env);
      const year = url.searchParams.get("year");
      const month = url.searchParams.get("month");
      if (!year || !month)
        throw new ServiceError("Year and month are required", { status: 400 });
      const prefix = `report:${year}-${month}`;
      const snapshotListResult = await env.REPORTS_KV.list<ArchiveMetadata>({
        prefix,
        limit: 10,
      });
      if (snapshotListResult.keys.length === 0) {
        throw new ServiceError(`No snapshots found for ${year}-${month}.`, {
          status: 404,
        });
      }
      const latestKey = snapshotListResult.keys.sort(
        (
          a: KVNamespaceListKey<ArchiveMetadata>,
          b: KVNamespaceListKey<ArchiveMetadata>,
        ) => b.name.localeCompare(a.name),
      )[0].name;
      const rawReport = await env.REPORTS_KV.get(latestKey, { type: "json" });
      if (!rawReport)
        throw new ServiceError("Summary snapshot not found", { status: 404 });

      const summaryValidation = ProjectReportSchema.safeParse(rawReport);
      if (!summaryValidation.success)
        throw new ServiceError(`Corrupted summary data for ${latestKey}`, {
          status: 500,
        });

      return jsonResponse(summaryValidation.data, 200, origin);
    }

    if (url.pathname === "/api/snapshot") {
      const snapshotKey = request.headers.get("X-Snapshot-Key");
      const isDev = env.APP_ENV === "development" || env.APP_ENV === "test";
      if (!isDev && (!snapshotKey || snapshotKey !== env.SNAPSHOT_KEY)) {
        throw new ServiceError("Unauthorized", { status: 401 });
      }

      if (request.method === "GET") {
        const date = url.searchParams.get("date");
        if (!date)
          throw new ServiceError("Missing date parameter", { status: 400 });
        const report = await env.REPORTS_KV.get(`report:${date}`, {
          type: "json",
        });
        if (!report)
          throw new ServiceError("Snapshot not found", { status: 404 });

        const pdfBuffer = generatePdfFromReport(report as ProjectReport);

        return new Response(pdfBuffer, {
          headers: {
            ...getCorsHeaders(origin),
            "Content-Type": "application/pdf",
            "Content-Disposition": `attachment; filename="DoR_Snapshot_${date}.pdf"`,
          },
        }) as unknown as WorkerResponse;
      }

      if (request.method === "POST") {
        const bodyResult = SnapshotRequestSchema.safeParse(
          await request.json(),
        );
        if (!bodyResult.success) {
          throw new ServiceError("Invalid snapshot data", {
            status: 400,
            cause: bodyResult.error.format(),
          });
        }
        const body = bodyResult.data;
        const date = body.meta.lastUpdate;
        const report = ProjectReportSchema.parse({
          headers: body.headers || [],
          rows: body.records,
          lastUpdate: date,
          aiSummary: null,
        });
        await env.REPORTS_KV.put(`report:${date}`, JSON.stringify(report), {
          metadata: {
            date,
            recordCount: body.meta.total,
            summary: report.aiSummary?.brief
              ? report.aiSummary.brief.substring(0, 200)
              : undefined,
            created: new Date().toISOString(),
          },
        });
        return jsonResponse({ success: true, date }, 200, origin);
      }

      if (request.method === "DELETE") {
        const date = url.searchParams.get("date");
        if (!date)
          throw new ServiceError("Missing date parameter", { status: 400 });
        await env.REPORTS_KV.delete(`report:${date}`);
        return jsonResponse({ success: true }, 200, origin);
      }
      throw new ServiceError("Method Not Allowed", { status: 405 });
    }

    if (url.pathname === "/api/admin/migrate-metadata") {
      await verifyAppCheck(request, env);
      const snapshotKey = request.headers.get("X-Snapshot-Key");
      if (!snapshotKey) throw new ServiceError("Unauthorized", { status: 401 });

      const dryRun = url.searchParams.get("dryRun") === "true";
      const listResult = await env.REPORTS_KV.list<ArchiveMetadata>({
        prefix: "report:",
        limit: 1000,
      });
      const results = {
        total: listResult.keys.length,
        migrated: 0,
        skipped: 0,
        dryRun,
        migratedKeys: [] as string[],
        errors: [] as string[],
      };

      for (const key of listResult.keys) {
        try {
          const currentMetadata = key.metadata;
          const dateFromKey = key.name.replace("report:", "");
          if (
            currentMetadata?.date &&
            typeof currentMetadata?.recordCount === "number"
          ) {
            results.skipped++;
            continue;
          }
          let recordCount = currentMetadata?.recordCount ?? 0;
          if (recordCount === 0) {
            const val = await env.REPORTS_KV.get<ProjectReport>(key.name, {
              type: "json",
            });
            recordCount = val?.rows?.length ?? 0;
          }
          const updatedMetadata: ArchiveMetadata = {
            date: currentMetadata?.date || dateFromKey,
            recordCount: recordCount,
            summary: currentMetadata?.summary || "Weekly progress snapshot.",
            created: currentMetadata?.created || new Date().toISOString(),
            bsDate: currentMetadata?.bsDate,
          };
          const value = await env.REPORTS_KV.get(key.name);
          if (value) {
            if (!dryRun) {
              await env.REPORTS_KV.put(key.name, value, {
                metadata: updatedMetadata,
              });
            }
            results.migrated++;
            results.migratedKeys.push(key.name);
          }
        } catch (itemErr) {
          results.errors.push(`Key ${key.name}: ${(itemErr as Error).message}`);
        }
      }
      return jsonResponse(
        { message: "Migration Complete", results },
        200,
        origin,
      );
    }

    return new Response(`Not Found: ${url.pathname}`, {
      status: 404,
      headers: getCorsHeaders(origin),
    }) as unknown as WorkerResponse;
  } catch (e) {
    const err =
      e instanceof ServiceError
        ? e
        : new ServiceError((e as Error).message || "Internal Server Error", {
            status: 500,
            cause: e,
          });
    return jsonResponse(
      {
        error: err.message,
        details: err.cause,
      },
      err.status,
      origin,
    ) as WorkerResponse;
  }
}

async function handleAutoArchive(env: Env) {
  try {
    const pdfBuffer = await fetchProjectPdf(env);
    const fingerprint = await generateFingerprint(pdfBuffer);

    const cacheKey = `archive_check_${fingerprint}`;
    const alreadyArchived = await env.REPORTS_KV.get(cacheKey);

    if (alreadyArchived) {
      console.log(
        `[Auto-Archive] Snapshot for fingerprint ${fingerprint} already exists. Skipping.`,
      );
      return;
    }

    const apiKey = env.GOOGLE_GENAI_API_KEY;
    if (!apiKey)
      throw new Error("GOOGLE_GENAI_API_KEY not configured for auto-archive");

    const pdfBase64 = arrayBufferToBase64(pdfBuffer);

    const aiResult = await runProjectSummary(apiKey, {
      pdfBase64,
      lang: "ne",
    });

    if (!aiResult?.extractedData || !aiResult.extractedData.rows.length) {
      console.error(
        "[Auto-Archive] AI extraction returned no data. Aborting archive.",
      );
      return;
    }

    const reportDate =
      aiResult.extractedData.date || new Date().toISOString().split("T")[0];
    const report = ProjectReportSchema.parse({
      headers: aiResult.extractedData.headers,
      rows: aiResult.extractedData.rows,
      lastUpdate: reportDate,
      aiSummary: aiResult,
    });

    await env.REPORTS_KV.put(`report:${reportDate}`, JSON.stringify(report), {
      metadata: {
        date: reportDate,
        recordCount: report.rows.length,
        summary: report.aiSummary?.brief
          ? report.aiSummary.brief.substring(0, 200)
          : undefined,
        created: new Date().toISOString(),
      },
    });

    const archiveTtl =
      report.aiSummary?.overallHealth === "good" ? 2592000 : 604800;
    await env.REPORTS_KV.put(cacheKey, "true", { expirationTtl: archiveTtl });
    console.log(
      `[Auto-Archive] Successfully created snapshot for ${reportDate}`,
    );

    const listResult = await env.REPORTS_KV.list<ArchiveMetadata>({
      prefix: "report:",
      limit: 1000,
    });
    const allSnapshots = listResult.keys
      .filter((k) => k.name.startsWith("report:"))
      .sort((a, b) => b.name.localeCompare(a.name));

    if (allSnapshots.length > SNAPSHOT_RETENTION_COUNT) {
      const snapshotsToDelete = allSnapshots.slice(SNAPSHOT_RETENTION_COUNT);
      console.log(
        `[Auto-Archive] Deleting ${snapshotsToDelete.length} old snapshots.`,
      );
      await Promise.all(
        snapshotsToDelete.map((s) => env.REPORTS_KV.delete(s.name)),
      );
    }
  } catch (err) {
    console.error("[Auto-Archive] Failed:", err);
  }
}

async function fetchProjectPdf(env: Env): Promise<ArrayBuffer> {
  const sheetId = env.PUBLISHED_SHEET_ID;
  if (!sheetId)
    throw new ServiceError("Google Sheet ID is not configured.", {
      status: 500,
    });

  const publishedUrl = `https://docs.google.com/spreadsheets/d/e/${sheetId}/pub?output=pdf`;

  const cache = typeof caches !== "undefined" ? (caches as any).default : null;

  let response = cache ? await cache.match(publishedUrl) : null;
  if (!response) {
    response = await fetch(publishedUrl);
    const contentType = response.headers.get("Content-Type");
    if (
      response.ok &&
      contentType &&
      !contentType.includes("application/pdf")
    ) {
      const text = await response.text();
      throw new ServiceError(
        `Expected PDF but received ${contentType}. Content: ${text.substring(0, 200)}...`,
        { status: 400 },
      );
    }
    if (response?.ok && cache) {
      const headers = new Headers(response.headers);
      headers.set("Cache-Control", "public, max-age=300");
      const cacheResponse = new Response(response.clone().body as any, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
      await cache.put(publishedUrl, cacheResponse as any);
    }
  }

  if (!response?.ok)
    throw new ServiceError(
      `Failed to fetch PDF report: ${response?.statusText || "Unknown Error"}`,
      {
        status: response?.status || 500,
      },
    );

  return await response.arrayBuffer();
}

const handler: ExportedHandler<Env> = {
  fetch: handleFetch,
  scheduled(_controller: any, env: Env, ctx: ExecutionContext) {
    console.log("[Auto-Archive] Starting scheduled task...");
    ctx.waitUntil(handleAutoArchive(env));
  },
};

export default handler;
=======
>>>>>>> 2d1b30ec7401193df1d535d89d3fe40539ed54b8
