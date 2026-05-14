import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface PipelineReport {
  byStage: { stage: string; count: number; valueSum: number }[];
  totalOpen: number;
  totalValueOpen: number;
  weightedPipeline: number;
  velocity: { avgDaysOpen: number; closedThisQuarter: number };
}

export interface LeadReport {
  byStatus: { status: string; count: number }[];
  bySource: { source: string; count: number }[];
  total: number;
  converted: number;
  conversionRate: number;
  avgScore: number;
}

export interface ServiceDeskReport {
  byStatus: { status: string; count: number }[];
  byPriority: { priority: string; count: number }[];
  total: number;
  open: number;
  resolvedThisMonth: number;
  avgSatisfaction: number | null;
}

export interface TaskReport {
  byStatus: { status: string; count: number }[];
  total: number;
  completed: number;
  overdue: number;
  completionRate: number;
}

export function usePipelineReport() {
  return useQuery<PipelineReport>({
    queryKey: ['reports', 'pipeline'],
    queryFn: async () => api<PipelineReport>('/api/reports/pipeline'),
  });
}

export function useLeadReport() {
  return useQuery<LeadReport>({
    queryKey: ['reports', 'leads'],
    queryFn: async () => api<LeadReport>('/api/reports/leads'),
  });
}

export function useServiceDeskReport() {
  return useQuery<ServiceDeskReport>({
    queryKey: ['reports', 'service-desk'],
    queryFn: async () => api<ServiceDeskReport>('/api/reports/service-desk'),
  });
}

export function useTaskReport() {
  return useQuery<TaskReport>({
    queryKey: ['reports', 'tasks'],
    queryFn: async () => api<TaskReport>('/api/reports/tasks'),
  });
}
