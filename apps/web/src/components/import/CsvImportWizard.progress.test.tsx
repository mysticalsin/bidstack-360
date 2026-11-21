// WHY: a finished import was painting 99 next to "Import complete" whenever
// some rows failed, because the bar used processed/total. Complete is 100.
// A job that is still running counts processed and errored rows and stops at 99.

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
  await screen.findByText(/rows?\. Match each column/);
}

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

function bar(): HTMLElement {
  const node = screen.getByRole('progressbar');
  if (!(node instanceof HTMLElement)) throw new Error('progress bar is not an element');
  return node;
}

describe('CsvImportWizard progress percent', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows 100 next to Import complete when some rows failed', async () => {
    // WHY: 248 imported and 2 failed is a finished job. processed/total rounds
    // to 99, which reads as still running beside "Import complete".
    stubHooks();
    await reachRun({
      id: 'job-1',
      status: 'COMPLETE',
      totalRows: 250,
      processedRows: 248,
      errorRows: 2,
    });
    await waitFor(() => expect(screen.getByText('Import complete')).toBeTruthy());
    expect(bar().getAttribute('aria-valuenow')).toBe('100');
    expect(bar().style.width).toBe('100%');
  });

  it('shows 100 when a completed import has no error rows', async () => {
    stubHooks();
    await reachRun({
      id: 'job-1',
      status: 'COMPLETE',
      totalRows: 250,
      processedRows: 250,
      errorRows: 0,
    });
    await waitFor(() => expect(screen.getByText('Import complete')).toBeTruthy());
    expect(bar().getAttribute('aria-valuenow')).toBe('100');
    expect(bar().style.width).toBe('100%');
  });

  it('counts errored rows while the import is running and stops at 99', async () => {
    // WHY: the bar has to move when a row fails, and it must not read 100
    // until the job is complete.
    stubHooks();
    await reachRun({
      id: 'job-1',
      status: 'RUNNING',
      totalRows: 200,
      processedRows: 100,
      errorRows: 50,
    });
    await waitFor(() => expect(screen.getByText('Importing…')).toBeTruthy());
    expect(bar().getAttribute('aria-valuenow')).toBe('75');
    expect(bar().style.width).toBe('75%');
  });

  it('caps a running import at 99 when the ratio rounds to 100', async () => {
    stubHooks();
    await reachRun({
      id: 'job-1',
      status: 'RUNNING',
      totalRows: 200,
      processedRows: 199,
      errorRows: 0,
    });
    await waitFor(() => expect(screen.getByText('Importing…')).toBeTruthy());
    expect(bar().getAttribute('aria-valuenow')).toBe('99');
    expect(bar().style.width).toBe('99%');
  });

  it('uses 0 while running when the file has no rows', async () => {
    // WHY: total 0 must not divide. An open job is 0, not NaN or Infinity.
    stubHooks();
    await reachRun({
      id: 'job-1',
      status: 'RUNNING',
      totalRows: 0,
      processedRows: 0,
      errorRows: 0,
    });
    await waitFor(() => expect(screen.getByText('Importing…')).toBeTruthy());
    const now = bar().getAttribute('aria-valuenow');
    expect(now).toBe('0');
    expect(Number.isFinite(Number(now))).toBe(true);
    expect(bar().style.width).toBe('0%');
  });

  it('uses 100 when a completed import has no rows', async () => {
    // WHY: a finished job with nothing to count is complete. The bar is 100.
    stubHooks();
    await reachRun({
      id: 'job-1',
      status: 'COMPLETE',
      totalRows: 0,
      processedRows: 0,
      errorRows: 0,
    });
    await waitFor(() => expect(screen.getByText('Import complete')).toBeTruthy());
    const now = bar().getAttribute('aria-valuenow');
    expect(now).toBe('100');
    expect(Number.isFinite(Number(now))).toBe(true);
    expect(bar().style.width).toBe('100%');
  });
});
