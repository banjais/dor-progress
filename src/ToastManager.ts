/// <reference lib="dom" />

import { AudioEngine } from "./components/AudioEngine";
import { Dashboard } from "./Dashboard"; // For accessing dashboard.state.lang and t()

export class ToastManager {
    private audio: AudioEngine;
    private dashboard: Dashboard; // Reference to dashboard for lang and t()
    private syncToast: HTMLDivElement | null = null;

    constructor(audioEngine: AudioEngine, dashboardInstance: Dashboard) {
        this.audio = audioEngine;
        this.dashboard = dashboardInstance;
        this.initToastContainer();
    }

    private initToastContainer() {
        let container = document.getElementById("toast-container") as HTMLElement | null;
        if (!container) {
            container = document.createElement("div");
            container.id = "toast-container";
            document.body.appendChild(container);
        }

        let dismissAllBtn = document.getElementById("dismiss-all") as HTMLElement | null;
        if (!dismissAllBtn) {
            dismissAllBtn = document.createElement("button");
            dismissAllBtn.id = "dismiss-all";
            dismissAllBtn.className = "dismiss-all-btn"; // Add a class for styling
            // Using dashboard.t() for translation, assuming it's available early enough
            dismissAllBtn.innerText = this.dashboard.t("dismissAll") || "Dismiss All";
            dismissAllBtn.style.display = "none"; // Hidden by default
            dismissAllBtn.onclick = () => this.dismissAllToasts();
            container.insertBefore(dismissAllBtn, container.firstChild); // Add it before toasts
        }
    }

    addToast(
        type: "success" | "info" | "error",
        message: string,
        duration = 4000,
    ): HTMLDivElement {
        this.audio.playUi("pop");
        const container = document.getElementById("toast-container") as HTMLElement | null;
        const dismissAllBtn = document.getElementById("dismiss-all") as HTMLElement | null;
        if (!container || !dismissAllBtn) return document.createElement("div");

        const toast = document.createElement("div");
        toast.className = `toast ${type}`;
        const isSyncing = duration === -1;
        const isPersistent = duration === 0 || isSyncing;

        const icons: Record<string, string> = {
            success: "✅",
            info: "ℹ️",
            error: "❌",
        };
        toast.innerHTML = `
            <span>${icons[type] || ""}</span>
            <span>${message}</span>
            ${isSyncing
                ? `
                <div class="toast-progress">
                    <div class="toast-bar" style="width: 100%; animation: toast-progress-loop 2s infinite ease-in-out;"></div>
                </div>`
                : isPersistent
                    ? ""
                    : `
                <div class="toast-progress">
                    <div class="toast-bar" style="animation-duration:${duration}ms"></div>
                </div>`
            }
        `;

        const bar = toast.querySelector(".toast-bar") as HTMLElement;
        const dismiss = () => {
            if (toast.dataset.dismissing) return;
            toast.dataset.dismissing = "true";
            toast.style.animation = "toast-in 0.3s ease-in reverse forwards";
            setTimeout(() => {
                toast.remove();
                const remaining = container.querySelectorAll(".toast");
                if (remaining.length === 0 && dismissAllBtn) {
                    dismissAllBtn.style.display = "none";
                }
                if (toast === this.syncToast) this.syncToast = null;
            }, 300);
        };

        let autoDismissId: number | null = isPersistent ? null : window.setTimeout(dismiss, duration);
        toast.onmouseenter = () => { if (autoDismissId) window.clearTimeout(autoDismissId); };
        toast.onmouseleave = () => { if (toast.getAttribute("data-dismissing") || isPersistent) return; if (bar) bar.style.animation = "none"; void toast.offsetWidth; if (bar) bar.style.animation = `toast-progress-shrink ${duration}ms linear forwards`; autoDismissId = window.setTimeout(dismiss, duration); };
        toast.onclick = () => { if (autoDismissId) window.clearTimeout(autoDismissId); dismiss(); };
        container.insertBefore(toast, container.firstChild);
        if (container.querySelectorAll(".toast").length > 1 && dismissAllBtn) { dismissAllBtn.style.display = "block"; }
        return toast;
    }

    dismissAllToasts() {
        const container = document.getElementById("toast-container");
        if (container) {
            (container.querySelectorAll(".toast") as NodeListOf<HTMLElement>).forEach((toast) => {
                if (!toast.dataset.dismissing) {
                    toast.dataset.dismissing = "true";
                    toast.style.animation = "toast-in 0.3s ease-in reverse forwards";
                    setTimeout(() => toast.remove(), 300);
                }
            });
        }
        const dismissAllBtn = document.getElementById("dismiss-all");
        if (dismissAllBtn) dismissAllBtn.style.display = "none";
        this.syncToast = null;
    }
}