import { initializeApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "firebase/app-check";
import { Dashboard } from "./Dashboard.js";
import { parseResponse, authenticatedFetch } from "./api-utils.js";
import { BrandingEngine } from "./components/BrandingEngine.js";
import { ClientConfig, ClientConfigSchema } from "../shared/types.js";

export class BootstrapManager {
    static async init(dashboard: Dashboard) {
        // Apply UI branding immediately so the app looks correct during load
        const safeWorkerBase = typeof WORKER_BASE !== "undefined" ? WORKER_BASE : "";

        // Diagnostic log to verify build-time injection
        console.info(`[System] Initializing with WORKER_BASE: "${safeWorkerBase}"`);

        try {
            // Apply UI branding inside try-catch to prevent initialization blocks
            try { BrandingEngine.apply(); } catch (e) { console.warn("Branding failed to apply", e); }

            this.initLowData();
            this.initParallaxEffect(dashboard); // Initialize parallax effect
            this.initParticles(dashboard); // Initialize background particles
            this.addSkipButton(dashboard); // Add the skip button
            this.handleSplashVideo();
            this.updateSplashProgress(10);

            const configPath = "/api/client-config";

            // 1. Fetch Configuration & Init System Shell
            const res = await authenticatedFetch(configPath);
            this.updateSplashProgress(40);

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
            dashboard.appCheck = initializeAppCheck(app, {
                provider: new ReCaptchaEnterpriseProvider(
                    config.recaptchaKey || ""
                ),
                isTokenAutoRefreshEnabled: true,
            });

            // 4. Initial State Setup
            dashboard.setLang(dashboard.state.lang);
            void dashboard.onVerify?.();
            this.updateSplashProgress(90);

            // 4. Reveal App Early
            // We hide splash here so the user sees the dashboard skeleton/loading state
            // instead of a static splash screen while waiting for the actual report data.
            this.hideSplash();

            // 5. Load Content
            this.updateSplashProgress(100);
            await dashboard.loadData();
        } catch (e) {
            console.error("Critical Bootstrap Failure:", e);
            let msg = e instanceof Error ? e.message : String(e);

            // Enhance error message for common configuration issues
            if (msg.includes("Routing Error: Received HTML instead of JSON") || msg.includes("not found (404)")) {
                msg += " Please ensure WORKER_BASE is correctly configured to your Cloudflare Worker URL and that the worker is deployed and routing requests properly.";
                console.error("ACTION REQUIRED: Check WORKER_BASE configuration and Cloudflare Worker deployment.");
            }

            this.hideSplash(); // Ensure splash is hidden so user can see the error toast
            dashboard.addToast(
                "error",
                `${dashboard.t("bootError") || "System failed to initialize"}: ${msg.split(" (Status:")[0]}`, // Trim status for toast
                0
            );
        } finally {
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

    private static updateSplashProgress(percent: number) {
        const fill = document.getElementById("loader-bar-fill");
        const text = document.getElementById("loader-percentage");
        if (fill) {
            fill.style.height = `${percent}%`;
        }
        if (text) text.innerText = `${percent}%`;
    }

    private static handleSplashVideo() {
        const video = document.querySelector(".splash-video") as HTMLVideoElement;
        if (video) {
            video.play().catch(() => {
                // Autoplay may be blocked by browser policy until user interaction
                console.warn("[System] Splash video autoplay blocked or unavailable.");
            });
        }
    }

    private static addSkipButton(dashboard: Dashboard) {
        const splashScreen = document.getElementById("splash-screen");
        if (!splashScreen) return;

        const skipButton = document.createElement("button");
        skipButton.id = "splash-skip-btn";
        skipButton.className = "splash-skip-btn";
        skipButton.innerText = dashboard.t("skip") || "Skip"; // Use translation for "Skip"
        splashScreen.appendChild(skipButton);

        skipButton.addEventListener("click", () => {
            this.hideSplash(true); // Pass true to indicate immediate hide
            // The dashboard.loadData() call in BootstrapManager.init() will still proceed,
            // ensuring the app loads correctly even if the splash is skipped early.
        });
    }

    /**
     * Adds a subtle parallax effect to the splash logo based on mouse movement.
     */
    private static initParallaxEffect(dashboard: Dashboard) {
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
    private static initParticles(dashboard: Dashboard) {
        const splashScreen = document.getElementById("splash-screen");
        if (!splashScreen) return;

        const canvas = document.createElement("canvas");
        canvas.className = "splash-particles";
        splashScreen.appendChild(canvas);

        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        // Pre-render a white glowing particle sprite on an offscreen canvas for performance
        const offscreen = document.createElement("canvas");
        offscreen.width = 32;
        offscreen.height = 32;
        const octx = offscreen.getContext("2d");

        const updateSpriteShape = () => {
            if (!octx) return;
            octx.clearRect(0, 0, 32, 32);
            octx.shadowBlur = 10;
            octx.shadowColor = "rgba(255, 255, 255, 1)";
            octx.fillStyle = "rgba(255, 255, 255, 1)";
            octx.beginPath();
            octx.arc(16, 16, 5, 0, Math.PI * 2);
            octx.fill();
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

        // Start the background hum when particles begin
        dashboard.startHum();

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
        });

        const animate = () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);

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


            // Draw subtle connecting lines between nearby particles
            // The effect becomes more visible as risk increases
            if (risk > 0.1) {
                ctx.lineWidth = 0.5;
                for (let i = 0; i < particles.length; i++) {
                    for (let j = i + 1; j < particles.length; j++) {
                        const p1 = particles[i];
                        const p2 = particles[j];
                        const dx = p1.x - p2.x;
                        const dy = p1.y - p2.y;
                        const dist = Math.sqrt(dx * dx + dy * dy);

                        // Only draw lines if particles are within 120 pixels
                        if (dist < 120) {
                            const opacity = (1 - dist / 120) * 0.2 * risk;
                            ctx.strokeStyle = `rgba(255, 255, 255, ${opacity})`;
                            ctx.beginPath();
                            ctx.moveTo(p1.x, p1.y);
                            ctx.lineTo(p2.x, p2.y);
                            ctx.stroke();
                        }
                    }
                }
            }

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