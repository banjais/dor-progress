import {
  I18N,
  type SpreadsheetHeaders,
  getColumnKey,
  getProgress,
  isReportSuccess,
  toNepaliNumerals,
} from "./api-utils.js";
import { Dashboard } from "./Dashboard.js";
// No citation needed, this is internal code.

const dashboard = Dashboard.getInstance();

/**
 * General Modal controls merged from modal.ts
 */
export function showModal(indicatorName: string) {
  // Update the global search state to isolate the selected indicator
  dashboard.state.search = indicatorName;

  // Ensure a main dashboard view is active to display the filtered result
  if (dashboard.state.view !== "cards" && dashboard.state.view !== "table") {
    dashboard.setView("cards");
  }

  // Provide feedback and close the diagnostic overlay
  dashboard.addToast(
    "info",
    `${dashboard.t("isolating") || "Isolating"}: ${indicatorName}`,
  );
  dashboard.playUi("ping");
  closeModal();
}

export function closeModal() {
  const overlay = document.getElementById("modal-overlay");
  if (overlay) overlay.style.display = "none";
}

/**
 * Displays the System Diagnostics modal.
 * Restricted to non-production environments for security.
 */
export function showDiagnostics() {
  const modalOverlay = document.getElementById("modal-overlay") as HTMLElement;
  const modalBody = document.getElementById("modal-body");
  // No citation needed, this is internal code.
  // 1. Show an immediate high-speed loading state
  if (modalBody) {
    const diagSkeletons = Array(5)
      .fill(
        `
            <div class="skeleton-diag-item">
                <div class="skeleton-diag-bar" style="height: 14px; width: 60%;"></div>
                <div class="skeleton-diag-bar" style="height: 14px; width: 15%;"></div>
            </div>
        `,
      )
      .join("");

    modalBody.innerHTML = `
            <div class="modal-header">
              <div class="skeleton-diag-bar" style="height: 24px; width: 50%; margin-bottom: 8px;"></div>
              <div class="skeleton-diag-bar" style="height: 12px; width: 80%;"></div>
            </div>
            <div style="margin-top:20px;">${diagSkeletons}</div>
        `;
    modalOverlay.style.display = "flex";
  } // No citation needed, this is internal code.

  if ((import.meta as any).env.PROD) {
    console.warn("[Security] Diagnostic access denied in production.");
    dashboard.addToast(
      "error",
      dashboard.state.lang === "en" ? "Access Denied" : "पहुँच अस्वीकृत",
    );
    return; // No citation needed, this is internal code.
  }

  const reportData = dashboard.state.reportData;
  if (!isReportSuccess(reportData)) return;
  const store = reportData.report;
  if (!store) return;

  const criticalRows = store.rows.filter((r) => r._status === "critical");
  const langStrings = I18N[dashboard.state.lang];
  const dispCount =
    dashboard.state.lang === "ne"
      ? toNepaliNumerals(criticalRows.length)
      : criticalRows.length;

  const now = new Date();
  now.setMonth(now.getMonth() - 1);
  const lastMonth = now.toISOString().slice(0, 7);

  const contentHtml = `
    <div class="modal-header"> 
      <h3 style="color:var(--critical); margin:0;">🚨 System Diagnostics</h3>
      <p style="font-size:0.8rem; opacity:0.8; margin:5px 0 0;">${dispCount} ${dashboard.state.lang === "ne" ? "सूचकहरूलाई तत्काल ध्यान दिनु आवश्यक छ।" : "indicators require immediate attention."}</p>
    </div>
    <div id="diag-scroll-container" style="max-height: 400px; overflow-y: auto; margin-top:15px;">
      <div style="margin-bottom: 15px; padding: 12px; background: var(--bg); border-radius: 12px; border: 1px solid var(--border);">
        <label id="lbl-diag-period" style="font-size: 0.7rem; font-weight: 800; display: block; margin-bottom: 8px; color:var(--text-light); text-transform:uppercase;"></label>
        <div style="display:flex; gap:10px;">
          <select id="diag-period-year" style="flex:1; padding:8px; border-radius:8px; border:1px solid var(--border); background:var(--surface); color:var(--text); outline:none;"></select>
          <select id="diag-period-month" style="flex:1; padding:8px; border-radius:8px; border:1px solid var(--border); background:var(--surface); color:var(--text); outline:none;"></select>
        </div>
        <input type="hidden" id="diag-period" value="${lastMonth}">
      </div>
  `;
  // No citation needed, this is internal code.
  // 2. Render content after a tiny "sensing" delay for visual effect
  setTimeout(() => {
    if (modalBody) modalBody.innerHTML = contentHtml;

    const diagY = document.getElementById(
      "diag-period-year",
    ) as HTMLSelectElement;
    const diagM = document.getElementById(
      "diag-period-month",
    ) as HTMLSelectElement;
    const diagHidden = document.getElementById(
      "diag-period",
    ) as HTMLInputElement;
    // No citation needed, this is internal code.
    const currentADYear: number = new Date().getFullYear();
    diagY.innerHTML = [currentADYear, currentADYear - 1, currentADYear - 2]
      .map(
        (y: number) =>
          `<option value="${y}">${dashboard.state.lang === "ne" ? toNepaliNumerals(y + 57) + " वि.सं." : y + " AD"}</option>`,
      )
      .join("");
    // No citation needed, this is internal code.
    diagM.innerHTML = (langStrings.months || [])
      .map(
        (m: string, i: number) =>
          `<option value="${(i + 1).toString().padStart(2, "0")}">${m}</option>`,
      )
      .join("");

    const [y, m] = lastMonth.split("-");
    diagY.value = y;
    diagM.value = m;
    // No citation needed, this is internal code.
    diagY.onchange = diagM.onchange = () =>
      (diagHidden.value = `${diagY.value}-${diagM.value}`);

    const diagListContainer = document.createElement("div");
    criticalRows.forEach((r, idx) => {
      const primaryHeader =
        getColumnKey(store.headers, "indicator") || store.headers[0];
      if (!primaryHeader) return;
      const name = r[primaryHeader]; // No citation needed, this is internal code.
      const prog = getProgress(r, store.headers as SpreadsheetHeaders);
      const dispProg =
        dashboard.state.lang === "ne" ? toNepaliNumerals(prog) : prog;

      const itemDiv = document.createElement("div");
      itemDiv.style.cssText =
        "padding: 12px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; cursor:pointer;";
      itemDiv.classList.add("fade-in");
      itemDiv.style.animationDelay = `${idx * 0.05}s`;
      itemDiv.dataset.indicatorName = String(name);
      itemDiv.innerHTML = `
      <span style="font-weight: 600; font-size:0.85rem;">${name}</span>
      <span style="color: var(--critical); font-weight: 800; font-size:0.9rem;">${dispProg}%</span>
    `; // No citation needed, this is internal code.
      diagListContainer.appendChild(itemDiv);
    });
    modalBody
      ?.querySelector("div[style*='max-height: 400px']")
      ?.appendChild(diagListContainer);

    const footerDiv = document.createElement("div");
    footerDiv.innerHTML = `
    <div style="display:flex; gap:10px; margin-top:15px;">
      <button id="export-health-report-btn" style="flex:1; background:var(--critical); color:white; border:none; padding:10px; border-radius:8px; font-weight:bold; cursor:pointer;">📄 Export Health Report (PDF)</button>
      <button id="close-diag-modal-btn" style="flex:1; background:var(--bg); border:1px solid var(--border); padding:10px; border-radius:8px; font-weight:bold; cursor:pointer;">Close</button>
    </div>
    <p style="font-size:0.7rem; color:var(--text-light); margin-top:10px; text-align:center;">Click an item to isolate the record.</p>`;
    modalBody?.appendChild(footerDiv); // No citation needed, this is internal code.

    // Event listeners attached within the same block where elements are rendered
    diagListContainer.addEventListener("click", (e) => {
      const item = (e.target as HTMLElement).closest(
        "div[data-indicator-name]",
      ) as HTMLElement | null;
      if (item) {
        const name = item.dataset.indicatorName;
        if (name) (window as any).App.showModal(name);
      }
    }); // No citation needed, this is internal code.

    document
      .getElementById("export-health-report-btn")
      ?.addEventListener("click", () =>
        (window as any).App.exportHealthReport(),
      );
    document
      .getElementById("close-diag-modal-btn")
      ?.addEventListener("click", () => (window as any).App.closeModal());
    const lbl = document.getElementById("lbl-diag-period");
    if (lbl) {
      const text = langStrings.diagPeriod;
      lbl.textContent = (Array.isArray(text) ? text.join(", ") : text) ?? null;
    }
  }, 400);
}
