import { Dashboard, DashboardState, isReportSuccess, isReportLoading, isReportError, isReportIdle, ReportState } from "./Dashboard.js";
import { authenticatedFetch, parseResponse, t, toNepaliNumerals } from "./api-utils.js";
import { ProjectReport, ProjectReportSchema } from "../shared/types.ts";

// No citation needed, this is internal code.
export class BriefManager {
    private dashboard: Dashboard;

    constructor(dashboard: Dashboard) {
        this.dashboard = dashboard;
        this.initReactivity();
    }

    private initReactivity() {
        this.dashboard.subscribe(
            ({ reportData, lang }) => this.render(reportData, lang),
            (state: DashboardState) => ({
                reportData: state.reportData,
                lang: state.lang
            })
        );
    }

    /**
     * Integrated Speech logic merged from SpeechEngine.ts
     */
    private synth = window.speechSynthesis;
    private currentUtterance: SpeechSynthesisUtterance | null = null;

    toggleReadAloud() {
        if (this.synth.speaking) {
            this.synth.cancel();
            this.dashboard.addToast("info", t("readAloudOff") || "Speech stopped");
            return;
        }

        const container = document.getElementById("ai-brief-text");
        if (!container) return;

        this.currentUtterance = new SpeechSynthesisUtterance(container.innerText);
        this.currentUtterance.lang = this.dashboard.state.lang === "ne" ? "ne-NP" : "en-US";

        this.currentUtterance.onstart = () => {
            this.dashboard.playUi("ping");
            document.getElementById("ai-read-btn")?.classList.add("active");
        };

        this.currentUtterance.onend = () => {
            document.getElementById("ai-read-btn")?.classList.remove("active");
        };

        this.synth.speak(this.currentUtterance);
    }

    private render(reportData: ReportState, lang: string) {
        const isLowData = localStorage.getItem("low-data") === "true";
        const briefCard = document.getElementById("ai-brief-card");
        const container = document.getElementById("ai-brief-text");
        if (!briefCard || !container) return;

        if (isLowData) {
            briefCard.style.display = "none";
            return;
        }

        if (isReportLoading(reportData) || isReportIdle(reportData)) {
            briefCard.style.display = "block";
            container.innerHTML = `
                <div class="skeleton-brief-line" style="width: 100%;"></div>
                <div class="skeleton-brief-line" style="width: 90%;"></div>
                <div class="skeleton-brief-line" style="width: 95%;"></div>
            `;
            return;
        }

        if (isReportError(reportData)) {
            briefCard.style.display = "block";
            container.innerText = reportData.message;
            return;
        }

        const summary = isReportSuccess(reportData) ? reportData.report.aiSummary : null;
        if (!summary?.brief) {
            if (isReportSuccess(reportData)) briefCard.style.display = "none";
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

        this.dashboard.typeText(container, briefText, true);

        // Actionable Insights (Badges)
        const highlightsContainer = document.getElementById("ai-highlights");
        if (highlightsContainer) {
            const hasCritical = (summary.criticalProjects?.length ?? 0) > 0;
            const hasExceeding = (summary.exceedingProjects?.length ?? 0) > 0;

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
                    ${summary.discrepancies.map((d) => `
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

    printAiBrief() {
        const lang = this.dashboard.state.lang;
        const now = new Date();
        const timestamp = now.toLocaleString(lang === 'ne' ? 'ne-NP' : 'en-US', {
            year: 'numeric', month: 'long', day: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });

        // Inject/Update timestamp in the signature container
        const sigContainer = document.getElementById("print-signature-container") as HTMLElement | null;
        if (sigContainer) {
            // Ensure the signature block exists or create it
            let sigBlock = sigContainer.querySelector(".signature-block") as HTMLElement | null;
            if (!sigBlock) {
                const newBlock = document.createElement("div");
                newBlock.className = "signature-block";
                sigContainer.appendChild(newBlock);
                sigBlock = newBlock;
            }

            // Add the seal image (prepended to the signature block)
            let sealEl = sigBlock.querySelector(".signature-seal") as HTMLImageElement | null;
            if (!sealEl) {
                sealEl = document.createElement("img");
                sealEl.className = "signature-seal";
                // Using insertAdjacentElement to avoid type collision with 
                // Cloudflare Worker's Element.prepend signature.
                (sigBlock as HTMLElement).insertAdjacentElement('afterbegin', sealEl);
            }
            sealEl.src = "/icons/logo.png"; // Path to your seal image

            // Add/Update QR code (appended to the signature block)
            let qrEl = sigBlock.querySelector(".signature-qr") as HTMLImageElement | null;
            if (!qrEl) {
                qrEl = document.createElement("img");
                qrEl.className = "signature-qr";
                (sigBlock as HTMLElement).appendChild(qrEl);
            }
            const reportDate = isReportSuccess(this.dashboard.state.reportData)
                ? this.dashboard.state.reportData.report.lastUpdate
                : null;
            const qrUrl = reportDate
                ? `${window.location.origin}?date=${reportDate}&lang=${lang}`
                : window.location.origin;
            qrEl.src = `https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=${encodeURIComponent(qrUrl)}`;

            // Add/Update timestamp (appended to the signature block)
            let tsEl = sigBlock.querySelector(".signature-timestamp");
            if (!tsEl) {
                tsEl = document.createElement("div");
                tsEl.className = "signature-timestamp";
                sigBlock.appendChild(tsEl);
            }
            tsEl.textContent = `${t("printedOn") || (lang === 'ne' ? 'मुद्रण समय:' : 'Printed on:')}: ${lang === 'ne' ? toNepaliNumerals(timestamp) : timestamp}`;
        }

        document.body.classList.add("print-memo-only");
        if (this.dashboard.state.clientConfig?.digitalSignatureEnabled) {
            document.body.classList.add("show-digital-signature");
        }
        window.print();
        window.addEventListener('afterprint', () => {
            document.body.classList.remove("print-memo-only");
            document.body.classList.remove("show-digital-signature");
        }, { once: true });
    }

    async copyAiBrief() {
        const text = (document.getElementById("ai-brief-text") as HTMLElement)?.innerText;
        if (!text) {
            this.dashboard.addToast("info", t("noTextToCopy") || "No text to copy.");
            return;
        }
        try {
            await navigator.clipboard.writeText(text);
            this.dashboard.addToast("success", t("briefCopied") || "Brief copied to clipboard!");
        } catch (_err) {
            this.dashboard.addToast("error", t("copyFailed") || "Failed to copy brief.");
        }
    }

    async share() {
        const text = (document.getElementById("ai-brief-text") as HTMLElement)?.innerText || "";
        if (navigator.share) {
            try {
                await navigator.share({
                    title: "DOR Progress Dashboard - Executive Briefing",
                    text: text,
                });
            } catch (_err) {
                console.log("Share cancelled or failed", _err);
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
            const json = (await parseResponse(res, ProjectReportSchema)) as ProjectReport;
            if (json?.aiSummary?.brief) {
                this.dashboard.typeText(
                    document.getElementById("ai-brief-text")!,
                    json.aiSummary.brief,
                    true,
                );
            }
        } catch {
            this.dashboard.addToast("error", this.dashboard.state.lang === "en" ? "Failed" : "असफल");
            const briefText = this.dashboard.state.lang === "en"
                ? "CRITICAL ERROR: DATA STREAM CORRUPTED..."
                : "गंभीर त्रुटि: डाटा स्ट्रिममा समस्या आयो...";
            const container = document.getElementById("ai-brief-text");
            if (container) this.dashboard.typeText(container, briefText, true, true);
        } finally {
            if (btn) btn.classList.remove("spinning");
        }
    }

    async downloadAudio() {
        this.dashboard.addToast("info", "Audio download is not available in online mode.");
    }

    async shareAudio() {
        this.dashboard.addToast("info", "Audio sharing is not available in online mode.");
    }
}
