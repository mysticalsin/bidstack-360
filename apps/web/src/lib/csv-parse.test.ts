import { describe, expect, it } from 'vitest';

import { parseCsv } from './csv-parse';
import { autoMap, TARGET_FIELDS } from './import-fields';

describe('parseCsv', () => {
  it('parses a simple CSV into header-keyed rows', () => {
    const { headers, rows } = parseCsv('name,email\nAcme,a@acme.com\nBeta,b@beta.com');
    expect(headers).toEqual(['name', 'email']);
    expect(rows).toEqual([
      { name: 'Acme', email: 'a@acme.com' },
      { name: 'Beta', email: 'b@beta.com' },
    ]);
  });

  it('honors quoted fields containing commas and newlines', () => {
    // WHY: a quoted "Smith, John" must stay one cell, not split on the comma —
    // otherwise every downstream column shifts and the import is silently wrong.
    const csv = 'name,note\n"Smith, John","line1\nline2"\nPlain,ok';
    const { rows } = parseCsv(csv);
    expect(rows[0]).toEqual({ name: 'Smith, John', note: 'line1\nline2' });
    expect(rows[1]).toEqual({ name: 'Plain', note: 'ok' });
  });

  it('unescapes doubled quotes inside a quoted field', () => {
    const { rows } = parseCsv('name\n"He said ""hi"""');
    expect(rows[0].name).toBe('He said "hi"');
  });

  it('handles CRLF line endings and a trailing newline', () => {
    const { rows } = parseCsv('a,b\r\n1,2\r\n');
    expect(rows).toEqual([{ a: '1', b: '2' }]);
  });

  it('returns empty result for empty input', () => {
    expect(parseCsv('')).toEqual({ headers: [], rows: [] });
  });

  it('splits a semicolon file into columns instead of one glued company', () => {
    // WHY: Excel in a comma-decimal locale writes ";" between cells. Reading
    // that as one column lets the wizard treat "Lumen Freight;lumen.example"
    // as a valid company name.
    const { headers, rows } = parseCsv('name;domain\nLumen Freight;lumen.example\n');
    expect(headers).toEqual(['name', 'domain']);
    expect(rows).toEqual([{ name: 'Lumen Freight', domain: 'lumen.example' }]);
    // A decimal comma is part of the amount, not a new column.
    expect(parseCsv('name;amount\nLumen Freight;1234,56\n').rows).toEqual([
      { name: 'Lumen Freight', amount: '1234,56' },
    ]);
  });

  it('drops an Excel sep hint so the hint is not imported as a company', () => {
    // WHY: Excel writes "sep=;" on the first line. If that line is the header,
    // the real header becomes a row and preview can save a company named "name".
    const hinted = parseCsv('sep=;\nname;domain\nLumen Freight;lumen.example\n');
    expect(hinted.headers).toEqual(['name', 'domain']);
    expect(hinted.rows).toEqual([{ name: 'Lumen Freight', domain: 'lumen.example' }]);
    expect(hinted.rows.some((row) => Object.values(row).includes('name'))).toBe(false);

    const commaHint = parseCsv('sep=,\nname,domain\nLumen Freight,lumen.example\n');
    expect(commaHint).toEqual({
      headers: ['name', 'domain'],
      rows: [{ name: 'Lumen Freight', domain: 'lumen.example' }],
    });

    const withBom = parseCsv('\uFEFFsep=;\r\nname;domain\r\nLumen Freight;lumen.example\r\n');
    expect(withBom.rows).toEqual([{ name: 'Lumen Freight', domain: 'lumen.example' }]);
  });

  it('keeps a comma file when a semicolon sits inside a cell', () => {
    // WHY: a tie, or a semicolon that is text, must stay a comma. This app
    // exports commas. Flipping the separator would shift every column.
    expect(parseCsv('name;legal,domain\nA;B,north.example\n')).toEqual({
      headers: ['name;legal', 'domain'],
      rows: [{ 'name;legal': 'A;B', domain: 'north.example' }],
    });
    expect(parseCsv('name,note\nLumen Freight,see; later\n').rows[0]).toEqual({
      name: 'Lumen Freight',
      note: 'see; later',
    });
  });

  it('keeps a quoted comma inside a semicolon file and reads tabs', () => {
    // WHY: the separator is only the character between cells. A comma inside
    // quotes is part of the name, and a tab-separated paste is the same split.
    expect(parseCsv('"Lumen, Freight";domain\n"Lumen, Freight";lumen.example\n')).toEqual({
      headers: ['Lumen, Freight', 'domain'],
      rows: [{ 'Lumen, Freight': 'Lumen, Freight', domain: 'lumen.example' }],
    });
    expect(parseCsv('name\tdomain\nLumen Freight\tlumen.example\n')).toEqual({
      headers: ['name', 'domain'],
      rows: [{ name: 'Lumen Freight', domain: 'lumen.example' }],
    });
    expect(parseCsv('\uFEFFname;domain\nLumen Freight;lumen.example').headers).toEqual([
      'name',
      'domain',
    ]);
  });
});

describe('autoMap', () => {
  it('matches headers to fields by normalized label or key tail, each field once', () => {
    const headers = ['First Name', 'Last Name', 'Email', 'Unknown Column'];
    const result = autoMap(headers, TARGET_FIELDS.contact);
    expect(result['First Name']).toBe('contact.firstName');
    expect(result['Last Name']).toBe('contact.lastName');
    expect(result['Email']).toBe('contact.email');
    // No plausible target → left unmapped rather than mis-mapped.
    expect(result['Unknown Column']).toBeNull();
  });

  it('does not reuse a target field for two distinct headers', () => {
    // Both normalize to "email" — the first wins, the second is left unmapped
    // so a column can never be silently overwritten by a later duplicate.
    const result = autoMap(['Email', 'E-mail'], TARGET_FIELDS.contact);
    expect(result['Email']).toBe('contact.email');
    expect(result['E-mail']).toBeNull();
  });
});
