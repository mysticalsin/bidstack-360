import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
  useCancelMigration: vi.fn(),
  useRetryMigration: vi.fn(),
  usePreviewCsvImport: vi.fn(),
  useParseSpreadsheet: vi.fn(),
  useMigrationJob: vi.fn(),
}));

vi.mock('@/hooks/useMigrations', () => ({
  useStartCsvImport: hookMocks.useStartCsvImport,
  useCancelMigration: hookMocks.useCancelMigration,
  useRetryMigration: hookMocks.useRetryMigration,
  usePreviewCsvImport: hookMocks.usePreviewCsvImport,
  useParseSpreadsheet: hookMocks.useParseSpreadsheet,
  useMigrationJob: hookMocks.useMigrationJob,
  downloadMigrationErrors: vi.fn(),
}));

import { CsvImportWizard } from './CsvImportWizard';

function chooseFile(text: string, name = 'accounts.csv') {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File([text], name, { type: 'text/csv' });
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  fireEvent.change(input);
}

describe('CsvImportWizard empty CSV', () => {
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
    hookMocks.useCancelMigration.mockReturnValue({ mutate: vi.fn(), isPending: false });
    hookMocks.useRetryMigration.mockReturnValue({ mutate: vi.fn(), isPending: false });
    hookMocks.usePreviewCsvImport.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      isError: false,
    });
    hookMocks.useParseSpreadsheet.mockReturnValue({ mutateAsync: vi.fn() });
    hookMocks.useMigrationJob.mockReturnValue({ data: undefined, isLoading: false });
  }

  it('stays on upload when the only rows are spreadsheet leftovers', async () => {
    // WHY: a header plus comma-only rows is an empty sheet. Opening mapping
    // would offer a blank record as if it were an account to import.
    stubHooks();
    render(<CsvImportWizard />);

    chooseFile('name,domain\n,\n,,\n');

    expect(await screen.findByText('That file has no data rows.')).toBeTruthy();
    expect(screen.queryByText(/Match each column/)).toBeNull();
    expect(hookMocks.mutate).not.toHaveBeenCalled();
  });

  it('does not carry a leftover blank row into the next file', async () => {
    // WHY: Start over then a blank file must not leave the previous account
    // on the mapping step, and a later file must not count the commas the
    // spreadsheet left under the real row.
    stubHooks();
    render(<CsvImportWizard />);

    chooseFile('name,domain\nVestra Logistics,vestra.example\n');
    expect(await screen.findByText('Vestra Logistics')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Start over' }));
    chooseFile('name,domain\n,\n');

    expect(await screen.findByText('That file has no data rows.')).toBeTruthy();
    expect(screen.queryByText('Vestra Logistics')).toBeNull();
    expect(screen.queryByText(/Match each column/)).toBeNull();

    chooseFile('name,domain\nNorthwind Freight,northwind.example\n,\n');
    expect(await screen.findByText(/1 row\. Match each column/)).toBeTruthy();
    expect(screen.getByText('Northwind Freight')).toBeTruthy();
    expect(screen.queryByText(/2 rows\. Match each column/)).toBeNull();
  });
});
