import { describe, expect, it } from 'vitest';

import { spreadsheetCell } from './spreadsheet-cell.js';

describe('spreadsheetCell', () => {
  it('prefixes a formula and leaves a signed amount as a number', () => {
    // WHY: company, contact, task, report, and opportunity exports share this.
    // A loss has to stay numeric. A formula still has to be text.
    expect(spreadsheetCell('-1.50')).toBe('-1.50');
    expect(spreadsheetCell('+33123456789')).toBe('+33123456789');
    expect(spreadsheetCell('-1+1')).toBe("'-1+1");
    expect(spreadsheetCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(spreadsheetCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(spreadsheetCell('\tleading')).toBe("'\tleading");
  });
});
