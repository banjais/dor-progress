import { Dashboard } from "../Dashboard.js";
import { BrandingEngine } from "./BrandingEngine.js";

export class SplashScreen {
  public static readyToEnter = false; // Made public for SplashParticles to access

  static init(dashboard: Dashboard) {
    this.handleSplashVideo();
    this.addSkipButton(dashboard);
    this.initParallaxEffect(dashboard);
    this.initAudioPrompt(dashboard);
    this.initSignalIndicator(dashboard);

    // Dynamically import and initialize SplashParticles
    import("./SplashParticles.js")
      .then(({ SplashParticles }) => {
        const splashScreenElement = document.getElementById("splash-screen");
        if (splashScreenElement) {
          new SplashParticles(dashboard, splashScreenElement);
        }
      })
      .catch((err) => console.error("Failed to load SplashParticles:", err));
  }

  static setReady() {
    this.readyToEnter = true;
    this.updateSplashProgress(100);
  }

  static updateSplashProgress(percent: number) {
    const fill = document.getElementById("loader-bar-fill");
    const text = document.getElementById("loader-percentage");
    if (fill) fill.style.height = `${percent}%`;
    if (text) text.innerText = `${percent}%`;
  }

  static updateStatusText(text: string, highlight = false) {
    const status = document.querySelector(".loader-status");
    if (status) {
      (status as HTMLElement).innerText = text;
      if (highlight) (status as HTMLElement).classList.add("ready");
    }
  }

  static hide(immediate = false) {
    const splash = document.getElementById("splash-screen");
    if (splash) {
      Dashboard.getInstance().stopMusic();
      // Reset any high-intensity static variables triggered during boot failure
      document.body.style.setProperty("--static-opacity", "0.03");
      document.body.style.setProperty("--noise-contrast", "120%");
      splash.style.opacity = "0";
      BrandingEngine.finalizeFavicon();
      BrandingEngine.finalizeThemeColor();
      setTimeout(() => (splash.style.display = "none"), immediate ? 100 : 800);
    }
  }

  /**
   * Triggers a high-intensity 'Signal Loss' effect using static noise.
   * Used to provide visceral feedback when critical system initialization fails.
   */
  static triggerSignalLoss() {
    const b = document.body.style;
    b.setProperty("--static-opacity", "0.95");
    b.setProperty("--noise-contrast", "800%");
    b.setProperty("--noise-brightness", "180%");
    b.setProperty("--noise-speed", "0.01s");

    Dashboard.getInstance().playUi("pop", true, 0.25); // Deep distortion crunch
  }

  private static handleSplashVideo() {
    const video = document.querySelector(".splash-video") as HTMLVideoElement;
    if (video) {
      video.muted = true;
      video
        .play()
        .catch(() => console.warn("[System] Splash video autoplay blocked."));
    }
  }

  private static addSkipButton(dashboard: Dashboard) {
    const splashScreen = document.getElementById("splash-screen");
    if (!splashScreen) return;

    const skipButton = document.createElement("button");
    skipButton.id = "splash-skip-btn";
    skipButton.className = "splash-skip-btn";
    skipButton.innerText = dashboard.t("skip") || "Skip";
    splashScreen.appendChild(skipButton);

    skipButton.addEventListener("click", (e) => {
      e.stopPropagation();
      dashboard.resumeAudioContext();
      dashboard.startMusic("/audio/ambient_track.mp3");
      this.hide(true);
    });
  }

  private static initAudioPrompt(dashboard: Dashboard) {
    const splashScreen = document.getElementById("splash-screen");
    if (!splashScreen) return;

    const prompt = document.createElement("div");
    prompt.className = "splash-audio-prompt";
    prompt.innerHTML = `<i>🔇</i> <span>${dashboard.t("clickToEnableSound") || "Click to enable sound"}</span>`;
    splashScreen.appendChild(prompt);

    dashboard.subscribe<{ suspended: boolean; broken: boolean }>(
      ({ suspended, broken }) => {
        if (suspended && !broken) prompt.classList.add("visible");
        else prompt.classList.remove("visible");
      },
      (state) => ({
        suspended: state.isAudioContextSuspended,
        broken: state.isAudioEngineBroken,
      }),
    );
  }

  private static initSignalIndicator(dashboard: Dashboard) {
    const splashScreen = document.getElementById("splash-screen");
    if (!splashScreen) return;

    const container = document.createElement("div");
    container.className = "splash-signal";
    container.innerHTML = `
            <div class="signal-label">LINK</div>
            <div class="signal-bars">
                <div class="signal-bar"></div><div class="signal-bar"></div>
                <div class="signal-bar"></div><div class="signal-bar"></div>
            </div>
        `;
    splashScreen.appendChild(container);

    dashboard.subscribe<number>(
      (strength) => {
        const bars = container.querySelectorAll(".signal-bar");
        const activeCount = Math.ceil(strength * 4);
        bars.forEach((bar, idx) => {
          const el = bar as HTMLElement;
          if (idx < activeCount) {
            el.classList.add("active");
            el.style.background =
              strength < 0.4
                ? "var(--critical)"
                : strength < 0.7
                  ? "var(--warning)"
                  : "var(--good)";
          } else {
            el.classList.remove("active");
            el.style.background = "";
          }
        });
        container.classList.toggle("glitch", strength < 0.4);
      },
      (state) => state.signalStrength,
    );
  }

  private static initParallaxEffect(dashboard: Dashboard) {
    const splashScreen = document.getElementById("splash-screen");
    const splashLogo = document.querySelector(
      ".splash-logo-mini",
    ) as HTMLElement;
    if (!splashScreen || !splashLogo) return;

    const handleMouseMove = (e: MouseEvent) => {
      const rect = splashScreen.getBoundingClientRect();
      const offsetX = (e.clientX - (rect.left + rect.width / 2)) * 0.02;
      const offsetY = (e.clientY - (rect.top + rect.height / 2)) * 0.02;
      splashLogo.style.setProperty("--logo-translate-x", `${offsetX}px`);
      splashLogo.style.setProperty("--logo-translate-y", `${offsetY}px`);
    };
    splashScreen.addEventListener("mousemove", handleMouseMove);

    const updateGlitch = () => {
      if (Math.random() < dashboard.state.riskLevel * 0.15) {
        splashLogo.classList.add("glitch");
        setTimeout(
          () => splashLogo.classList.remove("glitch"),
          80 + Math.random() * 100,
        );
      }
      requestAnimationFrame(updateGlitch);
    };
    updateGlitch();
  }

  static getGreetingKey(): string {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) return "welcomeMorning";
    if (hour >= 12 && hour < 17) return "welcomeAfternoon";
    if (hour >= 17 && hour < 21) return "welcomeEvening";
    return "welcomeNight";
  }
}
