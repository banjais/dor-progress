import { Dashboard, DashboardState } from "./Dashboard";
import { authenticatedFetch, t, toNepaliNumerals } from "./api-utils";
import { ProjectReport } from "../shared/types";

// No citation needed, this is internal code.
export class BriefManager {
    private dashboard: Dashboard;

    constructor(dashboard: Dashboard) {
        this.dashboard = dashboard;
        this.initReactivity();
    }

    private initReactivity() {
        this.dashboard.subscribe(
            ({ summary, lang }) => this.render(summary, lang),
            (state: DashboardState) => ({
                summary: state.store?.aiSummary || null,
                lang: state.lang
            })
        );
    }

    private render(summary: any, lang: string) {
        const isLowData = localStorage.getItem("low-data") === "true";
        const briefCard = document.getElementById("ai-brief-card");
        if (!briefCard) return;

        if (!summary?.brief || isLowData) {
            briefCard.style.display = "none";
            return;
        }

        briefCard.style.display = "block";
        briefCard.classList.add("fade-in");

        // Visual Sentiment
        if (summary.overallHealth) {
            const colorVar = summary.overallHealth === "moderate" ? "stable" : summary.overallHealth;
            briefCard.style.borderLeft = `4px solid var(--${colorVar})`;
        }

        let briefText = summary.brief;
        if (lang === "ne") briefText = toNepaliNumerals(briefText);

        const container = document.getElementById("ai-brief-text");
        if (container) this.dashboard.typeText(container, briefText, true);

        // Actionable Insights (Badges)
        const highlightsContainer = document.getElementById("ai-highlights");
        if (highlightsContainer) {
            const hasCritical = summary.criticalProjects?.length > 0;
            const hasExceeding = summary.exceedingProjects?.length > 0;

            if (hasCritical || hasExceeding) {
                highlightsContainer.innerHTML = `
                  <div style="display:flex; flex-wrap:wrap; gap:8px; margin-top:12px;">
                    ${(summary.criticalProjects || []).map((p: string) => `
                      <button onclick="App.handleSearch('${p}')" class="badge-btn" style="background:var(--critical-soft); color:var(--critical); border:1px solid var(--critical); font-size:0.7rem; padding:4px 8px; border-radius:12px; cursor:pointer;">
                        ⚠️ ${p}
                      </button>`).join('')}
                    ${(summary.exceedingProjects || []).map((p: string) => `
                      <button onclick="App.handleSearch('${p}')" class="badge-btn" style="background:var(--good-soft); color:var(--good); border:1px solid var(--good); font-size:0.7rem; padding:4px 8px; border-radius:12px; cursor:pointer;">
                        🌟 ${p}
                      </button>`).join('')}
                  </div>`;
                highlightsContainer.style.display = "block";
            } else {
                highlightsContainer.style.display = "none";
            }
        }

        // Data Integrity Alerts
        const alertsContainer = document.getElementById("ai-discrepancies");
        if (alertsContainer) {
            if (summary.discrepancies?.length) {
                const title = lang === "ne" ? "डाटा अलर्टहरू" : "Data Integrity Alerts";
                alertsContainer.innerHTML = `
                  <div style="margin-top:10px; border-top:1px solid var(--border); padding-top:8px;">
                    <small style="font-weight:800; opacity:0.6; display:block; margin-bottom:4px;">⚠️ ${title}</small>
                    ${summary.discrepancies.map((d: any) => `
                      <div style="font-size:0.75rem; margin-bottom:2px; color:${d.severity === 'high' ? 'var(--critical)' : 'inherit'}">
                        • ${lang === 'ne' ? toNepaliNumerals(d.text) : d.text}
                      </div>`).join('')}
                  </div>`;
                alertsContainer.style.display = "block";
            } else {
                alertsContainer.style.display = "none";
            }
        }
    }

    print() {
        document.body.classList.add("print-memo-only");
        window.print();
        document.body.classList.remove("print-memo-only");
    }

    async share() {
        const text = (document.getElementById("ai-brief-text") as HTMLElement)?.innerText || "";
        if (navigator.share) {
            try {
                await navigator.share({
                    title: "DOR Progress Dashboard - Executive Briefing",
                    text: text,
                });
            } catch (err) {
                console.log("Share cancelled or failed", err);
            }
        } else {
            navigator.clipboard.writeText(text);
            this.dashboard.addToast("success", t("linkCopied"));
        }
    }

    async translate() {
        const btn = document.getElementById("ai-translate-btn") as HTMLButtonElement;
        if (btn) btn.classList.add("spinning");

        try {
            const res = await authenticatedFetch(`/api/report?lang=${this.dashboard.state.lang}`);
            const json = (await res.json()) as ProjectReport;
            if (json?.aiSummary?.brief) {
                this.dashboard.typeText(
                    document.getElementById("ai-brief-text")!,
                    json.aiSummary.brief,
                    true,
                );
            }
        } catch {
            this.dashboard.addToast("error", this.dashboard.state.lang === "en" ? "Failed" : "असफल");
        } finally {
            if (btn) btn.classList.remove("spinning");
        }
    }

    async downloadAudio() {
        const btn = document.getElementById("ai-download-audio-btn") as HTMLButtonElement;
        if (!btn) return;
        const originalHtml = btn.innerHTML;

        try {
            btn.disabled = true;
            btn.innerHTML = `<span class="spinner" style="border-top-color:var(--primary); width:14px; height:14px;"></span>`;
            this.dashboard.addToast("info", t("preparingAudio"));

            const blob = await this.dashboard.fetchAiBriefBlob();
            if (!blob) return;

            const url = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `DoR_Executive_Briefing_${new Date().toISOString().split("T")[0]}.mp3`;
            a.click();
        } catch {
            this.dashboard.addToast("error", "Audio failed");
        } finally {
            btn.disabled = false;
            btn.innerHTML = originalHtml;
        }
    }

    async shareAudio() {
        const btn = document.getElementById("ai-share-audio-btn") as HTMLButtonElement;
        if (!btn) return;
        const originalHtml = btn.innerHTML;

        try {
            btn.disabled = true;
            btn.innerHTML = `<span class="spinner" style="border-top-color:var(--primary); width:14px; height:14px;"></span>`;
            const blob = await this.dashboard.fetchAiBriefBlob();
            if (!blob) return;
            const file = new File([blob], `DoR_Summary_${new Date().toISOString().slice(0, 10)}.mp3`, { type: "audio/mpeg" });

            if (navigator.canShare?.({ files: [file] })) {
                await navigator.share({ files: [file], title: "DoR Executive Briefing", text: "Official Department of Roads Audio Summary" });
            } else {
                this.dashboard.addToast("error", "Not supported");
            }
        } catch {
            this.dashboard.addToast("error", "Share failed");
        } finally {
            btn.disabled = false;
            btn.innerHTML = originalHtml;
        }
    }

    toggleReadAloud() {
        const container = document.getElementById("ai-brief-text");
        if (container) this.dashboard.toggleSpeech(container);
    }
}