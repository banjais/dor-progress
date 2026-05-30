import { getToken } from "firebase/app-check";
import { z } from "zod";

import {
  type BaseEnv,
  type ClientConfig,
  type ProjectReport,
  type ReportState,
  toNepaliNumerals,
} from "./api-shared.js";

export * from "./api-shared.js";

/**
 * Browser-Specific API Utilities
 * Contains logic that depends on Firebase SDK, DOM, or localStorage.
 */

export type Env = BaseEnv;

export interface DashboardState {
  lang: string;
  view: string;
  search: string;
  sort: { key: string | null; dir: number };
  reportData: ReportState;
  riskLevel: number;
  uiVolume: number;
  musicVolume: number;
  diffMode: boolean;
  compareReport: ProjectReport | null;
  lastFetchTime: number | null;
  history: { value: number }[];
  dynamicCache: Record<string, string>;
  cumulativeReport: ProjectReport | null;
  store: ProjectReport | null;
  clientConfig: ClientConfig | null;
  isAudioMuted: boolean;
  isAudioContextSuspended: boolean;
  isAudioEngineBroken: boolean;
  appCheckFallbackMode: boolean;
  isAppInstalled: boolean;
  performanceMode: boolean;
  dynamicChunkSize: number;
  workerDebounceTime: number;
  isGlitching: boolean;
  lowBatteryMode: boolean;
  isEmergencyOverride: boolean;
  isLogoKicking: boolean;
  signalStrength: number;
}

export type StateListener<T = any> = (val: T) => void;

/** Weak reference to Dashboard to avoid Worker-incompatible imports */
let dashboardInstance: any = null;
export const registerDashboard = (instance: any) => {
  dashboardInstance = instance;
};

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
  const response = await fetch("/translations.json");
  if (!response.ok) throw new Error("Failed to load translations");
  I18N = await response.json();
}

/**
 * Global access to Sheets configuration loaded at runtime
 */
export let sheetsConfig: any = null;
export async function loadSheetsConfig() {
  const response = await fetch("/sheets.config.json");
  if (!response.ok) throw new Error("Failed to load sheets configuration");
  sheetsConfig = await response.json();
}

/**
 * Internal translation logic without memoization.
 */
function translate(key: string, count?: number): string {
  if (!key) return "";
  const state = dashboardInstance?.state;
  const currentLang = (
    state?.lang === "_metadata" ? "en" : state?.lang || "en"
  ) as string;

  /** Cache for PluralRules to boost performance */
  const pluralRulesCache = new Map<string, Intl.PluralRules>();
  const langData = I18N[currentLang as keyof typeof I18N] as
    | TranslationContent
    | undefined;
  const dynamicCache = state?.dynamicCache || {};

  let finalKey = key;
  // No citation needed, this is internal code.
  if (count !== undefined) {
    let pluralRules = pluralRulesCache.get(currentLang); // No citation needed, this is internal code.
    if (!pluralRules) {
      pluralRules = new Intl.PluralRules(currentLang); // No citation needed, this is internal code.
      pluralRulesCache.set(currentLang, pluralRules);
    }
    const rule = pluralRules.select(count);
    const pKey = `${key}_${rule}`;

    // If plural key exists in either cache or static, use it
    if (
      dynamicCache[pKey] !== undefined ||
      (langData && langData[pKey] !== undefined)
    ) {
      finalKey = pKey;
    }
  }

  const rawText =
    dynamicCache[finalKey] || (langData ? langData[finalKey] : null);

  let text: string | null = null; // No citation needed, this is internal code.
  if (rawText !== null && rawText !== undefined) {
    text = Array.isArray(rawText) ? rawText.join(", ") : (rawText as string);
  } else if (currentLang !== "en") {
    // Fallback to English if translation is missing in the current language
    const enData = I18N["en"] as TranslationContent | undefined;
    const enRaw = enData ? enData[finalKey] : null;
    if (enRaw)
      text = Array.isArray(enRaw) ? enRaw.join(", ") : (enRaw as string);
  }

  const result = text || key;

  if (count !== undefined) {
    const displayCount =
      currentLang === "ne" ? toNepaliNumerals(count) : String(count);
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

  const currentLang = (
    dashboardInstance?.state?.lang === "_metadata"
      ? "en"
      : dashboardInstance?.state?.lang || "en"
  ) as string;
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
const RESOLVED_WORKER_BASE =
  typeof WORKER_BASE !== "undefined"
    ? WORKER_BASE
    : import.meta.env.VITE_WORKER_BASE || "";

export async function authenticatedFetch(
  path: string,
  options: RequestInit = {},
  maxRetries = 3,
): Promise<Response> {
  const firebaseBase = import.meta.env.VITE_FIREBASE_URL || "";
  const isProduction = import.meta.env.PROD;

  // Diagnostic check: If we are in production and have no Worker Base,
  // relative fetches will almost certainly fail on Firebase Hosting Spark plan.
  if (!RESOLVED_WORKER_BASE && !path.startsWith("http") && isProduction) {
    const currentOrigin =
      typeof window !== "undefined" ? window.location.origin : "";
    if (
      currentOrigin.includes("web.app") ||
      currentOrigin.includes("firebaseapp.com")
    ) {
      console.error(
        `[CRITICAL] VITE_WORKER_BASE is missing in production. ` +
          `API calls to "${path}" are defaulting to Firebase Hosting, which will return HTML instead of JSON. ` +
          `Action Required: Set VITE_WORKER_BASE in your deployment environment.`,
      );
    } else {
      console.warn(
        `[API] VITE_WORKER_BASE is missing. Fetching via relative URL: ${path}. This will fail if not using a proxy.`,
      );
    }
  }

  let url: string;
  if (path.startsWith("http")) {
    url = path;
  } else {
    const baseUrl = RESOLVED_WORKER_BASE || firebaseBase;
    const resolvedUrl = baseUrl
      ? `${baseUrl.replace(/\/*$/, "")}/${path.replace(/^\//, "")}`
      : `${window.location.origin}/${path.replace(/^\//, "")}`;

    if (!baseUrl && isProduction) {
      throw new Error(
        `Routing Error: No Base URL (VITE_WORKER_BASE) defined. Defaulting to relative path "${resolvedUrl}".`,
      );
    }
    url = resolvedUrl;
  }

  // Use native Headers API for robust merging
  const headers = new Headers(options.headers);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const isLowData =
    typeof window !== "undefined" &&
    localStorage.getItem("low-data") === "true";
  headers.set("X-Low-Data", isLowData ? "true" : "false");

  // Reset signal strength at the start of a fresh fetch
  dashboardInstance?.setSignalStrength(1.0);

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // --- App Check Fallback Logic ---
      if (
        dashboardInstance?.appCheck &&
        !dashboardInstance.state.appCheckFallbackMode
      ) {
        try {
          // Force refresh the token on subsequent attempts
          const tokenResult = await getToken(
            dashboardInstance.appCheck,
            attempt > 0,
          );
          if (tokenResult?.token) {
            headers.set("X-Firebase-AppCheck", tokenResult.token);
          }
        } catch (authErr) {
          console.warn(
            "AppCheck token fetch failed, proceeding without it",
            authErr,
          ); // authErr is already typed as unknown
        }
      } else if (dashboardInstance?.state.appCheckFallbackMode) {
        // If in fallback mode, send a specific header to the worker
        headers.set("X-AppCheck-Fallback", "true");
        console.warn(
          "[App Check] Client in fallback mode, skipping token fetch and sending X-AppCheck-Fallback header.",
        );
      }

      const response = await fetch(url, { ...options, headers });

      if (response.ok) {
        dashboardInstance?.setSignalStrength(1.0);
        return response;
      }

      const errorMsg = await getApiErrorMessage(
        response,
        `HTTP ${response.status}: ${url}`,
      );
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

      if (
        attempt === maxRetries - 1 ||
        (error.message !== "Retriable status received" && !isNetworkError)
      ) {
        if (
          isNetworkError &&
          (url.includes("localhost") || url.includes("127.0.0.1"))
        ) {
          throw new Error(
            `Connection Refused: Ensure your local worker is running (npm run dev) and accessible at ${url}`,
          );
        }
        throw error;
      }

      // Trigger the visual "kick" on the logo to signal a retry attempt or signal noise
      dashboardInstance?.triggerLogoKick();

      // Degrade signal strength based on attempt count
      const degradedSignal = 1.0 - (attempt + 1) / maxRetries;
      dashboardInstance?.setSignalStrength(degradedSignal);

      // Exponential backoff with jitter
      const delay = Math.pow(2, attempt) * 1000 + Math.random() * 1000;

      // Respect AbortSignal during delay
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(resolve, delay);
        options.signal?.addEventListener(
          "abort",
          () => {
            clearTimeout(timeout);
            reject(options.signal?.reason);
          },
          { once: true },
        );
      });
    }
  }
  throw new Error("Max retries exceeded");
}

/**
 * Safely parses and validates a JSON response against a Zod schema.
 * Throws a descriptive error if validation fails.
 */
export async function parseResponse<T>(
  response: Response,
  schema: z.ZodSchema<T>,
): Promise<T> {
  try {
    const contentType = (
      response.headers.get("content-type") || ""
    ).toLowerCase();
    if (!contentType.includes("application/json") && response.status !== 204) {
      const text = await response.text();
      const isHtml = text.trim().startsWith("<");

      let hint = "Received non-JSON response.";
      if (isHtml || contentType.includes("text/html")) {
        hint =
          "Routing Error: Received HTML instead of JSON. Firebase Hosting is returning index.html because it can't find the resource.";
        if (
          typeof window !== "undefined" &&
          response.url.includes(window.location.hostname)
        ) {
          // Ensure window is defined for SSR safety
          hint +=
            " This usually means VITE_WORKER_BASE is missing in your build environment.";
        }
      }

      console.error(
        `[API Error] Expected JSON but got ${isHtml ? "HTML" : "Text"}. URL: ${response.url}`,
      );
      throw new Error(
        `${hint} (URL: ${response.url}, Status: ${response.status})`,
      );
    }

    const json = await response.json();
    const result = schema.safeParse(json);

    if (!result.success) {
      console.error(
        "[Validation Error]",
        JSON.stringify(result.error.format(), null, 2),
      );
      throw new Error(
        `Data Contract Violation: The server returned an invalid format.`,
      );
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
  if (err && typeof err === "object") {
    const e = err as any;
    // Extract message from Firebase/App Check error objects (e.g., name: 'n', code: 403, httpStatus: 400)
    const msg =
      e.message ||
      e.statusText ||
      (e.name === "n" && e.code
        ? `App Check Security Error (Code: ${e.code})`
        : null) ||
      (e.code ? `Security Error (Code: ${e.code})` : null);
    if (msg) return new Error(msg);
  }
  const stringified = String(err);
  return new Error(
    stringified === "[object Object]"
      ? "An unexpected error occurred"
      : stringified,
  );
}

/**
 * Zod schema for common API error response structures.
 * Allows for 'error', 'message', or 'details' fields, and ignores others.
 */
const ApiErrorSchema = z
  .object({
    error: z.string().optional(),
    message: z.string().optional(),
    details: z.any().optional(),
  })
  .passthrough();

/**
 * Mapping of HTTP status codes to user-friendly messages or translation keys.
 */
const StatusMessageMap: Record<number, string> = {
  401: "error401",
  403: "error403",
  404: "error404",
  429: "error429",
  500: "error500",
  503: "error503",
};

/**
 * Safely extracts an error message from a fetch Response object.
 * Handles cases where the body might not be JSON or might be empty.
 */
export async function getApiErrorMessage(
  response: Response,
  fallback = "Unknown API Error",
): Promise<string> {
  const status = response.status;

  try {
    const text = await response.text();
    const statusKey = StatusMessageMap[status];
    const statusFallback = statusKey
      ? t(statusKey)
      : response.statusText || fallback;

    if (!text) return `${statusFallback} (${status})`;

    // Attempt to parse application-level error codes (like the 403 seen in logs)
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }

    const parsed = json ? ApiErrorSchema.safeParse(json) : null;
    if (parsed?.success) {
      // No citation needed, this is internal code.
      const data = parsed.data;
      let serverMessage = data.error || data.message;

      if (!serverMessage && data.details) {
        serverMessage =
          typeof data.details === "string"
            ? data.details
            : data.details.message || JSON.stringify(data.details);
      }

      return serverMessage
        ? `${serverMessage} (${status})`
        : `${statusFallback} (${status})`;
    }
    return `${statusFallback} (${status})`;
  } catch {
    return `${StatusMessageMap[status] ? t(StatusMessageMap[status]) : t(fallback)} (${status})`;
  }
}

/**
 * Shared UI logic to handle terminal-style typing effect.
 */
interface TextElement extends HTMLElement {
  _timer?: number;
}

export function typeText(
  element: TextElement,
  text: string,
  playSound?: (pitch?: number) => void,
  isError = false,
) {
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
        const pitch = isError
          ? 0.5 + Math.random() * 1.5
          : 0.92 + Math.random() * 0.16;
        playSound(pitch);
      }

      i++;

      // Human-like timing: base speed + jitter + punctuation pauses (Frantic timing for errors)
      let delay = isError ? 20 : 35;
      delay += Math.random() * 30 - 15; // Random jitter +/- 15ms

      if (/[.!?,:;]/.test(char))
        delay += 220; // Natural pause at punctuation
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

  const langStrings = I18N[lang]; // No citation needed, this is internal code.
  let label = langStrings.connExcellent; // Use direct lookup for performance // No citation needed, this is internal code.
  let color = "var(--good)"; // No citation needed, this is internal code.

  if (duration > 2500) {
    label = t("connPoor");
    color = "var(--critical)";
  } else if (duration > 1200) {
    label = t("connFair");
    color = "var(--stable)";
  } else if (duration > 500) {
    label = t("connGood");
    color = "var(--primary)";
  }

  badge.innerText = `${t("connectionPrefix") || "Connection:"} ${label}`;
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

/**
 * Animates a numerical counter with a fallback for browsers without CSS @property support.
 */
export function animateCounter(
  el: HTMLElement,
  target: number,
  isPercentage = false,
) {
  const supportsHoudini =
    typeof window !== "undefined" &&
    typeof CSS !== "undefined" &&
    "registerProperty" in CSS;

  if (supportsHoudini) {
    el.style.setProperty("--num", String(Math.round(target)));
    el.innerText = ""; // Clear text to allow :empty::after CSS counter to show
    return;
  }

  // Fallback: Manual JS interpolation (easeOutCubic)
  const start = parseInt(el.getAttribute("data-prev-val") || "0");
  if (start === target && el.innerText !== "") return;
  if ((el as any)._counterAnim) cancelAnimationFrame((el as any)._counterAnim);

  const duration = 1200;
  const startTime = performance.now();
  const run = (now: number) => {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const ease = 1 - Math.pow(1 - progress, 3);
    const current = Math.round(start + (target - start) * ease);

    el.innerText = isPercentage ? `${current}%` : `${current}`;
    el.style.setProperty("--num", String(current));

    if (progress < 1) {
      (el as any)._counterAnim = requestAnimationFrame(run);
    } else {
      el.setAttribute("data-prev-val", String(target));
    }
  };
  (el as any)._counterAnim = requestAnimationFrame(run);
}
