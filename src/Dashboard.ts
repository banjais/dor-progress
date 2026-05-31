import { AppCheck } from "firebase/app-check";
import { interpret } from "xstate";

// Fix: reportMachine is in src/
import { LoadingIndicatorManager } from "./LoadingIndicatorManager.js";
import { TelemetryManager } from "./TelemetryManager.js";
// Import interpret
import { ThemeManager } from "./ThemeManager.js";
import { TimerManager } from "./TimerManager.js";
import { ToastManager } from "./ToastManager.js";
import {
  type DashboardState,
  type ProjectReport,
  ProjectReportSchema,
  type ReportState,
  type StateListener,
  authenticatedFetch,
  clearTranslationCache,
  isReportSuccess,
  parseResponse,
  registerDashboard,
  t,
  toNepaliNumerals,
  typeText,
} from "./api-utils.js";
import { AudioEngine } from "./components/AudioEngine.js";
import { reportMachine } from "./reportMachine.js";

export class Dashboard {
  private static _instance: Dashboard | null = null;
  public audio!: AudioEngine;
  private reportService!: any;
  private theme!: ThemeManager;
  private loading!: LoadingIndicatorManager;
  private toast!: ToastManager;
  private timer!: TimerManager;
  private telemetry!: TelemetryManager;
  state!: DashboardState;
  // Automatic Performance Monitoring
  private fpsFrameCount = 0;
  private fpsStartTime = 0;
  private fpsMonitorActive = false;
  private glitchTimer?: number;

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
    registerDashboard(this);

    // Move initialization inside the constructor body to ensure it only runs once
    this.reportService = interpret(reportMachine).onTransition((xstate) => {
      this.state.reportData = {
        type: xstate.value as ReportState["type"],
        report: xstate.context.report,
        message: xstate.context.error,
      } as ReportState;
    });

    this.audio = new AudioEngine();
    this.theme = new ThemeManager(this);
    this.loading = new LoadingIndicatorManager();
    const initialUiVolume = parseFloat(
      localStorage.getItem("ui-volume") || "0.5",
    );
    const initialMusicVolume = parseFloat(
      localStorage.getItem("music-volume") || "0.4",
    );
    this.toast = new ToastManager(this.audio, this);

    const urlParams = new URLSearchParams(window.location.search);
    const urlLang = urlParams.get("lang");
    if (urlLang) localStorage.setItem("pref-lang", urlLang);

    const savedSortKey = localStorage.getItem("pref-sort-key");
    const rawSortDir = parseInt(localStorage.getItem("pref-sort-dir") || "1");
    const savedSortDir = isNaN(rawSortDir) ? 1 : rawSortDir;
    const savedView = localStorage.getItem("pref-view") || "cards";

    const initialState = {
      lang:
        urlLang ||
        localStorage.getItem("pref-lang") ||
        (navigator.language.startsWith("en") ? "en" : "ne"),
      view: savedView,
      search: "",
      sort: { key: savedSortKey, dir: savedSortDir },
      reportData: { type: "idle" } as ReportState,
      riskLevel: 0,
      uiVolume: initialUiVolume,
      musicVolume: initialMusicVolume,
      diffMode: false,
      compareReport: null,
      lastFetchTime: null,
      history: [],
      dynamicCache: JSON.parse(
        localStorage.getItem("dynamicTranslations") || "{}",
      ),
      cumulativeReport: null, // Initialize cumulative report state
      store: null, // Initialize store
      clientConfig: null,
      isAudioMuted: initialUiVolume === 0, // Initialize based on stored volume
      isAudioContextSuspended: true, // AudioContext starts suspended by default
      isAudioEngineBroken: false, // Assume not broken initially
      appCheckFallbackMode: false, // Initialize fallback mode to false
      isAppInstalled: false, // Updated by PWAManager
      performanceMode: localStorage.getItem("performance-mode") === "true",
      dynamicChunkSize: 50,
      workerDebounceTime: 50, // Default debounce time for worker messages
      isGlitching: false,
      lowBatteryMode: false,
      isEmergencyOverride: false,
      isLogoKicking: false,
      signalStrength: 1.0,
    };
    this.state = this.makeReactive(initialState);
    this.reportService.start(); // Start the XState service
    this.timer = new TimerManager(this);
    this.telemetry = new TelemetryManager(this);
    this.init();
  }

  static getInstance(): Dashboard {
    return Dashboard._instance || new Dashboard();
  }

  // Accessors for non-reactive service instances
  get appCheck() {
    return this._appCheck;
  }
  set appCheck(val: AppCheck | undefined) {
    this._appCheck = val;
  }

  private init() {
    this.attachGlobalEvents();
  }

  /**
   * Performs a shallow equality check.
   * Optimized for comparing arrays and objects returned by selectors.
   */
  private shallowEqual(a: any, b: any): boolean {
    if (a === b) return true;
    if (
      typeof a !== "object" ||
      a === null ||
      typeof b !== "object" ||
      b === null
    )
      return false;
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    for (const key of keysA) {
      if (a[key] !== b[key]) return false;
    }
    return true;
  }

  addToast = (
    type: "success" | "info" | "error",
    message: string,
    duration = 4000,
  ) => this.toast.addToast(type, message, duration);

  // Facade methods for encapsulated managers
  /**
   * Plays a UI sound effect.
   * @param useVariation If true, applies random pitch shifting (useful for typing effects).
   */
  playUi(sound: string, useVariation = false, pitch?: number) {
    void this.audio
      .playUi(sound, useVariation, pitch)
      .catch((e) => console.error("[Audio] Error playing UI sound:", e));
  }

  /**
   * Starts monitoring the frame rate and triggers Performance Mode if it drops below 30 FPS.
   */
  startFpsMonitor() {
    if (this.fpsMonitorActive || this.state.performanceMode) return;
    this.fpsMonitorActive = true;
    this.fpsStartTime = performance.now();
    this.fpsFrameCount = 0;

    const monitor = (now: number) => {
      if (!this.fpsMonitorActive) return;

      // Avoid false triggers when the tab is throttled in the background
      if (document.hidden) {
        this.fpsStartTime = now;
        this.fpsFrameCount = 0;
        requestAnimationFrame(monitor);
        return;
      }

      this.fpsFrameCount++;
      const elapsed = now - this.fpsStartTime;

      if (elapsed >= 3000) {
        // Sample over a 3-second window for stability
        const fps = (this.fpsFrameCount * 1000) / elapsed;

        // Dynamically adjust incremental rendering chunk size based on real-world FPS
        // Higher FPS allows for bigger chunks (faster load), Lower FPS needs smaller chunks (smoother UI)
        if (fps > 55) {
          this.state.dynamicChunkSize = Math.min(
            100,
            this.state.dynamicChunkSize + 10,
          );
          this.state.workerDebounceTime = Math.max(
            20,
            this.state.workerDebounceTime - 10,
          ); // Faster worker updates
        } else if (fps < 45) {
          this.state.dynamicChunkSize = Math.max(
            10,
            this.state.dynamicChunkSize - 10,
          );
          this.state.workerDebounceTime = Math.min(
            100,
            this.state.workerDebounceTime + 10,
          ); // Slower worker updates
        }
        console.debug(
          `[System] FPS: ${fps.toFixed(1)}, dynamicChunkSize: ${this.state.dynamicChunkSize}, workerDebounceTime: ${this.state.workerDebounceTime}`,
        );

        // Performance Mode Trigger (First line of defense) - Respect override
        if (
          fps < 30 &&
          !this.state.performanceMode &&
          !this.state.isEmergencyOverride
        ) {
          console.warn(
            `[System] Auto-Performance: FPS dropped to ${fps.toFixed(1)}. Reducing fidelity.`,
          );
          this.setPerformanceMode(true);
          this.addToast(
            "info",
            this.t("autoPerformanceMode") ||
              "Performance mode enabled automatically to ensure UI responsiveness.",
          );
        }

        // Low Battery Warning Trigger (Critical threshold) - Respect override
        if (
          fps < 20 &&
          !this.state.lowBatteryMode &&
          !this.state.isEmergencyOverride
        ) {
          this.state.lowBatteryMode = true;
          this.playUi("pop", true, 0.5); // Low-pitched warning thud
          this.addToast(
            "error",
            this.t("lowPerformanceWarning") ||
              "System instability detected. Closing background processes.",
          );
        }

        // Recovery Logic: If performance stabilizes significantly, clear the warning
        if (fps > 45 && this.state.lowBatteryMode) {
          this.state.lowBatteryMode = false;
        }

        this.fpsStartTime = now;
        this.fpsFrameCount = 0;
      }
      requestAnimationFrame(monitor);
    };
    requestAnimationFrame(monitor);
  }

  /**
   * Suppresses low battery mode constraints and warnings for the current session.
   */
  setEmergencyOverride(enabled: boolean) {
    this.state.isEmergencyOverride = enabled;
    if (enabled) this.state.lowBatteryMode = false;
  }

  /**
   * Triggers a brief chromatic aberration kick on the logo.
   * Used specifically to indicate API retries or network "noise".
   */
  triggerLogoKick() {
    if (this.state.performanceMode) return;
    this.state.isLogoKicking = true;
    window.setTimeout(() => {
      this.state.isLogoKicking = false;
    }, 150);
  }

  /**
   * Updates the visual signal strength indicator.
   */
  setSignalStrength(level: number) {
    this.state.signalStrength = Math.max(0, Math.min(1, level));
  }

  /**
   * Toggles performance mode to reduce CPU/GPU load.
   */
  setPerformanceMode(enabled: boolean) {
    this.state.performanceMode = enabled;
    localStorage.setItem("performance-mode", String(enabled));
    document.body.classList.toggle("performance-mode", enabled);

    if (enabled) {
      this.audio.stopVisualizer();
      this.fpsMonitorActive = false; // Stop monitoring if performance mode is active
    } else {
      this.addToast(
        "info",
        this.t("performanceModeDisabled") || "High-fidelity visuals enabled.",
      );
      this.startFpsMonitor(); // Resume monitoring if the user manually re-enables visuals
    }
  }

  muffleMusicForSearch(muffle: boolean) {
    this.audio.setMusicMuffle(muffle);
  }

  /**
   * Triggers a brief screen corruption effect (spiked static/shake).
   */
  triggerGlitch() {
    if (this.glitchTimer) window.clearTimeout(this.glitchTimer);
    this.state.isGlitching = true;
    this.playUi("pop", true, 0.4); // Heavy, low-pitched "crunch" sound
    this.glitchTimer = window.setTimeout(() => {
      this.state.isGlitching = false;
      this.glitchTimer = undefined;
    }, 400);
  }

  /**
   * Resumes the AudioContext to satisfy browser autoplay policies.
   * This must be called from a user gesture (click, mousedown, etc.).
   */
  async resumeAudioContext() {
    try {
      await this.audio.resume();
      // After attempting to resume, update the reactive state based on the AudioEngine's current status
      this.state.isAudioContextSuspended = this.audio.isContextSuspended;
      this.state.isAudioEngineBroken = this.audio.isBroken;

      // If successfully resumed, re-trigger the current view to start background music
      if (
        !this.state.isAudioContextSuspended &&
        !this.state.isAudioEngineBroken
      ) {
        this.setView(this.state.view);
      }
    } catch (e) {
      console.warn("[Audio] Context resumption failed:", e);
      this.state.isAudioEngineBroken = true; // Mark as broken if resume fails critically
    }
  }

  /**
   * Generates a context-aware URL including report date and current language.
   */
  getContextUrl(): string {
    const lang = this.state.lang;
    const reportDate = isReportSuccess(this.state.reportData)
      ? this.state.reportData.report.lastUpdate
      : null;

    return reportDate
      ? `${window.location.origin}?date=${reportDate}&lang=${lang}`
      : window.location.origin;
  }

  /**
   * Generates a localized audit footer containing the source, report date, and capture timestamp.
   */
  getAuditFooter(url: string): string {
    const lang = this.state.lang;
    const reportDate = isReportSuccess(this.state.reportData)
      ? this.state.reportData.report.lastUpdate
      : null;

    const dispDate =
      lang === "ne" && reportDate ? toNepaliNumerals(reportDate) : reportDate;
    const dateLine = reportDate ? `\n${this.t("reportDate")}: ${dispDate}` : "";

    const now = new Date();
    const timestamp = now.toLocaleString(lang === "ne" ? "ne-NP" : "en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const auditLabel =
      this.t("copiedOn") ||
      (lang === "ne" ? "प्रतिलिपि गरिएको समय:" : "Copied on:");
    const auditLine = `\n${auditLabel}: ${lang === "ne" ? toNepaliNumerals(timestamp) : timestamp}`;

    return `\n\n${this.t("source")} ${url}${dateLine}${auditLine}`;
  }

  /**
   * Invokes the native sharing dialog for the application.
   */
  async shareApp() {
    const url = this.getContextUrl();
    const shareData = {
      title: this.t("appName"),
      text: this.t("shareAppText"),
      url: url,
    };

    if (navigator.share && navigator.canShare?.(shareData)) {
      try {
        await navigator.share(shareData);
      } catch (e) {
        if ((e as Error).name !== "AbortError")
          console.error("Sharing failed:", e);
      }
    } else {
      // Fallback: Copy contextual link to clipboard, using a specific translation key
      await navigator.clipboard.writeText(url);
      this.addToast("success", this.t("appLinkCopied"));
    }
  }

  applyTheme(theme: string, persist = true) {
    return this.theme.applyTheme(theme, persist);
  }
  revertTheme() {
    return this.theme.revertTheme();
  }
  resetThemeToSystem() {
    this.theme.resetThemeToSystem();
  }
  toggleTheme() {
    this.theme.toggleTheme();
  }

  showLoading() {
    this.loading.showLoading();
  }
  hideLoading(success: boolean) {
    this.loading.hideLoading(success);
  }
  setSyncing(isSyncing: boolean) {
    this.loading.setSyncing(isSyncing);
  }

  pauseTimer() {
    this.timer.pause();
  }
  resumeTimer() {
    this.timer.resume();
  }
  recordFetch(duration: number) {
    this.telemetry.recordFetch(duration);
  }

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
        return value && typeof value === "object" && !(value instanceof Date)
          ? this.makeReactive(value)
          : value;
      },
    });

    this.proxyCache.set(obj, proxy);
    return proxy;
  }

  async loadData(isForced = false) {
    // Capture critical count before state is reset to detect new issues
    const prevCriticalCount =
      this.state.store?.rows.filter((r) => r._status === "critical").length ||
      0;
    const fetchStart = performance.now();
    this.showLoading();

    // Reset states to trigger skeleton screens in the UI
    this.state.store = null; // Still manage store directly if it's just a data holder
    this.reportService.send("FETCH"); // Send 'FETCH' event to the state machine
    this.state.search = "";

    try {
      const endpoint = `/api/report?lang=${this.state.lang}${isForced ? "&force=true" : ""}`;
      console.debug(`[Dashboard] Loading data from ${endpoint}`);
      const res = await authenticatedFetch(
        endpoint,
        isForced ? { cache: "no-store" } : {},
      );
      const json = (await parseResponse(
        res,
        ProjectReportSchema,
      )) as ProjectReport;

      if (json.headers) {
        const fetchEnd = performance.now();
        const duration = Math.round(fetchEnd - fetchStart);

        this.recordFetch(duration);

        // Update risk level based on critical projects count
        const criticalCount = json.rows.filter(
          (r) => r._status === "critical",
        ).length;
        this.state.riskLevel = criticalCount / (json.rows.length || 1);
        this.updateHum(this.state.riskLevel);
        this.updateMusicFilter(this.state.riskLevel);

        // Trigger glitch if new critical projects are detected compared to last load
        if (criticalCount > prevCriticalCount && prevCriticalCount > 0) {
          this.triggerGlitch();
        }

        if (res.headers.get("X-Force-Throttled") === "true")
          this.addToast("info", this.t("forceThrottled"));

        this.reportService.send("RESOLVE", { report: json }); // Send 'RESOLVE' event with the fetched report
        this.state.store = json;
        if (json.lastUpdate) {
          void this.onUpdateCheck?.();
        }
        if (isForced) this.addToast("success", this.t("cacheCleared"));
      }
    } catch (err) {
      console.error("Error loading data:", err);
      const errorMsg = err instanceof Error ? err.message : this.t("offline");
      this.reportService.send("REJECT", { message: errorMsg }); // Send 'REJECT' event with the error message
      this.addToast("error", errorMsg, 6000);
      this.hideLoading(false);
    } finally {
      this.setSyncing(false);
    }
  }

  setUiVolume(volume: number) {
    this.state.uiVolume = volume;
    this.state.isAudioMuted = volume === 0; // Update reactive state
    this.audio.setUiVolume(volume);
  }

  setMusicVolume(volume: number) {
    this.state.musicVolume = volume;
    localStorage.setItem("music-volume", this.state.musicVolume.toString());
    void this.audio.setMusicVolume(volume);
  }

  updateHum(_risk: number): void {
    // Assuming AudioEngine has an updateHum method
    // If not, this method should be removed or implemented here
    // this.audio.updateHum(risk);
  }

  updateMusicFilter(risk: number): void {
    this.audio.updateMusicFilter(risk);
  }

  /**
   * Subscribes to state changes.
   * Use the selector to prevent unnecessary re-renders.
   */
  subscribe<T>(
    listener: StateListener<T>,
    selector: (state: DashboardState) => T,
    isEqual: (a: T, b: T) => boolean = this.shallowEqual,
  ): () => void {
    const lastValue = selector(this.state);
    const sub = { selector, listener, lastValue, isEqual };
    this.subscriptions.add(sub as any);
    listener(lastValue);
    return () => this.subscriptions.delete(sub as any);
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
    clearTranslationCache();
    this.onApplyTranslations?.();

    // Only trigger a fresh load if the language actually changed
    // and data isn't already being loaded by the BootstrapManager.
    if (prevLang !== l && this.state.reportData.type === "success") {
      if (
        this.state.view === "history" &&
        isReportSuccess(this.state.reportData)
      ) {
        (window as any).App.loadSnapshot(
          this.state.reportData.report.lastUpdate,
        );
      } else if (
        this.state.view === "cumulative" &&
        isReportSuccess(this.state.reportData)
      ) {
        (window as any).App.renderDropdowns();
        (window as any).App.loadCumulative("monthly");
      } else {
        void this.loadData();
      }
    }
  }

  setView(v: string) {
    this.state.view = v;

    // Persist only primary visualization modes as user preferences
    if (["table", "cards", "charts"].includes(v)) {
      localStorage.setItem("pref-view", v);
    }

    ["table", "cards", "charts", "cumulative", "history"].forEach((mode) => {
      const btn = document.getElementById("btn-" + mode);
      if (btn) btn.classList.toggle("active", v === mode);
    });

    // Music transitions are disabled as per user request.
    // If music is ever re-enabled, uncomment the following block and define trackMap.
    // const trackMap: Record<string, string> = {
    //   table: "/audio/data_processing.mp3",
    //   cards: "/audio/ambient_track.mp3",
    //   charts: "/audio/analytics_pulse.mp3",
    //   cumulative: "/audio/executive_summary.mp3",
    // };
    // if (trackMap[v]) this.startMusic(trackMap[v]);
  }

  async toggleDiffMode(date: string | null) {
    // If null or same date is provided while already in diff mode, turn it off
    if (
      !date ||
      (this.state.diffMode && this.state.compareReport?.lastUpdate === date)
    ) {
      this.state.diffMode = false;
      this.state.compareReport = null;
      this.addToast("info", this.t("comparisonCleared"));
    } else {
      this.loading.showLoading();
      try {
        const res = await authenticatedFetch(
          `/api/report?date=${date}&lang=${this.state.lang}`,
        );
        const json = (await parseResponse(
          res,
          ProjectReportSchema,
        )) as ProjectReport;

        this.state.compareReport = json;
        this.state.diffMode = true;
        this.audio.playUi("ping"); // Play sound on diff mode activation

        // Update soundscape for the comparison state
        const compareRisk =
          json.rows.filter((r) => r._status === "critical").length /
          (json.rows.length || 1);
        this.updateHum(compareRisk); // Restore call
        this.updateMusicFilter(compareRisk); // Restore call
        this.addToast("success", `${this.t("comparingWith")} ${date}`);
      } catch (err) {
        console.error("Failed to load comparison report:", err);
        this.addToast("error", this.t("failedToLoadComparisonReport"));
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

  /**
   * Triggers a high-performance typing effect on a DOM element.
   * Uses 'any' for the element to support internal property injection (_timer)
   * defined in api-utils.
   */
  typeText(element: any, text: string, useSound = false, isError = false) {
    typeText(
      element,
      text,
      useSound ? (p?: number) => this.playUi("type", true, p) : undefined,
      isError,
    );
  }

  /**
   * Clears the snapshot session and notifies the user.
   */
  logout() {
    sessionStorage.removeItem("_snapshot_key");
    this.addToast("info", this.t("snapshotSessionCleared"));
    if ((window as any).App?.showSettings)
      void (window as any).App.showSettings();
  }

  /**
   * Centralized Audio Fetcher for AI Briefing.
   */
  async fetchAiBriefBlob(): Promise<Blob | null> {
    try {
      const res = await authenticatedFetch(
        `/api/brief/audio?lang=${this.state.lang}`,
      );
      if (!res.ok) return null;
      return await res.blob();
    } catch (err) {
      console.warn("Could not fetch AI audio brief:", err);
      return null;
    }
  }

  private attachGlobalEvents() {
    document.addEventListener("click", (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest("#fab-main-btn") && !target.closest("#fab-menu")) {
        document.getElementById("fab-menu")?.classList.remove("show");
      }
      if (
        !target.closest("#gemini-menu-btn") &&
        !target.closest("#gemini-menu")
      ) {
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
    // We can now derive the last update directly from the success state if we wanted to
    const lastFetch =
      this.state.reportData.type === "success"
        ? this.state.lastFetchTime
        : null;
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
