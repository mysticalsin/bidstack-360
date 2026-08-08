// Regression coverage for the "advance governance action status" silent-
// failure bug: a rejected mutation (e.g. a 403 without the write permission)
// must surface a toast. GovernanceLogCard's status-advance button wires no
// onError — without onError here, the pill just stopped showing pending
// state with zero feedback.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api, ApiError } from '@/lib/api';
import { toast } from '@/components/ui/Toast';
import { usePatchGovernanceAction } from './useGovernance';

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, api: vi.fn() };
});

vi.mock('@/components/ui/Toast', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('useGovernance mutation error surfacing', () => {
  beforeEach(() => {
    vi.mocked(api).mockReset();
    vi.mocked(toast.error).mockClear();
  });

  it('toasts the server message when patching a governance action is rejected (e.g. 403)', async () => {
    vi.mocked(api).mockRejectedValue(new ApiError('governance:write required', 403, null));
    const { result } = renderHook(() => usePatchGovernanceAction(), { wrapper: makeWrapper() });

    await expect(
      result.current.mutateAsync({
        meetingId: 'meeting-1',
        actionId: 'action-1',
        body: { status: 'done' },
      }),
    ).rejects.toThrow();

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('governance:write required'));
  });
});
