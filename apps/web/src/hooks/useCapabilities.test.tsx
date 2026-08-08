// useHasAdminPermission must AND the permission grant with the admin role,
// not OR them like useHasPermission does. Several server routes (e.g. the
// company write routes: apps/api/src/routes/companies.ts) stack
// requirePermission(key) with requireRole('admin') — a custom role holding
// the raw grant still gets 403'd there. This locks in the AND so a regression
// back to OR (which would show write controls the server rejects) fails here.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/lib/api';
import { useHasAdminPermission, useHasPermission, type CapabilityManifest } from './useCapabilities';

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, api: vi.fn() };
});

function makeWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function manifest(overrides: Partial<CapabilityManifest>): CapabilityManifest {
  return {
    userId: 'user-1',
    orgId: 'org-1',
    legacyRole: 'member',
    roles: ['member'],
    permissions: [],
    isAdmin: false,
    ...overrides,
  };
}

describe('useHasAdminPermission', () => {
  beforeEach(() => {
    vi.mocked(api).mockReset();
  });

  it('returns false for a non-admin holding the raw permission grant', async () => {
    vi.mocked(api).mockResolvedValue(
      manifest({ isAdmin: false, permissions: ['companies:write'] }),
    );
    const { result } = renderHook(() => useHasAdminPermission('companies:write'), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(vi.mocked(api)).toHaveBeenCalled());
    await waitFor(() => expect(result.current).toBe(false));
  });

  it('returns true for an admin holding the permission grant', async () => {
    vi.mocked(api).mockResolvedValue(
      manifest({ isAdmin: true, permissions: ['companies:write'] }),
    );
    const { result } = renderHook(() => useHasAdminPermission('companies:write'), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current).toBe(true));
  });

  it('returns false for an admin lacking the permission grant', async () => {
    vi.mocked(api).mockResolvedValue(manifest({ isAdmin: true, permissions: [] }));
    const { result } = renderHook(() => useHasAdminPermission('companies:write'), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(vi.mocked(api)).toHaveBeenCalled());
    await waitFor(() => expect(result.current).toBe(false));
  });

  it('differs from useHasPermission for a non-admin permission holder (the OR vs AND gap)', async () => {
    vi.mocked(api).mockResolvedValue(
      manifest({ isAdmin: false, permissions: ['companies:write'] }),
    );
    const wrapper = makeWrapper();
    const permissionOnly = renderHook(() => useHasPermission('companies:write'), { wrapper });
    const adminAndPermission = renderHook(() => useHasAdminPermission('companies:write'), {
      wrapper,
    });

    await waitFor(() => expect(permissionOnly.result.current).toBe(true));
    await waitFor(() => expect(adminAndPermission.result.current).toBe(false));
  });
});
