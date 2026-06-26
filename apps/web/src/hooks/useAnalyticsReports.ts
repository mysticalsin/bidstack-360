// Analytics report hooks — list, single, run, export, schedule
// Named useAnalyticsReports to avoid collision with the existing useReports.ts
// which serves the legacy /reports/pipeline etc. endpoints.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { csvCell } from '@/lib/csv';

// ── Types ────────────────────────────────────────────────────────────────────

export type ReportEntityType =
  | 'lead'
  | 'opportunity'
  | 'contact'
  | 'company'
  | 'task'
  | 'activity'
  | 'goal';

export type AggregateFunction = 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX' | 'COUNT_DISTINCT';

export type FilterOperator =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'contains'
  | 'startsWith'
  | 'in'
  | 'notIn'
  | 'isNull'
  | 'isNotNull';

export type TimeBucket = 'DAY' | 'WEEK' | 'MONTH' | 'QUARTER' | 'YEAR';

export type ChartType =
  | 'table'
  | 'line'
  | 'bar'
  | 'area'
  | 'pie'
  | 'donut'
  | 'funnel'
  | 'gauge'
  | 'heatmap'
  | 'scatter'
  | 'radar';

export interface FilterCondition {
  // WHY id: AnimatePresence needs a stable key that survives array mutations
  // (insertions, deletions, reorders). Without it, React maps key={index} to
  // the wrong element after deletion, corrupting animation state and local
  // component state (e.g. the ConditionRow's fieldDef useState).
  id?: string;
  field: string;
  operator: FilterOperator;
  value?: unknown;
}

export type FilterLogic = 'AND' | 'OR';

export interface FilterGroup {
  // WHY id: same stable-key reason as FilterCondition — groups can also be
  // deleted from their parent's conditions array.
  id?: string;
  logic: FilterLogic;
  conditions: (FilterCondition | FilterGroup)[];
}

export interface Aggregate {
  fn: AggregateFunction;
  field: string;
  alias?: string;
}

export interface GroupBy {
  field: string;
  timeBucket?: TimeBucket;
}

export interface SortField {
  field: string;
  dir: 'asc' | 'desc';
}

export interface ReportQuery {
  entity: ReportEntityType;
  filters?: FilterGroup;
  aggregates?: Aggregate[];
  groupBy?: GroupBy[];
  sort?: SortField[];
  limit?: number;
}

export interface Report {
  id: string;
  orgId: string;
  name: string;
  description?: string;
  ownerId: string;
  query: ReportQuery;
  chartType: ChartType;
  schedule?: string;
  lastRunAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type ReportRunStatus = 'pending' | 'running' | 'done' | 'error';

export interface ReportRun {
  id: string;
  reportId: string;
  status: ReportRunStatus;
  startedAt?: string;
  finishedAt?: string;
  rowCount?: number;
  result?: Array<Record<string, unknown>>;
  error?: string;
  createdAt: string;
}

export interface CreateReportInput {
  name: string;
  description?: string;
  query: ReportQuery;
  chartType?: ChartType;
  schedule?: string;
}

// ── Query keys ───────────────────────────────────────────────────────────────

const KEYS = {
  all: ['analytics-reports'] as const,
  list: () => [...KEYS.all, 'list'] as const,
  detail: (id: string) => [...KEYS.all, 'detail', id] as const,
  runs: (id: string) => [...KEYS.all, 'runs', id] as const,
  run: (id: string, runId: string) => [...KEYS.all, 'run', id, runId] as const,
};

// ── Hooks ────────────────────────────────────────────────────────────────────

export function useAnalyticsReportsList() {
  return useQuery<Report[]>({
    queryKey: KEYS.list(),
    queryFn: () => api<Report[]>('/api/reports'),
    staleTime: 30_000,
  });
}

export function useAnalyticsReport(id: string) {
  return useQuery<Report>({
    queryKey: KEYS.detail(id),
    queryFn: () => api<Report>(`/api/reports/${id}`),
    staleTime: 30_000,
    enabled: Boolean(id),
  });
}

export function useReportRuns(reportId: string) {
  return useQuery<ReportRun[]>({
    queryKey: KEYS.runs(reportId),
    queryFn: () => api<ReportRun[]>(`/api/reports/${reportId}/runs`),
    staleTime: 60_000,
    enabled: Boolean(reportId),
  });
}

export function useReportRun(reportId: string, runId: string) {
  return useQuery<ReportRun>({
    queryKey: KEYS.run(reportId, runId),
    queryFn: () => api<ReportRun>(`/api/reports/${reportId}/runs/${runId}`),
    staleTime: 5_000,
    enabled: Boolean(reportId) && Boolean(runId),
    // Poll while running
    refetchInterval: (q) => {
      const run = q.state.data;
      if (run && (run.status === 'pending' || run.status === 'running')) return 2_000;
      return false;
    },
  });
}

export function useCreateReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateReportInput) => api<Report>('/api/reports', { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.list() }),
  });
}

export function useUpdateReport(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<CreateReportInput>) =>
      api<Report>(`/api/reports/${id}`, { method: 'PATCH', body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.list() });
      qc.invalidateQueries({ queryKey: KEYS.detail(id) });
    },
  });
}

export function useDuplicateReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<Report>(`/api/reports/${id}/duplicate`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.list() }),
  });
}

export function useDeleteReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/api/reports/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.list() }),
  });
}

export function useRunReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, query }: { id: string; query?: ReportQuery }) =>
      api<ReportRun>(`/api/reports/${id}/run`, { method: 'POST', body: query ? { query } : {} }),
    onSuccess: (run) => {
      qc.invalidateQueries({ queryKey: KEYS.runs(run.reportId) });
    },
  });
}

/** Preview-run: POSTs an unsaved query and returns inline results. */
export function usePreviewReport() {
  return useMutation({
    mutationFn: (query: ReportQuery) =>
      api<ReportRun>('/api/reports/run', { method: 'POST', body: { query } }),
  });
}

export function useExportReport() {
  return useMutation({
    mutationFn: async ({
      reportId,
      runId,
      format,
    }: {
      reportId: string;
      runId: string;
      format: 'csv' | 'json';
    }) => {
      const result = await api<ReportRun>(`/api/reports/${reportId}/runs/${runId}`);
      const rows = result.result ?? [];
      if (format === 'json') {
        const blob = new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' });
        return { blob, filename: `report-${runId}.json` };
      }
      // CSV
      if (rows.length === 0) return { blob: new Blob(['']), filename: `report-${runId}.csv` };
      const headers = Object.keys(rows[0]!);
      const lines = [
        headers.map((h) => csvCell(h)).join(','),
        ...rows.map((row) =>
          headers
            .map((h) => {
              // csvCell neutralizes formula-injection (=,+,-,@,TAB,CR) first;
              // then escape commas/quotes/newlines per RFC 4180.
              const v = csvCell(String(row[h] ?? ''));
              return v.includes(',') || v.includes('"') || v.includes('\n')
                ? `"${v.replace(/"/g, '""')}"`
                : v;
            })
            .join(','),
        ),
      ];
      const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
      return { blob, filename: `report-${runId}.csv` };
    },
    onSuccess: ({ blob, filename }) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    },
  });
}
