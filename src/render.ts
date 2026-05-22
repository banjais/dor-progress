import { Dashboard, DashboardState } from "./Dashboard.js";
import { getProgress, t, toNepaliNumerals, toArabicNumerals, getColumnKey } from "./api-utils.js";
import { renderMiniChart, renderSparkline } from "./utils.js"; // Import I18N directly
import { ProjectReport, ProjectRow } from "../shared/types.ts";

/**
 * Core render function that updates the UI based on the project state.
 * Now accepts the full DashboardState to dynamically select which report to render.
 */
export function render(state: DashboardState) {
  const dashboard = Dashboard.getInstance();
  const currentReport = state.view === "cumulative" ? state.cumulativeReport : state.store;

  if (!currentReport) {
    renderSkeletons(state.view);
    return;
  }

  const headers = currentReport.headers || [];
  let rows = [...(currentReport.rows || [])];

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

  // 1. Filter Logic
  if (dashboard.state.search && dashboard.state.search !== "verify") {
    rows = rows.filter((r: ProjectRow) =>
      Object.values(r).some(
        (v) =>
          (typeof v === "string" || typeof v === "number" || typeof v === "boolean") &&
          String(v).toLowerCase().includes(dashboard.state.search),
      )
    );
  }

  // Update Results Counter
  const resCounter = document.getElementById("results-count") as HTMLElement;
  if (state.search && rows.length > 0 && resCounter) {
    const dispNum = state.lang === "ne" ? toNepaliNumerals(rows.length) : rows.length;
    resCounter.innerText = `${dispNum} ${t("results")}`;
    resCounter.style.display = "block";
  } else if (resCounter) {
    resCounter.style.display = "none";
  }

  // 2. Audit Tool (hidden)
  if (state.search === "verify") {
    runDataAudit(currentReport, rows, headers);
  }

  // 3. Highlight Regex
  const searchStr = state.search;
  let highlightRegex: RegExp | null = null;
  if (searchStr) {
    const isNumericSearch = !isNaN(parseFloat(toArabicNumerals(searchStr))) && isFinite(Number(toArabicNumerals(searchStr)));
    const pattern = isNumericSearch
      ? `(${toArabicNumerals(searchStr)}|${toNepaliNumerals(toArabicNumerals(searchStr))})`
      : `(${searchStr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`;
    highlightRegex = new RegExp(pattern, "gi");
  }

  renderSystemStats(currentReport, rows);

  if (state.view === "table") renderTableView(headers, rows, highlightRegex);
  else if (state.view === "cards") renderCardView(headers, rows);
  else if (state.view === "charts") renderChartView(headers, rows);
  else if (state.view === "cumulative") renderCumulativeView(headers, rows, highlightRegex);
}

function renderSystemStats(json: ProjectReport, rows: ProjectRow[]) {
  const dashboard = Dashboard.getInstance();
  const total = rows.length;
  const good = rows.filter((r) => r._status === "good").length;
  const critical = rows.filter((r) => r._status === "critical").length;
  const percent = total > 0 ? Math.round((good / total) * 100) : 0;
  const isNe = dashboard.state.lang === "ne";

  const kpiStats = document.getElementById("kpi-stats");
  if (kpiStats) {
    kpiStats.innerHTML = `
      <div class="kpi-card" style="--target-perc: ${total}"><h4>${t("total")}</h4><p class="kpi-counter"></p></div>
      <div class="kpi-card" style="--target-perc: ${good}; border-left-color:var(--good)"><h4>${t("met")}</h4><p class="kpi-counter"></p></div>
      <div class="kpi-card" style="--target-perc: ${critical}; border-left-color:var(--critical)"><h4>${t("attention")}</h4><p class="kpi-counter"></p></div>
    `;
  }

  const chartPath = document.getElementById("chart-path");
  if (chartPath) chartPath.setAttribute("stroke-dasharray", `${percent}, 100`);
  const chartPerc = document.getElementById("chart-percent");
  if (chartPerc) {
    chartPerc.style.setProperty("--target-perc", percent.toString());
    chartPerc.classList.add("kpi-counter-perc");
    chartPerc.innerText = "";
  }

  if (json?.lastUpdate) { // Use the passed json (which is currentReport)
    const updateEl = document.getElementById("last-update");
    if (updateEl) updateEl.innerText = `${t("update")} ${isNe ? toNepaliNumerals(json.lastUpdate) : `${json.lastUpdate} BS`}`;
  }
}
function renderTableView(headers: string[], rows: ProjectRow[], highlightRegex: RegExp | null) {
  const dashboard = Dashboard.getInstance();

  // Build thead HTML
  let thead = `<tr><th></th>`;
  headers.forEach((h) => {
    thead += `<th onclick="App.sortData('${h}'); event.stopPropagation()">${t(h)} ${dashboard.state.sort.key === h ? (dashboard.state.sort.dir === 1 ? "↑" : "↓") : ""}</th>`;
  });
  thead += "</tr>";
  const theadEl = document.getElementById("thead");
  if (theadEl) theadEl.innerHTML = thead;

  // Build tbody HTML with row limit for performance
  const rowLimit = 100;
  const rowsToRender = rows.slice(0, rowLimit);
  let tbody = "";

  rowsToRender.forEach((r: ProjectRow) => {
    const name = r[headers[0]] || "";
    const annualPerc = getProgress(r, headers);
    tbody += `<tr data-indicator-name="${name.replace(/"/g, "&quot;")}" class="fade-in">`;
    tbody += `<td><div style="display:flex; align-items:center; gap:8px;">${renderMiniChart(annualPerc, true)}<button class="icon-btn table-chart-btn" data-indicator="${name.replace(/"/g, "&quot;")}">📊</button></div></td>`;

    headers.forEach((h, i) => {
      let val = t(r[h]);
      if (highlightRegex) val = String(val).replace(highlightRegex, "<b>$1</b>");
      const isStatus = h.toLowerCase().includes("status") || i === 0;
      const color = isStatus ? (r._status === "good" ? "var(--good)" : r._status === "critical" ? "var(--critical)" : "var(--stable)") : "var(--text)";
      tbody += `<td style="color:${color}; font-weight:${isStatus ? 700 : 400}">${val}</td>`;
    });
    tbody += "</tr>";
  });

  // If more rows exist, add a placeholder for lazy loading
  if (rows.length > rowLimit) {
    tbody += `<tr id="load-more-row"><td colspan="${headers.length + 1}" style="text-align:center;padding:20px">Loading more items...</td></tr>`;
  }

  const tbodyEl = document.getElementById("tbody");
  if (tbodyEl) tbodyEl.innerHTML = tbody;
}

/**
  * Renders the dedicated Cumulative Report section.
  * This provides a formal, branded presentation distinct from the interactive table.
  */
function renderCumulativeView(headers: string[], rows: ProjectRow[], highlightRegex: RegExp | null) {
  const container = document.getElementById("view-cumulative");
  if (!container) return;

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
                  ${headers.map((h, i) => {
      let val = t(r[h]);
      if (highlightRegex) val = String(val).replace(highlightRegex, "<b>$1</b>");
      const isStatus = h.toLowerCase().includes("status") || i === 0;
      const color = isStatus ? (r._status === "good" ? "var(--good)" : r._status === "critical" ? "var(--critical)" : "var(--stable)") : "var(--text)";
      return `<td style="padding:15px; color:${color}; font-weight:${isStatus ? 700 : 400}; ${i === headers.length - 1 ? 'border-radius:0 12px 12px 0;' : ''}">${val}</td>`;
    }).join('')}
                </tr>`;
  });

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
          <span class="status-badge good" style="background:var(--good); color:white; padding:4px 12px; border-radius:20px; font-size:0.7rem; font-weight:800;">${t("official") || "OFFICIAL"}</span>
        </div>
      </div>

      <div class="table-container" style="margin-top:24px; overflow-x:auto;">
        <table class="data-table cumulative-table" style="width:100%; border-collapse:separate; border-spacing:0 8px;">
          <thead>
            <tr style="text-align:left; font-size:0.75rem; text-transform:uppercase; letter-spacing:0.05em; opacity:0.7;">
              <th style="padding:10px;"></th>
              ${headers.map(h => `<th style="padding:10px;">${t(h)}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${tbodyHtml}
            ${hasMore ? `<tr><td colspan="${headers.length + 1}" style="text-align:center;padding:20px;color:var(--text-light)">Showing ${rowLimit} of ${rows.length} items</td></tr>` : ''}
          </tbody>
        </table>
      </div>
      
      <div class="cumulative-footer" style="margin-top:30px; padding:20px; background:var(--bg-soft); border-radius:12px; border:1px dashed var(--border); text-align:center;">
        <p style="font-size:0.75rem; margin:0; opacity:0.8;">${t("cumulativeNote") || "This report is a point-in-time snapshot of the Department of Roads MIS. All figures are subject to final verification."}</p>
      </div>
    </div>
  `;
}

function renderCardView(headers: string[], rows: ProjectRow[]) {
  const indicatorKey = getColumnKey(headers, "indicator");

  // Paginate for performance
  const rowLimit = 20;
  const visibleRows = rows.slice(0, rowLimit);
  const hasMore = rows.length > rowLimit;

  let cardHtml = "";
  visibleRows.forEach((r: ProjectRow) => {
    const name = indicatorKey ? r[indicatorKey] || "" : "";
    const annPerc = getProgress(r, headers);
    cardHtml += `<div class="data-card" data-indicator="${name.replace(/"/g, "&quot;")}">
      <div style="display:flex; justify-content:space-between; align-items:start">
        <h3 style="margin:0; font-size:0.9rem;">${t(name)}</h3>
        ${renderMiniChart(annPerc, true)}
      </div>
    </div>`;
  });

  if (hasMore) {
    cardHtml += `<div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--text-light)">Showing ${rowLimit} of ${rows.length} items</div>`;
  }

  const cardContainer = document.getElementById("view-cards");
  if (cardContainer) cardContainer.innerHTML = cardHtml;
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

function runDataAudit(_json: ProjectReport, rows: ProjectRow[], headers: string[]) {
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
      <div style="display:flex; justify-content:space-between; align-items:center; padding:0 20px;">
        <div style="display:flex; align-items:center; gap:12px;">
          <span style="font-size:1.2rem;">↔️</span>
          <div>
            <div style="font-size:0.8rem; font-weight:800;">Comparing with ${dispDate}</div>
          </div>
        </div>
        <button onclick="App.toggleDiffMode(null)" style="background:rgba(255,255,255,0.2); border:none; color:white; padding:6px 12px; border-radius:8px; cursor:pointer; font-size:0.7rem; font-weight:800;">
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
function renderSkeletons(view: string) { // Accept view as argument

  // 1. Clear previous content but keep container structure
  const containers = ["view-table", "view-cards", "view-charts", "view-cumulative"];
  containers.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = "";
    el?.classList.remove("active-view"); // Ensure all are inactive first
  });

  if (view === "table") {
    const tbody = document.getElementById("tbody");
    if (tbody) {
      tbody.innerHTML = Array(8).fill(0).map(() => `
        <tr class="skeleton-row">
          <td><div></div></td>
          ${Array(5).fill('<td><div></div></td>').join('')}
        </tr>
      `).join("");
    }
  } else if (view === "cumulative") { // Use table skeletons for cumulative view
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
      container.innerHTML = Array(6).fill(0).map(() => `
        <div class="skeleton-card">
          <div style="width: 70%; height: 14px; margin-bottom: 12px;"></div>
          <div style="width: 40%; height: 10px;"></div>
          <div style="margin-top: 20px; height: 40px; border-radius: 8px;"></div>
        </div>
      `).join("");
    }
  } else if (view === "charts") {
    const container = document.getElementById("view-charts");
    if (container) {
      container.innerHTML = Array(4).fill(0).map(() => `
        <div class="chart-card">
          <div class="skeleton-brief-line" style="width: 60%"></div>
          <div class="skeleton-brief-line" style="width: 100%; height: 60px; margin: 20px 0"></div>
          <div style="display: flex; gap: 10px">
             <div class="skeleton-brief-line" style="flex: 1"></div>
             <div class="skeleton-brief-line" style="flex: 1"></div>
          </div>
        </div>
      `).join("");
    }
  }

  // Ensure the correct view container is visible
  containers.forEach(id => {
    const el = document.getElementById(id);
    if (el && id === `view-${view}`) {
      el.classList.add("active-view");
    }
  });
}