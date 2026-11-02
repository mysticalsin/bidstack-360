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
});
