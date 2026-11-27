// A paused, idle, or in-flight requirements read has no rows yet. The list
// used the same "No requirements yet" line as an extract that arrived empty.
// The list has not arrived, so that sentence is not a finding.
import type { ReactNode } from 'react';

import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Requirement } from '@/hooks/rfp/useRfpRequirements';
import { useRfpPipelineStore } from '@/stores/rfpPipeline';

const apiMock = vi.hoisted(() => vi.fn());

const COPY = vi.hoisted(
  () =>
    ({
      'requirements.heading': 'Extracted Requirements',
      'requirements.listLabel': 'Requirements list',
      'requirements.emptyTitle': 'No requirements yet',
      'requirements.emptyMessage': 'Requirements will appear here once extraction is complete.',
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

import { RequirementsList } from './RequirementsList';

const WORKSPACE = '11111111-1111-4111-8111-111111111111';
const REQ_PATH = `/api/v1/bid-workspaces/${WORKSPACE}/requirements`;
const EMPTY = 'No requirements yet';
const EMPTY_DETAIL = 'Requirements will appear here once extraction is complete.';
const ZERO = '0 requirement(s) extracted';
const WAITING = 'Checking requirements. The list has not arrived.';
const REQ_TEXT = 'Keep the delivery note';

function requirement(): Requirement {
  return {
    id: 'req-northwind',
    text: REQ_TEXT,
    category: 'Delivery',
    priority: 'high',
    aiConfidenceBps: 8000,
    pageRef: 2,
  };
}

function renderList(workspaceId: string | null = WORKSPACE) {
  if (workspaceId) useRfpPipelineStore.getState().setBidWorkspaceId(workspaceId);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, networkMode: 'online' } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return render(<RequirementsList />, { wrapper: Wrapper });
}

function hang(): Promise<never> {
  return new Promise(() => undefined);
}

function expectNoSettledMiss() {
  expect(screen.queryByRole('heading', { name: EMPTY })).toBeNull();
  expect(screen.queryByText(EMPTY_DETAIL)).toBeNull();
  expect(screen.queryByText(ZERO)).toBeNull();
  expect(screen.queryByText(REQ_TEXT)).toBeNull();
}

describe('RequirementsList unread extract', () => {
  afterEach(() => {
    cleanup();
    apiMock.mockReset();
    onlineManager.setOnline(true);
    useRfpPipelineStore.getState().reset();
  });

  it('does not call a paused requirements read an empty extract', async () => {
    // WHY: a paused first read has isLoading false and no rows. Demo review
    // then said No requirements yet, while the extract has not arrived.
    onlineManager.setOnline(false);
    apiMock.mockImplementation(hang);

    renderList();

    expect(await screen.findByText(WAITING)).toBeTruthy();
    expectNoSettledMiss();
  });

  it('does not call an in-flight requirements read an empty extract', async () => {
    // WHY: the skeleton alone still sat where a settled empty extract sits.
    // A slow read is not an empty requirements list, and it does not count 0.
    onlineManager.setOnline(true);
    apiMock.mockImplementation(hang);

    renderList();

    expect(await screen.findByText(WAITING)).toBeTruthy();
    expectNoSettledMiss();
  });

  it('does not call a read that has not started an empty extract', async () => {
    // WHY: with no workspace id the query stays idle. isLoading is false and
    // there is no payload, so the list said No requirements yet before it asked.
    onlineManager.setOnline(true);
    apiMock.mockImplementation(hang);

    renderList(null);

    expect(await screen.findByText(WAITING)).toBeTruthy();
    expectNoSettledMiss();
    expect(apiMock).not.toHaveBeenCalled();
  });

  it('does not call a failed requirements read an empty extract', async () => {
    // WHY: a failed read is not evidence that nothing was extracted. The error
    // stays, and the list does not say the extract is empty.
    apiMock.mockImplementation((path: string) => {
      if (path === REQ_PATH) return Promise.reject(new Error('network down'));
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderList();

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('network down');
    expect(screen.queryByText(WAITING)).toBeNull();
    expectNoSettledMiss();
  });

  it('still says a settled extract found none', async () => {
    // WHY: a payload that arrived with no rows is a miss. That line stays, so a
    // real empty extract is not dressed up as a slow network.
    apiMock.mockImplementation((path: string) => {
      if (path === REQ_PATH) return Promise.resolve({ items: [], total: 0 });
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderList();

    expect(await screen.findByRole('heading', { name: EMPTY })).toBeTruthy();
    expect(screen.getByText(EMPTY_DETAIL)).toBeTruthy();
    expect(screen.getByText(ZERO)).toBeTruthy();
    expect(screen.queryByText(WAITING)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('still shows a requirement that has arrived', async () => {
    // WHY: a loaded requirement stays on the list. The unread line must not
    // replace a row the read already returned.
    apiMock.mockImplementation((path: string) => {
      if (path === REQ_PATH) return Promise.resolve({ items: [requirement()], total: 1 });
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderList();

    expect(await screen.findByText(REQ_TEXT)).toBeTruthy();
    expect(screen.getByText('1 requirement(s) extracted')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: EMPTY })).toBeNull();
    expect(screen.queryByText(WAITING)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(ZERO)).toBeNull();
  });
});
