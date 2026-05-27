import type { Dashboard } from "./Dashboard.js";
import type { HistoryManager } from "./HistoryManager.js";
import { getProgress, t } from "./api-utils.js";
import { renderMiniChart, renderSparkline } from "./utils.js";

export function initApp(
  dashboard: Dashboard,
  historyManager: HistoryManager,
): any {
  const App: any = {
    toggleFabMenu: () => dashboard.toggleFabMenu(),
    setLang: (l: string) => dashboard.setLang(l),
    setTheme: (theme: string, persist = true) =>
      dashboard.applyTheme(theme, persist),
    revertTheme: () => dashboard.revertTheme(),
    resetThemeToSystem: () => dashboard.resetThemeToSystem(),
    toggleTheme: () => dashboard.toggleTheme(),
    setView: (v: string) => dashboard.setView(v),

    applyTranslations: () => {
      document.querySelectorAll("[data-i18n]").forEach((el: any) => {
        const key = el.getAttribute("data-i18n");
        if (key) el.textContent = t(key);
      });
      document.querySelectorAll("[data-i18n-title]").forEach((el: any) => {
        const key = el.getAttribute("data-i18n-title");
        if (key) el.setAttribute("title", t(key));
      });
    },

    // Audio Controls
    setSoundPack: (pack: string) => {
      localStorage.setItem("sound-pack", pack);
      document
        .querySelectorAll("#sound-pack-selector .pack-opt")
        .forEach((opt) => {
          opt.classList.toggle(
            "active",
            (opt as HTMLElement).dataset.pack === pack,
          );
        });
      dashboard.playUi("click");
    },
    updateVolume: (volume: number) => {
      dashboard.setUiVolume(volume);
      const muteBtn = document.getElementById("mute-toggle-btn");
      if (muteBtn) muteBtn.innerText = volume === 0 ? "🔇" : "🔊";
      const muteAllActive = document.getElementById("mute-all-active");
      if (muteAllActive)
        muteAllActive.style.display = volume === 0 ? "flex" : "none";
    },
    toggleMute: () => {
      const currentVolume = dashboard.state.uiVolume;
      if (currentVolume > 0) {
        localStorage.setItem("prev-ui-volume", currentVolume.toString());
        App.updateVolume?.(0);
      } else {
        const prevVolume = parseFloat(
          localStorage.getItem("prev-ui-volume") || "0.5",
        );
        App.updateVolume?.(prevVolume);
      }
    },
    resetAudioToDefault: () => {
      localStorage.removeItem("ui-volume");
      localStorage.removeItem("ui-pitch");
      localStorage.removeItem("sound-pack");
      localStorage.removeItem("tts-voice-uri");
      localStorage.removeItem("tts-rate");
      localStorage.removeItem("tts-pitch");
      dashboard.setUiVolume(0.5);
      dashboard.addToast("info", t("audioReset"));
      if ((window as any).App?.showSettings) (window as any).App.showSettings();
    },

    getRelativeTimeString: () => dashboard.getRelativeTimeString(),

    toggleHistory: () => historyManager.toggleHistory(),
    toggleHistoryTab: (tab: string) => historyManager.toggleHistoryTab(tab),
    selectCurrentWeek: () => historyManager.selectCurrentWeek(),
    loadCumulative: (type: string) => historyManager.loadCumulative(type),
    downloadConsolidatedPdf: () => historyManager.downloadConsolidatedPdf(),
    downloadPdf: (date: string) => historyManager.downloadPdf(date),
    loadSnapshot: (date: string) => historyManager.loadSnapshot(date),
    handleVerification: () => historyManager.handleVerification(),
    renderDropdowns: () => historyManager.renderDropdowns(),

    getProgress,
    renderMiniChart,
    renderSparkline,
    // Add more as needed
  };

  return App;
}
