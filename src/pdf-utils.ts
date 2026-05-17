import { Dashboard } from "./Dashboard";
import { I18N, toNepaliNumerals, getProgress } from "./api-utils";

/**
 * Generates a Progress Report PDF directly in the browser using pdf-lib.
 * Includes Devanagari font support for Nepali translations.
 */
export async function generateClientPDF(): Promise<void> {
    const dashboard = Dashboard.getInstance();
    const store = dashboard.state.store;
    if (!store?.rows.length) {
        dashboard.addToast("error", "No data to export");
        return;
    }

    const lang = dashboard.state.lang;
    dashboard.addToast(
        "info",
        lang === "en" ? "Generating PDF..." : "PDF तयार गर्दै...",
    );

    try {
        const { PDFDocument, rgb, StandardFonts, degrees } = window.PDFLib;
        const pdfDoc = await PDFDocument.create();

        // 1. Optimized Font Embedding
        let mainFont;
        if (lang === "ne") {
            const fontUrl = `https://fonts.gstatic.com/s/notosansdevanagari/v28/wf5m9WB_V9fNqbfVp-9ueS5mF-X_S-zY.ttf`;
            const fontBytes = await fetch(fontUrl).then((res) => res.arrayBuffer());
            mainFont = await pdfDoc.embedFont(fontBytes);
        } else {
            mainFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
        }

        await pdfDoc.embedFont(StandardFonts.HelveticaBold);

        // 2. Embed Logo and QR Code for Live Dashboard
        const logoUrl = `${window.location.origin}/icons/logo.png`;
        const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=${encodeURIComponent(window.location.origin)}`;

        const [logoBytes, qrBytes] = await Promise.all([
            fetch(logoUrl).then((res) => res.ok ? res.arrayBuffer() : null).catch(() => null),
            fetch(qrUrl).then((res) => res.ok ? res.arrayBuffer() : null).catch(() => null)
        ]);

        let logoImg = null, qrImg = null;
        if (logoBytes) logoImg = await pdfDoc.embedPng(logoBytes);
        if (qrBytes) qrImg = await pdfDoc.embedPng(qrBytes);

        let page = pdfDoc.addPage([595.28, 841.89]); // A4 Size
        const { width, height } = page.getSize();
        let yOffset = height - 50;

        const colWidth = (width - 100) / store.headers.length;

        const drawTableHeader = (currentPage: any) => {
            store.headers.forEach((h, i) => {
                currentPage.drawText(h, {
                    x: 50 + i * colWidth,
                    y: yOffset,
                    size: 9,
                    font: mainFont,
                });
            });
            currentPage.drawLine({
                start: { x: 50, y: yOffset - 5 },
                end: { x: width - 50, y: yOffset - 5 },
                thickness: 1.2,
                color: rgb(0, 0.38, 0.68),
            });
            yOffset -= 20;
        };

        // 3. Draw Header 
        if (logoImg) {
            const logoDims = logoImg.scale(0.3);
            page.drawImage(logoImg, {
                x: width / 2 - logoDims.width / 2,
                y: yOffset - logoDims.height,
                width: logoDims.width,
                height: logoDims.height,
            });
            yOffset -= logoDims.height + 20;
        }

        if (qrImg) {
            const qrDims = qrImg.scale(0.4); // 40x40
            page.drawImage(qrImg, {
                x: width - 50 - qrDims.width,
                y: height - 50 - qrDims.height,
                width: qrDims.width,
                height: qrDims.height,
            });
        }

        // Center Title 
        const title = I18N[lang].reportTitle;
        const titleWidth = mainFont.widthOfTextAtSize(title, 14);
        page.drawText(title, {
            x: width / 2 - titleWidth / 2,
            y: yOffset,
            size: 14,
            font: mainFont,
            color: rgb(0.1, 0.1, 0.1),
        });
        yOffset -= 30;

        // 3. Draw KPI Summary 
        const totalRows = store.rows.length;
        const critical = store.rows.filter((r: any) => r._status === "critical").length;
        page.drawRectangle({
            x: 50,
            y: yOffset - 10,
            width: width - 100,
            height: 40,
            color: rgb(0.95, 0.95, 0.95),
        });
        const kpiText = `${I18N[lang].total}: ${lang === "ne" ? toNepaliNumerals(totalRows) : totalRows} | ${I18N[lang].attention}: ${lang === "ne" ? toNepaliNumerals(critical) : critical}`;
        page.drawText(kpiText, {
            x: 60,
            y: yOffset,
            size: 10,
            font: mainFont,
            color: rgb(0.2, 0.2, 0.2),
        });
        yOffset -= 60;

        // 3.5 Draw AI Briefing (Executive Summary)
        if (store.aiSummary?.brief) {
            let briefText = store.aiSummary.brief;
            if (lang === "ne") briefText = toNepaliNumerals(briefText);

            const briefTitle = lang === "en" ? "Executive Summary" : "कार्यकारी सारांश";
            page.drawText(briefTitle, {
                x: 50,
                y: yOffset,
                size: 11,
                font: mainFont,
                color: rgb(0, 0.38, 0.68), // Professional Blue
            });
            yOffset -= 18;

            const fontSize = 9;
            const maxWidth = width - 100;

            // Word-wrap utility to handle multi-line briefing text
            const wrapText = (text: string): string[] => {
                const lines: string[] = [];
                text.split('\n').forEach(para => {
                    let currentLine = '';
                    para.split(' ').forEach(word => {
                        const testLine = currentLine ? `${currentLine} ${word}` : word;
                        if (mainFont.widthOfTextAtSize(testLine, fontSize) < maxWidth) {
                            currentLine = testLine;
                        } else {
                            lines.push(currentLine);
                            currentLine = word;
                        }
                    });
                    lines.push(currentLine);
                });
                return lines;
            };

            const briefLines = wrapText(briefText);
            for (const line of briefLines) {
                if (yOffset < 60) break; // Simple cutoff for the header area
                page.drawText(line, { x: 50, y: yOffset, size: fontSize, font: mainFont, color: rgb(0.2, 0.2, 0.2) });
                yOffset -= 13;
            }
            yOffset -= 20;
        }

        // 3.8 Draw Initial Headers
        drawTableHeader(page);

        // 4. Draw Table Rows 
        store.rows.forEach((row: any, index: number) => {
            if (yOffset < 50) {
                page = pdfDoc.addPage([595.28, 841.89]);
                yOffset = height - 50;
                drawTableHeader(page);
            }

            // Add zebra striping for better readability (every other row)
            if (index % 2 === 1) {
                page.drawRectangle({
                    x: 50,
                    y: yOffset - 10,
                    width: width - 100,
                    height: 15,
                    color: rgb(0.96, 0.97, 0.99), // Subtle blue-grey tint
                });
            }

            // Render a mini status indicator in the PDF row using pdf-lib primitives
            const annPerc = getProgress(row, store.headers);
            const radius = 3;
            const chartX = 35; // Positioned in the left margin
            const chartY = yOffset + 3;

            page.drawCircle({
                x: chartX,
                y: chartY,
                size: radius,
                borderWidth: 0.5,
                borderColor: rgb(0.8, 0.8, 0.8),
            });

            const statusColor = row._status === "good" ? rgb(0.29, 0.87, 0.5) :
                row._status === "critical" ? rgb(0.97, 0.44, 0.44) :
                    rgb(0.98, 0.8, 0.08);

            if (annPerc > 0) {
                page.drawCircle({ x: chartX, y: chartY, size: radius - 1, color: statusColor });
            }

            store.headers.forEach((h: string, i: number) => {
                let text = String(row[h] || "");
                if (lang === "ne") text = toNepaliNumerals(text);

                page.drawText(text.substring(0, 30), {
                    x: 50 + i * colWidth,
                    y: yOffset,
                    size: 8,
                    font: mainFont,
                    color:
                        row._status === "critical" && i === 0
                            ? rgb(0.9, 0, 0)
                            : rgb(0, 0, 0),
                });
            });
            yOffset -= 15;
        });

        // 5. Add Page Numbers (Footers)
        const totalPages = pdfDoc.getPageCount();
        const pdfPages = pdfDoc.getPages();
        pdfPages.forEach((p: any, i: number) => {
            // Add transparent watermark in the center of every page
            if (logoImg) {
                const watermarkDims = logoImg.scale(1.2);
                // When rotating 45 degrees, we adjust the center slightly 
                // to account for the rotation origin being the bottom-left corner.
                p.drawImage(logoImg, {
                    x: width / 2,
                    y: height / 2 - watermarkDims.height / 1.5,
                    width: watermarkDims.width,
                    height: watermarkDims.height,
                    opacity: 0.04, // Very low effective transparency
                    rotate: degrees(45),
                });
            }

            const pageNum = lang === "ne" ? toNepaliNumerals(i + 1) : (i + 1);
            const totalNum = lang === "ne" ? toNepaliNumerals(totalPages) : totalPages;

            // Add a subtle horizontal line above the footer
            p.drawLine({
                start: { x: 50, y: 40 },
                end: { x: width - 50, y: 40 },
                thickness: 1,
                color: rgb(0, 0.38, 0.68),
                dashArray: [2, 2],
            });

            const footerText = lang === "ne"
                ? `पृष्ठ ${pageNum} / ${totalNum}`
                : `Page ${pageNum} of ${totalNum}`;

            // Add Last Update date to the left side of the footer
            const updateDate = store.lastUpdate || "";
            const dateLabel = lang === "ne" ? "अद्यावधिक:" : "Updated:";
            const dispDate = lang === "ne" ? toNepaliNumerals(updateDate) : updateDate;
            const leftFooterText = `${dateLabel} ${dispDate}`;

            p.drawText(leftFooterText, {
                x: 50,
                y: 25,
                size: 8,
                font: mainFont,
                color: rgb(0.5, 0.5, 0.5),
            });

            const textWidth = mainFont.widthOfTextAtSize(footerText, 8);
            p.drawText(footerText, {
                x: width / 2 - textWidth / 2,
                y: 25,
                size: 8,
                font: mainFont,
                color: rgb(0.5, 0.5, 0.5),
            });
        });

        const pdfBytes = await pdfDoc.save();
        const blob = new Blob([pdfBytes], { type: "application/pdf" });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `DoR_Report_${new Date().toISOString().slice(0, 10)}.pdf`;
        link.click();
    } catch (err) {
        console.error("PDF generation failed:", err);
        dashboard.addToast("error", "Failed to generate PDF");
    }
}