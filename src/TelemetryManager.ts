import { Dashboard } from "./Dashboard.js";
import { type DashboardState, t } from "./api-utils.js";

export class TelemetryManager {
  private dashboard: Dashboard;
  private readonly MAX_HISTORY = 5;

  constructor(dashboard: Dashboard) {
    this.dashboard = dashboard;
    this.initReactivity();

    // Periodically refresh the tooltip to update the "Last Synced" relative time string
    setInterval(() => {
      this.updateConnectionStatus(this.dashboard.state.history);
    }, 60000); // Refresh every 60 seconds
  }

  private initReactivity() {
    this.dashboard.subscribe(
      ({
        history,
        lang: _lang,
      }: {
        history: { value: number }[];
        lang: string;
      }) => {
        // Destructure 'lang' and rename to '_lang'
        this.updateConnectionStatus(history);
      },
      (state: DashboardState) => ({
        history: state.history,
        lang: state.lang,
      }),
    );
  }

  /**
   * Records a fetch event and updates connection metrics.
   */
  recordFetch(duration: number) {
    const state = this.dashboard.state;

    // 1. Update Last Fetch Time
    state.lastFetchTime = Date.now();

    // 2. Update Latency History
    state.history.push({ value: duration });
    if (state.history.length > this.MAX_HISTORY) {
      state.history.shift();
    }
  }

  private updateConnectionStatus(history: { value: number }[]) {
    const badge = document.getElementById("conn-strength");
    if (!badge || history.length === 0) return;

    const duration = history[history.length - 1].value;
    const avgLatency = Math.round(
      history.reduce((sum, h) => sum + h.value, 0) / history.length,
    );
    const prevDuration =
      history.length > 1 ? history[history.length - 2].value : null;

    let label = t("connExcellent");
    let color = "#4ade80"; // Green

    if (duration > 2500) {
      label = t("connPoor");
      color = "var(--critical)";
    } else if (duration > 1200) {
      label = t("connFair");
      color = "#facc15"; // Yellow
    } else if (duration > 500) {
      label = t("connGood");
      color = "var(--primary)";
    }

    let trendIcon = "";
    if (prevDuration !== null) {
      const threshold = 50; // Ignore minor jitter under 50ms
      if (duration > prevDuration + threshold) {
        trendIcon = " ↗"; // Latency increased (Slower connection)
      } else if (duration < prevDuration - threshold) {
        trendIcon = " ↘"; // Latency decreased (Faster connection)
      }
    }

    // Generate Sparkline SVG points
    const svgWidth = 32;
    const svgHeight = 10;
    const latencies = history.map((h) => h.value);
    // Scale relative to max latency in history, but at least 2000ms
    const maxVal = Math.max(...latencies, 2000);

    const points = latencies
      .map((val, i) => {
        const x =
          latencies.length > 1 ? (i / (latencies.length - 1)) * svgWidth : 0;
        const y = svgHeight - (val / maxVal) * svgHeight;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");

    const sparklineHtml = `
            <svg width="${svgWidth}" height="${svgHeight}" class="conn-sparkline">
                <polyline points="${points}" pathLength="1" />
            </svg>
        `;

    const avgText = `${t("avgLatency") || "Average Latency"}: ${avgLatency}ms`;
    const syncText = `${t("lastSynced") || "Last Synced"}: ${this.dashboard.getRelativeTimeString()}`;

    badge.innerHTML = `<span>${t("connStrength")} ${label}${trendIcon}</span>${sparklineHtml}`;
    badge.setAttribute("data-title", `${avgText} • ${syncText}`);
    badge.style.color = color;
    badge.style.display = "inline-flex";
    badge.style.alignItems = "center";
  }
}
