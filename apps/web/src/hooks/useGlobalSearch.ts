import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface SearchResult {
  id: string;
  type: 'opportunity' | 'lead' | 'contact' | 'company' | 'task' | 'note';
  title: string;
  subtitle: string;
  url: string;
  score: number;
}

export interface SearchResponse {
  items: SearchResult[];
  /** True when this page is not every match. Not a result total. */
  pageContinues?: boolean;
  /** Types whose drawn rows are not every match of that type. Not a total. */
  continuedTypes?: string[];
  total: number;
  query: string;
}

/**
 * The term the workspace search actually runs, or null when the box is blank.
 * One letter is a search: the page prints "No results found" when this hook
 * is idle, and the demo book has Siemens under "S". " S " is that same search.
 */
export function globalSearchTerm(query: string): string | null {
  const term = query.trim();
  return term.length > 0 ? term : null;
}

export function useGlobalSearch(query: string) {
  const term = globalSearchTerm(query);
  return useQuery({
    queryKey: ['global-search', term],
    enabled: term !== null,
    queryFn: ({ signal, queryKey }) => {
      const q = queryKey[1];
      // An idle blank query must not resolve as an empty result list. The
      // page cannot tell that from a real miss.
      if (typeof q !== 'string' || q.length === 0) {
        throw new Error('workspace search ran without a query');
      }
      return api<SearchResponse>(`/api/search?q=${encodeURIComponent(q)}&limit=16`, { signal });
    },
    staleTime: 30_000,
  });
}
