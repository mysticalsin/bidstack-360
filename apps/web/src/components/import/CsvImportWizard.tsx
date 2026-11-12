import { useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  MIGRATION_CONFLICT,
  MIGRATION_ENQUEUE_FAILED,
  MIGRATION_ENQUEUE_STOPPED,
  MIGRATION_LEGACY_CONFLICT,
  MIGRATION_LEGACY_ENQUEUE_FAILED,
  MIGRATION_LEGACY_ROWS_EXPIRED,
  MIGRATION_ROWS_EXPIRED,
  MIGRATION_STALE_REASON,
  migrationFailureText,
  migrationRetryAllowed,
  migrationRetryOffered,
} from '@bidstack/shared';

import { Icon } from '@/components/ui/Icon';
import { parseCsv, type ParsedCsv } from '@/lib/csv-parse';
import {
  autoMap,
  IMPORT_ENTITIES,
  TARGET_FIELDS,
  type ImportEntity,
} from '@/lib/import-fields';
import {
  downloadMigrationErrors,
  useCancelMigration,
  useMigrationJob,
  useParseSpreadsheet,
  usePreviewCsvImport,
  useRetryMigration,
  useStartCsvImport,
  type ImportPreviewResult,
  type MigrationJob,
} from '@/hooks/useMigrations';

type Step = 'upload' | 'map' | 'preview' | 'run';
type Dedup = 'skip' | 'update' | 'duplicate';
const MAX_ROWS = 10_000;

const IMPORT_ERROR_KEYS: Record<string, readonly [string, string]> = {
  [MIGRATION_STALE_REASON]: [
    'csvImport.progress.reasonStalled',
    'The import stalled before any rows were saved.',
  ],
  [MIGRATION_ENQUEUE_FAILED]: [
    'csvImport.progress.reasonEnqueue',
    'The import did not start. Try again.',
  ],
  [MIGRATION_ENQUEUE_STOPPED]: [
    'csvImport.progress.reasonEnqueueStopped',
    'The import stopped before the remaining rows were saved.',
  ],
  [MIGRATION_ROWS_EXPIRED]: [
    'csvImport.progress.reasonRowsExpired',
    'Those rows expired. Upload the file again.',
  ],
  [MIGRATION_LEGACY_ENQUEUE_FAILED]: [
    'csvImport.progress.reasonEnqueue',
    'The import did not start. Try again.',
  ],
  [MIGRATION_LEGACY_ROWS_EXPIRED]: [
    'csvImport.progress.reasonRowsExpired',
    'Those rows expired. Upload the file again.',
  ],
  [MIGRATION_CONFLICT]: [
    'csvImport.progress.reasonConflict',
    'The import conflicted with another write.',
  ],
  [MIGRATION_LEGACY_CONFLICT]: [
    'csvImport.progress.reasonConflict',
    'The import conflicted with another write.',
  ],
};

function wizardReasonMessage(
  messages: readonly string[],
  processedRows: number,
  errorRows: number,
): string | undefined {
  const stopped = messages.find(
    (message) =>
      message === MIGRATION_ENQUEUE_STOPPED ||
      ((message === MIGRATION_ENQUEUE_FAILED || message === MIGRATION_LEGACY_ENQUEUE_FAILED) &&
        !migrationRetryAllowed(processedRows, errorRows)),
  );
  return stopped ?? messages[0];
}

function importErrorCopy(
  t: (key: string, fallback: string) => string,
  message: string | undefined,
  processedRows: number,
  errorRows: number,
): string | null {
  if (!message) return null;
  if (
    (message === MIGRATION_ENQUEUE_FAILED || message === MIGRATION_LEGACY_ENQUEUE_FAILED) &&
    !migrationRetryAllowed(processedRows, errorRows)
  ) {
    return t(
      'csvImport.progress.reasonEnqueueStopped',
      'The import stopped before the remaining rows were saved.',
    );
  }
  const known = IMPORT_ERROR_KEYS[message];
  if (known) return t(known[0], known[1]);
  const shown = migrationFailureText(message);
  if (shown === message) return message;
  return t('csvImport.progress.reasonUnknown', 'The import could not be completed.');
}

export function CsvImportWizard() {
  const { t } = useTranslation('crm');
  const entityId = useId();
  const dedupId = useId();
  const [step, setStep] = useState<Step>('upload');
  const [entity, setEntity] = useState<ImportEntity>('company');
  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const [fileName, setFileName] = useState('');
  const [parseError, setParseError] = useState<string | null>(null);
  const [mappings, setMappings] = useState<Record<string, string | null>>({});
  const [dedup, setDedup] = useState<Dedup>('update');
  const [jobId, setJobId] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const starting = useRef(false);

  const start = useStartCsvImport();
  const cancel = useCancelMigration();
  const retry = useRetryMigration();
  const preview = usePreviewCsvImport();
  const parseSheet = useParseSpreadsheet();
  const job = useMigrationJob(jobId);
  const fields = TARGET_FIELDS[entity];
  const [previewResult, setPreviewResult] = useState<ImportPreviewResult | null>(null);

  const requiredMissing = useMemo(() => {
    const mapped = new Set(Object.values(mappings).filter(Boolean) as string[]);
    return fields.filter((f) => f.required && !mapped.has(f.key)).map((f) => f.label);
  }, [fields, mappings]);

  async function onFile(file: File) {
    setParseError(null);
    try {
      const lower = file.name.toLowerCase();
      const result = lower.endsWith('.xlsx') || lower.endsWith('.xls')
        ? await parseSheet.mutateAsync({
            filename: file.name,
            contentBase64: await fileToBase64(file),
          })
        : parseCsv(await file.text());
      if (result.headers.length === 0 || result.rows.length === 0) {
        setParseError(t('csvImport.error.noDataRows', 'That file has no data rows.'));
        return;
      }
      if (result.rows.length > MAX_ROWS) {
        setParseError(
          t('csvImport.error.tooManyRows', 'That file has {{count}} rows — the limit is {{limit}}.', {
            count: result.rows.length,
            limit: MAX_ROWS,
          }),
        );
        return;
      }
      setParsed(result);
      setFileName(file.name);
      setMappings(autoMap(result.headers, TARGET_FIELDS[entity]));
      setPreviewResult(null);
      setStep('map');
    } catch {
      setParseError(
        t(
          'csvImport.error.unreadable',
          'Could not read that file. Use a UTF-8 CSV or an .xlsx spreadsheet.',
        ),
      );
    }
  }

  function onEntityChange(next: ImportEntity) {
    setEntity(next);
    if (parsed) setMappings(autoMap(parsed.headers, TARGET_FIELDS[next]));
  }

  function runPreview() {
    if (!parsed) return;
    preview.mutate(
      { entityType: entity, rows: parsed.rows, mappings },
      {
        onSuccess: (result) => {
          setPreviewResult(result);
          setStep('preview');
        },
      },
    );
  }

  function runImport() {
    if (!parsed || starting.current || start.isPending) return;
    starting.current = true;
    start.mutate(
      {
        source: 'CSV',
        entityType: entity,
        rows: parsed.rows,
        mappings,
        dedupStrategy: dedup,
      },
      {
        onSuccess: (created) => {
          setJobId(created.id);
          setStep('run');
        },
        onSettled: () => {
          starting.current = false;
        },
      },
    );
  }

  function reset() {
    setStep('upload');
    setParsed(null);
    setFileName('');
    setMappings({});
    setJobId(null);
    setParseError(null);
    setPreviewResult(null);
  }

  return (
    <div>
      <StepHeader step={step} />

      {step === 'upload' && (
        <div className="space-y-4">
          <div>
            <label
              htmlFor={entityId}
              className="mb-1 block text-sm font-medium text-[var(--fg-primary)]"
            >
              {t('csvImport.upload.entityLabel', 'What are you importing?')}
            </label>
            <select
              id={entityId}
              className="input max-w-xs"
              value={entity}
              onChange={(e) => onEntityChange(e.target.value as ImportEntity)}
            >
              {IMPORT_ENTITIES.map((e) => (
                <option key={e.value} value={e.value}>
                  {e.label}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            className="flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-[var(--border-strong)] py-10 text-[var(--fg-secondary)] transition-colors hover:border-[var(--brand-primary)] hover:text-[var(--fg-primary)]"
          >
            <Icon name="upload" size={24} ariaHidden />
            <span className="text-sm font-medium">
              {t('csvImport.upload.chooseFile', 'Choose a CSV or Excel file')}
            </span>
            <span className="text-xs text-[var(--fg-tertiary)]">
              {t('csvImport.upload.maxRows', 'Up to {{rows}} rows', {
                rows: MAX_ROWS.toLocaleString(),
              })}
            </span>
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
              e.target.value = '';
            }}
          />
          {parseError && <p className="text-sm text-[var(--danger)]">{parseError}</p>}
        </div>
      )}

      {step === 'map' && parsed && (
        <div className="space-y-4">
          <p className="text-sm text-[var(--fg-secondary)]">
            <span className="font-medium text-[var(--fg-primary)]">{fileName}</span> —{' '}
            {parsed.rows.length === 1
              ? t(
                  'csvImport.map.summaryOne',
                  '{{rows}} row. Match each column to a field, or leave it as Don’t import.',
                  { rows: parsed.rows.length.toLocaleString() },
                )
              : t(
                  'csvImport.map.summary',
                  '{{rows}} rows. Match each column to a field, or leave it as Don’t import.',
                  { rows: parsed.rows.length.toLocaleString() },
                )}
          </p>

          <div className="overflow-hidden rounded-lg border border-[var(--border-subtle)]">
            <table className="w-full text-sm">
              <thead className="bg-[var(--surface-sunken)] text-left text-[var(--fg-tertiary)]">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">
                    {t('csvImport.map.colCsvColumn', 'CSV column')}
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    {t('csvImport.map.colSample', 'Sample')}
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    {t('csvImport.map.colMapsTo', 'Maps to')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {parsed.headers.map((header) => (
                  <tr key={header} className="border-t border-[var(--border-subtle)]">
                    <td className="px-3 py-2 font-medium text-[var(--fg-primary)]">{header}</td>
                    <td className="max-w-[12rem] truncate px-3 py-2 text-[var(--fg-tertiary)]">
                      {parsed.rows[0]?.[header] || '—'}
                    </td>
                    <td className="px-3 py-2">
                      <select
                        className="input"
                        aria-label={t('csvImport.map.mapColumnAria', 'Map column {{header}}', {
                          header,
                        })}
                        value={mappings[header] ?? ''}
                        onChange={(e) =>
                          setMappings((m) => ({ ...m, [header]: e.target.value || null }))
                        }
                      >
                        <option value="">{t('csvImport.map.dontImport', 'Don’t import')}</option>
                        {fields.map((f) => (
                          <option key={f.key} value={f.key}>
                            {f.label}
                            {f.required ? ' *' : ''}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div>
            <label
              htmlFor={dedupId}
              className="mb-1 block text-sm font-medium text-[var(--fg-primary)]"
            >
              {t('csvImport.map.dedupLabel', 'If a record already exists')}
            </label>
            <select
              id={dedupId}
              className="input max-w-xs"
              value={dedup}
              onChange={(e) => setDedup(e.target.value as Dedup)}
            >
              <option value="update">
                {t('csvImport.map.dedupUpdate', 'Update it with the new values')}
              </option>
              <option value="skip">{t('csvImport.map.dedupSkip', 'Skip the row')}</option>
              <option value="duplicate">
                {t('csvImport.map.dedupDuplicate', 'Always create a new record')}
              </option>
            </select>
          </div>

          {requiredMissing.length > 0 && (
            <p className="text-sm text-[var(--danger)]">
              {t('csvImport.map.requiredMissing', 'Map a column to: {{fields}}.', {
                fields: requiredMissing.join(', '),
              })}
            </p>
          )}
          {start.isError && (
            <p className="text-sm text-[var(--danger)]">
              {t(
                'csvImport.map.startError',
                'Could not start the import. Check your mappings and try again.',
              )}
            </p>
          )}

          <div className="flex items-center gap-2">
            <button type="button" className="btn btn-ghost" onClick={reset}>
              {t('csvImport.map.startOver', 'Start over')}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={requiredMissing.length > 0 || preview.isPending}
              onClick={runPreview}
            >
              {preview.isPending
                ? t('csvImport.map.previewing', 'Validating…')
                : parsed.rows.length === 1
                  ? t('csvImport.map.previewRow', 'Preview {{rows}} row', {
                      rows: parsed.rows.length.toLocaleString(),
                    })
                  : t('csvImport.map.previewRows', 'Preview {{rows}} rows', {
                      rows: parsed.rows.length.toLocaleString(),
                    })}
            </button>
          </div>
        </div>
      )}

      {step === 'preview' && previewResult && (
        <div className="space-y-4">
          <p className="text-sm text-[var(--fg-secondary)]">
            {previewResult.rowCount === 1
              ? t(
                  'csvImport.preview.summaryOne',
                  '{{valid}} of {{total}} row looks valid. Confirm to write it. Nothing has been saved yet.',
                  { valid: previewResult.validCount, total: previewResult.rowCount },
                )
              : t(
                  'csvImport.preview.summary',
                  '{{valid}} of {{total}} rows look valid. Confirm to write them. Nothing has been saved yet.',
                  { valid: previewResult.validCount, total: previewResult.rowCount },
                )}
          </p>
          {previewResult.invalidCount > 0 ? (
            <div className="rounded-lg border border-[var(--danger)]/40 bg-[var(--danger)]/5 p-3 text-sm">
              <p className="font-medium text-[var(--danger)]">
                {previewResult.invalidCount === 1
                  ? t('csvImport.preview.issueTitle', '{{count}} row has problems', {
                      count: previewResult.invalidCount,
                    })
                  : t('csvImport.preview.issuesTitle', '{{count}} rows have problems', {
                      count: previewResult.invalidCount,
                    })}
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-[var(--fg-secondary)]">
                {previewResult.issues.slice(0, 8).map((issue) => (
                  <li key={`${issue.row}-${issue.field}-${issue.message}`}>
                    {t('csvImport.preview.issueRow', 'Row {{row}}', { row: issue.row })}
                    {issue.field ? ` · ${issue.field}` : ''}: {issue.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-sm text-[var(--fg-primary)]">
              {t('csvImport.preview.allValid', 'Money, dates, and required fields passed validation.')}
            </p>
          )}
          {start.isError && (
            <p className="text-sm text-[var(--danger)]">
              {t(
                'csvImport.map.startError',
                'Could not start the import. Check your mappings and try again.',
              )}
            </p>
          )}
          <div className="flex items-center gap-2">
            <button type="button" className="btn btn-ghost" onClick={() => setStep('map')}>
              {t('csvImport.preview.back', 'Back to mapping')}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={start.isPending}
              onClick={runImport}
            >
              {start.isPending
                ? t('csvImport.map.starting', 'Starting…')
                : t('csvImport.preview.confirm', 'Confirm import')}
            </button>
          </div>
        </div>
      )}

      {step === 'run' && (
        <ImportProgress
          job={job.data ?? null}
          isLoading={job.isLoading}
          onDone={reset}
          onCancel={() => {
            if (jobId) cancel.mutate(jobId);
          }}
          onRetry={() => {
            if (jobId) retry.mutate(jobId);
          }}
          cancelPending={cancel.isPending}
          retryPending={retry.isPending}
          actionFailed={cancel.isError || retry.isError}
        />
      )}
    </div>
  );
}

function StepHeader({ step }: { step: Step }) {
  const { t } = useTranslation('crm');
  const labels: { key: Step; label: string }[] = [
    { key: 'upload', label: t('csvImport.stepHeader.upload', 'Upload') },
    { key: 'map', label: t('csvImport.stepHeader.map', 'Map columns') },
    { key: 'preview', label: t('csvImport.stepHeader.preview', 'Preview') },
    { key: 'run', label: t('csvImport.stepHeader.run', 'Import') },
  ];
  const activeIndex = labels.findIndex((l) => l.key === step);
  return (
    <ol className="mb-5 flex items-center gap-2 text-xs">
      {labels.map((l, i) => (
        <li key={l.key} className="flex items-center gap-2">
          <span
            className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold ${
              i <= activeIndex
                ? 'bg-[var(--brand-primary)] text-[var(--fg-on-brand)]'
                : 'bg-[var(--surface-sunken)] text-[var(--fg-tertiary)]'
            }`}
          >
            {i + 1}
          </span>
          <span className={i <= activeIndex ? 'text-[var(--fg-primary)]' : 'text-[var(--fg-tertiary)]'}>
            {l.label}
          </span>
          {i < labels.length - 1 && <span className="text-[var(--fg-tertiary)]">→</span>}
        </li>
      ))}
    </ol>
  );
}

async function fileToBase64(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk) {
    binary += String.fromCharCode(...buf.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function importRowsExpired(messages: readonly string[]): boolean {
  return messages.some(
    (message) => message === MIGRATION_ROWS_EXPIRED || message === MIGRATION_LEGACY_ROWS_EXPIRED,
  );
}

function ImportProgress({
  job,
  isLoading,
  onDone,
  onCancel,
  onRetry,
  cancelPending,
  retryPending,
  actionFailed,
}: {
  job: MigrationJob | null;
  isLoading: boolean;
  onDone: () => void;
  onCancel: () => void;
  onRetry: () => void;
  cancelPending: boolean;
  retryPending: boolean;
  actionFailed: boolean;
}) {
  const { t } = useTranslation('crm');
  if (isLoading || !job) {
    return (
      <p className="text-sm text-[var(--fg-secondary)]">
        {t('csvImport.progress.starting', 'Starting import…')}
      </p>
    );
  }

  const done = job.status === 'COMPLETE' || job.status === 'FAILED' || job.status === 'CANCELLED';
  const failure = importErrorCopy(
    t,
    job.status === 'FAILED'
      ? wizardReasonMessage(
          (job.errorSummary ?? []).map((row) => row.message),
          job.processedRows,
          job.errorRows,
        )
      : undefined,
    job.processedRows,
    job.errorRows,
  );
  const pct =
    job.totalRows > 0 ? Math.round((job.processedRows / job.totalRows) * 100) : done ? 100 : 0;

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-1 flex items-center justify-between text-sm">
          <span className="font-medium text-[var(--fg-primary)]">
            {job.status === 'COMPLETE'
              ? t('csvImport.progress.statusComplete', 'Import complete')
              : job.stalled
                ? t('csvImport.progress.statusStalled', 'Import stalled')
                : job.status === 'RUNNING' || job.status === 'PENDING'
                  ? t('csvImport.progress.statusImporting', 'Importing…')
                  : job.status === 'CANCELLED'
                    ? t('csvImport.progress.statusCancelled', 'Import cancelled')
                    : t('csvImport.progress.statusFailed', 'Import failed')}
          </span>
          <span className="text-[var(--fg-tertiary)]">
            {job.processedRows.toLocaleString()} / {job.totalRows.toLocaleString()}
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--surface-sunken)]">
          <div
            className="h-full rounded-full bg-[var(--brand-primary)] transition-all"
            style={{ width: `${pct}%` }}
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
          />
        </div>
      </div>

      {actionFailed ? (
        <p className="text-sm text-[var(--danger)]" role="alert">
          {t('csvImport.progress.actionFailed', 'That did not work. Try again.')}
        </p>
      ) : null}

      {failure ? <p className="text-sm text-[var(--danger)]">{failure}</p> : null}

      {(job.status === 'RUNNING' || job.status === 'PENDING') && (
        <button
          type="button"
          className="btn btn-secondary"
          disabled={cancelPending}
          onClick={onCancel}
        >
          {cancelPending
            ? t('csvImport.progress.cancelling', 'Cancelling…')
            : t('csvImport.progress.cancel', 'Cancel import')}
        </button>
      )}

      {job.status === 'FAILED' &&
      migrationRetryOffered(
        job.processedRows,
        job.errorRows,
        (job.errorSummary ?? []).map((row) => row.message),
      ) ? (
        <button type="button" className="btn btn-primary" disabled={retryPending} onClick={onRetry}>
          {retryPending
            ? t('csvImport.progress.retrying', 'Retrying…')
            : t('csvImport.progress.retry', 'Retry import')}
        </button>
      ) : null}

      {(job.errorRows > 0 ||
        (job.status === 'FAILED' &&
          (job.errorSummary?.length ?? 0) > 0 &&
          !importRowsExpired((job.errorSummary ?? []).map((row) => row.message)))) && (
        <div className="rounded-md bg-[var(--surface-sunken)] p-3 text-sm">
          {job.errorRows > 0 ? (
            <p className="text-[var(--fg-primary)]">
              {job.errorRows === 1
                ? t(
                    'csvImport.progress.errorRow',
                    '{{formattedCount}} row could not be imported.',
                    {
                      count: job.errorRows,
                      formattedCount: job.errorRows.toLocaleString(),
                    },
                  )
                : t(
                    'csvImport.progress.errorRows',
                    '{{formattedCount}} rows could not be imported.',
                    {
                      count: job.errorRows,
                      formattedCount: job.errorRows.toLocaleString(),
                    },
                  )}
            </p>
          ) : null}
          <button
            type="button"
            className="mt-1 text-[var(--brand-primary)] hover:underline"
            onClick={() => downloadMigrationErrors(job.id)}
          >
            {t('csvImport.progress.downloadErrors', 'Download error report (CSV)')}
          </button>
        </div>
      )}

      {done && (
        <button type="button" className="btn btn-secondary" onClick={onDone}>
          {t('csvImport.progress.importAnother', 'Import another file')}
        </button>
      )}
    </div>
  );
}
