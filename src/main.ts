// @ts-nocheck
/**
 * Global type declarations for environment variables injected during build.
 */
declare const WORKER_BASE: string;
declare const APP_ENV: "development" | "production" | "test";
declare const APP_VERSION: string;
declare const PDFLib: any;

/**
 * Interfaces for Project Data and State
 */
const syncStyle = document.createElement("style");
syncStyle.textContent = `
  @keyframes toast-progress-loop {
    0% { transform: scaleX(0); transform-origin: left; }
    50% { transform: scaleX(1); transform-origin: left; }
    50.1% { transform: scaleX(1); transform-origin: right; }
    100% { transform: scaleX(0); transform-origin: right; }
  }
`;
document.head.appendChild(syncStyle);
import { initPWALogic } from "./PWAManager";

import { Dashboard } from "./Dashboard";
import {
  t,
  authenticatedFetch,
  toNepaliNumerals,
  I18N,
} from "./api-utils";

const dashboard = Dashboard.getInstance();

// Bind global window handlers for HTML onclick attributes
(window as any).toggleFabMenu = () => dashboard.toggleFabMenu();
(window as any).setLang = (l: string) => dashboard.setLang(l);

(window as any).logoutSnapshotSession = () => {
  sessionStorage.removeItem("_snapshot_key");
  dashboard.addToast(
    "info",
    dashboard.state.lang === "en"
      ? "Snapshot session cleared"
      : "स्न्यापसट सेसन मेटाइयो",
  );
  // Re-open settings to refresh the UI
  showSettings();
};

/**
 * Centralized fetch helper to handle base URLs and Firebase App Check tokens.
 */
// Definitions moved to api-utils.ts

(window as any).checkStatus = checkStatus;
async function checkStatus() {
  const statusEl = document.getElementById("status") as HTMLElement;
  const btn = document.getElementById(
    "status-refresh-btn",
  ) as HTMLButtonElement;
  if (!statusEl || !btn) return;

  statusEl.innerText =
    dashboard.state.lang === "en" ? "Pinging..." : "जाँच गर्दै...";
  const startTime = performance.now();
  btn.classList.add("spinning");
  btn.disabled = true;

  try {
    // Desktop Force Refresh: Clicking this now forces a full data reload bypassing Redis
    await dashboard.loadData(true);
    const res = await authenticatedFetch(`/api/ping`);
    const endTime = performance.now();
    const duration = Math.round(endTime - startTime);

    if (res.ok) {
      statusEl.innerText = t("live");
      statusEl.style.color = "#4ade80";
      dashboard.addToast(
        "success",
        dashboard.state.lang === "en"
          ? `Pong! ${duration}ms`
          : `पङ्! ${duration}ms`,
      );
    } else {
      throw new Error();
    }
  } catch {
    statusEl.innerText = t("offline");
    statusEl.style.color = "#f87171";
    dashboard.addToast(
      "error",
      dashboard.state.lang === "en" ? "Ping failed" : "पिङ असफल",
    );
  } finally {
    btn.classList.remove("spinning");
    btn.disabled = false;
  }
}

// Definitions moved to api-utils.ts

(window as any).startVoiceSearch = startVoiceSearch;
async function startVoiceSearch() {
  const SpeechRecognition =
    (window as any).SpeechRecognition ||
    (window as any).webkitSpeechRecognition;
  if (!SpeechRecognition) {
    dashboard.addToast(
      "error",
      dashboard.state.lang === "en"
        ? "Voice search not supported in this browser."
        : "यो ब्राउजरमा भ्वाइस सर्च समर्थित छैन।",
    );
    return;
  }

  const recognition = new SpeechRecognition();
  recognition.lang = dashboard.state.lang === "ne" ? "ne-NP" : "en-US"; // Set language for recognition
  recognition.interimResults = false; // Only return final results
  recognition.maxAlternatives = 1;

  const btn = document.getElementById("voice-search-btn") as HTMLButtonElement;
  const container = document.querySelector(".search-container");

  // Ensure the volume bar exists in the DOM
  let volumeBar = document.getElementById("voice-volume-bar");
  if (!volumeBar && container) {
    volumeBar = document.createElement("div");
    volumeBar.id = "voice-volume-bar";
    container.appendChild(volumeBar);
  }

  let audioStream: MediaStream = null as unknown as MediaStream;
  let localAudioCtx: AudioContext = null as unknown as AudioContext;
  let animationId: number = 0;

  const cleanup = () => {
    if (animationId) window.cancelAnimationFrame(animationId);
    if (audioStream) audioStream.getTracks().forEach((t) => t.stop());
    if (localAudioCtx) localAudioCtx.close(); // Close local context
    if (btn) btn.classList.remove("listening");
    if (volumeBar) {
      volumeBar.style.width = "0%";
      volumeBar.style.opacity = "0";
    }
  };
  try {
    audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    localAudioCtx = new (
      window.AudioContext || (window as any).webkitAudioContext
    )();
    if (localAudioCtx.state === "suspended") await localAudioCtx.resume();

    const source = localAudioCtx.createMediaStreamSource(audioStream);
    const analyser = localAudioCtx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    if (btn) btn.classList.add("listening");
    if (volumeBar) volumeBar.style.opacity = "1";

    const draw = () => {
      analyser.getByteFrequencyData(dataArray);
      let sum = 0;
      for (const value of dataArray) sum += value;
      const average = sum / dataArray.length;
      // Map average amplitude (0-128 typically) to percentage width
      const volumePercent = Math.min(100, (average / 64) * 100);
      if (volumeBar) volumeBar.style.width = `${volumePercent}%`;
      animationId = window.requestAnimationFrame(draw);
    };
    draw();
  } catch (err) {
    console.warn("Audio visualization failed:", err);
    cleanup(); // Ensure cleanup if audio setup fails
  }

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    const searchInput = document.getElementById(
      "search-input",
    ) as HTMLInputElement;
    if (searchInput) searchInput.value = transcript;
    handleSearch();
    dashboard.handleSearch();
    cleanup();
    dashboard.addToast(
      "info",
      (dashboard.state.lang === "en" ? "Search: " : "खोज: ") + transcript,
    );

    // Auto-scroll to the first result after rendering
    setTimeout(() => {
      const firstRow = document.querySelector("#tbody tr:not(.skeleton-row)");
      if (firstRow) {
        firstRow.scrollIntoView({ behavior: "smooth", block: "center" });
        firstRow.classList.add("selected-row");
        setTimeout(() => firstRow.classList.remove("selected-row"), 2000);
      }
    }, 400);
  };

  recognition.onspeechend = () => {
    recognition.stop();
    cleanup();
  };

  recognition.onerror = (event) => {
    cleanup();
    if (event.error === "not-allowed") {
      dashboard.addToast(
        "error",
        dashboard.state.lang === "en" ? "Mic denied" : "अनुमति छैन",
      );
    } else {
      console.error("Speech recognition error:", event.error);
      dashboard.addToast(
        "error",
        dashboard.state.lang === "en"
          ? "Voice search failed"
          : "भ्वाइस सर्च असफल",
      );
    }
  };
  recognition.start();
}

(window as any).clearSearch = clearSearch;
function clearSearch() {
  const input = document.getElementById("search-input") as HTMLInputElement;
  if (!input) return;
  input.value = "";
  handleSearch();
  dashboard.handleSearch();
  input.focus();
}

(window as any).printAiBrief = printAiBrief;
function printAiBrief() {
  document.body.classList.add("print-memo-only");
  window.print();
  document.body.classList.remove("print-memo-only");
}

(window as any).shareAiBrief = shareAiBrief;
async function shareAiBrief() {
  const text =
    (document.getElementById("ai-brief-text") as HTMLElement)?.innerText || "";
  if (navigator.share) {
    try {
      await navigator.share({
        title: "DOR Progress Dashboard - Executive Briefing",
        text: text,
      });
    } catch (err) {
      console.log("Share cancelled or failed", err);
    }
  } else {
    navigator.clipboard.writeText(text);
    dashboard.addToast("success", t("linkCopied"));
  }
}

(window as any).translateAiBrief = translateAiBrief;
async function translateAiBrief() {
  // Note: targetLang is calculated but the API call uses current state
  const btn = document.getElementById("ai-translate-btn") as HTMLButtonElement;
  if (btn) btn.classList.add("spinning");

  try {
    const res = await authenticatedFetch(
      `/api/report?lang=${dashboard.state.lang}`,
    );
    const json = await res.json();
    if (json.aiSummary?.brief) {
      dashboard.typeText(
        document.getElementById("ai-brief-text") as HTMLElement,
        json.aiSummary.brief,
        true,
      );
    }
  } catch {
    dashboard.addToast(
      "error",
      dashboard.state.lang === "en" ? "Failed" : "असफल",
    );
  } finally {
    if (btn) btn.classList.remove("spinning");
  }
}

/**
 * Downloads the AI Executive Briefing as an MP3 file.
 */
(window as any).downloadAiBriefAudio = async () => {
  const btn = document.getElementById(
    "ai-download-audio-btn",
  ) as HTMLButtonElement;
  if (!btn) return;
  const originalHtml = btn.innerHTML;

  try {
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner" style="border-top-color:var(--primary); width:14px; height:14px;"></span>`;
    dashboard.addToast("info", t("preparingAudio"));

    const blob = await dashboard.fetchAiBriefBlob();
    if (!blob) return;

    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `DoR_Executive_Briefing_${new Date().toISOString().split("T")[0]}.mp3`;
    a.click();
  } catch {
    dashboard.addToast("error", "Audio failed");
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
};

/**
 * Shares the AI Executive Briefing MP3 directly via Web Share API
 */
(window as any).shareAiBriefAudio = async () => {
  const btn = document.getElementById(
    "ai-share-audio-btn",
  ) as HTMLButtonElement;
  if (!btn) return;
  const originalHtml = btn.innerHTML;

  try {
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner" style="border-top-color:var(--primary); width:14px; height:14px;"></span>`;

    const blob = await dashboard.fetchAiBriefBlob();
    if (!blob) return;

    const file = new File(
      [blob],
      `DoR_Summary_${new Date().toISOString().slice(0, 10)}.mp3`,
      { type: "audio/mpeg" },
    );

    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({
        files: [file],
        title: "DoR Executive Briefing",
        text: "Official Department of Roads Audio Summary",
      });
    } else {
      dashboard.addToast("error", "Not supported");
    }
  } catch {
    dashboard.addToast("error", "Share failed");
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
};

(window as any).toggleReadAloud = () => {
  const container = document.getElementById("ai-brief-text");
  if (container) dashboard.speech.toggle(container);
};

interface TextElement extends HTMLElement {
  _timer?: number;
}

function typeText(element: TextElement, text: string, useSound = false) {
  if (element.getAttribute("data-current") === text) return;
  element.setAttribute("data-current", text);

  // Clear existing element-specific timer to prevent overlapping
  if (element._timer) window.clearInterval(element._timer);
  element.innerText = "";
  element.classList.add("shimmer-text");
  let i = 0;
  element._timer = window.setInterval(() => {
    if (i < text.length) {
      element.innerText += text.charAt(i);
      if (useSound) dashboard.audio.playUi("type");
      i++;
    } else {
      window.clearInterval(element._timer);
      element.classList.remove("shimmer-text");
    }
  }, 40); // 40ms per character for a smooth terminal feel
}

export async function exportHealthReport() {
  const period = document.getElementById("diag-period").value;
  if (!period) return;

  const [year, month] = period.split("-");
  const originalStore = dashboard.state.store;
  const originalView = dashboard.state.view;

  // Generate Bikram Sambat date string using I18N months and Nepali numerals
  const bsYear = parseInt(year) + 57;
  const bsMonthName = I18N[dashboard.state.lang].months[parseInt(month) - 1];
  const displayYear =
    dashboard.state.lang === "ne" ? toNepaliNumerals(bsYear) : bsYear;
  const formattedDate =
    dashboard.state.lang === "en"
      ? `${bsMonthName} ${displayYear} BS`
      : `${bsMonthName} ${displayYear} वि.सं.`;

  // Customize print header for the audit report
  const reportTitleEl = document.getElementById("h-report");
  const originalTitle = reportTitleEl.innerText;
  reportTitleEl.innerText =
    dashboard.state.lang === "en"
      ? `Monthly Health Audit - ${formattedDate}`
      : `मासिक स्वास्थ्य लेखापरीक्षण - ${formattedDate}`;

  // Update QR code to point to specific monthly verification link
  const qrEl = document.getElementById("print-qr");
  const originalQr = qrEl.src;
  const verificationLink = `${window.location.origin}${window.location.pathname}?type=monthly&period=${period}`;
  qrEl.src = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(verificationLink)}`;

  document.getElementById("loader").style.display = "flex";
  closeModal();

  try {
    const res = await authenticatedFetch(
      `/api/summary?type=monthly&year=${year}&month=${month}`,
    );
    const json = await res.json();

    // Calculate Risk Score for the Audit
    const totalRows = json.rows.length;
    const criticalCount = json.rows.filter(
      (r) => r._status === "critical",
    ).length;
    const auditRiskScore =
      totalRows > 0 ? Math.round((criticalCount / totalRows) * 100) : 0;
    const riskSummaryEl = document.getElementById("h-risk-summary");
    riskSummaryEl.style.display = "block";
    const dispScore =
      dashboard.state.lang === "ne"
        ? toNepaliNumerals(auditRiskScore)
        : auditRiskScore;
    riskSummaryEl.innerText =
      dashboard.state.lang === "en"
        ? `TOTAL RISK SCORE: ${dispScore}%`
        : `कुल जोखिम स्कोर: ${dispScore}%`;

    // Temporarily switch to historical store and filter for critical
    dashboard.state.store = json;
    dashboard.handleSearch("critical");
    dashboard.setView("table");

    dashboard.addToast(
      "info",
      dashboard.state.lang === "en"
        ? `Generating Report for ${period}...`
        : `${period} को लागि प्रतिवेदन तयार गर्दै...`,
    );

    setTimeout(() => {
      window.print();
      // Restore original state
      reportTitleEl.innerText = originalTitle;
      qrEl.src = originalQr;
      riskSummaryEl.style.display = "none";
      dashboard.state.store = originalStore;
      dashboard.render();
      dashboard.setView(originalView);
    }, 800);
  } catch {
    dashboard.addToast("error", "Failed to generate historical report.");
  } finally {
    document.getElementById("loader").style.display = "none";
  }
}

// AI Intent Sensing (Mind-Reading Effect)
document.addEventListener("mousemove", (e) => {
  const aura = document.getElementById("ai-aura");
  const auraText = document.getElementById("aura-text");
  const auraGlow = aura ? aura.querySelector(".aura-glow") : null;
  const auraHalo = aura ? aura.querySelector(".aura-halo") : null;
  if (!aura || !auraGlow || !auraHalo) return;

  aura.style.left = e.clientX + "px";
  aura.style.top = e.clientY + "px";
  aura.style.opacity = e.target.closest("button, .kpi-card, tr, .data-card")
    ? 1
    : 0.4; // Make aura more visible on interactive elements

  const kpi = e.target.closest(".kpi-card");
  if (kpi) {
    const title = kpi.innerText.toLowerCase();
    if (title.includes("attention") || title.includes("ध्यान")) {
      typeText(auraText, t("auraAnalyzing"));
      if (!auraHalo.classList.contains("critical"))
        dashboard.audio.playUi("alert");
      auraGlow.classList.add("pulsing");
      auraHalo.classList.add("critical");

      // Calculate dynamic intensity: higher risk = faster, wider glitch
      const offset = 1 + dashboard.riskLevel * 5; // 1px to 6px
      const duration = 0.15 - dashboard.riskLevel * 0.1; // 0.15s to 0.05s
      auraText.style.setProperty("--glitch-offset", `${offset}px`);
      auraText.style.setProperty("--glitch-dur", `${duration}s`);
      auraText.classList.add("glitch");

      // Expand halo based on risk
      auraHalo.style.setProperty("--halo-scale", 1 + dashboard.riskLevel * 1.5);

      if (!dashboard.intentTimer)
        dashboard.intentTimer = setTimeout(() => {
          handleSearch("critical");
          typeText(auraText, t("auraIsolated"));
        }, 1000);
    } else if (title.includes("met") || title.includes("पूरा")) {
      typeText(auraText, t("auraTracing"));
      auraGlow.classList.remove("pulsing");
      auraHalo.classList.remove("critical");
      auraText.classList.remove("glitch");
      auraHalo.style.setProperty("--halo-scale", 1);
      if (!dashboard.intentTimer)
        dashboard.intentTimer = setTimeout(() => {
          handleSearch("good");
          typeText(auraText, t("auraFiltered"));
        }, 1000);
    }
  } else {
    typeText(auraText, t("auraText"));
    auraGlow.classList.remove("pulsing");
    auraHalo.classList.remove("critical");
    auraText.classList.remove("glitch");
    auraHalo.style.setProperty("--halo-scale", 1);
    if (auraGlow) auraGlow.classList.remove("pulsing");
    if (auraHalo) auraHalo.classList.remove("critical");
    if (auraText) auraText.classList.remove("glitch");
    if (auraHalo) auraHalo.style.setProperty("--halo-scale", 1);
    if (dashboard.intentTimer) {
      clearTimeout(dashboard.intentTimer);
      dashboard.intentTimer = null;
    }
  }
});

// Language Detection
let originalTheme = "light";
window.setTheme = (theme, persist = true) => {
  const color = theme === "dark" ? "#0b0f1a" : "#1a5c3a";
  document.body.setAttribute("data-theme", theme);
  if (persist) {
    localStorage.setItem("theme", theme);
    originalTheme = theme;
  }
  document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
    meta.setAttribute("content", color);
  });
  // Sync modal UI
  document.querySelectorAll(".theme-option").forEach((opt) => {
    opt.classList.toggle("active", opt.dataset.theme === theme);
  });
  return originalTheme;
};

window.revertTheme = () => setTheme(originalTheme, false);

window.resetThemeToSystem = () => {
  localStorage.removeItem("theme");
  const isDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  const systemTheme = isDark ? "dark" : "light";
  // Apply the theme visually but do not persist it to localStorage
  setTheme(systemTheme, false);
  originalTheme = systemTheme; // Ensure revertTheme tracks the system state
  dashboard.addToast(
    "info",
    dashboard.state.lang === "en"
      ? "Theme reset to system default."
      : "थिम प्रणाली पूर्वनिर्धारितमा रिसेट गरियो।",
  );
};

window.toggleTheme = () => {
  const current = document.body.getAttribute("data-theme") || "light";
  setTheme(current === "dark" ? "light" : "dark");
};

window.setLang = (l) => dashboard.setLang(l);
window.setView = (v) => dashboard.setView(v);

window.showInChartView = showInChartView;
function showInChartView(name) {
  setView("charts");
  // Allow time for DOM to render before searching for the element
  setTimeout(() => {
    const charts = document.querySelectorAll(".chart-card");
    const el = Array.from(charts).find(
      (c) => c.getAttribute("data-indicator") === name,
    );
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("selected-row");
      setTimeout(() => el.classList.remove("selected-row"), 2000);
    }
  }, 300);
}

window.showInCardView = showInCardView;
function showInCardView(name) {
  setView("cards");
  // Allow time for DOM to render before searching for the element
  setTimeout(() => {
    const cards = document.querySelectorAll(".data-card");
    const el = Array.from(cards).find(
      (c) => c.getAttribute("data-indicator") === name,
    );
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("selected-row");
      setTimeout(() => el.classList.remove("selected-row"), 2000);
    }
  }, 300);
}

window.copyDeepLink = copyDeepLink;
function copyDeepLink(name) {
  const url = new URL(window.location.href);
  url.searchParams.set("indicator", name);
  navigator.clipboard.writeText(url.toString());
  dashboard.addToast("success", t("linkCopied"));
}

window.renderDropdowns = renderDropdowns;
function renderDropdowns() {
  const mSelect = document.getElementById("summary-month");
  const ySelect = document.getElementById("summary-year");
  if (!mSelect || !ySelect) return;

  const savedM = mSelect.value;
  const savedY = ySelect.value;

  // Populate Months from I18N Fallback
  mSelect.innerHTML = I18N[dashboard.state.lang].months
    .map(
      (m, i) =>
        `<option value="${(i + 1).toString().padStart(2, "0")}">${m}</option>`,
    )
    .join("");

  // Populate Bikram Sambat Years (roughly current year + 57)
  const currentADYear = new Date().getFullYear();
  ySelect.innerHTML = [currentADYear, currentADYear - 1, currentADYear - 2]
    .map(
      (y) =>
        `<option value="${y}">${dashboard.state.lang === "ne" ? toNepaliNumerals(y + 57) + " वि.सं." : y + " AD"}</option>`,
    )
    .join("");

  if (savedM) mSelect.value = savedM;
  if (savedY) ySelect.value = savedY;
}

window.toggleHistory = toggleHistory;
function toggleHistory() {
  if (dashboard.state.view === "history") {
    dashboard.setView("table");
    return;
  }
  dashboard.setView("history");
  toggleHistoryTab("weekly");
}

window.toggleHistoryTab = toggleHistoryTab;
function toggleHistoryTab(tab) {
  document
    .getElementById("hist-weekly-btn")
    .classList.toggle("active", tab === "weekly");
  document
    .getElementById("hist-cumulative-btn")
    .classList.toggle("active", tab === "cumulative");
  document.getElementById("cumulative-controls").style.display =
    tab === "cumulative" ? "block" : "none";
  document.getElementById("btn-current-week").style.display =
    tab === "weekly" ? "block" : "none";
  document.getElementById("history-list").style.display =
    tab === "weekly" ? "grid" : "none";

  if (tab === "cumulative") {
    renderDropdowns();
    const now = new Date();
    // Set to current Gregorian year and month, which will be converted to BS for display
    document.getElementById("summary-year").value = now
      .getFullYear()
      .toString();
    document.getElementById("summary-month").value = (now.getMonth() + 1)
      .toString()
      .padStart(2, "0");
  }

  if (tab === "weekly") void fetchWeeklyHistory();
}

let weeklyArchives = [];

async function fetchWeeklyHistory() {
  const res = await authenticatedFetch(`/api/reports`);
  weeklyArchives = await res.json();

  // SMART UI: If only 1 week of data exists, hide History button and Months/Years toggle
  const histBtn = document.getElementById("hist-btn");
  if (weeklyArchives.length < 2) {
    if (histBtn) histBtn.style.display = "none";
  } else {
    if (histBtn) histBtn.style.display = "flex";
  }

  const html = weeklyArchives
    .map(
      (h) => `
        <div class="chart-card archive-item" style="display:flex; flex-direction:column; justify-content:space-between">
          <div style="display:flex; justify-content:space-between; align-items:start; margin-bottom:10px">
            <div>
              ${dashboard.state.diffMode && dashboard.state.compareReport?.lastUpdate === h.date ? `<span style="font-size:0.6rem; background:var(--stable); color:white; padding:2px 6px; border-radius:4px; margin-right:5px;">COMPARING</span>` : ""}
              <b style="font-size:1.1rem">📅 ${h.date}</b>
              ${h.bsDate ? `<div style="font-size:0.75rem; color:var(--primary); font-weight:bold; margin-top:2px">${dashboard.state.lang === "ne" ? toNepaliNumerals(h.bsDate) : h.bsDate}</div>` : ""}
            </div>
            <div style="display:flex; gap:5px">
              <button onclick="shareSnapshot('${h.date}')" class="icon-btn" title="Share Link" style="width:28px; height:28px; font-size:0.8rem; background:rgba(0,0,0,0.05); border-radius:6px">🔗</button>
              <button onclick="downloadPdf('${h.date}')" style="border:none; cursor:pointer; font-size:0.7rem; background:var(--critical); color:white; padding:4px 8px; border-radius:6px; height:28px">PDF</button>
            </div>
          </div>
          <p style="font-size:0.8rem; opacity:0.8; margin-bottom:12px">${h.bsDate ? `${t("total")}: ${dashboard.state.lang === "ne" ? toNepaliNumerals(h.recordCount) : h.recordCount}` : h.summary || "Weekly progress snapshot."}</p>
          <div style="display:flex; gap:8px;">
            ${dashboard.state.diffMode ? `<button onclick="dashboard.toggleDiffMode(null)" style="flex:2; border:1px solid var(--critical); background:none; color:var(--critical); padding:10px; border-radius:8px; cursor:pointer; font-weight:bold">${t("diffModeOff")}</button>` : `<button onclick="dashboard.toggleDiffMode('${h.date}')" style="flex:2; border:1px solid var(--stable); background:none; color:var(--stable); padding:10px; border-radius:8px; cursor:pointer; font-weight:bold">↔️ ${t("compare")}</button>`}
            <button onclick="loadSnapshot('${h.date}')" style="flex:2; border:1px solid var(--primary); background:none; color:var(--primary); padding:10px; border-radius:8px; cursor:pointer; font-weight:bold">${t("viewData")}</button>
            <button onclick="quickPrintSnapshot('${h.date}')" title="Direct Print" style="flex:1; border:1px solid var(--border); background:rgba(0,0,0,0.03); color:var(--text); padding:10px; border-radius:8px; cursor:pointer; font-size:1rem">🖨️</button>
          </div>
        </div>
      `,
    )
    .join("");
  document.getElementById("history-list").innerHTML =
    html || "<p>No archives found yet.</p>";
}

window.selectCurrentWeek = selectCurrentWeek;
function selectCurrentWeek() {
  if (weeklyArchives && weeklyArchives.length > 0) {
    // Assuming the backend returns reports in descending date order
    void loadSnapshot(weeklyArchives[0].date);
  }
}

window.loadCumulative = loadCumulative;
async function loadCumulative(type) {
  document.getElementById("loader").style.display = "flex";
  const year = document.getElementById("summary-year").value;
  const month = document.getElementById("summary-month").value;
  const period = `${year}-${month}`; // Construct period for API

  const res = await authenticatedFetch(
    `${WORKER_BASE}/api/summary?type=${type}&year=${year}&month=${month}&lang=${dashboard.state.lang}`,
  );
  const json = await res.json();
  if (!res.ok) {
    document.getElementById("loader").style.display = "none";
    dashboard.addToast("info", json.error || t("noDataForPeriod"));
    return;
  }
  dashboard.state.store = json;
  dashboard.render();
  dashboard.setView("table");
  document.getElementById("loader").style.display = "none";
  dashboard.addToast("success", t("cumulativeReportSuccess", { period }));
}

window.downloadConsolidatedPdf = downloadConsolidatedPdf;
async function downloadConsolidatedPdf() {
  const month = document.getElementById("summary-month").value;
  const year = document.getElementById("summary-year").value;

  const res = await authenticatedFetch(
    `/api/consolidated-pdf?type=monthly&year=${year}&month=${month}`,
  );

  if (res.ok) {
    const blob = await res.blob();
    const downloadUrl = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = downloadUrl;
    a.download = `DoR_Consolidated_${month}_2026.pdf`;
    a.click();
  }
}

window.downloadPdf = downloadPdf;
async function downloadPdf(date) {
  const btn = document.getElementById("official-pdf-btn");
  const originalHtml = btn ? btn.innerHTML : "📥"; // Store original button content
  const t = I18N[dashboard.state.lang];

  try {
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<span class="spinner" style="border-top-color:var(--primary); width:16px; height:16px;"></span> ${t.downloading} 0%`;
    }

    const res = await authenticatedFetch(`/api/snapshot?date=${date}`);

    if (res.ok) {
      const contentLength = res.headers.get("Content-Length");
      if (!contentLength) {
        // Fallback to simple blob if Content-Length is not available
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `DoR_Official_Report_${date}.pdf`;
        a.click();
        if (btn) btn.innerHTML = originalHtml; // Restore button immediately
        return;
      }

      const total = parseInt(contentLength, 10);
      let loaded = 0;
      const reader = res.body.getReader();
      const chunks = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loaded += value.length;
        const percent = Math.round((loaded / total) * 100);
        const dispPerc =
          dashboard.state.lang === "ne" ? toNepaliNumerals(percent) : percent;
        if (btn)
          btn.innerHTML = `<span class="spinner" style="border-top-color:var(--primary); width:16px; height:16px;"></span> ${t.downloading} ${dispPerc}%`;
      }

      const blob = new Blob(chunks, { type: "application/pdf" });
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = downloadUrl;
      a.download = `DoR_Official_Report_${date}.pdf`;
      a.click();
      window.URL.revokeObjectURL(downloadUrl); // Clean up the object URL
    } else {
      dashboard.addToast(
        "error",
        dashboard.state.lang === "en"
          ? "Failed to download PDF archive."
          : "PDF अभिलेख डाउनलोड गर्न असफल भयो।",
      );
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalHtml;
    }
  }
}

window.loadSnapshot = loadSnapshot;
async function loadSnapshot(date) {
  document.getElementById("loader").style.display = "flex";
  const res = await authenticatedFetch(
    `/api/report?date=${date}&lang=${dashboard.state.lang}`,
  );
  const json = await res.json();
  dashboard.state.store = json;
  dashboard.render();
  dashboard.setView("table");
  document.getElementById("loader").style.display = "none";
  dashboard.addToast("info", `Viewing data from ${date}`);
}

async function handleVerification() {
  const params = new URLSearchParams(window.location.search);
  const type = params.get("type");
  const period = params.get("period"); // Format: YYYY-MM or YYYY-MM-DD

  if (!type || !period) return;

  dashboard.setView("verify");
  document.getElementById("loader").style.display = "flex";
  document.getElementById("loader").style.display = "flex";
  const verifyTitle = document.getElementById("verify-title");
  if (verifyTitle)
    verifyTitle.innerText = I18N[dashboard.state.lang].verificationTitle;

  try {
    // Construct internal API call to verify existence in KV (ensure year is passed for summary)
    const endpoint =
      type === "monthly"
        ? `/api/summary?type=monthly&year=${period.split("-")[0]}&month=${period.split("-")[1]}&lang=${dashboard.state.lang}`
        : `/api/report?date=${period}&lang=${dashboard.state.lang}`;
    const res = await authenticatedFetch(endpoint);
    if (res.ok) {
      document.getElementById("verify-msg").innerText =
        I18N[dashboard.state.lang].verifiedSuccess;
      document.getElementById("verify-msg").style.color = "var(--good)";
      document.getElementById("verify-details").innerHTML =
        `<b>Type:</b> ${type.toUpperCase()}<br><b>Period:</b> ${period}<br><b>Status:</b> SYSTEM_MATCH_FOUND`;
    } else {
      throw new Error();
    }
  } catch {
    const verifyMsg = document.getElementById("verify-msg");
    if (verifyMsg) {
      verifyMsg.innerText = I18N[dashboard.state.lang].invalidReport;
      verifyMsg.style.color = "var(--critical)";
    }
  }
  if (document.getElementById("loader"))
    document.getElementById("loader").style.display = "none";
}

window.handleVerification = handleVerification;

window.checkDeepLink = checkDeepLink;
function checkDeepLink() {
  const params = new URLSearchParams(window.location.search);
  const indicatorName = params.get("indicator");
  if (indicatorName && dashboard.state.store) {
    showModal(indicatorName, null, true);
  }
}

window.handleSearch = handleSearch;
function handleSearch(term) {
  const input = document.getElementById("search-input");
  const clearBtn = document.getElementById("clear-search");
  if (term !== undefined) input.value = term;

  const val = input.value.toLowerCase();
  if (dashboard.state.search === val) return;

  // Debounce logic to prevent lag during typing
  if (this.searchTimeout) clearTimeout(this.searchTimeout);
  this.searchTimeout = setTimeout(() => {
    dashboard.state.search = val;

    if (clearBtn)
      clearBtn.style.display = dashboard.state.search ? "block" : "none";

    // Populate suggestions from the first column (Indicators)
    if (dashboard.state.store?.headers?.length > 0) {
      const indicatorKey = dashboard.state.store.headers[0];
      const dl = document.getElementById("search-suggestions");
      if (dl) {
        const matches = dashboard.state.store.rows
          .map((r) => String(r[indicatorKey] || ""))
          .filter((v) => v.toLowerCase().includes(dashboard.state.search))
          .slice(0, 10);
        dl.innerHTML = [...new Set(matches)]
          .map((m: string) => `<option value="${m}">`)
          .join("");
      }
    }

    if (dashboard.state.store) dashboard.render();
  }, 150);
}

window.sortData = sortData;
function sortData(key) {
  if (dashboard.state.sort.key === key) dashboard.state.sort.dir *= -1;
  else {
    dashboard.state.sort.key = key;
    dashboard.state.sort.dir = 1;
  }
  dashboard.render();
}

window.shareApp = shareApp;
function shareApp() {
  if (navigator.share) {
    void navigator.share({
      title: "DoR MIS Dashboard",
      text: "Check the latest Department of Roads Progress Report.",
      url: window.location.href,
    });
  } else {
    // Fallback for browsers that don't support Web Share API
    navigator.clipboard.writeText(window.location.href); // Copy URL to clipboard
    alert(I18N[dashboard.state.lang].linkCopied); // Use localized alert message
  }
}

window.getProgress = getProgress;
function getProgress(row, headers) {
  const targetKey = headers.find(
    (h) => h.includes("Annual Target") || h.includes("बार्षिक लक्ष्य"),
  );
  const progKey = headers.find(
    (h) =>
      h.includes("Annual Progress") || h.includes("हाल सम्म को बार्षिक प्रगति"),
  );

  const t = parseFloat(String(row[targetKey] || "0").replace(/,/g, ""));
  const p = parseFloat(String(row[progKey] || "0").replace(/,/g, ""));

  return t > 0 ? Math.round((p / t) * 100) : 0;
}

window.renderMiniChart = renderMiniChart;
function renderMiniChart(percent, showTrend = false) {
  const color =
    percent >= 80
      ? "var(--good)"
      : percent >= 40
        ? "var(--stable)"
        : "var(--critical)";
  const trendIcon =
    percent >= 80
      ? '<span style="color:var(--good); font-size:0.6rem; margin-left:2px;">▲</span>'
      : percent < 40
        ? '<span style="color:var(--critical); font-size:0.6rem; margin-left:2px;">▼</span>'
        : '<span style="color:var(--stable); font-size:0.6rem; margin-left:2px;">▶</span>';

  return `
    <div style="display:flex; align-items:center; position:relative;">
    <svg width="22" height="22" viewBox="0 0 36 36" style="flex-shrink:0">
      <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="var(--border)" stroke-width="4" />
      <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="${color}" stroke-width="4" stroke-dasharray="${percent}, 100" stroke-linecap="round" />
    </svg>
    ${showTrend ? trendIcon : ""}
    </div>`;
}

window.renderSparkline = renderSparkline;
function renderSparkline(annPerc, totPerc) {
  const color =
    annPerc >= 80
      ? "var(--good)"
      : annPerc >= 40
        ? "var(--stable)"
        : "var(--critical)";
  // Simple 2-point trend path
  const p1 = 40 - annPerc * 0.4;
  const p2 = 40 - totPerc * 0.4;

  return `
    <div class="sparkline-container" style="width:100%; height:40px; background:rgba(0,0,0,0.02); border-radius:8px; padding:4px; margin:10px 0;">
      <svg width="100%" height="100%" viewBox="0 0 100 40" preserveAspectRatio="none">
        <defs>
          <linearGradient id="sparkGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="${color}" stop-opacity="0.2" />
            <stop offset="100%" stop-color="${color}" stop-opacity="0" />
          </linearGradient>
        </defs>
        <path d="M0,40 L0,${p1} L50,${p1} L100,${p2} L100,40 Z" fill="url(#sparkGradient)" />
        <polyline points="0,${p1} 50,${p1} 100,${p2}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
        <circle cx="0" cy="${p1}" r="3" fill="${color}" />
        <circle cx="50" cy="${p1}" r="2" fill="${color}" opacity="0.5" />
        <circle cx="100" cy="${p2}" r="3" fill="${color}" />
      </svg>
    </div>
  `;
}

window.showModal = showModal;
function showModal(indicatorName) {
  const r = dashboard.state.store.rows.find(
    (row) => row[dashboard.state.store.headers[0]] === indicatorName,
  );
  if (!r) return;
  const headers = dashboard.state.store.headers;
  const progress = getProgress(r, headers);
  const totTargetKey = headers.find(
    (h) => h.includes("Total Target") || h.includes("कुल लक्ष्य"),
  );
  const totProgKey = headers.find(
    (h) => h.includes("Total Progress") || h.includes("कुल प्रगति"),
  );
  const totT = parseFloat(String(r[totTargetKey] || "0").replace(/,/g, ""));
  const totP = parseFloat(String(r[totProgKey] || "0").replace(/,/g, ""));
  const totPerc = totT > 0 ? Math.round((totP / totT) * 100) : 0;

  const dispProg =
    dashboard.state.lang === "ne" ? toNepaliNumerals(progress) : progress;

  let details = "";
  headers.forEach((h) => {
    if (r[h])
      details += `<div class="modal-item"><b>${h}</b> ${dashboard.state.lang === "ne" ? toNepaliNumerals(r[h]) : r[h]}</div>`; // Use textContent for safety
  });

  document.getElementById("modal-body").innerHTML = `
    <div class="modal-header">
      <div style="display:flex; justify-content:space-between; align-items:start">
        <h3 style="margin:0">${t(r[headers[0]])}</h3>
        <span style="font-size:0.6rem;background:var(--bg);padding:4px 10px;border-radius:6px;font-weight:bold;color:var(--primary)">${dispProg}% DONE</span>
      </div>
      <div style="margin-top:20px; text-align:center">
        <div style="font-size:0.65rem; color:var(--text-light); text-transform:uppercase; margin-bottom:10px; font-weight:800;">Detailed Trend Analysis</div>
        ${renderSparkline(progress, totPerc)} <!-- Reusing sparkline logic for larger view -->
        <div style="height:8px; background:var(--bg); border-radius:10px; overflow:hidden; border:1px solid var(--border); margin-top:10px;">
          <div style="width:${progress}%; height:100%; background:var(--primary); transition:width 1s"></div>
        </div>
      </div>
    </div>
    <div class="modal-grid">${details}</div> 
    <p id="modal-insight" style="margin-top:20px; padding:15px; background:var(--bg); border-radius:12px; border:1px solid var(--border); font-style:italic; color:var(--text-light)"></p>
  `;
  document.getElementById("modal-indicator-title").textContent = t(
    r[headers[0]],
  );
  document.getElementById("modal-insight").textContent = r._insight || ""; // Use textContent for safety
  document.getElementById("modal-overlay").style.display = "flex";
}
window.closeModal = closeModal;

function closeModal() {
  document.getElementById("modal-overlay").style.display = "none";
  document
    .querySelectorAll(".selected-row")
    .forEach((node) => node.classList.remove("selected-row"));
}

window.checkForUpdates = async () => {
  if (!("serviceWorker" in navigator)) return;

  const btn = document.getElementById("update-check-btn");
  if (btn) btn.disabled = true;

  dashboard.addToast(
    "info",
    dashboard.state.lang === "en"
      ? "Checking for updates..."
      : "अपडेट जाँच गर्दै...",
  );

  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg) {
      await reg.update();
      // If an update is found, the 'updatefound' event listener
      // we previously added will trigger the persistent update toast.
      setTimeout(() => {
        if (!reg.installing && !reg.waiting) {
          dashboard.addToast(
            "success",
            dashboard.state.lang === "en"
              ? "App is up to date."
              : "एप अद्यावधिक छ।",
          );
          if (btn) btn.disabled = false;
        }
      }, 2000);
    }
  } catch {
    dashboard.addToast("error", "Update check failed.");
    if (btn) btn.disabled = false;
  }
};

async function getSwChangelog() {
  if (!navigator.serviceWorker?.controller) return null;
  return new Promise((resolve) => {
    const messageChannel = new MessageChannel();
    messageChannel.port1.onmessage = (event) => resolve(event.data.changelog);
    navigator.serviceWorker.controller.postMessage(
      { action: "get-changelog" },
      [messageChannel.port2],
    );
    // Fallback after 1s to prevent UI hang
    setTimeout(() => resolve(null), 1000);
  });
}

async function getActiveSwVersion() {
  if (!navigator.serviceWorker?.controller) return "v2.0.x";
  return new Promise((resolve) => {
    const messageChannel = new MessageChannel();
    messageChannel.port1.onmessage = (event) => resolve(event.data.version);
    navigator.serviceWorker.controller.postMessage({ action: "get-version" }, [
      messageChannel.port2,
    ]);
    setTimeout(() => resolve("v2.0.x"), 1000);
  });
}

/**
 * Requests the Snapshot Key from the user via a custom modal.
 */
async function requestSnapshotKey(): Promise<string | null> {
  if (APP_ENV !== "production") return "dev-bypass";

  const cached = sessionStorage.getItem("_snapshot_key");
  if (cached) return cached;

  return new Promise((resolve) => {
    const modalBody = document.getElementById("modal-body");
    const overlay = document.getElementById("modal-overlay");
    if (!modalBody || !overlay) return resolve(null);

    modalBody.innerHTML = `
      <div class="modal-header">
        <h3 style="margin:0; color:var(--primary)">🔐 ${t("authRequired") || "Authentication Required"}</h3>
        <p style="font-size:0.8rem; opacity:0.7; margin-top:5px;">Please enter the Snapshot Key to authorize this administrative action.</p>
      </div>
      <div style="padding: 20px 0;">
        <input type="password" id="snapshot-key-input" placeholder="••••••••" 
          style="width: 100%; padding: 14px; border-radius: 12px; border: 1px solid var(--border); background: var(--bg); color: var(--text); outline: none; font-size: 1.1rem; text-align: center; letter-spacing: 0.2em;">
      </div>
      <div style="display:flex; gap:10px;">
        <button id="snapshot-key-submit" class="retry-btn" style="flex:1; margin:0;">${t("authorize") || "Authorize"}</button>
        <button id="snapshot-key-cancel" class="toggle-btn" style="flex:1; border:1px solid var(--border);">${t("cancel")}</button>
      </div>
    `;

    overlay.style.display = "flex";
    const input = document.getElementById(
      "snapshot-key-input",
    ) as HTMLInputElement;
    input.focus();

    const closeAndResolve = (val: string | null) => {
      if (val) sessionStorage.setItem("_snapshot_key", val);
      overlay.style.display = "none";
      resolve(val);
    };

    document
      .getElementById("snapshot-key-submit")
      ?.addEventListener("click", () => closeAndResolve(input.value.trim()));
    document
      .getElementById("snapshot-key-cancel")
      ?.addEventListener("click", () => closeAndResolve(null));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") closeAndResolve(input.value.trim());
      if (e.key === "Escape") closeAndResolve(null);
    });
  });
}

// PDF Snapshot Code// PDF Snapshot Management Functions
let snapshotList: any[] = [];
window.createSnapshotManual = async (e) => {
  const btn = e?.target || document.getElementById("create-snapshot-btn");
  const originalText = btn.innerText;
  btn.innerText = "Creating...";
  btn.disabled = true;
  try {
    const snapshotKey = await requestSnapshotKey();
    if (!snapshotKey) {
      btn.innerText = originalText;
      btn.disabled = false;
      return;
    }

    if (!dashboard.state.store) {
      dashboard.addToast("error", "No data");
      btn.innerText = originalText;
      btn.disabled = false;
      return;
    }
    const response = await fetch(WORKER_BASE + "/api/snapshot", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Snapshot-Key": snapshotKey,
      },
      body: JSON.stringify({
        records: dashboard.state.store.rows || [],
        meta: {
          lastUpdate:
            dashboard.state.store.lastUpdate ||
            new Date().toISOString().split("T")[0],
          total: dashboard.state.store.rows?.length || 0,
        },
      }),
    });
    if (response.ok) {
      await response.json();
      dashboard.addToast("success", "Snapshot created!");
      listSnapshots(true);
    } else {
      const errorData = await response
        .json()
        .catch(() => ({ error: "Unknown error" }));
      dashboard.addToast(
        "error",
        errorData.error || "Failed to create snapshot",
      );
    }
  } catch (e) {
    console.error("Error creating snapshot:", e);
    dashboard.addToast("error", "An unexpected error occurred.");
  } finally {
    btn.innerText = originalText;
    btn.disabled = false;
  }
};
window.listSnapshots = async (force) => {
  const container = document.getElementById("snapshot-list-container");
  const listEl = document.getElementById("snapshot-list");
  if (container.style.display !== "none" && !force) {
    container.style.display = "none";
    return;
  }
  try {
    const snapshotKey = await requestSnapshotKey();
    if (!snapshotKey) return;

    const response = await fetch(WORKER_BASE + "/api/snapshots", {
      headers: { "X-Snapshot-Key": snapshotKey },
    });
    if (!response.ok) {
      dashboard.addToast("error", "Failed");
      return;
    }
    const data = await response.json();
    snapshotList = data.snapshots || []; // Assuming the API returns { snapshots: [...] }
    if (snapshotList.length === 0) {
      listEl.innerHTML = "<p style='font-size: 0.7rem;'>No snapshots</p>";
    } else {
      // Sort snapshots by date in descending order for better readability
      snapshotList.sort((a, b) => b.date.localeCompare(a.date));
      listEl.innerHTML = snapshotList
        .map(function (s) {
          return (
            "<div style='background: var(--bg); border-radius: 8px; padding: 10px; border: 1px solid var(--border); margin-bottom: 8px;'>" +
            "<div style='display: flex; justify-content: space-between; margin-bottom: 5px;'><span style='font-size: 0.75rem; font-weight: 800; color: var(--primary);'>" +
            s.date +
            "</span></div>" +
            "<div style='font-size: 0.65rem; color: var(--text-light);'>Records: " +
            s.recordCount +
            "</div>" +
            "<div style='display: flex; gap: 5px;'>" +
            "<button onclick='downloadSnapshot(\"" +
            s.date +
            "\")' class='toggle-btn' style='flex: 1; padding: 5px; font-size: 0.65rem; border: 1px solid var(--primary); background: transparent; color: var(--primary); cursor: pointer;'>Download</button>" +
            "<button onclick='deleteSnapshot(\"" +
            s.date +
            "\")' class='toggle-btn' style='flex: 1; padding: 5px; font-size: 0.65rem; border: 1px solid var(--critical); background: transparent; color: var(--critical); cursor: pointer;'>Delete</button>" +
            "</div></div>"
          );
        })
        .join("");
    }
    container.style.display = "block";
  } catch (e) {
    console.error("Error listing snapshots:", e);
    dashboard.addToast("error", "An unexpected error occurred.");
  }
};
window.downloadSnapshot = async (date) => {
  const snapshotKey = await requestSnapshotKey();
  if (!snapshotKey) return;

  try {
    const response = await fetch(WORKER_BASE + "/api/snapshot?date=" + date, {
      headers: { "X-Snapshot-Key": snapshotKey },
    });
    if (!response.ok) {
      const errorData = await response
        .json()
        .catch(() => ({ error: "Unknown error" }));
      dashboard.addToast(
        "error",
        errorData.error || "Failed to download snapshot",
      );
      return;
    }
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "DoR_Snapshot_" + date + ".pdf";
    a.click();
    window.URL.revokeObjectURL(url);
    dashboard.addToast("success", "Downloaded");
  } catch (e: any) {
    console.error("Error downloading snapshot:", e);
    dashboard.addToast("error", e.message || "An unexpected error occurred.");
  }
};
window.deleteSnapshot = async (date) => {
  if (!confirm("Delete " + date + "?")) return;
  const snapshotKey = await requestSnapshotKey();
  if (!snapshotKey) return;

  try {
    const response = await fetch(WORKER_BASE + "/api/snapshot?date=" + date, {
      method: "DELETE",
      headers: { "X-Snapshot-Key": snapshotKey },
    });
    if (response.ok) {
      dashboard.addToast("success", "Deleted");
      listSnapshots(true);
    } else {
      const errorData = await response
        .json()
        .catch(() => ({ error: "Unknown error" }));
      dashboard.addToast(
        "error",
        errorData.error || "Failed to delete snapshot",
      );
    }
  } catch (e) {
    console.error("Error deleting snapshot:", e);
    dashboard.addToast("error", "An unexpected error occurred.");
  }
};

window.showSettings = async () => {
  const t = I18N[dashboard.state.lang];
  originalTheme = document.body.getAttribute("data-theme") || "light";
  const isLowData = localStorage.getItem("low-data") === "true";
  const isSystemFont = localStorage.getItem("system-font") === "true";
  const fontMultiplier = localStorage.getItem("font-multiplier") || "1";
  const isSchedule = localStorage.getItem("theme-schedule") === "true";
  const speechPitch = localStorage.getItem("tts-pitch") || "1.0";
  const speechRate = localStorage.getItem("tts-rate") || "0.95";
  const isHighContrast = localStorage.getItem("high-contrast") === "true";
  const isGrayscale = localStorage.getItem("grayscale") === "true";
  const isSepia = localStorage.getItem("blue-light") === "true";
  const swVersion = await getActiveSwVersion();

  const isAuthorized = !!sessionStorage.getItem("_snapshot_key");
  const authStatusBadge = isAuthorized
    ? `<span style="margin-left: 8px; font-size: 0.55rem; color: var(--good); border: 1px solid var(--good); padding: 2px 6px; border-radius: 4px; vertical-align: middle; font-weight: 900; letter-spacing: 0.05em; background: rgba(74, 222, 128, 0.1); display: inline-flex; align-items: center; gap: 6px;">
        ACTIVE SESSION 
        <span onclick="logoutSnapshotSession(); event.stopPropagation();" style="cursor: pointer; opacity: 0.6; font-size: 0.7rem; border-left: 1px solid var(--good); padding-left: 6px;" title="Logout">✕</span>
      </span>`
    : "";

  // Clear the "New Feature" badge
  localStorage.setItem("app-version-seen", swVersion);
  document.getElementById("settings-btn")?.classList.remove("has-badge");

  // Get available voices and filter by current language
  const voices = speechSynthesis.getVoices();
  const langPrefix = dashboard.state.lang === "ne" ? "ne" : "en";
  const filteredVoices = voices.filter((v) => v.lang.startsWith(langPrefix));
  const savedVoiceUri = localStorage.getItem("tts-voice-uri");

  let voiceOptions = filteredVoices
    .map(
      (v) =>
        `<option value="${v.voiceURI}" ${v.voiceURI === savedVoiceUri ? "selected" : ""}>${v.name} (${v.lang})</option>`,
    )
    .join("");

  // If no language-specific voices found, show all as fallback
  if (!voiceOptions) {
    voiceOptions = voices
      .map(
        (v) =>
          `<option value="${v.voiceURI}" ${v.voiceURI === savedVoiceUri ? "selected" : ""}>${v.name} (${v.lang})</option>`,
      )
      .join("");
  }

  const changelog = await getSwChangelog();

  const modalBody = document.getElementById("modal-body");
  modalBody.innerHTML = `
        <div class="modal-header">
          <div style="display:flex; justify-content:space-between; align-items:center">
            <h3 style="margin:0">${t("settings")}</h3>
            <span style="font-size:0.6rem; opacity:0.6; font-weight:800; background:var(--bg); padding:2px 8px; border-radius:10px;">
              ${t.appVersion}: ${dashboard.state.lang === "ne" ? toNepaliNumerals(APP_VERSION) : APP_VERSION}
            </span>
          </div>
        </div>
        <div style="padding: 10px 0;">
          ${changelog
      ? `
            <div style="margin-bottom: 20px; background: var(--bg); border-radius: 12px; padding: 12px; border: 1px solid var(--border);">
              <div style="font-size: 0.7rem; font-weight: 800; color: var(--primary); text-transform: uppercase; margin-bottom: 8px;">✨ ${t.whatsNew}</div>
              <div style="max-height: 120px; overflow-y: auto; font-size: 0.75rem; scrollbar-width: thin;">
                ${Object.entries(changelog)
        .slice(0, 3)
        .map(
          ([v, changes]) => `
                  <div style="margin-bottom: 10px;">
                    <b style="color: var(--text-light)">Version ${v}</b>
                    <ul style="margin: 4px 0 0 15px; padding: 0; list-style-type: disc; color: var(--text);">
                      ${changes.map((c) => `<li>${c}</li>`).join("")}
                    </ul>
                  </div>
                `,
        )
        .join("")}
              </div>
            </div>
          `
      : ""
    }
          <label style="font-size: 0.7rem; font-weight: 800; text-transform: uppercase; color: var(--text-light); margin-bottom: 10px; display: block;">${t("theme")}</label>
          <div class="theme-selector">
            <div class="theme-option light-opt ${originalTheme === "light" ? "active" : ""}" data-theme="light">
              <div class="mini-dash"></div>
              <span>${t("themeLight")}</span>
            </div>
            <div class="theme-option dark-opt ${originalTheme === "dark" ? "active" : ""}" data-theme="dark">
              <div class="mini-dash"></div>
              <span>${t("themeDark")}</span>
            </div>
          </div>
          <div style="margin-top: 20px; padding: 12px; background: var(--bg); border-radius: 12px; border: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between;">
            <div style="text-align: left;">
              <div style="font-size: 0.8rem; font-weight: 800; color: var(--text);">${t("lowData")}</div>
              <div style="font-size: 0.65rem; color: var(--text-light);">${t("lowDataDesc")}</div>
            </div>
            <label class="toggle-btn" style="padding: 4px; display: flex; align-items: center; gap: 8px; cursor: pointer;">
              <input type="checkbox" id="low-data-toggle" ${isLowData ? "checked" : ""} style="width: 18px; height: 18px; cursor: pointer; accent-color: var(--primary);">
            </label>
          </div>
          <div style="margin-top: 15px; padding: 12px; background: var(--bg); border-radius: 12px; border: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between;">
            <div style="text-align: left;">
              <div style="font-size: 0.8rem; font-weight: 800; color: var(--text);">${t("darkSchedule")}</div>
              <div style="font-size: 0.65rem; color: var(--text-light);">${t("darkScheduleDesc")}</div>
            </div>
            <label class="toggle-btn" style="padding: 4px; display: flex; align-items: center; gap: 8px; cursor: pointer;">
              <input type="checkbox" id="dark-schedule-toggle" ${isSchedule ? "checked" : ""} style="width: 18px; height: 18px; cursor: pointer; accent-color: var(--primary);">
            </label>
          </div>
          <div style="margin-top: 15px; padding: 12px; background: var(--bg); border-radius: 12px; border: 1px solid var(--border);">
            <div style="text-align: left; margin-bottom: 10px;">
              <div style="font-size: 0.8rem; font-weight: 800; color: var(--text);">${t("musicSelection")}</div>
            </div>
            <select id="music-track-select" style="width: 100%; padding: 8px; border-radius: 8px; border: 1px solid var(--border); background: var(--surface); color: var(--text); font-size: 0.75rem; outline: none;">
              <option value="/ambient-focus.mp3" ${localStorage.getItem("music-track") === "/ambient-focus.mp3" ? "selected" : ""}>Focus Ambient</option>
              <option value="/ambient-calm.mp3" ${localStorage.getItem("music-track") === "/ambient-calm.mp3" ? "selected" : ""}>Calm Reflection</option>
            </select>
          </div>
          <div style="margin-top: 15px; padding: 12px; background: var(--bg); border-radius: 12px; border: 1px solid var(--border);">
            <div style="text-align: left; margin-bottom: 10px;">
              <div style="font-size: 0.8rem; font-weight: 800; color: var(--text);">${t("voiceSelection")}</div>
              <div style="font-size: 0.65rem; color: var(--text-light);">${t("voiceDesc")}</div>
            </div>
            <select id="tts-voice-select" style="width: 100%; padding: 8px; border-radius: 8px; border: 1px solid var(--border); background: var(--surface); color: var(--text); font-size: 0.75rem; outline: none;">
              <option value="">Default System Voice</option>
              ${voiceOptions}
            </select>
          </div>
          <div style="margin-top: 15px; padding: 12px; background: var(--bg); border-radius: 12px; border: 1px solid var(--border);">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
              <div style="text-align: left;">
                <div style="font-size: 0.8rem; font-weight: 800; color: var(--text);">${t("speechPitch")}</div>
                <div style="font-size: 0.65rem; color: var(--text-light);">${t("speechPitchDesc")}</div>
              </div>
              <div id="speech-pitch-val" style="font-size: 0.8rem; font-weight: 800; color: var(--primary);">${dashboard.state.lang === "ne" ? toNepaliNumerals(speechPitch) : speechPitch}x</div>
            </div> 
            <input type="range" id="tts-pitch-slider" min="0.5" max="2.0" step="0.05" value="${speechPitch}" style="width:100%; height:6px; accent-color: var(--primary); background:var(--surface); border-radius:3px; outline:none; cursor:pointer;">
          </div>
          <div style="margin-top: 15px; padding: 12px; background: var(--bg); border-radius: 12px; border: 1px solid var(--border);">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
              <div style="text-align: left;">
                <div style="font-size: 0.8rem; font-weight: 800; color: var(--text);">${t("speechRate")}</div>
                <div style="font-size: 0.65rem; color: var(--text-light);">${t("speechRateDesc")}</div>
              </div>
              <div id="speech-rate-val" style="font-size: 0.8rem; font-weight: 800; color: var(--primary);">${dashboard.state.lang === "ne" ? toNepaliNumerals(speechRate) : speechRate}x</div>
            </div> 
            <input type="range" id="tts-rate-slider" min="0.5" max="2.0" step="0.05" value="${speechRate}" style="width:100%; height:6px; accent-color: var(--primary); background:var(--surface); border-radius:3px; outline:none; cursor:pointer;">
          </div>
          <div style="margin-top: 15px; padding: 12px; background: var(--bg); border-radius: 12px; border: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between;">
            <div style="text-align: left;">
              <div style="font-size: 0.8rem; font-weight: 800; color: var(--text);">${t("systemFont")}</div>
              <div style="font-size: 0.65rem; color: var(--text-light);">${t("systemFontDesc")}</div>
            </div>
            <label class="toggle-btn" style="padding: 4px; display: flex; align-items: center; gap: 8px; cursor: pointer;">
              <input type="checkbox" id="system-font-toggle" ${isSystemFont ? "checked" : ""} style="width: 18px; height: 18px; cursor: pointer; accent-color: var(--primary);">
            </label>
          </div>
          <div style="margin-top: 15px; padding: 12px; background: var(--bg); border-radius: 12px; border: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between;">
            <div style="text-align: left;">
              <div style="font-size: 0.8rem; font-weight: 800; color: var(--text);">${t("dbBackup")}</div>
              <div style="font-size: 0.65rem; color: var(--text-light);">${t("dbBackupDesc")}</div>
            </div>
            <button id="db-backup-btn" class="icon-btn" style="width: auto; padding: 0 12px; border-radius: 8px; font-size: 0.7rem; font-weight: 800;">
              BACKUP
            </button>
          </div>
          <div style="margin-top: 15px; padding: 12px; background: var(--bg); border-radius: 12px; border: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between;">
            <div style="text-align: left;">
              <div style="font-size: 0.8rem; font-weight: 800; color: var(--text);">${t("dbRestore")}</div>
              <div style="font-size: 0.65rem; color: var(--text-light);">${t("dbRestoreDesc")}</div>
            </div>
            <button id="db-restore-btn" class="icon-btn" style="width: auto; padding: 0 12px; border-radius: 8px; font-size: 0.7rem; font-weight: 800; color: var(--stable);">
              RESTORE
            </button>
          </div>
          <div style="margin-top: 15px; padding: 12px; background: var(--bg); border-radius: 12px; border: 1px solid var(--border);">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
              <div style="text-align: left;">
                <div style="font-size: 0.8rem; font-weight: 800; color: var(--text);">${t("fontSize")}</div>
                <div style="font-size: 0.65rem; color: var(--text-light);">${t("fontSizeDesc")}</div>
              </div>
              <div id="font-size-val" style="font-size: 0.8rem; font-weight: 800; color: var(--primary);">${dashboard.state.lang === "ne" ? toNepaliNumerals(fontMultiplier) : fontMultiplier}x</div>
            </div> 
            <input type="range" id="font-size-slider" min="0.8" max="1.4" step="0.05" value="${fontMultiplier}" style="width:100%; height:6px; accent-color: var(--primary); background:var(--surface); border-radius:3px; outline:none; cursor:pointer;">
          </div>
          <div style="margin-top: 15px; padding: 12px; background: var(--bg); border-radius: 12px; border: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between;">
            <div style="text-align: left;">
              <div style="font-size: 0.8rem; font-weight: 800; color: var(--text);">${t("highContrast")}</div>
              <div style="font-size: 0.65rem; color: var(--text-light);">${t("highContrastDesc")}</div>
            </div>
            <label class="toggle-btn" style="padding: 4px; display: flex; align-items: center; gap: 8px; cursor: pointer;">
              <input type="checkbox" id="high-contrast-toggle" ${isHighContrast ? "checked" : ""} style="width: 18px; height: 18px; cursor: pointer; accent-color: var(--primary);">
            </label>
          </div>
          <div style="margin-top: 15px; padding: 12px; background: var(--bg); border-radius: 12px; border: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between;">
            <div style="text-align: left;">
              <div style="font-size: 0.8rem; font-weight: 800; color: var(--text);">${t("grayscale")}</div>
              <div style="font-size: 0.65rem; color: var(--text-light);">${t("grayscaleDesc")}</div>
            </div>
            <label class="toggle-btn" style="padding: 4px; display: flex; align-items: center; gap: 8px; cursor: pointer;">
              <input type="checkbox" id="grayscale-toggle" ${isGrayscale ? "checked" : ""} style="width: 18px; height: 18px; cursor: pointer; accent-color: var(--primary);">
            </label>
          </div>
          <div style="margin-top: 15px; padding: 12px; background: var(--bg); border-radius: 12px; border: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between;">
            <div style="text-align: left;">
              <div style="font-size: 0.8rem; font-weight: 800; color: var(--text);">${t("blueLightFilter")}</div>
              <div style="font-size: 0.65rem; color: var(--text-light);">${t("blueLightDesc")}</div>
            </div>
            <label class="toggle-btn" style="padding: 4px; display: flex; align-items: center; gap: 8px; cursor: pointer;">
              <input type="checkbox" id="sepia-toggle" ${isSepia ? "checked" : ""} style="width: 18px; height: 18px; cursor: pointer; accent-color: var(--primary);">
            </label>
          </div>
          <div style="margin-top: 15px;" id="sound-pack-selector">
            <label style="font-size: 0.7rem; font-weight: 800; text-transform: uppercase; color: var(--text-light); margin-bottom: 10px; display: block;">${t("soundPack")}</label>
            <div class="theme-selector">
              <div class="theme-option pack-opt" data-pack="modern"><span>${t("packModern")}</span></div>
              <div class="theme-option pack-opt" data-pack="classic"><span>${t("packClassic")}</span></div>
              <div class="theme-option pack-opt" data-pack="retro"><span>${t("packRetro")}</span></div>
            </div>
          </div>
          <div style="margin-top: 15px;">
            <label style="font-size: 0.7rem; font-weight: 800; text-transform: uppercase; color: var(--text-light); margin-bottom: 8px; display: block;">${t("uiVolume")}</label>
            <div style="display:flex; align-items:center; gap:10px;">
              <input type="range" id="ui-volume-slider" min="0" max="1" step="0.1" value="${dashboard.state.uiVolume}" style="flex:1; height:6px; accent-color: var(--primary); background:var(--bg); border-radius:3px; outline:none; cursor:pointer;">
              <button id="mute-toggle-btn" class="icon-btn" style="width:32px; height:32px; font-size:0.8rem; flex-shrink:0;">${dashboard.state.uiVolume === 0 ? "🔇" : "🔊"}</button>
            </div>
            <!-- Mute All Toggle/Indicator that appears when at zero -->
            <div style="margin-top: 15px;">
              <label style="font-size: 0.7rem; font-weight: 800; text-transform: uppercase; color: var(--text-light); margin-bottom: 8px; display: block;">${t("soundPitch")}</label>
              <input type="range" id="ui-pitch-slider" min="0.5" max="2.0" step="0.1" style="width:100%; height:6px; accent-color: var(--primary); background:var(--bg); border-radius:3px; outline:none; cursor:pointer;">
            </div>
            <div id="mute-all-active" style="display:${dashboard.state.uiVolume === 0 ? "flex" : "none"}; margin-top:10px; align-items:center; justify-content:center; gap:8px; padding:6px; background:rgba(239, 68, 68, 0.1); border:1px solid var(--critical); border-radius:8px; animation: modal-up 0.2s ease-out;">
              <span style="font-size:0.6rem; font-weight:800; color:var(--critical); text-transform:uppercase;">🚫 ${t("muteAll")}</span>
              <button id="unmute-btn" style="background:none; border:none; color:var(--primary); font-size:0.6rem; font-weight:800; cursor:pointer; text-decoration:underline;">UNMUTE</button>
            </div>
            <button id="reset-audio-btn" class="toggle-btn" style="width:100%; margin-top:15px; border:1px solid var(--border); font-size:0.65rem; display:flex; align-items:center; justify-content:center; gap:8px;">
               🔄 ${t("resetAudio")}
            </button>
          </div>
          <button id="reset-theme-btn" class="toggle-btn" style="width: 100%; margin-top: 15px; border: 1px solid var(--border); display: flex; align-items: center; justify-content: center; gap: 8px;">
             🌓 ${t("themeSystem")}
          </button>
          <div style="margin-top: 15px; font-size: 0.7rem; color: var(--text-light); text-align: center; font-weight: 800;">
            ${t("totalCache")}: <span id="storage-usage-val" style="color: var(--primary);">...</span>
          </div>
          <div class="quota-bar-container">
            <div id="storage-quota-bar" class="quota-bar"></div>
          </div>
          <hr style="margin: 15px 0; border: none; border-top: 1px solid var(--border);">
          <div style="display:flex; flex-direction:column; gap:8px;">
            <button id="update-check-btn" class="toggle-btn" style="width: 100%; border: 1px solid var(--primary); display: flex; align-items: center; justify-content: center; gap: 10px;">
              🔄 ${t("checkUpdates")}
            </button>
            <button id="offline-download-btn" class="toggle-btn" style="width: 100%; border: 1px solid var(--primary); display: flex; align-items: center; justify-content: center; gap: 10px;">
              📥 ${t("downloadOffline")}
            </button>
            <button id="clear-cache-btn" class="retry-btn" style="width: 100%; margin:0; display: flex; align-items: center; justify-content: center; gap: 10px;">
              🧹 ${t("clearCache")}
            </button>
            <button id="factory-reset-btn" class="toggle-btn" style="width: 100%; border: 1px solid var(--critical); color: var(--critical); display: flex; align-items: center; justify-content: center; gap: 10px;">
              ⚠️ ${t("resetAll")}
            </button>
         </div>
        </div>
           <hr style="margin: 15px 0; border: none; border-top: 1px solid var(--border);">
           <div style="margin-top: 15px;"> 
             <label style="font-size: 0.7rem; font-weight: 800; text-transform: uppercase; color: var(--text-light); margin-bottom: 10px; display: block;">PDF Snapshots ${authStatusBadge}</label>
             <p style="font-size: 0.65rem; color: var(--text-light); margin-bottom: 10px;">Create and manage PDF snapshots of report data with date-based versioning.</p>
             <div style="display:flex; flex-direction:column; gap:8px;">
               <button id="create-snapshot-btn" class="toggle-btn" style="width: 100%; border: 1px solid var(--primary); display: flex; align-items: center; justify-content: center; gap: 10px; padding: 10px;">
                 Create Snapshot Now
               </button>
               <button id="list-snapshots-btn" class="toggle-btn" style="width: 100%; border: 1px solid var(--primary); display: flex; align-items: center; justify-content: center; gap: 10px; padding: 10px;">
                 List Available Snapshots
               </button>
               ${isAuthorized
      ? `
                 <button onclick="logoutSnapshotSession()" style="background:none; border:none; color:var(--critical); font-size:0.6rem; font-weight:800; cursor:pointer; text-decoration:underline; align-self:flex-end; margin-top:-4px; padding: 4px;">LOGOUT SESSION</button>
               `
      : ""
    }
             </div>
<div id="snapshot-list-container" style="margin-top: 10px; display: none;">
                <div style="font-size: 0.7rem; font-weight: 800; color: var(--text-light); margin-bottom: 8px;">Snapshot History:</div>
                <div id="snapshot-list" style="max-height: 300px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px;"></div>
              </div>
            </div>
            `;
  document.getElementById("modal-overlay").style.display = "flex";

  // Attach event listeners programmatically
  document
    .getElementById("low-data-toggle")
    ?.addEventListener("change", (e) => toggleLowData(e.target.checked));
  document
    .getElementById("dark-schedule-toggle")
    ?.addEventListener("change", (e) => toggleDarkSchedule(e.target.checked));
  document
    .getElementById("tts-voice-select")
    ?.addEventListener("change", (e) => updateVoicePreference(e.target.value));
  document
    .getElementById("music-track-select")
    ?.addEventListener("change", (e) => setMusicTrack(e.target.value));
  document
    .getElementById("tts-pitch-slider")
    ?.addEventListener("input", (e) => updateSpeechPitch(e.target.value));
  document
    .getElementById("tts-rate-slider")
    ?.addEventListener("input", (e) => updateSpeechRate(e.target.value));
  document
    .getElementById("system-font-toggle")
    ?.addEventListener("change", (e) => toggleSystemFont(e.target.checked));
  document
    .getElementById("db-backup-btn")
    ?.addEventListener("click", triggerDatabaseBackup);
  document
    .getElementById("db-restore-btn")
    ?.addEventListener("click", triggerDatabaseRestore);
  document
    .getElementById("font-size-slider")
    ?.addEventListener("input", (e) => updateFontSize(e.target.value));
  document
    .getElementById("high-contrast-toggle")
    ?.addEventListener("change", (e) => toggleHighContrast(e.target.checked));
  document
    .getElementById("grayscale-toggle")
    ?.addEventListener("change", (e) => toggleGrayscale(e.target.checked));
  document
    .getElementById("sepia-toggle")
    ?.addEventListener("change", (e) => toggleSepia(e.target.checked));
  document
    .getElementById("sound-pack-selector")
    ?.addEventListener("click", (e) => {
      const packOption = e.target.closest(".pack-opt");
      if (packOption) setSoundPack(packOption.dataset.pack);
    });
  document
    .getElementById("ui-volume-slider")
    ?.addEventListener("input", (e) => updateVolume(e.target.value));
  document
    .getElementById("mute-toggle-btn")
    ?.addEventListener("click", toggleMute);
  document.getElementById("unmute-btn")?.addEventListener("click", toggleMute);
  document
    .getElementById("reset-audio-btn")
    ?.addEventListener("click", resetAudioToDefault);
  document
    .getElementById("reset-theme-btn")
    ?.addEventListener("click", resetThemeToSystem);
  document
    .getElementById("update-check-btn")
    ?.addEventListener("click", checkForUpdates);
  document
    .getElementById("offline-download-btn")
    ?.addEventListener("click", downloadAllOfflineData);
  document
    .getElementById("clear-cache-btn")
    ?.addEventListener("click", clearDataCache);
  document
    .getElementById("factory-reset-btn")
    ?.addEventListener("click", showFactoryResetConfirmation);
  document
    .getElementById("create-snapshot-btn")
    ?.addEventListener("click", createSnapshotManual);
  document
    .getElementById("list-snapshots-btn")
    ?.addEventListener("click", listSnapshots);

  // Theme selector event delegation
  document.querySelector(".theme-selector")?.addEventListener("click", (e) => {
    const themeOption = e.target.closest(".theme-option");
    if (themeOption) setTheme(themeOption.dataset.theme, true);
  });
  document.querySelector(".theme-selector")?.addEventListener(
    "mouseenter",
    (e) => {
      const themeOption = e.target.closest(".theme-option");
      if (themeOption) setTheme(themeOption.dataset.theme, false);
    },
    true,
  ); // Use capture phase
  document
    .querySelector(".theme-selector")
    ?.addEventListener("mouseleave", revertTheme);

  void updateStorageUsageDisplay(); // Update storage display after modal is rendered
};

/**
 * Extracts all data from IndexedDB and sends a JSON snapshot to Cloudflare KV.
 */
window.triggerDatabaseBackup = async () => {
  const btn = document.getElementById("db-backup-btn");
  if (!btn) return;
  const originalHtml = btn.innerHTML;

  try {
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner" style="border-top-color:var(--primary)"></span>`;

    // 1. Open Database and read all stores
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open("dor_mis_db", 2);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(new Error("IDB_OPEN_FAIL"));
    });

    const stores = ["analytics", "metadata"];
    const snapshot = {
      _meta: {
        timestamp: new Date().toISOString(),
        lang: dashboard.state.lang,
      },
    };

    for (const storeName of stores) {
      if (db.objectStoreNames.contains(storeName)) {
        const tx = db.transaction(storeName, "readonly");
        snapshot[storeName] = await new Promise((r) => {
          const sReq = tx.objectStore(storeName).getAll();
          sReq.onsuccess = () => r(sReq.result);
        });
      }
    }
    db.close();

    // 2. Transmit to Cloudflare Admin endpoint
    let snapshotKey = "dev-bypass";
    if (APP_ENV === "production") {
      snapshotKey =
        prompt(
          dashboard.state.lang === "en"
            ? "Enter Snapshot Key to authorize backup:"
            : "ब्याकअप प्रमाणित गर्न गोप्य कुञ्जी प्रविष्ट गर्नुहोस्:",
        ) || "";
      if (!snapshotKey) throw new Error("CANCELLED");
    }

    const res = await fetch(`${WORKER_BASE}/api/admin/backup-idb`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Snapshot-Key": snapshotKey,
      },
      body: JSON.stringify(snapshot),
    });

    if (res.ok)
      dashboard.addToast(
        "success",
        dashboard.state.lang === "en"
          ? "Cloud backup successful!"
          : "क्लाउड ब्याकअप सफल भयो!",
      );
    else throw new Error("API_FAIL");
  } catch {
    if (e.message !== "CANCELLED")
      dashboard.addToast("error", "Database backup failed.");
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
};

/**
 * Downloads a snapshot from KV and overwrites the local IndexedDB.
 */
window.triggerDatabaseRestore = async () => {
  const btn = document.getElementById("db-restore-btn");
  const originalHtml = btn.innerHTML;

  try {
    let snapshotKey = "dev-bypass";
    if (APP_ENV === "production") {
      snapshotKey =
        prompt(
          dashboard.state.lang === "en"
            ? "Enter Snapshot Key to list backups:"
            : "ब्याकअप सूची हेर्न गोप्य कुञ्जी प्रविष्ट गर्नुहोस्:",
        ) || "";
      if (!snapshotKey) return;
    }

    btn.disabled = true;
    btn.innerHTML = `<span class="spinner" style="border-top-color:var(--primary)"></span>`;

    // 1. Fetch list of available backups
    const listRes = await fetch(`${WORKER_BASE}/api/admin/list-backups`, {
      headers: { "X-Snapshot-Key": snapshotKey },
    });
    const keys = await listRes.json();
    if (!keys.length) {
      dashboard.addToast("info", "No backups found.");
      return;
    }

    const selectedKey = prompt(
      `Select backup to restore:\n${keys.map((k, i) => `${i + 1}. ${k.name}`).join("\n")}`,
      keys[0].name,
    );
    if (!selectedKey) return;

    // 2. Download snapshot
    dashboard.addToast("info", "Downloading snapshot...");
    const dataRes = await fetch(
      `${WORKER_BASE}/api/admin/get-backup?key=${selectedKey}`,
      { headers: { "X-Snapshot-Key": snapshotKey } },
    );
    const snapshot = await dataRes.json();

    // 3. Overwrite local IndexedDB
    const db = await new Promise((resolve) => {
      const req = indexedDB.open("dor_mis_db", 2);
      req.onsuccess = () => resolve(req.result);
    });

    for (const storeName of ["analytics", "metadata"]) {
      if (snapshot[storeName]) {
        const tx = db.transaction(storeName, "readwrite");
        const store = tx.objectStore(storeName);
        store.clear();
        snapshot[storeName].forEach((item) => store.add(item));
        await new Promise((r) => (tx.oncomplete = r));
      }
    }
    db.close();

    dashboard.addToast(
      "success",
      dashboard.state.lang === "en"
        ? "Database successfully restored!"
        : "डाटाबेस सफलतापूर्वक रिस्टोर गरियो!",
    );
    setTimeout(() => window.location.reload(), 1500);
  } catch (e) {
    console.error(e);
    dashboard.addToast("error", "Database restore failed.");
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
};

/**
 * Systematic pre-fetching of all critical data to ensure 100% offline availability.
 * Leverages the existing Service Worker's DATA_CACHE logic.
 */
window.downloadAllOfflineData = async () => {
  const btn = document.getElementById("offline-download-btn");
  const t = I18N[dashboard.state.lang];
  const originalHtml = btn.innerHTML;

  try {
    btn.disabled = true;

    // 1. Determine scope (fetch list of archives first)
    const histRes = await authenticatedFetch(`/api/reports`);
    const archives = histRes?.ok ? await histRes.json() : [];
    const snapshots = archives.slice(0, 5); // Cache the last 5 weeks

    const totalSteps = 3 + snapshots.length; // List + 2 languages + N snapshots
    let currentStep = 1;

    const updateProgress = () => {
      const percent = Math.round((currentStep / totalSteps) * 100);
      const dispPerc =
        dashboard.state.lang === "ne" ? toNepaliNumerals(percent) : percent;
      btn.innerHTML = `<span class="spinner" style="border-top-color:var(--primary)"></span> ${t.downloading} ${dispPerc}%`;
    };

    updateProgress();

    // 2. Pre-fetch main reports for both languages
    await authenticatedFetch(`/api/report?lang=ne`);
    currentStep++;
    updateProgress();

    await authenticatedFetch(`/api/report?lang=en`);
    currentStep++;
    updateProgress();

    // 3. Pre-fetch snapshots sequentially to avoid rate-limiting
    for (const entry of snapshots) {
      await authenticatedFetch(
        `/api/report?date=${entry.date}&lang=${dashboard.state.lang}`,
      );
      currentStep++;
      updateProgress();
    }

    dashboard.addToast("success", t.downloadComplete);
    void updateStorageUsageDisplay();
  } catch {
    dashboard.addToast("error", "Offline download interrupted.");
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
};

async function updateStorageUsageDisplay() {
  const el = document.getElementById("storage-usage-val");
  if (!el) return;

  if (navigator.storage?.estimate) {
    const { usage, quota } = await navigator.storage.estimate();

    const formatSize = (bytes) => {
      let val, unit;
      if (bytes < 1024) {
        val = bytes;
        unit = " B";
      } else if (bytes < 1048576) {
        val = (bytes / 1024).toFixed(1);
        unit = " KB";
      } else {
        val = (bytes / 1048576).toFixed(2);
        unit = " MB";
      }

      const dispVal =
        dashboard.state.lang === "ne" ? toNepaliNumerals(val) : val;
      return dispVal + unit;
    };

    const percent = quota ? (usage / quota) * 100 : 0;
    const displayPercent = percent.toFixed(2);

    // Visual bar logic: ensure at least 1% visibility if data exists
    const barPercent = usage > 0 && percent < 1 ? 1 : percent;

    const usedStr = formatSize(usage);
    const dispPerc =
      dashboard.state.lang === "ne"
        ? toNepaliNumerals(displayPercent)
        : displayPercent;

    el.innerText = `${usedStr} (${dispPerc}%)`;

    const bar = document.getElementById("storage-quota-bar");
    if (bar) {
      bar.style.width = `${barPercent}%`;
      bar.style.background =
        percent > 80 ? "var(--critical)" : "var(--primary)";
    }
  } else {
    el.innerText = "N/A";
  }
}

window.clearDataCache = () => {
  // Clear authentication session for snapshots
  sessionStorage.removeItem("_snapshot_key");

  if (navigator.serviceWorker?.controller) {
    // Communicate with Service Worker to clear the correct cache (dor-data-v2)
    navigator.serviceWorker.controller.postMessage({
      action: "clear-data-cache",
    });
    dashboard.addToast(
      "success",
      dashboard.state.lang === "en"
        ? "Total cache and session cleared!"
        : "सबै क्यास र सेसन मेटाइयो!",
    );
    setTimeout(() => dashboard.loadData(true), 500);
  } else {
    dashboard.addToast("error", "Service Worker unavailable");
  }
};

window.showFactoryResetConfirmation = () => {
  const t = I18N[dashboard.state.lang];
  dashboard.audio.playUi("pop");

  document.getElementById("modal-body").innerHTML = `
        <div class="modal-header">
          <h3 style="color:var(--critical); margin:0;">⚠️ ${t.resetAll}</h3>
        </div>
        <div style="padding: 20px 0; text-align: center;">
          <p style="font-weight: 800; color: var(--text); font-size: 1.1rem;">${t.resetConfirm}</p>
          <p style="font-size: 0.8rem; color: var(--text-light); margin-top: 10px; line-height: 1.5;">
            ${dashboard.state.lang === "en"
      ? "This action is irreversible. All cached road reports, offline data, theme preferences, and audio settings will be permanently deleted."
      : "यो कार्य अपरिवर्तनीय छ। सबै क्यास गरिएका सडक प्रतिवेदनहरू, अफलाइन डेटा, थिम प्राथमिकताहरू, र ध्वनि सेटिङहरू स्थायी रूपमा मेटिनेछन्।"
    }
          </p>
        </div>
        <div style="display:flex; flex-direction:column; gap:10px;">
          <button onclick="executeFactoryReset()" class="retry-btn" style="width:100%; background:var(--critical); margin:0; padding:15px;">
            ${dashboard.state.lang === "en" ? "Yes, Wipe Everything" : "हो, सबै मेटाउनुहोस्"}
          </button>
          <button onclick="showSettings()" class="toggle-btn" style="width:100%; border:1px solid var(--border); padding:12px;">
            ${dashboard.state.lang === "en" ? "Cancel" : "रद्द गर्नुहोस्"}
          </button>
        </div>
      `;
};

window.executeFactoryReset = executeFactoryReset;

/**
 * Performs a complete "Factory Reset" of the application state.
 * Clears LocalStorage, Caches, and IndexedDB.
 */
async function executeFactoryReset() {
  document.getElementById("modal-body").innerHTML = `
        <div style="text-align:center; padding: 40px 0;">
          <span class="spinner" style="border-top-color:var(--primary); width:30px; height:30px;"></span>
          <p style="margin-top:20px; font-weight:800;">Resetting System...</p>
        </div>
      `;

  // 1. Clear LocalStorage (Themes, Lang, Install State)
  localStorage.clear();
  sessionStorage.removeItem("_snapshot_key");

  // Immediate UI Reset (Remove all accessibility and theme layers)
  document.body.removeAttribute("data-theme");
  document.body.removeAttribute("data-font");
  document.body.removeAttribute("data-contrast");
  document.body.removeAttribute("data-grayscale");
  document.body.removeAttribute("data-sepia");
  document.documentElement.style.removeProperty("--font-multiplier");

  // 2. Clear all Caches (Static Shell and API Data)
  if ("caches" in window) {
    const names = await caches.keys();
    await Promise.all(names.map((name) => caches.delete(name)));
  }

  // 3. Clear IndexedDB (Offline Analytics Queue)
  if (window.indexedDB) {
    indexedDB.deleteDatabase("dor_mis_db");
  }

  dashboard.addToast("info", "Resetting application...");

  // 4. Force reload from server bypassing any potential remaining cache
  setTimeout(() => {
    window.location.href = window.location.origin;
  }, 1000);
}

window.toggleLowData = (enabled) => {
  localStorage.setItem("low-data", enabled);
  if (enabled) {
    dashboard.addToast(
      "info",
      dashboard.state.lang === "en"
        ? "Low Data Mode active. AI Briefing disabled."
        : "कम डाटा मोड सक्रिय। एआई सारांश असक्षम गरियो।",
    );
  }
  // Immediately re-render the dashboard to reflect the change
  if (dashboard.state.store) dashboard.render();
};

window.toggleSystemFont = (enabled) => {
  localStorage.setItem("system-font", enabled);
  document.body.setAttribute("data-font", enabled ? "system" : "branded");
};

window.updateFontSize = (val) => {
  document.documentElement.style.setProperty("--font-multiplier", val);
  localStorage.setItem("font-multiplier", val);
  const display = document.getElementById("font-size-val");
  if (display)
    display.innerText =
      (dashboard.state.lang === "ne" ? toNepaliNumerals(val) : val) + "x";
};

window.toggleHighContrast = (enabled) => {
  localStorage.setItem("high-contrast", enabled);
  if (enabled) document.body.setAttribute("data-contrast", "high");
  else document.body.removeAttribute("data-contrast");
};

window.togglePremiumTts = (enabled) => {
  localStorage.setItem("premium-tts", enabled);
};

window.updateVoicePreference = (uri) => {
  localStorage.setItem("tts-voice-uri", uri);
  // Provide a small sound sample when changing voices
  const msg = new SpeechSynthesisUtterance(
    dashboard.state.lang === "en" ? "Voice updated." : "आवाज परिवर्तन गरियो।",
  );
  const voices = speechSynthesis.getVoices();
  msg.voice = voices.find((v) => v.voiceURI === uri) || null;
  speechSynthesis.speak(msg);
};

window.updateSpeechRate = (val) => {
  localStorage.setItem("tts-rate", val);
  const display = document.getElementById("speech-rate-val");
  if (display)
    display.innerText =
      (dashboard.state.lang === "ne" ? toNepaliNumerals(val) : val) + "x";
};

window.updateSpeechPitch = (val) => {
  localStorage.setItem("tts-pitch", val);
  const display = document.getElementById("speech-pitch-val");
  if (display)
    display.innerText =
      (dashboard.state.lang === "ne" ? toNepaliNumerals(val) : val) + "x";
};

window.toggleDarkSchedule = (enabled) => {
  localStorage.setItem("theme-schedule", enabled);
  if (enabled) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        localStorage.setItem("last-lat", pos.coords.latitude);
        localStorage.setItem("last-lon", pos.coords.longitude);
        syncAppTheme();
        dashboard.addToast(
          "success",
          dashboard.state.lang === "en" ? "Location synced" : "स्थान सिङ्क",
        );
      },
      () => {
        dashboard.addToast(
          "info",
          dashboard.state.lang === "en"
            ? "Default schedule"
            : "पूर्वनिर्धारित शेड्युल",
        );
        syncAppTheme();
      },
    );
  } else {
    syncAppTheme();
  }
};

window.toggleGrayscale = (enabled) => {
  localStorage.setItem("grayscale", enabled);
  document.body.setAttribute("data-grayscale", enabled);
};

window.toggleSepia = (enabled) => {
  localStorage.setItem("blue-light", enabled);
  document.body.setAttribute("data-sepia", enabled);
};

// Initialize PWA logic on app start
initPWALogic();

const PULL_THRESHOLD = 120;

// Pull to Refresh Logic for Mobile
let touchStartY = 0;
let touchCurrentY = 0;
let isPulling = false;

window.addEventListener(
  "touchstart",
  (e) => {
    // Only start pulling if we are at the very top of the page
    if (window.scrollY <= 5) {
      touchStartY = e.touches[0].pageY;
      isPulling = true;
    }
  },
  { passive: true },
);

window.addEventListener(
  "touchmove",
  (e) => {
    if (!isPulling) return;
    touchCurrentY = e.touches[0].pageY;
    const dist = touchCurrentY - touchStartY;
    const pullIcon = document.getElementById("pull-icon");
    const pullTime = document.getElementById("pull-time");

    if (pullTime) pullTime.innerText = getRelativeTimeString();

    if (dist > 0) {
      const indicator = document.getElementById("pull-indicator");
      if (indicator) indicator.classList.add("visible");
      // Damped movement for natural resistance
      const topOffset = Math.min(dist / 2.5, PULL_THRESHOLD) - 50;
      if (indicator) indicator.style.top = `${topOffset}px`;
      if (pullIcon) pullIcon.style.transform = `rotate(${dist * 1.5}deg)`;
    }
  },
  { passive: true },
);

window.addEventListener("touchend", () => {
  if (!isPulling) return;
  const dist = touchCurrentY - touchStartY;
  const indicator = document.getElementById("pull-indicator");

  if (dist > PULL_THRESHOLD) {
    // Use PULL_THRESHOLD
    indicator.style.top = "20px";
    indicator.innerHTML =
      '<span class="spinner" style="border-top-color:var(--primary); width:20px; height:20px;"></span>';
    // Mobile Force Refresh: Pulling down now handles everything including clearing Gemini cache
    void dashboard.loadData(true).finally(() => {
      setTimeout(() => {
        indicator.style.top = "-60px";
        indicator.classList.remove("visible");
        setTimeout(() => {
          indicator.innerHTML = "🔄";
        }, 300);
      }, 500);
    });
  } else {
    indicator.style.top = "-60px";
    indicator.classList.remove("visible");
  }
  isPulling = false;
});

export function updateConnStrength(duration) {
  const badge = document.getElementById("conn-strength");
  if (!badge) return;

  const langStrings = I18N[dashboard.state.lang];
  let label = t.connExcellent;
  let color = "#4ade80"; // Good

  if (duration > 2500) {
    label = t.connPoor;
    color = "var(--critical)";
  } else if (duration > 1200) {
    label = t.connFair;
    color = "#facc15";
  } // Yellow
  else if (duration > 500) {
    label = t.connGood;
    color = "var(--primary)";
  }

  badge.innerText = `${langStrings.connStrength} ${label}`;
  badge.style.color = color;
  badge.style.display = "inline-flex";
}

export function render(json) {
  const langStrings = I18N[dashboard.state.lang];
  const headers = json.headers || [];
  let rows = [...(json.rows || [])];

  const compareMap = new Map();
  if (dashboard.state.diffMode && dashboard.state.compareReport) {
    const primaryKey = headers[0];
    dashboard.state.compareReport.rows.forEach((r) =>
      compareMap.set(r[primaryKey], r),
    );
  }

  // Handle Global Admin Message
  const banner = document.getElementById("admin-banner");
  if (json.adminMessage) {
    document.getElementById("admin-message-text").textContent =
      json.adminMessage; // Use textContent for safety
    banner.style.display = "block";
  } else {
    banner.style.display = "none";
  }

  // 1. FILTER
  if (dashboard.state.search && dashboard.state.search !== "verify") {
    rows = rows.filter((r) =>
      Object.values(r).some(
        (v) =>
          (typeof v === "string" || typeof v === "number") &&
          String(v).toLowerCase().includes(dashboard.state.search),
      ),
    );
  }

  // Update Results Counter
  const resCounter = document.getElementById("results-count");
  if (dashboard.state.search && rows.length > 0 && resCounter) {
    const dispNum =
      dashboard.state.lang === "ne"
        ? toNepaliNumerals(rows.length)
        : rows.length;
    resCounter.innerText = `${dispNum} ${langStrings.results}`;
    resCounter.style.display = "block";
  } else if (resCounter) {
    resCounter.style.display = "none";
  }

  // hidden Verification Audit Tool
  if (dashboard.state.search === "verify") {
    // Prevent debug audit tool from being accessed in production
    if (APP_ENV === "production") {
      dashboard.state.search = "";
      const input = document.getElementById("search-input");
      if (input) input.value = "";
      return;
    }

    console.group("Data Integrity Audit: Spreadsheet vs Dashboard");
    const rawTotal = json.rows.length;
    const rawCritical = json.rows.filter(
      (r) => r._status === "critical",
    ).length;
    const rawRisk =
      rawTotal > 0 ? Math.round((rawCritical / rawTotal) * 100) : 0;
    console.log(
      `%c TOTAL SYSTEM RISK SCORE: ${rawRisk}% `,
      "background: #ef4444; color: white; font-weight: bold; padding: 4px; border-radius: 4px;",
    );
    console.log(
      `Audit Summary: ${rawCritical} Critical indicators identified across ${rawTotal} total project records.`,
    );

    const audit = rows.map((r) => {
      const annTargetKey = headers.find(
        (h) => h.includes("Annual Target") || h.includes("बार्षिक लक्ष्य"),
      );
      const annProgKey = headers.find(
        (h) =>
          h.includes("Annual Progress") ||
          h.includes("हाल सम्म को बार्षिक प्रगति"),
      );
      const totTargetKey = headers.find(
        (h) => h.includes("Total Target") || h.includes("कुल लक्ष्य"),
      );
      const totProgKey = headers.find(
        (h) => h.includes("Total Progress") || h.includes("कुल प्रगति"),
      );

      const totT = parseFloat(String(r[totTargetKey] || "0").replace(/,/g, ""));
      const totP = parseFloat(String(r[totProgKey] || "0").replace(/,/g, ""));
      const totPerc = totT > 0 ? Math.round((totP / totT) * 100) : 0;

      return {
        Indicator: r[headers[0]],
        "Sheet Annual Target": r[annTargetKey],
        "Sheet Annual Achievement": r[annProgKey],
        "Dashboard Calc Annual %": getProgress(r, headers) + "%",
        "Sheet Total Target": r[totTargetKey],
        "Sheet Total Progress": r[totProgKey],
        "Dashboard Calc Total %": totPerc + "%",
      };
    });
    console.table(audit);
    console.groupEnd();
    dashboard.addToast(
      "info",
      "Audit table generated in Browser Console (F12)",
    );
  }

  // Pre-calculate search patterns for highlighting
  const arabicSearch = toArabicNumerals(dashboard.state.search);
  const isNumericSearch =
    dashboard.state.search &&
    !isNaN(parseFloat(arabicSearch)) &&
    isFinite(arabicSearch);

  let highlightRegex = null;
  if (dashboard.state.search) {
    const pattern = isNumericSearch
      ? `(${arabicSearch}|${toNepaliNumerals(arabicSearch)})`
      : `(${dashboard.state.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`;
    highlightRegex = new RegExp(pattern, "gi");
  }

  // 2. SORT
  if (dashboard.state.sort.key) {
    rows.sort((a, b) => {
      const v1 = a[dashboard.state.sort.key] ?? "";
      const v2 = b[dashboard.state.sort.key] ?? "";
      const n1 = parseFloat(String(v1).replace(/,/g, "").replace("%", ""));
      const n2 = parseFloat(String(v2).replace(/,/g, "").replace("%", ""));
      if (!isNaN(n1) && !isNaN(n2)) return (n1 - n2) * dashboard.state.sort.dir;
      return (
        String(v1).localeCompare(String(v2), dashboard.state.lang) *
        dashboard.state.sort.dir
      );
    });
  }

  // 3. KPI & CHART
  const total = rows.length;
  const good = rows.filter((r) => r._status === "good").length;
  const critical = rows.filter((r) => r._status === "critical").length;

  // Global System Instability Metric (0 to 1)
  dashboard.state.riskLevel = total > 0 ? critical / total : 0;

  const percent = total > 0 ? Math.round((good / total) * 100) : 0;
  const dispTotal =
    dashboard.state.lang === "ne" ? toNepaliNumerals(total) : total;
  const dispGood =
    dashboard.state.lang === "ne" ? toNepaliNumerals(good) : good;
  const dispCrit =
    dashboard.state.lang === "ne" ? toNepaliNumerals(critical) : critical;
  const dispPerc =
    dashboard.state.lang === "ne" ? toNepaliNumerals(percent) : percent;

  let trendTotal = "",
    trendGood = "",
    trendCrit = "";
  if (dashboard.state.diffMode && dashboard.state.compareReport) {
    let compRows = [...dashboard.state.compareReport.rows];
    if (dashboard.state.search && dashboard.state.search !== "verify") {
      compRows = compRows.filter((r) =>
        Object.values(r).some(
          (v) =>
            (typeof v === "string" || typeof v === "number") &&
            String(v).toLowerCase().includes(dashboard.state.search),
        ),
      );
    }
    const prevTotal = compRows.length;
    const prevGood = compRows.filter((r) => r._status === "good").length;
    const prevCrit = compRows.filter((r) => r._status === "critical").length;

    const formatTrend = (diff: number, invert = false) => {
      if (diff === 0) return "";
      const isPos = diff > 0;
      const color = (invert ? !isPos : isPos)
        ? "var(--good)"
        : "var(--critical)";
      const icon = isPos ? "▲" : "▼";
      const abs = Math.abs(diff);
      const val = dashboard.state.lang === "ne" ? toNepaliNumerals(abs) : abs;
      return `<span style="font-size:0.7rem; color:${color}; font-weight:800; margin-left:6px;">${icon}${val}</span>`;
    };

    trendTotal = formatTrend(total - prevTotal);
    trendGood = formatTrend(good - prevGood);
    trendCrit = formatTrend(critical - prevCrit, true);
  }

  const critPulseClass =
    dashboard.state.riskLevel > 0.2 ? "pulse-critical-card" : "";

  document.getElementById("kpi-stats").innerHTML = `
    <div class="kpi-card"><h4>${t.total}</h4><p style="display:flex; align-items:center;">${dispTotal}${trendTotal}</p></div>
    <div class="kpi-card" style="border-left-color:var(--good)"><h4>${t.met}</h4><p style="display:flex; align-items:center;">${dispGood}${trendGood}</p></div>
    <div class="kpi-card ${critPulseClass}" style="border-left-color:var(--critical)"><h4>${t.attention}</h4><p style="display:flex; align-items:center;">${dispCrit}${trendCrit}</p></div>
  `;
  document
    .getElementById("chart-path")
    .setAttribute("stroke-dasharray", `${percent}, 100`);
  document.getElementById("chart-percent").innerText = `${dispPerc}%`;

  if (json.lastUpdate) {
    document.getElementById("last-update").innerText =
      `${t.update} ${dashboard.state.lang === "ne" ? toNepaliNumerals(json.lastUpdate) : `${json.lastUpdate} BS`}`;
    document.getElementById("print-stamp").innerText =
      `Last Updated Version: ${json.lastUpdate}`;
  }
  const isLowData = localStorage.getItem("low-data") === "true";
  if (json.aiSummary?.brief && !isLowData) {
    const briefCard = document.getElementById("ai-brief-card");
    if (briefCard) {
      briefCard.style.display = "block";
      briefCard.classList.add("fade-in");
    }
    let briefText = json.aiSummary.brief;
    if (dashboard.state.lang === "ne") briefText = toNepaliNumerals(briefText);

    const container = document.getElementById("ai-brief-text");
    if (!document.getElementById("ai-visualizer")) {
      container.insertAdjacentHTML(
        "beforebegin",
        '<canvas id="ai-visualizer" width="400" height="40" style="width:100%; height:40px; margin-bottom:12px; border-radius:8px; opacity:0.6"></canvas>',
      );
      // SpeechEngine will manage starting and stopping the visualizer
    }
    typeText(container, briefText, true); // Type out with shimmer and sound
  }

  const url = window.location.origin;
  document.getElementById("app-link").innerText = url;
  document.getElementById("app-link").href = url;

  // 4. TABLE
  let thead = `<tr><th onclick="sortData(''); event.stopPropagation()"></th>`; // Empty header for mini-chart column

  // Sortable headers: Works regardless of column count or content
  headers.forEach((h) => {
    thead += `<th onclick="sortData('${h}'); event.stopPropagation()">${t(h)} ${dashboard.state.sort.key === h ? (dashboard.state.sort.dir === 1 ? "↑" : "↓") : ""}</th>`;
  });
  thead += "</tr>";
  document.getElementById("thead").innerHTML = thead;

  let tbody = "";
  if (rows.length === 0 && dashboard.state.search) {
    tbody = `<tr><td colspan="${headers.length + 1}" style="text-align:center; padding:3rem; opacity:0.7">
          <div style="font-size:2.5rem; margin-bottom:10px">🔍</div>
          <div style="font-weight:bold; color:var(--text)" data-i18n="noResults"></div>
          <div style="font-size:0.9rem; margin-bottom:15px; opacity:0.8">"${dashboard.state.search}"</div>
          <button onclick="clearSearch()" class="retry-btn" style="margin:0" data-i18n="retrySearch"></button>
        </td></tr>`;
  } else {
    rows.forEach((r) => {
      const name = r[headers[0]] || "";
      let rowClasses = "";
      if (dashboard.state.diffMode && !compareMap.has(name)) {
        rowClasses += "diff-added"; // New row in current report
      }
      const annualPerc = getProgress(r, headers);
      // Using data attributes for event delegation
      tbody += `<tr data-indicator-name="${name.replace(/"/g, "&quot;")}" class="${rowClasses} fade-in">`; // Escape quotes for HTML attribute
      tbody += `<td>
            <div style="display:flex; align-items:center; gap:8px;">
              ${renderMiniChart(annualPerc, true)}
              <button class="icon-btn table-chart-btn" data-indicator="${name.replace(/"/g, "&quot;")}" data-i18n-title="chartsView" style="width:24px; height:24px; font-size:0.7rem; padding:0; border-radius:6px; flex-shrink:0;">📊</button>
              <button class="icon-btn table-deeplink-btn" data-indicator="${name.replace(/"/g, "&quot;")}" data-i18n-title="linkCopied" style="width:24px; height:24px; font-size:0.7rem; padding:0; border-radius:6px; flex-shrink:0;">🔗</button>
            </div>
          </td>`;
      headers.forEach((h, i) => {
        let val = t(r[h]); // Translate ALL data content automatically

        let cellClass = "";
        let diffValue = "";

        if (dashboard.state.diffMode && compareMap.has(name)) {
          const compareRow = compareMap.get(name);
          const currentVal = r[h];
          const prevVal = compareRow[h];

          if (String(currentVal) !== String(prevVal)) {
            cellClass = "diff-changed";
            // Attempt to parse as number for numerical diff
            const currentNum = parseFloat(String(currentVal).replace(/,/g, ""));
            const prevNum = parseFloat(String(prevVal).replace(/,/g, ""));

            if (!isNaN(currentNum) && !isNaN(prevNum)) {
              const diff = currentNum - prevNum;
              diffValue = ` (${diff > 0 ? "+" : ""}${dashboard.state.lang === "ne" ? toNepaliNumerals(diff) : diff})`;
              if (diff > 0) cellClass = "diff-improved";
              else if (diff < 0) cellClass = "diff-regressed";
            } else {
              // Textual change
              diffValue = ` (was: ${t(prevVal)})`; // Show previous value for text changes
            }
          }
        }

        if (highlightRegex) {
          val = String(val).replace(highlightRegex, "<b>$1</b>");
        }

        // Convert to Nepali numerals AFTER potential highlighting
        const isStatus = h.toLowerCase().includes("status") || i === 0;
        const color = isStatus
          ? r._status === "good"
            ? "var(--good)"
            : r._status === "critical"
              ? "var(--critical)"
              : "var(--stable)"
          : "var(--text)"; // Default text color
        tbody += `<td class="${cellClass}" style="color:${color}; font-weight:${isStatus ? 700 : 400}">${val}${diffValue}</td>`;
      });
      tbody += "</tr>";
    });
  }
  document.getElementById("tbody").innerHTML = tbody;

  // 5. CARDS
  let cardHtml = "";
  if (rows.length === 0) {
    if (dashboard.state.search) {
      cardHtml = `<div class="chart-card" style="text-align:center; grid-column: 1 / -1; padding: 4rem;">
            <div style="font-size:3rem; margin-bottom:10px">🔎</div>
            <p style="font-weight:bold; font-size:1.1rem; color:var(--text)" data-i18n="noResults"></p>
            <p style="margin-bottom:15px; opacity:0.8">"${dashboard.state.search}"</p>
            <button onclick="clearSearch()" class="retry-btn" data-i18n="retrySearch"></button>
          </div>`;
    } else {
      cardHtml = `<p style='padding:2rem;text-align:center;opacity:0.5' data-i18n="noDataToVisualize"></p>`;
    }
  } else {
    rows.forEach((r) => {
      const name = r[headers[0]] || "—";

      const totTargetKey = headers.find(
        (h) => h.includes("Total Target") || h.includes("कुल लक्ष्य"),
      );
      const totProgKey = headers.find(
        (h) => h.includes("Total Progress") || h.includes("कुल प्रगति"),
      );

      const annPerc = getProgress(r, headers);
      const totT = parseFloat(String(r[totTargetKey] || "0").replace(/,/g, ""));
      const totP = parseFloat(String(r[totProgKey] || "0").replace(/,/g, ""));
      const totPerc = totT > 0 ? Math.round((totP / totT) * 100) : 0;

      const dispAnn =
        dashboard.state.lang === "ne" ? toNepaliNumerals(annPerc) : annPerc;

      const annColor = annPerc < 50 ? "var(--critical)" : "var(--primary)";
      const annPulseClass = annPerc < 20 ? "pulse-critical" : "";

      let details = "";
      headers.slice(1, 6).forEach((h) => {
        if (r[h])
          details += `<div style="font-size:0.75rem;margin-bottom:4px"><span style="color:var(--text-light)">${h}:</span> <span style="font-weight:600">${dashboard.state.lang === "ne" ? toNepaliNumerals(r[h]) : r[h]}</span></div>`; // Use textContent for safety
      });
      const delay = (rows.indexOf(r) % 12) * 0.05;
      cardHtml += `
            <div class="data-card fade-in" style="animation-delay: ${delay}s" data-indicator="${name}" onclick="showModal('${name.replace(/'/g, "\\'")}', this, true)">
              <div style="padding:1rem;background:rgba(0,0,0,0.02);display:flex;justify-content:space-between;align-items:center">
                <div style="display:flex; align-items:center">${renderMiniChart(annPerc)}<b>${t(name)}</b></div>
                <div style="display:flex; align-items:center; gap:6px">
                  <span style="font-size:0.7rem;background:${annColor};color:white;padding:2px 8px;border-radius:4px;font-weight:bold;">${dispAnn}%</span>
                  <button class="icon-btn card-chart-btn" data-indicator="${name.replace(/'/g, "\\'")}" style="width:24px; height:24px; font-size:0.7rem; padding:0; border-radius:6px">📊</button>
                </div>
              </div>
              <div style="padding:1rem">
                <div style="margin-bottom:15px">
                   <div style="display:flex;justify-content:space-between;font-size:0.6rem;font-weight:800;margin-bottom:4px;color:var(--text-light)">
                     <span>ANNUAL TARGET ACHIEVEMENT</span>
                     <span style="color:${annColor}">${dispAnn}%</span>
                   </div>
                   <div style="height:6px;background:var(--bg);border-radius:3px;overflow:${annPerc < 20 ? "visible" : "hidden"}">
                     <div style="width:${annPerc}%;height:100%;background:${annColor};border-radius:3px" class="${annPulseClass}"></div>
                   </div>
                </div>
                <div style="margin-bottom:15px">
                   <div style="display:flex;justify-content:space-between;font-size:0.6rem;font-weight:800;margin-bottom:4px;color:var(--text-light)">
                     <span>PROJECT TREND / प्रगति ग्राफ</span>
                   </div>
                   ${renderSparkline(annPerc, totPerc)}
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">${details}</div>
                <p style="font-size:0.8rem;color:var(--primary);margin-top:12px;border-top:1px solid var(--border);padding-top:8px;font-style:italic">${r._insight || ""}</p>
              </div>
            </div>`;
    });
  }
  document.getElementById("view-cards").innerHTML = cardHtml;

  // 6. CHARTS
  let chartHtml = "";
  if (rows.length === 0) {
    chartHtml = `<p style='padding:2rem;text-align:center;opacity:0.5'>${I18N[dashboard.state.lang].noDataToVisualize}</p>`;
  } else {
    rows.forEach((r) => {
      const name = r[headers[0]] || "—";

      const prog = getProgress(r, headers);
      const dispProg =
        dashboard.state.lang === "ne" ? toNepaliNumerals(prog) : prog;
      const color =
        prog >= 80
          ? "var(--good)"
          : prog >= 40
            ? "var(--stable)"
            : "var(--critical)";
      chartHtml += `
      <div class="chart-card fade-in" data-indicator="${name}" onclick="showModal('${name.replace(/'/g, "\\'")}', this, true)" style="cursor:pointer">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px">
          <b style="font-size:0.9rem">${t(name)}</b>
          <div style="display:flex; align-items:center; gap:6px"> 
            <span style="font-size:0.75rem; font-weight:800; color:${color}">${dispProg}%</span>
            <button class="icon-btn chart-card-btn" data-indicator="${name.replace(/'/g, "\\'")}" style="width:24px; height:24px; font-size:0.7rem; padding:0; border-radius:6px">🗂️</button>
          </div>
        </div>
        <div class="chart-bar-container">
          <div class="chart-bar" style="width:${prog}%; background:${color}; transition: width 1s ease-out;"></div>
        </div>
        <div style="font-size:0.65rem; color:var(--text-light); text-transform:uppercase; letter-spacing:0.05em">
          ${headers
          .slice(1, 4)
          .map(
            (h) =>
              `<span>${h}: <b>${dashboard.state.lang === "ne" ? toNepaliNumerals(r[h]) : r[h]}</b></span>`,
          )
          .join(" | ")}
        </div>
      </div>`;
    });
  }
  document.getElementById("view-charts").innerHTML = chartHtml;

  // Final Sync: Ensure all data-i18n elements (including results-count) are refreshed
  applyTranslations();
}

// --- One-time Event Delegation Initialization ---
const initDelegation = () => {
  document.getElementById("tbody").onclick = (event) => {
    const target = event.target;
    const row = target.closest("tr[data-indicator-name]");
    if (row) {
      const name = row.dataset.indicatorName;
      if (target.classList.contains("table-chart-btn")) {
        event.stopPropagation();
        showInChartView(name);
      } else if (target.classList.contains("table-deeplink-btn")) {
        event.stopPropagation();
        copyDeepLink(name);
      } else {
        showModal(name);
      }
    }
  };

  document.getElementById("view-cards").onclick = (event) => {
    const target = event.target;
    const card = target.closest(".data-card");
    if (card) {
      const name = card.dataset.indicator;
      if (target.classList.contains("card-chart-btn")) {
        event.stopPropagation();
        showInChartView(name);
      } else {
        showModal(name);
      }
    }
  };

  document.getElementById("view-charts").onclick = (event) => {
    const target = event.target;
    const chart = target.closest(".chart-card");
    if (chart) {
      const name = chart.dataset.indicator;
      if (target.classList.contains("chart-card-btn")) {
        event.stopPropagation();
        showInCardView(name);
      } else {
        showModal(name);
      }
    }
  };
};
initDelegation();

/**
 * Generates a Progress Report PDF directly in the browser using pdf-lib.
 * Includes Devanagari font support for Nepali translations.
 */
window.generateClientPDF = async () => {
  const store = dashboard.state.store;
  if (!store?.rows.length)
    return dashboard.addToast("error", "No data to export");

  const lang = dashboard.state.lang;
  dashboard.addToast(
    "info",
    lang === "en" ? "Generating PDF..." : "PDF तयार गर्दै...",
  );

  try {
    const { PDFDocument, rgb, StandardFonts } = PDFLib;
    const pdfDoc = await PDFDocument.create();

    // 1. Optimized Font Embedding
    let mainFont;
    if (lang === "ne") {
      const fontUrl = `https://fonts.gstatic.com/s/notosansdevanagari/v28/wf5m9WB_V9fNqbfVp-9ueS5mF-X_S-zY.ttf`;
      const fontBytes = await fetch(fontUrl).then((res) => res.arrayBuffer());
      mainFont = await pdfDoc.embedFont(fontBytes);
    } else {
      mainFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
    }

    const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    console.log(helveticaBold);
    // 2. Embed Logo
    const logoUrl = `${window.location.origin}/icons/logo.png`;
    const logoBytes = await fetch(logoUrl).then((res) =>
      res.ok ? res.arrayBuffer() : null,
    );
    let logoImg = null;
    if (logoBytes) logoImg = await pdfDoc.embedPng(logoBytes);

    const page = pdfDoc.addPage([595.28, 841.89]); // A4 Size
    const { width, height } = page.getSize();
    let yOffset = height - 50;

    const colWidth = (width - 100) / store.headers.length;

    const drawTableHeader = (currentPage) => {
      store.headers.forEach((h, i) => {
        currentPage.drawText(h, {
          x: 50 + i * colWidth,
          y: yOffset,
          size: 9,
          font: mainFont,
        });
      });
      currentPage.drawLine({
        start: { x: 50, y: yOffset - 5 },
        end: { x: width - 50, y: yOffset - 5 },
        thickness: 1,
        color: rgb(0.8, 0.8, 0.8),
      });
      yOffset -= 20;
    };

    // 3. Draw Header
    if (logoImg) {
      const logoDims = logoImg.scale(0.3);
      page.drawImage(logoImg, {
        x: width / 2 - logoDims.width / 2,
        y: yOffset - logoDims.height,
        width: logoDims.width,
        height: logoDims.height,
      });
      yOffset -= logoDims.height + 20;
    }

    // Center Title
    const title = I18N[lang].reportTitle;
    const titleWidth = mainFont.widthOfTextAtSize(title, 14);
    page.drawText(title, {
      x: width / 2 - titleWidth / 2,
      y: yOffset,
      size: 14,
      font: mainFont,
      color: rgb(0.1, 0.1, 0.1),
    });
    yOffset -= 30;

    // 3. Draw KPI Summary
    const totalRows = store.rows.length;
    const critical = store.rows.filter((r) => r._status === "critical").length;
    page.drawRectangle({
      x: 50,
      y: yOffset - 10,
      width: width - 100,
      height: 40,
      color: rgb(0.95, 0.95, 0.95),
    });
    const kpiText = `${I18N[lang].total}: ${lang === "ne" ? toNepaliNumerals(totalRows) : totalRows} | ${I18N[lang].attention}: ${lang === "ne" ? toNepaliNumerals(critical) : critical}`;
    page.drawText(kpiText, {
      x: 60,
      y: yOffset,
      size: 10,
      font: mainFont,
      color: rgb(0.2, 0.2, 0.2),
    });
    yOffset -= 60;

    // 4. Draw Initial Headers
    drawTableHeader(page);

    // 5. Draw Table Rows
    store.rows.forEach((row) => {
      if (yOffset < 50) {
        const newPage = pdfDoc.addPage([595.28, 841.89]);
        yOffset = height - 50;
        drawTableHeader(newPage);
      }

      store.headers.forEach((h, i) => {
        let text = String(row[h] || "");
        if (lang === "ne") text = toNepaliNumerals(text);

        page.drawText(text.substring(0, 30), {
          x: 50 + i * colWidth,
          y: yOffset,
          size: 8,
          font: mainFont,
          color:
            row._status === "critical" && i === 0
              ? rgb(0.9, 0, 0)
              : rgb(0, 0, 0),
        });
      });
      yOffset -= 15;
    });

    // 6. Save and Download
    const pdfBytes = await pdfDoc.save();
    const blob = new Blob([pdfBytes], { type: "application/pdf" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `DoR_Report_${new Date().toISOString().slice(0, 10)}.pdf`;
    link.click();
  } catch (err) {
    console.error(err);
    dashboard.addToast("error", "Failed to generate PDF");
  }
};

/**
 * Frontend Security Shield
 * Prevents unauthorized code copying, editing, and inspection.
 */
/**
 * Unlocks the AudioContext on the first user interaction.
 * This resolves the "AudioContext not allowed to start" error and ensures
 * audio feedback works as soon as the user starts using the dashboard.
 */
const unlockAudioContext = () => {
  if (dashboard.audio) {
    void dashboard.audio.init();
  }
  document.removeEventListener("click", unlockAudioContext);
  document.removeEventListener("keydown", unlockAudioContext);
  document.removeEventListener("touchstart", unlockAudioContext);
};
document.addEventListener("click", unlockAudioContext, { once: true });
document.addEventListener("keydown", unlockAudioContext, { once: true });
document.addEventListener("touchstart", unlockAudioContext, { once: true });

// lockFrontend();

// Mobile: default to card view (better for small screens)
if (window.innerWidth < 768 && dashboard.state.view === "table") {
  dashboard.setView("cards");
}
