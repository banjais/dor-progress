import { jwtVerify, createRemoteJWKSet } from 'jose';

const JWKS = createRemoteJWKSet(new URL('https://firebaseappcheck.googleapis.com/v1/jwks'));

// World-class Static Translation Dictionary for DoR Progress Indicators
const TRANSLATIONS = {
  // Headers
  "सूचक": "Indicator",
  "SDG संकेत": "SDG Code",
  "समीक्षा अवधि": "Review Period",
  "भार": "Weightage",
  "इकाइ": "Unit",
  "वेशलाइन": "Baseline",
  "कुल लक्ष्य": "Total Target",
  "कुल प्रगति": "Total Progress",
  "बार्षिक लक्ष्य": "Annual Target",
  "हाल सम्म को बार्षिक प्रगति": "Annual Progress to Date",

  // Indicators (Indicators names provided in input)
  "कालोपत्रे सडक (दुई लेन)-NH&Other Road": "Blacktopped Road (Two Lane)-NH&Other Road",
  "कालोपत्रे सडक (चार लेन वा चार लेन भन्दा बढी)": "Blacktopped Road (Four Lane or More)",
  "रिजिड पेभ्मेंट , कि.मि.": "Rigid Pavement, Km",
  "ग्रावेल (सबबेश बाहेक) , कि.मि.": "Gravel (Excluding Sub-base), Km",
  "माटे सडक (ट्रयाक निर्माण)": "Earthen Road (Track Construction)",
  "पुल निर्माण": "Bridge Construction",
  "बेली बृज जडान, संख्या": "Bailey Bridge Installation, No.",
  "सुरूङ निर्माण (मेन टनेल र ईभ्याकुएसन टनेल)": "Tunnel Construction (Main & Evacuation)",
  "क्र्यास बेरियर, मिटर": "Crash Barrier, Meter",
  "पोटहोल मर्मत, Km": "Pothole Repair, Km",
  "राजमार्ग आवधिक मर्मत, कि. मि.": "Highway Periodic Maintenance, Km",
  "राजमार्ग पुनर्निर्माण तथा स्तरोन्नति, कि.मि.": "Highway Reconstruction & Upgrade, Km",
  "रोजगारी सिर्जना": "Employment Generation",
  "कुल बजेट, अर्ब": "Total Budget, Billion",
  "पुँजीगत खर्च": "Capital Expenditure",
  "कुल बेरुजुमा फर्छ्यौटको अनुपात": "Ratio of Arrears Settlement",
  "गुनासो फर्छ्यौट": "Grievance Redressal",

  // Periods & Units
  "त्रैमासिक": "Quarterly",
  "मासिक": "Monthly",
  "कि.मी.": "Km",
  "संख्या": "No.",
  "वटा": "No.", // Added
  "कार्यदिन (हजारमा)": "Man-days (in thousands)", // Added
  "प्रतिशत": "Percent", // Added
  "अर्ब": "Billion" // Added
};

export class IdempotencyLock {
  constructor(state, env) {
    this.state = state;
  }

  async fetch(request) {
    const { action, result } = await request.json();

    if (action === "check") {
      const status = await this.state.storage.get("status");
      if (status === "processing") return new Response("LOCKED", { status: 423 });
      if (status === "completed") {
        const saved = await this.state.storage.get("response");
        return new Response(JSON.stringify(saved), { status: 200 });
      }

      await this.state.storage.put("status", "processing");
      return new Response("PROCEED", { status: 100 });
    }

    if (action === "save") {
      await this.state.storage.put("status", "completed");
      await this.state.storage.put("response", result);
      return new Response("SAVED");
    }

    return new Response("INVALID_ACTION", { status: 400 });
  }
}

/**
 * Centralized Configuration Validator
 * Checks for required environment variables and secrets.
 */
function validateEnv(env) {
  const required = [
    'FIREBASE_PROJECT_NUMBER',
    'FIREBASE_API_KEY',
    'FIREBASE_PROJECT_ID',
    'FIREBASE_AUTH_DOMAIN',
    'FIREBASE_APP_ID',
    'GOOGLE_SHEETS_API_KEY',
    'RECAPTCHA_SITE_KEY'
  ];

  const optional = [
    'GEMINI_API_KEY',
    'FIREBASE_STORAGE_BUCKET',
    'FIREBASE_MESSAGING_SENDER_ID',
    'FIREBASE_MEASUREMENT_ID',
    'VAPID_PUBLIC_KEY',
    'VAPID_PRIVATE_KEY'
  ];

  const missingRequired = required.filter(key => !env[key] || env[key] === "");
  const missingOptional = optional.filter(key => !env[key] || env[key] === "");

  if (missingRequired.length > 0) {
    console.error(`[Config Error] Missing critical secrets: ${missingRequired.join(', ')}`);
    return { valid: false, error: `Missing configuration: ${missingRequired.join(', ')}` };
  }

  if (missingOptional.length > 0) {
    console.warn(`[Config Warning] Optional features disabled. Missing: ${missingOptional.join(', ')}`);
  }

  return { valid: true };
}

export default {
  async fetch(request, env, ctx) {
    const configStatus = validateEnv(env);
    if (!configStatus.valid) {
      return new Response(JSON.stringify({ error: configStatus.error, code: 500 }), {
        status: 500,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    }

    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    const idempotencyKey = request.headers.get("Idempotency-Key");
    const appCheckToken = request.headers.get("X-Firebase-AppCheck");
    const method = request.method.toUpperCase();
    let doStub = null;

    // Handle CORS Preflight - MUST BE FIRST (Before App Check)
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": origin || "*",
          "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, X-API-Key, X-Firebase-AppCheck, Idempotency-Key",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    // ─── APP CHECK VERIFICATION ─────────────────────────────────────────────
    // Protect data routes. Exclude config, ping, and analytics (background sync compatible)
    const isDataRoute = url.pathname.startsWith("/api/") &&
      !["client-config", "ping", "analytics"].some(p => url.pathname.includes(p));

    if (isDataRoute) {
      if (!appCheckToken) {
        console.warn(`[App Check] Missing token for request: ${url.pathname}`);
        return new Response(JSON.stringify({ error: "Unauthorized: Missing App Check Token", code: 403 }), {
          status: 403, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }

      try {
        const projectNum = env.FIREBASE_PROJECT_NUMBER;
        const { payload } = await jwtVerify(appCheckToken, JWKS, {
          issuer: `https://firebaseappcheck.googleapis.com/${projectNum}`,
          audience: `projects/${projectNum}`,
        });
        console.log(`[App Check] Verified successfully for project ${projectNum}. Payload subject: ${payload.sub}`);
      } catch (err) {
        // Log the full error for debugging purposes
        console.error(`[App Check] Verification failed: ${err.message}`);
        return new Response(JSON.stringify({ error: "Forbidden: Invalid App Check Token", code: 403 }), {
          status: 403, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }
    }

    // ─── IDEMPOTENCY LOCK (Strict Consistency via Durable Objects) ──────────
    if (idempotencyKey && (method === "POST" || method === "PATCH")) {
      const doId = env.IDEMPOTENCY_LOCK.idFromName(idempotencyKey);
      doStub = env.IDEMPOTENCY_LOCK.get(doId);

      const checkRes = await doStub.fetch(new Request("http://do/action", {
        method: "POST",
        body: JSON.stringify({ action: "check" })
      }));

      if (checkRes.status === 423) {
        return new Response(JSON.stringify({ error: "Conflict: Request already in progress." }), {
          status: 423, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }
      if (checkRes.ok && checkRes.status === 200) {
        const cached = await checkRes.json();
        return new Response(JSON.stringify(cached.body), {
          status: cached.status,
          headers: { ...cached.headers, "X-Idempotency-Cache": "HIT", "Access-Control-Allow-Origin": "*" }
        });
      }
    }

    // ─── PUBLIC ENDPOINTS (no auth, no KV) ───────────────────────────────────
    if (url.pathname.endsWith("/api/client-config")) {
      return new Response(JSON.stringify({
        firebase: {
          apiKey: env.FIREBASE_API_KEY,
          authDomain: env.FIREBASE_AUTH_DOMAIN,
          projectId: env.FIREBASE_PROJECT_ID,
          storageBucket: env.FIREBASE_STORAGE_BUCKET,
          messagingSenderId: env.FIREBASE_MESSAGING_SENDER_ID,
          appId: env.FIREBASE_APP_ID,
          measurementId: env.FIREBASE_MEASUREMENT_ID
        },
        // Use the reCAPTCHA Site Key for App Check (Recaptcha V3)
        recaptchaKey: env.RECAPTCHA_SITE_KEY
      }), {
        headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=60", "Access-Control-Allow-Origin": "*" }
      });
    }

    if (url.pathname.endsWith("/ping")) {
      return new Response(JSON.stringify({
        status: "online",
        env: {
          google_sheets_configured: !!env.GOOGLE_SHEETS_API_KEY,
          gemini_configured: !!env.GEMINI_API_KEY
        }
      }), {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    }

    const clientIP = request.headers.get("CF-Connecting-IP") || "unknown";

    // ─── ANALYTICS ENDPOINT (Background Sync Target) ────────────────────────
    if (url.pathname.endsWith("/api/analytics") && method === "POST") {
      try {
        const payload = await request.json();
        const batchId = `${clientIP}_${Date.now()}`;

        // Store the analytics batch in KV with a 7-day expiration (604,800 seconds)
        // This keeps the data for analysis without manual cleanup.
        await env.TRANSLATION_KV.put(`stats_${batchId}`, JSON.stringify({
          ip: clientIP,
          userAgent: request.headers.get("User-Agent"),
          ...payload
        }), { expirationTtl: 604800 });

        return new Response(JSON.stringify({ ok: true, recorded: payload.events?.length || 0 }), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: "Invalid analytics data" }), {
          status: 400,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }
    }

    // ─── IP RATE LIMITING (only real protection needed) ───────────────────────
    const jailKey = `block_${clientIP}`;

    const isBlocked = await env.TRANSLATION_KV.get(jailKey);
    if (isBlocked) {
      return new Response(JSON.stringify({ error: 'Too many requests. Access denied for 1 hour.' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', "Access-Control-Allow-Origin": "*" }
      });
    }

    const SHEET_ID = "1ohBXufi7WEvKVAdMavbM5ZQfWnjxveFxgR0FJZf4EJM";
    const SHEET_RANGE = "Dashboard";
    const API_KEY = env.GOOGLE_SHEETS_API_KEY;
    const DOR_LOGO = "/logo.png";

    const cache = caches.default;
    const cacheKey = new Request(url.toString());

    // PDF endpoint
    if (url.pathname === "/api/report.pdf") {
      const pdfUrl = `https://docs.google.com/spreadsheets/d/e/${SHEET_ID}/export?format=pdf&gid=0`;
      return Response.redirect(pdfUrl, 302);
    }

    // Main API endpoint - handles both direct and Firebase-rewritten paths
    if (url.pathname === "/api/report" || url.pathname === "/api/dor-progress") {
      const requestedLang = url.searchParams.get("lang") || "ne";

      // Check cache (cache by language too)
      let cached = await cache.match(cacheKey);
      if (cached) return cached;

      // Fetch from Google Sheets API v4
      if (!API_KEY) {
        return new Response(JSON.stringify({ error: "GOOGLE_SHEETS_API_KEY not configured" }), {
          status: 500,
          headers: { "Content-Type": "application/json" }
        });
      }

      // Fetch a larger range to ensure we find headers even if rows are added at top
      const apiUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${SHEET_RANGE}!A1:Z100?key=${API_KEY}`;
      const res = await fetch(apiUrl);

      if (!res.ok) {
        return new Response(JSON.stringify({ error: `Sheets API error: ${res.status}` }), {
          status: 500,
          headers: { "Content-Type": "application/json" }
        });
      }

      const sheetData = await res.json();
      const values = sheetData.values || [];

      // 1. Dynamic Header Discovery: Find the first row that looks like a header (>= 3 non-empty cells)
      const headerRowIdx = values.findIndex(row => row.filter(cell => String(cell || "").trim().length > 0).length >= 3);

      if (headerRowIdx === -1) {
        return new Response(JSON.stringify({ error: "Could not identify header row" }), { status: 500 });
      }

      const rawHeaders = values[headerRowIdx].map(h => String(h || "").trim());
      const firstNonEmptyIdx = rawHeaders.findIndex(h => h.length > 0);
      let headers = rawHeaders.slice(firstNonEmptyIdx).filter(h => h.length > 0);

      // 2. Data Extraction: Process all rows after the header row
      let data = values.slice(headerRowIdx + 1).map(row => {
        const obj = {};
        headers.forEach((h, idx) => {
          const actualIdx = firstNonEmptyIdx + idx;
          obj[h] = row[actualIdx] !== undefined ? String(row[actualIdx]).trim() : "";
        });
        return obj;
      }).filter(row => {
        // Ignore rows where the primary indicator column is empty
        return row[headers[0]] && row[headers[0]].length > 0;
      });

      // Gemini AI Integration
      const geminiKey = env.GEMINI_API_KEY; // Ensure this is set as a secret in Cloudflare

      async function callGemini(prompt) {
        if (!geminiKey) { console.warn("GEMINI_API_KEY not configured."); return null; }
        const models = ["gemini-1.5-flash", "gemini-1.5-pro", "gemini-pro"];
        for (const model of models) {
          try {
            const geminiUrl = `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent?key=${geminiKey.trim()}`;
            const geminiRes = await fetch(geminiUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
            });
            const geminiJson = await geminiRes.json();
            if (geminiJson.candidates && geminiJson.candidates.length > 0) {
              return geminiJson.candidates[0].content.parts[0].text;
            }
          } catch (e) { }
        }
        return null;
      }

      // Handle Translation if requestedLang is English
      if (requestedLang === "en") {
        // 1. Translate Headers
        const englishHeaders = headers.map(h => TRANSLATIONS[h] || h);

        // 2. Translate Row Contents
        data = data.map(row => {
          const newRow = {};
          headers.forEach((h, i) => {
            const val = row[h];
            const engHeader = englishHeaders[i];
            // Translate value if it exists in dictionary, otherwise keep original
            newRow[engHeader] = TRANSLATIONS[val] || val;
          });
          return newRow;
        });

        headers = englishHeaders;
      }

      // Column detection for status/insight
      const annTargetCol = headers.find(h => h.includes("Annual Target") || h.includes("बार्षिक लक्ष्य"));
      const annProgCol = headers.find(h => h.includes("Annual Progress") || h.includes("हाल सम्म को बार्षिक प्रगति"));
      const totTargetCol = headers.find(h => h.includes("Total Target") || h.includes("कुल लक्ष्य"));
      const totProgCol = headers.find(h => h.includes("Total Progress") || h.includes("कुल प्रगति"));

      function getStatus(row) {
        const target = parseFloat(String(row[annTargetCol]).replace(/,/g, '')) || 0;
        const progress = parseFloat(String(row[annProgCol]).replace(/,/g, '')) || 0;
        if (!target) return "gray";
        const ratio = (progress / target) * 100;
        if (ratio >= 80) return "good";
        if (ratio >= 50) return "stable";
        return "critical";
      }

      function getInsight(row) {
        const target = parseFloat(String(row[annTargetCol]).replace(/,/g, '')) || 0;
        const progress = parseFloat(String(row[annProgCol]).replace(/,/g, '')) || 0;
        if (!target) return requestedLang === 'en' ? "No target defined." : "कुनै लक्ष्य परिभाषित छैन।";
        const percent = Math.round((progress / target) * 100);
        if (requestedLang === 'en') {
          if (percent >= 80) return `Strong performance (${percent}%). On track.`;
          if (percent >= 50) return `Moderate progress (${percent}%). Needs monitoring.`;
          return `Low progress (${percent}%). Immediate attention required.`;
        } else {
          if (percent >= 80) return `राम्रो प्रगति (${percent}%)। ट्र्याकमा छ।`;
          if (percent >= 50) return `मध्यम प्रगति (${percent}%)। निगरानी आवश्यक छ।`;
          return `कम प्रगति (${percent}%)। तत्काल ध्यान दिनु पर्छ।`;
        }
      }

      // 3. Metadata Extraction: Search for keywords anywhere in the sheet data
      let lastUpdate = "";
      let filteredData = [];

      data.forEach(row => {
        const rowContent = Object.values(row).join(" ").toLowerCase();

        if (rowContent.includes("last update") || rowContent.includes("अन्तिम अपडेट")) {
          const updateStr = Object.values(row).find(v => v.includes(":") || v.includes("/"));
          lastUpdate = updateStr ? updateStr.split(":").pop().trim() : "";
        } else if (rowContent.includes("next update") || rowContent.includes("अर्को अपडेट")) {
          // Catch and ignore Next Update rows to prevent them from showing as indicator data
        } else if (rowContent.includes("total") || rowContent.includes("कुल")) {
          // Skip summary rows
        } else {
          filteredData.push({ ...row, _status: getStatus(row), _insight: getInsight(row) });
        }
      });

      const rowsCopy = filteredData; // Use the properly filtered and processed data

      // World-Class Sliding Expiration Strategy: Automatically delete unused data.
      // We use 'lastUpdate' as a version fingerprint to keep the relay consistent across users.
      const kvKey = lastUpdate ? `full_report_${requestedLang}_${lastUpdate.replace(/[^a-zA-Z0-9]/g, '_')}` : null;
      const cachedFullReport = kvKey ? await env.TRANSLATION_KV.get(kvKey) : null;

      if (cachedFullReport) {
        // Refresh TTL on every access (Sliding Window: 48 hours).
        // This ensures the system "deletes it after not used" without manual management.
        ctx.waitUntil(env.TRANSLATION_KV.put(kvKey, cachedFullReport, { expirationTtl: 172800 }));

        console.log(`Relaying cached report for version: ${lastUpdate}`);
        return new Response(cachedFullReport, {
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "public, max-age=300",
            "Access-Control-Allow-Origin": "*"
          }
        });
      }

      // AI Brief Cache with Sliding Expiration
      const aiKvKey = lastUpdate ? `ai_brief_${requestedLang}_${lastUpdate.replace(/[^a-zA-Z0-9]/g, '_')}` : null;
      let aiExecutiveBrief = aiKvKey ? await env.TRANSLATION_KV.get(aiKvKey) : null;

      if (aiExecutiveBrief) {
        // Refresh AI cache TTL on hit
        ctx.waitUntil(env.TRANSLATION_KV.put(aiKvKey, aiExecutiveBrief, { expirationTtl: 172800 }));
      } else if (geminiKey) { // Only call Gemini if key is present
        // Cache Miss: Perform Fresh Gemini Analysis
        const aiSummaryPrompt = `Act as a Senior MIS Analyst for the Department of Roads (DoR), Nepal.
        Format your response as a formal Internal Memorandum.
        Analyze the progress data for ${rowsCopy.length} indicators.
        Headers: ${headers.join(", ")}
        Data: ${JSON.stringify(rowsCopy.slice(0, 30))}
        
        Structure:
        1. Start with "SUBJECT: [Concise Title]" in ${requestedLang === 'en' ? 'English' : 'Nepali'}.
        2. Follow with a formal assessment of project health (3-4 sentences).
        3. Explicitly list 1-2 high-risk indicators.
        4. End with a "Recommended Action" section.
        
        Tone: Official, direct, and data-driven. Use ${requestedLang === 'en' ? 'English' : 'Nepali'}.`;

        aiExecutiveBrief = await callGemini(aiSummaryPrompt);

        if (aiExecutiveBrief && aiKvKey) {
          // Store in KV with a 48h sliding window, only if Gemini returned a brief
          await env.TRANSLATION_KV.put(aiKvKey, aiExecutiveBrief, { expirationTtl: 172800 });
        }
      }

      aiExecutiveBrief = aiExecutiveBrief || (requestedLang === 'en' ? "Summary unavailable." : "सारांश उपलब्ध छैन।");

      const jsonResponse = {
        system: "DoR MIS",
        department: requestedLang === 'en' ? "Department of Roads" : "सडक विभाग",
        logo: DOR_LOGO,
        lastUpdate,
        headers,
        rows: rowsCopy,
        aiSummary: {
          stats: {
            total: rowsCopy.length,
            good: rowsCopy.filter(r => r._status === "good").length,
            stable: rowsCopy.filter(r => r._status === "stable").length,
            critical: rowsCopy.filter(r => r._status === "critical").length
          },
          brief: aiExecutiveBrief
        },
        clientIp: clientIP,
        pdfUrl: "/api/report.pdf",
        live: { refreshSeconds: 60, mode: "auto-pull" }
      };

      const responseBody = JSON.stringify(jsonResponse);

      const finalResponse = new Response(responseBody, {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=300",
          "Access-Control-Allow-Origin": "*"
        }
      });

      // Save to Idempotency Lock if stub exists
      if (doStub && finalResponse.ok) {
        ctx.waitUntil(doStub.fetch(new Request("http://do/action", {
          method: "POST",
          body: JSON.stringify({
            action: "save",
            result: {
              body: jsonResponse,
              status: finalResponse.status,
              headers: Object.fromEntries(finalResponse.headers.entries())
            }
          })
        })));
      }

      // Save the full processed report to KV for the 'Relay' effect
      if (kvKey) {
        ctx.waitUntil(env.TRANSLATION_KV.put(kvKey, responseBody, { expirationTtl: 172800 }));
      }

      ctx.waitUntil(cache.put(cacheKey, finalResponse.clone()));
      return finalResponse;
    }

    return new Response("DoR Report API Running");
  }
};
