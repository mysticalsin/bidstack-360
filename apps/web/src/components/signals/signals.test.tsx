import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import type { AccountPulse, Initiative, PortfolioMomentum, TimelineItem } from '@bidstack/shared';

import { InitiativesView } from './InitiativesBoard';
import { AlertsList, MomentumList } from './PortfolioMomentum';
import { PulseView } from './PulseHero';
import { TimelineView } from './SignalsTimeline';

const wrap = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);
afterEach(cleanup);

const pulse: AccountPulse = {
  companyId: 'c1',
  companyName: 'CI Financial',
  score: 78,
  delta: 12,
  trend: 'gaining',
  verdict: 'Gaining traction: pipeline growing and meetings more frequent.',
  coverage: 0.8,
  series: Array.from({ length: 13 }, (_, i) => ({ at: new Date(Date.UTC(2026, 7, 1 + i * 7)).toISOString(), score: 60 + i })),
  drivers: [
    { key: 'pipeline', label: 'Pipeline', signal: 0.6, points: 9, direction: 'up', detail: 'Open pipeline up 40% on 90 days ago.' },
    { key: 'meetings', label: 'Meetings', signal: 0.5, points: 7.4, direction: 'up', detail: '6 meetings in 60 days, up from 2.' },
    { key: 'winloss', label: 'Win and loss', signal: 0, points: 0, direction: 'flat', detail: 'No closed deals in 180 days.' },
    { key: 'hiring', label: 'Hiring', signal: 0.2, points: 2, direction: 'up', detail: '14 postings in 30 days.' },
    { key: 'news', label: 'News', signal: -0.4, points: -4, direction: 'down', detail: 'One risk story.' },
  ],
  sample: true,
  sources: [
    { id: 'crm', label: 'Deals and bids', active: true },
    { id: 'news', label: 'News (GDELT, Google News)', active: false, hint: 'Add a website or stock ticker to this account to get news.' },
  ],
  computedAt: '2026-10-31T00:00:00Z',
};

describe('PulseView', () => {
  it('answers in one look: score, trend, verdict, top 3 drivers, sample badge; sources live in Settings', () => {
    wrap(<PulseView pulse={pulse} />);
    expect(screen.getByRole('heading', { name: 'Account pulse' })).toBeTruthy();
    expect(screen.getByText('78')).toBeTruthy();
    expect(screen.getByText(/Gaining \+12/)).toBeTruthy();
    expect(screen.getByText(pulse.verdict)).toBeTruthy();
    const drivers = within(screen.getByRole('group', { name: 'Top drivers' })).getAllByRole('button');
    expect(drivers.map((d) => d.textContent)).toEqual(['Pipeline+9', 'Meetings+7', 'News-4']);
    expect(screen.getByRole('img', { name: /Momentum over 13 weeks: from 60 to 72/ })).toBeTruthy();
    expect(screen.getByText('Sample')).toBeTruthy();
    expect(screen.queryByText(/\(off\)/)).toBeNull();
    expect(screen.queryByText('Watching')).toBeNull();
    expect(document.body.textContent).not.toMatch(/[\u2014\u2013]/);
  });

  it('opens the drill panel for a driver with its contribution and a link', () => {
    const { container } = wrap(<PulseView pulse={pulse} />);
    const drill = container.querySelector('.sg-drill') as HTMLElement;
    expect(drill.hidden).toBe(true);
    const btn = screen.getByRole('button', { name: /Meetings/ });
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(drill.hidden).toBe(false);
    expect(screen.getByRole('heading', { name: 'Meetings: +7 points' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open meetings' }).getAttribute('href')).toBe('/meetings?account=c1');
    fireEvent.click(btn);
    expect(drill.hidden).toBe(true);
  });
});

const item = (over: Partial<TimelineItem>): TimelineItem => ({
  id: 'i', at: '2026-06-01T00:00:00Z', lane: 'theirs', category: 'funding', title: 'Raised', summary: '', source: 'gdelt',
  sourceUrl: 'https://news.example/x', href: null, importance: 50, implication: 'OPPORTUNITY', sample: false, upcoming: false, ...over,
});

describe('TimelineView', () => {
  const items = [
    item({ id: 'm1', lane: 'ours', category: 'meeting', title: 'Workshop with CIO', source: 'meeting_intel', sourceUrl: null, href: '/meetings/m1' }),
    item({ id: 'f1', title: 'Sample: Series C \u2014 150M', importance: 85, sample: true, sourceUrl: '' }),
    item({ id: 'l1', category: 'launch', title: 'New mobile app', at: '2026-08-01T00:00:00Z' }),
  ];
  it('draws two lanes with a mark per event, filter chips and an sr summary', () => {
    wrap(<TimelineView items={items} from="2025-11-01T00:00:00Z" to="2026-10-31T00:00:00Z" />);
    expect(screen.getByText('Our activity')).toBeTruthy();
    expect(screen.getByText('Their news')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /^(Meeting|Funding|Launch),/ })).toHaveLength(3);
    expect(screen.getByText(/1 of our activities and 2 of their events/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Launch 1/ }));
    expect(screen.queryByRole('button', { name: /^Launch,/ })).toBeNull();
  });

  it('shows the detail with the source on click, without the sample prefix or dashes', () => {
    wrap(<TimelineView items={items} from="2025-11-01T00:00:00Z" to="2026-10-31T00:00:00Z" />);
    fireEvent.click(screen.getByRole('button', { name: /^Funding,/ }));
    expect(screen.getByRole('heading', { name: 'Series C, 150M' })).toBeTruthy();
    expect(screen.getByText(/Sample data, no live source/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Launch,/ }));
    expect(screen.getByRole('link', { name: /Open source/ }).getAttribute('href')).toBe('https://news.example/x');
    fireEvent.click(screen.getByRole('button', { name: /^Meeting,/ }));
    expect(screen.getByRole('link', { name: 'Open in Polo' }).getAttribute('href')).toBe('/meetings/m1');
  });
});

const init = (n: number, over: Partial<Initiative> = {}): Initiative => ({
  id: `in${n}`, title: `Initiative ${n}`, theme: 'data_ai', themeLabel: 'Data and AI', rationale: 'Hiring data engineers and announced a data platform.',
  confidence: 'high', confidenceScore: 0.8, firstSeen: null, lastSeen: '2026-10-01T00:00:00Z',
  evidence: [
    { kind: 'hiring', title: 'Senior data engineer', url: 'https://jobs.example/1', at: null, source: 'enrichment', sample: false },
    { kind: 'hiring', title: 'ML engineer', url: null, at: null, source: 'enrichment', sample: false },
    { kind: 'news', title: 'Data platform launch', url: null, at: null, source: 'gdelt', sample: false },
  ],
  hook: { offering: 'Data and AI practice', pitch: '', nextStep: 'Offer a data platform assessment.', alreadySold: false },
  sample: false,
  ...over,
});

describe('InitiativesView', () => {
  it('shows confidence, evidence counts, the hook, evidence on click and caps at four', () => {
    wrap(<InitiativesView items={[init(1), init(2, { confidence: 'low', hook: { offering: 'Cloud', pitch: '', nextStep: '', alreadySold: true } }), init(3), init(4), init(5)]} />);
    expect(screen.getAllByRole('article')).toHaveLength(4);
    expect(screen.getAllByText('High confidence').length).toBe(3);
    expect(screen.getAllByText('2 job postings').length).toBe(4);
    expect(screen.getAllByText(/How we can help: Data and AI practice/).length).toBe(3);
    expect(screen.getByText(/Already working together here/)).toBeTruthy();
    const toggle = screen.getAllByRole('button', { name: 'See 3 evidence items' })[0]!;
    fireEvent.click(toggle);
    expect(screen.getByRole('link', { name: /Senior data engineer/ }).getAttribute('href')).toBe('https://jobs.example/1');
    fireEvent.click(screen.getByRole('button', { name: 'Show all 5 initiatives' }));
    expect(screen.getAllByRole('article')).toHaveLength(5);
  });
});

const port: PortfolioMomentum = {
  accounts: [
    { companyId: 'a', companyName: 'CI Financial', score: 88, delta: 15, trend: 'gaining', verdict: 'Gaining traction', topDriver: 'pipeline', openPipelineMicros: '0', series: [70, 80, 88], sample: true, coverage: 1 },
    { companyId: 'b', companyName: 'Mantu', score: 55, delta: 1, trend: 'steady', verdict: 'Holding steady', topDriver: null, openPipelineMicros: '0', series: [55, 55], sample: false, coverage: 1 },
    { companyId: 'c', companyName: 'Example Corp', score: 40, delta: -12, trend: 'declining', verdict: 'High level, but down over 4 weeks \u2014 news', topDriver: 'news', openPipelineMicros: '0', series: [52, 40], sample: true, coverage: 1 },
  ],
  counts: { gaining: 1, steady: 1, declining: 1 },
  alerts: [
    { id: 'x', companyId: 'c', companyName: 'Example Corp', title: 'Sample: Example Corp announces job cuts', category: 'risk', importance: 85, occurredAt: '2026-10-20T00:00:00Z', source: 'sample', sourceUrl: null, implication: 'RISK', sample: true },
  ],
  computedAt: '2026-10-31T00:00:00Z',
};

describe('Portfolio momentum', () => {
  it('ranks accounts with score and delta, filters by trend and links to the account', () => {
    wrap(<MomentumList data={port} />);
    const list = screen.getByRole('list', { name: 'Accounts ranked by size of momentum change' });
    // Biggest movers first in either direction: the decline is not buried.
    expect(within(list).getAllByRole('link').map((l) => l.textContent)).toEqual(['CI Financial', 'Example Corp', 'Mantu']);
    expect(screen.getByLabelText('+15 in 4 weeks')).toBeTruthy();
    expect(screen.getByText('High level, but down over 4 weeks, news')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Declining 1/ }));
    expect(within(screen.getByRole('list', { name: /ranked/ })).getAllByRole('link').map((l) => l.textContent)).toEqual(['Example Corp']);
    expect(screen.getByRole('link', { name: 'Example Corp' }).getAttribute('href')).toBe('/accounts/c');
  });

  it('lists top alerts with category and Sample, linking to the account watchdog', () => {
    wrap(<AlertsList alerts={port.alerts} />);
    const link = screen.getByRole('link', { name: 'Example Corp announces job cuts' });
    expect(link.getAttribute('href')).toBe('/accounts/c#watchdog');
    expect(screen.getByText('Risk')).toBeTruthy();
    expect(screen.getByText('Sample')).toBeTruthy();
  });
});
