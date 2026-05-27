/**
 * Data Worker for heavy filtering and sorting operations.
 */

const NE_TO_AR: Record<string, string> = {
  "०": "0",
  "१": "1",
  "२": "2",
  "३": "3",
  "४": "4",
  "५": "5",
  "६": "6",
  "७": "7",
  "८": "8",
  "९": "9",
};

const NE_NUMERAL_REGEX = /[०-९]/g;
const COMMA_REGEX = /,/g;
const PERCENT_REGEX = /%/g;

function toArabicNumerals(str: string | null | undefined): string {
  return String(str || "").replace(
    NE_NUMERAL_REGEX,
    (d: string) => NE_TO_AR[d] ?? d,
  );
}

self.onmessage = (e: MessageEvent) => {
  const { rows: sourceRows, search, sort, lang, requestId } = e.data;
  let rows = [...sourceRows];

  // 1. Filter Logic
  if (search && search !== "verify") {
    const arabicSearchTerm = toArabicNumerals(search.toLowerCase());
    rows = rows.filter((r) => {
      // Performance: Only search through user-visible data, skipping internal _ fields
      return Object.entries(r).some(([key, v]) => {
        if (key.startsWith("_")) return false;
        const arabicStringValue = toArabicNumerals(
          String(v || ""),
        ).toLowerCase();
        return arabicStringValue.includes(arabicSearchTerm);
      });
    });
  }

  // 2. Sort Logic
  if (sort.key) {
    const { key, dir } = sort;
    rows.sort((a, b) => {
      const v1 = a[key] ?? "";
      const v2 = b[key] ?? "";

      // Try numeric sort first (pre-compiled regexes for performance)
      const n1 = parseFloat(
        String(v1).replace(COMMA_REGEX, "").replace(PERCENT_REGEX, ""),
      );
      const n2 = parseFloat(
        String(v2).replace(COMMA_REGEX, "").replace(PERCENT_REGEX, ""),
      );

      if (!isNaN(n1) && !isNaN(n2)) {
        return (n1 - n2) * dir;
      }

      // Fallback to locale-aware string sort
      return String(v1).localeCompare(String(v2), lang) * dir;
    });
  }

  // Send processed data back with the original request ID to handle concurrency
  self.postMessage({ rows, requestId });
};
