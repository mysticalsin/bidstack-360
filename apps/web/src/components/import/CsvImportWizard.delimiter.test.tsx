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
  previewMutate: vi.fn(),
}));

vi.mock('@/hooks/useMigrations', () => ({
  useStartCsvImport: () => ({ mutate: hookMocks.mutate, isPending: false, isError: false }),
  useCancelMigration: () => ({ mutate: vi.fn(), isPending: false }),
  useRetryMigration: () => ({ mutate: vi.fn(), isPending: false }),
  usePreviewCsvImport: () => ({ mutate: hookMocks.previewMutate, isPending: false, isError: false }),
  useParseSpreadsheet: () => ({ mutateAsync: vi.fn() }),
  useMigrationJob: () => ({ data: undefined, isLoading: false }),
  downloadMigrationErrors: vi.fn(),
}));

import { CsvImportWizard } from './CsvImportWizard';

describe('CsvImportWizard semicolon file', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('previews the company in the name column, not the Excel separator line', async () => {
    // WHY: a demo import of an Excel semicolon file must not offer the sep
    // hint, or the glued "name;domain" line, as a company that passed preview.
    render(<CsvImportWizard />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(
      ['sep=;\nname;domain\nLumen Freight;lumen.example\n'],
      'accounts.csv',
      { type: 'text/csv' },
    );
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    fireEvent.change(input);

    expect(await screen.findByText('Lumen Freight')).toBeTruthy();
    expect(screen.getByText('lumen.example')).toBeTruthy();
    expect(screen.queryByText('name;domain')).toBeNull();
    expect(screen.queryByText('Lumen Freight;lumen.example')).toBeNull();
    expect(screen.queryByText('Map a column to: Name.')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Preview 1 row' }));
    await waitFor(() => expect(hookMocks.previewMutate).toHaveBeenCalledOnce());
    const [previewInput] = hookMocks.previewMutate.mock.calls[0]!;
    expect(previewInput.rows).toEqual([{ name: 'Lumen Freight', domain: 'lumen.example' }]);
    expect(hookMocks.mutate).not.toHaveBeenCalled();
  });
});
