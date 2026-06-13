import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';

export interface SalesToolkitCourse {
  id: string;
  title: string;
  description: string | null;
  sectorTags: string[];
  url: string | null;
}

export interface SalesToolkitsResponse {
  enabled: boolean;
  items: SalesToolkitCourse[];
}

/** Live Mantu Academy courses, optionally filtered by sector tag. Never cached long — content is pulled live by design. */
export function useSalesToolkits(sector?: string) {
  return useQuery({
    queryKey: ['sales-toolkits', sector ?? ''],
    queryFn: ({ signal }) =>
      api<SalesToolkitsResponse>(
        sector
          ? `/api/sales-toolkits?sector=${encodeURIComponent(sector)}`
          : '/api/sales-toolkits',
        { signal },
      ),
    staleTime: 60 * 1000,
  });
}
