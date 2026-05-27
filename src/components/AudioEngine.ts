/// <reference lib="dom" />

export type SoundProfile = {
  type: OscillatorType;
  f1: number;
  f2?: number;
  g: number;
  d: number;
};

export class AudioEngine {
  // Audio context and nodes
  public ctx: AudioContext | null = null; // Public for direct state checks
  private _isBroken: boolean = false; // Internal state for engine functionality
  private musicGain: GainNode | null = null;
  private uiGain: GainNode | null = null;
  private humOsc: OscillatorNode | null = null;
  private humGain: GainNode | null = null;
  private humFilter: BiquadFilterNode | null = null;
  private musicFilter: BiquadFilterNode | null = null;
  private musicBuffers: Map<string, AudioBuffer> = new Map();
  private musicSource: AudioBufferSourceNode | null = null;
  private _currentTrackGain: GainNode | null = null;
  private _currentMusicUrl: string | null = null;
  private musicVolume: number = parseFloat(
    localStorage.getItem("music-volume") || "0.4",
  );
  private _isMuffledForSearch: boolean = false; // New flag for search muffling
  private isDucked: boolean = false;
  private smoothedData: Float32Array | null = null;
  private peakData: Float32Array | null = null;
  private peakHold: Int32Array | null = null;
  public analyser: AnalyserNode | null = null;
  // Control parameters
  private visualizerRisk: number = 0;
  private duckLevel: number = 0.3;
  private bufferPool: Map<string, AudioBuffer> = new Map(); // Pre-rendered sound effects
  private uiVolume: number = parseFloat(
    localStorage.getItem("ui-volume") || "0.5",
  );
  private animationFrameId: number | null = null;
  /** Sound profiles for different UI themes */
  static SOUND_PROFILES: Record<string, Record<string, SoundProfile>> = {
    modern: {
      ping: { type: "triangle", f1: 1200, f2: 400, g: 0.05, d: 0.1 },
      type: { type: "sine", f1: 2000, g: 0.01, d: 0.02 },
      pop: { type: "sine", f1: 600, f2: 1200, g: 0.04, d: 0.1 },
      click: { type: "sine", f1: 1600, g: 0.015, d: 0.04 },
    },
    classic: {
      ping: { type: "sine", f1: 880, f2: 440, g: 0.06, d: 0.15 },
      type: { type: "triangle", f1: 1200, g: 0.015, d: 0.03 },
      pop: { type: "triangle", f1: 500, f2: 900, g: 0.05, d: 0.12 },
      click: { type: "triangle", f1: 1000, g: 0.02, d: 0.05 },
    },
    retro: {
      ping: { type: "square", f1: 400, f2: 100, g: 0.03, d: 0.2 },
      type: { type: "square", f1: 600, g: 0.012, d: 0.04 },
      pop: { type: "square", f1: 200, f2: 500, g: 0.03, d: 0.15 },
      click: { type: "square", f1: 300, g: 0.025, d: 0.06 },
    },
  };

  constructor() {
    // No side‑effects needed; fields are already initialised.
  }

  /** Returns true if the AudioEngine failed to initialize or encountered a critical error. */
  get isBroken(): boolean {
    return this._isBroken;
  }

  /** Returns true if the AudioContext is currently in a 'suspended' state, waiting for user interaction. */
  get isContextSuspended(): boolean {
    return this.ctx ? this.ctx.state === "suspended" : true; // Assume suspended if no context yet
  }

  /** Returns true if the UI volume is set to 0. */
  get isMutedByVolume(): boolean {
    return this.uiVolume === 0;
  }

  /** Initialise the audio graph – safe to call multiple times */
  async init(): Promise<void> {
    if (this.ctx || this._isBroken) return;
    try {
      const AudioContextClass =
        window.AudioContext ?? (window as any).webkitAudioContext;
      if (!AudioContextClass) throw new Error("Web Audio API not supported");

      // Attempt to create the context.
      // If not allowed by policy, some browsers throw here; others create it in 'suspended' state.
      try {
        this.ctx = new AudioContextClass();
        // The context might be suspended here, which is normal.
      } catch (e) {
        return; // Silent return: init will be re-attempted on the next playUi call
      }

      // Create nodes
      this.uiGain = this.ctx.createGain();
      this.musicGain = this.ctx.createGain();
      const analyserNode = this.ctx.createAnalyser(); // Create local constant
      this.analyser = analyserNode; // Assign to class property
      analyserNode.fftSize = 256; // Use the local constant to satisfy TS null-check

      // Optional: Set built-in smoothing (0 to 1). Default is 0.8.
      analyserNode.smoothingTimeConstant = 0.85;

      this.humFilter = this.ctx.createBiquadFilter();
      this.humFilter.type = "lowpass";
      this.humGain = this.ctx.createGain();
      this.humGain.gain.value = 0;
      this.musicFilter = this.ctx.createBiquadFilter();
      this.musicFilter.type = "lowpass";
      this.musicFilter.frequency.value = 20000; // Fully open by default

      // Wire graph
      this.uiGain.connect(this.ctx.destination);
      this.musicGain.connect(this.musicFilter).connect(this.ctx.destination);
      this.musicFilter.connect(analyserNode); // Use the non-nullable local constant
      this.humFilter.connect(this.humGain).connect(this.ctx.destination);

      await this.preRenderAll();
      await this.updateVolumes();
    } catch (e: any) {
      console.warn("Audio Engine initialization failed:", e.message);
      this._isBroken = true;
    }
  }

  /**
   * Explicitly resumes the AudioContext to satisfy browser autoplay policies.
   * This must be called from a user gesture (click, mousedown, etc.).
   * If the engine hasn't been initialized, it triggers full graph setup first. Returns true on success.
   */
  async resume(): Promise<void> {
    if (this._isBroken) return;
    if (!this.ctx) await this.init();

    if (this.ctx && this.ctx.state === "suspended") {
      try {
        await this.ctx.resume();
        console.info("[AudioEngine] Context resumed successfully.");
      } catch (e) {
        // Fails silently if called outside a user gesture context to avoid console noise.
      }
    }
  }

  /**
   * Initial pre‑render for modern pack only; other packs load in background
   */
  private async preRenderAll(): Promise<void> {
    if (!this.ctx) return;
    const sampleRate = this.ctx.sampleRate;

    // Render only the "modern" pack initially for faster startup
    const defaultPack = AudioEngine.SOUND_PROFILES.modern;
    for (const [soundId, profile] of Object.entries(defaultPack)) {
      const buffer = await this.renderProfileToBuffer(profile, sampleRate);
      this.bufferPool.set(`modern:${soundId}`, buffer);
    }

    // Pre-render other packs in background
    setTimeout(async () => {
      for (const [packName, profiles] of Object.entries(
        AudioEngine.SOUND_PROFILES,
      )) {
        if (packName === "modern") continue;
        for (const [soundId, profile] of Object.entries(profiles)) {
          const buffer = await this.renderProfileToBuffer(profile, sampleRate);
          this.bufferPool.set(`${packName}:${soundId}`, buffer);
        }
      }
    }, 2000);
  }

  /** Set UI volume (clamped 0‑1) and persist */

  /** Render a single {@link SoundProfile} to an offline buffer */
  private async renderProfileToBuffer(
    profile: SoundProfile,
    sampleRate: number,
  ): Promise<AudioBuffer> {
    const length = Math.ceil(sampleRate * profile.d);
    const offlineCtx = new OfflineAudioContext(1, length, sampleRate);
    const osc = offlineCtx.createOscillator();
    const gain = offlineCtx.createGain();

    osc.type = profile.type;
    osc.frequency.setValueAtTime(profile.f1, 0);
    if (profile.f2) {
      osc.frequency.exponentialRampToValueAtTime(profile.f2, profile.d);
    }
    gain.gain.setValueAtTime(profile.g, 0);
    gain.gain.exponentialRampToValueAtTime(0.0001, profile.d);

    osc.connect(gain);
    gain.connect(offlineCtx.destination);
    osc.start(0);
    osc.stop(profile.d);
    return await offlineCtx.startRendering();
  }

  /** Apply UI volume and ducking settings to the audio graph */
  async updateVolumes(): Promise<void> {
    if (!this.ctx) return;
    this.uiGain?.gain.setTargetAtTime(
      this.uiVolume,
      this.ctx.currentTime,
      0.05,
    );
    const targetMusicVol = this.isDucked
      ? this.musicVolume * this.duckLevel
      : this.musicVolume;
    this.musicGain?.gain.setTargetAtTime(
      targetMusicVol,
      this.ctx.currentTime,
      0.05,
    );
    this._applyMusicFilter(); // Re-apply filter settings when volumes update
  }

  /** Starts a continuous low-frequency hum for the splash screen */
  async startHum(): Promise<void> {
    await this.init();
    // Since startHum is called within skip/particle click handlers in
    // BootstrapManager, we can safely attempt to resume here.
    await this.resume();

    if (!this.ctx || !this.humFilter || !this.humGain || this.humOsc) return;

    this.humOsc = this.ctx.createOscillator();
    this.humOsc.type = "sawtooth"; // Richer harmonics for "distortion"
    this.humOsc.frequency.value = 60;

    this.humOsc.connect(this.humFilter);
    this.humOsc.start();
    this.humGain.gain.setTargetAtTime(
      0.15 * this.uiVolume,
      this.ctx.currentTime,
      0.5,
    );
  }

  /** Dynamically updates the hum's pitch and distortion based on risk */
  updateHum(risk: number): void {
    this.visualizerRisk = risk;
    if (!this.ctx || !this.humOsc || !this.humFilter || !this.humGain) return;

    // Lower frequency (deeper) as risk increases: 60Hz -> 35Hz
    const freq = 60 - risk * 25;
    // Open filter (more distorted/buzzy) as risk increases: 200Hz -> 1500Hz
    const cutoff = 200 + risk * 1300;
    // Slightly increase volume for intensity
    const gain = (0.15 + risk * 0.2) * this.uiVolume;

    this.humOsc.frequency.setTargetAtTime(freq, this.ctx.currentTime, 0.1);
    this.humFilter.frequency.setTargetAtTime(cutoff, this.ctx.currentTime, 0.1);
    this.humGain.gain.setTargetAtTime(gain, this.ctx.currentTime, 0.1);
  }

  /** Fades out and stops the hum */
  stopHum(): void {
    if (!this.ctx || !this.humGain || !this.humOsc) return;
    this.humGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.5);
    setTimeout(() => {
      this.humOsc?.stop();
      this.humOsc = null;
    }, 600);
  }

  /** Loads an audio track into an AudioBuffer. */
  private async loadMusicBuffer(url: string): Promise<AudioBuffer | null> {
    if (this.musicBuffers.has(url)) return this.musicBuffers.get(url)!;
    if (!this.ctx) await this.init();
    if (!this.ctx) return null;

    try {
      const response = await fetch(url);
      const arrayBuffer = await response.arrayBuffer();
      const buffer = await this.ctx.decodeAudioData(arrayBuffer);
      this.musicBuffers.set(url, buffer);
      console.info(`[AudioEngine] Music track loaded: ${url}`);
      return buffer;
    } catch (e) {
      console.error(`[AudioEngine] Failed to load music track ${url}:`, e);
      return null;
    }
  }

  /** Starts playing background music with optional crossfade */
  async startMusic(url: string, crossfadeTime = 2.0): Promise<void> {
    if (this._isBroken) return;
    if (this._currentMusicUrl === url) return;

    const buffer = await this.loadMusicBuffer(url);
    if (!this.ctx || !buffer || !this.musicGain) return;

    const oldSource = this.musicSource;
    const oldTrackGain = this._currentTrackGain;

    // Create new track gain for crossfade isolation
    const trackGain = this.ctx.createGain();
    trackGain.gain.setValueAtTime(0, this.ctx.currentTime);
    trackGain.connect(this.musicGain);

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(trackGain);

    // Connect to analyser if visualizer is active, but keep it subtle
    if (this.analyser) source.connect(this.analyser);

    this.musicSource = source;
    this._currentTrackGain = trackGain;
    this._currentMusicUrl = url;

    source.start(0);
    // Fade in new track (constant 1.0 because master musicGain handles overall volume)
    trackGain.gain.setTargetAtTime(
      1.0,
      this.ctx.currentTime,
      crossfadeTime / 3,
    );

    // Fade out and cleanup old source
    if (oldSource && oldTrackGain) {
      oldTrackGain.gain.setTargetAtTime(
        0,
        this.ctx.currentTime,
        crossfadeTime / 4,
      );
      setTimeout(
        () => {
          try {
            oldSource.stop();
          } catch {
            /* ignore if already stopped */
          }
          oldTrackGain.disconnect();
        },
        crossfadeTime * 1000 + 500,
      );
    }

    console.info(`[AudioEngine] Crossfading to: ${url}`);
  }

  /** Stops the background music track. */
  stopMusic(): void {
    if (!this.musicSource || !this.ctx || !this._currentTrackGain) return;
    // Smooth fade out
    this._currentTrackGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.3);

    const source = this.musicSource;
    const trackGain = this._currentTrackGain;
    setTimeout(() => {
      try {
        source.stop();
      } catch {
        /* ignore if already stopped */
      }
      trackGain.disconnect();
      if (this.musicSource === source) {
        this.musicSource = null;
        this._currentTrackGain = null;
        this._currentMusicUrl = null;
      }
    }, 1500);
    console.info("[AudioEngine] Background music stopped.");
  }

  /** Play a UI sound effect */
  async playUi(
    id: string,
    checkMute = true,
    pitchOverride?: number,
  ): Promise<void> {
    if (!this.ctx) await this.init();

    // We do NOT call resume() here. If the context is suspended,
    // the sound simply won't play, avoiding the browser warning. If the engine is broken, also return.
    const vol = this.uiVolume;
    if (this._isBroken || (checkMute && vol === 0)) return;
    const pack = localStorage.getItem("sound-pack") ?? "modern";
    const buffer = this.bufferPool.get(`${pack}:${id}`);
    if (!buffer) return;
    const source = this.ctx!.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value =
      pitchOverride ?? parseFloat(localStorage.getItem("ui-pitch") ?? "1.0");
    source.connect(this.uiGain!);
    source.start();
    // If visualizer is active, the UI sounds won't show unless connected to analyser.
    // For UI sounds, we typically don't visualize them to keep the focus on music/speech.
  }

  /** Duck background music when UI sounds play */
  duckMusic(): void {
    this.isDucked = true;
    if (!this.ctx || !this.musicGain) return;
    this.musicGain.gain.setTargetAtTime(
      this.musicVolume * this.duckLevel,
      this.ctx.currentTime,
      0.2,
    );
  }

  /** Restore background music volume */
  unduckMusic(fadeTime = 0.5): void {
    this.isDucked = false;
    if (!this.ctx || !this.musicGain) return;
    this.musicGain.gain.setTargetAtTime(
      this.musicVolume,
      this.ctx.currentTime,
      fadeTime,
    );
  }

  /** Sets a temporary muffle for music, typically used during search operations. */
  setMusicMuffle(muffle: boolean): void {
    if (this._isMuffledForSearch === muffle) return;
    this._isMuffledForSearch = muffle;
    this._applyMusicFilter();
  }

  /** Set the music filter frequency based on risk level */
  updateMusicFilter(risk: number): void {
    this.visualizerRisk = risk;
    this._applyMusicFilter();
  }

  /** Applies the music filter based on current risk and search muffle state. */
  private _applyMusicFilter(): void {
    if (!this.ctx || !this.musicFilter) return;

    // If muffled for search, apply a fixed, noticeable muffle.
    // Otherwise, use the risk-based calculation.
    const cutoff = this._isMuffledForSearch
      ? 5000
      : 20000 - this.visualizerRisk * 19600; // 20kHz (clear) -> 400Hz (oppressive)
    this.musicFilter.frequency.setTargetAtTime(
      cutoff,
      this.ctx.currentTime,
      0.2,
    );
  }

  /** Set UI volume (clamped 0‑1) and persist */
  setUiVolume(volume: number): void {
    this.uiVolume = Math.max(0, Math.min(1, volume));
    localStorage.setItem("ui-volume", this.uiVolume.toString());
    // The Dashboard will read this.uiVolume and update its reactive state for isAudioMuted.
    void this.updateVolumes();
  }

  /** Set background music volume (clamped 0-1) and persist */
  setMusicVolume(volume: number): void {
    this.musicVolume = Math.max(0, Math.min(1, volume));
    localStorage.setItem("music-volume", this.musicVolume.toString());
    void this.updateVolumes();
  }

  /** Set the ducking multiplier (>=0) */
  setDuckLevel(level: number): void {
    this.duckLevel = Math.max(0, level);
    void this.updateVolumes();
  }

  /** Retrieve the latest analyser frequency data */
  getAnalyserData(): Uint8Array | null {
    if (!this.analyser) return null;
    const data = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(data);
    return data;
  }

  /** Start a canvas visualizer using the analyser */
  startVisualizer(canvas: HTMLCanvasElement): void {
    const analyser = this.analyser;

    // If a visualizer is already running, stop it to prevent overlapping animation loops
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }

    if (!this.ctx || !analyser) return;
    const ctx2d = canvas.getContext("2d");
    if (!ctx2d) return;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    // Initialize or resize the smoothing buffer to match the analyser's current resolution
    if (!this.smoothedData || this.smoothedData.length !== bufferLength) {
      this.smoothedData = new Float32Array(bufferLength);
    }
    if (!this.peakData || this.peakData.length !== bufferLength) {
      this.peakData = new Float32Array(bufferLength);
    }
    if (!this.peakHold || this.peakHold.length !== bufferLength) {
      this.peakHold = new Int32Array(bufferLength);
    }

    const draw = () => {
      this.animationFrameId = requestAnimationFrame(draw);
      analyser.getByteFrequencyData(dataArray);
      ctx2d.clearRect(0, 0, canvas.width, canvas.height);

      const centerY = canvas.height / 2;

      // Map risk (0 to 1) to Hue (140/Green down to 0/Red)
      const hue = 140 - this.visualizerRisk * 140;

      // Performance: Optimization - Reduce number of frequency bins processed
      // Lower frequencies carry more visual energy; skipping the top 30% reduces iteration count
      const visualBins = Math.floor(bufferLength * 0.7);
      const barWidth = (canvas.width / visualBins) * 1.8;

      // Performance: Set style variables once per frame
      const peakColorStr = `hsl(${hue}, 100%, 80%)`;

      // Create a global vertical gradient for the bars to avoid creating objects inside the loop
      const globalBarGradient = ctx2d.createLinearGradient(
        0,
        0,
        0,
        canvas.height,
      );
      globalBarGradient.addColorStop(0, `hsla(${hue}, 100%, 80%, 1)`); // Top tip
      globalBarGradient.addColorStop(0.5, `hsla(${hue}, 80%, 20%, 0.9)`); // Middle
      globalBarGradient.addColorStop(1, `hsla(${hue}, 100%, 80%, 1)`); // Bottom tip

      let x = 0;
      const barPath = new Path2D();
      const peakPath = new Path2D();

      for (let i = 0; i < visualBins; i++) {
        const currentVal = dataArray[i];
        const prevVal = this.smoothedData![i];

        if (currentVal >= prevVal) {
          // Rise instantly: follow the data peak immediately
          this.smoothedData![i] = currentVal;
        } else {
          // Fall slowly: apply a decay factor (0.95 = 5% drop per frame)
          // Lower values (e.g. 0.9) fall faster, higher (e.g. 0.98) fall slower.
          this.smoothedData![i] = prevVal * 0.95;
        }

        const barHeight = this.smoothedData![i] / 4;

        // Peak Indicator Logic
        if (barHeight >= this.peakData![i]) {
          this.peakData![i] = barHeight;
          this.peakHold![i] = 30; // Hold peak for 30 frames (~0.5s at 60fps)
        } else {
          if (this.peakHold![i] > 0) {
            this.peakHold![i]--;
          } else {
            // Peak decay: falls slightly slower than the bars for better visibility
            this.peakData![i] = Math.max(0, this.peakData![i] * 0.97); // Ensure peak doesn't go negative
          }
        }

        // Draw the peak cap (small floating line)
        if (this.peakData![i] > 1) {
          // Batch peak caps into a single path
          peakPath.rect(x, centerY - this.peakData![i] - 2, barWidth, 2);
          peakPath.rect(x, centerY + this.peakData![i], barWidth, 2);
        }

        // Batch mirrored bars into a single path
        barPath.rect(
          x,
          centerY - barHeight / 2,
          barWidth,
          Math.max(1, barHeight),
        );

        x += barWidth + 1;
      }

      // Single fill calls for batched paths (Major performance boost)
      ctx2d.fillStyle = globalBarGradient;
      ctx2d.fill(barPath);
      ctx2d.fillStyle = peakColorStr;
      ctx2d.fill(peakPath);

      // Enhanced CRT Scanline Overlay
      if (document.body.getAttribute("data-theme") === "dark") {
        ctx2d.save();
        ctx2d.globalAlpha = 0.04 + Math.random() * 0.04;
        ctx2d.strokeStyle = "rgba(255, 255, 255, 0.2)";
        ctx2d.lineWidth = 1;
        ctx2d.beginPath(); // Start one path for all scanlines

        const scanOffset = (performance.now() / 100) % 4;
        for (let y = scanOffset; y < canvas.height; y += 4) {
          ctx2d.moveTo(0, y);
          ctx2d.lineTo(canvas.width, y);
        }
        ctx2d.stroke(); // Stroke once
        ctx2d.restore();
      }
    };
    draw();
  }

  /** Stop the visualizer and clear the canvas */
  stopVisualizer(): void {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    const canvas = document.getElementById(
      "ai-visualizer",
    ) as HTMLCanvasElement | null;
    if (canvas) {
      const ctx2d = canvas.getContext("2d");
      if (ctx2d) ctx2d.clearRect(0, 0, canvas.width, canvas.height);
    }
  }
}
