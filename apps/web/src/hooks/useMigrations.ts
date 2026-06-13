import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

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

export function useStartCsvImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: StartCsvImportInput) =>
      api<MigrationJob>('/api/migrations/start-csv', { method: 'POST', body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['migrations'] }),
  });
}

export function downloadMigrationErrors(id: string): Promise<void> {
  return downloadFromApi(`/api/migrations/${id}/errors.csv`, `import-errors-${id}.csv`);
}
