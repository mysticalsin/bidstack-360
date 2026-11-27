import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import { ActivityByHourCard } from './ActivityByHourCard';

const state = vi.hoisted(() => ({
  canRead: true,
  feed: {
    data: undefined as
      | undefined
      | {
          items: Array<{
            occurredAt: string;
            type: string;
            subject?: string | null;
            entityType?: string | null;
            entityId?: string | null;
          }>;
          total?: number;
        },
    isLoading: false,
    isError: false,
    refetch: (() => undefined) as () => void,
  },
}));

vi.mock('@/hooks/useCapabilities', () => ({ useHasPermission: () => state.canRead }));
vi.mock('@/hooks/useActivityFeed', () => ({ useActivityFeed: () => state.feed }));
vi.mock('@/lib/timezone', () => ({ browserTimeZone: () => 'UTC' }));

afterEach(() => {
  cleanup();
  state.canRead = true;
  state.feed = { data: undefined, isLoading: false, isError: false, refetch: () => undefined };
});

function renderCard() {
  return render(
    <MemoryRouter>
      <ActivityByHourCard />
    </MemoryRouter>,
  );
}

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
    renderCard();
    expect(screen.getByRole('heading', { name: 'Activity by hour' })).toBeTruthy();
    expect(screen.getByRole('img', { name: /busiest 09 with 2/i })).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
  });

  it('shows one empty sentence when there is no activity', () => {
    state.feed = { ...state.feed, data: { items: [] } };
    renderCard();
    expect(screen.getByText('No activity logged yet.')).toBeTruthy();
  });

  it('does not call a loading chart an empty log', () => {
    // A slow activity read used to announce "No activity logged yet" while the
    // card was still waiting. That sentence is only true once the read settles empty.
    state.feed = { ...state.feed, isLoading: true };
    renderCard();
    expect(screen.getByText('Loading activity.')).toBeTruthy();
    expect(screen.queryByText('No activity logged yet.')).toBeNull();
    expect(document.querySelector('figure')?.getAttribute('aria-label')).toBe('Loading activity.');
  });

  it('retries a failed read instead of saying the log is empty', () => {
    const refetch = vi.fn();
    state.feed = { data: undefined, isLoading: false, isError: true, refetch };
    renderCard();
    expect(screen.queryByText('No activity logged yet.')).toBeNull();
    expect(document.querySelector('figure')?.getAttribute('aria-label')).toBe('Could not load activity.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it('opens the bids logged in the busiest hour, and another hour on its chip', () => {
    // WHY: the demo book logs "Exec sponsor catch-up" on OP-2041 at 14:00, with
    // two more bids in that same hour. The chart said 14:00 was busiest and
    // then stopped. The person still could not open the bid.
    state.feed = {
      ...state.feed,
      data: {
        total: 4,
        items: [
          {
            occurredAt: '2026-11-23T14:00:00.000Z',
            type: 'call',
            subject: 'Exec sponsor catch-up',
            entityType: 'opportunity',
            entityId: 'opp-2041',
          },
          {
            occurredAt: '2026-11-13T14:20:00.000Z',
            type: 'call',
            subject: 'Proposal walkthrough',
            entityType: 'opportunity',
            entityId: 'opp-2047',
          },
          {
            occurredAt: '2026-11-18T14:30:00.000Z',
            type: 'email',
            subject: 'Cutover window proposal',
            entityType: 'opportunity',
            entityId: 'opp-2043',
          },
          {
            occurredAt: '2026-11-22T09:30:00.000Z',
            type: 'call',
            subject: 'Procurement timeline check',
            entityType: 'opportunity',
            entityId: 'opp-2048',
          },
        ],
      },
    };
    renderCard();
    expect(screen.getByRole('link', { name: 'Exec sponsor catch-up' }).getAttribute('href')).toBe(
      '/opportunities/opp-2041',
    );
    expect(screen.getByRole('link', { name: 'Proposal walkthrough' }).getAttribute('href')).toBe(
      '/opportunities/opp-2047',
    );
    expect(screen.getByRole('link', { name: 'Cutover window proposal' }).getAttribute('href')).toBe(
      '/opportunities/opp-2043',
    );
    expect(screen.queryByRole('link', { name: 'Procurement timeline check' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '09:00, 1 activity' }));
    expect(screen.getByRole('link', { name: 'Procurement timeline check' }).getAttribute('href')).toBe(
      '/opportunities/opp-2048',
    );
    expect(screen.queryByRole('link', { name: 'Exec sponsor catch-up' })).toBeNull();
  });

  it('stays out of the page without activities:read', () => {
    state.canRead = false;
    const { container } = render(<ActivityByHourCard />);
    expect(container.innerHTML).toBe('');
    state.canRead = true;
  });
});
