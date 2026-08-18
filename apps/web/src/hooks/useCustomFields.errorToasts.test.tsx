// Regression coverage for the custom-field-definition silent-failure bug: a
// rejected create/patch/delete (e.g. a duplicate field key, or a stale id)
// must surface a toast. Without onError wired here, saving/deleting a field
// in Settings just stopped the spinner with zero feedback.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api, ApiError } from '@/lib/api';
import { toast } from '@/components/ui/Toast';
import {
  useCreateCustomFieldDefinition,
  usePatchCustomFieldDefinition,
  useDeleteCustomFieldDefinition,
} from './useCustomFields';

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

describe('useCustomFields mutation error surfacing', () => {
  beforeEach(() => {
    vi.mocked(api).mockReset();
    vi.mocked(toast.error).mockClear();
  });

  it('toasts the server message when creating a custom field is rejected (e.g. duplicate key)', async () => {
    vi.mocked(api).mockRejectedValue(new ApiError('field key already in use', 409, null));
    const { result } = renderHook(() => useCreateCustomFieldDefinition(), {
      wrapper: makeWrapper(),
    });

    await expect(
      result.current.mutateAsync({
        entityType: 'company',
        label: 'Segment',
        fieldKey: 'segment',
        fieldType: 'text',
      } as never),
    ).rejects.toThrow();

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('field key already in use'),
    );
  });

  it('toasts the server message when patching a custom field is rejected', async () => {
    vi.mocked(api).mockRejectedValue(new ApiError('Definition not found', 404, null));
    const { result } = renderHook(() => usePatchCustomFieldDefinition('def-1'), {
      wrapper: makeWrapper(),
    });

    await expect(
      result.current.mutateAsync({ body: { label: 'New label' }, entityType: 'company' }),
    ).rejects.toThrow();

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Definition not found'));
  });

  it('toasts the server message when deleting a custom field is rejected', async () => {
    vi.mocked(api).mockRejectedValue(new ApiError('Definition not found', 404, null));
    const { result } = renderHook(() => useDeleteCustomFieldDefinition(), {
      wrapper: makeWrapper(),
    });

    await expect(
      result.current.mutateAsync({ id: 'def-1', entityType: 'company' }),
    ).rejects.toThrow();

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Definition not found'));
  });
});
