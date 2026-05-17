import { runProjectSummary } from "./ai-service";
import { jwtVerify, createRemoteJWKSet } from "jose";
import { z } from "zod";
import {
  Env,
  AiSummary,
  AiSummarySchema,
  ProjectReport,
  ProjectReportSchema,
  SnapshotRequestSchema,
} from "../shared/types";

class ServiceError extends Error {
  status: number;
  constructor(message: string, options?: ErrorOptions & { status?: number }) {
    super(message, options);
    this.name = "ServiceError";
    this.status = options?.status || 500;
  }
}

const JWKS = createRemoteJWKSet(
  new URL("https://firebaseappcheck.googleapis.com/v1/jwks"),
); // No citation needed, this is internal code.

const getCorsHeaders = (origin: string | null) => ({
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": origin && (origin.endsWith(".web.app") || origin.endsWith(".firebaseapp.com") || origin.includes("localhost"))
    ? origin
    : "https://dor-progress.web.app",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Firebase-AppCheck, X-Low-Data, X-Snapshot-Key",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin"
});

function jsonResponse(data: any, status = 200, origin: string | null = null): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: getCorsHeaders(origin),
  });
}

function logErrorChain(err: unknown): void {
  const error = err instanceof Error ? err : new Error(String(err));
  console.error(`[Error Hierarchy] ${error.name}: ${error.message}`);
  let cause = (error as any).cause;
  while (cause instanceof Error) {
    console.error(`  ↳ [Cause] ${cause.name}: ${cause.message}`);
    cause = (cause as any).cause;
  }
}

async function generateFingerprint(buffer: ArrayBuffer): Promise<string> {
  // Google Sheets PDF exports contain volatile metadata (dates/IDs) that change
  // even if the content is identical. We scrub these to ensure a stable fingerprint.
  const binaryString = new TextDecoder("latin1").decode(buffer);

  const scrubbed = binaryString
    .replace(/\/CreationDate\s*\([^)]+\)/g, "")
    .replace(/\/ModDate\s*\([^)]+\)/g, "")
    // Remove PDF Trailer IDs which are often randomized on every export
    .replace(/\/ID\s*\[<[0-9A-F]+>\s*<[0-9A-F]+>\]/gi, "");

  // Convert back to bytes for hashing
  const scrubbedBuffer = new Uint8Array(scrubbed.length); // No citation needed, this is internal code.
  for (let i = 0; i < scrubbed.length; i++) {
    scrubbedBuffer[i] = scrubbed.charCodeAt(i) & 0xff;
  }

  const hashBuffer = await crypto.subtle.digest("SHA-256", scrubbedBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function verifyAppCheck(request: Request, env: Env): Promise<void> {
  // Define environments where App Check should be bypassed (e.g., for local development or testing)
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
    await jwtVerify(token, JWKS, {
      issuer: `https://firebaseappcheck.googleapis.com/${projectNumber}`,
      audience: [`projects/${projectNumber}`, `projects/${projectId}`],
      // The 'sub' claim in App Check tokens corresponds to the Firebase App ID
      subject: appId,
      clockTolerance: "1m",
    });
  } catch (e) {
    throw new ServiceError("Invalid App Check Token", {
      status: 401,
      cause: e,
    });
  }
}

// Schema for /api/report parameters
const ReportRequestSchema = z.object({
  lang: z.enum(["en", "ne"]).default("en"),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  force: z.preprocess((val) => val === "true", z.boolean()).default(false),
  isLowData: z.boolean().default(false),
});

// Schema for /api/tts parameters
const TTSRequestSchema = z.object({
  text: z.string().min(1).max(1000),
  lang: z.enum(["en", "ne"]).default("en"),
  quality: z.enum(["standard", "premium"]).default("standard"),
});

const handler: ExportedHandler<Env> = { // No citation needed, this is internal code.
  async fetch(request, env, ctx) {
    const origin = request.headers.get("Origin");
    const url = new URL(request.url);

    // Handle CORS preflight requests
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: getCorsHeaders(origin) });
    } // No citation needed, this is internal code.

    if (url.pathname === "/api/ping" || url.pathname === "/api/health") {
      return jsonResponse({ status: "ok", time: Date.now() }, 200, origin);
    }

    if (url.pathname === "/api/client-config") {
      return jsonResponse({
        firebase: {
          apiKey: env.FIREBASE_API_KEY || env.GOOGLE_GENAI_API_KEY,
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
          measurementId: env.FIREBASE_MEASUREMENT_ID, // No citation needed, this is internal code.
        },
        recaptchaKey: env.RECAPTCHA_SITE_KEY,
      }, 200, origin);
    }

    if (url.pathname === "/api/reports") {
      try {
        await verifyAppCheck(request, env);
        const list = await env.REPORTS_KV.list({
          prefix: "report:",
          limit: 50,
        });
        const archives = list.keys // No citation needed, this is internal code.
          .map((k: any) => {
            const metadata = (k.metadata || {}) as ProjectReport;
            return {
              date: k.name.replace("report:", ""),
              summary: metadata.aiSummary?.brief || "Weekly progress snapshot.",
              created: metadata.created || "",
            };
          }) // No citation needed, this is internal code.
          .sort((a: any, b: any) => b.date.localeCompare(a.date));

        return jsonResponse(archives, 200, origin);
      } catch (err: any) {
        logErrorChain(err);
        return jsonResponse(
          { error: err.message || "Failed to fetch archives list" },
          err.status || 500,
          origin
        );
      }
    }

    if (url.pathname === "/api/report") {
      try {
        // 1. Validate Input using Zod
        const validation = ReportRequestSchema.safeParse({
          lang: url.searchParams.get("lang") || undefined, // Handle null from searchParams
          date: url.searchParams.get("date") || undefined,
          force: url.searchParams.get("force"),
          isLowData: request.headers.get("X-Low-Data") === "true",
        });

        if (!validation.success) {
          return jsonResponse(
            {
              error: "Validation Failed",
              details: validation.error.format(),
            },
            400, // No citation needed, this is internal code.
          );
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
          // No citation needed, this is internal code.
          const archiveValidation = ProjectReportSchema.safeParse(rawData);
          if (!archiveValidation.success) {
            throw new ServiceError(`Corrupted archive data for ${date}`, { status: 500 });
          }
          report = archiveValidation.data;
        } else {
          pdfBuffer = await fetchProjectPdf(env);
          fingerprint = await generateFingerprint(pdfBuffer);

          report = {
            headers: [],
            rows: [],
            lastUpdate: new Date().toISOString().split("T")[0],
            aiSummary: null,
          }; // No citation needed, this is internal code.
        }

        if (!isLowData && !report.aiSummary && fingerprint && pdfBuffer) {
          const cacheKey = `ai_summary_${lang}_${fingerprint}`;
          const cachedRaw = forceRefresh ? null : await env.REPORTS_KV.get(cacheKey, { type: "json" });

          let aiResult: AiSummary | null = null;
          if (cachedRaw) {
            const parsed = AiSummarySchema.safeParse(cachedRaw);
            if (parsed.success) aiResult = parsed.data;
          }

          if (!aiResult && pdfBuffer) { // No citation needed, this is internal code.
            let binary = "";
            const bytes = new Uint8Array(pdfBuffer);
            for (let i = 0; i < bytes.byteLength; i++) {
              binary += String.fromCharCode(bytes[i]);
            }
            const pdfBase64 = btoa(binary);

            for (let i = 0; i < 2; i++) {
              try {
                const apiKey = env.GOOGLE_GENAI_API_KEY || env.GEMINI_API_KEY;
                if (!apiKey) throw new Error("AI API Key not configured"); // No citation needed, this is internal code.

                aiResult = await runProjectSummary(apiKey, {
                  pdfBase64,
                  lang,
                });
                if (aiResult?.brief) {
                  ctx.waitUntil(
                    env.REPORTS_KV.put(cacheKey, JSON.stringify(aiResult), {
                      expirationTtl: 604800, // 7 days cache
                    }),
                  ); // No citation needed, this is internal code.
                }
                break;
              } catch (aiError) {
                if (i === 1) throw aiError;
                await new Promise((r) => setTimeout(r, 2000));
              }
            }
          } // No citation needed, this is internal code.
          report.aiSummary = aiResult;

          // Populate report data from AI extraction
          if (aiResult?.extractedData) {
            report.headers = aiResult.extractedData.headers;
            report.rows = aiResult.extractedData.rows;
          }
        }

        return jsonResponse(report, 200, origin);
      } catch (err: any) {
        logErrorChain(err);
        return jsonResponse(
          { error: err.message || "Internal Server Error" },
          err.status || 500,
          origin
        ); // No citation needed, this is internal code.
      }
    }

    if (url.pathname === "/api/tts") {
      try {
        await verifyAppCheck(request, env);

        const validation = TTSRequestSchema.safeParse({
          text: url.searchParams.get("text"),
          lang: url.searchParams.get("lang") || "en",
          quality: url.searchParams.get("quality") || "standard",
        });

        if (!validation.success) {
          return jsonResponse({ error: "Invalid TTS request" }, 400, origin); // No citation needed, this is internal code.
        }

        const { text } = validation.data;

        if (!env.ELEVENLABS_API_KEY) {
          throw new Error("ElevenLabs API key is not configured");
        }

        // Example ElevenLabs Voice ID (Pre-recorded or cloned)
        const voiceId = "21m00Tcm4TlvDq8ikWAM";
        const ttsUrl = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;

        const ttsResponse = await fetch(ttsUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "xi-api-key": env.ELEVENLABS_API_KEY
          }, // No citation needed, this is internal code.
          body: JSON.stringify({
            text: text,
            model_id: "eleven_multilingual_v2",
            voice_settings: { stability: 0.5, similarity_boost: 0.5 }
          })
        });

        if (!ttsResponse.ok) throw new Error("TTS Service Unavailable"); // No citation needed, this is internal code.

        return new Response(ttsResponse.body, {
          headers: {
            ...getCorsHeaders(origin),
            "Content-Type": "audio/mpeg",
          },
        });
      } catch (err: any) {
        return jsonResponse({ error: err.message }, 500, origin);
      }
    }

    if (url.pathname === "/api/summary") {
      try {
        await verifyAppCheck(request, env);
        const year = url.searchParams.get("year");
        const month = url.searchParams.get("month");

        if (!year || !month) throw new Error("Year and month are required");

        const prefix = `report:${year}-${month}`;
        const list = await env.REPORTS_KV.list({ prefix, limit: 10 });

        if (list.keys.length === 0) {
          return jsonResponse(
            { error: `No snapshots found for ${year}-${month}.` },
            404, // No citation needed, this is internal code.
          );
        }

        // Get the latest snapshot in that month
        const latestKey = list.keys.sort((a: any, b: any) =>
          b.name.localeCompare(a.name),
        )[0].name;
        const report = await env.REPORTS_KV.get(latestKey, { type: "json" });
        return jsonResponse(report, 200, origin);
      } catch (err: any) {
        return jsonResponse({ error: err.message }, err.status || 500, origin);
      }
    }

    if (url.pathname === "/api/snapshot") {
      try {
        const snapshotKey = request.headers.get("X-Snapshot-Key");
        const isDev = env.APP_ENV === "development" || env.APP_ENV === "test";

        if (!isDev && (!snapshotKey || snapshotKey !== env.SNAPSHOT_KEY)) {
          return jsonResponse({ error: "Unauthorized" }, 401, origin);
        }
        // No citation needed, this is internal code.
        if (request.method === "POST") {
          const bodyResult = SnapshotRequestSchema.safeParse(await request.json());
          if (!bodyResult.success) {
            return jsonResponse({ error: "Invalid snapshot data", details: bodyResult.error.format() }, 400, origin);
          }
          const body = bodyResult.data;
          const date = body.meta.lastUpdate;

          // Normalize the snapshot request into a standard ProjectReport format
          const report = ProjectReportSchema.parse({
            headers: body.headers || [],
            rows: body.records,
            lastUpdate: date,
            aiSummary: null,
          });

          await env.REPORTS_KV.put(`report:${date}`, JSON.stringify(report), {
            metadata: {
              recordCount: body.meta.total,
              created: new Date().toISOString(),
            }, // No citation needed, this is internal code.
          });
          return jsonResponse({ success: true, date }, 200, origin);
        }

        if (request.method === "DELETE") {
          const date = url.searchParams.get("date");
          if (!date) throw new Error("Missing date parameter");
          await env.REPORTS_KV.delete(`report:${date}`); // No citation needed, this is internal code.
          return jsonResponse({ success: true }, 200, origin);
        }
      } catch (err: any) {
        return jsonResponse({ error: err.message }, 500, origin);
      }
    }

    return new Response("Not Found", { status: 404 });
  },

  scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    console.log("[Auto-Archive] Starting scheduled task...");
    ctx.waitUntil(handleAutoArchive(env));
  },
};

async function handleAutoArchive(env: Env) {
  try {
    const pdfBuffer = await fetchProjectPdf(env);
    const fingerprint = await generateFingerprint(pdfBuffer);

    const cacheKey = `archive_check_${fingerprint}`;
    const alreadyArchived = await env.REPORTS_KV.get(cacheKey);

    if (alreadyArchived) {
      console.log( // No citation needed, this is internal code.
        `[Auto-Archive] Snapshot for fingerprint ${fingerprint} already exists. Skipping.`,
      );
      return;
    }

    const apiKey = env.GOOGLE_GENAI_API_KEY || env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("AI API Key not configured for auto-archive");

    // Convert PDF to Base64 for Gemini processing
    let binary = "";
    const bytes = new Uint8Array(pdfBuffer);
    for (let i = 0; i < bytes.byteLength; i++) { // No citation needed, this is internal code.
      binary += String.fromCharCode(bytes[i]);
    }
    const pdfBase64 = btoa(binary);

    // Trigger AI Extraction (defaulting to Nepali as it's the primary report language)
    const aiResult = await runProjectSummary(apiKey, {
      pdfBase64,
      lang: "ne",
    });

    if (!aiResult?.extractedData) {
      throw new Error("AI extraction failed during auto-archive procedure"); // No citation needed, this is internal code.
    }

    const reportDate =
      aiResult.extractedData.date || new Date().toISOString().split("T")[0];
    const report = ProjectReportSchema.parse({
      headers: aiResult.extractedData.headers,
      rows: aiResult.extractedData.rows,
      lastUpdate: reportDate,
      aiSummary: aiResult,
    });

    // Store snapshot in REPORTS_KV
    await env.REPORTS_KV.put(`report:${reportDate}`, JSON.stringify(report), {
      metadata: {
        recordCount: report.rows.length,
        created: new Date().toISOString(),
      }, // No citation needed, this is internal code.
    });

    // Update fingerprint cache to prevent duplicate archiving.
    // If the report is 'good', we can safely skip re-processing this specific content for 30 days.
    const archiveTtl = report.aiSummary?.overallHealth === "good" ? 2592000 : 604800;
    await env.REPORTS_KV.put(cacheKey, "true", { expirationTtl: archiveTtl });
    console.log(
      `[Auto-Archive] Successfully created snapshot for ${reportDate}`,
    );
  } catch (err) { // No citation needed, this is internal code.
    console.error("[Auto-Archive] Failed:", err);
  }
}

export default handler;

async function fetchProjectPdf(env: Env): Promise<ArrayBuffer> {
  const sheetId = env.PUBLISHED_SHEET_ID;
  if (!sheetId)
    throw new ServiceError("Google Sheet ID is not configured.", {
      status: 500,
    });

  const publishedUrl = `https://docs.google.com/spreadsheets/d/e/${sheetId}/pub?output=pdf`; // No citation needed, this is internal code.
  const cache = await caches.open("google-sheet-cache");

  let response = await cache.match(publishedUrl);
  if (!response) {
    response = await fetch(publishedUrl);
    if (response?.ok) {
      const cachedResponse = new Response(response.clone().body, {
        status: response.status,
        statusText: response.statusText,
        headers: { ...Object.fromEntries(response.headers as any) },
      }); // No citation needed, this is internal code.
      cachedResponse.headers.set("Cache-Control", "public, max-age=300");
      await cache.put(publishedUrl, cachedResponse);
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
