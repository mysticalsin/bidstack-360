import { describe, expect, it } from 'vitest';

import { decodeLatin1, iterateCsvRecords, parseCsvText } from './csv.js';
import { isNaturalPersonRut, parseRut } from './rut.js';

const latin1 = (s: string) => Uint8Array.from([...s].map((c) => c.charCodeAt(0)));

describe('Latin-1 semicolon CSV (ChileCompra bulk files)', () => {
  it('decodes Latin-1 bytes, so EXÁMENES stays EXÁMENES', () => {
    expect(decodeLatin1(latin1('EX\u00c1MENES OFTALMOL\u00d3GICOS'))).toBe('EXÁMENES OFTALMOLÓGICOS');
  });

  it('keeps semicolons and newlines that sit inside quotes', () => {
    const rows = parseCsvText('"a";"b";"c"\n1;"x ; y";"line1\nline2"\n2;NA;""\n', ';');
    expect(rows).toEqual([
      ['a', 'b', 'c'],
      ['1', 'x ; y', 'line1\nline2'],
      ['2', 'NA', ''],
    ]);
  });

  it('handles escaped quotes and CRLF', () => {
    expect(parseCsvText('"a";"b"\r\n"say ""hi""";2\r\n', ';')).toEqual([
      ['a', 'b'],
      ['say "hi"', '2'],
    ]);
  });

  it('streams records across chunk boundaries, including a split inside quotes', async () => {
    const text = '"h1";"h2"\n"va;l";1\n"two\nlines";2\n';
    const bytes = latin1(text);
    const chunks = [bytes.slice(0, 13), bytes.slice(13, 25), bytes.slice(25)];
    const out: Array<Record<string, string>> = [];
    for await (const rec of iterateCsvRecords(chunks)) out.push(rec);
    expect(out).toEqual([
      { h1: 'va;l', h2: '1' },
      { h1: 'two\nlines', h2: '2' },
    ]);
  });
});

describe('Chile RUT', () => {
  it('parses dotted, plain and OCDS forms and checks the verifier digit', () => {
    // Seeded synthetic bodies (synthetic-rut.ts indexes 500 / 513 / 502).
    expect(parseRut('99.000.600-8')).toEqual({ body: 99000600, dv: '8', formatted: '99.000.600-8' });
    expect(parseRut('99.000.613-k')?.formatted).toBe('99.000.613-K');
    expect(parseRut('990006024')?.formatted).toBe('99.000.602-4');
    expect(parseRut('99.000.600-9')).toBeNull();
    expect(parseRut('NA')).toBeNull();
  });

  it('treats RUT bodies under 50,000,000 as natural persons', () => {
    // Person index 500 stays in the scrubber fake window; institution index 500 does not.
    expect(isNaturalPersonRut('1.000.600-7')).toBe(true);
    expect(isNaturalPersonRut('61.000.600-0')).toBe(false);
  });
});
