// Goals hooks — list, detail, create, update, delete
// Separate from the existing hooks to keep analytics-domain concerns together.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

// ── Types ────────────────────────────────────────────────────────────────────

export type GoalMetric = 'revenue' | 'deals_closed' | 'leads_converted' | 'pipeline_value' | 'custom';
export type GoalPeriod = 'weekly' | 'monthly' | 'quarterly' | 'yearly';
export type GoalStatus = 'on_track' | 'at_risk' | 'behind' | 'achieved' | 'missed';

export interface Goal {
  id: string;
  orgId: string;
  ownerId: string;
  name: string;
  description?: string;
  metric: GoalMetric;
  target: number;
  current: number;
  unit: string;
  period: GoalPeriod;
  startDate: string;
  endDate: string;
  status: GoalStatus;
  createdAt: string;
  updatedAt: string;
}

export interface GoalProgress {
  goalId: string;
  current: number;
  target: number;
  percent: number;
  trend: number[]; // last N data points
  status: GoalStatus;
}

export interface CreateGoalInput {
  name: string;
  description?: string;
  metric: GoalMetric;
  target: number;
  unit?: string;
  period: GoalPeriod;
  startDate: string;
  endDate: string;
}

// ── Query keys ───────────────────────────────────────────────────────────────

const KEYS = {
  all: ['goals'] as const,
  list: () => [...KEYS.all, 'list'] as const,
  detail: (id: string) => [...KEYS.all, 'detail', id] as const,
  progress: (id: string) => [...KEYS.all, 'progress', id] as const,
};

// ── Hooks ────────────────────────────────────────────────────────────────────

export function useGoals() {
  return useQuery<Goal[]>({
    queryKey: KEYS.list(),
    queryFn: () => api<Goal[]>('/api/goals'),
    staleTime: 60_000,
  });
}

export function useGoal(id: string) {
  return useQuery<Goal>({
    queryKey: KEYS.detail(id),
    queryFn: () => api<Goal>(`/api/goals/${id}`),
    staleTime: 60_000,
    enabled: Boolean(id),
  });
}

export function useGoalProgress(id: string) {
  return useQuery<GoalProgress>({
    queryKey: KEYS.progress(id),
    queryFn: () => api<GoalProgress>(`/api/goals/${id}/progress`),
    staleTime: 30_000,
    enabled: Boolean(id),
  });
}

export function useCreateGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateGoalInput) =>
      api<Goal>('/api/goals', { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.list() }),
  });
}

export function useUpdateGoal(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<CreateGoalInput>) =>
      api<Goal>(`/api/goals/${id}`, { method: 'PATCH', body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.list() });
      qc.invalidateQueries({ queryKey: KEYS.detail(id) });
      qc.invalidateQueries({ queryKey: KEYS.progress(id) });
    },
  });
}

export function useDeleteGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/api/goals/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.list() }),
  });
}
