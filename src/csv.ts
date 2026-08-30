/** Quotes a single CSV field only when it needs it (contains a comma,
 * quote, or newline) — doubling any internal quotes, standard CSV escaping. */
function csvField(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Builds CSV text (with a header row) from a table of plain string cells —
 * callers format each value (dates, money, etc.) before passing it in. */
export function toCsv(headers: string[], rows: string[][]): string {
  const lines = [headers, ...rows].map((row) => row.map(csvField).join(","));
  return lines.join("\r\n") + "\r\n";
}
