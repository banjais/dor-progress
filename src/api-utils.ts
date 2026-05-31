import { getToken, type AppCheck } from "firebase/app-check";
import { z } from "zod";

import {
  type BaseEnv,
  type ClientConfig,
  type DashboardState,
  type ProjectReport,
  type ReportState,
  toNepaliNumerals,
} from "@shared/api-shared";

/**
 * =========================================================
 * RE-EXPORTS (shared contract layer)
 * =========================================================
 */
export {
  type BaseEnv,
  type ClientConfig,
  type DashboardState,
  type ProjectReport,
  type ReportState,
  toNepaliNumerals,
};

export * from "@shared/api-shared";

/**
 * =========================================================
 * DASHBOARD INTERFACE (CORE CONTRACT ONLY)
 * =========================================================
 */
export interface IDashboard {
  state: DashboardState;
  appCheck?: AppCheck;

  setSignalStrength(level: number): void;
  triggerLogoKick(): void;
  logout(): void;
  playUi(sound: string, useVariation?: boolean, pitch?: number): void;
  t(key: string, count?: number): string;
}

/**
 * =========================================================
 * GLOBAL REGISTRY
 * =========================================================
 */
let dashboardInstance: IDashboard | null = null;

export function registerDashboard(instance: IDashboard) {
  dashboardInstance = instance;
}

function getDashboard(): IDashboard | null {
  return dashboardInstance;
}

/**
 * =========================================================
 * I18N CORE
 * =========================================================
 */
interface TranslationContent {
  months?: string[];
  [key: string]: string | string[] | undefined;
}

let I18N: Record<string, TranslationContent> = {};

export function setI18N(data: typeof I18N) {
  I18N = data;
}

let sheetsConfig: any = null;

export async function loadSheetsConfig() {
  const res = await fetch("/sheets.config.json");
  if (!res.ok) throw new Error("Failed to load sheets config");
  sheetsConfig = await res.json();
}

/**
 * =========================================================
 * TRANSLATION ENGINE
 * =========================================================
 */
const pluralCache = new Map<string, Intl.PluralRules>();
const tCache = new Map<string, string>();

function translate(key: string, count?: number): string {
  if (!key) return "";

  const state = getDashboard()?.state;
  const lang =
    state?.lang === "_metadata" ? "en" : state?.lang ?? "en";

  const langData = I18N[lang] ?? I18N["en"];
  const dynamicCache = state?.dynamicCache ?? {};

  let finalKey = key;

  if (count !== undefined) {
    let rule = pluralCache.get(lang);
    if (!rule) {
      rule = new Intl.PluralRules(lang);
      pluralCache.set(lang, rule);
    }

    const pluralKey = `${key}_${rule.select(count)}`;

    if (dynamicCache[pluralKey] || langData?.[pluralKey]) {
      finalKey = pluralKey;
    }
  }

  const raw =
    dynamicCache[finalKey] ??
    langData?.[finalKey] ??
    I18N["en"]?.[finalKey];

  let text =
    raw === undefined
      ? key
      : Array.isArray(raw)
        ? raw.join(", ")
        : String(raw);

  if (count !== undefined) {
    const display =
      lang === "ne" ? toNepaliNumerals(count) : String(count);

    text = text.replace(/{{count}}/g, display);
  }

  return text;
}

export const t = (key: string, count?: number): string => {
  if (!key) return "";

  if (count !== undefined) return translate(key, count);

  const lang =
    getDashboard()?.state?.lang === "_metadata"
      ? "en"
      : getDashboard()?.state?.lang ?? "en";

  const cacheKey = `${lang}:${key}`;

  const cached = tCache.get(cacheKey);
  if (cached) return cached;

  const result = translate(key);
  tCache.set(cacheKey, result);

  return result;
};

export const clearTranslationCache = () => tCache.clear();

/**
 * =========================================================
 * SAFE API FETCH (CORE ONLY)
 * =========================================================
 */
const WORKER_BASE =
  (import.meta.env.VITE_WORKER_BASE as string | undefined) ?? "";

export async function authenticatedFetch(
  path: string,
  options: RequestInit = {},
  maxRetries = 3,
): Promise<Response> {
  const baseUrl =
    WORKER_BASE !== "" ? WORKER_BASE : window.location.origin;

  const url = path.startsWith("http")
    ? path
    : `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;

  const headers = new Headers(options.headers);

  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  headers.set(
    "X-Low-Data",
    localStorage.getItem("low-data") === "true" ? "true" : "false",
  );

  const dash = getDashboard();
  dash?.setSignalStrength(1);

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      if (dash?.appCheck && dash.state.appCheckFallbackMode !== true) {
        try {
          const token = await getToken(dash.appCheck, attempt > 0);
          if (token.token) {
            headers.set("X-Firebase-AppCheck", token.token);
          }
        } catch {
          headers.set("X-AppCheck-Fallback", "true");
        }
      }

      const response = await fetch(url, { ...options, headers });

      if (response.ok) {
        dash?.setSignalStrength(5);
        return response;
      }

      const errorText = await getApiErrorMessage(
        response,
        `HTTP ${response.status}`,
      );

      if (response.status === 401 && attempt === maxRetries - 1) {
        dash?.logout();
      }

      throw new Error(errorText);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt === maxRetries - 1) break;
      dash?.triggerLogoKick();
      await new Promise((r) =>
        setTimeout(r, Math.pow(2, attempt) * 1000),
      );
    }
  }

  throw lastError ?? new Error("Request failed");
}

/**
 * =========================================================
 * RESPONSE VALIDATION
 * =========================================================
 */
export async function parseResponse<T>(
  response: Response,
  schema: z.ZodSchema<T>,
): Promise<T> {
  const json = await response.json();
  const result = schema.safeParse(json);

  if (!result.success) {
    throw new Error("Response validation failed");
  }

  return result.data;
}

/**
 * =========================================================
 * ERROR HANDLING
 * =========================================================
 */
export function toError(err: unknown): Error {
  if (err instanceof Error) return err;
  return new Error(String(err));
}

const ApiErrorSchema = z.object({
  error: z.string().optional(),
  message: z.string().optional(),
});

export async function getApiErrorMessage(
  response: Response,
  fallback = "API Error",
): Promise<string> {
  try {
    const json = await response.json();
    const parsed = ApiErrorSchema.safeParse(json);

    return parsed.success
      ? parsed.data.error ?? parsed.data.message ?? fallback
      : fallback;
  } catch {
    return fallback;
  }
}