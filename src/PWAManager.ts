/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
import { Dashboard } from "./Dashboard.js";
import { I18N } from "./api-utils.js";

const dashboard = Dashboard.getInstance();
let deferredPrompt: any = null;

const PWA_INSTALL_QUALIFICATION_DELAY_MS = 30000;

const isIos = () => {
  const userAgent = window.navigator.userAgent.toLowerCase();
  return /iphone|ipad|ipod/.test(userAgent);
};

const isIosChrome = () => {
  return window.navigator.userAgent.toLowerCase().includes("crios");
};

const isInStandaloneMode = () =>
  "standalone" in window.navigator && (window.navigator as any).standalone;

function showIosInstallInstructions() {
  const isChrome = isIosChrome();

  const title = isChrome
    ? dashboard.state.lang === "en"
      ? "Install via Chrome on iOS"
      : "iOS मा Chrome मार्फत इन्स्टल गर्नुहोस्"
    : dashboard.state.lang === "en"
      ? "Install App on iPhone"
      : "आइफोनमा एप इन्स्टल गर्नुहोस्";

  const step1 =
    dashboard.state.lang === "en"
      ? `1. Tap the 'Share' icon ${isChrome ? "(at the top right)" : "(at the bottom center)"}.`
      : "१. स्क्रिनको तल रहेको 'Share' आइकनमा ट्याप गर्नुहोस्।";
  const step2 =
    dashboard.state.lang === "en"
      ? "2. Scroll down and select 'Add to Home Screen'."
      : "२. तल स्क्रोल गर्नुहोस् र 'Add to Home Screen' चयन गर्नुहोस्।";

  const modalBody = document.getElementById("modal-body");
  if (modalBody) {
    modalBody.innerHTML = `
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
  }
  const overlay = document.getElementById("modal-overlay");
  if (overlay) overlay.style.display = "flex";
}

export function initPWALogic() {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
  });

  window.addEventListener("appinstalled", () => {
    dashboard.addToast("success", I18N[dashboard.state.lang].installSuccess);
    const btn = document.getElementById("install-btn");
    if (btn) btn.style.display = "none";
  });

  const isIosDevice = isIos() && !isInStandaloneMode();
  const isInstallableBrowser =
    "BeforeInstallPromptEvent" in window || isIosDevice;

  if (isInstallableBrowser) {
    const btn = document.getElementById("install-btn") as HTMLButtonElement;
    if (btn) {
      btn.style.display = "block";
      btn.disabled = true;
      btn.innerHTML = `<span>${I18N[dashboard.state.lang].qualifying}</span><div class="install-progress"></div>`;

      requestAnimationFrame(() => {
        const bar = btn.querySelector(".install-progress") as HTMLElement;
        if (bar) bar.style.width = "100%";
      });
    }
  }

  setTimeout(() => {
    const btn = document.getElementById("install-btn") as HTMLButtonElement;
    if (!btn) return;

    if (deferredPrompt || isIosDevice) {
      btn.disabled = false;
      btn.innerHTML = I18N[dashboard.state.lang].install;
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

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      window.location.reload();
    });

    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.v2.js").then((reg) => {
        void reg.update();
        void registerPeriodicUpdate(reg);
      });
    });
  }
}

async function registerPeriodicUpdate(registration: ServiceWorkerRegistration) {
  if ("periodicSync" in registration) {
    const status = await navigator.permissions.query({
      name: "periodic-background-sync" as any,
    });
    if (status.state === "granted") {
      try {
        await (registration as any).periodicSync.register("update-road-data", {
          minInterval: 24 * 60 * 60 * 1000,
        });
      } catch {
        /* silent */
      }
    }
  }
}
