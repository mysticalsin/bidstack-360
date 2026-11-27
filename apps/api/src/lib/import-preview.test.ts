import { describe, expect, it } from 'vitest';

import { parseIsoDate, parseMoneyUnits, previewImportRows } from './import-preview.js';

describe('import preview validation', () => {
  it('rejects n/a money so a blank cell cannot become €0 revenue', () => {
    expect(parseMoneyUnits('n/a').ok).toBe(false);
    expect(parseMoneyUnits('1,200,000.50')).toEqual({ ok: true, units: 1_200_000.5 });
  });

  it('requires ISO dates so locale-formatted close dates cannot silently shift', () => {
    expect(parseIsoDate('31/12/2026').ok).toBe(false);
    expect(parseIsoDate('2026-12-31')).toEqual({ ok: true, iso: '2026-12-31' });
  });

  it('reports financial rows that lack currency or account without writing', () => {
    const result = previewImportRows({
      entityType: 'financials',
      mappings: {
        Account: 'financial.companyName',
        End: 'financial.periodEnd',
        Currency: 'financial.currency',
        Revenue: 'financial.revenue',
      },
      rows: [
        { Account: 'Acme', End: '2026-12-31', Currency: 'EUR', Revenue: '1000000' },
        { Account: '', End: '12/31/2026', Currency: 'EURO', Revenue: 'n/a' },
      ],
    });
    expect(result.validCount).toBe(1);
    expect(result.invalidCount).toBe(1);
    expect(result.issues.some((issue) => issue.field === 'financial.companyName')).toBe(true);
    expect(result.issues.some((issue) => issue.field === 'financial.currency')).toBe(true);
  });

  it('checks the later filled column when two columns share a field', () => {
    // WHY: the import writes the last non-empty cell for a field. The preview
    // was still reading the first column, so a blank Name hid Northwind Freight
    // and the row looked required-empty. A blank later column must keep the
    // earlier name, because that is the cell the import stores.
    const filledLater = previewImportRows({
      entityType: 'company',
      mappings: { Name: 'company.name', Legal: 'company.name' },
      rows: [{ Name: '', Legal: 'Northwind Freight' }],
    });
    expect(filledLater.invalidCount).toBe(0);
    expect(filledLater.issues).toEqual([]);

    const filledEarlier = previewImportRows({
      entityType: 'company',
      mappings: { Name: 'company.name', Legal: 'company.name' },
      rows: [{ Name: 'Northwind Freight', Legal: '' }],
    });
    expect(filledEarlier.invalidCount).toBe(0);
    expect(filledEarlier.issues).toEqual([]);
  });

  it('checks the later email when two columns share that field', () => {
    // WHY: a valid address in the first column was enough for the preview to
    // say the row was fine, while the import stored the later cell. That later
    // cell is the one that has to pass.
    const result = previewImportRows({
      entityType: 'contact',
      mappings: { Work: 'contact.email', Other: 'contact.email' },
      rows: [{ Work: 'good@northwind.example', Other: 'not-an-email' }],
    });
    expect(result.validCount).toBe(0);
    expect(result.issues).toEqual([
      { row: 1, field: 'contact.email', message: 'invalid email' },
    ]);
  });
});
