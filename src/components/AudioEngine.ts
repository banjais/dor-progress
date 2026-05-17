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
  public ctx: AudioContext | null = null;
  private isBroken: boolean = false;
  private musicGain: GainNode | null = null;
  private uiGain: GainNode | null = null;
  public analyser: AnalyserNode | null = null;
  // Control parameters
  private duckLevel: number = 0.3;
  private bufferPool: Map<string, AudioBuffer> = new Map();
  private uiVolume: number = parseFloat(localStorage.getItem("ui-volume") || "0.5");
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

  /** Initialise the audio graph – safe to call multiple times */
  async init(): Promise<void> {
    if (this.ctx || this.isBroken) return;
    try {
      const AudioContextClass = window.AudioContext ?? (window as any).webkitAudioContext;
      if (!AudioContextClass) throw new Error("Web Audio API not supported");
      this.ctx = new AudioContextClass();
      if (this.ctx.state === "suspended") await this.ctx.resume();

      // Create nodes
      this.uiGain = this.ctx.createGain();
      this.musicGain = this.ctx.createGain();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 256;

      // Wire graph
      this.uiGain.connect(this.ctx.destination);
      this.musicGain.connect(this.ctx.destination);
      this.musicGain.connect(this.analyser!); // Non-null assertion is safe here as analyser is just created

      await this.preRenderAll();
      await this.updateVolumes();
    } catch (e: any) {
      console.warn("Audio Engine initialization failed:", e.message);
      this.isBroken = true;
    }
  }

  /** Pre‑render every sound profile into an AudioBuffer */
  private async preRenderAll(): Promise<void> {
    if (!this.ctx) return;
    const sampleRate = this.ctx.sampleRate;
    for (const [packName, profiles] of Object.entries(AudioEngine.SOUND_PROFILES)) {
      for (const [soundId, profile] of Object.entries(profiles)) {
        const buffer = await this.renderProfileToBuffer(profile, sampleRate);
        this.bufferPool.set(`${packName}:${soundId}`, buffer);
      }
    }
  }

  /** Render a single {@link SoundProfile} to an offline buffer */
  private async renderProfileToBuffer(profile: SoundProfile, sampleRate: number): Promise<AudioBuffer> {
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
    if (this.ctx.state === "suspended") await this.ctx.resume();
    this.uiGain?.gain.setTargetAtTime(this.uiVolume, this.ctx.currentTime, 0.05);
    this.musicGain?.gain.setTargetAtTime(this.uiVolume * this.duckLevel, this.ctx.currentTime, 0.05);
  }

  /** Play a UI sound effect */
  async playUi(id: string, checkMute = true): Promise<void> {
    await this.init();
    const vol = this.uiVolume; // Use class property instead of re-reading localStorage
    if (this.isBroken || (checkMute && vol === 0)) return;
    const pack = localStorage.getItem("sound-pack") ?? "modern";
    const buffer = this.bufferPool.get(`${pack}:${id}`);
    if (!buffer) return;
    const source = this.ctx!.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = parseFloat(localStorage.getItem("ui-pitch") ?? "1.0");
    source.connect(this.uiGain!);
    source.start();
  }

  /** Duck background music when UI sounds play */
  duckMusic(): void {
    if (!this.ctx || !this.musicGain) return;
    this.musicGain.gain.setTargetAtTime(this.uiVolume * this.duckLevel, this.ctx.currentTime, 0.2);
  }

  /** Restore background music volume */
  unduckMusic(fadeTime = 0.5): void {
    if (!this.ctx || !this.musicGain) return;
    this.musicGain.gain.setTargetAtTime(this.uiVolume, this.ctx.currentTime, fadeTime);
  }

  /** Set UI volume (clamped 0‑1) and persist */
  setUiVolume(volume: number): void {
    this.uiVolume = Math.max(0, Math.min(1, volume));
    localStorage.setItem("ui-volume", this.uiVolume.toString());
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
    if (!this.ctx || !this.analyser) return;
    const ctx2d = canvas.getContext("2d");
    if (!ctx2d) return;
    const bufferLength = this.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    const draw = () => {
      this.animationFrameId = requestAnimationFrame(draw);
      this.analyser!.getByteFrequencyData(dataArray);
      ctx2d.clearRect(0, 0, canvas.width, canvas.height);
      const barWidth = (canvas.width / bufferLength) * 2.5;
      let x = 0;
      for (let i = 0; i < bufferLength; i++) {
        const barHeight = dataArray[i] / 4;
        ctx2d.fillStyle = `rgb(${barHeight + 100}, 50, 50)`;
        ctx2d.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
        x += barWidth + 1;
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
    const canvas = document.getElementById("ai-visualizer") as HTMLCanvasElement | null;
    if (canvas) {
      const ctx2d = canvas.getContext("2d");
      if (ctx2d) ctx2d.clearRect(0, 0, canvas.width, canvas.height);
    }
  }
}
