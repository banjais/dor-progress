import { Dashboard } from "./Dashboard";
import { getProgress, t, toNepaliNumerals, toArabicNumerals, I18N } from "./api-utils";
import { renderMiniChart, renderSparkline } from "./utils"; // Import I18N directly
import { ProjectReport } from "../shared/types";

/**
 * Core render function that updates the UI based on the project state.
 */
export function render(json: ProjectReport | null) {
  if (!json) return;

  const dashboard = Dashboard.getInstance(); // No citation needed, this is internal code.
  const langStrings = I18N[dashboard.state.lang] || {}; // Use imported I18N
  const headers = json?.headers || [];
  let rows = [...(json?.rows || [])];

  renderDiffBanner();

  // Handle Global Admin Message
  const banner = document.getElementById("admin-banner") as HTMLElement;
  if (json?.adminMessage) {
    const adminTxt = document.getElementById("admin-message-text");
    if (adminTxt) adminTxt.textContent = json.adminMessage;
    if (banner) banner.style.display = "block";
  } else if (banner) {
    banner.style.display = "none";
  }

  // 1. Filter Logic
  if (dashboard.state.search && dashboard.state.search !== "verify") {
    rows = rows.filter((r) =>
      Object.values(r).some(
        (v) =>
          (typeof v === "string" || typeof v === "number" || typeof v === "boolean") &&
          String(v).toLowerCase().includes(dashboard.state.search),
      )
    );
  }

  // Update Results Counter
  const resCounter = document.getElementById("results-count") as HTMLElement;
  if (dashboard.state.search && rows.length > 0 && resCounter) {
    const dispNum = dashboard.state.lang === "ne" ? toNepaliNumerals(rows.length) : rows.length;
    resCounter.innerText = `${dispNum} ${langStrings.results || "results"}`;
    resCounter.style.display = "block";
  } else if (resCounter) {
    resCounter.style.display = "none";
  }

  // 2. Audit Tool (hidden)
  if (dashboard.state.search === "verify") {
    runDataAudit(json, rows, headers);
  }

  // 3. Highlight Regex
  const searchStr = dashboard.state.search;
  let highlightRegex: RegExp | null = null;
  if (searchStr) {
    const isNumericSearch = !isNaN(parseFloat(toArabicNumerals(searchStr))) && isFinite(Number(toArabicNumerals(searchStr)));
    const pattern = isNumericSearch
      ? `(${toArabicNumerals(searchStr)}|${toNepaliNumerals(toArabicNumerals(searchStr))})`
      : `(${searchStr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`;
    highlightRegex = new RegExp(pattern, "gi");
  }

  renderSystemStats(json, rows);

  if (dashboard.state.view === "table") renderTableView(headers, rows, highlightRegex);
  else if (dashboard.state.view === "cards") renderCardView(headers, rows);
  else if (dashboard.state.view === "charts") renderChartView(headers, rows);
}

function renderSystemStats(json: ProjectReport, rows: any[]) {
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

  if (json?.lastUpdate) {
    const updateEl = document.getElementById("last-update");
    if (updateEl) updateEl.innerText = `${t("update")} ${isNe ? toNepaliNumerals(json.lastUpdate) : `${json.lastUpdate} BS`}`;
  }
}
function renderTableView(headers: string[], rows: any[], highlightRegex: RegExp | null) {
  const dashboard = Dashboard.getInstance();
  let thead = `<tr><th></th>`;
  headers.forEach((h) => {
    thead += `<th onclick="App.sortData('${h}'); event.stopPropagation()">${t(h)} ${dashboard.state.sort.key === h ? (dashboard.state.sort.dir === 1 ? "↑" : "↓") : ""}</th>`;
  });
  thead += "</tr>";
  const theadEl = document.getElementById("thead");
  if (theadEl) theadEl.innerHTML = thead;

  let tbody = "";
  rows.forEach((r: any) => {
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
  const tbodyEl = document.getElementById("tbody");
  if (tbodyEl) tbodyEl.innerHTML = tbody;
}

function renderCardView(headers: string[], rows: any[]) {
  let cardHtml = "";
  rows.forEach((r: any) => {
    const name = r[headers[0]] || "";
    const annPerc = getProgress(r, headers);
    cardHtml += `<div class="data-card" data-indicator="${name.replace(/"/g, "&quot;")}">
      <div style="display:flex; justify-content:space-between; align-items:start">
        <h3 style="margin:0; font-size:0.9rem;">${t(name)}</h3>
        ${renderMiniChart(annPerc, true)}
      </div>
    </div>`;
  });
  const cardContainer = document.getElementById("view-cards");
  if (cardContainer) cardContainer.innerHTML = cardHtml;
}

function renderChartView(headers: string[], rows: any[]) {
  let chartHtml = "";
  rows.forEach((r: any) => {
    const prog = getProgress(r, headers);
    chartHtml += `<div class="chart-card" data-indicator="${r[headers[0]]?.replace(/"/g, "&quot;")}">
      <h4>${t(r[headers[0]])}</h4>
      ${renderSparkline(prog, prog)}
    </div>`;
  });
  const chartContainer = document.getElementById("view-charts");
  if (chartContainer) chartContainer.innerHTML = chartHtml;
}

function runDataAudit(_json: ProjectReport, rows: any[], headers: string[]) {
  console.group("Data Integrity Audit");
  const audit = rows.map((r) => ({
    Indicator: r[headers[0]],
    "Annual %": getProgress(r, headers) + "%",
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