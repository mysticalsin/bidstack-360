import { describe, expect, it } from 'vitest';

import { presentFinancials, presentKeyNumbers } from './demo-data.js';

describe('demo data off hides sample numbers', () => {
  it('replaces a sample financial layout with Not connected and no figures', () => {
    // WHY: an eligible account with no filing was filled with example revenue.
    // With the switch off, that example must not be a number on the page.
    const shown = presentFinancials(
      {
        sample: true,
        periods: [{ fiscalYear: 2025, metrics: { revenue: { value: 1_200_000_000 } } }],
        signals: [{ id: 'sample:capex_up', sample: true }],
        periodsContinue: false,
        statusCopy: 'Example layout',
      },
      false,
    );
    expect(shown.sample).toBe(false);
    expect(shown.periods).toEqual([]);
    expect(shown.signals).toEqual([]);
    expect(shown.statusCopy).toBe('Not connected');
    expect(JSON.stringify(shown)).not.toContain('1200000000');
  });

  it('keeps a sample layout when the org turned demo data on', () => {
    const body = { sample: true, periods: [{ fiscalYear: 2025 }], signals: [], statusCopy: null };
    expect(presentFinancials(body, true)).toBe(body);
  });

  it('blanks a sample key number and leaves a real one', () => {
    const body = presentKeyNumbers(
      {
        companyId: 'c',
        items: [
          {
            id: 'revenue',
            group: 'company',
            label: 'Revenue',
            value: 1_200_000_000,
            unit: 'money',
            currency: 'EUR',
            delta: 9,
            deltaUnit: 'pct',
            goodWhen: 'up',
            series: [1, 2],
            sub: 'FY2025',
            source: 'Sample',
            period: 'FY2025',
            sourceUrl: null,
            anchor: null,
            missing: null,
            sample: true,
          },
          {
            id: 'pipeline',
            group: 'health',
            label: 'Open pipeline',
            value: 5_000_000,
            unit: 'money_micros',
            currency: null,
            delta: null,
            deltaUnit: null,
            goodWhen: 'up',
            series: [],
            sub: '1 open deal',
            source: 'Polo pipeline',
            period: 'Now',
            sourceUrl: null,
            anchor: null,
            missing: null,
            sample: false,
          },
        ],
        computedAt: '2026-11-20T00:00:00.000Z',
      },
      false,
    );
    const revenue = body.items.find((item) => item.id === 'revenue');
    const pipeline = body.items.find((item) => item.id === 'pipeline');
    expect(revenue).toMatchObject({ value: null, sample: false, missing: 'Not connected', series: [] });
    expect(pipeline).toMatchObject({ value: 5_000_000, sample: false });
  });
});
