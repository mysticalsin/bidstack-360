// Regression coverage for the "delete file" silent-failure bug: a rejected
// mutation (e.g. a stale id or a 403) must surface a toast. FilesPanel's
// delete-confirm dialog only wires onSuccess — without onError here, the
// dialog just stopped showing "Deleting…" with zero feedback.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api, ApiError } from '@/lib/api';
import { toast } from '@/components/ui/Toast';
import { useDeleteFile } from './useFiles';

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

describe('useFiles mutation error surfacing', () => {
  beforeEach(() => {
    vi.mocked(api).mockReset();
    vi.mocked(toast.error).mockClear();
  });

  it('toasts the server message when deleting a file is rejected (e.g. stale id)', async () => {
    vi.mocked(api).mockRejectedValue(new ApiError('File not found', 404, null));
    const { result } = renderHook(() => useDeleteFile('account-1'), { wrapper: makeWrapper() });

    await expect(result.current.mutateAsync('file-1')).rejects.toThrow();

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('File not found'));
  });
});
