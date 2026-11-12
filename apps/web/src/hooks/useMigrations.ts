import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';

import { api, downloadFromApi } from '@/lib/api';

export type MigrationStatus = 'PENDING' | 'RUNNING' | 'COMPLETE' | 'FAILED' | 'CANCELLED';

export interface MigrationJobError {
  row: number;
  field: string | null;
  message: string;
}

export interface MigrationJob {
  id: string;
  source: string;
  status: MigrationStatus;
  totalRows: number;
  processedRows: number;
  errorRows: number;
  startedAt: string | null;
  completedAt: string | null;
  errorSummary: MigrationJobError[];
  meta: Record<string, unknown>;
  undoableUntil: string | null;
  createdAt: string;
  updatedAt: string;
  /** Derived by GET. The worker is what persists FAILED. */
  stalled?: boolean;
}

export interface StartCsvImportInput {
  source: 'CSV' | 'SALESFORCE_CSV';
  entityType: string;
  rows: Record<string, string>[];
  mappings: Record<string, string | null>;
  dedupStrategy: 'skip' | 'update' | 'duplicate';
}

const TERMINAL: MigrationStatus[] = ['COMPLETE', 'FAILED', 'CANCELLED'];

export function useMigrations() {
  return useQuery({
    queryKey: ['migrations'],
    queryFn: ({ signal }) => api<{ items: MigrationJob[] }>('/api/migrations', { signal }),
    select: (data) => data.items,
  });
}

/** Poll a single job until it reaches a terminal state. */
export function useMigrationJob(id: string | null) {
  return useQuery({
    queryKey: ['migrations', id],
    queryFn: ({ signal }) => api<MigrationJob>(`/api/migrations/${id}`, { signal }),
    enabled: id !== null,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status && TERMINAL.includes(status) ? false : 1500;
    },
  });
}

export interface ImportPreviewResult {
  entityType: string;
  rowCount: number;
  validCount: number;
  invalidCount: number;
  issues: Array<{ row: number; field: string | null; message: string }>;
  sample: Record<string, string>[];
}

export function usePreviewCsvImport() {
  return useMutation({
    mutationFn: (input: {
      entityType: string;
      rows: Record<string, string>[];
      mappings: Record<string, string | null>;
    }) =>
      api<ImportPreviewResult>('/api/migrations/preview-csv', { method: 'POST', body: input }),
  });
}

export function useParseSpreadsheet() {
  return useMutation({
    mutationFn: (input: { filename: string; contentBase64: string }) =>
      api<{ headers: string[]; rows: Record<string, string>[] }>('/api/migrations/parse-spreadsheet', {
        method: 'POST',
        body: input,
      }),
  });
}

function newCsvStartKey(): string {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `import-csv-${random}`;
}

export function useStartCsvImport() {
  const qc = useQueryClient();
  // One key for the action that is still unsettled, including a retry of that
  // action. Cleared when the action settles so the next start is a new import.
  const keyRef = useRef<string | null>(null);
  return useMutation({
    mutationFn: (input: StartCsvImportInput) => {
      keyRef.current ??= newCsvStartKey();
      return api<MigrationJob>('/api/migrations/start-csv', {
        method: 'POST',
        body: input,
        headers: { 'Idempotency-Key': keyRef.current },
      });
    },
    // The app retries other mutations once on 500. A start creates a job, so a
    // retry would be a second request from the same click. The key above is
    // still stable if that retry is turned back on.
    retry: false,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['migrations'] }),
    onSettled: () => {
      keyRef.current = null;
    },
  });
}

export function useCancelMigration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<MigrationJob>(`/api/migrations/${id}/cancel`, { method: 'DELETE' }),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: ['migrations'] });
      qc.invalidateQueries({ queryKey: ['migrations', id] });
    },
  });
}

export function useRetryMigration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<MigrationJob>(`/api/migrations/${id}/retry`, { method: 'POST' }),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: ['migrations'] });
      qc.invalidateQueries({ queryKey: ['migrations', id] });
    },
    // A 409 stores the real reason on the job (the rows expired). The list the
    // wizard is showing is the one from before that write.
    onError: (_err, id) => {
      qc.invalidateQueries({ queryKey: ['migrations'] });
      qc.invalidateQueries({ queryKey: ['migrations', id] });
    },
  });
}

export function downloadMigrationErrors(id: string): Promise<void> {
  return downloadFromApi(`/api/migrations/${id}/errors.csv`, `import-errors-${id}.csv`);
}
