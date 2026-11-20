import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';

interface PipelineReport {
  byStage: { stage: string; count: number; valueSum: number }[];
  totalOpen: number;
  totalValueOpen: number;
  weightedPipeline: number;
  velocity: { avgDaysOpen: number; closedThisQuarter: number };
}

export function usePipelineReport() {
  return useQuery({
    queryKey: ['report:pipeline'],
    queryFn: ({ signal }) => api<PipelineReport>('/api/reports/pipeline', { signal }),
  });
}
