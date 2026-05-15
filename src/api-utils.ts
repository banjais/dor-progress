import { getToken } from "firebase/app-check";
import { Dashboard } from "./Dashboard.js";
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
  if (currentLang === "_metadata") currentLang = "en";

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
      dashboard.dynamicCache[pKey] !== undefined ||
      (langData && langData[pKey] !== undefined);

    finalKey = hasPlural ? pKey : key;
  }

  const rawText =
    dashboard.dynamicCache[finalKey] ||
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

      throw new Error(`HTTP ${response.status}: ${url}`);
    } catch (err) {
      if (attempt === maxRetries - 1) throw err;
      // Exponential backoff with jitter
      const delay = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw new Error("Max retries exceeded");
}
