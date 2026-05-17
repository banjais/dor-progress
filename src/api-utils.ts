import { getToken } from "firebase/app-check";
import { z } from "zod";
import { Dashboard } from "./Dashboard";
import translationsDataRaw from "./locales/translations.json" with { type: "json" };

interface TranslationContent {
  months: string[]; // Assuming 'months' is always an array of strings
  [key: string]: string | string[]; // Allow other keys to be strings or string arrays
}

/**
 * Type-safe access to translations including metadata
 */
export const I18N = translationsDataRaw as unknown as Record<string, TranslationContent> & {
  _metadata?: { syncAt: string; fingerprint: string };
};

/** Cache for PluralRules to boost performance */
const pluralRulesCache = new Map<string, Intl.PluralRules>();

/**
 * Converts Arabic numerals to Nepali numerals.
 */
export function toNepaliNumerals(num: number | string): string {
  const n = ["०", "१", "२", "३", "४", "५", "६", "७", "८", "९"];
  return String(num).replace(/[0-9]/g, (d) => n[Number(d)]);
}

/**
 * Converts Nepali numerals to Arabic numerals.
 */
export function toArabicNumerals(str: string): string {
  const n: Record<string, string> = {
    "०": "0",
    "१": "1",
    "२": "2",
    "३": "3",
    "४": "4",
    "५": "5",
    "६": "6",
    "७": "7",
    "८": "8",
    "९": "9",
  };
  return String(str || "").replace(/[०-९]/g, (d) => n[d] ?? d);
}

/**
 * Core Translation Helper
 */
export const t = (key: string, count?: number): string => {
  if (!key) return "";
  const dashboard = Dashboard.getInstance();
  let currentLang = (dashboard.state.lang || "en") as string;
  if (currentLang === "_metadata") currentLang = "en"; // No citation needed, this is internal code.

  let finalKey = key;
  const langData = I18N[currentLang as keyof typeof I18N] as TranslationContent | undefined;

  if (count !== undefined) {
    if (!pluralRulesCache.has(currentLang)) {
      pluralRulesCache.set(currentLang, new Intl.PluralRules(currentLang));
    }
    const rule = pluralRulesCache.get(currentLang)!.select(count);
    const pKey = `${key}_${rule}`;

    // If plural key exists in either cache or static, use it
    const hasPlural =
      dashboard.state.dynamicCache[pKey] !== undefined ||
      (langData && langData[pKey] !== undefined);

    finalKey = hasPlural ? pKey : key;
  }

  const rawText =
    dashboard.state.dynamicCache[finalKey] ||
    (langData ? langData[finalKey] : null);

  // Convert array translations to strings if necessary
  let text = Array.isArray(rawText) ? rawText.join(", ") : (rawText as string | null);

  text = text || key;

  if (count !== undefined) {
    const displayCount = currentLang === "ne" ? toNepaliNumerals(count) : String(count);
    return text.split("{{count}}").join(displayCount);
  }
  return text;
};

/**
 * Centralized fetch helper to handle base URLs and Firebase App Check tokens.
 */
export async function authenticatedFetch(
  path: string,
  options: RequestInit = {},
  maxRetries = 3,
): Promise<Response> {
  const dashboard = Dashboard.getInstance();

  // Normalize URL joining
  const baseUrl = WORKER_BASE.endsWith("/") ? WORKER_BASE.slice(0, -1) : WORKER_BASE;
  const url = path.startsWith("http") ? path : `${baseUrl}/${path.replace(/^\//, "")}`;

  // Use native Headers API for robust merging
  const headers = new Headers(options.headers);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const isLowData = typeof window !== "undefined" && localStorage.getItem("low-data") === "true";
  headers.set("X-Low-Data", isLowData ? "true" : "false");

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      if (dashboard.appCheck) {
        try {
          const tokenResult = await getToken(dashboard.appCheck, attempt > 0);
          if (tokenResult?.token) {
            headers.set("X-Firebase-AppCheck", tokenResult.token);
          }
        } catch (authErr) {
          console.warn("AppCheck token fetch failed, proceeding without it", authErr);
        }
      }

      const response = await fetch(url, { ...options, headers });
      if (response.ok) return response;

      // If it's a 401 on the last attempt, trigger logout
      if (response.status === 401 && attempt === maxRetries - 1) {
        dashboard.logout();
      }
      throw new Error(await getApiErrorMessage(response, `HTTP ${response.status}: ${url}`)); // Re-throw to be caught by calling function
    } catch (err) {
      if (attempt === maxRetries - 1) throw err;
      // Exponential backoff with jitter
      const delay = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
      await new Promise((resolve) => setTimeout(resolve, delay));
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
    const json = await response.json();
    const result = schema.safeParse(json);

    if (!result.success) {
      console.error("[Validation Error]", result.error.format());
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
  if (typeof err === "string") return new Error(err);
  try {
    return new Error(JSON.stringify(err));
  } catch {
    return new Error(String(err));
  }
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

    const json = JSON.parse(text);
    const parsed = ApiErrorSchema.safeParse(json);

    if (parsed.success) {
      const data = parsed.data;
      const serverMessage = data.error || data.message || (typeof data.details === 'string' ? data.details : data.details?.message);
      return serverMessage ? `${serverMessage} (${status})` : `${statusFallback} (${status})`;
    }
    return `${statusFallback} (${status})`;
  } catch {
    return `${StatusMessageMap[status] ? t(StatusMessageMap[status]) : fallback} (${status})`;
  }
}

/**
 * Shared UI logic to handle terminal-style typing effect.
 */
interface TextElement extends HTMLElement {
  _timer?: number;
}

export function typeText(element: TextElement, text: string, playSound?: () => void) {
  if (element.getAttribute("data-current") === text) return;
  element.setAttribute("data-current", text);

  // Clear existing element-specific timer to prevent overlapping
  if (element._timer) window.clearInterval(element._timer);
  element.innerText = "";
  element.classList.add("shimmer-text");
  let i = 0;
  element._timer = window.setInterval(() => {
    if (i < text.length) {
      element.innerText += text.charAt(i);
      if (playSound) playSound();
      i++;
    } else {
      window.clearInterval(element._timer);
      element.classList.remove("shimmer-text");
    }
  }, 40); // 40ms per character for a smooth terminal feel
}

// Re-export moved logic from shared types to avoid duplication
export { getColumnKey, getProgress } from "../shared/types";

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

  badge.innerText = `${langStrings.connStrength} ${label}`;
  badge.style.color = color;
  badge.style.display = "inline-flex";
}
