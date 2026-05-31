import { Dashboard } from "./Dashboard.js";
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

import { renderMiniChart, renderSparkline } from "./utils.js";

/**
 * =========================================================
 * GLOBAL RENDER STATE
 * =========================================================
 */
let worker: Worker | null = null;
let currentObserver: IntersectionObserver | null = null;
let animationObserver: IntersectionObserver | null = null;

let lastRequestId = 0;
let lastParams = "";
let lastRows: ProjectRow[] = [];
let debounceTimer: number | null = null;

/**
 * =========================================================
 * WORKER
 * =========================================================
 */
function getWorker(): Worker {
  if (worker) return worker;

  worker = new Worker(new URL("./data-worker.js", import.meta.url), {
    type: "module",
  });

  worker.onmessage = onWorkerMessage;

  worker.onerror = (err) => {
    console.error("[Worker Error]", err);
    worker?.terminate();
    worker = null;
  };

  return worker;
}

function onWorkerMessage(e: MessageEvent) {
  const { rows, requestId } = e.data;

  if (requestId !== lastRequestId) return;

  const state = Dashboard.getInstance().state;
  lastRows = rows;

  const report =
    state.view === "cumulative"
      ? state.cumulativeReport
      : state.store;

  if (!report) return;

  const headers = report.headers || [];

  if (state.view === "table") renderTable(headers, rows, state);
  if (state.view === "cards") renderCards(headers, rows);
  if (state.view === "charts") renderCharts(headers, rows);
  if (state.view === "cumulative") renderCumulative(headers, rows, report);
}

/**
 * =========================================================
 * MAIN RENDER ENTRY
 * =========================================================
 */
export function render(state: DashboardState) {
  const report =
    state.view === "cumulative"
      ? state.cumulativeReport
      : state.store;

  if (!report) {
    renderSkeleton(state.view);
    return;
  }

  const params = JSON.stringify({
    search: state.search,
    sort: state.sort,
    view: state.view,
  });

  if (params === lastParams && lastRows.length > 0) {
    rerenderFromCache(state.view, state);
    return;
  }

  lastParams = params;

  if (debounceTimer) clearTimeout(debounceTimer);

  renderSkeleton(state.view);

  debounceTimer = window.setTimeout(() => {
    lastRequestId++;

    getWorker().postMessage({
      rows: report.rows,
      search: state.search,
      sort: state.sort,
      requestId: lastRequestId,
    });
  }, 200);
}

/**
 * =========================================================
 * TABLE VIEW
 * =========================================================
 */
function renderTable(headers: string[], rows: ProjectRow[], state: DashboardState) {
  const tbody = document.getElementById("tbody");
  const thead = document.getElementById("thead");

  if (!tbody || !thead) return;

  thead.innerHTML =
    "<tr>" +
    headers.map(h =>
      `<th onclick="App.sort('${h}')">${t(h)}</th>`
    ).join("") +
    "</tr>";

  tbody.innerHTML = "";

  rows.forEach(r => {
    const tr = document.createElement("tr");

    headers.forEach((h, i) => {
      const td = document.createElement("td");

      let val = t(r[h]);
      td.innerHTML = val;

      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  });
}

/**
 * =========================================================
 * CARDS VIEW
 * =========================================================
 */
function renderCards(headers: string[], rows: ProjectRow[]) {
  const container = document.getElementById("view-cards");
  if (!container) return;

  container.innerHTML = "";

  rows.forEach(r => {
    const div = document.createElement("div");
    div.className = "card";

    const key = getColumnKey(headers, "indicator");
    const name = key ? r[key] : "";

    div.innerHTML = `
      <h3>${t(name)}</h3>
      <div>${renderMiniChart(getProgress(r, headers), true)}</div>
    `;

    container.appendChild(div);
  });
}

/**
 * =========================================================
 * CHART VIEW
 * =========================================================
 */
function renderCharts(headers: string[], rows: ProjectRow[]) {
  const container = document.getElementById("view-charts");
  if (!container) return;

  container.innerHTML = rows
    .map(r => {
      const name = r[getColumnKey(headers, "indicator") || ""] || "";
      return `
        <div class="chart">
          <h4>${t(name)}</h4>
          ${renderSparkline(getProgress(r, headers), 0)}
        </div>
      `;
    })
    .join("");
}

/**
 * =========================================================
 * CUMULATIVE VIEW
 * =========================================================
 */
function renderCumulative(
  headers: string[],
  rows: ProjectRow[],
  report: ProjectReport
) {
  const container = document.getElementById("view-cumulative");
  if (!container) return;

  container.innerHTML = `
    <h2>${t("monthlyReport")}</h2>
    <p>${rows.length} records</p>
  `;
}

/**
 * =========================================================
 * CACHE RERENDER
 * =========================================================
 */
function rerenderFromCache(view: string, state: DashboardState) {
  if (view === "table") renderTable([], lastRows, state);
  if (view === "cards") renderCards([], lastRows);
  if (view === "charts") renderCharts([], lastRows);
}

/**
 * =========================================================
 * SKELETON
 * =========================================================
 */
function renderSkeleton(view: string) {
  const map: Record<string, string> = {
    table: "#tbody",
    cards: "#view-cards",
    charts: "#view-charts",
    cumulative: "#view-cumulative",
  };

  const el = document.querySelector(map[view]);
  if (el) el.innerHTML = "Loading...";
}