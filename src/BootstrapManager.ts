import { initializeApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaEnterpriseProvider, CustomProvider } from "firebase/app-check";
import { Dashboard } from "./Dashboard.js";
import { BrandingEngine } from "./components/BrandingEngine.js";
import { 
    parseResponse,
    authenticatedFetch,
    type ClientConfig, 
    ClientConfigSchema, 
    loadTranslations, 
    loadSheetsConfig
} from "./api-utils.js";

export class BootstrapManager {
    private static readyToEnter = false;

    static async init(dashboard: Dashboard) {
        // Force a browser paint of the splash screen before starting heavy initialization
        // This ensures Chrome users see the branding even if the CPU is pegged during boot.
        await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));

        // --- App Check Debug Mode Setup ---
        // This MUST be set before initializeApp or initializeAppCheck is called.
        const debugToken = import.meta.env.VITE_APP_CHECK_DEBUG_TOKEN || localStorage.getItem('debug_app_check');
        if (import.meta.env.DEV || debugToken) {
            // If VITE_APP_CHECK_DEBUG_TOKEN is defined in .env.local, use it. 
            // Otherwise, setting to true will generate a new token in the browser console.
            (self as any).FIREBASE_APPCHECK_DEBUG_TOKEN = (debugToken && debugToken !== "false") ? debugToken : true;
            
            console.warn("[App Check] Debug mode active. Token:", (self as any).FIREBASE_APPCHECK_DEBUG_TOKEN);
        }

        // Apply UI branding immediately so the app looks correct during load
        // Use Vite's injected environment variables for the client application.
        const safeWorkerBase = (globalThis as any).WORKER_BASE
            ? (globalThis as any).WORKER_BASE
            : (import.meta.env.VITE_WORKER_BASE || '');

        // Diagnostic log to verify build-time injection
        console.info(`[System] Initializing with WORKER_BASE: "${safeWorkerBase}"`);

        try {
            // Apply UI branding inside try-catch to prevent initialization blocks
            try { await BrandingEngine.apply(); } catch (e) { console.warn("Branding failed to apply", e); }
            try { await loadTranslations(); } catch (e) { console.warn("Translations failed to load", e); }
            try { await loadSheetsConfig(); } catch (e) { console.warn("Sheets config failed to load", e); }

            this.initLowData();
            this.handleSplashVideo();
            this.updateSplashProgress(10);
            this.updateStatusText(dashboard.t("loadingConfig") || "Loading configuration...");

            // Initialize splash screen enhancements
            this.addSkipButton(dashboard);
            this.initParallaxEffect(dashboard);
            this.initParticles(dashboard);

            const configPath = "api/client-config";

            // 1. Fetch Configuration & Init System Shell
            console.info(`[System] Fetching config from path: ${configPath}`);
            const res = await authenticatedFetch(configPath);
            this.updateSplashProgress(50);
            this.updateStatusText(dashboard.t("configLoaded") || "Configuration loaded.");

            if (!res.ok) {
                throw new Error(`${dashboard.t("serverError") || "Server unavailable"} (${res.status})`);
            }
            if (res.headers.get("content-type")?.includes("text/html")) {
                throw new Error("Initialization Error: Expected JSON configuration but received HTML. Check your Cloudflare API route configuration.");
            }

            // 2. Validate Configuration with Zod
            const config: ClientConfig = await parseResponse(res, ClientConfigSchema);
            dashboard.state.clientConfig = config;

            // 3. Initialize Firebase
            const app = initializeApp(config.firebase);
            this.updateSplashProgress(70);
            this.updateStatusText(dashboard.t("firebaseInit") || "Initializing Firebase...");

            // --- App Check Initialization with Fallback ---
            let appCheckProvider;
            if (config.recaptchaKey) {
                try {
                    appCheckProvider = new ReCaptchaEnterpriseProvider(config.recaptchaKey);
                    console.info("[App Check] ReCAPTCHA Enterprise provider initialized.");
                } catch (e) {
                    console.error("[App Check] Failed to initialize ReCAPTCHA Enterprise provider, falling back to CustomProvider:", e);
                    dashboard.addToast("error", dashboard.t("recaptchaFailed") || "Security verification failed. Functionality may be limited.", 0);
                    dashboard.state.appCheckFallbackMode = true; // Set fallback flag
                    appCheckProvider = new CustomProvider({
                        getToken: async () => { // Fix: Return empty string for token
                            console.warn("[App Check] Using CustomProvider fallback: returning empty token.");
                            return { token: '', expireTimeMillis: Date.now() + 300000 }; // 5 minutes validity for dummy
                        }
                    });
                }
            } else {
                console.warn("[App Check] No reCAPTCHA key provided, falling back to CustomProvider.");
                dashboard.addToast("error", dashboard.t("recaptchaMissingKey") || "Security verification key missing. Functionality may be limited.", 0);
                dashboard.state.appCheckFallbackMode = true; // Set fallback flag
                appCheckProvider = new CustomProvider({
                    getToken: async () => { // Fix: Return empty string for token
                        console.warn("[App Check] Using CustomProvider fallback (no key): returning empty token.");
                        return { token: '', expireTimeMillis: Date.now() + 300000 };
                    }
                });
            }

            // Indicate that the app is ready to enter
            BootstrapManager.readyToEnter = true;
            this.updateSplashProgress(100);
            this.updateStatusText(dashboard.t("ready") || "Ready!", true);

            dashboard.appCheck = initializeAppCheck(app, {
                provider: appCheckProvider,
                isTokenAutoRefreshEnabled: true,
            });
            // --- End App Check Initialization with Fallback ---

        } catch (e) {
            console.error("Critical Bootstrap Failure:", e); // Keep original error logging

            let msg = "";
            if (e instanceof Error) { // Improved error extraction
                msg = e.message; // Use the message property of the Error object
            } else if (typeof e === "object" && e !== null) {
                const errObj = e as any;
                msg = errObj.message || errObj.code || JSON.stringify(e);
            } else {
                msg = String(e);
            }

            // Enhance error message for common configuration issues
            if (msg.includes("Routing Error: Received HTML instead of JSON") || msg.includes("not found (404)")) {
                msg += " Please ensure WORKER_BASE is correctly configured to your Cloudflare Worker URL and that the worker is deployed and routing requests properly.";
                console.error("ACTION REQUIRED: Check WORKER_BASE configuration and Cloudflare Worker deployment.");
            } else if (msg.includes("403") || msg.includes("App Check")) {
                msg += " (App Check/Security verification failed. Check ReCAPTCHA configuration and authorized domains in Firebase Console.)";
                console.error("DEBUG: Firebase App Check 403. Verify ReCAPTCHA Enterprise keys and domain whitelisting.");
            } else if (msg.includes("Connection Refused") || msg.includes("Failed to fetch")) {
                msg += " (Local API connection failed. Is your local worker running?)";
                console.error("DEBUG: Failed to connect to local API. Ensure wrangler is active on port 8787.");
            }

            setTimeout(() => this.hideSplash(), 500); // Ensure splash is hidden so user can see the error toast

            let bootErrorLabel = "System failed to initialize";
            try {
                // Safely attempt translation, fallback to English
                bootErrorLabel = dashboard.t("bootError") || bootErrorLabel;
            } catch { /* ignored */ }

            dashboard.addToast(
                "error",
                `${bootErrorLabel}: ${msg.split(" (Status:")[0]}`,
                0
            );
        } finally {
            // BrandingEngine usually touches DOM, safe to call at end of bootstrap.
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

    private static updateSplashProgress(percent: number) {
        const fill = document.getElementById("loader-bar-fill");
        const text = document.getElementById("loader-percentage");
        if (fill) {
            fill.style.height = `${percent}%`;
        }
        if (text) text.innerText = `${percent}%`;
    }

    private static updateStatusText(text: string, highlight = false) { // Now used
        const status = document.querySelector(".loader-status");
        if (status) {
            (status as HTMLElement).innerText = text;
            if (highlight) (status as HTMLElement).classList.add("ready");
        }
    }

    private static handleSplashVideo() {
        const video = document.querySelector(".splash-video") as HTMLVideoElement;
        if (video) {
            video.muted = true; // Muted video is required for programmatic autoplay
            video.play().catch(() => {
                // Autoplay may be blocked by browser policy until user interaction
                console.warn("[System] Splash video autoplay blocked or unavailable.");
            });
        }
    }

    private static addSkipButton(dashboard: Dashboard) { // Now used
        const splashScreen = document.getElementById("splash-screen");
        if (!splashScreen) return;

        const skipButton = document.createElement("button");
        skipButton.id = "splash-skip-btn";
        skipButton.className = "splash-skip-btn";
        skipButton.innerText = dashboard.t("skip") || "Skip"; // Use translation for "Skip"
        splashScreen.appendChild(skipButton);

        skipButton.addEventListener("click", (e) => {
            e.stopPropagation(); // Prevent triggering the global splash click
            dashboard.startHum(); // Resume AudioContext on user gesture
            this.hideSplash(true); // Pass true to indicate immediate hide
            // The dashboard.loadData() call in BootstrapManager.init() will still proceed,
            // ensuring the app loads correctly even if the splash is skipped early.
        });
    }

    /**
     * Adds a subtle parallax effect to the splash logo based on mouse movement.
     */
    private static initParallaxEffect(dashboard: Dashboard) { // Now used
        const splashScreen = document.getElementById("splash-screen");
        const splashLogo = document.querySelector(".splash-logo-mini") as HTMLElement;

        if (!splashScreen || !splashLogo) return;

        const handleMouseMove = (e: MouseEvent) => {
            const rect = splashScreen.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;

            // Calculate offset from center, normalized to a small range
            const offsetX = (e.clientX - centerX) * 0.02; // Adjust multiplier for desired intensity
            const offsetY = (e.clientY - centerY) * 0.02; // Adjust multiplier for desired intensity

            // Apply parallax using CSS variables, which combine with the existing scale animation
            splashLogo.style.setProperty('--logo-translate-x', `${offsetX}px`);
            splashLogo.style.setProperty('--logo-translate-y', `${offsetY}px`);
        };

        splashScreen.addEventListener("mousemove", handleMouseMove);

        // Subtle glitch effect that triggers more frequently at high risk levels
        const updateGlitch = () => {
            const risk = dashboard.state.riskLevel;
            if (Math.random() < risk * 0.15) {
                splashLogo.classList.add("glitch");
                setTimeout(() => splashLogo.classList.remove("glitch"), 80 + Math.random() * 100);
            }
            requestAnimationFrame(updateGlitch);
        };
        updateGlitch();

        // Cleanup: remove event listener when splash screen is hidden
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.attributeName === "style" && (splashScreen as HTMLElement).style.display === "none") {
                    splashScreen.removeEventListener("mousemove", handleMouseMove);
                    observer.disconnect();
                }
            });
        });
        observer.observe(splashScreen, { attributes: true });
    }

    /**
     * Creates a subtle particle background on the splash screen using Canvas.
     */
    private static initParticles(dashboard: Dashboard) { // Now used
        const splashScreen = document.getElementById("splash-screen");
        if (!splashScreen) return;

        const canvas = document.createElement("canvas");
        canvas.className = "splash-particles";
        splashScreen.appendChild(canvas);

        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        // 1. Pre-render Sprites (Circle and Triangle)
        const offscreen = document.createElement("canvas");
        offscreen.width = 32;
        offscreen.height = 32;
        const octx = offscreen.getContext("2d");

        const offscreenTri = document.createElement("canvas");
        offscreenTri.width = 32;
        offscreenTri.height = 32;
        const octxTri = offscreenTri.getContext("2d");

        const updateSpriteShape = () => {
            if (!octx || !octxTri) return;
            // Circle Sprite
            octx.clearRect(0, 0, 32, 32);
            octx.shadowBlur = 10;
            octx.shadowColor = "rgba(255, 255, 255, 1)";
            octx.fillStyle = "rgba(255, 255, 255, 1)";
            octx.beginPath();
            octx.arc(16, 16, 5, 0, Math.PI * 2);
            octx.fill();

            // Triangle Sprite (for Critical State)
            octxTri.clearRect(0, 0, 32, 32);
            octxTri.shadowBlur = 10;
            octxTri.shadowColor = "rgba(255, 255, 255, 1)";
            octxTri.fillStyle = "rgba(255, 255, 255, 1)";
            octxTri.beginPath();
            octxTri.moveTo(16, 8);
            octxTri.lineTo(26, 24);
            octxTri.lineTo(6, 24);
            octxTri.closePath();
            octxTri.fill();
        };
        updateSpriteShape();

        let animationFrameId: number;
        const particles: { x: number; y: number; s: number; vx: number; vy: number; o: number; hueOffset: number; lightnessOffset: number }[] = [];
        const count = 50;

        const resize = () => {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
        };
        window.addEventListener("resize", resize);
        resize();

        for (let i = 0; i < count; i++) {
            particles.push({
                x: Math.random() * canvas.width,
                y: Math.random() * canvas.height,
                s: Math.random() * 2 + 1,
                vx: (Math.random() - 0.5) * 0.4,
                vy: (Math.random() - 0.5) * 0.4,
                o: Math.random() * 0.4 + 0.1,
                hueOffset: (Math.random() - 0.5) * 30, // Hue variance ±15deg
                lightnessOffset: (Math.random() - 0.5) * 0.12 // Lightness variance ±12%
            });
        }

        // Particle explosion on click
        splashScreen.addEventListener("click", (e: MouseEvent) => {
            // Start/Resume audio on first interaction to satisfy autoplay policies
            dashboard.startHum();

            particles.forEach(p => {
                const dx = p.x - e.clientX;
                const dy = p.y - e.clientY;
                const dist = Math.sqrt(dx * dx + dy * dy) || 1;

                // Radial force away from click position
                const power = 25;
                p.vx += (dx / dist) * power;
                p.vy += (dy / dist) * power;
            });
            // Use the pop sound for the tactile impact
            dashboard.playUi("pop");

            // Finalize entry if loading is complete
            if (BootstrapManager.readyToEnter) {
                BootstrapManager.hideSplash();
            }
        });

        const animate = () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            
            // 2. Sync with CSS Variables
            const computedStyle = getComputedStyle(document.documentElement);
            const primaryColor = computedStyle.getPropertyValue('--primary').trim();

            const risk = dashboard.state.riskLevel; // 0 to 1
            const speedMultiplier = 1 + risk * 4; // Move up to 5x faster as risk increases
            const centerX = canvas.width / 2;
            const centerY = canvas.height / 2;
            const isDarkMode = document.body.getAttribute("data-theme") === "dark";

            // Toggle critical grid pulse effect on the body element
            if (risk > 0.8 && isDarkMode) {
                document.body.classList.add("critical-grid-pulse");
            } else {
                document.body.classList.remove("critical-grid-pulse");
            }


            // 3. Optimized Connection Logic (Distance Squared)
            if (risk > 0.1) {
                ctx.lineWidth = 0.5;
                const limitSq = 14400; // 120 * 120
                for (let i = 0; i < particles.length; i++) {
                    for (let j = i + 1; j < particles.length; j++) {
                        const p1 = particles[i];
                        const p2 = particles[j];
                        const dx = p1.x - p2.x;
                        const dy = p1.y - p2.y;
                        const distSq = dx * dx + dy * dy;

                        if (distSq < limitSq) {
                            const opacity = (1 - Math.sqrt(distSq) / 120) * 0.2 * risk;
                            // Use the primary theme color for lines
                            ctx.strokeStyle = primaryColor.replace('rgb', 'rgba').replace(')', `, ${opacity})`);
                            if (!ctx.strokeStyle.includes('rgba')) ctx.strokeStyle = `rgba(255,255,255,${opacity})`;
                            
                            ctx.beginPath();
                            ctx.moveTo(p1.x, p1.y);
                            ctx.lineTo(p2.x, p2.y);
                            ctx.stroke();
                        }
                    }
                }
            }

            // 4. Hoist Base Color Calculation
            const baseR = Math.floor(255 - (255 - 239) * risk);
            const baseG = Math.floor(255 - (255 - 68) * risk);
            const baseB = Math.floor(255 - (255 - 68) * risk);

            // Calculate base HSL once per frame for better performance
            const [baseH, baseS, baseL] = BootstrapManager.rgbToHsl(baseR, baseG, baseB);

            particles.forEach(p => {
                // Accelerate towards the center if risk is high (gravity effect)
                if (risk > 0.4) {
                    const dx = centerX - p.x;
                    const dy = centerY - p.y;
                    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
                    const pullStrength = risk * 0.015; // Subtle pull

                    p.vx += (dx / dist) * pullStrength;
                    p.vy += (dy / dist) * pullStrength;

                    // Apply light damping to keep the swarm contained
                    p.vx *= 0.99;
                    p.vy *= 0.99;
                }

                // Gentle friction to settle the particles after an explosion
                p.vx *= 0.98;
                p.vy *= 0.98;

                p.x = (p.x + p.vx * speedMultiplier + canvas.width) % canvas.width;
                p.y = (p.y + p.vy * speedMultiplier + canvas.height) % canvas.height;

                // Apply unique variance to the base color
                const h = (baseH + p.hueOffset + 360) % 360;
                const l = Math.max(0, Math.min(1, baseL + p.lightnessOffset));
                const [r, g, b] = BootstrapManager.hslToRgb(h, baseS, l);

                ctx.globalAlpha = p.o;
                const size = p.s * 4;

                ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
                ctx.beginPath();
                if (risk > 0.7) {
                    // Morph to Triangles in critical state
                    // Point triangles in the direction of velocity for an "aggressive" feel
                    const angle = Math.atan2(p.vy, p.vx);
                    const triSize = p.s * 1.5; // Slightly larger for visual presence
                    ctx.moveTo(p.x + Math.cos(angle) * triSize, p.y + Math.sin(angle) * triSize);
                    ctx.lineTo(p.x + Math.cos(angle + 2.3) * triSize, p.y + Math.sin(angle + 2.3) * triSize);
                    ctx.lineTo(p.x + Math.cos(angle - 2.3) * triSize, p.y + Math.sin(angle - 2.3) * triSize);
                    ctx.closePath();
                } else {
                    ctx.arc(p.x, p.y, p.s, 0, Math.PI * 2);
                }
                ctx.fill();

                // Overlay the pre-rendered white glow sprite for the core bloom effect
                ctx.globalAlpha = p.o * 0.6;
                ctx.drawImage(offscreen, p.x - size / 2, p.y - size / 2, size, size);
            });
            ctx.globalAlpha = 1.0;
            animationFrameId = requestAnimationFrame(animate);
        };
        animate();

        // Cleanup: Stop animation and remove canvas when splash is hidden
        const observer = new MutationObserver(() => {
            if (splashScreen.style.display === "none") {
                cancelAnimationFrame(animationFrameId);
                window.removeEventListener("resize", resize);
                canvas.remove();
                observer.disconnect();
            }
        });
        observer.observe(splashScreen, { attributes: true });
    }

    private static hideSplash(immediate = false) {
        const splash = document.getElementById("splash-screen");
        if (splash) {
            Dashboard.getInstance().stopHum(); // Stop the hum synth
            splash.style.opacity = "0"; // Always fade out
            BrandingEngine.finalizeFavicon();
            BrandingEngine.finalizeThemeColor();
            setTimeout(() => (splash.style.display = "none"), immediate ? 100 : 800); // Shorter timeout for immediate hide
        }
    }

    // --- Helper functions for RGB <-> HSL conversion ---

    private static rgbToHsl(r: number, g: number, b: number): [number, number, number] {
        r /= 255;
        g /= 255;
        b /= 255;

        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        let h = 0;
        let s = 0;
        const l = (max + min) / 2;

        if (max !== min) {
            const d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            switch (max) {
                case r: h = (g - b) / d + (g < b ? 6 : 0); break;
                case g: h = (b - r) / d + 2; break;
                case b: h = (r - g) / d + 4; break;
            }
            h /= 6;
        }

        return [h * 360, s, l];
    }

    private static hslToRgb(h: number, s: number, l: number): [number, number, number] {
        let r, g, b;
        h /= 360;

        if (s === 0) { r = g = b = l; } else {
            const hue2rgb = (p: number, q: number, t: number) => {
                if (t < 0) t += 1;
                if (t > 1) t -= 1;
                if (t < 1 / 6) return p + (q - p) * 6 * t;
                if (t < 1 / 2) return q;
                if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
                return p;
            };
            const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
            const p = 2 * l - q;
            r = hue2rgb(p, q, h + 1 / 3);
            g = hue2rgb(p, q, h);
            b = hue2rgb(p, q, h - 1 / 3);
        }

        return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
    }
}