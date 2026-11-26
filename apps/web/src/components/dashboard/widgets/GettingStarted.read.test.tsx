// A paused or in-flight workspace summary has no counts yet. The first-run
// screen said the workspace was ready and that nothing was here. That read
// has not arrived.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    { get: () => (props: Record<string, unknown>) => <div {...props} /> },
  ),
  useReducedMotion: () => true,
}));

vi.mock('@/hooks/useOrgSummary', () => ({ useOrgSummary: vi.fn() }));

vi.mock('@/stores/onboarding', () => ({
  useOnboardingStore: (selector: (state: { openTemplatePicker: () => void }) => unknown) =>
    selector({ openTemplatePicker: () => {} }),
}));

import { GettingStarted } from './GettingStarted';
import { useOrgSummary } from '@/hooks/useOrgSummary';

const UNREAD = 'Checking the workspace. The summary has not arrived.';
const FAILED = 'The workspace summary did not load.';
const READY = 'Your workspace is ready';
const EMPTY = 'There is nothing here yet. Make one of these three moves and the command center fills in as you go.';
const TITLE = "Let's pilot your first bid";
const FIRST_ACCOUNT = 'Add your first account';

const emptySummary = {
  companies: 0,
  contacts: 0,
  leads: 0,
  opportunities: 0,
  openOpportunities: 0,
  pipelineValue: 0,
  tasks: 0,
  overdueTasks: 0,
  serviceCases: 0,
  openServiceCases: 0,
  recentActivity: [],
};

function renderStarted(summary: {
  data?: unknown;
  isLoading?: boolean;
  isFetching?: boolean;
  isError?: boolean;
  status?: string;
}) {
  vi.mocked(useOrgSummary).mockReturnValue({
    data: summary.data,
    isLoading: summary.isLoading ?? false,
    isFetching: summary.isFetching ?? false,
    isError: summary.isError ?? false,
    status: summary.status,
    error: null,
    refetch: vi.fn(),
  } as never);
  render(
    <MemoryRouter>
      <GettingStarted />
    </MemoryRouter>,
  );
}

function expectNotStarting() {
  expect(screen.queryByText(READY)).toBeNull();
  expect(screen.queryByText(EMPTY)).toBeNull();
  expect(screen.queryByRole('heading', { name: TITLE })).toBeNull();
  expect(screen.queryByText(FIRST_ACCOUNT)).toBeNull();
  expect(screen.queryByRole('link', { name: /Add an account/ })).toBeNull();
}

describe('GettingStarted workspace summary read', () => {
  afterEach(() => cleanup());

  it('does not treat a paused summary as an empty workspace', () => {
    // WHY: a paused first read has isLoading false and no counts. Your
    // workspace is ready says the summary arrived. This one has not.
    renderStarted({
      data: undefined,
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'pending',
    });

    expect(screen.getByText(UNREAD)).toBeTruthy();
    expectNotStarting();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does not treat an in-flight summary as an empty workspace', () => {
    // WHY: a slow read also has no counts, and isLoading can stay false.
    // There is nothing here yet must not stand in for a read that is still running.
    renderStarted({
      data: undefined,
      isLoading: false,
      isFetching: true,
      isError: false,
      status: 'pending',
    });

    expect(screen.getByText(UNREAD)).toBeTruthy();
    expectNotStarting();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps a failed summary on the error', () => {
    // WHY: a failed read is not an unread pause and not an empty org. The
    // first-run cards must not open.
    renderStarted({
      data: undefined,
      isLoading: false,
      isFetching: false,
      isError: true,
      status: 'error',
    });

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(UNREAD)).toBeNull();
    expectNotStarting();
  });

  it('lets a failed read win over a stale empty summary', () => {
    // WHY: error wins before a payload. A refetch failure must not keep
    // saying the workspace is ready from counts that are no longer the read.
    renderStarted({
      data: emptySummary,
      isLoading: false,
      isFetching: false,
      isError: true,
      status: 'error',
    });

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(UNREAD)).toBeNull();
    expectNotStarting();
  });

  it('lets a failed status win when isError is still false', () => {
    // WHY: error wins even when the flag has not flipped. A status of error
    // must not keep the first-run cards, and it must not look ready.
    renderStarted({
      data: { ...emptySummary, companies: 1 },
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'error',
    });

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(UNREAD)).toBeNull();
    expectNotStarting();
  });

  it('stays on the empty workspace when a settled payload is null', () => {
    // WHY: null has arrived. Undefined data is unread. A null payload is not
    // a failed load, and it is not still checking.
    renderStarted({
      data: null,
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'success',
    });

    expect(screen.getByText(READY)).toBeTruthy();
    expect(screen.getByText(EMPTY)).toBeTruthy();
    expect(screen.getByRole('heading', { name: TITLE })).toBeTruthy();
    expect(screen.getByText(FIRST_ACCOUNT)).toBeTruthy();
    expect(screen.queryByText(UNREAD)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('stays on the empty workspace when a settled count is zero', () => {
    // WHY: a zero count has arrived. Unread must not replace that settled
    // miss, and the miss must not say the summary did not load.
    renderStarted({
      data: emptySummary,
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'success',
    });

    expect(screen.getByText(READY)).toBeTruthy();
    expect(screen.getByText(EMPTY)).toBeTruthy();
    expect(screen.getByRole('heading', { name: TITLE })).toBeTruthy();
    expect(screen.getByText(FIRST_ACCOUNT)).toBeTruthy();
    expect(screen.getByRole('link', { name: /Add an account/ })).toBeTruthy();
    expect(screen.queryByText(UNREAD)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('still shows the first-run cards when a summary has arrived', () => {
    // WHY: a loaded payload stays. The unread line must not replace the
    // first moves the screen already shows for a summary that arrived.
    renderStarted({
      data: { ...emptySummary, companies: 2, leads: 1 },
      isLoading: false,
      isFetching: true,
      isError: false,
      status: 'success',
    });

    expect(screen.getByText(READY)).toBeTruthy();
    expect(screen.getByText(EMPTY)).toBeTruthy();
    expect(screen.getByText(FIRST_ACCOUNT)).toBeTruthy();
    expect(screen.getByRole('link', { name: /See the full checklist/ })).toBeTruthy();
    expect(screen.queryByText(UNREAD)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
