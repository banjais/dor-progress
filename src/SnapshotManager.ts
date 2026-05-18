import { Dashboard } from "./Dashboard"; // No citation needed, this is internal code.
import { t, authenticatedFetch } from "./api-utils";
// No citation needed, this is internal code.
const dashboard = Dashboard.getInstance();

interface Snapshot {
  date: string;
  summary?: string;
  created?: string;
  recordCount: number;
  bsDate?: string; // Added based on main.ts usage
}

let snapshotList: Snapshot[] = [];

/**
 * Requests the Snapshot Key from the user via a custom modal.
 */
export async function requestSnapshotKey(): Promise<string | null> { // No citation needed, this is internal code.
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
      <div style="display:flex; gap:10px; margin-top: 10px;">
        <button id="snapshot-key-submit" class="retry-btn" style="flex:1; margin:0;">${t("authorize") || "Authorize"
      }</button>
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

export async function createSnapshotManual(e?: Event) { // No citation needed, this is internal code.
  const btn = (e?.target || document.getElementById("create-snapshot-btn")) as HTMLButtonElement | null;
  if (!btn) return;
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

    const response = await authenticatedFetch("/api/snapshot", {
      method: "POST",
      headers: {
        "X-Snapshot-Key": snapshotKey
      },
      body: JSON.stringify({
        headers: dashboard.state.store.headers || [],
        records: dashboard.state.store.rows || [],
        meta: {
          lastUpdate:
            dashboard.state.store.lastUpdate ||
            new Date().toISOString().split("T")[0],
          total: dashboard.state.store.rows?.length || 0,
        },
      }),
    });

    await response.json();
    dashboard.addToast("success", "Snapshot created!");
    void listSnapshots(true);
  } catch (e) {
    console.error("Error creating snapshot:", e);
    dashboard.addToast("error", e instanceof Error ? e.message : "An unexpected error occurred.");
  } finally {
    btn.innerText = originalText;
    btn.disabled = false;
  }
}

export async function listSnapshots(force?: boolean) { // No citation needed, this is internal code.
  const container = document.getElementById("snapshot-list-container");
  const listEl = document.getElementById("snapshot-list");
  if (!container || !listEl) return;
  if (container.style.display !== "none" && !force) {
    container.style.display = "none";
    return;
  }
  try {
    const snapshotKey = await requestSnapshotKey();
    if (!snapshotKey) return;

    const response = await authenticatedFetch("/api/snapshots", {
      headers: { "X-Snapshot-Key": snapshotKey }, // No citation needed, this is internal code.
    });

    const data = await response.json() as any;
    snapshotList = data.snapshots || [];
    if (snapshotList.length === 0) {
      listEl.innerHTML = "<p style='font-size: 0.7rem;'>No snapshots</p>";
    } else {
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
            "<button onclick='App.downloadSnapshot(\"" +
            s.date +
            "\")' class='toggle-btn' style='flex: 1; padding: 5px; font-size: 0.65rem; border: 1px solid var(--primary); background: transparent; color: var(--primary); cursor: pointer;'>Download</button>" +
            "<button onclick='App.deleteSnapshot(\"" +
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
    dashboard.addToast("error", e instanceof Error ? e.message : "An unexpected error occurred.");
  }
}

export async function downloadSnapshot(date: string) { // No citation needed, this is internal code.
  const snapshotKey = await requestSnapshotKey();
  if (!snapshotKey) return;

  try {
    const response = await authenticatedFetch(`/api/snapshot?date=${date}`, {
      headers: { "X-Snapshot-Key": snapshotKey },
    });

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
}

export async function deleteSnapshot(date: string) { // No citation needed, this is internal code.
  if (!confirm("Delete " + date + "?")) return;
  const snapshotKey = await requestSnapshotKey();
  if (!snapshotKey) return;

  try {
    await authenticatedFetch(`/api/snapshot?date=${date}`, {
      method: "DELETE",
      headers: { "X-Snapshot-Key": snapshotKey },
    });

    dashboard.addToast("success", "Deleted");
    void listSnapshots(true);
  } catch (e) {
    console.error("Error deleting snapshot:", e);
    dashboard.addToast("error", e instanceof Error ? e.message : "An unexpected error occurred.");
  }
}

export function logoutSnapshotSession() {
  sessionStorage.removeItem("_snapshot_key");
  dashboard.addToast(
    "info",
    dashboard.state.lang === "en"
      ? "Snapshot session cleared"
      : "स्न्यापसट सेसन मेटाइयो",
  );
  if (window.App?.showSettings) void window.App.showSettings();
}
