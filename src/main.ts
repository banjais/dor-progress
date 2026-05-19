/** 
 * Interfaces for Project Data and State
 */
import { Dashboard } from "./Dashboard.js";
import { initApp } from "./App.js";
import { render } from "./render.js";
import { initPWALogic } from "./PWAManager.js";
import { t } from "./api-utils.js";
import { SearchManager } from "./SearchManager.js";
import { AuraManager } from "./AuraManager.js";
import { BriefManager } from "./BriefManager.js";
import { HistoryManager } from "./HistoryManager.js";
import { showModal, closeModal } from "./modal.js";
import { showSettings } from "./settings.js";
import { triggerDatabaseBackup, triggerDatabaseRestore, downloadAllOfflineData, clearDataCache, executeFactoryReset } from "./database.js";
import { requestSnapshotKey, createSnapshotManual, listSnapshots, downloadSnapshot, deleteSnapshot, logoutSnapshotSession } from "./SnapshotManager.js";
import { showDiagnostics } from "./DiagnosticManager.js";
import { BootstrapManager } from "./BootstrapManager.js";

// Core instance
const dashboard = Dashboard.getInstance();

// Feature managers
const searchManager = new SearchManager(dashboard);
const historyManager = new HistoryManager(dashboard);
const briefManager = new BriefManager(dashboard);
new AuraManager(dashboard);

// Initialization modules
const App = initApp(dashboard, historyManager) as AppGlobalFunctions;
initPWALogic();

// Start the bootstrap process once the core instance and UI are ready
void BootstrapManager.init(dashboard);

// State subscription
dashboard.subscribe(render, (state) => state); // Subscribe to the entire state

// Dashboard Event Hookup
dashboard.onSearch = (term) => searchManager.handleSearch(term);
dashboard.onUpdateCheck = () => App.checkForUpdates();
dashboard.onDatabaseRestore = () => triggerDatabaseRestore();
dashboard.onVerify = () => historyManager.handleVerification();
dashboard.onApplyTranslations = () => App.applyTranslations();

// Extend the App object with manager-specific functions
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
  requestSnapshotKey: () => requestSnapshotKey(),
  createSnapshotManual: (e?: Event) => createSnapshotManual(e),
  listSnapshots: (force?: boolean) => listSnapshots(force),
  downloadSnapshot: (date: string) => downloadSnapshot(date),
  deleteSnapshot: (date: string) => deleteSnapshot(date),
  logoutSnapshotSession: () => logoutSnapshotSession(),
  exportHealthReport: () => showDiagnostics(),

  // UI Extras
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
  closeModal: closeModal,
  checkForUpdates: () => dashboard.loadData(true),
  showSettings: () => showSettings(dashboard),
  triggerDatabaseBackup: triggerDatabaseBackup,
  triggerDatabaseRestore: triggerDatabaseRestore,
  downloadAllOfflineData: downloadAllOfflineData,
  clearDataCache: clearDataCache,
  executeFactoryReset: executeFactoryReset
});

// Final single global assignment
window.App = App;
Object.assign(window, App);
