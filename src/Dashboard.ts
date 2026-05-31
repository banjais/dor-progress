import { interpret, type Interpreter } from "xstate";
import {
  type IDashboard,
  type DashboardState,
  ProjectReportSchema,
  type ReportState,
  authenticatedFetch,
  parseResponse,
  registerDashboard,
  t,
} from "./api-utils.js";

import { AudioEngine } from "./components/AudioEngine.js";
import { ThemeManager } from "./ThemeManager.js";
import { TimerManager } from "./TimerManager.js";
import { ToastManager } from "./ToastManager.js";
import { TelemetryManager } from "./TelemetryManager.js";
import { LoadingIndicatorManager } from "./LoadingIndicatorManager.js";

import {
  type ReportContext,
  type ReportEvent,
  reportMachine,
} from "./reportMachine.js";

export class Dashboard implements IDashboard {
  static _instance: Dashboard | null = null;

  state!: DashboardState;
  appCheck?: any;

  audio = new AudioEngine();
  theme = new ThemeManager(this);
  timer = new TimerManager(this);
  toast = new ToastManager(this.audio, this);
  telemetry = new TelemetryManager(this);
  loading = new LoadingIndicatorManager();

  private reportService: Interpreter<ReportContext, any, ReportEvent>;

  constructor() {
    if (Dashboard._instance) return Dashboard._instance;
    Dashboard._instance = this;

    registerDashboard(this);

    this.state = this.makeInitialState();
    this.reportService = interpret(reportMachine);

    this.reportService.onTransition((state) => {
      this.state.reportData = {
        type: state.value as ReportState["type"],
        report: state.context.report,
        message: state.context.error,
      } as ReportState;
    });

    this.reportService.start();
    this.attachGlobalEvents();
  }

  static getInstance() {
    return this._instance || new Dashboard();
  }

  /* =========================
     INITIAL STATE
  ========================= */
  private makeInitialState(): DashboardState {
    return {
      lang: "en",
      view: "cards",
      search: "",
      sort: { key: null, dir: 1 },
      reportData: { type: "idle" } as ReportState,
      riskLevel: 0,
      uiVolume: 0.5,
      musicVolume: 0.4,
      diffMode: false,
      compareReport: null,
      lastFetchTime: null,
      history: [],
      dynamicCache: {},
      cumulativeReport: null,
      store: null,
      clientConfig: null,
      isAudioMuted: false,
      isAudioContextSuspended: true,
      isAudioEngineBroken: false,
      appCheckFallbackMode: false,
      isOnline: navigator.onLine,
      performanceMode: false,
      dynamicChunkSize: 50,
      workerDebounceTime: 50,
      isGlitching: false,
      lowBatteryMode: false,
      isEmergencyOverride: false,
      signalStrength: 1,
    };
  }

  /* =========================
     DATA LOADING
  ========================= */
  async loadData(force = false) {
    this.loading.showLoading();

    try {
      const res = await authenticatedFetch(
        `/api/report?lang=${this.state.lang}${force ? "&force=true" : ""}`
      );

      const data = await parseResponse(res, ProjectReportSchema);

      this.state.store = data;

      this.reportService.send("RESOLVE", { report: data });

      this.toast.addToast("success", "Data loaded", 3000);
    } catch (err) {
      this.toast.addToast("error", String(err), 5000);
      this.reportService.send("REJECT", { message: String(err) });
    } finally {
      this.loading.hideLoading(true);
    }
  }

  /* =========================
     TRANSLATION
  ========================= */
  t(key: string, count?: number): string {
    return t(key, count);
  }

  /* =========================
     EVENTS
  ========================= */
  private attachGlobalEvents() {
    window.addEventListener("online", () => {
      this.state.isOnline = true;
      this.loadData();
    });

    window.addEventListener("offline", () => {
      this.state.isOnline = false;
    });
  }

  /* =========================
     REQUIRED INTERFACE METHODS
  ========================= */
  setSignalStrength(level: number) {
    this.state.signalStrength = level;
  }

  triggerLogoKick() {
    this.state.isGlitching = true;
    setTimeout(() => (this.state.isGlitching = false), 150);
  }

  logout() {
    sessionStorage.clear();
  }

  playUi() {}

  /* =========================
     STATE HELPERS
  ========================= */
  private shallowEqual(a: any, b: any) {
    return JSON.stringify(a) === JSON.stringify(b);
  }
}