// Regression test for the keyboard stage-move a11y path (WCAG 2.1.1): a
// focused card + ArrowLeft/ArrowRight is the keyboard-only alternative to
// drag-and-drop, per this page's own header comment. The mouse drag path
// (handleDrop) already toasts on a rejected move; the keyboard path must
// give the same feedback instead of the card silently snapping back.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { PipelinePage } from './PipelinePage';
import { toast } from '@/components/ui/Toast';
import { useOpportunities } from '@/hooks/useOpportunities';
import { usePipelineStages } from '@/hooks/usePipelineStages';
import { useStageMutation } from '@/hooks/useStageMutation';
import type { Opportunity, PipelineStage } from '@bidstack/shared';

vi.mock('@/hooks/useOpportunities', () => ({
  useOpportunities: vi.fn(),
}));

vi.mock('@/hooks/usePipelineReport', () => ({
  usePipelineReport: vi.fn(() => ({ data: undefined, isLoading: false })),
}));

vi.mock('@/hooks/usePipelineStages', () => ({
  usePipelineStages: vi.fn(),
}));

vi.mock('@/hooks/useStageMutation', () => ({
  useStageMutation: vi.fn(),
}));

vi.mock('@/components/ui/Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const capabilitiesMocks = vi.hoisted(() => ({ useHasPermission: vi.fn(() => true) }));
// Default to full access so the pre-existing keyboard-move assertions below
// (written before opportunities:write gating existed) keep exercising the
// move path; the gating describe block overrides this per-case.
vi.mock('@/hooks/useCapabilities', () => capabilitiesMocks);

const STAGE_1: PipelineStage = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Qualification',
  probability: 20,
  color: '#3b82f6',
  isWon: false,
  isLost: false,
};

const STAGE_2: PipelineStage = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Proposal Sent',
  probability: 45,
  color: '#06b6d4',
  isWon: false,
  isLost: false,
};

const OPPORTUNITY: Opportunity = {
  id: '33333333-3333-4333-8333-333333333333',
  code: 'OP-1234',
  customer: 'Acme Corp',
  name: 'Enterprise CRM rollout',
  stage: STAGE_1.name,
  pipelineStageId: STAGE_1.id,
  pipelineStage: STAGE_1,
  value: 250_000,
  probability: 20,
  dueDate: null,
  owner: null,
  industry: null,
  logo: null,
  country: null,
  territoryId: null,
  territoryName: null,
  updatedAt: '2026-06-01T00:00:00.000Z',
  taskCount: 0,
  commentCount: 0,
  viewCount: 0,
};

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

function renderPage() {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <PipelinePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('PipelinePage keyboard stage move', () => {
  beforeEach(() => {
    capabilitiesMocks.useHasPermission.mockReturnValue(true);
    vi.mocked(useOpportunities).mockReturnValue({
      data: { items: [OPPORTUNITY], nextCursor: null },
      isLoading: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof useOpportunities>);

    vi.mocked(usePipelineStages).mockReturnValue({
      data: { items: [STAGE_1, STAGE_2].map((s, i) => ({ ...s, key: s.id, orderIndex: i, forecastCategory: '', updatedAt: '' })) },
      isLoading: false,
    } as unknown as ReturnType<typeof usePipelineStages>);
  });

  afterEach(() => {
    vi.clearAllMocks();
    cleanup();
  });

  it('toasts an error when a keyboard-driven stage move is rejected, matching the mouse drag path', () => {
    // Simulate a rejected move (409/403/etc.) by invoking the caller-supplied
    // onError synchronously, the same way react-query would.
    const mutate = vi.fn(
      (
        _vars: unknown,
        opts?: { onSuccess?: (data: unknown) => void; onError?: (err: unknown) => void },
      ) => {
        opts?.onError?.(new Error('Stage is locked'));
      },
    );
    vi.mocked(useStageMutation).mockReturnValue({
      mutate,
      isPending: false,
    } as unknown as ReturnType<typeof useStageMutation>);

    renderPage();

    const card = screen.getByTestId('pipeline-card');
    fireEvent.keyDown(card, { key: 'ArrowRight' });

    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({ id: OPPORTUNITY.id, pipelineStageId: STAGE_2.id }),
      expect.objectContaining({ onError: expect.any(Function) }),
    );
    expect(toast.error).toHaveBeenCalledWith(
      'Could not move opportunity',
      expect.objectContaining({ description: 'Stage is locked' }),
    );
  });

  it('toasts success (no error) when a keyboard-driven stage move succeeds', () => {
    const mutate = vi.fn(
      (
        _vars: unknown,
        opts?: { onSuccess?: (data: unknown) => void; onError?: (err: unknown) => void },
      ) => {
        opts?.onSuccess?.({});
      },
    );
    vi.mocked(useStageMutation).mockReturnValue({
      mutate,
      isPending: false,
    } as unknown as ReturnType<typeof useStageMutation>);

    renderPage();

    const card = screen.getByTestId('pipeline-card');
    fireEvent.keyDown(card, { key: 'ArrowRight' });

    expect(toast.success).toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });
});

// Regression: POST /api/opportunities/:id/stage 403s server-side for a role
// (e.g. Presales) that reads but doesn't write opportunities. The board must
// stay fully viewable/navigable but withhold drag-and-drop AND the keyboard
// arrow-key move path — before this fix both silently 403'd on every attempt.
describe('PipelinePage — opportunities:write gating', () => {
  const mutate = vi.fn();

  beforeEach(() => {
    mutate.mockClear();
    vi.mocked(useOpportunities).mockReturnValue({
      data: { items: [OPPORTUNITY], nextCursor: null },
      isLoading: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof useOpportunities>);

    vi.mocked(usePipelineStages).mockReturnValue({
      data: { items: [STAGE_1, STAGE_2].map((s, i) => ({ ...s, key: s.id, orderIndex: i, forecastCategory: '', updatedAt: '' })) },
      isLoading: false,
    } as unknown as ReturnType<typeof usePipelineStages>);

    vi.mocked(useStageMutation).mockReturnValue({
      mutate,
      isPending: false,
    } as unknown as ReturnType<typeof useStageMutation>);
  });

  afterEach(() => {
    cleanup();
    vi.mocked(capabilitiesMocks.useHasPermission).mockReset();
    capabilitiesMocks.useHasPermission.mockReturnValue(true);
  });

  it('keeps the card draggable and moves stage on arrow keys for a user with opportunities:write', () => {
    capabilitiesMocks.useHasPermission.mockReturnValue(true);

    renderPage();

    const card = screen.getByTestId('pipeline-card');
    expect(card.getAttribute('draggable')).toBe('true');

    fireEvent.keyDown(card, { key: 'ArrowRight' });
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({ id: OPPORTUNITY.id, pipelineStageId: STAGE_2.id }),
      expect.anything(),
    );
  });

  it('renders the board fully viewable but withholds drag/keyboard move affordances without opportunities:write', () => {
    capabilitiesMocks.useHasPermission.mockReturnValue(false);

    renderPage();

    // The board and its cards stay visible/navigable ...
    expect(screen.getByText('Enterprise CRM rollout')).toBeTruthy();
    const card = screen.getByTestId('pipeline-card');
    expect(card.getAttribute('href')).toBe(`/opportunities/${OPPORTUNITY.id}`);

    // ... but neither move path is reachable.
    expect(card.getAttribute('draggable')).toBe('false');
    expect(card.getAttribute('aria-roledescription')).toBeNull();

    fireEvent.keyDown(card, { key: 'ArrowRight' });
    expect(mutate).not.toHaveBeenCalled();

    const dropzone = screen.getAllByTestId('pipeline-column-dropzone')[0];
    fireEvent.drop(dropzone, {
      dataTransfer: { getData: () => OPPORTUNITY.id },
    });
    expect(mutate).not.toHaveBeenCalled();
  });
});
