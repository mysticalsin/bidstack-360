// Tiny client-side CSV exporter. RFC 4180-ish — handles quote-escaping,
// embedded commas, newlines. No dependency, no streaming (CRM tables fit
// in memory for the next two years comfortably).
//
// Triggers a browser download via a synthesized <a download> click, which
// works in every evergreen browser without an extra library.

export function rowsToCsv<T extends Record<string, unknown>>(
  rows: ReadonlyArray<T>,
  columns: ReadonlyArray<{ key: keyof T; label: string }>,
): string {
  const header = columns.map((c) => quote(c.label)).join(',');
  const body = rows
    .map((row) => columns.map((c) => quote(toString(row[c.key]))).join(','))
    .join('\r\n');
  return `${header}\r\n${body}`;
}

function toString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString();
  return JSON.stringify(value);
}

/**
 * Neutralize CSV formula-injection. A cell whose first character is one of
 * `= + - @ TAB CR` is interpreted as a formula by Excel/Sheets/LibreOffice;
 * prefixing a single quote forces the cell to be read as literal text.
 *
 * WHY exported (not just used by `quote`): the analytics-report and dashboard-
 * widget exporters build their CSV strings by hand and must share this exact
 * sanitization rather than re-deriving (and drifting from) it.
 */
export function csvCell(value: string): string {
  return value.replace(/^(=|\+|-|@|\t|\r)/, "'$1");
}

function quote(value: string): string {
  const sanitized = csvCell(value);
  if (!/[,"\r\n]/.test(sanitized)) return sanitized;
  return `"${sanitized.replace(/"/g, '""')}"`;
}

/** Trigger a CSV download in the browser. */
export function downloadCsv(filename: string, csv: string): void {
  if (typeof window === 'undefined') return;
  // Excel sniffs BOM to detect UTF-8 properly; otherwise non-ASCII names
  // (Ångström, naïve, etc.) render as mojibake on Windows.
  const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Give the browser a tick to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 200);
}
