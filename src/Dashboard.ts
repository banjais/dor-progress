import { AudioEngine } from "./components/AudioEngine";
import { ProjectReport, ProjectReportSchema } from "../shared/types";
import { SpeechEngine } from "./components/SpeechEngine";
import { ThemeManager } from "./ThemeManager";
import { LoadingIndicatorManager } from "./LoadingIndicatorManager";
import { ToastManager } from "./ToastManager";
import { TimerManager } from "./TimerManager";
import { TelemetryManager } from "./TelemetryManager";
import { AppCheck } from "firebase/app-check";
import { t, authenticatedFetch, typeText, parseResponse } from "./api-utils";

export interface DashboardState {
  lang: string;
  view: string;
  search: string;
  sort: { key: string | null; dir: number };
  store: ProjectReport | null;
  riskLevel: number;
  uiVolume: number;
  diffMode: boolean;
  compareReport: ProjectReport | null;
  lastFetchTime: number | null;
  history: { value: number }[];
  dynamicCache: Record<string, string>;
}

export type StateListener<T = any> = (val: T) => void;

export class Dashboard {
  private static _instance: Dashboard | null = null;
  private audio!: AudioEngine;
  private speech!: SpeechEngine;
  private theme!: ThemeManager;
  private loading!: LoadingIndicatorManager;
  private toast!: ToastManager;
  private timer!: TimerManager;
  private telemetry!: TelemetryManager;
  state!: DashboardState;
  private _appCheck?: AppCheck;
  private subscriptions: Set<{
    selector: (state: DashboardState) => any;
    listener: StateListener;
    lastValue: any;
    isEqual: (a: any, b: any) => boolean;
  }> = new Set();
  private isScheduled = false;
  private proxyCache = new WeakMap<object, any>();

  // Event Callbacks to decouple state from UI implementation in main.ts
  onSearch?: (term?: string) => void;
  onUpdateCheck?: () => Promise<void>;
  onDatabaseRestore?: () => Promise<void>;
  onVerify?: () => Promise<void>;
  onApplyTranslations?: () => void;

  constructor() {
    if (Dashboard._instance) return Dashboard._instance;
    Dashboard._instance = this;

    this.audio = new AudioEngine();
    this.speech = new SpeechEngine(this.audio, this);
    this.theme = new ThemeManager(this);
    this.loading = new LoadingIndicatorManager();
    this.toast = new ToastManager(this.audio, this);
    const initialState = {
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
      lastFetchTime: null,
      history: [],
      dynamicCache: JSON.parse(localStorage.getItem("dynamicTranslations") || "{}"),
    };
    this.state = this.makeReactive(initialState);
    this.timer = new TimerManager(this);
    this.telemetry = new TelemetryManager(this);
    this.init();
  }

  static getInstance(): Dashboard {
    return Dashboard._instance || new Dashboard();
  }

  // Accessors for non-reactive service instances
  get appCheck() { return this._appCheck; }
  set appCheck(val: AppCheck | undefined) { this._appCheck = val; }

  private init() {
    this.attachGlobalEvents();
  }

  /**
   * Performs a shallow equality check.
   * Optimized for comparing arrays and objects returned by selectors.
   */
  private shallowEqual(a: any, b: any): boolean {
    if (a === b) return true;
    if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) return false;
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    for (const key of keysA) {
      if (a[key] !== b[key]) return false;
    }
    return true;
  }

  addToast = (type: "success" | "info" | "error", message: string, duration = 4000) => this.toast.addToast(type, message, duration);

  // Facade methods for encapsulated managers
  playUi(sound: string) { this.audio.playUi(sound); }
  toggleSpeech(container: HTMLElement) { this.speech.toggle(container); }

  applyTheme(theme: string, persist = true) { return this.theme.applyTheme(theme, persist); }
  revertTheme() { return this.theme.revertTheme(); }
  resetThemeToSystem() { this.theme.resetThemeToSystem(); }
  toggleTheme() { this.theme.toggleTheme(); }

  showLoading() { this.loading.showLoading(); }
  hideLoading(success: boolean) { this.loading.hideLoading(success); }
  setSyncing(isSyncing: boolean) { this.loading.setSyncing(isSyncing); }

  pauseTimer() { this.timer.pause(); }
  resumeTimer() { this.timer.resume(); }
  recordFetch(duration: number) { this.telemetry.recordFetch(duration); }

  /**
   * Wraps the state object in a Proxy to automatically trigger renders on change.
   */
  private makeReactive<T extends object>(obj: T): T {
    const cached = this.proxyCache.get(obj);
    if (cached) return cached;

    const proxy = new Proxy(obj, {
      set: (target, prop, value) => {
        if ((target as any)[prop] === value) return true;
        (target as any)[prop] = value;
        this.render(); // Automatically schedule a render
        return true;
      },
      get: (target, prop) => {
        const value = (target as any)[prop];
        // Recursively proxy nested objects (like sort or history)
        return (value && typeof value === 'object' && !(value instanceof Date)) ? this.makeReactive(value) : value;
      }
    });

    this.proxyCache.set(obj, proxy);
    return proxy;
  }

  async loadData(isForced = false) {
    const fetchStart = performance.now();
    this.showLoading();

    if (isForced) {
      this.state.store = null;
    }

    try {
      const endpoint = `/api/report?lang=${this.state.lang}${isForced ? "&force=true" : ""}`;
      const res = await authenticatedFetch(
        endpoint,
        isForced ? { cache: "no-store" } : {},
      );
      const json = (await parseResponse(res, ProjectReportSchema)) as ProjectReport;

      if (json.headers) {
        const fetchEnd = performance.now();
        const duration = Math.round(fetchEnd - fetchStart);

        this.recordFetch(duration);

        // Update risk level based on critical projects count
        this.state.riskLevel = json.rows.filter(r => r._status === "critical").length / (json.rows.length || 1);

        if (res.headers.get("X-Force-Throttled") === "true")
          this.addToast("info", this.t("forceThrottled"));

        this.state.store = json;
        if (json.lastUpdate) {
          void this.onUpdateCheck?.();
        }
        if (isForced) this.addToast("success", this.t("cacheCleared"));
      }
    } catch (err) {
      console.error("Error loading data:", err);
      this.addToast("error", this.t("offline"));
      this.hideLoading(false);
    } finally {
      this.setSyncing(false);
    }
  }

  setUiVolume(volume: number) {
    this.state.uiVolume = volume;
    this.audio.setUiVolume(volume);
  }

  /**
   * Subscribes to state changes. 
   * Use the selector to prevent unnecessary re-renders.
   */
  subscribe<T>(
    listener: StateListener<T>,
    selector: (state: DashboardState) => T,
    isEqual: (a: T, b: T) => boolean = this.shallowEqual
  ): () => void {
    const lastValue = selector(this.state);
    const sub = { selector, listener, lastValue, isEqual };
    this.subscriptions.add(sub);
    listener(lastValue);
    return () => this.subscriptions.delete(sub);
  }

  /**
   * Schedules a notification for all subscribers.
   * Uses microtask batching to prevent multiple renders in the same execution cycle.
   */
  private render() {
    if (this.isScheduled) return;
    this.isScheduled = true;
    Promise.resolve().then(() => {
      this.subscriptions.forEach((sub) => {
        const newValue = sub.selector(this.state);
        if (!sub.isEqual(newValue, sub.lastValue)) {
          sub.lastValue = newValue;
          sub.listener(newValue);
        }
      });
      this.isScheduled = false;
    });
  }

  setLang(l: string) {
    const prevLang = this.state.lang;
    this.state.lang = l;
    localStorage.setItem("pref-lang", l);
    this.onApplyTranslations?.();
    if (prevLang !== l) {
      void this.loadData();
    }
  }

  setView(v: string) {
    this.state.view = v;
    ["table", "cards", "charts"].forEach((mode) => {
      const btn = document.getElementById("btn-" + mode);
      if (btn) btn.classList.toggle("active", v === mode);
    });
  }

  async toggleDiffMode(date: string | null) {
    // If null or same date is provided while already in diff mode, turn it off
    if (!date || (this.state.diffMode && this.state.compareReport?.lastUpdate === date)) {
      this.state.diffMode = false;
      this.state.compareReport = null;
      this.addToast("info", this.t("diffModeOff") || "Comparison cleared");
    } else {
      this.loading.showLoading();
      try {
        const res = await authenticatedFetch(
          `/api/report?date=${date}&lang=${this.state.lang}`
        );
        const json = (await parseResponse(res, ProjectReportSchema)) as ProjectReport;

        this.state.compareReport = json;
        this.state.diffMode = true;
        this.audio.playUi("ping"); // Play sound on diff mode activation
        this.addToast("success", `${this.t("compare") || "Comparing with"} ${date}`);
      } catch (err) {
        console.error("Failed to load comparison report:", err);
        this.addToast("error", "Failed to load comparison report");
        this.state.diffMode = false;
      } finally {
        this.loading.hideLoading(true);
      }
    }
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
    this.onSearch?.(term);
  }

  typeText(element: HTMLElement, text: string, useSound = false) {
    typeText(element, text, useSound ? () => this.audio.playUi("type") : undefined);
  }

  /**
   * Clears the snapshot session and notifies the user.
   */
  logout() {
    sessionStorage.removeItem("_snapshot_key");
    this.addToast(
      "info",
      this.state.lang === "en" ? "Snapshot session cleared" : "स्न्यापसट सेसन मेटाइयो",
    );
    if (window.App?.showSettings) void window.App.showSettings();
  }

  /**
   * Centralized Audio Fetcher for AI Briefing.
   */
  async fetchAiBriefBlob() {
    const text =
      (document.getElementById("ai-brief-text") as HTMLElement)?.innerText || "";
    if (!text) return null;
    const isPremium = localStorage.getItem("premium-tts") === "true";
    const res = await authenticatedFetch(
      `/api/tts?lang=${this.state.lang}&quality=${isPremium ? "premium" : "standard"}&text=${encodeURIComponent(text)}`,
    );
    if (!res.ok) throw new Error();
    return await res.blob();
  }

  private attachGlobalEvents() {
    document.addEventListener("click", (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest("#fab-main-btn") && !target.closest("#fab-menu")) {
        document.getElementById("fab-menu")?.classList.remove("show");
      }
      if (!target.closest("#gemini-menu-btn") && !target.closest("#gemini-menu")) {
        document.getElementById("gemini-menu")?.classList.remove("show");
      }
    });
  }

  t(key: string, count?: number): string {
    return t(key, count);
  }

  /**
   * Returns a human-readable string representing the time elapsed since the last data fetch.
   */
  getRelativeTimeString(): string {
    const lastFetch = this.state.lastFetchTime;
    if (!lastFetch) return this.t("never");

    const diff = Date.now() - lastFetch;
    const seconds = Math.floor(diff / 1000);

    if (seconds < 60) return this.t("justNow");
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return this.t("minutesAgo", minutes);
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return this.t("hoursAgo", hours);
    const days = Math.floor(hours / 24);
    return this.t("daysAgo", days);
  }
}
