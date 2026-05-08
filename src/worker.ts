import { runProjectSummary } from "./ai-service.js";
import { jwtVerify, createRemoteJWKSet, type JWTPayload } from "jose";

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

let cachedAdminSecret: string | null = null;
let lastSecretFetch = 0;
const SECRET_CACHE_TTL = 300000;

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

async function generateFingerprint(data: ProjectRow[]): Promise<string> {
  const msgUint8 = new TextEncoder().encode(JSON.stringify(data));
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer as ArrayBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

const handler: ExportedHandler<Env> = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/ping" || url.pathname === "/api/health") {
      return new Response(JSON.stringify({ status: "ok", time: Date.now() }), {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    if (url.pathname === "/api/client-config") {
      const config = {
        firebase: {
          apiKey: env.GOOGLE_GENAI_API_KEY,
          authDomain: `${env.FIREBASE_PROJECT_ID}.firebaseapp.com`,
          projectId: env.FIREBASE_PROJECT_ID,
          storageBucket: `${env.FIREBASE_PROJECT_ID}.appspot.com`,
          messagingSenderId: env.FIREBASE_PROJECT_NUMBER,
          appId: `1:${env.FIREBASE_PROJECT_NUMBER}:web:dynamic`,
        },
        recaptchaKey: env.RECAPTCHA_SITE_KEY,
      };
      return new Response(JSON.stringify(config), {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    if (url.pathname === "/api/reports") {
      const appCheckToken = request.headers.get("X-Firebase-AppCheck");
      const isLocalDev =
        env.APP_ENV === "development" && env.DEBUG_MODE === "true";

      if (!appCheckToken && !isLocalDev) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        });
      }

      try {
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

        return new Response(JSON.stringify(archives), {
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        });
      } catch (err) {
        logErrorChain(err);
        return new Response(
          JSON.stringify({ error: "Failed to fetch archives list" }),
          {
            status: 500,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
            },
          },
        );
      }
    }

    if (url.pathname === "/api/report") {
      const appCheckToken = request.headers.get("X-Firebase-AppCheck");
      if (!appCheckToken) {
        return new Response(
          JSON.stringify({ error: "Unauthorized: No token" }),
          {
            status: 401,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
            },
          },
        );
      }

      const isLocalDev =
        env.APP_ENV === "development" && env.DEBUG_MODE === "true";
      if (!isLocalDev) {
        try {
          const projectNumber = env.FIREBASE_PROJECT_NUMBER;
          await jwtVerify(appCheckToken, JWKS, {
            issuer: `https://firebaseappcheck.googleapis.com/${projectNumber}`,
            audience: [
              `projects/${projectNumber}`,
              `projects/${env.FIREBASE_PROJECT_ID}`,
            ],
            clockTolerance: "1m",
          });
        } catch (e) {
          return new Response(
            JSON.stringify({ error: "Invalid App Check Token" }),
            {
              status: 401,
              headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
              },
            },
          );
        }
      }

      const lang = url.searchParams.get("lang") === "ne" ? "ne" : "en";
      const date = url.searchParams.get("date");
      const isLowData = request.headers.get("X-Low-Data") === "true";
      const forceRefresh = url.searchParams.get("force") === "true";

      try {
        let report: ProjectReport;
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
          const projectData = await fetchProjectData(env);
          report = {
            headers: projectData.headers,
            rows: projectData.rows,
            lastUpdate: new Date().toISOString().split("T")[0],
            aiSummary: null,
          };
        }

        if (!isLowData) {
          const fingerprint = await generateFingerprint(report.rows);
          const cacheKey = `ai_summary_${lang}_${fingerprint}`;
          let aiResult = forceRefresh
            ? null
            : ((await env.REPORTS_KV.get(cacheKey, {
                type: "json",
              })) as AiSummary | null);

          if (!aiResult) {
            for (let i = 0; i < 3; i++) {
              try {
                aiResult = await runProjectSummary(env.GOOGLE_GENAI_API_KEY, {
                  rows: report.rows,
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
                if (i === 2) throw aiError;
                await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, i)));
              }
            }
          }
          report.aiSummary = aiResult;
        }

        return new Response(JSON.stringify(report), {
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        });
      } catch (err: any) {
        logErrorChain(err);
        return new Response(
          JSON.stringify({ error: err.message || "Internal Server Error" }),
          {
            status: err.status || 500,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
            },
          },
        );
      }
    }

    return new Response("Not Found", { status: 404 });
  },
};

export default handler;

async function fetchProjectData(
  env: Env,
): Promise<{ headers: string[]; rows: ProjectRow[] }> {
  const sheetId = env.PUBLISHED_SHEET_ID;
  if (!sheetId)
    throw new ServiceError("Google Sheet ID is not configured.", {
      status: 500,
    });

  const publishedUrl = `https://docs.google.com/spreadsheets/d/e/${sheetId}/pub?output=csv`;
  const cache = caches.default;

  let response = await cache.match(publishedUrl);
  if (!response) {
    response = await fetch(publishedUrl);
    if (response.ok) {
      const cachedResponse = new Response(response.clone().body, response);
      cachedResponse.headers.set("Cache-Control", "public, s-maxage=300");
      await cache.put(publishedUrl, cachedResponse);
    }
  }

  if (!response.ok)
    throw new ServiceError(`Failed to fetch sheet: ${response.statusText}`, {
      status: response.status,
    });

  const csvText = await response.text();
  const lines = csvText.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length === 0) return { headers: [], rows: [] };

  const rawHeaders = lines[0]
    .split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/)
    .map((h) => h.replace(/^"|"$/g, "").trim());
  const headers = rawHeaders.map((h) =>
    h.replace(/[\u200B-\u200D\uFEFF]/g, ""),
  );

  const rows = lines.slice(1).map((line) => {
    const values = line
      .split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/)
      .map((v) => v.replace(/^"|"$/g, "").trim());
    const row: ProjectRow = {};

    headers.forEach((header, i) => {
      let rawValue = values[i] || "";
      const cleanValue = rawValue.replace(/,/g, "");
      if (cleanValue.trim() !== "" && !isNaN(Number(cleanValue))) {
        row[header as string] = Number(cleanValue);
      } else {
        row[header as string] = rawValue;
      }
    });

    const targetKey = headers.find(
      (h) => h.includes("Annual Target") || h.includes("बार्षिक लक्ष्य"),
    );
    const progKey = headers.find(
      (h) =>
        h.includes("Annual Progress") ||
        h.includes("हाल सम्म को बार्षिक प्रगति"),
    );

    if (targetKey && progKey) {
      const t = parseFloat(String(row[targetKey] || "0"));
      const p = parseFloat(String(row[progKey] || "0"));
      const progress = t > 0 ? Math.round((p / t) * 100) : 0;
      row._progress = progress;
      row._status =
        progress >= 80 ? "good" : progress >= 40 ? "stable" : "critical";
    }
    return row;
  });

  return { headers, rows };
}
