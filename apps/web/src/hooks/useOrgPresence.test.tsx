// Team settings reads Redis presence, which expires 30s after the last write.
// The notification socket connects once and never pings, so a demo user who
// is looking at the team list is stored as offline. The hook has to refresh
// that row while the list is open, and stop when the list unmounts.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

import { api } from '@/lib/api';
import { ORG_PRESENCE_HEARTBEAT_MS, useOrgPresence } from './useUsers';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

vi.mock('@/lib/api', () => ({ api: vi.fn() }));

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function heartbeatCalls(): number {
  return vi.mocked(api).mock.calls.filter(([path, opts]) => {
    return (
      path === '/api/v1/presence/heartbeat' &&
      (opts as { method?: string } | undefined)?.method === 'POST'
    );
  }).length;
}

describe('useOrgPresence', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('refreshes the signed-in person while the team list is open, inside the 30s TTL', async () => {
    // 30s is PRESENCE_TTL_SECONDS in the presence service. A slower beat
    // lets the row expire while the demo user is still on the page.
    expect(ORG_PRESENCE_HEARTBEAT_MS).toBeLessThan(30_000);

    vi.useFakeTimers();
    vi.mocked(api).mockResolvedValue({ users: [] });

    renderHook(() => useOrgPresence(), { wrapper });

    expect(api).toHaveBeenCalledWith('/api/v1/presence/heartbeat', {
      method: 'POST',
      body: {},
    });
    expect(heartbeatCalls()).toBe(1);

    await vi.advanceTimersByTimeAsync(ORG_PRESENCE_HEARTBEAT_MS);

    expect(heartbeatCalls()).toBe(2);
  });

  it('stops refreshing after the team list unmounts', () => {
    vi.useFakeTimers();
    vi.mocked(api).mockResolvedValue({ users: [] });

    const { unmount } = renderHook(() => useOrgPresence(), { wrapper });
    unmount();
    vi.mocked(api).mockClear();

    vi.advanceTimersByTime(60_000);

    expect(heartbeatCalls()).toBe(0);
  });
});
