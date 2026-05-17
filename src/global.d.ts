import {
  Env as BaseEnv,
  ProjectRow as BaseProjectRow,
  AiSummary as BaseAiSummary,
  ProjectReport as BaseProjectReport,
  SpreadsheetHeaders as BaseHeaders
} from "../shared/types.ts";

/**
 * Global type definitions for vendor-prefixed APIs.
 */

declare global {
  interface SpeechRecognitionAlternative {
    readonly transcript: string;
    readonly confidence: number;
  }

  interface SpeechRecognitionResult {
    readonly length: number;
    item(index: number): SpeechRecognitionAlternative;
    [index: number]: SpeechRecognitionAlternative;
    readonly isFinal: boolean;
  }

  interface SpeechRecognitionResultList {
    readonly length: number;
    item(index: number): SpeechRecognitionResult;
    [index: number]: SpeechRecognitionResult;
  }

  interface SpeechRecognitionEvent extends Event {
    readonly resultIndex: number;
    readonly results: SpeechRecognitionResultList;
  }

  interface SpeechRecognition extends EventTarget {
    lang: string;
    interimResults: boolean;
    maxAlternatives: number;
    continuous: boolean;
    start(): void;
    stop(): void;
    abort(): void;
    onresult: (event: SpeechRecognitionEvent) => void;
    onerror: (event: any) => void;
    onspeechend: () => void;
  }

  interface Window {
    /** Prefix for older WebKit browsers */
    webkitAudioContext: typeof AudioContext;
    /** Prefix for older WebKit browsers */
    webkitSpeechRecognition: {
      new(): SpeechRecognition;
    };
    PDFLib: any; // Assuming PDFLib is a global object from a library
    I18N: any; // If I18N is truly global, declare it here. Otherwise, it should be imported.
  }

  interface Window extends AppGlobalFunctions {
    App: AppGlobalFunctions;
  }

  /**
   * Global App object to avoid polluting the window namespace directly.
   * All globally accessible functions should be attached to this object.
   */
  interface AppGlobalFunctions {
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
    applyTranslations: () => void;
    exportHealthReport: () => void;
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
    selectCurrentWeek: () => void;
    loadSnapshot: (date: string) => Promise<void>;
    loadCumulative: (type: string) => Promise<void>;
    downloadConsolidatedPdf: () => Promise<void>;
    downloadPdf: (date: string) => Promise<void>;
    handleVerification: () => Promise<void>;
    checkDeepLink: () => void;
    handleSearch: (term?: string) => void;
    sortData: (key: string) => void;
    shareApp: () => void;
    getProgress: (row: ProjectRow, headers: SpreadsheetHeaders) => number;
    renderMiniChart: (percent: number, showTrend?: boolean) => string;
    renderSparkline: (annPerc: number, totPerc: number) => string;
    showModal: (indicatorName: string) => void;
    toggleDiffMode: (date: string | null) => Promise<void>;
    checkForUpdates: () => Promise<void>;
    requestSnapshotKey: () => Promise<string | null>;
    createSnapshotManual: (e?: Event) => Promise<void>;
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
    setSoundPack: (pack: string) => void;
    updateVolume: (volume: number) => void;
    toggleMute: () => void;
    resetAudioToDefault: () => void;
    getRelativeTimeString: () => string;
    syncAppTheme: () => void;
    setMusicTrack: (track: string) => void;
    shareSnapshot: (date: string) => void;
    quickPrintSnapshot: (date: string) => void;
  }

  interface Navigator {
    standalone?: boolean;
  }

  interface Env extends BaseEnv { VITE_API_BASE_URL?: string; }
  type ProjectRow = BaseProjectRow;
  type AiSummary = BaseAiSummary;
  type ProjectReport = BaseProjectReport;
  type SpreadsheetHeaders = BaseHeaders;
}
