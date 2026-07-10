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
  useStartCsvImport: vi.fn(),
  useMigrationJob: vi.fn(),
  downloadMigrationErrors: vi.fn(),
}));

vi.mock('@/hooks/useMigrations', () => ({
  useStartCsvImport: hookMocks.useStartCsvImport,
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

  it('auto-maps recognizable headers and blocks import while a required target field is unmapped', async () => {
    // WHY: 'company' is the default entity and its Name field is required.
    // A CSV with an unrecognized header for the name column must leave that
    // required field unmapped, and the wizard must refuse to start rather
    // than silently import rows with a blank required field.
    hookMocks.useStartCsvImport.mockReturnValue({ mutate: hookMocks.mutate, isPending: false, isError: false });
    hookMocks.useMigrationJob.mockReturnValue({ data: undefined, isLoading: false });

    render(<CsvImportWizard />);
    await uploadFile('company_title,domain\nAcme,acme.com');

    expect(
      screen.getByText('Map a column to: Name.'),
    ).toBeTruthy();
    const importButton = screen.getByRole('button', { name: /Import \d+ rows/ });
    expect(importButton).toHaveProperty('disabled', true);
  });

  it('once every required field is mapped, starts the import with the chosen dedup strategy', async () => {
    hookMocks.useStartCsvImport.mockReturnValue({ mutate: hookMocks.mutate, isPending: false, isError: false });
    hookMocks.useMigrationJob.mockReturnValue({ data: undefined, isLoading: false });

    render(<CsvImportWizard />);
    // 'name' is a header autoMap should recognize for company.name.
    await uploadFile('name,domain\nAcme,acme.com');

    expect(screen.queryByText(/Map a column to:/)).toBeNull();

    fireEvent.change(screen.getByLabelText('If a record already exists'), {
      target: { value: 'skip' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Import \d+ rows/ }));

    expect(hookMocks.mutate).toHaveBeenCalledOnce();
    const [input] = hookMocks.mutate.mock.calls[0]!;
    expect(input).toMatchObject({ source: 'CSV', entityType: 'company', dedupStrategy: 'skip' });
    expect(input.rows).toHaveLength(1);
  });

  it('rejects a file with more rows than the stated limit before ever calling the API', async () => {
    // WHY: MAX_ROWS is a client-side guard against pasting a spreadsheet
    // export meant for a bulk-data pipeline, not this UI — it must reject
    // BEFORE start.mutate is ever reachable, not rely on the server 400ing.
    hookMocks.useStartCsvImport.mockReturnValue({ mutate: hookMocks.mutate, isPending: false, isError: false });
    hookMocks.useMigrationJob.mockReturnValue({ data: undefined, isLoading: false });

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
    hookMocks.useStartCsvImport.mockReturnValue({ mutate: hookMocks.mutate, isPending: false, isError: false });
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
    fireEvent.click(screen.getByRole('button', { name: /Import \d+ rows/ }));
    // The component's onSuccess callback sets jobId + advances to 'run' —
    // simulate that by invoking the mutate call's onSuccess directly.
    const [, opts] = hookMocks.mutate.mock.calls[0]!;
    opts.onSuccess({ id: 'job-1' });

    await waitFor(() => expect(screen.getByText('Import complete')).toBeTruthy());
    expect(screen.getByText('2 rows could not be imported.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Download error report (CSV)' }));
    expect(hookMocks.downloadMigrationErrors).toHaveBeenCalledWith('job-1');
  });
});
