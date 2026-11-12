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
  await screen.findByText(/rows?\. Match each column/);
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
    const previewButton = screen.getByRole('button', { name: /Preview \d+ rows?/ });
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
    fireEvent.click(screen.getByRole('button', { name: /Preview \d+ rows?/ }));

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

    await waitFor(() => expect(screen.getByText(/1 of 1 row looks valid/)).toBeTruthy());
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

  it('uses the singular when the file has one row', async () => {
    // WHY: a one-row file was labelled "1 rows" on the map step and the preview button.
    stubHooks();
    render(<CsvImportWizard />);
    await uploadFile('name,domain\nAcme,acme.com');
    expect(screen.getByText(/1 row\. Match each column/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Preview 1 row' })).toBeTruthy();
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
    fireEvent.click(screen.getByRole('button', { name: /Preview \d+ rows?/ }));
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
    fireEvent.click(screen.getByRole('button', { name: /Preview \d+ rows?/ }));
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

  it('uses the singular when one row could not be imported', async () => {
    // WHY: the progress line always said "rows", so a single failure read "1 rows".
    stubHooks();
    await reachRun({
      id: 'job-1',
      status: 'FAILED',
      totalRows: 1,
      processedRows: 0,
      errorRows: 1,
      errorSummary: [{ row: 2, field: 'name', message: 'company.name is required' }],
    });
    await waitFor(() => expect(screen.getByText('1 row could not be imported.')).toBeTruthy());
    expect(screen.queryByText('1 rows could not be imported.')).toBeNull();
  });

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
      errorSummary: [{ row: 0, field: null, message: 'enqueue_failed' }],
    });
    await waitFor(() => expect(screen.getByText('The import did not start. Try again.')).toBeTruthy());
    expect(screen.queryByText('enqueue_failed')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry import' }));
    expect(hookMocks.retryMutate).toHaveBeenCalledWith('job-1');
    expect(screen.queryByRole('button', { name: 'Cancel import' })).toBeNull();
  });

  it('shows an error when cancel or retry fails, without the raw server text', async () => {
    // WHY: a failed cancel or retry must leave the wizard in an error state.
    // The server's English is not the copy the user reads.
    stubHooks();
    hookMocks.useCancelMigration.mockReturnValue({
      mutate: hookMocks.cancelMutate,
      isPending: false,
      isError: true,
      error: new Error('Migration job is no longer running'),
    });
    await reachRun({
      id: 'job-1',
      status: 'RUNNING',
      totalRows: 1,
      processedRows: 0,
      errorRows: 0,
      errorSummary: [],
    });
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toBe('That did not work. Try again.');
    expect(screen.queryByText('Migration job is no longer running')).toBeNull();
  });

  it('keeps a stored English enqueue failure specific', async () => {
    // WHY: jobs written before the codes still need the sentence they had,
    // not the generic failure.
    stubHooks();
    await reachRun({
      id: 'job-1',
      status: 'FAILED',
      totalRows: 1,
      processedRows: 0,
      errorRows: 0,
      errorSummary: [{ row: 0, field: null, message: 'Failed to enqueue import chunks' }],
    });
    await waitFor(() => expect(screen.getByText('The import did not start. Try again.')).toBeTruthy());
    expect(screen.queryByText('The import could not be completed.')).toBeNull();
  });

  it('keeps a stored English expiry specific and offers no retry', async () => {
    // WHY: an old job stored the English sentence. The wizard still says to
    // upload the file, and does not offer a retry that would fail.
    stubHooks();
    await reachRun({
      id: 'job-1',
      status: 'FAILED',
      totalRows: 1,
      processedRows: 0,
      errorRows: 0,
      errorSummary: [
        { row: 0, field: null, message: 'Import rows expired. Upload the file again.' },
      ],
    });
    await waitFor(() =>
      expect(screen.getByText('Those rows expired. Upload the file again.')).toBeTruthy(),
    );
    expect(screen.queryByText('The import could not be completed.')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry import' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Download error report (CSV)' })).toBeNull();
  });

  it('does not offer retry when the rows are gone', async () => {
    // WHY: retrying an expired upload fails again. The sentence says to upload,
    // and there is no Retry button.
    stubHooks();
    await reachRun({
      id: 'job-1',
      status: 'FAILED',
      totalRows: 1,
      processedRows: 0,
      errorRows: 0,
      errorSummary: [{ row: 0, field: null, message: 'rows_expired' }],
    });
    await waitFor(() =>
      expect(screen.getByText('Those rows expired. Upload the file again.')).toBeTruthy(),
    );
    expect(screen.queryByRole('button', { name: 'Retry import' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Download error report (CSV)' })).toBeNull();
    expect(screen.queryByText('Try again.')).toBeNull();
  });

  it('does not tell a partial import to try again', async () => {
    // WHY: a later page that could not be queued already saved rows. Retry is
    // not offered, so the sentence must not ask for it.
    stubHooks();
    await reachRun({
      id: 'job-1',
      status: 'FAILED',
      totalRows: 4,
      processedRows: 2,
      errorRows: 0,
      errorSummary: [{ row: 0, field: null, message: 'enqueue_failed' }],
    });
    await waitFor(() =>
      expect(screen.getByText('The import stopped before the remaining rows were saved.')).toBeTruthy(),
    );
    expect(screen.queryByText('The import did not start. Try again.')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry import' })).toBeNull();
  });

  it('says the import stopped when a row error is stored ahead of that code', async () => {
    // WHY: the row sentence is for the error file. The reason line is the job
    // stopping, which is the code stored after the rows that were already saved.
    stubHooks();
    await reachRun({
      id: 'job-1',
      status: 'FAILED',
      totalRows: 4,
      processedRows: 2,
      errorRows: 1,
      errorSummary: [
        { row: 5, field: 'company.name', message: 'company.name is required' },
        { row: 0, field: null, message: 'enqueue_stopped' },
      ],
    });
    await waitFor(() =>
      expect(screen.getByText('The import stopped before the remaining rows were saved.')).toBeTruthy(),
    );
    expect(screen.queryByText('company.name is required')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry import' })).toBeNull();
  });

  it('shows an unsupported-entity failure when no rows were saved', async () => {
    // WHY: the worker stores the sentence on the job and leaves both counters
    // at zero. The generic failure and a hidden error file would leave the
    // operator with nothing to read.
    stubHooks();
    const message = 'Entity type "tasks" is not supported by the import worker yet';
    await reachRun({
      id: 'job-1',
      status: 'FAILED',
      totalRows: 0,
      processedRows: 0,
      errorRows: 0,
      errorSummary: [{ row: 0, field: null, message }],
    });
    await waitFor(() => expect(screen.getByText(message)).toBeTruthy());
    expect(screen.queryByText('The import could not be completed.')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry import' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Download error report (CSV)' })).toBeTruthy();
  });

  it('maps pathless driver text to the existing sentence', async () => {
    // WHY: a driver error can name a host, a pool, or a constraint without a
    // file path. The operator still gets the sentence the wizard already has.
    stubHooks();
    await reachRun({
      id: 'job-1',
      status: 'FAILED',
      totalRows: 1,
      processedRows: 0,
      errorRows: 1,
      errorSummary: [
        { row: 2, field: null, message: "Can't reach database server at `host:5432`" },
      ],
    });
    await waitFor(() =>
      expect(screen.getByText('The import could not be completed.')).toBeTruthy(),
    );
    expect(screen.queryByText(/host:5432/)).toBeNull();
    expect(screen.queryByText(/Connection is closed/)).toBeNull();
  });

  it('does not offer retry when a chunk failed before any row was saved', async () => {
    // WHY: replaying a permanent chunk failure returns success and changes
    // nothing. The button must not be there, and the driver sentence must not show.
    stubHooks();
    await reachRun({
      id: 'job-1',
      status: 'FAILED',
      totalRows: 1,
      processedRows: 0,
      errorRows: 0,
      errorSummary: [{ row: 0, field: null, message: 'chunk failed permanently: Connection is closed.' }],
    });
    await waitFor(() =>
      expect(screen.getByText('The import could not be completed.')).toBeTruthy(),
    );
    expect(screen.queryByText(/Connection is closed/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry import' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Download error report (CSV)' })).toBeTruthy();
  });

  it('shows a stored failure sentence that has no code', async () => {
    // WHY: a row error is already the sentence the operator needs. Replacing
    // it with the generic failure hides which row was rejected.
    stubHooks();
    await reachRun({
      id: 'job-1',
      status: 'FAILED',
      totalRows: 1,
      processedRows: 1,
      errorRows: 1,
      errorSummary: [{ row: 2, field: 'company.name', message: 'company.name is required' }],
    });
    await waitFor(() => expect(screen.getByText('company.name is required')).toBeTruthy());
    expect(screen.queryByText('The import could not be completed.')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry import' })).toBeNull();
  });

  it('maps a stored driver failure to the existing sentence', async () => {
    // WHY: the worker prefixes the thrown driver text. That text can contain
    // a path, a process id, or a database code, and the wizard already has a
    // sentence for a failure it cannot explain.
    stubHooks();
    const message =
      'chunk failed permanently: PrismaClientKnownRequestError Invalid `ctx.tx.company.create()` Unique constraint failed at /apps/worker/src/queues/migration.ts:236:40 Process 4242 40P01';
    await reachRun({
      id: 'job-1',
      status: 'FAILED',
      totalRows: 1,
      processedRows: 0,
      errorRows: 1,
      errorSummary: [{ row: 0, field: null, message }],
    });
    await waitFor(() =>
      expect(screen.getByText('The import could not be completed.')).toBeTruthy(),
    );
    expect(screen.queryByText(/migration\.ts/)).toBeNull();
    expect(screen.queryByText(/40P01/)).toBeNull();
    expect(screen.queryByText(/Unique constraint/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Download error report (CSV)' })).toBeTruthy();
  });

  it('does not say an exhausted conflict will be tried again', async () => {
    // WHY: the last attempt is over. The error file and the wizard must not
    // promise another try.
    stubHooks();
    await reachRun({
      id: 'job-1',
      status: 'FAILED',
      totalRows: 1,
      processedRows: 0,
      errorRows: 0,
      errorSummary: [{ row: 0, field: null, message: 'import_conflict' }],
    });
    await waitFor(() =>
      expect(screen.getByText('The import conflicted with another write.')).toBeTruthy(),
    );
    expect(screen.queryByText(/will be tried again/)).toBeNull();
  });

  it('shows a failed start on the confirm step and sends it once', async () => {
    // WHY: Confirm lives on the preview step. The error was only rendered on
    // the mapping step, so a 500 left the screen unchanged, and a second click
    // before pending flipped sent the import again.
    stubHooks();
    hookMocks.useStartCsvImport.mockReturnValue({
      mutate: hookMocks.mutate,
      isPending: false,
      isError: true,
    });
    render(<CsvImportWizard />);
    await uploadFile('name,domain\nAcme,acme.com');
    fireEvent.click(screen.getByRole('button', { name: /Preview \d+ rows?/ }));
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
    expect(
      screen.getByText('Could not start the import. Check your mappings and try again.'),
    ).toBeTruthy();
    const confirm = screen.getByRole('button', { name: 'Confirm import' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(hookMocks.mutate).toHaveBeenCalledTimes(1);
  });
});
