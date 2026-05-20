/**
 * Renders a circular progress indicator as an SVG string for the web UI.
 */
export function renderMiniChart(percent: number, _showTrend = false): string {
  const radius = 8;
  const circumference = 2 * Math.PI * radius;
  const validPercent = Math.min(100, Math.max(0, percent));
  const offset = circumference - (validPercent / 100) * circumference;
  const color = percent >= 80 ? "var(--good)" : percent >= 50 ? "var(--stable)" : "var(--critical)";

  return `
    <svg width="20" height="20" viewBox="0 0 20 20" style="transform: rotate(-90deg); vertical-align: middle;">
      <circle cx="10" cy="10" r="${radius}" fill="none" stroke="var(--border)" stroke-width="2.5" opacity="0.3" />
      <circle class="mini-chart-fill" cx="10" cy="10" r="${radius}" fill="none" stroke="${color}" stroke-width="2.5"
        stroke-dasharray="${circumference}" stroke-dashoffset="${offset}" stroke-linecap="round" />
    </svg>
  `;
}

/**
 * Renders a horizontal progress sparkline for the web UI.
 */
export function renderSparkline(annPerc: number, _totPerc: number): string {
  const color = annPerc >= 80 ? "var(--good)" : annPerc >= 50 ? "var(--stable)" : "var(--critical)";
  const validPerc = Math.min(100, Math.max(0, annPerc));
  return `
    <div class="sparkline-container" style="--target-perc: ${validPerc}; --status-color: ${color};">
      <div class="sparkline-track">
        <div class="sparkline-fill" style="width: ${validPerc}%; background: ${color};"></div>
      </div>
      <span class="sparkline-label"></span>
    </div>
  `;
}

/**
 * Safely triggers a file download from a Blob and handles URL revocation.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = window.URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.style.display = "none";
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    // Use a timeout to ensure the browser has initiated the download
    // before the URL is invalidated.
    setTimeout(() => window.URL.revokeObjectURL(url), 1000);
  }
}

export function showInChartView(_name: string) { /* full original */ }
export function showInCardView(_name: string) { /* full original */ }
export function copyDeepLink(_name: string) { /* full original */ }
export function checkDeepLink() { /* full original */ }
export function shareApp() { /* full original */ }