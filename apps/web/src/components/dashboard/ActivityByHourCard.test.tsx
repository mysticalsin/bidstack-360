import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ActivityByHourCard } from './ActivityByHourCard';

const state = vi.hoisted(() => ({
  canRead: true,
  feed: {
    data: undefined as undefined | { items: Array<{ occurredAt: string; type: string }> },
    isLoading: false,
    isError: false,
    refetch: () => undefined,
  },
}));

vi.mock('@/hooks/useCapabilities', () => ({ useHasPermission: () => state.canRead }));
vi.mock('@/hooks/useActivityFeed', () => ({ useActivityFeed: () => state.feed }));
vi.mock('@/lib/timezone', () => ({ browserTimeZone: () => 'UTC' }));

afterEach(cleanup);

describe('ActivityByHourCard', () => {
  it('buckets the latest activity by hour of day', () => {
    state.feed = {
      ...state.feed,
      data: {
        items: [
          { occurredAt: '2026-11-02T09:15:00Z', type: 'call' },
          { occurredAt: '2026-11-03T09:40:00Z', type: 'email' },
          { occurredAt: '2026-11-03T15:00:00Z', type: 'meeting' },
        ],
      },
    };
    render(<ActivityByHourCard />);
    expect(screen.getByRole('heading', { name: 'Activity by hour' })).toBeTruthy();
    expect(screen.getByRole('img', { name: /busiest 09 with 2/i })).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
  });

  it('shows one empty sentence when there is no activity', () => {
    state.feed = { ...state.feed, data: { items: [] } };
    render(<ActivityByHourCard />);
    expect(screen.getByText('No activity logged yet.')).toBeTruthy();
  });

  it('stays out of the page without activities:read', () => {
    state.canRead = false;
    const { container } = render(<ActivityByHourCard />);
    expect(container.innerHTML).toBe('');
    state.canRead = true;
  });
});
