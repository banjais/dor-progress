import { AudioEngine } from "./components/AudioEngine";
import { SpeechEngine } from "./components/SpeechEngine";
import { Header } from "./components/Header";
import { BrandingEngine } from "./components/BrandingEngine";
import { initializeApp } from "firebase/app";
import {
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
} from "firebase/app-check";
import { ProjectReport, ProjectRow } from "../shared/types";
import { t, authenticatedFetch, toNepaliNumerals } from "./api-utils";

declare const WORKER_BASE: string;
declare const APP_ENV: string;
declare const APP_CHECK_DEBUG_TOKEN: string | boolean | undefined;
declare const APP_VERSION: string;

// External helper references from main.ts/utils.ts
// eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
declare const render: (json: ProjectReport | null) => void;
declare function applyTranslations(): void;
declare const handleSearch: (term?: string) => void;
declare const typeText: (
  element: HTMLElement,
  text: string,
  useSound?: boolean,
) => void;
declare function triggerDatabaseRestore(): Promise<void>;
declare function handleVerification(): Promise<void>;
declare function checkDeepLink(): void;
declare function getActiveSwVersion(): Promise<string>;
declare function updateConnStrength(duration: number): void;

export class Dashboard {
  static _instance: Dashboard | null = null;
  audio: AudioEngine;
  speech: SpeechEngine;
  header: Header;
  state: {
    lang: string;
    view: string;
    search: string;
    sort: { key: string | null; dir: number };
    // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
    store: ProjectReport | null;
    riskLevel: number;
    uiVolume: number;
    diffMode: boolean;
    // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
    compareReport: ProjectReport | null;
  };
  refreshCounter: number = 60;
  lastFetchTime: number | null = null;
  // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
  syncToast: HTMLDivElement | null = null;
  appCheck?: any;
  latencyHistory: { value: number }[] = [];
  intentTimer: number | null = null;
  dynamicCache: Record<string, string> = {};
  searchTimeout?: number;

  constructor() {
    if (Dashboard._instance) return Dashboard._instance;
    this.audio = new AudioEngine();
    this.speech = new SpeechEngine(this.audio);
    this.header = new Header(this);
    this.state = {
      lang:
        localStorage.getItem("pref-lang") ||
        (navigator.language.startsWith("en") ? "en" : "ne"),
      view: "cards",
      search: "",
      sort: { key: null, dir: 1 },
      store: null,
      riskLevel: 0,
      uiVolume: parseFloat(localStorage.getItem("ui-volume") || "0.5"),
      diffMode: false,
      compareReport: null,
    };
    this.dynamicCache = JSON.parse(
      localStorage.getItem("dynamicTranslations") || "{}",
    );
    this.initTimer();
    this.init();
    Dashboard._instance = this;
  }

  static getInstance(): Dashboard {
    return Dashboard._instance || new Dashboard();
  }

  private initTimer() {
    setInterval(() => {
      this.refreshCounter--;
      if (this.refreshCounter <= 0) {
        this.refreshCounter = 60;
        void this.loadData();
      }
      const timerEl = document.getElementById("refresh-timer");
      if (timerEl) {
        timerEl.innerText = `(${t("refreshing")} ${this.refreshCounter}${t("sec")})`;
      }
    }, 1000);
  }

  private init() {
    this.initTheme();
    this.initLowData();
    void this.setupSecurity();
    this.attachGlobalEvents();
    BrandingEngine.apply();
  }

  private initTheme() {
    const applyTheme = (theme: string) => {
      document.body.setAttribute("data-theme", theme);
      const color = theme === "dark" ? "#0b0f1a" : "#1a5c3a";
      document
        .querySelectorAll('meta[name="theme-color"]')
        .forEach((meta) => ((meta as HTMLMetaElement).content = color));
    };
    const startingTheme =
      localStorage.getItem("theme") ||
      (window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light");
    applyTheme(startingTheme);
  }

  private initLowData() {
    if (localStorage.getItem("low-data") === null) {
      if ((navigator as any).connection?.saveData)
        localStorage.setItem("low-data", "true");
    }
  }

  private async setupSecurity() {
    try {
      const res = await fetch(`${WORKER_BASE}/api/client-config`);
      const config = await res.json();
      const app = initializeApp(config.firebase);

      if (
        location.hostname === "localhost" ||
        location.hostname === "127.0.0.1" ||
        APP_ENV === "test"
      ) {
        (self as any).FIREBASE_APPCHECK_DEBUG_TOKEN =
          APP_CHECK_DEBUG_TOKEN || true;
      }

      this.appCheck = initializeAppCheck(app, {
        provider: new ReCaptchaEnterpriseProvider(
          config.recaptchaKey || config.RECAPTCHA_SITE_KEY,
        ),
        isTokenAutoRefreshEnabled: true,
      });

      this.setLang(this.state.lang);
      void handleVerification();
      await this.loadData();

      const splash = document.getElementById("splash-screen");
      if (splash) {
        splash.style.opacity = "0";
        setTimeout(() => (splash.style.display = "none"), 800);
      }
    } catch (e) {
      console.error("Security Bootstrap Failed", e);
    }
  }

  addToast(
    type: "success" | "info" | "error",
    message: string,
    duration = 4000,
  ): HTMLDivElement {
    this.audio.playUi("pop");
    const container = document.getElementById("toast-container");
    const dismissAllBtn = document.getElementById("dismiss-all");
    if (!container || !dismissAllBtn) return document.createElement("div");

    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    const isSyncing = duration === -1;
    const isPersistent = duration === 0 || isSyncing;

    const icons: Record<string, string> = {
      success: "✅",
      info: "ℹ️",
      error: "❌",
    };
    toast.innerHTML = `
            <span>${icons[type] || ""}</span>
            <span>${message}</span>
            ${
              isSyncing
                ? `
                <div class="toast-progress">
                    <div class="toast-bar" style="width: 100%; animation: toast-progress-loop 2s infinite ease-in-out;"></div>
                </div>`
                : isPersistent
                  ? ""
                  : `
                <div class="toast-progress">
                    <div class="toast-bar" style="animation-duration:${duration}ms"></div>
                </div>`
            }
        `;

    const bar = toast.querySelector(".toast-bar") as HTMLElement;
    const dismiss = () => {
      if (toast.dataset.dismissing) return;
      toast.dataset.dismissing = "true";
      toast.style.animation = "toast-in 0.3s ease-in reverse forwards";
      setTimeout(() => {
        toast.remove();
        const remaining = container.querySelectorAll(".toast");
        if (remaining.length === 0 && dismissAllBtn) {
          dismissAllBtn.style.display = "none";
        }
        if (toast === this.syncToast) this.syncToast = null;
      }, 300);
    };

    let autoDismissId: number | null = isPersistent
      ? null
      : window.setTimeout(dismiss, duration);
    toast.onmouseenter = () => {
      if (autoDismissId) window.clearTimeout(autoDismissId);
    };
    toast.onmouseleave = () => {
      if (toast.getAttribute("data-dismissing") || isPersistent) return;
      if (bar) bar.style.animation = "none";
      void toast.offsetWidth;
      if (bar)
        bar.style.animation = `toast-progress-shrink ${duration}ms linear forwards`;
      autoDismissId = window.setTimeout(dismiss, duration);
    };
    toast.onclick = () => {
      if (autoDismissId) window.clearTimeout(autoDismissId);
      dismiss();
    };
    container.prepend(toast);
    if (container.querySelectorAll(".toast").length > 1 && dismissAllBtn) {
      dismissAllBtn.style.display = "block";
    }
    return toast;
  }

  async loadData(isForced = false) {
    const fetchStart = performance.now();
    const syncIcon = document.getElementById("data-sync-icon");
    if (syncIcon) {
      syncIcon.style.display = "inline-block";
      syncIcon.classList.add("spinning");
    }

    this.state.store = null;
    const skeleton = Array(10)
      .fill(
        `<tr class="skeleton-row"><td><div></div></td>${Array(5).fill("<td><div></div></td>").join("")}</tr>`,
      )
      .join("");
    const tbody = document.getElementById("tbody");
    if (tbody) tbody.innerHTML = skeleton;

    const cardSkeleton = Array(6)
      .fill(
        `<div class="skeleton-card">
                    <div style="height: 24px; width: 70%; margin-bottom: 20px;"></div>
                    <div style="height: 12px; width: 100%; margin-bottom: 15px;"></div>
                    <div style="height: 40px; width: 100%; margin-bottom: 20px;"></div>
                    <div style="height: 10px; width: 90%; margin-bottom: 10px;"></div>
                    <div style="height: 10px; width: 50%;"></div>
                </div>`,
      )
      .join("");
    const cardsContainer = document.getElementById("view-cards");
    if (cardsContainer) cardsContainer.innerHTML = cardSkeleton;

    const briefContainer = document.getElementById("ai-brief-text");
    if (briefContainer) {
      briefContainer.innerHTML = `
                <div class="skeleton-brief-line" style="width: 100%;"></div>
                <div class="skeleton-brief-line" style="width: 90%;"></div>
                <div class="skeleton-brief-line" style="width: 95%;"></div>
            `;
      const briefCard = document.getElementById("ai-brief-card");
      if (briefCard) briefCard.style.display = "block";
    }

    try {
      const endpoint = `/api/report?lang=${this.state.lang}${isForced ? "&force=true" : ""}`;
      const res = await authenticatedFetch(
        endpoint,
        isForced ? { cache: "no-store" } : {},
      );
      const json = (await res.json()) as ProjectReport;
      if (json?.headers) {
        const fetchEnd = performance.now();
        const duration = Math.round(fetchEnd - fetchStart);
        this.lastFetchTime = Date.now();
        this.latencyHistory.push({ value: duration });
        if (this.latencyHistory.length > 5) this.latencyHistory.shift();
        if (res.headers.get("X-Force-Throttled") === "true")
          this.addToast("info", this.t("forceThrottled"));

        this.state.store = json;
        if (json.lastUpdate) {
          void this.header.checkUpdates(json.lastUpdate);
        }
        this.render();
        const offlineOverlay = document.getElementById("offline-overlay");
        if (offlineOverlay) offlineOverlay.style.display = "none";
        if (isForced) this.addToast("success", this.t("cacheCleared"));
        updateConnStrength(duration);
      }
    } catch (e) {
      console.error("Error loading data:", e);
      this.addToast("error", this.t("offline"));
      // Explicitly show the offline overlay if data fails to load
      const offlineOverlay = document.getElementById("offline-overlay");
      if (offlineOverlay) offlineOverlay.style.display = "flex";
    } finally {
      if (syncIcon) {
        syncIcon.classList.remove("spinning");
        syncIcon.style.display = "none";
      }
      const loader = document.getElementById("loader");
      if (loader) loader.style.display = "none";
    }
  }

  render() {
    render(this.state.store);
  }

  setLang(l: string) {
    const prevLang = this.state.lang;
    this.state.lang = l;
    localStorage.setItem("pref-lang", l);
    applyTranslations();
    if (prevLang !== l) {
      void this.loadData();
    } else if (this.state.store) {
      this.render();
    }
  }

  setView(v: string) {
    this.state.view = v;
    ["table", "cards", "charts"].forEach((mode) => {
      const btn = document.getElementById("btn-" + mode);
      if (btn) btn.classList.toggle("active", v === mode);
    });
    if (this.state.store) this.render();
  }

  toggleFabMenu() {
    const menu = document.getElementById("fab-menu");
    const geminiMenu = document.getElementById("gemini-menu");
    const btn = document.getElementById("fab-main-btn");
    if (geminiMenu) geminiMenu.classList.remove("show");
    if (menu) {
      menu.classList.toggle("show");
      if (btn) btn.classList.toggle("active", menu.classList.contains("show"));
    }
    this.audio.playUi("pop");
  }

  toggleGeminiMenu() {
    const menu = document.getElementById("gemini-menu");
    const fabMenu = document.getElementById("fab-menu");
    if (fabMenu) fabMenu.classList.remove("show");
    if (menu) menu.classList.toggle("show");
    this.audio.playUi("pop");
  }

  toggleLang() {
    const next = this.state.lang === "en" ? "ne" : "en";
    this.setLang(next);
    this.audio.playUi("click");
  }

  handleSearch(term?: string) {
    handleSearch(term);
  }

  typeText(element: HTMLElement, text: string, useSound = false) {
    typeText(element, text, useSound);
  }

  triggerDatabaseRestore() {
    return triggerDatabaseRestore();
  }

  private attachGlobalEvents() {
    document.addEventListener("click", (e) => {
      // Global menu closing logic
    });
  }

  t(key: string, count?: number): string {
    return t(key, count);
  }
}
