import { runProjectSummary } from "./ai-service.js";
import { jwtVerify, createRemoteJWKSet } from "jose";
import { z } from "zod";

export interface Env {
  REPORTS_KV: KVNamespace;
  GOOGLE_GENAI_API_KEY: string;
  FIREBASE_PROJECT_NUMBER: string;
  FIREBASE_PROJECT_ID: string;
  APP_ENV: string;
  DEBUG_MODE: string;
  PUBLISHED_SHEET_ID: string;
  RECAPTCHA_SITE_KEY: string;
  ADMIN_SECRET: string;
}

export type ProjectRow = Record<string, string | number>;

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
);

const CORS_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
};

function jsonResponse(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: CORS_HEADERS,
  });
}

function logErrorChain(err: any): void {
  if (!err) return;
  console.error(`[Error Hierarchy] ${err.name}: ${err.message}`);
  let cause = err.cause;
  while (cause) {
    console.error(
      `  ↳ [Cause] ${cause.name || "Error"}: ${cause.message || cause}`,
    );
    cause = cause.cause;
  }
}

async function generateFingerprint(buffer: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function verifyAppCheck(request: Request, env: Env): Promise<void> {
  // Define environments where App Check should be bypassed (e.g., for local development or testing)
  const bypassEnvironments = ["development", "test"];
  if (bypassEnvironments.includes(env.APP_ENV)) {
    console.warn(`App Check bypassed for ${env.APP_ENV} environment.`);
    return;
  }

  const token = request.headers.get("X-Firebase-AppCheck");
  if (!token) {
    throw new ServiceError("Unauthorized: No App Check token", { status: 401 });
  }

  try {
    const projectNumber = env.FIREBASE_PROJECT_NUMBER;
    await jwtVerify(token, JWKS, {
      issuer: `https://firebaseappcheck.googleapis.com/${projectNumber}`,
      audience: [
        `projects/${projectNumber}`,
        `projects/${env.FIREBASE_PROJECT_ID}`,
      ],
      clockTolerance: "1m",
    });
  } catch (e) {
    throw new ServiceError("Invalid App Check Token", { status: 401 });
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

const handler: ExportedHandler<Env> = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/ping" || url.pathname === "/api/health") {
      return jsonResponse({ status: "ok", time: Date.now() });
    }

    if (url.pathname === "/api/client-config") {
      return jsonResponse({
        firebase: {
          apiKey: env.GOOGLE_GENAI_API_KEY,
          authDomain: `${env.FIREBASE_PROJECT_ID}.firebaseapp.com`,
          projectId: env.FIREBASE_PROJECT_ID,
          storageBucket: `${env.FIREBASE_PROJECT_ID}.appspot.com`,
          messagingSenderId: env.FIREBASE_PROJECT_NUMBER,
          appId: `1:${env.FIREBASE_PROJECT_NUMBER}:web:dynamic`,
        },
        recaptchaKey: env.RECAPTCHA_SITE_KEY,
      });
    }

    if (url.pathname === "/api/reports") {
      try {
        await verifyAppCheck(request, env);
        const list = await env.REPORTS_KV.list({
          prefix: "report:",
          limit: 50,
        });
        const archives = list.keys
          .map((k) => {
            const metadata = (k.metadata || {}) as ProjectReport & {
              created?: string;
            };
            return {
              date: k.name.replace("report:", ""),
              summary: metadata.aiSummary?.brief || "Weekly progress snapshot.",
              created: metadata.created || "",
            };
          })
          .sort((a, b) => b.date.localeCompare(a.date));

        return jsonResponse(archives);
      } catch (err: any) {
        logErrorChain(err);
        return jsonResponse(
          { error: err.message || "Failed to fetch archives list" },
          err.status || 500,
        );
      }
    }

    if (url.pathname === "/api/report") {
      try {
        // 1. Validate Input using Zod
        const validation = ReportRequestSchema.safeParse({
          lang: url.searchParams.get("lang"),
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
            400,
          );
        }

        const { lang, date, force: forceRefresh, isLowData } = validation.data;

        await verifyAppCheck(request, env);

        let report: ProjectReport;
        let fingerprint: string | undefined;
        let pdfBuffer: ArrayBuffer | undefined;

        if (date) {
          const archivedData = (await env.REPORTS_KV.get(`report:${date}`, {
            type: "json",
          })) as ProjectReport | null;
          if (!archivedData)
            throw new ServiceError(`Archived report for ${date} not found.`, {
              status: 404,
            });
          report = archivedData;
        } else {
          pdfBuffer = await fetchProjectPdf(env);
          fingerprint = await generateFingerprint(pdfBuffer);

          report = {
            headers: [],
            rows: [],
            lastUpdate: new Date().toISOString().split("T")[0],
            aiSummary: null,
          };
        }

        if (!isLowData && !report.aiSummary && fingerprint && pdfBuffer) {
          const cacheKey = `ai_summary_${lang}_${fingerprint}`;
          let aiResult = forceRefresh
            ? null
            : ((await env.REPORTS_KV.get(cacheKey, {
                type: "json",
              })) as AiSummary | null);

          if (!aiResult && pdfBuffer) {
            let binary = "";
            const bytes = new Uint8Array(pdfBuffer);
            for (let i = 0; i < bytes.byteLength; i++) {
              binary += String.fromCharCode(bytes[i]);
            }
            const pdfBase64 = btoa(binary);

            for (let i = 0; i < 2; i++) {
              try {
                aiResult = await runProjectSummary(env.GOOGLE_GENAI_API_KEY, {
                  pdfBase64,
                  lang,
                });
                if (aiResult?.brief) {
                  ctx.waitUntil(
                    env.REPORTS_KV.put(cacheKey, JSON.stringify(aiResult), {
                      expirationTtl: 86400,
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

          // Populate report data from AI extraction
          if (aiResult?.extractedData) {
            report.headers = aiResult.extractedData.headers;
            report.rows = aiResult.extractedData.rows;
          }
        }

        return jsonResponse(report);
      } catch (err: any) {
        logErrorChain(err);
        return jsonResponse(
          { error: err.message || "Internal Server Error" },
          err.status || 500,
        );
      }
    }

    return new Response("Not Found", { status: 404 });
  },
};

export default handler;

async function fetchProjectPdf(env: Env): Promise<ArrayBuffer> {
  const sheetId = env.PUBLISHED_SHEET_ID;
  if (!sheetId)
    throw new ServiceError("Google Sheet ID is not configured.", {
      status: 500,
    });

  const publishedUrl = `https://docs.google.com/spreadsheets/d/e/${sheetId}/pub?output=pdf`;
  const cache = await caches.open("google-sheet-cache");

  let response = await cache.match(publishedUrl);
  if (!response) {
    response = await fetch(publishedUrl);
    if (response && response.ok) {
      const cachedResponse = new Response(response.clone().body, {
        status: response.status,
        statusText: response.statusText,
        headers: { ...Object.fromEntries(response.headers as any) },
      });
      cachedResponse.headers.set("Cache-Control", "public, max-age=300");
      await cache.put(publishedUrl, cachedResponse);
    }
  }

  if (!response || !response.ok)
    throw new ServiceError(
      `Failed to fetch PDF report: ${response?.statusText || "Unknown Error"}`,
      {
        status: response?.status || 500,
      },
    );

  return await response.arrayBuffer();
}
