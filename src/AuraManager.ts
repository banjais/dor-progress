import { Dashboard } from "./Dashboard";
import { typeText, t } from "./api-utils";
// No citation needed, this is internal code.
/**
 * Manages the AI Intent Sensing (Mind-Reading Effect) UI.
 */
export class AuraManager {
    private dashboard: Dashboard;
    private intentTimer: number | null = null;

    constructor(dashboard: Dashboard) {
        this.dashboard = dashboard;
        this.init();
    }

    private init() {
        document.addEventListener("mousemove", (e: MouseEvent) => this.handleMouseMove(e));
    }

    private handleMouseMove(e: MouseEvent) {
        const aura = document.getElementById("ai-aura");
        const auraText = document.getElementById("aura-text") as HTMLElement;
        const auraGlow = aura ? aura.querySelector(".aura-glow") : null;
        const auraHalo = aura ? aura.querySelector(".aura-halo") : null;
        if (!aura || !auraGlow || !auraHalo) return;

        aura.style.left = e.clientX + "px";
        aura.style.top = e.clientY + "px";
        const target = e.target as HTMLElement;
        aura.style.opacity = target.closest("button, .kpi-card, tr, .data-card") ? "1" : "0.4";

        const kpi = target.closest(".kpi-card") as HTMLElement;
        if (kpi) {
            const title = kpi.innerText.toLowerCase();
            if (title.includes("attention") || title.includes("ध्यान")) {
                typeText(auraText, t("auraAnalyzing"));
                if (!auraHalo.classList.contains("critical"))
                    this.dashboard.playUi("alert");
                auraGlow.classList.add("pulsing");
                auraHalo.classList.add("critical");

                // Calculate dynamic intensity: higher risk = faster, wider glitch
                const offset = 1 + this.dashboard.state.riskLevel * 5;
                const duration = 0.15 - this.dashboard.state.riskLevel * 0.1;
                if (auraText) {
                    auraText.style.setProperty("--glitch-offset", `${offset}px`);
                    auraText.style.setProperty("--glitch-dur", `${duration}s`);
                    auraText.classList.add("glitch");
                }

                // Expand halo based on risk
                (auraHalo as HTMLElement).style.setProperty("--halo-scale", String(1 + this.dashboard.state.riskLevel * 1.5));

                if (!this.intentTimer)
                    this.intentTimer = window.setTimeout(() => {
                        this.dashboard.handleSearch("critical");
                        typeText(auraText, t("auraIsolated"));
                    }, 1000);
            } else if (title.includes("met") || title.includes("पूरा")) {
                typeText(auraText, t("auraTracing"));
                auraGlow.classList.remove("pulsing");
                auraHalo.classList.remove("critical");
                if (auraText) auraText.classList.remove("glitch");
                (auraHalo as HTMLElement).style.setProperty("--halo-scale", "1");
                if (!this.intentTimer)
                    this.intentTimer = window.setTimeout(() => {
                        this.dashboard.handleSearch("good");
                        typeText(auraText, t("auraFiltered"));
                    }, 1000);
            }
        } else {
            if (auraGlow) auraGlow.classList.remove("pulsing");
            if (auraHalo) auraHalo.classList.remove("critical");
            if (auraText) {
                typeText(auraText, t("auraText"));
                auraText.classList.remove("glitch");
            }
            if (auraHalo) (auraHalo as HTMLElement).style.setProperty("--halo-scale", "1");
            if (this.intentTimer) {
                clearTimeout(this.intentTimer);
                this.intentTimer = null;
            }
        }
    }
}