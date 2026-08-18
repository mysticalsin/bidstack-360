// Regression coverage for the user-role/RBAC silent-failure bug: a rejected
// mutation (e.g. a 403 from a non-admin actor, or a stale role id) must
// surface a toast. Without onError wired here, Promote/Demote and role
// assign/revoke in the Team settings UI just stopped the spinner with zero
// feedback.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api, ApiError } from '@/lib/api';
import { toast } from '@/components/ui/Toast';
import { useUpdateUserRole, useAssignUserRole, useRevokeUserRole } from './useUsers';

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

describe('useUsers mutation error surfacing', () => {
  beforeEach(() => {
    vi.mocked(api).mockReset();
    vi.mocked(toast.error).mockClear();
  });

  it('toasts the server message when updating a user role is rejected (e.g. 403 non-admin actor)', async () => {
    vi.mocked(api).mockRejectedValue(new ApiError('Admin role required', 403, null));
    const { result } = renderHook(() => useUpdateUserRole(), { wrapper: makeWrapper() });

    await expect(
      result.current.mutateAsync({ id: 'user-1', role: 'admin' }),
    ).rejects.toThrow();

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Admin role required'));
  });

  it('toasts the server message when assigning a role is rejected', async () => {
    vi.mocked(api).mockRejectedValue(new ApiError('Role not found', 404, null));
    const { result } = renderHook(() => useAssignUserRole('user-1'), {
      wrapper: makeWrapper(),
    });

    await expect(result.current.mutateAsync('role-1')).rejects.toThrow();

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Role not found'));
  });

  it('toasts the server message when revoking a role is rejected', async () => {
    vi.mocked(api).mockRejectedValue(new ApiError('Role assignment not found', 404, null));
    const { result } = renderHook(() => useRevokeUserRole('user-1'), {
      wrapper: makeWrapper(),
    });

    await expect(result.current.mutateAsync('role-1')).rejects.toThrow();

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Role assignment not found'),
    );
  });
});
