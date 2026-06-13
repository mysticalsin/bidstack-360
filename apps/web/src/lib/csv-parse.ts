// Minimal RFC-4180 CSV parser for the client-side import wizard. The backend
// start-csv endpoint expects rows already parsed into { header: value }, so
// parsing happens here before upload. Handles quoted fields, embedded
// commas/newlines, and escaped double-quotes (""). Not a full streaming parser
// — bounded by the 10k-row import cap enforced server-side.

export interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
}

/** Split raw CSV text into a header row + record objects keyed by header. */
export function parseCsv(text: string): ParsedCsv {
  const matrix = toMatrix(text);
  const headerRow = matrix[0];
  if (!headerRow) return { headers: [], rows: [] };

  const headers = headerRow.map((h) => h.trim());
  const rows: Record<string, string>[] = [];

  for (let r = 1; r < matrix.length; r++) {
    const cells = matrix[r] ?? [];
    // Skip fully-empty trailing lines (common with a final newline).
    if (cells.length === 1 && cells[0] === '') continue;
    const row: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      const key = headers[c];
      if (key === undefined) continue;
      row[key] = (cells[c] ?? '').trim();
    }
    rows.push(row);
  }

  return { headers, rows };
}

/** Tokenize CSV text into a 2D array of raw cell strings. */
function toMatrix(text: string): string[][] {
  const matrix: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  // Normalize CRLF/CR to LF so newline handling stays single-character.
  const src = text.replace(/\r\n?/g, '\n');

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];

    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++; // consume the escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      matrix.push(row);
      field = '';
      row = [];
    } else {
      field += ch;
    }
  }

  // Flush the final field/row if the file did not end with a newline.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    matrix.push(row);
  }

  return matrix;
}
