import { initializeApp } from "firebase/app";
import {
  CustomProvider,
  ReCaptchaEnterpriseProvider,
  initializeAppCheck,
} from "firebase/app-check";

import { Dashboard } from "./Dashboard.js";
import {
  type ClientConfig,
  ClientConfigSchema,
  authenticatedFetch,
  loadSheetsConfig,
  loadTranslations,
  parseResponse,
} from "./api-utils.js";
import { BrandingEngine } from "./components/BrandingEngine.js";
import { SplashScreen } from "./components/SplashScreen.js";

export class BootstrapManager {
  static async init(dashboard: Dashboard) {
    // Force a browser paint of the splash screen before starting heavy initialization
    // This ensures Chrome users see the branding even if the CPU is pegged during boot.
    await new Promise((resolve) =>
      requestAnimationFrame(() => setTimeout(resolve, 0)),
    );

    // --- App Check Debug Mode Setup ---
    // This MUST be set before initializeApp or initializeAppCheck is called.
    // Debug mode is activated if we are in development OR a specific URL parameter is provided (non-prod only).
    const appEnv = (import.meta as any).env.VITE_APP_ENV;
    const isProduction =
      appEnv === "production" || (import.meta as any).env.PROD;

    const viteDebugToken = (import.meta as any).env.VITE_APP_CHECK_DEBUG_TOKEN;
    const storedDebugToken = localStorage.getItem("debug_app_check");
    const urlParams = new URLSearchParams(window.location.search);
    const urlDebugToken = !isProduction ? urlParams.get("appCheckDebug") : null;

    if (
      urlDebugToken ||
      (!isProduction &&
        appEnv === "development" &&
        (viteDebugToken || storedDebugToken))
    ) {
      // Prioritize URL token, then VITE_APP_CHECK_DEBUG_TOKEN, then stored, otherwise generate new (by setting to true)
      (self as any).FIREBASE_APPCHECK_DEBUG_TOKEN =
        urlDebugToken && urlDebugToken !== "true"
          ? urlDebugToken
          : urlDebugToken === "true"
            ? true
            : viteDebugToken && viteDebugToken !== "false"
              ? viteDebugToken
              : storedDebugToken && storedDebugToken !== "false"
                ? storedDebugToken
                : true;
      console.warn(
        "[App Check] Debug mode active. Token:",
        (self as any).FIREBASE_APPCHECK_DEBUG_TOKEN,
      );
    }

    // Apply UI branding immediately so the app looks correct during load
    // Use Vite's injected environment variables for the client application.
    // Resolve the worker base URL – ensure it's a full URL and not just '/'
    const safeWorkerBase =
      typeof WORKER_BASE !== "undefined"
        ? WORKER_BASE
        : (import.meta as any).env.VITE_WORKER_BASE || "";

    if (!safeWorkerBase || safeWorkerBase === "/") {
      console.error(
        "[CRITICAL] VITE_WORKER_BASE is missing or invalid. API requests will default to the hosting origin and return HTML. Set VITE_WORKER_BASE to your Cloudflare Worker URL in the build environment.",
      );
      // Optionally, you could throw to halt boot, but we continue to allow UI to show error toasts.
    }

    // Diagnostic log to verify build-time injection
    if (!safeWorkerBase || safeWorkerBase === "/") {
      console.error(
        "%c[System] VITE_WORKER_BASE is MISSING!",
        "color: white; background: red; padding: 4px; font-weight: bold;",
      );
    } else {
      console.info(
        `%c[System] Routing API to: ${safeWorkerBase}`,
        "color: #0099da; font-weight: bold;",
      );
    }

    try {
      // Apply UI branding inside try-catch to prevent initialization blocks
      // Run non-dependent initialization tasks in parallel to speed up boot time
      const results = await Promise.allSettled([
        BrandingEngine.apply(),
        loadTranslations(),
        loadSheetsConfig(),
      ]);

      let criticalInitFailure = false;
      results.forEach((result, index) => {
        if (result.status === "rejected") {
          const tasks = ["Branding", "Translations", "Sheets Config"];
          console.warn(`${tasks[index]} failed to load`, result.reason);
          // If translations or sheets config fail, it's a critical error for the app to function.
          if (
            tasks[index] === "Translations" ||
            tasks[index] === "Sheets Config"
          ) {
            criticalInitFailure = true;
          }
        }
      });
      if (criticalInitFailure) {
        throw new Error(
          "Critical initialization tasks failed (Translations or Sheets Config).",
        );
      }

      this.initLowData();
      this.initAccessibilitySettings();

      SplashScreen.init(dashboard);
      // Provide a localized time-of-day greeting as the system wakes up
      SplashScreen.updateStatusText(dashboard.t(SplashScreen.getGreetingKey()));
      await new Promise((r) => setTimeout(r, 1200)); // Pause briefly to allow the greeting to be read

      SplashScreen.updateSplashProgress(10);
      SplashScreen.updateStatusText(
        dashboard.t("loadingConfig") || "Loading configuration...",
      );

      const configPath = "api/client-config";

      // 1. Fetch Configuration & Init System Shell
      const res = await authenticatedFetch(configPath);

      // Diagnostic log: check the response URL to see if it was redirected or handled by Hosting
      console.info(`[System] Config fetched from: ${res.url}`);

      if (
        res.url.includes(window.location.hostname) &&
        (import.meta as any).env.PROD
      ) {
        console.warn(
          "[Diagnostic] API request resolved to the Hosting domain. " +
            "This usually indicates VITE_WORKER_BASE was not injected during the build process.",
        );
      }

      SplashScreen.updateSplashProgress(50);
      SplashScreen.updateStatusText(
        dashboard.t("configLoaded") || "Configuration loaded.",
      );

      if (!res.ok) {
        throw new Error(
          `${dashboard.t("serverError") || "Server unavailable"} (${res.status})`,
        );
      }
      if (res.headers.get("content-type")?.includes("text/html")) {
        throw new Error(
          "Initialization Error: Expected JSON configuration but received HTML. This usually means the API route was not found on your Hosting domain.",
        );
      }

      // 2. Validate Configuration with Zod
      const config: ClientConfig = await parseResponse(res, ClientConfigSchema);
      dashboard.state.clientConfig = config;

      // 3. Initialize Firebase
      const app = initializeApp(config.firebase);
      SplashScreen.updateSplashProgress(70);
      SplashScreen.updateStatusText(
        dashboard.t("firebaseInit") || "Initializing Firebase...",
      );

      // --- App Check Initialization with Fallback ---
      let appCheckProvider;
      const forceBypass = !isProduction && urlParams.has("appCheckBypass");

      if (config.recaptchaKey && !forceBypass) {
        try {
          appCheckProvider = new ReCaptchaEnterpriseProvider(
            config.recaptchaKey,
          );
          console.info(
            "[App Check] ReCAPTCHA Enterprise provider initialized.",
          );
        } catch (e) {
          console.error(
            "[App Check] Failed to initialize ReCAPTCHA Enterprise provider, falling back to CustomProvider:",
            e,
          );
          dashboard.addToast(
            "error",
            dashboard.t("recaptchaFailed") ||
              "Security verification failed. Functionality may be limited.",
            0,
          );
          dashboard.state.appCheckFallbackMode = true; // Set fallback flag
          appCheckProvider = new CustomProvider({
            getToken: async () => {
              // Fix: Return empty string for token
              console.warn(
                "[App Check] Using CustomProvider fallback: returning empty token.",
              );
              return { token: "", expireTimeMillis: Date.now() + 300000 }; // 5 minutes validity for dummy
            },
          });
        }
      } else {
        const reason = forceBypass
          ? "Manual bypass requested via URL"
          : "No reCAPTCHA key provided";

        console.warn(`[App Check] ${reason}, falling back to CustomProvider.`);
        dashboard.addToast(
          "error",
          dashboard.t("recaptchaMissingKey") ||
            "Security verification key missing. Functionality may be limited.",
          0,
        );
        dashboard.state.appCheckFallbackMode = true; // Set fallback flag
        appCheckProvider = new CustomProvider({
          getToken: async () => {
            // Fix: Return empty string for token
            console.warn(
              "[App Check] Using CustomProvider fallback (no key): returning empty token.",
            );
            return { token: "", expireTimeMillis: Date.now() + 300000 };
          },
        });
      }

      // Indicate that the app is ready to enter
      // After setting ready, hide the splash screen for a smooth transition
      SplashScreen.hide();
      // Update status text indicating readiness
      SplashScreen.updateStatusText(dashboard.t("ready") || "Ready!", true);

      dashboard.appCheck = initializeAppCheck(app, {
        provider: appCheckProvider,
        isTokenAutoRefreshEnabled: true,
      });
      // --- End App Check Initialization with Fallback ---
    } catch (e) {
      SplashScreen.triggerSignalLoss();

      console.error("Critical Bootstrap Failure:", e); // Keep original error logging

      let msg = "";
      if (e instanceof Error) {
        // Improved error extraction
        msg = e.message; // Use the message property of the Error object
      } else if (typeof e === "object" && e !== null) {
        const errObj = e as any;
        msg = errObj.message || errObj.code || JSON.stringify(e);
      } else {
        msg = String(e);
      }

      // Enhance error message for common configuration issues
      if (
        msg.includes("Expected JSON configuration but received HTML") ||
        msg.includes("not found (404)")
      ) {
        msg +=
          " (Network Error: VITE_WORKER_BASE is likely misconfigured or the Cloudflare Worker is not responding. Please check your .env files and Worker deployment status.)";
        console.error(
          "ACTION REQUIRED: Check VITE_WORKER_BASE configuration and Cloudflare Worker deployment.",
        );
      } else if (
        msg.includes("exchangeDebugToken") ||
        (msg.includes("403") &&
          (import.meta as any).env.VITE_APP_ENV === "development")
      ) {
        msg +=
          " (App Check 403: Debug token unregistered. Find the 'App Check debug token' in the console logs above and add it to Firebase Console -> App Check -> Apps -> Manage Debug Tokens.)";
        console.error(
          "DEBUG: App Check Debug Token mismatch. You must register the generated token in your Firebase project settings.",
        );
      } else if (msg.includes("400") && msg.includes("App Check")) {
        msg +=
          " (App Check 400: Bad Request. This typically indicates an invalid reCAPTCHA Site Key or that the reCAPTCHA Enterprise API is not enabled in your Google Cloud Project.)";
        console.error(
          "DEBUG: reCAPTCHA Configuration Error. Verify your Site Key in the Firebase Console and ensure reCAPTCHA Enterprise is enabled in Google Cloud.",
        );
      } else if (msg.includes("403") || msg.includes("App Check")) {
        msg +=
          " (App Check/Security verification failed. Check ReCAPTCHA configuration and authorized domains in Firebase Console.)";
        console.error(
          "DEBUG: Firebase App Check 403. Verify ReCAPTCHA Enterprise keys and domain whitelisting.",
        );
      } else if (
        msg.includes("Connection Refused") ||
        msg.includes("Failed to fetch")
      ) {
        msg += " (Local API connection failed. Is your local worker running?)";
        console.error(
          "DEBUG: Failed to connect to local API. Ensure wrangler is active on port 8787.",
        );
      }

      setTimeout(() => SplashScreen.hide(), 500); // Ensure splash is hidden so user can see the error toast

      let bootErrorLabel = "System failed to initialize";
      try {
        // Safely attempt translation, fallback to English
        bootErrorLabel = dashboard.t("bootError") || bootErrorLabel;
      } catch {
        /* ignored */
      }

      dashboard.addToast(
        "error",
        `${bootErrorLabel}: ${msg.split(" (Status:")[0]}`,
        0,
      );
    } finally {
      // BrandingEngine usually touches DOM, safe to call at end of bootstrap.
      // Note: Dashboard.ts context showed BrandingEngine.apply() was called in Dashboard.init
    }
  }

  private static initLowData() {
    if (localStorage.getItem("low-data") === null) {
      if ((navigator as any).connection?.saveData) {
        localStorage.setItem("low-data", "true");
      }
    }
  }

  private static initAccessibilitySettings() {
    const settings = ["high-contrast", "grayscale", "sepia", "system-font"];
    settings.forEach((s) => {
      const enabled = localStorage.getItem(s) === "true";
      document.body.classList.toggle(s, enabled);
    });
    const fontSize = localStorage.getItem("font-size");
    if (fontSize) {
      document.documentElement.style.setProperty(
        "--base-font-size",
        `${fontSize}px`,
      );
    }
  }
}
