/**
 * Global type definitions for vendor-prefixed APIs.
 */
interface Window {
  /** Prefix for older WebKit browsers */
  webkitAudioContext: typeof AudioContext;
  /** Prefix for older WebKit browsers */
  webkitSpeechRecognition: any;
  SpeechRecognition: any;

  // Dashboard UI Functions
  toggleFabMenu: () => void;
  setLang: (l: string) => void;
  logoutSnapshotSession: () => void;
  checkStatus: () => Promise<void>;
  startVoiceSearch: () => Promise<void>;
  clearSearch: () => void;
  printAiBrief: () => void;
  shareAiBrief: () => Promise<void>;
  translateAiBrief: () => Promise<void>;
  downloadAiBriefAudio: () => Promise<void>;
  shareAiBriefAudio: () => Promise<void>;
  toggleReadAloud: () => void;
  exportHealthReport: () => Promise<void>;
  closeModal: () => void;
  setTheme: (theme: string, persist?: boolean) => string;
  revertTheme: () => string;
  resetThemeToSystem: () => void;
  toggleTheme: () => void;
  setView: (v: string) => void;
  showInChartView: (name: string) => void;
  showInCardView: (name: string) => void;
  copyDeepLink: (name: string) => void;
  renderDropdowns: () => void;
  toggleHistory: () => void;
  toggleHistoryTab: (tab: string) => void;
  loadSnapshot: (date: string) => Promise<void>;
  loadCumulative: (type: string) => Promise<void>;
  downloadConsolidatedPdf: () => Promise<void>;
  downloadPdf: (date: string) => Promise<void>;
  handleVerification: () => Promise<void>;
  checkDeepLink: () => void;
  handleSearch: (term?: string) => void;
  sortData: (key: string) => void;
  shareApp: () => void;
  getProgress: (row: any, headers: string[]) => number;
  renderMiniChart: (percent: number, showTrend?: boolean) => string;
  renderSparkline: (annPerc: number, totPerc: number) => string;
  showModal: (indicatorName: string) => void;
  checkForUpdates: () => Promise<void>;
  createSnapshotManual: (e?: any) => Promise<void>;
  listSnapshots: (force?: boolean) => Promise<void>;
  downloadSnapshot: (date: string) => Promise<void>;
  deleteSnapshot: (date: string) => Promise<void>;
  showSettings: () => Promise<void>;
  triggerDatabaseBackup: () => Promise<void>;
  triggerDatabaseRestore: () => Promise<void>;
  downloadAllOfflineData: () => Promise<void>;
  clearDataCache: () => void;
  showFactoryResetConfirmation: () => void;
  executeFactoryReset: () => Promise<void>;
  toggleLowData: (enabled: boolean) => void;
  toggleDarkSchedule: (enabled: boolean) => void;
  updateVoicePreference: (uri: string) => void;
  updateSpeechRate: (val: string) => void;
  updateSpeechPitch: (val: string) => void;
  toggleSystemFont: (enabled: boolean) => void;
  updateFontSize: (val: string) => void;
  toggleHighContrast: (enabled: boolean) => void;
  toggleGrayscale: (enabled: boolean) => void;
  toggleSepia: (enabled: boolean) => void;
  generateClientPDF: () => Promise<void>;
}

import {
  Env as SharedEnv,
  ProjectRow as SharedProjectRow,
  AiSummary as SharedAiSummary,
  ProjectReport as SharedProjectReport,
} from "../shared/types";

declare global {
  interface Env extends SharedEnv {
    // Specific overrides for global scope if necessary, otherwise inherits SharedEnv
    VITE_API_BASE_URL?: string;
  }
  type ProjectRow = SharedProjectRow;
  type AiSummary = SharedAiSummary;
  interface ProjectReport extends SharedProjectReport {
    created?: string;
  }

  /**
   * Bridge the gap between generic Uint8Arrays and Worker APIs.
   * This helps when libraries return Uint8Array<ArrayBufferLike>.
   */
  type BodyInit =
    | string
    | ArrayBuffer
    | ArrayBufferView
    | ReadableStream
    | FormData
    | URLSearchParams
    | Uint8Array<any>;
}
