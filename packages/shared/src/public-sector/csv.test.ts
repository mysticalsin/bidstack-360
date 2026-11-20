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
    expect(parseRut('76.853.950-2')).toEqual({ body: 76853950, dv: '2', formatted: '76.853.950-2' });
    expect(parseRut('81.494.400-k')?.formatted).toBe('81.494.400-K');
    expect(parseRut('876067005')?.formatted).toBe('87.606.700-5');
    expect(parseRut('76.853.950-3')).toBeNull();
    expect(parseRut('NA')).toBeNull();
  });

  it('treats RUT bodies under 50,000,000 as natural persons', () => {
    expect(isNaturalPersonRut('12.345.678-5')).toBe(true);
    expect(isNaturalPersonRut('61.606.917-9')).toBe(false);
  });
});
