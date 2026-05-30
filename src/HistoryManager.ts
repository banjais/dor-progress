import { z } from "zod";

import { Dashboard } from "./Dashboard.js";
import {
  type ArchiveMetadata,
  ArchiveMetadataSchema,
  I18N,
  type ProjectReport,
  ProjectReportSchema,
  authenticatedFetch,
  downloadBlob,
  parseResponse,
  t,
  toNepaliNumerals,
} from "./api-utils.js";

export class HistoryManager {
  // No citation needed, this is internal code.
  private dashboard: Dashboard;
  private weeklyArchives = [] as ArchiveMetadata[];

  constructor(dashboard: Dashboard) {
    this.dashboard = dashboard;
  }

  toggleHistory() {
    if (this.dashboard.state.view === "history") {
      this.dashboard.setView("table");
      return;
    }
    this.dashboard.setView("history");
    this.toggleHistoryTab("weekly");
  }

  toggleHistoryTab(tab: string) {
    const weeklyBtn = document.getElementById("hist-weekly-btn");
    const cumulativeBtn = document.getElementById("hist-cumulative-btn");
    const cumulativeControls = document.getElementById("cumulative-controls");
    const currentWeekBtn = document.getElementById("btn-current-week");
    const historyList = document.getElementById("history-list");

    if (weeklyBtn) weeklyBtn.classList.toggle("active", tab === "weekly");
    if (cumulativeBtn)
      cumulativeBtn.classList.toggle("active", tab === "cumulative");
    if (cumulativeControls)
      cumulativeControls.style.display =
        tab === "cumulative" ? "block" : "none";
    if (currentWeekBtn)
      currentWeekBtn.style.display = tab === "weekly" ? "block" : "none";
    if (historyList)
      historyList.style.display = tab === "weekly" ? "grid" : "none";

    if (tab === "cumulative") {
      this.renderDropdowns();
      const now = new Date();
      const yearInput = document.getElementById(
        "summary-year",
      ) as unknown as HTMLSelectElement;
      const monthInput = document.getElementById(
        "summary-month",
      ) as unknown as HTMLSelectElement;
      if (yearInput) yearInput.value = now.getFullYear().toString();
      if (monthInput)
        monthInput.value = (now.getMonth() + 1).toString().padStart(2, "0");
    }

    if (tab === "weekly") void this.fetchWeeklyHistory();
  }

  private async fetchWeeklyHistory() {
    const res = await authenticatedFetch(`/api/reports`);
    if (!res.ok) return;
    this.weeklyArchives = await parseResponse(
      res,
      z.array(ArchiveMetadataSchema),
    );

    const histBtn = document.getElementById("hist-btn");
    if (this.weeklyArchives.length < 2) {
      if (histBtn) histBtn.style.display = "none";
    } else {
      if (histBtn) histBtn.style.display = "flex";
    }

    const html = this.weeklyArchives
      .map(
        (h: {
          date: string;
          bsDate?: string;
          recordCount: number;
          summary?: string;
        }) => `
                <div class="chart-card archive-item" style="display:flex; flex-direction:column; justify-content:space-between">
                  <div style="display:flex; justify-content:space-between; align-items:start; margin-bottom:10px">
                    <div>
                      ${this.dashboard.state.diffMode && this.dashboard.state.compareReport?.lastUpdate === h.date ? `<span style="font-size:0.6rem; background:var(--stable); color:var(--text-on-accent); padding:2px 6px; border-radius:4px; margin-right:5px;">COMPARING</span>` : ""}
                      <b style="font-size:1.1rem">📅 ${h.date}</b>
                      ${h.bsDate ? `<div style="font-size:0.75rem; color:var(--primary); font-weight:bold; margin-top:2px">${this.dashboard.state.lang === "ne" ? toNepaliNumerals(h.bsDate) : h.bsDate}</div>` : ""}
                    </div>
                    <div style="display:flex; gap:5px">
                      <button onclick="App.shareSnapshot('${h.date}')" class="icon-btn" title="Share Link" style="width:28px; height:28px; font-size:0.8rem; background:var(--hover); border-radius:6px">🔗</button>
                      <button onclick="App.downloadPdf('${h.date}')" style="border:none; cursor:pointer; font-size:0.7rem; background:var(--critical); color:var(--text-on-accent); padding:4px 8px; border-radius:6px; height:28px">PDF</button>
                    </div>
                  </div>
                  <p style="font-size:0.8rem; opacity:0.8; margin-bottom:12px">${h.bsDate ? `${t("total")}: ${this.dashboard.state.lang === "ne" ? toNepaliNumerals(h.recordCount) : h.recordCount}` : h.summary || "Weekly progress snapshot."}</p>
                  <div style="display:flex; gap:8px;">
                    ${this.dashboard.state.diffMode && this.dashboard.state.compareReport?.lastUpdate === h.date ? `<button onclick="App.toggleDiffMode(null)" style="flex:2; border:1px solid var(--critical); background:none; color:var(--critical); padding:10px; border-radius:8px; cursor:pointer; font-weight:bold">${t("diffModeOff")}</button>` : `<button onclick="App.toggleDiffMode('${h.date}')" style="flex:2; border:1px solid var(--stable); background:none; color:var(--stable); padding:10px; border-radius:8px; cursor:pointer; font-weight:bold">↔️ ${t("compare")}</button>`}
                    <button onclick="App.loadSnapshot('${h.date}')" style="flex:2; border:1px solid var(--primary); background:none; color:var(--primary); padding:10px; border-radius:8px; cursor:pointer; font-weight:bold">${t("viewData")}</button>
                    <button onclick="App.quickPrintSnapshot('${h.date}')" title="Direct Print" style="flex:1; border:1px solid var(--border); background:var(--hover); color:var(--text); padding:10px; border-radius:8px; cursor:pointer; font-size:1rem">🖨️</button>
                  </div>
                </div>
            `,
      )
      .join("");
    const hList = document.getElementById("history-list");
    if (hList) hList.innerHTML = html || "<p>No archives found yet.</p>";
  }

  selectCurrentWeek() {
    if (this.weeklyArchives.length > 0) {
      void this.loadSnapshot(this.weeklyArchives[0].date);
    }
  }

  async loadCumulative(type: string) {
    this.dashboard.showLoading();
    // Reset states to trigger skeleton screens
    this.dashboard.state.cumulativeReport = null;
    this.dashboard.state.reportData = {
      type: "loading",
      report: null,
      message: null,
    };
    this.dashboard.state.search = "";

    const yearInput = document.getElementById(
      "summary-year",
    ) as unknown as HTMLSelectElement;
    const monthInput = document.getElementById(
      "summary-month",
    ) as unknown as HTMLSelectElement;
    const year = yearInput?.value;
    const month = monthInput?.value;
    const period = `${year}-${month}`;

    try {
      const res: Response = await authenticatedFetch(
        `/api/summary?type=${type}&year=${year}&month=${month}&lang=${this.dashboard.state.lang}`,
      );
      if (!res.ok) {
        this.dashboard.addToast("info", t("noDataForPeriod"));
        this.dashboard.state.reportData = {
          type: "idle",
          report: null,
          message: null,
        };
        return;
      }
      const json = (await parseResponse(
        res,
        ProjectReportSchema,
      )) as ProjectReport;

      // Synchronize state for AI Briefing and main UI
      this.dashboard.state.cumulativeReport = json;
      this.dashboard.state.reportData = {
        type: "success",
        report: json,
        message: null,
      };

      // Update derived risk metrics so ambiance reflects cumulative data
      this.dashboard.state.riskLevel =
        json.rows.filter((r) => r._status === "critical").length /
        (json.rows.length || 1);
      this.dashboard.updateHum(this.dashboard.state.riskLevel);
      this.dashboard.updateMusicFilter(this.dashboard.state.riskLevel);

      this.dashboard.setView("cumulative");

      const successMsg = t("cumulativeReportSuccess");
      const msg =
        successMsg === "cumulativeReportSuccess"
          ? this.dashboard.state.lang === "ne"
            ? `मासिक रिपोर्ट सफलतापूर्वक लोड भयो (${toNepaliNumerals(period)})`
            : `Cumulative report loaded successfully for ${period}`
          : successMsg.replace("{{period}}", period);
      this.dashboard.addToast("success", msg);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Failed to load cumulative report";
      this.dashboard.state.reportData = {
        type: "error",
        message: msg,
        report: null,
      };
      this.dashboard.addToast("error", msg);
    } finally {
      this.dashboard.hideLoading(true);
    }
  }

  async downloadConsolidatedPdf() {
    const month = (
      document.getElementById("summary-month") as unknown as HTMLSelectElement
    ).value;
    const year = (
      document.getElementById("summary-year") as unknown as HTMLSelectElement
    ).value;

    const res = await authenticatedFetch(
      `/api/consolidated-pdf?type=monthly&year=${year}&month=${month}`,
    );

    if (res.ok) {
      const blob = await res.blob();
      downloadBlob(blob, `DoR_Consolidated_${month}_${year}.pdf`);
    }
  }

  async downloadPdf(date: string) {
    const btn = document.getElementById(
      "official-pdf-btn",
    ) as HTMLButtonElement;
    const originalHtml = btn ? btn.innerHTML : "📥";

    try {
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<span class="spinner" style="border-top-color:var(--primary); width:16px; height:16px;"></span> ${t("downloading")} 0%`;
      }

      const res = await authenticatedFetch(`/api/snapshot?date=${date}`);

      if (res.ok) {
        const contentLength = res.headers.get("Content-Length");
        if (!contentLength) {
          const blob = await res.blob();
          downloadBlob(blob, `DoR_Official_Report_${date}.pdf`);
          return;
        }

        const total = parseInt(contentLength, 10);
        let loaded = 0;
        const reader = res.body!.getReader();
        const chunks = [];

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          loaded += value.length;
          const percent = Math.round((loaded / total) * 100);
          const dispPerc =
            this.dashboard.state.lang === "ne"
              ? toNepaliNumerals(percent)
              : percent;
          if (btn)
            btn.innerHTML = `<span class="spinner" style="border-top-color:var(--primary); width:16px; height:16px;"></span> ${t("downloading")} ${dispPerc}%`;
        }

        const blob = new Blob(chunks, { type: "application/pdf" });
        downloadBlob(blob, `DoR_Official_Report_${date}.pdf`);
      } else {
        this.dashboard.addToast(
          "error",
          this.dashboard.state.lang === "en"
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

  async loadSnapshot(date: string) {
    this.dashboard.showLoading();
    // Reset states to trigger skeleton screens
    this.dashboard.state.store = null;
    this.dashboard.state.reportData = {
      type: "loading",
      report: null,
      message: null,
    };
    this.dashboard.state.search = "";

    try {
      const res = await authenticatedFetch(
        `/api/report?date=${date}&lang=${this.dashboard.state.lang}`,
      );
      const json = (await parseResponse(
        res,
        ProjectReportSchema,
      )) as ProjectReport;

      // Synchronize active report and briefing states
      this.dashboard.state.store = json;
      this.dashboard.state.reportData = {
        type: "success",
        report: json,
        message: null,
      };

      // Update derived risk metrics so audio/visual ambiance reflects history data
      this.dashboard.state.riskLevel =
        json.rows.filter((r) => r._status === "critical").length /
        (json.rows.length || 1);
      this.dashboard.updateHum(this.dashboard.state.riskLevel);
      this.dashboard.updateMusicFilter(this.dashboard.state.riskLevel);

      this.dashboard.setView("table");
      this.dashboard.addToast("info", `Viewing data from ${date}`);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Failed to load snapshot";
      this.dashboard.state.reportData = {
        type: "error",
        message: msg,
        report: null,
      };
      this.dashboard.addToast("error", msg);
    } finally {
      this.dashboard.hideLoading(true);
    }
  }

  async handleVerification() {
    const params = new URLSearchParams(window.location.search);
    const type = params.get("type");
    const period = params.get("period");

    if (!type || !period) return;

    this.dashboard.setView("verify");
    const loader = document.getElementById("loader");
    if (loader) loader.style.display = "flex";
    const verifyTitle = document.getElementById("verify-title");
    if (verifyTitle) verifyTitle.textContent = t("verificationTitle");

    try {
      const endpoint =
        type === "monthly"
          ? `/api/summary?type=monthly&year=${period.split("-")[0]}&month=${period.split("-")[1]}&lang=${this.dashboard.state.lang}`
          : `/api/report?date=${period}&lang=${this.dashboard.state.lang}`;
      const res = await authenticatedFetch(endpoint);
      const verifyMsg = document.getElementById("verify-msg");
      const verifyDetails = document.getElementById("verify-details");

      if (res.ok) {
        if (verifyMsg) {
          verifyMsg.textContent = t("verifiedSuccess");
          verifyMsg.style.color = "var(--good)";
        }
        if (verifyDetails)
          verifyDetails.innerHTML = `<b>Type:</b> ${type.toUpperCase()}<br><b>Period:</b> ${period}<br><b>Status:</b> SYSTEM_MATCH_FOUND`;
      } else {
        throw new Error();
      }
    } catch {
      const verifyMsg = document.getElementById("verify-msg");
      if (verifyMsg) {
        verifyMsg.textContent = t("invalidReport");
        verifyMsg.style.color = "var(--critical)";
      }
    } finally {
      if (loader) loader.style.display = "none";
    }
  }

  renderDropdowns() {
    const mSelect = document.getElementById(
      "summary-month",
    ) as unknown as HTMLSelectElement;
    const ySelect = document.getElementById(
      "summary-year",
    ) as unknown as HTMLSelectElement;
    if (!mSelect || !ySelect) return;

    const savedM = mSelect.value;
    const savedY = ySelect.value;

    mSelect.innerHTML = (I18N[this.dashboard.state.lang]?.months || [])
      .map(
        (m: string, i: number) =>
          `<option value="${(i + 1).toString().padStart(2, "0")}">${m}</option>`,
      )
      .join("");

    const currentADYear = new Date().getFullYear();
    ySelect.innerHTML = [currentADYear, currentADYear - 1, currentADYear - 2]
      .map(
        (y: number) =>
          `<option value="${y}">${this.dashboard.state.lang === "ne" ? toNepaliNumerals(y + 57) + " वि.सं." : y + " AD"}</option>`,
      )
      .join("");

    if (savedM) mSelect.value = savedM;
    if (savedY) ySelect.value = savedY;
  }
}
