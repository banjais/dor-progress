/** 
 * Interfaces for Project Data and State
 */
import { Dashboard } from "./Dashboard";
import { initApp } from "./App";
import { render } from "./render";
import { initPWALogic } from "./PWAManager";
import {
  t,
} from "./api-utils";
import { SearchManager } from "./SearchManager";
import { AuraManager } from "./AuraManager";
import { BriefManager } from "./BriefManager";
import { HistoryManager } from "./HistoryManager";
import { showModal, closeModal } from "./modal";
import { showSettings } from "./settings";
import { triggerDatabaseBackup, triggerDatabaseRestore, downloadAllOfflineData, clearDataCache, executeFactoryReset } from "./database";
import { requestSnapshotKey, createSnapshotManual, listSnapshots, downloadSnapshot, deleteSnapshot, logoutSnapshotSession } from "./SnapshotManager";
import { showDiagnostics } from "./DiagnosticManager";
import { BootstrapManager } from "./BootstrapManager";

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
dashboard.subscribe(render, (state) => state.store);

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
  printAiBrief: () => briefManager.print(),
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
