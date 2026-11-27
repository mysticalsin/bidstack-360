import type { MigrationJob } from '@/hooks/useMigrations';

/**
 * Percent painted on the import bar.
 *
 * COMPLETE is 100, including when some rows failed, so the bar matches
 * "Import complete". A job that is still importing counts processed and
 * errored rows and stops at 99, so 100 means the job has finished.
 * The caller does not use this when totalRows is 0.
 */
export function csvImportProgressPct(
  job: Pick<MigrationJob, 'status' | 'totalRows' | 'processedRows' | 'errorRows'>,
): number {
  if (job.status === 'COMPLETE') return 100;
  if (job.status === 'RUNNING' || job.status === 'PENDING') {
    const rounded = Math.round(((job.processedRows + job.errorRows) / job.totalRows) * 100);
    if (!Number.isFinite(rounded)) return 0;
    return Math.min(99, Math.max(0, rounded));
  }
  const rounded = Math.round((job.processedRows / job.totalRows) * 100);
  if (!Number.isFinite(rounded)) return 0;
  return Math.min(100, Math.max(0, rounded));
}
