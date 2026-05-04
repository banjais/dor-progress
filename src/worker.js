import { runProjectSummary } from "./ai-service.js";

async function generateFingerprint(data) {
  const msgUint8 = new TextEncoder().encode(JSON.stringify(data));
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Handle the /api/report endpoint
    if (url.pathname === "/api/report") {
      const lang = url.searchParams.get("lang") || "en";
      const isLowData = request.headers.get("X-Low-Data") === "true";
      const forceRefresh = url.searchParams.get("force") === "true";

      // Configure retry mechanism for Genkit API calls
      const maxRetries = 3;
      const initialRetryDelayMs = 1000; // 1 second

      try {
        // 1. Fetch your data (e.g., from Google Sheets or your DB)
        const projectData = await fetchProjectData(env);

        // 2. Prepare the base response structure
        const report = {
          headers: projectData.headers,
          rows: projectData.rows,
          lastUpdate: new Date().toISOString().split("T")[0],
          aiSummary: null,
        };

        // 3. Only run Genkit if NOT in Low Data mode
        if (!isLowData) {
          const fingerprint = await generateFingerprint(report.rows);
          const cacheKey = `ai_summary_${lang}_${fingerprint}`;

          // Try to fetch from Cloudflare KV unless a force refresh is requested
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
                  lang: lang,
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
                  `Genkit summary attempt ${i + 1}/${maxRetries} failed: ${aiError.message}`,
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
        console.error("Error processing /api/report request:", err);
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
        });
      }
    }

    return new Response("Not Found", { status: 404 });
  },
};

async function fetchProjectData(env) {
  try {
    // Placeholder: Replace with actual logic, e.g., const res = await fetch(env.DATA_URL);
    const data = {
      headers: ["Indicator", "Target", "Progress"],
      rows: [
        { Indicator: "Road A", Target: 100, Progress: 45, _status: "critical" },
      ],
    };

    // Validation: Ensure the data contains the expected structure before returning
    if (!data || !Array.isArray(data.rows) || data.rows.length === 0) {
      throw new Error("Data source returned an empty or invalid project list.");
    }

    return data;
  } catch (error) {
    console.error("[fetchProjectData Error]:", error.message);
    // Re-throwing allows the main fetch() try/catch to return a proper 500 response
    throw new Error(`Data synchronization failed: ${error.message}`);
  }
}
