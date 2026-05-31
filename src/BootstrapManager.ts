import { initializeApp } from "firebase/app";
import {
  CustomProvider,
  ReCaptchaV3Provider,
  initializeAppCheck,
} from "firebase/app-check";

import { Dashboard } from "./Dashboard.js";
import {
  ClientConfigSchema,
  type ClientConfig,
  authenticatedFetch,
  loadSheetsConfig,
  loadTranslations,
  parseResponse,
} from "./api-utils.js";

import { BrandingEngine } from "./components/BrandingEngine.js";
import { SplashScreen } from "./components/SplashScreen.js";

/**
 * =========================================================
 * BOOTSTRAP MANAGER v2 (CLEAN ARCHITECTURE)
 * =========================================================
 */
export class BootstrapManager {
  static async init(dashboard: Dashboard) {
    try {
      await this.validateEnvironment(dashboard);

      await this.paintSplashFrame();

      const config = await this.loadInitialResources(dashboard);

      const app = this.initFirebase(config);

      this.initAppCheck(app, config, dashboard);

      SplashScreen.hide();
      SplashScreen.updateStatusText(dashboard.t("ready") || "Ready!", true);
    } catch (err) {
      this.handleFatalError(err, dashboard);
    }
  }

  /**
   * =========================================================
   * ENV VALIDATION
   * =========================================================
   */
  private static async validateEnvironment(dashboard: Dashboard) {
    if (import.meta.env.PROD && !import.meta.env.VITE_WORKER_BASE) {
      dashboard.addToast(
        "error",
        "Missing VITE_WORKER_BASE configuration",
        0,
      );
    }

    const base = import.meta.env.VITE_WORKER_BASE;

    if (!base || base === "/") {
      console.error("[BOOT] Invalid worker base configuration");
    }
  }

  /**
   * =========================================================
   * SPLASH PAINT (ENSURES FIRST FRAME RENDER)
   * =========================================================
   */
  private static async paintSplashFrame() {
    await new Promise((r) =>
      requestAnimationFrame(() => setTimeout(r, 0)),
    );
  }

  /**
   * =========================================================
   * INITIAL RESOURCE LOADING (PARALLEL SAFE)
   * =========================================================
   */
  private static async loadInitialResources(dashboard: Dashboard): Promise<ClientConfig> {
    const results = await Promise.allSettled([
      BrandingEngine.apply(),
      loadTranslations(),
      loadSheetsConfig(),
    ]);

    const failedCritical: string[] = [];

    results.forEach((r, i) => {
      const names = ["Branding", "Translations", "Sheets"];

      if (r.status === "rejected") {
        console.warn(`[BOOT] ${names[i]} failed`, r.reason);

        if (names[i] !== "Branding") {
          failedCritical.push(names[i]);
        }
      }
    });

    if (failedCritical.length > 0) {
      throw new Error(
        `Critical boot failure: ${failedCritical.join(", ")}`,
      );
    }

    SplashScreen.init(dashboard);
    SplashScreen.updateSplashProgress(10);

    SplashScreen.updateStatusText(
      dashboard.t("loadingConfig") || "Loading configuration...",
    );

    const res = await authenticatedFetch("api/client-config");

    SplashScreen.updateSplashProgress(50);

    if (!res.ok) {
      throw new Error(`Config fetch failed (${res.status})`);
    }

    const config = await parseResponse(res, ClientConfigSchema);

    dashboard.state.clientConfig = config;

    return config;
  }

  /**
   * =========================================================
   * FIREBASE INIT
   * =========================================================
   */
  private static initFirebase(config: ClientConfig) {
    const app = initializeApp(config.firebase);

    SplashScreen.updateSplashProgress(70);
    SplashScreen.updateStatusText(
      "Initializing secure services...",
    );

    return app;
  }

  /**
   * =========================================================
   * APP CHECK SYSTEM (CLEAN + SAFE)
   * =========================================================
   */
  private static initAppCheck(
    app: any,
    config: ClientConfig,
    dashboard: Dashboard,
  ) {
    let provider;

    const useRecaptcha = !!config.recaptchaKey;

    if (useRecaptcha) {
      try {
        provider = new ReCaptchaV3Provider(config.recaptchaKey!);
      } catch (e) {
        console.warn("[AppCheck] Falling back to CustomProvider", e);

        dashboard.state.appCheckFallbackMode = true;

        provider = new CustomProvider({
          getToken: async () => ({
            token: "",
            expireTimeMillis: Date.now() + 300000,
          }),
        });
      }
    } else {
      dashboard.state.appCheckFallbackMode = true;

      provider = new CustomProvider({
        getToken: async () => ({
          token: "",
          expireTimeMillis: Date.now() + 300000,
        }),
      });
    }

    dashboard.appCheck = initializeAppCheck(app, {
      provider,
      isTokenAutoRefreshEnabled: true,
    });
  }

  /**
   * =========================================================
   * ERROR HANDLER (CENTRALIZED)
   * =========================================================
   */
  private static handleFatalError(err: unknown, dashboard: Dashboard) {
    SplashScreen.triggerSignalLoss();

    const msg =
      err instanceof Error
        ? err.message
        : typeof err === "string"
          ? err
          : JSON.stringify(err);

    console.error("[BOOT ERROR]", msg);

    SplashScreen.hide();

    dashboard.addToast(
      "error",
      dashboard.t("bootError") || "System failed to initialize",
      0,
    );
  }

  /**
   * =========================================================
   * LOW DATA MODE
   * =========================================================
   */
  private static initLowData() {
    if (localStorage.getItem("low-data") === null) {
      const saveData = (navigator as any)?.connection?.saveData;
      if (saveData) localStorage.setItem("low-data", "true");
    }
  }

  /**
   * =========================================================
   * ACCESSIBILITY SETTINGS
   * =========================================================
   */
  private static initAccessibilitySettings() {
    const settings = [
      "high-contrast",
      "grayscale",
      "sepia",
      "system-font",
    ];

    settings.forEach((s) => {
      document.body.classList.toggle(
        s,
        localStorage.getItem(s) === "true",
      );
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