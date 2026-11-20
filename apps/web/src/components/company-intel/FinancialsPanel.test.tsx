import type { AccountFinancialsIntel } from '@bidstack/shared';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { fmtMoney } from '@/components/financials/financials-format';

import { FinancialsPanel } from './IntelPanels';

const year = {
  fiscalYear: 2025,
  periodEnd: '2025-12-31',
  currency: 'EUR',
  source: 'ESEF (filings.xbrl.org)',
  sourceUrl: 'https://filings.xbrl.org/r-2025',
  revenue: 29_900e6,
  operatingMargin: 12,
  netMargin: 8,
  capex: 120e6,
  rnd: null,
  acquisitions: null,
  intangibles: null,
  debtIssued: null,
  cash: null,
  debt: null,
  headcount: null,
  restructuring: null,
  sample: false,
  evidenceId: 'fin:2025',
};

const fin: AccountFinancialsIntel = { companyId: 'c1', years: [year], revenueFallback: null, registry: [], sample: false };

describe('FinancialsPanel table cells', () => {
  afterEach(cleanup);

  it('marks a figure the filing did not report as Not disclosed and names the source checked', () => {
    render(<FinancialsPanel f={fin} />);
    const row = screen.getByTestId('intel-fin-year-2025');
    const missing = within(row).getAllByText('Not disclosed');
    // R&D, acquisitions and headcount are null in this filing.
    expect(missing).toHaveLength(3);
    for (const cell of missing) expect(cell.getAttribute('title')).toBe('Not disclosed in ESEF (filings.xbrl.org)');
    expect(row.textContent).not.toMatch(/(^|\s)-(\s|$)/);
  });

  it('formats money the same way as the key numbers (code first, one formatter)', () => {
    render(<FinancialsPanel f={fin} />);
    const row = screen.getByTestId('intel-fin-year-2025');
    expect(within(row).getByText(fmtMoney(29_900e6, 'EUR'))).toBeTruthy();
    expect(fmtMoney(29_900e6, 'EUR')).toBe('EUR 29.9bn');
    expect(row.textContent).not.toContain('30bn EUR');
  });
});
