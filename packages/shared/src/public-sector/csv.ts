/**
 * Streaming, quote-aware CSV parser for ChileCompra bulk files: Latin-1,
 * semicolon-delimited, quoted fields that may contain `;` and newlines.
 */

import { PsSourceError } from './errors.js';

const latin1Decoder = new TextDecoder('latin1');

/** Decode Latin-1 bytes. Single-byte, so chunks can be decoded independently. */
export function decodeLatin1(bytes: Uint8Array): string {
  return latin1Decoder.decode(bytes);
}

type State = 'fieldStart' | 'unquoted' | 'quoted' | 'quotePending';

/** Incremental parser: push text, receive the rows completed so far. */
export class CsvParser {
  private state: State = 'fieldStart';
  private field = '';
  private row: string[] = [];
  private rowStarted = false;

  constructor(private readonly delimiter = ';') {}

  /** Feed text; returns completed rows. */
  push(text: string): string[][] {
    const out: string[][] = [];
    const d = this.delimiter;
    for (let i = 0; i < text.length; i += 1) {
      const c = text[i]!;
      switch (this.state) {
        case 'fieldStart':
          if (c === '"') {
            this.state = 'quoted';
            this.rowStarted = true;
          } else if (c === d) {
            this.endField();
          } else if (c === '\n') {
            this.endRow(out);
          } else if (c !== '\r') {
            this.field += c;
            this.state = 'unquoted';
            this.rowStarted = true;
          }
          break;
        case 'unquoted':
          if (c === d) this.endField();
          else if (c === '\n') this.endRow(out);
          else if (c !== '\r') this.field += c;
          break;
        case 'quoted':
          if (c === '"') this.state = 'quotePending';
          else this.field += c;
          break;
        case 'quotePending':
          if (c === '"') {
            this.field += '"';
            this.state = 'quoted';
          } else if (c === d) {
            this.endField();
          } else if (c === '\n') {
            this.endRow(out);
          } else if (c !== '\r') {
            this.field += c;
            this.state = 'unquoted';
          }
          break;
      }
    }
    return out;
  }

  /** Flush the final row when the input does not end with a newline. Throws on an unterminated quote. */
  end(): string[][] {
    if (this.state === 'quoted') {
      throw new PsSourceError('schema', 'CSV ended inside a quoted field (truncated file?)', { doNotRetry: true });
    }
    const out: string[][] = [];
    if (this.rowStarted || this.row.length > 0 || this.field !== '') this.endRow(out);
    return out;
  }

  private endField(): void {
    this.row.push(this.field);
    this.field = '';
    this.state = 'fieldStart';
    this.rowStarted = true;
  }

  private endRow(out: string[][]): void {
    if (this.rowStarted || this.row.length > 0 || this.field !== '') {
      this.row.push(this.field);
      out.push(this.row);
    }
    this.row = [];
    this.field = '';
    this.state = 'fieldStart';
    this.rowStarted = false;
  }
}

/** Parse a whole CSV string into rows. */
export function parseCsvText(text: string, delimiter = ';'): string[][] {
  const p = new CsvParser(delimiter);
  return [...p.push(text), ...p.end()];
}

/**
 * Clean a header row: drop a byte order mark, trim names, and suffix repeated
 * names (`Name`, `Name#2`) so no column silently overwrites another.
 */
export function normalizeCsvHeader(row: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return row.map((raw, i) => {
    let name = raw;
    // A UTF-8 byte order mark reads as U+00EF U+00BB U+00BF once decoded as Latin-1.
    if (i === 0) name = name.replace(/^(?:\uFEFF|\u00EF\u00BB\u00BF)/, '');
    name = name.trim();
    const n = (seen.get(name) ?? 0) + 1;
    seen.set(name, n);
    return n === 1 ? name : `${name}#${n}`;
  });
}

/**
 * Stream Latin-1 CSV bytes as header-keyed records. Parsing is incremental, so
 * the decoded file is never held as one string. `requiredColumns` fails fast
 * with a `schema` error when the header has drifted.
 */
export async function* iterateCsvRecords(
  chunks: Iterable<Uint8Array> | AsyncIterable<Uint8Array>,
  opts: { delimiter?: string; requiredColumns?: readonly string[] } = {},
): AsyncGenerator<Record<string, string>> {
  const parser = new CsvParser(opts.delimiter ?? ';');
  let header: string[] | null = null;
  const setHeader = (row: string[]): void => {
    header = normalizeCsvHeader(row);
    const missing = (opts.requiredColumns ?? []).filter((c) => !header!.includes(c));
    if (missing.length > 0) {
      throw new PsSourceError('schema', `CSV header is missing columns: ${missing.join(', ')}`, { doNotRetry: true });
    }
  };
  const toRecord = (row: string[]): Record<string, string> => {
    const rec: Record<string, string> = {};
    header!.forEach((name, i) => {
      rec[name] = row[i] ?? '';
    });
    return rec;
  };
  for await (const chunk of chunks) {
    for (const row of parser.push(decodeLatin1(chunk))) {
      if (!header) setHeader(row);
      else yield toRecord(row);
    }
  }
  for (const row of parser.end()) {
    if (!header) setHeader(row);
    else yield toRecord(row);
  }
  if (!header && opts.requiredColumns?.length) {
    throw new PsSourceError('schema', 'CSV is empty', { doNotRetry: true });
  }
}
