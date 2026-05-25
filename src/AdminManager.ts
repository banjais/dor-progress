import { z } from "zod";
import { Dashboard } from "./Dashboard.js";
import { 
    t, 
    authenticatedFetch, 
    toError, 
    parseResponse, 
    ArchiveMetadataSchema, 
    downloadBlob 
} from "./api-utils.js";

const dashboard = Dashboard.getInstance();

/**
 * Administrative and Maintenance logic consolidated from SnapshotManager and MaintenanceManager
 */

export async function requestSnapshotKey(): Promise<string | null> {
    if (APP_ENV !== "production") return "dev-bypass";
    const cached = sessionStorage.getItem("_snapshot_key");
    if (cached) return cached;

    return new Promise((resolve) => {
        const modalBody = document.getElementById("modal-body");
        const overlay = document.getElementById("modal-overlay");
        if (!modalBody || !overlay) return resolve(null);

        modalBody.innerHTML = `
      <div class="modal-header">
        <h3 style="margin:0; color:var(--primary)">🔐 ${t("authRequired")}</h3>
        <p style="font-size:0.8rem; opacity:0.7; margin-top:5px;">Enter Snapshot Key to authorize administrative actions.</p>
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
        const input = document.getElementById("snapshot-key-input") as HTMLInputElement;
        input.focus();

        const closeAndResolve = (val: string | null) => {
            if (val) sessionStorage.setItem("_snapshot_key", val);
            overlay.style.display = "none";
            resolve(val);
        };

        document.getElementById("snapshot-key-submit")?.addEventListener("click", () => closeAndResolve(input.value.trim()));
        document.getElementById("snapshot-key-cancel")?.addEventListener("click", () => closeAndResolve(null));
    });
}

export async function createSnapshotManual(e?: Event) {
    const btn = (e?.target || document.getElementById("create-snapshot-btn")) as HTMLButtonElement | null;
    if (!btn || !dashboard.state.store) return;
    const originalText = btn.innerText;
    btn.innerText = "Creating...";
    try {
        const key = await requestSnapshotKey();
        if (!key) return;
        const response = await authenticatedFetch("/api/snapshot", {
            method: "POST",
            headers: { "X-Snapshot-Key": key },
            body: JSON.stringify({
                headers: dashboard.state.store.headers,
                records: dashboard.state.store.rows,
                meta: { lastUpdate: dashboard.state.store.lastUpdate, total: dashboard.state.store.rows.length }
            }),
        });
        await parseResponse(response, z.object({ success: z.boolean() }));
        dashboard.addToast("success", "Snapshot created!");
    } finally {
        btn.innerText = originalText;
    }
}

export async function listSnapshots(_force?: boolean) {
    const container = document.getElementById("snapshot-list-container");
    const listEl = document.getElementById("snapshot-list");
    if (!container || !listEl) return;
    try {
        const key = await requestSnapshotKey();
        if (!key) return;
        const response = await authenticatedFetch("/api/reports", { headers: { "X-Snapshot-Key": key } });
        const data = await parseResponse(response, z.array(ArchiveMetadataSchema));
        listEl.innerHTML = data.map(s => `
      <div style="background:var(--bg); padding:10px; border:1px solid var(--border); margin-bottom:8px; border-radius:8px;">
        <span style="font-size:0.75rem; font-weight:800; color:var(--primary);">${s.date}</span>
        <div style="display:flex; gap:5px; margin-top:5px;">
          <button onclick="App.downloadSnapshot('${s.date}')" style="flex:1; font-size:0.6rem;">Download</button>
          <button onclick="App.deleteSnapshot('${s.date}')" style="flex:1; font-size:0.6rem; color:var(--critical);">Delete</button>
        </div>
      </div>
    `).join("");
        container.style.display = "block";
    } catch (e) { dashboard.addToast("error", toError(e).message); }
}

export async function downloadSnapshot(date: string) {
    const key = await requestSnapshotKey();
    if (!key) return;
    try {
        const res = await authenticatedFetch(`/api/snapshot?date=${date}`, { headers: { "X-Snapshot-Key": key } });
        downloadBlob(await res.blob(), `DoR_Snapshot_${date}.pdf`);
    } catch (e) { dashboard.addToast("error", toError(e).message); }
}

export async function deleteSnapshot(date: string) {
    if (!confirm(`Delete ${date}?`)) return;
    const key = await requestSnapshotKey();
    if (!key) return;
    try {
        await authenticatedFetch(`/api/snapshot?date=${date}`, { method: "DELETE", headers: { "X-Snapshot-Key": key } });
        void listSnapshots(true);
    } catch (e) { dashboard.addToast("error", toError(e).message); }
}

export const showSettings = async (_dashboard: Dashboard) => { console.log("Settings opened"); };
export async function triggerDatabaseBackup() { console.log("Backup triggered"); }
export async function triggerDatabaseRestore() { console.log("Restore triggered"); }
export async function downloadAllOfflineData() { console.log("Downloading offline data"); }
export function clearDataCache() { localStorage.clear(); location.reload(); }
export function executeFactoryReset() { localStorage.clear(); sessionStorage.clear(); location.reload(); }
export function logoutSnapshotSession() {
    sessionStorage.removeItem("_snapshot_key");
    dashboard.addToast("info", dashboard.state.lang === "en" ? "Session cleared" : "सेसन मेटाइयो");
}