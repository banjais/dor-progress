import { Dashboard } from "./Dashboard.js";
import { t, toNepaliNumerals } from "./api-utils.js";
import { devanagariFontBase64 } from "./fonts.js";

// PWA install qualification delay (ms): 3 seconds
const PWA_INSTALL_QUALIFICATION_DELAY_MS = 3_000;

// BeforeInstallPromptEvent extends Event with prompt() and userChoice
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

// Mutable deferred prompt captured from the beforeinstallprompt event
let deferredPrompt: BeforeInstallPromptEvent | null = null;
let swRegistration: ServiceWorkerRegistration | null = null;
let lastKnownUpdateState = false;

// iOS detection helpers
function isIos(): boolean {
  return /iphone|ipad|ipod/.test(navigator.userAgent.toLowerCase());
}

function isInStandaloneMode(): boolean {
  return (
    (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    window.matchMedia("(display-mode: standalone)").matches
  );
}

// Show iOS "Add to Home Screen" instructions
function showIosInstallInstructions(): void {
  const toast = dashboard.addToast(
    "info",
    (t("iosInstallInfo") ?? "") !== "" ? t("iosInstallInfo") : "To install: tap Share › Add to Home Screen",
  );
  setTimeout(() => toast.remove(), 8_000);
}

// Periodically prompt the user to update the service worker
function registerPeriodicUpdate(reg: ServiceWorkerRegistration): void {
  setInterval(() => {
    void (async () => {
      try {
        // Trigger cache maintenance regardless of whether an update is found
        if (reg.active) {
          console.log("[PWA] Requesting periodic cache cleanup...");
          reg.active.postMessage({ type: "CLEANUP_EXPIRED_CACHE" });
        }

        if (reg.waiting) {
          const toast = dashboard.addToast(
            "success",
            (t("updateAvailable") ?? "") !== "" ? t("updateAvailable") : "An update is available. Please refresh.",
          );
          // Visual state will be updated by updateFabPulseState and updateUpdateButtonState
          setTimeout(() => toast.remove(), 8_000);
        }
        if (reg.installing) {
          console.log("[PWA] Installing service worker update…");
        }
        if (await reg.update()) {
          console.log("[PWA] Service worker updated.");
        }
      } catch (err) {
        // update() is not available in all browsers
      }
    })();
  },
    1000 * 60 * 30,
  ); // every 30 minutes
}

function isCheckStale(): boolean {
  const lastCheck = localStorage.getItem("pwa_last_check");
  if (!lastCheck) return true; // If never checked, it's stale
  const lastCheckDate = new Date(lastCheck);
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return lastCheckDate < twentyFourHoursAgo;
}

/**
 * Generates the localized tooltip text for the update button.
 */
function getUpdateTooltip(): string {
  const lastCheck = localStorage.getItem("pwa_last_check");
  const base = t("checkForUpdates") || "Check for Updates";
  if (!lastCheck) return base;

  const lang = dashboard.state.lang;
  const date = new Date(lastCheck);
  const timeStr = date.toLocaleTimeString(lang === "ne" ? "ne-NP" : "en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });

  const lastLabel = lang === "ne" ? "अन्तिम जाँच:" : "Last checked:";
  const displayTime = lang === "ne" ? toNepaliNumerals(timeStr) : timeStr;
  return `${base} (${lastLabel} ${displayTime})`;
}

/**
 * Updates the visual state of the PWA update button (stale, up-to-date, available).
 */
export function updateUpdateButtonState(targetBtn?: HTMLElement): void {
  const btn = targetBtn || document.getElementById("pwa-update-btn");
  if (!btn) return;

  // Remove all state classes first
  btn.classList.remove(
    "update-stale-check",
    "up-to-date-pulse",
    "update-available-pulse",
  );

  if (swRegistration?.waiting || swRegistration?.installing) {
    btn.classList.add("update-available-pulse");
  } else if (isCheckStale()) {
    btn.classList.add("update-stale-check");
  }
  btn.setAttribute("data-title", getUpdateTooltip());
}

function updateFabPulseState(): void {
  const fabTrigger = document.querySelector(
    ".fab-trigger",
  ) as HTMLElement | null;
  if (!fabTrigger) return;
  const hasUpdate = !!(swRegistration?.waiting || swRegistration?.installing);
  fabTrigger.classList.toggle("fab-has-update", hasUpdate);

  if (hasUpdate) {
    fabTrigger.setAttribute("data-title", t("whatsNew") || "What's New?");

    // Transition check: If update was just detected, force show tooltip for 5s
    if (!lastKnownUpdateState) {
      fabTrigger.classList.add("tooltip-active");
      setTimeout(() => fabTrigger.classList.remove("tooltip-active"), 5000);
    }
  } else {
    fabTrigger.removeAttribute("data-title");
    fabTrigger.classList.remove("tooltip-active");
  }

  lastKnownUpdateState = hasUpdate;
}

/**
 * Fetches /CHANGELOG.md, converts basic MD to HTML, and shows it in the system modal.
 */
async function showChangelogModal() {
  const modalBody = document.getElementById("modal-body");
  const overlay = document.getElementById("modal-overlay");
  if (!modalBody || !overlay) return;

  modalBody.innerHTML = `<div style="text-align:center; padding:40px;"><div class="spinner" style="border-top-color:var(--primary); width:30px; height:30px;"></div></div>`;
  overlay.style.display = "flex";

  try {
    const res = await fetch("/CHANGELOG.md");
    if (!res.ok) throw new Error("Changelog file not found");
    const md = await res.text();

    // Simple Regex Parser for standard Markdown
    const html = md
      .replace(
        /^# (.*$)/gm,
        '<h2 style="color:var(--primary); margin-top:0">$1</h2>',
      )
      .replace(
        /^## (.*$)/gm,
        '<h3 style="color:var(--primary); margin-top:20px; border-bottom:1px solid var(--border); padding-bottom:8px;">$1</h3>',
      )
      .replace(
        /^### (.*$)/gm,
        '<h4 style="margin-top:15px; color:var(--text-light)">$1</h4>',
      )
      .replace(
        /^\* (.*$)/gm,
        '<li style="margin-left:15px; margin-bottom:6px; list-style-type: disc;">$1</li>',
      )
      .replace(
        /^- (.*$)/gm,
        '<li style="margin-left:15px; margin-bottom:6px; list-style-type: circle;">$1</li>',
      )
      .replace(
        /\[([^\]]+)\]\(([^)]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener noreferrer" style="color:var(--primary); text-decoration:underline;">$1</a>',
      )
      .replace(
        /!\[([^\]]+)\]\(([^)]+)\)/g,
        '<img src="$2" alt="$1" style="max-width:100%; height:auto; display:block; margin:15px 0; border-radius:8px; border:1px solid var(--border);">',
      )
      .replace(/\*\*(.*)\*\*/g, "<strong>$1</strong>")
      .replace(
        /`(.*)`/g,
        '<code style="background:var(--hover); padding:2px 6px; border-radius:4px; font-family:monospace; font-size:0.85em;">$1</code>',
      )
      .replace(/\n\n/g, "<br>");

    modalBody.innerHTML = `
      <div class="changelog-scroll" style="max-height:65vh; overflow-y:auto; padding-right:10px; line-height:1.6;">
        ${html}
      </div>
      <div style="margin-top:25px; padding-top:15px; border-top:1px solid var(--border); display:flex; justify-content:space-between; align-items:center;">
        <button class="toggle-btn" onclick="App.downloadChangelogAsPdf()" style="padding:10px 15px; font-weight:700;">
           📥 ${t("downloadPdf") || "Download PDF"}
        </button>
        <button class="toggle-btn active" onclick="App.closeModal()" style="padding:10px 25px;">${t("close") || "Close"}</button>
      </div>
    `;
  } catch (err) {
    console.error("[PWA] Changelog load error:", err);
    modalBody.innerHTML = `<div style="text-align:center; padding:20px;"><p style="color:var(--critical); font-weight:800;">${t("error") || "Error"}</p><p>${t("changelogError") || "Failed to load latest updates."}</p></div>`;
  }
}

/**
 * Fetches the changelog and exports it to a PDF with multi-page support.
 */
export async function downloadChangelogAsPdf() {
  try {
    // Dynamically import jspdf and jspdf-autotable only when needed
    const { jsPDF } = await import("jspdf");
    const autoTable = (await import("jspdf-autotable")).default;
    const res = await fetch("/CHANGELOG.md");
    if (!res.ok) throw new Error("Changelog file not found");
    const md = await res.text();

    const doc = new jsPDF();
    const fontFileName = "NotoSansDevanagari.ttf";
    const fontName = "NotoSansDevanagari";

    doc.addFileToVFS(fontFileName, devanagariFontBase64);
    doc.addFont(fontFileName, fontName, "normal");
    doc.setFont(fontName);

    // Header styling
    doc.setFontSize(18);
    doc.setTextColor(0, 153, 218); // --primary
    doc.text(t("viewChangelog") || "What's New?", 14, 22);

    doc.setFontSize(9);
    doc.setTextColor(150);
    doc.text(
      `Department of Roads MIS - Exported on ${new Date().toLocaleString()}`,
      14,
      28,
    );

    // Use autoTable for the content to ensure it spans pages correctly if long
    autoTable(doc, {
      // Strip basic symbols for a cleaner print look
      body: [[md.replace(/[#*`]/g, "")]],
      startY: 35,
      styles: {
        font: fontName,
        fontSize: 11,
        textColor: [40, 40, 40],
        cellPadding: 0,
      },
      theme: "plain",
    });

    doc.save(`DoR_Changelog_${new Date().toISOString().split("T")[0]}.pdf`);
    dashboard.addToast(
      "success",
      t("pdfDownloaded") || "Changelog downloaded.",
    );
  } catch (err) {
    console.error("[PWA] Export failed:", err);
    dashboard.addToast("error", "Failed to export PDF.");
  }
}

/**
 * Manually triggers a Service Worker update check.
 */
export async function checkForUpdate(triggerBtn?: HTMLElement) {
  if (!swRegistration) return;
  const btn = triggerBtn || document.getElementById("pwa-update-btn");
  if (btn && btn.classList.contains("spinning")) return; // Prevent double clicks

  if (btn) btn.classList.add("spinning");
  dashboard.addToast("info", t("checkingUpdates") || "Checking for updates...");
  updateFabPulseState(); // Ensure FAB pulse is off during check

  try {
    await swRegistration.update();

    // Save the timestamp of the successful check
    localStorage.setItem("pwa_last_check", new Date().toISOString());

    await new Promise((r) => setTimeout(r, 1200));

    if (swRegistration.waiting || swRegistration.installing) {
      // Visual state will be updated by updateFabPulseState and updateUpdateButtonState
      dashboard.addToast(
        "success",
        t("updateAvailable") || "Update found! System will refresh.",
      );
      return;
    }

    dashboard.addToast("success", t("upToDate") || "System is up to date.");
    if (btn) {
      btn.classList.add("up-to-date-pulse"); // Apply transient pulse
      setTimeout(() => btn.classList.remove("up-to-date-pulse"), 2000); // Remove after 2s
    }
    dashboard.playUi("ping");
  } catch (err) {
    console.warn("[PWA] Update check failed:", err);
    dashboard.addToast(
      "error",
      t("updateCheckFailed") ||
        "Update check failed. Please check your connection.",
    );
  } finally {
    if (btn) btn.classList.remove("spinning");
  }
}

/**
 * Installs the waiting Service Worker and reloads the page.
 */
export async function installUpdate() {
  if (!swRegistration || !swRegistration.waiting) {
    dashboard.addToast(
      "info",
      t("noUpdateToInstall") || "No update available to install.",
    );
    return;
  }

  const btn = document.getElementById(
    "fab-check-update",
  ) as HTMLButtonElement | null;
  const originalHtml = btn ? btn.innerHTML : "";
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<i>🚀</i> <span>${t("installing") || "Installing..."}</span>`;
  }
  dashboard.addToast(
    "info",
    t("installingUpdate") || "Installing update. Please wait...",
  );

  try {
    // This message will trigger the 'SKIP_WAITING' logic in the waiting SW
    swRegistration.waiting.postMessage({ type: "SKIP_WAITING" });
    // The 'controllerchange' listener in initPWALogic will handle the page reload
  } catch (err) {
    console.error("[PWA] Failed to install update:", err);
    dashboard.addToast("error", (t("installFailed") ?? "") !== "" ? t("installFailed") : "Installation failed.");
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalHtml;
    }
  }
}

/**
 * Spawns a burst of CSS particles at the button's location for visual flair.
 */
function triggerInstallCelebration(btn: HTMLElement) {
  const rect = btn.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;

  for (let i = 0; i < 20; i++) {
    const p = document.createElement("div");
    p.className = "install-particle";
    p.style.left = `${centerX}px`;
    p.style.top = `${centerY}px`;
    p.style.backgroundColor = i % 2 === 0 ? "var(--primary)" : "var(--good)";
    p.style.setProperty("--dx", `${(Math.random() - 0.5) * 200}px`);
    p.style.setProperty("--dy", `${(Math.random() - 0.5) * 200}px`);
    document.body.appendChild(p);
    setTimeout(() => p.remove(), 1000);
  }
}

// Get the singleton dashboard instance
const dashboard = Dashboard.getInstance();

export function initPWALogic() {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    updateInstallButtonUI(); // Try to show the button immediately when the event fires
  });

  window.addEventListener("appinstalled", () => {
    dashboard.state.isAppInstalled = true;
    dashboard.addToast("success", t("installSuccess"), 8000); // Display for 8 seconds
    const btn = document.getElementById("install-btn");
    if (btn) {
      // Stop any active pulse and trigger the fade-out transition
      btn.classList.remove("install-ready-animate");
      btn.classList.add("install-fading");
      // Wait for the CSS transition (600ms) to complete before hiding the element
      setTimeout(() => {
        btn.style.display = "none";
      }, 600);
    }
  });
  updateFabPulseState(); // Ensure FAB pulse is off after install

  // Initialize installation state based on current display mode
  dashboard.state.isAppInstalled = isInStandaloneMode();

  // Subscribe to state changes to manage dynamic menu items
  dashboard.subscribe<{ isInstalled: boolean; lang: string }>(
    ({ isInstalled, lang: _lang }) => {
      const fabMenu = document.getElementById("fab-menu");
      const geminiMenu = document.getElementById("gemini-menu");
      const hasUpdate = !!(
        swRegistration?.waiting || swRegistration?.installing
      ); // Calculate once for the scope
      const actionRow = document.querySelector(".header-controls");

      // 1. Manage "Share App" in FAB Menu (Standalone only)
      if (fabMenu && isInstalled) {
        let shareBtn = document.getElementById("fab-share-app");
        if (!shareBtn) {
          shareBtn = document.createElement("button");
          shareBtn.id = "fab-share-app";
          shareBtn.className = "fab-item";
          shareBtn.addEventListener("click", () => {
            dashboard.shareApp();
            dashboard.toggleFabMenu();
          });
          fabMenu.appendChild(shareBtn);
        }
        shareBtn.innerHTML = `<i>📤</i> <span>${t("shareApp")}</span>`;
      }

      // 2. Manage "Share Link" in Gemini Menu (Always available)
      if (geminiMenu) {
        // Ensure progress container exists at the top of the menu
        if (!document.getElementById("gemini-progress-container")) {
          const progCont = document.createElement("div");
          progCont.id = "gemini-progress-container";
          progCont.className = "gemini-progress-container";
          progCont.innerHTML =
            '<div id="gemini-progress-bar" class="gemini-progress-bar"></div>';
          // Use insertAdjacentElement to avoid type collisions with Cloudflare Worker Element.prepend
          geminiMenu.insertAdjacentElement("afterbegin", progCont);
        }

        let linkBtn = document.getElementById("gemini-share-link");
        if (!linkBtn) {
          linkBtn = document.createElement("button");
          linkBtn.id = "gemini-share-link";
          linkBtn.className = "fab-item";
          linkBtn.addEventListener("click", () => {
            (window as any).App.shareAiBriefLink();
            dashboard.toggleGeminiMenu();
          });
          geminiMenu.appendChild(linkBtn);
        }
        linkBtn.innerHTML = `<i>🔗</i> <span>${t("shareLink") || "Share Link"}</span>`;
        linkBtn.setAttribute("data-title", t("shareLink") || "Share Link");
      }

      // 3. Manage "Share via Email" in Gemini Menu
      if (geminiMenu) {
        let emailBtn = document.getElementById("gemini-share-email");
        if (!emailBtn) {
          emailBtn = document.createElement("button");
          emailBtn.id = "gemini-share-email";
          emailBtn.className = "fab-item";
          emailBtn.addEventListener("click", () => {
            (window as any).App.shareAiBriefEmail();
            dashboard.toggleGeminiMenu();
          });
          geminiMenu.appendChild(emailBtn);
        }
        emailBtn.innerHTML = `<i>📧</i> <span>${t("shareViaEmail") || "Share via Email"}</span>`;
      }

      // 4. Manage "Download Brief as PDF" in Gemini Menu
      if (geminiMenu) {
        let pdfBtn = document.getElementById("gemini-download-pdf");
        if (!pdfBtn) {
          pdfBtn = document.createElement("button");
          pdfBtn.id = "gemini-download-pdf";
          pdfBtn.className = "fab-item";
          pdfBtn.addEventListener("click", async () => {
            await (window as any).App.downloadBriefAsPdf();
            if (
              document.getElementById("gemini-menu")?.classList.contains("show")
            ) {
              dashboard.toggleGeminiMenu();
            }
          });
          geminiMenu.appendChild(pdfBtn);
        }
        pdfBtn.innerHTML = `<i>📄</i> <span>${t("downloadPdf") || "Download as PDF"}</span>`;
      }

      // 5. Manage "Install Update" in FAB menu (Visible only when pending)
      if (fabMenu) {
        let fabUpdateBtn = document.getElementById("fab-check-update");
        if (hasUpdate) {
          if (!fabUpdateBtn) {
            fabUpdateBtn = document.createElement("button");
            fabUpdateBtn.id = "fab-check-update";
            fabUpdateBtn.className = "fab-item";
            fabUpdateBtn.addEventListener("click", () => {
              installUpdate();
              dashboard.toggleFabMenu();
            });
            fabMenu.appendChild(fabUpdateBtn);
          }
          fabUpdateBtn.innerHTML = `<i>📥</i> <span>${t("installUpdate") || "Install Update"}</span>`;
          fabUpdateBtn.style.display = "flex";
          fabUpdateBtn.classList.add("pulse-red"); // Add red pulse when update is available
        } else if (fabUpdateBtn) {
          fabUpdateBtn.style.display = "none";
          fabUpdateBtn.classList.remove("pulse-red"); // Remove pulse when not visible
        }
      }

      // 5. Manage "View Changelog" button in FAB menu (only when update is available)
      if (fabMenu) {
        let changelogBtn = document.getElementById("fab-view-changelog");
        if (hasUpdate) {
          if (!changelogBtn) {
            changelogBtn = document.createElement("button");
            changelogBtn.id = "fab-view-changelog";
            changelogBtn.className = "fab-item";
            changelogBtn.addEventListener("click", () => {
              showChangelogModal();
              dashboard.toggleFabMenu(); // Close menu after action
            });
            fabMenu.appendChild(changelogBtn);
          }
          changelogBtn.innerHTML = `<i>✨</i> <span>${t("viewChangelog") || "What's New?"}</span>`;
          changelogBtn.style.display = "flex"; // Ensure it's visible
        } else if (changelogBtn) {
          changelogBtn.style.display = "none"; // Hide if no update
        }
      }

      // 5. Manage "Check for Updates" button
      if (actionRow && !document.getElementById("pwa-update-btn")) {
        const updateBtn = document.createElement("button");
        updateBtn.id = "pwa-update-btn";
        updateBtn.className = "icon-btn";
        updateBtn.style.display = "none";
        updateBtn.innerHTML = "🔄";
        updateBtn.setAttribute("data-title", getUpdateTooltip());
        updateBtn.addEventListener("click", () => checkForUpdate());

        // Place it near the install button
        const installBtn = document.getElementById("install-btn");
        if (installBtn) {
          actionRow.insertBefore(updateBtn, installBtn);
        } else {
          actionRow.appendChild(updateBtn);
        }
      }

      // Update the tooltip title and state reactively (handles language changes)
      const updateBtn = document.getElementById("pwa-update-btn");
      if (updateBtn) {
        updateUpdateButtonState();
      }
      updateFabPulseState(); // Update FAB pulse on state/lang change
    },
    (state) => ({ isInstalled: state.isAppInstalled, lang: state.lang }),
  );

  const isIosDevice = isIos() && !isInStandaloneMode();
  const isInstallableBrowser =
    "BeforeInstallPromptEvent" in window || isIosDevice;

  let qualificationComplete = false;

  function updateInstallButtonUI() {
    // Only show the button if the user has "qualified" (waited 3s) AND the browser is ready
    const btn = document.getElementById(
      "install-btn",
    ) as HTMLButtonElement | null;
    if (!btn || !qualificationComplete) return;

    if (deferredPrompt || isIosDevice) {
      btn.style.display = "block";
      btn.disabled = false;
      btn.innerHTML = t("install");
      btn.classList.add("install-ready-animate"); // Add class for animation
    } else {
      btn.style.display = "none";
    }
  }

  if (isInstallableBrowser) {
    const btn = document.getElementById(
      "install-btn",
    ) as HTMLButtonElement | null;
    if (btn) {
      btn.style.display = "block";
      btn.disabled = true;
      btn.innerHTML = `<span>${t("qualifying")}</span><div class="install-progress"></div>`;
      requestAnimationFrame(() => {
        const bar = btn.querySelector(
          ".install-progress",
        ) as HTMLElement | null;
        if (bar) bar.style.width = "100%";
      });
    }
  }

  setTimeout(() => {
    qualificationComplete = true;
    updateInstallButtonUI();

    // Show the update button once qualification is over
    const updateBtn = document.getElementById("pwa-update-btn");
    if (updateBtn) updateBtn.style.display = "flex";
    updateUpdateButtonState(); // Initial state for update button
  }, PWA_INSTALL_QUALIFICATION_DELAY_MS);

  const installBtn = document.getElementById(
    "install-btn",
  ) as HTMLButtonElement | null;
  installBtn?.addEventListener("click", () => {
    // Stop the pulse animation once the user has interacted with the button
    installBtn.classList.remove("install-ready-animate");

    if (deferredPrompt) {
      deferredPrompt.prompt();
      deferredPrompt.userChoice
        .then((choice) => {
          if (choice.outcome === "accepted") {
            triggerInstallCelebration(installBtn);
            dashboard.playUi("ping"); // Play a rewarding sound
          }
          deferredPrompt = null; // Clear the deferred prompt regardless of outcome
        })
        .catch((e) => {
          console.error("[PWA] Deferred prompt user choice failed:", e);
          deferredPrompt = null; // Ensure prompt is cleared even on error
        });
      if ("vibrate" in navigator) navigator.vibrate(50); // Vibrate on user click
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
      const mode = (import.meta as any).env.MODE;
      // Remove query parameters if they cause MIME issues; SW can detect environment via location.host
      const swUrl = "/sw.v2.js";

      navigator.serviceWorker
        .register(swUrl)
        .then((reg) => {
          swRegistration = reg;
          console.log(
            `[PWA] Service Worker registered in ${mode} mode:`,
            reg.scope,
          );
          reg
            .update()
            .catch((e: any) =>
              console.error("[PWA] Service Worker update failed:", e),
            );
          updateUpdateButtonState(); // Update button state after initial registration
          registerPeriodicUpdate(reg);
        })
        .catch((err) => {
          console.error("[PWA] Service Worker registration failed:", err);
        });
    });
  }
}
