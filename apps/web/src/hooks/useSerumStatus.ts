import { useQuery } from '@tanstack/react-query';

import type { SerumStatusSnapshot } from '@bidstack/shared';

import { api } from '@/lib/api';

export function useSerumStatus() {
  return useQuery({
    queryKey: ['serum', 'status'],
    queryFn: ({ signal }) => api<SerumStatusSnapshot>('/api/v1/serum/status', { signal }),
    staleTime: 10_000,
    refetchInterval: 30_000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
  });
}
