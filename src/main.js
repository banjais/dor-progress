import translationsData from "./locales/translations.json";

const WORKER_BASE = import.meta.env.VITE_API_BASE_URL || "";
const BUILD_ID = import.meta.env.VITE_BUILD_ID || "dev";
const COMMIT_SHA = import.meta.env.VITE_COMMIT_SHA || "dev";

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import {
  initializeAppCheck,
  ReCaptchaV3Provider,
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app-check.js";

const toggleLang = () => {
  const next = currentLang === "en" ? "ne" : "en";
  setLang(next);
  const lbl = document.getElementById("lang-current-label");
  if (lbl) lbl.innerText = next.toUpperCase();
};

const toggleGeminiMenu = () => {
  const btn = document.getElementById("gemini-main-btn");
  const menu = document.getElementById("gemini-menu");
  const fabMenu = document.getElementById("fab-menu");
  if (fabMenu) fabMenu.classList.remove("show");
  menu.classList.toggle("show");
};

const toggleFabMenu = () => {
  const btn = document.getElementById("fab-main-btn");
  const menu = document.getElementById("fab-menu");
  const geminiMenu = document.getElementById("gemini-menu");
  if (geminiMenu) geminiMenu.classList.remove("show");
  btn.classList.toggle("active");
  menu.classList.toggle("show");
};

// Close on outside click
document.addEventListener("click", (e) => {
  const fabBtn = document.getElementById("fab-main-btn");
  const fabMenu = document.getElementById("fab-menu");
  const geminiBtn = document.getElementById("gemini-main-btn");
  const geminiMenu = document.getElementById("gemini-menu");

  if (fabMenu && !fabMenu.contains(e.target) && e.target !== fabBtn) {
    fabMenu.classList.remove("show");
    fabBtn.classList.remove("active");
  }
  if (geminiMenu && !geminiMenu.contains(e.target) && e.target !== geminiBtn) {
    geminiMenu.classList.remove("show");
  }
});

const updateLaunchProgress = (percent, status) => {
  const fill = document.getElementById("loader-bar-fill");
  const text = document.getElementById("loader-percentage");
  const statusText = document.querySelector(".loader-status");
  if (fill) fill.style.width = `${percent}%`;
  if (text) text.innerText = `${percent}%`;
  if (statusText && status) statusText.innerText = status;
};

const hideSplashScreen = () => {
  const splash = document.getElementById("splash-screen");
  if (splash) {
    splash.style.opacity = "0";
    setTimeout(() => (splash.style.display = "none"), 800);
  }
};

/**
     * Theme Lifecycle Management

     * Automatically switches theme when system settings change.
     */
const initTheme = () => {
  const applyTheme = (theme) => {
    const isDark = theme === "dark";
    const color = isDark ? "#0b0f1a" : "#1a5c3a";
    document.body.setAttribute("data-theme", theme);
    document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
      meta.setAttribute("content", color);
    });
  };

  if (window.matchMedia) {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    // Listen for OS-level theme changes in real-time
    mediaQuery.addEventListener("change", (e) => {
      // Only auto-update if the user hasn't explicitly set a preference
      if (!localStorage.getItem("theme")) {
        applyTheme(e.matches ? "dark" : "light");
      }
    });
  }

  // Final sync for the meta tags based on the state established by the FOUC guard
  applyTheme(document.body.getAttribute("data-theme") || "light");
};
initTheme();

/**
 * Automatically detects if the browser's 'Data Saver' mode is enabled.
 * Only sets the preference if the user hasn't explicitly set one before.
 */
const initLowData = () => {
  if (localStorage.getItem("low-data") === null) {
    // The Network Information API provides the saveData property
    if (navigator.connection && navigator.connection.saveData) {
      localStorage.setItem("low-data", "true");
    }
  }
};
initLowData();

/**
 * Detects a fresh install and offers to restore from Cloud Backup.
 */
async function checkFreshInstall() {
  if (localStorage.getItem("app-initialized")) return;

  // Check if any backups exist in the cloud
  try {
    const res = await fetch(`${WORKER_BASE}/api/admin/list-backups`);
    if (res.ok) {
      const backups = await res.json();
      if (backups.length > 0) {
        const confirmRestore = confirm(
          currentLang === "en"
            ? "Fresh Install Detected. Would you like to restore your settings and analytics from a Cloud Backup?"
            : "नयाँ इन्स्टल फेला पर्यो। के तपाईं क्लाउड ब्याकअपबाट आफ्ना सेटिङहरू र तथ्याङ्कहरू रिस्टोर गर्न चाहनुहुन्छ?",
        );

        if (confirmRestore) {
          await triggerDatabaseRestore();
        }
      }
    }
  } catch (e) {
    console.log("Auto-restore check skipped (likely first run/unauthorized).");
  } finally {
    localStorage.setItem("app-initialized", "true");
  }
}

async function setupSecurity() {
  try {
    updateLaunchProgress(10, "Connecting to Worker...");
    // Fetch config injected by Cloudflare Secrets via the Worker
    const res = await fetch(`${WORKER_BASE}/api/client-config`);
    const config = await res.json();

    updateLaunchProgress(30, "Initializing Firebase...");
    console.log("[App Check Init] Received client config:", config);
    const app = initializeApp(config.firebase);

    if (
      location.hostname === "localhost" ||
      location.hostname === "127.0.0.1"
    ) {
      self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
    }

    updateLaunchProgress(60, "Verifying Integrity...");
    window.appCheck = initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(config.recaptchaKey),
      isTokenAutoRefreshEnabled: true,
    });
    console.log("[App Check Init] App Check initialized successfully.");

    // Initialize
    setLang(initialLang);
    setView("table");
    handleVerification();

    updateLaunchProgress(80, "Fetching Project Data...");
    await loadData();
    updateLaunchProgress(100, "Dashboard Ready");
    setTimeout(hideSplashScreen, 500);

    setTimeout(checkDeepLink, 1500);
    setTimeout(checkFreshInstall, 3000); // Check for backups after UI is stable

    // Initialize Audio Icon State
    updateVolume(uiVolume);

    // Version Badge Check
    const swVersion = await getActiveSwVersion();
    const lastSeen = localStorage.getItem("app-version-seen");
    if (lastSeen && lastSeen !== swVersion) {
      document.getElementById("settings-btn")?.classList.add("has-badge");
    }
  } catch (e) {
    console.error("Security Bootstrap Failed", e);
    addToast(
      "error",
      currentLang === "en" ? "Security init failed" : "प्रणाली असफल",
    );
    // Ensure loader is removed so user can at least see the UI/Offline state
    const loader = document.getElementById("loader");
    if (loader) loader.style.display = "none";
  }
}

/**
 * Centralized fetch helper to handle base URLs and Firebase App Check tokens.
 */
async function authenticatedFetch(path, options = {}, maxRetries = 3) {
  const url = path.startsWith("http")
    ? path
    : `${WORKER_BASE}${path.startsWith("/") ? "" : "/"}${path}`;
  const { getToken } =
    await import("https://www.gstatic.com/firebasejs/11.0.1/firebase-app-check.js");

  const method = (options.method || "GET").toUpperCase();
  const isIdempotent = ["GET", "PUT", "DELETE", "HEAD", "OPTIONS"].includes(
    method,
  );
  const effectiveRetries = maxRetries; // With Durable Objects, we can safely retry non-idempotent methods

  const headers = { "Content-Type": "application/json", ...options.headers };
  headers["X-Low-Data"] =
    localStorage.getItem("low-data") === "true" ? "true" : "false";

  for (let attempt = 0; attempt < effectiveRetries; attempt++) {
    try {
      if (window.appCheck) {
        const tokenResult = await getToken(window.appCheck, attempt > 0); // Force refresh on retries
        if (tokenResult && tokenResult.token) {
          headers["X-Firebase-AppCheck"] = tokenResult.token;
          console.log(
            "[Security] App Check token attached to request:",
            tokenResult.token.substring(0, 10) + "...",
          ); // Log partial token for privacy
        } else {
          console.warn("[Security] getToken returned no token.");
        }
      }

      const response = await fetch(url, { ...options, headers });
      if (response.ok) {
        const isFromCache = response.headers.get("X-From-Cache") === "true";
        const isStale = response.headers.get("X-Is-Stale") === "true";

        if (isStale) {
          addToast("info", t("dataSyncing"), 2000);
        } else if (isFromCache) {
          addToast(
            "info",
            currentLang === "en" ? "Using cache" : "क्यास प्रयोग",
          );
        }
        return response;
      }

      // Don't retry on certain client errors like 404 or 400 (unless it's 403 or 429)
      if (
        response.status >= 400 &&
        response.status < 500 &&
        response.status !== 403 &&
        response.status !== 429
      ) {
        throw new Error(`HTTP ${response.status}`);
      }

      throw new Error(
        `Attempt ${attempt + 1} failed with status ${response.status}`,
      );
    } catch (err) {
      const isLastAttempt = attempt === effectiveRetries - 1;
      if (isLastAttempt) {
        const errorMsg =
          currentLang === "en"
            ? "Connection failed after multiple attempts."
            : "धेरै प्रयास पछि जडान असफल भयो।";
        addToast("error", errorMsg);
        throw err;
      }

      const delay = Math.pow(2, attempt) * 1000;
      console.warn(`Retrying in ${delay}ms...`, err);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

window.checkStatus = checkStatus;
async function checkStatus() {
  const statusEl = document.getElementById("status");
  const btn = document.getElementById("status-refresh-btn");
  if (!statusEl || !btn) return;

  statusEl.innerText = currentLang === "en" ? "Pinging..." : "जाँच गर्दै...";
  const startTime = performance.now();
  btn.classList.add("spinning");
  btn.disabled = true;

  try {
    // Desktop Force Refresh: Clicking this now forces a full data reload bypassing Redis
    await loadData(true);
    const res = await authenticatedFetch(`/api/ping`);
    const endTime = performance.now();
    const duration = Math.round(endTime - startTime);

    if (res.ok) {
      statusEl.innerText = t("live");
      statusEl.style.color = "#4ade80";
      addToast(
        "success",
        currentLang === "en" ? `Pong! ${duration}ms` : `पङ्! ${duration}ms`,
      );
    } else {
      throw new Error();
    }
  } catch (e) {
    statusEl.innerText = t("offline");
    statusEl.style.color = "#f87171";
    addToast("error", currentLang === "en" ? "Ping failed" : "पिङ असफल");
  } finally {
    btn.classList.remove("spinning");
    btn.disabled = false;
  }
}

window.dismissAllToasts = dismissAllToasts;
function dismissAllToasts() {
  const toasts = document.querySelectorAll(".toast");
  toasts.forEach((t) => {
    if (t.dataset.dismissing) return;
    // Trigger the click event to reuse the existing dismissal logic
    t.click();
  });
}

function addToast(type, message, duration = 4000) {
  playPopSound();
  const container = document.getElementById("toast-container");
  const dismissAllBtn = document.getElementById("dismiss-all");
  if (!container || !dismissAllBtn) return;

  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  const isPersistent = duration === 0;

  const icons = { success: "✅", info: "ℹ️", error: "❌" };
  toast.innerHTML = `
        <span>${icons[type] || ""}</span>
        <span>${message}</span>
        ${isPersistent ? "" : '<div class="toast-progress"><div class="toast-bar" style="animation-duration:' + duration + 'ms"></div></div>'}
      `;

  const bar = toast.querySelector(".toast-bar");

  const dismiss = () => {
    if (toast.dataset.dismissing) return;
    toast.dataset.dismissing = "true";
    toast.style.animation = "toast-in 0.3s ease-in reverse forwards";
    setTimeout(() => {
      toast.remove();
      // Hide 'Dismiss All' button if no toasts are left
      const remaining = container.querySelectorAll(".toast");
      if (remaining.length === 0) {
        dismissAllBtn.style.display = "none";
      }
    }, 300);
  };

  let autoDismissId = isPersistent ? null : setTimeout(dismiss, duration);

  toast.onmouseenter = () => {
    if (autoDismissId) clearTimeout(autoDismissId);
  };

  toast.onmouseleave = () => {
    if (toast.dataset.dismissing || isPersistent) return;
    // Reset animation and timer to sync them
    bar.style.animation = "none";
    void bar.offsetWidth;
    bar.style.animation = `toast-progress-shrink ${duration}ms linear forwards`;
    autoDismissId = setTimeout(dismiss, duration);
  };

  toast.onclick = () => {
    if (autoDismissId) clearTimeout(autoDismissId);
    dismiss();
  };

  container.prepend(toast);

  // Show 'Dismiss All' button if there's more than one toast
  if (container.querySelectorAll(".toast").length > 1) {
    dismissAllBtn.style.display = "block";
  }
}

/**
 * World-Class Audio Engine
 * Implements customizable sound profiles for UI feedback.
 */
const SOUND_PROFILES = {
  modern: {
    ping: { type: "triangle", f1: 1200, f2: 400, g: 0.05, d: 0.1 },
    type: { type: "sine", f1: 2000, g: 0.01, d: 0.02 },
    pop: { type: "sine", f1: 600, f2: 1200, g: 0.04, d: 0.1 },
    click: { type: "sine", f1: 1600, g: 0.015, d: 0.04 },
  },
  classic: {
    ping: { type: "sine", f1: 880, f2: 440, g: 0.06, d: 0.15 },
    type: { type: "triangle", f1: 1200, g: 0.015, d: 0.03 },
    pop: { type: "triangle", f1: 500, f2: 900, g: 0.05, d: 0.12 },
    click: { type: "triangle", f1: 1000, g: 0.02, d: 0.05 },
  },
  retro: {
    ping: { type: "square", f1: 400, f2: 100, g: 0.03, d: 0.2 },
    type: { type: "square", f1: 600, g: 0.012, d: 0.04 },
    pop: { type: "square", f1: 200, f2: 500, g: 0.03, d: 0.15 },
    click: { type: "square", f1: 300, g: 0.025, d: 0.06 },
  },
};

let uiVolume = parseFloat(localStorage.getItem("ui-volume") || "0.5");
let lastVolume = uiVolume > 0 ? uiVolume : 0.5;
let currentSoundPack = localStorage.getItem("sound-pack") || "modern";
let uiPitch = parseFloat(localStorage.getItem("ui-pitch") || "1.0");

window.updatePitch = (val) => {
  uiPitch = parseFloat(val);
  localStorage.setItem("ui-pitch", val);
};

window.updateVolume = (val) => {
  uiVolume = parseFloat(val);
  localStorage.setItem("ui-volume", val);
  const icon = uiVolume === 0 ? "🔇" : "🔊";
  const targets = ["mute-toggle-btn", "header-mute-btn"];
  targets.forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.innerText = icon;
      if (id === "header-mute-btn")
        el.classList.toggle("audio-active", uiVolume > 0);
    }
  });
  const banner = document.getElementById("mute-all-active");
  if (banner) banner.style.display = uiVolume === 0 ? "flex" : "none";
};

window.setSoundPack = (pack) => {
  currentSoundPack = pack;
  localStorage.setItem("sound-pack", pack);
  document
    .querySelectorAll(".pack-opt")
    .forEach((opt) =>
      opt.classList.toggle("active", opt.dataset.pack === pack),
    );
  playClickSound();
};

window.toggleMute = () => {
  playClickSound();
  if (uiVolume > 0) {
    lastVolume = uiVolume;
    updateVolume(0);
  } else {
    updateVolume(lastVolume);
  }
  const slider = document.getElementById("ui-volume-slider");
  if (slider) slider.value = uiVolume;
};

window.resetAudioToDefault = () => {
  updateVolume(0.5);
  updatePitch(1.0);
  setSoundPack("modern");
  const volSlider = document.getElementById("ui-volume-slider");
  const pitchSlider = document.getElementById("ui-pitch-slider");
  if (volSlider) volSlider.value = 0.5;
  if (pitchSlider) pitchSlider.value = 1.0;
  addToast(
    "success",
    currentLang === "en"
      ? "Audio settings reset to default."
      : "ध्वनि सेटिङहरू रिसेट गरियो।",
  );
};

const playSound = (id, checkMute = true) => {
  if (checkMute && uiVolume === 0) return;
  try {
    const p = SOUND_PROFILES[currentSoundPack][id];
    const audioCtx =
      window._audioCtx ||
      (window._audioCtx = new (
        window.AudioContext || window.webkitAudioContext
      )());
    if (audioCtx.state === "suspended") audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = p.type;
    osc.frequency.setValueAtTime(p.f1 * uiPitch, audioCtx.currentTime);
    if (p.f2)
      osc.frequency.exponentialRampToValueAtTime(
        p.f2 * uiPitch,
        audioCtx.currentTime + p.d,
      );
    gain.gain.setValueAtTime(
      p.g * (checkMute ? uiVolume : 1),
      audioCtx.currentTime,
    );
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + p.d);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + p.d);
  } catch (e) {}
};

const playPing = () => playSound("ping");
const playTypeSound = () => playSound("type");
const playClickSound = () => playSound("click", false);
const playPopSound = () => playSound("pop");

window.playPing = playPing;
window.playTypeSound = playTypeSound;
window.playPopSound = playPopSound;

let latencyHistory = [];
let lastFetchTime = null;
function getRelativeTimeString() {
  if (!lastFetchTime) return "";
  const diff = Math.floor((Date.now() - lastFetchTime) / 1000);
  const t = I18N[currentLang];
  if (diff < 10) return t.justNow;
  if (diff < 60)
    return (
      (currentLang === "ne" ? toNepaliNumerals(diff) : diff) + " " + t.secsAgo
    );
  const mins = Math.floor(diff / 60);
  return (
    (currentLang === "ne" ? toNepaliNumerals(mins) : mins) + " " + t.minsAgo
  );
}

function toNepaliNumerals(num) {
  const n = ["०", "१", "२", "३", "४", "५", "६", "७", "८", "९"];
  return String(num).replace(/[0-9]/g, (d) => n[d]);
}

function toArabicNumerals(str) {
  const n = {
    "०": "0",
    "१": "1",
    "२": "2",
    "३": "3",
    "४": "4",
    "५": "5",
    "६": "6",
    "७": "7",
    "८": "8",
    "९": "9",
  };
  return String(str || "").replace(/[०-९]/g, (d) => n[d]);
}

window.startVoiceSearch = startVoiceSearch;
async function startVoiceSearch() {
  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    addToast(
      "error",
      currentLang === "en"
        ? "Voice search not supported in this browser."
        : "यो ब्राउजरमा भ्वाइस सर्च समर्थित छैन।",
    );
    return;
  }

  const recognition = new SpeechRecognition();
  recognition.lang = currentLang === "ne" ? "ne-NP" : "en-US";
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  const btn = document.getElementById("voice-search-btn");
  const container = document.querySelector(".search-container");

  // Ensure the volume bar exists in the DOM
  let volumeBar = document.getElementById("voice-volume-bar");
  if (!volumeBar && container) {
    volumeBar = document.createElement("div");
    volumeBar.id = "voice-volume-bar";
    container.appendChild(volumeBar);
  }

  let audioStream = null;
  let audioCtx = null;
  let animationId = null;

  const cleanup = () => {
    if (animationId) cancelAnimationFrame(animationId);
    if (audioStream) audioStream.getTracks().forEach((t) => t.stop());
    if (audioCtx) audioCtx.close();
    if (btn) btn.classList.remove("listening");
    if (volumeBar) {
      volumeBar.style.width = "0%";
      volumeBar.style.opacity = "0";
    }
  };

  try {
    audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioCtx.createMediaStreamSource(audioStream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    if (btn) btn.classList.add("listening");
    if (volumeBar) volumeBar.style.opacity = "1";

    const draw = () => {
      analyser.getByteFrequencyData(dataArray);
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
      const average = sum / dataArray.length;
      // Map average amplitude (0-128 typically) to percentage width
      const volumePercent = Math.min(100, (average / 64) * 100);
      if (volumeBar) volumeBar.style.width = `${volumePercent}%`;
      animationId = requestAnimationFrame(draw);
    };
    draw();
  } catch (err) {
    console.warn("Audio visualization failed:", err);
  }

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    document.getElementById("search-input").value = transcript;
    handleSearch();
    cleanup();
    addToast(
      "info",
      (currentLang === "en" ? "Search: " : "खोज: ") + transcript,
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
      addToast("error", currentLang === "en" ? "Mic denied" : "अनुमति छैन");
    }
  };
  recognition.start();
}

window.clearSearch = clearSearch;
function clearSearch() {
  const input = document.getElementById("search-input");
  if (!input) return;
  input.value = "";
  handleSearch();
  input.focus();
}

window.printAiBrief = printAiBrief;
function printAiBrief() {
  document.body.classList.add("print-memo-only");
  window.print();
  document.body.classList.remove("print-memo-only");
}

window.shareAiBrief = shareAiBrief;
async function shareAiBrief() {
  const text = document.getElementById("ai-brief-text").innerText;
  if (navigator.share) {
    try {
      await navigator.share({
        title: "DoR MIS - Executive Briefing",
        text: text,
      });
    } catch (err) {
      console.log("Share cancelled or failed", err);
    }
  } else {
    navigator.clipboard.writeText(text);
    addToast("success", t("linkCopied"));
  }
}

window.translateAiBrief = translateAiBrief;
async function translateAiBrief() {
  const targetLang = currentLang === "en" ? "ne" : "en";
  const btn = document.getElementById("ai-translate-btn");
  btn.classList.add("spinning");

  try {
    const res = await authenticatedFetch(`/api/report?lang=${targetLang}`);
    const json = await res.json();
    if (json.aiSummary && json.aiSummary.brief) {
      typeText(
        document.getElementById("ai-brief-text"),
        json.aiSummary.brief,
        true,
      );
    }
  } catch (e) {
    addToast("error", currentLang === "en" ? "Failed" : "असफल");
  } finally {
    btn.classList.remove("spinning");
  }
}

/**
 * Centralized Audio Fetcher
 */
async function fetchAiBriefBlob() {
  const text = document.getElementById("ai-brief-text").innerText;
  if (!text) return null;
  const isPremium = localStorage.getItem("premium-tts") === "true";
  const res = await authenticatedFetch(
    `/api/tts?lang=${currentLang}&quality=${isPremium ? "premium" : "standard"}&text=${encodeURIComponent(text)}`,
  );
  if (!res.ok) throw new Error();
  return await res.blob();
}

/**
 * Downloads the AI Executive Briefing as an MP3 file.
 */
window.downloadAiBriefAudio = async () => {
  const btn = document.getElementById("ai-download-audio-btn");
  const originalHtml = btn.innerHTML;

  try {
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner" style="border-top-color:var(--primary); width:14px; height:14px;"></span>`;
    addToast("info", t("preparingAudio"));

    const blob = await fetchAiBriefBlob();
    if (!blob) return;

    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `DoR_Executive_Briefing_${new Date().toISOString().split("T")[0]}.mp3`;
    a.click();
  } catch (e) {
    addToast("error", "Audio failed");
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
};

/**
 * Shares the AI Executive Briefing MP3 directly via Web Share API
 */
window.shareAiBriefAudio = async () => {
  const btn = document.getElementById("ai-share-audio-btn");
  const originalHtml = btn.innerHTML;

  try {
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner" style="border-top-color:var(--primary); width:14px; height:14px;"></span>`;

    const blob = await fetchAiBriefBlob();
    if (!blob) return;

    const file = new File(
      [blob],
      `DoR_Summary_${new Date().toISOString().slice(0, 10)}.mp3`,
      { type: "audio/mpeg" },
    );

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({
        files: [file],
        title: "DoR Executive Briefing",
        text: "Official Department of Roads Audio Summary",
      });
    } else {
      addToast("error", "Not supported");
    }
  } catch (e) {
    addToast("error", "Share failed");
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
};

/**
 * World-Class Text-to-Speech Engine
 * Integrates Web Speech API for AI summary narration.
 */
let speechSynth = window.speechSynthesis;
let currentUtterance = null;
let originalAiText = "";

window.toggleReadAloud = () => {
  const btn = document.getElementById("ai-read-btn");
  const container = document.getElementById("ai-brief-text");
  const t = I18N[currentLang];

  if (speechSynth.speaking && !speechSynth.paused) {
    speechSynth.pause();
    btn.innerText = "▶️"; // Play icon
    btn.title = t.resumeReading;
    return;
  } else if (speechSynth.paused) {
    speechSynth.resume();
    btn.innerText = "⏸️"; // Pause icon
    btn.title = t.pauseReading;
    return;
  } else if (speechSynth.speaking) {
    // If speaking but not paused (e.g., just started)
    speechSynth.cancel();
    if (originalAiText) container.innerText = originalAiText;
    btn.innerText = "🔊";
    btn.title = t.readAloud;
    return;
  }
  originalAiText = container.innerText;
  if (!originalAiText) return;

  currentUtterance = new SpeechSynthesisUtterance(originalAiText);
  // Map local currentLang to standard BCP 47 language tags
  currentUtterance.lang = currentLang === "ne" ? "ne-NP" : "en-US";

  // Apply User-Selected Voice
  const savedVoiceUri = localStorage.getItem("tts-voice-uri");
  if (savedVoiceUri) {
    const voices = speechSynthesis.getVoices();
    currentUtterance.voice =
      voices.find((v) => v.voiceURI === savedVoiceUri) || null;
  }

  currentUtterance.rate = parseFloat(
    localStorage.getItem("tts-rate") || "0.95",
  );
  currentUtterance.pitch = parseFloat(
    localStorage.getItem("tts-pitch") || "1.0",
  );

  // Prepare Highlightable Spans
  const words = originalAiText.split(/(\s+)/);
  const spanMap = [];
  let cumulativeIdx = 0;

  container.innerHTML = "";
  words.forEach((w) => {
    if (w.trim().length > 0) {
      const span = document.createElement("span");
      span.innerText = w;
      container.appendChild(span);
      spanMap.push({
        start: cumulativeIdx,
        end: cumulativeIdx + w.length,
        el: span,
      });
    } else {
      container.appendChild(document.createTextNode(w));
    }
    cumulativeIdx += w.length;
  });

  currentUtterance.onboundary = (event) => {
    if (event.name !== "word") return;
    const match = spanMap.find(
      (m) => event.charIndex >= m.start && event.charIndex < m.end,
    );
    if (match) {
      spanMap.forEach((m) => m.el.classList.remove("highlight-word"));
      match.el.classList.add("highlight-word");

      // Auto-Scroll: Ensure the currently spoken word stays within the user's view
      match.el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  };

  currentUtterance.onstart = () => {
    btn.innerText = "🛑";
    btn.title = t.pauseReading; // Initially pause, then stop
  };

  currentUtterance.onend = () => {
    container.innerText = originalAiText;
    btn.innerText = "🔊";
    btn.title = t.readAloud;
  };

  speechSynth.speak(currentUtterance);
};

function typeText(element, text, useSound = false) {
  if (element.getAttribute("data-current") === text) return;
  element.setAttribute("data-current", text);

  // Clear existing element-specific timer to prevent overlapping
  if (element._timer) clearInterval(element._timer);
  element.innerText = "";
  element.classList.add("shimmer-text");
  let i = 0;
  element._timer = setInterval(() => {
    if (i < text.length) {
      element.innerText += text.charAt(i);
      if (useSound) playTypeSound();
      i++;
    } else {
      clearInterval(element._timer);
      element.classList.remove("shimmer-text");
    }
  }, 40); // 40ms per character for a smooth terminal feel
}

function showDiagnostics() {
  if (!store) return;
  const criticalRows = store.rows.filter((r) => r._status === "critical");
  const t = I18N[currentLang];
  const dispCount =
    currentLang === "ne"
      ? toNepaliNumerals(criticalRows.length)
      : criticalRows.length;

  // Calculate "Last Month" as default
  const now = new Date();
  now.setMonth(now.getMonth() - 1);
  const lastMonth = now.toISOString().slice(0, 7); // YYYY-MM

  let html = `
        <div class="modal-header">
          <h3 style="color:var(--critical); margin:0;">🚨 System Diagnostics</h3>
          <p style="font-size:0.8rem; opacity:0.8; margin:5px 0 0;">${dispCount} ${currentLang === "ne" ? "सूचकहरूलाई तत्काल ध्यान दिनु आवश्यक छ।" : "indicators require immediate attention."}</p>
        </div>
        <div style="max-height: 400px; overflow-y: auto; margin-top:15px;">
          <div style="margin-bottom: 15px; padding: 12px; background: var(--bg); border-radius: 12px; border: 1px solid var(--border);">
            <label id="lbl-diag-period" style="font-size: 0.7rem; font-weight: 800; display: block; margin-bottom: 8px; color:var(--text-light); text-transform:uppercase;"></label>
            <select id="diag-period-year" style="width:40%; padding:8px; border-radius:8px; border:1px solid var(--border); background:var(--surface); color:var(--text); outline:none;"></select>
            <input type="month" id="diag-period" value="${lastMonth}" lang="${currentLang === "en" ? "en" : "ne"}"
              style="width: 100%; padding: 8px; border-radius: 8px; border: 1px solid var(--border); background: var(--surface); color: var(--text); outline: none;">
          </div>
      `;

  criticalRows.forEach((r) => {
    const name = r[store.headers[0]];
    const prog = getProgress(r, store.headers);
    const dispProg = currentLang === "ne" ? toNepaliNumerals(prog) : prog;
    html += `<div style="padding: 12px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; cursor:pointer;" onclick="showModal('${name.replace(/'/g, "\\'")}', null, true)">
                   <span style="font-weight: 600; font-size:0.85rem;">${name}</span>
                   <span style="color: var(--critical); font-weight: 800; font-size:0.9rem;">${dispProg}%</span>
                 </div>`;
  });

  html += `</div>
        <div style="display:flex; gap:10px; margin-top:15px;">
          <button onclick="exportHealthReport()" style="flex:1; background:var(--critical); color:white; border:none; padding:10px; border-radius:8px; font-weight:bold; cursor:pointer;">📄 Export Health Report (PDF)</button>
          <button onclick="closeModal()" style="flex:1; background:var(--bg); border:1px solid var(--border); padding:10px; border-radius:8px; font-weight:bold; cursor:pointer;">Close</button>
        </div>
        <p style="font-size:0.7rem; color:var(--text-light); margin-top:10px; text-align:center;">Click an item to isolate the record.</p>`;

  document.getElementById("modal-body").innerHTML = html;
  document.getElementById("modal-overlay").style.display = "flex";
}

async function exportHealthReport() {
  const period = document.getElementById("diag-period").value;
  if (!period) return;

  const [year, month] = period.split("-");
  const originalStore = store;
  const originalView = currentView;

  // Generate Bikram Sambat date string using I18N months and Nepali numerals
  const bsYear = parseInt(year) + 57;
  const bsMonthName = t(months[parseInt(month) - 1]);
  const displayYear = currentLang === "ne" ? toNepaliNumerals(bsYear) : bsYear;
  const formattedDate =
    currentLang === "en"
      ? `${bsMonthName} ${displayYear} BS`
      : `${bsMonthName} ${displayYear} वि.सं.`;

  // Customize print header for the audit report
  const reportTitleEl = document.getElementById("h-report");
  const originalTitle = reportTitleEl.innerText;
  reportTitleEl.innerText =
    currentLang === "en"
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
      currentLang === "ne" ? toNepaliNumerals(auditRiskScore) : auditRiskScore;
    riskSummaryEl.innerText =
      currentLang === "en"
        ? `TOTAL RISK SCORE: ${dispScore}%`
        : `कुल जोखिम स्कोर: ${dispScore}%`;

    // Temporarily switch to historical store and filter for critical
    store = json;
    handleSearch("critical");
    setView("table");

    addToast(
      "info",
      currentLang === "en"
        ? `Generating Report for ${period}...`
        : `${period} को लागि प्रतिवेदन तयार गर्दै...`,
    );

    setTimeout(() => {
      window.print();
      // Restore original state
      reportTitleEl.innerText = originalTitle;
      qrEl.src = originalQr;
      riskSummaryEl.style.display = "none";
      store = originalStore;
      render(store);
      setView(originalView);
    }, 800);
  } catch (e) {
    addToast("error", "Failed to generate historical report.");
  } finally {
    document.getElementById("loader").style.display = "none";
  }
}

const I18N = {
  ne: {
    govt: "नेपाल सरकार",
    ministry: "भौतिक पूर्वाधार तथा यातायात मन्त्रालय",
    dept: "सडक विभाग",
    city: "चाकुपाट, ललितपुर",
    reportTitle: "DoR प्रगति प्रतिवेदन (साप्ताहिक)",
    mainTitle: "DoR सडक विभाग",
    total: "कुल सूचक",
    met: "लक्ष्य",
    attention: "ध्यान",
    update: "अन्तिम अपडेट",
    live: "● प्रत्यक्ष",
    offline: "● अफलाइन",
    loading: "लोडिङ",
    search: "खोज",
    progress: "प्रगति",
    refreshing: "रिफ्रेस",
    sec: "सेकेन्ड",
    briefTitle: "सारांश",
    charts: "प्रगति चार्ट",
    auraText: "🤖 मद्दत?",
    auraAnalyzing: "जोखिम विश्लेषण... 🤖🧠",
    auraIsolated: "जोखिम अलग!",
    auraTracing: "सफलता ट्र्याक... 🤖✨",
    auraFiltered: "सफलता फिल्टर!",
    noDataToVisualize: "डाटा छैन",
    linkCopied: "लिंक प्रतिलिपि!",
    checkConnection: "जडान",
    switchLanguage: "भाषा",
    reportHistory: "इतिहास",
    exportPdf: "पीडीएफ",
    downloadOfficialPdf: "डाउनलोड",
    muteUnmute: "ध्वनि",
    settings: "सेटिङ",
    translateBrief: "अनुवाद",
    readAloud: "वाचन",
    shareAudio: "साझा",
    downloadAudio: "डाउनलोड",
    shareBrief: "साझा",
    printMemo: "प्रिन्ट",
    tableView: "तालिका",
    chartsView: "चार्ट",
    cardsView: "कार्ड",
    stable: "प्रणाली स्थिर: जोखिम १०% भन्दा कम",
    netHealth: "नेटवर्क अवस्था",
    latency: "विलम्बता",
    latest: "भर्खरै",
    poweredBy: "द्वारा संचालित",
    ago: "पटक अघि",
    justNow: "भर्खरै",
    secsAgo: "सेकेन्ड अघि",
    minsAgo: "मिनेट अघि",
    noResults: "नतिजा भेटिएन",
    retrySearch: "सफाइ",
    results: "नतिजाहरू",
    connStrength: "लिंक:",
    connExcellent: "उत्कृष्ट",
    connGood: "राम्रो",
    connFair: "ठीकै",
    connPoor: "कमजोर",
    year: "वर्ष",
    selectMonth: "महिना छान्नुहोस्",
    diagPeriod: "लेखापरीक्षण अवधि",
    verificationTitle: "प्रतिवेदन प्रमाणीकरण",
    verifiedSuccess: "✅ प्रमाणित",
    invalidReport: "❌ अमान्य",
    settings: "सेटिङहरू",
    theme: "थिम प्राथमिकता",
    themeLight: "लाइट मोड",
    themeDark: "डार्क मोड",
    themeSystem: "प्रणाली पूर्वनिर्धारित",
    clearCache: "क्यास सफाइ",
    resetAll: "रिसेट",
    resetConfirm: "सबै डेटा मेटिनेछ। निश्चित हुनुहुन्छ?",
    totalCache: "कुल पीवाइई (PWA) क्यास",
    downloadOffline: "अफलाइन डाउनलोड",
    downloading: "डाउनलोड",
    downloadComplete: "डाउनलोड सम्पन्न",
    forceThrottled: "पुनः लोड सीमा पुग्यो। हालैको डेटा प्रयोग गर्दै।",
    cacheCleared: "क्यास सफा",
    qualifying: "योग्यता जाँच्दै...",
    storageUsage: "भण्डारण उपयोग",
    calculating: "गणना गर्दै...",
    lowData: "कम डाटा मोड",
    uiVolume: "प्रणाली ध्वनि भोल्युम",
    muteAll: "म्यूट",
    dbBackup: "क्लाउड ब्याकअप",
    dbBackupDesc: "डाटाबेस स्न्यापशट सुरक्षित गर्नुहोस्",
    dbRestore: "रिस्टोर",
    dbRestoreDesc: "क्लाउडबाट डाटा रिकभर गर्नुहोस्",
    dataSyncing: "डाटा सिङ्क हुँदैछ...",
    readAloud: "वाचन",
    stopReading: "रोक्नुहोस्",
    downloadAudio: "डाउनलोड",
    shareAudio: "साझा",
    preparingAudio: "तयारी...",
    voiceSelection: "आवाज चयन",
    voiceDesc: "पढ्नको लागि आवाज छान्नुहोस्",
    speechPitch: "पढ्ने पिच",
    speechPitchDesc: "आवाजको टोन मिलाउनुहोस्",
    pauseReading: "पज",
    resumeReading: "पुनः सुरु",
    speechRate: "पढ्ने गति",
    speechRateDesc: "पढेर सुनाउने गति मिलाउनुहोस्",
    darkSchedule: "डार्क मोड शेड्युल",
    darkScheduleDesc: "समय अनुसार थिम परिवर्तन",
    systemFont: "प्रणाली फन्ट प्रयोग गर्नुहोस्",
    systemFontDesc: "मानक ओएस फन्ट प्रयोग गर्नुहोस्",
    fontSize: "फन्ट साइज",
    fontSizeDesc: "राम्रो पढ्न योग्यताको लागि फन्ट साइज मिलाउनुहोस्",
    soundPitch: "पिच",
    soundPack: "ध्वनि प्याक",
    highContrast: "उच्च कन्ट्रास्ट मोड",
    highContrastDesc: "अधिकतम दृश्यताको लागि कालो र सेतो थिम प्रयोग गर्नुहोस्",
    grayscale: "ग्रेस्केल मोड",
    grayscaleDesc: "रंग अन्धोपन भएका प्रयोगकर्ताहरूको लागि रङ्गहरू हटाउनुहोस्",
    blueLightFilter: "निलो प्रकाश फिल्टर",
    blueLightDesc: "राती आँखाको आरामको लागि न्यानो रङ्गहरू प्रयोग गर्नुहोस्",
    resetAudio: "ध्वनि रिसेट",
    packModern: "आधुनिक",
    packClassic: "क्लासिक",
    packRetro: "रेट्रो",
    updateReady: "नयाँ संस्करण। अपडेट गर्ने?",
    lowDataDesc: "छिटो लोड गर्न एआई विश्लेषण असक्षम गर्नुहोस्",
    appVersion: "एप संस्करण",
    whatsNew: "नयाँ",
    downloading: "डाउनलोड हुँदैछ",
    checkUpdates: "अपडेट जाँच",
    install: "इन्स्टल",
    installSuccess: "इन्स्टल सम्पन्न",
    months: [
      "वैशाख",
      "जेठ",
      "असार",
      "साउन",
      "भदौ",
      "असोज",
      "कात्तिक",
      "मंसिर",
      "पुस",
      "माघ",
      "फागुन",
      "चैत",
    ],
  },
  en: {
    govt: "Government of Nepal",
    ministry: "Ministry of Physical Infrastructure & Transport",
    dept: "Department of Roads",
    city: "Chakupat, Lalitpur",
    reportTitle: "DoR Progress Report (Weekly)",
    mainTitle: "DoR MIS Dashboard",
    total: "Total",
    met: "Met",
    attention: "Attention",
    update: "Updated",
    live: "● LIVE",
    offline: "● OFFLINE",
    loading: "Loading",
    search: "Search",
    progress: "PROGRESS",
    refreshing: "Refreshing",
    sec: "s",
    briefTitle: "Briefing",
    charts: "Progress Charts",
    auraText: "🤖 Help?",
    auraAnalyzing: "Analyzing... 🤖🧠",
    auraIsolated: "Isolated!",
    auraTracing: "Tracing... 🤖✨",
    auraFiltered: "Filtered!",
    noDataToVisualize: "No data",
    linkCopied: "Link copied!",
    stable: "System Stable: Risk level below 10%",
    netHealth: "Network Health",
    latency: "Latency",
    latest: "Latest",
    poweredBy: "Powered by",
    ago: "refreshes ago",
    justNow: "Just now",
    secsAgo: "s ago",
    minsAgo: "m ago",
    noResults: "No results",
    retrySearch: "Clear",
    results: "Results",
    connStrength: "Link:",
    connExcellent: "Excellent",
    connGood: "Good",
    connFair: "Fair",
    connPoor: "Poor",
    year: "Year",
    selectMonth: "Select Month",
    diagPeriod: "Audit Period",
    verificationTitle: "Report Verification",
    verifiedSuccess: "✅ Verified",
    invalidReport: "❌ Invalid",
    checkConnection: "Connection",
    switchLanguage: "Language",
    reportHistory: "History",
    exportPdf: "PDF",
    downloadOfficialPdf: "Download",
    muteUnmute: "Sound",
    settings: "Settings",
    translateBrief: "Translate",
    readAloud: "Narration",
    shareAudio: "Share",
    downloadAudio: "Download",
    shareBrief: "Share",
    printMemo: "Print",
    tableView: "Table",
    chartsView: "Charts",
    cardsView: "Cards",
    settings: "Settings",
    theme: "Theme Preference",
    themeLight: "Light Mode",
    themeDark: "Dark Mode",
    themeSystem: "System Default",
    clearCache: "Clear Cache",
    resetAll: "Reset",
    resetConfirm: "All data will be deleted. Proceed?",
    totalCache: "Total PWA Cache",
    downloadOffline: "Offline Download",
    downloading: "Downloading",
    downloadComplete: "Download Complete",
    forceThrottled: "Refresh limit reached. Using cache.",
    cacheCleared: "Cache cleared",
    qualifying: "Qualifying...",
    storageUsage: "Storage Usage",
    calculating: "Calculating...",
    lowData: "Low Data Mode",
    uiVolume: "UI Sound Volume",
    muteAll: "Mute",
    dbBackup: "Cloud Backup",
    dbBackupDesc: "Save database snapshot to KV",
    dbRestore: "Restore",
    dbRestoreDesc: "Recover data from a cloud snapshot",
    dataSyncing: "Syncing...",
    readAloud: "Narration",
    stopReading: "Stop",
    downloadAudio: "Download",
    shareAudio: "Share",
    preparingAudio: "Preparing...",
    voiceSelection: "Voice Selection",
    voiceDesc: "Choose a voice for reading",
    speechPitch: "Speech Pitch",
    speechPitchDesc: "Adjust the voice tone",
    pauseReading: "Pause",
    resumeReading: "Resume",
    speechRate: "Speech Speed",
    speechRateDesc: "Adjust the narration speed",
    darkSchedule: "Dark Mode Schedule",
    darkScheduleDesc: "Schedule based theme",
    systemFont: "Use System Font",
    systemFontDesc: "Use standard OS typography",
    fontSize: "Font Size",
    fontSizeDesc: "Adjust font size for better readability",
    soundPitch: "Pitch",
    soundPack: "Sound Pack",
    highContrast: "High Contrast Mode",
    highContrastDesc: "Use pure black and white for maximum visibility",
    grayscale: "Grayscale Mode",
    grayscaleDesc: "Remove colors for users with color blindness",
    blueLightFilter: "Blue Light Filter",
    blueLightDesc: "Use warmer colors for eye comfort at night",
    resetAudio: "Reset Audio",
    packModern: "Modern",
    packClassic: "Classic",
    packRetro: "Retro",
    updateReady: "New version. Update?",
    lowDataDesc: "Disable AI analysis for faster loading",
    appVersion: "App Version",
    whatsNew: "What's New",
    downloading: "Downloading",
    checkUpdates: "Check Updates",
    install: "Install",
    installSuccess: "Installed",
    months: [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ],
  },
};

// Minimal critical translations hardcoded for bootstrapping
const CRITICAL_LABELS = {
  ne: {
    govt: "नेपाल सरकार",
    ministry: "भौतिक पूर्वाधार तथा यातायात मन्त्रालय",
    dept: "सडक विभाग",
    city: "चाकुपाट, ललितपुर",
    mainTitle: "DoR सडक विभाग",
    reportTitle: "DoR प्रगति प्रतिवेदन (साप्ताहिक)",
    total: "कुल सूचक",
    met: "लक्ष्य",
    attention: "ध्यान",
    update: "अन्तिम अपडेट",
    live: "● प्रत्यक्ष",
    offline: "● अफलाइन",
    search: "खोज",
    progress: "प्रगति",
    results: "नतिजाहरू",
  },
  en: {
    govt: "Government of Nepal",
    ministry: "Ministry of Physical Infrastructure & Transport",
    dept: "Department of Roads",
    city: "Chakupat, Lalitpur",
    mainTitle: "DoR MIS Dashboard",
    reportTitle: "DoR Progress Report (Weekly)",
    total: "Total",
    met: "Met",
    attention: "Attention",
    update: "Updated",
    live: "● LIVE",
    offline: "● OFFLINE",
    search: "Search",
    progress: "PROGRESS",
    results: "Results",
  },
};

let currentLang = "ne"; // Initialize to Nepali by default
let currentView = "table";
let currentSort = { key: null, dir: 1 };
let searchText = "";
let store = null;
let deferredPrompt;
let systemRiskLevel = 0;
let refreshCounter = 60;
let intentTimer = null;
let lastSnapshotUpdate = null; // Track lastUpdate for automatic snapshot creation

/**
 * Translation Helper
 * Priority: Dynamic JSON from Sheet > Hardcoded I18N fallback > Key name
 */
const t = (key, count) => {
  let finalKey = key;

  if (count !== undefined) {
    const rule = new Intl.PluralRules(currentLang).select(count);
    const pKey = `${key}_${rule}`;
    // Check if the specific plural key exists, otherwise fallback to base key
    if (translationsData?.[currentLang]?.[pKey] || I18N[currentLang]?.[pKey]) {
      finalKey = pKey;
    }
  }

  let text =
    translationsData?.[currentLang]?.[finalKey] ||
    I18N[currentLang]?.[finalKey] ||
    translationsData?.[currentLang]?.[key] ||
    I18N[currentLang]?.[key] ||
    key;

  if (count !== undefined) {
    const displayCount = currentLang === "ne" ? toNepaliNumerals(count) : count;
    return text.replace("{{count}}", displayCount);
  }
  return text;
};

/**
 * Scans the DOM for elements with data-i18n attributes and updates them.
 */
function applyTranslations() {
  // Translate standard text content
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    const countAttr = el.getAttribute("data-i18n-count");
    const count = countAttr !== null ? parseFloat(countAttr) : undefined;
    el.innerText = t(key, count);
  });

  // Generic attribute translation: title, placeholder, aria-label
  ["title", "placeholder", "aria-label"].forEach((attr) => {
    document.querySelectorAll(`[data-i18n-${attr}]`).forEach((el) => {
      el.setAttribute(attr, t(el.getAttribute(`data-i18n-${attr}`)));
    });
  });
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
      if (!auraHalo.classList.contains("critical")) playPing();
      auraGlow.classList.add("pulsing");
      auraHalo.classList.add("critical");

      // Calculate dynamic intensity: higher risk = faster, wider glitch
      const offset = 1 + systemRiskLevel * 5; // 1px to 6px
      const duration = 0.15 - systemRiskLevel * 0.1; // 0.15s to 0.05s
      auraText.style.setProperty("--glitch-offset", `${offset}px`);
      auraText.style.setProperty("--glitch-dur", `${duration}s`);
      auraText.classList.add("glitch");

      // Expand halo based on risk
      auraHalo.style.setProperty("--halo-scale", 1 + systemRiskLevel * 1.5);

      if (!intentTimer)
        intentTimer = setTimeout(() => {
          handleSearch("critical");
          typeText(auraText, t("auraIsolated"));
        }, 1000);
    } else if (title.includes("met") || title.includes("पूरा")) {
      typeText(auraText, t("auraTracing"));
      auraGlow.classList.remove("pulsing");
      auraHalo.classList.remove("critical");
      auraText.classList.remove("glitch");
      auraHalo.style.setProperty("--halo-scale", 1);
      if (!intentTimer)
        intentTimer = setTimeout(() => {
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
    if (intentTimer) {
      clearTimeout(intentTimer);
      intentTimer = null;
    }
  }
});

// Language Detection
const userLocale = navigator.language || navigator.userLanguage;
const initialLang = userLocale.startsWith("en") ? "en" : "ne";

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
  const isDark =
    window.matchMedia &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;
  const systemTheme = isDark ? "dark" : "light";
  // Apply the theme visually but do not persist it to localStorage
  setTheme(systemTheme, false);
  originalTheme = systemTheme; // Ensure revertTheme tracks the system state
  addToast(
    "info",
    currentLang === "en"
      ? "Theme reset to system default."
      : "थिम प्रणाली पूर्वनिर्धारितमा रिसेट गरियो।",
  );
};

window.toggleTheme = () => {
  const current = document.body.getAttribute("data-theme") || "light";
  setTheme(current === "dark" ? "light" : "dark");
};

window.setLang = async function (l) {
  const prevLang = currentLang;
  currentLang = l;
  localStorage.setItem("pref-lang", l);

  // Update switch UI
  const lbl = document.getElementById("lang-current-label");
  if (lbl) lbl.innerText = l.toUpperCase();

  // UI Sync
  applyTranslations();
  currentSort = { key: null, dir: 1 };

  // Total UI Update
  document.getElementById("main-title").innerText = t("mainTitle");

  // Update Gemini badge text
  const gBadge = document.getElementById("gemini-badge");
  if (gBadge) gBadge.innerHTML = `${t("poweredBy")} <span>Gemini</span>`;

  renderDropdowns();

  // Trigger data reload if language changed or first load
  if (prevLang !== l) {
    document.getElementById("loader").style.display = "flex";
    document.getElementById("loading-msg").innerText = t("loading");
    await loadData();
  } else if (store) {
    render(store);
  }
};

window.setView = setView;
function setView(v) {
  currentView = v;
  document
    .querySelectorAll("#view-toggle .toggle-btn")
    .forEach((b) => b.classList.toggle("active", b.id === "btn-" + v));
  document
    .getElementById("view-table")
    .classList.toggle("active-view", v === "table");
  document
    .getElementById("view-cards")
    .classList.toggle("active-view", v === "cards");
  document
    .getElementById("view-charts")
    .classList.toggle("active-view", v === "charts");
  document.getElementById("view-verify").style.display =
    v === "verify" ? "block" : "none";
  document.getElementById("view-history").style.display =
    v === "history" ? "block" : "none";
  if (store) render(store);
}

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
  addToast("success", t("linkCopied"));
}

window.renderDropdowns = renderDropdowns;
function renderDropdowns() {
  const mSelect = document.getElementById("summary-month");
  const ySelect = document.getElementById("summary-year");
  if (!mSelect || !ySelect) return;

  const savedM = mSelect.value;
  const savedY = ySelect.value;

  // Populate Months from I18N Fallback
  mSelect.innerHTML = I18N[currentLang].months
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
        `<option value="${y}">${currentLang === "ne" ? toNepaliNumerals(y + 57) + " वि.सं." : y + " AD"}</option>`,
    )
    .join("");

  if (savedM) mSelect.value = savedM;
  if (savedY) ySelect.value = savedY;
}

window.toggleHistory = toggleHistory;
async function toggleHistory() {
  if (currentView === "history") {
    setView("table");
    return;
  }
  setView("history");
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

  if (tab === "weekly") fetchWeeklyHistory();
}

let weeklyArchives = [];

async function logAnalytics(eventName, eventData = {}) {
  const payload = {
    eventName,
    eventData,
    url: window.location.href,
    time: new Date().toISOString(),
  };

  // 1. Save to IndexedDB
  const dbRequest = indexedDB.open("dor_mis_db", 1);
  dbRequest.onupgradeneeded = (e) =>
    e.target.result.createObjectStore("analytics", { autoIncrement: true });

  dbRequest.onsuccess = (e) => {
    const db = e.target.result;
    const tx = db.transaction("analytics", "readwrite");
    tx.objectStore("analytics").add(payload);

    tx.oncomplete = async () => {
      // 2. Register for Sync
      if ("serviceWorker" in navigator && "SyncManager" in window) {
        const reg = await navigator.serviceWorker.ready;
        try {
          await reg.sync.register("send-analytics");
        } catch (err) {
          console.warn("Sync registration failed, likely offline", err);
        }
      }
    };
  };
}

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

  let html = weeklyArchives
    .map(
      (h) => `
        <div class="chart-card">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px">
            <b style="font-size:1.1rem">📅 ${h.date}</b>
            <button onclick="downloadPdf('${h.date}')" style="border:none; cursor:pointer; font-size:0.7rem; background:var(--critical); color:white; padding:4px 8px; border-radius:4px">PDF</button>
          </div>
          <p style="font-size:0.8rem; opacity:0.8">${h.summary}</p>
          <button onclick="loadSnapshot('${h.date}')" style="width:100%; margin-top:10px; border:1px solid var(--primary); background:none; color:var(--primary); padding:8px; border-radius:8px; cursor:pointer; font-weight:bold">View Data</button>
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
    loadSnapshot(weeklyArchives[0].date);
  }
}

window.loadCumulative = loadCumulative;
async function loadCumulative(type) {
  document.getElementById("loader").style.display = "flex";
  const year = document.getElementById("summary-year").value;
  const month = document.getElementById("summary-month").value;
  const period = `${year}-${month}`; // Construct period for API

  const res = await authenticatedFetch(
    `${WORKER_BASE}/api/summary?type=${type}&year=${year}&month=${month}&lang=${currentLang}`,
  );
  const json = await res.json();
  store = json;
  render(json);
  setView("table");
  document.getElementById("loader").style.display = "none";
  addToast(
    "success",
    currentLang === "en"
      ? `Cumulative ${type} report generated for ${period}.`
      : `${period} को लागि संचयी ${type} प्रतिवेदन उत्पन्न भयो।`,
  );
}

window.downloadConsolidatedPdf = downloadConsolidatedPdf;
async function downloadConsolidatedPdf() {
  const year = document.getElementById("summary-year").value;
  const type = document
    .getElementById("hist-weekly-btn")
    .classList.contains("active")
    ? "weekly"
    : "monthly";
  const month = document.getElementById("summary-month").value;

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
  const t = I18N[currentLang];

  try {
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<span class="spinner" style="border-top-color:var(--primary); width:16px; height:16px;"></span> ${t.downloading} 0%`;
    }

    const res = await authenticatedFetch(`/api/pdf?date=${date}`);

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
          currentLang === "ne" ? toNepaliNumerals(percent) : percent;
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
      addToast(
        "error",
        currentLang === "en"
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
    `/api/report?date=${date}&lang=${currentLang}`,
  );
  const json = await res.json();
  store = json;
  render(json);
  setView("table");
  document.getElementById("loader").style.display = "none";
  addToast("info", `Viewing data from ${date}`);
}

window.handleVerification = handleVerification;
async function handleVerification() {
  const params = new URLSearchParams(window.location.search);
  const type = params.get("type");
  const period = params.get("period"); // Format: YYYY-MM or YYYY-MM-DD

  if (!type || !period) return;

  setView("verify");
  document.getElementById("loader").style.display = "flex";
  document.getElementById("verify-title").innerText =
    I18N[currentLang].verificationTitle;

  try {
    // Construct internal API call to verify existence in KV (ensure year is passed for summary)
    const endpoint =
      type === "monthly"
        ? `/api/summary?type=monthly&year=${period.split("-")[0]}&month=${period.split("-")[1]}&lang=${currentLang}`
        : `/api/report?date=${period}&lang=${currentLang}`;
    const res = await authenticatedFetch(endpoint);
    if (res.ok) {
      document.getElementById("verify-msg").innerText =
        I18N[currentLang].verifiedSuccess;
      document.getElementById("verify-msg").style.color = "var(--good)";
      document.getElementById("verify-details").innerHTML =
        `<b>Type:</b> ${type.toUpperCase()}<br><b>Period:</b> ${period}<br><b>Status:</b> SYSTEM_MATCH_FOUND`;
    } else {
      throw new Error();
    }
  } catch (e) {
    document.getElementById("verify-msg").innerText =
      I18N[currentLang].invalidReport;
    document.getElementById("verify-msg").style.color = "var(--critical)";
  }
  if (document.getElementById("loader"))
    document.getElementById("loader").style.display = "none";
}

window.checkDeepLink = checkDeepLink;
function checkDeepLink() {
  const params = new URLSearchParams(window.location.search);
  const indicatorName = params.get("indicator");
  if (indicatorName && store) {
    showModal(indicatorName, null, true);
  }
}

window.handleSearch = handleSearch;
function handleSearch(term) {
  const input = document.getElementById("search-input");
  const clearBtn = document.getElementById("clear-search");
  if (term !== undefined) input.value = term;
  searchText = input.value.toLowerCase();

  if (clearBtn) clearBtn.style.display = searchText ? "block" : "none";

  // Populate suggestions from the first column (Indicators)
  if (store && store.headers && store.headers.length > 0) {
    const indicatorKey = store.headers[0];
    const dl = document.getElementById("search-suggestions");
    if (dl) {
      const matches = store.rows
        .map((r) => String(r[indicatorKey] || ""))
        .filter((v) => v.toLowerCase().includes(searchText))
        .slice(0, 10);
      dl.innerHTML = [...new Set(matches)]
        .map((m) => `<option value="${m}">`)
        .join("");
    }
  }

  if (store) render(store);
}

window.sortData = sortData;
function sortData(key) {
  if (currentSort.key === key) currentSort.dir *= -1;
  else {
    currentSort.key = key;
    currentSort.dir = 1;
  }
  render(store);
}

window.shareApp = shareApp;
function shareApp() {
  if (navigator.share) {
    navigator.share({
      title: "DoR MIS Dashboard",
      text: "Check the latest Department of Roads Progress Report.",
      url: window.location.href,
    });
  } else {
    // Fallback for browsers that don't support Web Share API
    navigator.clipboard.writeText(window.location.href); // Copy URL to clipboard
    alert(I18N[currentLang].linkCopied); // Use localized alert message
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

window.showModal = showModal;
function showModal(indicatorName) {
  const r = store.rows.find((row) => row[store.headers[0]] === indicatorName);
  if (!r) return;
  const headers = store.headers;
  const progress = getProgress(r, headers);
  const dispProg = currentLang === "ne" ? toNepaliNumerals(progress) : progress;

  let details = "";
  headers.forEach((h, i) => {
    if (r[h])
      details += `<div class="modal-item"><b>${h}</b> ${currentLang === "ne" ? toNepaliNumerals(r[h]) : r[h]}</div>`;
  });

  document.getElementById("modal-body").innerHTML = `
    <div class="modal-header">
      <div style="display:flex; justify-content:space-between; align-items:start">
        <h3 style="margin:0">${t(r[headers[0]])}</h3>
        <span style="font-size:0.6rem;background:var(--bg);padding:4px 10px;border-radius:6px;font-weight:bold;color:var(--primary)">${dispProg}% DONE</span>
      </div>
      <div style="margin-top:20px; text-align:center">
        <div style="height:8px; background:var(--bg); border-radius:10px; overflow:hidden; border:1px solid var(--border)">
          <div style="width:${progress}%; height:100%; background:var(--primary); transition:width 1s"></div>
        </div>
      </div>
    </div>
    <div class="modal-grid">${details}</div>
    <p style="margin-top:20px; padding:15px; background:var(--bg); border-radius:12px; border:1px solid var(--border); font-style:italic; color:var(--text-light)">${r._insight || ""}</p>
  `;
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
  const t = I18N[currentLang];
  if (!("serviceWorker" in navigator)) return;

  const btn = document.getElementById("update-check-btn");
  if (btn) btn.disabled = true;

  addToast(
    "info",
    currentLang === "en" ? "Checking for updates..." : "अपडेट जाँच गर्दै...",
  );

  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg) {
      await reg.update();
      // If an update is found, the 'updatefound' event listener
      // we previously added will trigger the persistent update toast.
      setTimeout(() => {
        if (!reg.installing && !reg.waiting) {
          addToast(
            "success",
            currentLang === "en" ? "App is up to date." : "एप अद्यावधिक छ।",
          );
          if (btn) btn.disabled = false;
        }
      }, 2000);
    }
  } catch (e) {
    addToast("error", "Update check failed.");
    if (btn) btn.disabled = false;
  }
};

async function getSwChangelog() {
  if (!navigator.serviceWorker || !navigator.serviceWorker.controller)
    return null;
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
  if (!navigator.serviceWorker || !navigator.serviceWorker.controller)
    return "v2.0.x";
  return new Promise((resolve) => {
    const messageChannel = new MessageChannel();
    messageChannel.port1.onmessage = (event) => resolve(event.data.version);
    navigator.serviceWorker.controller.postMessage({ action: "get-version" }, [
      messageChannel.port2,
    ]);
    setTimeout(() => resolve("v2.0.x"), 1000);
  });
}

// PDF Snapshot Code// PDF Snapshot Management Functions
let snapshotList = [];
window.createSnapshotManual = async () => {
  var btn = event.target;
  var originalText = btn.innerText;
  btn.innerText = "Creating...";
  btn.disabled = true;
  try {
    var adminKey = prompt("Enter Admin Secret to create snapshot:");
    if (!adminKey) {
      btn.innerText = originalText;
      btn.disabled = false;
      return;
    }
    if (!store) {
      addToast("error", "No data");
      btn.innerText = originalText;
      btn.disabled = false;
      return;
    }
    var response = await fetch(WORKER_BASE + "/api/snapshot", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Admin-Secret": adminKey,
      },
      body: JSON.stringify({
        records: store.rows || [],
        meta: {
          lastUpdate:
            store.lastUpdate || new Date().toISOString().split("T")[0],
          total: store.rows?.length || 0,
        },
      }),
    });
    if (response.ok) {
      await response.json();
      addToast("success", "Snapshot created!");
      listSnapshots(true);
    } else {
      addToast("error", "Failed");
    }
  } catch (e) {
    addToast("error", "Failed");
  } finally {
    btn.innerText = originalText;
    btn.disabled = false;
  }
};
window.listSnapshots = async (force) => {
  var container = document.getElementById("snapshot-list-container");
  var listEl = document.getElementById("snapshot-list");
  if (container.style.display !== "none" && !force) {
    container.style.display = "none";
    return;
  }
  try {
    var adminKey = prompt("Enter Admin Secret:");
    if (!adminKey) return;
    var response = await fetch(WORKER_BASE + "/api/snapshots", {
      headers: { "X-Admin-Secret": adminKey },
    });
    if (!response.ok) {
      addToast("error", "Failed");
      return;
    }
    var data = await response.json();
    snapshotList = data.snapshots || [];
    if (snapshotList.length === 0) {
      listEl.innerHTML = "<p style='font-size: 0.7rem;'>No snapshots</p>";
    } else {
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
    addToast("error", "Failed");
  }
};
window.downloadSnapshot = async (date) => {
  var adminKey = prompt("Enter Admin Secret:");
  if (!adminKey) return;
  try {
    var response = await fetch(WORKER_BASE + "/api/snapshot?date=" + date, {
      headers: { "X-Admin-Secret": adminKey },
    });
    if (!response.ok) {
      addToast("error", "Failed");
      return;
    }
    var blob = await response.blob();
    var url = window.URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "DoR_Snapshot_" + date + ".pdf";
    a.click();
    window.URL.revokeObjectURL(url);
    addToast("success", "Downloaded");
  } catch (e) {
    addToast("error", "Failed");
  }
};
window.deleteSnapshot = async (date) => {
  if (!confirm("Delete " + date + "?")) return;
  var adminKey = prompt("Enter Admin Secret:");
  if (!adminKey) return;
  try {
    var response = await fetch(WORKER_BASE + "/api/snapshot?date=" + date, {
      method: "DELETE",
      headers: { "X-Admin-Secret": adminKey },
    });
    if (response.ok) {
      addToast("success", "Deleted");
      listSnapshots(true);
    } else {
      addToast("error", "Failed");
    }
  } catch (e) {
    addToast("error", "Failed");
  }
};

window.showSettings = async () => {
  const t = I18N[currentLang];
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

  // Clear the "New Feature" badge
  localStorage.setItem("app-version-seen", swVersion);
  document.getElementById("settings-btn")?.classList.remove("has-badge");

  // Get available voices and filter by current language
  const voices = speechSynthesis.getVoices();
  const langPrefix = currentLang === "ne" ? "ne" : "en";
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

  document.getElementById("modal-body").innerHTML = `
        <div class="modal-header">
          <div style="display:flex; justify-content:space-between; align-items:center">
            <h3 style="margin:0">${t.settings}</h3>
            <span style="font-size:0.6rem; opacity:0.6; font-weight:800; background:var(--bg); padding:2px 8px; border-radius:10px;">
              ${t.appVersion}: ${currentLang === "ne" ? toNepaliNumerals(swVersion) : swVersion}
            </span>
          </div>
        </div>
        <div style="padding: 10px 0;">
          ${
            changelog
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
          <label style="font-size: 0.7rem; font-weight: 800; text-transform: uppercase; color: var(--text-light); margin-bottom: 10px; display: block;">${t.theme}</label>
          <div class="theme-selector" onmouseleave="revertTheme()">
            <div class="theme-option light-opt ${originalTheme === "light" ? "active" : ""}" data-theme="light" onmouseenter="setTheme('light', false)" onclick="setTheme('light', true)">
              <div class="mini-dash"></div>
              <span>${t.themeLight}</span>
            </div>
            <div class="theme-option dark-opt ${originalTheme === "dark" ? "active" : ""}" data-theme="dark" onmouseenter="setTheme('dark', false)" onclick="setTheme('dark', true)">
              <div class="mini-dash"></div>
              <span>${t.themeDark}</span>
            </div>
          </div>
          <div style="margin-top: 20px; padding: 12px; background: var(--bg); border-radius: 12px; border: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between;">
            <div style="text-align: left;">
              <div style="font-size: 0.8rem; font-weight: 800; color: var(--text);">${t.lowData}</div>
              <div style="font-size: 0.65rem; color: var(--text-light);">${t.lowDataDesc}</div>
            </div>
            <label class="toggle-btn" style="padding: 4px; display: flex; align-items: center; gap: 8px; cursor: pointer;">
              <input type="checkbox" id="low-data-toggle" ${isLowData ? "checked" : ""} onchange="toggleLowData(this.checked)" style="width: 18px; height: 18px; cursor: pointer; accent-color: var(--primary);">
            </label>
          </div>
          <div style="margin-top: 15px; padding: 12px; background: var(--bg); border-radius: 12px; border: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between;">
            <div style="text-align: left;">
              <div style="font-size: 0.8rem; font-weight: 800; color: var(--text);">${t.darkSchedule}</div>
              <div style="font-size: 0.65rem; color: var(--text-light);">${t.darkScheduleDesc}</div>
            </div>
            <label class="toggle-btn" style="padding: 4px; display: flex; align-items: center; gap: 8px; cursor: pointer;">
              <input type="checkbox" id="dark-schedule-toggle" ${isSchedule ? "checked" : ""} onchange="toggleDarkSchedule(this.checked)" style="width: 18px; height: 18px; cursor: pointer; accent-color: var(--primary);">
            </label>
          </div>
          <div style="margin-top: 15px; padding: 12px; background: var(--bg); border-radius: 12px; border: 1px solid var(--border);">
            <div style="text-align: left; margin-bottom: 10px;">
              <div style="font-size: 0.8rem; font-weight: 800; color: var(--text);">${t.voiceSelection}</div>
              <div style="font-size: 0.65rem; color: var(--text-light);">${t.voiceDesc}</div>
            </div>
            <select onchange="updateVoicePreference(this.value)" style="width: 100%; padding: 8px; border-radius: 8px; border: 1px solid var(--border); background: var(--surface); color: var(--text); font-size: 0.75rem; outline: none;">
              <option value="">Default System Voice</option>
              ${voiceOptions}
            </select>
          </div>
          <div style="margin-top: 15px; padding: 12px; background: var(--bg); border-radius: 12px; border: 1px solid var(--border);">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
              <div style="text-align: left;">
                <div style="font-size: 0.8rem; font-weight: 800; color: var(--text);">${t.speechPitch}</div>
                <div style="font-size: 0.65rem; color: var(--text-light);">${t.speechPitchDesc}</div>
              </div>
              <div id="speech-pitch-val" style="font-size: 0.8rem; font-weight: 800; color: var(--primary);">${currentLang === "ne" ? toNepaliNumerals(speechPitch) : speechPitch}x</div>
            </div>
            <input type="range" min="0.5" max="2.0" step="0.05" value="${speechPitch}" oninput="updateSpeechPitch(this.value)" style="width:100%; height:6px; accent-color: var(--primary); background:var(--surface); border-radius:3px; outline:none; cursor:pointer;">
          </div>
          <div style="margin-top: 15px; padding: 12px; background: var(--bg); border-radius: 12px; border: 1px solid var(--border);">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
              <div style="text-align: left;">
                <div style="font-size: 0.8rem; font-weight: 800; color: var(--text);">${t.speechRate}</div>
                <div style="font-size: 0.65rem; color: var(--text-light);">${t.speechRateDesc}</div>
              </div>
              <div id="speech-rate-val" style="font-size: 0.8rem; font-weight: 800; color: var(--primary);">${currentLang === "ne" ? toNepaliNumerals(speechRate) : speechRate}x</div>
            </div>
            <input type="range" min="0.5" max="2.0" step="0.05" value="${speechRate}" oninput="updateSpeechRate(this.value)" style="width:100%; height:6px; accent-color: var(--primary); background:var(--surface); border-radius:3px; outline:none; cursor:pointer;">
          </div>
          <div style="margin-top: 15px; padding: 12px; background: var(--bg); border-radius: 12px; border: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between;">
            <div style="text-align: left;">
              <div style="font-size: 0.8rem; font-weight: 800; color: var(--text);">${t.systemFont}</div>
              <div style="font-size: 0.65rem; color: var(--text-light);">${t.systemFontDesc}</div>
            </div>
            <label class="toggle-btn" style="padding: 4px; display: flex; align-items: center; gap: 8px; cursor: pointer;">
              <input type="checkbox" id="system-font-toggle" ${isSystemFont ? "checked" : ""} onchange="toggleSystemFont(this.checked)" style="width: 18px; height: 18px; cursor: pointer; accent-color: var(--primary);">
            </label>
          </div>
          <div style="margin-top: 15px; padding: 12px; background: var(--bg); border-radius: 12px; border: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between;">
            <div style="text-align: left;">
              <div style="font-size: 0.8rem; font-weight: 800; color: var(--text);">${t.dbBackup}</div>
              <div style="font-size: 0.65rem; color: var(--text-light);">${t.dbBackupDesc}</div>
            </div>
            <button id="db-backup-btn" onclick="triggerDatabaseBackup()" class="icon-btn" style="width: auto; padding: 0 12px; border-radius: 8px; font-size: 0.7rem; font-weight: 800;">
              BACKUP
            </button>
          </div>
          <div style="margin-top: 15px; padding: 12px; background: var(--bg); border-radius: 12px; border: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between;">
            <div style="text-align: left;">
              <div style="font-size: 0.8rem; font-weight: 800; color: var(--text);">${t.dbRestore}</div>
              <div style="font-size: 0.65rem; color: var(--text-light);">${t.dbRestoreDesc}</div>
            </div>
            <button id="db-restore-btn" onclick="triggerDatabaseRestore()" class="icon-btn" style="width: auto; padding: 0 12px; border-radius: 8px; font-size: 0.7rem; font-weight: 800; color: var(--stable);">
              RESTORE
            </button>
          </div>
          <div style="margin-top: 15px; padding: 12px; background: var(--bg); border-radius: 12px; border: 1px solid var(--border);">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
              <div style="text-align: left;">
                <div style="font-size: 0.8rem; font-weight: 800; color: var(--text);">${t.fontSize}</div>
                <div style="font-size: 0.65rem; color: var(--text-light);">${t.fontSizeDesc}</div>
              </div>
              <div id="font-size-val" style="font-size: 0.8rem; font-weight: 800; color: var(--primary);">${currentLang === "ne" ? toNepaliNumerals(fontMultiplier) : fontMultiplier}x</div>
            </div>
            <input type="range" min="0.8" max="1.4" step="0.05" value="${fontMultiplier}" oninput="updateFontSize(this.value)" style="width:100%; height:6px; accent-color: var(--primary); background:var(--surface); border-radius:3px; outline:none; cursor:pointer;">
          </div>
          <div style="margin-top: 15px; padding: 12px; background: var(--bg); border-radius: 12px; border: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between;">
            <div style="text-align: left;">
              <div style="font-size: 0.8rem; font-weight: 800; color: var(--text);">${t.highContrast}</div>
              <div style="font-size: 0.65rem; color: var(--text-light);">${t.highContrastDesc}</div>
            </div>
            <label class="toggle-btn" style="padding: 4px; display: flex; align-items: center; gap: 8px; cursor: pointer;">
              <input type="checkbox" id="high-contrast-toggle" ${isHighContrast ? "checked" : ""} onchange="toggleHighContrast(this.checked)" style="width: 18px; height: 18px; cursor: pointer; accent-color: var(--primary);">
            </label>
          </div>
          <div style="margin-top: 15px; padding: 12px; background: var(--bg); border-radius: 12px; border: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between;">
            <div style="text-align: left;">
              <div style="font-size: 0.8rem; font-weight: 800; color: var(--text);">${t.grayscale}</div>
              <div style="font-size: 0.65rem; color: var(--text-light);">${t.grayscaleDesc}</div>
            </div>
            <label class="toggle-btn" style="padding: 4px; display: flex; align-items: center; gap: 8px; cursor: pointer;">
              <input type="checkbox" id="grayscale-toggle" ${isGrayscale ? "checked" : ""} onchange="toggleGrayscale(this.checked)" style="width: 18px; height: 18px; cursor: pointer; accent-color: var(--primary);">
            </label>
          </div>
          <div style="margin-top: 15px; padding: 12px; background: var(--bg); border-radius: 12px; border: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between;">
            <div style="text-align: left;">
              <div style="font-size: 0.8rem; font-weight: 800; color: var(--text);">${t.blueLightFilter}</div>
              <div style="font-size: 0.65rem; color: var(--text-light);">${t.blueLightDesc}</div>
            </div>
            <label class="toggle-btn" style="padding: 4px; display: flex; align-items: center; gap: 8px; cursor: pointer;">
              <input type="checkbox" id="sepia-toggle" ${isSepia ? "checked" : ""} onchange="toggleSepia(this.checked)" style="width: 18px; height: 18px; cursor: pointer; accent-color: var(--primary);">
            </label>
          </div>
          <div style="margin-top: 15px;">
            <label style="font-size: 0.7rem; font-weight: 800; text-transform: uppercase; color: var(--text-light); margin-bottom: 10px; display: block;">${t.soundPack}</label>
            <div class="theme-selector">
              <div class="theme-option pack-opt ${currentSoundPack === "modern" ? "active" : ""}" data-pack="modern" onclick="setSoundPack('modern')"><span>${t.packModern}</span></div>
              <div class="theme-option pack-opt ${currentSoundPack === "classic" ? "active" : ""}" data-pack="classic" onclick="setSoundPack('classic')"><span>${t.packClassic}</span></div>
              <div class="theme-option pack-opt ${currentSoundPack === "retro" ? "active" : ""}" data-pack="retro" onclick="setSoundPack('retro')"><span>${t.packRetro}</span></div>
            </div>
          </div>
          <div style="margin-top: 15px;">
            <label style="font-size: 0.7rem; font-weight: 800; text-transform: uppercase; color: var(--text-light); margin-bottom: 8px; display: block;">${t.uiVolume}</label>
            <div style="display:flex; align-items:center; gap:10px;">
              <input type="range" id="ui-volume-slider" min="0" max="1" step="0.1" value="${uiVolume}" oninput="updateVolume(this.value)" style="flex:1; height:6px; accent-color: var(--primary); background:var(--bg); border-radius:3px; outline:none; cursor:pointer;">
              <button id="mute-toggle-btn" onclick="toggleMute()" class="icon-btn" style="width:32px; height:32px; font-size:0.8rem; flex-shrink:0;">${uiVolume === 0 ? "🔇" : "🔊"}</button>
            </div>
            <!-- Mute All Toggle/Indicator that appears when at zero -->
            <div style="margin-top: 15px;">
              <label style="font-size: 0.7rem; font-weight: 800; text-transform: uppercase; color: var(--text-light); margin-bottom: 8px; display: block;">${t.soundPitch}</label>
              <input type="range" id="ui-pitch-slider" min="0.5" max="2.0" step="0.1" value="${uiPitch}" oninput="updatePitch(this.value)" style="width:100%; height:6px; accent-color: var(--primary); background:var(--bg); border-radius:3px; outline:none; cursor:pointer;">
            </div>
            <div id="mute-all-active" style="display:${uiVolume === 0 ? "flex" : "none"}; margin-top:10px; align-items:center; justify-content:center; gap:8px; padding:6px; background:rgba(239, 68, 68, 0.1); border:1px solid var(--critical); border-radius:8px; animation: modal-up 0.2s ease-out;">
              <span style="font-size:0.6rem; font-weight:800; color:var(--critical); text-transform:uppercase;">🚫 ${t.muteAll}</span>
              <button onclick="toggleMute()" style="background:none; border:none; color:var(--primary); font-size:0.6rem; font-weight:800; cursor:pointer; text-decoration:underline;">UNMUTE</button>
            </div>
            <button onclick="resetAudioToDefault()" class="toggle-btn" style="width:100%; margin-top:15px; border:1px solid var(--border); font-size:0.65rem; display:flex; align-items:center; justify-content:center; gap:8px;">
               🔄 ${t.resetAudio}
            </button>
          </div>
          <button onclick="resetThemeToSystem()" class="toggle-btn" style="width: 100%; margin-top: 15px; border: 1px solid var(--border); display: flex; align-items: center; justify-content: center; gap: 8px;">
             🌓 ${t.themeSystem}
          </button>
          <div style="margin-top: 15px; font-size: 0.7rem; color: var(--text-light); text-align: center; font-weight: 800;">
            ${t.totalCache}: <span id="storage-usage-val" style="color: var(--primary);">...</span>
          </div>
          <div class="quota-bar-container">
            <div id="storage-quota-bar" class="quota-bar"></div>
          </div>
          <hr style="margin: 15px 0; border: none; border-top: 1px solid var(--border);">
          <div style="display:flex; flex-direction:column; gap:8px;">
            <button id="update-check-btn" onclick="checkForUpdates()" class="toggle-btn" style="width: 100%; border: 1px solid var(--primary); display: flex; align-items: center; justify-content: center; gap: 10px;">
              🔄 ${t.checkUpdates}
            </button>
            <button id="offline-download-btn" onclick="downloadAllOfflineData()" class="toggle-btn" style="width: 100%; border: 1px solid var(--primary); display: flex; align-items: center; justify-content: center; gap: 10px;">
              📥 ${t.downloadOffline}
            </button>
            <button onclick="clearDataCache()" class="retry-btn" style="width: 100%; margin:0; display: flex; align-items: center; justify-content: center; gap: 10px;">
              🧹 ${t.clearCache}
            </button>
            <button onclick="showFactoryResetConfirmation()" class="toggle-btn" style="width: 100%; border: 1px solid var(--critical); color: var(--critical); display: flex; align-items: center; justify-content: center; gap: 10px;">
              ⚠️ ${t.resetAll}
            </button>
         </div>
        </div>
           <hr style="margin: 15px 0; border: none; border-top: 1px solid var(--border);">
           <div style="margin-top: 15px;">
             <label style="font-size: 0.7rem; font-weight: 800; text-transform: uppercase; color: var(--text-light); margin-bottom: 10px; display: block;">PDF Snapshots</label>
             <p style="font-size: 0.65rem; color: var(--text-light); margin-bottom: 10px;">Create and manage PDF snapshots of report data with date-based versioning.</p>
             <div style="display:flex; flex-direction:column; gap:8px;">
               <button onclick="createSnapshotManual()" class="toggle-btn" style="width: 100%; border: 1px solid var(--primary); display: flex; align-items: center; justify-content: center; gap: 10px; padding: 10px;">
                 Create Snapshot Now
               </button>
               <button onclick="listSnapshots()" class="toggle-btn" style="width: 100%; border: 1px solid var(--primary); display: flex; align-items: center; justify-content: center; gap: 10px; padding: 10px;">
                 List Available Snapshots
               </button>
             </div>
<div id="snapshot-list-container" style="margin-top: 10px; display: none;">
                <div style="font-size: 0.7rem; font-weight: 800; color: var(--text-light); margin-bottom: 8px;">Snapshot History:</div>
                <div id="snapshot-list" style="max-height: 300px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px;"></div>
              </div>
            </div>
            `;
};

/**
 * Extracts all data from IndexedDB and sends a JSON snapshot to Cloudflare KV.
 */
window.triggerDatabaseBackup = async () => {
  const btn = document.getElementById("db-backup-btn");
  const originalHtml = btn.innerHTML;
  const t = I18N[currentLang];

  try {
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner" style="border-top-color:var(--primary)"></span>`;

    // 1. Open Database and read all stores
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open("dor_mis_db", 2);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject("IDB_OPEN_FAIL");
    });

    const stores = ["analytics", "metadata"];
    const snapshot = {
      _meta: { timestamp: new Date().toISOString(), lang: currentLang },
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
    // Note: This requires the X-Admin-Secret header. Adjust as needed if using a prompt.
    const adminKey = prompt(
      currentLang === "en"
        ? "Enter Admin Secret to authorize backup:"
        : "ब्याकअप प्रमाणित गर्न एडमिन गोप्य कुञ्जी प्रविष्ट गर्नुहोस्:",
    );
    if (!adminKey) throw new Error("CANCELLED");

    const res = await fetch(`${WORKER_BASE}/api/admin/backup-idb`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Admin-Secret": adminKey,
      },
      body: JSON.stringify(snapshot),
    });

    if (res.ok)
      addToast(
        "success",
        currentLang === "en"
          ? "Cloud backup successful!"
          : "क्लाउड ब्याकअप सफल भयो!",
      );
    else throw new Error("API_FAIL");
  } catch (e) {
    if (e.message !== "CANCELLED") addToast("error", "Database backup failed.");
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
  const t = I18N[currentLang];

  try {
    const adminKey = prompt(
      currentLang === "en"
        ? "Enter Admin Secret to list backups:"
        : "ब्याकअप सूची हेर्न एडमिन गोप्य कुञ्जी प्रविष्ट गर्नुहोस्:",
    );
    if (!adminKey) return;

    btn.disabled = true;
    btn.innerHTML = `<span class="spinner" style="border-top-color:var(--primary)"></span>`;

    // 1. Fetch list of available backups
    const listRes = await fetch(`${WORKER_BASE}/api/admin/list-backups`, {
      headers: { "X-Admin-Secret": adminKey },
    });
    const keys = await listRes.json();
    if (!keys.length) {
      addToast("info", "No backups found.");
      return;
    }

    const selectedKey = prompt(
      `Select backup to restore:\n${keys.map((k, i) => `${i + 1}. ${k.name}`).join("\n")}`,
      keys[0].name,
    );
    if (!selectedKey) return;

    // 2. Download snapshot
    addToast("info", "Downloading snapshot...");
    const dataRes = await fetch(
      `${WORKER_BASE}/api/admin/get-backup?key=${selectedKey}`,
      { headers: { "X-Admin-Secret": adminKey } },
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

    addToast(
      "success",
      currentLang === "en"
        ? "Database successfully restored!"
        : "डाटाबेस सफलतापूर्वक रिस्टोर गरियो!",
    );
    setTimeout(() => window.location.reload(), 1500);
  } catch (e) {
    console.error(e);
    addToast("error", "Database restore failed.");
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
  const t = I18N[currentLang];
  const originalHtml = btn.innerHTML;

  try {
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner" style="border-top-color:var(--primary)"></span> ${t.downloading} ०%`;

    // 1. Determine scope (fetch list of archives first)
    const histRes = await authenticatedFetch(`/api/reports`);
    const archives = histRes && histRes.ok ? await histRes.json() : [];
    const snapshots = archives.slice(0, 5); // Cache the last 5 weeks

    const totalSteps = 3 + snapshots.length; // List + 2 languages + N snapshots
    let currentStep = 1;

    const updateProgress = () => {
      const percent = Math.round((currentStep / totalSteps) * 100);
      const dispPerc =
        currentLang === "ne" ? toNepaliNumerals(percent) : percent;
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
        `/api/report?date=${entry.date}&lang=${currentLang}`,
      );
      currentStep++;
      updateProgress();
    }

    addToast("success", t.downloadComplete);
    updateStorageUsageDisplay();
  } catch (e) {
    addToast("error", "Offline download interrupted.");
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
};

async function updateStorageUsageDisplay() {
  const el = document.getElementById("storage-usage-val");
  if (!el) return;

  if (navigator.storage && navigator.storage.estimate) {
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

      const dispVal = currentLang === "ne" ? toNepaliNumerals(val) : val;
      return dispVal + unit;
    };

    const percent = quota ? (usage / quota) * 100 : 0;
    const displayPercent = percent.toFixed(2);

    // Visual bar logic: ensure at least 1% visibility if data exists
    const barPercent = usage > 0 && percent < 1 ? 1 : percent;

    const usedStr = formatSize(usage);
    const dispPerc =
      currentLang === "ne" ? toNepaliNumerals(displayPercent) : displayPercent;

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

window.clearDataCache = async () => {
  if ("caches" in window) {
    // Clear the data cache which stores our API responses
    await caches.delete("road-data-v1");
    addToast(
      "success",
      currentLang === "en" ? "Data cache cleared!" : "डाटा क्यास मेटाइयो!",
    );
    loadData();
  }
};

window.showFactoryResetConfirmation = () => {
  const t = I18N[currentLang];
  playPopSound();

  document.getElementById("modal-body").innerHTML = `
        <div class="modal-header">
          <h3 style="color:var(--critical); margin:0;">⚠️ ${t.resetAll}</h3>
        </div>
        <div style="padding: 20px 0; text-align: center;">
          <p style="font-weight: 800; color: var(--text); font-size: 1.1rem;">${t.resetConfirm}</p>
          <p style="font-size: 0.8rem; color: var(--text-light); margin-top: 10px; line-height: 1.5;">
            ${
              currentLang === "en"
                ? "This action is irreversible. All cached road reports, offline data, theme preferences, and audio settings will be permanently deleted."
                : "यो कार्य अपरिवर्तनीय छ। सबै क्यास गरिएका सडक प्रतिवेदनहरू, अफलाइन डेटा, थिम प्राथमिकताहरू, र ध्वनि सेटिङहरू स्थायी रूपमा मेटिनेछन्।"
            }
          </p>
        </div>
        <div style="display:flex; flex-direction:column; gap:10px;">
          <button onclick="executeFactoryReset()" class="retry-btn" style="width:100%; background:var(--critical); margin:0; padding:15px;">
            ${currentLang === "en" ? "Yes, Wipe Everything" : "हो, सबै मेटाउनुहोस्"}
          </button>
          <button onclick="showSettings()" class="toggle-btn" style="width:100%; border:1px solid var(--border); padding:12px;">
            ${currentLang === "en" ? "Cancel" : "रद्द गर्नुहोस्"}
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

  addToast("info", "Resetting application...");

  // 4. Force reload from server bypassing any potential remaining cache
  setTimeout(() => {
    window.location.href = window.location.origin;
  }, 1000);
}

window.toggleLowData = (enabled) => {
  localStorage.setItem("low-data", enabled);
  if (enabled) {
    addToast(
      "info",
      currentLang === "en"
        ? "Low Data Mode active. AI Briefing disabled."
        : "कम डाटा मोड सक्रिय। एआई सारांश असक्षम गरियो।",
    );
  }
  // Immediately re-render the dashboard to reflect the change
  if (store) render(store);
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
      (currentLang === "ne" ? toNepaliNumerals(val) : val) + "x";
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
    currentLang === "en" ? "Voice updated." : "आवाज परिवर्तन गरियो।",
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
      (currentLang === "ne" ? toNepaliNumerals(val) : val) + "x";
};

window.updateSpeechPitch = (val) => {
  localStorage.setItem("tts-pitch", val);
  const display = document.getElementById("speech-pitch-val");
  if (display)
    display.innerText =
      (currentLang === "ne" ? toNepaliNumerals(val) : val) + "x";
};

window.toggleDarkSchedule = (enabled) => {
  localStorage.setItem("theme-schedule", enabled);
  if (enabled) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        localStorage.setItem("last-lat", pos.coords.latitude);
        localStorage.setItem("last-lon", pos.coords.longitude);
        syncAppTheme();
        addToast(
          "success",
          currentLang === "en" ? "Location synced" : "स्थान सिङ्क",
        );
      },
      () => {
        addToast(
          "info",
          currentLang === "en" ? "Default schedule" : "पूर्वनिर्धारित शेड्युल",
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

// --- iOS PWA "Install" Logic ---
const isIos = () => {
  const userAgent = window.navigator.userAgent.toLowerCase();
  return /iphone|ipad|ipod/.test(userAgent);
};
const isIosChrome = () => {
  return window.navigator.userAgent.toLowerCase().includes("crios");
};
const isInStandaloneMode = () =>
  "standalone" in window.navigator && window.navigator.standalone;

function showIosInstallInstructions() {
  const t = I18N[currentLang];
  const isChrome = isIosChrome();

  const title = isChrome
    ? currentLang === "en"
      ? "Install via Chrome on iOS"
      : "iOS मा Chrome मार्फत इन्स्टल गर्नुहोस्"
    : currentLang === "en"
      ? "Install App on iPhone"
      : "आइफोनमा एप इन्स्टल गर्नुहोस्";

  const step1 =
    currentLang === "en"
      ? `1. Tap the 'Share' icon ${isChrome ? "(at the top right)" : "(at the bottom center)"}.`
      : "१. स्क्रिनको तल रहेको 'Share' आइकनमा ट्याप गर्नुहोस्।";
  const step2 =
    currentLang === "en"
      ? "2. Scroll down and select 'Add to Home Screen'."
      : "२. तल स्क्रोल गर्नुहोस् र 'Add to Home Screen' चयन गर्नुहोस्।";

  document.getElementById("modal-body").innerHTML = `
        <div class="modal-header">
          <h3 style="margin:0; color:var(--primary)">${title}</h3>
        </div>
        <div style="padding: 20px 0; text-align: left;">
          <p style="font-size: 0.95rem; margin-bottom: 15px;">${step1}</p>
          <p style="font-size: 0.95rem; margin-bottom: 20px;">${step2}</p>
          <div style="text-align: center; opacity: 0.8;">
             <span style="font-size: 2rem;">⎋</span> <span style="font-size: 1.5rem;">→</span> <span style="font-size: 2rem;">⊞</span>
          </div>
        </div>
        <button onclick="closeModal()" class="retry-btn" style="width:100%; margin:0;">Got it</button>
      `;
  document.getElementById("modal-overlay").style.display = "flex";
}

// Refresh Logic
setInterval(() => {
  refreshCounter--;
  if (refreshCounter <= 0) {
    refreshCounter = 60;
    loadData();
  }
  const t = I18N[currentLang];
  document.getElementById("refresh-timer").innerText =
    `(${t.refreshing} ${refreshCounter}${t.sec})`;
}, 1000);

// PWA Install Logic for Android/Chrome
let canShowInstall = false;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  // Button visibility is now handled by the engagement timer logic
});

// Handle successful installation
window.addEventListener("appinstalled", (event) => {
  // Log analytics for conversion tracking
  logAnalytics("pwa_installed");
  // Hide the install button as it's no longer needed
  document.getElementById("install-btn").style.display = "none";
  // Show professional thank you message
  addToast("success", I18N[currentLang].installSuccess);
});

// PWA Install Logic for iOS
// Start the qualification timer and progress bar immediately for compatible browsers
const isIosDevice = isIos() && !isInStandaloneMode();
const isInstallableBrowser =
  "BeforeInstallPromptEvent" in window || isIosDevice;

if (isInstallableBrowser) {
  const btn = document.getElementById("install-btn");
  btn.style.display = "block";
  btn.disabled = true;
  btn.innerHTML = `<span>${I18N[currentLang].qualifying}</span><div class="install-progress"></div>`;

  // Trigger the 30s CSS transition
  requestAnimationFrame(() => {
    const bar = btn.querySelector(".install-progress");
    if (bar) bar.style.width = "100%";
  });
}

setTimeout(() => {
  canShowInstall = true;
  const btn = document.getElementById("install-btn");
  if (!btn) return;

  // Final eligibility check: If iOS or Android event actually fired
  if (deferredPrompt || isIosDevice) {
    btn.disabled = false;
    btn.innerHTML = I18N[currentLang].install;
    // Apply the bounce and flash animation
    btn.classList.add("install-ready");

    // Provide subtle haptic feedback for mobile users
    if ("vibrate" in navigator) {
      navigator.vibrate(50);
    }
  } else {
    // If the browser hasn't fired the event yet, hide until it does
    btn.style.display = "none";
  }
}, 30000);

document.getElementById("install-btn").addEventListener("click", async () => {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    deferredPrompt = null;
  } else if (isIos()) {
    showIosInstallInstructions();
  }
});

if ("serviceWorker" in navigator) {
  // Handle Service Worker updates
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    window.location.reload();
  });

  // Handle Background Data Updates
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data && event.data.action === "api-data-updated") {
      console.log("[SW Notification] Fresh data available. Updating UI...");
      // Trigger a silent reload (isForced = false)
      // This will pull the fresh data from the now-updated SW cache
      loadData(false);
    }
  });

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.v2.js").then((reg) => {
      reg.update();
      // Register for background updates
      registerPeriodicUpdate(reg);
    });
  });
}

/**
 * Requests permission and schedules a 24-hour background data refresh.
 */
async function registerPeriodicUpdate(registration) {
  if ("periodicSync" in registration) {
    const status = await navigator.permissions.query({
      name: "periodic-background-sync",
    });

    if (status.state === "granted") {
      try {
        await registration.periodicSync.register("update-road-data", {
          minInterval: 24 * 60 * 60 * 1000, // 24 hours in milliseconds
        });
        console.log("[Sync] 24h background refresh scheduled.");
      } catch (e) {
        console.warn("[Sync] Periodic sync registration failed:", e);
      }
    }
  }
}

// Pull to Refresh Logic for Mobile
let touchStartY = 0;
let touchCurrentY = 0;
let isPulling = false;
const pullThreshold = 120;

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
      indicator.classList.add("visible");
      // Damped movement for natural resistance
      const topOffset = Math.min(dist / 2.5, pullThreshold) - 50;
      indicator.style.top = `${topOffset}px`;
      if (pullIcon) pullIcon.style.transform = `rotate(${dist * 1.5}deg)`;
    }
  },
  { passive: true },
);

window.addEventListener("touchend", () => {
  if (!isPulling) return;
  const dist = touchCurrentY - touchStartY;
  const indicator = document.getElementById("pull-indicator");

  if (dist > pullThreshold) {
    indicator.style.top = "20px";
    indicator.innerHTML =
      '<span class="spinner" style="border-top-color:var(--primary); width:20px; height:20px;"></span>';
    // Mobile Force Refresh: Pulling down now handles everything including clearing Gemini cache
    loadData(true).finally(() => {
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

function updateConnStrength(duration) {
  const badge = document.getElementById("conn-strength");
  if (!badge) return;

  const t = I18N[currentLang];
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

  badge.innerText = `${t.connStrength} ${label}`;
  badge.style.color = color;
  badge.style.display = "inline-flex";
}

async function loadData(isForced = false) {
  const fetchStart = performance.now();
  const syncIcon = document.getElementById("data-sync-icon");
  if (syncIcon) {
    syncIcon.style.display = "inline-block";
    syncIcon.classList.add("spinning");
  }

  // Clear the store immediately to prevent "ghost" data while loading
  store = null;

  const skeleton = Array(10)
    .fill(
      `<tr class="skeleton-row"><td><div></div></td>${Array(5).fill("<td><div></div></td>").join("")}</tr>`,
    )
    .join("");
  document.getElementById("tbody").innerHTML = skeleton;

  try {
    const res = await authenticatedFetch(
      `/api/report?lang=${currentLang}${isForced ? "&force=true" : ""}`,
      {
        cache: "no-store",
      },
    );

    const json = await res.json();
    if (json && json.headers) {
      const fetchEnd = performance.now();
      const duration = Math.round(fetchEnd - fetchStart);

      lastFetchTime = Date.now();
      latencyHistory.push({ value: duration });
      if (latencyHistory.length > 5) latencyHistory.shift();

      if (res.headers.get("X-Force-Throttled") === "true") {
        addToast("info", I18N[currentLang].forceThrottled);
      }

      store = json;
      render(json);

      if (isForced) {
        addToast("success", I18N[currentLang].cacheCleared);
      }

      document.getElementById("status").innerText = I18N[currentLang].live;
      document.getElementById("status").style.color = "#4ade80";
      updateConnStrength(duration);
    }
  } catch (e) {
    document.getElementById("status").innerText = I18N[currentLang].offline;
    document.getElementById("status").style.color = "#f87171";
  }
  if (syncIcon) {
    syncIcon.classList.remove("spinning");
    syncIcon.style.display = "none";
  }
  document.getElementById("loader").style.display = "none";
}

function render(json) {
  const t = I18N[currentLang];
  const headers = json.headers || [];
  let rows = [...(json.rows || [])];

  // Handle Global Admin Message
  const banner = document.getElementById("admin-banner");
  if (json.adminMessage) {
    document.getElementById("admin-message-text").innerText = json.adminMessage;
    banner.style.display = "block";
  } else {
    banner.style.display = "none";
  }

  // 1. FILTER
  if (searchText && searchText !== "verify") {
    rows = rows.filter((r) =>
      Object.values(r).some((v) =>
        String(v).toLowerCase().includes(searchText),
      ),
    );
  }

  // Update Results Counter
  const resCounter = document.getElementById("results-count");
  if (searchText && rows.length > 0 && resCounter) {
    const dispNum =
      currentLang === "ne" ? toNepaliNumerals(rows.length) : rows.length;
    resCounter.innerText = `${dispNum} ${t.results}`;
    resCounter.style.display = "block";
  } else if (resCounter) {
    resCounter.style.display = "none";
  }

  // hidden Verification Audit Tool
  if (searchText === "verify") {
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
    addToast("info", "Audit table generated in Browser Console (F12)");
  }

  // Pre-calculate search patterns for highlighting
  const arabicSearch = toArabicNumerals(searchText);
  const isNumericSearch =
    searchText && !isNaN(parseFloat(arabicSearch)) && isFinite(arabicSearch);

  let highlightRegex = null;
  if (searchText) {
    const pattern = isNumericSearch
      ? `(${arabicSearch}|${toNepaliNumerals(arabicSearch)})`
      : `(${searchText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`;
    highlightRegex = new RegExp(pattern, "gi");
  }

  // 2. SORT
  if (currentSort.key) {
    rows.sort((a, b) => {
      const v1 = a[currentSort.key] ?? "";
      const v2 = b[currentSort.key] ?? "";
      const n1 = parseFloat(String(v1).replace(/,/g, "").replace("%", ""));
      const n2 = parseFloat(String(v2).replace(/,/g, "").replace("%", ""));
      if (!isNaN(n1) && !isNaN(n2)) return (n1 - n2) * currentSort.dir;
      return (
        String(v1).localeCompare(String(v2), currentLang) * currentSort.dir
      );
    });
  }

  // 3. KPI & CHART
  const total = rows.length;
  const good = rows.filter((r) => r._status === "good").length;
  const critical = rows.filter((r) => r._status === "critical").length;

  // Global System Instability Metric (0 to 1)
  systemRiskLevel = total > 0 ? critical / total : 0;

  const percent = total > 0 ? Math.round((good / total) * 100) : 0;
  const dispTotal = currentLang === "ne" ? toNepaliNumerals(total) : total;
  const dispGood = currentLang === "ne" ? toNepaliNumerals(good) : good;
  const dispCrit = currentLang === "ne" ? toNepaliNumerals(critical) : critical;
  const dispPerc = currentLang === "ne" ? toNepaliNumerals(percent) : percent;

  document.getElementById("kpi-stats").innerHTML = `
    <div class="kpi-card"><h4>${t.total}</h4><p>${dispTotal}</p></div>
    <div class="kpi-card" style="border-left-color:var(--good)"><h4>${t.met}</h4><p>${dispGood}</p></div>
    <div class="kpi-card" style="border-left-color:var(--critical)"><h4>${t.attention}</h4><p>${dispCrit}</p></div>
  `;
  document
    .getElementById("chart-path")
    .setAttribute("stroke-dasharray", `${percent}, 100`);
  document.getElementById("chart-percent").innerText = `${dispPerc}%`;

  if (json.lastUpdate) {
    document.getElementById("last-update").innerText =
      `${t.update} ${currentLang === "ne" ? toNepaliNumerals(json.lastUpdate) : `${json.lastUpdate} BS`}`;
    document.getElementById("print-stamp").innerText =
      `Last Updated Version: ${json.lastUpdate}`;
  }
  const isLowData = localStorage.getItem("low-data") === "true";
  if (json.aiSummary && json.aiSummary.brief && !isLowData) {
    document.getElementById("ai-brief-card").style.display = "block";
    let briefText = json.aiSummary.brief;
    if (currentLang === "ne") briefText = toNepaliNumerals(briefText);
    // Type out the brief with the shimmer effect and sound enabled
    typeText(document.getElementById("ai-brief-text"), briefText, true);
  }

  const url = window.location.origin;
  document.getElementById("app-link").innerText = url;
  document.getElementById("app-link").href = url;

  // 4. TABLE
  let thead = `<tr><th onclick="sortData(''); event.stopPropagation()"></th>`; // Empty header for mini-chart column

  // Sortable headers: Works regardless of column count or content
  headers.forEach((h, i) => {
    thead += `<th onclick="sortData('${h}'); event.stopPropagation()">${h} ${currentSort.key === h ? (currentSort.dir === 1 ? "↑" : "↓") : ""}</th>`;
  });
  thead += "</tr>";
  document.getElementById("thead").innerHTML = thead;

  let tbody = "";
  if (rows.length === 0 && searchText) {
    tbody = `<tr><td colspan="${headers.length + 1}" style="text-align:center; padding:3rem; opacity:0.7">
          <div style="font-size:2.5rem; margin-bottom:10px">🔍</div>
          <div style="font-weight:bold; color:var(--text)" data-i18n="noResults"></div>
          <div style="font-size:0.9rem; margin-bottom:15px; opacity:0.8">"${searchText}"</div>
          <button onclick="clearSearch()" class="retry-btn" style="margin:0" data-i18n="retrySearch"></button>
        </td></tr>`;
  } else {
    rows.forEach((r) => {
      const name = r[headers[0]] || "";
      const annualPerc = getProgress(r, headers);
      tbody += `<tr onclick="showModal('${name.replace(/'/g, "\\'")}', this, true)">`;
      tbody += `<td>
            <div style="display:flex; align-items:center; gap:8px;">
              ${renderMiniChart(annualPerc, true)} 
              <button class="icon-btn" onclick="event.stopPropagation(); showInChartView('${name.replace(/'/g, "\\'")}')" data-i18n-title="showInChartView" style="width:24px; height:24px; font-size:0.7rem; padding:0; border-radius:6px; flex-shrink:0;">📊</button>
              <button class="icon-btn" onclick="event.stopPropagation(); copyDeepLink('${name.replace(/'/g, "\\'")}')" data-title="${t.copyDeepLink}" style="width:24px; height:24px; font-size:0.7rem; padding:0; border-radius:6px; flex-shrink:0;">🔗</button>
            </div>
          </td>`;
      headers.forEach((h, i) => {
        let val = i === 0 ? t(r[h]) : (r[h] ?? "");

        if (highlightRegex) {
          val = String(val).replace(highlightRegex, "<b>$1</b>");
        }

        // Convert to Nepali numerals AFTER potential highlighting
        if (currentLang === "ne") val = toNepaliNumerals(val);

        const isStatus = h.toLowerCase().includes("status") || i === 0;
        const color = isStatus
          ? r._status === "good"
            ? "var(--good)"
            : r._status === "critical"
              ? "var(--critical)"
              : "var(--stable)"
          : "inherit";
        tbody += `<td style="color:${color}; font-weight:${isStatus ? 700 : 400}">${val}</td>`;
      });
      tbody += "</tr>";
    });
  }
  document.getElementById("tbody").innerHTML = tbody;

  // 5. CARDS
  let cards = "";
  if (rows.length === 0) {
    if (searchText) {
      cards = `<div class="chart-card" style="text-align:center; grid-column: 1 / -1; padding: 4rem;">
            <div style="font-size:3rem; margin-bottom:10px">🔎</div>
            <p style="font-weight:bold; font-size:1.1rem; color:var(--text)" data-i18n="noResults"></p>
            <p style="margin-bottom:15px; opacity:0.8">"${searchText}"</p>
            <button onclick="clearSearch()" class="retry-btn" data-i18n="retrySearch"></button>
          </div>`;
    } else {
      cards = `<p style='padding:2rem;text-align:center;opacity:0.5' data-i18n="noDataToVisualize"></p>`;
    }
  } else {
    rows.forEach((r) => {
      const nameKey = headers[0];
      const name = r[nameKey] || "—";

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

      const annPerc = getProgress(r, headers);
      const totT = parseFloat(String(r[totTargetKey] || "0").replace(/,/g, ""));
      const totP = parseFloat(String(r[totProgKey] || "0").replace(/,/g, ""));
      const totPerc = totT > 0 ? Math.round((totP / totT) * 100) : 0;

      const dispAnn =
        currentLang === "ne" ? toNepaliNumerals(annPerc) : annPerc;
      const dispTot =
        currentLang === "ne" ? toNepaliNumerals(totPerc) : totPerc;

      const annColor = annPerc < 50 ? "var(--critical)" : "var(--primary)";
      const annPulseClass = annPerc < 20 ? "pulse-critical" : "";

      let details = "";
      headers.slice(1, 6).forEach((h, i) => {
        if (r[h])
          details += `<div style="font-size:0.75rem;margin-bottom:4px"><span style="color:var(--text-light)">${h}:</span> <span style="font-weight:600">${currentLang === "ne" ? toNepaliNumerals(r[h]) : r[h]}</span></div>`;
      });
      cards += `
            <div class="data-card" data-indicator="${name}" onclick="showModal('${name.replace(/'/g, "\\'")}', this, true)">
              <div style="padding:1rem;background:rgba(0,0,0,0.02);display:flex;justify-content:space-between;align-items:center">
                <div style="display:flex; align-items:center">${renderMiniChart(annPerc)}<b>${t(name)}</b></div>
                <div style="display:flex; align-items:center; gap:6px">
                  <span style="font-size:0.7rem;background:${annColor};color:white;padding:2px 8px;border-radius:4px;font-weight:bold;">${dispAnn}%</span>
                  <button class="icon-btn" onclick="event.stopPropagation(); showInChartView('${name.replace(/'/g, "\\'")}')" data-title="${t.showInChartView}" style="width:24px; height:24px; font-size:0.7rem; padding:0; border-radius:6px">📊</button>
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
                     <span>TOTAL PROJECT PROGRESS</span>
                     <span>${dispTot}%</span>
                   </div>
                   <div style="height:6px;background:var(--bg);border-radius:3px;overflow:hidden">
                     <div style="width:${totPerc}%;height:100%;background:var(--good)"></div>
                   </div>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">${details}</div>
                <p style="font-size:0.8rem;color:var(--primary);margin-top:12px;border-top:1px solid var(--border);padding-top:8px;font-style:italic">${r._insight || ""}</p>
              </div>
            </div>`;
    });
  }
  document.getElementById("view-cards").innerHTML = cards;

  // 6. CHARTS
  let chartHtml = "";
  if (rows.length === 0) {
    chartHtml = `<p style='padding:2rem;text-align:center;opacity:0.5'>${I18N[currentLang].noDataToVisualize}</p>`;
  } else {
    rows.forEach((r) => {
      const nameKey = headers[0];
      const name = r[nameKey] || "—";

      const prog = getProgress(r, headers);
      const dispProg = currentLang === "ne" ? toNepaliNumerals(prog) : prog;
      const color =
        prog >= 80
          ? "var(--good)"
          : prog >= 40
            ? "var(--stable)"
            : "var(--critical)";
      chartHtml += `
      <div class="chart-card" data-indicator="${name}" onclick="showModal('${name.replace(/'/g, "\\'")}', this, true)" style="cursor:pointer">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px">
          <b style="font-size:0.9rem">${t(name)}</b>
          <div style="display:flex; align-items:center; gap:6px">
            <span style="font-size:0.75rem; font-weight:800; color:${color}">${dispProg}%</span>
            <button class="icon-btn" onclick="event.stopPropagation(); showInCardView('${name.replace(/'/g, "\\'")}')" data-title="${t.showInCardView}" style="width:24px; height:24px; font-size:0.7rem; padding:0; border-radius:6px">🗂️</button>
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
                `<span>${h}: <b>${currentLang === "ne" ? toNepaliNumerals(r[h]) : r[h]}</b></span>`,
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

/**
 * Generates a Progress Report PDF directly in the browser using pdf-lib.
 * Includes Devanagari font support for Nepali translations.
 */
window.generateClientPDF = async () => {
  if (!store || !store.rows.length)
    return addToast("error", "No data to export");

  addToast(
    "info",
    currentLang === "en" ? "Generating PDF..." : "PDF तयार गर्दै...",
  );

  try {
    const { PDFDocument, rgb, StandardFonts } = PDFLib;
    const pdfDoc = await PDFDocument.create();

    // 1. Optimized Font Embedding
    let mainFont;
    if (currentLang === "ne") {
      const fontUrl = `https://fonts.gstatic.com/s/notosansdevanagari/v28/wf5m9WB_V9fNqbfVp-9ueS5mF-X_S-zY.ttf`;
      const fontBytes = await fetch(fontUrl).then((res) => res.arrayBuffer());
      mainFont = await pdfDoc.embedFont(fontBytes);
    } else {
      mainFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
    }

    const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    // 2. Embed Logo
    const logoUrl = `${window.location.origin}/logo.png`;
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
    const title = I18N[currentLang].reportTitle;
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
    const kpiText = `${I18N[currentLang].total}: ${currentLang === "ne" ? toNepaliNumerals(totalRows) : totalRows} | ${I18N[currentLang].attention}: ${currentLang === "ne" ? toNepaliNumerals(critical) : critical}`;
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
    store.rows.forEach((row, rowIndex) => {
      // Pagination Check: If we are near the bottom, add a new page
      if (yOffset < 50) {
        page = pdfDoc.addPage([595.28, 841.89]);
        yOffset = height - 50;
        drawTableHeader(page);
      }

      store.headers.forEach((h, i) => {
        let text = String(row[h] || "");
        if (currentLang === "ne") text = toNepaliNumerals(text);

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
    addToast("error", "Failed to generate PDF");
  }
};

// Initialize App via Security Handshake
setupSecurity();

// Mobile: default to card view (better for small screens)
if (window.innerWidth < 768 && currentView === "table") {
  setView("cards");
}
