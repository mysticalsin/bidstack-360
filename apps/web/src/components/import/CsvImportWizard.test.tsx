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

function csvFile(text: string, name = 'contacts.csv'): File {
  return new File([text], name, { type: 'text/csv' });
}

async function uploadFile(text: string) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  const file = csvFile(text);
  Object.defineProperty(input, 'files', { value: [file] });
  fireEvent.change(input);
  // parseCsv runs through file.text() (async) before the wizard advances.
  await screen.findByText(/rows\. Match each column/);
}

describe('CsvImportWizard', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  function stubHooks() {
    hookMocks.useStartCsvImport.mockReturnValue({
      mutate: hookMocks.mutate,
      isPending: false,
      isError: false,
    });
    hookMocks.useCancelMigration.mockReturnValue({
      mutate: hookMocks.cancelMutate,
      isPending: false,
    });
    hookMocks.useRetryMigration.mockReturnValue({
      mutate: hookMocks.retryMutate,
      isPending: false,
    });
    hookMocks.usePreviewCsvImport.mockReturnValue({
      mutate: hookMocks.previewMutate,
      isPending: false,
      isError: false,
    });
    hookMocks.useParseSpreadsheet.mockReturnValue({
      mutateAsync: vi.fn(),
    });
    hookMocks.useMigrationJob.mockReturnValue({ data: undefined, isLoading: false });
  }

  it('auto-maps recognizable headers and blocks preview while a required target field is unmapped', async () => {
    // WHY: 'company' is the default entity and its Name field is required.
    // A CSV with an unrecognized header for the name column must leave that
    // required field unmapped, and the wizard must refuse to preview/write
    // rather than silently import rows with a blank required field.
    stubHooks();

    render(<CsvImportWizard />);
    await uploadFile('company_title,domain\nAcme,acme.com');

    expect(
      screen.getByText('Map a column to: Name.'),
    ).toBeTruthy();
    const previewButton = screen.getByRole('button', { name: /Preview \d+ rows/ });
    expect(previewButton).toHaveProperty('disabled', true);
  });

  it('requires preview confirmation before writing rows, using the chosen dedup strategy', async () => {
    // WHY: real revenue/account imports must not write on the first click.
    // Preview validates money/dates; Confirm is the only path that starts the job.
    stubHooks();

    render(<CsvImportWizard />);
    // 'name' is a header autoMap should recognize for company.name.
    await uploadFile('name,domain\nAcme,acme.com');

    expect(screen.queryByText(/Map a column to:/)).toBeNull();

    fireEvent.change(screen.getByLabelText('If a record already exists'), {
      target: { value: 'skip' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Preview \d+ rows/ }));

    expect(hookMocks.previewMutate).toHaveBeenCalledOnce();
    expect(hookMocks.mutate).not.toHaveBeenCalled();
    const [previewInput, previewOpts] = hookMocks.previewMutate.mock.calls[0]!;
    expect(previewInput).toMatchObject({ entityType: 'company' });
    previewOpts.onSuccess({
      entityType: 'company',
      rowCount: 1,
      validCount: 1,
      invalidCount: 0,
      issues: [],
      sample: [{ name: 'Acme' }],
    });

    await waitFor(() => expect(screen.getByText(/1 of 1 rows look valid/)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Confirm import' }));

    expect(hookMocks.mutate).toHaveBeenCalledOnce();
    const [input] = hookMocks.mutate.mock.calls[0]!;
    expect(input).toMatchObject({ source: 'CSV', entityType: 'company', dedupStrategy: 'skip' });
    expect(input.rows).toHaveLength(1);
  });

  it('rejects a file with more rows than the stated limit before ever calling the API', async () => {
    // WHY: MAX_ROWS is a client-side guard against pasting a spreadsheet
    // export meant for a bulk-data pipeline, not this UI — it must reject
    // BEFORE start.mutate is ever reachable, not rely on the server 400ing.
    stubHooks();

    render(<CsvImportWizard />);
    const rows = Array.from({ length: 10_001 }, (_, i) => `Row ${i}`).join('\n');
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = csvFile(`name\n${rows}`);
    Object.defineProperty(input, 'files', { value: [file] });
    fireEvent.change(input);

    await screen.findByText(/the limit is 10000/);
    expect(hookMocks.mutate).not.toHaveBeenCalled();
    // Still on the upload step — did not advance to mapping.
    expect(screen.queryByText(/Match each column/)).toBeNull();
  });

  it('renders progress from the polled migration job and exposes the error-report download once rows fail', async () => {
    stubHooks();
    hookMocks.useMigrationJob.mockReturnValue({
      data: {
        id: 'job-1',
        status: 'COMPLETE',
        totalRows: 10,
        processedRows: 10,
        errorRows: 2,
      },
      isLoading: false,
    });

    render(<CsvImportWizard />);
    await uploadFile('name,domain\nAcme,acme.com');
    fireEvent.click(screen.getByRole('button', { name: /Preview \d+ rows/ }));
    const [, previewOpts] = hookMocks.previewMutate.mock.calls[0]!;
    previewOpts.onSuccess({
      entityType: 'company',
      rowCount: 1,
      validCount: 1,
      invalidCount: 0,
      issues: [],
      sample: [],
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm import' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Confirm import' }));
    // The component's onSuccess callback sets jobId + advances to 'run' —
    // simulate that by invoking the mutate call's onSuccess directly.
    const [, opts] = hookMocks.mutate.mock.calls[0]!;
    opts.onSuccess({ id: 'job-1' });

    await waitFor(() => expect(screen.getByText('Import complete')).toBeTruthy());
    expect(screen.getByText('2 rows could not be imported.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Download error report (CSV)' }));
    expect(hookMocks.downloadMigrationErrors).toHaveBeenCalledWith('job-1');
  });

  async function reachRun(job: Record<string, unknown>) {
    hookMocks.useMigrationJob.mockReturnValue({ data: job, isLoading: false });
    render(<CsvImportWizard />);
    await uploadFile('name,domain\nAcme,acme.com');
    fireEvent.click(screen.getByRole('button', { name: /Preview \d+ rows/ }));
    const [, previewOpts] = hookMocks.previewMutate.mock.calls[0]!;
    previewOpts.onSuccess({
      entityType: 'company',
      rowCount: 1,
      validCount: 1,
      invalidCount: 0,
      issues: [],
      sample: [],
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm import' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Confirm import' }));
    const [, opts] = hookMocks.mutate.mock.calls[0]!;
    opts.onSuccess({ id: 'job-1' });
  }

  it('offers cancel while an import is running', async () => {
    // WHY: a job stuck on Importing… had no control. Cancel is the recovery
    // for a run the user no longer wants.
    stubHooks();
    await reachRun({
      id: 'job-1',
      status: 'RUNNING',
      totalRows: 1,
      processedRows: 0,
      errorRows: 0,
      errorSummary: [],
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel import' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Cancel import' }));
    expect(hookMocks.cancelMutate).toHaveBeenCalledWith('job-1');
  });

  it('offers retry only after a failure that imported nothing', async () => {
    // WHY: an enqueue failure must be visible and retryable. A failure that
    // already wrote rows must not offer a replay of the same file.
    stubHooks();
    await reachRun({
      id: 'job-1',
      status: 'FAILED',
      totalRows: 1,
      processedRows: 0,
      errorRows: 0,
      errorSummary: [{ row: 0, field: null, message: 'Failed to enqueue import chunks' }],
    });
    await waitFor(() => expect(screen.getByText('Failed to enqueue import chunks')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Retry import' }));
    expect(hookMocks.retryMutate).toHaveBeenCalledWith('job-1');
    expect(screen.queryByRole('button', { name: 'Cancel import' })).toBeNull();
  });
});
