import { describe, expect, it } from 'vitest';

import { rowsToCsv } from '@/lib/csv';

import { restoreExportedContactCell } from './contact-csv-cell';

describe('restoreExportedContactCell', () => {
  it('returns the demo phones the list export escaped', () => {
    // WHY: Klaus Vogt and Michael Johnson are stored as +49 and +1. The
    // exporter prefixes an apostrophe. The paste has to save that number,
    // and a phone that was already printed without the escape stays as typed.
    const csv = rowsToCsv(
      [{ phone: '+1 416 555 0142' }, { phone: '+49 30 1234 5670' }, { phone: '+46 8 555 0102' }],
      [{ key: 'phone', label: 'Phone' }],
    );
    const phones = csv
      .split('\n')
      .slice(1)
      .map((line) => line.replace(/\r$/, ''));

    expect(phones.map(restoreExportedContactCell)).toEqual([
      '+1 416 555 0142',
      '+49 30 1234 5670',
      '+46 8 555 0102',
    ]);
    expect(restoreExportedContactCell('+33 1 55 00 0100')).toBe('+33 1 55 00 0100');
  });

  it('does not turn a word or a plain apostrophe into a phone', () => {
    // WHY: the escape is only the spreadsheet prefix. A name, a sentiment,
    // or an apostrophe that is part of the text must not be rewritten.
    expect(restoreExportedContactCell("'warm")).toBe("'warm");
    expect(restoreExportedContactCell("O'Brien")).toBe("O'Brien");
    expect(restoreExportedContactCell("'")).toBe("'");
    expect(restoreExportedContactCell('')).toBe('');
    expect(restoreExportedContactCell('erased')).toBe('erased');
    expect(restoreExportedContactCell("'+")).toBe('+');
  });
});
