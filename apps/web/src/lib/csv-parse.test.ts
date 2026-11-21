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

  it('strips a UTF-8 BOM so the first header still matches Name', () => {
    // WHY: downloadCsv writes a BOM so Excel reads UTF-8. The header trim
    // drops U+FEFF. This locks that, including a non-Latin value beside it.
    const { headers, rows } = parseCsv('\uFEFFname,note\nÅngström,"line\ntwo"');
    expect(headers).toEqual(['name', 'note']);
    expect(rows[0]).toEqual({ name: 'Ångström', note: 'line\ntwo' });
  });

  it('splits a semicolon file instead of gluing every column into one cell', () => {
    // WHY: Excel in locales that use a comma decimal writes ';' between cells.
    // Treating that as one column imports the header "name;email" and no email.
    const { headers, rows } = parseCsv('name;email\nÅngström;a@example.com\n');
    expect(headers).toEqual(['name', 'email']);
    expect(rows).toEqual([{ name: 'Ångström', email: 'a@example.com' }]);
  });

  it('splits a tab-separated file', () => {
    const { rows } = parseCsv('name\temail\nAda\ta@example.com\n');
    expect(rows).toEqual([{ name: 'Ada', email: 'a@example.com' }]);
  });

  it('rejects an unclosed quote instead of gluing the rest of the file into one cell', () => {
    // WHY: a missing closing quote used to swallow the following rows into the
    // first name, and the wizard offered to import that corrupted row.
    expect(() =>
      parseCsv(
        'name,email\n"Northwind Labs,avery@northwind.example.com\nContoso Rail,blair@contoso.example.com\n',
      ),
    ).toThrow(/unclosed quote/);
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

  it('maps Account Name, Employees, and Country onto the company fields', () => {
    // WHY: a Salesforce-style account export uses these headers. Leaving them
    // unmapped blocks the required Name field, and on a phone the clipped
    // select cannot be used to fix it.
    const result = autoMap(['Account Name', 'Employees', 'Country'], TARGET_FIELDS.company);
    expect(result['Account Name']).toBe('company.name');
    expect(result['Employees']).toBe('company.employeeCount');
    expect(result['Country']).toBe('company.countryCode');
  });
});
