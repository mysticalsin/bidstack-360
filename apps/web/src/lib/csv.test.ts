import { describe, expect, it } from 'vitest';

import { csvCell, rowsToCsv } from './csv';

describe('csvCell — formula-injection neutralization', () => {
  // WHY: a cell beginning with any of these characters is executed as a
  // formula by Excel / Google Sheets / LibreOffice when the exported file is
  // opened. A leading apostrophe forces literal-text interpretation, which is
  // the difference between a benign string and arbitrary command execution
  // (e.g. =cmd|'/c calc'!A1, =HYPERLINK(...) phishing, +WEBSERVICE exfil).
  it.each([
    ['=SUM(A1:A2)', "'=SUM(A1:A2)"],
    ['+1+1', "'+1+1"],
    ['-1+1', "'-1+1"],
    ['@SUM(A1)', "'@SUM(A1)"],
    ['\tleading-tab', "'\tleading-tab"],
    ['\rleading-cr', "'\rleading-cr"],
  ])('prefixes a leading %j with an apostrophe', (input, expected) => {
    expect(csvCell(input)).toBe(expected);
  });

  it('leaves a safe value untouched', () => {
    expect(csvCell('Acme Corp')).toBe('Acme Corp');
  });

  it('only neutralizes the FIRST character — interior operators are safe', () => {
    // "1+1" does not start with a trigger char, so spreadsheets treat it as
    // text already; we must not corrupt legitimate data by escaping it.
    expect(csvCell('1+1')).toBe('1+1');
    expect(csvCell('a=b')).toBe('a=b');
  });

  it('returns empty string unchanged', () => {
    expect(csvCell('')).toBe('');
  });
});

describe('rowsToCsv uses csvCell under the hood', () => {
  it('neutralizes a formula in a data cell and quotes it when it also has a comma', () => {
    const csv = rowsToCsv([{ name: '=1,2' }], [{ key: 'name', label: 'Name' }]);
    // Leading '=' apostrophe-escaped, then RFC-4180-quoted for the comma.
    expect(csv).toBe('Name\r\n"\'=1,2"');
  });
});
