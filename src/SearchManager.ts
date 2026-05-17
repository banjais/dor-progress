import { Dashboard, DashboardState } from "./Dashboard";
import { getColumnKey } from "./api-utils";
import { ProjectReport } from "../shared/types";

// No citation needed, this is internal code.
export class SearchManager {
    private dashboard: Dashboard;
    private searchTimeout: number | null = null;

    constructor(dashboard: Dashboard) {
        this.dashboard = dashboard;
        this.initReactivity();
    }

    private initReactivity() {
        // Automatically update UI elements whenever relevant state changes
        this.dashboard.subscribe(
            ({ search, store }) => {
                const clearBtn = document.getElementById("clear-search");
                if (clearBtn) clearBtn.style.display = search ? "block" : "none";

                this.updateSuggestions(search, store);
            },
            (state: DashboardState) => ({
                search: state.search,
                store: state.store
            })
        );
    }

    private updateSuggestions(search: string, store: ProjectReport | null) {
        const dl = document.getElementById("search-suggestions");
        if (!dl) return;

        if (!store?.headers?.length) {
            dl.innerHTML = "";
            return;
        }

        const indicatorKey = getColumnKey(store.headers, "indicator") || store.headers[0];
        const searchTerm = search.toLowerCase();
        const matches = store.rows
            .map((r) => String(r[indicatorKey] || ""))
            .filter((v) => v.toLowerCase().includes(searchTerm))
            .slice(0, 10);

        dl.innerHTML = [...new Set(matches)]
            .map((m: string) => `<option value="${m.replace(/"/g, '&quot;')}">`)
            .join("");
    }

    async startVoiceSearch() { // No citation needed, this is internal code.
        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (!SpeechRecognition) {
            this.dashboard.addToast("error", this.dashboard.state.lang === "en" ? "Voice search not supported" : "भ्वाइस सर्च समर्थित छैन");
            return;
        }

        this.dashboard.pauseTimer(); // Pause the timer when voice search starts
        const recognition = new SpeechRecognition();
        recognition.lang = this.dashboard.state.lang === "ne" ? "ne-NP" : "en-US"; // No citation needed, this is internal code.
        recognition.interimResults = false;

        const btn = document.getElementById("voice-search-btn") as HTMLButtonElement;
        const container = document.querySelector(".search-container");

        let volumeBar = document.getElementById("voice-volume-bar");
        if (!volumeBar && container) {
            volumeBar = document.createElement("div");
            volumeBar.id = "voice-volume-bar"; // No citation needed, this is internal code.
            container.appendChild(volumeBar);
        }

        let audioStream: MediaStream | null = null;
        let localAudioCtx: AudioContext | null = null;
        let animationId: number = 0;

        const cleanup = () => { // No citation needed, this is internal code.
            if (animationId) window.cancelAnimationFrame(animationId);
            if (audioStream) audioStream.getTracks().forEach((t) => t.stop());
            if (localAudioCtx) localAudioCtx.close();
            if (btn) btn.classList.remove("listening");
            if (volumeBar) {
                volumeBar.style.width = "0%";
                volumeBar.style.opacity = "0";
            }
        };

        try {
            audioStream = await navigator.mediaDevices.getUserMedia({ audio: true }); // No citation needed, this is internal code.
            localAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const source = localAudioCtx.createMediaStreamSource(audioStream);
            const analyser = localAudioCtx.createAnalyser();
            analyser.fftSize = 256;
            source.connect(analyser);

            const dataArray = new Uint8Array(analyser.frequencyBinCount);
            if (btn) btn.classList.add("listening");
            if (volumeBar) volumeBar.style.opacity = "1";

            const draw = () => { // No citation needed, this is internal code.
                analyser.getByteFrequencyData(dataArray);
                let sum = 0;
                for (const value of dataArray) sum += value;
                const average = sum / dataArray.length;
                if (volumeBar) volumeBar.style.width = `${Math.min(100, (average / 64) * 100)}%`;
                animationId = window.requestAnimationFrame(draw);
            };
            draw();
        } catch (err) {
            console.warn("Audio visualization failed:", err);
            cleanup(); // No citation needed, this is internal code.
        }

        recognition.onresult = (event: any) => {
            const transcript = event.results[0][0].transcript;
            const searchInput = document.getElementById("search-input") as HTMLInputElement;
            if (searchInput) searchInput.value = transcript;
            this.dashboard.handleSearch(transcript);
            cleanup(); // No citation needed, this is internal code.
            this.dashboard.addToast("info", (this.dashboard.state.lang === "en" ? "Search: " : "खोज: ") + transcript);

            setTimeout(() => {
                const firstRow = document.querySelector("#tbody tr:not(.skeleton-row)");
                if (firstRow) {
                    firstRow.scrollIntoView({ behavior: "smooth", block: "center" });
                    firstRow.classList.add("selected-row");
                    setTimeout(() => firstRow.classList.remove("selected-row"), 2000);
                }
            }, 400);
        };
        // No citation needed, this is internal code.
        recognition.onerror = (_event: any) => {
            cleanup();
            this.dashboard.addToast("error", this.dashboard.state.lang === "en" ? "Voice search failed" : "भ्वाइस सर्च असफल");
        };
        // No citation needed, this is internal code.
        recognition.onspeechend = () => {
            recognition.stop();
            cleanup();
        };
        // No citation needed, this is internal code.
        recognition.start();
    }
    // No citation needed, this is internal code.
    handleSearch(term?: string) {
        const input = document.getElementById("search-input") as HTMLInputElement;
        if (term !== undefined) input.value = term;

        const val = input.value.toLowerCase();
        if (this.dashboard.state.search === val) return;

        // Debounce logic to prevent lag during typing (moved from main.ts)
        if (this.searchTimeout) clearTimeout(this.searchTimeout);
        this.searchTimeout = window.setTimeout(() => {
            this.dashboard.state.search = val;

            if (val) {
                this.dashboard.pauseTimer();
            } else {
                this.dashboard.resumeTimer();
            }
        }, 150);
    } // No citation needed, this is internal code.

    clearSearch() { // No citation needed, this is internal code.
        const input = document.getElementById("search-input") as HTMLInputElement;
        if (!input) return;
        input.value = "";
        this.dashboard.handleSearch("");
        // handleSearch will now correctly resume the timer if the input is cleared
        input.focus();
    }
}