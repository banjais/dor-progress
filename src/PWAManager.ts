import { t } from "./api-utils.js";
import { Dashboard } from "./Dashboard.js";

// PWA install qualification delay (ms): 3 seconds
const PWA_INSTALL_QUALIFICATION_DELAY_MS = 3_000;

// BeforeInstallPromptEvent extends Event with prompt() and userChoice
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

// Mutable deferred prompt captured from the beforeinstallprompt event
let deferredPrompt: BeforeInstallPromptEvent | null = null;

// iOS detection helpers
function isIos(): boolean {
  return /iphone|ipad|ipod/.test(navigator.userAgent.toLowerCase());
}

function isInStandaloneMode(): boolean {
  return (navigator as Navigator & { standalone?: boolean }).standalone === true
    || window.matchMedia("(display-mode: standalone)").matches;
}

// Show iOS "Add to Home Screen" instructions
function showIosInstallInstructions(): void {
  const toast = dashboard.addToast("info", t("iosInstallInfo") || "To install: tap Share › Add to Home Screen");
  setTimeout(() => toast.remove(), 8_000);
}

// Periodically prompt the user to update the service worker
function registerPeriodicUpdate(reg: ServiceWorkerRegistration): void {
  setInterval(async () => {
    try {
      // Trigger cache maintenance regardless of whether an update is found
      if (reg.active) {
        console.log("[PWA] Requesting periodic cache cleanup...");
        reg.active.postMessage({ type: "CLEANUP_EXPIRED_CACHE" });
      }

      if (reg.waiting) {
        const toast = dashboard.addToast("success", t("updateAvailable") || "An update is available. Please refresh.");
        reg.waiting.postMessage({ type: "SKIP_WAITING" });
        reg.waiting.addEventListener("controllerchange", () => window.location.reload());
        setTimeout(() => toast.remove(), 8_000);
      }
      if (reg.installing) {
        console.log("[PWA] Installing service worker update…");
      }
      if (await reg.update()) {
        console.log("[PWA] Service worker updated.");
      }
    } catch {
      // update() is not available in all browsers
    }
  }, 1000 * 60 * 30); // every 30 minutes
}

// Get the singleton dashboard instance
const dashboard = Dashboard.getInstance();

export function initPWALogic() {
  // PWA Install Prompt Logic (this can stay in dev)
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
  });

  window.addEventListener("appinstalled", () => {
    dashboard.addToast("success", t("installSuccess"));
    const btn = document.getElementById("install-btn");
    if (btn) btn.style.display = "none";
  });

  const isIosDevice = isIos() && !isInStandaloneMode();
  const isInstallableBrowser = "BeforeInstallPromptEvent" in window || isIosDevice;

  if (isInstallableBrowser) {
    const btn = document.getElementById("install-btn") as HTMLButtonElement | null;
    if (btn) {
      btn.style.display = "block";
      btn.disabled = true;
      btn.innerHTML = `<span>${t("qualifying")}</span><div class="install-progress"></div>`;
      requestAnimationFrame(() => {
        const bar = btn.querySelector(".install-progress") as HTMLElement | null;
        if (bar) bar.style.width = "100%";
      });
    }
  }

  setTimeout(() => {
    const btn = document.getElementById("install-btn") as HTMLButtonElement | null;
    if (!btn) return;
    if (deferredPrompt || isIosDevice) {
      btn.disabled = false;
      btn.innerHTML = t("install");
      btn.classList.add("install-ready");
      if ("vibrate" in navigator) navigator.vibrate(50);
    } else {
      btn.style.display = "none";
    }
  }, PWA_INSTALL_QUALIFICATION_DELAY_MS);

  const installBtn = document.getElementById("install-btn");
  installBtn?.addEventListener("click", () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      deferredPrompt = null;
    } else if (isIos()) {
      showIosInstallInstructions();
    }
  });

  // ==================== SERVICE WORKER REGISTRATION ====================
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      window.location.reload();
    });

    window.addEventListener("load", () => {
      // Pass mode and worker base to the Service Worker via query parameters.
      // This allows the static SW script to adapt to development vs production environments.
      const mode = import.meta.env.MODE;
      // Remove query parameters if they cause MIME issues; SW can detect environment via location.host
      const swUrl = '/sw.v2.js';

      navigator.serviceWorker.register(swUrl)
        .then((reg) => {
          console.log(`[PWA] Service Worker registered in ${mode} mode:`, reg.scope);
          void reg.update();
          void registerPeriodicUpdate(reg);
        })
        .catch((err) => {
          console.error("[PWA] Service Worker registration failed:", err);
        });
    });
  }
}
