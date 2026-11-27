// The search page prints "No results found" when this hook is idle with no
// data. A one-letter demo query was idle: "S" is Siemens, Sanofi, Stellantis,
// and Spotify, and " M " is the same search as "M" (MAHLE, Mantu, MAPFRE).
// Skipping it told the workspace those accounts were not there.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/lib/api';

import { useGlobalSearch, type SearchResponse } from './useGlobalSearch';

vi.mock('@/lib/api', () => ({
  api: vi.fn(),
}));

const SIEMENS: SearchResponse = {
  items: [
    {
      id: 'c0000000-0000-4000-8000-0000000000s1',
      type: 'company',
      title: 'Siemens',
      subtitle: 'siemens.com',
      url: '/accounts/c0000000-0000-4000-8000-0000000000s1',
      score: 12,
    },
  ],
  pageContinues: false,
  continuedTypes: [],
  total: 1,
  query: 'S',
};

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function renderSearch<T>(hook: (props: T) => ReturnType<typeof useGlobalSearch>, props: T) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return renderHook(hook, { wrapper: Wrapper, initialProps: props });
}

afterEach(() => {
  vi.mocked(api).mockReset();
});

describe('useGlobalSearch one-letter demo query', () => {
  it('searches "S" instead of settling on an empty page', async () => {
    // WHY: /search?q=S renders the no-match empty state when the hook never
    // fetches. The demo book has Siemens, Sanofi, Stellantis, and Spotify.
    // "No results found" is only honest after that request comes back empty.
    const pending = deferred<SearchResponse>();
    vi.mocked(api).mockReturnValue(pending.promise);

    const { result } = renderSearch(() => useGlobalSearch(' S '), undefined);

    await waitFor(() => {
      expect(vi.mocked(api)).toHaveBeenCalledWith(
        '/api/search?q=S&limit=16',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });
    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeUndefined();
    expect(result.current.fetchStatus).not.toBe('idle');

    pending.resolve(SIEMENS);
    await waitFor(() => {
      expect(result.current.data?.items[0]?.title).toBe('Siemens');
    });
    expect(result.current.isLoading).toBe(false);
  });

  it('keeps the Siemens hit when the same letter gains spaces', async () => {
    // WHY: "S" and " S " are one search. A second key that does not fetch
    // drops the hit and the page equates that idle state with no match.
    vi.mocked(api).mockResolvedValue(SIEMENS);
    const { result, rerender } = renderSearch(({ q }: { q: string }) => useGlobalSearch(q), {
      q: 'S',
    });

    await waitFor(() => {
      expect(result.current.data?.items[0]?.title).toBe('Siemens');
    });

    rerender({ q: ' S ' });

    expect(result.current.data?.items[0]?.title).toBe('Siemens');
    expect(result.current.isLoading).toBe(false);
    expect(result.current.fetchStatus).toBe('idle');
    expect(vi.mocked(api)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api)).toHaveBeenCalledWith(
      '/api/search?q=S&limit=16',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('does not search a blank box', async () => {
    // WHY: an empty search box is the guidance state. Firing /api/search
    // for it would replace that guidance with a result list.
    vi.mocked(api).mockResolvedValue(SIEMENS);
    const { result } = renderSearch(() => useGlobalSearch('   '), undefined);

    await waitFor(() => {
      expect(result.current.fetchStatus).toBe('idle');
    });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toBeUndefined();
    expect(vi.mocked(api)).not.toHaveBeenCalled();
  });
});
