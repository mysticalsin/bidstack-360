// Regression coverage for the opportunity-contacts silent-failure bug: a
// rejected link / unlink / role-update mutation must surface a toast. Without
// onError wired here, the ContactsPanel select/remove controls just stopped
// with zero feedback.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api, ApiError } from '@/lib/api';
import { toast } from '@/components/ui/Toast';
import { useLinkContact, useUnlinkContact, useUpdateContactRole } from './useOpportunityContacts';

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

describe('useOpportunityContacts mutation error surfacing', () => {
  beforeEach(() => {
    vi.mocked(api).mockReset();
    vi.mocked(toast.error).mockClear();
  });

  it('toasts the server message when linking a contact is rejected', async () => {
    vi.mocked(api).mockRejectedValue(new ApiError('Contact already linked', 409, null));
    const { result } = renderHook(() => useLinkContact(), { wrapper: makeWrapper() });

    await expect(
      result.current.mutateAsync({ opportunityId: 'opp-1', body: { contactId: 'contact-1' } }),
    ).rejects.toThrow();

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Contact already linked'));
  });

  it('toasts the server message when unlinking a contact is rejected', async () => {
    vi.mocked(api).mockRejectedValue(new ApiError('Link not found', 404, null));
    const { result } = renderHook(() => useUnlinkContact(), { wrapper: makeWrapper() });

    await expect(
      result.current.mutateAsync({ opportunityId: 'opp-1', contactId: 'contact-1' }),
    ).rejects.toThrow();

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Link not found'));
  });

  it('toasts the server message when updating a contact role is rejected', async () => {
    vi.mocked(api).mockRejectedValue(new ApiError('Invalid role', 400, null));
    const { result } = renderHook(() => useUpdateContactRole(), { wrapper: makeWrapper() });

    await expect(
      result.current.mutateAsync({
        opportunityId: 'opp-1',
        contactId: 'contact-1',
        patch: { role: 'bogus' },
      }),
    ).rejects.toThrow();

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Invalid role'));
  });
});
