import { z } from "zod";

import { Dashboard } from "./Dashboard.js";
import { checkForUpdate, updateUpdateButtonState } from "./PWAManager.js";
import {
  ArchiveMetadataSchema,
  authenticatedFetch,
  downloadBlob,
  parseResponse,
  t,
  toError,
  toNepaliNumerals,
} from "./api-utils.js";
import { BrandingEngine } from "./components/BrandingEngine.js";

const dashboard = Dashboard.getInstance();

/**
 * Administrative and Maintenance logic.
 */

export async function requestSnapshotKey(): Promise<string | null> {
  if ((import.meta as any).env.VITE_APP_ENV !== "production")
    return "dev-bypass";
  const cached = sessionStorage.getItem("_snapshot_key");
  if (cached !== null) return cached;

  return new Promise((resolve) => {
    const modalBody = document.getElementById("modal-body");
    const overlay = document.getElementById("modal-overlay");
    if (modalBody === null || overlay === null) return resolve(null);

    modalBody.innerHTML = `
      <div class="modal-header">
        <h3 style="margin:0; color:var(--primary)">🔐 ${t("authRequired") || "Authentication Required"}</h3>
        <p style="font-size:0.8rem; opacity:0.7; margin-top:5px;">Please enter the Snapshot Key to authorize this administrative action.</p>
      </div>
      <div style="padding: 20px 0;">
        <input type="password" id="snapshot-key-input" style="width: 100%; padding: 14px; border-radius: 12px; border: 1px solid var(--border); background: var(--bg); color: var(--text); text-align: center; letter-spacing: 0.2em;">
      </div>
      <div style="display:flex; gap:10px;">
        <button id="snapshot-key-submit" class="retry-btn" style="flex:1;">${t("authorize")}</button>
        <button id="snapshot-key-cancel" class="toggle-btn" style="flex:1; border:1px solid var(--border);">${t("cancel")}</button>
      </div>
    `;
    overlay.style.display = "flex";
    const input = document.getElementById(
      "snapshot-key-input",
    ) as HTMLInputElement;
    input.focus();

    const closeAndResolve = (val: string | null) => {
      if (val !== null && val !== "") sessionStorage.setItem("_snapshot_key", val);
      overlay.style.display = "none";
      resolve(val);
    };

    document
      .getElementById("snapshot-key-submit")
      ?.addEventListener("click", () => closeAndResolve(input.value.trim()));
    document
      .getElementById("snapshot-key-cancel")
      ?.addEventListener("click", () => closeAndResolve(null));
  });
}

export async function createSnapshotManual(e?: Event) {
  const btn = (e?.target ||
    document.getElementById("create-snapshot-btn")) as HTMLButtonElement | null;
  if (!btn) return;
  const originalText = btn.innerText;
  btn.innerText = "Creating...";
  btn.disabled = true;
  try {
    const key = await requestSnapshotKey();
    if (key === null) {
      btn.innerText = originalText;
      btn.disabled = false;
      return;
    }

    if (dashboard.state.store === null) {
      dashboard.addToast("error", "No data");
      btn.innerText = originalText;
      btn.disabled = false;
      return;
    }

    const response = await authenticatedFetch("/api/snapshot", {
      method: "POST",
      headers: { "X-Snapshot-Key": key },
      body: JSON.stringify({
        headers: dashboard.state.store.headers || [],
        records: dashboard.state.store.rows || [],
        meta: {
          lastUpdate:
            dashboard.state.store.lastUpdate ||
            new Date().toISOString().split("T")[0],
          total: dashboard.state.store.rows.length,
        },
      }),
    });
    await parseResponse(
      response,
      z.object({ success: z.boolean(), date: z.string().optional() }),
    );
    dashboard.addToast("success", "Snapshot created!");
    void listSnapshots(true);
  } catch (err) {
    console.error("Error creating snapshot:", err);
    dashboard.addToast("error", toError(err).message);
  } finally {
    btn.innerText = originalText;
    btn.disabled = false;
  }
}

export async function listSnapshots(force?: boolean) {
  const container = document.getElementById("snapshot-list-container");
  const listEl = document.getElementById("snapshot-list");
  if (container === null || listEl === null) return;
  if (container.style.display !== "none" && force !== true) {
    container.style.display = "none";
    return;
  }
  try {
    const key = await requestSnapshotKey();
    if (key === null) return;
    const response = await authenticatedFetch("/api/reports", {
      headers: { "X-Snapshot-Key": key },
    });
    const data = await parseResponse(response, z.array(ArchiveMetadataSchema));

    if (data.length === 0) {
      listEl.innerHTML = "<p style='font-size: 0.7rem;'>No snapshots</p>";
    } else {
      data.sort((a, b) => b.date.localeCompare(a.date));
      listEl.innerHTML = data
        .map(
          (s) => `
              <div style="background: var(--bg); border-radius: 8px; padding: 10px; border: 1px solid var(--border); margin-bottom: 8px;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                  <span style="font-size: 0.75rem; font-weight: 800; color: var(--primary);">${s.date}</span>
                </div>
                <div style="font-size: 0.65rem; color: var(--text-light);">${t("records") || "Records"}: ${dashboard.state.lang === "ne" ? toNepaliNumerals(s.recordCount) : s.recordCount}</div>
                <div style="display: flex; gap: 5px; margin-top: 5px;">
                  <button onclick="App.downloadSnapshot('${s.date}')" class="toggle-btn" style="flex: 1; padding: 5px; font-size: 0.65rem; border: 1px solid var(--primary); background: transparent; color: var(--primary); cursor: pointer;">Download</button>
                  <button onclick="App.deleteSnapshot('${s.date}')" class="toggle-btn" style="flex: 1; padding: 5px; font-size: 0.65rem; border: 1px solid var(--critical); background: transparent; color: var(--critical); cursor: pointer;">Delete</button>
                </div>
              </div>
            `,
        )
        .join("");
    }
    container.style.display = "block";
  } catch (e) {
    dashboard.addToast("error", toError(e).message);
  }
}

export async function downloadSnapshot(date: string) {
  const key = await requestSnapshotKey();
  if (key === null) return;
  try {
    const res = await authenticatedFetch(`/api/snapshot?date=${date}`, {
      headers: { "X-Snapshot-Key": key },
    });
    downloadBlob(await res.blob(), `DoR_Snapshot_${date}.pdf`);
  } catch (e) {
    dashboard.addToast("error", toError(e).message);
  }
}

export async function deleteSnapshot(date: string) {
  if (!confirm(`Delete ${date}?`)) return;
  const key = await requestSnapshotKey();
  if (key === null) return;
  try {
    await authenticatedFetch(`/api/snapshot?date=${date}`, {
      method: "DELETE",
      headers: { "X-Snapshot-Key": key },
    });
    void listSnapshots(true);
  } catch (e) {
    dashboard.addToast("error", toError(e).message);
  }
}

export const showSettings = async () => {
  const modalBody = document.getElementById("modal-body");
  const overlay = document.getElementById("modal-overlay");
  if (!modalBody || !overlay) return;

  modalBody.innerHTML = `
      <div class="modal-header">
        <h3 style="margin:0; color:var(--primary)">⚙️ ${t("settings") || "Settings"}</h3>
        <p style="font-size:0.8rem; opacity:0.7; margin-top:5px;">System configuration and update management.</p>
      </div>
      <div style="padding: 20px 0;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; padding: 15px; background: var(--bg); border-radius: 16px; border: 1px solid var(--border);">
            <div>
                <b style="font-size: 0.65rem; color: var(--text-light); text-transform: uppercase; letter-spacing: 0.05em;">Application Version</b>
                <div style="font-size: 1.1rem; font-weight: 800; color: var(--primary);">v${BrandingEngine.config.version || "1.0.0"}</div>
            </div>
            <button id="settings-check-update" class="retry-btn" style="margin: 0; padding: 10px 20px; font-size: 0.8rem; border-radius: 10px;">
                🔄 ${t("checkForUpdates") || "Check for Updates"}
            </button>
        </div>

        <div class="modal-item" style="margin-top: 15px;">
             <b style="color: var(--text-light); font-size: 0.75rem; text-transform: uppercase; margin-bottom: 10px; display: block;">${t("maintenance")}</b>
             <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
                <button class="toggle-btn" onclick="App.clearDataCache()" style="font-size: 0.75rem; border: 1px solid var(--border);">${t("clearCache")}</button>
                <button class="toggle-btn" onclick="App.logoutSnapshotSession()" style="font-size: 0.75rem; border: 1px solid var(--border);">${t("logoutAdmin") || "Logout Admin"}</button>
             </div>
        </div>
      </div>
      <div style="text-align: right; margin-top: 10px; padding-top: 15px; border-top: 1px solid var(--border);">
        <button id="settings-close" class="toggle-btn active" style="padding: 10px 30px; border-radius: 10px;">${t("close")}</button>
      </div>
    `;

  overlay.style.display = "flex";

  const updateBtn = document.getElementById(
    "settings-check-update",
  ) as HTMLButtonElement;
  updateBtn?.addEventListener("click", () => {
    checkForUpdate(updateBtn);
  });
  updateUpdateButtonState(updateBtn); // Set initial state for the settings button

  document.getElementById("settings-close")?.addEventListener("click", () => {
    overlay.style.display = "none";
  });
};
export async function triggerDatabaseBackup() {
  console.log("Backup triggered");
}
export async function triggerDatabaseRestore() {
  console.log("Restore triggered");
}
export async function downloadAllOfflineData() {
  console.log("Downloading offline data");
}
export function clearDataCache() {
  localStorage.clear();
  location.reload();
}
export function executeFactoryReset() {
  localStorage.clear();
  sessionStorage.clear();
  location.reload();
}
export function logoutSnapshotSession() {
  dashboard.logout();
}
