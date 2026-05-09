/// <reference types="@cloudflare/workers-types" />
/**
 * Cloudflare Worker for DoR Progress Report
 * Features: Per-value translation, English key retention, and KV Caching.
 */

import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import {
  Env,
  AiSummary,
  ProjectReport,
  ProjectRow,
  ProjectData,
  SnapshotMetadata,
  Jwks,
  Jwk,
} from "./shared/types.js";
import { runProjectSummary, runTranslation } from "./ai-service.js";
import aiPromptsData from "./ai-prompts.json" with { type: "json" };
import dictionaryData from "./translations.json" with { type: "json" };

// Helper to get the correct translation KV namespace (handles both production and staging)
function getTranslationKV(env: Env) {
  return (env as any).STAGING_TRANSLATION_KV || env.TRANSLATION_KV;
}

// Helper to get the correct reports KV namespace (handles both production and staging)
function getReportsKV(env: Env) {
  return (env as any).STAGING_REPORTS_KV || env.REPORTS_KV;
}

/** 
 * Derive TranslationKey from the 'ne' keys in the JSON.
 * This ensures the type and data stay perfectly in sync.
 */
type TranslationKey = keyof (typeof dictionaryData)["ne"];
const DICTIONARY = dictionaryData as Record<string, Record<TranslationKey, string>>;

// Type for AI prompts
type AiPrompts = typeof aiPromptsData;
const AI_PROMPTS: AiPrompts = aiPromptsData;

/** Supported language codes automatically derived from the DICTIONARY keys */
type SupportedLang = keyof typeof DICTIONARY;

/**
 * Type guard to check if a string is a supported language in the dictionary.
 */
function isSupportedLang(lang: string): lang is SupportedLang {
  return lang in DICTIONARY;
}

// Circuit breaker constants
const FAIL_COUNT_KEY = "system:gemini_failure_count";
const CIRCUIT_BREAKER_KEY = "system:circuit_open";
const FAIL_THRESHOLD = 5;
const COOL_OFF_SECONDS = 600; // 10 minutes

// App Check Ban Constants
const APP_CHECK_FAIL_COUNT_KEY_PREFIX = "appcheck:fail_count:";
const APP_CHECK_FAIL_THRESHOLD = 5; // Number of App Check failures before an IP is banned
const BANNED_IP_KEY_PREFIX = "appcheck:banned_ip:";
const BAN_DURATION_SECONDS = 3600; // 1 hour ban

/**
 * In-memory rate limiting (Per-Isolate)
 * Note: This is local to each Worker isolate and not shared globally across regions.
 */
const RATE_LIMIT_MAP = new Map<string, { count: number; reset: number }>();
const RATE_LIMIT_MAX_REQUESTS = 60; // Max requests per window
const RATE_LIMIT_WINDOW_MS = 60000; // 1 minute window

/**
 * In-memory cache for the admin secret to avoid redundant KV calls.
 */
let cachedAdminSecret: string | null = null;
let lastSecretFetch = 0;
const SECRET_CACHE_TTL = 300_000; // 5 minutes

/**
 * In-memory cache for the JWKS public keys.
 */
let cachedJwks: Jwks | null = null;
let lastJwksFetch = 0;
const JWKS_CACHE_TTL = 3600_000; // 1 hour

/**
 * Check if circuit breaker is open (Gemini repeatedly failing)
 */
async function isCircuitBreakerOpen(env: Env): Promise<boolean> {
  const translationKV = getTranslationKV(env);
  const open = await translationKV.get(CIRCUIT_BREAKER_KEY);
  if (open === "true") {
    const failCountStr = await translationKV.get(FAIL_COUNT_KEY);
    const failCount = failCountStr ? parseInt(failCountStr, 10) : 0;
    if (failCount >= FAIL_THRESHOLD) {
      return true; // Still open
    }
    // Reset if below threshold (e.g., after cooldown)
    await translationKV.delete(CIRCUIT_BREAKER_KEY);
    await translationKV.delete(FAIL_COUNT_KEY);
  }
  return false;
}

/**
 * Helper to verify admin secret with timing-attack resistant comparison and caching.
 */
async function verifyAdminSecret(request: Request, env: Env): Promise<boolean> {
  const providedSecret = request.headers.get("X-Admin-Secret");
  if (!providedSecret) return false;

  const now = Date.now();
  if (!cachedAdminSecret || (now - lastSecretFetch > SECRET_CACHE_TTL)) {
    cachedAdminSecret = await getTranslationKV(env).get("config:admin_secret");
    lastSecretFetch = now;
  }

  if (!cachedAdminSecret) return false;
  return secureCompare(providedSecret, cachedAdminSecret);
}

/**
 * Record a Gemini failure and potentially trip circuit breaker
 */
async function recordGeminiFailure(env: Env): Promise<void> {
  const currentStr = (await getTranslationKV(env).get(FAIL_COUNT_KEY)) || "0";
  const current = parseInt(currentStr, 10);
  const next = current + 1;
  await getTranslationKV(env).put(FAIL_COUNT_KEY, next.toString(), {
    expirationTtl: COOL_OFF_SECONDS,
  });
  if (next >= FAIL_THRESHOLD) {
    await getTranslationKV(env).put(CIRCUIT_BREAKER_KEY, "true", {
      expirationTtl: COOL_OFF_SECONDS,
    });
  }
}

/**
 * Records an App Check failure for an IP and potentially bans it.
 */
async function recordAppCheckFailure(
  ip: string,
  env: Env,
  ctx: ExecutionContext,
): Promise<void> {
  const failCountKey = APP_CHECK_FAIL_COUNT_KEY_PREFIX + ip;
  const bannedIpKey = BANNED_IP_KEY_PREFIX + ip;

  // Increment failure count
  const currentCountStr = await getTranslationKV(env).get(failCountKey);
  let currentCount = currentCountStr ? parseInt(currentCountStr, 10) : 0;
  currentCount++;

  // Store updated count with a short expiration (e.g., 10 minutes)
    ctx.waitUntil(
      getTranslationKV(env).put(failCountKey, currentCount.toString(), {
      expirationTtl: COOL_OFF_SECONDS,
    }),
  );

  // If threshold reached, ban the IP
  if (currentCount >= APP_CHECK_FAIL_THRESHOLD) {
    ctx.waitUntil(
      getTranslationKV(env).put(bannedIpKey, "true", {
        expirationTtl: BAN_DURATION_SECONDS,
      }),
    );
    console.warn(
      `IP ${ip} banned for ${BAN_DURATION_SECONDS}s due to ${currentCount} App Check failures.`,
    );
  }
}

/**
 * Checks if an IP is currently banned.
 */
async function isIpBanned(ip: string, env: Env): Promise<boolean> {
  return (await getTranslationKV(env).get(BANNED_IP_KEY_PREFIX + ip)) === "true";
}

/**
 * Cache key generator (hash-like to avoid huge keys)
 */
function makeCacheKey(text: string, targetLang: string): string {
  const input = `${targetLang}:${text}`.toLowerCase().trim();
  // Simple hash: djb2
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) + hash + input.charCodeAt(i); // hash * 33 + char
    hash = hash & hash; // Keep as 32-bit
  }
  return `trans:${targetLang}:${hash.toString(16)}`;
}

/**
 * Identity-Aware Rate Limiting
 */
async function checkRateLimit(
  id: string,
  env: Env,
  ctx: ExecutionContext,
  tier: "L1" | "L2" | "both" = "both",
): Promise<boolean> {
  const now = Date.now();

  // Tier 1: Memory (Fast Shield)
  if (tier === "L1" || tier === "both") {
    if (RATE_LIMIT_MAP.size > 10000) RATE_LIMIT_MAP.clear();
    const record = RATE_LIMIT_MAP.get(id);
    if (
      record &&
      now < record.reset &&
      record.count > RATE_LIMIT_MAX_REQUESTS
    ) {
      return true;
    }
    if (!record || now > record.reset) {
      RATE_LIMIT_MAP.set(id, { count: 1, reset: now + RATE_LIMIT_WINDOW_MS });
    } else {
      record.count++;
    }
  }

  // Tier 2: Redis (Global Identity-based Guard)
  if (tier === "L2" || tier === "both") {
    const windowKey = Math.floor(now / 60000);
    const redisKey = `rate:global:${id}:${windowKey}`;

    const globalCount = await incrRedis(redisKey, env);
    if (globalCount === 1) {
      ctx.waitUntil(expireRedis(redisKey, 60, env));
    }
    if (globalCount !== null && globalCount > 150) {
      return true;
    }
  }
  return false;
}

async function getRedisCache(key: string, env: Env): Promise<string | null> {
  if (!env.UPSTASH_REDIS_REST_URL) return "CONFIG_ERROR";
  const baseUrl = env.UPSTASH_REDIS_REST_URL.replace(/\/$/, "");
  const res = await fetch(`${baseUrl}/get/${key}`, {
    headers: { Authorization: `Bearer ${env.UPSTASH_REDIS_REST_TOKEN}` },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { result?: string };
  return data.result ?? null;
}

async function setRedisCache(key: string, val: string, env: Env, ttl: number = 604800): Promise<void> {
  if (!env.UPSTASH_REDIS_REST_URL) return;
  const baseUrl = env.UPSTASH_REDIS_REST_URL.replace(/\/$/, "");
  const cmd = ["SET", key, val, "EX", ttl];
  await fetch(`${baseUrl}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.UPSTASH_REDIS_REST_TOKEN}` },
    body: JSON.stringify(cmd),
  });
}

async function incrRedis(key: string, env: Env): Promise<number | null> {
  if (!env.UPSTASH_REDIS_REST_URL) return null;
  const res = await fetch(`${env.UPSTASH_REDIS_REST_URL.replace(/\/$/, "")}/incr/${key}`, {
    headers: { Authorization: `Bearer ${env.UPSTASH_REDIS_REST_TOKEN}` },
  });
  return res.ok ? ((await res.json()) as { result: number }).result : null;
}

async function expireRedis(key: string, ttl: number, env: Env): Promise<void> {
  if (!env.UPSTASH_REDIS_REST_URL) return;
  await fetch(`${env.UPSTASH_REDIS_REST_URL.replace(/\/$/, "")}/expire/${key}/${ttl}`, {
    headers: { Authorization: `Bearer ${env.UPSTASH_REDIS_REST_TOKEN}` },
  });
}

/**
 * Translate text using Gemini AI with dictionary fallback and caching
 */
export async function translateWithGemini(
  text: string,
  targetLang: string,
  env: Env,
  lowData: boolean = false,
): Promise<{
  translated: string;
  source:
  | "dictionary"
  | "gemini"
  | "cache"
  | "fallback"
  | "circuit-breaker"
  | "low-data";
}> {
  // 1. Circuit breaker check
  if (await isCircuitBreakerOpen(env)) {
    return { translated: text, source: "circuit-breaker" };
  }

  // 2. Cache lookup
  const cacheKey = makeCacheKey(text, targetLang);
  const cached = await getTranslationKV(env).get(cacheKey);
  if (cached) {
    return { translated: cached, source: "cache" };
  }

  // 3. Dictionary fallback (exact match)
  if (isSupportedLang(targetLang)) {
    // Inside this block, targetLang is narrowed to SupportedLang
    const dict = DICTIONARY[targetLang];
    const exact = dict[text as TranslationKey];
    if (exact) {
      await getTranslationKV(env).put(cacheKey, exact, {
        expirationTtl: 86400 * 30,
      }); // 30d
      return { translated: exact, source: "dictionary" };
    }
    // Case-insensitive partial match for short phrases (≤5 words)
    const words = text.split(/\s+/);
    if (words.length <= 5) {
      for (const [phrase, translation] of Object.entries(dict)) {
        if (text.toLowerCase() === phrase.toLowerCase()) {
          await getTranslationKV(env).put(cacheKey, translation, {
            expirationTtl: 86400 * 30,
          });
          return { translated: translation, source: "dictionary" };
        }
      }
    }
  }

  // 4. Low-data mode check: skip Gemini and return original text
  if (lowData) {
    return { translated: text, source: "low-data" };
  }

  // 5. Gemini AI translation (if key configured)
  const apiKey = env.GOOGLE_GENAI_API_KEY || env.GEMINI_API_KEY;
  if (!apiKey || apiKey.trim().length === 0) {
    // No Gemini configured — return original text
    return { translated: text, source: "fallback" };
  }

  try {
    const translated = await runTranslation(apiKey, {
      text,
      targetLang
    });

    // Cache successful translation for 7 days
    await getTranslationKV(env).put(cacheKey, translated, {
      expirationTtl: 86400 * 7,
    });

    return { translated, source: "gemini" };
  } catch (error) {
    console.error("Gemini translation error:", error);
    await recordGeminiFailure(env);
    // Fallback: return original text
    return { translated: text, source: "fallback" };
  }
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);
    const clientIp = request.headers.get("cf-connecting-ip") || "127.0.0.1";
    const origin = request.headers.get("Origin") || "*";

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
          "Access-Control-Allow-Headers":
            "Content-Type, X-Firebase-AppCheck, X-Admin-Secret, X-Low-Data",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    const securityHeaders = {
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self' https://www.gstatic.com https://www.google.com https://unpkg.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: https://dor.gov.np https://dor-progress.web.app https://api.qrserver.com; connect-src 'self' https://dor-progress.banjays.workers.dev https://docs.google.com https://generativelanguage.googleapis.com https://firebaseappcheck.googleapis.com blob:; media-src 'self' blob:; frame-ancestors *;",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Permissions-Policy": "geolocation=(), microphone=(), camera=()",
      "Access-Control-Allow-Origin": origin,
      "X-Served-By": "Cloudflare-Worker",
    };

    // Normalize path (remove trailing slashes) for consistent routing
    const normalizedPath = url.pathname.replace(/\/+$/, "");

    // --- Immediate IP Ban Check (First Line of Defense) ---
    if (await isIpBanned(clientIp, env)) {
      return new Response(
        JSON.stringify({
          error:
            "Access Denied: Your IP has been temporarily banned due to suspicious activity.",
        }),
        {
          status: 403,
          headers: { ...securityHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Diagnostic: log the incoming path (remove after testing)
    // console.log(`[dor-progress] path="${url.pathname}" normalized="${normalizedPath}"`);

    const isKillSwitchActive =
      (await getTranslationKV(env).get("system:global_kill_switch")) === "true";
    if (isKillSwitchActive && !normalizedPath.startsWith("/api/admin/")) {
      return new Response(
        JSON.stringify({
          error:
            "Service Temporarily Unavailable: Global maintenance mode active.",
        }),
        {
          status: 503,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        },
      );
    }

    const force = url.searchParams.get("force") === "true";
    if (force && !normalizedPath.startsWith("/api/admin/")) {
      const forceLimitKey = `limit:force_rate:${clientIp}`;
      const isThrottled = await getRedisCache(forceLimitKey, env);
      if (!isThrottled) {
        await setRedisCache(forceLimitKey, "active", env, 120);
      }
    }

    // --- Global L1 Protection (IP-based) ---
    // We only run the fast Memory check (L1) globally to shield the worker
    const isLimited =
      !normalizedPath.startsWith("/api/admin/") &&
      (await checkRateLimit(clientIp, env, ctx, "L1"));
    if (isLimited) {
      return new Response(
        JSON.stringify({ error: "Too Many Requests: Rate limit exceeded." }),
        {
          status: 429,
          headers: { ...securityHeaders, "Content-Type": "application/json" },
        },
      );
    }

    if (normalizedPath.startsWith("/api/admin/")) {
      if (!(await verifyAdminSecret(request, env))) {
        return new Response("Unauthorized", { status: 401, headers: securityHeaders });
      }

      if (normalizedPath === "/api/admin/config-check") {
        // List all critical environment variables to check their loading status
        const keys: (keyof Env)[] = [
          "TRANSLATION_KV",
          "UPSTASH_REDIS_REST_URL",
          "UPSTASH_REDIS_REST_TOKEN",
          "GEMINI_API_KEY",
          "FIREBASE_PROJECT_ID",
          "FIREBASE_API_KEY",
          "FIREBASE_AUTH_DOMAIN",
          "FIREBASE_APP_ID",
          "FIREBASE_MESSAGING_SENDER_ID",
          "BUILD_ID",
          "COMMIT_SHA",
          "DEPLOY_TIMESTAMP",
        ];
        const results: Record<string, any> = {};
        for (const k of keys) {
          const v = env[k];
          const isSet = v !== undefined && v !== null;
          if (isSet) {
            const isString = typeof v === "string";
            results[k] = isString
              ? {
                status: "LOADED",
                length: v.length,
                preview:
                  v.length > 8
                    ? `${v.substring(0, 4)}...${v.slice(-4)}`
                    : "****",
              }
              : { status: "LOADED", type: typeof v };
          } else {
            results[k] = { status: "NOT_FOUND" };
          }
        }

        // 2. Live Infrastructure Connectivity Health Checks
        const health: Record<string, string> = { status: "OPERATIONAL" };
        try {
          await getTranslationKV(env).put(
            "system:health_ping",
            Date.now().toString(),
            { expirationTtl: 60 },
          );
          health.kv = "CONNECTED";
        } catch (e) {
          health.kv = "FAILED";
          health.status = "DEGRADED";
        }

        const redisTest = await getRedisCache("system:health_ping", env);
        health.redis =
          redisTest !== "CONFIG_ERROR" && redisTest !== null
            ? "CONNECTED"
            : "DISCONNECTED";

        // Firebase App Check JWKS connectivity test
        if (env.FIREBASE_PROJECT_ID) {
          try {
            const fbJwksProbe = await fetch(
              `https://firebaseappcheck.googleapis.com/v1/jwks`,
            );
            health.firebaseAppCheckJwks = fbJwksProbe.ok
              ? "CONNECTED"
              : `FAILED (${fbJwksProbe.status})`;
          } catch (e) {
            health.firebaseAppCheckJwks = "UNREACHABLE";
          }
        } else {
          health.firebaseAppCheckJwks = "SKIPPED (FIREBASE_PROJECT_ID not set)";
        }

        // Free TTS Connectivity Probe
        try {
          const ttsProbe = await fetch(
            "https://translate.google.com/translate_tts?q=ping&tl=en&client=tw-ob",
          );
          health.ttsProxy = ttsProbe.ok ? "CONNECTED" : "THROTTLED";
        } catch (e) {
          health.ttsProxy = "UNREACHABLE";
        }

        return new Response(
          JSON.stringify({
            metadata: {
              build: env.BUILD_ID || "NOT_INJECTED",
              sha: env.COMMIT_SHA
                ? env.COMMIT_SHA.substring(0, 7)
                : "NOT_INJECTED",
              deployed_at: env.DEPLOY_TIMESTAMP || "NOT_INJECTED",
              worker_host: url.hostname,
              app_check_expected_iss: `https://firebaseappcheck.googleapis.com/${env.FIREBASE_PROJECT_ID || "MISSING"}`,
            },
            environment: results,
            connectivity: health,
            timestamp: new Date().toISOString(),
          }),
          {
            headers: { ...securityHeaders, "Content-Type": "application/json" },
          },
        );
      }

      // Admin API: Purge specific translations or the entire manifest
      if (normalizedPath === "/api/admin/purge-cache" && request.method === "POST") {
        const body = (await request.json().catch(() => ({}))) as {
          text?: string;
          targetLang?: string;
          type?: "manifest" | "entry";
        };

        // Option A: Purge the entire translations.json manifest
        if (body.type === "manifest") {
          await getTranslationKV(env).delete("translations");
          return new Response(JSON.stringify({ success: true, message: "Translations manifest purged." }), {
            headers: { ...securityHeaders, "Content-Type": "application/json" },
          });
        }

        // Option B: Purge a specific translation entry (requires original text and lang)
        if (body.text && body.targetLang) {
          const key = makeCacheKey(body.text, body.targetLang);
          await getTranslationKV(env).delete(key);
          return new Response(JSON.stringify({ success: true, purgedKey: key }), {
            headers: { ...securityHeaders, "Content-Type": "application/json" },
          });
        }

        return new Response(JSON.stringify({ error: "Invalid parameters. Provide 'type: manifest' or both 'text' and 'targetLang'." }), {
          status: 400,
          headers: { ...securityHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Public API: Client Config (Firebase/Recaptcha keys)
    if (normalizedPath === "/api/client-config") {
      return new Response(
        JSON.stringify({
          firebase: {
            apiKey: env.FIREBASE_API_KEY,
            authDomain: env.FIREBASE_AUTH_DOMAIN,
            projectId: env.FIREBASE_PROJECT_ID,
            storageBucket: env.FIREBASE_STORAGE_BUCKET,
            messagingSenderId: env.FIREBASE_MESSAGING_SENDER_ID,
            appId: env.FIREBASE_APP_ID,
            measurementId: env.FIREBASE_MEASUREMENT_ID,
          },
          recaptchaSiteKey: env.RECAPTCHA_SITE_KEY,
        }),
        {
          headers: { ...securityHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // API: Serve translations.json
    if (normalizedPath === "/api/translations") {
      // Try KV first (cached)
      const cached = await getTranslationKV(env).get("translations", {
        type: "json",
      });
      if (cached) {
        return new Response(JSON.stringify(cached), {
          headers: { ...securityHeaders, "Content-Type": "application/json" },
        });
      }

      // Fallback: try to fetch from hosting (public/translations.json)
      try {
        const res = await fetch(
          "https://dor-progress.web.app/translations.json",
        );
        if (res.ok) {
          const translations = await res.json();
          // Cache in KV for future requests
          ctx.waitUntil(
            getTranslationKV(env).put(
              "translations",
              JSON.stringify(translations),
              {
                expirationTtl: 3600, // 1 hour
              },
            ),
          );
          return new Response(JSON.stringify(translations), {
            headers: { ...securityHeaders, "Content-Type": "application/json" },
          });
        }
      } catch (e) {
        // Ignore, return empty
      }

      // Ultimate fallback
      return new Response(JSON.stringify({ en: {}, ne: {}, _metadata: {} }), {
        headers: { ...securityHeaders, "Content-Type": "application/json" },
      });
    }

    // Public API: Translation endpoint

    if (normalizedPath === "/api/translate") {
      // 1. Verify Firebase App Check token to prevent unauthorized API usage
      const appCheckToken = request.headers.get("X-Firebase-AppCheck");
      const verification = await verifyAppCheckToken(appCheckToken, env, ctx);

      if (!verification.valid) {
        ctx.waitUntil(recordAppCheckFailure(clientIp, env, ctx)); // Record failure
        return new Response(
          JSON.stringify({
            error: "Unauthorized: App Check verification failed.",
          }),
          {
            status: 401,
            headers: { ...securityHeaders, "Content-Type": "application/json" },
          },
        );
      }

      // 2. Identity-Aware Rate Limiting (L2 - Global)
      // Use the App ID from the token as the Redis key instead of IP
      const isAppLimited = await checkRateLimit(
        verification.appId || clientIp,
        env,
        ctx,
        "L2",
      );
      if (isAppLimited) {
        return new Response(
          JSON.stringify({
            error: "Rate limit exceeded for this app instance.",
          }),
          {
            status: 429,
            headers: { ...securityHeaders, "Content-Type": "application/json" },
          },
        );
      }

      const targetLang = url.searchParams.get("targetLang") || "ne";
      // Check for custom X-Low-Data header or standard Save-Data header
      const lowData =
        request.headers.get("X-Low-Data") === "true" ||
        request.headers.get("Save-Data") === "on";

      let texts: string[] = [];
      const queryText = url.searchParams.get("text");

      if (queryText) {
        texts = [queryText];
      } else if (request.method === "POST") {
        // Support batching via POST JSON body, fallback to query param
        const body = (await request.json().catch(() => ({}))) as { texts?: string[]; text?: string };
        if (Array.isArray(body.texts)) {
          texts = body.texts;
        } else if (body.text) {
          texts = [body.text];
        }
      }

      if (texts.length === 0) {
        return new Response(
          JSON.stringify({ error: "Missing 'text' or 'texts' parameter" }),
          {
            status: 400,
            headers: { ...securityHeaders, "Content-Type": "application/json" },
          },
        );
      }

      // Process translations (batch or single)
      const results = await Promise.all(
        texts.map(t => translateWithGemini(t, targetLang, env, lowData))
      );

      // Basic rate limiting for public endpoint (stricter)
      const translateKey = `limit:translate:${clientIp}`;
      const isRateLimited = await getRedisCache(translateKey, env);

      // Set rate limit cache if any were not circuit-broken
      if (results.some(r => r.source !== "circuit-breaker")) {
        await setRedisCache(translateKey, "active", env, 60);
      }

      const responseData = request.method === "POST"
        ? { results: results.map((r, i) => ({ original: texts[i], translated: r.translated, source: r.source })) }
        : { original: texts[0], translated: results[0].translated, source: results[0].source };

      return new Response(JSON.stringify(responseData), {
        status: 200,
        headers: { ...securityHeaders, "Content-Type": "application/json" },
      });
    }

    // Snapshot API routes (require admin auth)
    if (normalizedPath.startsWith("/api/snapshot")) {
      if (!(await verifyAdminSecret(request, env))) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...securityHeaders, "Content-Type": "application/json" },
        });
      }

      // GET /api/snapshots - list all snapshots
      if (request.method === "GET" && normalizedPath === "/api/snapshots") {
        const list =
          (await getTranslationKV(env).get<SnapshotMetadata[]>(
            SNAPSHOT_LIST_KEY,
            "json",
          )) || [];
        return new Response(JSON.stringify({ snapshots: list }), {
          headers: { ...securityHeaders, "Content-Type": "application/json" },
        });
      }

      // GET /api/snapshot?date=YYYY-MM-DD - get specific snapshot PDF
      if (request.method === "GET" && normalizedPath === "/api/snapshot") {
        const date = url.searchParams.get("date");
        if (!date) {
          return new Response(
            JSON.stringify({ error: "Missing 'date' parameter" }),
            {
              status: 400,
              headers: {
                ...securityHeaders,
                "Content-Type": "application/json",
              },
            },
          );
        }
        const { value: pdf, metadata } = await getTranslationKV(env).getWithMetadata<SnapshotMetadata>(
          `snapshot:pdf:${date}`,
          "arrayBuffer",
        );
        if (!pdf) {
          return new Response(JSON.stringify({ error: "Snapshot not found" }), {
            status: 404,
            headers: { ...securityHeaders, "Content-Type": "application/json" },
          });
        }
        return new Response(pdf, {
          headers: { ...securityHeaders, "Content-Type": "application/pdf", "X-From-Cache": "true", "X-Cache-Time": metadata?.createdAt ? new Date(metadata.createdAt).getTime().toString() : "" },
        });
      }

      // POST /api/snapshot - trigger manual snapshot
      if (request.method === "POST" && normalizedPath === "/api/snapshot") {
        const data = (await request
          .json()
          .catch(() => ({ records: [], meta: {} }))) as ProjectData;

        const isDryRun = url.searchParams.get("dryRun") === "true";

        if (isDryRun) {
          const { pdfBytes, metadata } = await generateSnapshotPdf(data, env, ctx);
          return new Response(pdfBytes, {
            headers: {
              ...securityHeaders,
              "Content-Type": "application/pdf",
              "X-Snapshot-Metadata": JSON.stringify(metadata),
              "Content-Disposition": `inline; filename="snapshot-dryrun-${metadata.date}.pdf"`,
            },
          });
        }

        const snapshotMeta = await createSnapshot(env, ctx, data);
        return new Response(JSON.stringify({ success: true, metadata: snapshotMeta }), {
          status: 201,
          headers: { ...securityHeaders, "Content-Type": "application/json" },
        });
      }

      // DELETE /api/snapshot?date=YYYY-MM-DD - delete snapshot
      if (request.method === "DELETE" && normalizedPath === "/api/snapshot") {
        const date = url.searchParams.get("date");
        if (!date) {
          return new Response(
            JSON.stringify({ error: "Missing 'date' parameter" }),
            {
              status: 400,
              headers: {
                ...securityHeaders,
                "Content-Type": "application/json",
              },
            },
          );
        }
        await getTranslationKV(env).delete(`snapshot:pdf:${date}`);
        await getTranslationKV(env).delete(`snapshot:meta:${date}`);
        const list =
          (await getTranslationKV(env).get<SnapshotMetadata[]>(
            SNAPSHOT_LIST_KEY,
            "json",
          )) || [];
        const updated = list.filter((s) => s.date !== date);
        await getTranslationKV(env).put(
          SNAPSHOT_LIST_KEY,
          JSON.stringify(updated),
        );
        return new Response(JSON.stringify({ success: true, deleted: date }), {
          headers: { ...securityHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Default fallback
    return new Response("DoR API Operational", { headers: securityHeaders });
  },

  // Cron Trigger for JWKS caching (already implemented)
  /**
   * Cron Trigger: Proactively refreshes JWKS cache to handle rotation
   * without impacting user request latency.
   */
  scheduled(
    _event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext,
  ): void {
    // 1. Refresh JWKS Cache (Existing logic)
    ctx.waitUntil((async () => {
      const response = await fetch("https://firebaseappcheck.googleapis.com/v1/jwks");
      const jwks = await response.json();
      await getTranslationKV(env).put("system:firebase_jwks", JSON.stringify(jwks), {
        expirationTtl: 86400,
        metadata: { created: Date.now() },
      });
    })());

    // 2. Automated Weekly Snapshot
    // This runs based on the CRON schedule (e.g., every Sunday)
    ctx.waitUntil((async () => {
      try {
        console.log("[Cron] Starting automated snapshot...");
        // Fetch the actual data from the Google Sheet
        const projectData = await fetchProjectData(env);

        // Create the snapshot
        // The metadata will automatically include the BS Date via our helper
        const metadata = await createSnapshot(env, ctx, {
          records: projectData.rows,
          meta: { lastUpdate: new Date().toISOString() }
        });
        console.log(`[Cron] Snapshot created successfully for ${metadata.date} (${metadata.bsDate})`);
      } catch (err) {
        console.error("[Cron] Snapshot failed:", err);
      }
    })());
  },
}; // End of export default

/**
 * Cryptographically verifies a Firebase App Check token using Web Crypto API.
 * Caches public keys in KV to ensure low latency.
 */
async function verifyAppCheckToken(
  token: string | null,
  env: Env,
  ctx: ExecutionContext,
): Promise<{ valid: boolean; appId?: string }> {
  if (!token || !env.FIREBASE_PROJECT_ID) return { valid: false };

  const parts = token.split(".");
  if (parts.length !== 3) return { valid: false };

  try {
    // 1. Decode Header and Payload
    const header = JSON.parse(
      atob(parts[0].replace(/-/g, "+").replace(/_/g, "/")),
    );
    const payload = JSON.parse(
      atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")),
    );

    // 2. Validate Standard Claims
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) return { valid: false };

    // Audience should be projects/<your-project-id>
    if (payload.aud !== `projects/${env.FIREBASE_PROJECT_ID}`) {
      // Sometimes audience is just the project ID or number depending on the client
      if (!payload.aud.includes(env.FIREBASE_PROJECT_ID))
        return { valid: false };
    }

    // 3. Signature Verification
    const kid = header.kid;
    if (!kid) return { valid: false };

    // 4. Fetch JWKS with Stale-While-Revalidate (SWR) pattern
    const jwksKey = "system:firebase_jwks";
    const now_ms = Date.now();

    // Check In-Memory Cache first
    let kvMetadata: { created: number } | null = null;
    if (!cachedJwks || (now_ms - lastJwksFetch > JWKS_CACHE_TTL)) {
      const { value: kvJwks, metadata } =
        await getTranslationKV(env).getWithMetadata<Jwks, { created: number }>(
          jwksKey,
          "json",
        );

      kvMetadata = metadata;
      if (kvJwks) {
        cachedJwks = kvJwks;
        lastJwksFetch = kvMetadata?.created || now_ms;
      }
    }

    let jwks = cachedJwks;
    const isStale = !lastJwksFetch || now_ms - lastJwksFetch > 3600000; // Soft expire after 1 hour
    const kidMissing = !jwks?.keys.some((k: Jwk) => k.kid === kid);

    // If KID is missing (rotation detected) or cache is empty, fetch blockingly
    if (kidMissing) {
      const res = await fetch(
        "https://firebaseappcheck.googleapis.com/v1/jwks",
      );
      jwks = await res.json();
       ctx.waitUntil(
         getTranslationKV(env).put(jwksKey, JSON.stringify(jwks), {
          expirationTtl: 86400,
          metadata: { created: Date.now() },
        }),
      );
      cachedJwks = jwks;
      lastJwksFetch = Date.now();
    }
    // If cache is just stale but usable, use it and refresh in background
    else if (isStale) {
      ctx.waitUntil(
        (async () => {
          const res = await fetch(
            "https://firebaseappcheck.googleapis.com/v1/jwks",
          );
          const newJwks = await res.json();
           await getTranslationKV(env).put(jwksKey, JSON.stringify(newJwks), {
            expirationTtl: 86400,
            metadata: { created: Date.now() },
          });
        })(),
      );
    }

    const jwk = jwks.keys.find((k: Jwk) => k.kid === kid);
    if (!jwk) return { valid: false };

    // Import key into Web Crypto
    const key = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );

    // Verify signature
    const encoder = new TextEncoder();
    const data = encoder.encode(`${parts[0]}.${parts[1]}`);
    const signature = Uint8Array.from(
      atob(parts[2].replace(/-/g, "+").replace(/_/g, "/")),
      (c) => c.charCodeAt(0),
    );

    const isValid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      signature,
      data,
    );
    // Sub contains the app ID or user ID depending on the token type
    return { valid: isValid, appId: payload.sub };
  } catch (e) {
    console.error("App Check verification failed:", e);
    return { valid: false };
  }
}

function secureCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/**
 * Generates a SHA-256 fingerprint for a dataset to handle AI caching.
 */
async function generateFingerprint(data: any[]): Promise<string> {
  const msgUint8 = new TextEncoder().encode(JSON.stringify(data));
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Generates an executive summary using Gemini 2.0 Flash.
 */
async function generateAiSummary(rows: ProjectRow[], lang: "en" | "ne", env: Env): Promise<string> {
  const apiKey = env.GOOGLE_GENAI_API_KEY || env.GEMINI_API_KEY;
  if (!apiKey) return "Summary unavailable: API key not configured.";

  try {
    const result = await runProjectSummary(apiKey, { rows, lang });
    return result.brief;
  } catch (err) {
    console.error("Consolidated Summary Error:", err);
    await recordGeminiFailure(env);
    return "Summary unavailable due to a technical error.";
  }
}

function getBsDate(date: Date = new Date()): string {
  const bsYear = 2082;
  const bsMonths = [
    { name: "बैशाख", days: 30 },
    { name: "जेठ", days: 32 },
    { name: "असार", days: 32 },
    { name: "श्रावण", days: 30 },
    { name: "भदौ", days: 29 },
    { name: "अश्विन", days: 30 },
    { name: "कार्तिक", days: 29 },
    { name: "मंसिर", days: 30 },
    { name: "पौष", days: 29 },
    { name: "माघ", days: 30 },
    { name: "फाल्गुण", days: 29 },
    { name: "चैत", days: 30 },
  ];

  const bsDay = date.getDate();
  const bsMonthIndex = date.getMonth();
  const bsMonth = bsMonths[bsMonthIndex]?.name || "असार";
  return `${bsYear} साल ${bsMonth} ${bsDay}`;
}

function generateChecksum(data: unknown): string {
  const str = JSON.stringify(data);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16);
}

/**
 * Fetches and parses project data from the configured Google Sheet.
 * Adapted for use within the Worker environment.
 */
async function fetchProjectData(env: Env): Promise<{ headers: string[]; rows: ProjectRow[] }> {
  const sheetId = env.PUBLISHED_SHEET_ID;
  if (!sheetId) throw new Error("Google Sheet ID is not configured.");

  const publishedUrl = `https://docs.google.com/spreadsheets/d/e/${sheetId}/pub?output=csv`;
  const response = await fetch(publishedUrl);

  if (!response.ok) throw new Error(`Sheet fetch failed: ${response.statusText}`);

  const csvText = await response.text();
  const lines = csvText.split(/\r?\n/).filter((line) => line.trim() !== "");

  if (lines.length === 0) return { headers: [], rows: [] };

  const rawHeaders = lines[0]
    .split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/)
    .map((h: string) => h.replace(/^"|"$/g, "").trim());

  const headers = rawHeaders.map((h: string) => h.replace(/[\u200B-\u200D\uFEFF]/g, ""));

  const rows = lines.slice(1).map((line: string) => {
    const values = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map((v: string) => v.replace(/^"|"$/g, "").trim());
    const row: Record<string, any> = {};

    headers.forEach((header: string, i: number) => {
      const rawValue = values[i] || "";
      const cleanValue = rawValue.replace(/,/g, "");
      if (!isNaN(Number(cleanValue)) && cleanValue.trim() !== "") {
        row[header] = Number(cleanValue);
      } else {
        row[header] = rawValue;
      }
    });

    // Dynamic calculation of progress/status
    const targetKey = headers.find(
      (h: string) => h.includes("Annual Target") || h.includes("बार्षिक लक्ष्य"),
    );
    const progKey = headers.find(
      (h: string) =>
        h.includes("Annual Progress") || h.includes("हाल सम्म को बार्षिक प्रगति"),
    );

    if (targetKey && progKey) {
      const t = parseFloat(String(row[targetKey] || "0"));
      const p = parseFloat(String(row[progKey] || "0"));
      const progress = t > 0 ? Math.round((p / t) * 100) : 0;
      row._progress = progress;
      row._status = progress >= 80 ? "good" : progress >= 40 ? "stable" : "critical";
    }

    return row;
  });

  return { headers, rows };
}

async function generateSnapshotPdf(
  data: ProjectData,
  env: Env,
  ctx: ExecutionContext,
): Promise<{ pdfBytes: Uint8Array; metadata: SnapshotMetadata }> {
  const pdfDoc = await PDFDocument.create();

  // Check if data contains a specific update date from the sheet
  // If your sheet has a 'Last Update' header, you can extract it here
  let displayDate = new Date().toISOString().split("T")[0];

  // Try to find a date in the records if it exists
  if (data.records.length > 0) {
    const firstRecord = data.records[0] as Record<string, any>;
    const possibleDateKeys = ["Update Date", "मिति", "Date"];
    for (const key of possibleDateKeys) {
      if (firstRecord[key]) {
        displayDate = String(firstRecord[key]);
        break;
      }
    }
  }

  const page = pdfDoc.addPage([595.28, 841.89]);

  // Fetch and embed Noto Sans Devanagari to support Nepali characters
  const fontKey = "system:font:noto_sans_devanagari";
   let fontBytes = await getTranslationKV(env).get(fontKey, "arrayBuffer");

  if (!fontBytes) {
    const fontUrl = "https://fonts.gstatic.com/s/notosansdevanagari/v28/wf5m9WB_V9fNqbfVp-9ueS5mF-X_S-zY.ttf";
    const res = await fetch(fontUrl);
    if (!res.ok) throw new Error("Failed to fetch Noto Sans font from CDN");
    fontBytes = await res.arrayBuffer();
     ctx.waitUntil(getTranslationKV(env).put(fontKey, fontBytes));
  }

  if (!fontBytes || fontBytes.byteLength === 0) {
    throw new Error("Font initialization failed: font bytes are empty.");
  }
  const font = await pdfDoc.embedFont(fontBytes as ArrayBuffer);

  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const { height } = page.getSize();

  let y = height - 50;

  page.drawText("DoR Progress Snapshot Report", {
    x: 50,
    y,
    size: 22,
    font: fontBold,
    color: rgb(0.2, 0.2, 0.6),
  });
  y -= 40;

  const today = new Date().toISOString().split("T")[0];
  const bsDate = getBsDate();

  page.drawText(`Date: ${today} (${bsDate})`, {
    x: 50,
    y,
    size: 12,
    font,
    color: rgb(0.3, 0.3, 0.3),
  });
  y -= 20;

  page.drawText(`Records: ${data.records?.length || 0}`, {
    x: 50,
    y,
    size: 12,
    font,
    color: rgb(0.3, 0.3, 0.3),
  });
  y -= 30;

  page.drawText("Project Records", {
    x: 50,
    y,
    size: 16,
    font: fontBold,
    color: rgb(0.2, 0.2, 0.2),
  });
  y -= 20;

  const records = data.records || [];
  for (let i = 0; i < Math.min(records.length, 50); i++) { // Limit to 50 records for brevity in PDF
    const record = records[i] as Record<string, unknown>;
    const text = `${i + 1}. ${JSON.stringify(record).substring(0, 100)}`;
    page.drawText(text, {
      x: 50,
      y,
      size: 9,
      font,
      color: rgb(0.1, 0.1, 0.1),
    });
    y -= 12;
    if (y < 100) {
      page.drawText("... (truncated)", {
        x: 50,
        y: y + 20,
        size: 10,
        font,
        color: rgb(0.5, 0.5, 0.5),
      });
      break;
    }
  }

  const pdfBytes = await pdfDoc.save();

  const metadata: SnapshotMetadata = {
    date: displayDate,
    recordCount: records.length,
    checksum: generateChecksum(data),
    createdAt: new Date().toISOString(),
    bsDate,
  };

  return { pdfBytes, metadata };
}

async function enforceRetentionPolicy(
  env: Env,
  ctx: ExecutionContext,
): Promise<void> {
  const list =
    (await getTranslationKV(env).get<SnapshotMetadata[]>(
      SNAPSHOT_LIST_KEY,
      "json",
    )) || [];
  if (list.length <= SNAPSHOT_RETENTION_COUNT) return;

  const toDelete = list.slice(SNAPSHOT_RETENTION_COUNT);
  for (const snap of toDelete) {
    ctx.waitUntil(getTranslationKV(env).delete(`snapshot:pdf:${snap.date}`));
    ctx.waitUntil(getTranslationKV(env).delete(`snapshot:meta:${snap.date}`));
  }
}

async function createSnapshot(
  env: Env,
  ctx: ExecutionContext,
  data: ProjectData,
): Promise<SnapshotMetadata> {
  const { pdfBytes, metadata } = await generateSnapshotPdf(data, env, ctx);

  ctx.waitUntil(
    getTranslationKV(env).put(`snapshot:pdf:${metadata.date}`, pdfBytes, {
      expirationTtl: 86400 * 60,
    }),
  );

  ctx.waitUntil(
    getTranslationKV(env).put(
      `snapshot:meta:${metadata.date}`,
      JSON.stringify(metadata),
      {
        expirationTtl: 86400 * 60,
      },
    ),
  );

  const list =
    (await getTranslationKV(env).get<SnapshotMetadata[]>(
      SNAPSHOT_LIST_KEY,
      "json",
    )) || [];
  const existingIndex = list.findIndex((s) => s.date === metadata.date);
  if (existingIndex >= 0) {
    list[existingIndex] = metadata;
  } else {
    list.unshift(metadata);
  }
  ctx.waitUntil(
    getTranslationKV(env).put(SNAPSHOT_LIST_KEY, JSON.stringify(list)),
  );
  ctx.waitUntil(enforceRetentionPolicy(env, ctx));

  return metadata;
}
