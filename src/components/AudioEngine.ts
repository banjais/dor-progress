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
  private humOsc: OscillatorNode | null = null;
  private humGain: GainNode | null = null;
  private humFilter: BiquadFilterNode | null = null;
  private musicFilter: BiquadFilterNode | null = null;
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

      // Attempt to create the context. 
      // If not allowed by policy, some browsers throw here; others create it in 'suspended' state.
      try {
        this.ctx = new AudioContextClass();
      } catch (e) {
        return; // Silent return: init will be re-attempted on the next playUi call
      }

      // If the context is suspended, we only attempt to resume it.
      // If this is called outside a user gesture, the browser will log a warning,
      // but the engine will remain ready to resume on the next valid interaction.
      if (this.ctx.state === "suspended") await this.ctx.resume();

      // Create nodes
      this.uiGain = this.ctx.createGain();
      this.musicGain = this.ctx.createGain();
      const analyserNode = this.ctx.createAnalyser(); // Create local constant
      this.analyser = analyserNode; // Assign to class property
      analyserNode.fftSize = 256; // Use the local constant to satisfy TS null-check
      this.humFilter = this.ctx.createBiquadFilter();
      this.humFilter.type = "lowpass";
      this.humGain = this.ctx.createGain();
      this.humGain.gain.value = 0;
      this.musicFilter = this.ctx.createBiquadFilter();
      this.musicFilter.type = "highpass";
      this.musicFilter.frequency.value = 0; // Bypass by default

      // Wire graph
      this.uiGain.connect(this.ctx.destination);
      this.musicGain.connect(this.musicFilter).connect(this.ctx.destination);
      this.musicFilter.connect(analyserNode); // Use the non-nullable local constant
      this.humFilter.connect(this.humGain).connect(this.ctx.destination);

      await this.preRenderAll();
      await this.updateVolumes();
    } catch (e: any) {
      console.warn("Audio Engine initialization failed:", e.message);
      this.isBroken = true;
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
      for (const [packName, profiles] of Object.entries(AudioEngine.SOUND_PROFILES)) {
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

  /** Starts a continuous low-frequency hum for the splash screen */
  async startHum(): Promise<void> {
    await this.init();
    if (!this.ctx || !this.humFilter || !this.humGain || this.humOsc) return;

    this.humOsc = this.ctx.createOscillator();
    this.humOsc.type = "sawtooth"; // Richer harmonics for "distortion"
    this.humOsc.frequency.value = 60;

    this.humOsc.connect(this.humFilter);
    this.humOsc.start();
    this.humGain.gain.setTargetAtTime(0.15 * this.uiVolume, this.ctx.currentTime, 0.5);
  }

  /** Dynamically updates the hum's pitch and distortion based on risk */
  updateHum(risk: number): void {
    if (!this.ctx || !this.humOsc || !this.humFilter || !this.humGain) return;

    // Lower frequency (deeper) as risk increases: 60Hz -> 35Hz
    const freq = 60 - (risk * 25);
    // Open filter (more distorted/buzzy) as risk increases: 200Hz -> 1500Hz
    const cutoff = 200 + (risk * 1300);
    // Slightly increase volume for intensity
    const gain = (0.15 + (risk * 0.2)) * this.uiVolume;

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

  /** Play a UI sound effect */
  async playUi(id: string, checkMute = true, pitchOverride?: number): Promise<void> {
    await this.init();
    const vol = this.uiVolume; // Use class property instead of re-reading localStorage
    if (this.isBroken || (checkMute && vol === 0)) return;
    const pack = localStorage.getItem("sound-pack") ?? "modern";
    const buffer = this.bufferPool.get(`${pack}:${id}`);
    if (!buffer) return;
    const source = this.ctx!.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = pitchOverride ?? parseFloat(localStorage.getItem("ui-pitch") ?? "1.0");
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

  /** Set the music filter frequency based on risk level */
  updateMusicFilter(risk: number): void {
    if (!this.ctx || !this.musicFilter) return;
    const freq = risk * 2000;
    this.musicFilter.frequency.setTargetAtTime(freq, this.ctx.currentTime, 0.1);
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
    const analyser = this.analyser;
    if (!this.ctx || !analyser) return;
    const ctx2d = canvas.getContext("2d");
    if (!ctx2d) return;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    const draw = () => {
      this.animationFrameId = requestAnimationFrame(draw);
      analyser.getByteFrequencyData(dataArray);
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
