import { describe, expect, it } from 'vitest';

import { csvCell } from './csv';
import { parseCsv } from './csv-parse';

describe('parseCsv exported phone', () => {
  it('reads the phone the export printed, not the spreadsheet apostrophe', () => {
    // WHY: demo phones start with +. csvCell prefixes that plus so a
    // spreadsheet will not run the cell as a formula. The file import was
    // keeping the apostrophe, so the number no longer matched the book.
    const phone = '+33 1 55 00 0100';
    const { rows } = parseCsv(`name,phone\nAlex O'Brien,${csvCell(phone)}\n`);
    expect(rows).toEqual([{ name: "Alex O'Brien", phone }]);
  });

  it('keeps an apostrophe that is part of a name, and a signed amount', () => {
    // WHY: O'Brien is the name. The minus prefix is how the export marks a
    // signed amount, and this fix is only the leading plus on a phone.
    const { rows } = parseCsv("name,amount\nAlex O'Brien,'-1200\n");
    expect(rows).toEqual([{ name: "Alex O'Brien", amount: "'-1200" }]);
  });
});
