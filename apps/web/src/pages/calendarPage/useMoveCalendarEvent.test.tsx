import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/api';

import type { CalendarEvent } from './types';
import { useMoveCalendarEvent } from './useMoveCalendarEvent';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, api: apiMock };
});

const KEY = ['calendar-events', 'from', 'to'] as const;

function event(): CalendarEvent {
  return {
    id: 'timed',
    subject: 'Pricing review',
    startAt: '2026-11-11T00:00:00.000Z',
    endAt: '2026-11-11T00:30:00.000Z',
    location: null,
    isAllDay: false,
    syncState: 'SYNCED',
    provider: 'google_workspace',
    createdAt: '2026-11-01T00:00:00.000Z',
    contactId: null,
    companyId: null,
    opportunityId: null,
    localOnly: true,
  };
}

function wrapper(client: QueryClient) {
  return function Wrap({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe('useMoveCalendarEvent', () => {
  beforeEach(() => {
    apiMock.mockReset();
  });

  // WHY: the conflict line reads the calendar row. A 409 has to mark that
  // row, not a message kept beside it.
  it('marks the dragged row as a conflict on 409', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(KEY, { items: [event()] });
    apiMock.mockRejectedValue(
      new ApiError(
        'This event has a sync conflict with the provider. Resolve the conflict before editing.',
        409,
        null,
      ),
    );

    const { result } = renderHook(() => useMoveCalendarEvent(), { wrapper: wrapper(client) });
    await result.current
      .mutateAsync({
        id: 'timed',
        move: { startAt: '2026-11-11T00:00:00.000Z', endAt: '2026-11-12T00:00:00.000Z', isAllDay: true },
      })
      .catch(() => undefined);

    await waitFor(() => {
      const page = client.getQueryData<{ items: CalendarEvent[] }>(KEY);
      expect(page?.items[0]?.syncState).toBe('CONFLICT');
      expect(page?.items[0]?.subject).toBe('Pricing review');
    });
  });
});
