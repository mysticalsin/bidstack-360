import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';

export interface PipelineStageSettings {
  id: string;
  key: string;
  name: string;
  orderIndex: number;
  probability: number;
  forecastCategory: string;
  isWon: boolean;
  isLost: boolean;
  color: string | null;
  updatedAt: string;
}

export interface PipelineStageSettingsList {
  items: PipelineStageSettings[];
}

export function usePipelineStages() {
  return useQuery({
    queryKey: ['pipeline-stages', 'default'],
    queryFn: ({ signal }) => api<PipelineStageSettingsList>('/api/v1/pipeline-stages', { signal }),
  });
}

export function usePatchPipelineStage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string;
      body: { name?: string; probability?: number; color?: string | null };
    }) => api<PipelineStageSettings>(`/api/v1/pipeline-stages/${id}`, { method: 'PATCH', body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['pipeline-stages', 'default'] });
      void qc.invalidateQueries({ queryKey: ['opportunities'] });
      void qc.invalidateQueries({ queryKey: ['report:pipeline'] });
    },
  });
}
