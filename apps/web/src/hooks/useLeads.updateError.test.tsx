// Regression coverage for the silent-revert bug: useUpdateLeadById only rolled
// back its optimistic write on a rejected PATCH — it never told the user why
// the status/priority badge snapped back (e.g. a stale/deleted lead, or a
// transient 5xx). Without onError wired to toast, the revert was
// indistinguishable from nothing happening. Mirrors useContacts.updateError.test.tsx.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { toast } from '@/components/ui/Toast';
import { api, ApiError } from '@/lib/api';
import { useUpdateLead, useUpdateLeadById } from './useLeads';

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

describe('useUpdateLeadById mutation error surfacing', () => {
  beforeEach(() => {
    vi.mocked(api).mockReset();
    vi.mocked(toast.error).mockClear();
  });

  it('toasts the server message when an inline status/priority PATCH is rejected (e.g. stale/deleted lead)', async () => {
    vi.mocked(api).mockRejectedValue(new ApiError('Lead not found', 404, null));
    const { result } = renderHook(() => useUpdateLeadById(), { wrapper: makeWrapper() });

    await expect(
      result.current.mutateAsync({ id: 'lead-1', patch: { status: 'qualified' } }),
    ).rejects.toThrow();

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Lead not found'));
  });

  it('falls back to a generic message when the rejection is not an Error', async () => {
    vi.mocked(api).mockRejectedValue('network down');
    const { result } = renderHook(() => useUpdateLeadById(), { wrapper: makeWrapper() });

    await expect(
      result.current.mutateAsync({ id: 'lead-1', patch: { priority: 'high' } }),
    ).rejects.toBeDefined();

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Could not update lead'));
  });
});

// useUpdateLead(id) is the single-lead variant used by LeadDetailPage — every
// BANT field, the source select, and the status/priority selects committed
// through it with no onError, so a rejected PATCH left the typed value on
// screen with zero indication the save failed. Mirrors the coverage above.
describe('useUpdateLead mutation error surfacing', () => {
  beforeEach(() => {
    vi.mocked(api).mockReset();
    vi.mocked(toast.error).mockClear();
  });

  it('toasts the server message when a lead-detail field PATCH is rejected (e.g. stale/deleted lead)', async () => {
    vi.mocked(api).mockRejectedValue(new ApiError('Lead not found', 404, null));
    const { result } = renderHook(() => useUpdateLead('lead-1'), { wrapper: makeWrapper() });

    await expect(result.current.mutateAsync({ budget: '€500K' })).rejects.toThrow();

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Lead not found'));
  });

  it('falls back to a generic message when the rejection is not an Error', async () => {
    vi.mocked(api).mockRejectedValue('network down');
    const { result } = renderHook(() => useUpdateLead('lead-1'), { wrapper: makeWrapper() });

    await expect(result.current.mutateAsync({ source: 'referral' })).rejects.toBeDefined();

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Could not update lead'));
  });
});
