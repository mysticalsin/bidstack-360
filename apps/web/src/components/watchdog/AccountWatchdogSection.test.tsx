import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AccountWatchdog } from '@/hooks/useAccountWatchdog';

const state: { data?: AccountWatchdog; isLoading: boolean; isError: boolean } = { isLoading: false, isError: false };
vi.mock('@/hooks/useAccountWatchdog', () => ({
  useAccountWatchdog: () => ({ ...state, refetch: vi.fn() }),
}));
const mi: { data?: { items: unknown[] } } = {};
vi.mock('@/hooks/useMeetingIntel', () => ({ useMeetingWatchdogFeed: () => mi }));
const enr: { data?: unknown } = {};
vi.mock('@/hooks/useCompanyEnrichment', () => ({ useCompanyEnrichment: () => enr }));

import { mockEnrichment } from '@/lib/enrichment/mock';

import { AccountWatchdogSection } from './AccountWatchdogSection';

const base: AccountWatchdog = {
  companyId: 'c1',
  monitoring: { enabled: true, identifiers: ['SEC CIK 0000320193'], lastCheckedAt: null, lastError: null },
  events: [],
  earnings: [],
  pastProjects: [],
  history: [],
};

describe('AccountWatchdogSection', () => {
  afterEach(cleanup);
  it('explains an empty feed with the watched identifiers', () => {
    state.data = base;
    render(<AccountWatchdogSection companyId="c1" />);
    expect(screen.getByText('Nothing new in public filings')).toBeTruthy();
    expect(screen.getByText(/SEC CIK 0000320193/)).toBeTruthy();
    expect(screen.getByText('No results dates announced')).toBeTruthy();
  });

  const ev = (n: number, implication: 'RISK' | 'OPPORTUNITY' | 'NEUTRAL' = 'RISK') => ({
    id: `e${n}`, source: 'sec_edgar', kind: 'RESTRUCTURING', title: `8-K Item 2.05 exit costs ${n}`,
    summary: `Restructuring announced ${n}.`, sourceUrl: `https://www.sec.gov/${n}`, occurredAt: '2026-10-20T00:00:00Z',
    implication, implicationRationale: null, severity: 4, status: 'NEW',
  });

  it('shows the top 3 signals as one line each with a single pill, details on click', () => {
    state.data = { ...base, events: [ev(1), ev(2, 'OPPORTUNITY'), ev(3, 'NEUTRAL'), ev(4)] };
    render(<AccountWatchdogSection companyId="c1" />);
    const rows = screen.getAllByRole('button', { name: /exit costs/ });
    expect(rows).toHaveLength(3);
    // One pill per row (the strip legend repeats the words, so scope to pills).
    expect(screen.getAllByText('Risk', { selector: '.wd-pill' })).toHaveLength(1);
    expect(screen.getByText('Opportunity', { selector: '.wd-pill' })).toBeTruthy();
    expect(screen.getByText('Watch', { selector: '.wd-pill' })).toBeTruthy();
    // The time-axis strip has a text alternative.
    expect(screen.getByRole('img', { name: /^Signals since/ })).toBeTruthy();
    // No severity dots, no description until expanded.
    expect(screen.queryByRole('img', { name: /Severity/ })).toBeNull();
    expect(screen.getByText('Restructuring announced 1.').closest('[hidden]')).toBeTruthy();
    fireEvent.click(rows[0]!);
    expect(rows[0]!.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Restructuring announced 1.').closest('[hidden]')).toBeNull();
    expect(screen.getAllByRole('link', { name: /Open source/ })[0]!.getAttribute('href')).toBe('https://www.sec.gov/1');
    fireEvent.click(screen.getByRole('button', { name: 'Show all 4 signals' }));
    expect(screen.getAllByRole('button', { name: /exit costs/ })).toHaveLength(4);
  });

  it('summarises past projects first and keeps one timeline (no tabs)', () => {
    state.data = {
      ...base,
      pastProjects: [
        { id: 'p1', name: 'Core banking RFP', outcome: 'won', valueMicros: '3000000000000', closedAt: '2026-03-01T00:00:00Z' },
        { id: 'p2', name: 'Data pilot', outcome: 'lost', valueMicros: '1000000000000', closedAt: '2026-02-01T00:00:00Z' },
      ],
      history: [{ id: 'op:p1', at: '2026-03-01T00:00:00Z', type: 'opportunity', title: 'Core banking RFP', detail: 'Closed won' }],
    };
    render(<AccountWatchdogSection companyId="c1" />);
    expect(screen.getByText('1 won, 1 lost')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Won 75% of closed value' })).toBeTruthy();
    expect(screen.queryByRole('tab')).toBeNull();
    const toggle = screen.getByRole('button', { name: 'Show 2 projects' });
    expect(screen.getByText('Data pilot').closest('[hidden]')).toBeTruthy();
    fireEvent.click(toggle);
    expect(screen.getByText('Data pilot').closest('[hidden]')).toBeNull();
    expect(screen.getByText(/Bid · Closed won/)).toBeTruthy();
  });

  it('folds cross-region meeting flags for this account into signals (task 5)', () => {
    state.data = base;
    mi.data = { items: [
      { kind: 'MEETING_CROSS_REGION', externalId: 'f1', companyId: 'c1', occurredAt: '2026-10-30T00:00:00Z', title: 'Data residency workshop took place at CI Financial Europe', summary: 'Ask your CA contacts.', implication: 'OPPORTUNITY', url: '/meeting-intel/flags/f1' },
      { kind: 'MEETING_CROSS_REGION', externalId: 'f2', companyId: 'other', occurredAt: '2026-10-30T00:00:00Z', title: 'Not mine', summary: '', implication: 'OPPORTUNITY', url: '/meeting-intel/flags/f2' },
    ] };
    render(<MemoryRouter><AccountWatchdogSection companyId="c1" /></MemoryRouter>);
    const row = screen.getByRole('button', { name: /Data residency workshop/ });
    expect(screen.queryByText('Not mine')).toBeNull();
    expect(screen.getByText(/Meeting intel ·/)).toBeTruthy();
    expect(screen.getByText('Opportunity', { selector: '.wd-pill' })).toBeTruthy();
    fireEvent.click(row);
    expect(screen.getByRole('link', { name: 'Open flag and talking points' }).getAttribute('href')).toBe('/meeting-intel/flags/f1');
    mi.data = undefined;
  });

  it('shows inferred potential projects as sample opportunity signals linking to their evidence', () => {
    state.data = base;
    enr.data = mockEnrichment('c1');
    render(<MemoryRouter><AccountWatchdogSection companyId="c1" /></MemoryRouter>);
    const rows = screen.getAllByRole('button', { name: /Sample: Potential project:/ });
    expect(rows.length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Hiring signals ·/).length).toBe(rows.length);
    fireEvent.click(rows[0]!);
    const link = screen.getByRole('link', { name: 'See the evidence postings' });
    expect(link.getAttribute('href')).toMatch(/^\/accounts\/c1#enrichment-project-/);
    enr.data = undefined;
  });
});
