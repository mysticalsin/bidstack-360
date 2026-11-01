import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SAMPLE_FINANCIAL_PERIODS, SAMPLE_FINANCIAL_SIGNALS, type AccountFinancials } from '@bidstack/shared';

const state: { data?: AccountFinancials; isLoading: boolean; isError: boolean } = { isLoading: false, isError: false };
const mutate = vi.fn();
vi.mock('@/hooks/useAccountFinancials', () => ({
  useAccountFinancials: () => ({ ...state, refetch: vi.fn() }),
  useTrackFinancials: () => ({ mutate, isPending: false, isError: false }),
}));

import { FinancialHealthSection } from './FinancialHealthSection';
import { buildTiles, fmtMoney } from './financials-format';

const general: AccountFinancials = {
  companyId: 'c1', tier: 'standard', tierLabel: 'General', gate: 'general',
  gateCopy: 'General accounts are not pulled automatically, to keep the scan small and polite to the public sources. Turn on Track financials to opt this account in.',
  trackFinancials: false, canToggle: true, status: 'paused', statusCopy: null, entity: null, lastPulledAt: null, nextPullAt: null, periods: [], signals: [], sample: false,
};

const P = (year: number, rev: number, margin: number | null, net: number | null = null) => ({
  periodType: 'FY' as const, fiscalYear: year, periodStart: `${year}-01-01`, periodEnd: `${year}-12-31`, currency: 'EUR', source: 'ESEF (filings.xbrl.org)',
  sourceUrl: `https://filings.xbrl.org/r/${year}`, filedAt: null,
  metrics: { revenue: { value: rev, concept: 'ifrs-full:Revenue' }, cash: { value: 14e6, concept: 'ifrs-full:CashAndCashEquivalents' } },
  derived: { operatingMargin: margin, netMargin: net, freeCashFlow: null },
});

const real: AccountFinancials = {
  ...general, tier: 'top', tierLabel: 'Top', gate: 'tier', gateCopy: 'Pulled automatically because this is a Strategic or Top account.', status: 'ok', canToggle: true,
  entity: { source: 'ESEF (filings.xbrl.org)', id: '5493004DM8FGIY6QKF37', name: 'NOS, SGPS, S.A.' }, lastPulledAt: '2026-11-01T04:00:00Z',
  periods: [P(2025, 1823e6, 16.5), P(2024, 1696e6, 22.4), P(2023, 1597e6, 16.5)],
  signals: [
    { id: 'a', rule: 'acquisitions', title: 'Acquisition mentioned in the report', explanation: 'Found in the narrative.', confidence: 'low', implication: 'OPPORTUNITY', periodEnd: '2025-12-31', sourceUrl: 'https://filings.xbrl.org/r/2025', snippet: 'NOS acquired the entire share capital of Claranet Portugal Group.', sample: false },
    { id: 'm', rule: 'margin_squeeze', title: 'Operating margin down 5.9 pts', explanation: 'Margin fell while restructuring charges were booked.', confidence: 'high', implication: 'RISK', periodEnd: '2025-12-31', sourceUrl: 'https://filings.xbrl.org/r/2025', snippet: null, sample: false },
  ],
};

describe('FinancialHealthSection', () => {
  afterEach(() => {
    cleanup();
    mutate.mockReset();
  });

  it('General account: explains why it is not pulled and offers Track financials to Admin / AE', () => {
    state.data = general;
    render(<FinancialHealthSection companyId="c1" />);
    expect(screen.getByTestId('fh-empty').textContent).toMatch(/not pulled automatically/);
    const sw = screen.getByRole('switch', { name: /Track financials/ });
    fireEvent.click(sw);
    expect(mutate).toHaveBeenCalledWith(true);
    expect(screen.queryByTestId('fh-tile-revenue')).toBeNull();
  });

  it('hides the toggle without permission', () => {
    state.data = { ...general, canToggle: false };
    render(<FinancialHealthSection companyId="c1" />);
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('real data: every number carries its period and source, missing lines say Not filed', () => {
    state.data = real;
    render(<FinancialHealthSection companyId="c1" />);
    const rev = screen.getByTestId('fh-tile-revenue');
    // WHY: 1.82bn is 1,820,000,000, three million short of the filed 1,823,000,000.
    expect(rev.textContent).toContain('EUR 1,823,000,000');
    expect(rev.textContent).toContain('+7%');
    expect(rev.textContent).toContain('FY2025');
    expect(rev.querySelector('a')?.getAttribute('href')).toBe('https://filings.xbrl.org/r/2025');
    expect(screen.getByTestId('fh-tile-margin').textContent).toContain('16.5%');
    expect(screen.getByTestId('fh-tile-margin').textContent).toContain('-5.9 pts');
    expect(screen.getByTestId('fh-tile-capex').textContent).toContain('Not filed');
    expect(screen.queryByText('Sample')).toBeNull();
    expect(screen.queryByText('Latest 20 fiscal years.')).toBeNull();
    // tier accounts never show the toggle
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('says when the fiscal-year trend is only the latest page', () => {
    // WHY: a full page of newer quarters used to hide the annual filing, and a long history was shown as complete.
    state.data = { ...real, periodsCapped: true };
    render(<FinancialHealthSection companyId="c1" />);
    expect(screen.getByText('Latest 20 fiscal years.')).toBeTruthy();
  });

  it('early warnings: high confidence first, details on click with snippet and filing link', () => {
    state.data = real;
    render(<FinancialHealthSection companyId="c1" />);
    const buttons = screen.getAllByRole('button', { expanded: false });
    expect(buttons[0]!.textContent).toContain('Operating margin down 5.9 pts');
    expect(buttons[0]!.textContent).toContain('High confidence');
    fireEvent.click(buttons[1]!);
    expect(screen.getByText(/Claranet Portugal Group/)).toBeTruthy();
    expect(screen.getAllByRole('link', { name: /Open filing/ }).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/[\u2014]/);
  });

  it('sample state is labelled Sample everywhere', () => {
    state.data = { ...real, status: 'pending', statusCopy: 'Queued: the next financials pull will fill this in.', entity: null, periods: SAMPLE_FINANCIAL_PERIODS, signals: SAMPLE_FINANCIAL_SIGNALS, sample: true };
    render(<FinancialHealthSection companyId="c1" />);
    expect(screen.getAllByText('Sample').length).toBeGreaterThan(2);
    expect(screen.getByTestId('fh-tile-revenue').querySelector('a')).toBeNull();
  });

  it('falls back to net margin for banks and formats money', () => {
    const tiles = buildTiles([P(2025, 90e9, null, 48), P(2024, 86e9, null, 53)]);
    expect(tiles[1]!.label).toBe('Net margin');
    // WHY: one decimal turned 90,649,000,000 into 90.6bn, and Math.round turned 7.86m into 8m.
    expect(fmtMoney(90_649e6, 'NOK')).toBe('NOK 90,649,000,000');
    expect(fmtMoney(-156_444e6, 'NOK')).toBe('-NOK 156,444,000,000');
    expect(fmtMoney(7_860_000, 'EUR')).toBe('EUR 7.86m');
    expect(fmtMoney(2_000_000, 'EUR')).toBe('EUR 2m');
    expect(fmtMoney(935e6, 'CAD')).toBe('CAD 935m');
    expect(fmtMoney(Number.NaN, 'EUR')).toBe('amount not readable');
  });
  it('period ends read as filed (31 Dec, not 30 Dec) and recent data is not flagged stale', () => {
    state.data = real;
    render(<FinancialHealthSection companyId="c1" />);
    expect(screen.getAllByText(/period to 31 Dec 2025/).length).toBe(2);
    expect(screen.queryByTestId('fh-stale')).toBeNull();
  });

  it('flags statements older than about 18 months as history (CI Financial stopped filing in 2023)', () => {
    state.data = { ...real, periods: [P(2021, 2730e6, null, 15.1), P(2020, 2050e6, null, 23.2)], signals: [] };
    render(<FinancialHealthSection companyId="c1" />);
    expect(screen.getByTestId('fh-stale').textContent).toContain('Latest filed period is FY2021');
  });
});
