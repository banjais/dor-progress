import { Dashboard } from "./Dashboard.js";
import { t } from "./api-utils.js";

export class TimerManager {
    private dashboard: Dashboard;
    private interval: number | null = null;
    private counter: number = 60; // Initial countdown value
    private isPaused: boolean = false; // Tracks if the timer is currently paused

    constructor(dashboard: Dashboard) {
        this.dashboard = dashboard;
        this.start();
    }

    /**
     * Starts or restarts the auto-refresh countdown.
     */
    start() {
        this.stop();
        this.interval = window.setInterval(() => {
            this.counter--;
            if (this.counter <= 0) {
                this.counter = 60;
                void this.dashboard.loadData();
            }
            this.updateUI();
        }, 1000);
    }

    /**
     * Stops the active timer interval.
     */
    stop() {
        if (this.interval) {
            window.clearInterval(this.interval);
            this.interval = null;
        }
    }

    /**
     * Pauses the timer countdown.
     */
    pause() {
        this.isPaused = true;
        this.stop();
        this.updateUI();
    }

    /**
     * Resumes the timer countdown.
     */
    resume() {
        if (this.isPaused) {
            this.isPaused = false;
            this.start();
        }
    }

    private updateUI() {
        const timerEl = document.getElementById("refresh-timer");
        if (timerEl) {
            timerEl.innerText = this.isPaused
                ? `(${t("paused") || "paused"})`
                : `(${t("refreshing")} ${this.counter}${t("sec")})`;
        }

        // Update the human-readable relative time string (e.g., "Last updated 5 mins ago")
        const relTimeEl = document.getElementById("last-fetch-relative");
        if (relTimeEl) {
            relTimeEl.innerText = this.dashboard.getRelativeTimeString();
        }
    }
}