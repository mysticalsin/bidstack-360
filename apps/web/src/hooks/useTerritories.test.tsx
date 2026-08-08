// Regression coverage for the territory/routing-rule silent-failure bug: a
// rejected mutation (validation 400, duplicate name, stale-id delete) must
// surface a toast. Without onError wired here, Save/Delete on the Territories
// page just stopped the spinner with zero feedback.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api, ApiError } from '@/lib/api';
import { toast } from '@/components/ui/Toast';
import {
  useCreateTerritory,
  useUpdateTerritory,
  useDeleteTerritory,
  useCreateLeadRoutingRule,
  useUpdateLeadRoutingRule,
  useDeleteLeadRoutingRule,
} from './useTerritories';

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

describe('useTerritories mutation error surfacing', () => {
  beforeEach(() => {
    vi.mocked(api).mockReset();
    vi.mocked(toast.error).mockClear();
  });

  it('toasts the server message when creating a territory is rejected (e.g. 400 missing fields)', async () => {
    vi.mocked(api).mockRejectedValue(
      new ApiError('body/name Required, body/countryCodes Required', 400, null),
    );
    const { result } = renderHook(() => useCreateTerritory(), { wrapper: makeWrapper() });

    await expect(
      result.current.mutateAsync({ name: '', countryCodes: [] } as never),
    ).rejects.toThrow();

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('body/name Required, body/countryCodes Required'),
    );
  });

  it('toasts the server message when updating a territory is rejected', async () => {
    vi.mocked(api).mockRejectedValue(new ApiError('Territory name already in use', 409, null));
    const { result } = renderHook(() => useUpdateTerritory(), { wrapper: makeWrapper() });

    await expect(
      result.current.mutateAsync({ id: 'territory-1', name: 'EMEA' }),
    ).rejects.toThrow();

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Territory name already in use'),
    );
  });

  it('toasts the server message when deleting a territory is rejected (e.g. invalid id)', async () => {
    vi.mocked(api).mockRejectedValue(new ApiError('Invalid uuid', 400, null));
    const { result } = renderHook(() => useDeleteTerritory(), { wrapper: makeWrapper() });

    await expect(result.current.mutateAsync('nonexistent-id')).rejects.toThrow();

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Invalid uuid'));
  });

  it('toasts the server message when creating a lead routing rule is rejected', async () => {
    vi.mocked(api).mockRejectedValue(new ApiError('body/territoryId Required', 400, null));
    const { result } = renderHook(() => useCreateLeadRoutingRule(), { wrapper: makeWrapper() });

    await expect(result.current.mutateAsync({} as never)).rejects.toThrow();

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('body/territoryId Required'));
  });

  it('toasts the server message when updating a lead routing rule is rejected', async () => {
    vi.mocked(api).mockRejectedValue(new ApiError('Routing rule not found', 404, null));
    const { result } = renderHook(() => useUpdateLeadRoutingRule(), { wrapper: makeWrapper() });

    await expect(
      result.current.mutateAsync({ id: 'rule-1', priority: 2 }),
    ).rejects.toThrow();

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Routing rule not found'));
  });

  it('toasts the server message when deleting a lead routing rule is rejected', async () => {
    vi.mocked(api).mockRejectedValue(new ApiError('Invalid uuid', 400, null));
    const { result } = renderHook(() => useDeleteLeadRoutingRule(), { wrapper: makeWrapper() });

    await expect(result.current.mutateAsync('nonexistent-id')).rejects.toThrow();

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Invalid uuid'));
  });
});
