import { getToken } from "firebase/app-check";
import { Dashboard } from "./Dashboard";
import translationsDataRaw from "./locales/translations.json" with { type: "json" };

interface TranslationContent {
  months: string[]; // Assuming 'months' is always an array of strings
  [key: string]: string | string[]; // Allow other keys to be strings or string arrays
}

export const I18N: Record<string, TranslationContent> =
  translationsDataRaw as Record<string, TranslationContent>;

declare const WORKER_BASE: string;

/**
 * Converts Arabic numerals to Nepali numerals.
 */
export function toNepaliNumerals(num: number | string): string {
  const n = ["०", "१", "२", "३", "४", "५", "६", "७", "८", "९"];
  return String(num).replace(/[0-9]/g, (d) => n[parseInt(d)]);
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
  return String(str || "").replace(/[०-९]/g, (d) => n[d] || d);
}

/**
 * Core Translation Helper
 */
export const t = (key: string, count?: number): string => {
  if (!key) return "";
  const dashboard = Dashboard.getInstance();
  const currentLang = dashboard.state.lang;

  let finalKey = key;

  if (count !== undefined) {
    const rule = new Intl.PluralRules(currentLang).select(count);
    const pKey = `${key}_${rule}`;

    const lookup = [
      dashboard.dynamicCache[pKey], // Check dynamic cache for plural key
      I18N?.[currentLang]?.[pKey], // Check static translations for plural key
      dashboard.dynamicCache[key], // Check dynamic cache for base key
      I18N?.[currentLang]?.[key], // Check static translations for base key
    ];

    finalKey = lookup.find((v) => v !== undefined)
      ? lookup[0] || lookup[1] // If plural key exists in either cache or static, use it
        ? pKey
        : key
      : key;
  }

  let text =
    dashboard.dynamicCache[finalKey] || // Check dynamic cache for finalKey
    I18N?.[currentLang]?.[finalKey] || // Check static translations for finalKey
    null;

  text = text || key;

  if (count !== undefined) {
    const displayCount = (
      currentLang === "ne" ? toNepaliNumerals(count) : count
    ) as string;
    return text.replace("{{count}}", displayCount);
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
  const url = path.startsWith("http")
    ? path
    : `${WORKER_BASE}${path.startsWith("/") ? "" : "/"}${path}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  headers["X-Low-Data"] =
    localStorage.getItem("low-data") === "true" ? "true" : "false";

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      if (dashboard.appCheck) {
        const tokenResult = await getToken(dashboard.appCheck, attempt > 0);
        if (tokenResult?.token) {
          headers["X-Firebase-AppCheck"] = tokenResult.token;
        }
      }

      const response = await fetch(url, { ...options, headers });
      if (response.ok) return response;

      throw new Error(`HTTP ${response.status}`);
    } catch (err) {
      if (attempt === maxRetries - 1) throw err;
      const delay = Math.pow(2, attempt) * 1000;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw new Error("Max retries exceeded");
}
