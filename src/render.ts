import {
  type DashboardState,
  type ProjectReport,
  type ProjectRow,
  animateCounter,
  getColumnKey,
  getProgress,
  t,
  toArabicNumerals,
  toNepaliNumerals,
} from "./api-utils.js";
import { Dashboard } from "./Dashboard.js";
import { renderMiniChart, renderSparkline } from "./utils.js";

/** Global state for incremental rendering */
let currentObserver: IntersectionObserver | null = null;
let dataWorker: Worker | null = null;

let lastWorkerRequestId = 0;
let isWorkerBusy = false;
let lastWorkerParams = "";
let lastProcessedRows: ProjectRow[] = [];
let workerDebounceTimer: number | null = null;

let animationObserver: IntersectionObserver | null = null;

/**
 * Sets up the IntersectionObserver for animating mini-charts as they enter the viewport.
 */
function setupAnimationObserver() {
  if (animationObserver) return; // Only create once

  animationObserver = new IntersectionObserver(
    (entries, observer) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const miniChart = entry.target as HTMLElement;
          const targetPerc = parseFloat(miniChart.dataset.targetPerc || "0");
          const targetColor = miniChart.dataset.targetColor || "var(--border)";

          // Trigger the CSS transition by setting the final values
          miniChart.style.setProperty("--status-color", targetColor);
          animateCounter(miniChart, targetPerc); // This will set --num and trigger transition

          const label = miniChart.querySelector(
            ".mini-chart-label",
          ) as HTMLElement;
          if (label) animateCounter(label, targetPerc, true);

          observer.unobserve(miniChart); // Stop observing once animated
        }
      });
    },
    { threshold: 0.5 },
  ); // Trigger when 50% of the element is visible
}

/**
 * Initializes or re-initializes the Data Worker and its event listeners.
 */
function getWorker(): Worker {
  if (dataWorker) return dataWorker;

  dataWorker = new Worker(new URL("./data-worker.js", import.meta.url), {
    type: "module",
  });
  dataWorker.onmessage = handleWorkerMessage;

  // Handle unexpected worker errors (e.g. out of memory on huge datasets)
  dataWorker.onerror = (err) => {
    console.error("[DataWorker] Critical Error:", err);
    isWorkerBusy = false;
    dataWorker?.terminate();
    dataWorker = null;
    Dashboard.getInstance().addToast(
      "error",
      t("workerError") || "Search engine crashed. Restarting...",
    );
  };

  return dataWorker;
}

/**
 * Processes the response from the background worker.
 */
function handleWorkerMessage(e: MessageEvent) {
  const { rows, requestId } = e.data;

  console.info(`[DataWorker] Completed request #${requestId}`);

  // Ignore stale results if a newer request was dispatched
  if (requestId !== lastWorkerRequestId) return;

  isWorkerBusy = false;
  const state = Dashboard.getInstance().state;
  lastProcessedRows = rows; // Cache results for local view switching
  const currentReport =
    state.view === "cumulative" ? state.cumulativeReport : state.store;
  if (!currentReport) return;

  // Calculate Regex and Stats using the filtered rows
  const highlightRegex = createHighlightRegex(state.search);

  updateResultsCounter(state.search, rows.length, state.lang);
  renderSystemStats(currentReport, rows);

  // Trigger final view-specific render
  const headers = currentReport.headers || [];
  if (state.view === "table") renderTableView(headers, rows, highlightRegex);
  else if (state.view === "cards")
    renderCardView(headers, rows); // Now supports incremental loading
  else if (state.view === "charts") renderChartView(headers, rows);
  else if (state.view === "cumulative")
    renderCumulativeView(headers, rows, highlightRegex);
  setupAnimationObserver(); // Ensure animation observer is ready
}

/**
 * Core render function that updates the UI based on the project state.
 * Now accepts the full DashboardState to dynamically select which report to render.
 */
export function render(state: DashboardState) {
  // Ambient UI Updates (Active even during splash/loading screens)
  const risk = state.riskLevel;
  const isGlitching = state.isGlitching;

  // Spike intensities if glitch is active; otherwise use risk-scaled values
  document.body.style.setProperty(
    "--static-opacity",
    isGlitching ? "0.4" : `${0.03 + risk * 0.12}`,
  );
  document.body.style.setProperty(
    "--shake-intensity",
    isGlitching ? "10px" : `${0.5 + risk * 2.5}px`,
  );
  document.body.style.setProperty(
    "--shake-speed",
    isGlitching ? "0.04s" : `${0.1 - risk * 0.06}s`,
  );
  document.body.style.setProperty(
    "--noise-speed",
    isGlitching ? "0.03s" : `${0.2 - risk * 0.15}s`,
  );
  document.body.style.setProperty(
    "--noise-contrast",
    isGlitching ? "350%" : `${120 + risk * 120}%`,
  );
  document.body.style.setProperty(
    "--noise-brightness",
    isGlitching ? "150%" : `${100 + risk * 50}%`,
  );

  const aberrationIntensity = Math.max(0, (risk - 0.5) / 0.5);
  const chromOffset = isGlitching ? 6 : aberrationIntensity * 2;
  document.body.style.setProperty("--chromatic-red-offset", `${chromOffset}px`);
  document.body.style.setProperty(
    "--chromatic-blue-offset",
    `${-chromOffset}px`,
  );

  // Apply logo retry kick visual state
  document.body.classList.toggle("logo-kick-active", state.isLogoKicking);

  // Apply 'Low Battery' visual state
  const showLowBattery = state.lowBatteryMode && !state.isEmergencyOverride;
  document.body.classList.toggle("low-battery-active", showLowBattery);

  if (showLowBattery) {
    // Force most aggressive chunking when performance is critical
    state.dynamicChunkSize = 5;

    // Ensure the indicator contains the Emergency Override button
    const indicator = document.querySelector(".low-battery-indicator");
    if (indicator && !indicator.querySelector(".emergency-btn")) {
      indicator.innerHTML = `
        <div style="display:flex; align-items:center; gap:10px;">
          <span>${t("lowPerformanceWarning") || "LOW POWER MODE"}</span>
          <button class="emergency-btn" onclick="App.setEmergencyOverride(true)" 
            style="background:white; color:var(--critical); border:none; border-radius:3px; 
            font-size:0.55rem; font-weight:900; padding:2px 6px; cursor:pointer; 
            text-transform:uppercase; letter-spacing:0.05em;">
            ${t("emergencyMode") || "Emergency Mode"}
          </button>
        </div>
      `;
    }
  }

  const currentReport =
    state.view === "cumulative" ? state.cumulativeReport : state.store;

  if (!currentReport) {
    renderSkeletons(state.view);
    return;
  }

  // Disconnect existing observer
  if (currentObserver) {
    currentObserver.disconnect();
  }
  animationObserver?.disconnect(); // Disconnect existing animation observer

  renderDiffBanner();

  // Handle Global Admin Message
  const banner = document.getElementById("admin-banner") as HTMLElement;
  if (currentReport?.adminMessage) {
    const adminTxt = document.getElementById("admin-message-text");
    if (adminTxt) adminTxt.textContent = currentReport.adminMessage ?? null;
    if (banner) banner.style.display = "block";
  } else if (banner) {
    banner.style.display = "none";
  }

  // Audit Tool (immediate debug)
  if (state.search === "verify") {
    runDataAudit(currentReport, currentReport.rows, currentReport.headers);
  }

  // Check if data processing parameters have actually changed
  const workerParams = JSON.stringify({
    search: state.search,
    sort: state.sort,
    lang: state.lang,
    reportDate: currentReport.lastUpdate,
  });

  if (workerParams === lastWorkerParams) {
    // If parameters haven't changed but the view has, render immediately with cached data
    if (lastProcessedRows.length > 0) {
      const highlightRegex = createHighlightRegex(state.search);
      const headers = currentReport.headers || [];
      if (state.view === "table")
        renderTableView(headers, lastProcessedRows, highlightRegex);
      else if (state.view === "cards")
        renderCardView(headers, lastProcessedRows);
      else if (state.view === "charts")
        renderChartView(headers, lastProcessedRows);
      else if (state.view === "cumulative")
        renderCumulativeView(headers, lastProcessedRows, highlightRegex);
    }
    return;
  }

  // Debounce the worker dispatch to batch multiple state updates (e.g. search + view change)
  if (workerDebounceTimer) window.clearTimeout(workerDebounceTimer);

  // Show skeletons immediately for responsiveness
  renderSkeletons(state.view);

  workerDebounceTimer = window.setTimeout(() => {
    // If the worker is still busy with an old request, terminate it to save CPU/Battery.
    if (isWorkerBusy && dataWorker) {
      console.warn(
        `[DataWorker] Terminating busy worker (Request #${lastWorkerRequestId})`,
      );
      renderSkeletons(state.view, true); // Trigger "Cancelling..." UI state
      dataWorker.terminate();
      dataWorker = null; // Force recreation on next getWorker call
    }

    lastWorkerRequestId++;
    lastWorkerParams = workerParams;
    isWorkerBusy = true;

    getWorker().postMessage({
      rows: currentReport.rows,
      search: state.search,
      sort: state.sort,
      lang: state.lang,
      requestId: lastWorkerRequestId,
    });
  }, Dashboard.getInstance().state.workerDebounceTime);
}

function updateResultsCounter(
  searchStr: string | undefined,
  count: number,
  lang: string,
) {
  const resCounter = document.getElementById("results-count");
  if (!resCounter) return;

  resCounter.classList.remove("badge-loading");

  if (searchStr && count > 0) {
    const dispNum = lang === "ne" ? toNepaliNumerals(count) : count;
    const newText = `${dispNum} ${t("results")}`;

    // Only trigger the pulse animation if the text actually changed
    if (resCounter.innerText !== newText) {
      resCounter.innerText = newText;
      resCounter.classList.remove("badge-pulse");
      void resCounter.offsetWidth; // Force reflow to allow re-triggering animation
      resCounter.classList.add("badge-pulse");
      Dashboard.getInstance().muffleMusicForSearch(false); // Unmuffle on successful result
      Dashboard.getInstance().playUi("ping", true, 1.2); // High-pitched ping for success
    }

    resCounter.style.display = "block";
    resCounter.style.background = "var(--primary)";
    resCounter.classList.remove("glitch");
  } else {
    Dashboard.getInstance().muffleMusicForSearch(false); // Unmuffle if search is cleared or no results
    resCounter.style.display = "none";
    resCounter.classList.remove("glitch");
  }
}

function createHighlightRegex(searchStr?: string): RegExp | null {
  if (searchStr) {
    const arabicNormalizedSearchStr = toArabicNumerals(searchStr);
    const escapedSearchStr = arabicNormalizedSearchStr.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&",
    );
    const numeralAgnosticPattern = escapedSearchStr.replace(
      /[0-9]/g,
      (digit) => {
        const nepalDigit = toNepaliNumerals(parseInt(digit, 10));
        return `(${digit}|${nepalDigit})`;
      },
    );
    return new RegExp(`(${numeralAgnosticPattern})`, "gi");
  }
  return null;
}

function renderSystemStats(json: ProjectReport, rows: ProjectRow[]) {
  const dashboard = Dashboard.getInstance();
  const total = rows.length;
  const good = rows.filter((r) => r._status === "good").length;
  const critical = rows.filter((r) => r._status === "critical").length;
  const percent = total > 0 ? Math.round((good / total) * 100) : 0;
  const isNe = dashboard.state.lang === "ne";

  // Set global status color based on risk level for the vignette and UI ambiance
  const globalStatusColor =
    percent > 80
      ? "var(--good)"
      : percent > 40
        ? "var(--stable)"
        : "var(--critical)";
  document.body.style.setProperty("--status-color", globalStatusColor);

  const kpiStats = document.getElementById("kpi-stats");
  if (kpiStats) {
    kpiStats.innerHTML = `
      <div class="kpi-card" style="--num: ${total}; --status-color: var(--primary)"><h4>${t("total")}</h4><p class="kpi-counter"></p></div>
      <div class="kpi-card" style="--num: ${good}; --status-color: var(--good)"><h4>${t("met")}</h4><p class="kpi-counter"></p></div>
      <div class="kpi-card" style="--num: ${critical}; --status-color: var(--critical)"><h4>${t("attention")}</h4><p class="kpi-counter"></p></div>
    `;
    kpiStats.querySelectorAll(".kpi-counter").forEach((p, i) => {
      const val = [total, good, critical][i];
      animateCounter(p as HTMLElement, val);
    });
  }

  const chartPath = document.getElementById("chart-path");
  if (chartPath) chartPath.setAttribute("stroke-dasharray", `${percent}, 100`);
  const chartPerc = document.getElementById("chart-percent");
  if (chartPerc) {
    chartPerc.style.setProperty("--status-color", globalStatusColor);
    animateCounter(chartPerc, percent, true);
  }

  const updateEl = document.getElementById("last-update");
  if (updateEl)
    updateEl.innerText = `${t("update")} ${isNe ? toNepaliNumerals(json.lastUpdate) : `${json.lastUpdate} BS`}`;
}

/**
 * Helper to create a single table row as a DOM element.
 */
function createTableRow(
  r: ProjectRow,
  headers: string[],
  highlightRegex: RegExp | null,
): HTMLTableRowElement {
  const tr = document.createElement("tr");
  const name = r[headers[0]] || "";
  const annualPerc = getProgress(r, headers);
  const statusColor =
    annualPerc > 80
      ? "var(--good)"
      : annualPerc > 40
        ? "var(--stable)"
        : "var(--critical)";

  tr.setAttribute("data-indicator-name", name.replace(/"/g, "&quot;"));
  tr.classList.add("fade-in");

  // Action Cell
  const tdAction = document.createElement("td");
  // Optimization: Attach click listener with glitch support for critical data
  tdAction.innerHTML = `<div style="display:flex; align-items:center; gap:8px;">${renderMiniChart(annualPerc, true)}<button class="icon-btn table-chart-btn" data-indicator="${name.replace(/"/g, "&quot;")}">📊</button></div>`;
  const btn = tdAction.querySelector(".table-chart-btn");
  btn?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (r._status === "critical") Dashboard.getInstance().triggerGlitch();
    (window as any).App.showInChartView(name);
  });

  // Trigger synchronized animation
  const miniChart = tdAction.querySelector(".mini-chart-css") as HTMLElement;
  if (miniChart) {
    miniChart.style.setProperty("--status-color", statusColor);
    animateCounter(miniChart, annualPerc);
    const label = miniChart.querySelector(".mini-chart-label") as HTMLElement;
    if (label) animateCounter(label, annualPerc, true);
  }

  tr.appendChild(tdAction);

  // Data Cells
  headers.forEach((h, i) => {
    const td = document.createElement("td");
    let val = t(r[h]);
    if (highlightRegex) val = String(val).replace(highlightRegex, "<b>$1</b>");

    const isStatus = h.toLowerCase().includes("status") || i === 0;
    const color = isStatus
      ? r._status === "good"
        ? "var(--good)"
        : r._status === "critical"
          ? "var(--critical)"
          : "var(--stable)"
      : "var(--text)";

    td.style.color = color;
    td.style.fontWeight = isStatus ? "700" : "400";
    td.innerHTML = val;
    tr.appendChild(td);
  });

  return tr;
}

function renderTableView(
  headers: string[],
  rows: ProjectRow[],
  highlightRegex: RegExp | null,
) {
  const dashboard = Dashboard.getInstance();
  const theadEl = document.getElementById("thead");
  const tbodyEl = document.getElementById("tbody");
  if (!theadEl || !tbodyEl) return;

  // 1. Build Header
  let thead = `<tr><th></th>`;
  headers.forEach((h) => {
    thead += `<th onclick="App.sortData('${h}'); event.stopPropagation()">${t(h)} ${dashboard.state.sort.key === h ? (dashboard.state.sort.dir === 1 ? "↑" : "↓") : ""}</th>`;
  });
  thead += "</tr>";
  theadEl.innerHTML = thead;

  // 2. Clear Body
  tbodyEl.innerHTML = "";

  // 3. Setup Pagination Logic
  let renderedCount = 0;

  const renderNextChunk = () => {
    const fragment = document.createDocumentFragment();
    const chunkSize = dashboard.state.dynamicChunkSize;
    const end = Math.min(renderedCount + chunkSize, rows.length);
    const newRows: HTMLTableRowElement[] = [];

    for (let i = renderedCount; i < end; i++) {
      const row = createTableRow(rows[i], headers, highlightRegex);
      fragment.appendChild(row);
      newRows.push(row);
    }

    tbodyEl.appendChild(fragment);

    // Observe mini-charts in newly added rows for animation
    newRows.forEach((row) => {
      const miniChart = row.querySelector(
        ".mini-chart-css.animated-on-scroll",
      ) as HTMLElement;
      if (miniChart && animationObserver) {
        animationObserver.observe(miniChart);
      }
    });
    renderedCount = end;

    // 4. Update or Create Sentinel for IntersectionObserver
    if (renderedCount < rows.length) {
      let sentinel = document.getElementById("render-sentinel");
      if (!sentinel) {
        sentinel = document.createElement("tr");
        sentinel.id = "render-sentinel";
        sentinel.innerHTML = `<td colspan="${headers.length + 1}" style="text-align:center; padding:20px; opacity:0.5;">${t("loadingMore") || "Loading..."}</td>`;
      }
      tbodyEl.appendChild(sentinel); // Move sentinel to end

      currentObserver = new IntersectionObserver(
        (entries) => {
          if (entries[0].isIntersecting) {
            currentObserver?.disconnect();
            renderNextChunk();
          }
        },
        { rootMargin: "200px" },
      );
      currentObserver.observe(sentinel);
    } else {
      document.getElementById("render-sentinel")?.remove();
    }
  };

  renderNextChunk();
}

/**
 * Renders the dedicated Cumulative Report section.
 * This provides a formal, branded presentation distinct from the interactive table.
 */
function renderCumulativeView(
  headers: string[],
  rows: ProjectRow[],
  highlightRegex: RegExp | null,
) {
  const container = document.getElementById("view-cumulative");
  if (!container) return;
  const isNe = Dashboard.getInstance().state.lang === "ne";

  // Paginate rows for better performance
  const rowLimit = 50;
  const visibleRows = rows.slice(0, rowLimit);
  const hasMore = rows.length > rowLimit;

  let tbodyHtml = "";
  visibleRows.forEach((r: ProjectRow) => {
    const annualPerc = getProgress(r, headers);
    tbodyHtml += `
                <tr class="cumulative-row" style="background:var(--surface); border-radius:12px; transition:transform 0.2s;">
                  <td style="padding:15px; border-radius:12px 0 0 12px;">${renderMiniChart(annualPerc, false)}</td>
                  ${headers
                    .map((h, i) => {
                      let val = t(r[h]);
                      if (highlightRegex)
                        val = String(val).replace(highlightRegex, "<b>$1</b>");
                      const isStatus =
                        h.toLowerCase().includes("status") || i === 0;
                      const color = isStatus
                        ? r._status === "good"
                          ? "var(--good)"
                          : r._status === "critical"
                            ? "var(--critical)"
                            : "var(--stable)"
                        : "var(--text)";
                      return `<td style="padding:15px; color:${color}; font-weight:${isStatus ? 700 : 400}; ${i === headers.length - 1 ? "border-radius:0 12px 12px 0;" : ""}">${val}</td>`;
                    })
                    .join("")}
                </tr>`;
  });

  const showingText =
    t("showingOf", rowLimit).replace(
      "{{total}}",
      isNe ? toNepaliNumerals(rows.length) : rows.length.toString(),
    ) || `Showing ${rowLimit} of ${rows.length} items`;

  container.innerHTML = `
    <div class="cumulative-report-section fade-in">
      <div class="cumulative-header" style="display:flex; justify-content:space-between; align-items:center; padding-bottom:15px; border-bottom:2px solid var(--primary-soft);">
        <div style="display:flex; align-items:center; gap:15px;">
          <div style="font-size:2rem; background:var(--primary-soft); width:50px; height:50px; display:flex; align-items:center; justify-content:center; border-radius:12px;">📊</div>
          <div>
            <h2 style="margin:0; font-size:1.2rem; color:var(--primary);">${t("monthlyReport") || "Monthly Progress Report"}</h2>
            <p style="margin:2px 0 0; font-size:0.8rem; opacity:0.6;">${t("consolidatedView") || "Consolidated Performance Data"}</p>
          </div>
        </div>
        <div class="cumulative-meta">
          <span class="status-badge good" style="background:var(--good); color:var(--text-on-accent); padding:4px 12px; border-radius:20px; font-size:0.7rem; font-weight:800;">${t("official") || "OFFICIAL"}</span>
        </div> 
      </div>

      <div class="table-container" style="margin-top:24px; overflow-x:auto;">
        <table class="data-table cumulative-table" style="width:100%; border-collapse:separate; border-spacing:0 8px;">
          <thead>
            <tr style="text-align:left; font-size:0.75rem; text-transform:uppercase; letter-spacing:0.05em; opacity:0.7;">
              <th style="padding:10px;"></th>
              ${headers.map((h) => `<th style="padding:10px;">${t(h)}</th>`).join("")}
            </tr>
          </thead>
          <tbody>
            ${tbodyHtml}
            ${hasMore ? `<tr><td colspan="${headers.length + 1}" style="text-align:center;padding:20px;color:var(--text-light)">${showingText}</td></tr>` : ""}
          </tbody>
        </table>
      </div>
      
      <div class="cumulative-footer" style="margin-top:30px; padding:20px; background:var(--bg-soft); border-radius:12px; border:1px dashed var(--border); text-align:center;">
        <p style="font-size:0.75rem; margin:0; opacity:0.8;">${t("cumulativeNote") || "This report is a point-in-time snapshot of the Department of Roads MIS. All figures are subject to final verification."}</p>
      </div>
    </div>
  `;

  // After setting innerHTML, find mini-charts and observe them
  const miniCharts = container.querySelectorAll(
    ".mini-chart-css.animated-on-scroll",
  ) as NodeListOf<HTMLElement>;
  miniCharts.forEach((miniChart) => {
    if (animationObserver) animationObserver.observe(miniChart);
  });
}

/**
 * Helper to create a single card as a DOM element.
 */
function createDataCard(
  r: ProjectRow,
  headers: string[],
  indicatorKey?: string,
): HTMLDivElement {
  const card = document.createElement("div");
  card.className = "data-card";
  const name = indicatorKey ? r[indicatorKey] || "" : "";
  const annPerc = getProgress(r, headers);

  card.setAttribute("data-indicator", name.replace(/"/g, "&quot;"));
  card.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:start">
      <h3 style="margin:0; font-size:0.9rem;">${t(name)}</h3>
      <div class="card-chart-container">${renderMiniChart(annPerc, true)}</div>
    </div>
  `;
  return card;
}

function renderCardView(headers: string[], rows: ProjectRow[]) {
  const indicatorKey = getColumnKey(headers, "indicator");
  const dashboard = Dashboard.getInstance();
  const cardContainer = document.getElementById("view-cards");
  if (cardContainer) {
    cardContainer.innerHTML = "";
    let renderedCount = 0;

    const renderNextCards = () => {
      const fragment = document.createDocumentFragment();
      const chunkSize = dashboard.state.dynamicChunkSize;
      const end = Math.min(renderedCount + chunkSize, rows.length);

      for (let i = renderedCount; i < end; i++) {
        const card = createDataCard(rows[i], headers, indicatorKey);
        fragment.appendChild(card);

        // Register mini-chart for scroll-animation
        const mc = card.querySelector(".mini-chart-css.animated-on-scroll");
        if (mc && animationObserver) animationObserver.observe(mc);
      }

      cardContainer.appendChild(fragment);
      renderedCount = end;

      if (renderedCount < rows.length) {
        const sentinel = document.createElement("div");
        sentinel.className = "card-sentinel";
        sentinel.style.height = "20px";
        cardContainer.appendChild(sentinel);

        const obs = new IntersectionObserver((entries) => {
          if (entries[0].isIntersecting) {
            obs.disconnect();
            sentinel.remove();
            renderNextCards();
          }
        });
        obs.observe(sentinel);
      }
    };

    renderNextCards();
  }
}

function renderChartView(headers: string[], rows: ProjectRow[]) {
  const indicatorKey = getColumnKey(headers, "indicator");

  let chartHtml = "";
  rows.forEach((r: ProjectRow) => {
    const prog = getProgress(r, headers as any);
    const name = indicatorKey ? r[indicatorKey] || "" : "";

    chartHtml += `<div class="chart-card" data-indicator="${name.replace(/"/g, "&quot;")}">
      <h4>${t(name)}</h4>
      ${renderSparkline(prog, prog)}
    </div>`;
  });
  const chartContainer = document.getElementById("view-charts");
  if (chartContainer) chartContainer.innerHTML = chartHtml;
}

function runDataAudit(
  _json: ProjectReport,
  rows: ProjectRow[],
  headers: string[],
) {
  const indicatorKey = getColumnKey(headers, "indicator");

  console.group("Data Integrity Audit");
  const audit = rows.map((r: ProjectRow) => ({
    Indicator: indicatorKey ? r[indicatorKey] : "N/A",
    "Annual %": getProgress(r, headers as any) + "%",
  }));
  console.table(audit);
  console.groupEnd();
}

function renderDiffBanner() {
  const dashboard = Dashboard.getInstance();
  let banner = document.getElementById("diff-banner");
  if (!banner) {
    const mainEl = document.querySelector("main");
    if (!mainEl) return;
    banner = document.createElement("div");
    banner.id = "diff-banner";
    banner.className = "diff-banner";
    mainEl.insertBefore(banner, mainEl.firstChild);
  }

  const state = dashboard.state;
  if (state.diffMode && state.compareReport && state.store) {
    const date = state.compareReport.lastUpdate;
    const dispDate = state.lang === "ne" ? toNepaliNumerals(date) : date;
    banner.innerHTML = ` 
      <div style="display:flex; justify-content:space-between; align-items:center; padding:0 20px; color:var(--diff-banner-text-color);">
        <div style="display:flex; align-items:center; gap:12px;">
          <span style="font-size:1.2rem;">↔️</span>
          <div>
            <div style="font-size:0.8rem; font-weight:800;">${t("comparingWith") || "Comparing with"} ${dispDate}</div>
          </div>
        </div>
        <button onclick="App.toggleDiffMode(null)" style="background:var(--bg-transparent-light); border:none; color:var(--text-on-accent); padding:6px 12px; border-radius:8px; cursor:pointer; font-size:0.7rem; font-weight:800;">
          ${t("exitDiff") || "EXIT"}
        </button>
      </div>
    `;
    banner.style.display = "block";
  } else {
    banner.style.display = "none";
  }
}

/**
 * Renders placeholder elements while data is fetching.
 */
function renderSkeletons(view: string, isCancelling = false) {
  // Accept view as argument

  // 1. Clear previous content but keep container structure
  const containers = [
    "view-table",
    "view-cards",
    "view-charts",
    "view-cumulative",
  ];

  // Handle "Cancelling..." status badge update
  const resCounter = document.getElementById("results-count");
  if (resCounter) {
    resCounter.classList.remove("glitch", "badge-loading");
    resCounter.style.background = "var(--primary)";

    if (isCancelling) {
      const cancellingText = t("cancelling") || "Cancelling...";
      if (resCounter.innerText !== cancellingText) {
        resCounter.innerText = cancellingText;
        resCounter.classList.remove("badge-pulse");
        void resCounter.offsetWidth;
        resCounter.classList.add("badge-pulse");
        Dashboard.getInstance().playUi("pop", true, 0.8); // Tactile "pop" for interruption
      }
      resCounter.style.display = "block";
      resCounter.style.background = "var(--critical)";
      resCounter.classList.add("glitch");
    } else {
      const state = Dashboard.getInstance().state;
      if (state.search) {
        const searchingText = t("searching") || "Searching...";
        if (resCounter.innerText !== searchingText) {
          resCounter.innerText = searchingText;
          resCounter.classList.remove("badge-pulse");
          void resCounter.offsetWidth;
          resCounter.classList.add("badge-pulse");
          Dashboard.getInstance().muffleMusicForSearch(true); // Muffle music for search
          Dashboard.getInstance().playUi("click", true, 1.4); // Subtle click for search start
        }
        resCounter.style.display = "block";
        resCounter.classList.add("badge-loading");
      }
    }
  }

  containers.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = "";
    el?.classList.remove("active-view"); // Ensure all are inactive first
  });

  if (view === "table") {
    const tbody = document.getElementById("tbody");
    if (tbody) {
      tbody.innerHTML = Array(8)
        .fill(0)
        .map(
          () => `
        <tr class="skeleton-row">
          <td><div></div></td>
          ${Array(5).fill("<td><div></div></td>").join("")}
        </tr>
      `,
        )
        .join("");
    }
  } else if (view === "cumulative") {
    // Use table skeletons for cumulative view
    const container = document.getElementById("view-cumulative");
    if (container) {
      container.innerHTML = `
        <div class="skeleton-cumulative" style="padding:20px;">
          <div style="height: 80px; width: 100%; border-radius: 12px; margin-bottom: 30px;" class="skeleton-row"></div>
          <div style="height: 400px; width: 100%; border-radius: 12px;" class="skeleton-row"></div>
        </div>`;
    }
  } else if (view === "cards") {
    const container = document.getElementById("view-cards");
    if (container) {
      container.innerHTML = Array(6)
        .fill(0)
        .map(
          () => `
        <div class="skeleton-card">
          <div style="width: 70%; height: 14px; margin-bottom: 12px;"></div>
          <div style="width: 40%; height: 10px;"></div>
          <div style="margin-top: 20px; height: 40px; border-radius: 8px;"></div>
        </div>
      `,
        )
        .join("");
    }
  } else if (view === "charts") {
    const container = document.getElementById("view-charts");
    if (container) {
      container.innerHTML = Array(4)
        .fill(0)
        .map(
          () => `
        <div class="chart-card">
          <div class="skeleton-brief-line" style="width: 60%"></div>
          <div class="skeleton-brief-line" style="width: 100%; height: 60px; margin: 20px 0"></div>
          <div style="display: flex; gap: 10px">
             <div class="skeleton-brief-line" style="flex: 1"></div>
             <div class="skeleton-brief-line" style="flex: 1"></div>
          </div>
        </div>
      `,
        )
        .join("");
    }
  }

  // Ensure the correct view container is visible
  containers.forEach((id) => {
    const el = document.getElementById(id);
    if (el && id === `view-${view}`) {
      el.classList.add("active-view");
    }
  });
}
