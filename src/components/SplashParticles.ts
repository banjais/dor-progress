import { Dashboard } from "../Dashboard.js";
import { SplashScreen } from "./SplashScreen.js";

// Import SplashScreen to access its static members

export class SplashParticles {
  private dashboard: Dashboard;
  private splashScreenElement: HTMLElement;
  private splashLogo: HTMLElement | null;
  private canvas: HTMLCanvasElement;
  private animationFrameId: number | null = null;

  private mouseX = -1000;
  private mouseY = -1000;
  private observer!: MutationObserver;
  private worker: Worker;
  private idleTimer: number | null = null;
  private readonly IDLE_THRESHOLD = 5000; // 5 seconds
  private cleaned = false;

  constructor(dashboard: Dashboard, splashScreenElement: HTMLElement) {
    this.dashboard = dashboard;
    this.splashScreenElement = splashScreenElement;
    this.splashLogo = splashScreenElement.querySelector(".splash-logo-mini");

    this.canvas = document.createElement("canvas");
    this.canvas.className = "splash-particles";
    this.splashScreenElement.appendChild(this.canvas);

    // Set initial dimensions BEFORE transferring control to offscreen.
    // The width and height properties cannot be modified on the DOM element after transfer.
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;

    // Transfer Control to OffscreenCanvas for Worker-side rendering
    const offscreen = this.canvas.transferControlToOffscreen();

    this.worker = new Worker(
      new URL("../particles-worker.js", import.meta.url),
      { type: "module" },
    );
    this.worker.onmessage = this.handleWorkerMessage;

    this.worker.postMessage(
      {
        type: "INIT",
        data: {
          width: window.innerWidth,
          height: window.innerHeight,
          canvas: offscreen,
        },
      },
      [offscreen],
    ); // Transferable

    this.initListeners();
    this.resize();
    this.extractLogoTemplate();
    this.resetIdleTimer();
    this.animate();

    // Observe when the splash screen is hidden to clean up resources
    this.observer = new MutationObserver(() => {
      if (this.splashScreenElement.style.display === "none") {
        this.cleanup();
      }
    });
    this.observer.observe(this.splashScreenElement, { attributes: true });
  }
  private async extractLogoTemplate() {
    const img = new Image();
    // Use the same logo source as the branding engine
    img.src = "/logo.png";

    await new Promise((resolve) => (img.onload = resolve));

    const canvas = document.createElement("canvas");
    // Sample from a 100x100 grid for normalization.
    // This resolution is sufficient for 50 particles to pick up distinct colors.
    const size = 100;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(img, 0, 0, size, size);
    const imageData = ctx.getImageData(0, 0, size, size);
    const buffer = imageData.data.buffer;

    // Optimize payload by transferring the raw ArrayBuffer.
    // This moves the sampling computation to the worker thread and avoids expensive cloning.
    this.worker.postMessage(
      { type: "SET_LOGO_TEMPLATE", data: { buffer, size } },
      [buffer],
    );
  }

  private initListeners() {
    this.splashScreenElement.addEventListener(
      "mousemove",
      this.handleMouseMove,
    );
    this.splashScreenElement.addEventListener(
      "mouseleave",
      this.handleMouseLeave,
    );
    window.addEventListener("resize", this.resize);
    this.splashScreenElement.addEventListener("click", this.handleClick);
  }

  private resetIdleTimer() {
    if (this.idleTimer) {
      window.clearTimeout(this.idleTimer);
      // Turn off idle modes immediately on activity
      this.worker.postMessage({ type: "SET_SWARM", data: { active: false } });
      this.worker.postMessage({ type: "SET_VORTEX", data: { active: false } });
      this.worker.postMessage({ type: "SET_RAIN", data: { active: false } });
      this.worker.postMessage({ type: "SET_LENS", data: { active: false } });
      this.worker.postMessage({
        type: "SET_BLACK_HOLE",
        data: { active: false },
      });
      if (this.splashLogo) this.splashLogo.classList.remove("swarm-active");
    }

    this.idleTimer = window.setTimeout(() => {
      // Alternate between idle modes to keep the intro sequence engaging
      const mode = Math.random();
      // 20% chance for each idle behavior
      if (mode < 0.2)
        this.worker.postMessage({ type: "SET_VORTEX", data: { active: true } });
      else if (mode < 0.4)
        this.worker.postMessage({
          type: "SET_BLACK_HOLE",
          data: { active: true },
        });
      else if (mode < 0.6)
        this.worker.postMessage({ type: "SET_LENS", data: { active: true } });
      else if (mode < 0.8)
        this.worker.postMessage({ type: "SET_RAIN", data: { active: true } });
      else
        this.worker.postMessage({ type: "SET_SWARM", data: { active: true } });

      // Visual cue: add a subtle glow to the logo when swarm starts
      if (this.splashLogo) this.splashLogo.classList.add("swarm-active");
    }, this.IDLE_THRESHOLD);
  }

  private handleMouseMove = (e: MouseEvent) => {
    this.mouseX = e.clientX;
    this.mouseY = e.clientY;
    this.resetIdleTimer();
  };

  private handleMouseLeave = () => {
    this.mouseX = -1000;
    this.mouseY = -1000;
    // Don't reset timer on leave; being off the splash screen counts as idle
  };

  private resize = () => {
    // Use local constants to calculate current window size.
    // We only update the worker; the CSS (100% width/height) handles the element's layout.
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.worker.postMessage({
      type: "RESIZE",
      data: { width, height },
    });
  };

  private handleClick = (e: MouseEvent) => {
    // this.dashboard.resumeAudioContext(); // Disabled: No audio required
    // this.dashboard.startMusic("/audio/ambient_track.mp3"); // Disabled: No audio required
    this.worker.postMessage({
      type: "CLICK",
      data: { x: e.clientX, y: e.clientY },
    });
    this.resetIdleTimer();
    this.dashboard.playUi("pop");
    if (SplashScreen.readyToEnter) SplashScreen.hide();
  };

  private handleWorkerMessage = (e: MessageEvent) => {
    const { proximityIntensity, events, bassIntensity } = e.data;

    // Process events from worker (audio triggers disabled)
    events.forEach((evt: string) => {
      // No citation needed, this is internal code.
      if (evt === "playPop") {
        /* this.dashboard.playUi("pop", true, 2.5 + Math.random()); */
      }
      if (evt === "playShockwavePop") {
        /* this.dashboard.playUi("pop", true, 3.0 + Math.random() * 0.5); */
      } // High-pitched pop for rebirth
      if (evt === "playSplash") {
        /* this.dashboard.playUi("click", true, 2.0 + Math.random()); */
      } // Microscopic splash sound
      if (evt === "playShatter") {
        // No citation needed, this is internal code.
        // this.dashboard.triggerGlitch(); // Spikes global static/shake + plays crunch sound
        // Glitch effect is still visual, but audio is removed.
        this.dashboard.triggerGlitch();

        if (this.splashLogo) {
          this.splashLogo.classList.add("glitch");
          this.splashLogo.style.setProperty("--logo-scale", "1.4"); // Spiked scale
          setTimeout(() => {
            this.splashLogo?.classList.remove("glitch");
            this.splashLogo?.style.setProperty("--logo-scale", "1");
          }, 400);
        }
      }
    });

    if (this.splashLogo) {
      // Base values from particle proximity
      const currentGlowRadius = 15 + Math.min(35, proximityIntensity * 3);
      const currentBrightness = 1 + Math.min(1.5, proximityIntensity * 0.15);

      // Add bass intensity effect
      // Scale bassIntensity (0-1) to a suitable range for glow and brightness
      const bassGlowBoost = bassIntensity * 15; // Max 15px additional glow
      const bassBrightnessBoost = bassIntensity * 0.3; // Max 0.3 additional brightness

      this.splashLogo.style.setProperty(
        "--logo-glow-radius",
        `${currentGlowRadius + bassGlowBoost}px`,
      );
      this.splashLogo.style.setProperty(
        "--logo-brightness",
        `${currentBrightness + bassBrightnessBoost}`,
      );
    }
  };

  private animate = () => {
    // Kill the loop and worker if performance mode is enabled
    if (this.dashboard.state.performanceMode) {
      this.cleanup();
      return;
    }

    const bass = 0; // Initialize bass to 0 since audio processing is disabled
    // Audio processing disabled
    // const audioData = this.dashboard.audio.getAnalyserData();
    // let bass = 0;
    // if (audioData) {
    //   // Sample the first 4 frequency bins for high-precision bass/beat detection
    //   for (let i = 0; i < 4; i++) bass += audioData[i];
    //   bass = bass / 4 / 255; // Normalize to 0.0 - 1.0 range
    // }

    this.worker.postMessage({
      type: "INPUT",
      data: {
        mouseX: this.mouseX,
        mouseY: this.mouseY,
        risk: this.dashboard.state.riskLevel,
        bassIntensity: bass,
      },
    });
    this.worker.postMessage({ type: "UPDATE" });
    this.animationFrameId = requestAnimationFrame(this.animate);
  };

  private cleanup() {
    if (this.cleaned) return;
    this.cleaned = true;
    if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);
    this.worker.terminate();
    if (this.idleTimer) window.clearTimeout(this.idleTimer);
    window.removeEventListener("resize", this.resize);
    this.splashScreenElement.removeEventListener(
      "mousemove",
      this.handleMouseMove,
    );
    this.splashScreenElement.removeEventListener(
      "mouseleave",
      this.handleMouseLeave,
    );
    this.splashScreenElement.removeEventListener("click", this.handleClick);

    // Optional: If you want to stop particles immediately from elsewhere, you can call this.observer?.disconnect(); here.
    if (this.canvas.parentElement) {
      this.canvas.remove();
    }

    // Disconnect the observer only if it was created
    if (this.observer) {
      this.observer.disconnect();
    }
  }
}
