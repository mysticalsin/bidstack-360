import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AccountWatchdog } from '@/hooks/useAccountWatchdog';

const state: { data?: AccountWatchdog; isLoading: boolean; isError: boolean } = { isLoading: false, isError: false };
vi.mock('@/hooks/useAccountWatchdog', () => ({
  useAccountWatchdog: () => ({ ...state, refetch: vi.fn() }),
}));

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
    expect(screen.getByText('No public filings tracked yet')).toBeTruthy();
    expect(screen.getByText(/SEC CIK 0000320193/)).toBeTruthy();
    expect(screen.getByText('No scheduled results')).toBeTruthy();
  });

  it('tags events with text, not colour alone, and exposes severity', () => {
    state.data = {
      ...base,
      events: [
        {
          id: 'e1', source: 'sec_edgar', kind: 'RESTRUCTURING', title: '8-K Item 2.05 — exit costs',
          summary: 'Restructuring announced.', sourceUrl: 'https://www.sec.gov/x', occurredAt: '2026-10-20T00:00:00Z',
          implication: 'RISK', implicationRationale: null, severity: 4, status: 'NEW',
        },
      ],
    };
    render(<AccountWatchdogSection companyId="c1" />);
    expect(screen.getByText('Risk')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Severity 4 of 5' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /exit costs/ }).getAttribute('href')).toBe('https://www.sec.gov/x');
  });

  it('switches between past projects and history tabs', () => {
    state.data = {
      ...base,
      pastProjects: [{ id: 'p1', name: 'Core banking RFP', outcome: 'won', valueMicros: '2000000000000', closedAt: '2026-03-01T00:00:00Z' }],
      history: [{ id: 'op:p1', at: '2026-03-01T00:00:00Z', type: 'opportunity', title: 'Core banking RFP', detail: 'Closed won' }],
    };
    render(<AccountWatchdogSection companyId="c1" />);
    expect(screen.getByText('1 won · 0 lost')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'History' }));
    expect(screen.getByRole('tab', { name: 'History' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText(/Opportunity · Closed won/)).toBeTruthy();
  });
});
