import { initializeApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "firebase/app-check";
import { z } from "zod";
import { Dashboard } from "./Dashboard";
import { parseResponse } from "./api-utils";
import { BrandingEngine } from "./components/BrandingEngine";

const ClientConfigSchema = z.object({
    firebase: z.object({
        apiKey: z.string(),
        authDomain: z.string(),
        projectId: z.string(),
        storageBucket: z.string(),
        messagingSenderId: z.string(),
        appId: z.string(),
        measurementId: z.string().optional(),
    }),
    recaptchaKey: z.string().optional(),
    RECAPTCHA_SITE_KEY: z.string().optional(),
});

export class BootstrapManager {
    static async init(dashboard: Dashboard) {
        // Apply UI branding immediately so the app looks correct during load
        BrandingEngine.apply();

        this.initLowData();

        try {
            // 1. Fetch Remote Client Configuration
            const res = await fetch(`${WORKER_BASE}/api/client-config`);
            if (!res.ok) {
                throw new Error(`${dashboard.t("serverError") || "Server unavailable"} (${res.status})`);
            }

            // 2. Validate Configuration with Zod
            const config = await parseResponse(res, ClientConfigSchema);

            // 3. Initialize Firebase
            const app = initializeApp(config.firebase);
            dashboard.appCheck = initializeAppCheck(app, {
                provider: new ReCaptchaEnterpriseProvider(
                    config.recaptchaKey || config.RECAPTCHA_SITE_KEY || ""
                ),
                isTokenAutoRefreshEnabled: true,
            });

            // 4. Initial State Setup
            dashboard.setLang(dashboard.state.lang);
            void dashboard.onVerify?.();

            // 5. Initial Data Load
            await dashboard.loadData();
        } catch (e) {
            console.error("Critical Bootstrap Failure:", e);
            const msg = e instanceof Error ? e.message : String(e);
            dashboard.addToast(
                "error",
                `${dashboard.t("bootError") || "System failed to initialize"}: ${msg}`,
                0
            );
        } finally {
            this.hideSplash();
            // BrandingEngine usually touches DOM, safe to call at end of bootstrap
            // Note: Dashboard.ts context showed BrandingEngine.apply() was called in Dashboard.init
        }
    }

    private static initLowData() {
        if (localStorage.getItem("low-data") === null) {
            if ((navigator as any).connection?.saveData) {
                localStorage.setItem("low-data", "true");
            }
        }
    }

    private static hideSplash() {
        const splash = document.getElementById("splash-screen");
        if (splash) {
            splash.style.opacity = "0";
            setTimeout(() => (splash.style.display = "none"), 800);
        }
    }
}