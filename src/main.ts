// src/main.ts
import { Dashboard } from "./Dashboard.js";
import { initApp } from "./App.js";
import { render } from "./render.js";
import { initPWALogic } from "./PWAManager.js";
import { t } from "./api-utils.js";

import { SearchManager } from "./SearchManager.js";
import { AuraManager } from "./AuraManager.js";
import { BriefManager } from "./BriefManager.js";
import { HistoryManager } from "./HistoryManager.js";

import {
  showModal,
  closeModal,
  showDiagnostics
} from "./DiagnosticManager.js";

import {
  requestSnapshotKey,
  createSnapshotManual,
  listSnapshots,
  downloadSnapshot,
  deleteSnapshot,
  logoutSnapshotSession,
  showSettings,
  triggerDatabaseBackup,
  triggerDatabaseRestore,
  downloadAllOfflineData,
  clearDataCache,
  executeFactoryReset
} from "./AdminManager.js";

import { BootstrapManager } from "./BootstrapManager.js";

// Core instance
const dashboard = Dashboard.getInstance();

// Feature managers
const searchManager = new SearchManager(dashboard);
const historyManager = new HistoryManager(dashboard);
const briefManager = new BriefManager(dashboard);
new AuraManager(dashboard);

// Initialize App
const App = initApp(dashboard, historyManager) as AppGlobalFunctions;

// Initialize PWA (Service Worker + Install Prompt)
initPWALogic();

// Bootstrap the app
void BootstrapManager.init(dashboard);

// Subscribe to state changes
dashboard.subscribe(render, (state) => state);

// Attach event handlers
dashboard.onSearch = (term) => searchManager.handleSearch(term);
dashboard.onUpdateCheck = () => App.checkForUpdates();
dashboard.onDatabaseRestore = () => triggerDatabaseRestore();
dashboard.onVerify = () => historyManager.handleVerification();
dashboard.onApplyTranslations = () => App.applyTranslations();

// Extend App with methods
Object.assign(App, {
  // Voice & Search
  startVoiceSearch: () => searchManager.startVoiceSearch(),
  clearSearch: () => searchManager.clearSearch(),
  handleSearch: (term?: string) => searchManager.handleSearch(term),

  // AI Briefs
  printAiBrief: () => briefManager.printAiBrief(),
  copyAiBrief: () => briefManager.copyAiBrief(),
  shareAiBrief: () => briefManager.share(),
  translateAiBrief: () => briefManager.translate(),
  downloadAiBriefAudio: () => briefManager.downloadAudio(),
  shareAiBriefAudio: () => briefManager.shareAudio(),
  toggleReadAloud: () => briefManager.toggleReadAloud(),

  // Snapshots & Diagnostics
  requestSnapshotKey,
  createSnapshotManual,
  listSnapshots,
  downloadSnapshot,
  deleteSnapshot,
  logoutSnapshotSession,
  exportHealthReport: () => showDiagnostics(),

  // UI
  shareSnapshot: (date: string) => {
    console.warn(`shareSnapshot for ${date} not implemented.`);
    dashboard.addToast("info", t("notImplemented"));
  },
  quickPrintSnapshot: (date: string) => {
    console.warn(`quickPrintSnapshot for ${date} not implemented.`);
    dashboard.addToast("info", t("notImplemented"));
  },

  sortData: (key: string) => {
    dashboard.state.sort.dir = dashboard.state.sort.key === key ? -dashboard.state.sort.dir : 1;
    dashboard.state.sort.key = key;
  },
  toggleDiffMode: (date: string | null) => dashboard.toggleDiffMode(date),

  showModal: (name: string) => showModal(name, dashboard),
  closeModal,
  checkForUpdates: () => dashboard.loadData(true),
  showSettings: () => showSettings(dashboard),

  triggerDatabaseBackup,
  triggerDatabaseRestore,
  downloadAllOfflineData,
  clearDataCache,
  executeFactoryReset,
});

// Make App globally available
window.App = App;
Object.assign(window, App);

console.log("[App] Main initialization completed.");