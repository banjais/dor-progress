import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

import type { Dashboard } from "./Dashboard.js";
import {
  DashboardState,
  ReportState,
  isReportError,
  isReportIdle,
  isReportLoading,
  isReportSuccess,
} from "./api-utils.js";
import {
  I18N,
  type ProjectReport,
  ProjectReportSchema,
  authenticatedFetch,
  downloadBlob,
  parseResponse,
  t,
  toNepaliNumerals,
} from "./api-utils.js";
import { devanagariFontBase64 } from "./fonts.js";

// Assuming fonts.js exists and exports this

// No citation needed, this is internal code.
export class BriefManager {
  private dashboard: Dashboard;

  constructor(dashboard: Dashboard) {
    this.dashboard = dashboard;
    this.initReactivity();
  }

  private initReactivity() {
    this.dashboard.subscribe(
      ({ reportData, lang, riskLevel }) =>
        this.render(reportData, lang, riskLevel),
      (state: DashboardState) => ({
        reportData: state.reportData,
        lang: state.lang,
        riskLevel: state.riskLevel,
      }),
    );
  }

  /**
   * Integrated Speech logic with Visualizer and Ducking support
   */
  private synth = window.speechSynthesis;
  private currentUtterance: SpeechSynthesisUtterance | null = null;
  private currentBlobSource: AudioBufferSourceNode | null = null;
  private originalText: string = "";
  private volumeInterval: number | null = null;

  async toggleReadAloud() {
    // Stop if already playing (either Web Speech or Blob Audio)
    if (this.synth.speaking || this.currentBlobSource) {
      this.stopReadAloud();
      return;
    }

    const container = document.getElementById("ai-brief-text");
    const btn = document.getElementById("ai-read-btn");
    if (!container || !btn) return;

    this.originalText = container.innerText;
    const text = this.originalText;
    const isPremium = localStorage.getItem("premium-tts") === "true";

    // Start visualizer and volume meter feedback
    this.startVolumeMeter(btn);
    this.dashboard.audio.duckMusic();
    const canvas = document.getElementById(
      "ai-visualizer",
    ) as HTMLCanvasElement;
    if (canvas) this.dashboard.audio.startVisualizer(canvas);

    // 1. Try Premium Audio (Blob) if enabled
    if (isPremium) {
      const blob = await this.dashboard.fetchAiBriefBlob();
      if (blob) {
        await this.playBlobAudio(blob);
        return;
      }
    }

    // 2. Fallback to Web Speech API
    this.playWebSpeech(text);
  }

  private stopReadAloud() {
    if (this.synth.speaking) this.synth.cancel();

    if (this.currentBlobSource) {
      try {
        this.currentBlobSource.stop();
      } catch {
        /* ignore */
      }
      this.currentBlobSource = null;
    }

    if (this.volumeInterval) {
      clearInterval(this.volumeInterval);
      this.volumeInterval = null;
    }

    const volBar = document.getElementById("voice-volume-bar");
    if (volBar) {
      volBar.style.width = "0%";
      volBar.style.opacity = "0";
    }

    const container = document.getElementById("ai-brief-text");
    if (container && this.originalText) container.innerText = this.originalText;

    this.dashboard.audio.unduckMusic();
    this.dashboard.audio.stopVisualizer();
    document.getElementById("ai-read-btn")?.classList.remove("active");
    this.dashboard.addToast("info", t("readAloudOff") || "Speech stopped");
  }

  /**
   * Starts a loop to update a small volume meter on the button.
   */
  private startVolumeMeter(btn: HTMLElement) {
    let volBar = document.getElementById("voice-volume-bar");
    if (!volBar) {
      volBar = document.createElement("div");
      volBar.id = "voice-volume-bar";
      btn.appendChild(volBar);
    }
    volBar.style.opacity = "1";

    this.volumeInterval = window.setInterval(() => {
      const data = this.dashboard.audio.getAnalyserData();
      let perc = 0;

      if (data && this.currentBlobSource) {
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        const avg = sum / data.length;
        perc = Math.min(100, (avg / 64) * 100); // Scale for UI visibility
      } else if (this.synth.speaking) {
        // Fallback jitter for Web Speech API (not routed through audio graph)
        perc = 30 + Math.random() * 40;
      }
      volBar!.style.width = `${perc}%`;
    }, 60);
  }

  private async playBlobAudio(blob: Blob) {
    const audio = this.dashboard.audio;
    if (!audio.ctx) await audio.init();
    if (!audio.ctx || !audio.analyser) return;

    try {
      const arrayBuffer = await blob.arrayBuffer();
      const audioBuffer = await audio.ctx.decodeAudioData(arrayBuffer);

      const source = audio.ctx.createBufferSource();
      this.currentBlobSource = source;
      source.buffer = audioBuffer;

      // Route through analyser and destination
      source.connect(audio.analyser);
      source.connect(audio.ctx.destination);

      source.onended = () => {
        if (this.currentBlobSource === source) {
          this.currentBlobSource = null;
          this.stopReadAloud();
        }
      };

      this.dashboard.playUi("ping");
      document.getElementById("ai-read-btn")?.classList.add("active");
      source.start(0);
    } catch (e) {
      console.error("Blob playback failed", e);
      this.playWebSpeech(
        document.getElementById("ai-brief-text")?.innerText || "",
      );
    }
  }

  private playWebSpeech(text: string) {
    this.currentUtterance = new SpeechSynthesisUtterance(text);
    const lang = this.dashboard.state.lang;
    this.currentUtterance.lang = lang === "ne" ? "ne-NP" : "en-US";

    // Apply settings from localStorage
    this.currentUtterance.pitch = parseFloat(
      localStorage.getItem("tts-pitch") || "1.0",
    );
    this.currentUtterance.rate = parseFloat(
      localStorage.getItem("tts-rate") || "0.95",
    );

    // Real-time Word Highlighting
    this.currentUtterance.onboundary = (event) => {
      const container = document.getElementById("ai-brief-text");
      if (event.name === "word" && container) {
        const words = this.originalText.trim().split(/\s+/);
        let charCount = 0;
        let wordIdx = -1;
        for (let i = 0; i < words.length; i++) {
          if (charCount + words[i].length >= event.charIndex) {
            wordIdx = i;
            break;
          }
          charCount += words[i].length + 1; // +1 for space
        }

        if (wordIdx !== -1) {
          container.innerHTML = words
            .map((w, idx) =>
              idx === wordIdx ? `<span class="highlight-word">${w}</span>` : w,
            )
            .join(" ");
        }
      }
    };

    this.currentUtterance.onstart = () => {
      this.dashboard.playUi("ping");
      document.getElementById("ai-read-btn")?.classList.add("active");
    };

    this.currentUtterance.onend = () => {
      this.stopReadAloud();
    };

    this.currentUtterance.onerror = () => {
      this.stopReadAloud();
      this.dashboard.addToast(
        "error",
        t("speechError") || "Speech synthesis failed",
      );
    };

    this.synth.speak(this.currentUtterance);
  }

  private render(reportData: ReportState, lang: string, riskLevel: number) {
    const isLowData = localStorage.getItem("low-data") === "true";
    const briefCard = document.getElementById("ai-brief-card");

    // Ensure Visualizer Canvas exists in the card
    if (briefCard && !document.getElementById("ai-visualizer")) {
      const canvas = document.createElement("canvas");
      canvas.id = "ai-visualizer";
      canvas.width = 400; // Resolution
      canvas.height = 100;
      // Append before the highlights
      const highlights = document.getElementById("ai-highlights");
      if (highlights) briefCard.insertBefore(canvas, highlights);
      else briefCard.appendChild(canvas);
    }

    const container = document.getElementById("ai-brief-text");
    if (!briefCard || !container) return;

    if (isLowData) {
      briefCard.style.display = "none";
      return;
    }

    // Apply risk-based animations and effects
    briefCard.classList.remove("critical-shake", "risk-high-border"); // Always remove to re-evaluate
    document.body.classList.remove("critical-vignette"); // Remove vignette by default

    if (riskLevel > 0.8) {
      briefCard.classList.add("critical-shake", "risk-high-border");
      document.body.classList.add("critical-vignette"); // Add vignette for critical risk
    } else if (riskLevel > 0.5) {
      briefCard.classList.add("risk-high-border");
    }

    if (isReportLoading(reportData) || isReportIdle(reportData)) {
      briefCard.style.display = "block";
      container.innerHTML = `
                <div class="skeleton-brief-line" style="width: 100%;"></div>
                <div class="skeleton-brief-line" style="width: 90%;"></div>
                <div class="skeleton-brief-line" style="width: 95%;"></div>
            `;
      return;
    }

    if (isReportError(reportData)) {
      briefCard.style.display = "block";
      container.innerText = reportData.message;
      return;
    }

    const summary = isReportSuccess(reportData)
      ? reportData.report.aiSummary
      : null;
    if (!summary?.brief) {
      if (isReportSuccess(reportData)) briefCard.style.display = "none";
      return;
    }

    briefCard.style.display = "block";
    briefCard.classList.add("fade-in");

    // Visual Sentiment
    if (summary.overallHealth) {
      const colorVar =
        summary.overallHealth === "moderate" ? "stable" : summary.overallHealth;
      briefCard.style.borderLeft = `4px solid var(--${colorVar})`;
    }

    let briefText = summary.brief;
    if (lang === "ne") briefText = toNepaliNumerals(briefText);

    this.dashboard.typeText(container, briefText, true);

    // Actionable Insights (Badges)
    const highlightsContainer = document.getElementById("ai-highlights");
    if (highlightsContainer) {
      const hasCritical = (summary.criticalProjects?.length ?? 0) > 0;
      const hasExceeding = (summary.exceedingProjects?.length ?? 0) > 0;

      if (hasCritical || hasExceeding) {
        highlightsContainer.innerHTML = `
                  <div style="display:flex; flex-wrap:wrap; gap:8px; margin-top:12px;">
                    ${(summary.criticalProjects || [])
                      .map(
                        (p: string) => `
                      <button onclick="App.handleSearch('${p}')" class="badge-btn" style="background:var(--critical-soft); color:var(--critical); border:1px solid var(--critical); font-size:0.7rem; padding:4px 8px; border-radius:12px; cursor:pointer;">
                        ⚠️ ${p}
                      </button>`,
                      )
                      .join("")}
                    ${(summary.exceedingProjects || [])
                      .map(
                        (p: string) => `
                      <button onclick="App.handleSearch('${p}')" class="badge-btn" style="background:var(--good-soft); color:var(--good); border:1px solid var(--good); font-size:0.7rem; padding:4px 8px; border-radius:12px; cursor:pointer;">
                        🌟 ${p}
                      </button>`,
                      )
                      .join("")}
                  </div>`;
        highlightsContainer.style.display = "block";
      } else {
        highlightsContainer.style.display = "none";
      }
    }

    // Data Integrity Alerts
    const alertsContainer = document.getElementById("ai-discrepancies");
    if (alertsContainer) {
      if (summary.discrepancies?.length) {
        const title = lang === "ne" ? "डाटा अलर्टहरू" : "Data Integrity Alerts";
        alertsContainer.innerHTML = `
                  <div style="margin-top:10px; border-top:1px solid var(--border); padding-top:8px;">
                    <small style="font-weight:800; opacity:0.6; display:block; margin-bottom:4px;">⚠️ ${title}</small>
                    ${summary.discrepancies
                      .map(
                        (d) => `
                      <div style="font-size:0.75rem; margin-bottom:2px; color:${d.severity === "high" ? "var(--critical)" : "inherit"}">
                        • ${lang === "ne" ? toNepaliNumerals(d.text) : d.text}
                      </div>`,
                      )
                      .join("")}
                  </div>`;
        alertsContainer.style.display = "block";
      } else {
        alertsContainer.style.display = "none";
      }
    }
  }

  printAiBrief() {
    const lang = this.dashboard.state.lang;
    const now = new Date();
    const timestamp = now.toLocaleString(lang === "ne" ? "ne-NP" : "en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

    // Inject/Update timestamp in the signature container
    const sigContainer = document.getElementById(
      "print-signature-container",
    ) as HTMLElement | null;
    if (sigContainer) {
      // Ensure the signature block exists or create it
      let sigBlock = sigContainer.querySelector(
        ".signature-block",
      ) as HTMLElement | null;
      if (!sigBlock) {
        const newBlock = document.createElement("div");
        newBlock.className = "signature-block";
        sigContainer.appendChild(newBlock);
        sigBlock = newBlock;
      }

      // Add the seal image (prepended to the signature block)
      let sealEl = sigBlock.querySelector(
        ".signature-seal",
      ) as HTMLImageElement | null;
      if (!sealEl) {
        sealEl = document.createElement("img");
        sealEl.className = "signature-seal";
        // Using insertAdjacentElement to avoid type collision with
        // Cloudflare Worker's Element.prepend signature.
        (sigBlock as HTMLElement).insertAdjacentElement("afterbegin", sealEl);
      }
      sealEl.src = "/icons/logo.png"; // Path to your seal image

      // Add/Update QR code (appended to the signature block)
      let qrEl = sigBlock.querySelector(
        ".signature-qr",
      ) as HTMLImageElement | null;
      if (!qrEl) {
        qrEl = document.createElement("img");
        qrEl.className = "signature-qr";
        (sigBlock as HTMLElement).appendChild(qrEl);
      }
      const qrUrl = this.dashboard.getContextUrl();
      qrEl.src = `https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=${encodeURIComponent(qrUrl)}`;

      // Add/Update timestamp (appended to the signature block)
      let tsEl = sigBlock.querySelector(".signature-timestamp");
      if (!tsEl) {
        tsEl = document.createElement("div");
        tsEl.className = "signature-timestamp";
        sigBlock.appendChild(tsEl);
      }
      tsEl.textContent = `${t("printedOn") || (lang === "ne" ? "मुद्रण समय:" : "Printed on:")}: ${lang === "ne" ? toNepaliNumerals(timestamp) : timestamp}`;
    }

    document.body.classList.add("print-memo-only");
    if (this.dashboard.state.clientConfig?.digitalSignatureEnabled) {
      document.body.classList.add("show-digital-signature");
    }
    window.print();
    window.addEventListener(
      "afterprint",
      () => {
        document.body.classList.remove("print-memo-only");
        document.body.classList.remove("show-digital-signature");
      },
      { once: true },
    );
  }

  async copyAiBrief() {
    const text = (document.getElementById("ai-brief-text") as HTMLElement)
      ?.innerText;
    if (!text) {
      this.dashboard.addToast("info", t("noTextToCopy") || "No text to copy.");
      return;
    }

    const url = this.dashboard.getContextUrl();
    const textWithFooter = `${text}${this.dashboard.getAuditFooter(url)}`;

    try {
      await navigator.clipboard.writeText(textWithFooter);
      this.dashboard.addToast("success", t("briefCopied"));
      this.triggerSuccessTooltip("ai-copy-btn", "linkCopied");
    } catch (_err) {
      this.dashboard.addToast(
        "error",
        t("copyFailed") || "Failed to copy brief.",
      );
    }
  }

  async share() {
    const text =
      (document.getElementById("ai-brief-text") as HTMLElement)?.innerText ||
      "";
    const url = this.dashboard.getContextUrl();
    const textWithFooter = `${text}${this.dashboard.getAuditFooter(url)}`;

    if (navigator.share && navigator.canShare?.({ text: textWithFooter })) {
      try {
        await navigator.share({
          title: t("briefShareTitle") || "Executive Briefing",
          text: textWithFooter,
          url: url,
        });
      } catch (_err) {
        if ((_err as Error).name !== "AbortError")
          console.error("Share failed", _err);
      }
    } else {
      // Fallback: Copy the entire brief with the link and footer
      await navigator.clipboard.writeText(textWithFooter);
      this.dashboard.addToast("success", t("briefCopied"));
    }
  }

  async shareLink() {
    const url = this.dashboard.getContextUrl();
    if (navigator.share && navigator.canShare?.({ url })) {
      try {
        await navigator.share({
          title: t("appName"),
          url: url,
        });
      } catch (e) {
        if ((e as Error).name !== "AbortError")
          console.error("Share failed", e);
      }
    } else {
      await navigator.clipboard.writeText(url);
      this.dashboard.addToast(
        "success",
        t("linkCopied") || "Link copied to clipboard",
      );
      this.triggerSuccessTooltip("gemini-share-link", "linkCopied");
    }
  }

  async shareEmail() {
    const text =
      (document.getElementById("ai-brief-text") as HTMLElement)?.innerText ||
      "";
    const url = this.dashboard.getContextUrl();
    const subject = t("briefShareTitle") || "Executive Briefing";
    const body = `${text}\n\n${this.dashboard.getAuditFooter(url)}`;

    // Use mailto link to open default email client
    const mailtoUrl = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.location.href = mailtoUrl;
    this.dashboard.playUi("click");
  }

  async downloadBriefAsPdf() {
    const btn = document.getElementById(
      "gemini-download-pdf",
    ) as HTMLButtonElement | null;
    const progBar = document.getElementById("gemini-progress-bar");
    const progCont = document.getElementById("gemini-progress-container");
    const originalHtml = btn ? btn.innerHTML : "";

    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<i>⏳</i> <span>${t("processing") || "Processing..."}</span>`;
    }

    if (progCont) progCont.style.display = "block";
    if (progBar) progBar.style.width = "10%";

    try {
      const briefText = (
        document.getElementById("ai-brief-text") as HTMLElement
      )?.innerText;
      if (!briefText) {
        this.dashboard.addToast(
          "info",
          t("noTextToDownload") || "No brief text available to download.",
        );
        return;
      }

      const lang = this.dashboard.state.lang;
      const reportDataState = this.dashboard.state.reportData;
      const isSuccess = isReportSuccess(reportDataState);
      const reportDate = isSuccess ? reportDataState.report.lastUpdate : null;
      const summary = isSuccess ? reportDataState.report.aiSummary : null;
      const url = this.dashboard.getContextUrl();
      const auditFooter = this.dashboard.getAuditFooter(url);

      const criticalRows = isSuccess
        ? reportDataState.report.rows.filter((r) => r._status === "critical")
        : [];

      if (progBar) progBar.style.width = "30%";

      // Fetch Department Seal and QR Code for the PDF
      let sealBase64 = "";
      let qrBase64 = "";
      try {
        const sealUrl = "/icons/logo.png";
        const qrImgUrl = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(url)}`;

        const [sealRes, qrRes] = await Promise.all([
          fetch(sealUrl),
          fetch(qrImgUrl),
        ]);
        const [sealBlob, qrBlob] = await Promise.all([
          sealRes.blob(),
          qrRes.blob(),
        ]);

        const toBase64 = (blob: Blob): Promise<string> =>
          new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.readAsDataURL(blob);
          });

        [sealBase64, qrBase64] = await Promise.all([
          toBase64(sealBlob),
          toBase64(qrBlob),
        ]);
      } catch (e) {
        console.warn("Failed to fetch assets for PDF", e);
      }

      if (progBar) progBar.style.width = "60%";

      // Determine sentiment color (matching web UI logic)
      let sentimentRGB: [number, number, number] = [0, 153, 218]; // Default Theme Blue
      if (summary?.overallHealth === "good")
        sentimentRGB = [16, 185, 129]; // --good
      else if (summary?.overallHealth === "critical")
        sentimentRGB = [239, 68, 68]; // --critical
      else if (summary?.overallHealth === "moderate")
        sentimentRGB = [59, 130, 246]; // --stable

      const doc = new jsPDF();

      // Register and set the custom Devanagari font
      const fontFileName = "NotoSansDevanagari.ttf";
      const fontName = "NotoSansDevanagari";

      doc.addFileToVFS(fontFileName, devanagariFontBase64);
      doc.addFont(fontFileName, fontName, "normal");
      doc.setFont(fontName);

      // Add Seal Image
      if (sealBase64) {
        doc.addImage(sealBase64, "PNG", 14, 10, 12, 12);
      }

      if (progBar) progBar.style.width = "85%";

      // Add Department Names (Bilingual Header)
      doc.setFontSize(8);
      doc.setTextColor(100);
      // Direct lookup from I18N ensures both languages appear regardless of current UI state
      const govNe = (I18N.ne as any)?.govName || "नेपाल सरकार";
      const govEn = (I18N.en as any)?.govName || "Government of Nepal";
      const deptNe = (I18N.ne as any)?.deptName || "सडक विभाग";
      const deptEn = (I18N.en as any)?.deptName || "Department of Roads";

      doc.text(govNe, 14, 26);
      doc.text(govEn, 14, 29);
      doc.setFontSize(10);
      doc.setTextColor(0);
      doc.text(deptNe, 14, 34);
      doc.text(deptEn, 14, 38);

      // Add Title
      doc.setFontSize(18);
      doc.text(t("briefShareTitle") || "Executive Briefing", 14, 48);

      // Add Report Date
      doc.setFontSize(10);
      doc.setTextColor(100);
      if (reportDate) {
        doc.text(
          `${t("reportDate")}: ${lang === "ne" ? toNepaliNumerals(reportDate) : reportDate}`,
          14,
          54,
        );
      }

      // Add Brief Text with Left Sentiment Border
      autoTable(doc, {
        body: [[briefText]],
        startY: 62,
        styles: {
          font: fontName,
          fontSize: 12,
          textColor: [0, 0, 0],
          cellPadding: { left: 8, top: 2, right: 2, bottom: 2 },
        },
        theme: "plain",
      });

      const briefEndY = (doc as any).lastAutoTable.finalY;
      doc.setDrawColor(sentimentRGB[0], sentimentRGB[1], sentimentRGB[2]);
      doc.setLineWidth(1.5);
      doc.line(14, 62, 14, briefEndY);

      let currentY = briefEndY + 10;

      // Add Critical Projects Table
      if (criticalRows.length > 0 && isSuccess) {
        doc.setFontSize(14);
        doc.setTextColor(239, 68, 68); // Critical Red
        doc.text(t("criticalProjects") || "Critical Projects", 14, currentY);
        currentY += 6;

        const headers = reportDataState.report.headers;
        const tableData = criticalRows.map((row) =>
          headers.map((h) => {
            let val = row[h];
            if (lang === "ne") val = toNepaliNumerals(val);
            return String(val || "");
          }),
        );

        autoTable(doc, {
          head: [headers.map((h) => t(h))],
          body: tableData,
          startY: currentY,
          styles: { font: fontName, fontSize: 8 },
          headStyles: { fillColor: [239, 68, 68] },
        });

        currentY = (doc as any).lastAutoTable.finalY + 15;
      }

      // Add Audit Footer
      autoTable(doc, {
        body: [[auditFooter.trim()]],
        startY: currentY,
        styles: {
          font: fontName,
          fontSize: 10,
          textColor: [100, 100, 100],
          cellPadding: 0,
        },
        theme: "plain",
      });

      currentY = (doc as any).lastAutoTable.finalY + 10;

      // Add QR Code at the bottom
      if (qrBase64) {
        // Check if there's enough space on the current page for the QR code
        if (currentY + 40 > 280) {
          doc.addPage();
          currentY = 20;
        }
        doc.addImage(qrBase64, "PNG", 14, currentY, 30, 30);
        doc.setFontSize(8);
        doc.setTextColor(150);
        doc.text(
          t("scanForLive") || "Scan for live dashboard",
          48,
          currentY + 18,
        );
      }

      // Add Page Numbers (Footers) to all pages
      const totalPages = doc.getNumberOfPages();
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();

      for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.setTextColor(150);

        const pageNum = lang === "ne" ? toNepaliNumerals(i) : i;
        const totalNum =
          lang === "ne" ? toNepaliNumerals(totalPages) : totalPages;

        const footerText =
          lang === "ne"
            ? `पृष्ठ ${pageNum} / ${totalNum}`
            : `Page ${pageNum} of ${totalNum}`;

        const textWidth = doc.getTextWidth(footerText);
        doc.text(footerText, (pageWidth - textWidth) / 2, pageHeight - 10);
      }

      if (progBar) progBar.style.width = "100%";

      doc.save(
        `AI_Brief_${reportDate || new Date().toISOString().split("T")[0]}.pdf`,
      );
      this.dashboard.addToast(
        "success",
        t("pdfDownloaded") || "PDF downloaded successfully!",
      );
    } catch (e) {
      console.error("PDF generation failed:", e);
      this.dashboard.addToast(
        "error",
        t("pdfError") || "Failed to generate PDF.",
      );
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
      }
      // Hide progress bar with a slight delay for visual satisfaction
      setTimeout(() => {
        if (progCont) progCont.style.display = "none";
        if (progBar) progBar.style.width = "0%";
      }, 1000);
    }
  }

  async translate() {
    const btn = document.getElementById(
      "ai-translate-btn",
    ) as HTMLButtonElement;
    if (btn) btn.classList.add("spinning");

    try {
      const state = this.dashboard.state;
      let endpoint = `/api/report?lang=${state.lang}`;

      // Ensure we translate the correct report if viewing archives or cumulative data
      if (isReportSuccess(state.reportData)) {
        const report = state.reportData.report;
        // Snapshots and cumulative reports use the 'date' parameter
        if (state.view === "cumulative" || state.view === "history") {
          endpoint += `&date=${report.lastUpdate}`;
        }
      }

      const res = await authenticatedFetch(endpoint);
      const json = (await parseResponse(
        res,
        ProjectReportSchema,
      )) as ProjectReport;
      if (json?.aiSummary?.brief) {
        this.dashboard.typeText(
          document.getElementById("ai-brief-text")!,
          json.aiSummary.brief,
          true,
        );
      }
    } catch {
      this.dashboard.addToast(
        "error",
        this.dashboard.state.lang === "en" ? "Failed" : "असफल",
      );
      const briefText =
        this.dashboard.state.lang === "en"
          ? "CRITICAL ERROR: DATA STREAM CORRUPTED..."
          : "गंभीर त्रुटि: डाटा स्ट्रिममा समस्या आयो...";
      const container = document.getElementById("ai-brief-text");
      if (container) this.dashboard.typeText(container, briefText, true, true);
    } finally {
      if (btn) btn.classList.remove("spinning");
    }
  }

  async downloadAudio() {
    this.dashboard.addToast("info", t("processing") || "Generating audio...");
    const blob = await this.dashboard.fetchAiBriefBlob();
    if (blob) {
      const date = isReportSuccess(this.dashboard.state.reportData)
        ? this.dashboard.state.reportData.report.lastUpdate
        : new Date().toISOString().split("T")[0];
      downloadBlob(blob, `AI_Brief_${date}.mp3`);
      this.dashboard.addToast(
        "success",
        t("downloadSuccess") || "Audio downloaded",
      );
    } else {
      this.dashboard.addToast(
        "error",
        t("audioError") || "Failed to fetch audio",
      );
    }
  }

  async shareAudio() {
    const blob = await this.dashboard.fetchAiBriefBlob();
    if (blob && navigator.share && (navigator as any).canShare) {
      const date = isReportSuccess(this.dashboard.state.reportData)
        ? this.dashboard.state.reportData.report.lastUpdate
        : new Date().toISOString().split("T")[0];
      const file = new File([blob], `AI_Brief_${date}.mp3`, {
        type: "audio/mpeg",
      });

      if ((navigator as any).canShare({ files: [file] })) {
        try {
          await navigator.share({
            files: [file],
            title: t("briefShareTitle") || "Executive Briefing",
          });
          return;
        } catch (e) {
          if ((e as Error).name !== "AbortError") console.error(e);
        }
      }
    }
    this.dashboard.addToast(
      "info",
      t("shareNotSupported") || "Audio sharing not supported on this device.",
    );
  }

  /**
   * Triggers a transient success state on a tooltip.
   */
  private triggerSuccessTooltip(elementId: string, translationKey: string) {
    const btn = document.getElementById(elementId);
    if (!btn) return;

    const originalTitle = btn.getAttribute("data-title") || "";
    btn.setAttribute("data-title", t(translationKey));
    btn.classList.add("tooltip-active", "tooltip-success");

    setTimeout(() => {
      btn.classList.remove("tooltip-active", "tooltip-success");
      btn.setAttribute("data-title", originalTitle);
    }, 2000);
  }
}
