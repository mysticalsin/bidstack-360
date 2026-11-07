/**
 * Streaming, quote-aware CSV parser for ChileCompra bulk files: Latin-1,
 * semicolon-delimited, quoted fields that may contain `;` and newlines.
 */

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

  /** Flush the final row when the input does not end with a newline. */
  end(): string[][] {
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
 * Stream Latin-1 CSV bytes as header-keyed records. Accepts any sync or async
 * iterable of chunks, so a 287 MB monthly file never sits in memory whole.
 */
export async function* iterateCsvRecords(
  chunks: Iterable<Uint8Array> | AsyncIterable<Uint8Array>,
  opts: { delimiter?: string } = {},
): AsyncGenerator<Record<string, string>> {
  const parser = new CsvParser(opts.delimiter ?? ';');
  let header: string[] | null = null;
  const toRecord = (row: string[]): Record<string, string> => {
    const rec: Record<string, string> = {};
    header!.forEach((name, i) => {
      rec[name] = row[i] ?? '';
    });
    return rec;
  };
  for await (const chunk of chunks) {
    for (const row of parser.push(decodeLatin1(chunk))) {
      if (!header) header = row;
      else yield toRecord(row);
    }
  }
  for (const row of parser.end()) {
    if (!header) header = row;
    else yield toRecord(row);
  }
}
