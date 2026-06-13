import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';

export type TemplateKey = 'B2B_SAAS' | 'AGENCY_CONSULTING' | 'ENTERPRISE_SALES' | 'INSIDE_SALES';

export interface OnboardingTemplate {
  key: TemplateKey;
  name: string;
  description: string;
  stageCount: number;
}

export interface InstallResult {
  pipelineId: string;
  stagesCreated: number;
  leadsCreated: number;
  dealsCreated: number;
  tasksCreated: number;
  notesCreated: number;
}

const STATUS_KEY = ['onboarding', 'sample-data-status'] as const;

export function useTemplates() {
  return useQuery({
    queryKey: ['onboarding', 'templates'],
    queryFn: ({ signal }) => api<OnboardingTemplate[]>('/api/onboarding/templates', { signal }),
    staleTime: Infinity, // static catalog
  });
}

export function useSampleDataStatus() {
  return useQuery({
    queryKey: STATUS_KEY,
    queryFn: ({ signal }) =>
      api<{ hasSampleData: boolean }>('/api/onboarding/sample-data/status', { signal }),
    staleTime: 60_000,
  });
}

// Invalidate the workspace-shaping caches a template install or sample-data
// delete touches, so the pipeline/dashboard/lists reflect the change at once.
function invalidateWorkspace(qc: ReturnType<typeof useQueryClient>) {
  for (const key of [
    STATUS_KEY,
    ['pipeline'],
    ['crm-dashboard'],
    ['opportunities'],
    ['leads'],
    ['tasks'],
  ]) {
    qc.invalidateQueries({ queryKey: key });
  }
}

export function useInstallTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (template: TemplateKey) =>
      api<InstallResult>(`/api/onboarding/templates/${template}/install`, { method: 'POST' }),
    onSuccess: () => invalidateWorkspace(qc),
  });
}

export function useDeleteSampleData() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<unknown>('/api/onboarding/sample-data', { method: 'DELETE' }),
    onSuccess: () => invalidateWorkspace(qc),
  });
}
