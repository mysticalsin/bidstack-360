import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AccountWatchdog } from '@/hooks/useAccountWatchdog';

const state: { data?: AccountWatchdog; isLoading: boolean; isError: boolean } = { isLoading: false, isError: false };
const mutate = vi.fn();
vi.mock('@/hooks/useAccountWatchdog', () => ({
  useAccountWatchdog: () => ({ ...state, refetch: vi.fn() }),
  useSetWatchEventStatus: () => ({ mutate, isError: false }),
}));
const perms = { write: true };
vi.mock('@/hooks/useCapabilities', () => ({ useHasPermission: () => perms.write }));
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

  it('says what to add when the account has no website or ticker for news (v22)', () => {
    state.data = { ...base, news: { domain: null, ticker: null, hint: 'Add a website or stock ticker to this account to get news.' } };
    render(<AccountWatchdogSection companyId="c1" />);
    expect(screen.getByTestId('wd-news-hint').textContent).toBe('Add a website or stock ticker to this account to get news.');
    cleanup();
    state.data = { ...base, news: { domain: 'acme.com', ticker: null, hint: null } };
    render(<AccountWatchdogSection companyId="c1" />);
    expect(screen.queryByTestId('wd-news-hint')).toBeNull();
  });

  it('shows grouped analyst notes as one Market / analyst row with each note linked (v22.1)', () => {
    state.data = {
      ...base,
      events: [
        {
          id: 'grp:market:x', source: 'google_news', kind: 'MARKET_COMMENTARY', title: '3 analyst notes this week', displayTitle: '3 analyst notes this week',
          summary: 'a; b; c', sourceUrl: 'https://news.example/1', occurredAt: '2026-10-30T00:00:00Z', implication: 'NEUTRAL',
          implicationRationale: 'Stock and analyst chatter: context for the conversation, not a buying signal on its own.', severity: 1, status: 'NEW',
          importance: 15, category: 'market', mentions: 3, sample: false,
          group: [
            { id: 'n1', title: 'Aritzia (TSE:ATZ) Stock Price Target Raised at Canaccord', sourceUrl: 'https://news.example/1', occurredAt: '2026-10-30T00:00:00Z' },
            { id: 'n2', title: 'Aritzia Inc. (TSE:ATZ) Rated Moderate Buy', sourceUrl: 'https://news.example/2', occurredAt: '2026-10-29T00:00:00Z' },
            { id: 'n3', title: 'Can Aritzia (TSX:ATZ) Expand Its Boutique Network?', sourceUrl: 'https://news.example/3', occurredAt: '2026-10-28T00:00:00Z' },
          ],
        },
      ],
    };
    render(<MemoryRouter><AccountWatchdogSection companyId="c1" /></MemoryRouter>);
    const row = screen.getByRole('button', { name: /3 analyst notes this week/ });
    expect(row.textContent).toContain('Market / analyst');
    expect(row.textContent).not.toContain('outlets');
    fireEvent.click(row);
    const list = screen.getByRole('list', { name: 'Analyst notes in this group' });
    expect(list.querySelectorAll('a')).toHaveLength(3);
    expect(screen.queryByRole('button', { name: /Dismiss signal/ })).toBeNull();
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
    // One pill per row.
    expect(screen.getAllByText('Risk', { selector: '.wd-pill' })).toHaveLength(1);
    expect(screen.getByText('Opportunity', { selector: '.wd-pill' })).toBeTruthy();
    expect(screen.getByText('Watch', { selector: '.wd-pill' })).toBeTruthy();
    // v21: the strip moved into the Signals timeline; the feed has an order toggle instead.
    expect(screen.queryByRole('img', { name: /^Signals since/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Most important' }).getAttribute('aria-pressed')).toBe('true');
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

  it('summarises past projects; the old timeline lives in the Signals timeline now', () => {
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
    expect(screen.queryByText(/Bid · Closed won/)).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Timeline' })).toBeNull();
  });

  it('keeps the cents on a closed project', () => {
    // WHY: dividing micros by 1e6 dropped 250,000.50 to 250,000 and turned 7.86 million into a whole number.
    state.data = {
      ...base,
      pastProjects: [
        { id: 'p1', name: 'Core banking RFP', outcome: 'won', valueMicros: '7860000000000', closedAt: '2026-03-01T00:00:00Z' },
        { id: 'p2', name: 'Data pilot', outcome: 'lost', valueMicros: '250000500000', closedAt: '2026-02-01T00:00:00Z' },
      ],
    };
    render(<AccountWatchdogSection companyId="c1" />);
    expect(screen.getByText('8,110,000.50 total value')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show 2 projects' }));
    expect(screen.getByText('7.86m')).toBeTruthy();
    expect(screen.getByText('250,000.50')).toBeTruthy();
    expect(screen.queryByText('7.9m')).toBeNull();
    // WHY: the year chart added the unit numbers, so the same cents never reached the figure name.
    expect(screen.getByRole('img', { name: 'Won and lost value by close year: 2026 won 7.86m, lost 250,000.50' })).toBeTruthy();
  });

  it('names a close year from the micros sum when the unit numbers collapse', () => {
    // WHY: each of these wins becomes the same safe integer, so adding them was two short.
    const one = (9007199254740993n * 1_000_000n).toString();
    state.data = {
      ...base,
      pastProjects: [
        { id: 'a', name: 'Alpha', outcome: 'won', valueMicros: one, closedAt: '2026-01-15T00:00:00Z' },
        { id: 'b', name: 'Beta', outcome: 'won', valueMicros: one, closedAt: '2026-06-01T00:00:00Z' },
      ],
    };
    render(<AccountWatchdogSection companyId="c1" />);
    const name = screen.getByRole('img', { name: /Won and lost value by close year/ }).getAttribute('aria-label');
    expect(name).toContain('2026 won 18,014,398,509,481,986');
    expect(name).not.toContain('18,014,398,509,481,984');
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
    const rows = screen.getAllByRole('button', { name: /^Potential project:/ });
    // The "Sample: " prefix becomes a badge.
    expect(screen.getAllByText('Sample', { selector: '.wd-sample-badge' }).length).toBe(rows.length);
    expect(rows.length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Hiring signals ·/).length).toBe(rows.length);
    fireEvent.click(rows[0]!);
    const link = screen.getByRole('link', { name: 'See the evidence postings' });
    expect(link.getAttribute('href')).toMatch(/^\/accounts\/c1#enrichment-project-/);
    enr.data = undefined;
  });

  it('orders by importance with a Latest toggle and shows category, outlets and Sample', () => {
    state.data = {
      ...base,
      events: [
        { ...ev(1), title: 'Older funding', occurredAt: '2026-09-01T00:00:00Z', importance: 90, category: 'funding', mentions: 4, source: 'gdelt' },
        { ...ev(2), title: 'Sample: Newer hiring note', displayTitle: 'Newer hiring note', occurredAt: '2026-10-25T00:00:00Z', importance: 30, category: 'hiring', sample: true },
        { ...ev(3), title: 'Middle filing \u2014 restated', occurredAt: '2026-10-01T00:00:00Z', importance: 60 },
      ],
    };
    render(<AccountWatchdogSection companyId="c1" />);
    const titles = () => screen.getAllByRole('button', { expanded: false }).map((b) => b.querySelector('.wd-row-title')?.textContent ?? '').filter(Boolean);
    expect(titles()).toEqual(['ImportantOlder funding', 'Middle filing, restated', 'Newer hiring note']);
    expect(screen.getByText(/Funding · News · 4 outlets ·/)).toBeTruthy();
    expect(screen.getByText('Sample', { selector: '.wd-sample-badge' })).toBeTruthy();
    expect(screen.getByText(/1 important/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Latest' }));
    expect(titles()).toEqual(['Newer hiring note', 'Middle filing, restated', 'ImportantOlder funding']);
  });

  it('dismisses a stored signal with undo; browser-merged and read-only rows have no Dismiss', () => {
    mutate.mockClear();
    const id = '11111111-2222-4333-8444-555555555555';
    state.data = { ...base, events: [{ ...ev(1), id }, ev(2)] };
    render(<AccountWatchdogSection companyId="c1" />);
    fireEvent.click(screen.getAllByRole('button', { name: /exit costs/ })[0]!);
    expect(screen.getAllByRole('button', { name: /^Dismiss signal/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: /^Dismiss signal: 8-K Item 2.05 exit costs 1/ }));
    expect(mutate).toHaveBeenCalledWith({ eventId: id, status: 'DISMISSED' });
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(mutate).toHaveBeenLastCalledWith({ eventId: id, status: 'NEW' });
    cleanup();
    perms.write = false;
    render(<AccountWatchdogSection companyId="c1" />);
    expect(screen.queryByRole('button', { name: /^Dismiss signal/ })).toBeNull();
    perms.write = true;
  });
});
