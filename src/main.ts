// src/main.ts
// Global fix for EventEmitter max listeners
import { initApp } from "./App.js";
import { BootstrapManager } from "./BootstrapManager.js";
import { Dashboard } from "./Dashboard.js";
import { HistoryManager } from "./HistoryManager.js";
import {
  checkForUpdate,
  downloadChangelogAsPdf,
  initPWALogic,
  installUpdate,
} from "./PWAManager.js";
import { SearchManager } from "./SearchManager.js";
import { getProgress, t } from "./api-utils.js";
import "./eventEmitterFix";
import { render } from "./render.js";
import "./styles.css";
import { renderMiniChart, renderSparkline } from "./utils.js";

// Core instance
const dashboard = Dashboard.getInstance();

// Feature managers
const searchManager = new SearchManager(dashboard);
const historyManager = new HistoryManager(dashboard);

// Lazy loading helpers for heavy features
let briefManagerInstance: InstanceType<
  typeof import("./BriefManager.js").BriefManager
> | null = null;
const getBrief = async () => {
  if (!briefManagerInstance) {
    const { BriefManager } = await import("./BriefManager.js");
    briefManagerInstance = new BriefManager(dashboard);
  }
  return briefManagerInstance;
};

// Defer AuraManager (Mind-reading effect) until after bootstrap
import("./AuraManager.js").then(
  ({ AuraManager }) => new AuraManager(dashboard),
);

// Initialize App
const App = initApp(dashboard, historyManager) as any;

// Initialize PWA (Service Worker + Install Prompt)
initPWALogic();

// Subscribe to state changes
dashboard.subscribe(render, (state) => state);

// Attach event handlers
dashboard.onSearch = (term) => searchManager.handleSearch(term);
dashboard.onUpdateCheck = async () => {
  try {
    await checkForUpdate();
  } catch (e) {
    console.error("[App] Update check failed:", e);
  }
};
dashboard.onDatabaseRestore = () =>
  import("./AdminManager.js")
    .then((m) => m.triggerDatabaseRestore())
    .catch((e) => {
      console.error(e);
      dashboard.addToast("error", t("moduleLoadError") || "Connection error");
    });
dashboard.onVerify = () => historyManager.handleVerification(); // Use instance, not class
dashboard.onApplyTranslations = () => App.applyTranslations();

// Extend App with methods
Object.assign(App, {
  // Voice & Search
  toggleFabMenu: () => dashboard.toggleFabMenu(),
  setLang: (l: string) => dashboard.setLang(l),
  setView: (v: string) => dashboard.setView(v),
  shareApp: () => dashboard.shareApp(),
  startVoiceSearch: () => searchManager.startVoiceSearch(),
  clearSearch: () => searchManager.clearSearch(),
  handleSearch: (term?: string) => searchManager.handleSearch(term),

  // AI Briefs
  printAiBrief: async () => (await getBrief()).printAiBrief(),
  copyAiBrief: async () => (await getBrief()).copyAiBrief(),
  shareAiBrief: async () => (await getBrief()).share(),
  shareAiBriefLink: async () => (await getBrief()).shareLink(),
  shareAiBriefEmail: async () => (await getBrief()).shareEmail(),
  downloadBriefAsPdf: async () => (await getBrief()).downloadBriefAsPdf(),
  downloadChangelogAsPdf: () => downloadChangelogAsPdf(),
  checkStatus: () => dashboard.loadData(),
  translateAiBrief: async () => (await getBrief()).translate(),
  downloadAiBriefAudio: async () => (await getBrief()).downloadAudio(),
  shareAiBriefAudio: async () => (await getBrief()).shareAudio(),
  toggleReadAloud: async () => (await getBrief()).toggleReadAloud(),

  // History & Cumulative
  toggleHistory: () => historyManager.toggleHistory(),
  toggleHistoryTab: (tab: string) => historyManager.toggleHistoryTab(tab),
  selectCurrentWeek: () => historyManager.selectCurrentWeek(),
  loadSnapshot: (date: string) => historyManager.loadSnapshot(date),
  loadCumulative: (type: string) => historyManager.loadCumulative(type),
  downloadConsolidatedPdf: () => historyManager.downloadConsolidatedPdf(),
  downloadPdf: (date: string) => historyManager.downloadPdf(date),
  handleVerification: () => historyManager.handleVerification(),
  renderDropdowns: () => historyManager.renderDropdowns(),

  // Snapshots & Diagnostics
  requestSnapshotKey: () =>
    import("./AdminManager.js")
      .then((m) => m.requestSnapshotKey())
      .catch((e) => {
        console.error(e);
        dashboard.addToast("error", t("moduleLoadError") || "Connection error");
      }),
  createSnapshotManual: (e?: Event) =>
    import("./AdminManager.js")
      .then((m) => m.createSnapshotManual(e))
      .catch((e) => {
        console.error(e);
        dashboard.addToast("error", t("moduleLoadError") || "Connection error");
      }),
  listSnapshots: (force?: boolean) =>
    import("./AdminManager.js")
      .then((m) => m.listSnapshots(force))
      .catch((e) => {
        console.error(e);
        dashboard.addToast("error", t("moduleLoadError") || "Connection error");
      }),
  downloadSnapshot: (date: string) =>
    import("./AdminManager.js")
      .then((m) => m.downloadSnapshot(date))
      .catch((e) => {
        console.error(e);
        dashboard.addToast("error", t("moduleLoadError") || "Connection error");
      }),
  deleteSnapshot: (date: string) =>
    import("./AdminManager.js")
      .then((m) => m.deleteSnapshot(date))
      .catch((e) => {
        console.error(e);
        dashboard.addToast("error", t("moduleLoadError") || "Connection error");
      }),
  logoutSnapshotSession: () =>
    import("./AdminManager.js")
      .then((m) => m.logoutSnapshotSession())
      .catch((e) => {
        console.error(e);
        dashboard.addToast("error", t("moduleLoadError") || "Connection error");
      }),
  exportHealthReport: () =>
    import("./DiagnosticManager.js")
      .then((m) => m.showDiagnostics())
      .catch((e) => {
        console.error(e);
        dashboard.addToast("error", t("moduleLoadError") || "Connection error");
      }),

  // UI
  shareSnapshot: async (date: string) => {
    const url = `${window.location.origin}?date=${date}&lang=${dashboard.state.lang}`;
    const shareData = { title: `${t("appName")} - ${date}`, url };
    if (navigator.share && navigator.canShare?.(shareData)) {
      // No citation needed, this is internal code.
      try {
        // No citation needed, this is internal code.
        await navigator.share(shareData);
      } catch (e) {
        if ((e as Error).name !== "AbortError") console.error(e);
      }
    } else {
      await navigator.clipboard.writeText(url);
      dashboard.addToast("success", t("linkCopied") || "Link copied");
    }
  },
  quickPrintSnapshot: (date: string) => historyManager.downloadPdf(date),

  sortData: (key: string) => {
    dashboard.state.sort.dir =
      dashboard.state.sort.key === key ? -dashboard.state.sort.dir : 1;
    dashboard.state.sort.key = key;
    localStorage.setItem("pref-sort-key", key);
    localStorage.setItem("pref-sort-dir", dashboard.state.sort.dir.toString());
  },
  toggleDiffMode: (date: string | null) => dashboard.toggleDiffMode(date),

  // Navigation & Deep Linking
  showInChartView: (name: string) => {
    dashboard.setView("charts");
    searchManager.handleSearch(name);
  },
  showInCardView: (name: string) => {
    dashboard.setView("cards");
    searchManager.handleSearch(name);
  },
  copyDeepLink: (name: string) => {
    const url = `${window.location.origin}?search=${encodeURIComponent(name)}`;
    navigator.clipboard.writeText(url).then(() => {
      dashboard.addToast("success", t("linkCopied") || "Link copied");
    });
  },
  checkDeepLink: () => {
    const params = new URLSearchParams(window.location.search);
    const search = params.get("search");
    if (search) searchManager.handleSearch(search);
  },

  // Theming
  setTheme: (theme: string, persist?: boolean) =>
    dashboard.applyTheme(theme, persist),
  revertTheme: () => dashboard.revertTheme(),
  resetThemeToSystem: () => dashboard.resetThemeToSystem(),
  toggleTheme: () => dashboard.toggleTheme(),
  syncAppTheme: () =>
    dashboard.applyTheme(localStorage.getItem("theme") || "light"),
  applyTranslations: () => render(dashboard.state),

  showModal: (name: string) =>
    import("./DiagnosticManager.js").then((m) => m.showModal(name)),
  closeModal: () =>
    import("./DiagnosticManager.js").then((m) => m.closeModal()),
  checkForUpdates: () => dashboard.loadData(true),
  checkForPWAUpdate: checkForUpdate, // Use shorthand property name
  showSettings: () => import("./AdminManager.js").then((m) => m.showSettings()),
  setMusicVolume: (vol: number) => dashboard.setMusicVolume(vol),
  // setMusicTrack: (track: string) => dashboard.startMusic(track),
  getRelativeTimeString: () => dashboard.getRelativeTimeString(),
  installUpdate, // Use shorthand property name

  triggerDatabaseBackup: () =>
    import("./AdminManager.js").then((m) => m.triggerDatabaseBackup()),
  triggerDatabaseRestore: () =>
    import("./AdminManager.js").then((m) => m.triggerDatabaseRestore()),
  downloadAllOfflineData: () =>
    import("./AdminManager.js").then((m) => m.downloadAllOfflineData()),
  clearDataCache: () =>
    import("./AdminManager.js").then((m) => m.clearDataCache()),

  // Audio & Sound
  setSoundPack: (pack: string) => {
    localStorage.setItem("sound-pack", pack);
    dashboard.addToast("info", t("settingsUpdated"));
  },
  updateVolume: (vol: number) => dashboard.setUiVolume(vol),
  toggleMute: () => {
    const isMuted = dashboard.state.uiVolume === 0;
    dashboard.setUiVolume(isMuted ? 0.5 : 0);
  },
  resetAudioToDefault: () => {
    dashboard.setUiVolume(0.5);
    dashboard.setMusicVolume(0.4);
    localStorage.removeItem("ui-pitch");
    dashboard.addToast("info", t("settingsUpdated"));
  },

  // Maintenance
  executeFactoryReset: () =>
    import("./AdminManager.js").then((m) => m.executeFactoryReset()),
  showFactoryResetConfirmation: async () => {
    if (
      confirm(
        t("confirmFactoryReset") ||
          "Are you sure you want to perform a factory reset? This will clear all local data.",
      )
    ) {
      (await import("./AdminManager.js")).executeFactoryReset();
    }
  },

  // Utilities & Rendering
  getProgress,
  renderMiniChart,
  renderSparkline,

  // Accessibility & Preferences
  toggleLowData: (enabled: boolean) => {
    localStorage.setItem("low-data", String(enabled));
    dashboard.addToast("info", t("settingsUpdated"));
  },
  toggleHighContrast: (enabled: boolean) => {
    document.body.classList.toggle("high-contrast", enabled);
    localStorage.setItem("high-contrast", String(enabled));
  },
  toggleGrayscale: (enabled: boolean) => {
    document.body.classList.toggle("grayscale", enabled);
    localStorage.setItem("grayscale", String(enabled));
  },
  toggleSepia: (enabled: boolean) => {
    document.body.classList.toggle("sepia", enabled);
    localStorage.setItem("sepia", String(enabled));
  },
  toggleSystemFont: (enabled: boolean) => {
    document.body.classList.toggle("system-font", enabled);
    localStorage.setItem("system-font", String(enabled));
  },
  updateFontSize: (val: string) => {
    document.documentElement.style.setProperty("--base-font-size", `${val}px`);
    localStorage.setItem("font-size", val);
  },
  togglePerformanceMode: (enabled: boolean) =>
    dashboard.setPerformanceMode(enabled),
  triggerGlitch: () => dashboard.triggerGlitch(),
  focusProject: (name: string) => searchManager.handleSearch(name),
  setEmergencyOverride: (val: boolean) => dashboard.setEmergencyOverride(val),

  // Audio/Voice stubs for settings UI
  updateVoicePreference: (uri: string) =>
    localStorage.setItem("tts-voice-uri", uri),
  updateSpeechRate: (val: string) => localStorage.setItem("tts-rate", val),
  updateSpeechPitch: (val: string) => localStorage.setItem("tts-pitch", val),
  toggleDarkSchedule: (enabled: boolean) =>
    localStorage.setItem("dark-schedule", String(enabled)),
  generateClientPDF: async () => (await getBrief()).downloadBriefAsPdf(),
});

// Autoplay Policy Fix: Resume AudioContext on the first user interaction.
// This addresses the "AudioContext was not allowed to start" warning/error.
const unlockAudio = async () => {
  try {
    await dashboard.resumeAudioContext();
    window.removeEventListener("mousedown", unlockAudio);
    window.removeEventListener("keydown", unlockAudio);
  } catch (e) {
    console.error("[Audio] Failed to unlock audio context:", e);
  }
};
window.addEventListener("mousedown", unlockAudio);
window.addEventListener("keydown", unlockAudio);

// Make App globally available
(window as any).App = App;
Object.assign(window, App);

console.log("[App] Main initialization completed.");

// Bootstrap the app and trigger initial data load via deep linking logic
BootstrapManager.init(dashboard)
  .then(() => {
    // Sync initial UI button states with persisted view preference
    dashboard.setView(dashboard.state.view);
    App.checkDeepLink();
    dashboard.startFpsMonitor(); // Start the system performance check
  })
  .catch((err: any) => {
    console.error("[Fatal] App failed to bootstrap:", err);
  });
