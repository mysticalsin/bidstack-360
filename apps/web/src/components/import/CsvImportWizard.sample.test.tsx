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

function rowText(header: string): string {
  const select = screen.getByRole('combobox', { name: `Map column ${header}` });
  return select.closest('tr')?.textContent ?? '';
}

describe('CsvImportWizard column sample', () => {
  afterEach(() => {
    cleanup();
  });

  it('shows a later filled cell when the first cell in that column is blank', async () => {
    // WHY: the map step's sample is the only proof of what a column holds.
    // A blank first cell rendered as a dash, so Name looked empty and the
    // account in the next row was invisible. A column with no values must
    // say so, and a column whose first value is present must show that value.
    render(<CsvImportWizard />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(
      [
        'name,domain,note\n',
        ',lumen.example,\n',
        'Northwind Freight,northwind.example,\n',
      ],
      'accounts.csv',
      { type: 'text/csv' },
    );
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    fireEvent.change(input);

    await screen.findByText(/Match each column/);

    const name = rowText('name');
    expect(name).toContain('Northwind Freight');
    expect(name).not.toContain('lumen.example');

    const domain = rowText('domain');
    expect(domain).toContain('lumen.example');
    expect(domain).not.toContain('northwind.example');

    expect(rowText('note')).toContain('Empty');
    expect(screen.queryByText('Map a column to: Name.')).toBeNull();
  });
});
