import { runProjectSummary } from "./ai-service.js";
import { jwtVerify, createRemoteJWKSet } from "jose";

/**
 * @typedef {object} Env
 * @property {KVNamespace} REPORTS_KV
 * @property {string} GOOGLE_GENAI_API_KEY
 * @property {string} FIREBASE_PROJECT_NUMBER
 * @property {string} FIREBASE_PROJECT_ID
 * @property {string} APP_ENV
 * @property {string} DEBUG_MODE
 * @property {string} PUBLISHED_SHEET_ID
 * @property {string} RECAPTCHA_SITE_KEY
 * @property {string} ADMIN_SECRET
 */

/**
 * @typedef {Record<string, string | number>} ProjectRow
 */

/**
 * @typedef {object} AiSummary
 * @property {string} brief
 */

/**
 * @typedef {object} ProjectReport
 * @property {string[]} headers
 * @property {ProjectRow[]} rows
 * @property {string} lastUpdate
 * @property {AiSummary | null} aiSummary
 */
/**
 * Custom error for Worker services that supports error chaining via 'cause'.
 */
class ServiceError extends Error {
  /**
   * @param {string} message
   * @param {{ cause?: any, status?: number }} [options]
   */
  constructor(message, options) {
    super(message, options);
    this.name = "ServiceError";
    this.status = options?.status || 500;
  }
}

/**
 * Traverses and logs the entire Error.cause chain for deep debugging.
 * @param {any} err
 */
function logErrorChain(err) {
  if (!err) return;
  const e = /** @type {any} */ (err);
  console.error(`[Error Hierarchy] ${e.name}: ${e.message}`);
  let cause = e.cause;
  while (cause) {
    console.error(
      `  ↳ [Cause] ${cause.name || "Error"}: ${cause.message || cause}`,
    );
    cause = cause.cause;
  }
}

/**
 * @param {ProjectRow[]} data
 * @returns {Promise<string>}
 */
async function generateFingerprint(data) {
  const msgUint8 = new TextEncoder().encode(JSON.stringify(data));
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Verifies the X-Admin-Secret header and Firebase App Check token.
 * @param {Request} request
 * @param {Env} env
 * @returns {Promise<object | null>} Returns the App Check payload if successful, null otherwise.
 * @throws {ServiceError} if authentication fails.
 */
async function verifyAdminAccess(request, env) {
  const adminSecret = request.headers.get("X-Admin-Secret");
  if (!adminSecret || adminSecret !== env.ADMIN_SECRET) {
    throw new ServiceError("Unauthorized: Invalid Admin Secret", {
      status: 401,
    });
  }

  const appCheckToken = request.headers.get("X-Firebase-AppCheck");
  if (!appCheckToken) {
    throw new ServiceError("Unauthorized: No App Check token", { status: 401 });
  }

  const isLocalDev = env.APP_ENV === "development" && env.DEBUG_MODE === "true";

  if (!isLocalDev) {
    try {
      const projectNumber = env.FIREBASE_PROJECT_NUMBER;
      const { payload } = await jwtVerify(appCheckToken, JWKS, {
        issuer: `https://firebaseappcheck.googleapis.com/${projectNumber}`,
        audience: [
          `projects/${projectNumber}`,
          `projects/${env.FIREBASE_PROJECT_ID}`,
        ],
        clockTolerance: "1m",
      });
      return payload;
    } catch (e) {
      console.error(
        "[Security] App Check verification failed for admin endpoint:",
        /** @type {any} */ (e).message,
      );
      throw new ServiceError("Unauthorized: Invalid App Check Token", {
        status: 401,
        cause: e,
      });
    }
  }
  // In local dev, return a dummy payload
  return { sub: "local-dev-admin", email: "dev@example.com" };
}

// Firebase App Check public keys URL
const JWKS = createRemoteJWKSet(
  new URL("https://firebaseappcheck.googleapis.com/v1/jwks"),
);

export default {
  /**
   * @param {Request} request
   * @param {Env} env
   */
  async fetch(request, env) {
    const url = new URL(request.url);

    // Health Check & Ping
    if (url.pathname === "/api/ping" || url.pathname === "/api/health") {
      return new Response(JSON.stringify({ status: "ok", time: Date.now() }), {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    // Client Security Configuration
    if (url.pathname === "/api/client-config") {
      const config = {
        firebase: {
          apiKey: env.GOOGLE_GENAI_API_KEY, // Or a specific FIREBASE_API_KEY if different
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

    // Handle the /api/reports endpoint (Archive History List)
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
          .map((k) => ({
            date: k.name.replace("report:", ""),
            summary:
              /** @type {any} */ (k.metadata)?.summary ||
              "Weekly progress snapshot.",
          }))
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

    // Handle the /api/report endpoint (Live Data & AI Summary)
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

      // Allow bypassing strict JWT verification in local development environments
      // Ensure this ONLY evaluates to true when explicitly set in .dev.vars
      const isLocalDev =
        env.APP_ENV === "development" && env.DEBUG_MODE === "true";

      if (!isLocalDev) {
        try {
          // Verify the token against Google's public keys
          const projectNumber = env.FIREBASE_PROJECT_NUMBER;
          const { payload } = await jwtVerify(appCheckToken, JWKS, {
            issuer: `https://firebaseappcheck.googleapis.com/${projectNumber}`,
            audience: [
              `projects/${projectNumber}`,
              `projects/${env.FIREBASE_PROJECT_ID}`,
            ],
            // Enforce that the token has not expired
            clockTolerance: "1m",
          });

          console.log(
            "[Security] App Check verified for project:",
            payload.sub,
          );
        } catch (e) {
          console.error(
            "[Security] App Check verification failed:",
            /** @type {any} */ (e).message,
          );
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

      const lang = url.searchParams.get("lang") || "en";
      const date = url.searchParams.get("date");
      const isLowData = request.headers.get("X-Low-Data") === "true";
      const forceRefresh = url.searchParams.get("force") === "true";

      // Configure retry mechanism for Genkit API calls
      const maxRetries = 3;
      const initialRetryDelayMs = 1000; // 1 second

      try {
        /** @type {ProjectReport} */
        let report;

        if (date) {
          // 1. Fetch from Archive (KV)
          const archivedData = await env.REPORTS_KV.get(`report:${date}`, {
            type: "json",
          });
          if (!archivedData) {
            throw new ServiceError(
              `Archived report for date ${date} not found.`,
              { status: 404 },
            );
          }
          report = /** @type {ProjectReport} */ (archivedData);
        } else {
          // 1. Fetch live data from Google Sheets
          const projectData = await fetchProjectData(env);
          report = {
            headers: projectData.headers,
            rows: projectData.rows,
            lastUpdate: new Date().toISOString().split("T")[0],
            aiSummary: null,
          };
        }

        // 3. Only run Genkit if NOT in Low Data mode
        if (!isLowData) {
          const fingerprint = await generateFingerprint(report.rows);
          const cacheKey = `ai_summary_${lang}_${fingerprint}`;

          // Try to fetch from Cloudflare KV unless a force refresh is requested
          /** @type {AiSummary | null} */
          let aiResult = forceRefresh
            ? null
            : await env.REPORTS_KV.get(cacheKey, { type: "json" });

          if (aiResult) {
            console.log(`[Cache] Serving cached summary for ${cacheKey}`);
          } else {
            console.log(
              `[Cache] Cache miss or force-refresh for ${cacheKey}. Generating fresh summary.`,
            );

            for (let i = 0; i < maxRetries; i++) {
              try {
                // env.GOOGLE_GENAI_API_KEY must be set via 'wrangler secret put'
                aiResult = await runProjectSummary(env.GOOGLE_GENAI_API_KEY, {
                  rows: report.rows,
                  lang: /** @type {any} */ (lang),
                });

                // Cache the successful result in KV (expire after 24 hours)
                if (aiResult && aiResult.brief && env.REPORTS_KV) {
                  await env.REPORTS_KV.put(cacheKey, JSON.stringify(aiResult), {
                    expirationTtl: 86400, // 24 hours
                  });
                }
                // If successful, break the retry loop
                break;
              } catch (aiError) {
                console.warn(
                  `Genkit summary attempt ${i + 1}/${maxRetries} failed: ${/** @type {any} */ (aiError).message}`,
                );
                if (i < maxRetries - 1) {
                  // Implement exponential backoff
                  await new Promise((resolve) =>
                    setTimeout(resolve, initialRetryDelayMs * Math.pow(2, i)),
                  );
                } else {
                  throw aiError; // Re-throw error if all retries fail
                }
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
      } catch (err) {
        const e = /** @type {any} */ (err);
        console.error("Error processing /api/report request:", e);
        logErrorChain(e);
        return new Response(
          JSON.stringify({ error: e.message || "Internal Server Error" }),
          {
            status: e.status || 500,
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

/**
 * Fetches and parses project data from the configured Google Sheet.
 * @param {Env} env
 * @param {string} [lang="en"]
 * @returns {Promise<{headers: string[], rows: ProjectRow[]}>}
 */
async function fetchProjectData(env, lang = "en") {
  try {
    const sheetId = env.PUBLISHED_SHEET_ID;
    if (!sheetId) {
      throw new ServiceError("Google Sheet ID is not configured.", {
        status: 500,
      });
    }

    // Construct the URL for the published Google Sheet as CSV
    const publishedUrl = `https://docs.google.com/spreadsheets/d/e/${sheetId}/pub?output=csv`;
    const response = await fetch(publishedUrl);

    if (!response.ok) {
      throw new ServiceError(
        `Failed to fetch data from Google Sheets: ${response.statusText}`,
        { status: response.status },
      );
    }

    const csvText = await response.text();
    const lines = csvText.split(/\r?\n/).filter((line) => line.trim() !== ""); // Filter out empty lines

    if (lines.length === 0) {
      return { headers: [], rows: [] };
    }

    // Parse headers (first line)
    const rawHeaders = lines[0]
      .split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/)
      .map((h) => h.replace(/^"|"$/g, "").trim());
    // Remove zero-width spaces that sometimes appear in CSVs from Google Sheets
    const headers = rawHeaders.map((h) =>
      h.replace(/[\u200B-\u200D\uFEFF]/g, ""),
    );

    // Parse rows
    const rows = lines.slice(1).map((line) => {
      const values = line
        .split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/)
        .map((v) => v.replace(/^"|"$/g, "").trim());
      /** @type {ProjectRow} */
      const row = {};

      headers.forEach((header, i) => {
        let rawValue = values[i] || "";
        // Strip commas and attempt numeric conversion for values like "1,234.50"
        const cleanValue = rawValue.replace(/,/g, "");
        if (!isNaN(Number(cleanValue)) && cleanValue.trim() !== "") {
          row[header] = Number(cleanValue);
        } else {
          row[header] = rawValue;
        }
      });

      // Determine Progress and Status for the Dashboard
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

    // Validation: Ensure the data contains the expected structure before returning
    if (!rows || !Array.isArray(rows)) {
      throw new ServiceError(
        "Parsed data is not in the expected array format.",
        { status: 422 },
      );
    }

    return { headers, rows };
  } catch (error) {
    const e = /** @type {any} */ (error);
    console.error("[fetchProjectData Error]:", e.message);
    // Re-throwing allows the main fetch() try/catch to return a proper 500 response
    throw new ServiceError("Data synchronization failed", { cause: e });
  }
}
