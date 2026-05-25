import { getToken } from "firebase/app-check";
import { z } from "zod";

/** 
 * Unified Core & API Utilities
 * Consolidated from shared/types.ts to reduce file count.
 */

export interface Env {
  UPSTASH_REDIS_REST_URL?: string;
  UPSTASH_REDIS_REST_TOKEN?: string;
  GEMINI_API_KEY?: string;
  GOOGLE_GENAI_API_KEY?: string;
  FIREBASE_PROJECT_ID?: string;
  FIREBASE_PROJECT_NUMBER?: string;
  FIREBASE_APP_ID?: string;
  FIREBASE_API_KEY?: string;
  FIREBASE_AUTH_DOMAIN?: string;
  FIREBASE_STORAGE_BUCKET?: string;
  FIREBASE_MESSAGING_SENDER_ID?: string;
  FIREBASE_MEASUREMENT_ID?: string;
  PUBLISHED_SHEET_ID?: string;
  SNAPSHOT_KEY?: string;
  APP_ENV?: string;
  DIGITAL_SIGNATURE?: string;
  RECAPTCHA_SITE_KEY?: string;
}

export const SpreadsheetHeadersSchema = z.array(z.string());
export type SpreadsheetHeaders = z.infer<typeof SpreadsheetHeadersSchema>;

export const ProjectRowSchema = z.object({
  _status: z.enum(["good", "moderate", "critical", "stable"]).optional(),
  _insight: z.string().optional(),
}).catchall(z.any());
export type ProjectRow = z.infer<typeof ProjectRowSchema>;

export const AiSummarySchema = z.object({
  brief: z.string(),
  overallHealth: z.enum(["good", "moderate", "critical"]).optional(),
  criticalProjects: z.array(z.string()).optional().nullable(),
  exceedingProjects: z.array(z.string()).optional().nullable(),
  discrepancies: z.array(z.object({
    text: z.string().min(1),
    severity: z.enum(["low", "medium", "high"]).default("medium")
  })).optional().nullable(),
  extractedData: z.object({
    headers: SpreadsheetHeadersSchema,
    rows: z.array(ProjectRowSchema),
    date: z.string().optional()
  }).optional().nullable()
});
export type AiSummary = z.infer<typeof AiSummarySchema>;

export const ProjectReportSchema = z.object({
  created: z.string().optional(),
  headers: SpreadsheetHeadersSchema,
  rows: z.array(ProjectRowSchema),
  lastUpdate: z.string(),
  aiSummary: AiSummarySchema.nullable(),
  adminMessage: z.string().optional()
});
export type ProjectReport = z.infer<typeof ProjectReportSchema>;

export const ArchiveMetadataSchema = z.object({
  date: z.string(),
  summary: z.string().optional(),
  created: z.string(),
  bsDate: z.string().optional(),
  recordCount: z.number(),
});
export type ArchiveMetadata = z.infer<typeof ArchiveMetadataSchema>;

export const SnapshotRequestSchema = z.object({
  headers: SpreadsheetHeadersSchema.optional(),
  records: z.array(ProjectRowSchema),
  meta: z.object({ lastUpdate: z.string(), total: z.number() })
});

export const ClientConfigSchema = z.object({
  firebase: z.object({
    apiKey: z.string(),
    authDomain: z.string(),
    projectId: z.string(),
    storageBucket: z.string(),
    messagingSenderId: z.string(),
    appId: z.string(),
    measurementId: z.string().optional(),
  }),
  recaptchaKey: z.string().optional(),
  digitalSignatureEnabled: z.boolean().optional(),
});
export type ClientConfig = z.infer<typeof ClientConfigSchema>;

/** Weak reference to Dashboard to avoid Worker-incompatible imports */
let dashboardInstance: any = null;
export const registerDashboard = (instance: any) => { dashboardInstance = instance; };

interface TranslationContent {
  months?: string[];
  [key: string]: string | string[] | undefined;
}

/**
 * Type-safe access to translations including metadata
 */
export let I18N: Record<string, TranslationContent> & {
  _metadata?: { syncAt: string; fingerprint: string };
} = {} as any;

/**
 * Loads translations from the public directory at runtime
 */
export async function loadTranslations() {
  const response = await fetch('/translations.json');
  if (!response.ok) throw new Error("Failed to load translations");
  I18N = await response.json();
}

/**
 * Global access to Sheets configuration loaded at runtime
 */
export let sheetsConfig: any = null;
export async function loadSheetsConfig() {
  const response = await fetch('/sheets.config.json');
  if (!response.ok) throw new Error("Failed to load sheets configuration");
  sheetsConfig = await response.json();
}

/** Cache for PluralRules to boost performance */
const pluralRulesCache = new Map<string, Intl.PluralRules>();

const AR_TO_NE = ["०", "१", "२", "३", "४", "५", "६", "७", "८", "९"];
const NE_TO_AR: Record<string, string> = {
  "०": "0", "१": "1", "२": "2", "३": "3", "४": "4",
  "५": "5", "६": "6", "७": "7", "८": "8", "९": "9",
};

/**
 * Converts Arabic numerals to Nepali numerals.
 */
export function toNepaliNumerals(num: number | string | null | undefined): string {
  return String(num || "").replace(/[0-9]/g, (d: string) => AR_TO_NE[Number(d)]);
}

/**
 * Converts Nepali numerals to Arabic numerals.
 */
export function toArabicNumerals(str: string | null | undefined): string {
  return String(str || "").replace(/[०-९]/g, (d: string) => NE_TO_AR[d] ?? d);
}

/**
 * Robustly finds a column header based on known aliases.
 */
export function getColumnKey(
  headers: SpreadsheetHeaders,
  field: "indicator" | "annualTarget" | "annualProgress" | "totalTarget" | "totalProgress",
): string | undefined {
  const aliases: Record<string, string[]> = {
    indicator: ["Indicator", "सूचक", "विवरण", "Indicator Name"],
    annualTarget: ["Annual Target", "बार्षिक लक्ष्य", "Yearly Target", "Target (Annual)"],
    annualProgress: ["Annual Progress", "हाल सम्म को बार्षिक प्रगति", "Yearly Progress", "Achievement"],
    totalTarget: ["Total Target", "कुल लक्ष्य", "Overall Target"],
    totalProgress: ["Total Progress", "कुल प्रगति", "Overall Progress"],
  };
  const searchTerms = aliases[field] || [];
  return headers.find((h: string) =>
    searchTerms.some((term) => h.toLowerCase().includes(term.toLowerCase())),
  );
}

/**
 * Calculates progress percentage based on row data.
 */
export function getProgress(row: ProjectRow, headers: SpreadsheetHeaders): number {
  const targetKey = getColumnKey(headers, "annualTarget");
  const progKey = getColumnKey(headers, "annualProgress");
  if (!targetKey || !progKey) return 0;
  const clean = (val: any) => parseFloat(String(val || "0").replace(/[^0-9.-]/g, ""));
  const t_val = clean(row[targetKey]);
  const p_val = clean(row[progKey]);
  return t_val > 0 ? Math.round((p_val / t_val) * 100) : 0;
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/**
 * Internal translation logic without memoization.
 */
function translate(key: string, count?: number): string {
  if (!key) return "";
  const state = dashboardInstance?.state;
  const currentLang = (state?.lang === "_metadata" ? "en" : (state?.lang || "en")) as string;

  const langData = I18N[currentLang as keyof typeof I18N] as TranslationContent | undefined;
  const dynamicCache = state?.dynamicCache || {};

  let finalKey = key;

  if (count !== undefined) {
    let pluralRules = pluralRulesCache.get(currentLang);
    if (!pluralRules) {
      pluralRules = new Intl.PluralRules(currentLang);
      pluralRulesCache.set(currentLang, pluralRules);
    }
    const rule = pluralRules.select(count);
    const pKey = `${key}_${rule}`;

    // If plural key exists in either cache or static, use it
    if (dynamicCache[pKey] !== undefined || (langData && langData[pKey] !== undefined)) {
      finalKey = pKey;
    }
  }

  const rawText = dynamicCache[finalKey] || (langData ? langData[finalKey] : null);

  let text: string | null = null;
  if (rawText !== null && rawText !== undefined) {
    text = Array.isArray(rawText) ? rawText.join(", ") : (rawText as string);
  } else if (currentLang !== "en") {
    // Fallback to English if translation is missing in the current language
    const enData = I18N["en"] as TranslationContent | undefined;
    const enRaw = enData ? enData[finalKey] : null;
    if (enRaw) text = Array.isArray(enRaw) ? enRaw.join(", ") : (enRaw as string);
  }

  const result = text || key;

  if (count !== undefined) {
    const displayCount = currentLang === "ne" ? toNepaliNumerals(count) : String(count);
    return result.replace(/{{count}}/g, displayCount);
  }
  return result;
}

/** Cache for static translations to prevent redundant lookups */
const tCache = new Map<string, string>();

/**
 * Core Translation Helper with memoization for static keys.
 */
export const t = (key: string, count?: number): string => {
  if (!key) return "";

  // Pluralized translations or those with counts are dynamic; bypass memoization
  if (count !== undefined) return translate(key, count);

  const currentLang = (dashboardInstance?.state?.lang === "_metadata" ? "en" : dashboardInstance?.state?.lang || "en") as string;
  const cacheKey = `${currentLang}:${key}`;

  const cached = tCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const result = translate(key);
  tCache.set(cacheKey, result);
  return result;
};

/**
 * Clears the translation memoization cache.
 */
export const clearTranslationCache = () => tCache.clear();

/**
 * Centralized fetch helper to handle base URLs and Firebase App Check tokens.
 */
// Capture the worker base once at module load. 
// In Browser: uses Vite env. In Worker: uses global WORKER_BASE.
const GLOBAL_WORKER_BASE = (globalThis as any).WORKER_BASE
  ? (globalThis as any).WORKER_BASE
  : (import.meta.env.VITE_WORKER_BASE || "");

export async function authenticatedFetch(
  path: string,
  options: RequestInit = {},
  maxRetries = 3,
): Promise<Response> {
  const firebaseBase = import.meta.env.VITE_FIREBASE_URL || '';

  // Improved validation: warn if we are making a relative request that likely needs an absolute worker URL
  const isProduction = import.meta.env.PROD;
  if (!GLOBAL_WORKER_BASE && !path.startsWith('http') && (path.includes('/api/') || path.includes('/snapshot')) && isProduction) {
    throw new Error(
      `Routing Error: VITE_WORKER_BASE is not defined. API requests cannot be made to relative paths in production. ` +
      `Check your GitHub Secrets and deployment environment.`
    );
  }

  let url: string;
  if (path.startsWith('http')) {
    url = path;
  } else {
    const baseUrl = GLOBAL_WORKER_BASE || firebaseBase;
    if (!baseUrl && isProduction) {
      throw new Error(`Routing Error: No Base URL defined for API request to "${path}".`);
    }
    url = baseUrl 
      ? `${baseUrl.replace(/\/*$/, '')}/${path.replace(/^\//, '')}`
      : `${window.location.origin}/${path.replace(/^\//, '')}`;
  }

  // Use native Headers API for robust merging
  const headers = new Headers(options.headers);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const isLowData = typeof window !== "undefined" && localStorage.getItem("low-data") === "true";
  headers.set("X-Low-Data", isLowData ? "true" : "false");

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // --- App Check Fallback Logic ---
      if (dashboardInstance?.appCheck && !dashboardInstance.state.appCheckFallbackMode) {
        try {
          // Force refresh the token on subsequent attempts
          const tokenResult = await getToken(dashboardInstance.appCheck, attempt > 0);
          if (tokenResult?.token) {
            headers.set("X-Firebase-AppCheck", tokenResult.token);
          }
        } catch (authErr) {
          console.warn("AppCheck token fetch failed, proceeding without it", authErr); // authErr is already typed as unknown
        }
      } else if (dashboardInstance?.state.appCheckFallbackMode) {
        // If in fallback mode, send a specific header to the worker
        headers.set("X-AppCheck-Fallback", "true");
        console.warn("[App Check] Client in fallback mode, skipping token fetch and sending X-AppCheck-Fallback header.");
      }

      const response = await fetch(url, { ...options, headers });

      if (response.ok) return response;

      const errorMsg = await getApiErrorMessage(response, `HTTP ${response.status}: ${url}`);
      const isLastAttempt = attempt === maxRetries - 1;

      // Handle terminal 401
      if (response.status === 401) {
        if (isLastAttempt) dashboardInstance?.logout();
        // If it's a 401, we only want to retry once with a fresh token
        if (attempt > 0) throw new Error(errorMsg);
      }

      // Only retry on network errors (caught below) or specific status codes
      const retriableStatuses = [401, 429, 500, 502, 503, 504];
      if (!retriableStatuses.includes(response.status) || isLastAttempt) {
        throw new Error(errorMsg);
      }

      // If we are here, we are going to retry. Fall through to catch block logic.
      throw new Error("Retriable status received");
    } catch (err) {
      const error = toError(err);
      const isNetworkError = error.message.toLowerCase().includes("fetch");

      if (attempt === maxRetries - 1 || (error.message !== "Retriable status received" && !isNetworkError)) {
        if (isNetworkError && (url.includes("localhost") || url.includes("127.0.0.1"))) {
          throw new Error(`Connection Refused: Ensure your local worker is running (npm run dev) and accessible at ${url}`);
        }
        throw error;
      }

      // Exponential backoff with jitter
      const delay = Math.pow(2, attempt) * 1000 + Math.random() * 1000;

      // Respect AbortSignal during delay
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(resolve, delay);
        options.signal?.addEventListener("abort", () => {
          clearTimeout(timeout);
          reject(options.signal?.reason);
        }, { once: true });
      });
    }
  }
  throw new Error("Max retries exceeded");
}

/**
 * Safely parses and validates a JSON response against a Zod schema.
 * Throws a descriptive error if validation fails.
 */
export async function parseResponse<T>(response: Response, schema: z.ZodSchema<T>): Promise<T> {
  try {
    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    if (!contentType.includes("application/json") && response.status !== 204) {
      const text = await response.text();
      const isHtml = text.trim().startsWith("<");

      let hint = "Received non-JSON response.";
      if (isHtml || contentType.includes("text/html")) {
        hint = "Routing Error: Received HTML instead of JSON. Firebase Hosting is returning index.html because it can't find the resource.";
        if (response.url.includes(window.location.hostname)) {
          hint += " If this is an API call, ensure WORKER_BASE is set to your absolute Cloudflare URL, or that Cloudflare is configured as a reverse proxy.";
        }
      }

      console.error(`[API Error] Expected JSON but got ${isHtml ? 'HTML' : 'Text'}. URL: ${response.url}`);
      throw new Error(`${hint} (Status: ${response.status})`);
    }

    const json = await response.json();
    const result = schema.safeParse(json);

    if (!result.success) {
      console.error("[Validation Error]", JSON.stringify(result.error.format(), null, 2));
      throw new Error(`Data Contract Violation: The server returned an invalid format.`);
    }

    return result.data;
  } catch (err) {
    throw toError(err);
  }
}

/**
 * Safely converts an unknown error variable to a standard Error object.
 */
export function toError(err: unknown): Error {
  if (err instanceof Error) return err;
  if (err && typeof err === 'object') {
    const e = err as any;
    // Extract message from Firebase/App Check error objects (e.g., name: 'n', code: 403)
    const msg = e.message || e.statusText || (e.code ? `Security Error (Code: ${e.code})` : null);
    if (msg) return new Error(msg);
  }
  const stringified = String(err);
  return new Error(stringified === "[object Object]" ? "An unexpected error occurred" : stringified);
}

/**
 * Zod schema for common API error response structures.
 * Allows for 'error', 'message', or 'details' fields, and ignores others.
 */
const ApiErrorSchema = z.object({
  error: z.string().optional(),
  message: z.string().optional(),
  details: z.any().optional(),
}).passthrough();

/**
 * Mapping of HTTP status codes to user-friendly messages or translation keys.
 */
const StatusMessageMap: Record<number, string> = {
  401: "authRequired",
  403: "Access Denied: You do not have permission to perform this action.",
  404: "The requested resource was not found on the server.",
  429: "Too many requests. Please wait a moment before trying again.",
  500: "Server Error: Something went wrong on our end.",
  503: "Service Unavailable: The server is temporarily offline.",
};

/**
 * Safely extracts an error message from a fetch Response object.
 * Handles cases where the body might not be JSON or might be empty.
 */
export async function getApiErrorMessage(response: Response, fallback = "Unknown API Error"): Promise<string> {
  const status = response.status;

  try {
    const text = await response.text();
    const statusFallback = StatusMessageMap[status] ? t(StatusMessageMap[status]) : (response.statusText || fallback);

    if (!text) return `${statusFallback} (${status})`;

    // Attempt to parse application-level error codes (like the 403 seen in logs)
    let json;
    try { json = JSON.parse(text); } catch { json = null; }

    const parsed = json ? ApiErrorSchema.safeParse(json) : null;
    if (parsed?.success) {
      const data = parsed.data;
      const serverMessage = data.error || data.message || (typeof data.details === 'string' ? data.details : data.details?.message);
      return serverMessage ? `${serverMessage} (${status})` : `${statusFallback} (${status})`;
    }
    return `${statusFallback} (${status})`;
  } catch {
    return `${StatusMessageMap[status] ? t(StatusMessageMap[status]) : fallback} (${status})`; // err is implicitly any here, but not used.
  }
}

/**
 * Shared UI logic to handle terminal-style typing effect.
 */
interface TextElement extends HTMLElement {
  _timer?: number;
}

export function typeText(element: TextElement, text: string, playSound?: (pitch?: number) => void, isError = false) {
  if (element.getAttribute("data-current") === text) return;
  element.setAttribute("data-current", text);

  // Clear existing element-specific timer to prevent overlapping
  if (element._timer) window.clearTimeout(element._timer);
  element.innerText = "";
  element.classList.add("shimmer-text");
  if (isError) element.classList.add("glitch");

  let i = 0;
  const process = () => {
    if (i < text.length) {
      const char = text.charAt(i);
      element.innerText += char;

      // Realistic variation: slight pitch shift, or chaotic pitch for errors
      if (playSound) {
        const pitch = isError ? (0.5 + Math.random() * 1.5) : (0.92 + Math.random() * 0.16);
        playSound(pitch);
      }

      i++;

      // Human-like timing: base speed + jitter + punctuation pauses (Frantic timing for errors)
      let delay = isError ? 20 : 35;
      delay += (Math.random() * 30 - 15); // Random jitter +/- 15ms

      if (/[.!?,:;]/.test(char)) delay += 220; // Natural pause at punctuation
      else if (char === " ") delay += 50; // Slight pause for word separation

      element._timer = window.setTimeout(process, Math.max(10, delay));
    } else {
      element.classList.remove("shimmer-text");
      element.classList.remove("glitch");
      element._timer = undefined;
    }
  };
  process();
}

/**
 * Updates the connection strength badge in the UI.
 */
export function updateConnStrength(duration: number, lang: string) {
  const badge = document.getElementById("conn-strength");
  if (!badge) return;

  const langStrings = I18N[lang];
  let label = langStrings.connExcellent; // Use direct lookup for performance
  let color = "#4ade80";

  if (duration > 2500) { label = t("connPoor"); color = "var(--critical)"; }
  else if (duration > 1200) { label = t("connFair"); color = "#facc15"; }
  else if (duration > 500) { label = t("connGood"); color = "var(--primary)"; }

  const connText = lang === 'ne' ? 'जडान:' : 'Connection:';
  badge.innerText = `${connText} ${label}`;
  badge.style.color = color;
  badge.style.display = "inline-flex";
}

/**
 * Safely triggers a file download from a Blob (Moved from utils.ts)
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.style.display = "none";
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => window.URL.revokeObjectURL(url), 1000);
}
