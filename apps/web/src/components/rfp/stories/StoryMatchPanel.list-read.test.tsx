// A paused or in-flight story match has no rows yet. The panel used the same
// "No stories matched" line as a catalog that arrived empty. The list has not
// arrived, so that sentence is not a finding.
import type { ReactNode } from 'react';

import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { StoryMatch } from '@/hooks/rfp/useRfpStoryMatches';
import { useRfpPipelineStore } from '@/stores/rfpPipeline';

const apiMock = vi.hoisted(() => vi.fn());

const COPY = vi.hoisted(
  () =>
    ({
      'stories.heading': 'Matched Success Stories',
      'stories.count': '{{count}} stories matched',
      'stories.listLabel': 'Story matches',
      'stories.emptyTitle': 'No stories matched',
      'stories.emptyMessage': 'Relevant success stories will appear here after story matching.',
      'stories.matchedRequirements': '{{count}} requirements covered',
      'states.error': 'Something went wrong. Please try again.',
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

import { StoryMatchPanel } from './StoryMatchPanel';

const WORKSPACE = '11111111-1111-4111-8111-111111111111';
const STORY_PATH = `/api/v1/bid-workspaces/${WORKSPACE}/story-matches`;
const EMPTY = 'No stories matched';
const EMPTY_DETAIL = 'Relevant success stories will appear here after story matching.';
const ZERO = '0 stories matched';
const WAITING = 'Checking matched stories. The list has not arrived.';
const STORY_TITLE = 'Northwind delivery';

function story(): StoryMatch {
  return {
    id: 'story-northwind',
    title: STORY_TITLE,
    client: 'Northwind',
    industry: 'Health',
    relevanceScore: 80,
    hybridScoreBps: 8000,
    summary: 'Kept the delivery note',
    matchedRequirements: ['req-1'],
    url: null,
  };
}

function renderPanel() {
  useRfpPipelineStore.getState().setBidWorkspaceId(WORKSPACE);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, networkMode: 'online' } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return render(<StoryMatchPanel />, { wrapper: Wrapper });
}

function hang(): Promise<never> {
  return new Promise(() => {});
}

function expectNoSettledMiss() {
  expect(screen.queryByRole('heading', { name: EMPTY })).toBeNull();
  expect(screen.queryByText(EMPTY_DETAIL)).toBeNull();
  expect(screen.queryByText(ZERO)).toBeNull();
  expect(screen.queryByText(STORY_TITLE)).toBeNull();
}

describe('StoryMatchPanel unread catalog', () => {
  afterEach(() => {
    cleanup();
    apiMock.mockReset();
    onlineManager.setOnline(true);
    useRfpPipelineStore.getState().reset();
  });

  it('does not call a paused story match an empty catalog', async () => {
    // WHY: a paused first read has isLoading false and no rows. The panel said
    // No stories matched, while the list has not arrived.
    onlineManager.setOnline(false);
    apiMock.mockImplementation(hang);

    renderPanel();

    expect(await screen.findByText(WAITING)).toBeTruthy();
    expectNoSettledMiss();
  });

  it('does not call an in-flight story match an empty catalog', async () => {
    // WHY: the skeleton alone still sat where a settled empty catalog sits.
    // A slow read is not an empty match list, and it does not count 0.
    onlineManager.setOnline(true);
    apiMock.mockImplementation(hang);

    renderPanel();

    expect(await screen.findByText(WAITING)).toBeTruthy();
    expectNoSettledMiss();
  });

  it('does not call a failed story match an empty catalog', async () => {
    // WHY: a failed read is not evidence that nothing matched. The error stays,
    // and the panel does not say the catalog is empty.
    apiMock.mockImplementation((path: string) => {
      if (path === STORY_PATH) return Promise.reject(new Error('network down'));
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderPanel();

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('network down');
    expect(screen.queryByText(WAITING)).toBeNull();
    expectNoSettledMiss();
  });

  it('still says a settled catalog found none', async () => {
    // WHY: a payload that arrived with no rows is a miss. That line stays, so a
    // real empty catalog is not dressed up as a slow network.
    apiMock.mockImplementation((path: string) => {
      if (path === STORY_PATH) return Promise.resolve({ items: [], total: 0 });
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderPanel();

    expect(await screen.findByRole('heading', { name: EMPTY })).toBeTruthy();
    expect(screen.getByText(EMPTY_DETAIL)).toBeTruthy();
    expect(screen.getByText(ZERO)).toBeTruthy();
    expect(screen.queryByText(WAITING)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('still shows a story that has arrived', async () => {
    // WHY: a loaded title stays on the panel. The unread line must not replace
    // a story the read already returned.
    apiMock.mockImplementation((path: string) => {
      if (path === STORY_PATH) return Promise.resolve({ items: [story()], total: 1 });
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderPanel();

    expect(await screen.findByText(STORY_TITLE)).toBeTruthy();
    expect(screen.getByText('1 stories matched')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: EMPTY })).toBeNull();
    expect(screen.queryByText(WAITING)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(ZERO)).toBeNull();
  });
});
