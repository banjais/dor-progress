import { Dashboard } from "./Dashboard.js";
import { BrandingEngine } from "./components/BrandingEngine.js";

export class ThemeManager {
    private dashboard: Dashboard;
    private originalTheme: string; // Tracks the theme before a temporary hover change

    constructor(dashboardInstance: Dashboard) {
        this.dashboard = dashboardInstance;
        this.originalTheme = "light"; // Default, will be set by init()
        this.init();
    }

    private init() {
        const startingTheme =
            localStorage.getItem("theme") ||
            (window.matchMedia("(prefers-color-scheme: dark)").matches
                ? "dark"
                : "light");
        this.applyTheme(startingTheme);
        this.originalTheme = startingTheme;
    }

    applyTheme(theme: string, persist = true) {
        document.body.setAttribute("data-theme", theme);
        const isDark = theme === "dark";
        const color = isDark ? BrandingEngine.getBrandedDarkColor() : BrandingEngine.getBrandedColor();
        const brandedPrimary = BrandingEngine.getBrandedColor();

        // Sync the CSS variables with the branded configuration
        if (isDark) {
            document.documentElement.style.setProperty("--bg", color);
            document.documentElement.style.removeProperty("--primary"); // Allow CSS to use the dark-mode primary default
        } else {
            document.documentElement.style.removeProperty("--bg");
            document.documentElement.style.setProperty("--primary", brandedPrimary);
        }

        document
            .querySelectorAll('meta[name="theme-color"]')
            .forEach((meta) => ((meta as HTMLMetaElement).content = color));
        if (persist) {
            localStorage.setItem("theme", theme);
            this.originalTheme = theme;
        }
        // Update modal UI elements if they exist (e.g., in settings)
        document.querySelectorAll(".theme-option").forEach((opt) => {
            opt.classList.toggle("active", (opt as HTMLElement).dataset.theme === theme);
        });
        return this.originalTheme;
    }

    revertTheme() {
        return this.applyTheme(this.originalTheme, false);
    }

    resetThemeToSystem() {
        localStorage.removeItem("theme");
        const isDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
        const systemTheme = isDark ? "dark" : "light";
        this.applyTheme(systemTheme, false);
        this.originalTheme = systemTheme; // Ensure revertTheme tracks the system state
        this.dashboard.addToast(
            "info",
            this.dashboard.t("themeResetToSystem"), // Use translation key
        );
    }

    toggleTheme() {
        const current = document.body.getAttribute("data-theme") || "light";
        this.applyTheme(current === "dark" ? "light" : "dark");
    }
}