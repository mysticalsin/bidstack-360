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

vi.mock('@/hooks/useMigrations', () => ({
  useStartCsvImport: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useCancelMigration: () => ({ mutate: vi.fn(), isPending: false }),
  useRetryMigration: () => ({ mutate: vi.fn(), isPending: false }),
  usePreviewCsvImport: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useParseSpreadsheet: () => ({ mutateAsync: vi.fn() }),
  useMigrationJob: () => ({ data: undefined, isLoading: false }),
  downloadMigrationErrors: vi.fn(),
}));

import { CsvImportWizard } from './CsvImportWizard';

function columnSelect(header: string): HTMLSelectElement {
  return screen.getByRole('combobox', { name: `Map column ${header}` }) as HTMLSelectElement;
}

describe('CsvImportWizard column map', () => {
  afterEach(() => {
    cleanup();
  });

  it('drops a field from the earlier column when a later column takes it', async () => {
    // WHY: two columns left on Name made the preview check the first cell and
    // the import write the second. The map on screen has to show one column
    // for that field, the one that will be written.
    render(<CsvImportWizard />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['Name,Legal\n,Northwind Freight\n'], 'accounts.csv', {
      type: 'text/csv',
    });
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    fireEvent.change(input);

    await screen.findByText(/Match each column/);

    const name = columnSelect('Name');
    const legal = columnSelect('Legal');
    expect(name.value).toBe('company.name');
    expect(legal.value).toBe('');

    fireEvent.change(legal, { target: { value: 'company.name' } });

    expect(columnSelect('Legal').value).toBe('company.name');
    expect(columnSelect('Name').value).toBe('');
    expect(screen.queryByText('Map a column to: Name.')).toBeNull();
  });
});
