// A paused or in-flight cross-sell read has no rows yet. The org log still
// painted zero counts and, once isLoading was false, "No cross-sell actions".
// That empty is not a finding. The list has not arrived.
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CrossSellAction, CrossSellActionPage } from '@bidstack/shared';

const hookMocks = vi.hoisted(() => ({
  actions: {
    data: undefined as CrossSellActionPage | undefined,
    isLoading: false,
    isError: false,
    error: null as Error | null,
    status: 'pending' as string,
    fetchStatus: 'idle' as 'idle' | 'fetching' | 'paused',
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, values?: Record<string, unknown>) => {
      const text = typeof fallback === 'string' ? fallback : key;
      if (!values) return text;
      return text.replace(/\{\{(\w+)\}\}/g, (_match, token: string) => String(values[token] ?? ''));
    },
  }),
}));

vi.mock('@/hooks/useCapabilities', () => ({
  useHasPermission: () => false,
}));

vi.mock('@/hooks/useCrossSell', () => ({
  useCrossSellActions: () => hookMocks.actions,
  usePatchCrossSellAction: () => ({
    mutate: vi.fn(),
    isPending: false,
    variables: undefined,
  }),
}));

import CrossSellPage from './CrossSellPage';

const CHECKING = 'Checking cross-sell actions. The list has not arrived.';
const EMPTY = 'No cross-sell actions';
const FAILED = 'Could not load cross-sell actions';
const NO_DATED = 'No dated action';

const action: CrossSellAction = {
  id: '11111111-1111-4111-8111-111111111111',
  accountKey: 'harbor-sample',
  description: 'Introduce the sample offer to the demo desk',
  requestingUnit: 'Sample East',
  assignedUnit: 'Sample West',
  assigneeId: null,
  assigneeName: null,
  dueDate: '2099-01-01T00:00:00.000Z',
  status: 'open',
  notes: null,
  createdAt: '2026-06-01T10:00:00.000Z',
  updatedAt: '2026-06-01T10:00:00.000Z',
};

function settle(
  data: CrossSellActionPage | undefined,
  extra: Partial<typeof hookMocks.actions> = {},
) {
  hookMocks.actions = {
    data,
    isLoading: false,
    isError: false,
    error: null,
    status: data === undefined ? 'pending' : 'success',
    fetchStatus: 'idle',
    ...extra,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <CrossSellPage />
    </MemoryRouter>,
  );
}

function expectNoSettledBook() {
  expect(screen.queryByText(EMPTY)).toBeNull();
  expect(screen.queryByText(NO_DATED)).toBeNull();
  expect(screen.queryByText('No dated active action')).toBeNull();
  expect(screen.queryByTestId('cross-sell-active-count')).toBeNull();
  expect(screen.queryByTestId('cross-sell-overdue-count')).toBeNull();
  expect(screen.queryByTestId('cross-sell-unassigned-count')).toBeNull();
  expect(screen.queryByText(action.description)).toBeNull();
}

describe('CrossSellPage unread log', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not call a paused cross-sell read an empty log', async () => {
    // WHY: a paused first read has isLoading false and no payload. The page
    // said there were no actions and counted 0, while the log has not arrived.
    settle(undefined, { status: 'pending', fetchStatus: 'paused' });
    renderPage();

    expect(await screen.findByText(CHECKING)).toBeTruthy();
    expectNoSettledBook();
    expect(screen.queryByText(FAILED)).toBeNull();
  });

  it('does not call an in-flight cross-sell read an empty log', async () => {
    // WHY: a slow read showed zero counts and only the loading skeleton. A
    // log that has not arrived is not a book the API returned empty.
    settle(undefined, { isLoading: true, status: 'pending', fetchStatus: 'fetching' });
    renderPage();

    expect(await screen.findByText(CHECKING)).toBeTruthy();
    expectNoSettledBook();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('does not call a failed cross-sell read an empty log', async () => {
    // WHY: a failed read is not evidence that the org has no cross-sell work.
    // The error stays, and the page does not count 0.
    settle(undefined, {
      isError: true,
      status: 'error',
      fetchStatus: 'idle',
      error: new Error('offline'),
    });
    renderPage();

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expectNoSettledBook();
  });

  it('still shows a settled log that returned no actions', async () => {
    // WHY: a page that arrived with no rows is empty. That sentence and the
    // zero counts stay, so a real empty log is not dressed up as a slow network.
    settle({ items: [] });
    renderPage();

    expect(await screen.findByText(EMPTY)).toBeTruthy();
    expect(screen.getByTestId('cross-sell-active-count').textContent).toBe('0');
    expect(screen.getByText(NO_DATED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(action.description)).toBeNull();
  });

  it('still shows an action that arrived', async () => {
    // WHY: a loaded action stays on the page. The unread line must not
    // replace work the read already returned, and the count is not zero.
    settle({ items: [action] });
    renderPage();

    expect((await screen.findAllByText(action.description)).length).toBeGreaterThan(0);
    expect(screen.getByTestId('cross-sell-active-count').textContent).toBe('1');
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByText(NO_DATED)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
