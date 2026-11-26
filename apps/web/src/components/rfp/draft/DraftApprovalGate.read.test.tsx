// A paused or in-flight capability read has no manifest and isLoading false.
// The pre-drafting gate treated that as not an admin. That read has not arrived.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const CHECKING = 'Checking admin access. The permission read has not arrived.';
const FAILED = 'Could not check admin access.';
const DENIED = 'Only admins and owners can approve proposals. Contact your administrator.';
const APPROVE = 'Approve & Start AI Drafting';

const state = vi.hoisted(() => ({
  isAdmin: false,
  caps: {
    data: undefined as unknown,
    isLoading: false,
    isError: false,
    status: 'pending' as string,
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => {
      if (key === 'approval.requiresAdmin') return DENIED;
      return fallback ?? key;
    },
  }),
}));

vi.mock('@/lib/auth', () => ({
  useIsAdmin: () => state.isAdmin,
  useAuth: () => ({ isLoaded: true, isSignedIn: true }),
}));

vi.mock('@/hooks/useCapabilities', () => ({
  useCapabilities: () => state.caps,
}));

vi.mock('@/stores/rfpPipeline', () => ({
  useRfpPipelineStore: (select: (store: Record<string, unknown>) => unknown) =>
    select({
      bidWorkspaceId: 'ws-1',
      orchestrationId: 'orch-1',
      stage: 'awaiting_approval',
      applyEvent: () => undefined,
    }),
}));

vi.mock('@/hooks/rfp/useApproveDrafting', () => ({
  useApproveDrafting: () => ({
    mutate: () => undefined,
    isPending: false,
    isError: false,
    error: null,
  }),
}));

vi.mock('@/lib/sentry', () => ({
  Sentry: { captureException: () => undefined },
}));

import { DraftApprovalGate } from './DraftApprovalGate';

function unread(isLoading: boolean) {
  state.isAdmin = false;
  state.caps = {
    data: undefined,
    isLoading,
    isError: false,
    status: 'pending',
  };
}

function manifest(permissions: string[]) {
  return { permissions, roles: [''] };
}

describe('DraftApprovalGate admin read', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not treat a paused admin read as not an admin', () => {
    // WHY: a paused first read has isLoading false and no manifest. The
    // denial is a settled answer. This read has not arrived.
    unread(false);
    render(<DraftApprovalGate />);

    expect(screen.getByRole('status').textContent).toContain(CHECKING);
    expect(screen.queryByText(DENIED)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(screen.getByRole('button', { name: APPROVE }).hasAttribute('disabled')).toBe(true);
  });

  it('does not treat an in-flight admin read as not an admin', () => {
    // WHY: a slow read also has no manifest. The denial is not a settled
    // answer, and it is not a failed load.
    unread(true);
    render(<DraftApprovalGate />);

    expect(screen.getByRole('status').textContent).toContain(CHECKING);
    expect(screen.queryByText(DENIED)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('keeps a failed admin read on the error', () => {
    // WHY: a failed read is not evidence that the person is not an admin.
    state.isAdmin = false;
    state.caps = {
      data: undefined,
      isLoading: false,
      isError: true,
      status: 'error',
    };
    render(<DraftApprovalGate />);

    expect(screen.getByRole('alert').textContent).toContain(FAILED);
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(DENIED)).toBeNull();
    expect(screen.getByRole('button', { name: APPROVE }).hasAttribute('disabled')).toBe(true);
  });

  it('lets a failed status win over a stale admin grant', () => {
    // WHY: error wins before a payload. A refetch failure must not leave
    // Approve enabled from a manifest that is no longer the read.
    state.isAdmin = true;
    state.caps = {
      data: manifest(['settings:write']),
      isLoading: false,
      isError: false,
      status: 'error',
    };
    render(<DraftApprovalGate />);
    fireEvent.click(screen.getByRole('checkbox'));

    expect(screen.getByRole('alert').textContent).toContain(FAILED);
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(DENIED)).toBeNull();
    expect(screen.getByRole('button', { name: APPROVE }).hasAttribute('disabled')).toBe(true);
  });

  it('stays on the denial when a settled read has a null payload', () => {
    // WHY: a settled null payload is not an unread pause. Undefined data is
    // unread. Null has arrived, and the gate stays on the existing denial.
    state.isAdmin = false;
    state.caps = {
      data: null,
      isLoading: false,
      isError: false,
      status: 'success',
    };
    render(<DraftApprovalGate />);

    expect(screen.getByRole('alert').textContent).toContain(DENIED);
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
  });

  it('stays on the denial when a settled manifest has no grants', () => {
    // WHY: an empty permission list has arrived. Unread must not look like
    // that miss, and a real miss must stay.
    state.isAdmin = false;
    state.caps = {
      data: { permissions: [], roles: [] },
      isLoading: false,
      isError: false,
      status: 'success',
    };
    render(<DraftApprovalGate />);

    expect(screen.getByRole('alert').textContent).toContain(DENIED);
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
  });

  it('still lets a loaded admin approve', () => {
    // WHY: a loaded grant stays. The checking line must not replace an
    // admin the read already returned.
    state.isAdmin = true;
    state.caps = {
      data: manifest(['settings:write']),
      isLoading: false,
      isError: false,
      status: 'success',
    };
    render(<DraftApprovalGate />);
    fireEvent.click(screen.getByRole('checkbox'));

    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText(DENIED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(screen.getByRole('button', { name: APPROVE }).hasAttribute('disabled')).toBe(false);
  });

  it('still lets a loaded admin approve when another grant is blank', () => {
    // WHY: a loaded manifest with a blank extra grant stays an admin. A
    // blank field is not a missing read.
    state.isAdmin = true;
    state.caps = {
      data: manifest(['settings:write', '']),
      isLoading: false,
      isError: false,
      status: 'success',
    };
    render(<DraftApprovalGate />);
    fireEvent.click(screen.getByRole('checkbox'));

    expect(screen.getByRole('button', { name: APPROVE }).hasAttribute('disabled')).toBe(false);
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(DENIED)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
  });
});
