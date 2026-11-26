// A paused, idle, or in-flight competitor catalog has no names yet.
// The picker used the same dash as a catalog that arrived empty. The list
// has not arrived, so that dash is not a finding. Demo profiles can still
// be on the server.
import type { ReactNode } from 'react';

import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CompetitorProfile } from '@/hooks/rfp/useCompetitorIntel';

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
      'competitor.profilesUnread': 'Checking competitors. The list has not arrived.',
      'competitor.profilesFailed': 'Could not load competitors.',
      'competitor.profilesEmpty': 'No competitors yet',
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
const WAITING = 'Checking competitors. The list has not arrived.';
const FAILED = 'Could not load competitors.';
const EMPTY = 'No competitors yet';
const NONE = '\u2014';
const PROFILE_NAME = 'Northwind Synthetic';

function profile(): CompetitorProfile {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    name: PROFILE_NAME,
    domain: null,
    aliases: [],
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

function renderPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, networkMode: 'online' } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return render(<CompetitorIntelPanel opportunityId={OPPORTUNITY} />, { wrapper: Wrapper });
}

function hang(): Promise<never> {
  return new Promise(() => undefined);
}

function picker(): HTMLSelectElement {
  return screen.getByRole('combobox', { name: /Competitor to research/ }) as HTMLSelectElement;
}

function settleInsights(path: string): Promise<{ items: [] }> | undefined {
  if (path === INSIGHTS) return Promise.resolve({ items: [] });
  return undefined;
}

describe('CompetitorIntelPanel profile catalog', () => {
  afterEach(() => {
    cleanup();
    apiMock.mockReset();
    onlineManager.setOnline(true);
  });

  it('does not call a paused catalog an empty competitor list', async () => {
    // WHY: a paused first read has isLoading false and no rows. The picker
    // then showed a dash, while the catalog has not arrived.
    onlineManager.setOnline(false);
    apiMock.mockImplementation(hang);

    renderPanel();

    expect(await screen.findByRole('status')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain(WAITING);
    expect(picker().options[0]?.text).toBe(WAITING);
    expect(picker().options[0]?.text).not.toBe(NONE);
    expect(screen.queryByRole('option', { name: EMPTY })).toBeNull();
    expect(screen.queryByRole('option', { name: PROFILE_NAME })).toBeNull();
    expect(screen.getByLabelText('Add a competitor by name')).toBeTruthy();
  });

  it('does not call an in-flight catalog an empty competitor list', async () => {
    // WHY: a slow read is not proof the org has no tracked competitors.
    // The dash sat in the picker for the whole fetch.
    onlineManager.setOnline(true);
    apiMock.mockImplementation((path: string) => settleInsights(path) ?? hang());

    renderPanel();

    expect(await screen.findByRole('status')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain(WAITING);
    expect(picker().options[0]?.text).toBe(WAITING);
    expect(picker().options[0]?.text).not.toBe(NONE);
    expect(screen.queryByRole('option', { name: EMPTY })).toBeNull();
  });

  it('does not call a failed catalog an empty competitor list', async () => {
    // WHY: a failed read is not evidence that the org tracks nobody. The
    // error stays, and the picker does not say the catalog is empty.
    apiMock.mockImplementation((path: string) => {
      if (path === COMPETITORS) return Promise.reject(new Error('network down'));
      const insights = settleInsights(path);
      if (insights) return insights;
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderPanel();

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('network down');
    expect(picker().options[0]?.text).toBe(FAILED);
    expect(picker().options[0]?.text).not.toBe(NONE);
    expect(screen.queryByText(WAITING)).toBeNull();
    expect(screen.queryByRole('option', { name: EMPTY })).toBeNull();
  });

  it('still says a settled catalog found none', async () => {
    // WHY: a payload that arrived with no rows is a miss. That line stays, so
    // a real empty catalog is not dressed up as a slow network.
    apiMock.mockImplementation((path: string) => {
      if (path === COMPETITORS) return Promise.resolve({ items: [] });
      const insights = settleInsights(path);
      if (insights) return insights;
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderPanel();

    expect(await screen.findByRole('option', { name: EMPTY })).toBeTruthy();
    expect(picker().options[0]?.text).toBe(EMPTY);
    expect(picker().options[0]?.text).not.toBe(NONE);
    expect(screen.queryByText(WAITING)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('still shows a competitor that has arrived', async () => {
    // WHY: a loaded profile stays in the picker. The unread line must not
    // replace a name the read already returned.
    apiMock.mockImplementation((path: string) => {
      if (path === COMPETITORS) return Promise.resolve({ items: [profile()] });
      const insights = settleInsights(path);
      if (insights) return insights;
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderPanel();

    expect(await screen.findByRole('option', { name: PROFILE_NAME })).toBeTruthy();
    expect(picker().options[0]?.text).toBe('Choose a competitor');
    expect(screen.queryByText(WAITING)).toBeNull();
    expect(screen.queryByRole('option', { name: EMPTY })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
