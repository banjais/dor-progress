/**
 * Web Worker for off-thread data processing.
 */
self.onmessage = (e: MessageEvent) => {
    const { rows, search, sort, lang } = e.data;
    let processedRows = [...rows];

    // 1. Filter Logic
    if (search && search !== "verify") {
        processedRows = processedRows.filter((r) =>
            Object.values(r).some(
                (v) =>
                    (typeof v === "string" || typeof v === "number" || typeof v === "boolean") &&
                    String(v).toLowerCase().includes(search)
            )
        );
    }

    // 2. Sort Logic
    if (sort.key) {
        processedRows.sort((a: any, b: any) => {
            const v1 = a[sort.key] ?? "";
            const v2 = b[sort.key] ?? "";
            const n1 = parseFloat(String(v1).replace(/,/g, "").replace("%", ""));
            const n2 = parseFloat(String(v2).replace(/,/g, "").replace("%", ""));
            if (!isNaN(n1) && !isNaN(n2)) return (n1 - n2) * sort.dir;
            return String(v1).localeCompare(String(v2), lang) * sort.dir;
        });
    }

    self.postMessage({ rows: processedRows });
};