import { Dashboard } from "../Dashboard.js";
import { animateCounter } from "../api-utils.js";
import { BrandingEngine } from "./BrandingEngine.js";

export class SplashScreen {
  public static readyToEnter = false; // Made public for SplashParticles to access

  static init(dashboard: Dashboard) {
    // Removed: No video required
    this.addSkipButton(dashboard);
    // Removed: Not needed with smaller logo
    // Removed: No audio required
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
    if (fill) {
      fill.style.transition = "height 0.8s cubic-bezier(0.4, 0, 0.2, 1)";
      fill.style.height = `${percent}%`;
    }
    if (text) {
      animateCounter(text, percent, true);
      if (percent === 100) {
        text.classList.add("ready-pulse");
      } else {
        text.classList.remove("ready-pulse");
      }
    }

    // Ensure the loader container is visible when progress updates
    const loaderContainer = document.querySelector(".splash-loader-container");
    if (loaderContainer && percent > 0) {
      loaderContainer.classList.add("visible");
    } else if (loaderContainer && percent === 0) {
      loaderContainer.classList.remove("visible");
    }
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
      // dashboard.resumeAudioContext(); // Disabled: No audio required
      // dashboard.startMusic("/audio/ambient_track.mp3"); // Disabled: No audio required
      this.hide(true);
    });
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

  static getGreetingKey(): string {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) return "welcomeMorning";
    if (hour >= 12 && hour < 17) return "welcomeAfternoon";
    if (hour >= 17 && hour < 21) return "welcomeEvening";
    return "welcomeNight";
  }
}
