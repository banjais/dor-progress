// @ts-nocheck
export class AudioEngine {
  static SOUND_PROFILES = {
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
    this.ctx = null;
    this.isBroken = false;
    this.musicSource = null;
    this.musicGain = null;
    this.uiGain = null;
    this.musicBuffer = null;
    this.analyser = null;
    this.duckLevel = 0.3;
    this.bufferPool = new Map();
    this.uiVolume = parseFloat(localStorage.getItem("ui-volume") || "0.5");
    this.lastVolume = this.uiVolume > 0 ? this.uiVolume : 0.5;
    this.currentSoundPack = localStorage.getItem("sound-pack") || "modern";
    this.uiPitch = parseFloat(localStorage.getItem("ui-pitch") || "1.0");
  }

  async init() {
    if (this.ctx || this.isBroken) return;
    try {
      const AudioContextClass =
        window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) throw new Error("Web Audio API not supported");
      this.ctx = new AudioContextClass();
      if (this.ctx.state === "suspended") await this.ctx.resume();
      this.uiGain = this.ctx.createGain();
      this.musicGain = this.ctx.createGain();
      this.uiGain.connect(this.ctx.destination);
      this.musicGain.connect(this.ctx.destination);
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 64;
      this.musicGain.connect(this.analyser);
      await this.preRenderAll();
      await this.updateVolumes();
    } catch (e) {
      console.warn("Audio Engine initialization failed:", e.message);
      this.isBroken = true;
    }
  }

  async preRenderAll() {
    const sampleRate = this.ctx.sampleRate;
    for (const [packName, profiles] of Object.entries(
      AudioEngine.SOUND_PROFILES,
    )) {
      for (const [soundId, profile] of Object.entries(profiles)) {
        const buffer = await this._renderProfileToBuffer(profile, sampleRate);
        this.bufferPool.set(`${packName}:${soundId}`, buffer);
      }
    }
  }

  async _renderProfileToBuffer(profile, sampleRate) {
    const length = Math.ceil(sampleRate * profile.d);
    const offlineCtx = new OfflineAudioContext(1, length, sampleRate);
    try {
      const osc = offlineCtx.createOscillator();
      const gain = offlineCtx.createGain();
      osc.type = profile.type;
      osc.frequency.setValueAtTime(profile.f1, 0);
      if (profile.f2)
        osc.frequency.exponentialRampToValueAtTime(profile.f2, profile.d);
      gain.gain.setValueAtTime(profile.g, 0);
      gain.gain.exponentialRampToValueAtTime(0.0001, profile.d);
      osc.connect(gain);
      gain.connect(offlineCtx.destination);
      osc.start(0);
      osc.stop(profile.d);
      return await offlineCtx.startRendering();
    } catch (e) {
      this.isBroken = true;
    }
  }

  async updateVolumes() {
    if (!this.ctx) return;
    if (this.ctx.state === "suspended") await this.ctx.resume();
    this.uiGain.gain.setTargetAtTime(this.uiVolume, this.ctx.currentTime, 0.05);
    this.musicGain.gain.setTargetAtTime(
      this.uiVolume * this.duckLevel,
      this.ctx.currentTime,
      0.05,
    );
  }

  async playUi(id, checkMute = true) {
    await this.init();
    const vol = parseFloat(localStorage.getItem("ui-volume") || "0.5");
    if (this.isBroken || (checkMute && vol === 0)) return;
    try {
      const pack = localStorage.getItem("sound-pack") || "modern";
      const buffer = this.bufferPool.get(`${pack}:${id}`);
      if (!buffer) return;
      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = parseFloat(
        localStorage.getItem("ui-pitch") || "1.0",
      );
      source.connect(this.uiGain);
      source.start();
    } catch (e) {
      // Silently fail audio playback errors
    }
  }
}
