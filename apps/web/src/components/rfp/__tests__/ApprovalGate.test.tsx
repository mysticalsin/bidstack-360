/**
 * Tests for ApprovalGate.
 *
 * Implementation notes (spec vs reality):
 * - The spec describes an `onApprove` callback prop — the real component has
 *   NO such prop. Approval is handled internally via useMutation → api().
 * - The Approve button is rendered at all times but is disabled unless:
 *     stage === 'awaiting_approval' AND all 5 review checkboxes are checked
 *     AND isAdmin=true AND proposalId is non-null.
 * - Mocking strategy: vi.mock the store selector, useIsAdmin, and useRfpDraft.
 *   react-query is wrapped in a QueryClientProvider.
 *
 * We mock react-i18next to return the translation key as the label
 * (standard pattern for component unit tests in this codebase).
 *
 * WHY file-level any disable: Zustand selector mocks, vi.fn() overrides, and
 * mockReturnValue fixtures in this file all legitimately use `any` because the
 * runtime mock shape must satisfy the selector's generic parameter at test time
 * without duplicating the full store type in test code.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { ApprovalGate } from '../approval/ApprovalGate';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@/lib/auth', () => ({
  useIsAdmin: vi.fn(() => false),
}));

// The store is mocked at module level; individual tests override via
// vi.mocked(useRfpPipelineStore) if they need different state.
vi.mock('@/stores/rfpPipeline', () => ({
  useRfpPipelineStore: vi.fn((selector: (s: any) => any) =>
    selector({
      orchestrationId: null,
      bidWorkspaceId: null,
      stage: 'idle',
      events: [],
      progress: 0,
      error: null,
      lastEventAt: null,
      setOrchestrationId: vi.fn(),
      setBidWorkspaceId: vi.fn(),
      applyEvent: vi.fn(),
      reset: vi.fn(),
    }),
  ),
}));

vi.mock('@/hooks/rfp/useRfpDraft', () => ({
  useRfpDraft: vi.fn(() => ({
    query: { data: null },
    saveSection: { mutateAsync: vi.fn() },
  })),
}));

vi.mock('@/lib/api', () => ({
  api: vi.fn(),
}));

// Card is a thin wrapper — render it transparently
vi.mock('@/components/ui/Card', () => ({
  Card: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div data-testid="card" className={className}>
      {children}
    </div>
  ),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import { useIsAdmin } from '@/lib/auth';
import { useRfpPipelineStore } from '@/stores/rfpPipeline';
import { useRfpDraft } from '@/hooks/rfp/useRfpDraft';

function makePipelineState(
  overrides: {
    stage?: string;
    bidWorkspaceId?: string | null;
    applyEvent?: ReturnType<typeof vi.fn>;
  } = {},
): any {
  return {
    orchestrationId: null,
    bidWorkspaceId: overrides.bidWorkspaceId ?? 'ws-001',
    stage: overrides.stage ?? 'awaiting_approval',
    events: [],
    progress: 0,
    error: null,
    lastEventAt: null,
    setOrchestrationId: vi.fn(),
    setBidWorkspaceId: vi.fn(),
    applyEvent: overrides.applyEvent ?? vi.fn(),
    reset: vi.fn(),
  };
}

function renderGate() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <ApprovalGate />
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Before/after
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  // Default: non-admin, idle stage, no proposalId
  vi.mocked(useIsAdmin).mockReturnValue(false);
  vi.mocked(useRfpPipelineStore).mockImplementation((selector) =>
    selector(makePipelineState({ stage: 'idle', bidWorkspaceId: null })),
  );
  vi.mocked(useRfpDraft).mockReturnValue({ query: { data: null } } as any);
});

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Stage gate
// ---------------------------------------------------------------------------

describe('ApprovalGate — stage gate', () => {
  it('shows a status notice when stage is NOT awaiting_approval', () => {
    vi.mocked(useRfpPipelineStore).mockImplementation((selector) =>
      selector(makePipelineState({ stage: 'qa_review' })),
    );

    renderGate();
    // The stage gate notice renders with role="status"
    expect(screen.getByRole('status')).toBeDefined();
  });

  it('does NOT show the stage gate status when stage is awaiting_approval', () => {
    vi.mocked(useRfpPipelineStore).mockImplementation((selector) =>
      selector(makePipelineState({ stage: 'awaiting_approval' })),
    );

    renderGate();
    expect(screen.queryByRole('status')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Role gate
// ---------------------------------------------------------------------------

describe('ApprovalGate — admin role gate', () => {
  it('shows a role-gate alert when the user is not an admin', () => {
    vi.mocked(useIsAdmin).mockReturnValue(false);
    renderGate();
    // Non-admin sees an alert
    expect(screen.getByRole('alert')).toBeDefined();
  });

  it('does NOT show the role-gate alert when the user is an admin', () => {
    vi.mocked(useIsAdmin).mockReturnValue(true);
    vi.mocked(useRfpPipelineStore).mockImplementation((selector) =>
      selector(makePipelineState({ stage: 'awaiting_approval' })),
    );

    renderGate();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Approve button — always rendered, enabled only when all conditions met
// ---------------------------------------------------------------------------

describe('ApprovalGate — Approve button', () => {
  it('renders the Approve button in all stages', () => {
    renderGate();
    // The button always exists; its label changes by stage (i18n key returned as-is by mock)
    expect(
      screen.getByRole('button', { name: /approval\.(approve|approved|approving)/i }),
    ).toBeDefined();
  });

  it('button is disabled when stage is not awaiting_approval', () => {
    vi.mocked(useRfpPipelineStore).mockImplementation((selector) =>
      selector(makePipelineState({ stage: 'qa_review' })),
    );

    renderGate();
    const btn = screen.getByRole('button', {
      name: /approval\.(approve|approved|approving)/i,
    }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('button is disabled for non-admin even when stage is awaiting_approval', () => {
    vi.mocked(useIsAdmin).mockReturnValue(false);
    vi.mocked(useRfpPipelineStore).mockImplementation((selector) =>
      selector(makePipelineState({ stage: 'awaiting_approval' })),
    );
    vi.mocked(useRfpDraft).mockReturnValue({
      query: { data: { proposalId: 'prop-1', sections: [] } },
    } as any);

    renderGate();
    const btn = screen.getByRole('button', {
      name: /approval\.(approve|approved|approving)/i,
    }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('button is disabled when not all review checkboxes are checked', () => {
    vi.mocked(useIsAdmin).mockReturnValue(true);
    vi.mocked(useRfpPipelineStore).mockImplementation((selector) =>
      selector(makePipelineState({ stage: 'awaiting_approval' })),
    );
    vi.mocked(useRfpDraft).mockReturnValue({
      query: { data: { proposalId: 'prop-1', sections: [] } },
    } as any);

    renderGate();
    // No checkboxes checked yet → button disabled
    const btn = screen.getByRole('button', {
      name: /approval\.(approve|approved|approving)/i,
    }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Review checklist
// ---------------------------------------------------------------------------

describe('ApprovalGate — review checklist', () => {
  it('renders all 5 review step checkboxes', () => {
    renderGate();
    const checkboxes = screen.getAllByRole('checkbox');
    // WHY: 5 review steps defined in REVIEW_STEPS constant
    expect(checkboxes).toHaveLength(5);
  });

  it('first checkbox is enabled by default; subsequent are disabled until previous is checked', () => {
    renderGate();
    const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(checkboxes[0]?.disabled).toBe(false);
    expect(checkboxes[1]?.disabled).toBe(true);
    expect(checkboxes[2]?.disabled).toBe(true);
  });

  it('checking the first checkbox enables the second', () => {
    renderGate();
    const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];

    fireEvent.click(checkboxes[0]!);

    const updated = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(updated[1]?.disabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Already-approved state
// ---------------------------------------------------------------------------

describe('ApprovalGate — already approved', () => {
  it('shows the "approved" label on the button when stage is approved', () => {
    vi.mocked(useRfpPipelineStore).mockImplementation((selector) =>
      selector(makePipelineState({ stage: 'approved' })),
    );

    renderGate();
    // The button label comes from t('approval.approved') which the mock returns as-is
    expect(screen.getByRole('button', { name: /approval\.approved/i })).toBeDefined();
  });
});
