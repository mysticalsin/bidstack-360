// Regression coverage for the "delete template" silent-failure bug: a
// rejected mutation (e.g. a stale id or a 403) must surface a toast.
// Without onError wired here, EmailTemplatesSection.remove() has no catch of
// its own — clicking "Delete" appeared to do nothing.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api, ApiError } from '@/lib/api';
import { toast } from '@/components/ui/Toast';
import { useDeleteEmailTemplate } from './useEmailTemplates';

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

describe('useEmailTemplates mutation error surfacing', () => {
  beforeEach(() => {
    vi.mocked(api).mockReset();
    vi.mocked(toast.error).mockClear();
  });

  it('toasts the server message when deleting a template is rejected (e.g. stale id)', async () => {
    vi.mocked(api).mockRejectedValue(new ApiError('Template not found', 404, null));
    const { result } = renderHook(() => useDeleteEmailTemplate(), { wrapper: makeWrapper() });

    await expect(result.current.mutateAsync('template-1')).rejects.toThrow();

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Template not found'));
  });
});
