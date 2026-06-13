import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface SearchResult {
  id: string;
  type: 'opportunity' | 'contact' | 'company' | 'task' | 'note';
  title: string;
  subtitle: string;
  url: string;
  score: number;
}

export interface SearchResponse {
  items: SearchResult[];
  total: number;
  query: string;
}

export function useGlobalSearch(query: string) {
  return useQuery({
    queryKey: ['global-search', query],
    enabled: query.trim().length >= 2,
    queryFn: ({ signal }) =>
      api<SearchResponse>(`/api/search?q=${encodeURIComponent(query.trim())}&limit=16`, { signal }),
    staleTime: 30_000,
  });
}
