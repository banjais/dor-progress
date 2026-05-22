import { AudioEngine } from "./AudioEngine.js";
import { Dashboard } from "../Dashboard.js";

export class SpeechEngine {
  audio: AudioEngine;
  dashboard: Dashboard;
  webSpeechApiAvailable: boolean;
  synth: SpeechSynthesis | null;
  utterance: SpeechSynthesisUtterance | null;
  originalText: string;
  container: HTMLElement | null;
  currentBlobAudioSource: AudioBufferSourceNode | null; // Added for blob audio
  constructor(audio: AudioEngine, dashboard: Dashboard) {
    this.audio = audio;
    this.dashboard = dashboard;
    this.webSpeechApiAvailable = "speechSynthesis" in window;
    this.synth = this.webSpeechApiAvailable ? window.speechSynthesis : null;
    this.utterance = null;
    this.originalText = "";
    this.container = null;
    this.currentBlobAudioSource = null; // No citation needed, this is internal code.
  }

  stop() {
    if (this.synth?.speaking) {
      this.synth.cancel();
      this.utterance = null;
      this.audio.unduckMusic(0.5); // Fade music back in
      this.audio.stopVisualizer();
      if (this.container && this.originalText) {
        this.container.innerText = this.originalText; // Restore original text
      }
      this.resetUI();
    }

    if (this.currentBlobAudioSource) {
      this.currentBlobAudioSource?.stop();
      this.currentBlobAudioSource = null;
      this.audio.unduckMusic(0.5); // Fade music back in
      this.audio.stopVisualizer();
      this.resetUI();
    }
  }

  resetUI() {
    const btn = document.getElementById("ai-read-btn");
    if (btn) {
      btn.innerText = this.dashboard.t("readAloud"); // Assuming 'readAloud' is a translation key
    }
    this.audio.stopVisualizer(); // Ensure visualizer is stopped when UI resets
  }

  async toggle(container: HTMLElement) {
    // If currently speaking, stop it
    if (this.synth?.speaking || this.currentBlobAudioSource) {
      this.stop();
      return;
    }

    // If not speaking, start it
    this.container = container;
    this.originalText = container.innerText;
    const text = this.originalText;
    if (!text) return;

    const btn = document.getElementById("ai-read-btn");
    if (btn) btn.innerText = this.dashboard.t("stop"); // Assuming 'stop' is a translation key

    const isPremiumTts = localStorage.getItem("premium-tts") === "true";

    // Try blob audio first if premium TTS is enabled
    if (isPremiumTts) {
      try {
        const blob = await this.dashboard.fetchAiBriefBlob(); // Reuse the existing fetcher
        if (blob) {
          await this.playBlobAudio(blob);
          return;
        }
      } catch (error) {
        console.warn(
          "Failed to play premium blob audio, falling back to Web Speech API:",
          error,
        );
        // Fallback to Web Speech API
      }
    }

    // Web Speech API fallback or default
    this.playWebSpeechApi(text);
  }

  private async playBlobAudio(blob: Blob) {
    if (!this.audio.ctx) await this.audio.init(); // Ensure AudioContext is initialized
    if (!this.audio.ctx) {
      console.error("AudioContext not available for blob playback.");
      this.resetUI();
      return;
    }

    try {
      const arrayBuffer = await blob.arrayBuffer();
      const audioBuffer = await this.audio.ctx.decodeAudioData(arrayBuffer);

      const sourceNode = this.audio.ctx.createBufferSource();
      this.currentBlobAudioSource = sourceNode; // Assign to class property

      sourceNode.buffer = audioBuffer;

      // Connect to analyser for visualization, ensuring analyser is not null
      if (this.audio.analyser && this.audio.ctx) {
        sourceNode.connect(this.audio.analyser);
        this.audio.analyser.connect(this.audio.ctx.destination); // Ensure analyser is connected to destination
      } else if (this.audio.ctx) {
        sourceNode.connect(this.audio.ctx.destination);
      }

      sourceNode.onended = () => {
        this.currentBlobAudioSource = null;
        this.resetUI();
        this.audio.unduckMusic(0.5); // Fade music back in
      };

      this.audio.duckMusic(); // Duck background music
      sourceNode.start(0);
      this.audio.startVisualizer(
        document.getElementById("ai-visualizer") as HTMLCanvasElement,
      ); // Start visualizer
    } catch (error) {
      console.error("Error playing blob audio:", error);
      this.dashboard.addToast("error", this.dashboard.t("audioPlaybackError"));
      this.resetUI();
      this.audio.unduckMusic(0.5);
    }
  }

  private playWebSpeechApi(text: string) {
    if (!this.synth) {
      this.dashboard.addToast(
        "error",
        this.dashboard.t("speechNotSupported"),
      ); // Assuming translation key
      this.resetUI();
      return;
    }

    this.utterance = new SpeechSynthesisUtterance(text);
    this.utterance.lang =
      this.dashboard.state.lang === "ne" ? "ne-NP" : "en-US";
    this.utterance.pitch = parseFloat(
      localStorage.getItem("tts-pitch") || "1.0",
    );
    this.utterance.rate = parseFloat(
      localStorage.getItem("tts-rate") || "0.95",
    );

    const savedVoiceUri = localStorage.getItem("tts-voice-uri");
    if (savedVoiceUri) {
      const voices = this.synth.getVoices();
      this.utterance.voice =
        voices.find((v) => v.voiceURI === savedVoiceUri) || null;
    }
    let currentWordIndex = 0;

    this.utterance.onboundary = (event) => {
      if (event.name === "word" && this.container) {
        const words = this.originalText.split(/\s+/);
        let charCount = 0;
        for (let i = 0; i < words.length; i++) {
          if (charCount + words[i].length > event.charIndex) {
            currentWordIndex = i;
            break;
          }
          charCount += words[i].length + 1; // +1 for space
        }

        // Highlight the current word
        const highlightedText = words
          .map((word, index) =>
            index === currentWordIndex
              ? `<span class="highlight-word">${word}</span>`
              : word,
          )
          .join(" ");
        this.container.innerHTML = highlightedText;
      }
    };

    this.utterance.onend = () => {
      this.utterance = null;
      this.resetUI();
      if (this.container && this.originalText) {
        this.container.innerText = this.originalText; // Restore original text
      }
      this.audio.unduckMusic(0.5); // Fade music back in
    };

    this.utterance.onerror = (event) => {
      console.error("SpeechSynthesisUtterance error:", event);
      this.dashboard.addToast("error", this.dashboard.t("speechError")); // Assuming translation key
      this.utterance = null;
      this.resetUI();
      if (this.container && this.originalText) {
        this.container.innerText = this.originalText;
      }
      this.audio.unduckMusic(0.5); // Fade music back in
    };

    this.audio.duckMusic(); // Duck background music
    this.synth.speak(this.utterance);
    this.audio.startVisualizer(
      document.getElementById("ai-visualizer") as HTMLCanvasElement,
    ); // Start visualizer
  }
}
