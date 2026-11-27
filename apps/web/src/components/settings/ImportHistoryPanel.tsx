import { useTranslation } from 'react-i18next';

import { useMigrations } from '@/hooks/useMigrations';

import { importHistoryPhase } from './import-history-read';

interface ImportHistoryJob {
  id: string;
  source: string;
  status: string;
  processedRows: number;
  totalRows: number;
  stalled?: boolean;
}

function isJob(item: unknown): item is ImportHistoryJob {
  if (!item || typeof item !== 'object') return false;
  const row = item as Partial<ImportHistoryJob>;
  return (
    typeof row.id === 'string' &&
    typeof row.source === 'string' &&
    typeof row.status === 'string' &&
    typeof row.processedRows === 'number' &&
    typeof row.totalRows === 'number'
  );
}

function jobsFrom(data: unknown): ImportHistoryJob[] {
  if (!Array.isArray(data)) return [];
  return data.filter(isJob);
}

export function ImportHistoryPanel() {
  const { t } = useTranslation('settings');
  const query = useMigrations();
  const phase = importHistoryPhase({
    data: query.data,
    isError: query.isError,
    status: query.status,
  });

  if (phase === 'unread') {
    return (
      <p className="text-sm text-[var(--fg-secondary)]">
        {t('dataImport.history.checking', 'Checking recent imports. The list has not arrived.')}
      </p>
    );
  }

  if (phase === 'failed') {
    return (
      <p className="text-sm text-[var(--danger)]" role="alert">
        {t(
          'dataImport.history.failed',
          'Could not load recent imports. The list has not arrived.',
        )}
      </p>
    );
  }

  const jobs = jobsFrom(query.data);
  if (jobs.length === 0) {
    return (
      <p className="text-sm text-[var(--fg-secondary)]">
        {t('dataImport.history.empty', 'No imports yet.')}
      </p>
    );
  }

  return (
    <ul
      aria-label={t('dataImport.history.listLabel', 'Recent imports')}
      className="flex flex-col gap-2"
    >
      {jobs.map((job) => (
        <li
          key={job.id}
          className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm text-[var(--fg-primary)]"
        >
          <span>{sourceLabel(job.source, t)}</span>
          <span>{statusLabel(job, t)}</span>
          <span className="font-mono text-xs text-[var(--fg-tertiary)] tabular-nums">
            {`${job.processedRows.toLocaleString()} / ${job.totalRows.toLocaleString()}`}
          </span>
        </li>
      ))}
    </ul>
  );
}

function sourceLabel(source: string, t: (key: string, fallback: string) => string): string {
  if (source === 'CSV') return t('dataImport.history.sourceCsv', 'CSV');
  if (source === 'SALESFORCE_CSV') {
    return t('dataImport.history.sourceSalesforce', 'Salesforce CSV');
  }
  if (source === 'HUBSPOT_OAUTH') return t('dataImport.history.sourceHubspot', 'HubSpot import');
  return t('dataImport.history.sourceOther', 'Import');
}

function statusLabel(
  job: ImportHistoryJob,
  t: (key: string, fallback: string) => string,
): string {
  if (job.stalled === true && (job.status === 'RUNNING' || job.status === 'PENDING')) {
    return t('dataImport.history.statusStalled', 'Import stalled');
  }
  if (job.status === 'COMPLETE') return t('dataImport.history.statusImported', 'Imported');
  if (job.status === 'FAILED') return t('dataImport.history.statusJobFailed', 'Import failed');
  if (job.status === 'CANCELLED') {
    return t('dataImport.history.statusCancelled', 'Import cancelled');
  }
  if (job.status === 'RUNNING') return t('dataImport.history.statusImporting', 'Importing');
  if (job.status === 'PENDING') return t('dataImport.history.statusWaiting', 'Waiting to import');
  return t('dataImport.history.statusUnknown', 'Import status unknown');
}
