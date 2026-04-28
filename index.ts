/**
 * Cloudflare Worker for DoR Progress Report
 * Features: Per-value translation, English key retention, and KV Caching.
 */

import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { Tiktoken } from 'js-tiktoken/lite';

/**
 * Interface for environment bindings.
 */
interface Env {
    // Bindings and Vars from wrangler.toml
    TRANSLATION_KV: KVNamespace;
    RATE_LIMITER: DurableObjectNamespace;

    // Secrets (Managed via 'npx wrangler secret put')
    UPSTASH_REDIS_REST_URL: string;
    UPSTASH_REDIS_REST_TOKEN: string;
    GEMINI_API_KEY: string;
    ADMIN_SECRET: string;
    FIREBASE_PROJECT_ID: string;

    // Optional Firebase fields (future use)
    FIREBASE_STORAGE_BUCKET?: string;
    FIREBASE_MESSAGING_SENDER_ID?: string;

    // Build metadata (passed as vars)
    BUILD_ID: string;
    COMMIT_SHA: string;
    DEPLOY_TIMESTAMP: string;
}

/**
 * Official Branding Constants from dor.gov.np
 */
const BRANDING = {
    primary: "#8D1B1B",       // DoR Crimson Red
    secondary: "#003893",     // DoR Navy Blue
    accent: "#FFD700",        // Gold accent
    success: "#2E7D32",       // High contrast green
    warning: "#ED6C02",       // High contrast orange
    error: "#D32F2F",         // High contrast red
    background: "#F4F7F9",   // Soft, eye-appealing cool gray (not pure white)
    surface: "#FFFFFF",      // Card/Paper color
    textPrimary: "#1A1A1A",  // Deep Charcoal for maximum sharpness
    textSecondary: "#455A64",// Muted Blue-Gray for secondary info
};

const BRANDING_DARK = {
    primary: "#B71C1C",       // Darker Crimson Red for contrast
    secondary: "#1A237E",     // Darker Navy Blue
    accent: "#FFEB3B",        // Brighter Gold for contrast
    success: "#66BB6A",       // Brighter Green
    warning: "#FFB300",       // Brighter Orange
    error: "#EF5350",         // Brighter Red
    background: "#121212",    // Very dark gray for background
    surface: "#1E1E1E",       // Slightly lighter dark gray for cards
    textPrimary: "#E0E0E0",   // Light gray for primary text
    textSecondary: "#A0A0A0", // Muted light gray for secondary info
};

// Static dictionary for common road department terms to minimize Gemini usage
const DICTIONARY: Record<string, Record<string, string>> = {
    ne: {
        "On Track": "ट्र्याकमा",
        "Delayed": "ढिलाइ",
        "In Progress": "सञ्चालनमा",
        "Critical": "गम्भीर",
        "Asphalt Paving": "कालोपत्रे",
        "Drainage Work": "ढल निर्माण",
        "km": "कि.मि.",
        "m": "मिटर",
        "Nos": "संख्या",
        "Hello": "नमस्ते",
        "Road": "सडक",
        "Construction": "निर्माण",
        "Traffic": "यातायात",
        "Blocked": "अवरुद्ध",
        "Open": "खुला",
        "Closed": "बन्द"
    }
};

// Circuit breaker constants
const FAIL_COUNT_KEY = "system:gemini_failure_count";
const CIRCUIT_BREAKER_KEY = "system:circuit_open";
const FAIL_THRESHOLD = 5;
const COOL_OFF_SECONDS = 600; // 10 minutes

/**
 * Check if circuit breaker is open (Gemini repeatedly failing)
 */
async function isCircuitBreakerOpen(env: Env): Promise<boolean> {
    const open = await env.TRANSLATION_KV.get(CIRCUIT_BREAKER_KEY);
    if (open === "true") {
        const failCountStr = await env.TRANSLATION_KV.get(FAIL_COUNT_KEY);
        const failCount = failCountStr ? parseInt(failCountStr, 10) : 0;
        if (failCount >= FAIL_THRESHOLD) {
            return true; // Still open
        }
        // Reset if below threshold (e.g., after cooldown)
        await env.TRANSLATION_KV.delete(CIRCUIT_BREAKER_KEY);
        await env.TRANSLATION_KV.delete(FAIL_COUNT_KEY);
    }
    return false;
}

/**
 * Record a Gemini failure and potentially trip circuit breaker
 */
async function recordGeminiFailure(env: Env): Promise<void> {
    const currentStr = await env.TRANSLATION_KV.get(FAIL_COUNT_KEY) || "0";
    const current = parseInt(currentStr, 10);
    const next = current + 1;
    await env.TRANSLATION_KV.put(FAIL_COUNT_KEY, next.toString(), { expirationTtl: COOL_OFF_SECONDS });
    if (next >= FAIL_THRESHOLD) {
        await env.TRANSLATION_KV.put(CIRCUIT_BREAKER_KEY, "true", { expirationTtl: COOL_OFF_SECONDS });
    }
}

/**
 * Cache key generator (hash-like to avoid huge keys)
 */
function makeCacheKey(text: string, targetLang: string): string {
    const input = `${targetLang}:${text}`.toLowerCase().trim();
    // Simple hash: djb2
    let hash = 5381;
    for (let i = 0; i < input.length; i++) {
        hash = ((hash << 5) + hash) + input.charCodeAt(i); // hash * 33 + char
        hash = hash & hash; // Keep as 32-bit
    }
    return `trans:${targetLang}:${hash.toString(16)}`;
}

/**
 * Translate text using Gemini AI with dictionary fallback and caching
 */
export async function translateWithGemini(
    text: string,
    targetLang: string,
    env: Env
): Promise<{ translated: string; source: "dictionary" | "gemini" | "cache" | "fallback" | "circuit-breaker" }> {
    // 1. Circuit breaker check
    if (await isCircuitBreakerOpen(env)) {
        return { translated: text, source: "circuit-breaker" };
    }

    // 2. Cache lookup
    const cacheKey = makeCacheKey(text, targetLang);
    const cached = await env.TRANSLATION_KV.get(cacheKey);
    if (cached) {
        return { translated: cached, source: "cache" };
    }

    // 3. Dictionary fallback (exact match)
    const dict = DICTIONARY[targetLang as keyof typeof DICTIONARY];
    if (dict) {
        const exact = dict[text];
        if (exact) {
            await env.TRANSLATION_KV.put(cacheKey, exact, { expirationTtl: 86400 * 30 }); // 30d
            return { translated: exact, source: "dictionary" };
        }
        // Case-insensitive partial match for short phrases (≤5 words)
        const words = text.split(/\s+/);
        if (words.length <= 5) {
            for (const [phrase, translation] of Object.entries(dict)) {
                if (text.toLowerCase() === phrase.toLowerCase()) {
                    await env.TRANSLATION_KV.put(cacheKey, translation, { expirationTtl: 86400 * 30 });
                    return { translated: translation, source: "dictionary" };
                }
            }
        }
    }

    // 4. Gemini AI translation (if key configured)
    if (!env.GEMINI_API_KEY || env.GEMINI_API_KEY.trim().length === 0) {
        // No Gemini configured — return original text
        return { translated: text, source: "fallback" };
    }

    try {
        // Construct prompt for translation
        const prompt = `Translate the following English text to ${targetLang === 'ne' ? 'Nepali (Devanagari script)' : targetLang}. 
Preserve numbers, units (km, m, Nos), proper nouns, and technical terms. 
Return ONLY the translated text with no additional commentary.

Text: "${text}"

Translation:`;

        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${env.GEMINI_API_KEY}`;
        const response = await fetch(geminiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [{
                    parts: [{ text: prompt }],
                    role: "user"
                }],
                generationConfig: {
                    temperature: 0.2,
                    maxOutputTokens: 512,
                    topP: 0.95,
                    topK: 40
                },
                safetySettings: [
                    { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
                    { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
                    { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
                    { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" }
                ]
            })
        });

        if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(`Gemini API ${response.status}: ${errorBody}`);
        }

        const data = await response.json() as {
            candidates?: Array<{
                content?: {
                    parts?: Array<{ text?: string }>
                }
            }>
        };
        const candidate = data.candidates?.[0];
        if (!candidate?.content?.parts?.[0]?.text) {
            throw new Error("Invalid Gemini response structure");
        }

        let translated = candidate.content.parts[0].text.trim();
        // Remove surrounding quotes if present
        translated = translated.replace(/^["']|["']$/g, "").trim();

        // Cache successful translation for 7 days
        await env.TRANSLATION_KV.put(cacheKey, translated, { expirationTtl: 86400 * 7 });

        return { translated, source: "gemini" };
    } catch (error) {
        console.error("Gemini translation error:", error);
        await recordGeminiFailure(env);
        // Fallback: return original text
        return { translated: text, source: "fallback" };
    }
}

export default {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
        const url = new URL(request.url);
        const clientIp = request.headers.get("cf-connecting-ip") || "127.0.0.1";
        const origin = request.headers.get("Origin") || "*";

        if (request.method === "OPTIONS") {
            return new Response(null, {
                headers: {
                    "Access-Control-Allow-Origin": origin,
                    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
                    "Access-Control-Allow-Headers": "Content-Type, X-Firebase-AppCheck, X-Admin-Secret, X-Low-Data",
                    "Access-Control-Max-Age": "86400",
                },
            });
        }

        const securityHeaders = {
            "Content-Security-Policy": "default-src 'self'; script-src 'self' https://www.gstatic.com https://www.google.com https://unpkg.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: https://dor.gov.np https://dor-progress.web.app https://api.qrserver.com; connect-src 'self' https://dor-progress.banjays.workers.dev https://docs.google.com https://generativelanguage.googleapis.com https://firebaseappcheck.googleapis.com blob:; media-src 'self' blob:; frame-ancestors *;",
            "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "strict-origin-when-cross-origin",
            "Permissions-Policy": "geolocation=(), microphone=(), camera=()",
            "Access-Control-Allow-Origin": origin,
            "X-Served-By": "Cloudflare-Worker"
        };

        // Normalize path (remove trailing slashes) for consistent routing
        const normalizedPath = url.pathname.replace(/\/+$/, '');

        // Diagnostic: log the incoming path (remove after testing)
        // console.log(`[dor-progress] path="${url.pathname}" normalized="${normalizedPath}"`);

        const isKillSwitchActive = await env.TRANSLATION_KV.get("system:global_kill_switch") === "true";
        if (isKillSwitchActive && !normalizedPath.startsWith('/api/admin/')) {
            return new Response(JSON.stringify({ error: "Service Temporarily Unavailable: Global maintenance mode active." }), {
                status: 503,
                headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
            });
        }

        let force = url.searchParams.get('force') === "true";
        let isForceThrottled = false;
        if (force && !normalizedPath.startsWith('/api/admin/')) {
            const forceLimitKey = `limit:force_rate:${clientIp}`;
            const isThrottled = await this.getRedisCache(forceLimitKey, env);
            if (isThrottled) {
                force = false;
                isForceThrottled = true;
            } else {
                await this.setRedisCache(forceLimitKey, "active", env, 120);
            }
        }

        const isLimited = !normalizedPath.startsWith('/api/admin/') && await this.checkRateLimit(clientIp, env);
        if (isLimited) {
            return new Response(JSON.stringify({ error: "Too Many Requests: Rate limit exceeded." }), {
                status: 429,
                headers: { ...securityHeaders, "Content-Type": "application/json" }
            });
        }

        if (normalizedPath.startsWith('/api/admin/')) {
            const adminSecret = request.headers.get("X-Admin-Secret");
            if (!adminSecret || !env.ADMIN_SECRET || !secureCompare(adminSecret, env.ADMIN_SECRET)) {
                return new Response("Unauthorized", { status: 401, headers: securityHeaders });
            }
            if (normalizedPath === '/api/admin/config-check') {
                const keys: (keyof Env)[] = [
                    'TRANSLATION_KV', 'RATE_LIMITER', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN',
                    'GEMINI_API_KEY', 'ADMIN_SECRET', 'FIREBASE_PROJECT_ID',
                    'BUILD_ID', 'COMMIT_SHA', 'DEPLOY_TIMESTAMP'
                ];
                const results: Record<string, any> = {};
                for (const k of keys) {
                    const v = env[k];
                    const isSet = v !== undefined && v !== null;
                    if (isSet) {
                        const isString = typeof v === 'string';
                        results[k] = isString
                            ? { status: "LOADED", length: v.length, preview: v.length > 8 ? `${v.substring(0, 4)}...${v.slice(-4)}` : "****" }
                            : { status: "LOADED", type: typeof v };
                    } else {
                        results[k] = { status: "NOT_FOUND" };
                    }
                }

                // 2. Live Infrastructure Health Check
                const health: Record<string, string> = { status: "OPERATIONAL" };
                try {
                    await env.TRANSLATION_KV.put("system:health_ping", Date.now().toString(), { expirationTtl: 60 });
                    health.kv = "CONNECTED";
                } catch (e) { health.kv = "FAILED"; health.status = "DEGRADED"; }

                // 3. Durable Object Storage Integrity Check (Internal DB)
                try {
                    const id = env.RATE_LIMITER.idFromName("health_probe");
                    const stub = env.RATE_LIMITER.get(id);
                    const doRes = await stub.fetch(new Request("https://rate.limit/health_check"));
                    health.internalDb = doRes.ok ? "HEALTHY" : "CORRUPT";
                    if (!doRes.ok) health.status = "DEGRADED";
                } catch (e) { health.internalDb = "UNREACHABLE"; health.status = "DEGRADED"; }

                const redisTest = await this.getRedisCache("system:health_ping", env);
                health.redis = redisTest !== "CONFIG_ERROR" && redisTest !== null ? "CONNECTED" : "DISCONNECTED";

                // Free TTS Connectivity Probe
                try {
                    const ttsProbe = await fetch("https://translate.google.com/translate_tts?q=ping&tl=en&client=tw-ob");
                    health.ttsProxy = ttsProbe.ok ? "CONNECTED" : "THROTTLED";
                } catch (e) { health.ttsProxy = "UNREACHABLE"; }

                return new Response(JSON.stringify({
                    metadata: {
                        build: env.BUILD_ID || "NOT_INJECTED",
                        sha: env.COMMIT_SHA ? env.COMMIT_SHA.substring(0, 7) : "NOT_INJECTED",
                        deployed_at: env.DEPLOY_TIMESTAMP || "NOT_INJECTED",
                        worker_host: url.hostname,
                        app_check_expected_iss: `https://firebaseappcheck.googleapis.com/${env.FIREBASE_PROJECT_ID || 'MISSING'}`
                    },
                    environment: results,
                    connectivity: health,
                    timestamp: new Date().toISOString()
                }), { headers: { ...securityHeaders, "Content-Type": "application/json" } });
            }
            // Future admin routes (idempotency, cache-purge, etc.) go here
        }

        // Public API: Translation endpoint
        if (normalizedPath === '/api/translate') {
            const text = url.searchParams.get('text');
            const targetLang = url.searchParams.get('targetLang') || 'ne';

            if (!text) {
                return new Response(JSON.stringify({ error: "Missing 'text' query parameter" }), {
                    status: 400,
                    headers: { ...securityHeaders, "Content-Type": "application/json" }
                });
            }

            // Basic rate limiting for public endpoint (stricter)
            const translateKey = `limit:translate:${clientIp}`;
            const isRateLimited = await this.getRedisCache(translateKey, env);
            if (isRateLimited) {
                return new Response(JSON.stringify({ error: "Rate limit exceeded. Try again later." }), {
                    status: 429,
                    headers: { ...securityHeaders, "Content-Type": "application/json" }
                });
            }

            // Perform translation
            const result = await translateWithGemini(text, targetLang, env);

            // Set rate limit cache (1 minute) — only if not circuit-broken
            if (result.source !== 'circuit-breaker') {
                await this.setRedisCache(translateKey, "active", env, 60);
            }

            return new Response(JSON.stringify({
                original: text,
                translated: result.translated,
                targetLang,
                source: result.source
            }), {
                status: 200,
                headers: { ...securityHeaders, "Content-Type": "application/json" }
            });
        }

        // Default fallback
        return new Response("DoR API Operational", { headers: securityHeaders });
    },

    async checkRateLimit(clientIp: string, env: Env): Promise<boolean> {
        if (!env.RATE_LIMITER) return false;
        const id = env.RATE_LIMITER.idFromName(clientIp);
        const stub = env.RATE_LIMITER.get(id);
        const res = await stub.fetch(new Request("https://rate.limit/"));
        return res.status === 429;
    },

    async getRedisCache(key: string, env: Env): Promise<string | null> {
        if (!env.UPSTASH_REDIS_REST_URL) return "CONFIG_ERROR";
        const baseUrl = env.UPSTASH_REDIS_REST_URL.replace(/\/$/, "");
        const res = await fetch(`${baseUrl}/get/${key}`, { headers: { Authorization: `Bearer ${env.UPSTASH_REDIS_REST_TOKEN}` } });
        if (!res.ok) return null;
        const data = await res.json() as { result?: string };
        return data.result ?? null;
    },

    async setRedisCache(key: string, val: string, env: Env, ttl: number = 604800): Promise<void> {
        if (!env.UPSTASH_REDIS_REST_URL) return;
        const baseUrl = env.UPSTASH_REDIS_REST_URL.replace(/\/$/, "");
        const cmd = ["SET", key, val, "EX", ttl];
        await fetch(`${baseUrl}`, { method: "POST", headers: { Authorization: `Bearer ${env.UPSTASH_REDIS_REST_TOKEN}` }, body: JSON.stringify(cmd) });
    },
    // ... (Other helpers)
};

// ... (Logic functions like translateWithGemini, applyBrandingToPdf follow)

async function verifyAppCheckToken(token: string | null, env: Env): Promise<boolean> {
    if (!token || !env.FIREBASE_PROJECT_ID || token.split('.').length !== 3) return false;
    try {
        const parts = token.split('.');
        const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
        return payload.exp > Date.now() / 1000 && payload.iss === `https://firebaseappcheck.googleapis.com/${env.FIREBASE_PROJECT_ID}`;
    } catch { return false; }
}

function secureCompare(a: string, b: string): boolean {
    if (a.length !== b.length) return false; let r = 0;
    for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return r === 0;
}

export class RateLimiter {
    constructor(private state: DurableObjectState) { }
    async fetch(request: Request) {
        const url = new URL(request.url);

        // Health Check Probe for Storage Integrity
        if (url.pathname === '/health_check') {
            try {
                await this.state.storage.put("integrity_ping", Date.now());
                const val = await this.state.storage.get("integrity_ping");
                return new Response(val ? "OK" : "FAIL");
            } catch (e) { return new Response("FAIL", { status: 500 }); }
        }

        let ts: number[] = await this.state.storage.get<number[]>("ts") || [];
        const now = Date.now();
        ts = ts.filter(t => now - t < 60000);
        if (ts.length >= 100) return new Response("Throttled", { status: 429 });
        ts.push(now);
        await this.state.storage.put("ts", ts);
        return new Response("OK");
    }
}