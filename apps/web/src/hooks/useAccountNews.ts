import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';

export interface AccountNewsItem {
  title: string;
  url: string;
  source: string | null;
  publishedAt: string | null;
}

export interface AccountNewsResponse {
  source: 'google-news';
  fetchedAt: string;
  items: AccountNewsItem[];
}

// Free, keyless news/intent signal for an account (Google News RSS, server-side).
// Cached for 5 min — these change slowly and the upstream is a courtesy feed.
export function useAccountNews(accountId: string) {
  return useQuery<AccountNewsResponse>({
    queryKey: ['account-news', accountId],
    queryFn: ({ signal }) =>
      api(`/api/accounts/${encodeURIComponent(accountId)}/news-signals`, { signal }),
    enabled: Boolean(accountId),
    staleTime: 5 * 60_000,
    retry: false,
  });
}
