import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';

export interface StoryMatch {
  id: string;
  title: string;
  client: string;
  industry: string;
  relevanceScore: number; // 0-100
  hybridScoreBps: number; // 0-10000
  summary: string;
  matchedRequirements: string[]; // requirement IDs
  url: string | null;
}

interface StoryMatchResult {
  items: StoryMatch[];
  total: number;
}

export function useRfpStoryMatches(bidWorkspaceId: string | null) {
  return useQuery<StoryMatchResult>({
    queryKey: ['rfp', bidWorkspaceId, 'story-matches'],
    queryFn: ({ signal }) =>
      api<StoryMatchResult>(`/api/v1/bid-workspaces/${bidWorkspaceId}/story-matches`, { signal }),
    enabled: !!bidWorkspaceId,
    staleTime: 60_000,
  });
}
