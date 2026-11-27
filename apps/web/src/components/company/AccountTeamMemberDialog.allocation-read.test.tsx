// A missing allocation total is not a free desk. The edit dialog used
// `totalPct ?? 0`, so a paused read and a payload with no total both read as
// 0% across accounts. That is the same sentence as a person who is actually free.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const hookMocks = vi.hoisted(() => ({
  useUserAllocation: vi.fn(),
}));

vi.mock('@/hooks/useAccountTeam', () => ({
  useUserAllocation: hookMocks.useUserAllocation,
  useAddTeamMember: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateTeamMember: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('@/hooks/useUsers', () => ({
  useUsers: () => ({ data: [], isLoading: false, isError: false, status: 'success' }),
}));

import { AccountTeamMemberDialog } from './AccountTeamMemberDialog';

const COMPANY = '00000000-0000-4000-8000-000000000003';
const USER = '00000000-0000-4000-8000-0000000000b1';
const CHECKING = 'Checking allocation. The total has not arrived.';
const FAILED = 'Could not load allocation. The total has not arrived.';
const ZERO = '0% across all accounts with this change';
const KNOWN = '90% across all accounts with this change';

const member = {
  id: '00000000-0000-4000-8000-0000000000a1',
  companyId: COMPANY,
  userId: USER,
  userName: 'Ada North',
  userEmail: 'ada.north@example.com',
  role: 'delivery_lead' as const,
  allocationPct: 30,
  startDate: '2026-11-01',
  endDate: null,
  totalAllocationPct: 90,
  createdAt: '2026-11-01T00:00:00.000Z',
};

function renderEdit(
  query: {
    data?: unknown;
    isLoading?: boolean;
    isError?: boolean;
    status?: string;
  },
  who: typeof member = member,
) {
  hookMocks.useUserAllocation.mockReturnValue({
    isLoading: false,
    isError: false,
    status: 'pending',
    ...query,
  });
  render(
    <AccountTeamMemberDialog
      companyId={COMPANY}
      open
      onOpenChange={() => undefined}
      member={who}
    />,
  );
}

function expectNoSettledTotal() {
  expect(screen.queryByText(ZERO)).toBeNull();
  expect(screen.queryByText(KNOWN)).toBeNull();
  expect(screen.queryByText(/would be at/)).toBeNull();
}

describe('Account team allocation read', () => {
  afterEach(() => {
    cleanup();
    hookMocks.useUserAllocation.mockReset();
  });

  it('does not call a paused allocation read a free desk', () => {
    // WHY: a paused first read has isLoading false and no total. 0% across
    // accounts is what a settled free person says. This total has not arrived.
    renderEdit({
      data: undefined,
      isLoading: false,
      isError: false,
      status: 'pending',
    });

    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expectNoSettledTotal();
  });

  it('does not call an in-flight allocation read a free desk', () => {
    // WHY: a slow read also has no total. The dialog must not fill the gap with 0%.
    renderEdit({
      data: undefined,
      isLoading: true,
      isError: false,
      status: 'pending',
    });

    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByText(FAILED)).toBeNull();
    expectNoSettledTotal();
  });

  it('does not call a read that has not started a free desk', () => {
    // WHY: an idle read has no payload. The person is not free until the total arrives.
    renderEdit({
      data: undefined,
      isLoading: false,
      isError: false,
      status: 'pending',
    });

    expect(screen.getByText(CHECKING)).toBeTruthy();
    expectNoSettledTotal();
    expect(screen.queryByText(FAILED)).toBeNull();
  });

  it('does not call a failed allocation read a free desk', () => {
    // WHY: a failed read is unknown, not 0% booked. Save must not look safe
    // because the over-allocation line stayed quiet.
    renderEdit({
      data: undefined,
      isLoading: false,
      isError: true,
      status: 'error',
    });

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expectNoSettledTotal();
  });

  it('does not call a failed status a free desk when isError is still false', () => {
    // WHY: status can be error before the flag flips. That is still not 0%.
    renderEdit({
      data: undefined,
      isLoading: false,
      isError: false,
      status: 'error',
    });

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expectNoSettledTotal();
  });

  it('does not call a payload with no total a free desk', () => {
    // WHY: a body that arrived without totalPct is not a settled zero. The
    // dialog used ?? 0 and printed 0% across accounts.
    renderEdit(
      {
        data: { userId: USER, accounts: [] },
        isLoading: false,
        isError: false,
        status: 'success',
      },
      { ...member, allocationPct: null },
    );

    expect(screen.queryByText(ZERO)).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(/would be at/)).toBeNull();
  });

  it('still says 0% when a settled total is zero', () => {
    // WHY: a total that arrived at zero is a free book. That line stays, so a
    // real zero is not dressed up as a slow network.
    renderEdit(
      {
        data: { userId: USER, totalPct: 0, accounts: [] },
        isLoading: false,
        isError: false,
        status: 'success',
      },
      { ...member, allocationPct: null },
    );

    expect(screen.getByText(ZERO)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('still warns when a settled total goes over 100%', () => {
    // WHY: a loaded total stays. The unread line must not hide an over-allocation
    // the read already returned.
    renderEdit({
      data: { userId: USER, totalPct: 90, accounts: [] },
      isLoading: false,
      isError: false,
      status: 'success',
    });

    expect(screen.getByText(KNOWN)).toBeTruthy();
    expect(screen.queryByText(/would be at/)).toBeNull();
    fireEvent.change(screen.getByLabelText('Allocation %'), { target: { value: '50' } });
    expect(screen.getByText('Ada North would be at 110% across accounts')).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
  });

  it('keeps a total that already arrived when a later read fails', () => {
    // WHY: a failed refresh is not a free desk. The 90% already in hand stays,
    // and the dialog does not replace it with 0% or with the error line.
    renderEdit({
      data: { userId: USER, totalPct: 90, accounts: [] },
      isLoading: false,
      isError: true,
      status: 'error',
    });

    expect(screen.getByText(KNOWN)).toBeTruthy();
    expect(screen.queryByText(ZERO)).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });
});
