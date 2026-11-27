// A paused, idle, or in-flight competitor-findings read has no rows yet.
// The panel used the same "No competitor findings yet" line as a research
// pass that arrived empty. The list has not arrived, so that sentence is
// not a finding. Demo synthetic data can still be on the server.
import type { ReactNode } from 'react';

import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CompetitorInsight } from '@/hooks/rfp/useCompetitorIntel';

const apiMock = vi.hoisted(() => vi.fn());

const COPY = vi.hoisted(
  () =>
    ({
      'competitor.heading': 'Competitor intelligence',
      'competitor.subtitle':
        'Grounded in public sources. Every finding links to where it came from.',
      'competitor.selectLabel': 'Competitor to research',
      'competitor.selectPlaceholder': 'Choose a competitor',
      'competitor.research': 'Research',
      'competitor.researching': 'Researching',
      'competitor.addPlaceholder': 'Add a competitor by name',
      'competitor.add': 'Add',
      'competitor.listLabel': 'Cited competitor findings',
      'competitor.sourceNewTab': '(opens in a new tab)',
      'competitor.emptyTitle': 'No competitor findings yet',
      'competitor.emptyMessage':
        'Pick a competitor and run research. We only surface claims we can link to a public source.',
      'competitor.error': "Couldn't load competitor findings.",
    }) as Record<string, string>,
);

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (
      key: string,
      fallback?: string | Record<string, unknown>,
      values?: Record<string, unknown>,
    ) => {
      const vars = typeof fallback === 'object' && fallback ? fallback : values;
      const template = typeof fallback === 'string' ? fallback : (COPY[key] ?? key);
      if (!vars) return template;
      return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(vars[name] ?? ''));
    },
  }),
}));

vi.mock('@/lib/api', () => ({
  api: apiMock,
}));

import { CompetitorIntelPanel } from './CompetitorIntelPanel';

const OPPORTUNITY = '11111111-1111-4111-8111-111111111111';
const INSIGHTS = `/api/v1/opportunities/${OPPORTUNITY}/competitor-insights`;
const COMPETITORS = '/api/v1/competitors';
const EMPTY = 'No competitor findings yet';
const EMPTY_DETAIL =
  'Pick a competitor and run research. We only surface claims we can link to a public source.';
const WAITING = 'Checking competitor findings. They have not arrived.';
const FINDING = 'Northwind public award price';

function finding(): CompetitorInsight {
  return {
    id: 'insight-northwind',
    competitorProfileId: '22222222-2222-4222-8222-222222222222',
    opportunityId: OPPORTUNITY,
    category: 'pricing',
    status: 'active',
    title: FINDING,
    summary: 'A synthetic public award lists a unit price.',
    sourceUrl: 'https://example.com/northwind-award',
    sourceTitle: 'Example award notice',
    provider: 'demo',
    confidenceBps: 8000,
    publishedAt: null,
    retrievedAt: '2026-01-01T00:00:00.000Z',
  };
}

function renderPanel(opportunityId: string | null = OPPORTUNITY) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, networkMode: 'online' } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return render(<CompetitorIntelPanel opportunityId={opportunityId} />, { wrapper: Wrapper });
}

function hang(): Promise<never> {
  return new Promise(() => undefined);
}

function expectNoSettledMiss() {
  expect(screen.queryByRole('heading', { name: EMPTY })).toBeNull();
  expect(screen.queryByText(EMPTY_DETAIL)).toBeNull();
  expect(screen.queryByText(FINDING)).toBeNull();
}

describe('CompetitorIntelPanel findings read', () => {
  afterEach(() => {
    cleanup();
    apiMock.mockReset();
    onlineManager.setOnline(true);
  });

  it('does not call a paused findings read an empty research pass', async () => {
    // WHY: a paused first read has isLoading false and no rows. Demo review
    // then said No competitor findings yet, while the cited list has not arrived.
    onlineManager.setOnline(false);
    apiMock.mockImplementation(hang);

    renderPanel();

    expect(await screen.findByText(WAITING)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Competitor intelligence' })).toBeTruthy();
    expectNoSettledMiss();
  });

  it('does not call an in-flight findings read an empty research pass', async () => {
    // WHY: the skeleton alone still sat where a settled empty pass sits.
    // A slow read is not proof the demo bid has no cited findings.
    onlineManager.setOnline(true);
    apiMock.mockImplementation(hang);

    renderPanel();

    expect(await screen.findByText(WAITING)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Competitor intelligence' })).toBeTruthy();
    expectNoSettledMiss();
  });

  it('does not call a read that has not started an empty research pass', async () => {
    // WHY: with no opportunity id the query stays idle. isLoading is false
    // and there is no payload, so the panel said No competitor findings yet
    // before it asked.
    onlineManager.setOnline(true);
    apiMock.mockImplementation(hang);

    renderPanel(null);

    expect(await screen.findByText(WAITING)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Competitor intelligence' })).toBeTruthy();
    expectNoSettledMiss();
    expect(apiMock).not.toHaveBeenCalled();
  });

  it('does not call a failed findings read an empty research pass', async () => {
    // WHY: a failed read is not evidence that research found nothing. The
    // error stays, and the panel does not say the cited list is empty.
    apiMock.mockImplementation((path: string) => {
      if (path === INSIGHTS) return Promise.reject(new Error('network down'));
      if (path === COMPETITORS) return Promise.resolve({ items: [] });
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderPanel();

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('network down');
    expect(screen.queryByText(WAITING)).toBeNull();
    expectNoSettledMiss();
  });

  it('still says a settled research pass found none', async () => {
    // WHY: a payload that arrived with no rows is a miss. That line stays, so
    // a real empty pass is not dressed up as a slow network.
    apiMock.mockImplementation((path: string) => {
      if (path === INSIGHTS) return Promise.resolve({ items: [] });
      if (path === COMPETITORS) return Promise.resolve({ items: [] });
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderPanel();

    expect(await screen.findByRole('heading', { name: EMPTY })).toBeTruthy();
    expect(screen.getByText(EMPTY_DETAIL)).toBeTruthy();
    expect(screen.queryByText(WAITING)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('still shows a finding that has arrived', async () => {
    // WHY: a loaded cited finding stays on the panel. The unread line must
    // not replace a row the read already returned.
    apiMock.mockImplementation((path: string) => {
      if (path === INSIGHTS) return Promise.resolve({ items: [finding()] });
      if (path === COMPETITORS) return Promise.resolve({ items: [] });
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderPanel();

    expect(await screen.findByText(FINDING)).toBeTruthy();
    expect(screen.getByText('Example award notice')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: EMPTY })).toBeNull();
    expect(screen.queryByText(WAITING)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
