// A paused or in-flight draft read has no proposal yet. The gate drew the
// review checklist anyway. That read has not arrived.
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

const draftMocks = vi.hoisted(() => ({
  useRfpDraft: vi.fn(),
}));

vi.mock('@/hooks/rfp/useRfpDraft', () => ({
  useRfpDraft: draftMocks.useRfpDraft,
}));

vi.mock('@/lib/auth', () => ({
  useIsAdmin: () => true,
}));

vi.mock('@/stores/rfpPipeline', () => ({
  useRfpPipelineStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      bidWorkspaceId: 'ws-demo',
      stage: 'awaiting_approval',
      applyEvent: () => undefined,
    }),
}));

vi.mock('@/lib/api', () => ({
  api: vi.fn(),
}));

vi.mock('@/lib/sentry', () => ({
  Sentry: { captureException: vi.fn() },
}));

import { ApprovalGate } from './ApprovalGate';

const CHECKING = 'Checking the draft. The proposal has not arrived.';
const FAILED = 'Could not load the draft.';
const TITLE = 'approval.title';
const STEP = 'approval.steps.executiveSummary';

function renderGate(query: {
  data?: { proposalId: string | null; sections: unknown[] } | null;
  isLoading: boolean;
  isError: boolean;
  status?: string;
}) {
  draftMocks.useRfpDraft.mockReturnValue({
    query,
    saveSection: { mutate: vi.fn() },
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ApprovalGate />
    </QueryClientProvider>,
  );
}

describe('ApprovalGate draft read', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not treat a paused draft read as a review gate', () => {
    // WHY: a paused first read has isLoading false and no proposal. The
    // checklist is a settled draft. The proposal has not arrived.
    renderGate({ data: undefined, isLoading: false, isError: false, status: 'pending' });

    expect(screen.queryByRole('heading', { name: TITLE })).toBeNull();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'approval.approve' })).toBeNull();
    expect(screen.getAllByText(CHECKING).length).toBeGreaterThan(0);
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(screen.queryByText(STEP)).toBeNull();
  });

  it('does not treat an in-flight draft read as a review gate', () => {
    // WHY: a slow read also has no proposal. A checklist with no status is
    // not a settled draft, and it is not a failed load.
    renderGate({ data: undefined, isLoading: true, isError: false, status: 'pending' });

    expect(screen.queryByRole('heading', { name: TITLE })).toBeNull();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'approval.approve' })).toBeNull();
    expect(screen.getAllByText(CHECKING).length).toBeGreaterThan(0);
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(screen.queryByText(STEP)).toBeNull();
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('keeps a failed draft read on the error', () => {
    // WHY: a failed read is not evidence that the proposal is missing. The
    // error stays, and a blank checklist does not stand in for the draft.
    renderGate({ data: undefined, isLoading: false, isError: true, status: 'error' });

    expect(screen.queryByRole('heading', { name: TITLE })).toBeNull();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'approval.approve' })).toBeNull();
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
    expect(screen.getAllByText(FAILED).length).toBeGreaterThan(0);
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(STEP)).toBeNull();
  });

  it('lets a failed read win over a stale draft', () => {
    // WHY: error wins before a payload. A refetch failure must not keep
    // showing a checklist from a draft that is no longer the read.
    renderGate({
      data: { proposalId: 'prop-stale', sections: [] },
      isLoading: false,
      isError: true,
      status: 'error',
    });

    expect(screen.queryByRole('heading', { name: TITLE })).toBeNull();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'approval.approve' })).toBeNull();
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
    expect(screen.getAllByText(FAILED).length).toBeGreaterThan(0);
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(STEP)).toBeNull();
  });

  it('stays on the review gate when a settled draft has no proposal', () => {
    // WHY: a draft that arrived without a proposal stays on that gate. A slow
    // network must not be dressed up as a missing proposal, and this one must.
    renderGate({
      data: { proposalId: null, sections: [] },
      isLoading: false,
      isError: false,
      status: 'success',
    });

    expect(screen.getByRole('heading', { name: TITLE })).toBeTruthy();
    expect(screen.getAllByRole('checkbox')).toHaveLength(5);
    expect(screen.getByRole('button', { name: 'approval.approve' })).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('still shows the review gate when the draft has arrived', () => {
    // WHY: a loaded draft stays. The unread line must not replace a checklist
    // the draft already returned.
    renderGate({
      data: { proposalId: 'prop-demo', sections: [] },
      isLoading: false,
      isError: false,
      status: 'success',
    });

    expect(screen.getByRole('heading', { name: TITLE })).toBeTruthy();
    expect(screen.getAllByRole('checkbox')).toHaveLength(5);
    expect(screen.getByText(STEP)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'approval.approve' })).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });
});
