import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, vars?: Record<string, unknown>) => {
      if (!vars) return fallback;
      return Object.entries(vars).reduce(
        (out, [k, v]) => out.replace(`{{${k}}}`, String(v)),
        fallback,
      );
    },
  }),
}));

const hookMocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  cancelMutate: vi.fn(),
  retryMutate: vi.fn(),
  previewMutate: vi.fn(),
  useStartCsvImport: vi.fn(),
  useCancelMigration: vi.fn(),
  useRetryMigration: vi.fn(),
  usePreviewCsvImport: vi.fn(),
  useParseSpreadsheet: vi.fn(),
  useMigrationJob: vi.fn(),
  downloadMigrationErrors: vi.fn(),
}));

vi.mock('@/hooks/useMigrations', () => ({
  useStartCsvImport: hookMocks.useStartCsvImport,
  useCancelMigration: hookMocks.useCancelMigration,
  useRetryMigration: hookMocks.useRetryMigration,
  usePreviewCsvImport: hookMocks.usePreviewCsvImport,
  useParseSpreadsheet: hookMocks.useParseSpreadsheet,
  useMigrationJob: hookMocks.useMigrationJob,
  downloadMigrationErrors: hookMocks.downloadMigrationErrors,
}));

import { CsvImportWizard } from './CsvImportWizard';

const UNREAD = 'The import status has not arrived.';
const READ_FAILED = 'Could not load the import. It has not arrived.';

function csvFile(text: string): File {
  return new File([text], 'companies.csv', { type: 'text/csv' });
}

function stubActions() {
  hookMocks.useStartCsvImport.mockReturnValue({
    mutate: hookMocks.mutate,
    isPending: false,
    isError: false,
  });
  hookMocks.useCancelMigration.mockReturnValue({
    mutate: hookMocks.cancelMutate,
    isPending: false,
    isError: false,
  });
  hookMocks.useRetryMigration.mockReturnValue({
    mutate: hookMocks.retryMutate,
    isPending: false,
    isError: false,
  });
  hookMocks.usePreviewCsvImport.mockReturnValue({
    mutate: hookMocks.previewMutate,
    isPending: false,
    isError: false,
  });
  hookMocks.useParseSpreadsheet.mockReturnValue({
    mutateAsync: vi.fn(),
  });
}

async function reachRunStep() {
  render(<CsvImportWizard />);
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  Object.defineProperty(input, 'files', { value: [csvFile('name,domain\nAcme,acme.com')] });
  fireEvent.change(input);
  await screen.findByText(/rows?\. Match each column/);
  fireEvent.click(screen.getByRole('button', { name: /Preview \d+ rows?/ }));
  const [, previewOpts] = hookMocks.previewMutate.mock.calls[0]!;
  previewOpts.onSuccess({
    entityType: 'company',
    rowCount: 1,
    validCount: 1,
    invalidCount: 0,
    issues: [],
    sample: [{ name: 'Acme' }],
  });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm import' })).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: 'Confirm import' }));
  const [, opts] = hookMocks.mutate.mock.calls[0]!;
  opts.onSuccess({ id: 'job-unread' });
  await waitFor(() => {
    expect(screen.queryByText(/Nothing has been saved yet/)).toBeNull();
  });
}

describe('CsvImportWizard import status read', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('does not call an in-flight import status read a start or a completion', async () => {
    // WHY: the job row is created before its status payload arrives. "Starting
    // import" claims the import is underway. The wizard has not read the job.
    stubActions();
    hookMocks.useMigrationJob.mockReturnValue({
      data: undefined,
      isLoading: true,
      isPending: true,
      isFetching: true,
      isError: false,
    });

    await reachRunStep();

    expect(screen.getByRole('status').textContent).toBe(UNREAD);
    expect(screen.queryByText('Starting import…')).toBeNull();
    expect(screen.queryByText('Import complete')).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('does not call a paused import status read a start when no payload has arrived', async () => {
    // WHY: a paused query is not loading and has no data. Treating a missing
    // job as "Starting import" tells the operator the import is in progress.
    stubActions();
    hookMocks.useMigrationJob.mockReturnValue({
      data: undefined,
      isLoading: false,
      isPending: true,
      isFetching: false,
      isError: false,
    });

    await reachRunStep();

    expect(screen.getByRole('status').textContent).toBe(UNREAD);
    expect(screen.queryByText('Starting import…')).toBeNull();
    expect(screen.queryByText('Import complete')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Import another file' })).toBeNull();
  });

  it('does not call a failed import status read a start, a completion, or a failed job', async () => {
    // WHY: a failed GET is not a failed import. "Import failed" means the job
    // itself ended in FAILED. The operator must see that the status never arrived.
    stubActions();
    hookMocks.useMigrationJob.mockReturnValue({
      data: undefined,
      isLoading: false,
      isPending: false,
      isFetching: false,
      isError: true,
    });

    await reachRunStep();

    expect(screen.getByRole('alert').textContent).toBe(READ_FAILED);
    expect(screen.queryByText('Starting import…')).toBeNull();
    expect(screen.queryByText('Import complete')).toBeNull();
    expect(screen.queryByText('Import failed')).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('does not keep a stale complete job on screen after the status read fails', async () => {
    // WHY: a later poll can fail while the last payload still says COMPLETE.
    // Showing that stale completion says the import is done when this read failed.
    stubActions();
    hookMocks.useMigrationJob.mockReturnValue({
      data: {
        id: 'job-stale',
        status: 'COMPLETE',
        totalRows: 4,
        processedRows: 4,
        errorRows: 0,
      },
      isLoading: false,
      isError: true,
    });

    await reachRunStep();

    expect(screen.getByRole('alert').textContent).toBe(READ_FAILED);
    expect(screen.queryByText('Import complete')).toBeNull();
    expect(screen.queryByText('4 / 4')).toBeNull();
  });

  it('still says import complete once a settled complete payload has arrived', async () => {
    stubActions();
    hookMocks.useMigrationJob.mockReturnValue({
      data: {
        id: 'job-done',
        status: 'COMPLETE',
        totalRows: 3,
        processedRows: 3,
        errorRows: 0,
      },
      isLoading: false,
      isError: false,
    });

    await reachRunStep();

    expect(screen.getByText('Import complete')).toBeTruthy();
    expect(screen.getByText('3 / 3')).toBeTruthy();
    expect(screen.queryByText(UNREAD)).toBeNull();
    expect(screen.queryByText(READ_FAILED)).toBeNull();
  });

  it('still says importing once a settled running payload has arrived', async () => {
    stubActions();
    hookMocks.useMigrationJob.mockReturnValue({
      data: {
        id: 'job-run',
        status: 'RUNNING',
        totalRows: 8,
        processedRows: 2,
        errorRows: 0,
      },
      isLoading: false,
      isError: false,
    });

    await reachRunStep();

    expect(screen.getByText('Importing…')).toBeTruthy();
    expect(screen.getByText('2 / 8')).toBeTruthy();
    expect(screen.getByRole('progressbar')).toBeTruthy();
    expect(screen.queryByText(UNREAD)).toBeNull();
  });

  it('still says the job failed once a settled failed payload has arrived', async () => {
    // WHY: a job that reached FAILED is a finished import, not a missing read.
    stubActions();
    hookMocks.useMigrationJob.mockReturnValue({
      data: {
        id: 'job-failed',
        status: 'FAILED',
        totalRows: 5,
        processedRows: 1,
        errorRows: 1,
        errorSummary: [{ row: 2, field: 'name', message: 'company.name is required' }],
      },
      isLoading: false,
      isError: false,
    });

    await reachRunStep();

    expect(screen.getByText('Import failed')).toBeTruthy();
    expect(screen.queryByText(READ_FAILED)).toBeNull();
    expect(screen.queryByText(UNREAD)).toBeNull();
  });
});
