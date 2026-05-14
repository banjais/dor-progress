export class SpeechEngine {
  constructor(audio, dashboard) {
    this.audio = audio;
    this.dashboard = dashboard;
    this.webSpeechApiAvailable = "speechSynthesis" in window;
    this.synth = this.webSpeechApiAvailable ? window.speechSynthesis : null;
    this.utterance = null;
    this.originalText = "";
    this.container = null;
    this.currentBlobAudioSource = null;
    this.spanMap = [];
  }

  stop() {
    if (this.synth?.speaking) {
      this.audio.stopMusic(1.5);
      setTimeout(() => {
        if (this.synth) this.synth.cancel();
        if (this.container && this.originalText) {
          this.container.innerText = this.originalText;
        }
        this.resetUI();
      }, 800);
    } else if (this.currentBlobAudioSource) {
      this.audio.stopMusic(1.5);
      setTimeout(() => {
        this.currentBlobAudioSource.stop();
        this.resetUI();
      }, 800);
    }
  }

  resetUI() {
    const btn = document.getElementById("ai-read-btn");
    if (btn) {
      btn.innerText = "🔊";
      // Note: Translation logic remains in the dashboard
    }
  }

  async toggle(container) {
    // ... Existing logic migrated from main.ts
    // This is a partial migration for the demonstration of separation
  }
}
