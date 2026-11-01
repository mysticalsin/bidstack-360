import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AccountKeyNumbers, AccountPositioning, KeyNumber } from '@bidstack/shared';

const state: { pos: AccountPositioning | null; kn: AccountKeyNumbers | null } = { pos: null, kn: null };
vi.mock('@/hooks/useAccountPositioning', () => ({
  useAccountPositioning: () => ({ isLoading: false, isError: false, data: state.pos, refetch: vi.fn() }),
  useAccountKeyNumbers: () => ({ isLoading: false, isError: false, data: state.kn, refetch: vi.fn() }),
}));

import { KeyNumbersStrip } from './KeyNumbersStrip';
import { directionOf, formatDelta, formatValue, sparkPoints, toneOf } from './positioning-format';
import { WhatToPosition } from './WhatToPosition';

afterEach(cleanup);

const kn = (over: Partial<KeyNumber>): KeyNumber => ({
  id: 'x',
  group: 'company',
  label: 'X',
  value: null,
  unit: 'count',
  currency: null,
  delta: null,
  deltaUnit: null,
  goodWhen: 'up',
  series: [],
  sub: null,
  source: 'Src',
  period: 'Per',
  sourceUrl: null,
  anchor: null,
  missing: null,
  sample: false,
  ...over,
});

describe('positioning-format', () => {
  it('formats values, deltas and direction tones', () => {
    expect(formatValue(kn({ value: 1234 }))).toBe('1,234');
    expect(formatValue(kn({ value: 1.7e9, unit: 'money', currency: 'EUR' }))).toBe('EUR 1.70bn');
    expect(formatValue(kn({ value: 18.34, unit: 'pct' }))).toBe('18.3%');
    expect(formatValue(kn({ value: -0.4, unit: 'sentiment' }))).toBe('Negative');
    expect(formatValue(kn({ value: 12, unit: 'days' }))).toBe('12d ago');
    expect(formatValue(kn({}))).toBe('No data');
    expect(formatDelta(kn({ delta: 5.23, deltaUnit: 'pct' }))).toBe('+5.2%');
    expect(formatDelta(kn({ delta: -1.1, deltaUnit: 'pts' }))).toBe('-1.1 pts');
    expect(directionOf(kn({ delta: 0 }))).toBe('flat');
    expect(toneOf(kn({ delta: 3, goodWhen: 'down' }))).toBe('neg');
    expect(toneOf(kn({ delta: -3, goodWhen: 'down' }))).toBe('pos');
    expect(sparkPoints([1], 10, 10)).toBeNull();
    expect(sparkPoints([1, 2, 3], 10, 10)?.split(' ')).toHaveLength(3);
  });
});

describe('KeyNumbersStrip', () => {
  it('shows big numbers with arrows, source and period on hover, and the reason when missing', () => {
    state.kn = {
      companyId: 'c1',
      computedAt: '2026-11-01T00:00:00Z',
      items: [
        kn({ id: 'revenue', label: 'Revenue', unit: 'money', currency: 'EUR', value: 1.7e9, delta: 5, deltaUnit: 'pct', series: [1, 2, 3], source: 'ESEF (filings.xbrl.org)', period: 'FY2025 (to 2025-12-31), change vs prior year', sourceUrl: 'https://filings.example/1' }),
        kn({ id: 'open_jobs', label: 'Open jobs', missing: 'No job postings tracked yet' }),
        kn({ id: 'momentum', group: 'health', label: 'Momentum', unit: 'score', value: 62, delta: -4, deltaUnit: 'pts', sample: true }),
      ],
    };
    render(<KeyNumbersStrip companyId="c1" />);
    const rev = screen.getByTestId('kn-revenue');
    expect(within(rev).getByText('EUR 1.70bn')).toBeTruthy();
    expect(within(rev).getByText(/\+5\.0%/)).toBeTruthy();
    const tip = within(rev).getByRole('tooltip', { hidden: true });
    expect(tip.textContent).toContain('ESEF (filings.xbrl.org)');
    expect(tip.textContent).toContain('FY2025');
    expect(rev.getAttribute('aria-describedby')).toBe(tip.id);
    expect(within(screen.getByTestId('kn-open_jobs')).getByText('No job postings tracked yet')).toBeTruthy();
    const mom = screen.getByTestId('kn-momentum');
    expect(within(mom).getByText('Sample')).toBeTruthy();
    const md = mom.querySelector('.kn-delta')!;
    expect(md.textContent).toContain('-4.0 pts');
    expect(md.getAttribute('data-tone')).toBe('neg');
    expect(document.body.textContent).not.toMatch(/[\u2014\u2013]/);
  });
});

const pos: AccountPositioning = {
  companyId: 'c1',
  sample: false,
  computedAt: '2026-11-01T00:00:00Z',
  brief: {
    name: 'NOS',
    tierLabel: 'Strategic',
    industry: 'Telecom',
    country: 'PT',
    employees: { value: 2000, source: 'Account record' },
    momentum: null,
    financials: null,
    pipeline: { openCount: 0, openMicros: '0', won24m: 0, lost24m: 0 },
    people: { known: 0, senior: 0, metLast12m: 0, lastMeeting: null },
    topSignal: null,
  },
  plays: [
    {
      rank: 1,
      theme: 'm_and_a',
      themeLabel: 'M&A integration',
      offering: 'Post-merger integration',
      headline: 'Acquisitions in the filed accounts',
      whyNow: [
        { kind: 'financial', label: 'Spent EUR 120m on acquisitions', url: 'https://filings.example/nos', anchor: 'financial-health', at: '2025-12-31', source: 'ESEF', sample: false },
        { kind: 'news', label: 'NOS buys Claranet Portugal', url: null, anchor: 'watchdog', at: '2025-03-17', source: 'GDELT news', sample: false },
        { kind: 'initiative', label: 'Integration', url: null, anchor: 'initiatives', at: null, source: 'Initiatives board', sample: false },
      ],
      approach: [],
      approachGap: 'No Head of Corporate Development or Integration known yet. Map this role in the org chart.',
      talkingPoints: ['Point one.', 'Point two.'],
      firstStep: 'Offer an integration health check.',
      confidence: 'medium',
      confidenceScore: 0.55,
      alreadySold: false,
      dealRange: { lowMicros: '100000000000', highMicros: '300000000000', basis: 'Middle half of 4 won M&A deals in your pipeline', deals: 4 },
      sample: false,
    },
  ],
  gaps: [{ kind: 'senior_contacts', severity: 'high', title: 'No senior contacts mapped', detail: 'Map the economic buyer.', evidence: [] }],
};

describe('WhatToPosition', () => {
  it('shows the brief, a ranked play with evidence links, the approach gap, details on click and gaps', () => {
    state.pos = pos;
    render(<WhatToPosition companyId="c1" />);
    expect(screen.getByRole('heading', { name: 'What to position' })).toBeTruthy();
    expect(screen.getByTestId('account-brief').textContent).toContain('NOS is a Strategic account in Telecom, based in PT with about 2,000 employees.');
    const play = screen.getByTestId('wp-play-1');
    expect(within(play).getByText('Post-merger integration')).toBeTruthy();
    const links = within(play).getAllByRole('link');
    expect(links).toHaveLength(2);
    expect(links[0]!.getAttribute('href')).toBe('https://filings.example/nos');
    expect(links[0]!.getAttribute('target')).toBe('_blank');
    expect(links[1]!.getAttribute('href')).toBe('#watchdog');
    expect(within(play).getByText(/No Head of Corporate Development/)).toBeTruthy();
    const more = within(play).getByRole('button', { name: /Talking points/ });
    expect(more.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(more);
    expect(more.getAttribute('aria-expanded')).toBe('true');
    expect(within(play).getByText('Point one.')).toBeTruthy();
    expect(within(play).getByText(/Middle half of 4 won/)).toBeTruthy();
    expect(within(play).getAllByRole('link')).toHaveLength(3);
    expect(within(screen.getByTestId('gaps-risks')).getByText('No senior contacts mapped')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/[\u2014\u2013]/);
  });

  it('says what is needed when there is no play, and omits the deal range when not derived', () => {
    state.pos = { ...pos, plays: [], gaps: [] };
    render(<WhatToPosition companyId="c1" />);
    expect(screen.getByText('No play to recommend yet')).toBeTruthy();
    expect(screen.queryByTestId('gaps-risks')).toBeNull();
    expect(screen.queryByText(/Expected deal size/)).toBeNull();
  });
});
