// A paused or in-flight follow read has no status yet. The control rendered
// nothing, which looks off. That read has not arrived.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/useAccountTeam', () => ({
  useAccountFollow: vi.fn(),
  useSetAccountFollow: vi.fn(),
}));

import { useAccountFollow, useSetAccountFollow } from '@/hooks/useAccountTeam';

import { FollowAccountButton } from './FollowAccountButton';

const COMPANY = '00000000-0000-4000-8000-000000000003';
const CHECKING = 'Checking follow. The status has not arrived.';
const FAILED = 'Could not load the follow status.';

interface FollowState {
  following: boolean;
  muted: boolean;
  reasons: Array<'team' | 'key_account_owner' | 'opportunity_owner' | 'explicit'>;
}

function renderFollow(query: {
  data?: FollowState | null;
  isLoading: boolean;
  isError: boolean;
  status?: string;
}) {
  vi.mocked(useAccountFollow).mockReturnValue(query as never);
  vi.mocked(useSetAccountFollow).mockReturnValue({ mutate: vi.fn(), isPending: false } as never);
  return render(<FollowAccountButton companyId={COMPANY} />);
}

describe('FollowAccountButton read', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not treat a paused follow read as off', () => {
    // WHY: a paused first read has isLoading false and no status. Hiding the
    // control looks off. This read has not arrived.
    renderFollow({ data: undefined, isLoading: false, isError: false, status: 'pending' });

    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Follow/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Following/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Muted/ })).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('does not treat an in-flight follow read as off', () => {
    // WHY: a slow read also has no status. Rendering nothing is not a settled
    // empty record, and it is not a failed load.
    renderFollow({ data: undefined, isLoading: true, isError: false, status: 'pending' });

    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Follow/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Following/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Muted/ })).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('keeps a failed follow read on the error', () => {
    // WHY: a failed read is not evidence that the caller is not following.
    // The error stays, and a hidden control does not stand in for the read.
    renderFollow({ data: undefined, isLoading: false, isError: true, status: 'error' });

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('lets a failed read win over a stale follow status', () => {
    // WHY: error wins before a payload. A refetch failure must not keep
    // showing Following from a status that is no longer the read.
    renderFollow({
      data: { following: true, muted: false, reasons: ['explicit'] },
      isLoading: false,
      isError: true,
      status: 'error',
    });

    expect(screen.queryByRole('button', { name: /Following/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Follow/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Muted/ })).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
  });

  it('stays empty when a settled read has no status', () => {
    // WHY: a settled null payload is not an unread pause. Undefined data is
    // unread. Null has arrived, and the control stays empty.
    renderFollow({ data: null, isLoading: false, isError: false, status: 'success' });

    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('still shows Follow when the caller is not following', () => {
    // WHY: a loaded status of not following stays. Unread must not look like
    // the follow control is off, and a real not-following status must stay.
    renderFollow({
      data: { following: false, muted: false, reasons: [] },
      isLoading: false,
      isError: false,
      status: 'success',
    });

    expect(screen.getByRole('button', { name: /^Follow\b/ })).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('still shows Following when the caller follows', () => {
    // WHY: a loaded following status stays. The unread line must not replace
    // a status the read already returned.
    renderFollow({
      data: { following: true, muted: false, reasons: ['team'] },
      isLoading: false,
      isError: false,
      status: 'success',
    });

    const button = screen.getByRole('button', { name: /Following/ });
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(button.getAttribute('title')).toContain('You are on the account team');
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
  });

  it('still shows Muted when alerts are muted', () => {
    // WHY: a loaded muted status stays. Unread must not look muted, and a
    // real muted status must stay.
    renderFollow({
      data: { following: false, muted: true, reasons: ['opportunity_owner'] },
      isLoading: false,
      isError: false,
      status: 'success',
    });

    expect(screen.getByRole('button', { name: /Muted/ })).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });
});
