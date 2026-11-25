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
// Separate from STATUS_KEY so this read can fail once without changing how
// the sample-data banner retries. Install and delete still invalidate it.
const CHECKLIST_TEMPLATE_KEY = ['onboarding', 'checklist-template'] as const;

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

// Quick Start's "pick a template pipeline" row used to flip when the picker
// opened. Installing a template writes sample leads. The row follows that
// flag. Install and sample-data delete invalidate this read. A seeded demo
// book is not this signal. retry is off so a denied read fails once and the
// page can keep a stored click instead of inventing an install.
export function useChecklistTemplateInstalled() {
  return useQuery({
    queryKey: CHECKLIST_TEMPLATE_KEY,
    queryFn: ({ signal }) =>
      api<{ hasSampleData: boolean }>('/api/onboarding/sample-data/status', { signal }),
    select: (status) => status.hasSampleData,
    staleTime: 60_000,
    retry: false,
  });
}

// Invalidate the workspace-shaping caches a template install or sample-data
// delete touches, so the pipeline/dashboard/lists reflect the change at once.
function invalidateWorkspace(qc: ReturnType<typeof useQueryClient>) {
  for (const key of [
    STATUS_KEY,
    CHECKLIST_TEMPLATE_KEY,
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
