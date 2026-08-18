// Regression coverage for the tags silent-failure gap: a rejected mutation
// (validation 400, duplicate name, stale-id delete/apply) must surface a
// toast. Without onError wired here, tag actions in TagsSection/TagPicker
// just stopped the spinner with zero feedback.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api, ApiError } from '@/lib/api';
import { toast } from '@/components/ui/Toast';
import {
  useCreateTag,
  useUpdateTag,
  useDeleteTag,
  useApplyTags,
  useRemoveTags,
  useTagSuggestions,
} from './useTags';

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

describe('useTags mutation error surfacing', () => {
  beforeEach(() => {
    vi.mocked(api).mockReset();
    vi.mocked(toast.error).mockClear();
  });

  it('toasts the server message when creating a tag is rejected (e.g. duplicate name)', async () => {
    vi.mocked(api).mockRejectedValue(new ApiError('Tag name already in use', 409, null));
    const { result } = renderHook(() => useCreateTag(), { wrapper: makeWrapper() });

    await expect(
      result.current.mutateAsync({ name: 'Hot Lead', color: '#000' }),
    ).rejects.toThrow();

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Tag name already in use'));
  });

  it('toasts the server message when updating a tag is rejected', async () => {
    vi.mocked(api).mockRejectedValue(new ApiError('body/name Required', 400, null));
    const { result } = renderHook(() => useUpdateTag(), { wrapper: makeWrapper() });

    await expect(
      result.current.mutateAsync({ id: 'tag-1', patch: { name: '' } }),
    ).rejects.toThrow();

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('body/name Required'));
  });

  it('toasts the server message when deleting a tag is rejected', async () => {
    vi.mocked(api).mockRejectedValue(new ApiError('Invalid uuid', 400, null));
    const { result } = renderHook(() => useDeleteTag(), { wrapper: makeWrapper() });

    await expect(result.current.mutateAsync('nonexistent-id')).rejects.toThrow();

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Invalid uuid'));
  });

  it('toasts the server message when applying tags is rejected', async () => {
    vi.mocked(api).mockRejectedValue(new ApiError('Tag not found', 404, null));
    const { result } = renderHook(() => useApplyTags(), { wrapper: makeWrapper() });

    await expect(
      result.current.mutateAsync({ entityType: 'lead', entityId: 'lead-1', tagIds: ['tag-1'] }),
    ).rejects.toThrow();

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Tag not found'));
  });

  it('toasts the server message when removing tags is rejected', async () => {
    vi.mocked(api).mockRejectedValue(new ApiError('Tag not found', 404, null));
    const { result } = renderHook(() => useRemoveTags(), { wrapper: makeWrapper() });

    await expect(
      result.current.mutateAsync({ entityType: 'lead', entityId: 'lead-1', tagIds: ['tag-1'] }),
    ).rejects.toThrow();

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Tag not found'));
  });

  it('toasts the server message when tag suggestions are rejected', async () => {
    vi.mocked(api).mockRejectedValue(new ApiError('Suggestion service unavailable', 502, null));
    const { result } = renderHook(() => useTagSuggestions(), { wrapper: makeWrapper() });

    await expect(
      result.current.mutateAsync({ entityType: 'lead', entityId: 'lead-1', text: 'hot lead' }),
    ).rejects.toThrow();

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Suggestion service unavailable'),
    );
  });
});
