import { useQuery } from '@tanstack/react-query';

import type { SearchResponse } from '@bidstack/shared';

import { api } from '@/lib/api';

export type { SearchResponse, SearchResult } from '@bidstack/shared';

export function useGlobalSearch(query: string) {
  return useQuery({
    queryKey: ['global-search', query],
    enabled: query.trim().length >= 2,
    queryFn: ({ signal }) =>
      api<SearchResponse>(`/api/search?q=${encodeURIComponent(query.trim())}&limit=16`, { signal }),
    staleTime: 30_000,
  });
}
