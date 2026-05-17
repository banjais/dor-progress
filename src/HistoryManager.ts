import { Dashboard } from "./Dashboard";
import {
    authenticatedFetch,
    t,
    toNepaliNumerals,
    I18N,
} from "./api-utils";

export class HistoryManager { // No citation needed, this is internal code.
    private dashboard: Dashboard;
    private weeklyArchives: any[] = [];

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
        if (cumulativeBtn) cumulativeBtn.classList.toggle("active", tab === "cumulative");
        if (cumulativeControls) cumulativeControls.style.display = tab === "cumulative" ? "block" : "none";
        if (currentWeekBtn) currentWeekBtn.style.display = tab === "weekly" ? "block" : "none";
        if (historyList) historyList.style.display = tab === "weekly" ? "grid" : "none";

        if (tab === "cumulative") {
            this.renderDropdowns();
            const now = new Date();
            const yearInput = document.getElementById("summary-year") as unknown as HTMLSelectElement;
            const monthInput = document.getElementById("summary-month") as unknown as HTMLSelectElement;
            if (yearInput) yearInput.value = now.getFullYear().toString();
            if (monthInput) monthInput.value = (now.getMonth() + 1).toString().padStart(2, "0");
        }

        if (tab === "weekly") void this.fetchWeeklyHistory();
    }

    private async fetchWeeklyHistory() {
        const res = await authenticatedFetch(`/api/reports`);
        if (!res.ok) return;
        this.weeklyArchives = await res.json();

        const histBtn = document.getElementById("hist-btn");
        if (this.weeklyArchives.length < 2) {
            if (histBtn) histBtn.style.display = "none";
        } else {
            if (histBtn) histBtn.style.display = "flex";
        }

        const html = this.weeklyArchives
            .map((h: any) => `
                <div class="chart-card archive-item" style="display:flex; flex-direction:column; justify-content:space-between">
                  <div style="display:flex; justify-content:space-between; align-items:start; margin-bottom:10px">
                    <div>
                      ${this.dashboard.state.diffMode && this.dashboard.state.compareReport?.lastUpdate === h.date ? `<span style="font-size:0.6rem; background:var(--stable); color:white; padding:2px 6px; border-radius:4px; margin-right:5px;">COMPARING</span>` : ""}
                      <b style="font-size:1.1rem">📅 ${h.date}</b>
                      ${h.bsDate ? `<div style="font-size:0.75rem; color:var(--primary); font-weight:bold; margin-top:2px">${this.dashboard.state.lang === "ne" ? toNepaliNumerals(h.bsDate) : h.bsDate}</div>` : ""}
                    </div>
                    <div style="display:flex; gap:5px">
                      <button onclick="App.shareSnapshot('${h.date}')" class="icon-btn" title="Share Link" style="width:28px; height:28px; font-size:0.8rem; background:rgba(0,0,0,0.05); border-radius:6px">🔗</button>
                      <button onclick="App.downloadPdf('${h.date}')" style="border:none; cursor:pointer; font-size:0.7rem; background:var(--critical); color:white; padding:4px 8px; border-radius:6px; height:28px">PDF</button>
                    </div>
                  </div>
                  <p style="font-size:0.8rem; opacity:0.8; margin-bottom:12px">${h.bsDate ? `${t("total")}: ${this.dashboard.state.lang === "ne" ? toNepaliNumerals(h.recordCount) : h.recordCount}` : h.summary || "Weekly progress snapshot."}</p>
                  <div style="display:flex; gap:8px;">
                    ${this.dashboard.state.diffMode && this.dashboard.state.compareReport?.lastUpdate === h.date ? `<button onclick="App.toggleDiffMode(null)" style="flex:2; border:1px solid var(--critical); background:none; color:var(--critical); padding:10px; border-radius:8px; cursor:pointer; font-weight:bold">${t("diffModeOff")}</button>` : `<button onclick="App.toggleDiffMode('${h.date}')" style="flex:2; border:1px solid var(--stable); background:none; color:var(--stable); padding:10px; border-radius:8px; cursor:pointer; font-weight:bold">↔️ ${t("compare")}</button>`}
                    <button onclick="App.loadSnapshot('${h.date}')" style="flex:2; border:1px solid var(--primary); background:none; color:var(--primary); padding:10px; border-radius:8px; cursor:pointer; font-weight:bold">${t("viewData")}</button>
                    <button onclick="App.quickPrintSnapshot('${h.date}')" title="Direct Print" style="flex:1; border:1px solid var(--border); background:rgba(0,0,0,0.03); color:var(--text); padding:10px; border-radius:8px; cursor:pointer; font-size:1rem">🖨️</button>
                  </div>
                </div>
            `).join("");
        const hList = document.getElementById("history-list");
        if (hList) hList.innerHTML = html || "<p>No archives found yet.</p>";
    }

    selectCurrentWeek() {
        if (this.weeklyArchives.length > 0) {
            void this.loadSnapshot(this.weeklyArchives[0].date);
        }
    }

    async loadCumulative(type: string) {
        const loader = document.getElementById("loader");
        if (loader) loader.style.display = "flex";
        const yearInput = document.getElementById("summary-year") as unknown as HTMLSelectElement;
        const monthInput = document.getElementById("summary-month") as unknown as HTMLSelectElement;
        const year = yearInput?.value;
        const month = monthInput?.value;
        const period = `${year}-${month}`;

        try {
            const res = await authenticatedFetch(
                `${WORKER_BASE}/api/summary?type=${type}&year=${year}&month=${month}&lang=${this.dashboard.state.lang}`,
            );
            const json = await res.json() as any;
            if (!res.ok) {
                this.dashboard.addToast("info", json.error || t("noDataForPeriod"));
                return;
            }
            this.dashboard.state.store = json;
            this.dashboard.setView("table");

            const successMsg = t("cumulativeReportSuccess");
            const msg = successMsg === "cumulativeReportSuccess"
                ? (this.dashboard.state.lang === "ne"
                    ? `मासिक रिपोर्ट सफलतापूर्वक लोड भयो (${toNepaliNumerals(period)})`
                    : `Cumulative report loaded successfully for ${period}`)
                : successMsg.replace("{{period}}", period);
            this.dashboard.addToast("success", msg);
        } finally {
            if (loader) loader.style.display = "none";
        }
    }

    async downloadConsolidatedPdf() {
        const month = (document.getElementById("summary-month") as unknown as HTMLSelectElement).value;
        const year = (document.getElementById("summary-year") as unknown as HTMLSelectElement).value;

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

    async downloadPdf(date: string) {
        const btn = document.getElementById("official-pdf-btn") as HTMLButtonElement;
        const originalHtml = btn ? btn.innerHTML : "📥";

        try {
            if (btn) {
                btn.disabled = true;
                btn.innerHTML = `<span class="spinner" style="border-top-color:var(--primary); width:16px; height:16px;"></span> ${t('downloading')} 0%`;
            }

            const res = await authenticatedFetch(`/api/snapshot?date=${date}`);

            if (res.ok) {
                const contentLength = res.headers.get("Content-Length");
                if (!contentLength) {
                    const blob = await res.blob();
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `DoR_Official_Report_${date}.pdf`;
                    a.click();
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
                    const dispPerc = this.dashboard.state.lang === "ne" ? toNepaliNumerals(percent) : percent;
                    if (btn) btn.innerHTML = `<span class="spinner" style="border-top-color:var(--primary); width:16px; height:16px;"></span> ${t('downloading')} ${dispPerc}%`;
                }

                const blob = new Blob(chunks, { type: "application/pdf" });
                const downloadUrl = window.URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = downloadUrl;
                a.download = `DoR_Official_Report_${date}.pdf`;
                a.click();
                window.URL.revokeObjectURL(downloadUrl);
            } else {
                this.dashboard.addToast("error", this.dashboard.state.lang === "en" ? "Failed to download PDF archive." : "PDF अभिलेख डाउनलोड गर्न असफल भयो।");
            }
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = originalHtml;
            }
        }
    }

    async loadSnapshot(date: string) {
        const loader = document.getElementById("loader");
        if (loader) loader.style.display = "flex";
        const res = await authenticatedFetch(`/api/report?date=${date}&lang=${this.dashboard.state.lang}`);
        const json = await res.json() as any;
        this.dashboard.state.store = json;
        this.dashboard.setView("table");
        if (loader) loader.style.display = "none";
        this.dashboard.addToast("info", `Viewing data from ${date}`);
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
        if (verifyTitle) verifyTitle.innerText = I18N[this.dashboard.state.lang].verificationTitle as string;

        try {
            const endpoint = type === "monthly"
                ? `/api/summary?type=monthly&year=${period.split("-")[0]}&month=${period.split("-")[1]}&lang=${this.dashboard.state.lang}`
                : `/api/report?date=${period}&lang=${this.dashboard.state.lang}`;
            const res = await authenticatedFetch(endpoint);
            const verifyMsg = document.getElementById("verify-msg");
            const verifyDetails = document.getElementById("verify-details");

            if (res.ok) {
                if (verifyMsg) {
                    verifyMsg.innerText = I18N[this.dashboard.state.lang].verifiedSuccess as string;
                    verifyMsg.style.color = "var(--good)";
                }
                if (verifyDetails) verifyDetails.innerHTML = `<b>Type:</b> ${type.toUpperCase()}<br><b>Period:</b> ${period}<br><b>Status:</b> SYSTEM_MATCH_FOUND`;
            } else {
                throw new Error();
            }
        } catch {
            const verifyMsg = document.getElementById("verify-msg");
            if (verifyMsg) {
                verifyMsg.innerText = I18N[this.dashboard.state.lang].invalidReport as string;
                verifyMsg.style.color = "var(--critical)";
            }
        } finally {
            if (loader) loader.style.display = "none";
        }
    }

    renderDropdowns() {
        const mSelect = document.getElementById("summary-month") as unknown as HTMLSelectElement;
        const ySelect = document.getElementById("summary-year") as unknown as HTMLSelectElement;
        if (!mSelect || !ySelect) return;

        const savedM = mSelect.value;
        const savedY = ySelect.value;

        mSelect.innerHTML = (I18N[this.dashboard.state.lang] as any).months
            .map((m: string, i: number) => `<option value="${(i + 1).toString().padStart(2, "0")}">${m}</option>`)
            .join("");

        const currentADYear = new Date().getFullYear();
        ySelect.innerHTML = [currentADYear, currentADYear - 1, currentADYear - 2]
            .map((y) => `<option value="${y}">${this.dashboard.state.lang === "ne" ? toNepaliNumerals(y + 57) + " वि.सं." : y + " AD"}</option>`)
            .join("");

        if (savedM) mSelect.value = savedM;
        if (savedY) ySelect.value = savedY;
    }
}