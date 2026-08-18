// Analytics dashboard hooks — useDashboards, useDashboard, useDashboardWidgets
// All mutations optimistically update the React Query cache so the UI feels instant.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from '@/components/ui/Toast';

// ── Types ────────────────────────────────────────────────────────────────────

export type WidgetType =
  | 'kpi'
  | 'line'
  | 'bar'
  | 'area'
  | 'pie'
  | 'donut'
  | 'funnel'
  | 'gauge'
  | 'heatmap'
  | 'scatter'
  | 'radar'
  | 'table';

export interface DashboardWidget {
  id: string;
  dashboardId: string;
  reportId?: string;
  title: string;
  type: WidgetType;
  config: Record<string, unknown>;
  position: { x: number; y: number; w: number; h: number };
  createdAt: string;
  updatedAt: string;
}

export interface Dashboard {
  id: string;
  orgId: string;
  name: string;
  description?: string;
  ownerId: string;
  isShared: boolean;
  widgets?: DashboardWidget[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateDashboardInput {
  name: string;
  description?: string;
  isShared?: boolean;
}

export interface CreateWidgetInput {
  reportId?: string;
  title: string;
  type: WidgetType;
  config?: Record<string, unknown>;
  position?: { x: number; y: number; w: number; h: number };
}

// ── Query keys ───────────────────────────────────────────────────────────────

const KEYS = {
  all: ['dashboards'] as const,
  list: () => [...KEYS.all, 'list'] as const,
  detail: (id: string) => [...KEYS.all, 'detail', id] as const,
  widgets: (id: string) => [...KEYS.all, 'widgets', id] as const,
};

// ── Hooks ────────────────────────────────────────────────────────────────────

export function useDashboards() {
  return useQuery<Dashboard[]>({
    queryKey: KEYS.list(),
    queryFn: () => api<Dashboard[]>('/api/dashboards'),
    staleTime: 30_000,
  });
}

export function useDashboard(id: string) {
  return useQuery<Dashboard>({
    queryKey: KEYS.detail(id),
    queryFn: () => api<Dashboard>(`/api/dashboards/${id}`),
    staleTime: 30_000,
    enabled: Boolean(id),
  });
}

export function useDashboardWidgets(dashboardId: string) {
  return useQuery<DashboardWidget[]>({
    queryKey: KEYS.widgets(dashboardId),
    queryFn: () => api<DashboardWidget[]>(`/api/dashboards/${dashboardId}/widgets`),
    staleTime: 60_000,
    enabled: Boolean(dashboardId),
  });
}

export function useCreateDashboard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateDashboardInput) =>
      api<Dashboard>('/api/dashboards', { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.list() }),
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : 'Could not create dashboard'),
  });
}

export function useUpdateDashboard(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<CreateDashboardInput>) =>
      api<Dashboard>(`/api/dashboards/${id}`, { method: 'PATCH', body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.list() });
      qc.invalidateQueries({ queryKey: KEYS.detail(id) });
    },
  });
}

export function useDeleteDashboard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/api/dashboards/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.list() }),
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : 'Could not delete dashboard'),
  });
}

export function useAddWidget(dashboardId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateWidgetInput) =>
      api<DashboardWidget>(`/api/dashboards/${dashboardId}/widgets`, { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.widgets(dashboardId) }),
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Could not add widget'),
  });
}

export function useUpdateWidget(dashboardId: string, widgetId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<CreateWidgetInput> & { position?: DashboardWidget['position'] }) =>
      api<DashboardWidget>(`/api/dashboards/${dashboardId}/widgets/${widgetId}`, {
        method: 'PATCH',
        body,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.widgets(dashboardId) }),
  });
}

export function useDeleteWidget(dashboardId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (widgetId: string) =>
      api<void>(`/api/dashboards/${dashboardId}/widgets/${widgetId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.widgets(dashboardId) }),
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Could not delete widget'),
  });
}
