import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/useAccountTeam', () => ({
  useAccountFollow: vi.fn(),
  useSetAccountFollow: vi.fn(),
}));

import { useAccountFollow, useSetAccountFollow } from '@/hooks/useAccountTeam';

import { FollowAccountButton, followView } from './FollowAccountButton';

const COMPANY = '00000000-0000-4000-8000-000000000003';

afterEach(() => cleanup());

function setup(state: { following: boolean; muted: boolean; reasons: string[] }) {
  const mutate = vi.fn();
  vi.mocked(useAccountFollow).mockReturnValue({ data: state } as never);
  vi.mocked(useSetAccountFollow).mockReturnValue({ mutate, isPending: false } as never);
  render(<FollowAccountButton companyId={COMPANY} />);
  return mutate;
}

describe('FollowAccountButton', () => {
  it('follows when not following', () => {
    const mutate = setup({ following: false, muted: false, reasons: [] });
    const btn = screen.getByRole('button', { name: /Follow/ });
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(btn);
    expect(mutate).toHaveBeenCalledWith('follow');
  });

  it('mutes an automatic follower instead of unfollowing', () => {
    const mutate = setup({ following: true, muted: false, reasons: ['team'] });
    const btn = screen.getByRole('button', { name: /Following/ });
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(btn.getAttribute('title')).toContain('You are on the account team');
    fireEvent.click(btn);
    expect(mutate).toHaveBeenCalledWith('mute');
  });

  it('unfollows an explicit follower and unmutes a muted one', () => {
    expect(followView({ following: true, muted: false, reasons: ['explicit'] }).next).toBe(
      'unfollow',
    );
    const mutate = setup({ following: false, muted: true, reasons: ['opportunity_owner'] });
    fireEvent.click(screen.getByRole('button', { name: /Muted/ }));
    expect(mutate).toHaveBeenCalledWith('unmute');
  });
});
