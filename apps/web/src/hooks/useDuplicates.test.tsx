// The duplicate scan is O(n) server work: it must fire ONLY while the review
// dialog is open (enabled flag), and a merge must invalidate the duplicates
// cache so a merged pair can never be offered for a second merge.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/lib/api';
import {
  useCompanyDuplicates,
  useContactDuplicates,
  useMergeDuplicates,
} from './useDuplicates';

vi.mock('@/lib/api', () => ({
  api: vi.fn(async () => ({ clusters: [], scanned: 0, truncated: false })),
}));

function makeWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

describe('useDuplicates', () => {
  beforeEach(() => vi.mocked(api).mockClear());

  it('does not scan while disabled — the scan only runs with the dialog open', async () => {
    renderHook(() => useCompanyDuplicates(false), { wrapper: makeWrapper(makeClient()) });
    await new Promise((r) => setTimeout(r, 20));
    expect(api).not.toHaveBeenCalled();
  });

  it('scans companies and contacts on their own endpoints when enabled', async () => {
    const wrapper = makeWrapper(makeClient());
    renderHook(() => useCompanyDuplicates(true), { wrapper });
    renderHook(() => useContactDuplicates(true), { wrapper });
    await waitFor(() => expect(api).toHaveBeenCalledTimes(2));
    const paths = vi.mocked(api).mock.calls.map((c) => c[0]);
    expect(paths).toContain('/api/duplicates/companies');
    expect(paths).toContain('/api/duplicates/contacts');
  });

  it('posts one survivor/duplicate pair per merge call', async () => {
    const { result } = renderHook(() => useMergeDuplicates(), {
      wrapper: makeWrapper(makeClient()),
    });
    await result.current.mutateAsync({
      entity: 'company',
      survivorId: 'keep-1',
      duplicateId: 'lose-1',
    });
    expect(api).toHaveBeenCalledWith('/api/duplicates/merge', {
      method: 'POST',
      body: { entity: 'company', survivorId: 'keep-1', duplicateId: 'lose-1' },
    });
  });

  it('invalidates the duplicates cache after a merge so a merged pair cannot resurface', async () => {
    const queryClient = makeClient();
    queryClient.setQueryData(['duplicates', 'companies'], {
      clusters: [],
      scanned: 0,
      truncated: false,
    });
    const { result } = renderHook(() => useMergeDuplicates(), {
      wrapper: makeWrapper(queryClient),
    });
    await result.current.mutateAsync({
      entity: 'company',
      survivorId: 'keep-1',
      duplicateId: 'lose-1',
    });
    await waitFor(() =>
      expect(
        queryClient.getQueryState(['duplicates', 'companies'])?.isInvalidated,
      ).toBe(true),
    );
  });
});
