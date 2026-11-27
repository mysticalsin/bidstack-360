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

  it('drops comma-only rows a spreadsheet leaves after the last record', () => {
    // WHY: Excel writes an empty sheet row as commas. Those cells are not a
    // company. Keeping them imports a blank record beside the real one, and a
    // file of only those rows looks like it has data.
    const withRecord = parseCsv('name,domain\nAcme,acme.com\n,\n,,\n  ,  \n');
    expect(withRecord.rows).toEqual([{ name: 'Acme', domain: 'acme.com' }]);

    const onlyBlanks = parseCsv('name,domain\n,\n,,\n');
    expect(onlyBlanks).toEqual({ headers: ['name', 'domain'], rows: [] });
  });

  it('keeps a row that has a value in any column', () => {
    // WHY: a blank name next to a real domain is a row the mapper can still
    // place. Only a row with no values at all is a leftover.
    expect(parseCsv('name,domain\n,acme.com\n')).toEqual({
      headers: ['name', 'domain'],
      rows: [{ name: '', domain: 'acme.com' }],
    });
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
